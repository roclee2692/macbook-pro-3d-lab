import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/sim/flows/scenarios';
import { NODE_CN } from '../src/sim/flows/types';
import { VirtualMemory } from '../src/sim/memory/vm';
import { Ssd } from '../src/sim/storage/ssd';
import { DEFAULT_GPU, runAll, startRun } from '../src/sim/gpu/gpu';
import { addThread, newSched, schedTick } from '../src/sim/sched/sched';

describe('六个数据流场景', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.title}：步骤非空，数据包端点合法`, () => {
      const steps = sc.build({});
      expect(steps.length).toBeGreaterThan(4);
      for (const st of steps) {
        for (const p of st.packets) {
          expect(NODE_CN[p.from]).toBeTruthy();
          expect(NODE_CN[p.to]).toBeTruthy();
          expect(p.reason.length).toBeGreaterThan(0);
        }
        expect(st.inspect.length).toBeGreaterThan(0);
      }
    });
  }
  it('篡改 iBoot 后安全启动中断', () => {
    const steps = SCENARIOS[0].build({ tamper: true });
    expect(steps[steps.length - 1].failed).toBe(true);
    expect(SCENARIOS[0].build({}).some((s) => s.failed)).toBe(false);
  });
  it('内存不足场景确实发生压缩、换出和换入', () => {
    const steps = SCENARIOS[4].build({});
    const ops = steps.flatMap((s) => s.packets.map((p) => p.op));
    expect(ops).toContain('压缩页面');
    expect(ops).toContain('换出');
    expect(ops).toContain('换入');
  });
});

describe('虚拟内存', () => {
  it('申请内存不立即占用物理页框，首次访问才分配', () => {
    const vm = new VirtualMemory();
    const free0 = vm.summary().free;
    const p = vm.spawn('t', 10, 5);
    expect(vm.summary().free).toBe(free0);
    expect(vm.access(p.pid, 0x400, true)).toBe('fault-zero');
    expect(vm.summary().free).toBe(free0 - 1);
    expect(vm.access(p.pid, 0x400, false)).toBe('hit');
    expect(vm.translate(p.pid, 0x400 * 16384 + 5).pa! % 16384).toBe(5);
  });
  it('关闭压缩器后直接换出到 SSD；释放后交换槽归还', () => {
    const vm = new VirtualMemory({ frames: 16, kernelFrames: 2, compressor: false, compressRatio: 2, swap: true, swapSlots: 64, accessesPerTick: 30 });
    const p = vm.spawn('big', 40, 40);
    for (let i = 0; i < 10; i++) vm.tick();
    expect(vm.s.stats.pageOuts).toBeGreaterThan(0);
    expect(vm.s.stats.compressions).toBe(0);
    vm.kill(p.pid);
    expect(vm.summary().swapUsed).toBe(0);
  });
});

describe('SSD', () => {
  it('顺序读（并行预读）比随机读快；缓存命中远快于 NAND', () => {
    const a = new Ssd();
    const seq = a.read('/Users/me/photo.heic', 'seq')!;
    const b = new Ssd();
    const rnd = b.read('/Users/me/photo.heic', 'rand')!;
    expect(seq.totalUs).toBeLessThan(rnd.totalUs / 2);
    const again = a.read('/Users/me/photo.heic', 'seq')!;
    expect(again.misses).toBe(seq.bytes / 4096 > a.s.cfg.cacheBlocks ? again.misses : 0);
  });
});

describe('GPU', () => {
  it('光栅化产生非背景像素，TBDR 写回量不超过立即模式', () => {
    const r = runAll(startRun(DEFAULT_GPU));
    let lit = 0;
    for (let i = 0; i < r.framebuffer.length; i += 4) if (r.framebuffer[i] > 40 || r.framebuffer[i + 1] > 40) lit++;
    expect(lit).toBeGreaterThan(500);
    expect(r.stats.tbdrWrites).toBe(r.cfg.width * r.cfg.height * 4);
  });
});

describe('调度与散热', () => {
  it('后台线程只在能效核上运行；风扇故障时触发降频', () => {
    const s = newSched();
    addThread(s, 'bg', 'BG', 1, 1e9);
    for (let i = 0; i < 20; i++) {
      schedTick(s);
      const c = s.cores.find((x) => x.thread === 1);
      if (c) expect(c.kind).toBe('E');
    }
    const h = newSched();
    h.thermal.fanMode = 'failed';
    for (let i = 0; i < 8; i++) addThread(h, `c${i}`, 'IN', 1, 1e9);
    for (let i = 0; i < 1500; i++) schedTick(h);
    expect(h.throttled).toBe(true);
    expect(h.pFreq).toBeLessThan(3.2);
  });
});
