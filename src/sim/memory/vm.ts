// 虚拟内存模型：每进程页表、按需分配（零页）、时钟置换、内存压缩器、SSD 交换区。
// 页大小 16 KB 为 Apple silicon 上 macOS 的真实值；物理页框数为缩小后的实验参数。
// macOS 在换出到 SSD 之前会先压缩不活跃的匿名页——这里用“压缩器”近似这一行为（教学近似，压缩比可调）。

import { rng, type Rng } from '../rng';

export const PAGE_SIZE = 16 * 1024;
export const REAL_FRAMES = (16 * 1024 ** 3) / PAGE_SIZE; // 1,048,576

export type PageState = 'unmapped' | 'resident' | 'compressed' | 'swapped' | 'file';

export interface Pte {
  vpn: number;
  kind: 'code' | 'heap';
  state: PageState; // unmapped = 已分配虚拟地址但从未访问（零页）
  frame: number | null;
  swapSlot: number | null;
  dirty: boolean;
  referenced: boolean;
}

export interface Proc {
  pid: number;
  name: string;
  hue: number;
  workingSet: number; // 活跃页数（实验参数）
  writeRatio: number;
  pt: Record<number, Pte>;
  heapNext: number;
  minorFaults: number;
  majorFaults: number;
  alive: boolean;
}

export interface Frame {
  owner: number | null; // pid；-1 = 内核/压缩器
  vpn: number | null;
  use: 'free' | 'page' | 'compressor' | 'kernel';
  fill?: number; // 压缩器页框中已存放的压缩页数
}

export interface VmConfig {
  frames: number;
  kernelFrames: number;
  compressor: boolean;
  compressRatio: number; // 每个压缩器页框可容纳几页
  swap: boolean;
  swapSlots: number;
  accessesPerTick: number;
}

export interface VmEvent {
  kind: 'fault-zero' | 'fault-file' | 'fault-swap' | 'decompress' | 'compress' | 'swap-out' | 'drop' | 'oom' | 'alloc' | 'free' | 'spawn' | 'exit';
  pid: number;
  vpn?: number;
  frame?: number;
  msg: string;
  bytes?: number;
}

export interface VmState {
  cfg: VmConfig;
  frames: Frame[];
  procs: Proc[];
  swap: ({ pid: number; vpn: number } | null)[];
  compressed: { pid: number; vpn: number; frame: number }[];
  hand: number;
  tick: number;
  seed: number;
  nextPid: number;
  stats: { pageIns: number; pageOuts: number; compressions: number; decompressions: number; zeroFills: number; fileReads: number; swapBytesWritten: number; swapBytesRead: number };
}

export const DEFAULT_VM: VmConfig = {
  frames: 64,
  kernelFrames: 6,
  compressor: true,
  compressRatio: 2,
  swap: true,
  swapSlots: 96,
  accessesPerTick: 24,
};

const HEAP_BASE = 0x400; // 虚拟页号（VA 0x1000000 起），代码段从 0x100 开始
const CODE_BASE = 0x100;

export class VirtualMemory {
  s: VmState;
  events: VmEvent[] = [];
  private r: Rng;

  constructor(cfg: VmConfig = DEFAULT_VM, seed = 7) {
    this.s = VirtualMemory.fresh(cfg, seed);
    this.r = rng(seed);
  }

  static fresh(cfg: VmConfig, seed: number): VmState {
    const frames: Frame[] = Array.from({ length: cfg.frames }, (_, i) =>
      i < cfg.kernelFrames ? { owner: -1, vpn: null, use: 'kernel' } : { owner: null, vpn: null, use: 'free' },
    );
    return {
      cfg,
      frames,
      procs: [],
      swap: Array(cfg.swapSlots).fill(null),
      compressed: [],
      hand: cfg.kernelFrames,
      tick: 0,
      seed,
      nextPid: 101,
      stats: { pageIns: 0, pageOuts: 0, compressions: 0, decompressions: 0, zeroFills: 0, fileReads: 0, swapBytesWritten: 0, swapBytesRead: 0 },
    };
  }

  snapshot(): VmState {
    return structuredClone(this.s);
  }
  restore(s: VmState) {
    this.s = structuredClone(s);
    this.r = rng(s.seed + s.tick * 7919);
  }

