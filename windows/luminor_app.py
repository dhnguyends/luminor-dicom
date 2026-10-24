"""Luminor desktop launcher for Windows.

Starts the Luminor server on a free local port and opens the viewer in its own
window (Microsoft Edge WebView2 through pywebview). If the window cannot be
created, it falls back to the default web browser.

Per-user files live in %APPDATA%\\Luminor:
    config.json   remembered DICOM data folder
    findings\\     saved measurements and markers, one JSON file per series
    webview\\      window storage (language, last opened series)
    luminor.log   log file (the windowed exe has no console)

Usage:
    Luminor.exe                     open Luminor (asks for the data folder the first time)
    Luminor.exe --choose-folder     pick another data folder
    Luminor.exe --data "D:\\scans"   use this folder (and remember it)
    Luminor.exe --browser           open in the web browser instead of a window
    Luminor.exe --server-only       run the server without any window (prints the URL)
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import sys
import threading
import webbrowser
from pathlib import Path

APP_NAME = "Luminor"
VERSION = "1.2"
USER_DIR = Path(os.environ.get("APPDATA") or Path.home()) / APP_NAME
CONFIG_FILE = USER_DIR / "config.json"
LOG_FILE = USER_DIR / "luminor.log"

# When run from source, server.py is in the repository root (this file is in windows/) or in
# a sibling Claude-Radio folder; in the exe, PyInstaller bundles it as a module.
if not getattr(sys, "frozen", False):
    _here = Path(__file__).resolve().parent
    for _src in (_here.parent, _here.parent / "Claude-Radio"):
        if (_src / "server.py").is_file():
            sys.path.insert(0, str(_src))
            break


# --------------------------------------------------------------------------- #
# Messages (English / French, following the Windows display language)        #
# --------------------------------------------------------------------------- #
def _windows_is_french() -> bool:
    try:
        return (ctypes.windll.kernel32.GetUserDefaultUILanguage() & 0x3FF) == 0x0C
    except (AttributeError, OSError):
        return False


FR = _windows_is_french()
TEXT = {
    "pick_title": (
        "Luminor — choisissez le dossier qui contient vos séries de scanner"
        if FR else "Luminor — choose the folder that contains your CT series"
    ),
    "no_series_title": "Aucune série trouvée" if FR else "No series found",
    "no_series": (
        "Ce dossier ne contient aucune série DICOM.\n\n"
        "Choisissez le dossier parent dans lequel chaque sous-dossier contient les "
        "fichiers .dcm d’une série de scanner."
        if FR else
        "This folder does not contain any DICOM series.\n\n"
        "Choose the parent folder in which each sub-folder holds the .dcm files of one CT series."
    ),
    "error_title": "Luminor — erreur" if FR else "Luminor — error",
    "error": (
        "Luminor n’a pas pu démarrer :\n\n{err}\n\nDétails dans {log}"
        if FR else "Luminor could not start:\n\n{err}\n\nDetails in {log}"
    ),
    "running": "Luminor est ouvert dans votre navigateur." if FR else "Luminor is open in your web browser.",
    "open": "Ouvrir" if FR else "Open",
    "quit": "Quitter Luminor" if FR else "Quit Luminor",
}


# --------------------------------------------------------------------------- #
# Logging and settings                                                         #
# --------------------------------------------------------------------------- #
def setup_logging() -> None:
    """A windowed exe has no console: send print/log output to luminor.log."""
    USER_DIR.mkdir(parents=True, exist_ok=True)
    if sys.stdout is None or sys.stderr is None:
        log = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log


def load_config() -> dict:
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_config(config: dict) -> None:
    USER_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config, indent=2), encoding="utf-8")


# --------------------------------------------------------------------------- #
# Data folder                                                                  #
# --------------------------------------------------------------------------- #
# Folder validation and label lookup are shared with the server (and its
# "Change folder" API): resolve_data_folder() returns an absolute path, or None.
from server import find_labels, resolve_data_folder  # noqa: E402


def remember_data_folder(data: Path) -> None:
    """Called by the server when the folder is changed from inside Luminor."""
    config = load_config()
    config["data"] = str(data)
    save_config(config)


def _tk_root():
    import tkinter as tk

    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)  # sharp dialogs on high-DPI screens
    except (AttributeError, OSError):
        pass
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    return root


def choose_data_folder(initial: str | None) -> Path | None:
    """Folder picker; repeats until a folder with series is chosen or the user cancels."""
    from tkinter import filedialog, messagebox

    root = _tk_root()
    try:
        while True:
            picked = filedialog.askdirectory(
                parent=root, title=TEXT["pick_title"], initialdir=initial or str(Path.home()), mustexist=True
            )
            if not picked:
                return None
            data = resolve_data_folder(Path(picked))
            if data:
                return data
            if not messagebox.askretrycancel(TEXT["no_series_title"], TEXT["no_series"], parent=root):
                return None
            initial = picked
    finally:
        root.destroy()


def show_error(message: str) -> None:
    try:
        from tkinter import messagebox

        root = _tk_root()
        messagebox.showerror(TEXT["error_title"], TEXT["error"].format(err=message, log=LOG_FILE), parent=root)
        root.destroy()
    except Exception:  # last resort: the log file
        print(f"[luminor] error: {message}", file=sys.stderr)


# --------------------------------------------------------------------------- #
# Windows                                                                      #
# --------------------------------------------------------------------------- #
class WindowApi:
    """Functions the web page can call as window.pywebview.api.<name>().

    pywebview exposes every public attribute to the page, so the window is kept in a
    private attribute (a public one makes pywebview walk the native window objects).
    """

    def __init__(self):
        self._window = None

    def choose_folder(self):
        """Native Windows folder picker for "Change folder"; returns a path or None."""
        import webview

        start = load_config().get("data") or str(Path.home())
        picked = self._window.create_file_dialog(webview.FileDialog.FOLDER, directory=start)
        return picked[0] if picked else None


def open_app_window(url: str) -> None:
    """Native window through pywebview (Edge WebView2). Raises if unavailable."""
    import webview

    for key, value in {
        "ALLOW_DOWNLOADS": True,                 # key images and report drafts
        "OPEN_EXTERNAL_LINKS_IN_BROWSER": True,  # user guide opens in the browser
    }.items():
        if key in webview.settings:
            webview.settings[key] = value

    api = WindowApi()
    api._window = webview.create_window(
        APP_NAME, url, width=1440, height=900, min_size=(900, 600),
        background_color="#000000", text_select=True, js_api=api,
    )
    # private_mode=False keeps the interface language and last series between sessions
    webview.start(private_mode=False, storage_path=str(USER_DIR / "webview"))


def run_in_browser(url: str) -> None:
    """Fallback: default browser plus a small window to quit Luminor."""
    import tkinter as tk

    webbrowser.open(url)
    root = _tk_root()
    root.deiconify()
    root.attributes("-topmost", False)
    root.title(APP_NAME)
    root.resizable(False, False)
    tk.Label(root, text=TEXT["running"], padx=24, pady=14).pack()
    tk.Label(root, text=url, fg="#0a64d6", padx=24).pack()
    buttons = tk.Frame(root, pady=14)
    buttons.pack()
    tk.Button(buttons, text=TEXT["open"], width=12, command=lambda: webbrowser.open(url)).pack(side="left", padx=6)
    tk.Button(buttons, text=TEXT["quit"], width=16, command=root.destroy).pack(side="left", padx=6)
    root.mainloop()


# --------------------------------------------------------------------------- #
# Main                                                                         #
# --------------------------------------------------------------------------- #
def main() -> int:
    setup_logging()
    parser = argparse.ArgumentParser(prog=APP_NAME, description="Luminor CT viewer")
    parser.add_argument("--data", type=Path, help="folder of CT series (remembered)")
    parser.add_argument("--choose-folder", action="store_true", help="pick another data folder")
    parser.add_argument("--browser", action="store_true", help="open in the web browser")
    parser.add_argument("--server-only", action="store_true", help="run the server without a window")
    parser.add_argument("--port", type=int, default=0, help="port (default: any free port)")
    args = parser.parse_args()
    print(f"[luminor] {APP_NAME} {VERSION} starting", flush=True)

    config = load_config()
    data = resolve_data_folder(args.data) if args.data else None
    if args.data and data is None:
        show_error(f"{TEXT['no_series']}\n\n{args.data}")
        return 2
    if data is None and not args.choose_folder and config.get("data"):
        data = resolve_data_folder(Path(config["data"]))
    if data is None:
        data = choose_data_folder(config.get("data"))
        if data is None:
            return 0  # cancelled
    config["data"] = str(data)
    save_config(config)

    import server as luminor_server

    labels = find_labels(data)
    httpd = luminor_server.create_server(data, labels, args.port, findings_dir=USER_DIR / "findings")
    # Remember folders chosen with "Change folder" inside Luminor
    luminor_server.Handler.on_data_change = staticmethod(remember_data_folder)
    if args.browser or args.server_only:
        # The browser fallback runs tkinter on the main thread: no second picker from the server
        luminor_server.Handler.browse_folder = None
    url = f"http://127.0.0.1:{httpd.server_port}/"
    print(f"[luminor] data: {data} | labels: {labels} | {url}", flush=True)

    if args.server_only:
        print(url, flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        return 0

    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        if args.browser:
            run_in_browser(url)
        else:
            try:
                open_app_window(url)
            except Exception as exc:  # no WebView2 / pywebview problem: use the browser
                print(f"[luminor] app window unavailable ({exc!r}); using the browser", flush=True)
                luminor_server.Handler.browse_folder = None
                run_in_browser(url)
    finally:
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        import traceback

        traceback.print_exc()
        show_error(f"{type(exc).__name__}: {exc}")
        sys.exit(1)
