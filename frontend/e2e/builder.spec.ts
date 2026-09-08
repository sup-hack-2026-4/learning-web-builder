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
test("理由を書かずに変更でき、あとから説明して記録できる", async ({ page }) => {
  await page.goto("/");

  // 先に変える。見た目の違いを確かめてからでないと、どう良くなったかは書けない。
  await page.getByLabel("メインカラー").fill("#e11d48");
  await expect(page.getByText("先に『なぜ変えるか』を入力してください。")).toBeHidden();

  // 変えたあとで説明を書いて記録する。
  await page.getByLabel("なぜこの変更をしますか？").fill("見出しを赤にした。目立たせて読み始めてもらいたいから");
  await page.getByRole("button", { name: "デザイン変更の理由を記録" }).click();
  await expect(page.getByText("デザイン変更の内容と理由を学習メモへ記録しました。")).toBeVisible();

  // メモの見出しでたどる。汎用のdivで拾うと、囲みを1つ足すだけで壊れる。
  const colorNote = page.getByTestId("learning-note").filter({ hasText: "デザイン変更（メインカラーを #e11d48 に）" }).last();
  await expect(colorNote).toContainText("見出しを赤にした。目立たせて読み始めてもらいたいから");
});

test("説明していない変更が複数あると、まとめて1件として記録される", async ({ page }) => {
  await page.goto("/");

  // 説明を書かないまま、続けて2つ変える。
  await page.getByLabel("メインカラー").fill("#e11d48");
  await page.getByLabel(/^余白/).fill("9");

  await page.getByLabel("なぜこの変更をしますか？").fill("色と余白を変えた。全体を明るくして読みやすくしたいから");
  await page.getByRole("button", { name: "デザイン変更の理由を記録" }).click();

  // 2つの変更が1件のメモにまとまること。
  const note = page.getByTestId("learning-note").filter({ hasText: "デザイン変更（" }).last();
  await expect(note).toContainText("メインカラーを #e11d48 に");
  await expect(note).toContainText("余白を 9 に");
  await expect(note).toContainText("色と余白を変えた。全体を明るくして読みやすくしたいから");
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
  // 選択中タブの見た目も消えないこと（aria属性だけでなく見た目でも選択が分かる）。
  const explanationTab = page.getByRole("tab", { name: "解説", exact: true });
  const [activeStyle, inactiveStyle] = await Promise.all([
    designTab.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.color, style.backgroundColor, style.boxShadow].join("|");
    }),
    explanationTab.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.color, style.backgroundColor, style.boxShadow].join("|");
    }),
  ]);
  expect(activeStyle).not.toBe(inactiveStyle);
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
  await expect(designTab).toHaveAttribute("aria-selected", "true");
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

test("内側タブは左右キーでフォーカスと選択が循環移動する", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const tabList = page.getByRole("tablist", { name: "調整と学習" });
  await expect(tabList.locator(":scope > :not([role='tab'])")).toHaveCount(0);
  const designTab = page.getByRole("tab", { name: "調整", exact: true });
  const explanationTab = page.getByRole("tab", { name: "解説", exact: true });
  const qualityTab = page.getByRole("tab", { name: "品質", exact: true });

  // 選択中だけがタブ順に含まれる。
  await expect(designTab).toHaveAttribute("tabindex", "0");
  await expect(explanationTab).toHaveAttribute("tabindex", "-1");

  // ここではタブ列の中の移動だけを検証する。
  // ページ全体のTab順はプレビューiframeの中身も含むため、別の関心事として切り離す。
  await designTab.focus();
  // タブ列は横並びのため、左右キーで移動する。
  await page.keyboard.press("ArrowRight");
  await expect(explanationTab).toBeFocused();
  await expect(explanationTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("なぜこのコード？")).toBeVisible();

  // 末尾から先頭へ循環する。
  await page.keyboard.press("ArrowRight");
  await expect(qualityTab).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(designTab).toBeFocused();

  // 逆方向にも動き、Home/Endも効く。
  await page.keyboard.press("ArrowLeft");
  await expect(qualityTab).toBeFocused();
  await page.keyboard.press("Home");
  await expect(designTab).toBeFocused();
  await page.keyboard.press("End");
  await expect(qualityTab).toBeFocused();
});

