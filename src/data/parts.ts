import type { Provenance } from './sources';

// 坐标约定（单位 cm，机身本地坐标，正常放置）：
//   x：宽度方向，-x = 用户视角左侧（MagSafe 一侧）
//   y：高度方向，0 = 底壳外表面，向上指向键盘
//   z：深度方向，+z = 前缘（触控板一侧），-z = 后缘（转轴）
// 布局依据 iFixit 拆机步骤与芯片识别照片；精确毫米级坐标未公开，属“资料推导”。

export type Vec3 = [number, number, number];

export type MatKey =
  | 'alu'
  | 'aluInner'
  | 'glass'
  | 'pcb'
  | 'chip'
  | 'soc'
  | 'dram'
  | 'nand'
  | 'copper'
  | 'fins'
  | 'battery'
  | 'black'
  | 'rubber'
  | 'screw'
  | 'flex'
  | 'port'
  | 'speaker'
  | 'shield';

export type Shape =
  | 'box'
  | 'topcase'
  | 'lowercase'
  | 'lid'
  | 'keyboard'
  | 'fan'
  | 'heatsink'
  | 'logicboard'
  | 'screws'
  | 'cell'
  | 'port';

export interface ChipSpec {
  id: string;
  name: string;
  part: string;
  side: 1 | 2; // 1 = 朝键盘/散热器一面；2 = 朝底壳一面
  pos: [number, number]; // 板上 (x, z)，相对主板中心
  size: Vec3;
  mat: MatKey;
  provenance: Provenance;
  role: string;
}

export interface PartDef {
  id: string;
  name: string;
  en: string;
  category: 'shell' | 'input' | 'display' | 'board' | 'thermal' | 'power' | 'io' | 'audio' | 'wireless' | 'fastener';
  shape: Shape;
  pos: Vec3; // 中心
  size: Vec3; // 包围盒
  mat: MatKey;
  stage: number; // 拆解步骤序号（0 = 不拆）
  explode: Vec3; // 拆解位移（本地坐标）
  role: string; // 功能
  principle: string; // 工作原理
  links: string[]; // 连接关系（其他 part id）
  linkNote?: string;
  details?: string[];
  provenance: Provenance;
  sources: string[];
}

// 主板主体：中央偏后，左右夹在两只风扇之间（外形为近似）。
export const BOARD = {
  center: [0, 0.34, -6.3] as Vec3,
  main: { w: 16.0, d: 7.8 },
  thickness: 0.08,
};

