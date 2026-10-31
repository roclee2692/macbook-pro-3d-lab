// 多任务调度 + 功耗/温度/风扇模型。
// 真实：M1 Pro 8 核版为 6 个性能核 + 2 个能效核（官方）；性能核分两簇（资料推导）。
// 调度策略参考 macOS 的 QoS 思路——后台（Background）任务只在能效核上跑，交互类优先性能核；
// 时间片 10 ms、功耗与热阻数值均为教学近似，用来展示因果关系，不是实测曲线。

import { rng } from '../rng';

export type QoS = 'UI' | 'IN' | 'UT' | 'BG';
export const QOS_CN: Record<QoS, string> = { UI: '用户交互', IN: '用户发起', UT: '实用工具', BG: '后台' };
const QOS_BASE: Record<QoS, number> = { UI: 47, IN: 37, UT: 20, BG: 4 };

export interface Thread {
  tid: number;
  name: string;
  qos: QoS;
  priority: number; // 基础优先级（实验参数，0–63）
  load: number; // 计算密集程度 0–1：每个时间片想要运行的概率
  work: number; // 剩余工作量（十亿条指令）
  done: number;
  state: 'ready' | 'running' | 'blocked' | 'finished';
  core: number | null;
  cpuMs: number;
  waitMs: number;
  usage: number; // 近期 CPU 使用（用于优先级衰减）
}

export interface Core {
  id: number;
  kind: 'P' | 'E';
  cluster: string;
  thread: number | null;
  util: number; // 最近一个时间片的占用 0/1
}

export interface ThermalConfig {
  ambient: number; // °C（实验参数）
  fanMode: 'auto' | 'manual' | 'failed';
  manualRpm: number;
  throttleAt: number; // °C
}

export interface SchedState {
  tick: number;
  timeMs: number;
  quantumMs: number;
  threads: Thread[];
  cores: Core[];
  nextTid: number;
  temp: number;
  rpm: number;
  power: { cpu: number; total: number };
  pFreq: number; // GHz
  eFreq: number;
  throttled: boolean;
  thermal: ThermalConfig;
  history: { t: number; temp: number; rpm: number; power: number; pFreq: number; ips: number }[];
  log: string[];
  seed: number;
}

export const P_MAX_GHZ = 3.228; // 资料推导
export const E_MAX_GHZ = 2.064; // 资料推导
const P_IPC = 1.0; // 每周期十亿条指令的相对值（教学）
const E_IPC = 0.55;
const FAN_MIN = 1200; // 教学近似
const FAN_MAX = 5800;

export function newSched(seed = 3): SchedState {
  const cores: Core[] = [];
  for (let i = 0; i < 6; i++) cores.push({ id: i, kind: 'P', cluster: i < 3 ? 'P0' : 'P1', thread: null, util: 0 });
  for (let i = 0; i < 2; i++) cores.push({ id: 6 + i, kind: 'E', cluster: 'E', thread: null, util: 0 });
  return {
    tick: 0,
    timeMs: 0,
    quantumMs: 10,
    threads: [],
    cores,
    nextTid: 1,
    temp: 38,
    rpm: 0,
    power: { cpu: 0, total: 0 },
    pFreq: P_MAX_GHZ,
    eFreq: E_MAX_GHZ,
    throttled: false,
    thermal: { ambient: 25, fanMode: 'auto', manualRpm: 3000, throttleAt: 99 },
    history: [],
    log: [],
    seed,
  };
}

export function addThread(s: SchedState, name: string, qos: QoS, load: number, work: number, priority?: number): Thread {
  const t: Thread = { tid: s.nextTid++, name, qos, priority: priority ?? QOS_BASE[qos], load, work, done: 0, state: 'ready', core: null, cpuMs: 0, waitMs: 0, usage: 0 };
  s.threads.push(t);
  s.log.push(`[${s.timeMs} ms] 新线程 #${t.tid} ${name}（QoS ${QOS_CN[qos]}，优先级 ${t.priority}）进入就绪队列`);
  return t;
}

/** 有效优先级：基础优先级 − 近期 CPU 使用造成的衰减（防止计算密集线程饿死其他线程） */
export const effPriority = (t: Thread) => t.priority - Math.floor(t.usage * 8);

export function readyQueue(s: SchedState) {
  return s.threads.filter((t) => t.state === 'ready').sort((a, b) => effPriority(b) - effPriority(a) || a.waitMs - b.waitMs);
}

function power(s: SchedState) {
  // 动态功耗 ∝ f·V²，V 随 f 近似线性 → ∝ f³（教学近似）。满频满载：P 核约 5 W，E 核约 0.5 W。
  let cpu = 0;
  for (const c of s.cores) {
    if (!c.util) {
      cpu += c.kind === 'P' ? 0.05 : 0.02; // 空闲漏电
      continue;
    }
    cpu += c.kind === 'P' ? 5.0 * (s.pFreq / P_MAX_GHZ) ** 3 : 0.5 * (s.eFreq / E_MAX_GHZ) ** 3;
  }
  return { cpu, total: cpu + 2.5 }; // + SoC 其余部分（内存、互连、显示）约 2.5 W
}

