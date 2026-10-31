// 教学 CPU：顺序执行，每条指令分 IF/ID/EX/MEM/WB 五个阶段，可逐阶段单步。
// 【教学抽象】真实 M1 Pro 性能核为宽发射乱序核心，Apple 未公开其微架构细节；
// 这里只保留“取指—译码—执行—访存—写回/提交”的逻辑顺序，便于观察一条指令的完整生命周期。

import { assemble, type Program } from './assembler';
import { Cache, DEFAULT_CACHE, DRAM_LATENCY, Hierarchy, type CacheAccess, type CacheConfig, type HierarchyResult } from './cache';
import { COND_NAMES, decode, disasm, regName, type Decoded, type Inst } from './isa';

export const MEM_SIZE = 0x8000; // 32 KB 教学内存
export const STACK_TOP = 0x7f00; // 栈向下增长，避开输出端口
export const OUT_ADDR = 0x7ff8; // 模拟输出端口（教学约定）：str 到这里的值会出现在“输出”中
export const PAGE_BITS = 14; // 16 KB 页（Apple silicon 上 macOS 的真实页大小）
const MASK64 = (1n << 64n) - 1n;

export type Stage = 'IF' | 'ID' | 'EX' | 'MEM' | 'WB';
export const STAGES: Stage[] = ['IF', 'ID', 'EX', 'MEM', 'WB'];
export const STAGE_CN: Record<Stage, string> = { IF: '取指', ID: '译码', EX: '执行', MEM: '访存', WB: '写回/提交' };

export interface Translation {
  va: number;
  vpn: number;
  offset: number;
  tlbHit: boolean;
  walk: { level: string; index: number }[];
  pfn: number;
  pa: number;
}

export interface MemEvent {
  kind: 'fetch' | 'load' | 'store';
  va: number;
  size: number;
  value: bigint;
  xlat: Translation;
  cache: HierarchyResult;
  mmio?: boolean;
}

export interface InstTrace {
  seq: number;
  pc: number;
  word: number;
  decoded?: Decoded;
  srcRegs: { name: string; value: bigint }[];
  alu?: { op: string; a: bigint; b: bigint; result: bigint; flags?: Flags };
  addr?: number;
  mem?: MemEvent;
  fetch?: MemEvent;
  regWrite?: { name: string; value: bigint };
  branch?: { taken: boolean; target: number; reason: string };
  nextPc: number;
  cycles: number;
  done: Stage[];
}

export interface Flags {
  n: boolean;
  z: boolean;
  c: boolean;
  v: boolean;
}

interface Snap {
  regs: bigint[];
  sp: bigint;
  pc: number;
  flags: Flags;
  cycle: number;
  retired: number;
  output: string[];
  dcache: ReturnType<Hierarchy['snapshot']>;
  icache: ReturnType<Cache['snapshot']>;
  tlb: TlbEntry[];
  memUndo: { addr: number; old: Uint8Array }[];
  halted: boolean;
  haltReason: string;
}

interface TlbEntry {
  vpn: number;
  pfn: number;
  lru: number;
}

// 教学页表：虚拟页 → 物理页框（页框号是示意值，代表 16 GB 统一内存中的某个位置）
const PAGE_TABLE: Record<number, number> = { 0: 0x2a31c, 1: 0x2a31d };

export class Machine {
  regs: bigint[] = Array(31).fill(0n);
  sp = BigInt(STACK_TOP);
  pc = 0x1000;
  flags: Flags = { n: false, z: false, c: false, v: false };
  mem = new Uint8Array(MEM_SIZE);
  cacheCfg: CacheConfig[];
  dcache: Hierarchy;
  icache: Cache;
  tlb: TlbEntry[] = [];
  tlbSize = 4;
  tlbClock = 0;
  cycle = 0;
  retired = 0;
  halted = false;
  haltReason = '';
  output: string[] = [];
  program: Program | null = null;
  cur: InstTrace | null = null;
  last: InstTrace | null = null;
  history: Snap[] = [];
  readsWrites = { loads: 0, stores: 0 };
  private seq = 0;

  constructor(cacheCfg: CacheConfig[] = DEFAULT_CACHE) {
    this.cacheCfg = cacheCfg;
    this.dcache = new Hierarchy(cacheCfg);
    this.icache = new Cache({ ...cacheCfg[0], name: 'L1I' });
  }