export const CHIPS: ChipSpec[] = [
  { id: 'soc', name: 'Apple M1 Pro SoC', part: 'Apple M1 Pro（iFixit 识别；具体封装编号未在资料中列出）', side: 1, pos: [0, 0], size: [4.4, 0.12, 3.0], mat: 'soc', provenance: 'teardown', role: 'CPU、GPU、神经网络引擎、媒体引擎、内存控制器、SSD 控制器与安全隔区集成在一颗 5nm 芯片上' },
  { id: 'dram-a', name: 'LPDDR5 8GB #1', part: 'Samsung K3LKYKY0EM-ZGCP', side: 1, pos: [-1.55, 0], size: [1.0, 0.1, 1.5], mat: 'dram', provenance: 'teardown', role: '统一内存，与 SoC 同封装（不可插拔）' },
  { id: 'dram-b', name: 'LPDDR5 8GB #2', part: 'Samsung K3LKYKY0EM-ZGCP', side: 1, pos: [1.55, 0], size: [1.0, 0.1, 1.5], mat: 'dram', provenance: 'teardown', role: '统一内存，与 SoC 同封装（不可插拔）' },
  { id: 'nand-1', name: 'NAND 128GB #1', part: 'Kioxia KICM225UZ0460', side: 1, pos: [-5.6, 1.9], size: [1.3, 0.1, 1.15], mat: 'nand', provenance: 'teardown', role: 'SSD 闪存颗粒，焊在主板上（板载 SSD，不是机械硬盘）' },
  { id: 'nand-2', name: 'NAND 128GB #2', part: 'Kioxia KICM225UZ0460（推导）', side: 1, pos: [-5.6, 0.4], size: [1.3, 0.1, 1.15], mat: 'nand', provenance: 'derived', role: 'SSD 闪存颗粒' },
  { id: 'pmu-1', name: '主电源管理 PMU', part: 'Apple APL1098 / 343S00515', side: 1, pos: [4.6, 1.6], size: [1.0, 0.08, 1.0], mat: 'chip', provenance: 'teardown', role: '为 SoC 各电源域提供多路电压，按负载调节' },
  { id: 'pmu-2', name: '辅助电源管理', part: 'Apple 338S00600', side: 1, pos: [4.6, -0.2], size: [0.8, 0.08, 0.8], mat: 'chip', provenance: 'teardown', role: '辅助电源管理' },
  { id: 'hdmi-conv', name: 'DP→HDMI 转换', part: 'Kinetic MCDP2920', side: 1, pos: [6.6, 2.6], size: [0.6, 0.06, 0.6], mat: 'chip', provenance: 'teardown', role: '把显示输出转换为 HDMI 信号' },
  { id: 'card-ctl', name: '读卡器控制器', part: 'Genesys Logic', side: 1, pos: [6.6, 1.4], size: [0.5, 0.06, 0.5], mat: 'chip', provenance: 'teardown', role: 'SDXC 读卡器控制' },
  { id: 'tb-retimer', name: 'Thunderbolt 4 重定时器', part: 'Intel', side: 1, pos: [-6.7, -2.0], size: [0.7, 0.06, 0.7], mat: 'chip', provenance: 'teardown', role: '为 40 Gb/s 链路重整信号' },
  { id: 'nor', name: '启动 NOR 闪存', part: 'Macronix 64 Mb Serial NOR', side: 1, pos: [2.9, -2.6], size: [0.5, 0.06, 0.4], mat: 'chip', provenance: 'teardown', role: '存放早期固件（教学模型中作为 LLB/iBoot 存放位置）' },
  { id: 'nand-3', name: 'NAND 128GB #3', part: 'Kioxia KICM225VF9081', side: 2, pos: [-5.6, 1.9], size: [1.3, 0.1, 1.15], mat: 'nand', provenance: 'teardown', role: 'SSD 闪存颗粒' },
  { id: 'nand-4', name: 'NAND 128GB #4', part: 'Kioxia KICM225VF9081（推导）', side: 2, pos: [-5.6, 0.4], size: [1.3, 0.1, 1.15], mat: 'nand', provenance: 'derived', role: 'SSD 闪存颗粒' },
  { id: 'wifi', name: 'Wi-Fi 6 / 蓝牙 5.0 模块', part: 'USI 339S00912', side: 2, pos: [2.4, 1.6], size: [1.4, 0.12, 1.1], mat: 'shield', provenance: 'teardown', role: '无线网络与蓝牙；经同轴线连到转轴处天线条' },
  { id: 'nfc', name: 'NFC + 安全元件', part: 'NXP SN210V', side: 2, pos: [4.5, 2.4], size: [0.5, 0.06, 0.5], mat: 'chip', provenance: 'teardown', role: 'Apple Pay 相关的安全元件' },
  { id: 'usbpd', name: 'USB-C / PD 控制器', part: 'TI CD3217B12', side: 2, pos: [-3.2, -2.4], size: [0.7, 0.06, 0.7], mat: 'chip', provenance: 'teardown', role: 'USB-C 端口供电协商与模式切换' },
  { id: 'charger', name: '电池充电控制器', part: 'Renesas ISL9240', side: 2, pos: [0.6, -2.4], size: [0.6, 0.06, 0.6], mat: 'chip', provenance: 'teardown', role: '管理充电电流与电池/适配器之间的功率路径' },
  { id: 'codec', name: '音频编解码器', part: 'Cirrus Logic CS42L84A', side: 2, pos: [5.4, -1.0], size: [0.5, 0.06, 0.5], mat: 'chip', provenance: 'teardown', role: '耳机插孔与麦克风的模拟/数字转换' },
  { id: 'amp', name: '音频功放', part: 'TI SN012776B0', side: 2, pos: [6.6, -1.0], size: [0.5, 0.06, 0.5], mat: 'chip', provenance: 'teardown', role: '驱动六扬声器系统' },
  { id: 'backlight', name: '背光驱动', part: 'TI LP8548B1', side: 2, pos: [5.4, 0.4], size: [0.5, 0.06, 0.5], mat: 'chip', provenance: 'teardown', role: '驱动 mini-LED 背光' },
  { id: 'imu', name: '六轴 IMU', part: 'Bosch BMI282', side: 2, pos: [-1.6, 2.8], size: [0.3, 0.05, 0.3], mat: 'chip', provenance: 'teardown', role: '加速度计/陀螺仪' },
];

