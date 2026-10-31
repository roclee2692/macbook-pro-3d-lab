import * as THREE from 'three';
import type { DisplayContent } from '../sim/flows/types';

// 屏幕内容：画到 Canvas 再作为纹理贴到三维显示屏上（3024×1964 的比例，分辨率缩小）。
export const SCREEN_W = 1024;
export const SCREEN_H = Math.round((1024 * 1964) / 3024);

export const screenCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : (null as unknown as HTMLCanvasElement);
if (screenCanvas) {
  screenCanvas.width = SCREEN_W;
  screenCanvas.height = SCREEN_H;
}
export const screenTexture = new THREE.CanvasTexture(screenCanvas);
screenTexture.colorSpace = THREE.SRGBColorSpace;
screenTexture.anisotropy = 4;

const fbCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : (null as unknown as HTMLCanvasElement);

export function drawScreen(c: DisplayContent) {
  const ctx = screenCanvas.getContext('2d')!;
  const W = SCREEN_W;
  const H = SCREEN_H;
  ctx.fillStyle = c.mode === 'off' ? '#030304' : '#0b0d12';
  ctx.fillRect(0, 0, W, H);
  if (c.mode === 'logo') {
    const g = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, 260);
    g.addColorStop(0, '#1c2230');
    g.addColorStop(1, '#0b0d12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e8ebf0';
    ctx.font = '600 44px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('启动中', W / 2, H / 2 - 30);
    ctx.fillStyle = '#2a2f3a';
    ctx.fillRect(W / 2 - 150, H / 2 + 20, 300, 8);
    ctx.fillStyle = c.error ? '#ff5a5f' : '#e8ebf0';
    ctx.fillRect(W / 2 - 150, H / 2 + 20, 300 * c.progress, 8);
    if (c.error) {
      ctx.fillStyle = '#ff8a8f';
      ctx.font = '500 28px -apple-system, "PingFang SC", sans-serif';
      ctx.fillText(c.error, W / 2, H / 2 + 90);
    }
  } else if (c.mode === 'text') {
    ctx.fillStyle = '#d7f7e2';
    ctx.font = '500 40px "SF Mono", Menlo, monospace';
    ctx.textAlign = 'left';
    c.lines.forEach((l, i) => ctx.fillText(l, 80, 140 + i * 60));
  } else if (c.mode === 'fb') {
    fbCanvas.width = c.w;
    fbCanvas.height = c.h;
    const fctx = fbCanvas.getContext('2d')!;
    fctx.putImageData(new ImageData(new Uint8ClampedArray(c.fb), c.w, c.h), 0, 0);
    ctx.imageSmoothingEnabled = false;
    const s = Math.min(W / c.w, H / c.h);
    ctx.drawImage(fbCanvas, (W - c.w * s) / 2, (H - c.h * s) / 2, c.w * s, c.h * s);
  }
  // 刘海区域（相机）
  ctx.fillStyle = '#000';
  const nw = 90;
  ctx.beginPath();
  ctx.roundRect(W / 2 - nw / 2, -10, nw, 32, 10);
  ctx.fill();
  screenTexture.needsUpdate = true;
}
