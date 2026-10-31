import type { Provenance } from './sources';

// 真实硬件固定参数：只读，不允许在实验面板里修改。
export interface Spec {
  key: string;
  label: string;
  value: string;
  provenance: Provenance;
  source: string;
}

export const MACHINE = {
  name: 'MacBook Pro (14-inch, 2021)',
  model: 'A2442',
  config: 'M1 Pro 8 核 CPU（6P+2E）· 14 核 GPU · 16GB 统一内存 · 512GB SSD',
};

// 物理尺寸（cm），三维模型以此为准。
export const DIM = {
  width: 31.26,
  depth: 22.12,
  height: 1.55,
};

export const SPECS: Spec[] = [
  { key: 'size', label: '尺寸', value: '31.26 × 22.12 × 1.55 cm', provenance: 'official', source: 'apple-spec' },
  { key: 'weight', label: '重量', value: '1.6 kg', provenance: 'official', source: 'apple-spec' },
  { key: 'cpu', label: 'CPU', value: '8 核：6 个性能核 + 2 个能效核', provenance: 'official', source: 'apple-spec' },
  { key: 'gpu', label: 'GPU', value: '14 核', provenance: 'official', source: 'apple-spec' },
  { key: 'npu', label: '神经网络引擎', value: '16 核', provenance: 'official', source: 'apple-spec' },
  { key: 'membw', label: '内存带宽', value: '200 GB/s', provenance: 'official', source: 'apple-spec' },
  { key: 'mem', label: '统一内存', value: '16 GB（2 颗 8 GB LPDDR5，封装在 SoC 基板上）', provenance: 'teardown', source: 'ifixit-chipid' },
  { key: 'ssd', label: '存储', value: '512 GB SSD（Kioxia 128 GB NAND，板载焊接）', provenance: 'teardown', source: 'ifixit-chipid' },
  { key: 'nandcount', label: 'NAND 颗数', value: '4 × 128 GB（由容量推算）', provenance: 'derived', source: 'ifixit-chipid' },
  { key: 'display', label: '显示屏', value: '14.2 英寸 Liquid Retina XDR，3024×1964，254 ppi', provenance: 'official', source: 'apple-spec' },
  { key: 'refresh', label: '刷新率', value: 'ProMotion 自适应，最高 120 Hz', provenance: 'official', source: 'apple-spec' },
  { key: 'battery', label: '电池', value: 'Apple 标称 70 Wh；拆机电池组额定 69.6 Wh', provenance: 'derived', source: 'ifixit-battery' },
  { key: 'adapter', label: '电源适配器', value: '67 W USB-C（8 核 CPU 机型随附）', provenance: 'official', source: 'apple-spec' },
  { key: 'ports', label: '接口', value: '3 × Thunderbolt 4、HDMI、SDXC、MagSafe 3、3.5 mm 耳机', provenance: 'official', source: 'apple-spec' },
  { key: 'wireless', label: '无线', value: 'Wi-Fi 6 (802.11ax)、蓝牙 5.0', provenance: 'official', source: 'apple-spec' },
  { key: 'keys', label: '键盘', value: '78 键（美式），12 个全高功能键，倒 T 方向键，Touch ID', provenance: 'official', source: 'apple-spec' },
  { key: 'page', label: '虚拟内存页', value: '16 KB', provenance: 'official', source: 'apple-dev-16k' },
  { key: 'l1', label: 'P 核 L1', value: '192 KB 指令 + 128 KB 数据', provenance: 'derived', source: 'third-party-m1pro' },
  { key: 'l2', label: 'L2', value: 'P 簇 2 × 12 MB，E 簇 4 MB', provenance: 'derived', source: 'third-party-m1pro' },
  { key: 'slc', label: '系统级缓存 SLC', value: '24 MB', provenance: 'derived', source: 'third-party-m1pro' },
  { key: 'membus', label: '内存总线', value: '256-bit LPDDR5-6400 → 204.8 GB/s（Apple 标称 200 GB/s）', provenance: 'derived', source: 'third-party-m1pro' },
  { key: 'freq', label: '最高频率', value: 'P 核约 3.2 GHz，E 核约 2.06 GHz', provenance: 'derived', source: 'third-party-m1pro' },
];

export const specByKey = (k: string) => SPECS.find((s) => s.key === k);
