"""ComfyUI-NovaField: camera-motion carriers, film looks and track masks for NovaField, and its model downloads."""

if __package__:  # imported as a package (ComfyUI custom_nodes loader, tests/_pkg.py)
    from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

    # The model download routes the app calls; only inside a running ComfyUI server.
    try:
        from server import PromptServer  # type: ignore # noqa: F401
    except Exception:
        pass
    else:
        from .nova.routes import register

        register()
else:  # imported as a bare file (e.g. pytest walking the rootdir): nothing to register
    NODE_CLASS_MAPPINGS = {}
    NODE_DISPLAY_NAME_MAPPINGS = {}

WEB_DIRECTORY = None

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
