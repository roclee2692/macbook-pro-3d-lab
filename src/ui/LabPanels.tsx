import { useState } from 'react';
import { useLab } from '../store';
import { lab } from '../sim/lab';
import { PAGE_SIZE, PRESSURE_CN, REAL_FRAMES, VirtualMemory, type VmState } from '../sim/memory/vm';
import { BLOCK } from '../sim/storage/ssd';
import { QOS_CN, effPriority, readyQueue, P_MAX_GHZ, E_MAX_GHZ, type QoS } from '../sim/sched/sched';
import { fmtBytes, fmtUs } from '../sim/flows/types';
import { Btn, Fixed, KV, Param, Section, Sparkline, Toggle } from './common';
import { FbCanvas, FrameGrid, IoTimeline, CoreGrid } from './Visuals';
import { gpuActions, schedActions, ssdActions, vmActions } from './actions';

// ====================== 内存 ======================
const APPS = [
  { name: '浏览器', pages: 14, ws: 10 },
  { name: '编译器', pages: 20, ws: 16 },
  { name: '照片编辑', pages: 22, ws: 18 },
  { name: '视频导出', pages: 30, ws: 26 },
  { name: '文本编辑', pages: 4, ws: 3 },
];

function viewVm(): VmState {
  const idx = useLab.getState().histIdx;
  return idx !== null && lab.vmHistory[idx] ? lab.vmHistory[idx] : lab.vm.s;
}

