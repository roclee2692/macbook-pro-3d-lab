// 两遍汇编器：第一遍收集标签地址，第二遍生成机器码。
import { COND_ALIASES, COND_NAMES, encode, type Inst, type ShiftType } from './isa';

export const CODE_BASE = 0x1000;

export interface AsmLine {
  line: number; // 源码行号（从 1 开始）
  addr: number;
  word: number;
  source: string;
  isData: boolean;
}

export interface AsmError {
  line: number;
  message: string;
}

export interface Program {
  lines: AsmLine[];
  labels: Record<string, number>;
  errors: AsmError[];
  entry: number;
  end: number; // 最后一个字节之后的地址
  words: { addr: number; word: number }[];
}

class AsmFail extends Error {}
const fail = (m: string): never => {
  throw new AsmFail(m);
};

function parseReg(tok: string, allowSp = false): number {
  const t = tok.trim().toLowerCase();
  if (t === 'xzr') return 31;
  if (t === 'sp') {
    if (!allowSp) fail('此处不能使用 sp');
    return 31;
  }
  if (t === 'lr') return 30;
  if (t === 'fp') return 29;
  const m = /^x(\d{1,2})$/.exec(t);
  if (!m) {
    if (/^w\d+$/.test(t)) fail(`本模拟器只支持 64 位 X 寄存器，暂不支持 ${tok}`);
    fail(`无法识别的寄存器“${tok}”`);
  }
  const n = Number(m![1]);
  if (n > 30) fail(`寄存器编号超出范围：${tok}`);
  return n;
}

