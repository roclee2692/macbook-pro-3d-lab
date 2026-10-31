// GPU 模型：CPU 编码命令缓冲 → 顶点变换 → 分块（tiling）→ 逐块光栅化到片上 tile 内存 → 整块写回统一内存中的帧缓冲 → 显示引擎扫描输出。
// Apple GPU 采用基于分块的延迟渲染（TBDR）是 Apple 在 Metal 文档中公开说明的；
// 具体核心内部结构未公开，这里的“14 个核心各领取若干 tile”属教学抽象。
// 光栅化是真实计算（边函数 + 重心插值 + 深度测试），帧缓冲像素由它逐个算出。

export interface GpuConfig {
  width: number;
  height: number;
  tile: number;
  cores: number;
  triangles: number;
  angle: number; // 度
  discrete: boolean; // 对照：独立显卡需要经 PCIe 复制
}

export const DEFAULT_GPU: GpuConfig = { width: 160, height: 104, tile: 16, cores: 14, triangles: 6, angle: 20, discrete: false };

export interface Vertex {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
}

export interface UMBuffer {
  name: string;
  addr: number; // 统一内存中的物理地址（示意）
  bytes: number;
  writer: 'CPU' | 'GPU';
  readers: string[];
}

export interface GpuCommand {
  op: string;
  args: string;
  bytes: number;
}

export interface TileWork {
  tx: number;
  ty: number;
  core: number;
  tris: number[];
  pixels: number; // 被覆盖的像素数（含重叠）
  written: number; // 写回帧缓冲字节数
}

export type GpuPhase = 'idle' | 'encode' | 'vertex' | 'tiling' | 'raster' | 'present' | 'done';

export interface GpuRun {
  cfg: GpuConfig;
  commands: GpuCommand[];
  buffers: UMBuffer[];
  verts: Vertex[]; // 对象空间
  screen: { x: number; y: number; z: number }[];
  tiles: TileWork[];
  framebuffer: Uint8ClampedArray; // RGBA
  depth: Float32Array;
  phase: GpuPhase;
  tileCursor: number; // 已完成的 tile 数
  stats: { vertexBytes: number; fbBytes: number; tbdrWrites: number; imrWrites: number; overdraw: number; pcieCopyBytes: number };
}

const FB_BASE = 0x2_4000_0000;
const VB_BASE = 0x2_3800_0000;
const CB_BASE = 0x2_3000_0000;

export function buildScene(cfg: GpuConfig): Vertex[] {
  const v: Vertex[] = [];
  const palette = [
    [0.96, 0.36, 0.29], [0.98, 0.72, 0.2], [0.3, 0.78, 0.45], [0.25, 0.6, 0.98], [0.62, 0.42, 0.95], [0.95, 0.4, 0.7],
    [0.2, 0.82, 0.82], [0.9, 0.9, 0.9],
  ];
  for (let i = 0; i < cfg.triangles; i++) {
    const a = (i / cfg.triangles) * Math.PI * 2;
    const cx = Math.cos(a) * 0.45;
    const cy = Math.sin(a) * 0.45;
    const z = 0.2 + (i % 3) * 0.25;
    const s = 0.55;
    const c = palette[i % palette.length];
    for (let k = 0; k < 3; k++) {
      const b = a + (k * Math.PI * 2) / 3 + Math.PI / 2;
      const shade = 0.65 + 0.35 * (k / 2);
      v.push({ x: cx + Math.cos(b) * s, y: cy + Math.sin(b) * s, z, r: c[0] * shade, g: c[1] * shade, b: c[2] * shade });
    }
  }
  return v;
}

export function startRun(cfg: GpuConfig): GpuRun {
  const verts = buildScene(cfg);
  const vertexBytes = verts.length * 6 * 4; // xyz + rgb，float32
  const fbBytes = cfg.width * cfg.height * 4;
  return {
    cfg,
    commands: [],
    buffers: [],
    verts,
    screen: [],
    tiles: [],
    framebuffer: new Uint8ClampedArray(fbBytes),
    depth: new Float32Array(cfg.width * cfg.height).fill(Infinity),
    phase: 'idle',
    tileCursor: 0,
    stats: { vertexBytes, fbBytes, tbdrWrites: 0, imrWrites: 0, overdraw: 0, pcieCopyBytes: cfg.discrete ? vertexBytes + fbBytes : 0 },
  };
}

/** CPU 端：把顶点写入统一内存、编码命令缓冲 */
export function encode(run: GpuRun) {
  const { cfg, stats } = run;
  run.buffers = [
    { name: '顶点缓冲 vertexBuffer', addr: VB_BASE, bytes: stats.vertexBytes, writer: 'CPU', readers: ['GPU 顶点着色'] },
    { name: '命令缓冲 MTLCommandBuffer', addr: CB_BASE, bytes: 256, writer: 'CPU', readers: ['GPU 命令处理器'] },
    { name: '帧缓冲 drawable', addr: FB_BASE, bytes: stats.fbBytes, writer: 'GPU', readers: ['显示引擎'] },
  ];
  run.commands = [
    { op: 'setRenderPipelineState', args: 'vertex: rotate2D, fragment: passColor', bytes: 32 },
    { op: 'setVertexBuffer', args: `0x${VB_BASE.toString(16)}（${stats.vertexBytes} B，零拷贝）`, bytes: 24 },
    { op: 'setVertexBytes', args: `angle = ${cfg.angle}°`, bytes: 16 },
    { op: 'drawPrimitives', args: `triangle × ${cfg.triangles}（${cfg.triangles * 3} 个顶点）`, bytes: 24 },
    { op: 'present', args: `drawable @ 0x${FB_BASE.toString(16)}`, bytes: 16 },
    { op: 'commit', args: '提交到 GPU 命令队列', bytes: 8 },
  ];
  run.phase = 'encode';
}

