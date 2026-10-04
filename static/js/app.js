// Luminor — application state, layouts, tools, findings and UI wiring.
import { Volume } from './volume.js';
import { Viewport, formatArea } from './viewport.js';
import { icon } from './icons.js';
import { t, fmt, getLang, setLang, applyStatic, locale } from './i18n.js';

const $ = id => document.getElementById(id);

const PRESETS = [
  { key: 'lung', c: -600, w: 1500 },
  { key: 'mediastinum', c: 40, w: 400 },
  { key: 'bone', c: 400, w: 1800 },
  { key: 'liver', c: 60, w: 160 },
  { key: 'brain', c: 40, w: 80 },
];
const TOOLS = [
  { key: 'crosshair', hotkey: 'X', icon: 'scope' },
  { key: 'wl', hotkey: 'W', icon: 'contrast' },
  { key: 'pan', hotkey: 'H', icon: 'hand' },
  { key: 'zoom', hotkey: 'Z', icon: 'zoom' },
  { key: 'length', hotkey: 'M', icon: 'ruler' },
  { key: 'ellipse', hotkey: 'E', icon: 'ellipse' },
];
const LAYOUTS = [
  { key: 'single', icon: 'single', hotkey: '' },
  { key: 'mpr', icon: 'mpr', hotkey: '' },
  { key: 'compare', icon: 'compare', hotkey: '' },
];
const PLANES = [
  { key: 'axial', hotkey: 'A' },
  { key: 'coronal', hotkey: 'C' },
  { key: 'sagittal', hotkey: 'S' },
];
const AXIS = { axial: 0, coronal: 1, sagittal: 2 }; // cursor component driven by each plane

const state = {
  catalog: [],
  filter: 'all',
  query: '',
  primary: null,        // Volume
  prior: null,          // Volume (comparison)
  layout: 'single',
  plane: 'axial',
  tool: 'crosshair',
  wl: { c: -600, w: 1500 },
  preset: 'lung',
  invert: false,
  lut: new Uint32Array(65536),
  lutVersion: 0,
  slab: { mode: 'none', mm: 10 },
  cursor: [0, 0, 0],
  priorIndex: 0,
  linked: true,
  linkOffset: 0,
  findings: [],
  selectedId: null,
  draft: null,
  active: null,
  maximized: null,
  cine: { playing: false, fps: 12, last: 0 },
};

// ---------------------------------------------------------------------------
// Viewports
// ---------------------------------------------------------------------------
const scene = () => ({
  lut: state.lut, lutVersion: state.lutVersion, wl: state.wl, invert: state.invert,
  slab: state.slab, cursor: state.cursor, primary: state.primary,
  crosshair: state.layout === 'mpr' || state.tool === 'crosshair',
  findings: state.findings, selectedId: state.selectedId, draft: state.draft,
});
const vps = {
  main: new Viewport($('vp-main'), scene),
  cor: new Viewport($('vp-cor'), scene),
  sag: new Viewport($('vp-sag'), scene),
  prior: new Viewport($('vp-prior'), scene),
};
vps.prior.badge = 'hud.badge.compare'; // translation key

function visibleViewports() {
  if (state.layout === 'mpr') return [vps.main, vps.cor, vps.sag];
  if (state.layout === 'compare') return [vps.main, vps.prior];
  return [vps.main];
}

/** Push global state (cursor, planes, volumes) into the viewports and redraw. */
function sync() {
  const planes = state.layout === 'mpr' ? { main: 'axial', cor: 'coronal', sag: 'sagittal' } : { main: state.plane };
  for (const [k, plane] of Object.entries(planes)) {
    const vp = vps[k];
    vp.volume = state.primary;
    vp.plane = plane;
    if (state.primary) vp.index = state.primary.fromVoxel(plane, state.cursor).index;
  }
  vps.prior.volume = state.prior;
  vps.prior.plane = state.plane;
  vps.prior.index = state.priorIndex;
  vps.prior.setEmpty(state.layout === 'compare' && !state.prior
    ? `${icon('duplicate', 'big')}<strong>${t('empty.prior.title')}</strong><span>${t('empty.prior.text', { icon: icon('duplicate', 'inline') })}</span>` : '');
  vps.main.setEmpty(!state.primary
    ? `${icon('lungs', 'big')}<strong>${t('empty.primary.title')}</strong><span>${t('empty.primary.text')}</span>` : '');
  for (const vp of Object.values(vps)) vp.invalidate();
  updateStatus();
}

function setActive(vp) {
  if (state.active === vp) return;
  state.active = vp;
  for (const v of Object.values(vps)) v.el.classList.toggle('active', v === vp);
}

