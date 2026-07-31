# 本番環境の完成確認

発表前に、Cloudflare Pages・Clerk・Render・Neonを通した縦断動作を確認するための手順です。
秘密鍵、トークン、DB接続文字列はスクリーンショットやIssueへ貼り付けません。

## 事前条件

- Cloudflare Pagesの本番URLが分かっている
- Cloudflare Pagesに`VITE_API_BASE_URL`と`VITE_CLERK_PUBLISHABLE_KEY`が設定されている
- Renderに`FRONTEND_ORIGIN`、`CLERK_SECRET_KEY`、`DATABASE_URL`、`GEMINI_API_KEY`が設定されている
- `FRONTEND_ORIGIN`はCloudflare Pagesの本番URLと完全一致している
- Neonへ`db/migrations/001_initial.sql`を適用済み

## 10分で行う縦断確認

| # | 操作 | 合格条件 | 証跡 |
|---:|---|---|---|
| 1 | Cloudflare Pagesの本番URLを開く | 画面が表示され、コンソールにCORSエラーがない | URLと画面のスクリーンショット |
| 2 | Clerkでログインする | ログイン済み表示になり、保存UIが使える | ユーザー名部分だけのスクリーンショット |
| 3 | 任意の題材でサイトを生成する | プレビューと品質チェックが表示される | 生成後の画面 |
| 4 | 「保存」を押す | 「プロジェクトを保存しました。」が表示される | 通知と保存一覧 |
| 5 | 色などを変更して「上書き保存」を押す | 「プロジェクトを更新しました。」が表示される | バージョンが増えた保存一覧 |
| 6 | ページを再読み込みして保存済み項目を選ぶ | 保存時の内容が復元される | 復元後の画面 |
| 7 | ZIPをダウンロードする | HTML、CSS、JS、README、学習メモ、品質レポートが含まれる | ZIP内のファイル一覧 |
| 8 | ログアウトする | 保存APIを利用できず、保存UIがログイン案内になる | ログアウト後の画面 |

## API側の確認

認証情報を付けない保存APIが拒否されることを確認します。

```powershell
Invoke-WebRequest `
  -Uri 'https://learning-web-builder-api.onrender.com/api/v1/projects' `
  -Method Get `
  -SkipHttpErrorCheck |
  Select-Object StatusCode
```

合格値は`401`です。`503`の場合は`DATABASE_URL`、`401`以外のCORSエラーの場合は`FRONTEND_ORIGIN`を確認します。

Renderの動作確認:

```powershell
Invoke-RestMethod `
  -Uri 'https://learning-web-builder-api.onrender.com/api/v1/health'
```

`status`が`ok`なら合格です。

## Neon側の確認

Neon SQL Editorでは、秘密情報を含まない件数とバージョンだけを確認します。

```sql
SELECT
  COUNT(*) AS project_count,
  MAX(version) AS latest_version,
  MAX(updated_at) AS last_updated_at
FROM projects;
```

新規保存後に`project_count`が増え、上書き保存後に`latest_version`が2以上なら合格です。

## 完成判定

- 8項目がすべて合格: Clerk・Neon保存を「完了」にする
- 生成とZIPは成功、ログインだけ失敗: ゲストデモは可能。Clerk設定を最優先で修正する
- Renderが不安定: 発表前に一度アクセスし、静的サンプルとオフラインZIPを待機させる
- Cloudflare Pagesが未公開: P0未完了。公開URLの確定を最優先にする
