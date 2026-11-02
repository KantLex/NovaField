"""Model downloads for the NovaField app: fetch the files its features need into ComfyUI's model
folders, one at a time, with progress, resume and cancel.

Only files in ``model_catalog.json`` can be downloaded, from the links listed there (Hugging Face),
into the folder listed there: a request names a file, never a URL or a path. No ComfyUI imports at
module level; the server routes (``routes.py``) pass in where each folder is.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import urllib.request
from pathlib import Path
from typing import Callable, Dict, List, Optional

CATALOG: Dict[str, dict] = json.loads((Path(__file__).parent / "model_catalog.json").read_text())["files"]

ALLOWED_PREFIX = "https://huggingface.co/"
PART = ".novafield-part"
CHUNK = 1 << 20

# Where a folder kind ("diffusion_models", "loras"…) lives on this server, or None if it has none.
FolderFn = Callable[[str], Optional[str]]
Opener = Callable[[urllib.request.Request], object]


class Downloads:
    """A queue of downloads worked through by one thread, so one big file isn't split across many."""

    def __init__(self, folder_of: FolderFn, opener: Optional[Opener] = None):
        self.folder_of = folder_of
        self.open = opener or (lambda req: urllib.request.urlopen(req, timeout=60))
        self.lock = threading.Lock()
        self.jobs: Dict[str, dict] = {}
        self.queue: List[str] = []
        self.worker: Optional[threading.Thread] = None

    # --- what's there -------------------------------------------------------------------------

    def target(self, name: str) -> Optional[Path]:
        entry = CATALOG.get(name)
        folder = self.folder_of(entry["folder"]) if entry else None
        return Path(folder) / name if folder else None

    def installed(self, name: str) -> bool:
        t = self.target(name)
        return bool(t and t.is_file())

    def status(self) -> dict:
        with self.lock:
            jobs = {k: dict(v) for k, v in self.jobs.items()}
        files = {}
        for name, entry in CATALOG.items():
            files[name] = {"folder": entry["folder"], "size": entry["size"], "installed": self.installed(name)}
            if name in jobs:
                files[name]["job"] = jobs[name]
        return {"files": files}

    # --- asking for files ---------------------------------------------------------------------

    def start(self, names: List[str]) -> List[str]:
        """Queue the named files that aren't there yet. Unknown names are an error, before anything starts."""
        unknown = [n for n in names if n not in CATALOG]
        if unknown:
            raise ValueError(f"Not a file NovaField downloads: {', '.join(unknown)}")
        queued = []
        with self.lock:
            for name in names:
                job = self.jobs.get(name)
                if self.installed(name) or (job and job["state"] in ("queued", "downloading")):
                    continue
                self.jobs[name] = {"state": "queued", "done": 0, "total": CATALOG[name]["size"]}
                self.queue.append(name)
                queued.append(name)
            if queued and not (self.worker and self.worker.is_alive()):
                self.worker = threading.Thread(target=self._run, name="novafield-models", daemon=True)
                self.worker.start()
        return queued

    def cancel(self, name: str) -> bool:
        with self.lock:
            job = self.jobs.get(name)
            if not job or job["state"] not in ("queued", "downloading"):
                return False
            if name in self.queue:
                self.queue.remove(name)
            job["state"] = "cancelled"
        return True

    # --- the work -----------------------------------------------------------------------------

    def _run(self):
        while True:
            with self.lock:
                if not self.queue:
                    return
                name = self.queue.pop(0)
                self.jobs[name]["state"] = "downloading"
            try:
                self._download(name)
            except Exception as e:  # noqa: BLE001 - reported to the app as it is
                with self.lock:
                    if self.jobs[name]["state"] != "cancelled":
                        self.jobs[name].update(state="failed", error=str(e)[:300])

    def _cancelled(self, name: str) -> bool:
        with self.lock:
            return self.jobs[name]["state"] == "cancelled"

    def _download(self, name: str):
        entry = CATALOG[name]
        url = entry["url"]
        if not url.startswith(ALLOWED_PREFIX):
            raise ValueError("Only Hugging Face links are downloaded.")
        target = self.target(name)
        if target is None:
            raise RuntimeError(f"This ComfyUI has no '{entry['folder']}' model folder. Update ComfyUI and try again.")
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_name(target.name + PART)
        have = part.stat().st_size if part.exists() else 0
        free = shutil.disk_usage(target.parent).free
        if entry["size"] - have > free:
            raise RuntimeError(f"Not enough disk space: {name} needs {(entry['size'] - have) / 1e9:.1f} GB, {free / 1e9:.1f} GB free.")

        # Carry on from a part left by an earlier try.
        req = urllib.request.Request(url, headers={"User-Agent": "ComfyUI-NovaField", **({"Range": f"bytes={have}-"} if have else {})})
        res = self.open(req)
        status = getattr(res, "status", 200)
        if have and status != 206:
            have = 0  # the server sent the whole file: start over
        with self.lock:
            self.jobs[name]["done"] = have
        with open(part, "ab" if have else "wb") as out:
            while True:
                if self._cancelled(name):
                    break
                chunk = res.read(CHUNK)
                if not chunk:
                    break
                out.write(chunk)
                with self.lock:
                    self.jobs[name]["done"] += len(chunk)
        close = getattr(res, "close", None)
        if close:
            close()

        if self._cancelled(name):
            part.unlink(missing_ok=True)
            return
        got = part.stat().st_size
        if got != entry["size"]:
            # A short read: keep the part, so trying again carries on from here.
            raise RuntimeError(f"The download stopped at {got / 1e9:.2f} of {entry['size'] / 1e9:.2f} GB. Try again to carry on.")
        os.replace(part, target)
        with self.lock:
            self.jobs[name]["state"] = "done"