const KB_STAGE_NOTE = '键盘与顶壳一体铆接，iFixit 流程中不单独拆下';

export const PARTS: PartDef[] = [
  {
    id: 'lid', name: '显示屏组件', en: 'Display assembly', category: 'display', shape: 'lid',
    pos: [0, 1.25, -0.05], size: [31.26, 0.5, 21.6], mat: 'alu', stage: 10, explode: [0, 0, -16],
    role: '14.2 英寸 Liquid Retina XDR（mini-LED 背光），3024×1964，ProMotion 最高 120 Hz；顶部刘海内为 1080p 摄像头。',
    principle: '显示引擎从统一内存中的帧缓冲逐行扫描像素，经 eDP 排线送到时序控制器，再驱动液晶层；mini-LED 背光分区调光实现高对比度。',
    links: ['logicboard', 'antenna'], linkNote: '两条屏幕排线经转轴进入机身，压接在主板上（iFixit 第 23–26 步）',
    provenance: 'official', sources: ['apple-spec', 'ifixit-logicboard'],
  },
  {
    id: 'topcase', name: '顶壳（含键盘骨架）', en: 'Top case', category: 'shell', shape: 'topcase',
    pos: [0, 0.56, 0], size: [31.26, 0.88, 22.12], mat: 'alu', stage: 0, explode: [0, 0, 0],
    role: '一体成型铝合金机身框架；所有内部组件以螺丝和卡扣固定在它上面。',
    principle: '铝合金既是结构件也是散热面；侧面开出接口孔，后缘与转轴相接。',
    links: ['keyboard', 'trackpad', 'battery-l1', 'logicboard'],
    provenance: 'official', sources: ['apple-spec'],
  },
  {
    id: 'keyboard', name: '妙控键盘 + Touch ID', en: 'Magic Keyboard', category: 'input', shape: 'keyboard',
    pos: [0, 1.0, -4.15], size: [27.4, 0.08, 10.9], mat: 'black', stage: 0, explode: [0, 0, 0],
    role: '78 键（美式），12 个全高功能键，倒 T 方向键；右上角 Touch ID。' + KB_STAGE_NOTE + '。',
    principle: '每个按键是剪刀式结构下的电容/薄膜开关，键盘控制器扫描矩阵后经排线把扫描码送到主板，由 SoC 产生中断。',
    links: ['logicboard'], linkNote: '键盘与背光排线（ZIF）接主板（iFixit 第 46–48 步）；Touch ID 单独一条压接排线',
    provenance: 'official', sources: ['apple-spec', 'ifixit-logicboard'],
  },
  {
    id: 'trackpad', name: 'Force Touch 触控板', en: 'Trackpad', category: 'input', shape: 'box',
    pos: [0, 0.86, 6.0], size: [15.2, 0.28, 8.8], mat: 'glass', stage: 7, explode: [0, 9, 0],
    role: '压力感应触控板，提供力度点按与触觉反馈。',
    principle: '电容阵列定位手指，四角应变片测压力，Taptic 线性马达模拟按压“咔哒”感。',
    links: ['logicboard', 'battery-c1'], linkNote: '触控板排线经支架压接在主板上；由 10 颗 5.7 mm T5 螺丝从底部固定',
    provenance: 'teardown', sources: ['apple-spec', 'ifixit-battery'],
  },
  {
    id: 'lowercase', name: '底壳', en: 'Lower case', category: 'shell', shape: 'lowercase',
    pos: [0, 0.06, 0], size: [31.26, 0.12, 22.12], mat: 'alu', stage: 2, explode: [36, -2, 0],
    role: '铝合金底壳，四个橡胶脚垫；拆下后可见电池、主板、风扇。',
    principle: '靠 8 颗 P5 五角螺丝 + 两侧隐藏卡扣 + 后缘滑扣固定；装回时需沿后缘滑入卡扣。',
    links: ['screws'],
    provenance: 'teardown', sources: ['ifixit-lowercase'],
  },
  {
    id: 'screws', name: '底壳螺丝 ×8', en: 'P5 pentalobe screws', category: 'fastener', shape: 'screws',
    pos: [0, -0.05, 0], size: [29, 0.3, 20], mat: 'screw', stage: 1, explode: [36, -6, -16],
    role: '4 颗 9.3 mm + 4 颗 5 mm 的 P5 五角螺丝。',
    principle: '长短螺丝位置不同，装回时必须放回原孔，否则可能顶伤内部元件。（长短分布位置为近似）',
    links: ['lowercase'],
    provenance: 'teardown', sources: ['ifixit-lowercase'],
  },
  {
    id: 'covers', name: '排线盖板与支架', en: 'Cable covers & brackets', category: 'fastener', shape: 'box',
    pos: [0, 0.44, -2.6], size: [16, 0.04, 0.6], mat: 'shield', stage: 3, explode: [-34, -3, -8],
    role: '压住主板连接器的金属盖板：右侧 5 片（9 颗 T3）、左侧 2 片、屏幕排线盖 2 片、触控板支架 1 片。',
    principle: '压接式连接器靠盖板持续施压保持接触；拆主板前要先断开 18 个连接器。',
    links: ['logicboard'],
    provenance: 'teardown', sources: ['ifixit-logicboard'],
  },
  {
    id: 'logicboard', name: '主逻辑板', en: 'Logic board', category: 'board', shape: 'logicboard',
    pos: BOARD.center, size: [16, 0.6, 7.8], mat: 'pcb', stage: 4, explode: [0, -8.5, 0],
    role: '承载 M1 Pro SoC、统一内存、NAND、电源管理、无线与音频芯片；共 18 个排线连接器。',
    principle: 'SoC 位于朝键盘的一面，被散热器压住；NAND、Wi-Fi 模块等分布在两面。由 11 颗 T5 + 3 颗 T6 螺丝固定。',
    links: ['heatsink', 'battery-board', 'fan-l', 'fan-r', 'keyboard', 'trackpad', 'lid', 'port-l', 'port-r', 'speaker-l', 'speaker-r', 'antenna'],
    linkNote: '拆机流程：先断开电池，再依次断开触控板、天线、屏幕、麦克风、扬声器、接口、Touch ID、键盘、风扇排线',
    provenance: 'teardown', sources: ['ifixit-logicboard', 'ifixit-chipid'],
  },
  {
    id: 'heatsink', name: '散热器（铜底座 + 热管 + 鳍片）', en: 'Heat sink', category: 'thermal', shape: 'heatsink',
    pos: [0, 0.6, -6.3], size: [27, 0.2, 9], mat: 'copper', stage: 5, explode: [0, 4.2, 0],
    role: '把 SoC 的热量经热管导到两侧风扇出风口的鳍片组。',
    principle: '热管内部工质在热端蒸发、冷端冷凝回流，传热效率远高于实心铜；风扇吹过鳍片把热量排出后缘。',
    links: ['logicboard', 'fan-l', 'fan-r'], linkNote: '位于主板朝键盘一面；4 颗 3.9 mm T5 螺丝 + 张力支架压紧，导热膏填缝',
    provenance: 'teardown', sources: ['ifixit-heatsink'],
  },
  {
    id: 'fan-l', name: '左风扇', en: 'Left fan', category: 'thermal', shape: 'fan',
    pos: [-10.9, 0.44, -6.9], size: [5.8, 0.58, 5.8], mat: 'black', stage: 6, explode: [-4, -5, 3],
    role: '离心风扇，从底部吸风，经鳍片从后缘排出。',
    principle: '转速由 SMC/系统根据温度调节；转速越高散热越强、噪声越大。',
    links: ['logicboard', 'heatsink'], linkNote: '风扇排线（ZIF）接主板，排线极易撕裂',
    provenance: 'teardown', sources: ['ifixit-fans'],
  },
  {
    id: 'fan-r', name: '右风扇', en: 'Right fan', category: 'thermal', shape: 'fan',
    pos: [10.9, 0.44, -6.9], size: [5.8, 0.58, 5.8], mat: 'black', stage: 6, explode: [4, -5, 3],
    role: '离心风扇，与左风扇对称。', principle: '同左风扇。',
    links: ['logicboard', 'heatsink'], provenance: 'teardown', sources: ['ifixit-fans'],
  },
  ...(['l1', 'l2', 'c1', 'c2', 'r1', 'r2'] as const).map((k): PartDef => {
    const side = k[0];
    const idx = Number(k[1]);
    const x = side === 'l' ? -11.3 : side === 'r' ? 11.3 : idx === 1 ? -3.7 : 3.7;
    const w = side === 'c' ? 7.2 : 6.9;
    const z = side === 'c' ? 5.85 : idx === 1 ? 3.1 : 7.95;
    const d = side === 'c' ? 8.9 : 4.6;
    return {
      id: `battery-${k}`, name: `电池电芯 ${side === 'l' ? '左' : side === 'r' ? '右' : '中'}${idx}`, en: 'Battery cell',
      category: 'power', shape: 'cell', pos: [x, 0.4, z], size: [w, 0.5, d], mat: 'battery', stage: 8,
      explode: [side === 'l' ? -4 : side === 'r' ? 4 : 0, -3, 4],
      role: '70 Wh 锂聚合物电池组的一部分（整组额定 69.6 Wh）。电芯分布与数量为依据照片的近似。',
      principle: '锂离子在正负极之间往返；电池板（BMS）监测每串电芯电压与温度，防止过充过放。',
      links: ['battery-board'], linkNote: '整组电池由 14 条易拉胶固定（底部 8 条 + 触控板位置 6 条）',
      provenance: 'derived', sources: ['apple-spec', 'ifixit-battery'],
    };
  }),
  {
    id: 'battery-board', name: '电池管理板', en: 'Battery board', category: 'power', shape: 'box',
    pos: [0, 0.26, -0.6], size: [6, 0.08, 2.6], mat: 'pcb', stage: 3, explode: [-34, -3, 8],
    role: '电池保护与电量计；电池电源经此进入主板。',
    principle: '拆机第一步就是断开电池连接器，避免短路；1 颗 4 mm T5 螺丝固定。',
    links: ['logicboard', 'battery-c1'], provenance: 'teardown', sources: ['ifixit-battery'],
  },
  {
    id: 'speaker-l', name: '左扬声器（低音单元）', en: 'Left speaker', category: 'audio', shape: 'box',
    pos: [-10.4, 0.42, -1.6], size: [4.0, 0.52, 3.6], mat: 'speaker', stage: 9, explode: [-6, -4, 0],
    role: '六扬声器系统的一部分，力抵消低音单元成对反向运动以减少振动。',
    principle: '功放把数字音频转换成驱动电流，音圈在磁场中带动振膜发声。',
    links: ['logicboard'], provenance: 'derived', sources: ['apple-spec', 'ifixit-logicboard'],
  },
  {
    id: 'speaker-r', name: '右扬声器（低音单元）', en: 'Right speaker', category: 'audio', shape: 'box',
    pos: [10.4, 0.42, -1.6], size: [4.0, 0.52, 3.6], mat: 'speaker', stage: 9, explode: [6, -4, 0],
    role: '同左扬声器。', principle: '同左扬声器。',
    links: ['logicboard'], provenance: 'derived', sources: ['apple-spec', 'ifixit-logicboard'],
  },
  {
    id: 'port-l', name: '左侧接口模块', en: 'Left I/O', category: 'io', shape: 'port',
    pos: [-14.7, 0.5, -3.3], size: [1.4, 0.5, 9.0], mat: 'port', stage: 9, explode: [-7, -2, 0],
    role: 'MagSafe 3、2 × Thunderbolt 4、3.5 mm 耳机孔，均为独立模块，排线压接到主板。',
    principle: 'Thunderbolt 4 在一根 USB-C 线上复用 PCIe、DisplayPort、USB 与供电（最高 40 Gb/s）。',
    links: ['logicboard'], provenance: 'teardown', sources: ['apple-spec', 'ifixit-logicboard'],
  },
  {
    id: 'port-r', name: '右侧接口', en: 'Right I/O', category: 'io', shape: 'port',
    pos: [14.7, 0.5, -2.6], size: [1.4, 0.5, 8.0], mat: 'port', stage: 9, explode: [7, -2, 0],
    role: 'SDXC、HDMI、1 × Thunderbolt 4。HDMI 与 SDXC 焊在主板上，不是独立可拔接口卡；端口位置为近似。',
    principle: 'HDMI 由 DP→HDMI 转换芯片（Kinetic MCDP2920）生成。',
    links: ['logicboard'], provenance: 'derived', sources: ['apple-spec', 'ifixit-chipid'],
  },
  {
    id: 'antenna', name: '天线条', en: 'Antenna bar', category: 'wireless', shape: 'box',
    pos: [0, 0.75, -10.75], size: [12, 0.4, 0.45], mat: 'black', stage: 9, explode: [0, -3, -4],
    role: 'Wi-Fi / 蓝牙天线，位于转轴处。',
    principle: '三根同轴线把射频信号连到主板上的 Wi-Fi 模块。',
    links: ['logicboard'], provenance: 'teardown', sources: ['ifixit-logicboard'],
  },
];

