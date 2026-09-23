import { expect, test } from "@playwright/test";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const fakeFeedback = {
  overallBand: 6.5,
  criteria: { taskAchievement: 6, coherenceCohesion: 6.5, lexicalResource: 6, grammaticalRangeAccuracy: 5.5 },
  strengths: ["Clear structure", "Good range of vocabulary"],
  improvements: ["Develop main ideas further", "Check article usage"],
  priorityImprovement: "Develop main ideas further",
};

const essayText = Array.from({ length: 20 }, () => "Technology has changed the way people communicate with each other.").join(" ");

async function openWritingWorkspace(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByLabel("Task image").setInputFiles({ name: "task.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Start writing" }).click();
  await expect(page).toHaveURL(/\/write\//);
  await page.getByTestId("essay-editor").fill(essayText);
}

test("requests one-shot feedback and renders the non-official result in the sidebar", async ({ page }) => {
  await page.route("**/api/task-intakes/*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ processingStatus: "READY", taskContextVersionId: "00000000-0000-4000-8000-000000000111" }) }));
  await page.route("**/api/essays/*/feedback", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ feedback: fakeFeedback }) }));
  await openWritingWorkspace(page);
  await expect(page.getByText(/作文字数偏少/)).not.toBeVisible();
  await page.getByRole("button", { name: "获取反馈" }).click();
  await expect(page.getByText("非官方估计，仅供练习参考")).toBeVisible();
  await expect(page.getByTestId("feedback-overall")).toContainText("6.5");
  await expect(page.getByText(/最优先改进/)).toContainText("Develop main ideas further");
  await expect(page.getByText(/优点：/)).toContainText("Clear structure");
});

test("shows a stable Chinese error when feedback generation fails", async ({ page }) => {
  await page.route("**/api/task-intakes/*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ processingStatus: "READY", taskContextVersionId: "00000000-0000-4000-8000-000000000111" }) }));
  await page.route("**/api/essays/*/feedback", (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "FEEDBACK_LLM_FAILED", message: "反馈生成失败，请稍后重试。" }) }));
  await openWritingWorkspace(page);
  await page.getByRole("button", { name: "获取反馈" }).click();
  await expect(page.getByTestId("feedback-error")).toContainText("反馈生成失败，请稍后重试。");
});
