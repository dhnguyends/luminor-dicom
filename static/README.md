# `static/` — the Luminor browser app

This folder holds the browser half of Luminor: about 2,500 lines of plain HTML, CSS and
JavaScript, with **no libraries and no build step**. The browser loads the files directly as
standard ES modules.

[`server.py`](../server.py) only reads DICOM files and sends each volume once (see
[The server](#the-server-serverpy) below). Everything you see and interact with, including
window/level, reformats, slabs and measurements, is computed in the browser by these files.

## How the files fit together

```
index.html ──loads──► style.css
     │
     └──loads──► js/app.js  (entry point)
                   ├── imports js/volume.js    (the data)
                   ├── imports js/viewport.js  (the drawing) ── imports volume.js, i18n.js
                   ├── imports js/i18n.js      (the text)
                   └── imports js/icons.js     (the icons)
```

| File | Lines | Role |
|---|---:|---|
| [`index.html`](index.html) | 152 | Page layout |
| [`style.css`](style.css) | 412 | Visual design and layouts |
| [`js/app.js`](js/app.js) | 946 | Application state, features and interaction |
| [`js/volume.js`](js/volume.js) | 193 | CT volume in memory: planes, slabs, statistics |
| [`js/viewport.js`](js/viewport.js) | 332 | Drawing one image pane |
| [`js/i18n.js`](js/i18n.js) | 453 | English and French text, number formatting |
| [`js/icons.js`](js/icons.js) | 42 | Line icons |
| [`favicon.svg`](favicon.svg) | — | App icon |

## `index.html` — the page layout

The app's skeleton, with no logic in it:

- **Library** (left): images folder with its **Change…** button, search field, Cancer / No cancer filter, series list.
- **Toolbar** (top): layout, plane and tool buttons, Linked toggle, cine, help, EN/FR button.
- **Stage** (centre): four image panes (main, coronal, sagittal, comparison) and the loading card.
- **Inspector** (right): Window, Slab, Cine, Findings and Series cards.
- **Three sheets**: keyboard help, the images folder, and the report draft. Also the notification banner.

Static labels carry `data-i18n` attributes so [`i18n.js`](js/i18n.js) can translate them.

## `style.css` — the look

The dark, Apple-inspired design: colour tokens (Apple system blue, translucent panels),
Inter/SF typography, segmented controls, cards, sheets and notifications. It also handles:

- **The layouts:** Single, MPR (one large pane plus two small) and Compare (two side by side),
  plus enlarging a pane on double-click.
- **The text on images:** corner information and yellow orientation letters. On small panes this
  text shrinks or hides some lines automatically.
- **Small screens:** responsive rules, and reduced motion for users who ask for it.

## `js/app.js` — the conductor

The main module: it holds the app's state and wires every feature to the screen.

- **State:** open series and comparison, layout, plane, tool, window, slab, crosshair position,
  findings, cine.
- **`sync()`** pushes that state into the four panes and redraws them.
- **Window/level:** builds a 65,536-entry lookup table that converts each HU value to a grey
  level, with the presets and invert.
- **Navigation:** wheel, keyboard and cine scrolling, the crosshair, and comparison linking by
  position in millimetres (`computeLinkOffset`).
- **Mouse handling:** right-drag for window/level, middle-drag to pan, Ctrl+wheel to zoom, and the
  left button for the selected tool.
- **Findings:** creates, renames, selects, deletes and jumps to measurements and markers; saves
  them to the server automatically (`saveFindings`).
- **Report and key image:** builds the Markdown report draft (`buildReport`) and exports
  annotated PNGs.
- **Library and loading:** fetches the series list, downloads volumes with a progress bar, opens a
  series as current or as comparison.
- **Keyboard shortcuts:** including AZERTY support for the 1–5 presets.
- **Language switching:** `renderLanguage()` redraws everything in the chosen language.

## `js/volume.js` — the CT data in memory

The `Volume` class wraps the downloaded 3D array of HU values (z, y, x).

- **Plane geometry:** maps axial, coronal and sagittal coordinates to voxels, with the head at the
  top (`toVoxel` / `fromVoxel`).
- **`readPlane()`** extracts a slice in any plane.
- **`render()`** builds MIP, MinIP or average slabs of a chosen thickness.
- **Measurements:** `ellipseStats()` gives an ROI's mean, SD, min, max and area; `lengthMM()`
  gives distances using the true pixel spacing.
- **Positions:** slice positions and patient (LPS) coordinates in millimetres.
- **`orientationMarkers()`** works out the R/L, A/P, S/I letters from the DICOM orientation tags.

## `js/viewport.js` — drawing one image pane

The `Viewport` class handles one pane:

- **Drawing:** renders the slice to a canvas through the window lookup table. The slice is
  cached, so zooming and panning don't recompute it.
- **Coordinates:** screen ↔ image conversion, with correct physical proportions, zoom limits
  (25 %–1200 %) and pan.
- **Overlays:** the colour-coded crosshair lines; lengths, ellipses and markers with their labels.
- **Text on the image:** plane, image number, position, window, slab, HU under the cursor, zoom,
  and the orientation letters.
- **Clicks:** `hitTest()` finds which measurement was clicked.
- **Key images:** `snapshot()` produces the PNG with its text and watermark.

## `js/i18n.js` — English and French

- **The text:** two dictionaries covering every word in the interface, the report template and the
  help sheet.
- **`t(key)`** returns the text for the current language.
- **`fmt()`** formats numbers for the locale (90.9 or 90,9).
- **`applyStatic()`** translates the `data-i18n` labels in `index.html`.
- **Language choice:** detected from the browser, remembered between visits.
- **French conventions:** UH, C/L for the window, and D/G orientation letters.

To add a language, add a dictionary here and list it in `LANGS`.

## `js/icons.js` — icons

About 35 line icons in the style of Apple's SF Symbols (ruler, ellipse, crosshair, globe and so
on), drawn as inline SVG. `icon(name)` returns the SVG markup, and the icons take their colour
from the surrounding text.

## `favicon.svg` — the app icon

The blue Luminor logo shown in the browser tab and the sidebar.

---

## The server (`server.py`)

[`server.py`](../server.py) (324 lines, in the repository root) is the only Python in Luminor. It
uses Python's standard library plus **pydicom** (to read DICOM files) and **NumPy** (to convert to
Hounsfield units). Its whole job is to find series, read them, and hand them to the browser.