// ---------------------------------------------------------------------------
// Window / level
// ---------------------------------------------------------------------------
function buildLut() {
  const { c, w } = state.wl;
  const lo = c - w / 2;
  const k = 255 / Math.max(1, w);
  const lut = state.lut;
  for (let i = 0; i < 65536; i++) {
    let g = ((i - 32768) - lo) * k;
    g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
    if (state.invert) g = 255 - g;
    lut[i] = 0xff000000 | (g << 16) | (g << 8) | g;
  }
  state.lutVersion++;
}

function setWindow(c, w, preset = null) {
  state.wl = { c: Math.round(c), w: Math.max(1, Math.round(w)) };
  state.preset = preset;
  buildLut();
  $('wl-c').value = state.wl.c;
  $('wl-w').value = state.wl.w;
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', b.dataset.key === preset));
  for (const vp of visibleViewports()) vp.invalidate();
}

function applyPreset(key) {
  const p = PRESETS.find(p => p.key === key);
  if (p) { setWindow(p.c, p.w, p.key); toast(t('toast.window', { name: t(`preset.${p.key}`) })); }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function scroll(vp, delta) {
  if (!vp?.volume) return;
  const depth = vp.geometry.depth;
  const next = Math.max(0, Math.min(depth - 1, vp.index + delta));
  if (next === vp.index) return;
  if (vp === vps.prior) {
    state.priorIndex = next;
    if (state.linked && state.primary) {
      const mm = state.prior.slicePosition(state.plane, next) - state.linkOffset;
      state.cursor[AXIS[state.plane]] = state.primary.indexAt(state.plane, mm);
    }
  } else {
    state.cursor[AXIS[vp.plane]] = next;
    if (state.layout === 'compare' && state.linked && state.prior && vp.plane === state.plane) {
      const mm = state.primary.slicePosition(state.plane, next) + state.linkOffset;
      state.priorIndex = state.prior.indexAt(state.plane, mm);
    }
  }
  sync();
}

function scrollTo(vp, index) { if (vp?.volume) scroll(vp, index - vp.index); }

function setCursorFromScreen(vp, x, y) {
  const vox = vp.voxelAt(x, y);
  if (!vox || vp.volume !== state.primary) return;
  // keep the clicked view's own slice, move the others
  state.cursor = vox;
  if (state.layout === 'compare' && state.linked && state.prior) {
    state.priorIndex = state.prior.indexAt(state.plane, state.primary.slicePosition(state.plane, vox[AXIS[state.plane]]) + state.linkOffset);
  }
  sync();
}

function computeLinkOffset() {
  if (!state.primary || !state.prior) return;
  state.linkOffset = state.prior.slicePosition(state.plane, state.priorIndex)
    - state.primary.slicePosition(state.plane, state.cursor[AXIS[state.plane]]);
}

function setLinked(on) {
  state.linked = on;
  if (on) computeLinkOffset();
  renderLinkToggle();
}

function renderLinkToggle() {
  const b = $('link-toggle');
  b.classList.toggle('on', state.linked);
  b.innerHTML = `${icon(state.linked ? 'link' : 'unlink')}<span>${t(state.linked ? 'link.on' : 'link.off')}</span>`;
}

// ---------------------------------------------------------------------------
// Layout / plane / tool
// ---------------------------------------------------------------------------
function setLayout(layout) {
  state.layout = layout;
  state.maximized = null;
  const stage = $('stage');
  stage.className = `stage layout-${layout}`;
  $('link-toggle').hidden = layout !== 'compare';
  renderSegmented();
  if (!visibleViewports().includes(state.active)) setActive(vps.main);
  if (layout === 'compare' && state.prior) computeLinkOffset();
  sync();
}

function setPlane(plane) {
  if (state.layout === 'mpr') setLayout('single');
  if (state.prior) {
    // keep the comparison at the matching relative position in the new plane
    const g = state.prior.geometry(plane);
    state.priorIndex = Math.round(g.depth / 2);
  }
  state.plane = plane;
  renderSegmented();
  for (const vp of Object.values(vps)) vp.resetView();
  sync();
  if (state.prior) { computeLinkOffset(); }
}

function setTool(tool) {
  state.tool = tool;
  state.draft = null;
  renderSegmented();
  $('stage').dataset.tool = tool;
  sync();
}

function toggleMaximize(vp) {
  if (state.layout === 'single') return;
  state.maximized = state.maximized === vp ? null : vp;
  for (const v of Object.values(vps)) v.el.classList.toggle('maximized', v === state.maximized);
  $('stage').classList.toggle('has-max', !!state.maximized);
}

function renderSegmented() {
  const seg = (el, items, prefix, current, onClick, withIcons) => {
    el.innerHTML = items.map(i => {
      const name = t(`${prefix}.${i.key}`);
      return `<button data-key="${i.key}" class="${i.key === current ? 'on' : ''}" title="${name}${i.hotkey ? ` (${i.hotkey})` : ''}" aria-pressed="${i.key === current}">` +
        `${withIcons ? icon(i.icon) : ''}${withIcons === 'only' ? '' : `<span>${name}</span>`}</button>`;
    }).join('');
    el.onclick = e => { const b = e.target.closest('button'); if (b) onClick(b.dataset.key); };
  };
  seg($('layout-control'), LAYOUTS, 'layout', state.layout, setLayout, true);
  seg($('plane-control'), PLANES, 'plane', state.layout === 'mpr' ? null : state.plane, setPlane, false);
  seg($('tool-control'), TOOLS, 'tool', state.tool, setTool, 'only');
  $('plane-control').classList.toggle('dimmed', state.layout === 'mpr');
}

// ---------------------------------------------------------------------------
// Pointer interaction
// ---------------------------------------------------------------------------
let drag = null;
const wheelAcc = new WeakMap();

function attachPointer(vp) {
  const el = vp.el;
  const pos = e => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointerenter', () => setActive(vp));

  el.addEventListener('wheel', e => {
    e.preventDefault();
    if (!vp.volume) return;
    const [x, y] = pos(e);
    const d = (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 40 : 1);
    if (e.ctrlKey || e.metaKey) {
      vp.zoomAt(Math.exp(-d * 0.0025), x, y);
      mirrorView(vp);
      return;
    }
    let steps;
    if (Math.abs(d) >= 50) steps = Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / 100));
    else {
      const acc = (wheelAcc.get(vp) || 0) + d;
      steps = Math.trunc(acc / 30);
      wheelAcc.set(vp, acc - steps * 30);
    }
    if (steps) scroll(vp, steps * (e.shiftKey ? 5 : 1));
  }, { passive: false });

  el.addEventListener('dblclick', () => toggleMaximize(vp));

  el.addEventListener('pointerdown', e => {
    if (!vp.volume) return;
    setActive(vp);
    const [x, y] = pos(e);
    el.setPointerCapture(e.pointerId);
    let mode = e.button === 2 ? 'wl' : e.button === 1 ? 'pan' : state.tool;
    if (e.button === 0 && (mode === 'length' || mode === 'ellipse' || mode === 'crosshair')) {
      const hit = vp.hitTest(x, y, state.findings);
      if (hit) { selectFinding(hit.id); mode = 'none'; }
    }
    drag = { vp, mode, x0: x, y0: y, x, y, wl0: { ...state.wl }, zoom0: vp.zoom, pan0: [vp.panX, vp.panY] };
    if (mode === 'crosshair') setCursorFromScreen(vp, x, y);
    if ((mode === 'length' || mode === 'ellipse') && vp.volume === state.primary) {
      const p = vp.toImage(x, y);
      state.draft = { vp, type: mode, plane: vp.plane, index: vp.index, p1: p, p2: p, value: { mm: 0 } };
    }
    e.preventDefault();
  });

  el.addEventListener('pointermove', e => {
    const [x, y] = pos(e);
    updateProbe(vp, x, y);
    if (!drag || drag.vp !== vp) return;
    const dx = x - drag.x0, dy = y - drag.y0;
    drag.x = x; drag.y = y;
    switch (drag.mode) {
      case 'wl': {
        const k = Math.max(1, drag.wl0.w / 300);
        setWindow(drag.wl0.c + dy * k, drag.wl0.w + dx * k * 2, null);
        break;
      }
      case 'pan':
        vp.panX = drag.pan0[0] + dx; vp.panY = drag.pan0[1] + dy; vp.invalidate(); mirrorView(vp);
        break;
      case 'zoom': {
        const target = drag.zoom0 * Math.exp(-dy * 0.01);
        vp.zoomAt(target / vp.zoom, drag.x0, drag.y0); mirrorView(vp);
        break;
      }
      case 'crosshair':
        setCursorFromScreen(vp, x, y);
        break;
      case 'length':
      case 'ellipse':
        if (state.draft) {
          state.draft.p2 = vp.toImage(x, y);
          state.draft.value = draftValue(state.draft);
          vp.invalidate();
        }
        break;
    }
  });

  const end = () => {
    if (!drag || drag.vp !== vp) return;
    if (state.draft) commitDraft();
    drag = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', () => { vp.probe = null; vp.invalidate(); });
}