  private emit(e: VmEvent) {
    this.events.push(e);
  }
  drain(): VmEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  proc(pid: number) {
    return this.s.procs.find((p) => p.pid === pid && p.alive);
  }

  // ---------- 进程 ----------
  spawn(name: string, heapPages: number, workingSet: number, codePages = 3, writeRatio = 0.3): Proc {
    const p: Proc = { pid: this.s.nextPid++, name, hue: (this.s.nextPid * 67) % 360, workingSet, writeRatio, pt: {}, heapNext: HEAP_BASE, minorFaults: 0, majorFaults: 0, alive: true };
    for (let i = 0; i < codePages; i++) p.pt[CODE_BASE + i] = { vpn: CODE_BASE + i, kind: 'code', state: 'file', frame: null, swapSlot: null, dirty: false, referenced: false };
    this.s.procs.push(p);
    this.emit({ kind: 'spawn', pid: p.pid, msg: `创建进程 ${name}（pid ${p.pid}）：代码段 ${codePages} 页映射到可执行文件，尚未读入内存` });
    this.malloc(p.pid, heapPages);
    return p;
  }

  malloc(pid: number, pages: number) {
    const p = this.proc(pid);
    if (!p) return;
    const start = p.heapNext;
    for (let i = 0; i < pages; i++) {
      const vpn = p.heapNext++;
      p.pt[vpn] = { vpn, kind: 'heap', state: 'unmapped', frame: null, swapSlot: null, dirty: false, referenced: false };
    }
    this.emit({ kind: 'alloc', pid, msg: `pid ${pid} 申请 ${pages} 页（${(pages * 16).toLocaleString()} KB）虚拟内存：只建立页表项，物理页在首次访问时才分配`, vpn: start, bytes: pages * PAGE_SIZE });
  }

  free(pid: number, pages: number) {
    const p = this.proc(pid);
    if (!p) return;
    let n = 0;
    while (n < pages && p.heapNext > HEAP_BASE) {
      const vpn = --p.heapNext;
      this.releasePage(p, vpn);
      delete p.pt[vpn];
      n++;
    }
    this.emit({ kind: 'free', pid, msg: `pid ${pid} 释放 ${n} 页：对应物理页框、压缩数据与交换槽立即归还` });
  }

  kill(pid: number) {
    const p = this.proc(pid);
    if (!p) return;
    for (const k of Object.keys(p.pt)) this.releasePage(p, Number(k));
    p.pt = {};
    p.alive = false;
    this.emit({ kind: 'exit', pid, msg: `进程 ${p.name}（pid ${pid}）退出，回收全部内存` });
  }

  private releasePage(p: Proc, vpn: number) {
    const e = p.pt[vpn];
    if (!e) return;
    if (e.state === 'resident' && e.frame !== null) this.s.frames[e.frame] = { owner: null, vpn: null, use: 'free' };
    if (e.state === 'swapped' && e.swapSlot !== null) this.s.swap[e.swapSlot] = null;
    if (e.state === 'compressed') this.removeCompressed(p.pid, vpn);
  }

  private removeCompressed(pid: number, vpn: number) {
    const i = this.s.compressed.findIndex((c) => c.pid === pid && c.vpn === vpn);
    if (i < 0) return;
    const f = this.s.compressed[i].frame;
    this.s.compressed.splice(i, 1);
    const fr = this.s.frames[f];
    fr.fill = (fr.fill ?? 1) - 1;
    if (fr.fill <= 0) this.s.frames[f] = { owner: null, vpn: null, use: 'free' };
  }

  // ---------- 地址转换与缺页 ----------
  translate(pid: number, va: number) {
    const p = this.proc(pid);
    const vpn = Math.floor(va / PAGE_SIZE);
    const offset = va % PAGE_SIZE;
    const e = p?.pt[vpn];
    return { vpn, offset, pte: e, pa: e?.state === 'resident' && e.frame !== null ? e.frame * PAGE_SIZE + offset : null };
  }

