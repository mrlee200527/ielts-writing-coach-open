import { expect, test } from "@playwright/test";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("uploads Task 1, edits, saves, and restores the latest body", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Task image").setInputFiles({ name: "task.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Start writing" }).click();
  await expect(page).toHaveURL(/\/write\//);
  await expect(page.getByTestId("task-original-image")).toBeVisible();
  const editor = page.getByTestId("essay-editor");
  await editor.fill("The chart rose sharply. Overall, the trend was positive.");
  await expect(page.getByTestId("word-count")).toContainText("9");
  await expect(page.getByTestId("save-status")).toContainText("已保存", { timeout: 5000 });
  await page.reload();
  await expect(editor).toHaveText("The chart rose sharply. Overall, the trend was positive.");
  await expect(page.getByTestId("task-original-image")).toBeVisible();
});