  load(src: string): Program {
    const prog = assemble(src);
    this.program = prog;
    this.reset();
    return prog;
  }

  setCache(cfg: CacheConfig[]) {
    this.cacheCfg = cfg;
    this.reset();
  }

  reset() {
    this.regs = Array(31).fill(0n);
    this.sp = BigInt(STACK_TOP);
    this.flags = { n: false, z: false, c: false, v: false };
    this.mem = new Uint8Array(MEM_SIZE);
    this.dcache = new Hierarchy(this.cacheCfg);
    this.icache = new Cache({ ...this.cacheCfg[0], name: 'L1I' });
    this.tlb = [];
    this.cycle = 0;
    this.retired = 0;
    this.halted = false;
    this.haltReason = '';
    this.output = [];
    this.cur = null;
    this.last = null;
    this.history = [];
    this.seq = 0;
    this.readsWrites = { loads: 0, stores: 0 };
    if (this.program) {
      for (const { addr, word } of this.program.words) this.write32(addr, word);
      this.pc = this.program.entry;
      if (this.program.errors.length) {
        this.halted = true;
        this.haltReason = '汇编有错误，无法运行';
      }
    }
  }

  // ---------- 寄存器 ----------
  getReg(r: number, spCtx = false): bigint {
    if (r === 31) return spCtx ? this.sp : 0n;
    return this.regs[r];
  }
  setReg(r: number, v: bigint, spCtx = false) {
    v &= MASK64;
    if (r === 31) {
      if (spCtx) this.sp = v;
      return;
    }
    this.regs[r] = v;
  }

  // ---------- 内存 ----------
  private write32(addr: number, w: number) {
    for (let i = 0; i < 4; i++) this.mem[addr + i] = (w >>> (8 * i)) & 0xff;
  }
  read32(addr: number) {
    return (this.mem[addr] | (this.mem[addr + 1] << 8) | (this.mem[addr + 2] << 16) | (this.mem[addr + 3] << 24)) >>> 0;
  }
  read64(addr: number): bigint {
    let v = 0n;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(this.mem[addr + i]);
    return v;
  }
  private write64(addr: number, v: bigint) {
    const top = this.history[this.history.length - 1];
    if (top) top.memUndo.push({ addr, old: this.mem.slice(addr, addr + 8) });
    for (let i = 0; i < 8; i++) this.mem[addr + i] = Number((v >> BigInt(8 * i)) & 0xffn);
  }

  translate(va: number): Translation {
    const vpn = va >>> PAGE_BITS;
    const offset = va & ((1 << PAGE_BITS) - 1);
    // 48 位虚拟地址、16 KB 粒度的四级页表索引：L0=VA[47]，L1=VA[46:36]，L2=VA[35:25]，L3=VA[24:14]
    const big = BigInt(va);
    const walk = [
      { level: 'L0', index: Number((big >> 47n) & 1n) },
      { level: 'L1', index: Number((big >> 36n) & 0x7ffn) },
      { level: 'L2', index: Number((big >> 25n) & 0x7ffn) },
      { level: 'L3', index: Number((big >> 14n) & 0x7ffn) },
    ];
    this.tlbClock++;
    const hit = this.tlb.find((e) => e.vpn === vpn);
    let pfn: number;
    if (hit) {
      hit.lru = this.tlbClock;
      pfn = hit.pfn;
    } else {
      pfn = PAGE_TABLE[vpn] ?? 0x2a300 + vpn;
      if (this.tlb.length >= this.tlbSize) {
        const victim = this.tlb.reduce((b, e, i) => (e.lru < this.tlb[b].lru ? i : b), 0);
        this.tlb.splice(victim, 1);
      }
      this.tlb.push({ vpn, pfn, lru: this.tlbClock });
    }
    return { va, vpn, offset, tlbHit: !!hit, walk: hit ? [] : walk, pfn, pa: pfn * (1 << PAGE_BITS) + offset };
  }

