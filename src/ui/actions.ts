// 实验操作：修改模拟状态 → 写事件日志 → 发出数据包/高亮 → 刷新界面。
// 所有面板与底部控制条都调用这里，保证图形、数值、日志三者一致。

import { useLab } from '../store';
import { lab } from '../sim/lab';
import { STAGE_CN, type Stage } from '../sim/cpu/machine';
import { stageFlow } from '../sim/cpu/flow';
import { Machine } from '../sim/cpu/machine';
import { VirtualMemory, PAGE_SIZE, PRESSURE_CN, type VmEvent } from '../sim/memory/vm';
import { Ssd } from '../sim/storage/ssd';
import { encode as gpuEncode, finish, rasterTile, startRun, tilingStage, vertexStage } from '../sim/gpu/gpu';
import { addThread, newSched, schedTick, QOS_CN, type QoS } from '../sim/sched/sched';
import { fmtBytes, fmtUs, pk, type Packet } from '../sim/flows/types';

const st = () => useLab.getState();
const log = (src: string, msg: string, kind: Parameters<ReturnType<typeof st>['addLog']>[2] = 'info') => st().addLog(src, msg, kind);

// ---------------- CPU ----------------
function cpuScreen() {
  const m = lab.cpu;
  st().set({ screen: { mode: 'text', lines: ['$ ./a.out', ...(m.output.length ? m.output.slice(-5) : ['（尚无输出）']), '', m.halted ? m.haltReason.slice(0, 26) : `PC = 0x${m.pc.toString(16)}`] } });
}

export function cpuLoad(src: string) {
  lab.cpuSource = src;
  const p = lab.cpu.load(src);
  if (p.errors.length) log('汇编器', `汇编失败：第 ${p.errors[0].line} 行 ${p.errors[0].message}`, 'error');
  else log('汇编器', `汇编成功：${p.lines.length} 条指令/数据字，入口 0x${p.entry.toString(16)}`);
  st().emitPackets([], []);
  cpuScreen();
  st().bump();
}

export function cpuMicro(): Stage | null {
  const m = lab.cpu;
  const stage = m.microStep();
  const t = m.cur ?? m.last;
  if (stage && t) {
    const f = stageFlow(t, stage);
    st().emitPackets(f.packets, f.lit);
    log(`CPU ${STAGE_CN[stage]}`, `${t.decoded?.text ?? `0x${t.pc.toString(16)}`} · ${m.describe(t, stage)[0] ?? ''}`, stage === 'MEM' && t.mem ? (t.mem.kind === 'load' ? 'mem-read' : 'mem-write') : 'control');
  }
  if (m.halted) {
    log('CPU', m.haltReason, m.haltReason.includes('brk') ? 'info' : 'error');
    st().set({ cpuRunning: false });
  }
  cpuScreen();
  st().bump();
  return stage;
}

export function cpuStep(quiet = false) {
  const m = lab.cpu;
  if (m.halted) return;
  const t = m.step();
  if (t && !quiet) {
    const mem = t.mem;
    const packets: Packet[] = [];
    const lit: string[] = [];
    for (const s of ['IF', 'MEM'] as Stage[]) {
      const f = stageFlow(t, s);
      packets.push(...f.packets.filter((p) => p.kind !== 'control'));
      lit.push(...f.lit);
    }
    st().emitPackets(packets, lit);
    log('CPU', `0x${t.pc.toString(16)}  ${t.decoded?.text ?? '?'}${mem ? ` · ${mem.kind === 'load' ? '读' : '写'} 0x${mem.va.toString(16)}（${mem.cache.servedBy}）` : ''}${t.regWrite ? ` · ${t.regWrite.name}←${t.regWrite.value}` : ''}`, mem ? (mem.kind === 'load' ? 'mem-read' : 'mem-write') : 'control');
  }
  if (m.halted) {
    log('CPU', m.haltReason, m.haltReason.includes('brk') ? 'info' : 'error');
    st().set({ cpuRunning: false });
  }
  cpuScreen();
  st().bump();
}

