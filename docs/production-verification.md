# 本番環境の完成確認

発表前に、Cloudflare Pages・Clerk・Render・Neonを通した縦断動作を確認するための手順です。
秘密鍵、トークン、DB接続文字列はスクリーンショットやIssueへ貼り付けません。

## 2026年9月2日の確認結果

7月31日に未反映だった2設定（`VITE_API_BASE_URL`、`FRONTEND_ORIGIN`）は反映済みで、
ログインを伴わない範囲はすべて合格しています。

| 対象 | 確認内容 | 結果 |
|---|---|---|
| Cloudflare Pages | `https://learning-web-builder.pages.dev` と `https://develop.learning-web-builder.pages.dev` | どちらも200。同じビルドを配信 |
| Cloudflare Pages | 配信中のJSに焼き込まれたAPIのベースURL | `https://learning-web-builder-api.onrender.com/api/v1` |
| Cloudflare Pages | Clerk公開鍵 | 設定済み（ただし開発用キー。後述） |
| Render | `GET /api/v1/health` | 200・`status: ok` |
| Render | 認証なしの `GET /api/v1/projects` | 401（`DATABASE_URL`が設定済みであることを示す） |
| Render | 上記2つのCloudflare Originからのアクセス | どちらも許可 |
| Render | 無関係なOriginからのアクセス | 403で拒否 |
| Render | `POST /api/v1/generate` | 200・`provider: gemini`（`GEMINI_API_KEY`が有効） |
| ブラウザ | 公開URLでのコンソール | CORSエラーなし |
| ブラウザ | 題材からの生成 | 「AIでたたき台を生成しました。」を表示 |
| ブラウザ | 品質チェック | 見出し構造・画像のalt・モバイル表示がすべて合格 |

発表前に対処を検討する点:

- **Clerkが開発用キーで動いている。** コンソールに
  「Clerk has been loaded with development keys」の警告が出ます。
  開発インスタンスは利用量の制限が厳しいため、
  当日の同時ログインが多い場合は本番用インスタンスへ切り替えます。
- **Renderのコールドスタートが遅い。** 一定時間アクセスが無いと
  最初の応答に40秒以上かかりました。発表直前に一度アクセスして起こしておきます。

公開URLを別のURLへ切り替えた場合は、`FRONTEND_ORIGIN`も実際の公開URLへ合わせます。

## 事前条件

- Cloudflare Pagesの本番URLが分かっている
- Cloudflare Pagesに`VITE_API_BASE_URL`と`VITE_CLERK_PUBLISHABLE_KEY`が設定されている
- Renderに`FRONTEND_ORIGIN`、`CLERK_SECRET_KEY`、`DATABASE_URL`、`GEMINI_API_KEY`が設定されている
- `FRONTEND_ORIGIN`はCloudflare Pagesの本番URLと完全一致している
- Neonへ`db/migrations/001_initial.sql`を適用済み

## 10分で行う縦断確認

9月2日時点で、1と3は合格を確認済みです。
2・4〜8はClerkのログインが要るため、アカウントを持つ人が実施してください。

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
