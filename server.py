"""Luminor - local CT viewer server.

Serves the single-page viewer in ``static/`` (falling back to ``docs/`` for the user
guides) and a small API:

    GET  /api/series                 catalog of series folders (+ slice counts, labels)
    GET  /api/series/<id>/meta       geometry and acquisition metadata
    GET  /api/series/<id>/volume     raw HU volume, int16 little-endian, C order (z, y, x)
    GET  /api/series/<id>/findings   saved findings (JSON list)
    PUT  /api/series/<id>/findings   replace saved findings

All rendering (window/level, MPR, MIP, measurements) happens in the browser on the
downloaded volume. The server binds to 127.0.0.1 unless --host is given.

With --public (a shared online demo), visitors cannot change the images folder,
download from Google Drive or save findings on the server: findings stay in
each visitor's browser.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import threading
import time
import urllib.parse
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import pydicom

APP_DIR = Path(__file__).resolve().parent
# Bundled resources live in sys._MEIPASS when frozen with PyInstaller (Windows exe)
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))
STATIC_DIR = RESOURCE_DIR / "static"
DOCS_DIR = RESOURCE_DIR / "docs"  # user guides + intro page (also published with GitHub Pages)
FINDINGS_DIR = APP_DIR / "data" / "findings"
DEFAULT_DATA = APP_DIR.parent / "img" / "DSB3" / "stage1" / "stage1"
DEFAULT_LABELS = APP_DIR.parent / "img" / "DSB3" / "stage1_labels.csv"

# Any ordinary folder name (spaces and accents allowed); no path separators, no leading dot,
# no "~" (it separates an exam folder from one of its series: "folder~2")
SERIES_ID = re.compile(r"^(?!\.)[^/\\:*?\"<>|~\x00-\x1f]{1,200}$")
MAX_FINDINGS_BYTES = 1_000_000
CACHE_SIZE = 3  # volumes kept in memory (~100 MB each)


# --------------------------------------------------------------------------- #
# Catalog                                                                     #
# --------------------------------------------------------------------------- #
class Catalog:
    """Series folders under the data root; slice counts are filled in the background."""

    def __init__(self, root: Path, labels_csv: Path | None):
        self.root = root
        self.ids = sorted(
            d.name for d in root.iterdir() if d.is_dir() and SERIES_ID.match(d.name)
        ) if root.is_dir() else []
        self.counts: dict[str, int] = {}
        self.labels = self._read_labels(labels_csv)
        threading.Thread(target=self._count_slices, daemon=True).start()

    @staticmethod
    def _read_labels(path: Path | None) -> dict[str, int]:
        """Optional id,cancer CSV; anything else (other columns, bad values) is ignored."""
        if not path or not path.is_file():
            return {}
        try:
            with path.open(newline="", encoding="utf-8-sig") as f:
                return {row["id"]: int(row["cancer"]) for row in csv.DictReader(f)}
        except (OSError, KeyError, ValueError, TypeError, csv.Error) as exc:
            print(f"[luminor] labels ignored ({path.name}: {exc!r})", file=sys.stderr)
            return {}

    def _count_slices(self) -> None:
        for sid in self.ids:
            try:
                with os.scandir(self.root / sid) as it:
                    self.counts[sid] = sum(1 for e in it if e.name.lower().endswith(".dcm"))
            except OSError:
                self.counts[sid] = 0

    def path(self, sid: str) -> Path | None:
        if not SERIES_ID.match(sid) or sid not in self.ids:
            return None
        return self.root / sid

    def listing(self) -> list[dict]:
        return [
            {"id": sid, "slices": self.counts.get(sid), "label": self.labels.get(sid)}
            for sid in self.ids
        ]


def _has_dicom(folder: Path) -> bool:
    try:
        return any(f.suffix.lower() == ".dcm" for f in folder.iterdir())
    except OSError:
        return False


def resolve_data_folder(folder: Path | str) -> Path | None:
    """Folder of series sub-folders for a user's choice, or None if it holds no series.

    Accepts that folder itself, or a single series folder (its parent is used).
    """
    folder = Path(folder).expanduser().resolve()
    if not folder.is_dir():
        return None
    if _has_dicom(folder):  # a single series was chosen
        return folder.parent
    try:
        subdirs = [d for d in folder.iterdir() if d.is_dir()]
    except OSError:
        return None
    return folder if any(_has_dicom(d) for d in subdirs[:200]) else None


def find_labels(data: Path) -> Path | None:
    """Optional id,cancer CSV (e.g. Kaggle stage1_labels.csv) in or up to two levels above data."""
    for folder in (data, data.parent, data.parent.parent):
        try:
            matches = sorted(folder.glob("*labels*.csv"))
        except OSError:
            continue
        if matches:
            return matches[0]
    return None


# --------------------------------------------------------------------------- #
# Volume loading                                                              #
# --------------------------------------------------------------------------- #
class NoVolumeError(ValueError):
    """The folder holds no image series that can be stacked into a volume."""


AXIAL_IOP = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]


def _first(seq_owner, *path):
    """Nested sequence lookup, e.g. _first(ds, 'SharedFunctionalGroupsSequence', 'PixelMeasuresSequence')."""
    item = seq_owner
    for name in path:
        seq = getattr(item, name, None)
        if not seq:
            return None
        item = seq[0]
    return item


def _orientation(ds) -> list[float]:
    plane = _first(ds, "SharedFunctionalGroupsSequence", "PlaneOrientationSequence") or \
        _first(ds, "PerFrameFunctionalGroupsSequence", "PlaneOrientationSequence")
    iop = getattr(plane, "ImageOrientationPatient", None) or getattr(ds, "ImageOrientationPatient", None)
    return [float(v) for v in iop] if iop else list(AXIAL_IOP)


def _pixel_spacing(ds) -> tuple[float, float]:
    measures = _first(ds, "SharedFunctionalGroupsSequence", "PixelMeasuresSequence")
    ps = getattr(measures, "PixelSpacing", None) or getattr(ds, "PixelSpacing", None) or [1, 1]
    return float(ps[0]), float(ps[1])


def _normal(iop: list[float]) -> np.ndarray:
    n = np.cross(np.asarray(iop[:3]), np.asarray(iop[3:]))
    norm = np.linalg.norm(n)
    return n / norm if norm else np.array([0.0, 0.0, 1.0])


def _plane_name(iop: list[float]) -> str:
    axis = int(np.argmax(np.abs(_normal(iop))))
    return ("sagittal", "coronal", "axial")[axis]


def _is_image(ds) -> bool:
    """Grey-scale or colour image with pixel data (reports and annotations excluded)."""
    return (
        "Rows" in ds and "Columns" in ds
        and int(getattr(ds, "SamplesPerPixel", 1) or 1) in (1, 3)
        and str(getattr(ds, "Modality", "")) not in ("SR", "DOC", "KO", "PR")
    )


def _is_document(ds) -> bool:
    return "MIMETypeOfEncapsulatedDocument" in ds and \
        str(ds.MIMETypeOfEncapsulatedDocument).lower() == "application/pdf"


def _calibration(ds) -> tuple[float, float] | None:
    """Pixel size (row, column) in mm for a 2D image, or None when it is not calibrated.

    Uses PixelSpacing, ImagerPixelSpacing, or the ultrasound region calibration
    (PhysicalDeltaX/Y in cm when the physical units are cm).
    """
    for name in ("PixelSpacing", "ImagerPixelSpacing"):
        ps = getattr(ds, name, None)
        if ps:
            return float(ps[0]), float(ps[1])
    for region in getattr(ds, "SequenceOfUltrasoundRegions", None) or []:
        if getattr(region, "PhysicalUnitsXDirection", None) == 3 and getattr(region, "PhysicalUnitsYDirection", None) == 3:
            dx, dy = float(region.PhysicalDeltaX), float(region.PhysicalDeltaY)
            if dx > 0 and dy > 0:
                return abs(dy) * 10, abs(dx) * 10  # cm -> mm
    return None


def scan_parts(folder: Path) -> list[dict]:
    """Group a folder's DICOM files into displayable parts, best first.

    kind "volume": single-frame grey-scale images of one series with the same size and
        orientation (at least 2), or one grey-scale multi-frame file (e.g. enhanced MR).
    kind "images": 2D images shown one by one (colour such as ultrasound or screenshots,
        single grey images such as scout views), grouped by series, size and calibration.
    kind "document": an encapsulated PDF report (opened in the browser, not displayed).
    Volumes come first, then images, then documents.
    """
    files = sorted(folder.glob("*.dcm"))
    if not files:
        raise FileNotFoundError(f"No DICOM files in {folder.name}")

    def header(f):
        try:
            return f, pydicom.dcmread(f, stop_before_pixels=True)
        except Exception:
            return f, None

    with ThreadPoolExecutor(max_workers=8) as pool:
        headers = list(pool.map(header, files))

    groups: dict[tuple, dict] = {}
    documents: list[dict] = []
    for f, ds in headers:
        if ds is None:
            continue
        if _is_document(ds):
            title = str(getattr(ds, "DocumentTitle", "") or getattr(ds, "SeriesDescription", "") or "")
            documents.append({"kind": "document", "modality": str(getattr(ds, "Modality", "") or "DOC"),
                              "description": title, "files": [f], "slices": 0, "rows": 0, "cols": 0,
                              "plane": "", "multiframe": False, "rgb": False})
            continue
        if not _is_image(ds):
            continue
        frames = int(getattr(ds, "NumberOfFrames", 1) or 1)
        rgb = int(getattr(ds, "SamplesPerPixel", 1) or 1) == 3
        iop = _orientation(ds)
        image_type = [str(v).upper() for v in (getattr(ds, "ImageType", None) or [])]
        description = str(getattr(ds, "SeriesDescription", "") or "") or \
            ("Scout (localizer)" if "LOCALIZER" in image_type else "")
        info = {
            "modality": str(getattr(ds, "Modality", "") or ""),
            "description": description,
            "rows": int(ds.Rows), "cols": int(ds.Columns), "plane": _plane_name(iop), "rgb": rgb,
        }
        if frames > 1:  # one multi-frame file: a volume (grey) or a run of images (colour cine)
            groups[("mf", str(f))] = {**info, "kind": "images" if rgb else "volume",
                                      "files": [f], "multiframe": True, "slices": frames,
                                      "calibration": _calibration(ds) if rgb else None}
            continue
        if rgb:
            cal = _calibration(ds)
            key = ("rgb", str(getattr(ds, "SeriesInstanceUID", "")), info["rows"], info["cols"],
                   tuple(round(v, 4) for v in cal) if cal else None)
            group = groups.setdefault(key, {**info, "kind": "images", "calibration": cal,
                                            "files": [], "multiframe": False, "slices": 0})
        else:
            key = (str(getattr(ds, "SeriesInstanceUID", "")), info["rows"], info["cols"],
                   tuple(round(v, 2) for v in iop))
            group = groups.setdefault(key, {**info, "kind": "volume", "calibration": None,
                                            "files": [], "multiframe": False, "slices": 0})
        group["files"].append(f)
        group["slices"] += 1

    parts = list(groups.values())
    for p in parts:  # a single grey image (scout view...) is shown as an image, not a volume
        if p["kind"] == "volume" and not p["multiframe"] and p["slices"] < 2:
            p["kind"] = "images"
            with_header = next(ds for f, ds in headers if f == p["files"][0])
            p["calibration"] = _calibration(with_header)
    modality_rank = {"CT": 0, "MR": 1, "PT": 2, "NM": 3}
    kind_rank = {"volume": 0, "images": 1}
    parts.sort(key=lambda p: (kind_rank[p["kind"]], modality_rank.get(p["modality"], 9),
                              p["plane"] != "axial", -p["slices"], p["description"]))
    parts += sorted(documents, key=lambda d: str(d["files"][0]))
    for i, p in enumerate(parts):
        p["index"] = i
    return parts


JPEG_LS = {"1.2.840.10008.1.2.4.80", "1.2.840.10008.1.2.4.81"}
try:  # CharLS decodes JPEG-LS about 10x faster than the default plugin, with identical pixels
    import jpeg_ls  # noqa: F401  (pyjpegls)
    _HAS_CHARLS = True
except ImportError:
    _HAS_CHARLS = False


def _pixels(ds) -> np.ndarray:
    """Decoded pixel data, using CharLS for JPEG-LS when it is installed."""
    if _HAS_CHARLS and str(getattr(ds.file_meta, "TransferSyntaxUID", "")) in JPEG_LS:
        try:
            from pydicom.pixels import pixel_array

            return pixel_array(ds, decoding_plugin="pyjpegls")
        except Exception:
            pass  # fall back to whatever plugin pydicom picks
    return ds.pixel_array


def part_summary(part: dict) -> dict:
    return {k: part[k] for k in ("index", "kind", "modality", "description", "slices", "rows", "cols", "plane")}


def _to_rgb8(ds, px: np.ndarray) -> np.ndarray:
    """Any decoded image (grey or colour, any bit depth) as uint8 RGB, (..., rows, cols, 3)."""
    if px.ndim >= 3 and px.shape[-1] == 3:  # colour: pydicom already returns RGB
        if px.dtype != np.uint8:
            top = float(px.max()) or 1.0
            px = np.clip(px.astype(np.float32) * (255.0 / top), 0, 255)
        return px.astype(np.uint8)
    # grey: apply the stored window (VOI) if any, else the 0.5-99.5th percentiles
    slope, intercept = _rescale(ds)
    values = px.astype(np.float32) * slope + intercept
    wc, ww = getattr(ds, "WindowCenter", None), getattr(ds, "WindowWidth", None)
    if wc is not None and ww is not None:
        wc = float(wc[0] if isinstance(wc, pydicom.multival.MultiValue) else wc)
        ww = float(ww[0] if isinstance(ww, pydicom.multival.MultiValue) else ww)
        lo, hi = wc - ww / 2, wc + ww / 2
    else:
        lo, hi = np.percentile(values, [0.5, 99.5])
    grey = np.clip((values - lo) * (255.0 / max(hi - lo, 1e-6)), 0, 255).astype(np.uint8)
    if str(getattr(ds, "PhotometricInterpretation", "")) == "MONOCHROME1":
        grey = 255 - grey
    return np.repeat(grey[..., None], 3, axis=-1)


def load_images(folder: Path, part: dict) -> tuple[dict, np.ndarray]:
    """Read a part of 2D images as uint8 RGB, shape (images, rows, cols, 3)."""
    if part["multiframe"]:
        ds = pydicom.dcmread(part["files"][0])
        frames = _to_rgb8(ds, _pixels(ds))
        images = list(frames.reshape(-1, part["rows"], part["cols"], 3))
        first = ds
    else:
        with ThreadPoolExecutor(max_workers=8) as pool:
            slices = list(pool.map(pydicom.dcmread, part["files"]))
        slices.sort(key=lambda s: (int(getattr(s, "InstanceNumber", 0) or 0), str(getattr(s, "SOPInstanceUID", ""))))
        with ThreadPoolExecutor(max_workers=8) as pool:
            images = list(pool.map(lambda s: _to_rgb8(s, _pixels(s)), slices))
        first = slices[0]
    vol = np.stack(images).astype(np.uint8)
    cal = part.get("calibration")
    sy, sx = cal if cal else (1.0, 1.0)

    def tag(name):
        v = getattr(first, name, None)
        return None if v in (None, "") else str(v)

    meta = {
        "id": folder.name if part["index"] == 0 else f"{folder.name}~{part['index']}",
        "folder": folder.name,
        "part": part["index"],
        "kind": "images",
        "rgb": True,
        "calibrated": cal is not None,
        "shape": list(vol.shape[:3]),
        "spacing": [1.0, sy, sx],
        "z_positions": [float(i) for i in range(len(vol))],
        "origin": [0.0, 0.0, 0.0],
        "orientation": list(AXIAL_IOP),
        "hu_range": [0, 255],
        "unit": "",
        "window": [127.5, 255.0],
        "modality": part["modality"] or tag("Modality"),
        "series_description": part["description"] or tag("SeriesDescription"),
        "manufacturer": tag("Manufacturer"),
        "kvp": None, "slice_thickness_tag": None, "convolution_kernel": None,
    }
    return meta, vol


def read_document(part: dict) -> tuple[bytes, str]:
    """The PDF bytes of an encapsulated-document part, with a file name."""
    ds = pydicom.dcmread(part["files"][0])
    data = bytes(ds.EncapsulatedDocument)
    if data.endswith(b"\x00") and not data.rstrip(b"\x00").endswith(b"\x00"):
        data = data[:-1]  # DICOM pads odd-length values with one zero byte
    name = re.sub(r"[^\w.-]+", "_", part["description"] or "report").strip("_") or "report"
    return data, f"{name}.pdf"


def _rescale(ds, frame_group=None) -> tuple[float, float]:
    transform = (getattr(frame_group, "PixelValueTransformationSequence", None) or [None])[0] if frame_group else None
    if transform is None:
        transform = _first(ds, "SharedFunctionalGroupsSequence", "PixelValueTransformationSequence")
    src = transform if transform is not None and "RescaleSlope" in transform else ds
    return float(getattr(src, "RescaleSlope", 1) or 1), float(getattr(src, "RescaleIntercept", 0) or 0)


def load_part(folder: Path, part: dict) -> tuple[dict, np.ndarray]:
    """Read one part, sort slices along the slice normal and convert to int16 values
    (Hounsfield units for CT). 2D image parts are delegated to load_images()."""
    if part["kind"] == "images":
        return load_images(folder, part)
    if part["kind"] != "volume":
        raise NoVolumeError(folder.name)
    if part["multiframe"]:
        ds = pydicom.dcmread(part["files"][0])
        frames = _pixels(ds).reshape(-1, part["rows"], part["cols"])
        per_frame = list(getattr(ds, "PerFrameFunctionalGroupsSequence", None) or [])
        iop = _orientation(ds)
        positions, scales = [], []
        for i in range(len(frames)):
            fg = per_frame[i] if i < len(per_frame) else None
            pos = getattr(_first(fg, "PlanePositionSequence") if fg else None, "ImagePositionPatient", None)
            positions.append([float(v) for v in pos] if pos else None)
            scales.append(_rescale(ds, fg))
        sources = [(frames[i], positions[i], scales[i]) for i in range(len(frames))]
        first = ds
    else:
        with ThreadPoolExecutor(max_workers=8) as pool:
            slices = list(pool.map(pydicom.dcmread, part["files"]))
        first = slices[0]
        iop = _orientation(first)
        sources = []
        for s in slices:
            pos = getattr(s, "ImagePositionPatient", None)
            sources.append((s, [float(v) for v in pos] if pos else None, _rescale(s)))

    normal = _normal(iop)
    if all(p is not None for _, p, _ in sources):
        proj = [float(np.dot(p, normal)) for _, p, _ in sources]
    else:  # no positions: keep acquisition order
        proj = [float(i) for i in range(len(sources))]
    order = sorted(range(len(sources)), key=lambda i: proj[i])

    # Keep one image per position (multi-echo / diffusion b-values repeat positions)
    kept, seen = [], set()
    for i in order:
        key = round(proj[i], 2)
        if key not in seen:
            seen.add(key)
            kept.append(i)

    vol = np.empty((len(kept), part["rows"], part["cols"]), np.int16)
    is_ct = part["modality"] == "CT"

    def convert(k_i):
        k, i = k_i
        src, _, (slope, intercept) = sources[i]
        px = (src if isinstance(src, np.ndarray) else _pixels(src)).astype(np.float32)
        if is_ct:
            px[px <= -2000] = 0  # outside-of-scan padding -> air after rescale
        vol[k] = np.clip(np.rint(px * slope + intercept), -32768, 32767).astype(np.int16)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(convert, enumerate(kept)))

    z = [proj[i] for i in kept]
    diffs = np.abs(np.diff(z)) if len(z) > 1 else np.array([])
    dz = float(np.median(diffs)) if diffs.size and np.median(diffs) > 0 else float(
        getattr(first, "SpacingBetweenSlices", None) or getattr(first, "SliceThickness", None) or 1)
    if len(z) > 1 and z[0] == z[-1]:
        z = [z[0] + k * dz for k in range(len(z))]
    sy, sx = _pixel_spacing(first)
    p0 = sources[kept[0]][1] or [0.0, 0.0, 0.0]

    def tag(name):
        v = getattr(first, name, None)
        return None if v in (None, "") else str(v)

    meta = {
        "id": folder.name if part["index"] == 0 else f"{folder.name}~{part['index']}",
        "folder": folder.name,
        "part": part["index"],
        "shape": list(vol.shape),
        "spacing": [dz, sy, sx],
        "z_positions": z,
        "origin": p0,
        "orientation": iop,
        "hu_range": [int(vol.min()), int(vol.max())],
        "unit": "HU" if is_ct else "",
        "modality": part["modality"] or tag("Modality"),
        "series_description": part["description"] or tag("SeriesDescription"),
        "manufacturer": tag("Manufacturer"),
        "kvp": tag("KVP"),
        "slice_thickness_tag": tag("SliceThickness"),
        "convolution_kernel": tag("ConvolutionKernel"),
    }
    if not is_ct:  # no Hounsfield units: suggest a window from the intensity distribution
        lo, hi = np.percentile(vol[:: max(1, len(vol) // 16)], [1, 99.5])
        meta["window"] = [float((lo + hi) / 2), float(max(1.0, hi - lo))]
    return meta, vol


class VolumeCache:
    """Small LRU cache; concurrent requests for the same series load it once."""

    def __init__(self, catalog: Catalog, size: int = CACHE_SIZE):
        self.catalog = catalog
        self.size = size
        self._items: OrderedDict[str, tuple[dict, bytes]] = OrderedDict()
        self._parts: dict[str, list[dict]] = {}
        self._lock = threading.Lock()
        self._loading: dict[str, threading.Lock] = {}

    def parts(self, folder_id: str) -> list[dict]:
        """Stackable volumes of a folder (scanned once, then remembered)."""
        if folder_id not in self._parts:
            folder = self.catalog.path(folder_id)
            if folder is None:
                raise KeyError(folder_id)
            self._parts[folder_id] = scan_parts(folder)
        return self._parts[folder_id]

    def get(self, sid: str) -> tuple[dict, bytes]:
        """sid is a folder id, optionally followed by ~<part> (another series of that exam)."""
        with self._lock:
            if sid in self._items:
                self._items.move_to_end(sid)
                return self._items[sid]
            series_lock = self._loading.setdefault(sid, threading.Lock())
        with series_lock:
            with self._lock:
                if sid in self._items:
                    return self._items[sid]
            folder_id, _, part_txt = sid.partition("~")
            folder = self.catalog.path(folder_id)
            if folder is None:
                raise KeyError(sid)
            t0 = time.perf_counter()
            parts = self.parts(folder_id)
            if not parts or parts[0]["kind"] == "document":  # nothing viewable (reports only)
                raise NoVolumeError(folder_id)
            index = int(part_txt) if part_txt.isdigit() else 0
            if index >= len(parts):
                raise KeyError(sid)
            meta, hu = load_part(folder, parts[index])
            meta["parts"] = [part_summary(p) for p in parts]
            meta["load_seconds"] = round(time.perf_counter() - t0, 2)
            data = hu.tobytes() if hu.dtype == np.uint8 else hu.astype("<i2", copy=False).tobytes()
            item = (meta, data)
            with self._lock:
                self._items[sid] = item
                while len(self._items) > self.size:
                    self._items.popitem(last=False)
            print(f"[luminor] loaded {sid[:12]} {meta['shape']} in {meta['load_seconds']} s", flush=True)
            return item


# --------------------------------------------------------------------------- #
# HTTP                                                                        #
# --------------------------------------------------------------------------- #
# --------------------------------------------------------------------------- #
# Google Drive (shared folders, "anyone with the link", no API key)          #
# --------------------------------------------------------------------------- #
DRIVE_ID = re.compile(r"^[A-Za-z0-9_-]{10,}$")
DRIVE_URL = re.compile(
    r"^https://drive\.google\.com/(?:drive/(?:u/\d+/)?folders/|embeddedfolderview\?id=|open\?id=)([A-Za-z0-9_-]{10,})")
_DRIVE_ENTRY = re.compile(
    r'<div class="flip-entry" id="entry-([\w-]+)".*?<a href="([^"]+)".*?<div class="flip-entry-title">(.*?)</div>', re.S)
_UA = {"User-Agent": "Mozilla/5.0 (Luminor DICOM viewer)"}


def drive_folder_id(text: str) -> str | None:
    """Folder id from a Google Drive folder link (or a bare id), else None."""
    text = (text or "").strip()
    m = DRIVE_URL.match(text)
    if m:
        return m.group(1)
    return None


def _http_get(url: str, timeout: float = 60) -> tuple[bytes, str]:
    import urllib.request

    req = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type", "")


def drive_listing(folder_id: str) -> tuple[str, list[tuple[str, str, bool]]]:
    """(folder title, [(id, name, is_folder), ...]) from the public folder page."""
    import html as htmlmod

    import urllib.error

    try:
        body, _ = _http_get(f"https://drive.google.com/embeddedfolderview?id={folder_id}")
    except urllib.error.HTTPError as exc:  # unknown or private folder
        if exc.code in (401, 403, 404):
            raise PermissionError("not_shared") from exc
        raise
    page = body.decode("utf-8", "replace")
    title = re.search(r"<title>(.*?)</title>", page, re.S)
    entries = [(fid, htmlmod.unescape(name).strip(), "/folders/" in href)
               for fid, href, name in _DRIVE_ENTRY.findall(page)]
    if title is None and not entries:
        raise PermissionError("not_shared")
    return htmlmod.unescape(title.group(1)).strip() if title else folder_id, entries


def _safe_name(name: str, used: set[str]) -> str:
    """A file or folder name from Drive that is valid on Windows and cannot leave its folder."""
    clean = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .") or "file"
    if clean in ("..", ".") or clean.upper() in ("CON", "PRN", "AUX", "NUL"):
        clean = f"_{clean}"
    base, n = clean, 2
    while clean.lower() in used:  # Drive allows duplicate names in one folder
        stem, dot, ext = base.rpartition(".")
        clean = f"{stem} ({n}).{ext}" if dot else f"{base} ({n})"
        n += 1
    used.add(clean.lower())
    return clean


class DriveJob:
    """Downloads a shared Google Drive folder (with sub-folders) into a local cache."""

    def __init__(self, folder_id: str, cache_root: Path):
        self.folder_id = folder_id
        self.cache_root = cache_root
        self.state = "listing"  # listing -> downloading -> done | error | cancelled
        self.total = self.done = self.skipped = 0
        self.bytes = 0
        self.error = None
        self.path = None
        self.cancelled = False
        threading.Thread(target=self._run, daemon=True).start()

    def info(self) -> dict:
        return {k: getattr(self, k) for k in ("state", "total", "done", "skipped", "bytes", "error")} | \
            {"path": str(self.path) if self.path else None}

    def _walk(self, folder_id: str, dest: Path, files: list, depth: int = 0) -> None:
        if depth > 8 or self.cancelled:
            return
        _, entries = drive_listing(folder_id)
        used: set[str] = set()
        for fid, name, is_folder in entries:
            target = dest / _safe_name(name, used)
            if is_folder:
                self._walk(fid, target, files, depth + 1)
            else:
                files.append((fid, target))

    def _download(self, item) -> None:
        fid, target = item
        if self.cancelled:
            return
        if target.is_file() and target.stat().st_size > 0:  # already in the cache
            self.skipped += 1
            self.done += 1
            return
        url = f"https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t"
        for attempt in range(3):
            try:
                data, ctype = _http_get(url, timeout=120)
                if ctype.startswith("text/html") and data[:200].lstrip().lower().startswith((b"<!doctype", b"<html")):
                    raise PermissionError("refused")  # quota, permission or virus-scan page
                target.parent.mkdir(parents=True, exist_ok=True)
                tmp = target.with_name(target.name + ".part")
                tmp.write_bytes(data)
                os.replace(tmp, target)
                self.bytes += len(data)
                self.done += 1
                return
            except PermissionError:
                raise
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(1 + attempt)

    def _run(self) -> None:
        try:
            title, entries = drive_listing(self.folder_id)
            if not entries:
                raise PermissionError("not_shared")  # private, wrong link or empty
            root = self.cache_root / f"{_safe_name(title, set())}-{self.folder_id[:8]}"
            files: list = []
            used: set[str] = set()
            loose = []  # files directly in the shared folder: keep them as one exam
            for fid, name, is_folder in entries:
                if is_folder:
                    self._walk(fid, root / _safe_name(name, used), files, 1)
                else:
                    loose.append((fid, name))
            if loose:
                exam = root / _safe_name(title, used)
                files += [(fid, exam / _safe_name(name, set())) for fid, name in loose]
            self.total = len(files)
            self.path = root
            self.state = "downloading"
            with ThreadPoolExecutor(max_workers=6) as pool:
                list(pool.map(self._download, files))
            self.state = "cancelled" if self.cancelled else "done"
        except PermissionError as exc:
            self.state, self.error = "error", str(exc) if str(exc) in ("not_shared", "refused") else "refused"
        except Exception as exc:
            self.state, self.error = "error", f"{type(exc).__name__}: {exc}"
        print(f"[luminor] Google Drive {self.folder_id[:8]}: {self.state} "
              f"({self.done}/{self.total} files, {self.bytes / 1e6:.0f} MB new)", flush=True)


_browse_lock = threading.Lock()


def tk_browse_folder(initial: str | None = None) -> str | None:
    """Native folder picker on this computer (the server is local), via tkinter."""
    import tkinter as tk
    from tkinter import filedialog

    with _browse_lock:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        try:
            return filedialog.askdirectory(parent=root, initialdir=initial or None, mustexist=True) or None
        finally:
            root.destroy()


class Handler(SimpleHTTPRequestHandler):
    catalog: Catalog
    cache: VolumeCache
    findings_dir: Path = FINDINGS_DIR
    # Native folder picker used by POST /api/browse-folder (None disables it)
    browse_folder = staticmethod(tk_browse_folder)
    # Called with the new data folder after a change (the desktop app saves it)
    on_data_change = None
    # Google Drive downloads: cache folder and the current download
    drive_cache: Path = APP_DIR / "data" / "drive"
    drive_job: DriveJob | None = None
    # Shared online demo: read-only library, findings kept in each visitor's browser
    public = False

    @classmethod
    def set_data_folder(cls, data: Path, labels: Path | None = None) -> Catalog:
        """Switch the series library to another folder (labels are looked up if not given)."""
        catalog = Catalog(Path(data).resolve(), labels if labels is not None else find_labels(Path(data)))
        cls.catalog = catalog
        cls.cache = VolumeCache(catalog)
        return catalog

    # Windows' registry can map .js to text/plain, which breaks ES modules
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".html": "text/html",
        ".json": "application/json",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, fmt, *args):  # quieter console: API errors only
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def translate_path(self, path):
        """Serve static/ first, then fall back to docs/ (guides, intro page, screenshots)."""
        local = super().translate_path(path)
        if not os.path.exists(local):
            rel = os.path.relpath(local, STATIC_DIR)
            alt = DOCS_DIR / rel
            if not rel.startswith("..") and alt.is_file():
                return str(alt)
        return local

    def list_directory(self, path):  # no directory listings
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    # -- helpers -------------------------------------------------------------
    def _json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _route(self):
        parts = [urllib.parse.unquote(p) for p in self.path.split("?", 1)[0].strip("/").split("/")]
        if parts[:2] != ["api", "series"]:
            return None
        return parts[2:]

    def _valid_sid(self, sid: str) -> bool:
        """A folder id from the catalog, optionally followed by ~<part number>."""
        folder_id, sep, part = sid.partition("~")
        return self.catalog.path(folder_id) is not None and (not sep or part.isdigit())

    def _endpoint(self) -> str:
        return self.path.split("?", 1)[0].rstrip("/")

    def _same_origin(self) -> bool:
        """Refuse requests sent by web pages from other sites (they carry their own Origin)."""
        origin = self.headers.get("Origin")
        host = self.headers.get("Host")
        return origin is None or origin in (f"http://{host}", f"https://{host}")

    def _read_json_body(self, limit: int):
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            raise ValueError("expected application/json")
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 <= length <= limit:
            raise ValueError("invalid size")
        return json.loads(self.rfile.read(length) or b"{}")

    def _folder_info(self):
        return {
            "path": str(self.catalog.root),
            "series": len(self.catalog.ids),
            "browse": self.browse_folder is not None and not self.public,
            "public": self.public,
        }

    # -- verbs ---------------------------------------------------------------
    def do_GET(self):
        if self._endpoint() == "/api/data-folder":
            return self._json(self._folder_info())
        if self._endpoint() == "/api/drive":
            job = type(self).drive_job
            return self._json(job.info() if job else {"state": "idle"})
        route = self._route()
        if route is None:
            return super().do_GET()
        try:
            if route == []:
                return self._json({"series": self.catalog.listing(), "root": str(self.catalog.root)})
            if len(route) == 2:
                sid, what = route
                if not self._valid_sid(sid):
                    return self._json({"error": "Unknown series"}, HTTPStatus.NOT_FOUND)
                if what == "meta":
                    return self._json(self.cache.get(sid)[0])
                if what == "volume":
                    return self._send_volume(sid)
                if what == "findings":
                    return self._json(self._read_findings(sid))
            if len(route) == 3 and route[1] == "document" and route[2].isdigit():
                return self._send_document(route[0], int(route[2]))
            return self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        except (ConnectionError, BrokenPipeError):
            pass
        except NoVolumeError:
            return self._json({"error": "no_volume"}, HTTPStatus.UNPROCESSABLE_ENTITY)
        except Exception as exc:  # report loader problems to the UI
            return self._json({"error": f"{type(exc).__name__}: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self):
        if not self._same_origin():
            return self._json({"error": "Forbidden"}, HTTPStatus.FORBIDDEN)
        endpoint = self._endpoint()
        if self.public:  # nothing on a shared demo server may be changed by visitors
            return self._json({"error": "public"}, HTTPStatus.FORBIDDEN)
        try:
            body = self._read_json_body(64_000)
        except ValueError as exc:
            return self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

        if endpoint == "/api/drive":  # download a shared Google Drive folder
            folder_id = drive_folder_id(str(body.get("url") or ""))
            if not folder_id:
                return self._json({"error": "drive_url"}, HTTPStatus.BAD_REQUEST)
            job = type(self).drive_job
            if job and job.state in ("listing", "downloading"):
                if job.folder_id == folder_id:
                    return self._json(job.info())
                job.cancelled = True
            type(self).drive_job = DriveJob(folder_id, Path(self.drive_cache))
            return self._json(type(self).drive_job.info())

        if endpoint == "/api/drive/cancel":
            if type(self).drive_job:
                type(self).drive_job.cancelled = True
            return self._json({"state": "cancelled"})

        if endpoint == "/api/browse-folder":
            if self.browse_folder is None:
                return self._json({"error": "Folder picker unavailable"}, HTTPStatus.NOT_IMPLEMENTED)
            try:
                return self._json({"path": self.browse_folder(str(self.catalog.root))})
            except Exception as exc:  # e.g. no display / tkinter missing
                return self._json({"error": f"{type(exc).__name__}: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

        if endpoint == "/api/data-folder":
            raw = str(body.get("path") or "").strip().strip('"')
            if not raw:
                return self._json({"error": "missing_path"}, HTTPStatus.BAD_REQUEST)
            if not Path(raw).expanduser().is_dir():
                return self._json({"error": "not_found", "path": raw}, HTTPStatus.BAD_REQUEST)
            data = resolve_data_folder(raw)
            if data is None:
                return self._json({"error": "no_series", "path": raw}, HTTPStatus.BAD_REQUEST)
            type(self).set_data_folder(data)
            print(f"[luminor] data folder changed: {data} ({len(self.catalog.ids)} series)", flush=True)
            if self.on_data_change:
                try:
                    self.on_data_change(data)
                except Exception as exc:
                    print(f"[luminor] could not save the data folder: {exc!r}", file=sys.stderr)
            return self._json(self._folder_info())

        return self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        if not self._same_origin():
            return self._json({"error": "Forbidden"}, HTTPStatus.FORBIDDEN)
        if self.public:
            return self._json({"error": "public"}, HTTPStatus.FORBIDDEN)
        route = self._route()
        if not route or len(route) != 2 or route[1] != "findings" or not self._valid_sid(route[0]):
            return self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_FINDINGS_BYTES:
            return self._json({"error": "Invalid size"}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        try:
            findings = json.loads(self.rfile.read(length))
            if not isinstance(findings, list):
                raise ValueError("expected a list")
        except ValueError as exc:
            return self._json({"error": f"Invalid JSON: {exc}"}, HTTPStatus.BAD_REQUEST)
        self.findings_dir.mkdir(parents=True, exist_ok=True)
        target = self.findings_dir / f"{route[0]}.json"
        tmp = target.with_suffix(".tmp")
        tmp.write_text(json.dumps(findings, indent=1), encoding="utf-8")
        os.replace(tmp, target)
        return self._json({"saved": len(findings)})

    def _read_findings(self, sid: str):
        f = self.findings_dir / f"{sid}.json"
        if self.public:
            return []
        return json.loads(f.read_text(encoding="utf-8")) if f.is_file() else []

    def _send_document(self, folder_id: str, index: int):
        """An exam's PDF report, shown by the browser's PDF viewer."""
        if self.catalog.path(folder_id) is None:
            return self._json({"error": "Unknown series"}, HTTPStatus.NOT_FOUND)
        parts = self.cache.parts(folder_id)
        if not 0 <= index < len(parts) or parts[index]["kind"] != "document":
            return self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        data, name = read_document(parts[index])
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Disposition", f'inline; filename="{name}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_volume(self, sid: str):
        _, data = self.cache.get(sid)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        view = memoryview(data)
        for i in range(0, len(view), 1 << 20):
            self.wfile.write(view[i : i + (1 << 20)])


def create_server(
    data: Path, labels: Path | None = None, port: int = 8770, findings_dir: Path | None = None,
    host: str = "127.0.0.1", public: bool = False,
) -> ThreadingHTTPServer:
    """Build the HTTP server (port 0 picks a free port); call serve_forever()."""
    catalog = Handler.set_data_folder(Path(data), labels)
    if not catalog.ids:
        print(f"[luminor] warning: no series found in {data}", file=sys.stderr)
    if findings_dir is not None:
        Handler.findings_dir = Path(findings_dir)

    Handler.public = public
    if public:
        Handler.browse_folder = None
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    print(f"[luminor] {len(catalog.ids)} series in {catalog.root}")
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="Luminor CT viewer")
    parser.add_argument("--port", type=int, default=8770)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="folder of series sub-folders")
    parser.add_argument("--labels", type=Path, default=DEFAULT_LABELS, help="optional id,cancer CSV")
    parser.add_argument("--host", default="127.0.0.1", help="address to listen on (0.0.0.0 for a container)")
    parser.add_argument("--public", action="store_true",
                        help="shared online demo: read-only library, findings kept in the browser")
    args = parser.parse_args()

    server = create_server(args.data, args.labels, args.port, host=args.host, public=args.public)
    mode = " (public mode)" if args.public else ""
    print(f"[luminor] Luminor running at http://{args.host}:{server.server_port}/{mode}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
