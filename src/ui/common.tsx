import type { ReactNode } from 'react';
import { PROVENANCE_HINT, PROVENANCE_LABEL, type Provenance } from '../data/sources';

export function Badge({ p }: { p: Provenance }) {
  return (
    <span className={`badge badge-${p}`} title={PROVENANCE_HINT[p]}>
      {PROVENANCE_LABEL[p]}
    </span>
  );
}

export function Section({ title, right, children, badge }: { title: string; right?: ReactNode; children: ReactNode; badge?: Provenance }) {
  return (
    <section className="sec">
      <header>
        <h3>
          {title} {badge && <Badge p={badge} />}
        </h3>
        {right}
      </header>
      {children}
    </section>
  );
}

/** 实验模拟参数：可调，明确标注 */
export function Param({ label, value, min, max, step = 1, unit = '', onChange, note }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; note?: string }) {
  return (
    <label className="param" title={note}>
      <span className="param-k">
        <i className="tag-sim">实验参数</i>
        {label}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <b>
        {value}
        {unit}
      </b>
    </label>
  );
}

export function Toggle({ label, value, onChange, sim = true }: { label: string; value: boolean; onChange: (v: boolean) => void; sim?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {sim && <i className="tag-sim">实验参数</i>}
        {label}
      </span>
    </label>
  );
}

/** 真实硬件固定参数：只读 */
export function Fixed({ rows }: { rows: { k: string; v: string; p: Provenance }[] }) {
  return (
    <table className="kv fixed">
      <tbody>
        {rows.map((r) => (
          <tr key={r.k}>
            <th>
              <i className="tag-real">真实固定</i>
              {r.k}
            </th>
            <td>
              {r.v} <Badge p={r.p} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <table className="kv">
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i}>
            <th>{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Btn({ children, onClick, primary, disabled, title }: { children: ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button className={primary ? 'btn primary' : 'btn'} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Sparkline({ data, color, min, max, height = 36 }: { data: number[]; color: string; min?: number; max?: number; height?: number }) {
  if (data.length < 2) return <svg className="spark" height={height} />;
  const lo = min ?? Math.min(...data);
  const hi = max ?? Math.max(...data);
  const w = 240;
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * w},${height - ((d - lo) / Math.max(1e-9, hi - lo)) * (height - 4) - 2}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" height={height}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
