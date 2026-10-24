# PyInstaller build recipe for Luminor.exe
#   pyinstaller --noconfirm --clean luminor.spec
#
# One-folder build (dist\Luminor\Luminor.exe + _internal\): starts faster and
# triggers fewer antivirus false positives than a single-file exe.
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules, copy_metadata

HERE = Path(SPECPATH)
# Luminor source code (server.py, static/, docs/): the repository root when this folder is
# luminor-dicom/windows, or a sibling "Claude-Radio" folder in the original project layout.
SOURCE = next(p for p in (HERE.parent, HERE.parent / "Claude-Radio") if (p / "server.py").is_file())

# Decoders for compressed DICOM (JPEG-LS, JPEG, JPEG 2000, RLE). pylibjpeg finds its
# plugins through package metadata (entry points), so the metadata must be bundled too.
decoder_datas, decoder_binaries, decoder_imports = [], [], []
for package in ("pylibjpeg", "libjpeg", "openjpeg", "rle", "jpeg_ls"):
    d, b, h = collect_all(package)
    decoder_datas += d
    decoder_binaries += b
    decoder_imports += h
for dist in ("pylibjpeg", "pylibjpeg-libjpeg", "pylibjpeg-openjpeg", "pylibjpeg-rle", "pyjpegls"):
    decoder_datas += copy_metadata(dist)

a = Analysis(
    [str(HERE / "luminor_app.py")],
    pathex=[str(SOURCE)],
    binaries=decoder_binaries,
    datas=[
        (str(SOURCE / "static"), "static"),
        (str(SOURCE / "docs"), "docs"),
        (str(SOURCE / "LICENSE"), "."),
        (str(SOURCE / "NOTICE"), "."),
        *decoder_datas,
    ],
    # server.py is imported at run time; pydicom loads pixel decoders as plugins
    hiddenimports=["server", *collect_submodules("pydicom.pixels"), *decoder_imports],
    excludes=["matplotlib", "scipy", "pandas", "IPython", "pytest", "PIL"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Luminor",
    icon=str(HERE / "assets" / "luminor.ico"),
    version=str(HERE / "assets" / "version_info.txt"),
    console=False,  # windowed app; output goes to %APPDATA%\Luminor\luminor.log
    upx=False,      # UPX compression causes antivirus false positives
)

coll = COLLECT(exe, a.binaries, a.datas, name="Luminor", upx=False)