export const partById = (id: string) => PARTS.find((p) => p.id === id);

export const TEARDOWN_STEPS = [
  { stage: 0, title: '完整整机', note: '一台 14 英寸 MacBook Pro，屏幕打开。' },
  { stage: 1, title: '拧下 8 颗 P5 螺丝', note: '4 颗 9.3 mm + 4 颗 5 mm，记住各自位置。' },
  { stage: 2, title: '取下底壳', note: '吸盘撬开前缘，释放两侧卡扣，再向前滑出后缘滑扣。' },
  { stage: 3, title: '断开电池、拆盖板', note: '先断电池！再拆排线盖板与支架。' },
  { stage: 4, title: '取出主板', note: '断开 18 个连接器，拆 11 颗 T5 + 3 颗 T6 螺丝，主板连同散热器取出。' },
  { stage: 5, title: '主板翻面，取下散热器', note: 'SoC 在朝键盘的一面，被散热器压住；可见 M1 Pro 与两颗 LPDDR5。' },
  { stage: 6, title: '拆下双风扇', note: '6 颗 T3 + 2 颗 T5。' },
  { stage: 7, title: '拆下触控板', note: '10 颗 5.7 mm T5 螺丝，注意 6 个垫圈。' },
  { stage: 8, title: '拉出易拉胶，取出电池', note: '共 14 条易拉胶；拉断时用异丙醇辅助，严禁刺破电芯。' },
  { stage: 9, title: '拆扬声器、接口、天线', note: '拆下左侧可拆接口、扬声器与天线条；HDMI/SDXC 保持板载。' },
  { stage: 10, title: '分离显示屏组件', note: '剩下的是带键盘的顶壳。' },
];

export const MAX_STAGE = TEARDOWN_STEPS[TEARDOWN_STEPS.length - 1].stage;
