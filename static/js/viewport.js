// One image pane: canvas rendering, screen <-> image transforms, overlays and HUD.
import { orientationMarkers } from './volume.js';
import { t as tr, fmt } from './i18n.js'; // 't' is used for canvas transforms here

export const PLANE_COLORS = { axial: '#0A84FF', coronal: '#30D158', sagittal: '#FF9F0A' };
const COLOR_FINDING = '#FFD60A';
const COLOR_SELECTED = '#64D2FF';
const FONT = '600 12px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", sans-serif';

export class Viewport {
  /**
   * @param {HTMLElement} el container element
   * @param {() => object} scene callback returning shared render state
   */
  constructor(el, scene) {
    this.el = el;
    this.scene = scene;
    this.volume = null;
    this.plane = 'axial';
    this.index = 0;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.badge = '';
    this.probe = null;
    this._key = '';
    this._dirty = false;

    el.innerHTML = `
      <canvas></canvas>
      <div class="hud tl"></div><div class="hud tr"></div>
      <div class="hud bl"></div><div class="hud br"></div>
      <div class="orient o-top"></div><div class="orient o-bottom"></div>
      <div class="orient o-left"></div><div class="orient o-right"></div>
      <div class="vp-empty" hidden></div>`;
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.offCtx = this.off.getContext('2d');
    this.hud = {
      tl: el.querySelector('.tl'), tr: el.querySelector('.tr'),
      bl: el.querySelector('.bl'), br: el.querySelector('.br'),
    };
    this.orient = {
      top: el.querySelector('.o-top'), bottom: el.querySelector('.o-bottom'),
      left: el.querySelector('.o-left'), right: el.querySelector('.o-right'),
    };
    this.emptyEl = el.querySelector('.vp-empty');
    new ResizeObserver(() => this.invalidate()).observe(el);
  }

  get geometry() { return this.volume ? this.volume.geometry(this.plane) : null; }
  get visible() { return this.el.offsetParent !== null; }

  setEmpty(html) {
    this.emptyEl.hidden = !html;
    if (html) this.emptyEl.innerHTML = html;
  }

  invalidate() {
    if (this._dirty) return;
    this._dirty = true;
    requestAnimationFrame(() => this.draw());
  }

  resetView() { this.zoom = 1; this.panX = 0; this.panY = 0; }

  // ---- transforms ---------------------------------------------------------
  transform() {
    const g = this.geometry;
    const cw = this.el.clientWidth, ch = this.el.clientHeight;
    const W = g.w * g.pw, H = g.h * g.ph;
    const s = Math.min(cw / W, ch / H) * 0.94 * this.zoom; // CSS px per mm
    return { g, s, dx: (cw - W * s) / 2 + this.panX, dy: (ch - H * s) / 2 + this.panY };
  }

  /** image coords [col, row] (continuous, pixel centres at +0.5) -> CSS px */
  toScreen([c, r], t = this.transform()) {
    return [t.dx + c * t.g.pw * t.s, t.dy + r * t.g.ph * t.s];
  }

  toImage(x, y, t = this.transform()) {
    return [(x - t.dx) / (t.g.pw * t.s), (y - t.dy) / (t.g.ph * t.s)];
  }

  /** Voxel [z,y,x] under a CSS-pixel point, or null outside the image. */
  voxelAt(x, y) {
    if (!this.volume) return null;
    const [c, r] = this.toImage(x, y);
    const g = this.geometry;
    if (c < 0 || r < 0 || c >= g.w || r >= g.h) return null;
    return this.volume.toVoxel(this.plane, this.index, Math.floor(r), Math.floor(c));
  }

  zoomAt(factor, x, y) {
    const t = this.transform();
    const p = this.toImage(x, y, t);
    this.zoom = Math.min(12, Math.max(0.25, this.zoom * factor));
    const [nx, ny] = this.toScreen(p);
    this.panX += x - nx;
    this.panY += y - ny;
    this.invalidate();
  }

