import { useEffect } from 'react';
import { Stage } from './three/Stage';
import { LeftPanel } from './ui/LeftPanel';
import { RightPanel } from './ui/RightPanel';
import { BottomBar } from './ui/BottomBar';
import { useLab } from './store';
import { PROVENANCE_HINT, PROVENANCE_LABEL, type Provenance } from './data/sources';

const MODE_TITLE = { teardown: '模式 A · 真实硬件拆解', dataflow: '模式 B · 数据流动可视化', chip: '模式 C · 深入芯片内部（教学抽象）', lab: '计算机实验' };

export function App() {
  const mode = useLab((s) => s.mode);
  useEffect(() => {
    if (useLab.getState().log.length) return;
    useLab.getState().addLog('系统', '实验室已就绪。本应用在浏览器中模拟硬件与操作系统机制，不运行真实 macOS。');
  }, []);
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <b>MacBook Pro 3D</b>
          <span>计算机体系结构与操作系统实验室</span>
        </div>
        <div className="mode-title">{MODE_TITLE[mode]}</div>
        <div className="prov-legend">
          {(Object.keys(PROVENANCE_LABEL) as Provenance[]).map((p) => (
            <span key={p} className={`badge badge-${p}`} title={PROVENANCE_HINT[p]}>
              {PROVENANCE_LABEL[p]}
            </span>
          ))}
        </div>
      </header>
      <LeftPanel />
      <main className="center">
        <Stage />
        <div className="overlay-note">拖动旋转 · 滚轮缩放 · 右键平移 · 点击部件选择并自动聚焦</div>
      </main>
      <RightPanel />
      <BottomBar />
    </div>
  );
}