/** 顶点阶段：旋转 + 视口变换（真实计算） */
export function vertexStage(run: GpuRun) {
  const { cfg } = run;
  const t = (cfg.angle * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const aspect = cfg.height / cfg.width;
  run.screen = run.verts.map((v) => {
    const x = (v.x * c - v.y * s) * aspect;
    const y = v.x * s + v.y * c;
    return { x: ((x + 1) / 2) * cfg.width, y: ((1 - y) / 2) * cfg.height, z: v.z };
  });
  run.phase = 'vertex';
}

/** 分块：计算每个三角形覆盖的 tile，并把 tile 分配给 GPU 核心 */
export function tilingStage(run: GpuRun) {
  const { cfg } = run;
  const tw = Math.ceil(cfg.width / cfg.tile);
  const th = Math.ceil(cfg.height / cfg.tile);
  const tiles: TileWork[] = [];
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) tiles.push({ tx, ty, core: (ty * tw + tx) % cfg.cores, tris: [], pixels: 0, written: 0 });
  for (let i = 0; i < run.screen.length / 3; i++) {
    const p = run.screen.slice(i * 3, i * 3 + 3);
    const x0 = Math.max(0, Math.floor(Math.min(...p.map((q) => q.x)) / cfg.tile));
    const x1 = Math.min(tw - 1, Math.floor(Math.max(...p.map((q) => q.x)) / cfg.tile));
    const y0 = Math.max(0, Math.floor(Math.min(...p.map((q) => q.y)) / cfg.tile));
    const y1 = Math.min(th - 1, Math.floor(Math.max(...p.map((q) => q.y)) / cfg.tile));
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) tiles[ty * tw + tx].tris.push(i);
  }
  run.tiles = tiles;
  run.phase = 'tiling';
}

const edge = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => (px - ax) * (by - ay) - (py - ay) * (bx - ax);

/** 光栅化一个 tile：在片上 tile 内存中完成深度测试与着色，最后整块写回帧缓冲 */
export function rasterTile(run: GpuRun, index: number) {
  const { cfg } = run;
  const t = run.tiles[index];
  const W = cfg.width;
  const local = new Uint8ClampedArray(cfg.tile * cfg.tile * 4);
  const ldepth = new Float32Array(cfg.tile * cfg.tile).fill(Infinity);
  let covered = 0;
  for (const ti of t.tris) {
    const [a, b, c] = run.screen.slice(ti * 3, ti * 3 + 3);
    const [va, vb, vc] = run.verts.slice(ti * 3, ti * 3 + 3);
    const area = edge(a.x, a.y, b.x, b.y, c.x, c.y);
    if (area === 0) continue;
    for (let ly = 0; ly < cfg.tile; ly++) {
      for (let lx = 0; lx < cfg.tile; lx++) {
        const px = t.tx * cfg.tile + lx + 0.5;
        const py = t.ty * cfg.tile + ly + 0.5;
        if (px >= W || py >= cfg.height) continue;
        const w0 = edge(b.x, b.y, c.x, c.y, px, py) / area;
        const w1 = edge(c.x, c.y, a.x, a.y, px, py) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        covered++;
        run.stats.imrWrites += 4; // 立即模式渲染每个片元都要写一次帧缓冲
        const z = w0 * a.z + w1 * b.z + w2 * c.z;
        const li = ly * cfg.tile + lx;
        if (z >= ldepth[li]) continue;
        ldepth[li] = z;
        local[li * 4] = 255 * (w0 * va.r + w1 * vb.r + w2 * vc.r);
        local[li * 4 + 1] = 255 * (w0 * va.g + w1 * vb.g + w2 * vc.g);
        local[li * 4 + 2] = 255 * (w0 * va.b + w1 * vb.b + w2 * vc.b);
        local[li * 4 + 3] = 255;
      }
    }
  }
  // 整块写回（TBDR：每个像素只写一次）
  let written = 0;
  for (let ly = 0; ly < cfg.tile; ly++) {
    for (let lx = 0; lx < cfg.tile; lx++) {
      const x = t.tx * cfg.tile + lx;
      const y = t.ty * cfg.tile + ly;
      if (x >= W || y >= cfg.height) continue;
      const gi = (y * W + x) * 4;
      const li = (ly * cfg.tile + lx) * 4;
      if (local[li + 3]) {
        run.framebuffer.set(local.subarray(li, li + 4), gi);
        run.depth[y * W + x] = ldepth[ly * cfg.tile + lx];
      } else {
        run.framebuffer.set([16, 18, 24, 255], gi); // 清屏色
      }
      written += 4;
    }
  }
  t.pixels = covered;
  t.written = written;
  run.stats.tbdrWrites += written;
  run.tileCursor = index + 1;
  run.phase = run.tileCursor >= run.tiles.length ? 'present' : 'raster';
}

export function runAll(run: GpuRun) {
  encode(run);
  vertexStage(run);
  tilingStage(run);
  for (let i = 0; i < run.tiles.length; i++) rasterTile(run, i);
  finish(run);
  return run;
}

export function finish(run: GpuRun) {
  const covered = run.tiles.reduce((a, t) => a + t.pixels, 0);
  const lit = run.depth.reduce((a, d) => a + (Number.isFinite(d) ? 1 : 0), 0);
  run.stats.overdraw = lit ? covered / lit : 0;
  run.phase = 'done';
}
