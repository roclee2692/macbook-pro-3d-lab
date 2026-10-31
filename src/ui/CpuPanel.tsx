import { useState } from 'react';
import { useLab } from '../store';
import { lab } from '../sim/lab';
import { EXAMPLES } from '../sim/cpu/programs';
import { hex32 } from '../sim/cpu/assembler';
import { STAGES, STAGE_CN, fstr, toSigned, OUT_ADDR } from '../sim/cpu/machine';
import { INSTRUCTION_HELP, regName } from '../sim/cpu/isa';
import { Badge, Btn, Fixed, Param, Section } from './common';
import { cpuLoad, cpuSetCache } from './actions';

export function CpuPanel() {
  useLab((s) => s.rev);
  const m = lab.cpu;
  const [src, setSrc] = useState(lab.cpuSource);
  const [showHelp, setShowHelp] = useState(false);
  const prog = m.program;
  const t = m.cur ?? m.last;
  const errLines = new Set(prog?.errors.map((e) => e.line));
  const curLine = prog?.lines.find((l) => l.addr === (m.cur ? m.cur.pc : m.pc))?.line;
  const prevRegs = m.history[m.history.length - 1]?.regs;
  const addr = t?.mem?.va ?? 0x1000;
  const dumpBase = Math.max(0, Math.min(0x8000 - 64, (addr & ~0x3f) - 0));

  return (
    <div className="panel cpu">
      <Section title="AArch64 程序" right={<button className="link" onClick={() => setShowHelp(!showHelp)}>{showHelp ? '收起指令表' : '支持的指令'}</button>}>
        <div className="row">
          <select
            onChange={(e) => {
              const ex = EXAMPLES.find((x) => x.id === e.target.value)!;
              setSrc(ex.source);
              cpuLoad(ex.source);
            }}
            defaultValue=""
          >
            <option value="" disabled>
              载入示例程序…
            </option>
            {EXAMPLES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <Btn primary onClick={() => cpuLoad(src)}>
            汇编并载入
          </Btn>
        </div>
        {showHelp && (
          <table className="kv help">
            <tbody>
              {INSTRUCTION_HELP.map((h) => (
                <tr key={h.syntax}>
                  <th>
                    <code>{h.syntax}</code>
                  </th>
                  <td>{h.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="editor">
          <div className="gutter">
            {src.split('\n').map((_, i) => (
              <div key={i} className={errLines.has(i + 1) ? 'err' : curLine === i + 1 ? 'cur' : ''}>
                {i + 1}
              </div>
            ))}
          </div>
          <textarea spellCheck={false} value={src} onChange={(e) => setSrc(e.target.value)} rows={Math.min(18, src.split('\n').length + 1)} />
        </div>
        {prog?.errors.map((e, i) => (
          <div key={i} className="error">
            第 {e.line} 行：{e.message}
          </div>
        ))}
      </Section>

      <Section title="机器码（与 clang 汇编结果逐条比对验证）" badge="official">
        <div className="scroll code-wrap">
          <table className="code">
            <thead>
              <tr>
                <th>地址</th>
                <th>机器码</th>
                <th>源码</th>
              </tr>
            </thead>
            <tbody>
              {prog?.lines.map((l, i) => (
                <tr key={i} className={l.addr === (m.cur ? m.cur.pc : m.pc) && !l.isData ? 'on' : l.isData ? 'data' : ''}>
                  <td>{l.addr.toString(16).padStart(4, '0')}</td>
                  <td>{hex32(l.word)}</td>
                  <td>{l.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="指令执行（逐阶段）" badge="teaching">
        <div className="pipe">
          {STAGES.map((s, i) => {
            const done = m.cur ? i < m.cur.done.length : !!m.last;
            const active = m.cur ? i === m.cur.done.length - 1 : m.last ? i === 4 : false;
            return (
              <div key={s} className={`ps ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
                <b>{s}</b>
                <span>{STAGE_CN[s]}</span>
              </div>
            );
          })}
        </div>
        {t ? (
          <div className="trace">
            <div className="trace-head">
              <code>0x{t.pc.toString(16)}</code> <code>{hex32(t.word)}</code> <b>{t.decoded?.text ?? '（尚未译码）'}</b>
            </div>
            {t.decoded && (
              <div className="bits">
                {t.decoded.fields.map((f, i) => (
                  <span key={i} style={{ flex: f.hi - f.lo + 1 }} title={`位 ${f.hi}:${f.lo}`}>
                    <i>{f.label}</i>
                    <code>{(f.value >>> 0).toString(2).padStart(f.hi - f.lo + 1, '0')}</code>
                  </span>
                ))}
              </div>
            )}
            {t.done.map((s) => (
              <div key={s} className="stage-desc">
                <b>{STAGE_CN[s]}</b>
                <ul>
                  {m.describe(t, s).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <div className="dim">按底部“微步”逐阶段执行，或“单步”执行一整条指令。</div>
        )}
        {m.halted && <div className={m.haltReason.includes('brk') ? 'ok' : 'error'}>{m.haltReason}</div>}
      </Section>

      <Section title="寄存器">
        <div className="regs">
          {m.regs.map((v, i) => (
            <div key={i} className={prevRegs && prevRegs[i] !== v ? 'reg chg' : v ? 'reg nz' : 'reg'} title={`0x${v.toString(16)}`}>
              <b>{regName(i)}</b>
              <span>{toSigned(v).toString()}</span>
            </div>
          ))}
          <div className="reg sp">
            <b>sp</b>
            <span>0x{m.sp.toString(16)}</span>
          </div>
          <div className="reg sp">
            <b>pc</b>
            <span>0x{m.pc.toString(16)}</span>
          </div>
          <div className="reg sp">
            <b>NZCV</b>
            <span>{fstr(m.flags)}</span>
          </div>
        </div>
        <div className="stats">
          <span>已退休 {m.retired} 条</span>
          <span>{m.cycle} 周期</span>
          <span>读 {m.readsWrites.loads} · 写 {m.readsWrites.stores}</span>
          <span>输出：{m.output.join(', ') || '—'}</span>
        </div>
      </Section>

      <Section title="地址转换 MMU / TLB" badge="teaching">
        {t?.mem || t?.fetch ? (
          (() => {
            const x = (t.mem ?? t.fetch)!.xlat;
            return (
              <div className="xlat">
                <div>
                  VA <code>0x{x.va.toString(16).padStart(6, '0')}</code> = VPN <code>0x{x.vpn.toString(16)}</code> | 页内偏移 <code>0x{x.offset.toString(16)}</code>（16 KB 页 → 低 14 位）
                </div>
                <div>{x.tlbHit ? 'TLB 命中：直接得到物理页框号' : `TLB 未命中 → 四级页表遍历：${x.walk.map((w) => `${w.level}[${w.index}]`).join(' → ')}`}</div>
                <div>
                  PA <code>0x{x.pa.toString(16)}</code> = 页框 <code>0x{x.pfn.toString(16)}</code> × 16 KB + 偏移
                </div>
                <div className="dim small">TLB：{m.tlb.map((e) => `VPN ${e.vpn}→PFN 0x${e.pfn.toString(16)}`).join('；') || '空'}（页框号为示意值）</div>
              </div>
            );
          })()
        ) : (
          <div className="dim">执行一条指令后显示。</div>
        )}
      </Section>

      <Section title="缓存层次">
        <table className="kv cache">
          <thead>
            <tr>
              <th>层级</th>
              <th>配置（实验参数）</th>
              <th>命中</th>
              <th>未命中</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>L1I</th>
              <td>同 L1D</td>
              <td>{m.icache.hits}</td>
              <td>{m.icache.misses}</td>
            </tr>
            {m.dcache.levels.map((c) => (
              <tr key={c.cfg.name}>
                <th>{c.cfg.name === 'L1' ? 'L1D' : c.cfg.name}</th>
                <td>
                  {c.cfg.sets}组×{c.cfg.ways}路×{c.cfg.lineBytes}B = {(c.cfg.sets * c.cfg.ways * c.cfg.lineBytes) / 1024} KB · {c.cfg.latency} 周期
                </td>
                <td>{c.hits}</td>
                <td>{c.misses}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="l1map">
          {m.dcache.levels[0].lines.map((set, si) => (
            <div key={si} className="l1set">
              <span>组{si}</span>
              {set.map((l, wi) => (
                <i key={wi} className={l.valid ? 'v' : ''} title={l.valid ? `tag 0x${l.tag.toString(16)}` : '无效'}>
                  {l.valid ? l.tag.toString(16) : '·'}
                </i>
              ))}
            </div>
          ))}
        </div>
        <Param label="L1D 组数" value={lab.cacheCfg[0].sets} min={1} max={32} onChange={(v) => cpuSetCache(0, 'sets', v)} />
        <Param label="L1D 路数" value={lab.cacheCfg[0].ways} min={1} max={8} onChange={(v) => cpuSetCache(0, 'ways', v)} />
        <Param label="缓存行字节" value={lab.cacheCfg[0].lineBytes} min={16} max={128} step={16} unit=" B" onChange={(v) => cpuSetCache(0, 'lineBytes', v)} />
        <Fixed
          rows={[
            { k: 'P 核 L1D', v: '128 KB', p: 'derived' },
            { k: 'P 核 L1I', v: '192 KB', p: 'derived' },
            { k: 'P 簇 L2', v: '12 MB × 2', p: 'derived' },
            { k: 'SLC', v: '24 MB', p: 'derived' },
            { k: '页大小', v: '16 KB', p: 'official' },
          ]}
        />
        <div className="dim small">
          教学缓存远小于真实容量，便于观察替换；延迟量级 <Badge p="derived" />
        </div>
      </Section>

      <Section title={`内存 0x${dumpBase.toString(16)} 起（最近访问附近）`}>
        <div className="hexdump">
          {Array.from({ length: 8 }).map((_, r) => {
            const a = dumpBase + r * 8;
            const v = m.read64(a);
            return (
              <div key={r} className={t?.mem && t.mem.va === a ? 'on' : ''}>
                <code>{a.toString(16).padStart(4, '0')}</code>
                <code>{v.toString(16).padStart(16, '0')}</code>
                <span>{a === OUT_ADDR ? '输出端口' : toSigned(v).toString()}</span>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