  // ---- rendering ----------------------------------------------------------
  _updateImage(scene) {
    const { slab, lutVersion, lut } = scene;
    const key = `${this.volume.id}|${this.plane}|${this.index}|${slab.mode}|${slab.mm}|${lutVersion}`;
    if (key === this._key) return;
    this._key = key;
    const g = this.geometry;
    const { pixels, slices } = this.volume.render(this.plane, this.index, slab.mode, slab.mm);
    this.slabSlices = slices;
    if (this.off.width !== g.w || this.off.height !== g.h) {
      this.off.width = g.w;
      this.off.height = g.h;
      this._imageData = this.offCtx.createImageData(g.w, g.h);
    }
    const out = new Uint32Array(this._imageData.data.buffer);
    for (let i = 0; i < pixels.length; i++) out[i] = lut[pixels[i] + 32768];
    this.offCtx.putImageData(this._imageData, 0, 0);
  }

  draw() {
    this._dirty = false;
    const dpr = window.devicePixelRatio || 1;
    const cw = this.el.clientWidth, ch = this.el.clientHeight;
    if (!cw || !ch) return;
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    if (!this.volume) { this._hud(null); return; }

    const scene = this.scene(this);
    this.index = Math.max(0, Math.min(this.geometry.depth - 1, this.index));
    this._updateImage(scene);
    const t = this.transform();
    const { g } = t;
    ctx.imageSmoothingEnabled = t.s * g.pw < 4;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.off, t.dx, t.dy, g.w * g.pw * t.s, g.h * g.ph * t.s);

