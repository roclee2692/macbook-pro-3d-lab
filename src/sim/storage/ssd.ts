// SSD 与文件系统模型：文件 → 逻辑块（LBA，4 KB）→ FTL 映射 → NAND 通道/页。
// 读取先查内核的统一缓冲区缓存（page cache），未命中才向 SSD 控制器（集成在 M1 Pro 内）发 NVMe 命令。
// NAND 时序（tR、tPROG、通道带宽）为常见 TLC NAND 的量级，属教学近似；4 个通道对应主板上的 4 颗 NAND。

export const BLOCK = 4096;

export interface SsdConfig {
  channels: number;
  nandReadUs: number; // tR
  nandProgUs: number; // tPROG
  channelMBps: number; // 每通道传输带宽
  cacheBlocks: number; // page cache 容量（块）
  readahead: number; // 顺序预读块数
  memcpyGBps: number; // 内存拷贝带宽（缓存命中时）
}

export const DEFAULT_SSD: SsdConfig = {
  channels: 4,
  nandReadUs: 50,
  nandProgUs: 600,
  channelMBps: 800,
  cacheBlocks: 48,
  readahead: 8,
  memcpyGBps: 20,
};

export interface FileNode {
  name: string;
  path: string;
  inode: number;
  size: number;
  lbas: number[];
  content: string;
}

export interface FtlEntry {
  channel: number;
  block: number;
  page: number;
}

export interface BlockIo {
  lba: number;
  hit: boolean;
  prefetch: boolean;
  channel: number;
  start: number;
  end: number;
}

export interface ReadResult {
  file: string;
  pattern: 'seq' | 'rand';
  ios: BlockIo[];
  totalUs: number;
  bytes: number;
  hits: number; // 页缓存命中
  prefetched: number; // 由顺序预读提前取回（仍访问了 NAND）
  misses: number; // 按需访问 NAND
  mbps: number;
  checksum: number;
}

export interface SsdState {
  cfg: SsdConfig;
  files: FileNode[];
  ftl: Record<number, FtlEntry>;
  cache: { lba: number; dirty: boolean }[]; // 越靠后越新（LRU）
  nextLba: number;
  writePtr: number[]; // 每通道写指针（日志结构）
  nextInode: number;
  stats: { nandReads: number; nandWrites: number; hostReadBytes: number; hostWriteBytes: number };
}

export class Ssd {
  s: SsdState;
  constructor(cfg: SsdConfig = DEFAULT_SSD) {
    this.s = { cfg, files: [], ftl: {}, cache: [], nextLba: 2048, writePtr: Array(cfg.channels).fill(0), nextInode: 1000, stats: { nandReads: 0, nandWrites: 0, hostReadBytes: 0, hostWriteBytes: 0 } };
    // 预置文件（已在 NAND 上，不在缓存中）
    this.create('/Applications/Hello.app/Contents/MacOS/Hello', 64 * 1024, 'Mach-O 可执行文件（示意）', false);
    this.create('/Users/me/notes.txt', 24 * 1024, '计算机体系结构笔记：缓存命中比访问 NAND 快三个数量级。', false);
    this.create('/Users/me/photo.heic', 256 * 1024, 'HEIC 图片数据（示意）', false);
    this.dropCache();
  }

  snapshot() {
    return structuredClone(this.s);
  }
  restore(s: SsdState) {
    this.s = structuredClone(s);
  }

  find(path: string) {
    return this.s.files.find((f) => f.path === path);
  }

  /** 创建文件：分配 LBA；persist=false 时直接视为已落盘 */
  create(path: string, size: number, content: string, cached = true): FileNode {
    const old = this.find(path);
    if (old) this.remove(path);
    const n = Math.max(1, Math.ceil(size / BLOCK));
    const lbas: number[] = [];
    for (let i = 0; i < n; i++) lbas.push(this.s.nextLba++);
    const f: FileNode = { name: path.split('/').pop()!, path, inode: this.s.nextInode++, size, lbas, content };
    this.s.files.push(f);
    for (const lba of lbas) {
      if (cached) this.touchCache(lba, true);
      else this.program(lba);
    }
    return f;
  }

  remove(path: string) {
    const f = this.find(path);
    if (!f) return;
    this.s.files = this.s.files.filter((x) => x !== f);
    this.s.cache = this.s.cache.filter((c) => !f.lbas.includes(c.lba));
    for (const l of f.lbas) delete this.s.ftl[l]; // 相当于 TRIM
  }

  private program(lba: number): FtlEntry {
    // 日志结构：写到“下一个空闲页”，轮流使用各通道，旧位置变为无效（等待垃圾回收）
    const ch = lba % this.s.cfg.channels;
    const p = this.s.writePtr[ch]++;
    const e = { channel: ch, block: Math.floor(p / 64), page: p % 64 };
    this.s.ftl[lba] = e;
    this.s.stats.nandWrites++;
    return e;
  }

