"""Copy what the Hugging Face Space needs into a clone of the Space repository.

    git clone https://huggingface.co/spaces/<user>/luminor HF-Space
    python huggingface/prepare_space.py HF-Space
    cd HF-Space && git add -A && git commit -m "Update Luminor" && git push
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent  # the luminor-dicom repository
HERE = Path(__file__).resolve().parent

FILES = {
    HERE / "Dockerfile": "Dockerfile",
    HERE / "README.md": "README.md",
    HERE / "fetch_tcia.py": "fetch_tcia.py",
    SRC / "server.py": "server.py",
    SRC / "requirements.txt": "requirements.txt",
    SRC / "LICENSE": "LICENSE",
    SRC / "NOTICE": "NOTICE",
}
FOLDERS = ["static", "docs"]


def main(target: Path) -> None:
    if not (target / ".git").is_dir():
        sys.exit(f"{target} is not a clone of the Space repository")
    for src, name in FILES.items():
        shutil.copy2(src, target / name)
    for folder in FOLDERS:
        shutil.rmtree(target / folder, ignore_errors=True)
        shutil.copytree(SRC / folder, target / folder)
    print(f"Space files copied to {target}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
