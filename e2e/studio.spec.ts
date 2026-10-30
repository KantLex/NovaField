// Import a workflow, pick it as the Studio's model, write a prompt, press Create, and find the
// finished picture in the Library.

import { expect, test } from "@playwright/test";
import { TINY_WORKFLOW } from "../src/test/fakeComfy";

const COMFY = "http://127.0.0.1:8199";

test("a take made in the Studio lands in the Library", async ({ page, request }) => {
  // The header reads ComfyUI's status off the live feed.
  await page.goto("/workflows");
  await expect(page.getByText("Fake GPU")).toBeVisible();

  // Bring the workflow in as a file, as from the drop zone.
  await page.locator("input[type=file][accept*='json']").setInputFiles({ name: "Blank studio.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(TINY_WORKFLOW)) });
  await expect(page.getByText("Blank studio").first()).toBeVisible();

  // Pick it as the Studio's model. The check for the model picked before it (which this server
  // can't run) has answered; the check for the new one answers slowly, as on a busy machine, so
  // Create is pressed while the old answer is still on screen.
  let slow = false;
  await page.route("**/api/preflight", async (route) => {
    if (slow) await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });
  const checked = page.waitForResponse("**/api/preflight");
  await page.goto("/");
  await checked;
  const model = page.getByLabel("Model", { exact: true });
  const option = model.locator("option", { hasText: "Blank studio" });
  await expect(option).toHaveCount(1);
  slow = true;
  await model.selectOption((await option.getAttribute("value"))!);

  await page.getByLabel("Script for this shot").fill("a lighthouse at dusk");
  await page.getByRole("button", { name: /^Create/ }).click();

  // ComfyUI got the workflow with the prompt in it.
  await expect.poll(async () => JSON.stringify(await (await request.get(`${COMFY}/_prompts`)).json())).toContain("a lighthouse at dusk");

  // The finished picture is in the Library, and it loads.
  await page.goto("/library");
  const take = page.locator("[data-take]").first();
  await expect(take).toBeVisible();
  const img = take.locator("img[src*='/api/files/media/']").first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1);
});
