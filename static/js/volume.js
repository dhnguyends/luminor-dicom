// HU volume held in the browser, with plane geometry, slab projections and ROI statistics.
//
// Voxel order is (z, y, x); z runs inferior -> superior (sorted by the server).
// Planes are addressed as (index, row, col):
//   axial    index=z  row=y          col=x
//   coronal  index=y  row=nz-1-z     col=x   (superior at the top)
//   sagittal index=x  row=nz-1-z     col=y

export const PLANES = ['axial', 'coronal', 'sagittal'];

export class Volume {
  constructor(meta, buffer) {
    this.meta = meta;
    this.id = meta.id;
    this.data = new Int16Array(buffer);
    [this.nz, this.ny, this.nx] = meta.shape;
    [this.sz, this.sy, this.sx] = meta.spacing;
    this.zpos = meta.z_positions;
    this.origin = meta.origin;
    this.orientation = meta.orientation;
    this._tmp = null;
  }

  value(z, y, x) {
    if (z < 0 || y < 0 || x < 0 || z >= this.nz || y >= this.ny || x >= this.nx) return null;
    return this.data[(z * this.ny + y) * this.nx + x];
  }

  /** Width/height in pixels, pixel size in mm, number of slices and slice spacing. */
  geometry(plane) {
    switch (plane) {
      case 'axial': return { w: this.nx, h: this.ny, pw: this.sx, ph: this.sy, depth: this.nz, ds: this.sz };
      case 'coronal': return { w: this.nx, h: this.nz, pw: this.sx, ph: this.sz, depth: this.ny, ds: this.sy };
      default: return { w: this.ny, h: this.nz, pw: this.sy, ph: this.sz, depth: this.nx, ds: this.sx };
    }
  }

  toVoxel(plane, index, r, c) {
    if (plane === 'axial') return [index, r, c];
    if (plane === 'coronal') return [this.nz - 1 - r, index, c];
    return [this.nz - 1 - r, c, index];
  }

  fromVoxel(plane, [z, y, x]) {
    if (plane === 'axial') return { index: z, r: y, c: x };
    if (plane === 'coronal') return { index: y, r: this.nz - 1 - z, c: x };
    return { index: x, r: this.nz - 1 - z, c: y };
  }

  /** Patient coordinate (mm) of a plane's slice, along its normal. */
  slicePosition(plane, index) {
    if (plane === 'axial') return this.zpos[Math.max(0, Math.min(this.nz - 1, index))];
    if (plane === 'coronal') return this.origin[1] + index * this.sy;
    return this.origin[0] + index * this.sx;
  }

  /** Nearest slice index for a patient coordinate along the plane normal. */
  indexAt(plane, mm) {
    const g = this.geometry(plane);
    let i;
    if (plane === 'axial') {
      const z0 = this.zpos[0];
      const step = this.nz > 1 ? (this.zpos[this.nz - 1] - z0) / (this.nz - 1) : 1;
      i = Math.round((mm - z0) / step);
    } else if (plane === 'coronal') {
      i = Math.round((mm - this.origin[1]) / this.sy);
    } else {
      i = Math.round((mm - this.origin[0]) / this.sx);
    }
    return Math.max(0, Math.min(g.depth - 1, i));
  }

  /** Patient (LPS) coordinates in mm of a voxel. */
  patientMM([z, y, x]) {
    const [rx, ry, rz, cx, cy, cz] = this.orientation;
    const [ox, oy] = this.origin;
    return [
      ox + x * this.sx * rx + y * this.sy * cx,
      oy + x * this.sx * ry + y * this.sy * cy,
      this.zpos[Math.max(0, Math.min(this.nz - 1, Math.round(z)))],
    ];
  }

  /** Copy one plane slice into ``out`` (Int16Array of w*h). */
  readPlane(plane, index, out) {
    const { nx, ny, nz, data } = this;
    if (plane === 'axial') {
      out.set(data.subarray(index * ny * nx, (index + 1) * ny * nx));
    } else if (plane === 'coronal') {
      for (let r = 0; r < nz; r++) {
        const src = ((nz - 1 - r) * ny + index) * nx;
        out.set(data.subarray(src, src + nx), r * nx);
      }
    } else {
      for (let r = 0; r < nz; r++) {
        const base = (nz - 1 - r) * ny * nx + index;
        const row = r * ny;
        for (let c = 0; c < ny; c++) out[row + c] = data[base + c * nx];
      }
    }
    return out;
  }

