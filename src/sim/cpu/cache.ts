// 组相联缓存（LRU 替换），只记录标签，不存数据——数据始终以内存为准（写直达的教学简化）。

export interface CacheConfig {
  name: string;
  sets: number;
  ways: number;
  lineBytes: number;
  latency: number; // 命中延迟（周期）
}

export interface CacheLine {
  valid: boolean;
  tag: number;
  lru: number; // 越大越近使用
}

export interface CacheAccess {
  level: string;
  hit: boolean;
  set: number;
  way: number;
  tag: number;
  evictedTag?: number;
}

export class Cache {
  cfg: CacheConfig;
  lines: CacheLine[][];
  hits = 0;
  misses = 0;
  private clock = 0;

  constructor(cfg: CacheConfig) {
    this.cfg = cfg;
    this.lines = Array.from({ length: cfg.sets }, () => Array.from({ length: cfg.ways }, () => ({ valid: false, tag: 0, lru: 0 })));
  }

  split(addr: number) {
    const line = Math.floor(addr / this.cfg.lineBytes);
    return { set: line % this.cfg.sets, tag: Math.floor(line / this.cfg.sets), offset: addr % this.cfg.lineBytes };
  }

  access(addr: number): CacheAccess {
    const { set, tag } = this.split(addr);
    const ways = this.lines[set];
    this.clock++;
    const w = ways.findIndex((l) => l.valid && l.tag === tag);
    if (w >= 0) {
      ways[w].lru = this.clock;
      this.hits++;
      return { level: this.cfg.name, hit: true, set, way: w, tag };
    }
    this.misses++;
    let victim = ways.findIndex((l) => !l.valid);
    let evictedTag: number | undefined;
    if (victim < 0) {
      victim = ways.reduce((best, l, i) => (l.lru < ways[best].lru ? i : best), 0);
      evictedTag = ways[victim].tag;
    }
    ways[victim] = { valid: true, tag, lru: this.clock };
    return { level: this.cfg.name, hit: false, set, way: victim, tag, evictedTag };
  }

  snapshot() {
    return { lines: this.lines.map((s) => s.map((l) => ({ ...l }))), hits: this.hits, misses: this.misses, clock: this.clock };
  }

  restore(s: ReturnType<Cache['snapshot']>) {
    this.lines = s.lines.map((set) => set.map((l) => ({ ...l })));
    this.hits = s.hits;
    this.misses = s.misses;
    this.clock = s.clock;
  }
}

// 访存层次：L1 → L2 → SLC → LPDDR5。
// 延迟为量级参考（第三方测量的大致量级，按 3.2 GHz 折算），属资料推导 + 教学近似。
export const DRAM_LATENCY = 320;

export interface HierarchyResult {
  path: CacheAccess[];
  servedBy: 'L1' | 'L2' | 'SLC' | 'DRAM';
  cycles: number;
}

export class Hierarchy {
  levels: Cache[];
  constructor(cfgs: CacheConfig[]) {
    this.levels = cfgs.map((c) => new Cache(c));
  }
  access(addr: number): HierarchyResult {
    const path: CacheAccess[] = [];
    let cycles = 0;
    for (const c of this.levels) {
      const r = c.access(addr);
      path.push(r);
      cycles += c.cfg.latency;
      if (r.hit) return { path, servedBy: c.cfg.name as HierarchyResult['servedBy'], cycles };
    }
    return { path, servedBy: 'DRAM', cycles: cycles + DRAM_LATENCY };
  }
  snapshot() {
    return this.levels.map((l) => l.snapshot());
  }
  restore(s: ReturnType<Hierarchy['snapshot']>) {
    s.forEach((x, i) => this.levels[i].restore(x));
  }
}

export const DEFAULT_CACHE: CacheConfig[] = [
  { name: 'L1', sets: 8, ways: 2, lineBytes: 64, latency: 3 },
  { name: 'L2', sets: 32, ways: 4, lineBytes: 64, latency: 16 },
  { name: 'SLC', sets: 64, ways: 8, lineBytes: 64, latency: 40 },
];
