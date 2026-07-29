import { expect, test } from "@playwright/test";

test("題材を入力し、静的フォールバックでサイトを生成できる", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("紹介サイトの題材").fill("学校の写真部");
  await page.getByRole("button", { name: "たたき台を生成" }).click();
  await expect(page.getByRole("heading", { name: "学校の写真部", exact: true })).toBeVisible();
  await expect(page.getByText("APIを利用できないため、静的サンプルを生成しました。")).toBeVisible();
});