export function cpuBack() {
  if (lab.cpu.stepBack()) log('CPU', `回退一条指令，PC = 0x${lab.cpu.pc.toString(16)}`);
  st().emitPackets([], []);
  cpuScreen();
  st().bump();
}

export function cpuReset() {
  lab.cpu.reset();
  log('CPU', '重置：寄存器、内存、缓存、TLB 清空，重新载入程序');
  st().set({ cpuRunning: false });
  st().emitPackets([], []);
  cpuScreen();
  st().bump();
}

export function cpuSetCache(i: number, key: 'sets' | 'ways' | 'lineBytes', v: number) {
  lab.cacheCfg[i] = { ...lab.cacheCfg[i], [key]: v };
  lab.cpu = new Machine(lab.cacheCfg);
  lab.cpu.load(lab.cpuSource);
  log('实验参数', `${lab.cacheCfg[i].name} ${key === 'sets' ? '组数' : key === 'ways' ? '路数' : '行大小'} → ${v}（已重置 CPU）`);
  st().bump();
}

// ---------------- 内存 ----------------
function vmPackets(ev: VmEvent[]) {
  const n = (k: VmEvent['kind']) => ev.filter((e) => e.kind === k).length;
  const packets: Packet[] = [];
  if (n('fault-zero')) packets.push(pk('mem-write', 'cpu', 'dram', n('fault-zero') * PAGE_SIZE, '零页填充', `${n('fault-zero')} 次首次访问缺页`));
  if (n('fault-file')) packets.push(pk('storage', 'nand', 'dram', n('fault-file') * PAGE_SIZE, '读文件页', `${n('fault-file')} 次文件缺页`));
  if (n('compress')) packets.push(pk('mem-write', 'cpu', 'dram', n('compress') * PAGE_SIZE, '压缩', `${n('compress')} 页压缩`));
  if (n('decompress')) packets.push(pk('mem-read', 'dram', 'cpu', n('decompress') * PAGE_SIZE, '解压', `${n('decompress')} 页解压`));
  if (n('swap-out')) packets.push(pk('storage', 'dram', 'nand', n('swap-out') * PAGE_SIZE, '换出', `${n('swap-out')} 页写入交换文件`));
  if (n('fault-swap')) packets.push(pk('storage', 'nand', 'dram', n('fault-swap') * PAGE_SIZE, '换入', `${n('fault-swap')} 页从交换区读回`));
  const io = n('swap-out') + n('fault-swap') + n('fault-file');
  st().emitPackets(packets, io ? ['dram-a', 'dram-b', 'nand-1', 'nand-2', 'nand-3', 'nand-4'] : packets.length ? ['dram-a', 'dram-b'] : []);
}

function vmCommit(src: string) {
  const ev = lab.vm.drain();
  const important = ev.filter((e) => !['fault-zero'].includes(e.kind));
  for (const e of important.slice(-6)) log(src, e.msg, e.kind === 'swap-out' || e.kind === 'fault-swap' || e.kind === 'fault-file' ? 'storage' : e.kind === 'oom' ? 'error' : 'mem-write');
  const zeros = ev.filter((e) => e.kind === 'fault-zero').length;
  if (zeros) log(src, `${zeros} 次零页缺页（首次访问分配物理页）`, 'mem-write');
  vmPackets(ev);
  lab.vmHistory.push(lab.vm.snapshot());
  if (lab.vmHistory.length > 400) lab.vmHistory.shift();
  const s = lab.vm.summary();
  st().set({ histIdx: null, screen: { mode: 'text', lines: ['活动监视器（模拟）', `内存压力：${PRESSURE_CN[s.pressure]}`, `空闲 ${s.free}/${s.total} 页框`, `压缩 ${s.compressedPages} 页 · 交换 ${s.swapUsed} 槽`] } });
  st().bump();
}