/** In linked compare mode, mirror zoom/pan to the other pane. */
function mirrorView(src) {
  if (state.layout !== 'compare' || !state.linked) return;
  const dst = src === vps.prior ? vps.main : vps.prior;
  dst.zoom = src.zoom; dst.panX = src.panX; dst.panY = src.panY;
  dst.invalidate();
}

function updateProbe(vp, x, y) {
  const vox = vp.voxelAt(x, y);
  vp.probe = vox ? { vox, hu: vp.volume.value(...vox) } : null;
  vp.invalidate();
  if (vox) {
    const mm = vp.volume.patientMM(vox);
    $('status-probe').innerHTML =
      `<b>${vp.probe.hu} ${t('unit.hu')}</b><span class="sep"></span>voxel ${vox[2]}, ${vox[1]}, ${vox[0]}` +
      `<span class="sep"></span>${mm.map(v => fmt(v, 1)).join(getLang() === 'fr' ? ' ; ' : ', ')} mm (LPS)`;
  }
}

function updateStatus() {
  const el = $('status-probe');
  if (!state.primary) el.textContent = t('status.none');
  else if (!el.querySelector('b')) el.textContent = t('status.hover');
}

// ---------------------------------------------------------------------------
// Findings (measurements + markers)
// ---------------------------------------------------------------------------
function draftValue(d) {
  const v = state.primary;
  if (d.type === 'length') return { mm: v.lengthMM(d.plane, d.p1, d.p2) };
  return v.ellipseStats(d.plane, d.index, d.p1, d.p2);
}

