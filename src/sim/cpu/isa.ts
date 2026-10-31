// AArch64（A64）指令子集：编码与解码。
// 编码规则来自 Arm ARM；每种格式的编码都在 tests/isa.test.ts 中与本机 clang 汇编出的机器码逐条比对。
// CPU 执行时只读取内存中的 32 位机器码并在这里解码——不依赖汇编源码文本。

export const COND_NAMES = ['eq', 'ne', 'hs', 'lo', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le', 'al', 'nv'] as const;
export const COND_ALIASES: Record<string, number> = { cs: 2, cc: 3 };

export type ShiftType = 'lsl' | 'lsr' | 'asr';
const SHIFT_NAMES: ShiftType[] = ['lsl', 'lsr', 'asr'];

export type Inst =
  | { op: 'movz' | 'movk' | 'movn'; rd: number; imm16: number; hw: number }
  | { op: 'add_i' | 'sub_i' | 'adds_i' | 'subs_i'; rd: number; rn: number; imm12: number; sh: number }
  | { op: 'add_r' | 'sub_r' | 'adds_r' | 'subs_r' | 'and_r' | 'orr_r' | 'eor_r'; rd: number; rn: number; rm: number; shift: ShiftType; amount: number }
  | { op: 'madd'; rd: number; rn: number; rm: number; ra: number }
  | { op: 'udiv' | 'lslv' | 'lsrv'; rd: number; rn: number; rm: number }
  | { op: 'ubfm'; rd: number; rn: number; immr: number; imms: number }
  | { op: 'ldr_u' | 'str_u'; rt: number; rn: number; offset: number }
  | { op: 'ldr_r' | 'str_r'; rt: number; rn: number; rm: number; scaled: boolean }
  | { op: 'b' | 'bl'; offset: number }
  | { op: 'bcond'; cond: number; offset: number }
  | { op: 'cbz' | 'cbnz'; rt: number; offset: number }
  | { op: 'adr'; rd: number; offset: number }
  | { op: 'ret'; rn: number }
  | { op: 'nop' }
  | { op: 'brk'; imm16: number };

export interface BitField {
  label: string;
  hi: number;
  lo: number;
  value: number;
}

export interface Decoded {
  word: number;
  inst: Inst;
  text: string; // 反汇编（规范别名形式）
  fields: BitField[];
  klass: string; // 指令类别（中文）
}

const u32 = (x: number) => x >>> 0;
const bits = (w: number, hi: number, lo: number) => (w >>> lo) & ((1 << (hi - lo + 1)) - 1 || 0xffffffff);
const sext = (v: number, width: number) => (v << (32 - width)) >> (32 - width);

// ---------- 编码 ----------
export function encode(i: Inst): number {
  switch (i.op) {
    case 'movz':
      return u32(0xd2800000 | (i.hw << 21) | (i.imm16 << 5) | i.rd);
    case 'movk':
      return u32(0xf2800000 | (i.hw << 21) | (i.imm16 << 5) | i.rd);
    case 'movn':
      return u32(0x92800000 | (i.hw << 21) | (i.imm16 << 5) | i.rd);
    case 'add_i':
    case 'sub_i':
    case 'adds_i':
    case 'subs_i': {
      const base = { add_i: 0x91000000, sub_i: 0xd1000000, adds_i: 0xb1000000, subs_i: 0xf1000000 }[i.op];
      return u32(base | (i.sh << 22) | (i.imm12 << 10) | (i.rn << 5) | i.rd);
    }
    case 'add_r':
    case 'sub_r':
    case 'adds_r':
    case 'subs_r':
    case 'and_r':
    case 'orr_r':
    case 'eor_r': {
      const base = { add_r: 0x8b000000, sub_r: 0xcb000000, adds_r: 0xab000000, subs_r: 0xeb000000, and_r: 0x8a000000, orr_r: 0xaa000000, eor_r: 0xca000000 }[i.op];
      return u32(base | (SHIFT_NAMES.indexOf(i.shift) << 22) | (i.rm << 16) | (i.amount << 10) | (i.rn << 5) | i.rd);
    }
    case 'madd':
      return u32(0x9b000000 | (i.rm << 16) | (i.ra << 10) | (i.rn << 5) | i.rd);
    case 'udiv':
    case 'lslv':
    case 'lsrv': {
      const base = { udiv: 0x9ac00800, lslv: 0x9ac02000, lsrv: 0x9ac02400 }[i.op];
      return u32(base | (i.rm << 16) | (i.rn << 5) | i.rd);
    }
    case 'ubfm':
      return u32(0xd3400000 | (i.immr << 16) | (i.imms << 10) | (i.rn << 5) | i.rd);
    case 'ldr_u':
    case 'str_u':
      return u32((i.op === 'ldr_u' ? 0xf9400000 : 0xf9000000) | ((i.offset >> 3) << 10) | (i.rn << 5) | i.rt);
    case 'ldr_r':
    case 'str_r':
      return u32((i.op === 'ldr_r' ? 0xf8606800 : 0xf8206800) | (i.rm << 16) | ((i.scaled ? 1 : 0) << 12) | (i.rn << 5) | i.rt);
    case 'b':
    case 'bl':
      return u32((i.op === 'b' ? 0x14000000 : 0x94000000) | ((i.offset >> 2) & 0x3ffffff));
    case 'bcond':
      return u32(0x54000000 | (((i.offset >> 2) & 0x7ffff) << 5) | i.cond);
    case 'cbz':
    case 'cbnz':
      return u32((i.op === 'cbz' ? 0xb4000000 : 0xb5000000) | (((i.offset >> 2) & 0x7ffff) << 5) | i.rt);
    case 'adr': {
      const imm = i.offset & 0x1fffff;
      return u32(0x10000000 | ((imm & 3) << 29) | ((imm >> 2) << 5) | i.rd);
    }
    case 'ret':
      return u32(0xd65f0000 | (i.rn << 5));
    case 'nop':
      return 0xd503201f;
    case 'brk':
      return u32(0xd4200000 | (i.imm16 << 5));
  }
}

// ---------- 解码 ----------
const F = (label: string, w: number, hi: number, lo: number): BitField => ({ label, hi, lo, value: bits(w, hi, lo) });

export function decode(word: number): Decoded | null {
  const w = u32(word);
  const rd = w & 31;
  const rn = (w >>> 5) & 31;
  const rm = (w >>> 16) & 31;
  let inst: Inst | null = null;
  let fields: BitField[] = [];
  let klass = '';

  const top9 = u32(w & 0xff800000);
  if (top9 === 0xd2800000 || top9 === 0xf2800000 || top9 === 0x92800000) {
    const op = top9 === 0xd2800000 ? 'movz' : top9 === 0xf2800000 ? 'movk' : 'movn';
    inst = { op, rd, imm16: bits(w, 20, 5), hw: bits(w, 22, 21) };
    fields = [F('sf', w, 31, 31), F('opc', w, 30, 29), F('100101', w, 28, 23), F('hw', w, 22, 21), F('imm16', w, 20, 5), F('Rd', w, 4, 0)];
    klass = '宽立即数传送';
  }
  const top8 = u32(w & 0xff000000);
  if (!inst && (top8 === 0x91000000 || top8 === 0xd1000000 || top8 === 0xb1000000 || top8 === 0xf1000000) && bits(w, 23, 23) === 0) {
    const op = ({ 0x91000000: 'add_i', 0xd1000000: 'sub_i', 0xb1000000: 'adds_i', 0xf1000000: 'subs_i' } as const)[top8 as 0x91000000];
    inst = { op, rd, rn, imm12: bits(w, 21, 10), sh: bits(w, 22, 22) };
    fields = [F('sf', w, 31, 31), F('op', w, 30, 30), F('S', w, 29, 29), F('100010', w, 28, 23), F('sh', w, 22, 22), F('imm12', w, 21, 10), F('Rn', w, 9, 5), F('Rd', w, 4, 0)];
    klass = '算术（立即数）';
  }
  if (!inst && bits(w, 21, 21) === 0 && bits(w, 23, 22) !== 3) {
    const t = u32(w & 0xff200000);
    const map: Record<number, Inst['op']> = { 0x8b000000: 'add_r', 0xcb000000: 'sub_r', 0xab000000: 'adds_r', 0xeb000000: 'subs_r', 0x8a000000: 'and_r', 0xaa000000: 'orr_r', 0xca000000: 'eor_r' };
    const op = map[t];
    if (op) {
      const logical = op === 'and_r' || op === 'orr_r' || op === 'eor_r';
      const sh = bits(w, 23, 22);
      if (!(logical && sh === 3)) {
        inst = { op, rd, rn, rm, shift: SHIFT_NAMES[sh], amount: bits(w, 15, 10) } as Inst;
        fields = [F('sf', w, 31, 31), F('opc', w, 30, 29), F(logical ? '01010' : '01011', w, 28, 24), F('shift', w, 23, 22), F('N/0', w, 21, 21), F('Rm', w, 20, 16), F('imm6', w, 15, 10), F('Rn', w, 9, 5), F('Rd', w, 4, 0)];
        klass = logical ? '逻辑运算（寄存器）' : '算术（寄存器）';
      }
    }
  }
  if (!inst && u32(w & 0xffe08000) === 0x9b000000) {
    inst = { op: 'madd', rd, rn, rm, ra: bits(w, 14, 10) };
    fields = [F('sf', w, 31, 31), F('op54', w, 30, 29), F('11011', w, 28, 24), F('op31', w, 23, 21), F('Rm', w, 20, 16), F('o0', w, 15, 15), F('Ra', w, 14, 10), F('Rn', w, 9, 5), F('Rd', w, 4, 0)];
    klass = '乘加';
  }
  if (!inst) {
    const t = u32(w & 0xffe0fc00);
    const op = ({ 0x9ac00800: 'udiv', 0x9ac02000: 'lslv', 0x9ac02400: 'lsrv' } as Record<number, 'udiv' | 'lslv' | 'lsrv'>)[t];
    if (op) {
      inst = { op, rd, rn, rm };
      fields = [F('sf', w, 31, 31), F('0', w, 30, 30), F('S', w, 29, 29), F('11010110', w, 28, 21), F('Rm', w, 20, 16), F('opcode', w, 15, 10), F('Rn', w, 9, 5), F('Rd', w, 4, 0)];
      klass = op === 'udiv' ? '除法' : '可变移位';
    }
  }
  if (!inst && u32(w & 0xffc00000) === 0xd3400000) {
    inst = { op: 'ubfm', rd, rn, immr: bits(w, 21, 16), imms: bits(w, 15, 10) };
    fields = [F('sf', w, 31, 31), F('opc', w, 30, 29), F('100110', w, 28, 23), F('N', w, 22, 22), F('immr', w, 21, 16), F('imms', w, 15, 10), F('Rn', w, 9, 5), F('Rd', w, 4, 0)];
    klass = '位域移动（移位别名）';
  }
  if (!inst && (u32(w & 0xffc00000) === 0xf9400000 || u32(w & 0xffc00000) === 0xf9000000)) {
    inst = { op: u32(w & 0xffc00000) === 0xf9400000 ? 'ldr_u' : 'str_u', rt: rd, rn, offset: bits(w, 21, 10) * 8 };
    fields = [F('size', w, 31, 30), F('111001', w, 29, 24), F('opc', w, 23, 22), F('imm12', w, 21, 10), F('Rn', w, 9, 5), F('Rt', w, 4, 0)];
    klass = '访存（无符号偏移）';
  }
  if (!inst && (u32(w & 0xffe0ec00) === 0xf8606800 || u32(w & 0xffe0ec00) === 0xf8206800)) {
    inst = { op: u32(w & 0xffe0ec00) === 0xf8606800 ? 'ldr_r' : 'str_r', rt: rd, rn, rm, scaled: bits(w, 12, 12) === 1 };
    fields = [F('size', w, 31, 30), F('111000', w, 29, 24), F('opc', w, 23, 22), F('1', w, 21, 21), F('Rm', w, 20, 16), F('option', w, 15, 13), F('S', w, 12, 12), F('10', w, 11, 10), F('Rn', w, 9, 5), F('Rt', w, 4, 0)];
    klass = '访存（寄存器偏移）';
  }
  if (!inst && (u32(w & 0xfc000000) === 0x14000000 || u32(w & 0xfc000000) === 0x94000000)) {
    inst = { op: u32(w & 0xfc000000) === 0x14000000 ? 'b' : 'bl', offset: sext(bits(w, 25, 0), 26) * 4 };
    fields = [F('op', w, 31, 31), F('00101', w, 30, 26), F('imm26', w, 25, 0)];
    klass = inst.op === 'b' ? '无条件跳转' : '函数调用';
  }
  if (!inst && u32(w & 0xff000010) === 0x54000000) {
    inst = { op: 'bcond', cond: w & 15, offset: sext(bits(w, 23, 5), 19) * 4 };
    fields = [F('0101010', w, 31, 25), F('o1', w, 24, 24), F('imm19', w, 23, 5), F('o0', w, 4, 4), F('cond', w, 3, 0)];
    klass = '条件跳转';
  }
  if (!inst && (top8 === 0xb4000000 || top8 === 0xb5000000)) {
    inst = { op: top8 === 0xb4000000 ? 'cbz' : 'cbnz', rt: rd, offset: sext(bits(w, 23, 5), 19) * 4 };
    fields = [F('sf', w, 31, 31), F('011010', w, 30, 25), F('op', w, 24, 24), F('imm19', w, 23, 5), F('Rt', w, 4, 0)];
    klass = '比较并跳转';
  }
  if (!inst && u32(w & 0x9f000000) === 0x10000000) {
    const imm = (bits(w, 23, 5) << 2) | bits(w, 30, 29);
    inst = { op: 'adr', rd, offset: sext(imm, 21) };
    fields = [F('op', w, 31, 31), F('immlo', w, 30, 29), F('10000', w, 28, 24), F('immhi', w, 23, 5), F('Rd', w, 4, 0)];
    klass = 'PC 相对地址';
  }
  if (!inst && u32(w & 0xfffffc1f) === 0xd65f0000) {
    inst = { op: 'ret', rn };
    fields = [F('1101011', w, 31, 25), F('opc', w, 24, 21), F('op2', w, 20, 16), F('op3', w, 15, 10), F('Rn', w, 9, 5), F('op4', w, 4, 0)];
    klass = '函数返回';
  }
  if (!inst && w === 0xd503201f) {
    inst = { op: 'nop' };
    fields = [F('hint', w, 31, 0)];
    klass = '空操作';
  }
  if (!inst && u32(w & 0xffe0001f) === 0xd4200000) {
    inst = { op: 'brk', imm16: bits(w, 20, 5) };
    fields = [F('11010100', w, 31, 24), F('opc', w, 23, 21), F('imm16', w, 20, 5), F('op2/LL', w, 4, 0)];
    klass = '断点（模拟器用作停机）';
  }
  if (!inst) return null;
  return { word: w, inst, text: disasm(inst), fields, klass };
}

// ---------- 反汇编 ----------
export const regName = (r: number, spCtx = false) => (r === 31 ? (spCtx ? 'sp' : 'xzr') : r === 30 ? 'x30' : `x${r}`);

function hex(n: number) {
  return n < 0 ? `-0x${(-n).toString(16)}` : `0x${n.toString(16)}`;
}

export function disasm(i: Inst, pc?: number): string {
  const tgt = (off: number) => (pc === undefined ? `${off >= 0 ? '+' : ''}${off}` : hex(pc + off));
  switch (i.op) {
    case 'movz': return i.hw === 0 ? `mov ${regName(i.rd)}, #${i.imm16}` : `movz ${regName(i.rd)}, #${i.imm16}, lsl #${i.hw * 16}`;
    case 'movk': return `movk ${regName(i.rd)}, #${i.imm16}${i.hw ? `, lsl #${i.hw * 16}` : ''}`;
    case 'movn': return i.hw === 0 ? `mov ${regName(i.rd)}, #${-(i.imm16 + 1)}` : `movn ${regName(i.rd)}, #${i.imm16}, lsl #${i.hw * 16}`;
    case 'add_i':
      if (i.imm12 === 0 && i.sh === 0 && (i.rd === 31 || i.rn === 31)) return `mov ${regName(i.rd, true)}, ${regName(i.rn, true)}`;
      return `add ${regName(i.rd, true)}, ${regName(i.rn, true)}, #${i.imm12}${i.sh ? ', lsl #12' : ''}`;
    case 'sub_i': return `sub ${regName(i.rd, true)}, ${regName(i.rn, true)}, #${i.imm12}${i.sh ? ', lsl #12' : ''}`;
    case 'adds_i': return `adds ${regName(i.rd)}, ${regName(i.rn, true)}, #${i.imm12}${i.sh ? ', lsl #12' : ''}`;
    case 'subs_i':
      return i.rd === 31 ? `cmp ${regName(i.rn, true)}, #${i.imm12}${i.sh ? ', lsl #12' : ''}` : `subs ${regName(i.rd)}, ${regName(i.rn, true)}, #${i.imm12}${i.sh ? ', lsl #12' : ''}`;
    case 'add_r': case 'sub_r': case 'adds_r': case 'subs_r': case 'and_r': case 'orr_r': case 'eor_r': {
      const sfx = i.amount ? `, ${i.shift} #${i.amount}` : '';
      if (i.op === 'orr_r' && i.rn === 31 && i.amount === 0) return `mov ${regName(i.rd)}, ${regName(i.rm)}`;
      if (i.op === 'subs_r' && i.rd === 31) return `cmp ${regName(i.rn)}, ${regName(i.rm)}${sfx}`;
      const m = i.op.replace('_r', '');
      return `${m} ${regName(i.rd)}, ${regName(i.rn)}, ${regName(i.rm)}${sfx}`;
    }
    case 'madd': return i.ra === 31 ? `mul ${regName(i.rd)}, ${regName(i.rn)}, ${regName(i.rm)}` : `madd ${regName(i.rd)}, ${regName(i.rn)}, ${regName(i.rm)}, ${regName(i.ra)}`;
    case 'udiv': return `udiv ${regName(i.rd)}, ${regName(i.rn)}, ${regName(i.rm)}`;
    case 'lslv': return `lsl ${regName(i.rd)}, ${regName(i.rn)}, ${regName(i.rm)}`;
    case 'lsrv': return `lsr ${regName(i.rd)}, ${regName(i.rn)}, ${regName(i.rm)}`;
    case 'ubfm':
      if (i.imms === 63) return `lsr ${regName(i.rd)}, ${regName(i.rn)}, #${i.immr}`;
      if (i.imms + 1 === i.immr) return `lsl ${regName(i.rd)}, ${regName(i.rn)}, #${63 - i.imms}`;
      return `ubfm ${regName(i.rd)}, ${regName(i.rn)}, #${i.immr}, #${i.imms}`;
    case 'ldr_u': case 'str_u':
      return `${i.op.slice(0, 3)} ${regName(i.rt)}, [${regName(i.rn, true)}${i.offset ? `, #${i.offset}` : ''}]`;
    case 'ldr_r': case 'str_r':
      return `${i.op.slice(0, 3)} ${regName(i.rt)}, [${regName(i.rn, true)}, ${regName(i.rm)}${i.scaled ? ', lsl #3' : ''}]`;
    case 'b': case 'bl': return `${i.op} ${tgt(i.offset)}`;
    case 'bcond': return `b.${COND_NAMES[i.cond]} ${tgt(i.offset)}`;
    case 'cbz': case 'cbnz': return `${i.op} ${regName(i.rt)}, ${tgt(i.offset)}`;
    case 'adr': return `adr ${regName(i.rd)}, ${tgt(i.offset)}`;
    case 'ret': return i.rn === 30 ? 'ret' : `ret ${regName(i.rn)}`;
    case 'nop': return 'nop';
    case 'brk': return `brk #${hex(i.imm16)}`;
  }
}

// 指令表：扩展新指令时在此登记语法与说明（汇编器、帮助面板共用）。
export const INSTRUCTION_HELP: { syntax: string; desc: string }[] = [
  { syntax: 'mov xd, #imm', desc: '传送立即数（MOVZ/MOVN 别名）' },
  { syntax: 'movz/movk xd, #imm16{, lsl #16·n}', desc: '写入/保留其他位写入 16 位' },
  { syntax: 'mov xd, xm', desc: '寄存器传送（ORR 别名）' },
  { syntax: 'add/sub xd, xn, #imm12 | xm{, lsl #n}', desc: '加/减' },
  { syntax: 'adds/subs/cmp …', desc: '加/减并设置 NZCV 标志' },
  { syntax: 'and/orr/eor xd, xn, xm', desc: '按位与/或/异或' },
  { syntax: 'mul xd, xn, xm · udiv xd, xn, xm', desc: '乘法（MADD 别名）/ 无符号除法' },
  { syntax: 'lsl/lsr xd, xn, #sh | xm', desc: '逻辑移位' },
  { syntax: 'ldr/str xt, [xn{, #imm}]', desc: '64 位读/写内存（偏移为 8 的倍数）' },
  { syntax: 'ldr/str xt, [xn, xm{, lsl #3}]', desc: '寄存器偏移寻址（数组下标）' },
  { syntax: 'adr xd, label', desc: '取标签地址（PC 相对）' },
  { syntax: 'b label · b.eq/ne/lt/ge/gt/le/hs/lo label', desc: '无条件 / 条件跳转' },
  { syntax: 'cbz/cbnz xt, label', desc: '为零/非零则跳转' },
  { syntax: 'bl label · ret', desc: '调用（返回地址写入 x30）/ 返回' },
  { syntax: 'nop · brk #0', desc: '空操作 · 停机（模拟器约定）' },
  { syntax: '.quad v1, v2 …', desc: '在当前位置放 64 位数据' },
];