test("モバイル下部タブは左右キーでフォーカスと選択が循環移動する", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const previewTab = page.getByRole("tab", { name: "プレビュー" });
  const setupTab = page.getByRole("tab", { name: "題材・メモ" });
  const panelTab = page.getByRole("tab", { name: "調整と学習" });

  await expect(previewTab).toHaveAttribute("tabindex", "0");
  await expect(setupTab).toHaveAttribute("tabindex", "-1");

  await previewTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(setupTab).toBeFocused();
  await expect(setupTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("紹介サイトの題材")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(panelTab).toBeFocused();
  // 末尾から先頭へ循環する。
  await page.keyboard.press("ArrowRight");
  await expect(previewTab).toBeFocused();
  // 左方向にも動く。
  await page.keyboard.press("ArrowLeft");
  await expect(panelTab).toBeFocused();
});

// レビュー指摘の再現ケース。
// タブUIの都合でプレビューiframeをtabIndex={-1}にしたことがあり、
// 生成サイト内のロゴリンクとセクション(tabindex=0)へキーボードで到達できなくなっていた。
test("プレビュー内の要素へキーボードで到達できる", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const preview = page.locator("iframe[title='生成サイトのプレビュー']");
  await expect(preview).not.toHaveAttribute("tabindex", "-1");

  // iframe内へフォーカスを入れ、Tabでロゴ→各セクションへ進めること。
  const frame = page.frameLocator("iframe[title='生成サイトのプレビュー']");
  await frame.locator(".logo").focus();
  await expect(frame.locator(".logo")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(frame.locator("[data-builder-id='hero']")).toBeFocused();
});

// 「理由を書くときに、目の前にコードがある」状態を作るための表示。
// プレビューとコードを同時に見せ、選んだ要素がコードのどこかを示す。
test("プレビューの下に生成コードが並び、選んだ要素の行が示される", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const codeView = page.getByRole("region", { name: "生成されたコード" });
  await expect(codeView).toBeVisible();
  // プレビューを隠さずに、同時に見えていること。
  await expect(page.locator("iframe[title='生成サイトのプレビュー']")).toBeVisible();

  // 初期表示はindex.html。提出物ZIPと同じファイル名で示す。
  await expect(codeView.getByRole("tab", { name: "index.html" })).toHaveAttribute("aria-selected", "true");
  await expect(codeView).toContainText("<!doctype html>");

  const frame = page.frameLocator("iframe[title='生成サイトのプレビュー']");
  await frame.locator("[data-builder-id='about']").click();

  await expect(codeView).toContainText("選んだ要素: 私たちについて");
  const selectedLines = codeView.locator("li[data-selected='true']");
  // 選んだセクションを書いている行だけが示される。
  await expect(selectedLines.filter({ hasText: "私たちについて" })).toHaveCount(1);
  await expect(selectedLines.filter({ hasText: "3つの魅力" })).toHaveCount(0);
});

test("CSSタブでは、選んだ要素に効いているルールが示される", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const frame = page.frameLocator("iframe[title='生成サイトのプレビュー']");
  await frame.locator("[data-builder-id='hero']").click();

  const codeView = page.getByRole("region", { name: "生成されたコード" });
  await codeView.getByRole("tab", { name: "style.css" }).click();

  const selectedLines = codeView.locator("li[data-selected='true']");
  // ヒーローはh1と.section-heroの両方で装飾されている。
  // .section-heroは通常時と@media内の2か所にあり、どちらもヒーローに効いている。
  await expect(selectedLines.filter({ hasText: ".section-hero {" })).toHaveCount(2);
  await expect(selectedLines.filter({ hasText: "h1 {" })).toHaveCount(1);
  // 他のセクションだけに効くルールは対象外。
  await expect(selectedLines.filter({ hasText: "h2 {" })).toHaveCount(0);
});

// 「なぜ変えるか」を書く場面で、自分の操作がコードのどこを動かしたかを見せる。
test("デザインを変えると、コード上に未記録の変更として示される", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const codeView = page.getByRole("region", { name: "生成されたコード" });
  await codeView.getByRole("tab", { name: "style.css" }).click();
  await expect(codeView.locator("li[data-changed='true']")).toHaveCount(0);

  await page.getByLabel("なぜこの変更をしますか？").fill("元気な印象にしたいから");
  await page.getByLabel("メインカラー").fill("#e11d48");

  const changedLines = codeView.locator("li[data-changed='true']");
  await expect(changedLines.filter({ hasText: "--primary:" })).toHaveCount(1);
  await expect(changedLines.filter({ hasText: "#e11d48" }).first()).toBeVisible();
  await expect(codeView).toContainText("未記録の変更");

  // 理由を記録すると、そこが新しい基準になり「未記録」ではなくなる。
  await page.getByRole("button", { name: "デザイン変更の理由を記録" }).click();
  await expect(codeView.locator("li[data-changed='true']")).toHaveCount(0);
  await expect(codeView).not.toContainText("未記録の変更");
});

