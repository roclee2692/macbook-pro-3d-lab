# 硬件与指令资料基线

核对日期：2026-10-30。本文只记录本项目采用的证据边界，不把三维推断升级为实测。

## 参考配置

Apple 官方 [MacBook Pro 14-inch 2021 技术规格](https://support.apple.com/en-us/111902)列出标准 M1 Pro 配置：8 核 CPU（6P+2E）、14 核 GPU、16 核 Neural Engine、200GB/s 内存带宽；16GB 统一内存、512GB SSD、14.2 英寸 3024×1964 Liquid Retina XDR、3×雷雳 4、HDMI、SDXC、MagSafe 3、Wi-Fi 6、蓝牙 5.0、六扬声器、70Wh 电池。A2442 也可选配 10 核 CPU，因此不能只凭型号与容量反推核心数；本项目明确选标准 8CPU/14GPU 配置。

机身固定尺寸 31.26×22.12×1.55cm、约 1.6kg。三维场景以厘米为单位，但内部部件坐标不是 Apple CAD。

## 拆机布局

来源：[iFixit 总拆](https://www.ifixit.com/News/54122/macbook-pro-2021-teardown)、[Chip ID](https://www.ifixit.com/Teardown/MacBook+Pro+14-Inch+2021+Chip+ID/145718)、[Logic Board](https://www.ifixit.com/Guide/MacBook+Pro+14-Inch+2021+Logic+Board+Replacement/150899)、[Heat Sink](https://www.ifixit.com/Guide/MacBook+Pro+14-Inch+2021+Heat+Sink+Replacement/150898)、[Antenna Bar](https://www.ifixit.com/Guide/MacBook+Pro+14-Inch+2021+Antenna+Bar+Replacement/150894)。

- 后部中央为逻辑板，左右后方为双风扇；散热组件跨过 SoC 并连接两侧鳍片。
- 电池组占据前部主要区域；六个外观区域属于一个电池组，不是六个独立可换电池。
- 扬声器沿电池两侧布置；天线/通风格栅位于后缘，三根同轴线接向逻辑板区域。
- 左侧 MagSafe、USB-C、耳机接口具有可拆模块；右侧 HDMI 与 SDXC 为板载件，不能另画成独立可拔接口卡。
- 触控板、风扇、扬声器、显示、键盘/背光等经排线连接。被遮挡的精确走线、板形、元件高度均属推断。

## 统一内存与存储

[Apple M1 Pro 说明](https://www.apple.com/newsroom/2021/10/introducing-m1-pro-and-m1-max-the-most-powerful-chips-apple-has-ever-built/)确认统一内存架构；[Apple M1 架构说明](https://www.apple.com/newsroom/2020/11/apple-unleashes-m1/)解释定制封装内单一内存池。iFixit Chip ID 对应样机照片显示两颗 8GB Samsung LPDDR5 与 M1 Pro 同封装，合计 16GB。

本项目不出现 DIMM/SO-DIMM、M.2、SATA、机械硬盘或独立显卡显存。Kioxia NAND 焊在逻辑板；4×128GB 是由 512GB 容量和资料颗粒作出的推算，标签为“资料推导”。供应商和丝印只代表 iFixit 样机，不能宣称所有 A2442 唯一配置。

## 未公开部分

CPU/GPU/缓存/互联/内存控制器的裸片位置、面积和内部管线；封装内部连接；PCB 隐藏走线；NAND 通道细节；热管内部结构；天线辐射体，均不是公开工程图。本项目的芯片视图、五级流水线、缩小缓存/页框、I/O 时延和热模型全部标“教学抽象”。

## AArch64 机器码

Arm A64 参考由斯坦福镜像提供：[总索引](https://www.scs.stanford.edu/~zyedidia/arm64/)。项目不是凭记忆显示机器码：`scripts/gen-golden.sh` 使用本机 Apple Clang 21.0.0 实汇编 57 条普通指令与 22 条分支/ADR，并由 Vitest 逐条比较字值及“解码→再编码”。

关键边界：LDR/STR 64 位 unsigned-offset 的 imm12 存字节偏移÷8；B/BL 的 imm26、B.cond 的 imm19 都相对当前 PC；目标内存采用 little-endian；CMP 是 SUBS XZR 的别名。浏览器 CPU 仍是顺序教学核心，不冒充 M1 Pro 的真实乱序微架构。
