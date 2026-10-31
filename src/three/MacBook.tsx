import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BOARD, CHIPS, MAX_STAGE, PARTS, type MatKey, type PartDef, type Vec3 } from '../data/parts';
import { DIM } from '../data/specs';
import { useLab } from '../store';
import { glowMat, mat } from './materials';
import { register } from './registry';
import { ring, slab, smooth } from './geom';
import { drawScreen, screenTexture } from './screen';
import { lab } from '../sim/lab';

// ---------- 动画共享状态（帧循环中插值，避免每帧触发 React 渲染） ----------
export const anim = { explode: 0, flip: 0, lid: 112 };
export const stageP = (stage: number) => (stage <= 0 ? 0 : smooth(anim.explode * MAX_STAGE - (stage - 1)));

const GHOST_CATS = new Set(['shell', 'display', 'input']);
const SEL_COLOR = '#3b82f6';
const FLOW_COLOR = '#22d3ee';

function useLook(id: string, key: MatKey, category?: string) {
  const selected = useLab((s) => s.selected === id);
  const flow = useLab((s) => {
    if (s.mode === 'dataflow') return !!s.steps[s.stepIdx]?.highlights.includes(id);
    if (s.mode === 'lab') return s.liveHighlights.includes(id);
    return false;
  });
  const ghost = useLab((s) => s.xray && !!category && GHOST_CATS.has(category));
  if (selected) return glowMat(key, SEL_COLOR);
  if (flow) return glowMat(key, FLOW_COLOR);
  return mat(key, ghost);
}

function clickSelect(id: string) {
  return {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      useLab.getState().select(id);
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      document.body.style.cursor = '';
    },
  };
}

/** 部件外层：负责位置、拆解位移与注册锚点 */
function PartGroup({ part, children, extra }: { part: PartDef; children: ReactNode; extra?: (g: THREE.Group) => void }) {
  const ref = useRef<THREE.Group>(null!);
  useFrame(() => {
    const p = stageP(part.stage);
    ref.current.position.set(part.pos[0] + part.explode[0] * p, part.pos[1] + part.explode[1] * p, part.pos[2] + part.explode[2] * p);
    extra?.(ref.current);
  });
  return (
    <group ref={(g) => { ref.current = g!; register(part.id)(g); }} {...clickSelect(part.id)}>
      {children}
    </group>
  );
}

// ---------- 机身外壳 ----------
function TopCase({ part }: { part: PartDef }) {
  const m = useLook(part.id, 'alu', part.category);
  const inner = useLook(part.id, 'aluInner', part.category);
  const walls = useMemo(() => ring(DIM.width, DIM.depth, 1.05, 0.22, 0.74), []);
  const deck = useMemo(
    () =>
      slab(DIM.width, DIM.depth, 1.05, 0.14, [
        { cx: 0, cz: -4.15, w: 27.7, d: 11.2, r: 0.4 },
        { cx: 0, cz: 6.0, w: 15.3, d: 8.9, r: 0.35 },
      ], 0.03),
    [],
  );
  const grille = mat('black');
  return (
    <group position={[0, -0.56, 0]}>
      <mesh geometry={walls} material={m} position={[0, 0.12, 0]} />
      <mesh geometry={deck} material={m} position={[0, 0.86, 0]} />
      {/* 键盘槽底板 */}
      <mesh material={inner} position={[0, 0.9, -4.15]}>
        <boxGeometry args={[27.6, 0.04, 11.1]} />
      </mesh>
      {/* 扬声器格栅（键盘两侧） */}
      {[-1, 1].map((s) => (
        <mesh key={s} material={grille} position={[s * 14.45, 1.005, -4.3]}>
          <boxGeometry args={[0.55, 0.01, 10.4]} />
        </mesh>
      ))}
      {/* 后缘转轴舱 */}
      <mesh material={m} position={[0, 0.62, -10.75]}>
        <boxGeometry args={[24, 0.75, 0.55]} />
      </mesh>
    </group>
  );
}