export const vmActions = {
  spawn(name: string, pages: number, ws: number) {
    lab.vm.spawn(name, pages, ws);
    vmCommit('内存');
  },
  malloc(pid: number, pages: number) {
    lab.vm.malloc(pid, pages);
    vmCommit('内存');
  },
  free(pid: number, pages: number) {
    lab.vm.free(pid, pages);
    vmCommit('内存');
  },
  kill(pid: number) {
    lab.vm.kill(pid);
    vmCommit('内存');
  },
  setWs(pid: number, ws: number) {
    const p = lab.vm.proc(pid);
    if (p) p.workingSet = ws;
    log('实验参数', `pid ${pid} 工作集 → ${ws} 页（${ws * 16} KB）`);
    st().bump();
  },
  touch(pid: number, vpn: number, write: boolean) {
    const r = lab.vm.access(pid, vpn, write);
    if (r === 'hit') log('内存', `pid ${pid} 访问 VPN 0x${vpn.toString(16)}：页表命中，无缺页`, 'mem-read');
    vmCommit('内存');
  },
  tick() {
    const r = lab.vm.tick();
    vmCommit(`内存 t=${lab.vm.s.tick}`);
    return r;
  },
  reset() {
    lab.vm = new VirtualMemory(lab.vmCfg);
    lab.vmHistory = [];
    log('内存', `重置：${lab.vmCfg.frames} 个页框，压缩器${lab.vmCfg.compressor ? '开' : '关'}，交换${lab.vmCfg.swap ? '开' : '关'}`);
    st().emitPackets([], []);
    st().set({ histIdx: null, labRunning: false });
    st().bump();
  },
  replay(i: number | null) {
    if (i === null) {
      st().set({ histIdx: null });
    } else {
      st().set({ histIdx: i, labRunning: false });
      log('回放', `查看内存实验第 ${i + 1} 个快照（t=${lab.vmHistory[i].tick}）`);
    }
    st().bump();
  },
  resumeFrom(i: number) {
    lab.vm.restore(lab.vmHistory[i]);
    lab.vmHistory = lab.vmHistory.slice(0, i + 1);
    log('回放', `从快照 t=${lab.vmHistory[i].tick} 继续，之后的历史被丢弃`);
    st().set({ histIdx: null });
    st().bump();
  },
};

