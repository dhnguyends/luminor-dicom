"""Download the demo chest CT series from The Cancer Imaging Archive (TCIA).

The series come from the LIDC-IDRI collection (anonymized, Creative Commons
Attribution 3.0). Each series is saved as <out>/<patient id>/*.dcm, the layout
Luminor expects. Run once when the Docker image is built:

    python fetch_tcia.py /app/data
"""

from __future__ import annotations

import io
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

API = "https://services.cancerimagingarchive.net/nbia-api/services/v1/getImage?SeriesInstanceUID="

# (patient id, series instance UID) - LIDC-IDRI chest CTs of 128 to 145 slices
SERIES = [
    ("LIDC-IDRI-0001", "1.3.6.1.4.1.14519.5.2.1.6279.6001.179049373636438705059720603192"),
    ("LIDC-IDRI-0003", "1.3.6.1.4.1.14519.5.2.1.6279.6001.170706757615202213033480003264"),
    ("LIDC-IDRI-0005", "1.3.6.1.4.1.14519.5.2.1.6279.6001.129007566048223160327836686225"),
    ("LIDC-IDRI-0007", "1.3.6.1.4.1.14519.5.2.1.6279.6001.272348349298439120568330857680"),
    ("LIDC-IDRI-0011", "1.3.6.1.4.1.14519.5.2.1.6279.6001.140253591510022414496468423138"),
    ("LIDC-IDRI-0012", "1.3.6.1.4.1.14519.5.2.1.6279.6001.328789598898469177563438457842"),
]


def download(uid: str) -> bytes:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(API + uid, timeout=300) as r:
                return r.read()
        except OSError as exc:
            if attempt == 3:
                raise
            print(f"  retry after {exc!r}", flush=True)
            time.sleep(5 * (attempt + 1))
    raise AssertionError


def main(out: Path) -> None:
    for patient, uid in SERIES:
        folder = out / patient
        if folder.is_dir() and any(folder.glob("*.dcm")):
            print(f"{patient}: already present", flush=True)
            continue
        print(f"{patient}: downloading", flush=True)
        folder.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(download(uid))) as z:
            count = 0
            for member in z.infolist():
                name = Path(member.filename).name  # flatten: never write outside the folder
                if member.is_dir() or not name.lower().endswith(".dcm"):
                    continue
                (folder / name).write_bytes(z.read(member))
                count += 1
        if count == 0:
            sys.exit(f"{patient}: no DICOM files in the download")
        print(f"{patient}: {count} slices", flush=True)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "data"))