export function schedTick(s: SchedState) {
  const r = rng(s.seed + s.tick * 131);
  s.tick++;
  s.timeMs += s.quantumMs;

  // 1. 阻塞线程按负载概率被唤醒；运行中的线程按 (1-load) 概率主动让出（等待 I/O）
  for (const t of s.threads) {
    if (t.state === 'blocked' && r() < t.load + 0.1) t.state = 'ready';
    if (t.state === 'running' && r() > t.load) {
      t.state = 'blocked';
      t.core = null;
    }
    if (t.state === 'running') t.state = 'ready'; // 时间片到期，重新参与调度
    t.usage *= 0.8;
  }
  for (const c of s.cores) {
    c.thread = null;
    c.util = 0;
  }

  // 2. 调度：按有效优先级取线程，按 QoS 选核心类型
  const q = readyQueue(s);
  const freeP = s.cores.filter((c) => c.kind === 'P');
  const freeE = s.cores.filter((c) => c.kind === 'E');
  for (const t of q) {
    let core: Core | undefined;
    if (t.qos === 'BG') core = freeE.shift();
    else if (t.qos === 'UT') core = freeE.shift() ?? freeP.shift();
    else core = freeP.shift() ?? freeE.shift();
    if (!core) {
      t.waitMs += s.quantumMs;
      continue;
    }
    core.thread = t.tid;
    core.util = 1;
    t.state = 'running';
    t.core = core.id;
  }

  // 3. 执行：完成的工作量 = 频率 × IPC × 时间
  let ips = 0;
  for (const c of s.cores) {
    if (c.thread === null) continue;
    const t = s.threads.find((x) => x.tid === c.thread)!;
    const g = (c.kind === 'P' ? s.pFreq * P_IPC : s.eFreq * E_IPC) * (s.quantumMs / 1000);
    t.done += g;
    t.cpuMs += s.quantumMs;
    t.usage += 1;
    ips += g / (s.quantumMs / 1000);
    if (t.done >= t.work) {
      t.state = 'finished';
      t.core = null;
      c.thread = null;
      s.log.push(`[${s.timeMs} ms] 线程 #${t.tid} ${t.name} 完成（CPU 时间 ${t.cpuMs} ms，等待 ${t.waitMs} ms）`);
    }
  }

  // 4. 功耗 → 温度（一阶热模型：C·dT/dt = P − (T − T环境)/R，R 随风扇转速降低）
  s.power = power(s);
  const th = s.thermal;
  if (th.fanMode === 'failed') s.rpm = 0;
  else if (th.fanMode === 'manual') s.rpm = th.manualRpm;
  else {
    // 自动：60 °C 以下停转，之后按温差比例升速
    const target = s.temp < 60 ? 0 : Math.min(FAN_MAX, FAN_MIN + (s.temp - 60) * 160);
    s.rpm += (target - s.rpm) * 0.3;
    if (s.rpm < FAN_MIN * 0.5 && target === 0) s.rpm = 0;
  }
  const R = 1 / (0.22 + 0.55 * (s.rpm / FAN_MAX)); // °C/W
  const C = 18; // J/°C（整机等效热容，按时间压缩便于观察）
  const dt = s.quantumMs / 1000 * 8; // 时间加速 8 倍以便在演示中看到升温
  s.temp += ((s.power.total - (s.temp - th.ambient) / R) / C) * dt;

  // 5. 温度保护：超过阈值降频，回落后逐步恢复
  if (s.temp > th.throttleAt) {
    s.pFreq = Math.max(0.6, s.pFreq - 0.1);
    if (!s.throttled) s.log.push(`[${s.timeMs} ms] ⚠ 温度 ${s.temp.toFixed(1)} °C 超过 ${th.throttleAt} °C，性能核降频`);
    s.throttled = true;
  } else if (s.temp < th.throttleAt - 4 && s.pFreq < P_MAX_GHZ) {
    s.pFreq = Math.min(P_MAX_GHZ, s.pFreq + 0.05);
    if (s.pFreq >= P_MAX_GHZ) s.throttled = false;
  }

  s.history.push({ t: s.timeMs, temp: s.temp, rpm: s.rpm, power: s.power.total, pFreq: s.pFreq, ips });
  if (s.history.length > 240) s.history.shift();
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
}

export const PRESET_THREADS: { name: string; qos: QoS; load: number; work: number }[] = [
  { name: 'WindowServer', qos: 'UI', load: 0.35, work: 1e9 },
  { name: 'Safari 渲染', qos: 'UI', load: 0.5, work: 40 },
  { name: 'Xcode 编译 #1', qos: 'IN', load: 0.95, work: 60 },
  { name: 'Xcode 编译 #2', qos: 'IN', load: 0.95, work: 60 },
  { name: 'Spotlight 索引', qos: 'BG', load: 0.8, work: 30 },
  { name: 'Time Machine', qos: 'BG', load: 0.6, work: 25 },
  { name: '音乐解码', qos: 'UT', load: 0.2, work: 1e9 },
];