function nextLabel(type) {
  const n = state.findings.filter(f => f.type === type).length + 1;
  return `${t(`label.${type}`)} ${n}`;
}

function newId() {
  return (crypto.randomUUID?.() || `f${Date.now()}${Math.random().toString(16).slice(2)}`);
}

function commitDraft() {
  const d = state.draft;
  state.draft = null;
  const tooSmall = d.type === 'length'
    ? d.value.mm < 0.5
    : !d.value || Math.abs(d.p2[0] - d.p1[0]) < 1 || Math.abs(d.p2[1] - d.p1[1]) < 1;
  if (tooSmall) { d.vp.invalidate(); return; }
  addFinding({ type: d.type, plane: d.plane, index: d.index, p1: d.p1, p2: d.p2, value: d.value });
}

function addFinding(f) {
  const finding = {
    id: newId(), seriesId: state.primary.id, label: nextLabel(f.type),
    created: new Date().toISOString(), ...f,
  };
  state.findings.push(finding);
  state.selectedId = finding.id;
  renderFindings();
  saveFindings();
  sync();
}

function addMarker() {
  if (!state.primary) return;
  const vp = state.active?.volume === state.primary ? state.active : vps.main;
  const { index, r, c } = state.primary.fromVoxel(vp.plane, state.cursor);
  addFinding({ type: 'point', plane: vp.plane, index, p1: [c + 0.5, r + 0.5], value: { hu: state.primary.value(...state.cursor) } });
  toast(t('toast.marker'));
}

function selectFinding(id) {
  state.selectedId = id;
  document.querySelectorAll('.finding').forEach(el => el.classList.toggle('on', el.dataset.id === id));
  for (const vp of visibleViewports()) vp.invalidate();
}

