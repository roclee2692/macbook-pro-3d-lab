// 资料来源与“可信度标签”。每条硬件事实、每个参数都必须挂一个 Provenance。

export type Provenance = 'official' | 'teardown' | 'derived' | 'teaching';

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  official: '官方规格',
  teardown: '拆机实测',
  derived: '资料推导',
  teaching: '教学抽象',
};

export const PROVENANCE_HINT: Record<Provenance, string> = {
  official: 'Apple 官方技术规格 / 官方文档原文给出的数字',
  teardown: 'iFixit 拆机与芯片识别照片中可直接读到的信息',
  derived: '由公开资料、第三方测量或多条事实推算得到，可能有误差',
  teaching: '为教学可视化而简化或缩小的模型，不代表真实微架构或真实尺寸',
};

export interface Source {
  id: string;
  title: string;
  url: string;
  note: string;
}

export const SOURCES: Source[] = [
  {
    id: 'apple-spec',
    title: 'Apple 支持：MacBook Pro (14-inch, 2021) 技术规格',
    url: 'https://support.apple.com/en-us/111902',
    note: '尺寸、重量、显示屏、芯片配置、电池、接口、无线、音频。2026-10-30 抓取核对。',
  },
  {
    id: 'ifixit-chipid',
    title: 'iFixit：MacBook Pro 14" 2021 Chip ID（主板两面芯片识别）',
    url: 'https://www.ifixit.com/Teardown/MacBook+Pro+14-Inch+2021+Chip+ID/145718',
    note: 'LPDDR5（Samsung K3LKYKY0EM-ZGCP 8GB×2）、Kioxia 128GB NAND、APL1098 PMU、USI Wi-Fi/BT 模块等。2026-10-30 通过 iFixit API 读取。',
  },
  {
    id: 'ifixit-lowercase',
    title: 'iFixit：Lower Case Replacement',
    url: 'https://www.ifixit.com/Guide/MacBook+Pro+14-Inch+2021+Lower+Case+Replacement/150900',
    note: '8 颗 P5 五角螺丝（4×9.3 mm，4×5 mm），两侧隐藏卡扣 + 后缘滑扣。',
  },
  {
    id: 'ifixit-logicboard',
    title: 'iFixit：Logic Board Replacement',
    url: 'https://www.ifixit.com/Guide/MacBook+Pro+14-Inch+2021+Logic+Board+Replacement/150899',
    note: '主板由 11 颗 T5 + 3 颗 T6 螺丝固定，共 18 个连接器；接口、扬声器、风扇、键盘等均以排线接到主板。',
  },
  {
    id: 'ifixit-heatsink',
    title: 'iFixit：Heat Sink Replacement',
    url: 'https://www.ifixit.com/Guide/MacBook+Pro+14-Inch+2021+Heat+Sink+Replacement/150898',
    note: '散热器在主板朝键盘的一面，需取下主板并翻面，拆 4 颗 3.9 mm T5 螺丝；SoC 与散热器之间为灰色导热膏。',
  },
  {
    id: 'ifixit-fans',
    title: 'iFixit：Fan Assembly Replacement',
    url: 'https://www.ifixit.com/Guide/MacBook+Pro+14-Inch+2021+Fan+Assembly+Replacement/150896',
    note: '左右两只风扇，主板取下后再拆（6×3.3 mm T3 + 2×3 mm T5）。',
  },
  {
    id: 'ifixit-battery',
    title: 'iFixit：Battery Replacement',
    url: 'https://www.ifixit.com/Guide/MacBook+Pro+14-Inch+2021+Battery+Replacement/150895',
    note: '电池由 14 条易拉胶固定（底部 8 条 + 触控板位置 6 条）；触控板 10 颗 5.7 mm T5 螺丝；电池板 1 颗 4 mm 螺丝。',
  },
  {
    id: 'apple-platform-security',
    title: 'Apple Platform Security Guide：Boot process for a Mac with Apple silicon',
    url: 'https://support.apple.com/guide/security/boot-process-secac71d5623/web',
    note: 'Boot ROM → LLB → iBoot → macOS 内核的安全启动链；本次未在线复核，依据既有知识，标为资料推导。',
  },
  {
    id: 'apple-dev-16k',
    title: 'Apple Developer：Addressing architectural differences in your macOS code',
    url: 'https://developer.apple.com/documentation/apple-silicon/addressing-architectural-differences-in-your-macos-code',
    note: 'Apple silicon 上 macOS 使用 16 KB 虚拟内存页。本次未在线复核。',
  },
  {
    id: 'arm-arm',
    title: 'Arm Architecture Reference Manual (A64 指令编码)',
    url: 'https://developer.arm.com/documentation/ddi0487/latest',
    note: '机器码编码规则；本项目每条编码另用本机 clang (arm64) 汇编结果做单元测试比对。',
  },
  {
    id: 'third-party-m1pro',
    title: '第三方评测（AnandTech 2021-10 M1 Pro/Max 评测等）',
    url: 'https://www.anandtech.com/show/17024/apple-m1-max-performance-review',
    note: '缓存容量、核心频率、内存位宽等第三方测量值；本次未在线复核，统一标为资料推导。',
  },
];

export const sourceById = (id: string) => SOURCES.find((s) => s.id === id);
