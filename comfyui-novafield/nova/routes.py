"""HTTP routes the NovaField app calls on this ComfyUI server (registered when ComfyUI loads the pack).

    GET  /novafield/models           every file NovaField can download: folder, size, installed, progress
    POST /novafield/models/download  {"files": [names]}: queue the ones not there yet
    POST /novafield/models/cancel    {"file": name}: stop it and drop what was downloaded

Bodies must be JSON, so a web page elsewhere can't start a download with a plain form.
"""

from __future__ import annotations

from .models import Downloads

VERSION = "0.5.1"


def register():
    from aiohttp import web  # type: ignore
    import folder_paths  # type: ignore
    from server import PromptServer  # type: ignore

    def folder_of(kind: str):
        if kind not in folder_paths.folder_names_and_paths:
            return None
        paths = folder_paths.get_folder_paths(kind)
        return paths[0] if paths else None

    downloads = Downloads(folder_of)
    routes = PromptServer.instance.routes

    async def body(request):
        if request.content_type != "application/json":
            raise web.HTTPUnsupportedMediaType(text="Send JSON.")
        try:
            return await request.json()
        except Exception:
            raise web.HTTPBadRequest(text="Send JSON.")

    @routes.get("/novafield/models")
    async def models(_request):
        return web.json_response({"version": VERSION, **downloads.status()})

    @routes.post("/novafield/models/download")
    async def download(request):
        data = await body(request)
        files = data.get("files")
        if not isinstance(files, list) or not all(isinstance(f, str) for f in files):
            return web.json_response({"error": "files: a list of file names"}, status=400)
        try:
            return web.json_response({"queued": downloads.start(files)})
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)

    @routes.post("/novafield/models/cancel")
    async def cancel(request):
        data = await body(request)
        return web.json_response({"cancelled": downloads.cancel(str(data.get("file", "")))})