function deleteFinding(id) {
  state.findings = state.findings.filter(f => f.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  renderFindings();
  saveFindings();
  sync();
}

function jumpToFinding(f) {
  const v = state.primary;
  if (state.layout !== 'mpr' && state.plane !== f.plane) setPlane(f.plane);
  state.cursor = v.toVoxel(f.plane, f.index, Math.floor(f.p1[1]), Math.floor(f.p1[0]));
  if (f.type !== 'point') {
    const mid = [(f.p1[0] + f.p2[0]) / 2, (f.p1[1] + f.p2[1]) / 2];
    state.cursor = v.toVoxel(f.plane, f.index, Math.floor(mid[1]), Math.floor(mid[0]));
  }
  selectFinding(f.id);
  sync();
}

function describeValue(f) {
  const hu = t('unit.hu');
  if (f.type === 'length') return `${fmt(f.value.mm, 1)} mm`;
  if (f.type === 'ellipse') return f.value ? `${Math.round(f.value.mean)} ± ${Math.round(f.value.sd)} ${hu} · ${formatArea(f.value.areaMM2)}` : '—';
  return f.value?.hu != null ? `${f.value.hu} ${hu}` : '';
}

function describeLocation(f) {
  const v = state.primary;
  const axis = f.plane === 'axial' ? 'Z' : f.plane === 'coronal' ? 'Y' : 'X';
  return t('findings.location', {
    plane: t(`plane.${f.plane}`), n: f.index + 1, axis, pos: fmt(v.slicePosition(f.plane, f.index), 1),
  });
}

function renderFindings() {
  const list = $('findings');
  $('findings-count').textContent = state.findings.length;
  if (!state.findings.length) {
    list.innerHTML = `<p class="empty-note">${t('findings.empty', {
      ruler: icon('ruler', 'inline'), ellipse: icon('ellipse', 'inline'), pin: icon('pin', 'inline'),
    })}</p>`;
    return;
  }
  const iconFor = { length: 'ruler', ellipse: 'ellipse', point: 'pin' };
  list.innerHTML = state.findings.map(f => `
    <div class="finding ${f.id === state.selectedId ? 'on' : ''}" data-id="${f.id}" tabindex="0">
      <span class="f-icon">${icon(iconFor[f.type])}</span>
      <div class="f-body">
        <input class="f-label" value="${escapeHtml(f.label)}" aria-label="${t('findings.labelAria')}" spellcheck="false">
        <span class="f-value">${describeValue(f)}</span>
        <span class="f-loc">${describeLocation(f)}</span>
      </div>
      <button class="icon-btn f-del" title="${t('findings.delete')}" aria-label="${t('findings.deleteAria')}">${icon('trash')}</button>
    </div>`).join('');
}

$('findings').addEventListener('click', e => {
  const row = e.target.closest('.finding');
  if (!row) return;
  const f = state.findings.find(x => x.id === row.dataset.id);
  if (e.target.closest('.f-del')) return deleteFinding(f.id);
  if (!e.target.classList.contains('f-label')) jumpToFinding(f);
  else selectFinding(f.id);
});
$('findings').addEventListener('change', e => {
  if (!e.target.classList.contains('f-label')) return;
  const f = state.findings.find(x => x.id === e.target.closest('.finding').dataset.id);
  f.label = e.target.value.trim().slice(0, 80) || f.label;
  saveFindings();
  sync();
});
$('findings').addEventListener('keydown', e => {
  if (e.target.classList.contains('f-label') && e.key === 'Enter') e.target.blur();
});

let saveTimer = null;
function saveFindings() {
  const sid = state.primary?.id;
  const data = state.findings.map(({ vp, ...f }) => f);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const r = await fetch(`/api/series/${sid}/findings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error((await r.json()).error);
    } catch (err) { toast(t('toast.saveFail', { msg: err.message }), true); }
  }, 350);
}

// ---------------------------------------------------------------------------
// Report & key image
// ---------------------------------------------------------------------------
function buildReport() {
  const v = state.primary;
  const m = v.meta;
  const L = t('report.md');
  const hu = t('unit.hu');
  const date = new Date().toLocaleString(locale());
  const lines = [
    `# ${L.title}`,
    ``,
    `- **${L.series} :** ${m.id}`,
    `- **${L.modality} :** ${m.modality || 'CT'}${m.series_description ? ` · ${m.series_description}` : ''}`,
    `- **${L.images} :** ${m.shape[0]} × ${m.shape[1]} × ${m.shape[2]} · ${L.spacing} ${m.spacing.map(s => fmt(s, 2)).join(' / ')} mm (z / y / x)`,
    `- **${L.generated} :** ${date} ${L.with}`,
    ``,
    `## ${L.technique}`,
    L.techniqueText.replace('{mm}', fmt(m.spacing[0], 1)),
    ``,
    `## ${L.findings}`,
  ];
  if (getLang() === 'en') for (let i = 2; i <= 5; i++) lines[i] = lines[i].replace(' :**', ':**');
  if (!state.findings.length) lines.push(L.none);
  state.findings.forEach((f, i) => {
    const kind = t(`label.${f.type}`);
    const sep = getLang() === 'fr' ? ' : ' : ': ';
    lines.push(`${i + 1}. **${f.label}** — ${kind}${sep}${describeValue(f)} (${describeLocation(f)})`);
    if (f.type === 'ellipse' && f.value) {
      lines.push(`   - ${L.minmax.replace('{min}', f.value.min).replace('{max}', f.value.max).replace('{n}', f.value.n).replace(' HU', ` ${hu}`)}`);
    }
  });
  lines.push('', `## ${L.impression}`, '', L.impressionText, '', '---', L.disclaimer);
  return lines.join('\n');
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function saveKeyImage() {
  const vp = state.active?.volume ? state.active : vps.main;
  if (!vp.volume) return;
  vp.draw();
  vp.snapshot().toBlob(b => download(`key-image_${vp.volume.id.slice(0, 8)}_${vp.plane}_${vp.index + 1}.png`, b));
  toast(t('toast.keyImage'));
}

// ---------------------------------------------------------------------------
// Cine
// ---------------------------------------------------------------------------
function toggleCine(force) {
  state.cine.playing = force ?? !state.cine.playing;
  $('play').innerHTML = icon(state.cine.playing ? 'pause' : 'play');
  $('play').classList.toggle('on', state.cine.playing);
  if (state.cine.playing) requestAnimationFrame(cineTick);
}

function cineTick(time) {
  if (!state.cine.playing) return;
  const vp = state.active?.volume ? state.active : vps.main;
  if (vp.volume && time - state.cine.last >= 1000 / state.cine.fps) {
    state.cine.last = time;
    const depth = vp.geometry.depth;
    scrollTo(vp, vp.index + 1 >= depth ? 0 : vp.index + 1);
  }
  requestAnimationFrame(cineTick);
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
async function loadCatalog() {
  const r = await fetch('/api/series');
  const { series } = await r.json();
  state.catalog = series;
  renderLibrary();
  if (series.some(s => s.slices == null)) setTimeout(loadCatalog, 3000);
  return series;
}

function hue(id) { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }

function labelTag(label) {
  if (label === 1) return `<span class="tag red">${t('tag.cancer')}</span>`;
  if (label === 0) return `<span class="tag">${t('tag.clear')}</span>`;
  return '';
}

function renderLibrary() {
  const q = state.query.toLowerCase();
  const items = state.catalog.filter(s =>
    (!q || s.id.includes(q)) && (state.filter === 'all' || String(s.label) === state.filter));
  $('series-count').textContent = t('library.count', { n: fmt(items.length), total: fmt(state.catalog.length) });
  const html = items.slice(0, 400).map(s => {
    const cur = s.id === state.primary?.id, pri = s.id === state.prior?.id;
    return `<div class="series ${cur ? 'current' : ''} ${pri ? 'prior' : ''}" data-id="${s.id}" role="option" aria-selected="${cur}" tabindex="0">
      <span class="avatar" style="--h:${hue(s.id)}">${s.id.slice(-2).toUpperCase()}</span>
      <span class="s-body"><strong>${s.id.slice(0, 12)}…</strong>
        <span>${s.slices != null ? t('library.images', { n: s.slices }) : t('library.counting')}${pri ? ` · <em>${t('library.comparison')}</em>` : ''}</span></span>
      ${labelTag(s.label)}
      <button class="icon-btn s-compare" title="${t('compare.open')}" aria-label="${t('compare.open')}">${icon('duplicate')}</button>
    </div>`;
  }).join('');
  $('series-list').innerHTML = html + (items.length > 400 ? `<p class="empty-note">${t('library.more', { n: fmt(items.length - 400) })}</p>` : '');
}

$('series-list').addEventListener('click', e => {
  const row = e.target.closest('.series');
  if (!row) return;
  if (e.target.closest('.s-compare')) openPrior(row.dataset.id);
  else openPrimary(row.dataset.id);
});
$('series-list').addEventListener('keydown', e => {
  const row = e.target.closest('.series');
  if (row && e.key === 'Enter') openPrimary(row.dataset.id);
});
$('search').addEventListener('input', e => { state.query = e.target.value.trim(); renderLibrary(); });
$('label-filter').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  state.filter = b.dataset.filter;
  $('label-filter').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  renderLibrary();
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
async function fetchVolume(id, titleKey) {
  const loader = $('loader');
  loader.hidden = false;
  $('loader-title').textContent = t(titleKey);
  $('loader-text').textContent = t('loader.reading');
  $('loader-bar').style.width = '0%';
  try {
    const mr = await fetch(`/api/series/${id}/meta`);
    const meta = await mr.json();
    if (!mr.ok) throw new Error(meta.error || mr.statusText);
    const r = await fetch(`/api/series/${id}/volume`);
    if (!r.ok) throw new Error(t('error.volume', { status: r.status }));
    const total = Number(r.headers.get('Content-Length'));
    const buf = new Uint8Array(total);
    const reader = r.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf.set(value, got);
      got += value.length;
      const pct = Math.round((got / total) * 100);
      $('loader-bar').style.width = `${pct}%`;
      $('loader-text').textContent = t('loader.progress', { pct, mb: fmt(total / 1e6) });
    }
    return new Volume(meta, buf.buffer);
  } finally {
    loader.hidden = true;
  }
}

async function openPrimary(id) {
  if (state.primary?.id === id) return;
  toggleCine(false);
  try {
    const vol = await fetchVolume(id, 'loader.series');
    state.primary = vol;
    state.cursor = [Math.floor(vol.nz / 2), Math.floor(vol.ny / 2), Math.floor(vol.nx / 2)];
    state.selectedId = null;
    state.draft = null;
    for (const vp of [vps.main, vps.cor, vps.sag]) vp.resetView();
    if (state.prior?.id === id) { state.prior = null; }
    const fr = await fetch(`/api/series/${id}/findings`);
    state.findings = fr.ok ? await fr.json() : [];
    try { localStorage.setItem('radio.last', id); } catch { /* storage unavailable */ }
    renderSeriesInfo();
    renderFindings();
    renderLibrary();
    if (state.prior) computeLinkOffset();
    setActive(vps.main);
    sync();
    toast(t('toast.opened', { id: id.slice(0, 10), n: vol.nz }));
  } catch (err) {
    toast(t('toast.openFail', { msg: err.message }), true);
  }
}

async function openPrior(id) {
  if (!state.primary) return openPrimary(id);
  if (id === state.primary.id) { toast(t('toast.sameSeries'), true); return; }
  try {
    const vol = await fetchVolume(id, 'loader.compare');
    state.prior = vol;
    // start at the same relative height as the current slice
    const g = vol.geometry(state.plane);
    const gp = state.primary.geometry(state.plane);
    state.priorIndex = Math.round((state.cursor[AXIS[state.plane]] / Math.max(1, gp.depth - 1)) * (g.depth - 1));
    vps.prior.resetView();
    computeLinkOffset();
    renderLibrary();
    setLayout('compare');
    toast(t('toast.comparing', { id: id.slice(0, 10) }));
  } catch (err) {
    toast(t('toast.compareFail', { msg: err.message }), true);
  }
}

function renderSeriesInfo() {
  if (!state.primary) {
    $('title').textContent = t('title.none');
    $('subtitle').textContent = t('subtitle.none');
    return;
  }
  const m = state.primary.meta;
  const rows = [
    ['info.series', `<span class="mono">${m.id.slice(0, 16)}…</span>`],
    ['info.label', labelTag(state.catalog.find(s => s.id === m.id)?.label) || '—'],
    ['info.modality', [m.modality, m.series_description].filter(Boolean).join(' · ') || '—'],
    ['info.matrix', `${m.shape[2]} × ${m.shape[1]} × ${m.shape[0]}`],
    ['info.pixel', `${fmt(m.spacing[2], 3)} × ${fmt(m.spacing[1], 3)} mm`],
    ['info.spacing', `${fmt(m.spacing[0], 2)} mm`],
    ['info.hu', `${m.hu_range[0]} … ${m.hu_range[1]}`],
    ['info.load', m.load_seconds != null ? `${fmt(m.load_seconds, 2)} s` : '—'],
  ];
  $('series-info').innerHTML = rows.map(([k, v]) => `<dt>${t(k)}</dt><dd>${v}</dd>`).join('');
  $('title').textContent = `${m.id.slice(0, 16)}…`;
  $('subtitle').textContent = t('subtitle.series', { modality: m.modality || 'CT', n: m.shape[0], mm: fmt(m.spacing[0], 1) });
  document.title = `${m.id.slice(0, 8)} — Luminor`;
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------
function renderShortcuts() {
  $('shortcut-grid').innerHTML = t('shortcuts').map(([title, rows]) =>
    `<section><h4>${title}</h4>${rows.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}</section>`).join('');
}

document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  const vp = state.active?.volume ? state.active : vps.main;
  const k = e.key;
  const handled = () => e.preventDefault();
  if (k === 'ArrowDown' || k === 'ArrowRight') { scroll(vp, e.shiftKey ? 5 : 1); return handled(); }
  if (k === 'ArrowUp' || k === 'ArrowLeft') { scroll(vp, e.shiftKey ? -5 : -1); return handled(); }
  if (k === 'PageDown') { scroll(vp, 10); return handled(); }
  if (k === 'PageUp') { scroll(vp, -10); return handled(); }
  if (k === 'Home') { scrollTo(vp, 0); return handled(); }
  if (k === 'End') { scrollTo(vp, vp.geometry ? vp.geometry.depth - 1 : 0); return handled(); }
  if (k === ' ') { toggleCine(); return handled(); }
  // Match the physical key so presets also work on AZERTY keyboards (1 types "&" there)
  const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code)?.[1] ?? (/^[1-5]$/.test(k) ? k : null);
  if (digit) return applyPreset(PRESETS[Number(digit) - 1].key);
  if (k === '?' || k === '/') return $('help-sheet').showModal();
  if (k === 'Escape') { state.draft = null; selectFinding(null); return; }
  if (k === 'Delete' || k === 'Backspace') { if (state.selectedId) deleteFinding(state.selectedId); return handled(); }
  if (k === '+' || k === '=') return setSlabMM(state.slab.mm + 2);
  if (k === '-') return setSlabMM(state.slab.mm - 2);
  const lower = k.toLowerCase();
  const tool = TOOLS.find(x => x.hotkey.toLowerCase() === lower);
  if (tool) return setTool(tool.key);
  const plane = PLANES.find(p => p.hotkey.toLowerCase() === lower);
  if (plane) return setPlane(plane.key);
  switch (lower) {
    case 'i': state.invert = !state.invert; $('invert').classList.toggle('on', state.invert); return setWindow(state.wl.c, state.wl.w, state.preset);
    case 'r': for (const v of visibleViewports()) { v.resetView(); v.invalidate(); } return;
    case 'l': return setLayout(LAYOUTS[(LAYOUTS.findIndex(l => l.key === state.layout) + 1) % LAYOUTS.length].key);
    case 'b': return addMarker();
    case 'k': return setLinked(!state.linked);
    case 't': {
      const modes = ['none', 'mip', 'minip', 'avg'];
      return setSlabMode(modes[(modes.indexOf(state.slab.mode) + 1) % modes.length]);
    }
  }
});

