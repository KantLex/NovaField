import io
import re
import time
import tomllib
from pathlib import Path

import pytest

from comfyui_novafield.nova import models, routes

ROOT = Path(__file__).resolve().parent.parent
FOLDERS = {"diffusion_models", "loras", "text_encoders", "vae", "clip_vision", "checkpoints", "model_patches", "frame_interpolation"}
BODY = b"0123456789"


class Response(io.BytesIO):
    def __init__(self, data, status=200):
        super().__init__(data)
        self.status = status


@pytest.fixture
def tiny(monkeypatch, tmp_path):
    """A one-entry catalog and a server that serves it, honouring Range."""
    monkeypatch.setattr(models, "CATALOG", {"tiny.safetensors": {"url": models.ALLOWED_PREFIX + "x/tiny.safetensors", "folder": "loras", "size": len(BODY)}})
    asked = []

    def opener(req):
        asked.append(req)
        rng = req.get_header("Range")
        if rng:
            start = int(re.match(r"bytes=(\d+)-", rng).group(1))
            return Response(BODY[start:], 206)
        return Response(BODY)

    d = models.Downloads(lambda kind: str(tmp_path / kind), opener)
    return d, tmp_path, asked


def wait(d, name):
    for _ in range(200):
        if d.status()["files"][name].get("job", {}).get("state") not in ("queued", "downloading"):
            return d.status()["files"][name]
        time.sleep(0.01)
    raise AssertionError("download did not finish")


def test_catalog_only_names_safe_files_from_hugging_face():
    assert len(models.CATALOG) >= 29
    for name, e in models.CATALOG.items():
        assert re.fullmatch(r"[\w.\-]+\.safetensors", name), name
        assert e["url"].startswith(models.ALLOWED_PREFIX) and e["url"].endswith("/" + name), name
        assert e["folder"] in FOLDERS, name
        assert e["size"] > 0, name


def test_route_version_matches_the_pack():
    assert routes.VERSION == tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]


def test_downloads_into_the_folder_and_reports_progress(tiny):
    d, root, _ = tiny
    assert d.status()["files"]["tiny.safetensors"]["installed"] is False
    assert d.start(["tiny.safetensors"]) == ["tiny.safetensors"]
    f = wait(d, "tiny.safetensors")
    assert f["installed"] and f["job"] == {"state": "done", "done": len(BODY), "total": len(BODY)}
    assert (root / "loras" / "tiny.safetensors").read_bytes() == BODY
    assert not list((root / "loras").glob("*" + models.PART))
    assert d.start(["tiny.safetensors"]) == []  # already there


def test_carries_on_from_a_part_left_earlier(tiny):
    d, root, asked = tiny
    (root / "loras").mkdir()
    (root / "loras" / ("tiny.safetensors" + models.PART)).write_bytes(BODY[:4])
    d.start(["tiny.safetensors"])
    assert wait(d, "tiny.safetensors")["installed"]
    assert asked[0].get_header("Range") == "bytes=4-"
    assert (root / "loras" / "tiny.safetensors").read_bytes() == BODY


def test_a_short_read_fails_and_keeps_the_part(tiny, monkeypatch):
    d, root, _ = tiny
    d.open = lambda req: Response(BODY[:6])
    d.start(["tiny.safetensors"])
    f = wait(d, "tiny.safetensors")
    assert f["job"]["state"] == "failed" and "Try again" in f["job"]["error"]
    assert (root / "loras" / ("tiny.safetensors" + models.PART)).stat().st_size == 6


def test_refuses_files_not_in_the_catalog(tiny):
    d, _, asked = tiny
    with pytest.raises(ValueError, match="Not a file NovaField downloads"):
        d.start(["tiny.safetensors", "../../evil.py"])
    assert d.status()["files"]["tiny.safetensors"].get("job") is None
    assert not asked


def test_cancel_drops_a_queued_file(tiny):
    d, root, _ = tiny
    d.jobs["tiny.safetensors"] = {"state": "queued", "done": 0, "total": len(BODY)}
    d.queue.append("tiny.safetensors")
    assert d.cancel("tiny.safetensors") is True
    assert d.queue == [] and d.jobs["tiny.safetensors"]["state"] == "cancelled"
    assert d.cancel("tiny.safetensors") is False
    # It can be asked for again.
    assert d.start(["tiny.safetensors"]) == ["tiny.safetensors"]
    assert wait(d, "tiny.safetensors")["installed"]


