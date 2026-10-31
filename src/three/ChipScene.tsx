import { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useLab } from '../store';
import type { NodeId } from '../sim/flows/types';
import { Packets, type Resolver } from './Packets';

// 【教学抽象】M1 Pro 芯片内部视图。Apple 未公开版图细节：
// 模块数量来自官方规格（6P+2E CPU、14 核 GPU、16 核神经网络引擎），
// 模块位置、面积与“核心放大图”中的流水线结构均为示意，不代表真实微架构版图。

export interface Block {
  id: string;
  label: string;
  x: number;
  z: number;
  w: number;
  d: number;
  color: string;
  h?: number;
  disabled?: boolean;
  info: string;
}

const P = '#3b82f6';
const E = '#14b8a6';
const G = '#22c55e';
const C = '#64748b';
const M = '#f59e0b';

function pBlocks(cluster: 0 | 1): Block[] {
  const z = cluster === 0 ? -4.9 : 4.9;
  const out: Block[] = [];
  for (let i = 0; i < 4; i++) {
    const disabled = i === 3; // 8 核 CPU 版本：每簇 4 核中启用 3 核（资料推导）
    out.push({ id: `chip-p${cluster}-${i}`, label: disabled ? '未启用' : `P${cluster * 3 + i}`, x: -8.9 + i * 1.45, z, w: 1.25, d: 2.0, color: P, disabled, info: '性能核（Firestorm 级别的宽发射乱序核心；内部结构未公开）' });
  }
  out.push({ id: `chip-l2p${cluster}`, label: `L2 12 MB`, x: -6.7, z: cluster === 0 ? -2.95 : 2.95, w: 5.6, d: 1.2, color: '#1d4ed8', info: '性能核簇共享二级缓存（第三方测量 12 MB）' });
  return out;
}

export const BLOCKS: Block[] = [
  ...pBlocks(0),
  ...pBlocks(1),
  { id: 'chip-e-0', label: 'E0', x: -8.9, z: 0, w: 1.2, d: 1.6, color: E, info: '能效核（省电，适合后台任务）' },
  { id: 'chip-e-1', label: 'E1', x: -7.5, z: 0, w: 1.2, d: 1.6, color: E, info: '能效核' },
  { id: 'chip-l2e', label: 'L2 4 MB', x: -5.4, z: 0, w: 2.4, d: 1.6, color: '#0f766e', info: '能效核簇二级缓存（第三方测量 4 MB）' },
  { id: 'chip-slc', label: 'SLC 24 MB', x: -2.0, z: 0, w: 2.2, d: 10.2, color: '#7c3aed', info: '系统级缓存：CPU、GPU 与其他模块共享，位于内存控制器之前（第三方测量 24 MB）' },
  ...Array.from({ length: 16 }, (_, i): Block => {
    const disabled = i >= 14;
    return { id: `chip-gpu-${i}`, label: disabled ? '×' : `G${i}`, x: 0.9 + (i % 4) * 1.55, z: -5.0 + Math.floor(i / 4) * 1.6, w: 1.35, d: 1.4, color: G, disabled, info: disabled ? '14 核版本中未启用的 GPU 核心（示意）' : 'GPU 核心：每核含多个执行单元与片上 tile 存储（官方 14 核）' };
  }),
  { id: 'chip-ane', label: '神经网络引擎 16 核', x: 2.3, z: 3.6, w: 4.0, d: 2.4, color: '#db2777', info: '16 核神经网络引擎（官方）' },
  { id: 'chip-media', label: '媒体引擎', x: 5.6, z: 2.9, w: 2.2, d: 1.2, color: '#ea580c', info: 'H.264/HEVC/ProRes 硬件编解码（官方）' },
  { id: 'chip-disp', label: '显示引擎', x: 5.6, z: 4.4, w: 2.2, d: 1.2, color: '#0891b2', info: '从帧缓冲读像素送往内建屏与外接显示器' },
  { id: 'chip-ssd', label: 'SSD 控制器', x: 8.4, z: 2.0, w: 2.0, d: 1.3, color: '#a855f7', info: 'Apple 自研存储控制器，集成在 SoC 内，NAND 直接挂在它下面' },
  { id: 'chip-sep', label: '安全隔区', x: 8.4, z: 3.6, w: 2.0, d: 1.3, color: '#e11d48', info: 'Secure Enclave：独立处理器与 Boot ROM' },
  { id: 'chip-rom', label: 'Boot ROM', x: 8.4, z: 5.1, w: 2.0, d: 1.0, color: '#9f1239', info: '只读启动代码，硬件信任根' },
  { id: 'chip-tb', label: 'Thunderbolt / PCIe', x: 8.4, z: 0.1, w: 2.0, d: 1.9, color: C, info: 'Thunderbolt 4 与 PCIe 控制器' },
  { id: 'chip-mc0', label: '内存控制器 A', x: 0, z: -6.75, w: 19.2, d: 0.55, color: M, info: 'LPDDR5 控制器（通道数为示意；总线 256 位为第三方资料）' },
  { id: 'chip-mc1', label: '内存控制器 B', x: 0, z: 6.75, w: 19.2, d: 0.55, color: M, info: 'LPDDR5 控制器' },
  { id: 'chip-dram-0', label: 'LPDDR5 8 GB', x: 0, z: -10.2, w: 12, d: 4.2, color: '#1f2937', h: 0.9, info: 'Samsung 8 GB LPDDR5 封装（拆机识别），与 SoC 同基板' },
  { id: 'chip-dram-1', label: 'LPDDR5 8 GB', x: 0, z: 10.2, w: 12, d: 4.2, color: '#1f2937', h: 0.9, info: 'Samsung 8 GB LPDDR5 封装（拆机识别）' },
];