  private memAccess(kind: MemEvent['kind'], va: number, size: number, value: bigint = 0n): MemEvent {
    if (va < 0 || va + size > MEM_SIZE) throw new Fault(`访问地址 0x${va.toString(16)} 越界（模拟段错误）`);
    const xlat = this.translate(va);
    let cache: HierarchyResult;
    if (kind === 'fetch') {
      const r = this.icache.access(va);
      if (r.hit) cache = { path: [r], servedBy: 'L1', cycles: this.icache.cfg.latency };
      else {
        const path: CacheAccess[] = [r];
        let cycles = this.icache.cfg.latency;
        let servedBy: HierarchyResult['servedBy'] = 'DRAM';
        for (const c of this.dcache.levels.slice(1)) {
          const x = c.access(va);
          path.push(x);
          cycles += c.cfg.latency;
          if (x.hit) {
            servedBy = c.cfg.name as HierarchyResult['servedBy'];
            break;
          }
        }
        if (servedBy === 'DRAM') cycles += DRAM_LATENCY;
        cache = { path, servedBy, cycles };
      }
    } else cache = this.dcache.access(va);
    const mmio = kind === 'store' && va === OUT_ADDR;
    return { kind, va, size, value, xlat, cache, mmio };
  }

  // ---------- 执行 ----------
  get stageIndex() {
    return this.cur ? this.cur.done.length : 0;
  }

  /** 推进一个流水阶段。返回刚完成的阶段。 */
  microStep(): Stage | null {
    if (this.halted) return null;
    try {
      if (!this.cur) this.beginInstruction();
      const t = this.cur!;
      const stage = STAGES[t.done.length];
      ({ IF: this.doIF, ID: this.doID, EX: this.doEX, MEM: this.doMEM, WB: this.doWB })[stage].call(this, t);
      t.done.push(stage);
      if (stage === 'WB') {
        this.last = t;
        this.cur = null;
      }
      return stage;
    } catch (e) {
      if (e instanceof Fault) {
        this.halted = true;
        this.haltReason = e.message;
        if (this.cur) {
          this.last = this.cur;
          this.cur = null;
        }
        return null;
      }
      throw e;
    }
  }

  /** 执行完当前（或下一条）指令。 */
  step(): InstTrace | null {
    if (this.halted) return null;
    do {
      if (this.microStep() === null) return this.last;
    } while (this.cur);
    return this.last;
  }

  run(maxInstructions = 10000) {
    let n = 0;
    while (!this.halted && n < maxInstructions) {
      this.step();
      n++;
    }
    if (!this.halted && n >= maxInstructions) {
      this.halted = true;
      this.haltReason = `已执行 ${maxInstructions} 条指令仍未停机（可能是死循环）`;
    }
    return n;
  }

  stepBack(): boolean {
    const s = this.history.pop();
    if (!s) return false;
    for (let i = s.memUndo.length - 1; i >= 0; i--) this.mem.set(s.memUndo[i].old, s.memUndo[i].addr);
    this.regs = s.regs;
    this.sp = s.sp;
    this.pc = s.pc;
    this.flags = s.flags;
    this.cycle = s.cycle;
    this.retired = s.retired;
    this.output = s.output;
    this.dcache.restore(s.dcache);
    this.icache.restore(s.icache);
    this.tlb = s.tlb;
    this.halted = s.halted;
    this.haltReason = s.haltReason;
    this.cur = null;
    this.last = null;
    this.seq = Math.max(0, this.seq - 1);
    return true;
  }

  private beginInstruction() {
    this.history.push({
      regs: [...this.regs],
      sp: this.sp,
      pc: this.pc,
      flags: { ...this.flags },
      cycle: this.cycle,
      retired: this.retired,
      output: [...this.output],
      dcache: this.dcache.snapshot(),
      icache: this.icache.snapshot(),
      tlb: this.tlb.map((e) => ({ ...e })),
      memUndo: [],
      halted: this.halted,
      haltReason: this.haltReason,
    });
    if (this.history.length > 5000) this.history.shift();
    this.cur = { seq: this.seq++, pc: this.pc, word: 0, srcRegs: [], nextPc: this.pc + 4, cycles: 0, done: [] };
  }

  private doIF(t: InstTrace) {
    if (t.pc % 4 !== 0) throw new Fault('PC 未按 4 字节对齐');
    const ev = this.memAccess('fetch', t.pc, 4);
    t.word = this.read32(t.pc);
    ev.value = BigInt(t.word);
    t.fetch = ev;
    t.cycles += ev.cache.cycles;
    this.cycle += ev.cache.cycles;
  }

