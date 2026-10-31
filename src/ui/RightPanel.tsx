import { useEffect, useRef } from 'react';
import { useLab } from '../store';
import { CHIPS, PARTS, partById } from '../data/parts';
import { sourceById } from '../data/sources';
import { BLOCKS, CORE } from '../three/ChipScene';
import { NODE_CN, PACKET_STYLE, fmtBytes, fmtUs } from '../sim/flows/types';
import { KV, Section } from './common';
import { VisualView } from './Visuals';
import { CpuPanel } from './CpuPanel';
import { GpuPanel, MemoryPanel, SchedPanel, SsdPanel } from './LabPanels';

function PacketCard() {
  const p = useLab((s) => s.selectedPacket);
  if (!p) return null;
  const st = PACKET_STYLE[p.kind];
  return (
    <Section title="数据包" right={<button className="link" onClick={() => useLab.getState().set({ selectedPacket: null })}>关闭</button>}>
      <div className="pkt-card" style={{ borderColor: st.color }}>
        <KV
          rows={[
            ['类型', <span key="k"><i className="dot" style={{ background: st.color }} />{st.label}</span>],
            ['来源', NODE_CN[p.from]],
            ['目标', NODE_CN[p.to]],
            ['数据大小', p.bytes ? fmtBytes(p.bytes) : '—（能量/信号）'],
            ['操作', p.op],
            ['发生原因', p.reason],
            ...(p.addr ? ([['地址', p.addr]] as [string, string][]) : []),
          ]}
        />
      </div>
    </Section>
  );
}

function PartInfo() {
  const id = useLab((s) => s.selected);
  if (!id) return <div className="hint">点击三维模型中的任意部件或芯片，查看功能、连接关系与工作原理。</div>;
  const part = partById(id);
  const chip = CHIPS.find((c) => c.id === id);
  const block = [...BLOCKS, ...CORE].find((b) => b.id === id);
  const select = (x: string) => useLab.getState().select(x);
  if (part)
    return (
      <Section title={part.name} badge={part.provenance}>
        <div className="en">{part.en}</div>
        <p>
          <b>功能</b>　{part.role}
        </p>
        <p>
          <b>原理</b>　{part.principle}
        </p>
        <div className="links">
          <b>连接</b>
          {part.links.map((l) => (
            <button key={l} className="chip-link" onClick={() => select(l)}>
              {partById(l)?.name ?? l}
            </button>
          ))}
        </div>
        {part.linkNote && <p className="dim small">{part.linkNote}</p>}
        <Sources ids={part.sources} />
      </Section>
    );
  if (chip)
    return (
      <Section title={chip.name} badge={chip.provenance}>
        <KV rows={[['型号', chip.part], ['位置', `主板第 ${chip.side} 面（${chip.side === 1 ? '朝键盘/散热器' : '朝底壳'}）`], ['作用', chip.role]]} />
        {chip.id === 'soc' && (
          <>
            <p className="dim small">统一内存（两颗 LPDDR5）与 SoC 同封装，NAND 焊在主板上——都不是可插拔的内存条或硬盘。</p>
            <button className="btn primary" onClick={() => useLab.getState().setMode('chip')}>
              进入芯片内部 →
            </button>
          </>
        )}
        <div className="links">
          <b>相关</b>
          <button className="chip-link" onClick={() => select('logicboard')}>
            主逻辑板
          </button>
        </div>
        <Sources ids={['ifixit-chipid']} />
      </Section>
    );
  if (block)
    return (
      <Section title={block.label} badge="teaching">
        <p>{block.info}</p>
      </Section>
    );
  if (id === 'touchid') return <Section title="Touch ID" badge="official"><p>键盘右上角的指纹传感器，兼作电源键；指纹数据由安全隔区处理。</p></Section>;
  return null;
}

function Sources({ ids }: { ids: string[] }) {
  return (
    <div className="sources">
      {ids.map((i) => {
        const s = sourceById(i);
        return s ? (
          <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.note}>
            {s.title}
          </a>
        ) : null;
      })}
    </div>
  );
}

function StepInfo() {
  const steps = useLab((s) => s.steps);
  const idx = useLab((s) => s.stepIdx);
  const st = steps[idx];
  if (!st) return <div className="hint">在左侧选择一个场景。每一步都有可检查的状态；点击三维中移动的数据包查看来源、目标、大小与原因。</div>;
  return (
    <Section title={`步骤 ${idx + 1}/${steps.length} · ${st.title}`} badge={st.provenance}>
      <p className={st.failed ? 'error' : ''}>{st.detail}</p>
      <KV rows={st.inspect} />
      <div className="dim small">模型耗时：{fmtUs(st.durationUs)}</div>
      {st.visual && <VisualView v={st.visual} />}
      <h4 className="sub">本步数据包</h4>
      <div className="pkts">
        {st.packets.map((p) => (
          <button key={p.id} className="pkt" style={{ borderLeftColor: PACKET_STYLE[p.kind].color }} onClick={() => useLab.getState().set({ selectedPacket: p })}>
            <b>{p.op}</b>
            <span>
              {NODE_CN[p.from]} → {NODE_CN[p.to]}
              {p.bytes ? ` · ${fmtBytes(p.bytes)}` : ''}
            </span>
          </button>
        ))}
        {!st.packets.length && <span className="dim">无</span>}
      </div>
    </Section>
  );
}

function EventLog() {
  const log = useLab((s) => s.log);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log]);
  return (
    <div className="log">
      <header>
        <b>事件日志</b>
        <button className="link" onClick={() => useLab.getState().set({ log: [] })}>
          清空
        </button>
      </header>
      <div className="log-body" ref={ref}>
        {log.map((l) => (
          <div key={l.id} className={`log-row ${l.kind}`}>
            <i style={{ background: l.kind in PACKET_STYLE ? PACKET_STYLE[l.kind as keyof typeof PACKET_STYLE].color : undefined }} />
            <time>{l.time}</time>
            <b>{l.src}</b>
            <span>{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RightPanel() {
  const mode = useLab((s) => s.mode);
  const labTab = useLab((s) => s.labTab);
  const selected = useLab((s) => s.selected);
  let body;
  if (mode === 'teardown') body = <PartInfo />;
  else if (mode === 'dataflow') body = <StepInfo />;
  else if (mode === 'chip') body = <>{selected && <PartInfo />}<CpuPanel /></>;
  else
    body = {
      cpu: <CpuPanel />,
      memory: <MemoryPanel />,
      ssd: <SsdPanel />,
      gpu: <GpuPanel />,
      sched: <SchedPanel />,
    }[labTab];
  return (
    <aside className="right">
      <div className="right-body">
        <PacketCard />
        {mode !== 'teardown' && mode !== 'dataflow' && mode !== 'chip' && selected && PARTS.some((p) => p.id === selected) && <PartInfo />}
        {body}
      </div>
      <EventLog />
    </aside>
  );
}