// 性能核放大图（教学流水线）
export const CORE: Block[] = [
  { id: 'core-l1i', label: 'L1 指令缓存', x: 15.5, z: -5.2, w: 3, d: 1.6, color: '#2563eb', info: '真实容量 192 KB（第三方测量）；本模拟器使用缩小的教学缓存' },
  { id: 'core-fetch', label: '① 取指', x: 15.5, z: -2.2, w: 3, d: 2, color: P, info: '按 PC 取出 4 字节机器码' },
  { id: 'core-decode', label: '② 译码', x: 19.1, z: -2.2, w: 3, d: 2, color: P, info: '拆出操作码、寄存器号、立即数' },
  { id: 'core-alu', label: '③ 执行 ALU', x: 22.7, z: -2.2, w: 3, d: 2, color: P, info: '加减、逻辑、移位、乘除、比较与分支判断' },
  { id: 'core-lsu', label: '④ 访存 LSU', x: 26.3, z: -2.2, w: 3, d: 2, color: P, info: '计算地址、经 MMU 翻译、访问 L1D' },
  { id: 'core-commit', label: '⑤ 写回/提交', x: 29.9, z: -2.2, w: 3, d: 2, color: P, info: '写目的寄存器、更新 PC、指令退休' },
  { id: 'core-regs', label: '寄存器堆 x0–x30 · SP · PC · NZCV', x: 22.7, z: 1.6, w: 10.2, d: 2.0, color: '#0ea5e9', info: 'AArch64 通用寄存器 31 个 64 位' },
  { id: 'core-mmu', label: 'MMU / TLB', x: 22.7, z: -5.2, w: 3, d: 1.6, color: '#94a3b8', info: '虚拟地址→物理地址；16 KB 页，四级页表' },
  { id: 'core-l1d', label: 'L1 数据缓存', x: 26.3, z: -5.2, w: 3, d: 1.6, color: '#2563eb', info: '真实容量 128 KB（第三方测量）' },
];

