import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { PACKET_STYLE, fmtBytes, type NodeId, type Packet } from '../sim/flows/types';
import { useLab } from '../store';

export type Resolver = (n: NodeId, out: THREE.Vector3) => boolean;

/** 当前应显示的数据包：数据流模式取当前步骤，实验模式取实验刚产生的包 */
export function useActivePackets(): Packet[] {
  const mode = useLab((s) => s.mode);
  const step = useLab((s) => s.steps[s.stepIdx]);
  const live = useLab((s) => s.livePackets);
  if (mode === 'dataflow') return step?.packets ?? [];
  return live;
}

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();

function PacketMover({ p, index, total, resolve, lift }: { p: Packet; index: number; total: number; resolve: Resolver; lift: number }) {
  const ball = useRef<THREE.Mesh>(null!);
  const selected = useLab((s) => s.selectedPacket?.id === p.id);
  const color = PACKET_STYLE[p.kind].color;
  const pts = useMemo(() => new Float32Array(33 * 3), []);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    return g;
  }, [pts]);
  const lineMat = useMemo(() => new THREE.LineDashedMaterial({ color, dashSize: 0.4, gapSize: 0.25, transparent: true, opacity: 0.75, depthTest: false }), [color]);
  const lineObj = useMemo(() => new THREE.Line(geom, lineMat), [geom, lineMat]);
  const size = 0.3 + Math.min(0.35, Math.log10(Math.max(1, p.bytes)) * 0.05);
  useFrame(({ clock }) => {
    if (!resolve(p.from, a) || !resolve(p.to, b)) {
      ball.current.visible = false;
      return;
    }
    ball.current.visible = true;
    const speed = useLab.getState().speed;
    const self = p.from === p.to;
    // 控制点抬高，路径成弧线
    c.copy(a).add(b).multiplyScalar(0.5);
    c.y += self ? lift * 0.6 : Math.max(lift, a.distanceTo(b) * 0.35);
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      const x = (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x;
      const y = (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y;
      const z = (1 - t) ** 2 * a.z + 2 * (1 - t) * t * c.z + t * t * b.z;
      pts.set(self ? [a.x + Math.cos(t * Math.PI * 2) * 0.8, a.y + lift * 0.3, a.z + Math.sin(t * Math.PI * 2) * 0.8] : [x, y, z], i * 3);
    }
    geom.attributes.position.needsUpdate = true;
    lineObj.computeLineDistances();
    const period = 2.2 / speed;
    const t = (((clock.elapsedTime + (index / Math.max(1, total)) * period) % period) / period);
    const k = Math.min(32, Math.floor(t * 32));
    const f = t * 32 - k;
    ball.current.position.set(
      pts[k * 3] + (pts[Math.min(32, k + 1) * 3] - pts[k * 3]) * f,
      pts[k * 3 + 1] + (pts[Math.min(32, k + 1) * 3 + 1] - pts[k * 3 + 1]) * f,
      pts[k * 3 + 2] + (pts[Math.min(32, k + 1) * 3 + 2] - pts[k * 3 + 2]) * f,
    );
    ball.current.scale.setScalar(selected ? 1.6 : 1);
  });
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    useLab.getState().set({ selectedPacket: p });
  };
  return (
    <group>
      <primitive object={lineObj} />
      <mesh ref={ball} onClick={onClick} renderOrder={10} onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
        <sphereGeometry args={[size, 20, 20]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} toneMapped={false} />
        {/* 放大的不可见拾取球，便于点击移动中的数据包 */}
        <mesh onClick={onClick}>
          <sphereGeometry args={[size * 3, 8, 8]} />
          <meshBasicMaterial visible={false} />
        </mesh>
        {selected && (
          <Html center distanceFactor={40} style={{ pointerEvents: 'none' }}>
            <div className="pkt-tag" style={{ borderColor: color }}>
              {p.op} · {fmtBytes(p.bytes)}
            </div>
          </Html>
        )}
      </mesh>
    </group>
  );
}

export function Packets({ resolve, lift = 2.5 }: { resolve: Resolver; lift?: number }) {
  const packets = useActivePackets();
  return (
    <group>
      {packets.map((p, i) => (
        <PacketMover key={p.id} p={p} index={i} total={packets.length} resolve={resolve} lift={lift} />
      ))}
    </group>
  );
}