function LowerCase({ part }: { part: PartDef }) {
  const m = useLook(part.id, 'alu', part.category);
  const plate = useMemo(() => slab(DIM.width, DIM.depth, 1.05, 0.12, [], 0.04), []);
  const feet: Vec3[] = [[-13.6, 0, -9.4], [13.6, 0, -9.4], [-13.6, 0, 9.4], [13.6, 0, 9.4]];
  return (
    <group position={[0, -0.06, 0]}>
      <mesh geometry={plate} material={m} />
      {feet.map((f, i) => (
        <mesh key={i} position={[f[0], -0.03, f[2]]} material={mat('rubber')}>
          <cylinderGeometry args={[0.8, 0.8, 0.06, 32]} />
        </mesh>
      ))}
      {/* 底壳内侧的进风格栅示意（两侧风扇下方） */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 10.9, 0.125, -6.9]} material={mat('black', true)}>
          <cylinderGeometry args={[2.5, 2.5, 0.01, 32]} />
        </mesh>
      ))}
    </group>
  );
}

const SCREW_POS: { p: [number, number]; long: boolean }[] = [
  { p: [-14.4, -10.0], long: true }, { p: [-5.2, -10.3], long: true }, { p: [5.2, -10.3], long: true }, { p: [14.4, -10.0], long: true },
  { p: [-14.4, 9.9], long: false }, { p: [-4.6, 10.4], long: false }, { p: [4.6, 10.4], long: false }, { p: [14.4, 9.9], long: false },
];

