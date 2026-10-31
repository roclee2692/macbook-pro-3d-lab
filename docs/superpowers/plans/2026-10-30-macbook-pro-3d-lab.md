# MacBook Pro 3D Lab Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已有完整项目基线上完成资料真实性修正、可重复浏览器验收与最终交付，而不重写已验证模块。

**Architecture:** 保留现有 React/Zustand/Three.js 与可执行模拟模型；仅修改被资料复核证伪的文本和 provenance，以测试锁定。项目目录没有 Git 元数据，因此用已校验的 `.agent-backups` 源码归档作为回滚基线，不伪造提交记录。

**Tech Stack:** React 18、TypeScript、Three.js、Zustand、Vite、Vitest、Apple Clang、Chrome CDP。

**Spec:** `docs/superpowers/specs/2026-10-30-macbook-pro-3d-lab-design.md`

## Global Constraints

- 不将浏览器模拟描述为真实 macOS，不将近似几何描述为 Apple 官方 CAD。
- 统一内存和 NAND 不得变成可插拔模块；HDMI/SDXC 不得描述为独立可拔卡。
- 所有改动先备份；新行为或修复先看到测试失败，再实施并跑完整测试。
- 使用 Homebrew Node 26.12.0 运行当前依赖；bunded DSH Node 与 Rollup 原生模块存在签名策略冲突。
- 不终止已有 5191 服务，不替换 DSH GUI；复用已确认属于本项目的 Vite 页面。

## Review Focus

- 资料文字与三维拆解关系不一致：由 `tests/data.test.ts` 检查右侧板载接口及拆解步骤。
- 推算数据挂错来源标签：由同一测试检查 NAND 数量和电池混合规格。
- 页面能返回 200 但 WebGL/实验未运行：由 `scripts/browser-smoke.mjs` 实际点击并断言 DOM/WebGL。
- 机器码金标准陈旧：重新运行 Clang 并比较 SHA-256，再跑 ISA 测试。
- 作者无法直接读取当前模型截图：只报告 DOM/像素证据，保留 PNG 给用户，不声称完成人工视觉审查。

---

### Task 1: 修正硬件真实性与来源标签

**Files:**
- Create: `tests/data.test.ts`
- Modify: `src/data/parts.ts`
- Modify: `src/data/specs.ts`
- Modify: `src/ui/LabPanels.tsx`

**Interfaces:**
- Consumes: 现有 `PARTS`、`TEARDOWN_STEPS`、`SPECS` 和 `Fixed` 参数。
- Produces: 不改变任何运行时函数签名；只使资料表述与 iFixit 一致。

- [ ] **Step 1: 写失败测试**
  - 第 9 拆解步骤不得再把所有接口统称为独立模块，须明确 HDMI/SDXC 板载。
  - `port-r` 说明须明确 HDMI/SDXC 焊接关系。
  - NAND 4 颗为容量推算，provenance 必须为 `derived`。
  - Apple 70Wh 与拆机 69.6Wh 的混合说明不得单挂 `official`。
- [ ] **Step 2: 运行 `npm test -- tests/data.test.ts`，确认上述断言因原文/原标签失败。**
- [ ] **Step 3: 做最小文字和标签修正，不改模型、布局或模拟参数。**
- [ ] **Step 4: 运行 `npm test`，Expected: 全部测试通过。**

### Task 2: 固化研究、运行和浏览器验收说明

**Files:**
- Create: `docs/RESEARCH.md`
- Modify: `README.md`
- Use: `scripts/browser-smoke.mjs`

**Interfaces:**
- Consumes: 已核实的 Apple/iFixit/Arm 资料、Homebrew Node、5191 Vite、9227 隔离 Chrome。
- Produces: 用户可复现的运行与验收步骤，不改变产品 API。

- [ ] **Step 1: 记录机型配置边界、内部布局、统一内存/NAND 硬约束和未公开微架构边界。**
- [ ] **Step 2: README 写入实际测试数、Clang 金标准复验和浏览器验收方法；不加入未执行的成功声明。**
- [ ] **Step 3: 运行浏览器脚本，Expected: 10 项通过且无运行时异常。**

### Task 3: 全量验证与独立审查

**Files:**
- Verify: `tests/`、`scripts/gen-golden.sh`、`dist/`、`artifacts/`
- Create: `artifacts/verification-summary.md`

**Interfaces:**
- Consumes: Task 1–2 的最终源码。
- Produces: 最终测试、构建、页面 URL、截图和限制清单。

- [ ] **Step 1: 完整运行 `npm test`、`npm run build`、金标准哈希复验和浏览器 smoke。**
- [ ] **Step 2: 用独立子代理审查真实性边界与本轮修改，重要问题按 RED→GREEN 修复。**
- [ ] **Step 3: 记录最终验证证据和限制，交付 http://127.0.0.1:5191 与源码路径。**

## Rulings

- 非 Git 项目：不执行 worktree/commit 步骤，使用备份归档和测试账本；代价是回滚依赖归档而非 Git 历史。
- 既有项目复用：不重写已验证的 82 项测试和三维/模拟架构；代价是需要以现有接口做回归验收。
