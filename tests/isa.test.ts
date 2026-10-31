import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assemble, hex32 } from '../src/sim/cpu/assembler';
import { decode, encode } from '../src/sim/cpu/isa';
import { Machine, toSigned } from '../src/sim/cpu/machine';
import { EXAMPLES } from '../src/sim/cpu/programs';

const golden = JSON.parse(readFileSync(new URL('./clang-golden.json', import.meta.url), 'utf8')) as {
  cases: Record<string, string>;
  branches: string[];
};

describe('机器码与 clang (arm64) 汇编结果一致', () => {
  for (const [src, word] of Object.entries(golden.cases)) {
    it(src, () => {
      const p = assemble(src);
      expect(p.errors).toEqual([]);
      expect(hex32(p.lines[0].word)).toBe(word);
      const d = decode(p.lines[0].word);
      expect(d).not.toBeNull();
      expect(hex32(encode(d!.inst))).toBe(word); // 解码后再编码应完全还原
    });
  }

  it('分支、条件跳转、CBZ/CBNZ、ADR 的 PC 相对偏移', () => {
    const src = readFileSync(new URL('../scripts/isa-branches.s', import.meta.url), 'utf8');
    const p = assemble(src);
    expect(p.errors).toEqual([]);
    expect(p.lines.map((l) => hex32(l.word))).toEqual(golden.branches);
    for (const l of p.lines) expect(hex32(encode(decode(l.word)!.inst))).toBe(hex32(l.word));
  });
});

describe('汇编器报错', () => {
  it('不支持的写法给出中文错误而不是错误编码', () => {
    expect(assemble('add w0, w1, w2').errors[0].message).toMatch(/X 寄存器/);
    expect(assemble('ldr x0, [x1, #3]').errors[0].message).toMatch(/8 的倍数/);
    expect(assemble('b nowhere').errors[0].message).toMatch(/未定义的标签/);
    expect(assemble('mov x0, #0x12345').errors[0].message).toMatch(/movk/);
  });
});

function runExample(id: string) {
  const m = new Machine();
  m.load(EXAMPLES.find((e) => e.id === id)!.source);
  m.run();
  return m;
}

describe('教学 CPU 执行语义', () => {
  it('数组求和 = 31', () => {
    const m = runExample('sum');
    expect(m.haltReason).toMatch(/brk/);
    expect(m.regs[0]).toBe(31n);
    expect(m.output).toEqual(['31']);
  });
  it('栈写读 = 42', () => {
    const m = runExample('store');
    expect(m.output).toEqual(['42']);
    expect(m.sp).toBe(0x7f00n);
  });
  it('BL/RET 调用 square(7) = 49', () => {
    const m = runExample('call');
    expect(m.output).toEqual(['49']);
  });
  it('斐波那契前 10 项', () => {
    const m = runExample('fib');
    expect(m.output).toEqual(['0', '1', '1', '2', '3', '5', '8', '13', '21', '34']);
  });
  it('跨步 128 字节时 L1 每次都未命中，跨步 8 字节时命中率高', () => {
    const m = runExample('stride');
    expect(m.dcache.levels[0].hits).toBe(0);
    const src = EXAMPLES.find((e) => e.id === 'stride')!.source.replace('#128', '#8');
    const m2 = new Machine();
    m2.load(src);
    m2.run();
    expect(m2.dcache.levels[0].misses).toBe(8); // 64 次 × 8 字节 = 512 字节 = 8 条 64 字节缓存行
    expect(m2.dcache.levels[0].hits).toBe(56);
  });
  it('SUBS 标志位：1 - 2 为负且借位（C=0）', () => {
    const m = new Machine();
    m.load('mov x0, #1\nsubs x1, x0, #2\nbrk #0');
    m.run();
    expect(toSigned(m.regs[1])).toBe(-1n);
    expect(m.flags).toEqual({ n: true, z: false, c: false, v: false });
  });
  it('逐阶段单步：一条指令恰好经过 5 个阶段', () => {
    const m = new Machine();
    m.load('mov x0, #7\nbrk #0');
    const stages = [m.microStep(), m.microStep(), m.microStep(), m.microStep()];
    expect(stages).toEqual(['IF', 'ID', 'EX', 'MEM']);
    expect(m.regs[0]).toBe(0n); // 尚未写回
    expect(m.microStep()).toBe('WB');
    expect(m.regs[0]).toBe(7n);
    expect(m.pc).toBe(0x1004);
  });
  it('单步回退恢复寄存器与内存', () => {
    const m = new Machine();
    m.load(EXAMPLES.find((e) => e.id === 'store')!.source);
    for (let i = 0; i < 5; i++) m.step();
    expect(m.read64(0x7ef0)).toBe(40n);
    m.stepBack();
    m.stepBack();
    expect(m.read64(0x7ef0)).toBe(0n);
    expect(m.pc).toBe(0x100c);
  });
  it('越界访问触发模拟段错误', () => {
    const m = new Machine();
    m.load('mov x1, #0x9000\nldr x0, [x1]\nbrk #0');
    m.run();
    expect(m.haltReason).toMatch(/越界/);
  });
  it('VA→PA：16 KB 页，第二次访问同页 TLB 命中', () => {
    const m = new Machine();
    const a = m.translate(0x1234);
    const b = m.translate(0x1238);
    expect(a.tlbHit).toBe(false);
    expect(b.tlbHit).toBe(true);
    expect(a.offset).toBe(0x1234);
    expect(a.pa % 16384).toBe(0x1234);
  });
});