  private doID(t: InstTrace) {
    const d = decode(t.word);
    if (!d) throw new Fault(`无法译码的机器码 0x${t.word.toString(16).padStart(8, '0')}（未定义指令）`);
    t.decoded = d;
    const i = d.inst;
    const src = (r: number, sp = false) => t.srcRegs.push({ name: regName(r, sp), value: this.getReg(r, sp) });
    switch (i.op) {
      case 'add_i': case 'sub_i': case 'adds_i': case 'subs_i': src(i.rn, true); break;
      case 'add_r': case 'sub_r': case 'adds_r': case 'subs_r': case 'and_r': case 'orr_r': case 'eor_r':
      case 'udiv': case 'lslv': case 'lsrv': src(i.rn); src(i.rm); break;
      case 'madd': src(i.rn); src(i.rm); if (i.ra !== 31) src(i.ra); break;
      case 'ubfm': src(i.rn); break;
      case 'ldr_u': src(i.rn, true); break;
      case 'str_u': src(i.rn, true); src(i.rt); break;
      case 'ldr_r': src(i.rn, true); src(i.rm); break;
      case 'str_r': src(i.rn, true); src(i.rm); src(i.rt); break;
      case 'cbz': case 'cbnz': src(i.rt); break;
      case 'ret': src(i.rn); break;
      case 'movk': src(i.rd); break;
    }
    t.cycles += 1;
    this.cycle += 1;
  }

  private doEX(t: InstTrace) {
    const i = t.decoded!.inst;
    const r = (n: number, sp = false) => this.getReg(n, sp);
    const alu = (op: string, a: bigint, b: bigint, result: bigint, flags?: Flags) => {
      t.alu = { op, a, b, result: result & MASK64, flags };
    };
    switch (i.op) {
      case 'movz': alu('MOVZ', BigInt(i.imm16), BigInt(i.hw * 16), BigInt(i.imm16) << BigInt(i.hw * 16)); break;
      case 'movn': alu('MOVN', BigInt(i.imm16), BigInt(i.hw * 16), ~(BigInt(i.imm16) << BigInt(i.hw * 16))); break;
      case 'movk': {
        const sh = BigInt(i.hw * 16);
        const keep = r(i.rd) & ~(0xffffn << sh);
        alu('MOVK', r(i.rd), BigInt(i.imm16), keep | (BigInt(i.imm16) << sh));
        break;
      }
      case 'add_i': case 'sub_i': case 'adds_i': case 'subs_i': {
        const a = r(i.rn, true);
        const b = BigInt(i.imm12) << BigInt(i.sh * 12);
        const sub = i.op.startsWith('sub');
        const [res, fl] = addsub(a, b, sub);
        alu(sub ? 'SUB' : 'ADD', a, b, res, i.op.includes('s_') ? fl : undefined);
        break;
      }
      case 'add_r': case 'sub_r': case 'adds_r': case 'subs_r': case 'and_r': case 'orr_r': case 'eor_r': {
        const a = r(i.rn);
        const b = shiftVal(r(i.rm), i.shift, i.amount);
        if (i.op === 'and_r') alu('AND', a, b, a & b);
        else if (i.op === 'orr_r') alu('ORR', a, b, a | b);
        else if (i.op === 'eor_r') alu('EOR', a, b, a ^ b);
        else {
          const sub = i.op.startsWith('sub');
          const [res, fl] = addsub(a, b, sub);
          alu(sub ? 'SUB' : 'ADD', a, b, res, i.op === 'adds_r' || i.op === 'subs_r' ? fl : undefined);
        }
        break;
      }
      case 'madd': {
        const a = r(i.rn), b = r(i.rm), c = r(i.ra);
        alu(i.ra === 31 ? 'MUL' : 'MADD', a, b, (a * b + c) & MASK64);
        break;
      }
      case 'udiv': {
        const a = r(i.rn), b = r(i.rm);
        alu('UDIV', a, b, b === 0n ? 0n : a / b); // A64 规定除以 0 结果为 0，不触发异常
        break;
      }
      case 'lslv': { const a = r(i.rn), b = r(i.rm) & 63n; alu('LSL', a, b, a << b); break; }
      case 'lsrv': { const a = r(i.rn), b = r(i.rm) & 63n; alu('LSR', a, b, a >> b); break; }
      case 'ubfm': {
        const a = r(i.rn);
        let res: bigint;
        if (i.imms >= i.immr) res = (a >> BigInt(i.immr)) & ((1n << BigInt(i.imms - i.immr + 1)) - 1n);
        else res = (a & ((1n << BigInt(i.imms + 1)) - 1n)) << BigInt(64 - i.immr);
        alu(i.imms === 63 ? 'LSR' : 'LSL', a, BigInt(i.imms === 63 ? i.immr : 63 - i.imms), res);
        break;
      }
      case 'ldr_u': case 'str_u': {
        const base = r(i.rn, true);
        t.addr = Number((base + BigInt(i.offset)) & MASK64);
        alu('AGU', base, BigInt(i.offset), BigInt(t.addr));
        break;
      }
      case 'ldr_r': case 'str_r': {
        const base = r(i.rn, true);
        const off = i.scaled ? r(i.rm) << 3n : r(i.rm);
        const a = (base + off) & MASK64;
        if (a > BigInt(Number.MAX_SAFE_INTEGER)) throw new Fault('地址超出范围');
        t.addr = Number(a);
        alu('AGU', base, off, a);
        break;
      }
      case 'b': case 'bl':
        t.branch = { taken: true, target: t.pc + i.offset, reason: i.op === 'bl' ? '函数调用：x30 ← 返回地址' : '无条件跳转' };
        break;
      case 'bcond': {
        const taken = condHolds(i.cond, this.flags);
        t.branch = { taken, target: t.pc + i.offset, reason: `条件 ${COND_NAMES[i.cond].toUpperCase()}（NZCV=${fstr(this.flags)}）${taken ? '成立' : '不成立'}` };
        break;
      }
      case 'cbz': case 'cbnz': {
        const v = r(i.rt);
        const taken = i.op === 'cbz' ? v === 0n : v !== 0n;
        t.branch = { taken, target: t.pc + i.offset, reason: `${regName(i.rt)} = ${v} ${taken ? '满足' : '不满足'}${i.op === 'cbz' ? '为零' : '非零'}` };
        break;
      }
      case 'adr': alu('ADR', BigInt(t.pc), BigInt(i.offset), BigInt(t.pc + i.offset)); break;
      case 'ret': t.branch = { taken: true, target: Number(r(i.rn)), reason: `返回到 ${regName(i.rn)} 中的地址` }; break;
      case 'nop': break;
      case 'brk': break;
    }
    if (t.branch?.taken) t.nextPc = t.branch.target;
    t.cycles += 1;
    this.cycle += 1;
  }