def test_a_file_queued_as_the_worker_stops_still_downloads(tiny):
    d, root, _ = tiny
    # The worker found the queue empty and is on its way out, but its thread hasn't ended yet.
    stopping = __import__("threading").Event()
    d.worker = __import__("threading").Thread(target=stopping.wait)
    d.worker.start()
    d.worker = None  # what _run leaves as it stops, under the lock
    try:
        assert d.start(["tiny.safetensors"]) == ["tiny.safetensors"]
        assert wait(d, "tiny.safetensors")["installed"]
    finally:
        stopping.set()
    assert d.worker is None


def test_cancel_then_download_again_does_not_revive_the_cancelled_transfer(tiny):
    d, root, asked = tiny
    first = __import__("threading").Event()
    go_on = __import__("threading").Event()

    class Slow(Response):
        def read(self, n=-1):
            first.set()
            go_on.wait(2)
            return super().read(1)  # a byte at a time, so the cancel lands mid-file

    d.open = lambda req: (asked.append(req), Slow(BODY))[1]
    d.start(["tiny.safetensors"])
    assert first.wait(2)
    old = d.jobs["tiny.safetensors"]
    d.cancel("tiny.safetensors")
    d.start(["tiny.safetensors"])  # a fresh record while the old transfer is still reading
    go_on.set()
    f = wait(d, "tiny.safetensors")
    assert old["state"] == "cancelled"
    assert f["installed"] and (root / "loras" / "tiny.safetensors").read_bytes() == BODY
    # The cancelled transfer stopped; the second one fetched the file once, from the start.
    assert len(asked) == 2 and asked[1].get_header("Range") is None


def test_a_whole_part_is_renamed_without_asking_again(tiny):
    d, root, asked = tiny
    (root / "loras").mkdir()
    (root / "loras" / ("tiny.safetensors" + models.PART)).write_bytes(BODY)
    d.start(["tiny.safetensors"])
    assert wait(d, "tiny.safetensors")["job"] == {"state": "done", "done": len(BODY), "total": len(BODY)}
    assert not asked and (root / "loras" / "tiny.safetensors").read_bytes() == BODY


def test_a_part_bigger_than_the_file_starts_over(tiny):
    d, root, asked = tiny
    (root / "loras").mkdir()
    (root / "loras" / ("tiny.safetensors" + models.PART)).write_bytes(BODY + b"extra")
    d.start(["tiny.safetensors"])
    assert wait(d, "tiny.safetensors")["installed"]
    assert asked[0].get_header("Range") is None
    assert (root / "loras" / "tiny.safetensors").read_bytes() == BODY


def test_routes_in_a_real_server(monkeypatch, tmp_path):
    """The routes as ComfyUI would serve them: aiohttp, with stand-ins for ComfyUI's own modules."""
    aiohttp = pytest.importorskip("aiohttp")
    import asyncio
    import sys
    import types

    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer

    table = web.RouteTableDef()
    monkeypatch.setitem(sys.modules, "server", types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=table))))
    monkeypatch.setitem(
        sys.modules,
        "folder_paths",
        types.SimpleNamespace(folder_names_and_paths={"loras": None}, get_folder_paths=lambda kind: [str(tmp_path / kind)]),
    )
    monkeypatch.setattr(models, "CATALOG", {"tiny.safetensors": {"url": models.ALLOWED_PREFIX + "x/tiny.safetensors", "folder": "loras", "size": len(BODY)}})
    monkeypatch.setattr(models.urllib.request, "urlopen", lambda req, timeout=60: Response(BODY))
    routes.register()
    app = web.Application()
    app.add_routes(table)

    async def run():
        async with TestClient(TestServer(app)) as c:
            listed = await (await c.get("/novafield/models")).json()
            assert listed["version"] == routes.VERSION
            assert listed["files"]["tiny.safetensors"] == {"folder": "loras", "size": len(BODY), "installed": False}
            # A plain form can't start one; an unknown file is refused.
            assert (await c.post("/novafield/models/download", data="files=tiny.safetensors")).status == 415
            assert (await c.post("/novafield/models/download", json={"files": ["../x.py"]})).status == 400
            assert (await (await c.post("/novafield/models/download", json={"files": ["tiny.safetensors"]})).json()) == {"queued": ["tiny.safetensors"]}
            for _ in range(200):
                f = (await (await c.get("/novafield/models")).json())["files"]["tiny.safetensors"]
                if f["installed"]:
                    break
                await asyncio.sleep(0.01)
            assert f["installed"] and f["job"]["state"] == "done"
            assert (await (await c.post("/novafield/models/cancel", json={"file": "tiny.safetensors"})).json()) == {"cancelled": False}

    asyncio.run(run())
    assert (tmp_path / "loras" / "tiny.safetensors").read_bytes() == BODY
