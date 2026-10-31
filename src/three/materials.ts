import * as THREE from 'three';
import type { MatKey } from '../data/parts';

const spec: Record<MatKey, THREE.MeshPhysicalMaterialParameters> = {
  alu: { color: '#c9ccd1', metalness: 1, roughness: 0.32, clearcoat: 0.15 },
  aluInner: { color: '#a9adb3', metalness: 0.9, roughness: 0.45 },
  glass: { color: '#d6d8dc', metalness: 0.2, roughness: 0.18, clearcoat: 1 },
  pcb: { color: '#1f3b2c', metalness: 0.1, roughness: 0.6 },
  chip: { color: '#22252a', metalness: 0.2, roughness: 0.55 },
  soc: { color: '#8f9399', metalness: 0.95, roughness: 0.28 },
  dram: { color: '#17181b', metalness: 0.3, roughness: 0.4 },
  nand: { color: '#26282c', metalness: 0.3, roughness: 0.5 },
  copper: { color: '#c77d4e', metalness: 1, roughness: 0.3 },
  fins: { color: '#b9bdc2', metalness: 0.9, roughness: 0.35 },
  battery: { color: '#2b2f36', metalness: 0.4, roughness: 0.55 },
  black: { color: '#121316', metalness: 0.2, roughness: 0.55 },
  rubber: { color: '#0b0b0c', metalness: 0, roughness: 0.9 },
  screw: { color: '#d8dade', metalness: 1, roughness: 0.25 },
  flex: { color: '#c98a1d', metalness: 0.2, roughness: 0.5 },
  port: { color: '#6d7077', metalness: 0.9, roughness: 0.35 },
  speaker: { color: '#2a2c30', metalness: 0.3, roughness: 0.65 },
  shield: { color: '#b4b7bc', metalness: 1, roughness: 0.38 },
};

const cache = new Map<string, THREE.MeshPhysicalMaterial>();

/** 取共享材质。ghost=true 为透视模式下的半透明版本 */
export function mat(key: MatKey, ghost = false): THREE.MeshPhysicalMaterial {
  const id = `${key}${ghost ? ':g' : ''}`;
  let m = cache.get(id);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ ...spec[key], side: THREE.DoubleSide });
    if (ghost) {
      m.transparent = true;
      m.opacity = 0.12;
      m.depthWrite = false;
    }
    cache.set(id, m);
  }
  return m;
}

export const sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

/** 高亮用材质（选中/数据流经过时） */
const glowCache = new Map<string, THREE.MeshPhysicalMaterial>();
export function glowMat(key: MatKey, color: string) {
  const id = `${key}|${color}`;
  let m = glowCache.get(id);
  if (!m) {
    m = mat(key).clone();
    m.emissive = new THREE.Color(color);
    m.emissiveIntensity = 0.9;
    glowCache.set(id, m);
  }
  return m;
}