test("コードを隠すとプレビューが縦に広がる", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const codeView = page.getByRole("region", { name: "生成されたコード" });
  const preview = page.locator("iframe[title='生成サイトのプレビュー']");
  const initialPreviewHeight = (await preview.boundingBox())!.height;

  await page.getByRole("button", { name: "コードを隠す" }).click();
  await expect(codeView).toBeHidden();
  expect((await preview.boundingBox())!.height).toBeGreaterThan(initialPreviewHeight);

  await page.getByRole("button", { name: "コードを見る" }).click();
  await expect(codeView).toBeVisible();
});

test("プレビューとコードの高さを境目で調整できる", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const codeView = page.getByRole("region", { name: "生成されたコード" });
  const heightOf = async () => (await codeView.boundingBox())!.height;
  const initial = await heightOf();

  // ドラッグできない環境でも変えられるよう、キーボードでも操作できる。
  await page.getByRole("separator", { name: "プレビューとコードの高さを調整" }).focus();
  await page.keyboard.press("ArrowUp");
  expect(await heightOf()).toBeGreaterThan(initial);

  await page.keyboard.press("ArrowDown");
  expect(await heightOf()).toBeCloseTo(initial, 0);
});

test("モバイルのプレビュー画面でもコードを一緒に見られる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator("iframe[title='生成サイトのプレビュー']")).toBeVisible();
  await expect(page.getByRole("region", { name: "生成されたコード" })).toBeVisible();
});

// 「理由を書けた＝理解できている」とは限らないという指摘への対応。
// 何を・なぜ・どう良くなるかの3点を、書いている最中に示す。
test("理由を書くと、書けている観点がその場で示される", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const aspects = page.getByRole("list", { name: "理由の書けている観点" });
  // 空欄のうちは、3つとも書き足しかたの案内が出ている。
  await expect(aspects).toContainText("色・余白・見出しなど、変えた部分の名前を入れましょう。");
  await expect(aspects).toContainText("「〜だから」「〜のため」と、根拠まで書きましょう。");

  // 変えた部分だけを書くと、その観点だけが満たされる。
  await page.getByLabel("なぜこの変更をしますか？").fill("見出しの色を変えた");
  await expect(aspects).not.toContainText("色・余白・見出しなど、変えた部分の名前を入れましょう。");
  await expect(aspects).toContainText("「〜だから」「〜のため」と、根拠まで書きましょう。");

  // 根拠と効果まで書くと3つそろう。
  await page.getByLabel("なぜこの変更をしますか？").fill("見出しの色を濃くした。背景との差が小さいと読みにくいから");
  await expect(page.getByText("3つそろいました。記録すると、変わったコードも一緒に残ります。")).toBeVisible();
});

test("理由を記録すると、そのとき変わったコードが学習メモに残る", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.getByLabel("なぜこの変更をしますか？").fill("余白を広げた。文章のまとまりが見やすくなるから");
  // サンプルの初期値(6)と違う値にする。
  await page.getByLabel(/^余白/).fill("9");
  await page.getByRole("button", { name: "デザイン変更の理由を記録" }).click();

  // メモには理由と、実際に変わったCSSの行が並ぶ。
  const note = page.getByTestId("learning-note").filter({ hasText: "デザイン変更（余白を 9 に）" }).last();
  await expect(note).toContainText("文章のまとまりが見やすくなるから");
  await expect(note).toContainText("--space: 36px;");
});

test("観点が足りない理由でも記録でき、次に書く観点を案内する", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // 変えた部分は書いているが、根拠と効果がない理由。
  await page.getByLabel("なぜこの変更をしますか？").fill("メインカラーを赤にした");
  await page.getByLabel("メインカラー").fill("#e11d48");
  await page.getByRole("button", { name: "デザイン変更の理由を記録" }).click();

  // 記録は止めない。そのうえで、書けていない観点を示す。
  await expect(page.getByText("デザイン変更の内容と理由を学習メモへ記録しました。")).toBeVisible();
  await expect(page.getByText(/次は「なぜ変えるか」「どう良くなるか」も書けると/)).toBeVisible();
});

test("セクションを非表示にすると、消えたコードが学習メモに残る", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.getByLabel("なぜこの変更をしますか？").fill("3つの魅力を隠した。先に全体像を伝えたいから。読み手が迷わなくなる");
  await page.getByRole("checkbox", { name: "3つの魅力" }).uncheck();

  // 削除しか起きていなくても、消えた行が「-」付きで残る。
  const note = page.getByTestId("learning-note").filter({ hasText: "表示切替（3つの魅力）" }).last();
  await expect(note).toContainText("先に全体像を伝えたいから");
  await expect(note).toContainText("- <h2>3つの魅力</h2>");
});

