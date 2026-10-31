// 六个可触发事件。每个场景都调用真实的模拟模型（CPU / VM / SSD / GPU / 调度）生成步骤，
// 步骤中的数字（字节数、地址、命中与否、耗时）都来自模型计算结果，而不是写死的动画。

import { Machine } from '../cpu/machine';
import { EXAMPLES } from '../cpu/programs';
import { hex32 } from '../cpu/assembler';
import { VirtualMemory, PAGE_SIZE, PRESSURE_CN } from '../memory/vm';
import { Ssd, BLOCK } from '../storage/ssd';
import { DEFAULT_GPU, encode as gpuEncode, finish, rasterTile, startRun, tilingStage, vertexStage } from '../gpu/gpu';
import { addThread, newSched, PRESET_THREADS, QOS_CN, readyQueue, schedTick, type SchedState } from '../sched/sched';
import { fmtBytes, fmtUs, pk, type FlowStep, type Scenario, type Visual } from './types';

// ---------- 1. 开机启动 ----------
function digest(bytes: Uint8Array) {
  // FNV-1a 32 位：教学用摘要（真实系统使用 SHA-384 摘要 + Apple 签名）
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
function image(seed: number, n = 256) {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (seed * 131 + i * 17 + ((i * i) >> 3)) & 0xff;
  return a;
}

const bootScenario: Scenario = {
  id: 'boot',
  title: '开机启动',
  summary: '供电 → Boot ROM（信任根）→ LLB → iBoot → 内核 → launchd，每一级先验证下一级的签名。',
  options: [{ key: 'tamper', label: '篡改 iBoot 固件（观察安全启动拒绝执行）' }],
  build: ({ tamper }) => {
    const steps: FlowStep[] = [];
    const llb = image(11);
    const iboot = image(23);
    const manifest = { llb: digest(llb), iboot: digest(iboot), kernel: digest(image(37)) };
    if (tamper) iboot[100] ^= 0x5a;
    steps.push({
      title: '按下电源键',
      detail: '电源键（Touch ID 按键）产生唤醒信号，电源管理芯片开始按顺序为各电源域上电。',
      packets: [pk('control', 'powerkey', 'pmu', 1, '唤醒信号', '用户按下电源键')],
      highlights: ['keyboard', 'pmu-1'],
      inspect: [['事件', '电源键按下'], ['电源状态', '关机 → 上电时序开始']],
      durationUs: 1000,
      provenance: 'derived',
      display: { mode: 'off' },
    });
    steps.push({
      title: '供电：电池/MagSafe → 充电控制 → PMU → SoC',
      detail: '电池（或 MagSafe 适配器）经充电控制器 ISL9240 的功率路径，送到电源管理芯片 APL1098，由它生成 SoC 各电源域所需的多路电压。',
      packets: [
        pk('power', 'battery', 'charger', 0, '直流供电', '电池放电（未接适配器）'),
        pk('power', 'charger', 'pmu', 0, '系统电源轨', '功率路径切换到电池'),
        pk('power', 'pmu', 'cpu', 0, '多路降压输出', '为 CPU/GPU/SRAM/IO 等电源域上电'),
      ],
      highlights: ['battery-c1', 'charger', 'pmu-1', 'soc'],
      inspect: [['电池', '70 Wh 锂聚合物（官方）'], ['功率路径', 'ISL9240（拆机识别）'], ['电源管理', 'APL1098 / 343S00515（拆机识别）'], ['各路电压', 'Apple 未公开，此处不编造数值']],
      durationUs: 20000,
      provenance: 'teardown',
      display: { mode: 'off' },
    });
    steps.push({
      title: 'Boot ROM：硬件信任根',
      detail: 'CPU 复位后从 SoC 内部只读的 Boot ROM 开始执行。Boot ROM 在芯片制造时写死，无法更新，内含 Apple 根证书公钥，用来验证下一级。',
      packets: [pk('control', 'bootrom', 'cpu', 0, '复位向量取指', '复位后第一条指令来自 Boot ROM')],
      highlights: ['soc'],
      inspect: [['执行位置', 'SoC 内部 Boot ROM（只读）'], ['可修改', '否'], ['作用', '验证 LLB 签名']],
      durationUs: 500,
      provenance: 'derived',
      display: { mode: 'logo', progress: 0 },
    });
    const llbOk = digest(llb) === manifest.llb;
    steps.push({
      title: '读取并验证 LLB',
      detail: 'Boot ROM 从启动闪存读取 LLB（底层引导程序），计算摘要并与 Apple 签名清单中的值比对，一致才跳转执行。',
      packets: [pk('storage', 'nor', 'bootrom', llb.length, '读取 LLB 镜像', '加载下一级引导程序（镜像大小为示意）')],
      highlights: ['nor', 'soc'],
      inspect: [['计算摘要', digest(llb)], ['清单摘要', manifest.llb], ['结果', llbOk ? '一致 → 跳转到 LLB' : '不一致'], ['说明', '摘要算法为教学版 FNV-1a；真实系统用 SHA-384 + 签名']],
      durationUs: 3000,
      provenance: 'teaching',
      display: { mode: 'logo', progress: 0.1 },
    });
    steps.push({
      title: '安全隔区（SEP）独立启动',
      detail: 'Secure Enclave 有自己的 Boot ROM 和固件，与主 CPU 并行启动，负责 Touch ID 与磁盘加密密钥，主系统无法直接读取它的内存。',
      packets: [pk('control', 'cpu', 'sep', 0, '启动 SEP 固件', '加载并验证 sepOS')],
      highlights: ['soc'],
      inspect: [['SEP', '独立 Boot ROM + sepOS'], ['保管', 'Touch ID 模板、数据卷加密密钥']],
      durationUs: 8000,
      provenance: 'derived',
      display: { mode: 'logo', progress: 0.2 },
    });
    const ibootDigest = digest(iboot);
    const ibootOk = ibootDigest === manifest.iboot;
    steps.push({
      title: 'LLB 验证 iBoot',
      detail: ibootOk
        ? 'LLB 初始化内存控制器（LPDDR5 训练），读取本机 LocalPolicy 安全策略，再读取 iBoot 并验证签名。'
        : 'iBoot 镜像被篡改：计算出的摘要与签名清单不一致。安全启动链在此中断，Mac 不会执行被修改的代码，只能进入恢复/DFU 流程。',
      packets: [
        pk('control', 'cpu', 'memctl', 0, '内存控制器初始化', '训练 LPDDR5 时序后才能使用统一内存'),
        pk('storage', 'nand', 'ssdctl', 16384, '读取 LocalPolicy', 'Preboot 卷中的本机安全策略（大小为示意）'),
        pk('storage', 'nor', 'dram', iboot.length, '读取 iBoot 镜像', '加载下一级引导程序'),
      ],
      highlights: ['dram-a', 'dram-b', 'nor', 'soc'],
      inspect: [['计算摘要', ibootDigest], ['清单摘要', manifest.iboot], ['结果', ibootOk ? '一致 → 跳转到 iBoot' : '✗ 不一致 → 拒绝执行']],
      durationUs: 40000,
      provenance: 'teaching',
      display: ibootOk ? { mode: 'logo', progress: 0.35 } : { mode: 'logo', progress: 0.35, error: '启动失败：固件签名验证未通过' },
      failed: !ibootOk,
      log: ibootOk ? 'iBoot 签名验证通过' : '安全启动：iBoot 摘要不匹配，停止启动',
    });
    if (!ibootOk) return steps;
    const ssd = new Ssd();
    const kc = ssd.create('/System/Library/KernelCollections/BootKernelExtensions.kc', 48 * BLOCK, 'kernelcache', false);
    ssd.dropCache();
    const r = ssd.read(kc.path, 'seq')!;
    steps.push({
      title: 'iBoot 从 SSD 加载内核',
      detail: 'iBoot 通过 SoC 内的 SSD 控制器读取 kernelcache（内核 + 驱动集合），NAND 数据经 DMA 进入统一内存。顺序读取会触发预读，多个 NAND 通道并行。',
      packets: [
        pk('storage', 'nand', 'ssdctl', r.bytes, 'NAND 读取', `顺序读 ${kc.lbas.length} 个 4 KB 块（演示中缩小了内核尺寸）`),
        pk('mem-write', 'ssdctl', 'dram', r.bytes, 'DMA 写入内存', 'kernelcache 放入统一内存', '0x8_0000_0000（示意）'),
      ],
      highlights: ['nand-1', 'nand-2', 'nand-3', 'nand-4', 'dram-a', 'dram-b'],
      inspect: [['读取量', fmtBytes(r.bytes)], ['NAND 读次数', String(r.misses + r.prefetched)], ['模型耗时', fmtUs(r.totalUs)], ['模型吞吐', `${r.mbps.toFixed(0)} MB/s`], ['内核摘要', manifest.kernel + '（验证通过）']],
      durationUs: r.totalUs,
      provenance: 'teaching',
      display: { mode: 'logo', progress: 0.6 },
      visual: { type: 'io', ios: r.ios, totalUs: r.totalUs },
    });
    steps.push({
      title: '内核启动：开启 MMU、建立页表',
      detail: 'XNU 内核建立内核页表并打开 MMU，此后 CPU 发出的都是虚拟地址；随后验证签名系统卷（SSV）的默克尔树根哈希，再挂载系统卷。',
      packets: [pk('mem-write', 'cpu', 'dram', 64 * 1024, '写页表', '建立 16 KB 粒度的四级页表')],
      highlights: ['soc', 'dram-a'],
      inspect: [['页大小', '16 KB（官方）'], ['虚拟地址', '48 位，四级页表'], ['系统卷', '签名系统卷（SSV），只读']],
      durationUs: 300000,
      provenance: 'derived',
      display: { mode: 'logo', progress: 0.8 },
    });
    steps.push({
      title: 'launchd（PID 1）→ WindowServer → 登录窗口',
      detail: '内核启动第一个用户进程 launchd，它再拉起 WindowServer 等系统服务；GPU 合成第一帧画面，显示引擎从帧缓冲读出像素送到屏幕。',
      packets: [
        pk('control', 'cpu', 'cpu', 0, 'exec launchd', 'PID 1'),
        pk('gpu', 'gpu', 'dram', 3024 * 1964 * 4, '写帧缓冲', '合成登录界面'),
        pk('gpu', 'dram', 'dispeng', 3024 * 1964 * 4, '扫描输出', '显示引擎每帧读取整幅画面'),
        pk('gpu', 'dispeng', 'display', 3024 * 1964 * 4, 'eDP 传输', '送往 XDR 屏幕'),
      ],
      highlights: ['soc', 'dram-b', 'lid'],
      inspect: [['首个进程', 'launchd（PID 1）'], ['帧缓冲', `3024×1964×4 B = ${fmtBytes(3024 * 1964 * 4)}`], ['刷新率', '最高 120 Hz（ProMotion）']],
      durationUs: 2_000_000,
      provenance: 'derived',
      display: { mode: 'text', lines: ['macOS', '', '登录窗口（模拟画面）', '本应用不运行真实 macOS'] },
      log: '启动完成',
    });
    return steps;
  },
};

// ---------- 2. 运行程序 ----------
const runScenario: Scenario = {
  id: 'run',
  title: '运行程序',
  summary: 'SSD → 内存 → CPU → 输出：exec 一个程序，经历缺页、取指、缓存、执行与显示。',
  build: () => {
    const steps: FlowStep[] = [];
    const ssd = new Ssd();
    const vm = new VirtualMemory();
    const path = '/Applications/Hello.app/Contents/MacOS/Hello';
    const f = ssd.find(path)!;
    steps.push({
      title: '用户点击程序图标',
      detail: '触控板把点击事件交给 CPU；Finder 请求 launchd 启动程序，最终由内核执行 exec 系统调用。',
      packets: [pk('control', 'trackpad', 'cpu', 64, '输入事件', '点击 Hello.app')],
      highlights: ['trackpad', 'soc'],
      inspect: [['系统调用', 'posix_spawn / exec'], ['目标文件', path]],
      durationUs: 2000,
      provenance: 'teaching',
    });
    const p = vm.spawn('Hello', 4, 2, 4);
    steps.push({
      title: '内核建立进程地址空间（尚未读文件）',
      detail: '内核为新进程创建页表，把可执行文件的代码段映射到虚拟地址，但这些页标记为“不在内存”。这就是按需调页：用到才读。',
      packets: [pk('mem-write', 'cpu', 'dram', 4096, '写页表项', '为代码段与堆建立 PTE')],
      highlights: ['soc', 'dram-a'],
      inspect: [['PID', String(p.pid)], ['inode', String(f.inode)], ['文件大小', fmtBytes(f.size)], ['代码页', `${Object.values(p.pt).filter((e) => e.kind === 'code').length} 页（状态：在文件中）`], ['堆页', '4 页（状态：未分配物理页）']],
      durationUs: 50,
      provenance: 'teaching',
    });
    const fault = vm.access(p.pid, 0x100, false);
    const rd = ssd.read(path, 'seq')!;
    const firstIos = rd.ios.slice(0, 4);
    steps.push({
      title: '第一次取指 → 缺页 → 从 SSD 读入代码页',
      detail: `CPU 取第一条指令时 MMU 发现页表项无效，触发页错误（${fault}）。内核向 SSD 控制器发起读请求，NAND 中的 16 KB（4 个 4 KB 块）经 DMA 写入一个空闲页框。顺序读会顺带预读后续块。`,
      packets: [
        pk('control', 'cpu', 'cpu', 0, '页错误异常', '代码页不在内存', 'VA 0x400000'),
        pk('storage', 'nand', 'ssdctl', PAGE_SIZE, 'NAND 读', '读取可执行文件第一页'),
        pk('mem-write', 'ssdctl', 'dram', PAGE_SIZE, 'DMA 写入', '放入页框', `页框 #${p.pt[0x100].frame}`),
      ],
      highlights: ['nand-1', 'nand-3', 'dram-a', 'soc'],
      inspect: [['缺页类型', '主缺页（需读 SSD）'], ['分配页框', `#${p.pt[0x100].frame}`], ['NAND 访问', firstIos.map((i) => `LBA ${i.lba}→通道 ${i.channel}`).join('，')], ['整个文件模型耗时', fmtUs(rd.totalUs)]],
      durationUs: firstIos[firstIos.length - 1]?.end ?? 100,
      provenance: 'teaching',
      visual: { type: 'io', ios: rd.ios, totalUs: rd.totalUs },
    });
    const m = new Machine();
    const prog = m.load(EXAMPLES[0].source);
    const t1 = m.step()!;
    steps.push({
      title: '取指：DRAM → SLC → L2 → L1I → 译码',
      detail: '页表项已有效，MMU 把虚拟地址转换为物理地址；指令缓存未命中，于是从统一内存把整条缓存行逐级取回。',
      packets: [
        pk('mem-read', 'dram', 'slc', 64, '读缓存行', '指令缓存未命中', `PA 0x${t1.fetch!.xlat.pa.toString(16)}`),
        pk('mem-read', 'slc', 'cpu', 64, '填充 L2 / L1I', '送往取指单元'),
      ],
      highlights: ['dram-a', 'soc'],
      inspect: [['PC', `0x${t1.pc.toString(16)}`], ['机器码', hex32(t1.word)], ['反汇编', t1.decoded!.text], ['TLB', t1.fetch!.xlat.tlbHit ? '命中' : '未命中 → 页表遍历'], ['服务层级', t1.fetch!.cache.servedBy], ['周期', String(t1.cycles)]],
      durationUs: 0.1,
      provenance: 'teaching',
      visual: { type: 'code', lines: prog.lines.slice(0, 8).map((l) => ({ addr: l.addr.toString(16), word: hex32(l.word), text: l.source, active: l.addr === t1.pc })) },
    });
    // 执行到第一次 LDR
    let ldr = m.step()!;
    while (!m.halted && !ldr.mem) ldr = m.step()!;
    steps.push({
      title: '执行 LDR：数据从统一内存进入寄存器',
      detail: '数组数据第一次被访问，L1D、L2、SLC 都未命中，由内存控制器从 LPDDR5 读取 64 字节缓存行；之后的相邻元素都会命中同一行。',
      packets: [
        pk('mem-read', 'dram', 'memctl', 64, '读缓存行', 'L1D/L2/SLC 未命中', `VA 0x${ldr.mem!.va.toString(16)} → PA 0x${ldr.mem!.xlat.pa.toString(16)}`),
        pk('mem-read', 'memctl', 'cpu', 8, 'LDR 结果', `x4 ← ${ldr.mem!.value}`),
      ],
      highlights: ['dram-b', 'soc'],
      inspect: [['指令', ldr.decoded!.text], ['地址', `0x${ldr.mem!.va.toString(16)}`], ['缓存路径', ldr.mem!.cache.path.map((x) => `${x.level}${x.hit ? '✓' : '✗'}`).join(' → ')], ['读到', String(ldr.mem!.value)], ['本条周期', String(ldr.cycles)]],
      durationUs: 0.1,
      provenance: 'teaching',
    });
    m.run();
    const l1 = m.dcache.levels[0];
    steps.push({
      title: '循环执行完毕',
      detail: `程序共退休 ${m.retired} 条指令、${m.cycle} 个模拟周期。L1D 命中 ${l1.hits} 次、未命中 ${l1.misses} 次——数组连续存放，空间局部性让大部分读取命中缓存。`,
      packets: [pk('mem-read', 'dram', 'cpu', 64, '后续缓存行', '数组跨越第二条缓存行')],
      highlights: ['soc'],
      inspect: [['退休指令', String(m.retired)], ['周期', String(m.cycle)], ['IPC（教学顺序核）', (m.retired / m.cycle).toFixed(3)], ['L1D 命中率', `${((l1.hits / (l1.hits + l1.misses)) * 100).toFixed(0)}%`], ['x0（和）', String(m.regs[0])]],
      durationUs: m.cycle / 3200,
      provenance: 'teaching',
    });
    steps.push({
      title: '输出：写结果 → GPU 合成 → 显示',
      detail: '程序把结果写到输出端口（模拟 write 系统调用），WindowServer 把文字绘制进窗口纹理，GPU 合成后写帧缓冲，显示引擎读出送屏。',
      packets: [
        pk('mem-write', 'cpu', 'dram', 8, 'STR 输出', `值 ${m.output.join(',')}`, '0x7ff8'),
        pk('gpu', 'dram', 'gpu', 4096, '读取窗口纹理', '合成'),
        pk('gpu', 'gpu', 'dram', 4096, '写帧缓冲', '更新窗口区域'),
        pk('gpu', 'dispeng', 'display', 4096, '扫描输出', '下一次刷新时显示'),
      ],
      highlights: ['soc', 'lid'],
      inspect: [['程序输出', m.output.join(', ')], ['停机原因', m.haltReason]],
      durationUs: 8333,
      provenance: 'teaching',
      display: { mode: 'text', lines: ['$ ./Hello', `sum = ${m.output.join(', ')}`, '', `retired ${m.retired} insts`, `L1D hit ${l1.hits}/${l1.hits + l1.misses}`] },
    });
    return steps;
  },
};

// ---------- 3. 打开文件 ----------
const fileScenario: Scenario = {
  id: 'file',
  title: '打开文件',
  summary: '路径解析 → inode → 页缓存 → NVMe 读 → FTL → NAND → DMA → 用户缓冲；第二次读取命中缓存。',
  build: () => {
    const steps: FlowStep[] = [];
    const ssd = new Ssd();
    const path = '/Users/me/notes.txt';
    const f = ssd.find(path)!;
    steps.push({
      title: 'open()：逐级解析路径',
      detail: 'VFS 从根目录开始逐个查找目录项，最终得到文件的 inode；目录项本身大多已在内存的目录缓存中。',
      packets: [pk('mem-read', 'dram', 'cpu', 256, '查目录缓存', '/ → Users → me → notes.txt')],
      highlights: ['soc', 'dram-a'],
      inspect: [['路径分量', '/ · Users · me · notes.txt'], ['inode', String(f.inode)], ['大小', fmtBytes(f.size)], ['逻辑块', `${f.lbas.length} 个 4 KB 块：LBA ${f.lbas[0]}–${f.lbas[f.lbas.length - 1]}`]],
      durationUs: 4,
      provenance: 'teaching',
    });
    steps.push({
      title: 'read()：先查统一缓冲区缓存',
      detail: '内核按 (文件, 偏移) 查找页缓存。冷启动后第一次读取，全部未命中。',
      packets: [pk('mem-read', 'dram', 'cpu', 64, '查页缓存', '缓存中没有这些块')],
      highlights: ['soc'],
      inspect: f.lbas.slice(0, 6).map((l) => [`LBA ${l}`, ssd.inCache(l) ? '命中' : '未命中']),
      durationUs: 1,
      provenance: 'teaching',
    });
    const ftl = f.lbas.slice(0, 4).map((l) => ssd.s.ftl[l]);
    const r1 = ssd.read(path, 'seq')!;
    steps.push({
      title: 'NVMe 读命令 → FTL → NAND',
      detail: 'SoC 内的 SSD 控制器把逻辑块号经闪存转换层（FTL）映射到 NAND 的通道/块/页，并行地向多颗 NAND 发出读命令；每次读要经过阵列读取时间 tR，再经通道传输。',
      packets: [
        pk('control', 'cpu', 'ssdctl', 64, 'NVMe 读命令', `读 ${f.lbas.length} 个块`),
        pk('storage', 'nand', 'ssdctl', r1.bytes, 'NAND 页读', '多通道并行'),
      ],
      highlights: ['nand-1', 'nand-2', 'nand-3', 'nand-4', 'soc'],
      inspect: ftl.map((e, i) => [`LBA ${f.lbas[i]}`, `通道 ${e.channel} · 块 ${e.block} · 页 ${e.page}`] as [string, string]).concat([['tR（教学值）', `${ssd.s.cfg.nandReadUs} µs`], ['模型耗时', fmtUs(r1.totalUs)]]),
      durationUs: r1.totalUs,
      provenance: 'teaching',
      visual: { type: 'io', ios: r1.ios, totalUs: r1.totalUs },
    });
    steps.push({
      title: 'DMA 写入页缓存，再复制到用户缓冲',
      detail: '数据由 SSD 控制器直接写入内存中的页缓存（DMA，无需 CPU 搬运），read() 再把它复制到程序自己的缓冲区。',
      packets: [
        pk('mem-write', 'ssdctl', 'dram', r1.bytes, 'DMA', '写入页缓存'),
        pk('mem-read', 'dram', 'cpu', r1.bytes, 'copyout 读', '内核读页缓存'),
        pk('mem-write', 'cpu', 'dram', r1.bytes, 'copyout 写', '写入用户缓冲区'),
      ],
      highlights: ['dram-a', 'dram-b', 'soc'],
      inspect: [['复制字节', fmtBytes(r1.bytes)], ['页缓存现有块', String(ssd.s.cache.length)]],
      durationUs: r1.bytes / 20e3,
      provenance: 'teaching',
    });
    steps.push({
      title: 'CPU 处理数据',
      detail: '程序遍历缓冲区计算校验和，数据经 L1D 进入寄存器。',
      packets: [pk('mem-read', 'dram', 'cpu', r1.bytes, '顺序读', '计算校验和')],
      highlights: ['soc'],
      inspect: [['文件内容', f.content], ['校验和', `0x${r1.checksum.toString(16)}`]],
      durationUs: 3,
      provenance: 'teaching',
      display: { mode: 'text', lines: ['notes.txt', '', f.content.slice(0, 24), f.content.slice(24)] },
    });
    const r2 = ssd.read(path, 'seq')!;
    steps.push({
      title: '第二次读取：页缓存命中',
      detail: `同一文件再读一次，所有块都在页缓存中，不再访问 SSD：耗时从 ${fmtUs(r1.totalUs)} 降到 ${fmtUs(r2.totalUs)}，约快 ${(r1.totalUs / r2.totalUs).toFixed(0)} 倍。`,
      packets: [pk('mem-read', 'dram', 'cpu', r2.bytes, '页缓存命中', '直接内存复制')],
      highlights: ['dram-a', 'soc'],
      inspect: [['缓存命中 / 访问 NAND', `${r2.hits} / ${r2.misses + r2.prefetched}`], ['第一次耗时', fmtUs(r1.totalUs)], ['第二次耗时', fmtUs(r2.totalUs)], ['加速比', `${(r1.totalUs / r2.totalUs).toFixed(0)}×`]],
      durationUs: r2.totalUs,
      provenance: 'teaching',
      visual: { type: 'io', ios: r2.ios, totalUs: r2.totalUs },
    });
    return steps;
  },
};

// ---------- 4. GPU 渲染 ----------
const gpuScenario: Scenario = {
  id: 'gpu',
  title: 'GPU 渲染',
  summary: 'CPU 写顶点并编码命令 → GPU 读取同一块统一内存 → 分块光栅化 → 帧缓冲 → 显示屏。',
  build: () => {
    const steps: FlowStep[] = [];
    const run = startRun({ ...DEFAULT_GPU });
    gpuEncode(run);
    const vb = run.buffers[0];
    const fbVisual = (): Visual => ({ type: 'fb', fb: run.framebuffer.slice(), w: run.cfg.width, h: run.cfg.height, tilesDone: run.tileCursor, tiles: run.tiles.length, tile: run.cfg.tile });
    steps.push({
      title: 'CPU 写顶点数据到统一内存',
      detail: 'App 在 CPU 上生成三角形顶点，直接写入一块 CPU 与 GPU 共享的内存。统一内存架构下没有“显存”，也不需要拷贝。',
      packets: [pk('mem-write', 'cpu', 'dram', vb.bytes, '写顶点缓冲', `${run.verts.length} 个顶点 × 24 B`, `0x${vb.addr.toString(16)}`)],
      highlights: ['soc', 'dram-a'],
      inspect: [['顶点数', String(run.verts.length)], ['顶点缓冲', `${vb.bytes} B @ 0x${vb.addr.toString(16)}`], ['写入者', 'CPU'], ['读取者', 'GPU（同一物理地址）']],
      durationUs: 1,
      provenance: 'teaching',
    });
    steps.push({
      title: 'CPU 编码并提交命令缓冲',
      detail: '用 Metal 风格的命令描述“用哪个管线、读哪个缓冲、画几个三角形、画到哪个帧缓冲”，提交后 GPU 命令处理器开始异步执行，CPU 可以继续做别的事。',
      packets: [
        pk('mem-write', 'cpu', 'dram', run.commands.reduce((a, c) => a + c.bytes, 0), '写命令缓冲', 'encode'),
        pk('control', 'cpu', 'gpu', 8, 'commit / 门铃', '通知 GPU 有新工作'),
      ],
      highlights: ['soc'],
      inspect: run.commands.map((c) => [c.op, c.args]),
      durationUs: 5,
      provenance: 'teaching',
    });
    vertexStage(run);
    steps.push({
      title: 'GPU 读取顶点并执行顶点着色',
      detail: `GPU 从刚才 CPU 写入的同一物理地址读取顶点，旋转 ${run.cfg.angle}° 并变换到屏幕坐标。`,
      packets: [pk('gpu', 'dram', 'gpu', vb.bytes, '顶点读取', '零拷贝：与 CPU 共享同一缓冲', `0x${vb.addr.toString(16)}`)],
      highlights: ['soc', 'dram-a'],
      inspect: run.screen.slice(0, 3).map((s, i) => [`顶点 ${i}`, `(${s.x.toFixed(1)}, ${s.y.toFixed(1)}) z=${s.z}`]),
      durationUs: 2,
      provenance: 'teaching',
    });
    tilingStage(run);
    const busy = run.tiles.filter((t) => t.tris.length).length;
    steps.push({
      title: '分块（Tiling）：把三角形分配到屏幕小块',
      detail: `画面被切成 ${run.tiles.length} 个 ${run.cfg.tile}×${run.cfg.tile} 像素的 tile，其中 ${busy} 个被三角形覆盖。每个 tile 由一个 GPU 核心在片上 tile 内存中独立完成着色。`,
      packets: [pk('gpu', 'gpu', 'dram', run.tiles.reduce((a, t) => a + t.tris.length * 4, 0), '写分块列表', '每个 tile 覆盖哪些三角形')],
      highlights: ['soc'],
      inspect: [['tile 数', String(run.tiles.length)], ['非空 tile', String(busy)], ['GPU 核心', `${run.cfg.cores}（官方）`], ['分配方式', '轮转分配（教学抽象）']],
      durationUs: 3,
      provenance: 'teaching',
      visual: fbVisual(),
    });
    const n = run.tiles.length;
    for (const frac of [0.34, 0.67, 1]) {
      const to = Math.round(n * frac);
      const from = run.tileCursor;
      for (let i = from; i < to; i++) rasterTile(run, i);
      const done = run.tiles.slice(from, to);
      steps.push({
        title: `光栅化 tile ${from + 1}–${to} / ${n}`,
        detail: '每个 tile 在片上存储中完成深度测试与着色，完成后整块写回统一内存中的帧缓冲——每个像素只写一次，这是 TBDR 省带宽的关键。',
        packets: [pk('gpu', 'gpu', 'dram', done.reduce((a, t) => a + t.written, 0), '写回 tile', `${to - from} 个 tile`, `帧缓冲 0x${run.buffers[2].addr.toString(16)}`)],
        highlights: ['soc', 'dram-b'],
        inspect: [['本批覆盖片元', String(done.reduce((a, t) => a + t.pixels, 0))], ['本批写回', fmtBytes(done.reduce((a, t) => a + t.written, 0))], ['参与核心', [...new Set(done.map((t) => t.core))].sort((a, b) => a - b).join(', ')]],
        durationUs: 4,
        provenance: 'teaching',
        visual: fbVisual(),
        display: { mode: 'fb', fb: run.framebuffer.slice(), w: run.cfg.width, h: run.cfg.height },
      });
    }
    finish(run);
    steps.push({
      title: '显示引擎扫描帧缓冲 → 屏幕',
      detail: `帧缓冲完成后，显示引擎读取它送往屏幕。对比：立即模式渲染需要写 ${fmtBytes(run.stats.imrWrites)}（重绘率 ${run.stats.overdraw.toFixed(2)}），TBDR 只写 ${fmtBytes(run.stats.tbdrWrites)}；独立显卡还需额外经 PCIe 复制顶点与回读结果。`,
      packets: [
        pk('gpu', 'dram', 'dispeng', run.stats.fbBytes, '扫描输出', '逐行读取帧缓冲'),
        pk('gpu', 'dispeng', 'display', run.stats.fbBytes, 'eDP', '送往 XDR 屏幕'),
      ],
      highlights: ['dram-b', 'lid'],
      inspect: [['TBDR 写回', fmtBytes(run.stats.tbdrWrites)], ['立即模式估算', fmtBytes(run.stats.imrWrites)], ['重绘率', run.stats.overdraw.toFixed(2)], ['CPU↔GPU 复制', '0 B（统一内存）'], ['独立显卡需复制', fmtBytes(run.stats.vertexBytes + run.stats.fbBytes)]],
      durationUs: 8333,
      provenance: 'teaching',
      visual: fbVisual(),
      display: { mode: 'fb', fb: run.framebuffer.slice(), w: run.cfg.width, h: run.cfg.height },
    });
    return steps;
  },
};

// ---------- 5. 内存不足 ----------
function framesVisual(vm: VirtualMemory): Visual {
  return {
    type: 'frames',
    frames: vm.s.frames.map((f) => ({ use: f.use, owner: f.owner, hue: vm.s.procs.find((p) => p.pid === f.owner)?.hue })),
    procs: vm.s.procs.filter((p) => p.alive).map((p) => ({ pid: p.pid, name: p.name, hue: p.hue })),
  };
}

const memScenario: Scenario = {
  id: 'mem',
  title: '内存不足',
  summary: '多个进程不断申请内存：零页分配 → 页面压缩 → 换出到 SSD → 再次访问时缺页换入。',
  build: () => {
    const steps: FlowStep[] = [];
    const vm = new VirtualMemory();
    const pressureRow = (): [string, string][] => {
      const s = vm.summary();
      return [['物理页框', `${s.total}（缩小模型；真实 16 GB = 1,048,576 页）`], ['空闲', String(s.free)], ['压缩器占用', `${s.comp} 页框 / ${s.compressedPages} 个压缩页`], ['交换区', `${s.swapUsed} / ${s.swapTotal} 槽`], ['内存压力', PRESSURE_CN[s.pressure]]];
    };
    const phase = (title: string, detail: string, act: () => void, ticks: number) => {
      act();
      for (let i = 0; i < ticks; i++) vm.tick();
      const ev = vm.drain();
      const swapOut = ev.filter((e) => e.kind === 'swap-out').length;
      const swapIn = ev.filter((e) => e.kind === 'fault-swap').length;
      const comp = ev.filter((e) => e.kind === 'compress').length;
      const zero = ev.filter((e) => e.kind === 'fault-zero').length;
      const file = ev.filter((e) => e.kind === 'fault-file').length;
      const packets = [];
      if (zero) packets.push(pk('mem-write', 'cpu', 'dram', zero * PAGE_SIZE, '零页填充', `${zero} 次首次访问缺页`));
      if (file) packets.push(pk('storage', 'nand', 'dram', file * PAGE_SIZE, '读代码页', `${file} 次文件缺页`));
      if (comp) packets.push(pk('mem-write', 'cpu', 'dram', comp * PAGE_SIZE, '压缩页面', `${comp} 页被压缩`));
      if (swapOut) packets.push(pk('storage', 'dram', 'nand', swapOut * PAGE_SIZE, '换出', `${swapOut} 页写入交换文件`));
      if (swapIn) packets.push(pk('storage', 'nand', 'dram', swapIn * PAGE_SIZE, '换入', `${swapIn} 页从交换文件读回`));
      steps.push({
        title,
        detail,
        packets,
        highlights: swapOut || swapIn ? ['dram-a', 'dram-b', 'nand-1', 'nand-3'] : ['dram-a', 'dram-b'],
        inspect: [...pressureRow(), ['本阶段事件', `零页 ${zero} · 文件缺页 ${file} · 压缩 ${comp} · 换出 ${swapOut} · 换入 ${swapIn}`]],
        durationUs: ticks * 10000,
        provenance: 'teaching',
        visual: framesVisual(vm),
        log: ev.slice(-1)[0]?.msg,
      });
    };
    phase('开机后：内核已占用部分页框', '只有内核使用少量页框，其余空闲。', () => {}, 0);
    let a = 0;
    phase('启动“浏览器”（14 页，工作集 10）', '进程只是申请虚拟内存；随着运行逐页访问，才触发零页缺页并占用页框。', () => { a = vm.spawn('浏览器', 14, 10).pid; }, 4);
    phase('启动“编译器”（20 页，工作集 16）', '空闲页框继续减少。', () => { vm.spawn('编译器', 20, 16); }, 4);
    phase('启动“照片编辑”（22 页，工作集 18）', '空闲页框耗尽，时钟算法挑选最近未使用的页；匿名页先被压缩留在内存里，干净的代码页直接丢弃。', () => { vm.spawn('照片编辑', 22, 18); }, 5);
    phase('启动“视频导出”（30 页，工作集 26）', '压缩器容量也到上限后，只能把页面写入 SSD 上的交换文件，内存压力变为严重。', () => { vm.spawn('视频导出', 30, 26); }, 6);
    const pa = vm.proc(a)!;
    const swappedVpn = Object.values(pa.pt).find((e) => e.state === 'swapped' || e.state === 'compressed');
    phase(
      '切回“浏览器”：访问被换出的页',
      swappedVpn
        ? `浏览器访问 VPN 0x${swappedVpn.vpn.toString(16)}（状态：${swappedVpn.state === 'swapped' ? '在交换区' : '已压缩'}），产生缺页并被${swappedVpn.state === 'swapped' ? '从 SSD 读回' : '解压'}——这就是切换应用时的卡顿来源。`
        : '浏览器的页面仍在内存中。',
      () => { if (swappedVpn) vm.access(a, swappedVpn.vpn, false); },
      2,
    );
    const victim = vm.s.procs.find((p) => p.name === '视频导出');
    phase('退出“视频导出”', '进程退出后页框、压缩数据与交换槽全部释放，内存压力回落。', () => { if (victim) vm.kill(victim.pid); }, 2);
    return steps;
  },
};

// ---------- 6. 多任务 ----------
function coresVisual(s: SchedState): Visual {
  return {
    type: 'cores',
    cores: s.cores.map((c) => ({ id: c.id, kind: c.kind, thread: c.thread === null ? null : s.threads.find((t) => t.tid === c.thread)!.name })),
    queue: readyQueue(s).map((t) => `${t.name}（${QOS_CN[t.qos]}）`),
    temp: s.temp,
    rpm: s.rpm,
    pFreq: s.pFreq,
  };
}

const taskScenario: Scenario = {
  id: 'sched',
  title: '多任务运行',
  summary: '7 个线程、8 个核心：调度器按优先级与 QoS 把线程分到性能核/能效核，负载转化为功耗、温度和风扇转速。',
  build: () => {
    const steps: FlowStep[] = [];
    const s = newSched();
    const snap = (title: string, detail: string, ticks: number, act?: () => void) => {
      act?.();
      for (let i = 0; i < ticks; i++) schedTick(s);
      const running = s.cores.filter((c) => c.thread !== null);
      steps.push({
        title,
        detail,
        packets: [
          pk('power', 'pmu', 'cpu', 0, '供电', `CPU 功耗 ${s.power.cpu.toFixed(1)} W`),
          pk('thermal', 'cpu', 'heatsink', 0, '导热', `SoC ${s.temp.toFixed(1)} °C`),
          ...(s.rpm > 0 ? [pk('thermal', 'heatsink', 'fan', 0, '排热', `风扇 ${Math.round(s.rpm)} rpm`)] : []),
        ],
        highlights: ['soc', 'heatsink', 'fan-l', 'fan-r'],
        inspect: [
          ['模拟时间', `${s.timeMs} ms`],
          ['运行中', running.map((c) => `${c.kind}${c.id}:${s.threads.find((t) => t.tid === c.thread)!.name}`).join('，') || '无'],
          ['就绪队列', readyQueue(s).map((t) => t.name).join('，') || '空'],
          ['性能核频率', `${s.pFreq.toFixed(2)} GHz`],
          ['温度 / 风扇', `${s.temp.toFixed(1)} °C / ${Math.round(s.rpm)} rpm`],
          ['整机 SoC 功耗', `${s.power.total.toFixed(1)} W`],
        ],
        durationUs: ticks * s.quantumMs * 1000,
        provenance: 'teaching',
        visual: coresVisual(s),
        log: s.log.slice(-1)[0],
      });
    };
    snap('空闲：只有系统线程', '大部分核心空闲，温度低，风扇停转。', 5, () => {
      addThread(s, 'WindowServer', 'UI', 0.35, 1e9);
      addThread(s, '音乐解码', 'UT', 0.2, 1e9);
    });
    snap('加入两个后台任务', '后台（Background）QoS 只允许在能效核上运行，即使性能核空闲——省电优先。', 10, () => {
      for (const t of PRESET_THREADS.filter((x) => x.qos === 'BG')) addThread(s, t.name, t.qos, t.load, t.work);
    });
    snap('开始编译：两个计算密集线程', '“用户发起”QoS 线程被放到性能核上；功耗上升，温度开始爬升。', 30, () => {
      addThread(s, 'Xcode 编译 #1', 'IN', 0.95, 60);
      addThread(s, 'Xcode 编译 #2', 'IN', 0.95, 60);
    });
    snap('再加 4 个编译线程：核心饱和', '就绪线程多于核心时进入就绪队列等待；持续占用 CPU 的线程有效优先级会衰减，让其他线程也有机会运行。', 60, () => {
      for (let i = 3; i <= 6; i++) addThread(s, `Xcode 编译 #${i}`, 'IN', 0.95, 60);
      addThread(s, 'Safari 渲染', 'UI', 0.5, 40);
    });
    snap('持续高负载：风扇加速', '温度超过 60 °C 后自动风扇控制开始升速，热阻下降，温度趋于平衡。', 120);
    snap('编译结束', '计算任务完成，功耗下降，温度回落，风扇逐渐减速。', 200);
    return steps;
  },
};

export const SCENARIOS: Scenario[] = [bootScenario, runScenario, fileScenario, gpuScenario, memScenario, taskScenario];
