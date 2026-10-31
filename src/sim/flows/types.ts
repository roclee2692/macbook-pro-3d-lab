import type { Provenance } from '../../data/sources';

// 统一数据流：所有场景、实验产生的数据包都用同一结构与配色。
export type PacketKind = 'mem-read' | 'mem-write' | 'storage' | 'gpu' | 'power' | 'thermal' | 'control';

export const PACKET_STYLE: Record<PacketKind, { color: string; label: string }> = {
  'mem-read': { color: '#4ea1ff', label: '内存读' },
  'mem-write': { color: '#ffb020', label: '内存写' },
  storage: { color: '#b57bff', label: '存储 I/O' },
  gpu: { color: '#34d399', label: 'GPU 数据' },
  power: { color: '#ff4d5e', label: '供电' },
  thermal: { color: '#ff8a3d', label: '散热' },
  control: { color: '#cbd5e1', label: '控制/指令' },
};

// 数据包端点（会映射到三维模型上的部件或芯片视图中的模块）
export type NodeId =
  | 'magsafe' | 'battery' | 'charger' | 'pmu' | 'powerkey'
  | 'bootrom' | 'sep' | 'nor'
  | 'cpu' | 'ecore' | 'l2' | 'slc' | 'memctl' | 'gpu' | 'dispeng' | 'ssdctl'
  | 'dram' | 'nand' | 'display'
  | 'heatsink' | 'fan' | 'trackpad' | 'keyboard'
  // 性能核内部（芯片视图中的教学抽象）
  | 'l1i' | 'fetch' | 'decode' | 'regs' | 'alu' | 'lsu' | 'l1d' | 'mmu' | 'commit';

export const NODE_CN: Record<NodeId, string> = {
  magsafe: 'MagSafe 3 接口', battery: '电池', charger: '充电控制器 ISL9240', pmu: '电源管理 APL1098', powerkey: '电源键（Touch ID）',
  bootrom: 'Boot ROM（SoC 内）', sep: '安全隔区 SEP', nor: '启动 NOR 闪存',
  cpu: 'CPU 性能核', ecore: 'CPU 能效核', l2: 'L2 缓存', slc: '系统级缓存 SLC', memctl: '内存控制器', gpu: 'GPU', dispeng: '显示引擎', ssdctl: 'SSD 控制器（SoC 内）',
  dram: 'LPDDR5 统一内存', nand: 'NAND 闪存', display: 'XDR 显示屏',
  heatsink: '散热器', fan: '风扇', trackpad: '触控板', keyboard: '键盘',
  l1i: 'L1 指令缓存', fetch: '取指单元', decode: '译码器', regs: '寄存器堆', alu: '算术逻辑单元 ALU', lsu: '访存单元 LSU', l1d: 'L1 数据缓存', mmu: 'MMU / TLB', commit: '提交（退休）',
};

export interface Packet {
  id: string;
  kind: PacketKind;
  from: NodeId;
  to: NodeId;
  bytes: number;
  op: string;
  reason: string;
  addr?: string;
}

export type DisplayContent =
  | { mode: 'off' }
  | { mode: 'logo'; progress: number; error?: string }
  | { mode: 'text'; lines: string[] }
  | { mode: 'fb'; fb: Uint8ClampedArray; w: number; h: number };

export type Visual =
  | { type: 'frames'; frames: { use: string; owner: number | null; hue?: number }[]; procs: { pid: number; name: string; hue: number }[] }
  | { type: 'cores'; cores: { id: number; kind: string; thread: string | null }[]; queue: string[]; temp: number; rpm: number; pFreq: number }
  | { type: 'fb'; fb: Uint8ClampedArray; w: number; h: number; tilesDone: number; tiles: number; tile: number }
  | { type: 'io'; ios: { lba: number; hit: boolean; channel: number; start: number; end: number; prefetch: boolean }[]; totalUs: number }
  | { type: 'code'; lines: { addr: string; word: string; text: string; active?: boolean }[] };

export interface FlowStep {
  title: string;
  detail: string;
  packets: Packet[];
  highlights: string[]; // 三维部件/芯片 id
  inspect: [string, string][];
  durationUs: number;
  provenance: Provenance;
  display?: DisplayContent;
  visual?: Visual;
  log?: string;
  failed?: boolean;
}

export interface Scenario {
  id: string;
  title: string;
  summary: string;
  options?: { key: string; label: string }[];
  build: (opts: Record<string, boolean>) => FlowStep[];
}

let pid = 0;
export const pk = (kind: PacketKind, from: NodeId, to: NodeId, bytes: number, op: string, reason: string, addr?: string): Packet => ({
  id: `p${++pid}`,
  kind,
  from,
  to,
  bytes,
  op,
  reason,
  addr,
});

export const fmtBytes = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(b % 1024 ? 1 : 0)} KB` : `${b} B`;

export const fmtUs = (us: number) => (us >= 1e6 ? `${(us / 1e6).toFixed(2)} s` : us >= 1000 ? `${(us / 1000).toFixed(2)} ms` : us >= 1 ? `${us.toFixed(1)} µs` : `${(us * 1000).toFixed(0)} ns`);
