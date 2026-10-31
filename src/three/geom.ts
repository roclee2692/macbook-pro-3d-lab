import * as THREE from 'three';

// 在 xz 平面上画圆角矩形，再拉伸成水平板。world z 与 shape y 符号相反（rotateX(-90°) 的结果）。
export function roundRect(shape: THREE.Shape | THREE.Path, cx: number, cz: number, w: number, d: number, r: number) {
  const x0 = cx - w / 2;
  const y0 = -cz - d / 2;
  const x1 = cx + w / 2;
  const y1 = -cz + d / 2;
  r = Math.min(r, w / 2, d / 2);
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x1 - r, y0);
  shape.quadraticCurveTo(x1, y0, x1, y0 + r);
  shape.lineTo(x1, y1 - r);
  shape.quadraticCurveTo(x1, y1, x1 - r, y1);
  shape.lineTo(x0 + r, y1);
  shape.quadraticCurveTo(x0, y1, x0, y1 - r);
  shape.lineTo(x0, y0 + r);
  shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  return shape;
}

export interface Hole {
  cx: number;
  cz: number;
  w: number;
  d: number;
  r: number;
}

/** 水平板：外轮廓 + 若干开孔，从 y0 向上拉伸 h */
export function slab(w: number, d: number, r: number, h: number, holes: Hole[] = [], bevel = 0): THREE.ExtrudeGeometry {
  const s = roundRect(new THREE.Shape(), 0, 0, w, d, r) as THREE.Shape;
  for (const hl of holes) s.holes.push(roundRect(new THREE.Path(), hl.cx, hl.cz, hl.w, hl.d, hl.r) as THREE.Path);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: h - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return g;
}

/** 圆角矩形环（壁） */
export function ring(w: number, d: number, r: number, wall: number, h: number) {
  return slab(w, d, r, h, [{ cx: 0, cz: 0, w: w - wall * 2, d: d - wall * 2, r: Math.max(0.1, r - wall) }]);
}

export const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