function parseImm(tok: string): number {
  const t = tok.trim().replace(/^#/, '');
  if (!/^-?(0x[0-9a-f]+|\d+)$/i.test(t)) fail(`无法识别的立即数“${tok}”`);
  const neg = t.startsWith('-');
  const v = Number(neg ? t.slice(1) : t);
  return neg ? -v : v;
}

// 按逗号切分，但保留方括号内整体
function splitOperands(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseShift(ops: string[], idx: number): { shift: ShiftType; amount: number } {
  if (ops.length <= idx) return { shift: 'lsl', amount: 0 };
  const m = /^(lsl|lsr|asr)\s+#?(\d+)$/i.exec(ops[idx]);
  if (!m) fail(`无法识别的移位“${ops[idx]}”`);
  const amount = Number(m![2]);
  if (amount > 63) fail('移位量必须在 0–63');
  return { shift: m![1].toLowerCase() as ShiftType, amount };
}

function movImm(rd: number, value: number): Inst {
  if (!Number.isSafeInteger(value)) fail('立即数超出范围');
  if (value >= 0) {
    for (let hw = 0; hw < 4; hw++) {
      const sh = 2 ** (16 * hw);
      if (value % sh === 0 && value / sh <= 0xffff) return { op: 'movz', rd, imm16: value / sh, hw };
    }
  } else if (value >= -0x10000) {
    return { op: 'movn', rd, imm16: -value - 1, hw: 0 };
  }
  return fail(`立即数 ${value} 无法用一条 MOVZ/MOVN 表示，请用 movz + movk 组合`);
}

function arithImm(op: 'add_i' | 'sub_i' | 'adds_i' | 'subs_i', rd: number, rn: number, immTok: string, shiftTok?: string): Inst {
  let imm = parseImm(immTok);
  let sh = 0;
  if (shiftTok) {
    if (!/^lsl\s+#?12$/i.test(shiftTok)) fail('立即数加减只能使用 lsl #12');
    sh = 1;
  }
  if (imm < 0) {
    // add x, x, #-n 等价于 sub x, x, #n（与 clang 行为一致）
    imm = -imm;
    op = ({ add_i: 'sub_i', sub_i: 'add_i', adds_i: 'subs_i', subs_i: 'adds_i' } as const)[op];
  }
  if (imm > 0xfff) {
    if (!sh && imm % 4096 === 0 && imm / 4096 <= 0xfff) {
      imm /= 4096;
      sh = 1;
    } else fail('立即数加减范围为 0–4095（或 4096 的倍数，自动使用 lsl #12）');
  }
  return { op, rd, rn, imm12: imm, sh };
}

function branchOffset(target: string, labels: Record<string, number>, pc: number, bitsWidth: number): number {
  const key = target.trim();
  let addr: number;
  if (key in labels) addr = labels[key];
  else if (/^#?-?(0x[0-9a-f]+|\d+)$/i.test(key)) addr = pc + parseImm(key);
  else return fail(`未定义的标签“${key}”`);
  const off = addr - pc;
  if (off % 4 !== 0) fail('跳转目标必须 4 字节对齐');
  const lim = 2 ** bitsWidth;
  if (off < -lim || off >= lim) fail('跳转距离超出编码范围');
  return off;
}

function assembleOne(mn: string, ops: string[], pc: number, labels: Record<string, number>): Inst {
  const n = (k: number) => {
    if (ops.length !== k) fail(`${mn} 需要 ${k} 个操作数`);
  };
  const isImm = (s: string) => s.trim().startsWith('#') || /^-?\d/.test(s.trim());
  switch (mn) {
    case 'nop': n(0); return { op: 'nop' };
    case 'ret': return { op: 'ret', rn: ops.length ? parseReg(ops[0]) : 30 };
    case 'brk': n(1); { const v = parseImm(ops[0]); if (v < 0 || v > 0xffff) fail('brk 立即数 0–65535'); return { op: 'brk', imm16: v }; }
    case 'mov': {
      n(2);
      const rdSp = ops[0].trim().toLowerCase() === 'sp';
      if (isImm(ops[1])) return movImm(parseReg(ops[0]), parseImm(ops[1]));
      const rsSp = ops[1].trim().toLowerCase() === 'sp';
      if (rdSp || rsSp) return { op: 'add_i', rd: parseReg(ops[0], true), rn: parseReg(ops[1], true), imm12: 0, sh: 0 };
      return { op: 'orr_r', rd: parseReg(ops[0]), rn: 31, rm: parseReg(ops[1]), shift: 'lsl', amount: 0 };
    }
    case 'movz': case 'movk': case 'movn': {
      if (ops.length < 2 || ops.length > 3) fail(`${mn} 需要 2–3 个操作数`);
      const v = parseImm(ops[1]);
      if (v < 0 || v > 0xffff) fail('imm16 范围 0–65535');
      let hw = 0;
      if (ops[2]) {
        const m = /^lsl\s+#?(\d+)$/i.exec(ops[2]);
        if (!m || Number(m[1]) % 16 !== 0 || Number(m[1]) > 48) fail('移位只能是 lsl #0/16/32/48');
        hw = Number(m![1]) / 16;
      }
      return { op: mn, rd: parseReg(ops[0]), imm16: v, hw };
    }
    case 'add': case 'sub': case 'adds': case 'subs': {
      if (ops.length < 3) fail(`${mn} 至少需要 3 个操作数`);
      if (isImm(ops[2])) {
        const rd = parseReg(ops[0], mn === 'add' || mn === 'sub');
        const rn = parseReg(ops[1], true);
        return arithImm(`${mn}_i` as 'add_i', rd, rn, ops[2], ops[3]);
      }
      const { shift, amount } = parseShift(ops, 3);
      return { op: `${mn}_r` as 'add_r', rd: parseReg(ops[0]), rn: parseReg(ops[1]), rm: parseReg(ops[2]), shift, amount };
    }
    case 'cmp': {
      if (ops.length < 2) fail('cmp 需要 2 个操作数');
      if (isImm(ops[1])) return arithImm('subs_i', 31, parseReg(ops[0], true), ops[1], ops[2]);
      const { shift, amount } = parseShift(ops, 2);
      return { op: 'subs_r', rd: 31, rn: parseReg(ops[0]), rm: parseReg(ops[1]), shift, amount };
    }
    case 'and': case 'orr': case 'eor': {
      if (ops.length < 3) fail(`${mn} 需要 3 个操作数`);
      if (isImm(ops[2])) fail('本模拟器暂未实现逻辑立即数（位掩码编码），请先把常数 mov 到寄存器');
      const { shift, amount } = parseShift(ops, 3);
      return { op: `${mn}_r` as 'and_r', rd: parseReg(ops[0]), rn: parseReg(ops[1]), rm: parseReg(ops[2]), shift, amount };
    }
    case 'mul': n(3); return { op: 'madd', rd: parseReg(ops[0]), rn: parseReg(ops[1]), rm: parseReg(ops[2]), ra: 31 };
    case 'madd': n(4); return { op: 'madd', rd: parseReg(ops[0]), rn: parseReg(ops[1]), rm: parseReg(ops[2]), ra: parseReg(ops[3]) };
    case 'udiv': n(3); return { op: 'udiv', rd: parseReg(ops[0]), rn: parseReg(ops[1]), rm: parseReg(ops[2]) };
    case 'lsl': case 'lsr': {
      n(3);
      const rd = parseReg(ops[0]);
      const rn = parseReg(ops[1]);
      if (isImm(ops[2])) {
        const sh = parseImm(ops[2]);
        if (sh < 0 || sh > 63) fail('移位量 0–63');
        return mn === 'lsl' ? { op: 'ubfm', rd, rn, immr: (64 - sh) % 64, imms: 63 - sh } : { op: 'ubfm', rd, rn, immr: sh, imms: 63 };
      }
      return { op: mn === 'lsl' ? 'lslv' : 'lsrv', rd, rn, rm: parseReg(ops[2]) };
    }
    case 'ldr': case 'str': {
      n(2);
      const rt = parseReg(ops[0]);
      const m = /^\[(.+)\]$/.exec(ops[1].trim());
      if (!m) fail('内存操作数格式应为 [xn]、[xn, #imm] 或 [xn, xm{, lsl #3}]；暂不支持前/后变址');
      const inner = splitOperands(m![1]);
      const rn = parseReg(inner[0], true);
      if (inner.length === 1 || isImm(inner[1])) {
        const off = inner.length === 1 ? 0 : parseImm(inner[1]);
        if (off < 0 || off % 8 !== 0 || off > 32760) fail('偏移必须是 0–32760 之间 8 的倍数');
        return { op: mn === 'ldr' ? 'ldr_u' : 'str_u', rt, rn, offset: off };
      }
      const rm = parseReg(inner[1]);
      let scaled = false;
      if (inner[2]) {
        if (!/^lsl\s+#?3$/i.test(inner[2])) fail('寄存器偏移只支持 lsl #3');
        scaled = true;
      }
      return { op: mn === 'ldr' ? 'ldr_r' : 'str_r', rt, rn, rm, scaled };
    }
    case 'b': case 'bl': n(1); return { op: mn, offset: branchOffset(ops[0], labels, pc, 27) };
    case 'cbz': case 'cbnz': n(2); return { op: mn, rt: parseReg(ops[0]), offset: branchOffset(ops[1], labels, pc, 20) };
    case 'adr': n(2); return { op: 'adr', rd: parseReg(ops[0]), offset: branchOffset(ops[1], labels, pc, 20) };
    default: {
      const m = /^b\.(\w+)$/.exec(mn);
      if (m) {
        n(1);
        const c = m[1];
        let cond = (COND_NAMES as readonly string[]).indexOf(c);
        if (cond < 0 && c in COND_ALIASES) cond = COND_ALIASES[c];
        if (cond < 0) fail(`未知条件码“${c}”`);
        return { op: 'bcond', cond, offset: branchOffset(ops[0], labels, pc, 20) };
      }
      return fail(`不支持的指令“${mn}”`);
    }
  }
}

function stripComment(s: string) {
  const i = s.search(/\/\/|;/);
  return i >= 0 ? s.slice(0, i) : s;
}

export function assemble(src: string, base = CODE_BASE): Program {
  const rawLines = src.split('\n');
  const labels: Record<string, number> = {};
  const errors: AsmError[] = [];
  type Item = { line: number; text: string; addr: number; kind: 'inst' | 'quad'; values?: string[] };
  const items: Item[] = [];
  let pc = base;

  rawLines.forEach((raw, idx) => {
    let text = stripComment(raw).trim();
    while (true) {
      const m = /^([A-Za-z_.][\w.]*):\s*/.exec(text);
      if (!m) break;
      if (m[1] in labels) errors.push({ line: idx + 1, message: `标签“${m[1]}”重复定义` });
      labels[m[1]] = pc;
      text = text.slice(m[0].length);
    }
    if (!text) return;
    if (/^\.(text|global|globl|align|p2align)\b/i.test(text)) return;
    const q = /^\.quad\s+(.+)$/i.exec(text);
    if (q) {
      const values = splitOperands(q[1]);
      if (pc % 8 !== 0) {
        errors.push({ line: idx + 1, message: '.quad 需要 8 字节对齐（可在前面加 nop）' });
        return;
      }
      items.push({ line: idx + 1, text, addr: pc, kind: 'quad', values });
      pc += 8 * values.length;
      return;
    }
    items.push({ line: idx + 1, text, addr: pc, kind: 'inst' });
    pc += 4;
  });

  const lines: AsmLine[] = [];
  const words: { addr: number; word: number }[] = [];
  for (const it of items) {
    try {
      if (it.kind === 'quad') {
        it.values!.forEach((v, k) => {
          const n = v.trim() in labels ? labels[v.trim()] : parseImm(v);
          const lo = Number(BigInt.asUintN(64, BigInt(n)) & 0xffffffffn);
          const hi = Number((BigInt.asUintN(64, BigInt(n)) >> 32n) & 0xffffffffn);
          const a = it.addr + 8 * k;
          words.push({ addr: a, word: lo >>> 0 }, { addr: a + 4, word: hi >>> 0 });
          lines.push({ line: it.line, addr: a, word: lo >>> 0, source: `.quad ${v.trim()}`, isData: true });
        });
        continue;
      }
      const sp = it.text.search(/\s/);
      const mn = (sp < 0 ? it.text : it.text.slice(0, sp)).toLowerCase();
      const ops = sp < 0 ? [] : splitOperands(it.text.slice(sp + 1));
      const inst = assembleOne(mn, ops, it.addr, labels);
      const word = encode(inst);
      words.push({ addr: it.addr, word });
      lines.push({ line: it.line, addr: it.addr, word, source: it.text, isData: false });
    } catch (e) {
      if (e instanceof AsmFail) errors.push({ line: it.line, message: e.message });
      else throw e;
    }
  }
  return { lines, labels, errors, entry: labels._start ?? labels.main ?? base, end: pc, words };
}

export const hex32 = (w: number) => (w >>> 0).toString(16).padStart(8, '0');
