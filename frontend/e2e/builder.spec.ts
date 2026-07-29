import { expect, test } from "@playwright/test";

test("題材を入力し、静的フォールバックでサイトを生成できる", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("紹介サイトの題材").fill("学校の写真部");
  await page.getByRole("button", { name: "たたき台を生成" }).click();
  await expect(page.getByRole("heading", { name: "学校の写真部", exact: true })).toBeVisible();
  await expect(page.getByText("APIを利用できないため、静的サンプルを生成しました。")).toBeVisible();
});

test("リセットすると未記録のテーマ変更と理由を破棄する", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("なぜこの変更をしますか？").fill("明るい印象にしたいから");
  await page.getByLabel("メインカラー").fill("#e11d48");

  await page.getByRole("button", { name: "リセット" }).click();

  await expect(page.getByLabel("なぜこの変更をしますか？")).toHaveValue("");
  // 変更履歴も破棄されているので、記録しようとしても「変更がない」と案内される。
  await page.getByLabel("なぜこの変更をしますか？").fill("別の変更を記録したいから");
  await page.getByRole("button", { name: "デザイン変更の理由を記録" }).click();
  await expect(page.getByText("先に色・余白・フォントを変更してください。")).toBeVisible();
});

test("サイトを再生成すると未記録のテーマ変更と理由を破棄する", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("なぜこの変更をしますか？").fill("明るい印象にしたいから");
  await page.getByLabel("メインカラー").fill("#e11d48");

  await page.getByLabel("紹介サイトの題材").fill("学校の写真部");
  await page.getByRole("button", { name: "たたき台を生成" }).click();
  await expect(page.getByText("APIを利用できないため、静的サンプルを生成しました。")).toBeVisible();

  await expect(page.getByLabel("なぜこの変更をしますか？")).toHaveValue("");
  // 生成後のサイトに対しては未変更なので、初期値が変更として記録されることはない。
  await page.getByLabel("なぜこの変更をしますか？").fill("別の変更を記録したいから");
  await page.getByRole("button", { name: "デザイン変更の理由を記録" }).click();
  await expect(page.getByText("先に色・余白・フォントを変更してください。")).toBeVisible();
});
