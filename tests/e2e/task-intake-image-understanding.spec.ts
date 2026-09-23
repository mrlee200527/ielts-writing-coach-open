import { expect, test } from "@playwright/test";

test("rejects a mismatched image without creating a workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Task image").setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not-png") });
  await page.getByRole("button", { name: "Start writing" }).click();
  await expect(page.getByText("Upload failed. Please retry.")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});
