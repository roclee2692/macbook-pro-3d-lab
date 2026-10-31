# MacBook Pro 3D · 计算机体系结构与操作系统实验室

参考机型：MacBook Pro (14-inch, 2021) A2442，M1 Pro 8 核 CPU（6P+2E）、14 核 GPU、16 GB 统一内存、512 GB SSD。
React 18 + TypeScript + Three.js（@react-three/fiber / drei）+ zustand，Vite 构建，Vitest 测试。

本应用在浏览器中**模拟**硬件与操作系统机制，不运行真实 macOS。

## 运行

```bash
npm ci
npm run dev
npm test           # 82 个单元测试
npm run build      # 产物在 dist/
```

默认本地地址为 <http://127.0.0.1:5191>。也可以从仓库根目录运行：

```bash
npm run dev -- --host 127.0.0.1 --port 5191
```

## 功能

| 模式 | 内容 |
|---|---|
| A 真实硬件拆解 | 按 iFixit 流程 0–10 步拆解：P5 螺丝 → 底壳 → 断电池/盖板 → 主板（连同散热器）→ 主板翻面露出 SoC → 风扇 → 触控板 → 电池 → 扬声器/接口/天线 → 显示屏。0–100% 爆炸滑块、平滑复原、维修姿态翻转、透明显示、剖切、部件点选与自动聚焦。 |
| B 数据流动 | 开机启动（可篡改 iBoot 观察安全启动中断）、运行程序、打开文件、GPU 渲染、内存不足、多任务。每步都有可检查的状态表，点击三维中的数据包可看来源/目标/大小/操作/原因。 |
| C 深入芯片 | M1 Pro 抽象版图（标注“教学抽象”）+ 性能核放大图；AArch64 模拟器可逐阶段（IF/ID/EX/MEM/WB）单步，显示机器码位域、寄存器、PC、NZCV、MMU/TLB 地址转换、三级缓存、内存。 |
| 实验 | CPU（改程序、缓存参数）、内存（进程、malloc/free、页表、压缩器、交换）、SSD（创建/保存/读取、顺序 vs 随机、缓存命中 vs NAND）、GPU（命令缓冲、统一内存零拷贝、TBDR 分块光栅化）、调度与散热（QoS、优先级、P/E 核、功耗、温度、风扇、降频、风扇故障）。 |

统一数据流配色：内存读（蓝）、内存写（橙黄）、存储 I/O（紫）、GPU（绿）、供电（红）、散热（橙）、控制/指令（灰白）。

## 可信度标签

每条硬件事实和每个参数都挂一个标签，界面中以徽章显示：

- **官方规格**：Apple 技术规格页（[support.apple.com/en-us/111902](https://support.apple.com/en-us/111902)，2026-10-30 抓取核对）。
- **拆机实测**：iFixit 芯片识别与维修指南（通过 iFixit API 读取：Chip ID 145718、Lower Case 150900、Logic Board 150899、Heat Sink 150898、Fans 150896、Battery 150895）。
- **资料推导**：第三方测量或由多条事实推算（缓存容量、频率、NAND 颗数 4×128 GB、启动链细节等），本次未全部在线复核。
- **教学抽象**：为可视化缩小或简化的模型（芯片版图、五级流水线、缓存/页框数量、NAND 时序、热模型系数等）。

实验面板把参数分成「真实固定」（只读）和「实验参数」（可调）两类。

## 验证

- **机器码**：[scripts/gen-golden.sh](scripts/gen-golden.sh) 用本机 `clang -target arm64-apple-macos13` 汇编 [scripts/isa-cases.txt](scripts/isa-cases.txt)（57 条）和 [scripts/isa-branches.s](scripts/isa-branches.s)（22 条分支/ADR），导出 [tests/clang-golden.json](tests/clang-golden.json)。[tests/isa.test.ts](tests/isa.test.ts) 逐条比对汇编器输出，并验证“解码→再编码”完全还原。
- **执行语义**：数组求和、栈读写、BL/RET、斐波那契、跨步访存的缓存命中数、SUBS 标志位、逐阶段单步、回退、越界、TLB。
- **系统模型**：[tests/sim.test.ts](tests/sim.test.ts) 覆盖六个场景的数据包端点、篡改启动失败、压缩/换出/换入、按需分页、顺序读快于随机读、光栅化输出、后台线程只上能效核、风扇故障降频。

## 已知限制

- 主板、电池电芯、扬声器、接口的毫米级位置未公开，按拆机照片近似摆放；右侧 HDMI/SD 的连接方式为近似。
- CPU 是顺序执行的教学核心；只支持 64 位 X 寄存器子集，不支持 W 寄存器、逻辑立即数、前/后变址寻址。
- 启动链中各级镜像大小、页框号、物理地址为示意值；摘要算法为 FNV-1a（真实为 SHA-384 + 签名）。
- 热模型做了时间加速，用来展示因果关系，不是实测曲线。

## 扩展

- 新指令：在 [src/sim/cpu/isa.ts](src/sim/cpu/isa.ts) 的 `Inst`、`encode`、`decode`、`disasm` 中添加，在 [src/sim/cpu/assembler.ts](src/sim/cpu/assembler.ts) 中添加语法，在 [src/sim/cpu/machine.ts](src/sim/cpu/machine.ts) 中添加执行语义，再往 `scripts/isa-cases.txt` 加用例并重新生成金标准。
- 新场景：在 [src/sim/flows/scenarios.ts](src/sim/flows/scenarios.ts) 中添加一个 `Scenario`，调用模型生成 `FlowStep[]`。
- 新部件：在 [src/data/parts.ts](src/data/parts.ts) 中登记，按 `shape` 在 [src/three/MacBook.tsx](src/three/MacBook.tsx) 中渲染。
