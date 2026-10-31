import { useEffect, useRef } from 'react';
import type { Visual } from '../sim/flows/types';
import { fmtUs } from '../sim/flows/types';

export function FrameGrid({ frames, procs }: { frames: { use: string; owner: number | null; hue?: number }[]; procs: { pid: number; name: string; hue: number }[] }) {
  return (
    <div>
      <div className="frames">
        {frames.map((f, i) => (
          <div
            key={i}
            className={`frame ${f.use}`}
            style={f.use === 'page' && f.hue !== undefined ? { background: `hsl(${f.hue} 65% 45%)` } : undefined}
            title={`页框 #${i}：${f.use === 'free' ? '空闲' : f.use === 'kernel' ? '内核' : f.use === 'compressor' ? '压缩器' : `pid ${f.owner}`}`}
          />
        ))}
      </div>
      <div className="frame-legend">
        <span><i className="frame free" />空闲</span>
        <span><i className="frame kernel" />内核</span>
        <span><i className="frame compressor" />压缩器</span>
        {procs.map((p) => (
          <span key={p.pid}>
            <i className="frame" style={{ background: `hsl(${p.hue} 65% 45%)` }} />
            {p.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function FbCanvas({ fb, w, h, tile, tilesDone, tiles, cores }: { fb: Uint8ClampedArray; w: number; h: number; tile?: number; tilesDone?: number; tiles?: number; cores?: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(fb), w, h), 0, 0);
    if (tile && tiles !== undefined && tilesDone !== undefined) {
      const tw = Math.ceil(w / tile);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      for (let i = 0; i < tiles; i++) {
        const x = (i % tw) * tile;
        const y = Math.floor(i / tw) * tile;
        ctx.strokeRect(x + 0.5, y + 0.5, tile - 1, tile - 1);
        if (i >= tilesDone) {
          ctx.fillStyle = 'rgba(12,14,19,0.75)';
          ctx.fillRect(x, y, tile, tile);
        }
        if (cores && i < tilesDone) {
          ctx.fillStyle = `hsla(${(cores[i] * 360) / 14} 80% 60% / 0.9)`;
          ctx.fillRect(x + 1, y + 1, 3, 3);
        }
      }
    }
  }, [fb, w, h, tile, tilesDone, tiles, cores]);
  return <canvas ref={ref} className="fb" />;
}

export function IoTimeline({ ios, totalUs }: { ios: { lba: number; hit: boolean; channel: number; start: number; end: number; prefetch: boolean }[]; totalUs: number }) {
  const lanes = [-1, 0, 1, 2, 3];
  const T = Math.max(totalUs, ...ios.map((i) => i.end), 1);
  return (
    <div className="io">
      {lanes.map((ln) => (
        <div key={ln} className="io-lane">
          <span>{ln < 0 ? '缓存' : `NAND ${ln}`}</span>
          <div className="io-track">
            {ios
              .filter((i) => i.channel === ln)
              .map((i, k) => (
                <i
                  key={k}
                  className={i.hit ? 'hit' : i.prefetch ? 'pre' : 'miss'}
                  style={{ left: `${(i.start / T) * 100}%`, width: `${Math.max(0.6, ((i.end - i.start) / T) * 100)}%` }}
                  title={`LBA ${i.lba}：${i.hit ? '缓存命中' : i.prefetch ? '预读' : 'NAND 读'} ${fmtUs(i.start)}–${fmtUs(i.end)}`}
                />
              ))}
          </div>
        </div>
      ))}
      <div className="io-axis">
        <span>0</span>
        <span>{fmtUs(T)}</span>
      </div>
      <div className="frame-legend">
        <span><i className="iol miss" />按需读</span>
        <span><i className="iol pre" />预读</span>
        <span><i className="iol hit" />缓存命中</span>
      </div>
    </div>
  );
}

export function CoreGrid({ cores, queue }: { cores: { id: number; kind: string; thread: string | null }[]; queue: string[] }) {
  return (
    <div>
      <div className="cores">
        {cores.map((c) => (
          <div key={c.id} className={`core ${c.kind} ${c.thread ? 'busy' : ''}`}>
            <b>
              {c.kind}
              {c.id}
            </b>
            <span>{c.thread ?? '空闲'}</span>
          </div>
        ))}
      </div>
      <div className="queue">
        <b>就绪队列</b>
        {queue.length ? queue.map((q, i) => <span key={i}>{q}</span>) : <span className="dim">空</span>}
      </div>
    </div>
  );
}

export function VisualView({ v }: { v: Visual }) {
  switch (v.type) {
    case 'frames':
      return <FrameGrid frames={v.frames} procs={v.procs} />;
    case 'fb':
      return <FbCanvas fb={v.fb} w={v.w} h={v.h} tile={v.tile} tiles={v.tiles} tilesDone={v.tilesDone} />;
    case 'io':
      return <IoTimeline ios={v.ios} totalUs={v.totalUs} />;
    case 'cores':
      return (
        <>
          <CoreGrid cores={v.cores} queue={v.queue} />
          <div className="dim small">
            温度 {v.temp.toFixed(1)} °C · 风扇 {Math.round(v.rpm)} rpm · 性能核 {v.pFreq.toFixed(2)} GHz
          </div>
        </>
      );
    case 'code':
      return (
        <table className="code">
          <tbody>
            {v.lines.map((l, i) => (
              <tr key={i} className={l.active ? 'on' : ''}>
                <td>{l.addr}</td>
                <td>{l.word}</td>
                <td>{l.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}