// ---------------- SSD ----------------
export const ssdActions = {
  read(path: string, pattern: 'seq' | 'rand') {
    const r = lab.ssd.read(path, pattern, Date.now() & 0xffff);
    if (!r) return;
    lab.ssdResults = [r, ...lab.ssdResults].slice(0, 8);
    const packets: Packet[] = [];
    if (r.misses + r.prefetched) {
      packets.push(pk('control', 'cpu', 'ssdctl', 64, 'NVMe 读命令', `${r.misses + r.prefetched} 个块需要访问 NAND`));
      packets.push(pk('storage', 'nand', 'ssdctl', r.ios.filter((i) => !i.hit).length * 4096, 'NAND 读', `${pattern === 'seq' ? '顺序读 + 预读' : '随机读，队列深度 1'}`));
      packets.push(pk('mem-write', 'ssdctl', 'dram', r.ios.filter((i) => !i.hit).length * 4096, 'DMA → 页缓存', '数据进入统一内存'));
    }
    packets.push(pk('mem-read', 'dram', 'cpu', r.bytes, r.misses ? 'copyout' : '页缓存命中', `CPU 读取 ${fmtBytes(r.bytes)}`));
    st().emitPackets(packets, r.misses + r.prefetched ? ['nand-1', 'nand-2', 'nand-3', 'nand-4', 'dram-a', 'soc'] : ['dram-a', 'soc']);
    log('SSD', `${pattern === 'seq' ? '顺序' : '随机'}读 ${path.split('/').pop()}：缓存命中 ${r.hits} · 预读 ${r.prefetched} · 按需读 NAND ${r.misses}（共 ${r.hits + r.prefetched + r.misses} 块），${fmtUs(r.totalUs)}，${r.mbps.toFixed(0)} MB/s`, 'storage');
    st().set({ screen: { mode: 'text', lines: [path.split('/').pop()!, '', `${pattern === 'seq' ? '顺序' : '随机'}读取 ${fmtBytes(r.bytes)}`, `${fmtUs(r.totalUs)} · ${r.mbps.toFixed(0)} MB/s`, `校验和 0x${r.checksum.toString(16)}`] } });
    st().bump();
  },
  save(path: string, content: string, sizeKB: number) {
    const r = lab.ssd.save(path, content, sizeKB * 1024);
    st().emitPackets(
      [pk('mem-write', 'cpu', 'dram', sizeKB * 1024, 'write() → 页缓存', '先写入内存中的页缓存'), pk('storage', 'dram', 'nand', sizeKB * 1024, 'fsync → NAND 编程', `${r.file.lbas.length} 个块分到 ${lab.ssd.s.cfg.channels} 个通道`)],
      ['dram-a', 'nand-1', 'nand-2', 'nand-3', 'nand-4'],
    );
    log('SSD', `保存 ${path}（${sizeKB} KB，inode ${r.file.inode}，LBA ${r.file.lbas[0]}…）NAND 编程耗时 ${fmtUs(r.totalUs)}`, 'storage');
    st().bump();
  },
  drop() {
    lab.ssd.dropCache();
    log('SSD', '清空页缓存（脏块先写回 NAND）', 'storage');
    st().bump();
  },
  reset() {
    lab.ssd = new Ssd(lab.ssdCfg);
    lab.ssdResults = [];
    log('SSD', '重置文件系统与缓存');
    st().emitPackets([], []);
    st().bump();
  },
};

// ---------------- GPU ----------------
export const gpuActions = {
  reset() {
    lab.gpu = startRun(lab.gpuCfg);
    log('GPU', `新建渲染任务：${lab.gpuCfg.triangles} 个三角形，${lab.gpuCfg.width}×${lab.gpuCfg.height}，tile ${lab.gpuCfg.tile}px`);
    st().emitPackets([], []);
    st().bump();
  },
  next() {
    const r = lab.gpu;
    const fbShow = () => st().set({ screen: { mode: 'fb', fb: r.framebuffer.slice(), w: r.cfg.width, h: r.cfg.height } });
    switch (r.phase) {
      case 'idle':
        gpuEncode(r);
        st().emitPackets([pk('mem-write', 'cpu', 'dram', r.stats.vertexBytes, '写顶点缓冲', 'CPU 生成顶点', `0x${r.buffers[0].addr.toString(16)}`), pk('control', 'cpu', 'gpu', 8, 'commit', '提交命令缓冲')], ['soc', 'dram-a']);
        log('GPU', `CPU 写入顶点 ${r.stats.vertexBytes} B 并编码 ${r.commands.length} 条命令`, 'mem-write');
        break;
      case 'encode':
        vertexStage(r);
        st().emitPackets([pk('gpu', 'dram', 'gpu', r.stats.vertexBytes, '顶点读取', '与 CPU 写入的是同一物理地址（零拷贝）', `0x${r.buffers[0].addr.toString(16)}`)], ['soc', 'dram-a']);
        log('GPU', `顶点着色：${r.verts.length} 个顶点旋转 ${r.cfg.angle}° 并投影到屏幕`, 'gpu');
        break;
      case 'vertex':
        tilingStage(r);
        st().emitPackets([pk('gpu', 'gpu', 'dram', r.tiles.reduce((a, t) => a + t.tris.length * 4, 0), '分块列表', '每个 tile 覆盖哪些三角形')], ['soc']);
        log('GPU', `分块：${r.tiles.length} 个 tile，非空 ${r.tiles.filter((t) => t.tris.length).length} 个`, 'gpu');
        break;
      case 'tiling':
      case 'raster': {
        const batch = Math.max(1, Math.ceil(r.tiles.length / 8));
        const from = r.tileCursor;
        for (let i = from; i < Math.min(r.tiles.length, from + batch); i++) rasterTile(r, i);
        const bytes = r.tiles.slice(from, r.tileCursor).reduce((a, t) => a + t.written, 0);
        st().emitPackets([pk('gpu', 'gpu', 'dram', bytes, '写回 tile', `tile ${from + 1}–${r.tileCursor}`)], ['soc', 'dram-b']);
        log('GPU', `光栅化 tile ${from + 1}–${r.tileCursor}/${r.tiles.length}，写回 ${fmtBytes(bytes)}`, 'gpu');
        fbShow();
        break;
      }
      case 'present':
        finish(r);
        st().emitPackets([pk('gpu', 'dram', 'dispeng', r.stats.fbBytes, '扫描输出', '显示引擎读帧缓冲'), pk('gpu', 'dispeng', 'display', r.stats.fbBytes, 'eDP', '送屏')], ['dram-b', 'lid']);
        log('GPU', `完成：TBDR 写回 ${fmtBytes(r.stats.tbdrWrites)}，立即模式估算 ${fmtBytes(r.stats.imrWrites)}，重绘率 ${r.stats.overdraw.toFixed(2)}`, 'gpu');
        fbShow();
        break;
      case 'done':
        gpuActions.reset();
        return;
    }
    st().bump();
  },
  runAll() {
    if (lab.gpu.phase === 'done') gpuActions.reset();
    let guard = 0;
    while (lab.gpu.phase !== 'done' && guard++ < 100) gpuActions.next();
  },
};

