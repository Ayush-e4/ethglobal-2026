/**
 * Where the tiles are in the camera picture. jsQR gives the code's four corners; a homography
 * maps the code's own square (0..1 × 0..1) onto them, so tiles are found at any angle or tilt.
 */

/** 3×3 homography taking (0,0),(1,0),(1,1),(0,1) to the four points (projective, Heckbert). */
export function squareToQuad(p0, p1, p2, p3) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = [p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y];
  const dx1 = x1 - x2,
    dx2 = x3 - x2,
    dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2,
    dy2 = y3 - y2,
    dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, h;
  if (dx3 === 0 && dy3 === 0) {
    [a, b, c, d, e, f, g, h] = [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0];
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    c = x0;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
    f = y0;
  }
  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
}

/** jsQR's location → a map from code coordinates (u, v in 0..1) to picture pixels. */
export function codeToImage(location) {
  return squareToQuad(
    location.topLeftCorner,
    location.topRightCorner,
    location.bottomRightCorner,
    location.bottomLeftCorner,
  );
}

/**
 * Where to sample, in picture pixels: each tile's inner 60% (points × points), and a light
 * reference per tile from the quiet zone left and right of the code at the same height (rolling
 * shutters and lamp flicker make bands across the picture, so "same height" matters).
 */
export function tilePoints(map, grid, { points = 16, quietU = 0.06, refPoints = 6 } = {}) {
  const tiles = [];
  const refs = [];
  for (let r = 0; r < grid; r++) {
    for (let col = 0; col < grid; col++) {
      const pts = [];
      for (let a = 0; a < points; a++) {
        for (let b = 0; b < points; b++) {
          pts.push(
            map(
              (col + 0.2 + (0.6 * a) / (points - 1)) / grid,
              (r + 0.2 + (0.6 * b) / (points - 1)) / grid,
            ),
          );
        }
      }
      tiles.push(pts);
      const ref = [];
      for (let b = 0; b < refPoints; b++) {
        const v = (r + 0.2 + (0.6 * b) / (refPoints - 1)) / grid;
        ref.push(map(-quietU, v), map(1 + quietU, v));
      }
      refs.push(ref);
    }
  }
  return { tiles, refs };
}

/** Bilinear RGB lookup in RGBA bytes; adds into `out`. */
export function imageSampler({ data, width, height }) {
  return (x, y, out) => {
    const x0 = Math.max(0, Math.min(width - 2, Math.floor(x)));
    const y0 = Math.max(0, Math.min(height - 2, Math.floor(y)));
    const fx = Math.min(1, Math.max(0, x - x0));
    const fy = Math.min(1, Math.max(0, y - y0));
    for (let c = 0; c < 3; c++) {
      const i00 = (y0 * width + x0) * 4 + c;
      const i10 = i00 + 4;
      const i01 = i00 + width * 4;
      const i11 = i01 + 4;
      out[c] +=
        (data[i00] * (1 - fx) + data[i10] * fx) * (1 - fy) +
        (data[i01] * (1 - fx) + data[i11] * fx) * fy;
    }
  };
}

/** Mean RGB of every tile and its reference, using any sampler(x, y, out). */
export function measure(points, sample) {
  const mean = (pts) => {
    const acc = [0, 0, 0];
    for (const p of pts) sample(p.x, p.y, acc);
    return acc.map((s) => s / pts.length);
  };
  return { tiles: points.tiles.map(mean), refs: points.refs.map(mean) };
}

export function sampleTiles(img, map, grid, opts) {
  return measure(tilePoints(map, grid, opts), imageSampler(img));
}
