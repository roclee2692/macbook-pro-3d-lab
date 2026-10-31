// 把 CPU 某个阶段的真实执行结果翻译成统一数据流的数据包与高亮模块（芯片视图 + 三维整机共用）。
import { pk, type NodeId, type Packet } from '../flows/types';
import type { InstTrace, MemEvent, Stage } from './machine';

function memPath(ev: MemEvent, sink: NodeId): { packets: Packet[]; lit: string[] } {
  const hex = `0x${ev.va.toString(16)}`;
  const served = ev.cache.servedBy;
  const lit = ['core-mmu'];
  const packets: Packet[] = [
    pk('control', sink, 'mmu', 8, ev.xlat.tlbHit ? 'TLB 命中' : 'TLB 未命中 → 页表遍历', `VA ${hex} → PA 0x${ev.xlat.pa.toString(16)}`, hex),
  ];
  const first: NodeId = ev.kind === 'fetch' ? 'l1i' : 'l1d';
  if (ev.kind === 'store') {
    packets.push(pk('mem-write', sink, first, 8, 'STR 写缓存', `写入 ${ev.value}${ev.mmio ? '（输出端口）' : ''}`, hex));
    lit.push(ev.kind === 'store' ? 'core-l1d' : 'core-l1i');
    if (served !== 'L1') {
      packets.push(pk('mem-write', 'l2', 'slc', 64, '写分配：取回缓存行', `L1 未命中，由 ${served} 提供该行`, hex));
      lit.push('chip-l2p0', 'chip-slc');
    }
    return { packets, lit };
  }
  // 读：从提供数据的层级逐级返回
  const chain: NodeId[] = [];
  if (served === 'DRAM') chain.push('dram', 'memctl', 'slc', 'l2', first);
  else if (served === 'SLC') chain.push('slc', 'l2', first);
  else if (served === 'L2') chain.push('l2', first);
  else chain.push(first);
  chain.push(sink);
  for (let i = 0; i + 1 < chain.length; i++) {
    const bytes = chain[i + 1] === sink ? (ev.kind === 'fetch' ? 4 : 8) : 64;
    packets.push(pk('mem-read', chain[i], chain[i + 1], bytes, i === 0 ? `${served} 提供数据` : '缓存行填充', ev.kind === 'fetch' ? '取指令' : 'LDR 读数据', hex));
  }
  const map: Record<string, string[]> = { DRAM: ['chip-dram-0', 'chip-mc0', 'chip-slc', 'chip-l2p0'], SLC: ['chip-slc', 'chip-l2p0'], L2: ['chip-l2p0'], L1: [] };
  lit.push(...map[served], ev.kind === 'fetch' ? 'core-l1i' : 'core-l1d');
  return { packets, lit };
}

export function stageFlow(t: InstTrace, stage: Stage): { packets: Packet[]; lit: string[] } {
  switch (stage) {
    case 'IF': {
      const r = t.fetch ? memPath(t.fetch, 'fetch') : { packets: [], lit: [] };
      return { packets: r.packets, lit: [...r.lit, 'core-fetch', 'chip-p0-0'] };
    }
    case 'ID':
      return {
        packets: [pk('control', 'fetch', 'decode', 4, '机器码', t.decoded?.text ?? ''), ...t.srcRegs.map((s) => pk('control', 'regs', 'decode', 8, `读 ${s.name}`, `${s.name} = ${s.value}`))],
        lit: ['core-decode', 'core-regs', 'chip-p0-0'],
      };
    case 'EX':
      return {
        packets: t.alu ? [pk('control', 'decode', 'alu', 16, `ALU ${t.alu.op}`, `${t.alu.a} , ${t.alu.b} → ${t.alu.result}`)] : t.branch ? [pk('control', 'decode', 'alu', 8, '分支判断', t.branch.reason)] : [],
        lit: ['core-alu', 'chip-p0-0'],
      };
    case 'MEM': {
      if (!t.mem) return { packets: [], lit: ['core-lsu'] };
      const r = memPath(t.mem, 'lsu');
      return { packets: [pk('control', 'alu', 'lsu', 8, '地址', `0x${t.mem.va.toString(16)}`), ...r.packets], lit: [...r.lit, 'core-lsu', 'chip-p0-0'] };
    }
    case 'WB':
      return {
        packets: [
          ...(t.regWrite ? [pk('control', t.mem?.kind === 'load' ? 'lsu' : 'alu', 'regs', 8, `写回 ${t.regWrite.name}`, `${t.regWrite.name} ← ${t.regWrite.value}`)] : []),
          pk('control', 'commit', 'fetch', 8, '更新 PC', `PC ← 0x${t.nextPc.toString(16)}`),
        ],
        lit: ['core-commit', 'core-regs', 'chip-p0-0'],
      };
  }
}