// ---------------- 调度与散热 ----------------
export const schedActions = {
  tick(n = 1) {
    const s = lab.sched;
    const before = s.log.length;
    for (let i = 0; i < n; i++) schedTick(s);
    for (const l of s.log.slice(before)) log('调度', l, l.includes('⚠') ? 'warn' : 'info');
    lab.schedHistory.push(structuredClone(s));
    if (lab.schedHistory.length > 400) lab.schedHistory.shift();
    const packets = [pk('power', 'pmu', 'cpu', 0, '供电', `CPU ${s.power.cpu.toFixed(1)} W`), pk('thermal', 'cpu', 'heatsink', 0, '导热', `${s.temp.toFixed(1)} °C`)];
    if (s.rpm > 0) packets.push(pk('thermal', 'heatsink', 'fan', 0, '排热', `${Math.round(s.rpm)} rpm`));
    st().emitPackets(packets, ['soc', 'heatsink', ...(s.rpm > 0 ? ['fan-l', 'fan-r'] : []), ...(s.throttled ? ['pmu-1'] : [])]);
    st().set({ histIdx: null, screen: { mode: 'text', lines: ['活动监视器（模拟）', `CPU 功耗 ${s.power.cpu.toFixed(1)} W`, `SoC ${s.temp.toFixed(1)} °C · 风扇 ${Math.round(s.rpm)} rpm`, `性能核 ${s.pFreq.toFixed(2)} GHz${s.throttled ? '（降频）' : ''}`] } });
    st().bump();
  },
  add(name: string, qos: QoS, load: number, work: number) {
    addThread(lab.sched, name, qos, load, work);
    log('调度', `添加线程 ${name}（${QOS_CN[qos]}，负载 ${Math.round(load * 100)}%）`);
    st().bump();
  },
  remove(tid: number) {
    const t = lab.sched.threads.find((x) => x.tid === tid);
    if (t) {
      t.state = 'finished';
      t.core = null;
      log('调度', `结束线程 #${tid} ${t.name}`);
    }
    st().bump();
  },
  reset() {
    const th = lab.sched.thermal;
    lab.sched = newSched();
    lab.sched.thermal = th;
    lab.schedHistory = [];
    log('调度', '重置调度器与热状态');
    st().set({ labRunning: false, histIdx: null });
    st().emitPackets([], []);
    st().bump();
  },
};
