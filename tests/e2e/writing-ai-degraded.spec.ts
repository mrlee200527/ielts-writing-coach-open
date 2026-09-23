import { expect, test } from "@playwright/test";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("a failed autosave does not block editing and a later edit recovers", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Task image").setInputFiles({ name: "task.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Start writing" }).click();
  await expect(page).toHaveURL(/\/write\//);
  let failed = false;
  await page.route("**/draft", async (route) => { if (!failed) { failed = true; await route.fulfill({ status: 503, body: JSON.stringify({ error: "STORAGE_UNAVAILABLE" }) }); } else await route.continue(); });
  const editor = page.getByTestId("essay-editor"); await editor.fill("First unsaved text.");
  await expect(page.getByTestId("save-status")).toContainText("保存失败", { timeout: 5000 });
  await editor.fill("Recovered saved text.");
  await expect(page.getByTestId("save-status")).toContainText("已保存", { timeout: 5000 });
  await page.reload(); await expect(editor).toHaveText("Recovered saved text.");
});