test("未記録の変更が残っていても、別のセクションのメモには混ざらない", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // 1. ヒーローの見出しを、理由を書かずに書き換えておく（未記録のまま残す）。
  const frame = page.frameLocator("iframe[title='生成サイトのプレビュー']");
  await frame.locator("[data-builder-id='hero']").click();
  await page.getByLabel("見出し", { exact: true }).fill("未記録のままにする見出し");

  // 2. 別のセクションを選び、そちらだけ理由を書いて記録する。
  await frame.locator("[data-builder-id='about']").click();
  await page.getByLabel("見出し", { exact: true }).fill("記録するほうの見出し");
  await page.getByLabel("なぜこの変更をしますか？").fill("見出しを具体的にした。内容が伝わるようにしたいから。読み手が迷わなくなる");
  await page.getByRole("button", { name: "内容変更の理由を記録" }).click();

  // 記録したセクションの変更だけがメモに入る。
  const note = page.getByTestId("learning-note").filter({ hasText: "内容変更（記録するほうの見出し）" }).last();
  await expect(note).toContainText("記録するほうの見出し");
  await expect(note).not.toContainText("未記録のままにする見出し");
});

test("変えた値を元に戻すと、デザイン変更として記録されない", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.getByLabel("なぜこの変更をしますか？").fill("余白を試しに変えた");
  const spacing = page.getByLabel(/^余白/);
  const original = await spacing.inputValue();
  await spacing.fill("9");
  await spacing.fill(original);

  await page.getByRole("button", { name: "デザイン変更の理由を記録" }).click();
  await expect(page.getByText("先に色・余白・フォントを変更してください。")).toBeVisible();
});

test("削除しか起きない変更も、コード上に消えた行として示される", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const codeView = page.getByRole("region", { name: "生成されたコード" });
  await expect(codeView).not.toContainText("未記録の変更");

  // 理由を書かずに非表示にするので、記録されず「未記録の変更」として残る。
  await page.getByRole("checkbox", { name: "3つの魅力" }).uncheck();

  // 消えた行は今のコードに無いため、消える前の位置へ差し込んで見せる。
  await expect(codeView).toContainText("未記録の変更");
  await expect(codeView).toContainText("うち削除");
  await expect(codeView.getByText("<h2>3つの魅力</h2>")).toBeVisible();
});

test("見出しの色を初期値へ戻すと、デザイン変更として記録されない", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // 見出しの色は未指定のときメインカラーを引き継ぐ。その実効値が初期値になる。
  const original = await page.getByLabel("メインカラー").inputValue();

  await page.getByLabel("なぜこの変更をしますか？").fill("見出しの色を試しに変えた");
  await page.getByLabel("見出しの色").fill("#e11d48");
  await page.getByLabel("見出しの色").fill(original);

  await page.getByRole("button", { name: "デザイン変更の理由を記録" }).click();
  await expect(page.getByText("先に色・余白・フォントを変更してください。")).toBeVisible();
});

// レビュー指摘の再現ケース。
// 見出しの色を触って初期色へ戻したとき、同じ色を明示値として残すと
// 「未指定（メインカラーを継承）」へ戻らず、以降メインカラーへ追従しなくなる。
test("見出しの色を初期値へ戻すと、メインカラーへの追従も元どおりになる", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const heading = page.getByLabel("見出しの色");
  const primary = page.getByLabel("メインカラー");
  const original = await primary.inputValue();

  // 未指定の状態では、見出しの色にメインカラーの実効値が出ている。
  await expect(heading).toHaveValue(original);

  await page.getByLabel("なぜこの変更をしますか？").fill("見出しの色を試しに変えた");
  await heading.fill("#e11d48");
  await heading.fill(original);

  // メインカラーを変えると、未指定へ戻っているので見出しの色も追従する。
  await primary.fill("#16a34a");
  await expect(heading).toHaveValue("#16a34a");

  // 追従した結果なので、記録されるのはメインカラーの変更だけ。
  await page.getByRole("button", { name: "デザイン変更の理由を記録" }).click();
  await expect(page.getByText("デザイン変更（メインカラーを #16a34a に）")).toBeVisible();
  await expect(page.getByText("見出しの色を #e11d48 に")).toHaveCount(0);
});

