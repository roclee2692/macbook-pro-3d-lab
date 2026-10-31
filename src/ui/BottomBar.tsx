import { useEffect } from 'react';
import { useLab } from '../store';
import { lab } from '../sim/lab';
import { MAX_STAGE, TEARDOWN_STEPS } from '../data/parts';
import { fmtUs } from '../sim/flows/types';
import { cpuBack, cpuMicro, cpuReset, cpuStep, gpuActions, schedActions, ssdActions, vmActions } from './actions';

function useLoops() {
  const playing = useLab((s) => s.playing);
  const speed = useLab((s) => s.speed);
  const mode = useLab((s) => s.mode);
  const cpuRunning = useLab((s) => s.cpuRunning);
  const labRunning = useLab((s) => s.labRunning);
  const labTab = useLab((s) => s.labTab);

  // 数据流：自动播放下一步
  useEffect(() => {
    if (!playing || mode !== 'dataflow') return;
    const id = setInterval(() => {
      const s = useLab.getState();
      if (s.stepIdx >= s.steps.length - 1 || s.steps[s.stepIdx]?.failed) s.set({ playing: false });
      else s.gotoStep(s.stepIdx + 1);
    }, 3200 / speed);
    return () => clearInterval(id);
  }, [playing, speed, mode]);

  // 拆解：自动逐步展开
  useEffect(() => {
    if (!playing || mode !== 'teardown') return;
    const id = setInterval(() => {
      const s = useLab.getState();
      const cur = Math.round(s.explode * MAX_STAGE);
      if (cur >= MAX_STAGE) s.set({ playing: false });
      else s.setExplodeStage(cur + 1);
    }, 1800 / speed);
    return () => clearInterval(id);
  }, [playing, speed, mode]);

  // CPU 连续运行
  useEffect(() => {
    if (!cpuRunning) return;
    const id = setInterval(() => {
      if (lab.cpu.halted) {
        useLab.getState().set({ cpuRunning: false });
        return;
      }
      cpuStep();
    }, 450 / speed);
    return () => clearInterval(id);
  }, [cpuRunning, speed]);

  // 内存/调度实验时钟
  useEffect(() => {
    if (!labRunning || mode !== 'lab') return;
    const id = setInterval(() => {
      if (labTab === 'memory') vmActions.tick();
      else if (labTab === 'sched') schedActions.tick(2);
    }, (labTab === 'memory' ? 600 : 100) / speed);
    return () => clearInterval(id);
  }, [labRunning, speed, mode, labTab]);
}

function Speed() {
  const speed = useLab((s) => s.speed);
  return (
    <select className="speed" value={speed} onChange={(e) => useLab.getState().set({ speed: Number(e.target.value) })} title="播放速度">
      {[0.25, 0.5, 1, 2, 4].map((v) => (
        <option key={v} value={v}>
          {v}×
        </option>
      ))}
    </select>
  );
}

function Teardown() {
  const explode = useLab((s) => s.explode);
  const playing = useLab((s) => s.playing);
  const set = useLab((s) => s.set);
  const stage = Math.round(explode * MAX_STAGE);
  const cur = TEARDOWN_STEPS[Math.min(MAX_STAGE, Math.floor(explode * MAX_STAGE + 0.001))];
  return (
    <>
      <div className="ctrl">
        <button className="btn" onClick={() => useLab.getState().setExplodeStage(Math.max(0, stage - 1))}>◀ 上一步</button>
        <button className="btn primary" onClick={() => set({ playing: !playing, flipped: true, lidAngle: 0 })}>{playing ? '❚❚ 暂停' : '▶ 自动拆解'}</button>
        <button className="btn" onClick={() => { set({ flipped: true, lidAngle: 0 }); useLab.getState().setExplodeStage(Math.min(MAX_STAGE, stage + 1)); }}>下一步 ▶</button>
        <button className="btn" onClick={() => set({ explode: 0, playing: false })}>⟲ 复原</button>
        <Speed />
      </div>
      <div className="timeline">
        <div className="tl-label">
          爆炸展开 <b>{Math.round(explode * 100)}%</b> · 第 {cur.stage} 步：{cur.title}
          <span className="dim"> — {cur.note}</span>
        </div>
        <input className="tl-range" type="range" min={0} max={100} value={Math.round(explode * 100)} onChange={(e) => set({ explode: Number(e.target.value) / 100, playing: false })} />
        <div className="ticks">
          {TEARDOWN_STEPS.map((t) => (
            <span key={t.stage} className={t.stage <= stage ? 'on' : ''} style={{ left: `${(t.stage / MAX_STAGE) * 100}%` }} onClick={() => useLab.getState().setExplodeStage(t.stage)} title={t.title} />
          ))}
        </div>
      </div>
    </>
  );
}