function Screws({ part }: { part: PartDef }) {
  const m = useLook(part.id, 'screw');
  return (
    <group>
      {SCREW_POS.map((s, i) => (
        <group key={i} position={[s.p[0], 0, s.p[1]]}>
          <mesh material={m}>
            <cylinderGeometry args={[0.2, 0.2, 0.06, 5]} />
          </mesh>
          <mesh material={m} position={[0, (s.long ? 0.93 : 0.5) / 2, 0]}>
            <cylinderGeometry args={[0.08, 0.08, s.long ? 0.93 : 0.5, 10]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------- 键盘 ----------
const ROWS: number[][] = [
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.75],
  [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25],
  [1, 1, 1, 1.25, 5, 1.25, 1, 1, -1, 1], // -1：上下方向键（半高叠放）
];

function Keyboard({ part }: { part: PartDef }) {
  const m = useLook(part.id, 'black', part.category);
  const touch = useLook('touchid', 'aluInner');
  const { keys, count } = useMemo(() => {
    const W = 27.4;
    const D = 10.9;
    const u = W / 14.5;
    const pitch = D / 6;
    const keys: { x: number; z: number; w: number; d: number; touch?: boolean }[] = [];
    ROWS.forEach((row, ri) => {
      let x = -W / 2;
      const z = -D / 2 + pitch * (ri + 0.5);
      row.forEach((k, ki) => {
        if (k === -1) {
          keys.push({ x: x + u / 2, z: z - pitch / 4, w: u - 0.22, d: pitch / 2 - 0.16 });
          keys.push({ x: x + u / 2, z: z + pitch / 4, w: u - 0.22, d: pitch / 2 - 0.16 });
          x += u;
          return;
        }
        const w = k * u;
        const half = ri === 5 && (ki === 7 || ki === 9);
        keys.push({ x: x + w / 2, z: half ? z + pitch / 4 : z, w: w - 0.22, d: (half ? pitch / 2 : pitch) - 0.22, touch: ri === 0 && ki === 13 });
        x += w;
      });
    });
    return { keys, count: keys.filter((k) => !k.touch).length };
  }, []);
  const ref = useRef<THREE.InstancedMesh>(null!);
  const geo = useMemo(() => new RoundedBoxGeometry(1, 0.12, 1, 2, 0.05), []);
  useEffect(() => {
    const o = new THREE.Object3D();
    let i = 0;
    for (const k of keys) {
      if (k.touch) continue;
      o.position.set(k.x, 0, k.z);
      o.scale.set(k.w, 1, k.d);
      o.updateMatrix();
      ref.current.setMatrixAt(i++, o.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  }, [keys]);
  const tk = keys.find((k) => k.touch)!;
  return (
    <group>
      <instancedMesh ref={ref} args={[geo, m, count]} />
      <group position={[tk.x, 0, tk.z]} ref={register('touchid')}>
        <mesh material={touch} scale={[tk.w, 1, tk.d]} geometry={geo} />
      </group>
    </group>
  );
}

// ---------- 显示屏 ----------
function Lid({ part }: { part: PartDef }) {
  const m = useLook(part.id, 'alu', part.category);
  const pivot = useRef<THREE.Group>(null!);
  const screen = useLab((s) => s.screen);
  useEffect(() => drawScreen(screen), [screen]);
  const shell = useMemo(() => slab(DIM.width, 21.6, 1.0, 0.42, [], 0.05), []);
  const screenW = 30.25;
  const screenH = 19.65;
  useFrame(() => {
    const p = stageP(part.stage);
    pivot.current.rotation.x = -THREE.MathUtils.degToRad(anim.lid);
    pivot.current.position.set(part.explode[0] * p, 1.0 + part.explode[1] * p, -10.66 + part.explode[2] * p);
  });
  return (
    <group ref={(g) => { pivot.current = g!; register('lid')(g); }} {...clickSelect('lid')}>
      <mesh geometry={shell} material={m} position={[0, 0.06, 10.8]} />
      {/* 黑色边框 + 屏幕 */}
      <mesh position={[0, 0.03, 10.8]} rotation={[Math.PI / 2, 0, 0]} material={mat('black')}>
        <planeGeometry args={[DIM.width - 0.5, 21.2]} />
      </mesh>
      <mesh position={[0, 0.025, 1.6 + screenH / 2]} rotation={[Math.PI / 2, 0, 0]} ref={register('screen')}>
        <planeGeometry args={[screenW, screenH]} />
        <meshBasicMaterial map={screenTexture} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* 转轴 */}
      <mesh position={[0, 0.2, 0.15]} rotation={[0, 0, Math.PI / 2]} material={mat('black')}>
        <cylinderGeometry args={[0.28, 0.28, 24, 24]} />
      </mesh>
    </group>
  );
}

// ---------- 主板 ----------
function Chip({ id, size, mat: mk, y }: { id: string; size: Vec3; mat: MatKey; y: number }) {
  const m = useLook(id, mk);
  return (
    <group ref={register(id)} position={[0, y, 0]} {...clickSelect(id)}>
      <mesh material={m}>
        <boxGeometry args={size} />
      </mesh>
    </group>
  );
}

function SocPackage() {
  const sub = useLook('soc', 'pcb');
  const die = useLook('soc', 'soc');
  const c = CHIPS.find((x) => x.id === 'soc')!;
  return (
    <group ref={register('soc')} position={[c.pos[0], BOARD.thickness / 2 + 0.03, c.pos[1]]} {...clickSelect('soc')}>
      <mesh material={sub}>
        <boxGeometry args={[c.size[0], 0.06, c.size[2]]} />
      </mesh>
      <mesh material={die} position={[0, 0.07, 0]}>
        <boxGeometry args={[1.75, 0.08, 1.4]} />
      </mesh>
      {/* 封装上的小电容阵列 */}
      {Array.from({ length: 10 }).map((_, i) => (
        <mesh key={i} material={mat('chip')} position={[-1.5 + i * 0.33, 0.05, 1.3]}>
          <boxGeometry args={[0.18, 0.04, 0.1]} />
        </mesh>
      ))}
    </group>
  );
}

function LogicBoard({ part }: { part: PartDef }) {
  const m = useLook(part.id, 'pcb');
  const board = useMemo(() => {
    const g = slab(BOARD.main.w, BOARD.main.d, 0.4, BOARD.thickness, [{ cx: -7.2, cz: -3.1, w: 1.4, d: 1.4, r: 0.6 }]);
    g.translate(0, -BOARD.thickness / 2, 0);
    return g;
  }, []);
  const flipRef = useRef<THREE.Group>(null!);
  useFrame(() => {
    flipRef.current.rotation.x = Math.PI * stageP(5);
  });
  const connectors: [number, number, number][] = [
    [-7.4, -2.4, 0.9], [-7.4, 0.2, 0.9], [-7.4, 2.2, 0.9], [7.4, -2.6, 0.9], [7.4, 0.6, 0.9], [7.4, 2.8, 0.9],
    [-3.0, 3.6, 1.4], [0.6, 3.6, 1.6], [3.8, 3.6, 1.2], [-2.0, -3.6, 1.3], [2.2, -3.6, 1.3],
  ];
  return (
    <group ref={flipRef}>
      <mesh geometry={board} material={m} />
      {CHIPS.filter((c) => c.id !== 'soc').map((c) => (
        <group key={c.id} position={[c.pos[0], 0, c.pos[1]]}>
          <Chip id={c.id} size={c.size} mat={c.mat} y={(c.side === 1 ? 1 : -1) * (BOARD.thickness / 2 + c.size[1] / 2)} />
        </group>
      ))}
      <SocPackage />
      {connectors.map(([x, z, w], i) => (
        <mesh key={i} material={mat('chip')} position={[x, i % 2 ? -0.09 : 0.09, z]}>
          <boxGeometry args={[Math.abs(x) > 7 ? 0.5 : w, 0.1, Math.abs(x) > 7 ? w : 0.5]} />
        </mesh>
      ))}
      {/* 小型阻容元件点缀 */}
      {Array.from({ length: 60 }).map((_, i) => {
        const x = -6.8 + ((i * 37) % 136) / 10;
        const z = -3.4 + ((i * 53) % 68) / 10;
        if (Math.abs(x) < 2.6 && Math.abs(z) < 1.8) return null;
        return (
          <mesh key={`r${i}`} material={mat(i % 3 ? 'chip' : 'copper')} position={[x, (i % 2 ? 1 : -1) * 0.065, z]}>
            <boxGeometry args={[0.12, 0.05, 0.07]} />
          </mesh>
        );
      })}
    </group>
  );
}

// ---------- 散热 ----------
function temperatureColor() {
  const st = useLab.getState();
  const step = st.mode === 'dataflow' ? st.steps[st.stepIdx] : undefined;
  if (step?.visual?.type === 'cores') return { t: step.visual.temp, rpm: step.visual.rpm };
  return { t: lab.sched.temp, rpm: lab.sched.rpm };
}

function HeatSink({ part }: { part: PartDef }) {
  const m = useLook(part.id, 'copper');
  const fin = useLook(part.id, 'fins');
  const pipes = useMemo(
    () =>
      [-1, 1].map((s) => {
        const c = new THREE.CatmullRomCurve3([
          new THREE.Vector3(s * 0.9, 0, 0),
          new THREE.Vector3(s * 4.5, 0.02, -1.6),
          new THREE.Vector3(s * 8.2, -0.02, -3.6),
          new THREE.Vector3(s * 13.2, -0.05, -3.95),
        ]);
        return new THREE.TubeGeometry(c, 48, 0.2, 10);
      }),
    [],
  );
  const finRef = useRef<THREE.InstancedMesh>(null!);
  useEffect(() => {
    const o = new THREE.Object3D();
    let i = 0;
    for (const s of [-1, 1])
      for (let k = 0; k < 44; k++) {
        o.position.set(s * (8.3 + k * 0.12), -0.1, -3.95);
        o.updateMatrix();
        finRef.current.setMatrixAt(i++, o.matrix);
      }
    finRef.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <group>
      <mesh material={m}>
        <boxGeometry args={[4.6, 0.12, 3.6]} />
      </mesh>
      {pipes.map((g, i) => (
        <mesh key={i} geometry={g} material={m} scale={[1, 0.45, 1]} />
      ))}
      <instancedMesh ref={finRef} args={[new THREE.BoxGeometry(0.03, 0.5, 0.95), fin, 88]} />
      <HeatGlow />
    </group>
  );
}

/** 散热器温度可视化：叠加一层随温度变红的半透明体（与调度/散热模拟双向绑定） */
function HeatGlow() {
  const ref = useRef<THREE.Mesh>(null!);
  const m = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ff5a1f', transparent: true, opacity: 0, depthWrite: false }), []);
  useFrame(() => {
    const { t } = temperatureColor();
    m.opacity = Math.max(0, Math.min(0.55, (t - 50) / 80));
  });
  return (
    <mesh ref={ref} material={m} position={[0, 0.08, 0]}>
      <boxGeometry args={[4.8, 0.05, 3.8]} />
    </mesh>
  );
}

function Fan({ part }: { part: PartDef }) {
  const m = useLook(part.id, 'black');
  const blade = useLook(part.id, 'speaker');
  const housing = useMemo(() => ring(5.6, 5.6, 2.8, 0.15, 0.5), []);
  const rotor = useRef<THREE.Group>(null!);
  const bladeRef = useRef<THREE.InstancedMesh>(null!);
  useEffect(() => {
    const o = new THREE.Object3D();
    for (let i = 0; i < 31; i++) {
      const a = (i / 31) * Math.PI * 2;
      o.position.set(Math.cos(a) * 1.85, 0, Math.sin(a) * 1.85);
      o.rotation.set(0, -a + 0.5, 0);
      o.updateMatrix();
      bladeRef.current.setMatrixAt(i, o.matrix);
    }
    bladeRef.current.instanceMatrix.needsUpdate = true;
  }, []);
  useFrame((_, dt) => {
    // 真实转速 ÷ 20 显示（避免频闪混叠）
    const { rpm } = temperatureColor();
    rotor.current.rotation.y += ((rpm / 60) * Math.PI * 2 * dt) / 20;
  });
  return (
    <group>
      <mesh geometry={housing} material={m} position={[0, -0.25, 0]} />
      <mesh material={m} position={[0, 0.27, 0]}>
        <cylinderGeometry args={[2.8, 2.8, 0.03, 48, 1, false]} />
      </mesh>
      <group ref={rotor}>
        <mesh material={m}>
          <cylinderGeometry args={[1.0, 1.0, 0.42, 32]} />
        </mesh>
        <instancedMesh ref={bladeRef} args={[new THREE.BoxGeometry(1.5, 0.4, 0.05), blade, 31]} />
      </group>
      {/* 出风口导流（朝后缘鳍片） */}
      <mesh material={m} position={[0, 0, -2.9]}>
        <boxGeometry args={[5.0, 0.5, 0.6]} />
      </mesh>
    </group>
  );
}

// ---------- 其他部件 ----------
function Cell({ part }: { part: PartDef }) {
  const m = useLook(part.id, 'battery');
  const geo = useMemo(() => new RoundedBoxGeometry(part.size[0], part.size[1], part.size[2], 3, 0.12), [part]);
  return (
    <group>
      <mesh geometry={geo} material={m} />
      {/* 易拉胶拉片 */}
      <mesh material={mat('rubber')} position={[0, -part.size[1] / 2 - 0.01, part.size[2] / 2 + 0.4]}>
        <boxGeometry args={[1.2, 0.02, 0.9]} />
      </mesh>
    </group>
  );
}

function Ports({ part }: { part: PartDef }) {
  const m = useLook(part.id, 'port');
  const right = part.id === 'port-r';
  const sx = right ? 1 : -1;
  // 端口沿 z 的位置（绝对坐标）与外形
  const items = right
    ? [{ z: -5.6, kind: 'usbc' }, { z: -2.9, kind: 'hdmi' }, { z: 0.2, kind: 'sd' }]
    : [{ z: -6.6, kind: 'magsafe' }, { z: -4.4, kind: 'usbc' }, { z: -2.4, kind: 'usbc' }, { z: 0.6, kind: 'jack' }];
  const hole = mat('rubber');
  return (
    <group>
      <mesh material={m}>
        <boxGeometry args={[part.size[0], part.size[1], part.size[2]]} />
      </mesh>
      {items.map((it, i) => {
        const z = it.z - part.pos[2];
        const x = sx * (part.size[0] / 2 + 0.005);
        const dims: Record<string, [number, number]> = { usbc: [0.84, 0.26], hdmi: [1.4, 0.45], sd: [2.4, 0.22], magsafe: [1.6, 0.36], jack: [0.36, 0.36] };
        const [w, h] = dims[it.kind];
        return (
          <mesh key={i} material={hole} position={[x, 0, z]} rotation={[0, (sx * Math.PI) / 2, 0]}>
            {it.kind === 'jack' ? <circleGeometry args={[0.18, 24]} /> : <planeGeometry args={[w, h]} />}
          </mesh>
        );
      })}
    </group>
  );
}

function BoxPart({ part }: { part: PartDef }) {
  const m = useLook(part.id, part.mat, part.category);
  const geo = useMemo(() => new RoundedBoxGeometry(part.size[0], part.size[1], part.size[2], 2, Math.min(0.08, part.size[1] / 2.5)), [part]);
  return <mesh geometry={geo} material={m} />;
}

export function MacBook() {
  const root = useRef<THREE.Group>(null!);
  useFrame((_, dt) => {
    const s = useLab.getState();
    const k = 1 - Math.exp(-dt * 4);
    anim.explode += (s.explode - anim.explode) * k;
    anim.flip += ((s.flipped ? 1 : 0) - anim.flip) * k;
    anim.lid += (s.lidAngle - anim.lid) * k;
    root.current.rotation.z = Math.PI * smooth(anim.flip);
    root.current.position.y = DIM.height * smooth(anim.flip) * 0.7;
  });
  return (
    <group ref={root} onPointerMissed={() => useLab.getState().select(null, false)}>
      {PARTS.map((p) => {
        switch (p.shape) {
          case 'topcase':
            return <PartGroup key={p.id} part={p}><TopCase part={p} /></PartGroup>;
          case 'lowercase':
            return <PartGroup key={p.id} part={p}><LowerCase part={p} /></PartGroup>;
          case 'screws':
            return <PartGroup key={p.id} part={p}><Screws part={p} /></PartGroup>;
          case 'keyboard':
            return <PartGroup key={p.id} part={p}><Keyboard part={p} /></PartGroup>;
          case 'lid':
            return <Lid key={p.id} part={p} />;
          case 'logicboard':
            return <PartGroup key={p.id} part={p}><LogicBoard part={p} /></PartGroup>;
          case 'heatsink':
            return (
              <PartGroup
                key={p.id}
                part={p}
                extra={(g) => {
                  // 散热器先随主板一起取出（第 4 步），再在第 5 步与主板分离
                  const b = PARTS.find((x) => x.id === 'logicboard')!;
                  const pb = stageP(b.stage);
                  g.position.x += b.explode[0] * pb;
                  g.position.y += b.explode[1] * pb;
                  g.position.z += b.explode[2] * pb;
                }}
              >
                <HeatSink part={p} />
              </PartGroup>
            );
          case 'fan':
            return <PartGroup key={p.id} part={p}><Fan part={p} /></PartGroup>;
          case 'cell':
            return <PartGroup key={p.id} part={p}><Cell part={p} /></PartGroup>;
          case 'port':
            return <PartGroup key={p.id} part={p}><Ports part={p} /></PartGroup>;
          default:
            return <PartGroup key={p.id} part={p}><BoxPart part={p} /></PartGroup>;
        }
      })}
    </group>
  );
}
