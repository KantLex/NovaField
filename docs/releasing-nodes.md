# Releasing the ComfyUI node pack

The pack lives in `comfyui-novafield/` in this repo. ComfyUI installs packs from a repo whose
root *is* the pack, so each release is copied into a standalone repo, and that repo publishes
to the Comfy Registry.

```
NovaField (this repo)                      ComfyUI-NovaField (standalone)        Comfy Registry
comfyui-novafield/  ── tag nodes-vX.Y.Z ──▶ main + tag vX.Y.Z  ── pyproject ──▶ comfyui-novafield
                     (release-nodes.yml)                          (publish.yml)
```

## One-time setup

1. **Create the standalone repo** on GitHub, e.g. `KantLex/ComfyUI-NovaField` (public, empty).
   If you use another name, update `Repository` in `comfyui-novafield/pyproject.toml` and
   `NOVAFIELD_NODES_REPO` (see `.env.example`).
2. **Let this repo push to it:** create a fine-grained token with *Contents: read and write* on the
   standalone repo. In this repo's settings, add it as the secret `NODES_REPO_TOKEN` and add a
   variable `NODES_REPO` = `KantLex/ComfyUI-NovaField`.
3. **Claim a publisher** on [registry.comfy.org](https://registry.comfy.org). The pack's
   `pyproject.toml` uses the publisher id `novafield`; change `PublisherId` there (and
   `NOVAFIELD_NODES_PUBLISHER`) if yours differs. Create a publishing API key and add it to the
   **standalone** repo's secrets as `REGISTRY_ACCESS_TOKEN`.
4. **Check the license.** The pack ships with MIT (`comfyui-novafield/LICENSE`); change it before
   the first release if you want something else.

## Each release

1. Make the changes in `comfyui-novafield/` and bump `version` in its `pyproject.toml`.
2. Commit, then tag and push:

   ```bash
   git tag nodes-v0.2.0
   ```

   ```bash
   git push origin nodes-v0.2.0
   ```

3. `release-nodes.yml` runs the pack's tests, copies it into the standalone repo and tags it
   `v0.2.0`. The standalone repo's `publish.yml` sees the new version and publishes it to the
   Registry. Within a few minutes, ComfyUI Manager (and NovaField's **Install NovaField nodes**
   button) can install it.

No GitHub Actions? `scripts/release-nodes.sh <standalone repo git URL>` does the copy, commit and
tag locally, and asks before it pushes.

## How NovaField picks the install source

The **Install NovaField nodes** button installs from the Comfy Registry when `comfyui-novafield`
exists there *and* belongs to your publisher id. Registry ids are first come, first served, so a
pack with that name from someone else is never installed. Otherwise it falls back to the
standalone GitHub repo. If neither is published yet, the app shows manual steps instead.
