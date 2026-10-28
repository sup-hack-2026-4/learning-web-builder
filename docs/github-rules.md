# GitHub管理ルール

## 目的

開発メンバーはブランチ作成とPR提出ができますが、`main`の更新とマージはリポジトリ管理者だけが行います。

## 推奨ルールセット

- 対象ブランチ: `main`
- Pull requestを必須化
- 最低1件の承認を必須化
- 新しいコミットで古い承認を無効化
- CODEOWNERSの承認を必須化
- 会話の解決を必須化
- 必須ステータスチェック: `frontend`、`backend`、`e2e`
- ブランチを最新状態にしてからマージ
- Force pushと削除を禁止
- 管理者にもルールを適用
- `main`の更新権限は管理者に限定

実際のGitHubプランや個人／Organizationリポジトリの制約により、「更新権限を管理者だけに限定」の選択肢が利用できない場合があります。その場合はOrganization所有へ移し、メンバーにはWrite、管理者チームだけにRulesetのバイパス権限を付与します。個人リポジトリで厳密に制限できない場合は、メンバーをTriage権限にしてForkからPRを送る運用が確実です。

## 依存の脆弱性の検出

- CIの`backend`ジョブで`govulncheck ./...`を、`frontend`ジョブで`npm audit --omit=dev`を実行します。実際に呼ばれる経路の脆弱性、または本番用依存の脆弱性があると失敗します
- `scheduled-vulnerability-check.yml`が、毎週月曜9:00（日本時間）に`develop`で同じ確認をします。手動実行（Actionsタブの「Run workflow」）もできます。GitHubの定期実行はデフォルトブランチ（`main`）にあるワークフローだけが動くため、このファイルは`main`へリリースされてから有効になります。定期実行が失敗したときの通知は、ワークフローの`cron`を最後に変更した人に届きます
- 失敗したら、`bug`ラベルのIssueを立てて修正します。修正版がまだない場合は、Issueに経緯を書いて待ちます
- 開発用依存の脆弱性ではCIを失敗させません。ローカルの`npm audit`やDependabotのPRで確認します

## DependabotのPR

`.github/dependabot.yml`により、毎週月曜9:00（日本時間）にnpm（`frontend`）・Go modules（`backend`）・GitHub Actionsの更新を確認し、`develop`向けのPRを作ります。minorとpatchはエコシステムごとに1本にまとめ、majorは個別のPRになります。

- 確認する人: CODEOWNERS（リポジトリ管理者）
- 取り込み方
  1. CI（`frontend`、`backend`、`e2e`）が通っていることを確かめる
  2. 変更履歴（PR本文のRelease notes・Changelog）で、破壊的変更がないか確かめる。majorの更新は、必要ならIssueを立てて別のPRで対応し、DependabotのPRは閉じる
  3. 承認して`develop`へマージする。コミットメッセージは英語のままでよい
- セキュリティ更新のPR: `target-branch`はバージョン更新にしか効かないため、セキュリティ更新のPRは`main`向けに作られます。`main`へは直接マージせず、PRを閉じて同じ更新を`develop`向けのPRで行います
- Dependabotのアラート・セキュリティ更新・Grouped security updatesは、2026年10月26日にリポジトリの「Settings → Advanced Security」で有効にしました。セキュリティ更新のPRは、エコシステムごとに1本にまとまります（`dependabot.yml`のグループは`applies-to`を書いていないため、バージョン更新にだけ効きます）

## 秘密情報の検出

Secret scanningとPush protectionを、2026年10月26日に「Settings → Advanced Security」で有効にしました。このリポジトリはpublicのため、コミットに入った秘密情報は誰でも見られます。

- pushを止められたら、まずコミットから秘密情報を取り除いてpushし直します。誤検知のときだけ、止められたときの画面で理由を選んで通します
- Securityタブの「Secret scanning」にアラートが出たら、**先にそのキーを発行元（Clerk・Neon・AIのAPIなど）で無効にして、新しいキーに差し替えます**。そのあとでコミットを直し、アラートを閉じます。履歴から消しても、すでに見られていた前提で対応します
- 秘密情報はコミットしません。`.env`と`.env.local`は`.gitignore`で除外しており、リポジトリに置くのは項目の一覧である`.env.example`だけです。実行環境（Render・Cloudflare Pages）には、それぞれの管理画面で設定します