  private touchCache(lba: number, dirty = false): { evicted?: { lba: number; dirty: boolean } } {
    const i = this.s.cache.findIndex((c) => c.lba === lba);
    let d = dirty;
    if (i >= 0) {
      d = d || this.s.cache[i].dirty;
      this.s.cache.splice(i, 1);
    }
    this.s.cache.push({ lba, dirty: d });
    if (this.s.cache.length > this.s.cfg.cacheBlocks) {
      const ev = this.s.cache.shift()!;
      if (ev.dirty) this.program(ev.lba);
      return { evicted: ev };
    }
    return {};
  }

  inCache(lba: number) {
    return this.s.cache.some((c) => c.lba === lba);
  }

  dropCache() {
    for (const c of this.s.cache) if (c.dirty) this.program(c.lba);
    this.s.cache = [];
  }

  /** 写入并同步（fsync）：脏块写入 NAND，按通道并行编程 */
  save(path: string, content: string, size: number) {
    const f = this.create(path, size, content, true);
    const chanFree = Array(this.s.cfg.channels).fill(0);
    const ios: BlockIo[] = [];
    const xfer = (BLOCK / (this.s.cfg.channelMBps * 1e6)) * 1e6;
    for (const lba of f.lbas) {
      const e = this.program(lba);
      const start = chanFree[e.channel];
      const end = start + xfer + this.s.cfg.nandProgUs;
      chanFree[e.channel] = end;
      ios.push({ lba, hit: false, prefetch: false, channel: e.channel, start, end });
      const c = this.s.cache.find((x) => x.lba === lba);
      if (c) c.dirty = false;
    }
    this.s.stats.hostWriteBytes += f.lbas.length * BLOCK;
    return { file: f, ios, totalUs: Math.max(0, ...ios.map((i) => i.end)) };
  }

  /** 读取整个文件。seq：按顺序读并预读；rand：随机顺序、队列深度 1 */
  read(path: string, pattern: 'seq' | 'rand', seed = 1): ReadResult | null {
    const f = this.find(path);
    if (!f) return null;
    const cfg = this.s.cfg;
    const order = [...f.lbas];
    if (pattern === 'rand') {
      let a = seed;
      for (let i = order.length - 1; i > 0; i--) {
        a = (a * 1103515245 + 12345) & 0x7fffffff;
        const j = a % (i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    const xfer = (BLOCK / (cfg.channelMBps * 1e6)) * 1e6;
    const hitCost = (BLOCK / (cfg.memcpyGBps * 1e9)) * 1e6;
    const chanFree = Array(cfg.channels).fill(0);
    const ready = new Map<number, number>(); // lba → 数据到达内存的时间
    const ios: BlockIo[] = [];
    let now = 0;
    let hits = 0;
    let prefetched = 0;
    let misses = 0;
    const fetch = (lba: number, at: number, prefetch: boolean) => {
      const e = this.s.ftl[lba] ?? this.program(lba);
      const start = Math.max(at, chanFree[e.channel]);
      const end = start + cfg.nandReadUs + xfer;
      chanFree[e.channel] = end;
      ready.set(lba, end);
      this.s.stats.nandReads++;
      ios.push({ lba, hit: false, prefetch, channel: e.channel, start, end });
      this.touchCache(lba);
    };
    for (let k = 0; k < order.length; k++) {
      const lba = order[k];
      if (ready.has(lba)) {
        // 预读已在途或已到达
        now = Math.max(now, ready.get(lba)!) + hitCost;
        prefetched++;
        continue;
      }
      if (this.inCache(lba)) {
        ios.push({ lba, hit: true, prefetch: false, channel: -1, start: now, end: now + hitCost });
        this.touchCache(lba);
        now += hitCost;
        hits++;
        continue;
      }
      misses++;
      fetch(lba, now, false);
      if (pattern === 'seq') {
        // 顺序访问：一次把后续块的请求并行发给各通道
        for (let j = 1; j <= cfg.readahead && k + j < order.length; j++) {
          const nl = order[k + j];
          if (!ready.has(nl) && !this.inCache(nl)) fetch(nl, now, true);
        }
      }
      now = ready.get(lba)! + hitCost;
    }
    const bytes = f.lbas.length * BLOCK;
    this.s.stats.hostReadBytes += bytes;
    let checksum = 0;
    for (let i = 0; i < f.content.length; i++) checksum = (checksum * 31 + f.content.charCodeAt(i)) >>> 0;
    return { file: path, pattern, ios, totalUs: now, bytes, hits, prefetched, misses, mbps: bytes / now, checksum };
  }
}
