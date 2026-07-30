import { expect, test } from "@playwright/test";

test("題材を入力し、静的フォールバックでサイトを生成できる", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("紹介サイトの題材").fill("学校の写真部");
  await page.getByRole("button", { name: "たたき台を生成" }).click();
  await expect(page.getByRole("heading", { name: "学校の写真部", exact: true })).toBeVisible();
  await expect(page.getByText("APIを利用できないため、静的サンプルを生成しました。")).toBeVisible();
});

test("プレビュー内の要素をクリックすると選択状態になり解説が表示される", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("紹介サイトの題材").fill("スミレ即売会");
  await page.getByRole("button", { name: "たたき台を生成" }).click();
  await expect(page.getByRole("heading", { name: "スミレ即売会", exact: true })).toBeVisible();

  const frame = page.frameLocator("iframe[title='生成サイトのプレビュー']");
  await frame.locator("[data-builder-id='about']").click();

  await expect(page.getByText("選択中: 私たちについて", { exact: true })).toBeVisible();
  await expect(page.getByText("なぜこのコード？")).toBeVisible();
});

test("画像のaltを入力すると品質チェックが失敗から成功に切り替わる", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("紹介サイトの題材").fill("スミレ即売会");
  await page.getByRole("button", { name: "たたき台を生成" }).click();
  await expect(page.getByRole("heading", { name: "スミレ即売会", exact: true })).toBeVisible();

  await expect(page.getByText(/の画像説明が空です。/)).toBeVisible();

  const frame = page.frameLocator("iframe[title='生成サイトのプレビュー']");
  await frame.locator("[data-builder-id='hero']").click();
  await page.getByLabel("画像の説明（alt）").fill("スミレの鉢植えが並ぶ即売会の様子");

  await expect(page.getByText("表示中の画像に代替テキストがあります。")).toBeVisible();
});

test("提出物ZIPをダウンロードできる", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("紹介サイトの題材").fill("スミレ即売会");
  await page.getByRole("button", { name: "たたき台を生成" }).click();
  await expect(page.getByRole("heading", { name: "スミレ即売会", exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "提出物ZIP" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/-site\.zip$/);
});

test("Clerk未設定時はプロジェクト保存を実行できない", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("保存にはClerk設定が必要です")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
});
