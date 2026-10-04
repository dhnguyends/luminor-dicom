"""Luminor - local CT viewer server.

Serves the single-page viewer in ``static/`` (falling back to ``docs/`` for the user
guides) and a small API:

    GET  /api/series                 catalog of series folders (+ slice counts, labels)
    GET  /api/series/<id>/meta       geometry and acquisition metadata
    GET  /api/series/<id>/volume     raw HU volume, int16 little-endian, C order (z, y, x)
    GET  /api/series/<id>/findings   saved findings (JSON list)
    PUT  /api/series/<id>/findings   replace saved findings

All rendering (window/level, MPR, MIP, measurements) happens in the browser on the
downloaded volume. The server binds to 127.0.0.1 only.
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

SERIES_ID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
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
def _z(ds) -> float:
    if "ImagePositionPatient" in ds:
        return float(ds.ImagePositionPatient[2])
    if "SliceLocation" in ds:
        return float(ds.SliceLocation)
    return float(ds.InstanceNumber)


def load_series(folder: Path) -> tuple[dict, np.ndarray]:
    """Read a series, sort it inferior -> superior and convert to HU (int16)."""
    files = sorted(folder.glob("*.dcm"))
    if not files:
        raise FileNotFoundError(f"No DICOM files in {folder.name}")
    with ThreadPoolExecutor(max_workers=8) as pool:
        slices = list(pool.map(pydicom.dcmread, files))
    slices.sort(key=_z)

    hu = np.empty((len(slices), int(slices[0].Rows), int(slices[0].Columns)), np.int16)
    for i, s in enumerate(slices):
        px = s.pixel_array.astype(np.int16)
        px[px == -2000] = 0  # outside-of-scan padding -> air after rescale
        slope = float(getattr(s, "RescaleSlope", 1))
        intercept = float(getattr(s, "RescaleIntercept", 0))
        if slope != 1:
            px = (px.astype(np.float32) * slope).astype(np.int16)
        hu[i] = px + np.int16(intercept)

    z = [_z(s) for s in slices]
    dz = float(np.median(np.abs(np.diff(z)))) if len(z) > 1 else float(
        getattr(slices[0], "SliceThickness", 1) or 1
    )
    first = slices[0]
    sy, sx = (float(v) for v in first.PixelSpacing)
    iop = [float(v) for v in getattr(first, "ImageOrientationPatient", [1, 0, 0, 0, 1, 0])]
    ipp = [float(v) for v in getattr(first, "ImagePositionPatient", [0, 0, z[0]])]

    def tag(name):
        v = getattr(first, name, None)
        return None if v in (None, "") else str(v)

    meta = {
        "id": folder.name,
        "shape": list(hu.shape),
        "spacing": [dz, sy, sx],
        "z_positions": z,
        "origin": ipp,
        "orientation": iop,
        "hu_range": [int(hu.min()), int(hu.max())],
        "modality": tag("Modality"),
        "series_description": tag("SeriesDescription"),
        "manufacturer": tag("Manufacturer"),
        "kvp": tag("KVP"),
        "slice_thickness_tag": tag("SliceThickness"),
        "convolution_kernel": tag("ConvolutionKernel"),
    }
    return meta, hu


class VolumeCache:
    """Small LRU cache; concurrent requests for the same series load it once."""

    def __init__(self, catalog: Catalog, size: int = CACHE_SIZE):
        self.catalog = catalog
        self.size = size
        self._items: OrderedDict[str, tuple[dict, bytes]] = OrderedDict()
        self._lock = threading.Lock()
        self._loading: dict[str, threading.Lock] = {}

    def get(self, sid: str) -> tuple[dict, bytes]:
        with self._lock:
            if sid in self._items:
                self._items.move_to_end(sid)
                return self._items[sid]
            series_lock = self._loading.setdefault(sid, threading.Lock())
        with series_lock:
            with self._lock:
                if sid in self._items:
                    return self._items[sid]
            folder = self.catalog.path(sid)
            if folder is None:
                raise KeyError(sid)
            t0 = time.perf_counter()
            meta, hu = load_series(folder)
            meta["load_seconds"] = round(time.perf_counter() - t0, 2)
            item = (meta, hu.astype("<i2", copy=False).tobytes())
            with self._lock:
                self._items[sid] = item
                while len(self._items) > self.size:
                    self._items.popitem(last=False)
            print(f"[luminor] loaded {sid[:12]} {meta['shape']} in {meta['load_seconds']} s", flush=True)
            return item


# --------------------------------------------------------------------------- #
# HTTP                                                                        #
# --------------------------------------------------------------------------- #
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
        parts = self.path.split("?", 1)[0].strip("/").split("/")
        if parts[:2] != ["api", "series"]:
            return None
        return parts[2:]

    def _endpoint(self) -> str:
        return self.path.split("?", 1)[0].rstrip("/")

    def _same_origin(self) -> bool:
        """Refuse requests sent by web pages from other sites (they carry their own Origin)."""
        origin = self.headers.get("Origin")
        return origin is None or origin == f"http://{self.headers.get('Host')}"

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
            "browse": self.browse_folder is not None,
        }

    # -- verbs ---------------------------------------------------------------
    def do_GET(self):
        if self._endpoint() == "/api/data-folder":
            return self._json(self._folder_info())
        route = self._route()
        if route is None:
            return super().do_GET()
        try:
            if route == []:
                return self._json({"series": self.catalog.listing(), "root": str(self.catalog.root)})
            if len(route) == 2:
                sid, what = route
                if self.catalog.path(sid) is None:
                    return self._json({"error": "Unknown series"}, HTTPStatus.NOT_FOUND)
                if what == "meta":
                    return self._json(self.cache.get(sid)[0])
                if what == "volume":
                    return self._send_volume(sid)
                if what == "findings":
                    return self._json(self._read_findings(sid))
            return self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        except (ConnectionError, BrokenPipeError):
            pass
        except Exception as exc:  # report loader problems to the UI
            return self._json({"error": f"{type(exc).__name__}: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self):
        if not self._same_origin():
            return self._json({"error": "Forbidden"}, HTTPStatus.FORBIDDEN)
        endpoint = self._endpoint()
        try:
            body = self._read_json_body(64_000)
        except ValueError as exc:
            return self._json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

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
        route = self._route()
        if not route or len(route) != 2 or route[1] != "findings" or self.catalog.path(route[0]) is None:
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
        return json.loads(f.read_text(encoding="utf-8")) if f.is_file() else []

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
    data: Path, labels: Path | None = None, port: int = 8770, findings_dir: Path | None = None
) -> ThreadingHTTPServer:
    """Build the HTTP server on 127.0.0.1 (port 0 picks a free port); call serve_forever()."""
    catalog = Handler.set_data_folder(Path(data), labels)
    if not catalog.ids:
        print(f"[luminor] warning: no series found in {data}", file=sys.stderr)
    if findings_dir is not None:
        Handler.findings_dir = Path(findings_dir)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    print(f"[luminor] {len(catalog.ids)} series in {catalog.root}")
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="Luminor CT viewer")
    parser.add_argument("--port", type=int, default=8770)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="folder of series sub-folders")
    parser.add_argument("--labels", type=Path, default=DEFAULT_LABELS, help="optional id,cancer CSV")
    args = parser.parse_args()

    server = create_server(args.data, args.labels, args.port)
    print(f"[luminor] Luminor running at http://127.0.0.1:{server.server_port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
