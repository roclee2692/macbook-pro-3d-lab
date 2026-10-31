// 实验用模拟实例（单例）。界面通过 store.rev 订阅变化；三维场景直接读取这里的状态（风扇转速、温度、帧缓冲）。

import { Machine } from './cpu/machine';
import { EXAMPLES } from './cpu/programs';
import { DEFAULT_CACHE, type CacheConfig } from './cpu/cache';
import { VirtualMemory, DEFAULT_VM, type VmConfig, type VmState } from './memory/vm';
import { Ssd, DEFAULT_SSD, type SsdConfig, type ReadResult } from './storage/ssd';
import { DEFAULT_GPU, startRun, type GpuConfig, type GpuRun } from './gpu/gpu';
import { newSched, type SchedState } from './sched/sched';

export const lab = {
  cpuSource: EXAMPLES[0].source,
  cacheCfg: DEFAULT_CACHE.map((c) => ({ ...c })) as CacheConfig[],
  cpu: new Machine(DEFAULT_CACHE),
  vmCfg: { ...DEFAULT_VM } as VmConfig,
  vm: new VirtualMemory(DEFAULT_VM),
  vmHistory: [] as VmState[],
  ssdCfg: { ...DEFAULT_SSD } as SsdConfig,
  ssd: new Ssd(DEFAULT_SSD),
  ssdResults: [] as ReadResult[],
  gpuCfg: { ...DEFAULT_GPU } as GpuConfig,
  gpu: startRun(DEFAULT_GPU) as GpuRun,
  sched: newSched(),
  schedHistory: [] as SchedState[],
};

lab.cpu.load(lab.cpuSource);