// ---------------------------------------------------------------------------
// Inspector controls
// ---------------------------------------------------------------------------
function setSlabMode(mode) {
  state.slab.mode = mode;
  $('slab-mode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  if (mode !== 'none') {
    const name = mode === 'avg' ? t('toast.slabAvg') : t(`slab.${mode}`);
    toast(t('toast.slab', { mode: name, mm: state.slab.mm }));
  }
  sync();
}

function setSlabMM(mm) {
  state.slab.mm = Math.max(2, Math.min(40, mm));
  $('slab-mm').value = state.slab.mm;
  $('slab-mm-out').textContent = `${state.slab.mm} mm`;
  sync();
}

function renderPresets() {
  $('presets').innerHTML = PRESETS.map((p, i) => {
    const name = t(`preset.${p.key}`);
    return `<button data-key="${p.key}" class="${p.key === state.preset ? 'on' : ''}" title="${t('preset.title', { name, c: p.c, w: p.w, k: i + 1 })}"><kbd>${i + 1}</kbd>${name}</button>`;
  }).join('');
}

function initControls() {
  renderPresets();
  $('presets').onclick = e => { const b = e.target.closest('button'); if (b) applyPreset(b.dataset.key); };
  const onWL = () => setWindow(Number($('wl-c').value), Number($('wl-w').value), null);
  $('wl-c').addEventListener('change', onWL);
  $('wl-w').addEventListener('change', onWL);
  $('invert').onclick = () => {
    state.invert = !state.invert;
    $('invert').classList.toggle('on', state.invert);
    setWindow(state.wl.c, state.wl.w, state.preset);
  };
  $('slab-mode').onclick = e => { const b = e.target.closest('button'); if (b) setSlabMode(b.dataset.mode); };
  $('slab-mm').oninput = e => setSlabMM(Number(e.target.value));
  $('fps').oninput = e => { state.cine.fps = Number(e.target.value); renderFps(); };
  $('play').onclick = () => toggleCine();
  $('help').onclick = () => $('help-sheet').showModal();
  $('lang-toggle').onclick = () => switchLanguage(getLang() === 'fr' ? 'en' : 'fr');
  $('link-toggle').onclick = () => setLinked(!state.linked);
  $('add-marker').onclick = addMarker;
  $('key-image').onclick = saveKeyImage;
  $('open-report').onclick = () => {
    if (!state.primary) return toast(t('toast.openFirst'), true);
    $('report-text').value = buildReport();
    $('report-sheet').showModal();
  };
  $('report-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('report-text').value); toast(t('toast.copied')); }
    catch { $('report-text').select(); toast(t('toast.copyManual'), true); }
  };
  $('report-download').onclick = () => {
    download(`${t('report.file')}_${state.primary.id.slice(0, 8)}.md`, new Blob([$('report-text').value], { type: 'text/markdown' }));
  };
  document.querySelectorAll('dialog [data-close]').forEach(b => { b.onclick = () => b.closest('dialog').close(); });
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
  $('toggle-sidebar').onclick = () => $('app').classList.toggle('no-sidebar');
  $('toggle-inspector').onclick = () => $('app').classList.toggle('no-inspector');
}

