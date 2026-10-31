import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CameraControls, ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { useLab } from '../store';
import { MacBook } from './MacBook';
import { ChipScene } from './ChipScene';
import { Packets } from './Packets';
import { anchors, nodeWorld } from './registry';
import { sectionPlane } from './materials';

function Section() {
  const { gl } = useThree();
  const section = useLab((s) => s.section);
  useEffect(() => {
    gl.localClippingEnabled = true;
    if (section.on) {
      sectionPlane.normal.set(section.axis === 'x' ? -1 : 0, 0, section.axis === 'z' ? -1 : 0);
      sectionPlane.constant = section.pos;
      gl.clippingPlanes = [sectionPlane];
    } else gl.clippingPlanes = [];
  }, [gl, section]);
  if (!section.on) return null;
  return (
    <mesh position={section.axis === 'x' ? [section.pos, 2, 0] : [0, 2, section.pos]} rotation={section.axis === 'x' ? [0, Math.PI / 2, 0] : [0, 0, 0]}>
      <planeGeometry args={[30, 16]} />
      <meshBasicMaterial color="#38bdf8" transparent opacity={0.06} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function Controls({ chip }: { chip: boolean }) {
  const ref = useRef<CameraControls>(null!);
  const focusTick = useLab((s) => s.focusTick);
  const autoRotate = useLab((s) => s.autoRotate);
  const mode = useLab((s) => s.mode);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    if (chip) c.setLookAt(2, 48, 40, 2, 0, -1, true);
    else c.setLookAt(30, 26, 40, 0, 2, 0, true);
  }, [chip, mode]);
  useEffect(() => {
    if (!focusTick || chip) return;
    const id = useLab.getState().selected;
    const o = id ? anchors.get(id) : undefined;
    if (!o) return;
    const box = new THREE.Box3().setFromObject(o);
    if (box.isEmpty()) return;
    // 保持当前水平方位，以 50° 俯角看向部件，距离按包围球半径决定
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const az = ref.current.azimuthAngle;
    const el = THREE.MathUtils.degToRad(50);
    const d = Math.max(7, sphere.radius * 3.2);
    const c = sphere.center;
    ref.current.setLookAt(c.x + d * Math.cos(el) * Math.sin(az), c.y + d * Math.sin(el), c.z + d * Math.cos(el) * Math.cos(az), c.x, c.y, c.z, true);
  }, [focusTick, chip]);
  useFrame((_, dt) => {
    if (autoRotate && ref.current) ref.current.azimuthAngle += dt * 0.15;
  });
  return <CameraControls ref={ref} makeDefault minDistance={4} maxDistance={140} dollySpeed={0.6} />;
}

export function Stage() {
  const mode = useLab((s) => s.mode);
  const labTab = useLab((s) => s.labTab);
  const chip = mode === 'chip' || (mode === 'lab' && labTab === 'cpu');
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [30, 26, 40], fov: 35, near: 0.1, far: 500 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => gl.setClearColor('#0c0e13')}
    >
      <color attach="background" args={['#0c0e13']} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[20, 40, 25]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-25, 15, -20]} intensity={0.5} color="#9fb4ff" />
      <Environment resolution={256}>
        <Lightformer form="rect" intensity={3} position={[0, 20, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[40, 40, 1]} />
        <Lightformer form="rect" intensity={1.5} position={[-30, 5, 10]} rotation={[0, Math.PI / 2, 0]} scale={[30, 8, 1]} color="#cfe0ff" />
        <Lightformer form="rect" intensity={1.2} position={[30, 8, -10]} rotation={[0, -Math.PI / 2, 0]} scale={[30, 8, 1]} />
        <Lightformer form="ring" intensity={1} position={[0, 4, 30]} scale={10} color="#ffffff" />
      </Environment>
      {chip ? (
        <ChipScene />
      ) : (
        <>
          <MacBook />
          <Packets resolve={nodeWorld} />
          <ContactShadows position={[0, -0.12, 0]} opacity={0.5} scale={70} blur={2.4} far={30} />
        </>
      )}
      <Section />
      <Controls chip={chip} />
    </Canvas>
  );
}
