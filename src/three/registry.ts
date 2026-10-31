import * as THREE from 'three';
import type { NodeId } from '../sim/flows/types';

// 部件/芯片 id → 三维对象。数据包的起止点直接读取这些对象的世界坐标，
// 因此无论机身翻转、爆炸拆解还是主板翻面，数据流路径都与模型保持一致。
export const anchors = new Map<string, THREE.Object3D>();

export const register = (id: string) => (o: THREE.Object3D | null) => {
  if (o) anchors.set(id, o);
  else anchors.delete(id);
};

// 数据流端点 → 部件 id + 在该部件上的局部偏移（cm）
export const NODE_ANCHOR: Record<NodeId, { id: string; offset?: [number, number, number] }> = {
  magsafe: { id: 'port-l' },
  battery: { id: 'battery-c1' },
  charger: { id: 'charger' },
  pmu: { id: 'pmu-1' },
  powerkey: { id: 'touchid' },
  bootrom: { id: 'soc', offset: [0.6, 0.1, 0.9] },
  sep: { id: 'soc', offset: [1.0, 0.1, 0.9] },
  nor: { id: 'nor' },
  cpu: { id: 'soc', offset: [-0.5, 0.1, -0.6] },
  ecore: { id: 'soc', offset: [0.4, 0.1, -0.8] },
  l2: { id: 'soc', offset: [-0.2, 0.1, -0.3] },
  slc: { id: 'soc', offset: [0, 0.1, 0] },
  memctl: { id: 'soc', offset: [-0.8, 0.1, 0.2] },
  gpu: { id: 'soc', offset: [0.3, 0.1, 0.5] },
  dispeng: { id: 'soc', offset: [0.8, 0.1, -0.2] },
  ssdctl: { id: 'soc', offset: [-0.9, 0.1, 0.8] },
  dram: { id: 'dram-a' },
  nand: { id: 'nand-1' },
  display: { id: 'screen' },
  heatsink: { id: 'heatsink' },
  fan: { id: 'fan-l' },
  trackpad: { id: 'trackpad' },
  keyboard: { id: 'keyboard' },
  l1i: { id: 'soc', offset: [-0.7, 0.1, -0.7] },
  fetch: { id: 'soc', offset: [-0.6, 0.1, -0.7] },
  decode: { id: 'soc', offset: [-0.5, 0.1, -0.7] },
  regs: { id: 'soc', offset: [-0.4, 0.1, -0.6] },
  alu: { id: 'soc', offset: [-0.4, 0.1, -0.5] },
  lsu: { id: 'soc', offset: [-0.5, 0.1, -0.5] },
  l1d: { id: 'soc', offset: [-0.6, 0.1, -0.5] },
  mmu: { id: 'soc', offset: [-0.7, 0.1, -0.5] },
  commit: { id: 'soc', offset: [-0.5, 0.1, -0.6] },
};

const tmp = new THREE.Vector3();
export function nodeWorld(node: NodeId, out: THREE.Vector3): boolean {
  const a = NODE_ANCHOR[node];
  const o = anchors.get(a.id);
  if (!o) return false;
  tmp.set(...(a.offset ?? [0, 0, 0]));
  out.copy(tmp);
  o.localToWorld(out);
  return true;
}