  private doMEM(t: InstTrace) {
    const i = t.decoded!.inst;
    if (i.op === 'ldr_u' || i.op === 'ldr_r') {
      const ev = this.memAccess('load', t.addr!, 8);
      ev.value = this.read64(t.addr!);
      t.mem = ev;
      this.readsWrites.loads++;
      t.cycles += ev.cache.cycles;
      this.cycle += ev.cache.cycles;
    } else if (i.op === 'str_u' || i.op === 'str_r') {
      const v = this.getReg(i.rt);
      const ev = this.memAccess('store', t.addr!, 8, v);
      this.write64(t.addr!, v);
      if (ev.mmio) this.output.push(v.toString());
      t.mem = ev;
      this.readsWrites.stores++;
      t.cycles += ev.cache.cycles;
      this.cycle += ev.cache.cycles;
    } else {
      t.cycles += 0; // 无访存，阶段直通
    }
  }

  private doWB(t: InstTrace) {
    const i = t.decoded!.inst;
    const wr = (rd: number, v: bigint, sp = false) => {
      this.setReg(rd, v, sp);
      if (rd !== 31 || sp) t.regWrite = { name: regName(rd, sp), value: v & MASK64 };
    };
    switch (i.op) {
      case 'movz': case 'movn': case 'movk': case 'madd': case 'udiv': case 'lslv': case 'lsrv': case 'ubfm': case 'adr':
        wr(i.rd, t.alu!.result);
        break;
      case 'add_i': case 'sub_i':
        wr(i.rd, t.alu!.result, true);
        break;
      case 'adds_i': case 'subs_i': case 'adds_r': case 'subs_r':
        wr(i.rd, t.alu!.result);
        this.flags = t.alu!.flags!;
        break;
      case 'add_r': case 'sub_r': case 'and_r': case 'orr_r': case 'eor_r':
        wr(i.rd, t.alu!.result);
        break;
      case 'ldr_u': case 'ldr_r':
        wr(i.rt, t.mem!.value);
        break;
      case 'bl':
        wr(30, BigInt(t.pc + 4));
        break;
      case 'brk':
        this.halted = true;
        this.haltReason = `执行到 brk #${i.imm16}，程序结束`;
        break;
    }
    this.pc = t.nextPc;
    this.retired++;
    t.cycles += 1;
    this.cycle += 1;
  }

