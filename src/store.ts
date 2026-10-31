import { create } from 'zustand';
import type { DisplayContent, FlowStep, Packet, PacketKind } from './sim/flows/types';
import { SCENARIOS } from './sim/flows/scenarios';
import { MAX_STAGE } from './data/parts';

export type Mode = 'teardown' | 'dataflow' | 'chip' | 'lab';
export type LabTab = 'cpu' | 'memory' | 'ssd' | 'gpu' | 'sched';

export interface LogEntry {
  id: number;
  time: string;
  src: string;
  msg: string;
  kind: PacketKind | 'info' | 'warn' | 'error';
}

interface State {
  mode: Mode;
  labTab: LabTab;
  // 视图
  explode: number; // 0..1 目标值（三维中平滑插值）
  xray: boolean;
  section: { on: boolean; axis: 'x' | 'z'; pos: number };
  flipped: boolean;
  lidAngle: number;
  autoRotate: boolean;
  selected: string | null;
  focusTick: number;
  // 数据流
  scenarioId: string | null;
  scenarioOpts: Record<string, boolean>;
  steps: FlowStep[];
  stepIdx: number;
  playing: boolean;
  speed: number;
  selectedPacket: Packet | null;
  livePackets: Packet[]; // 实验产生的数据包（短暂显示）
  liveHighlights: string[];
  screen: DisplayContent;
  // 日志与修订号
  log: LogEntry[];
  rev: number;
  simTimeMs: number;
  labRunning: boolean;
  cpuRunning: boolean;
  histIdx: number | null; // 实验回放：null = 实时

  setMode: (m: Mode) => void;
  setLabTab: (t: LabTab) => void;
  set: (p: Partial<State>) => void;
  setExplodeStage: (stage: number) => void;
  select: (id: string | null, focus?: boolean) => void;
  loadScenario: (id: string, opts?: Record<string, boolean>) => void;
  gotoStep: (i: number) => void;
  addLog: (src: string, msg: string, kind?: LogEntry['kind']) => void;
  emitPackets: (packets: Packet[], highlights?: string[]) => void;
  bump: () => void;
}

let logId = 0;
const clock = () => {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
};

export const useLab = create<State>((set, get) => ({
  mode: 'teardown',
  labTab: 'cpu',
  explode: 0,
  xray: false,
  section: { on: false, axis: 'x', pos: 0 },
  flipped: false,
  lidAngle: 112,
  autoRotate: false,
  selected: null,
  focusTick: 0,
  scenarioId: null,
  scenarioOpts: {},
  steps: [],
  stepIdx: 0,
  playing: false,
  speed: 1,
  selectedPacket: null,
  livePackets: [],
  liveHighlights: [],
  screen: { mode: 'text', lines: ['MacBook Pro 3D Lab', '', '选择左侧场景或实验'] },
  log: [],
  rev: 0,
  simTimeMs: 0,
  labRunning: false,
  cpuRunning: false,
  histIdx: null,

  setMode: (mode) => {
    const p: Partial<State> = { mode, playing: false, selectedPacket: null, livePackets: [], liveHighlights: [], cpuRunning: false, selected: null };
    if (mode === 'teardown') Object.assign(p, { xray: false });
    if (mode === 'dataflow' || mode === 'lab') Object.assign(p, { xray: true, flipped: false, explode: 0, lidAngle: 112 });
    set(p);
    get().addLog('界面', `切换到${{ teardown: '模式 A · 真实硬件拆解', dataflow: '模式 B · 数据流动', chip: '模式 C · 芯片内部', lab: '计算机实验' }[mode]}`);
  },
  setLabTab: (labTab) =>
    set({ labTab, livePackets: [], liveHighlights: [], cpuRunning: false, labRunning: false, histIdx: null, selected: null, screen: { mode: 'text', lines: [{ cpu: 'CPU 指令实验', memory: '内存 / 虚拟内存实验', ssd: 'SSD 与文件实验', gpu: 'GPU 渲染实验', sched: '多任务与散热实验' }[labTab], '', '等待操作…'] } }),
  set: (p) => set(p),
  setExplodeStage: (stage) => set({ explode: stage / MAX_STAGE }),
  select: (id, focus = true) => set((s) => ({ selected: id, focusTick: focus && id ? s.focusTick + 1 : s.focusTick })),
  loadScenario: (id, opts) => {
    const sc = SCENARIOS.find((s) => s.id === id)!;
    const o = opts ?? get().scenarioOpts;
    const steps = sc.build(o);
    set({ scenarioId: id, scenarioOpts: o, steps, stepIdx: 0, playing: false, selectedPacket: null });
    get().addLog('场景', `载入“${sc.title}”，共 ${steps.length} 步`);
    get().gotoStep(0);
  },
  gotoStep: (i) => {
    const { steps } = get();
    if (!steps.length) return;
    const idx = Math.max(0, Math.min(steps.length - 1, i));
    const st = steps[idx];
    const simTimeMs = steps.slice(0, idx + 1).reduce((a, s) => a + s.durationUs, 0) / 1000;
    const p: Partial<State> = { stepIdx: idx, selectedPacket: null, simTimeMs };
    if (st.display) p.screen = st.display;
    set(p);
    get().addLog(`步骤 ${idx + 1}`, st.log ? `${st.title} — ${st.log}` : st.title, st.failed ? 'error' : st.packets[0]?.kind ?? 'info');
  },
  addLog: (src, msg, kind = 'info') =>
    set((s) => ({ log: [...s.log.slice(-299), { id: ++logId, time: clock(), src, msg, kind }] })),
  emitPackets: (packets, highlights = []) => set({ livePackets: packets, liveHighlights: highlights }),
  bump: () => set((s) => ({ rev: s.rev + 1 })),
}));