export function MemoryPanel() {
  useLab((s) => s.rev);
  const histIdx = useLab((s) => s.histIdx);
  const s = viewVm();
  const view = new VirtualMemory(s.cfg);
  view.s = s;
  const sum = view.summary();
  const alive = s.procs.filter((p) => p.alive);
  const [sel, setSel] = useState<number | null>(null);
  const [va, setVa] = useState('0x1000000');
  const proc = alive.find((p) => p.pid === sel) ?? alive[0];
  const vaNum = Number(va) || 0;
  const tr = proc ? view.translate(proc.pid, vaNum) : null;
  const ro = histIdx !== null;
  const cfg = lab.vmCfg;
  const setCfg = (p: Partial<typeof cfg>) => {
    Object.assign(lab.vmCfg, p);
    vmActions.reset();
  };
  return (
    <div className="panel">
      {ro && (
        <div className="replay-banner">
          正在回放快照 t={s.tick}（只读）
          <Btn onClick={() => vmActions.resumeFrom(histIdx!)}>从这里继续</Btn>
          <Btn onClick={() => vmActions.replay(null)}>回到实时</Btn>
        </div>
      )}
      <Section title="物理内存页框" badge="teaching">
        <FrameGrid frames={s.frames.map((f) => ({ use: f.use, owner: f.owner, hue: s.procs.find((p) => p.pid === f.owner)?.hue }))} procs={alive.map((p) => ({ pid: p.pid, name: p.name, hue: p.hue }))} />
        <div className={`pressure ${sum.pressure}`}>
          内存压力：<b>{PRESSURE_CN[sum.pressure]}</b>
          <span>空闲 {sum.free}/{sum.total}</span>
          <span>压缩 {sum.compressedPages} 页（占 {sum.comp} 框）</span>
          <span>交换 {sum.swapUsed}/{sum.swapTotal}</span>
        </div>
        <KV
          rows={[
            ['换出 / 换入', `${s.stats.pageOuts} / ${s.stats.pageIns}（SSD 写 ${fmtBytes(s.stats.swapBytesWritten)}，读 ${fmtBytes(s.stats.swapBytesRead)}）`],
            ['压缩 / 解压', `${s.stats.compressions} / ${s.stats.decompressions}`],
            ['零页 / 文件页缺页', `${s.stats.zeroFills} / ${s.stats.fileReads}`],
          ]}
        />
      </Section>

      <Section title="进程">
        <div className="row wrap">
          {APPS.map((a) => (
            <Btn key={a.name} disabled={ro} onClick={() => vmActions.spawn(a.name, a.pages, a.ws)}>
              + {a.name}（{a.pages} 页）
            </Btn>
          ))}
        </div>
        <table className="kv procs">
          <thead>
            <tr>
              <th>进程</th>
              <th>驻留/虚拟</th>
              <th>缺页 次/主</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {alive.map((p) => {
              const ents = Object.values(p.pt);
              const res = ents.filter((e) => e.state === 'resident').length;
              return (
                <tr key={p.pid} className={proc?.pid === p.pid ? 'on' : ''} onClick={() => setSel(p.pid)}>
                  <th>
                    <i className="dot" style={{ background: `hsl(${p.hue} 65% 45%)` }} />
                    {p.name} <small>pid {p.pid}</small>
                  </th>
                  <td>
                    {res}/{ents.length}
                  </td>
                  <td>
                    {p.minorFaults}/{p.majorFaults}
                  </td>
                  <td className="ops">
                    <button disabled={ro} onClick={() => vmActions.malloc(p.pid, 4)}>malloc 4</button>
                    <button disabled={ro} onClick={() => vmActions.free(p.pid, 4)}>free 4</button>
                    <button disabled={ro} onClick={() => vmActions.kill(p.pid)}>退出</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {proc && (
          <Param label={`${proc.name} 工作集`} value={proc.workingSet} min={1} max={40} unit=" 页" onChange={(v) => !ro && vmActions.setWs(proc.pid, v)} note="每个时间片 90% 的访问落在工作集内" />
        )}
      </Section>

      {proc && (
        <Section title={`${proc.name} 的页表（VA → 物理页框）`}>
          <div className="pt scroll">
            {Object.values(proc.pt).map((e) => (
              <div key={e.vpn} className={`pte ${e.state}`} title={`VPN 0x${e.vpn.toString(16)}`} onClick={() => !ro && vmActions.touch(proc.pid, e.vpn, true)}>
                <code>0x{(e.vpn * PAGE_SIZE).toString(16)}</code>
                <span>{e.kind === 'code' ? '代码' : '堆'}</span>
                <b>
                  {e.state === 'resident' ? `→ 框 #${e.frame}` : e.state === 'unmapped' ? '未分配' : e.state === 'file' ? '在文件中' : e.state === 'compressed' ? '已压缩' : `交换槽 #${e.swapSlot}`}
                </b>
                <small>{e.dirty ? '脏' : ''}{e.referenced ? ' R' : ''}</small>
              </div>
            ))}
          </div>
          <div className="dim small">点击一页可模拟写访问（观察缺页类型）。</div>
          <div className="row">
            <span>虚拟地址</span>
            <input value={va} onChange={(e) => setVa(e.target.value)} />
          </div>
          {tr && (
            <div className="xlat">
              VA {va} → VPN 0x{tr.vpn.toString(16)} + 偏移 0x{tr.offset.toString(16)} →{' '}
              {tr.pte ? (tr.pa !== null ? `物理地址 0x${tr.pa.toString(16)}（页框 #${tr.pte.frame}）` : `页不在内存（${tr.pte.state}）→ 访问将触发页错误`) : '无映射 → 段错误'}
            </div>
          )}
        </Section>
      )}

      <Section title="参数">
        <Param label="物理页框数" value={cfg.frames} min={24} max={128} step={8} onChange={(v) => setCfg({ frames: v })} />
        <Toggle label="内存压缩器" value={cfg.compressor} onChange={(v) => setCfg({ compressor: v })} />
        <Param label="压缩比（页/框）" value={cfg.compressRatio} min={1} max={4} onChange={(v) => setCfg({ compressRatio: v })} />
        <Toggle label="SSD 交换区" value={cfg.swap} onChange={(v) => setCfg({ swap: v })} />
        <Param label="每时间片访问次数" value={cfg.accessesPerTick} min={4} max={64} step={4} onChange={(v) => { lab.vmCfg.accessesPerTick = v; lab.vm.s.cfg.accessesPerTick = v; useLab.getState().bump(); }} />
        <Fixed
          rows={[
            { k: '页大小', v: '16 KB', p: 'official' },
            { k: '统一内存', v: `16 GB = ${REAL_FRAMES.toLocaleString()} 页`, p: 'official' },
            { k: '先压缩后换出', v: 'macOS 内存压缩器行为（简化）', p: 'derived' },
          ]}
        />
      </Section>
    </div>
  );
}

// ====================== SSD ======================
export function SsdPanel() {
  useLab((s) => s.rev);
  const ssd = lab.ssd;
  const [name, setName] = useState('/Users/me/report.txt');
  const [size, setSize] = useState(64);
  const [content, setContent] = useState('实验报告：顺序读取比随机读取快，因为预读让多个 NAND 通道并行工作。');
  const last = lab.ssdResults[0];
  const cfg = lab.ssdCfg;
  const setCfg = (p: Partial<typeof cfg>) => {
    Object.assign(lab.ssdCfg, p);
    ssdActions.reset();
  };
  return (
    <div className="panel">
      <Section title="文件">
        <table className="kv files">
          <thead>
            <tr>
              <th>路径</th>
              <th>大小</th>
              <th>缓存</th>
              <th>读取</th>
            </tr>
          </thead>
          <tbody>
            {ssd.s.files.map((f) => {
              const cached = f.lbas.filter((l) => ssd.inCache(l)).length;
              return (
                <tr key={f.path}>
                  <th title={`inode ${f.inode} · LBA ${f.lbas[0]}–${f.lbas[f.lbas.length - 1]}`}>{f.path}</th>
                  <td>{fmtBytes(f.size)}</td>
                  <td>
                    {cached}/{f.lbas.length}
                  </td>
                  <td className="ops">
                    <button onClick={() => ssdActions.read(f.path, 'seq')}>顺序</button>
                    <button onClick={() => ssdActions.read(f.path, 'rand')}>随机</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row">
          <Btn onClick={() => ssdActions.drop()}>清空页缓存（模拟冷启动）</Btn>
          <Btn onClick={() => ssdActions.reset()}>重置</Btn>
        </div>
      </Section>
      <Section title="创建并保存文件">
        <div className="form">
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <textarea rows={2} value={content} onChange={(e) => setContent(e.target.value)} />
          <Param label="文件大小" value={size} min={4} max={512} step={4} unit=" KB" onChange={setSize} />
          <Btn primary onClick={() => ssdActions.save(name, content, size)}>
            保存（write + fsync）
          </Btn>
        </div>
      </Section>
      {last && (
        <Section title={`最近一次读取：${last.file.split('/').pop()}（${last.pattern === 'seq' ? '顺序' : '随机'}）`} badge="teaching">
          <IoTimeline ios={last.ios} totalUs={last.totalUs} />
          <KV
            rows={[
              ['缓存命中 / 预读 / 按需读', `${last.hits} / ${last.prefetched} / ${last.misses}`],
              ['耗时', fmtUs(last.totalUs)],
              ['吞吐', `${last.mbps.toFixed(0)} MB/s`],
              ['路径', last.misses + last.prefetched ? 'NAND → SSD 控制器 → DMA → 页缓存（内存）→ CPU' : '页缓存（内存）→ CPU'],
            ]}
          />
          {lab.ssdResults.length > 1 && (
            <table className="kv">
              <thead>
                <tr>
                  <th>历史</th>
                  <th>方式</th>
                  <th>命中</th>
                  <th>耗时</th>
                </tr>
              </thead>
              <tbody>
                {lab.ssdResults.map((r, i) => (
                  <tr key={i}>
                    <th>{r.file.split('/').pop()}</th>
                    <td>{r.pattern === 'seq' ? '顺序' : '随机'}</td>
                    <td>
                      {r.hits}/{r.hits + r.prefetched + r.misses}
                    </td>
                    <td>{fmtUs(r.totalUs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}
      <Section title="参数">
        <Param label="页缓存容量" value={cfg.cacheBlocks} min={8} max={256} step={8} unit=" 块" onChange={(v) => setCfg({ cacheBlocks: v })} />
        <Param label="顺序预读" value={cfg.readahead} min={0} max={32} unit=" 块" onChange={(v) => setCfg({ readahead: v })} />
        <Param label="NAND 读取时间 tR" value={cfg.nandReadUs} min={20} max={120} step={5} unit=" µs" onChange={(v) => setCfg({ nandReadUs: v })} />
        <Param label="NAND 通道" value={cfg.channels} min={1} max={8} onChange={(v) => setCfg({ channels: v })} />
        <Fixed
          rows={[
            { k: '容量', v: '512 GB', p: 'official' },
            { k: 'NAND', v: 'Kioxia 128 GB × 4（数量推算）', p: 'derived' },
            { k: 'SSD 控制器', v: '集成在 M1 Pro 内', p: 'derived' },
            { k: '逻辑块', v: `${BLOCK} B`, p: 'teaching' },
          ]}
        />
      </Section>
    </div>
  );
}

// ====================== GPU ======================
const PHASE_CN: Record<string, string> = { idle: '待开始', encode: 'CPU 已编码命令', vertex: '顶点已处理', tiling: '已分块', raster: '光栅化中', present: '等待显示', done: '完成' };

export function GpuPanel() {
  useLab((s) => s.rev);
  const r = lab.gpu;
  const cfg = lab.gpuCfg;
  const setCfg = (p: Partial<typeof cfg>) => {
    Object.assign(lab.gpuCfg, p);
    gpuActions.reset();
  };
  return (
    <div className="panel">
      <Section title={`帧缓冲（${r.cfg.width}×${r.cfg.height}）· ${PHASE_CN[r.phase]}`} badge="teaching">
        <FbCanvas fb={r.framebuffer} w={r.cfg.width} h={r.cfg.height} tile={r.cfg.tile} tiles={r.tiles.length} tilesDone={r.tileCursor} cores={r.tiles.map((t) => t.core)} />
        <div className="row">
          <Btn primary onClick={() => gpuActions.next()}>
            {r.phase === 'done' ? '重新开始' : '下一阶段'}
          </Btn>
          <Btn onClick={() => gpuActions.runAll()}>一次完成</Btn>
          <Btn onClick={() => gpuActions.reset()}>重置</Btn>
        </div>
        <div className="dim small">tile 左上角小色块 = 负责该 tile 的 GPU 核心（轮转分配，教学抽象）。</div>
      </Section>
      <Section title="统一内存中的缓冲区">
        <table className="kv">
          <thead>
            <tr>
              <th>缓冲</th>
              <th>物理地址（示意）</th>
              <th>写入者 → 读取者</th>
            </tr>
          </thead>
          <tbody>
            {r.buffers.map((b) => (
              <tr key={b.name}>
                <th>{b.name}</th>
                <td>
                  0x{b.addr.toString(16)} · {fmtBytes(b.bytes)}
                </td>
                <td>
                  {b.writer} → {b.readers.join('、')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!r.buffers.length && <div className="dim">点击“下一阶段”让 CPU 写入顶点并编码命令。</div>}
        <div className="cmp">
          <div>
            <b>Apple 统一内存</b>
            <span>CPU 写入的地址 = GPU 读取的地址，复制 0 B</span>
          </div>
          <div>
            <b>对照：独立显卡</b>
            <span>需经 PCIe 复制顶点 {fmtBytes(r.stats.vertexBytes)}，回读帧缓冲 {fmtBytes(r.stats.fbBytes)}</span>
          </div>
        </div>
      </Section>
      {r.commands.length > 0 && (
        <Section title="命令缓冲（CPU 编码）">
          <ol className="cmds">
            {r.commands.map((c, i) => (
              <li key={i}>
                <code>{c.op}</code> {c.args}
              </li>
            ))}
          </ol>
        </Section>
      )}
      {r.phase === 'done' && (
        <Section title="带宽对比">
          <KV
            rows={[
              ['TBDR 写回帧缓冲', fmtBytes(r.stats.tbdrWrites)],
              ['立即模式估算写入', fmtBytes(r.stats.imrWrites)],
              ['重绘率', r.stats.overdraw.toFixed(2)],
            ]}
          />
        </Section>
      )}
      <Section title="参数">
        <Param label="三角形数" value={cfg.triangles} min={1} max={16} onChange={(v) => setCfg({ triangles: v })} />
        <Param label="旋转角度" value={cfg.angle} min={0} max={360} step={5} unit="°" onChange={(v) => setCfg({ angle: v })} />
        <Param label="tile 尺寸" value={cfg.tile} min={8} max={32} step={8} unit=" px" onChange={(v) => setCfg({ tile: v })} />
        <Fixed
          rows={[
            { k: 'GPU 核心', v: '14', p: 'official' },
            { k: '渲染架构', v: '基于分块的延迟渲染（TBDR）', p: 'derived' },
            { k: '内存', v: 'CPU/GPU 共享 16 GB 统一内存，200 GB/s', p: 'official' },
          ]}
        />
      </Section>
    </div>
  );
}

// ====================== 调度与散热 ======================
const QOS_LIST: QoS[] = ['UI', 'IN', 'UT', 'BG'];

export function SchedPanel() {
  useLab((s) => s.rev);
  const histIdx = useLab((s) => s.histIdx);
  const s = histIdx !== null && lab.schedHistory[histIdx] ? lab.schedHistory[histIdx] : lab.sched;
  const live = histIdx === null;
  const [qos, setQos] = useState<QoS>('IN');
  const [load, setLoad] = useState(90);
  const th = lab.sched.thermal;
  const h = s.history;
  return (
    <div className="panel">
      <Section title="核心占用" badge="teaching">
        <CoreGrid cores={s.cores.map((c) => ({ id: c.id, kind: c.kind, thread: c.thread === null ? null : s.threads.find((t) => t.tid === c.thread)?.name ?? null }))} queue={readyQueue(s).map((t) => `${t.name}（优先级 ${effPriority(t)}）`)} />
      </Section>
      <Section title="线程">
        <div className="row wrap">
          <select value={qos} onChange={(e) => setQos(e.target.value as QoS)}>
            {QOS_LIST.map((q) => (
              <option key={q} value={q}>
                {QOS_CN[q]}
              </option>
            ))}
          </select>
          <Param label="负载" value={load} min={5} max={100} step={5} unit="%" onChange={setLoad} />
          <Btn primary disabled={!live} onClick={() => schedActions.add(`${QOS_CN[qos]}任务 ${lab.sched.nextTid}`, qos, load / 100, 40)}>
            添加线程
          </Btn>
        </div>
        <table className="kv threads">
          <thead>
            <tr>
              <th>线程</th>
              <th>QoS</th>
              <th>优先级</th>
              <th>状态</th>
              <th>进度</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.threads
              .filter((t) => t.state !== 'finished')
              .map((t) => (
                <tr key={t.tid}>
                  <th>
                    #{t.tid} {t.name}
                  </th>
                  <td>{QOS_CN[t.qos]}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={63}
                      value={t.priority}
                      disabled={!live}
                      onChange={(e) => {
                        const tt = lab.sched.threads.find((x) => x.tid === t.tid);
                        if (tt) tt.priority = Number(e.target.value);
                        useLab.getState().addLog('实验参数', `线程 #${t.tid} 优先级 → ${e.target.value}`);
                        useLab.getState().bump();
                      }}
                    />
                    <small> 有效 {effPriority(t)}</small>
                  </td>
                  <td>{t.state === 'running' ? `运行于 ${s.cores[t.core!].kind}${t.core}` : t.state === 'ready' ? '就绪' : '阻塞'}</td>
                  <td>{t.work > 1e6 ? '常驻' : `${Math.min(100, (t.done / t.work) * 100).toFixed(0)}%`}</td>
                  <td>
                    <button disabled={!live} onClick={() => schedActions.remove(t.tid)}>
                      结束
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="row wrap">
          <Btn disabled={!live} onClick={() => ['Xcode 编译 #1', 'Xcode 编译 #2', 'Xcode 编译 #3', 'Xcode 编译 #4'].forEach((n) => schedActions.add(n, 'IN', 0.95, 60))}>
            + 4 个编译线程
          </Btn>
          <Btn disabled={!live} onClick={() => schedActions.add('Spotlight 索引', 'BG', 0.8, 30)}>+ 后台索引</Btn>
          <Btn disabled={!live} onClick={() => schedActions.add('WindowServer', 'UI', 0.35, 1e9)}>+ WindowServer</Btn>
        </div>
      </Section>
      <Section title="功耗 · 温度 · 风扇" badge="teaching">
        <div className="meters">
          <div>
            <b>{s.temp.toFixed(1)} °C</b>
            <span>SoC 温度</span>
            <Sparkline data={h.map((x) => x.temp)} color="#ff8a3d" min={20} max={110} />
          </div>
          <div>
            <b>{Math.round(s.rpm)} rpm</b>
            <span>风扇转速</span>
            <Sparkline data={h.map((x) => x.rpm)} color="#38bdf8" min={0} max={6000} />
          </div>
          <div>
            <b>{s.power.total.toFixed(1)} W</b>
            <span>SoC 功耗</span>
            <Sparkline data={h.map((x) => x.power)} color="#ff4d5e" min={0} max={40} />
          </div>
          <div>
            <b>{s.pFreq.toFixed(2)} GHz</b>
            <span>性能核频率{s.throttled ? ' · 降频中' : ''}</span>
            <Sparkline data={h.map((x) => x.pFreq)} color="#34d399" min={0.5} max={3.4} />
          </div>
        </div>
        <Param label="环境温度" value={th.ambient} min={10} max={40} unit=" °C" onChange={(v) => { th.ambient = v; useLab.getState().addLog('实验参数', `环境温度 → ${v} °C`); useLab.getState().bump(); }} />
        <div className="row">
          <i className="tag-sim">实验参数</i>风扇
          <select
            value={th.fanMode}
            onChange={(e) => {
              th.fanMode = e.target.value as typeof th.fanMode;
              useLab.getState().addLog('实验参数', `风扇模式 → ${{ auto: '自动', manual: '手动', failed: '故障（停转）' }[th.fanMode]}`, th.fanMode === 'failed' ? 'warn' : 'info');
              useLab.getState().bump();
            }}
          >
            <option value="auto">自动</option>
            <option value="manual">手动</option>
            <option value="failed">故障（停转）</option>
          </select>
        </div>
        {th.fanMode === 'manual' && <Param label="手动转速" value={th.manualRpm} min={0} max={5800} step={100} unit=" rpm" onChange={(v) => { th.manualRpm = v; useLab.getState().bump(); }} />}
        <Param label="降频温度阈值" value={th.throttleAt} min={70} max={105} unit=" °C" onChange={(v) => { th.throttleAt = v; useLab.getState().bump(); }} />
        <Fixed
          rows={[
            { k: 'CPU 核心', v: '6 性能核 + 2 能效核', p: 'official' },
            { k: '性能核最高频率', v: `${P_MAX_GHZ} GHz`, p: 'derived' },
            { k: '能效核最高频率', v: `${E_MAX_GHZ} GHz`, p: 'derived' },
            { k: '风扇', v: '双风扇（转速曲线为教学近似）', p: 'teardown' },
          ]}
        />
      </Section>
    </div>
  );
}
