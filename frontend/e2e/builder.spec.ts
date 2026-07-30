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

// レビュー指摘の再現ケース。
// 未記録のデザイン変更が残ったまま内容変更を記録すると理由欄だけが空になるため、
// そのあと別の理由でデザイン変更を記録すると、以前のデザイン変更に無関係な理由が
// 紐づいてしまう恐れがあった。デザイン変更は変更時点の理由を保持する。
test("内容変更の記録をはさんでも、デザイン変更には変更時の理由が紐づく", async ({ page }) => {
  await page.goto("/");

  // 1. デザイン変更の理由を入力して、メインカラーを変更する（まだ記録しない）。
  await page.getByLabel("なぜこの変更をしますか？").fill("見出しを目立たせたいから");
  await page.getByLabel("メインカラー").fill("#e11d48");

  // 2. 記録しないまま、別の理由で内容変更を記録する。ここで理由欄が空になる。
  await page.getByLabel("なぜこの変更をしますか？").fill("紹介文を分かりやすくしたいから");
  await page.getByRole("button", { name: "内容変更の理由を記録" }).click();
  await expect(page.getByText("内容変更の理由を学習メモへ記録しました。")).toBeVisible();
  await expect(page.getByLabel("なぜこの変更をしますか？")).toHaveValue("");

  // 3. さらに別の理由を入力してデザイン変更を記録する。
  await page.getByLabel("なぜこの変更をしますか？").fill("余白を広げて読みやすくしたいから");
  await page.getByRole("button", { name: "デザイン変更の理由を記録" }).click();
  await expect(page.getByText("デザイン変更の内容と理由を学習メモへ記録しました。")).toBeVisible();

  // メインカラーの変更には、手順1で入力した理由が紐づいていること。
  const colorNote = page.locator("div").filter({ hasText: /^デザイン変更（メインカラーを #e11d48 に）/ }).last();
  await expect(colorNote).toContainText("見出しを目立たせたいから");
  // 手順3で入力した理由が、手順1のデザイン変更へ紐づいていないこと。
  await expect(colorNote).not.toContainText("余白を広げて読みやすくしたいから");
});

test("同じ理由でまとめて変更した項目は1件のメモに残る", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("なぜこの変更をしますか？").fill("落ち着いた印象にしたいから");
  // サンプルの初期値と異なる値にする（同じ値だと change イベントが発火しない）。
  await page.getByLabel("メインカラー").fill("#334155");
  await page.getByLabel("背景色").fill("#e2e8f0");

  await page.getByRole("button", { name: "デザイン変更の理由を記録" }).click();

  // 2項目が1件のメモへまとめられる。
  await expect(
    page.getByText("デザイン変更（メインカラーを #334155 に / 背景色を #e2e8f0 に）"),
  ).toBeVisible();
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

test("Clerk未設定時はプロジェクト保存を実行できない", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("保存にはClerk設定が必要です")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
});