test("品質タブでaxeの自動チェック結果を読める", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "品質" }).click();

  // 検査はiframeでの実測なので、まず実行中の状態が出る。
  await expect(page.getByTestId("axe-loading")).toBeVisible();

  // 既定のサンプルは画像の説明が空のため、指摘が並ぶ。
  const findings = page.getByTestId("axe-findings");
  await expect(findings).toBeVisible({ timeout: 20000 });
  await expect(findings.getByText("画像として扱っている要素に説明がありません。")).toBeVisible();
  await expect(findings.getByText(/影響: /).first()).toBeVisible();
});

test("altを埋めるとaxeの指摘が減る", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "品質" }).click();
  const findings = page.getByTestId("axe-findings");
  await expect(findings).toBeVisible({ timeout: 20000 });
  await expect(findings.getByText("画像として扱っている要素に説明がありません。")).toBeVisible();

  // 既定のサンプルで説明が空なのはヒーローだけなので、そこを埋めれば指摘は消える。
  await page.getByRole("tab", { name: "調整", exact: true }).click();
  const frame = page.frameLocator("iframe[title='生成サイトのプレビュー']");
  await frame.locator("[data-builder-id='hero']").click();
  await page.getByLabel("画像の説明（alt）").fill("植物園の入口に並ぶ鉢植えの写真");

  await page.getByRole("tab", { name: "品質" }).click();
  await expect(page.getByText("画像として扱っている要素に説明がありません。")).toHaveCount(0, { timeout: 20000 });
});

test("セクションを追加すると、増えたコードと理由が学習メモに残る", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.getByLabel("追加するセクション").selectOption("gallery");
  await page.getByRole("button", { name: "追加" }).click();

  // 末尾に入り、プレビューにも出る。
  await expect(page.getByRole("checkbox", { name: "写真・作品" })).toBeVisible();

  // 追加しただけでは未説明の変更として残る。
  await expect(page.getByText("未説明1件")).toBeVisible();

  await page.getByLabel("なぜこの変更をしますか？").fill("写真の節を足した。文章だけだと様子が伝わらないから。見た人が雰囲気をつかめる");
  await page.getByRole("button", { name: "セクション構成の理由を記録" }).click();

  const note = page.getByTestId("learning-note").filter({ hasText: "セクション追加（写真・作品）" }).last();
  await expect(note).toContainText("見た人が雰囲気をつかめる");
  await expect(note).toContainText("+ <h2>写真・作品</h2>");
  await expect(page.getByText("未説明1件")).toBeHidden();
});

test("削除は確認を挟み、まず非表示にする道を示す", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.getByRole("button", { name: "3つの魅力を削除" }).click();
  await expect(page.getByText("削除すると元に戻せません。")).toBeVisible();

  // 引き返せる。非表示にするだけならセクションは残る。
  await page.getByRole("button", { name: "まず非表示にする" }).click();
  await expect(page.getByRole("checkbox", { name: "3つの魅力" })).not.toBeChecked();

  // あらためて削除すると、一覧から消える。
  await page.getByRole("button", { name: "3つの魅力を削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByRole("checkbox", { name: "3つの魅力" })).toBeHidden();

  await page.getByLabel("なぜこの変更をしますか？").fill("魅力の節を削った。伝えたいことを絞りたいから。読み手が迷わなくなる");
  await page.getByRole("button", { name: "セクション構成の理由を記録" }).click();

  const note = page.getByTestId("learning-note").filter({ hasText: "セクション削除（3つの魅力）" }).last();
  await expect(note).toContainText("読み手が迷わなくなる");
  await expect(note).toContainText("- <h2>3つの魅力</h2>");
});

test("上限と下限に達すると、追加も削除もできなくなる", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const addButton = page.getByRole("button", { name: "追加" });
  // 初期サンプルは4件。8件になるまで足す。
  for (let index = 0; index < 4; index += 1) await addButton.click();

  await expect(page.getByText("セクションは8件までです。")).toBeVisible();
  await expect(addButton).toBeDisabled();

  // 2件になるまで削ると、今度は削除できなくなる。
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole("button", { name: /を削除$/ }).first().click();
    await page.getByRole("button", { name: "削除する" }).click();
  }

  await expect(page.getByRole("button", { name: /を削除$/ }).first()).toBeDisabled();
  await expect(addButton).toBeEnabled();
});

test("追加したセクションをすぐ消すと、説明すべき変更として残らない", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.getByRole("button", { name: "追加" }).click();
  await expect(page.getByText("未説明1件")).toBeVisible();

  await page.getByRole("button", { name: "写真・作品を削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();

  // 足して消したなら構成は元のまま。書くべき説明も無い。
  await expect(page.getByText(/未説明\d+件/)).toBeHidden();
  await expect(page.getByRole("button", { name: "セクション構成の理由を記録" })).toBeHidden();
});
