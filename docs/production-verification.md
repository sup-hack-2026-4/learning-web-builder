# 本番環境の完成確認

発表前に、Cloudflare Pages・Clerk・Render・Neonを通した縦断動作を確認するための手順です。
秘密鍵、トークン、DB接続文字列はスクリーンショットやIssueへ貼り付けません。

## 2026年9月8日の確認結果

ログインを伴う手順（2・4〜6・8）とNeon側の確認を実施し、
[10分で行う縦断確認](#10分で行う縦断確認)の全項目が合格しました。
9月2日に未確定だった`DATABASE_URL`の設定状況も、ここで確定しています。

| 対象 | 確認内容 | 結果 |
|---|---|---|
| ブラウザ | Clerkでのログイン（手順2） | ログイン済み表示になり、保存UIが使える |
| ブラウザ | 保存（手順4） | 「プロジェクトを保存しました。」。`DATABASE_URL`は設定済みと確定 |
| ブラウザ | 上書き保存（手順5） | 「プロジェクトを更新しました。」 |
| ブラウザ | 再読み込みからの復元（手順6） | 保存時の内容が復元される |
| ブラウザ | ログアウト（手順8） | 保存UIがログイン案内に戻る |
| Neon | `SELECT COUNT(*) FROM projects` | 保存前3件、保存後4件（1増） |
| Neon | 対象プロジェクトの`version` | 2（上書き保存がNeonへ反映） |

これで[完成判定](#完成判定)の「全項目が合格」に該当し、ClerkとNeon保存は完了と判断できます。
引き続き残る懸念は、下記のClerkの開発用キーとRenderのコールドスタートの2点です。

## 2026年9月2日の確認結果

7月31日に未反映だった2設定（`VITE_API_BASE_URL`、`FRONTEND_ORIGIN`）は反映済みで、
ログインを伴わない範囲はすべて合格しています。

以下はすべて2026年9月2日に、公開URLへ実際にリクエストを送って測った結果です。
リポジトリの中身からは確かめられないため、再確認するときは同じ操作をやり直してください。

| 対象 | 確認内容 | 結果 |
|---|---|---|
| Cloudflare Pages | `https://learning-web-builder.pages.dev` と `https://develop.learning-web-builder.pages.dev` | どちらも200。同じJSアセット名を配信 |
| Cloudflare Pages | 配信中のJSに焼き込まれたAPIのベースURL | `https://learning-web-builder-api.onrender.com/api/v1` |
| Cloudflare Pages | Clerk公開鍵 | 設定済み（ただし開発用キー。後述） |
| Render | `GET /api/v1/health` | 200・`status: ok` |
| Render | 認証なしの `GET /api/v1/projects` | 401（認証が要ることのみを示す。後述） |
| Render | 上記2つのCloudflare Originからのアクセス | どちらも許可 |
| Render | 無関係なOriginからのアクセス | 403で拒否 |
| Render | `POST /api/v1/generate` | 200・`provider: gemini`（`GEMINI_API_KEY`が有効） |
| ブラウザ | 公開URLでのコンソール | CORSエラーなし |
| ブラウザ | 題材からの生成 | 「AIでたたき台を生成しました。」を表示 |
| ブラウザ | 品質チェック | 見出し構造・画像のalt・モバイル表示がすべて合格 |
| ブラウザ | 未ログインでの提出物ZIP | 7ファイルすべて出力（手順7の合格を確認） |

この時点では`DATABASE_URL`の設定状況を確認できていませんでした。
未認証リクエストは認証チェックで止まるため、DBの設定有無にかかわらず401になるためです。
判定には認証付きのリクエストが要ります（[API側の確認](#api側の確認)を参照）。
9月8日にログイン済みの保存を実行し、設定済みであることを確定しました。

発表前に対処を検討する点:

- **Clerkが開発用キーで動いている。このまま発表する判断です。** コンソールに
  「Clerk has been loaded with development keys」の警告が出ますが、動作には影響しません。
  発表は発表者だけがログインするデモ形式のため、開発インスタンスの制限
  （ユーザー100人、認証コードの検証が3回／10秒）には届きません。
  観客に一斉にログインさせる形式へ変える場合のみ、本番インスタンスが要ります。
  ただし本番インスタンスはDNSレコードを追加できる独自ドメインが必須で、
  Cloudflareが所有する`pages.dev`のままでは設定できません。
  切り替えるなら、独自ドメインの取得とCloudflare Pagesへの割り当てから始めます
  （Clerkの無料枠でも本番インスタンスの作成自体は可能です）。
- **Renderのコールドスタートが遅い。** 一定時間アクセスが無いと
  最初の応答に40秒以上かかりました。発表直前に一度アクセスして起こしておきます。

公開URLを別のURLへ切り替えた場合は、`FRONTEND_ORIGIN`も実際の公開URLへ合わせます。

## 事前条件

- Cloudflare Pagesの本番URLが分かっている
- Cloudflare Pagesに`VITE_API_BASE_URL`と`VITE_CLERK_PUBLISHABLE_KEY`が設定されている
- Renderに`FRONTEND_ORIGIN`、`CLERK_SECRET_KEY`、`DATABASE_URL`、`GEMINI_API_KEY`が設定されている
- `FRONTEND_ORIGIN`に、確認で使うCloudflare PagesのURLがすべて入っている
  （カンマ区切りで複数指定できます。本番URLとdevelop URLの両方を使うなら両方書きます）
- Neonへ`db/migrations/001_initial.sql`を適用済み

## 10分で行う縦断確認

1・3・7は9月2日、2・4〜6・8は9月8日に合格を確認済みです。
2・4〜6・8はClerkのログインが要るため、再確認するときはアカウントを持つ人が実施してください。

| # | 操作 | 合格条件 | 証跡 |
|---:|---|---|---|
| 1 | Cloudflare Pagesの本番URLを開く | 画面が表示され、コンソールにCORSエラーがない | URLと画面のスクリーンショット |
| 2 | Clerkでログインする | ログイン済み表示になり、保存UIが使える | ユーザー名部分だけのスクリーンショット |
| 3 | 任意の題材でサイトを生成する | 生成APIへのリクエストが200で返り、プレビューと品質チェックが表示される | 生成後の画面と、開発者ツールのNetworkで`/api/v1/generate`が200であること |
| 4 | 「保存」を押す | 「プロジェクトを保存しました。」が表示される | 通知と保存一覧 |
| 5 | 色などを変更して「上書き保存」を押す | 「プロジェクトを更新しました。」が表示される | バージョンが増えた保存一覧 |
| 6 | ページを再読み込みして保存済み項目を選ぶ | 保存時の内容が復元される | 復元後の画面 |
| 7 | ZIPをダウンロードする | `index.html`、`style.css`、`script.js`、`learning-notes.md`、`quality-report.md`、`ai-usage.json`、`README.md`の7ファイルが含まれる | ZIP内のファイル一覧 |
| 8 | ログアウトする | 保存UIがログイン案内になる | ログアウト後の画面 |

補足:

- CORSは、ページを開くだけでは確かめられません。APIへ実際にリクエストが飛ぶ手順3で、
  Networkの`/api/v1/generate`にレスポンスヘッダー`access-control-allow-origin`が
  付いていることを見てください。
- 手順7はログイン不要です。ゲストのままダウンロードできます。
- 手順8で見えるのは保存UIの出し分けだけです。保存APIそのものが拒否されることは、
  [API側の確認](#api側の確認)で別途確かめます。

## API側の確認

`curl.exe`を使います。`Invoke-WebRequest`の`-SkipHttpErrorCheck`はPowerShell 7以降の
オプションで、Windows標準のPowerShell 5.1では動かないためです。

### 認証が要ることの確認

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" `
  https://learning-web-builder-api.onrender.com/api/v1/projects
```

合格値は`401`です。認証チェックはDBより先に動くため、**この結果からは
`DATABASE_URL`の設定有無は分かりません**。`200`が返る場合は認証が効いていないので、
`CLERK_SECRET_KEY`を確認します。

### `DATABASE_URL`の確認

DBの設定有無は、認証を通したうえでないと切り分けられません。
ログイン済みのブラウザで手順4（保存）を実行し、結果で判断します。

| 手順4の結果 | 意味 |
|---|---|
| 「プロジェクトを保存しました。」 | `DATABASE_URL`が設定され、Neonへ書けている |
| `503`（保存できない旨のエラー） | `DATABASE_URL`が未設定 |
| `401` | Clerkのトークン検証に失敗。`CLERK_SECRET_KEY`を確認 |

### CORSの確認

`Origin`ヘッダーを付けないとCORSの判定自体が行われないため、必ず付けて送ります。

```powershell
curl.exe -s -D - -o NUL `
  -H "Origin: https://learning-web-builder.pages.dev" `
  https://learning-web-builder-api.onrender.com/api/v1/health |
  Select-String "access-control-allow-origin"
```

自分が使う公開URLが返ってくれば合格です。何も返らない、または`403`になる場合は
`FRONTEND_ORIGIN`にそのURLが入っていません。

### Renderの動作確認

```powershell
Invoke-RestMethod `
  -Uri 'https://learning-web-builder-api.onrender.com/api/v1/health'
```

`status`が`ok`なら合格です。しばらくアクセスが無いと、コールドスタートで
最初の応答に40秒以上かかることがあります。

## Neon側の確認

Neon SQL Editorでは、秘密情報を含まない件数とバージョンだけを確認します。
全体の最大値だけを見ると、既にバージョン2以上の別プロジェクトがあるときに
今回の保存が失敗していても合格に見えてしまうため、前後で比べます。

手順4の前に、件数を控えます。

```sql
SELECT COUNT(*) AS project_count FROM projects;
```

手順5のあと、今回作ったプロジェクトだけを見ます。
`project_id`は、保存後のURLか保存一覧から控えてください。

```sql
SELECT version, updated_at
FROM projects
WHERE id = '<控えたproject_id>';
```

`project_count`が1増えており、対象プロジェクトの`version`が2以上なら合格です。

## 完成判定

判定には、上のUI8項目に加えてAPI側とNeon側の確認も含めます。

- 全項目が合格: Clerk・Neon保存を「完了」にする
- 生成とZIPは成功、ログインだけ失敗: ゲストデモは可能。Clerk設定を最優先で修正する
- 手順4が`503`: `DATABASE_URL`が未設定。保存機能は落として発表する判断もできる
- Renderが不安定: 発表前に一度アクセスし、静的サンプルとオフラインZIPを待機させる
- Cloudflare Pagesが未公開: P0未完了。公開URLの確定を最優先にする
