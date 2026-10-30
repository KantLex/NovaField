# Contributing to NovaField

Thanks for helping. Issues, ideas and pull requests are all welcome.

## Before you open a pull request

- Run the checks: `pnpm tsc --noEmit`, `pnpm lint` and `pnpm test`. `pnpm e2e` runs the browser test against a stand-in ComfyUI, with its own data folder and a server on port 4318 (once: `pnpm exec playwright install chromium`).
- Keep interface text in plain words, and add new strings to every language with
  `node scripts/i18n-add.mjs` (dictionaries are in `src/i18n/locales/`). `--missing` lists what a
  language lacks; the translation test fails on it too.
- The ComfyUI server can be shared with other people: never clear its queue or interrupt prompts
  NovaField didn't start.

## License of your contribution

NovaField is offered under the AGPL-3.0 and, separately, under a commercial license
(see [COMMERCIAL.md](COMMERCIAL.md)). For that to stay possible, the project needs the right to
offer your contribution under both.

By opening a pull request, you agree that:

1. Your contribution is your own work, or you have the right to submit it.
2. You license it to the project under the AGPL-3.0, **and** grant the project maintainer a
   perpetual, worldwide, royalty-free, irrevocable license to use, change, sublicense and
   distribute it under other terms as well, including the commercial license.
3. You keep the copyright in your contribution, and you can use it however you like.

Contributions to the node pack in `comfyui-novafield/` are under its MIT license only.
