// The stand-in ComfyUI the browser tests point NovaField at (see playwright.config.ts).

import { startFakeComfy } from "../src/test/fakeComfy";

void startFakeComfy(Number(process.env.PORT ?? 8199)).then((c) => console.log(`Fake ComfyUI at ${c.url}`));