export const CHIP_NODE: Partial<Record<NodeId, string>> = {
  cpu: 'chip-p0-0', ecore: 'chip-e-0', l2: 'chip-l2p0', slc: 'chip-slc', memctl: 'chip-mc0', gpu: 'chip-gpu-5', dispeng: 'chip-disp', ssdctl: 'chip-ssd', sep: 'chip-sep', bootrom: 'chip-rom',
  dram: 'chip-dram-0', nand: 'chip-ssd', display: 'chip-disp',
  l1i: 'core-l1i', fetch: 'core-fetch', decode: 'core-decode', regs: 'core-regs', alu: 'core-alu', lsu: 'core-lsu', l1d: 'core-l1d', mmu: 'core-mmu', commit: 'core-commit',
};

const ALL = [...BLOCKS, ...CORE];

export const chipResolve: Resolver = (n, out) => {
  const id = CHIP_NODE[n];
  const b = ALL.find((x) => x.id === id);
  if (!b) return false;
  out.set(b.x, (b.h ?? 0.5) + 0.3, b.z);
  return true;
};

function BlockMesh({ b }: { b: Block }) {
  const sel = useLab((s) => s.selected === b.id);
  const lit = useLab((s) => s.liveHighlights.includes(b.id));
  const color = useMemo(() => new THREE.Color(b.disabled ? '#3a3f48' : b.color), [b]);
  const h = b.h ?? 0.5;
  return (
    <group position={[b.x, h / 2 + 0.15, b.z]}>
      <mesh
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          useLab.getState().select(b.id, false);
        }}
      >
        <boxGeometry args={[b.w, h, b.d]} />
        <meshStandardMaterial
          color={color}
          metalness={0.3}
          roughness={0.5}
          emissive={sel || lit ? (lit ? '#22d3ee' : '#93c5fd') : '#000'}
          emissiveIntensity={sel || lit ? 0.85 : 0}
          transparent={!!b.disabled}
          opacity={b.disabled ? 0.55 : 1}
        />
      </mesh>
      <Html center position={[0, h / 2 + 0.05, 0]} distanceFactor={22} style={{ pointerEvents: 'none' }} zIndexRange={[5, 0]}>
        <div className={`chip-label${b.disabled ? ' off' : ''}`}>{b.label}</div>
      </Html>
    </group>
  );
}

export function ChipScene() {
  return (
    <group position={[-8, 0, 0]}>
      {/* 封装基板与裸片 */}
      <mesh position={[0, -0.1, 0]}>
        <boxGeometry args={[24, 0.2, 26]} />
        <meshStandardMaterial color="#1b3326" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.07, 0]}>
        <boxGeometry args={[20.4, 0.14, 14.6]} />
        <meshStandardMaterial color="#9aa0a8" metalness={0.9} roughness={0.25} />
      </mesh>
      {BLOCKS.map((b) => (
        <BlockMesh key={b.id} b={b} />
      ))}
      {/* 放大框与引线 */}
      <mesh position={[22.7, 0.05, -1.6]}>
        <boxGeometry args={[19.2, 0.1, 10.4]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.85} />
      </mesh>
      {CORE.map((b) => (
        <BlockMesh key={b.id} b={b} />
      ))}
      <Html position={[22.7, 0.6, -7.6]} center distanceFactor={22} style={{ pointerEvents: 'none' }}>
        <div className="chip-title">性能核 P0 放大 · 教学五级流水线（真实核心为宽发射乱序执行，细节未公开）</div>
      </Html>
      <Html position={[0, 0.6, -13.2]} center distanceFactor={22} style={{ pointerEvents: 'none' }}>
        <div className="chip-title warn">教学抽象：模块数量依据官方规格，位置与面积为示意，不是 M1 Pro 真实版图</div>
      </Html>
      <Packets resolve={(n, out) => chipResolve(n, out)} lift={2} />
    </group>
  );
}