  /** 访问一个虚拟页；返回发生了什么 */
  access(pid: number, vpn: number, write: boolean): VmEvent['kind'] | 'hit' | 'segv' {
    const p = this.proc(pid);
    const e = p?.pt[vpn];
    if (!p || !e) return 'segv';
    if (e.state === 'resident') {
      e.referenced = true;
      if (write) e.dirty = true;
      return 'hit';
    }
    const prev = e.state;
    const frame = this.allocFrame(pid);
    if (frame === null) {
      this.emit({ kind: 'oom', pid, vpn, msg: `内存耗尽：没有可回收页框，pid ${pid} 的访问被阻塞（真实系统会弹出“内存不足”并可能终止进程）` });
      return 'oom';
    }
    this.s.frames[frame] = { owner: pid, vpn, use: 'page' };
    e.frame = frame;
    e.state = 'resident';
    e.referenced = true;
    e.dirty = write;
    let kind: VmEvent['kind'];
    if (prev === 'unmapped') {
      kind = 'fault-zero';
      p.minorFaults++;
      this.s.stats.zeroFills++;
      this.emit({ kind, pid, vpn, frame, msg: `页错误（零页）：pid ${pid} 首次访问 VPN 0x${vpn.toString(16)}，分配页框 #${frame} 并清零` });
    } else if (prev === 'file') {
      kind = 'fault-file';
      p.majorFaults++;
      this.s.stats.fileReads++;
      this.emit({ kind, pid, vpn, frame, bytes: PAGE_SIZE, msg: `页错误（文件页）：从 SSD 读取可执行文件 16 KB 到页框 #${frame}` });
    } else if (prev === 'compressed') {
      kind = 'decompress';
      p.minorFaults++;
      this.removeCompressed(pid, vpn);
      this.s.stats.decompressions++;
      this.emit({ kind, pid, vpn, frame, msg: `页错误（压缩页）：在内存中解压 VPN 0x${vpn.toString(16)} 到页框 #${frame}，无需访问 SSD` });
    } else {
      kind = 'fault-swap';
      p.majorFaults++;
      if (e.swapSlot !== null) this.s.swap[e.swapSlot] = null;
      e.swapSlot = null;
      this.s.stats.pageIns++;
      this.s.stats.swapBytesRead += PAGE_SIZE;
      this.emit({ kind, pid, vpn, frame, bytes: PAGE_SIZE, msg: `页错误（换入）：从 SSD 交换文件读回 16 KB 到页框 #${frame}` });
    }
    return kind;
  }

  private allocFrame(forPid: number): number | null {
    const free = this.s.frames.findIndex((f) => f.use === 'free');
    if (free >= 0) return free;
    return this.reclaim(forPid);
  }

  /** 时钟（二次机会）算法挑选牺牲页 */
  private reclaim(forPid: number): number | null {
    const n = this.s.frames.length;
    for (let scanned = 0; scanned < n * 2; scanned++) {
      const i = this.s.hand;
      this.s.hand = this.s.hand + 1 >= n ? this.s.cfg.kernelFrames : this.s.hand + 1;
      const f = this.s.frames[i];
      if (f.use !== 'page' || f.owner === null || f.vpn === null) continue;
      const owner = this.proc(f.owner)!;
      const e = owner.pt[f.vpn];
      if (e.referenced) {
        e.referenced = false; // 给第二次机会
        continue;
      }
      if (this.evict(owner, e, i, forPid)) return i;
    }
    return null;
  }

