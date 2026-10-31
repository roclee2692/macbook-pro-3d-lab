import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PARTS, TEARDOWN_STEPS } from '../src/data/parts';
import { SPECS } from '../src/data/specs';

describe('硬件资料与拆机事实一致', () => {
  it('不会把 HDMI 和 SDXC 描述成独立可拔接口模块', () => {
    const right = PARTS.find((p) => p.id === 'port-r')!;
    const step = TEARDOWN_STEPS.find((s) => s.stage === 9)!;
    expect(right.role).toContain('HDMI 与 SDXC 焊在主板上');
    expect(step.note).toContain('HDMI/SDXC 保持板载');
    expect(step.note).not.toContain('接口是独立模块，可单独更换');
  });

  it('NAND 颗数推算在规格和实验面板都标为资料推导', () => {
    expect(SPECS.find((s) => s.key === 'nandcount')?.provenance).toBe('derived');
    const panel = readFileSync(new URL('../src/ui/LabPanels.tsx', import.meta.url), 'utf8');
    const nandRow = panel.match(/\{ k: 'NAND'[^\n]+\}/)?.[0];
    expect(nandRow).toBeTruthy();
    expect(nandRow).toContain("p: 'derived'");
  });

  it('Apple 标称与拆机额定值的混合电池说明不冒称单一官方规格', () => {
    const battery = SPECS.find((s) => s.key === 'battery')!;
    expect(battery.value).toContain('Apple 标称 70 Wh');
    expect(battery.value).toContain('69.6 Wh');
    expect(battery.provenance).toBe('derived');
  });
});