function renderFps() { $('fps-out').textContent = t('inspector.fps', { n: state.cine.fps }); }

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------
/** Render every language-dependent part of the interface. */
function renderLanguage() {
  applyStatic();
  $('lang-code').textContent = getLang().toUpperCase();
  const other = $('other-guide');
  other.href = t('guide.otherHref');
  other.hreflang = t('guide.otherLang');
  other.lang = t('guide.otherLang');
  $('user-guide').href = t('guide.href');
  renderSegmented();
  renderPresets();
  renderLinkToggle();
  renderShortcuts();
  renderFindings();
  renderLibrary();
  renderSeriesInfo();
  renderFps();
  $('status-probe').textContent = '';
  sync();
}

function switchLanguage(lang) {
  setLang(lang);
  renderLanguage();
  toast(t('toast.lang'));
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
let toastTimer;
function toast(msg, error = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), error ? 4000 : 1800);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function init() {
  document.querySelectorAll('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });
  for (const vp of Object.values(vps)) attachPointer(vp);
  initControls();
  setLinked(true);
  setWindow(PRESETS[0].c, PRESETS[0].w, PRESETS[0].key);
  setTool('crosshair');
  renderLanguage();
  setActive(vps.main);
  if (window.innerWidth < 1280) $('app').classList.add('no-inspector');
  if (window.innerWidth < 1000) $('app').classList.add('no-sidebar');
  try {
    const series = await loadCatalog();
    let last = null;
    try { last = localStorage.getItem('radio.last'); } catch { /* storage unavailable */ }
    const first = series.find(s => s.id === last) || series[0];
    if (first) openPrimary(first.id);
  } catch (err) {
    toast(t('toast.server', { msg: err.message }), true);
  }
}

init();