  describe(t: InstTrace, stage: Stage): string[] {
    const hex = (n: number | bigint) => '0x' + n.toString(16);
    const out: string[] = [];
    const i: Inst | undefined = t.decoded?.inst;
    switch (stage) {
      case 'IF':
        out.push(`PC = ${hex(t.pc)}，按 PC 从指令缓存读取 4 字节`);
        if (t.fetch) {
          out.push(`虚拟地址 ${hex(t.fetch.va)} → 物理地址 ${hex(t.fetch.xlat.pa)}（TLB ${t.fetch.xlat.tlbHit ? '命中' : '未命中，走页表'}）`);
          out.push(`L1I ${t.fetch.cache.path[0].hit ? '命中' : '未命中'}，数据来自 ${t.fetch.cache.servedBy}，耗时 ${t.fetch.cache.cycles} 周期`);
          out.push(`取得机器码 ${t.word.toString(16).padStart(8, '0')}`);
        }
        break;
      case 'ID':
        if (t.decoded) {
          out.push(`类别：${t.decoded.klass}`);
          out.push(`译码结果：${disasm(t.decoded.inst, t.pc)}`);
          t.srcRegs.forEach((s) => out.push(`读寄存器 ${s.name} = ${s.value}`));
        }
        break;
      case 'EX':
        if (t.alu) out.push(`ALU ${t.alu.op}：${t.alu.a} , ${t.alu.b} → ${t.alu.result}${t.alu.flags ? `，标志 NZCV=${fstr(t.alu.flags)}` : ''}`);
        if (t.branch) out.push(`${t.branch.reason} → ${t.branch.taken ? `跳到 ${hex(t.branch.target)}` : '顺序执行'}`);
        if (!t.alu && !t.branch) out.push(i?.op === 'brk' ? '断点指令：准备停机' : '无运算');
        break;
      case 'MEM':
        if (t.mem) {
          out.push(`${t.mem.kind === 'load' ? '读' : '写'} 8 字节 @ VA ${hex(t.mem.va)} → PA ${hex(t.mem.xlat.pa)}`);
          out.push(`缓存路径：${t.mem.cache.path.map((p) => `${p.level}${p.hit ? '✓' : '✗'}`).join(' → ')}${t.mem.cache.servedBy === 'DRAM' ? ' → LPDDR5' : ''}（${t.mem.cache.cycles} 周期）`);
          out.push(`${t.mem.kind === 'load' ? '读到' : '写入'}值 ${t.mem.value}${t.mem.mmio ? '（输出端口）' : ''}`);
        } else out.push('本指令不访问数据内存');
        break;
      case 'WB':
        if (t.regWrite) out.push(`写回 ${t.regWrite.name} ← ${t.regWrite.value}`);
        out.push(`PC ← ${hex(t.nextPc)}`);
        break;
    }
    return out;
  }
}

export class Fault extends Error {}

function addsub(a: bigint, b: bigint, sub: boolean): [bigint, Flags] {
  const bb = sub ? (~b & MASK64) : b;
  const carryIn = sub ? 1n : 0n;
  const full = a + bb + carryIn;
  const res = full & MASK64;
  const sign = (x: bigint) => (x >> 63n) & 1n;
  const v = sign(a) === sign(bb) && sign(res) !== sign(a);
  return [res, { n: sign(res) === 1n, z: res === 0n, c: full > MASK64, v }];
}

function shiftVal(v: bigint, shift: string, amount: number) {
  const a = BigInt(amount);
  if (shift === 'lsl') return (v << a) & MASK64;
  if (shift === 'lsr') return v >> a;
  const signed = BigInt.asIntN(64, v) >> a;
  return signed & MASK64;
}

export function condHolds(cond: number, f: Flags): boolean {
  let r: boolean;
  switch (cond >> 1) {
    case 0: r = f.z; break;
    case 1: r = f.c; break;
    case 2: r = f.n; break;
    case 3: r = f.v; break;
    case 4: r = f.c && !f.z; break;
    case 5: r = f.n === f.v; break;
    case 6: r = f.n === f.v && !f.z; break;
    default: r = true;
  }
  if ((cond & 1) === 1 && cond !== 15) r = !r;
  return r;
}

export const fstr = (f: Flags) => `${+f.n}${+f.z}${+f.c}${+f.v}`;
export const toSigned = (v: bigint) => BigInt.asIntN(64, v);
