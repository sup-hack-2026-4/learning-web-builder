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

test("プレビュー内の要素をクリックすると選択状態になり解説が表示される", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("紹介サイトの題材").fill("スミレ即売会");
  await page.getByRole("button", { name: "たたき台を生成" }).click();
  await expect(page.getByRole("heading", { name: "スミレ即売会", exact: true })).toBeVisible();

  const frame = page.frameLocator("iframe[title='生成サイトのプレビュー']");
  await frame.locator("[data-builder-id='about']").click();

  await expect(page.getByText("選択中: 私たちについて", { exact: true })).toBeVisible();

  // 解説は「解説」タブに入っている（右カラムは常に1パネルだけ表示する）。
  await page.getByRole("tab", { name: "解説" }).click();
  await expect(page.getByText("なぜこのコード？")).toBeVisible();
});

test("画像のaltを入力すると品質チェックが失敗から成功に切り替わる", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("紹介サイトの題材").fill("スミレ即売会");
  await page.getByRole("button", { name: "たたき台を生成" }).click();
  await expect(page.getByRole("heading", { name: "スミレ即売会", exact: true })).toBeVisible();

  // 品質チェックは「品質」タブに入っている。
  await page.getByRole("tab", { name: "品質" }).click();
  await expect(page.getByText(/の画像説明が空です。/)).toBeVisible();

  // altの入力欄は「調整」タブ側にあるため、いったん戻して入力する。
  await page.getByRole("tab", { name: "調整", exact: true }).click();
  const frame = page.frameLocator("iframe[title='生成サイトのプレビュー']");
  await frame.locator("[data-builder-id='hero']").click();
  await page.getByLabel("画像の説明（alt）").fill("スミレの鉢植えが並ぶ即売会の様子");

  await page.getByRole("tab", { name: "品質" }).click();
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

test("デスクトップでは左右カラムを畳んでプレビューを広げられる", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const preview = page.locator("iframe[title='生成サイトのプレビュー']");
  const widthOf = async () => (await preview.boundingBox())!.width;
  const initial = await widthOf();

  // 右パネルを畳む → プレビューが広がる。
  await page.getByRole("button", { name: "パネルを畳んでプレビューを広げる" }).click();
  const afterRight = await widthOf();
  expect(afterRight).toBeGreaterThan(initial);

  // 左カラムも畳む → さらに広がる。
  await page.getByRole("button", { name: "題材・メモを畳んでプレビューを広げる" }).click();
  expect(await widthOf()).toBeGreaterThan(afterRight);

  // 開き直すと元の幅に戻る。
  await page.getByRole("button", { name: "題材・メモを開く" }).click();
  await page.getByRole("button", { name: "パネルを開く" }).click();
  expect(await widthOf()).toBeCloseTo(initial, 0);
});

test("デスクトップでタブを再クリックしてもパネルは畳まれない", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const designTab = page.getByRole("tab", { name: "調整", exact: true });
  await expect(designTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("なぜこの変更をしますか？")).toBeVisible();

  // 畳みは専用ボタンの役割。タブは切り替えだけを担うので、再クリックしても開いたまま。
  await designTab.click();
  await expect(page.getByText("なぜこの変更をしますか？")).toBeVisible();
  await expect(designTab).toHaveAttribute("aria-selected", "true");

  // 畳むとタブ列ごと隠れる。押しても結果が見えないタブを残さないため。
  await page.getByRole("button", { name: "パネルを畳んでプレビューを広げる" }).click();
  await expect(page.getByText("なぜこの変更をしますか？")).toBeHidden();
  await expect(designTab).toBeHidden();

  // 開き直すと、畳む前に選んでいたパネルが出る。
  await page.getByRole("button", { name: "パネルを開く" }).click();
  await expect(designTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("なぜこの変更をしますか？")).toBeVisible();
});

test("モバイルでは3つの画面を下部バーで切り替えられる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  // 初期はプレビュー。
  await expect(page.locator("iframe[title='生成サイトのプレビュー']")).toBeVisible();
  await expect(page.getByLabel("紹介サイトの題材")).toBeHidden();

  await page.getByRole("tab", { name: "題材・メモ" }).click();
  await expect(page.getByLabel("紹介サイトの題材")).toBeVisible();
  await expect(page.locator("iframe[title='生成サイトのプレビュー']")).toBeHidden();

  await page.getByRole("tab", { name: "調整と学習" }).click();
  await expect(page.getByText("なぜこの変更をしますか？")).toBeVisible();
  await expect(page.getByLabel("紹介サイトの題材")).toBeHidden();
});

test("モバイルで選択中タブを再クリックしても選択状態と表示が食い違わない", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("tab", { name: "調整と学習" }).click();

  const designTab = page.getByRole("tab", { name: "調整", exact: true });
  await expect(designTab).toHaveAttribute("aria-selected", "true");

  // モバイルは畳めないので、再クリックしても選択状態と中身が保たれる。
  await designTab.click();
  await expect(designTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("なぜこの変更をしますか？")).toBeVisible();
  // 選択中タブの背景も消えないこと（aria属性だけでなく見た目でも選択が分かる）。
  await expect(designTab).toHaveClass(/bg-white/);
});

// レビュー指摘の再現ケース。
// タブクリックでpanelOpenを畳んでいたころは、モバイルでの再クリックが
// デスクトップ用の折り畳み状態として残り、幅を広げた瞬間にパネルが畳まれていた。
test("モバイルでタブを再クリックしてもデスクトップ幅でパネルは畳まれない", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("tab", { name: "調整と学習" }).click();

  const designTab = page.getByRole("tab", { name: "調整", exact: true });
  await designTab.click();
  await expect(page.getByText("なぜこの変更をしますか？")).toBeVisible();

  // デスクトップ幅へ広げても、パネルは開いたまま。
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByText("なぜこの変更をしますか？")).toBeVisible();
  await expect(designTab).toHaveClass(/bg-white/);
});

test("デスクトップで畳んだ状態からモバイル幅にすると内容が見える", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.getByRole("button", { name: "パネルを畳んでプレビューを広げる" }).click();
  await expect(page.getByText("なぜこの変更をしますか？")).toBeHidden();

  // 畳んだままモバイル幅へ。中身が見える以上、タブも選択状態でなければ食い違う。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "調整と学習" }).click();
  await expect(page.getByText("なぜこの変更をしますか？")).toBeVisible();
  await expect(page.getByRole("tab", { name: "調整", exact: true })).toHaveAttribute("aria-selected", "true");
});

// レビュー指摘の再現ケース。
// 内側タブのクリックでsetPanelOpen(true)していたころは、モバイルでタブを切り替えると
// デスクトップで畳んでおいた状態が展開されてしまっていた。
test("デスクトップで畳んだ状態は、モバイルでタブを切り替えても保たれる", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // 1. デスクトップで右パネルを畳む。
  await page.getByRole("button", { name: "パネルを畳んでプレビューを広げる" }).click();
  await expect(page.getByText("なぜこの変更をしますか？")).toBeHidden();

  // 2. モバイル幅へ縮小し、3. 内側の別タブを押す。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "調整と学習" }).click();
  await page.getByRole("tab", { name: "解説", exact: true }).click();
  await expect(page.getByText("なぜこのコード？")).toBeVisible();

  // 4. デスクトップ幅へ戻すと、畳んだ状態が保たれている。
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByText("なぜこのコード？")).toBeHidden();
  await expect(page.getByRole("button", { name: "パネルを開く" })).toBeVisible();
});