**Settings (top of file)**

- **Folder paths:** `static/` (the app), `docs/` (guides), `data/findings/` (saved findings).
- **Default data location:** the Kaggle dataset next to the project folder, overridden with `--data`.
- **Limits:** series IDs may contain only letters, digits, `.`, `_` and `-`; saved findings are
  capped at 1 MB; at most 3 volumes are kept in memory.

**`Catalog` — the series library**

- **Lists series:** every sub-folder of the data folder with a valid name is one series.
- **Counts images:** counts the `.dcm` files of each series in a background thread, so the library
  appears immediately and the counts fill in afterwards.
- **Reads labels:** loads the optional `id,cancer` CSV.
- **`path()`:** converts a series ID to its folder, accepting only IDs that are in the catalog.
  This is part of what stops requests from reaching other files on disk.

**`load_series()` — reading a CT series**

1. Reads all slices with 8 threads in parallel.
2. Sorts them by physical position (`ImagePositionPatient`), inferior to superior, rather than by
   instance number.
3. Converts each slice to Hounsfield units with its own rescale slope and intercept; padding
   values become air.
4. Measures the true slice spacing from the positions, then builds the metadata the browser needs:
   shape, spacing, slice positions, origin, orientation, HU range and a few DICOM tags.

**`VolumeCache` — memory cache**

- **Fast reopening:** keeps the last 3 volumes (about 100 MB each), dropping the least recently used.
- **Loads once:** a per-series lock ensures that if the metadata and the volume are requested at
  the same moment, the series is read from disk only once.

**`Handler` — the web server**

- **Static files:** serves `static/` first, then falls back to `docs/`, which is how `/guide.html`
  works inside the app. It sets correct content types (fixing Windows' wrong type for `.js`), and
  disables directory listings and browser caching.
- **API:**

  | Request | Answer |
  |---|---|
  | `GET /api/series` | The catalog: ID, image count, label |
  | `GET /api/series/<id>/meta` | Geometry and metadata (loads the series if needed) |
  | `GET /api/series/<id>/volume` | The raw volume, 16-bit HU values (`int16`), sent in 1 MB chunks |
  | `GET` / `PUT /api/series/<id>/findings` | Read or replace the saved findings (JSON list) |
  | `GET` / `POST /api/data-folder` | Current images folder; POST `{"path": …}` switches to another folder (validated, labels found automatically) |
  | `POST /api/browse-folder` | Opens the native folder picker on this computer (tkinter) and returns the chosen path |

  POST and PUT must be `application/json` and are refused when sent by a web page from another
  site (`Origin` check). The desktop app replaces the tkinter picker with the Windows one
  (`window.pywebview.api.choose_folder`) and saves a new folder through `Handler.on_data_change`.

- **Safe saving:** findings are written to a temporary file and then swapped in, so a crash can't
  leave a half-written file. Loading errors are returned as JSON messages, which the app shows as
  notifications.

**`main()` — start-up**

- **Options:** `--port` (default 8770), `--data` and `--labels`.
- **Local only:** it listens on **127.0.0.1**, so other computers on the network can't connect,
  and it uses one thread per request so loading a series doesn't block the page.