function Dataflow() {
  const s = useLab();
  const total = s.steps.reduce((a, x) => a + x.durationUs, 0);
  return (
    <>
      <div className="ctrl">
        <button className="btn" disabled={!s.steps.length} onClick={() => s.gotoStep(s.stepIdx - 1)}>◀</button>
        <button className="btn primary" disabled={!s.steps.length} onClick={() => s.set({ playing: !s.playing })}>{s.playing ? '❚❚ 暂停' : '▶ 播放'}</button>
        <button className="btn" disabled={!s.steps.length} onClick={() => s.gotoStep(s.stepIdx + 1)}>单步 ▶</button>
        <button className="btn" disabled={!s.scenarioId} onClick={() => s.scenarioId && s.loadScenario(s.scenarioId)}>⟲ 重置</button>
        <Speed />
      </div>
      <div className="timeline">
        <div className="tl-label">
          {s.steps.length ? (
            <>
              模拟时间 <b>{fmtUs(s.simTimeMs * 1000)}</b> / {fmtUs(total)} · 步骤 {s.stepIdx + 1}/{s.steps.length}
              <span className="dim">（各步按模型耗时计时；动画速度与真实时间不成比例）</span>
            </>
          ) : (
            '选择左侧的一个场景开始'
          )}
        </div>
        <div className="segs">
          {s.steps.map((st, i) => (
            <button key={i} className={`seg ${i === s.stepIdx ? 'on' : i < s.stepIdx ? 'done' : ''} ${st.failed ? 'fail' : ''}`} onClick={() => s.gotoStep(i)} title={st.title}>
              <span>{i + 1}</span>
              {st.title}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function CpuBar() {
  useLab((s) => s.rev);
  const running = useLab((s) => s.cpuRunning);
  const m = lab.cpu;
  const n = m.history.length;
  return (
    <>
      <div className="ctrl">
        <button className="btn" disabled={!n} onClick={cpuBack} title="撤销上一条指令">⟲ 回退</button>
        <button className="btn" disabled={m.halted} onClick={() => cpuMicro()} title="推进一个流水阶段">微步（阶段）</button>
        <button className="btn" disabled={m.halted} onClick={() => cpuStep()}>单步（指令）</button>
        <button className="btn primary" disabled={m.halted} onClick={() => useLab.getState().set({ cpuRunning: !running })}>{running ? '❚❚ 暂停' : '▶ 连续执行'}</button>
        <button className="btn" onClick={cpuReset}>重置</button>
        <Speed />
      </div>
      <div className="timeline">
        <div className="tl-label">
          指令历史 <b>{m.retired}</b> 条已退休 · {m.cycle} 周期 · PC 0x{m.pc.toString(16)}
          {m.cur && <span className="dim"> · 当前指令处于 {m.cur.done[m.cur.done.length - 1]} 阶段</span>}
          {m.halted && <span className="dim"> · {m.haltReason}</span>}
        </div>
        <input
          className="tl-range"
          type="range"
          min={0}
          max={Math.max(n, 1)}
          value={n}
          onChange={(e) => {
            const target = Number(e.target.value);
            while (lab.cpu.history.length > target && lab.cpu.stepBack());
            while (lab.cpu.history.length < target && !lab.cpu.halted) lab.cpu.step();
            useLab.getState().addLog('回放', `跳到第 ${target} 条指令处（通过撤销/重新执行实现，结果确定）`);
            useLab.getState().bump();
          }}
          title="拖动回放：向左撤销、向右重新执行"
        />
      </div>
    </>
  );
}

function TickBar({ kind }: { kind: 'memory' | 'sched' }) {
  useLab((s) => s.rev);
  const running = useLab((s) => s.labRunning);
  const histIdx = useLab((s) => s.histIdx);
  const hist = kind === 'memory' ? lab.vmHistory : lab.schedHistory;
  const now = kind === 'memory' ? `t = ${lab.vm.s.tick} 个时间片` : `${lab.sched.timeMs} ms`;
  return (
    <>
      <div className="ctrl">
        <button className="btn" onClick={() => (kind === 'memory' ? vmActions.tick() : schedActions.tick(1))}>单步</button>
        <button className="btn primary" onClick={() => useLab.getState().set({ labRunning: !running, histIdx: null })}>{running ? '❚❚ 暂停' : '▶ 运行'}</button>
        <button className="btn" onClick={() => (kind === 'memory' ? vmActions.reset() : schedActions.reset())}>重置实验</button>
        <Speed />
      </div>
      <div className="timeline">
        <div className="tl-label">
          {kind === 'memory' ? '内存实验' : '调度实验'} · {now} · 快照 {hist.length}
          {histIdx !== null && <b className="warn"> · 回放第 {histIdx + 1} 个快照</b>}
        </div>
        <input
          className="tl-range"
          type="range"
          min={0}
          max={Math.max(0, hist.length - 1)}
          value={histIdx ?? Math.max(0, hist.length - 1)}
          disabled={!hist.length}
          onChange={(e) => {
            const i = Number(e.target.value);
            if (kind === 'memory') vmActions.replay(i >= hist.length - 1 ? null : i);
            else {
              useLab.getState().set({ histIdx: i >= hist.length - 1 ? null : i, labRunning: false });
              useLab.getState().bump();
            }
          }}
        />
      </div>
    </>
  );
}

function SimpleBar({ kind }: { kind: 'ssd' | 'gpu' }) {
  useLab((s) => s.rev);
  return (
    <>
      <div className="ctrl">
        {kind === 'gpu' ? (
          <>
            <button className="btn primary" onClick={() => gpuActions.next()}>下一阶段 ▶</button>
            <button className="btn" onClick={() => gpuActions.runAll()}>一次完成</button>
            <button className="btn" onClick={() => gpuActions.reset()}>重置</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => ssdActions.drop()}>清空页缓存</button>
            <button className="btn" onClick={() => ssdActions.reset()}>重置</button>
          </>
        )}
      </div>
      <div className="timeline">
        <div className="tl-label">
          {kind === 'gpu'
            ? `GPU 阶段：${lab.gpu.phase} · tile ${lab.gpu.tileCursor}/${lab.gpu.tiles.length || '—'}`
            : `NAND 读 ${lab.ssd.s.stats.nandReads} 次 · 写 ${lab.ssd.s.stats.nandWrites} 次 · 页缓存 ${lab.ssd.s.cache.length}/${lab.ssd.s.cfg.cacheBlocks} 块`}
        </div>
      </div>
    </>
  );
}

export function BottomBar() {
  useLoops();
  const mode = useLab((s) => s.mode);
  const labTab = useLab((s) => s.labTab);
  let body;
  if (mode === 'teardown') body = <Teardown />;
  else if (mode === 'dataflow') body = <Dataflow />;
  else if (mode === 'chip' || labTab === 'cpu') body = <CpuBar />;
  else if (labTab === 'memory' || labTab === 'sched') body = <TickBar kind={labTab} />;
  else body = <SimpleBar kind={labTab} />;
  return <footer className="bottom">{body}</footer>;
}