  /**
   * Slice image, optionally as a slab projection.
   * mode: 'none' | 'mip' | 'minip' | 'avg'; thicknessMM: slab thickness.
   * Returns { pixels: Int16Array, slices: number of slices combined }.
   */
  render(plane, index, mode = 'none', thicknessMM = 0) {
    const g = this.geometry(plane);
    const n = g.w * g.h;
    const out = new Int16Array(n);
    const count = mode === 'none' ? 1 : Math.max(1, Math.round(thicknessMM / g.ds));
    if (count === 1) return { pixels: this.readPlane(plane, index, out), slices: 1 };

    const half = Math.floor((count - 1) / 2);
    const lo = Math.max(0, index - half);
    const hi = Math.min(g.depth - 1, lo + count - 1);
    if (!this._tmp || this._tmp.length < n) this._tmp = new Int16Array(n);
    const tmp = this._tmp.subarray(0, n);

    if (mode === 'avg') {
      const acc = new Float32Array(n);
      for (let k = lo; k <= hi; k++) {
        this.readPlane(plane, k, tmp);
        for (let i = 0; i < n; i++) acc[i] += tmp[i];
      }
      const inv = 1 / (hi - lo + 1);
      for (let i = 0; i < n; i++) out[i] = Math.round(acc[i] * inv);
    } else {
      this.readPlane(plane, lo, out);
      for (let k = lo + 1; k <= hi; k++) {
        this.readPlane(plane, k, tmp);
        if (mode === 'mip') { for (let i = 0; i < n; i++) if (tmp[i] > out[i]) out[i] = tmp[i]; }
        else { for (let i = 0; i < n; i++) if (tmp[i] < out[i]) out[i] = tmp[i]; }
      }
    }
    return { pixels: out, slices: hi - lo + 1 };
  }

  /** HU statistics inside an ellipse given by its bounding box corners (plane pixel coords). */
  ellipseStats(plane, index, p1, p2) {
    const g = this.geometry(plane);
    const slice = this.readPlane(plane, index, new Int16Array(g.w * g.h));
    const cx = (p1[0] + p2[0]) / 2, cy = (p1[1] + p2[1]) / 2;
    const rx = Math.abs(p2[0] - p1[0]) / 2, ry = Math.abs(p2[1] - p1[1]) / 2;
    if (rx < 0.5 || ry < 0.5) return null;
    let n = 0, sum = 0, sum2 = 0, min = Infinity, max = -Infinity;
    const c0 = Math.max(0, Math.floor(cx - rx)), c1 = Math.min(g.w - 1, Math.ceil(cx + rx));
    const r0 = Math.max(0, Math.floor(cy - ry)), r1 = Math.min(g.h - 1, Math.ceil(cy + ry));
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5 - cy) / ry;
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5 - cx) / rx;
        if (dx * dx + dy * dy > 1) continue;
        const v = slice[r * g.w + c];
        n++; sum += v; sum2 += v * v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!n) return null;
    const mean = sum / n;
    return {
      mean, sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), min, max, n,
      areaMM2: n * g.pw * g.ph,
    };
  }

  lengthMM(plane, p1, p2) {
    const g = this.geometry(plane);
    return Math.hypot((p2[0] - p1[0]) * g.pw, (p2[1] - p1[1]) * g.ph);
  }
}

// Orientation letters (DICOM LPS: +x = Left, +y = Posterior, +z = Superior)
function letter(v) {
  const a = v.map(Math.abs);
  const i = a.indexOf(Math.max(...a));
  return [['R', 'L'], ['A', 'P'], ['I', 'S']][i][v[i] > 0 ? 1 : 0];
}
const opposite = { R: 'L', L: 'R', A: 'P', P: 'A', S: 'I', I: 'S' };

/** Edge markers {left, right, top, bottom} for a plane. */
export function orientationMarkers(volume, plane) {
  const row = volume.orientation.slice(0, 3); // direction of increasing column index (x)
  const col = volume.orientation.slice(3, 6); // direction of increasing row index (y)
  let right, bottom;
  if (plane === 'axial') { right = letter(row); bottom = letter(col); }
  else if (plane === 'coronal') { right = letter(row); bottom = 'I'; }
  else { right = letter(col); bottom = 'I'; }
  return { right, left: opposite[right], bottom, top: opposite[bottom] };
}
