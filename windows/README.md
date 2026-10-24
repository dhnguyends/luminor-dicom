# Luminor for Windows — installation guide

Luminor is a CT viewer built around the seven actions radiologists use most: scrolling,
window/level, MPR, measurements, MIP slabs, comparison and reporting. This package runs it as a
normal Windows application: no Python, no command line, no browser needed.

> **Research and education use only.** Luminor is not a certified medical device and must not
> be used for diagnostic or treatment decisions.

**Contents:** [Requirements](#requirements) · [Install](#install) · [First launch](#first-launch) ·
[Everyday use](#everyday-use) · [Change the data folder](#change-the-data-folder) ·
[Where Luminor keeps your files](#where-luminor-keeps-your-files) · [Update](#update) ·
[Uninstall](#uninstall) · [Troubleshooting](#troubleshooting) ·
[Building from source](#building-from-source)

---

## Requirements

| | |
|---|---|
| **Windows** | Windows 11, or Windows 10 (64-bit) |
| **WebView2 Runtime** | Built into Windows 11. On Windows 10, install it from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/) if Luminor opens in your browser instead of its own window. |
| **Memory** | 8 GB RAM recommended (each open CT study uses about 100–200 MB) |
| **Disk** | About 75 MB for Luminor (30 MB download), plus your DICOM data |
| **Data** | CT or MRI exams as DICOM files: one folder per exam or series (see [First launch](#first-launch)) |

Nothing else is needed: Python and all libraries are included.

## Install

1. Download **[`Luminor-1.2-win64.zip`](https://github.com/dhnguyends/luminor-dicom-windows/releases/download/v1.2/Luminor-1.2-win64.zip)**
   from the [releases page](https://github.com/dhnguyends/luminor-dicom-windows/releases).
2. Right-click the zip → **Extract All…** and choose a folder you own, for example
   `C:\Users\<you>\Apps\Luminor` or `D:\Apps\Luminor`.
   Keep all extracted files together: `Luminor.exe` needs the `_internal` folder next to it.
3. Optional: right-click **`Luminor.exe`** → **Show more options** → **Send to** →
   **Desktop (create shortcut)**. You can also right-click it → **Pin to Start**.

There is no installer and nothing is written to `Program Files` or the registry.

### "Windows protected your PC"

Luminor is not digitally signed, so the first time you open it Windows SmartScreen may show
**"Windows protected your PC"**. Click **More info → Run anyway**. Windows remembers your choice.

If your antivirus quarantines `Luminor.exe`, restore it and add the Luminor folder to its
exceptions. Applications packaged with PyInstaller are sometimes flagged by mistake.

## First launch

1. Double-click **`Luminor.exe`**.
2. Luminor asks for **the folder that contains your CT series**. Choose the folder in which
   **each sub-folder is one CT series** of `.dcm` files:

   ```
   D:\scans\                      ← choose this folder
   ├── patient-001\  *.dcm
   ├── patient-002\  *.dcm
   └── patient-003\  *.dcm
   ```

   If you select a single series folder instead, Luminor uses its parent folder automatically.
3. Luminor opens in its own window and loads the first series. It remembers the folder for the
   next time.

**Optional labels:** if a CSV file whose name contains `labels` (for example the Kaggle
`stage1_labels.csv`, with columns `id,cancer`) sits in the data folder or up to two levels
above it, Luminor shows the labels in the library and lets you filter by them.

**Sample data:** Luminor was developed with chest CT scans from the
[Kaggle Data Science Bowl 2017](https://www.kaggle.com/c/data-science-bowl-2017) (Kaggle account
and acceptance of the competition rules required). Extract `stage1` and choose the
`stage1\stage1` folder that contains one folder per patient.

## Everyday use

- Double-click **`Luminor.exe`** (or your shortcut). Closing the window quits Luminor.
- **Exams with several series** (for example bone and soft-tissue reconstructions, a coronal series, or MRI sequences) show a **series bar** above the images. Use **‹ Previous** / **Next ›** (**Précédente** / **Suivante** in French), or the **P** / **N** keys, to go through the series; the drop-down jumps to any series. Luminor stays at the same anatomical position.
- **Incomplete exams:** many CD/USB exports stop at 1,000 images. If a series seems to skip part of the body, export it again without that limit, or one series at a time.
- Luminor displays **CT and MRI volumes**, including compressed DICOM (JPEG-LS, JPEG, JPEG 2000, RLE) and multi-frame MRI, and **2D images** (ultrasound images and cine loops, screenshots, scout views), shown one by one. An exam's **PDF reports** open from the **Report (PDF)** buttons in the series bar.
- Press **?** in Luminor for all keyboard and mouse shortcuts.
- The **globe button (EN / FR)** switches the interface between English and French.
- The full illustrated user guide opens in your browser from the shortcuts sheet, or online:
  [English](https://dhnguyends.github.io/luminor-dicom/guide.html) ·
  [Français](https://dhnguyends.github.io/luminor-dicom/guide-fr.html).
- **Key images** and **report drafts** open a **Save As** dialog, starting in your
  **Downloads** folder; choose where to save and click **Save**.

## Change the data folder

**From inside Luminor** (easiest), at any time:

1. At the top of the library, next to the current **Images folder**, click **Change…**
   (**Changer…** in French).
2. Click **Browse…** to pick a folder with the Windows folder picker, or paste a path
   (File Explorer → right-click a folder → **Copy as path**) and click **Open folder**.
3. Luminor checks that the folder contains DICOM series, reloads the library and opens the first
   series. It remembers the new folder for the next time.

**From Google Drive:** paste the link of a Google Drive folder shared with **“Anyone with the link”** (`https://drive.google.com/drive/folders/…`) instead of a path, and click **Open folder**. Luminor downloads the folder to `%APPDATA%\Luminor\drive` with a progress bar, then opens it; files already downloaded are reused next time. Anyone who obtains such a link can open the folder, so share medical images with care.

**Before starting Luminor:** double-click **`Choose data folder.cmd`** in the Luminor folder, or run:

```
Luminor.exe --choose-folder
```

Other options, for a shortcut's **Target** field or a command prompt:

| Option | Effect |
|---|---|
| `--data "D:\scans"` | Open this folder (and remember it) without asking |
| `--choose-folder` | Pick another data folder |
| `--browser` | Open Luminor in your web browser instead of its own window |
| `--server-only` | Start only the local server (advanced) |

## Where Luminor keeps your files

Luminor never modifies your DICOM files. Everything it creates is in
**`%APPDATA%\Luminor`** (paste this into the File Explorer address bar):

| File or folder | Content |
|---|---|
| `config.json` | The data folder you chose |
| `findings\` | Your measurements and markers, one file per series |
| `webview\` | Window settings: language, last opened series |
| `luminor.log` | Diagnostic log (useful when reporting a problem) |

Luminor works entirely on your computer: its local server only accepts connections from this
PC, and images never leave it.

## Update

1. Close Luminor.
2. Delete the old Luminor folder (your findings and settings are kept in `%APPDATA%\Luminor`).
3. Extract the new zip in its place.

## Uninstall

1. Delete the Luminor folder and any shortcuts you created.
2. Optional: delete `%APPDATA%\Luminor` to remove your findings and settings.

## Troubleshooting

| Problem | Solution |
|---|---|
| "Windows protected your PC" | **More info → Run anyway** (see [above](#windows-protected-your-pc)). |
| Nothing happens when I double-click | Wait a few seconds: the first start takes longer. Then check `%APPDATA%\Luminor\luminor.log`. |
| "No series found" | Choose the folder whose **sub-folders** contain the `.dcm` files (see [First launch](#first-launch)). |
| Luminor opens in the browser, not in a window | The WebView2 Runtime is missing: [install it](https://developer.microsoft.com/microsoft-edge/webview2/), then restart Luminor. |
| "No image that Luminor can display" | The folder holds only reports or unsupported files. |
| A series does not open | It may use a DICOM format Luminor cannot decode. Details are in `luminor.log`. |
| Opening a study is slow | The first opening reads every DICOM file of the exam (up to 15–20 s for a large compressed CT); switching series is then faster, and the last three series stay in memory. |
| "The code execution cannot proceed…" or a missing DLL | Extract the **whole** zip again; `_internal` must stay next to `Luminor.exe`. |
| Antivirus removed `Luminor.exe` | Restore it and add the Luminor folder to the antivirus exceptions. |

When asking for help, attach `%APPDATA%\Luminor\luminor.log`.

---

## Building from source

For developers who want to rebuild `Luminor.exe`. The source code is at
<https://github.com/dhnguyends/luminor-dicom>; its `windows/` folder holds the Windows packaging.

### Tools

| Software | Download | Role |
|---|---|---|
| Anaconda or Miniconda | <https://www.anaconda.com/download> | Python 3.11 build environment |
| PyInstaller | <https://pyinstaller.org/> | Packs Python and Luminor into `Luminor.exe` |
| pywebview | <https://pywebview.flowrl.com/> | Native app window (Edge WebView2) |
| NumPy, pydicom | <https://numpy.org/> · <https://pydicom.github.io/> | Luminor's libraries |
| pyjpegls, pylibjpeg (+ libjpeg, openjpeg, rle plugins) | <https://pypi.org/project/pyjpegls/> · <https://pypi.org/project/pylibjpeg/> | Decoders for compressed DICOM (JPEG-LS, JPEG, JPEG 2000, RLE) |
| Pillow | <https://python-pillow.org/> | Draws the app icon at build time (not bundled) |
| Git | <https://git-scm.com/download/win> | Source code |

### Steps

```powershell
# 1. Get the source code
git clone https://github.com/dhnguyends/luminor-dicom.git

# 2. Create the build environment (once)
conda create -n luminor-build python=3.11 -y
conda run -n luminor-build pip install pyinstaller pywebview numpy pydicom pillow pyjpegls pylibjpeg pylibjpeg-libjpeg pylibjpeg-openjpeg pylibjpeg-rle

# 3. Build
cd luminor-dicom\windows
powershell -ExecutionPolicy Bypass -File build.ps1
```

Output in `windows\dist\` (not committed to Git):

- `Luminor\Luminor.exe` with its `_internal\` folder, `Choose data folder.cmd` and this README;
- `Luminor-1.2-win64.zip`, ready to share.

### Files in this folder

| File | Role |
|---|---|
| `luminor_app.py` | Desktop launcher: data-folder picker, local server on a free port, app window, browser fallback, `%APPDATA%` storage, logging |
| `luminor.spec` | PyInstaller recipe: bundles `server.py`, `static/`, `docs/`, LICENSE and NOTICE from the repository root |
| `make_icon.py` | Draws `assets\luminor.ico` (same design as the web favicon) |
| `assets\version_info.txt` | Version, description and copyright shown in the exe's Properties |
| `build.ps1` | Runs the three steps above and creates the zip |

To run the launcher without building: `conda run -n luminor-build python luminor_app.py`.

---

Luminor · Copyright 2026 dhnguyends · [Apache License 2.0](https://github.com/dhnguyends/luminor-dicom/blob/main/LICENSE) ·
[Documentation](https://dhnguyends.github.io/luminor-dicom/)