  private evict(owner: Proc, e: Pte, frame: number, forPid: number): boolean {
    if (e.kind === 'code') {
      e.state = 'file';
      e.frame = null;
      this.s.frames[frame] = { owner: null, vpn: null, use: 'free' };
      this.emit({ kind: 'drop', pid: owner.pid, vpn: e.vpn, frame, msg: `回收页框 #${frame}：pid ${owner.pid} 的代码页是干净的文件页，直接丢弃（需要时再从 SSD 读）` });
      return true;
    }
    if (this.s.cfg.compressor) {
      const target = this.compressorFrame(frame);
      if (target !== null) {
        e.state = 'compressed';
        e.frame = null;
        this.s.compressed.push({ pid: owner.pid, vpn: e.vpn, frame: target });
        this.s.stats.compressions++;
        if (target !== frame) this.s.frames[frame] = { owner: null, vpn: null, use: 'free' };
        this.emit({ kind: 'compress', pid: owner.pid, vpn: e.vpn, frame: target, msg: `压缩：pid ${owner.pid} 的 VPN 0x${e.vpn.toString(16)} 压进压缩器页框 #${target}（为 pid ${forPid} 腾出空间）` });
        return target !== frame;
      }
    }
    if (this.s.cfg.swap) {
      const slot = this.s.swap.findIndex((x) => x === null);
      if (slot >= 0) {
        this.s.swap[slot] = { pid: owner.pid, vpn: e.vpn };
        e.state = 'swapped';
        e.swapSlot = slot;
        e.frame = null;
        this.s.frames[frame] = { owner: null, vpn: null, use: 'free' };
        this.s.stats.pageOuts++;
        this.s.stats.swapBytesWritten += PAGE_SIZE;
        this.emit({ kind: 'swap-out', pid: owner.pid, vpn: e.vpn, frame, bytes: PAGE_SIZE, msg: `换出：pid ${owner.pid} 的 VPN 0x${e.vpn.toString(16)} 写入 SSD 交换槽 #${slot}，页框 #${frame} 释放` });
        return true;
      }
    }
    return false;
  }

  /** 找一个有空位的压缩器页框；没有则把当前牺牲页框转为压缩器页框 */
  private compressorFrame(victimFrame: number): number | null {
    const ratio = this.s.cfg.compressRatio;
    const existing = this.s.frames.findIndex((f) => f.use === 'compressor' && (f.fill ?? 0) < ratio);
    if (existing >= 0) {
      this.s.frames[existing].fill = (this.s.frames[existing].fill ?? 0) + 1;
      return existing;
    }
    // 压缩器最多占用一半页框，超过就改用交换
    const used = this.s.frames.filter((f) => f.use === 'compressor').length;
    if (used >= Math.floor(this.s.frames.length / 2)) return null;
    this.s.frames[victimFrame] = { owner: -1, vpn: null, use: 'compressor', fill: 1 };
    return victimFrame;
  }

  // ---------- 工作负载 ----------
  /** 推进一个时间片：每个进程按工作集随机访问页面（90% 落在工作集内） */
  tick(): { faults: number; hits: number } {
    this.s.tick++;
    this.r = rng(this.s.seed + this.s.tick * 7919);
    let faults = 0;
    let hits = 0;
    const alive = this.s.procs.filter((p) => p.alive);
    for (let k = 0; k < this.s.cfg.accessesPerTick; k++) {
      for (const p of alive) {
        const heap = Object.values(p.pt).filter((e) => e.kind === 'heap');
        const code = Object.values(p.pt).filter((e) => e.kind === 'code');
        if (!heap.length) continue;
        let e: Pte;
        const x = this.r();
        if (x < 0.1 && code.length) e = code[Math.floor(this.r() * code.length)];
        else {
          const ws = Math.max(1, Math.min(p.workingSet, heap.length));
          const inWs = this.r() < 0.9;
          e = inWs ? heap[Math.floor(this.r() * ws)] : heap[Math.floor(this.r() * heap.length)];
        }
        const r = this.access(p.pid, e.vpn, e.kind === 'heap' && this.r() < p.writeRatio);
        if (r === 'hit') hits++;
        else faults++;
      }
    }
    return { faults, hits };
  }

  // ---------- 统计 ----------
  summary() {
    const f = this.s.frames;
    const free = f.filter((x) => x.use === 'free').length;
    const kernel = f.filter((x) => x.use === 'kernel').length;
    const comp = f.filter((x) => x.use === 'compressor').length;
    const used = f.length - free;
    const swapUsed = this.s.swap.filter(Boolean).length;
    // 压力：可用（空闲）比例 + 是否已经在换出。macOS 的真实判定更复杂，这里是教学近似。
    const freeRatio = free / f.length;
    const pressure = swapUsed > 0 && freeRatio < 0.05 ? 'critical' : comp > 0 || freeRatio < 0.1 ? 'warn' : 'normal';
    return { total: f.length, free, kernel, comp, used, swapUsed, swapTotal: this.s.swap.length, pressure: pressure as 'normal' | 'warn' | 'critical', compressedPages: this.s.compressed.length };
  }
}

export const PRESSURE_CN = { normal: '正常', warn: '偏高（开始压缩）', critical: '严重（频繁换出到 SSD）' };
