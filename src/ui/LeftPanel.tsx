import { useLab, type LabTab, type Mode } from '../store';
import { SCENARIOS } from '../sim/flows/scenarios';
import { MAX_STAGE, TEARDOWN_STEPS } from '../data/parts';
import { MACHINE } from '../data/specs';
import { PACKET_STYLE } from '../sim/flows/types';

const MODES: { id: Mode; key: string; title: string; sub: string }[] = [
  { id: 'teardown', key: 'A', title: '真实硬件拆解', sub: '逐层拆开底壳、散热与主板' },
  { id: 'dataflow', key: 'B', title: '数据流动', sub: '触发事件，检查每个数据包' },
  { id: 'chip', key: 'C', title: '深入芯片内部', sub: 'M1 Pro 教学抽象 + 指令模拟器' },
  { id: 'lab', key: '⚗', title: '计算机实验', sub: 'CPU · 内存 · SSD · GPU · 调度散热' },
];

const LABS: { id: LabTab; title: string }[] = [
  { id: 'cpu', title: 'CPU 指令实验' },
  { id: 'memory', title: '内存 / 虚拟内存实验' },
  { id: 'ssd', title: 'SSD 与文件实验' },
  { id: 'gpu', title: 'GPU 渲染实验' },
  { id: 'sched', title: '多任务与散热实验' },
];

export function LeftPanel() {
  const s = useLab();
  const stage = Math.round(s.explode * MAX_STAGE);
  return (
    <aside className="left">
      <div className="machine">
        <div className="machine-name">{MACHINE.name}</div>
        <div className="machine-sub">
          {MACHINE.model} · {MACHINE.config}
        </div>
      </div>

      <nav className="modes">
        {MODES.map((m) => (
          <button key={m.id} className={s.mode === m.id ? 'mode on' : 'mode'} onClick={() => s.setMode(m.id)}>
            <span className="mode-key">{m.key}</span>
            <span>
              <b>{m.title}</b>
              <small>{m.sub}</small>
            </span>
          </button>
        ))}
      </nav>

      {s.mode === 'teardown' && (
        <div className="group">
          <h4>拆解步骤（iFixit 流程）</h4>
          <ol className="steps">
            {TEARDOWN_STEPS.map((t) => (
              <li key={t.stage} className={t.stage === stage ? 'on' : t.stage < stage ? 'done' : ''} onClick={() => s.setExplodeStage(t.stage)}>
                <span>{t.stage}</span>
                {t.title}
              </li>
            ))}
          </ol>
        </div>
      )}

      {s.mode === 'dataflow' && (
        <div className="group">
          <h4>运行场景</h4>
          {SCENARIOS.map((sc, i) => (
            <div key={sc.id} className={s.scenarioId === sc.id ? 'scn on' : 'scn'}>
              <button onClick={() => s.loadScenario(sc.id, {})}>
                <span className="scn-n">{i + 1}</span>
                <span>
                  <b>{sc.title}</b>
                  <small>{sc.summary}</small>
                </span>
              </button>
              {s.scenarioId === sc.id &&
                sc.options?.map((o) => (
                  <label key={o.key} className="toggle small">
                    <input type="checkbox" checked={!!s.scenarioOpts[o.key]} onChange={(e) => s.loadScenario(sc.id, { ...s.scenarioOpts, [o.key]: e.target.checked })} />
                    <span>{o.label}</span>
                  </label>
                ))}
            </div>
          ))}
        </div>
      )}

      {(s.mode === 'lab' || s.mode === 'chip') && (
        <div className="group">
          <h4>实验入口</h4>
          {LABS.map((l) => (
            <button
              key={l.id}
              className={s.mode === 'lab' && s.labTab === l.id ? 'lab-btn on' : 'lab-btn'}
              onClick={() => {
                if (s.mode !== 'lab') s.setMode('lab');
                s.setLabTab(l.id);
              }}
            >
              {l.title}
            </button>
          ))}
        </div>
      )}

      {!(s.mode === 'chip' || (s.mode === 'lab' && s.labTab === 'cpu')) && (
        <div className="group">
          <h4>视图</h4>
          <label className="toggle">
            <input type="checkbox" checked={s.xray} onChange={(e) => s.set({ xray: e.target.checked })} />
            <span>透明显示（外壳半透明）</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={s.flipped} onChange={(e) => s.set({ flipped: e.target.checked, lidAngle: e.target.checked ? 0 : 112 })} />
            <span>维修姿态（合盖翻转，底壳朝上）</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={s.section.on} onChange={(e) => s.set({ section: { ...s.section, on: e.target.checked } })} />
            <span>剖切</span>
          </label>
          {s.section.on && (
            <div className="row">
              <select value={s.section.axis} onChange={(e) => s.set({ section: { ...s.section, axis: e.target.value as 'x' | 'z' } })}>
                <option value="x">沿宽度（x）</option>
                <option value="z">沿深度（z）</option>
              </select>
              <input type="range" min={-16} max={16} step={0.1} value={s.section.pos} onChange={(e) => s.set({ section: { ...s.section, pos: Number(e.target.value) } })} />
            </div>
          )}
          <label className="param">
            <span className="param-k">屏幕开合</span>
            <input type="range" min={0} max={135} value={s.lidAngle} onChange={(e) => s.set({ lidAngle: Number(e.target.value) })} />
            <b>{s.lidAngle}°</b>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={s.autoRotate} onChange={(e) => s.set({ autoRotate: e.target.checked })} />
            <span>自动环绕</span>
          </label>
        </div>
      )}

      <div className="group legend">
        <h4>数据流配色</h4>
        {Object.entries(PACKET_STYLE).map(([k, v]) => (
          <span key={k} className="lg">
            <i style={{ background: v.color }} />
            {v.label}
          </span>
        ))}
      </div>
    </aside>
  );
}