    if (scene.crosshair && scene.cursor && this.volume === scene.primary) this._drawCrosshair(t, scene.cursor);
    for (const f of scene.findings) {
      if (f.plane === this.plane && f.index === this.index && f.seriesId === this.volume.id) {
        this._drawFinding(t, f, f.id === scene.selectedId, false);
      }
    }
    if (scene.draft && scene.draft.vp === this) this._drawFinding(t, scene.draft, true, true);
    this._hud(scene);
  }

  _drawCrosshair(t, cursor) {
    const ctx = this.ctx;
    const { r, c } = this.volume.fromVoxel(this.plane, cursor);
    const [x, y] = this.toScreen([c + 0.5, r + 0.5], t);
    const cw = this.el.clientWidth, ch = this.el.clientHeight;
    const gap = 14;
    // horizontal line = the plane that is constant along rows
    const hColor = this.plane === 'axial' ? PLANE_COLORS.coronal : PLANE_COLORS.axial;
    const vColor = this.plane === 'sagittal' ? PLANE_COLORS.coronal : PLANE_COLORS.sagittal;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = hColor;
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y); ctx.lineTo(cw, y);
    ctx.stroke();
    ctx.strokeStyle = vColor;
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap); ctx.lineTo(x, ch);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  _drawFinding(t, f, selected, draft) {
    const ctx = this.ctx;
    const color = selected ? COLOR_SELECTED : COLOR_FINDING;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = selected ? 2 : 1.5;
    if (draft) ctx.setLineDash([5, 4]);
    ctx.shadowColor = 'rgba(0,0,0,.8)';
    ctx.shadowBlur = 3;
    const a = this.toScreen(f.p1, t);
    let lines = [];
    let anchor;
    if (f.type === 'length') {
      const b = this.toScreen(f.p2, t);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      ctx.setLineDash([]);
      for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, Math.PI * 2); ctx.fill(); }
      lines = [`${fmt(f.value.mm, 1)} mm`];
      anchor = a[1] < b[1] ? b : a;
    } else if (f.type === 'ellipse') {
      const b = this.toScreen(f.p2, t);
      ctx.beginPath();
      ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      const s = f.value;
      const hu = tr('unit.hu');
      if (s) lines = [`${Math.round(s.mean)} ± ${Math.round(s.sd)} ${hu}`, `${s.min} / ${s.max} ${hu}`, formatArea(s.areaMM2)];
      anchor = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    } else {
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(a[0], a[1], 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(a[0], a[1], 1.8, 0, Math.PI * 2); ctx.fill();
      lines = f.value?.hu != null ? [`${f.value.hu} ${tr('unit.hu')}`] : [];
      anchor = [a[0] + 6, a[1] + 6];
    }
    ctx.restore();
    if (!draft || lines.length) this._bubble(anchor, f.label && !draft ? [f.label, ...lines] : lines, color);
  }

  _bubble([x, y], lines, color) {
    if (!lines.length) return;
    const ctx = this.ctx;
    ctx.font = FONT;
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14;
    const h = lines.length * 16 + 8;
    const bx = Math.min(x + 8, this.el.clientWidth - w - 4);
    const by = Math.min(y + 8, this.el.clientHeight - h - 4);
    ctx.fillStyle = 'rgba(28,28,30,.82)';
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, 7);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 && lines.length > 1 ? color : '#F5F5F7';
      ctx.fillText(l, bx + 7, by + 17 + i * 16);
    });
  }

  _hud(scene) {
    const v = this.volume;
    for (const k of ['tl', 'tr', 'bl', 'br']) this.hud[k].innerHTML = '';
    for (const k in this.orient) this.orient[k].textContent = '';
    if (!v || !scene) return;
    const g = this.geometry;
    const pos = v.slicePosition(this.plane, this.index);
    const dot = `<i style="background:${PLANE_COLORS[this.plane]}"></i>`;
    this.hud.tl.innerHTML =
      `<b>${dot}${tr(`plane.${this.plane}`)}${this.badge ? `<span class="badge">${tr(this.badge)}</span>` : ''}</b>` +
      `<span>${tr('hud.im')} ${this.index + 1} / ${g.depth}</span>` +
      `<span>${this.plane === 'axial' ? 'Z' : this.plane === 'coronal' ? 'Y' : 'X'} ${fmt(pos, 1)} mm</span>`;
    const slab = scene.slab.mode !== 'none' && this.slabSlices > 1
      ? `<span class="accent">${tr(`hud.slab.${scene.slab.mode}`)} ${fmt(this.slabSlices * g.ds)} mm</span>` : '';
    this.hud.tr.innerHTML =
      `<span>${tr('hud.wl', { c: Math.round(scene.wl.c), w: Math.round(scene.wl.w) })}${scene.invert ? ` · ${tr('hud.inv')}` : ''}</span>${slab}` +
      `<span class="dim">${v.id.slice(0, 10)}…</span>`;
    this.hud.br.innerHTML = `<span>${Math.round(this.zoom * 100)} %</span>`;
    if (this.probe) {
      const p = this.probe;
      this.hud.bl.innerHTML = `<span><b>${p.hu} ${tr('unit.hu')}</b></span><span class="dim">x ${p.vox[2]}  y ${p.vox[1]}  z ${p.vox[0]}</span>`;
    }
    const m = orientationMarkers(v, this.plane);
    for (const k in m) this.orient[k].textContent = tr(`orient.${m[k]}`);
  }

  // ---- hit testing --------------------------------------------------------
  hitTest(x, y, findings) {
    if (!this.volume) return null;
    const t = this.transform();
    for (const f of findings) {
      if (f.plane !== this.plane || f.index !== this.index || f.seriesId !== this.volume.id) continue;
      const a = this.toScreen(f.p1, t);
      if (f.type === 'point' && Math.hypot(x - a[0], y - a[1]) < 10) return f;
      if (f.type === 'length') {
        const b = this.toScreen(f.p2, t);
        if (distToSegment([x, y], a, b) < 6) return f;
      }
      if (f.type === 'ellipse') {
        const b = this.toScreen(f.p2, t);
        const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
        const rx = Math.abs(b[0] - a[0]) / 2 + 4, ry = Math.abs(b[1] - a[1]) / 2 + 4;
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) return f;
      }
    }
    return null;
  }

  /** PNG of the pane including image, overlays and corner text. */
  snapshot() {
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(this.canvas, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    ctx.font = FONT;
    ctx.fillStyle = '#F5F5F7';
    const cw = this.el.clientWidth, ch = this.el.clientHeight;
    const text = el => [...el.children].map(c => c.textContent.trim()).filter(Boolean);
    text(this.hud.tl).forEach((l, i) => ctx.fillText(l, 12, 22 + i * 16));
    ctx.textAlign = 'right';
    text(this.hud.tr).forEach((l, i) => ctx.fillText(l, cw - 12, 22 + i * 16));
    ctx.textAlign = 'center';
    ctx.fillText(this.orient.top.textContent, cw / 2, 18);
    ctx.fillText(this.orient.bottom.textContent, cw / 2, ch - 10);
    ctx.textAlign = 'left';
    ctx.fillText(this.orient.left.textContent, 6, ch / 2);
    ctx.textAlign = 'right';
    ctx.fillText(this.orient.right.textContent, cw - 6, ch / 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(235,235,245,.6)';
    ctx.fillText(tr('snapshot.watermark'), 12, ch - 10);
    return out;
  }
}

export function formatArea(mm2) {
  return mm2 >= 100 ? `${fmt(mm2 / 100, 2)} cm²` : `${fmt(mm2, 1)} mm²`;
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
