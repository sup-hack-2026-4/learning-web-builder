# 2週間MVPバックログ

ハッカソン期間中の2週間分の計画です。**発表は終了しており、この計画は完了扱いです。**
以降の開発はこのバックログではなく、GitHubのIssueで管理します。

2026年9月8日時点の状況を記録しています。
チェックは、リポジトリの実装を確認できたものだけに付けています。

## 1週目

- [x] モノレポ、CI、開発規約
- [x] SiteModel、静的フォールバック、iframeプレビュー
- [x] デザイン調整、学習メモ、品質チェック、ZIPの初期縦断
- [x] Gemini構造生成と厳格なサーバー側検証
      （`backend/internal/gemini`と`backend/internal/site/validate.go`。
      本番でも`provider: gemini`の応答を確認済み）
- [x] Clerkログインとプロジェクト所有者確認
      （`backend/internal/auth`。`backend/internal/project/postgres.go`が
      `clerk_user_id`で所有者を絞り込む）
- [ ] Neon保存、マイグレーション、sqlcクエリ
      （保存とマイグレーションは実装済みで、本番のNeonへの保存も確認済み。
      sqlcのみ未完。下記参照）

## 2週目

- [x] 監修済み解説辞書の拡充
      （`frontend/src/features/explanations/dictionary.ts`。6要素すべてに個別の解説）
- [x] axe-core結果の画面統合
      （`frontend/src/features/quality/`のaxe-audit・run-axe-audit・use-axe-audit。
      画面外のiframeで実測し、品質パネルに実行中・結果・失敗を出し分ける。
      結果は提出物ZIPにも含まれる）
- [x] Playwrightの主要デモシナリオ安定化
      （`frontend/e2e/builder.spec.ts`に34シナリオ。CIの`e2e`ジョブで実行）
- [x] API停止・不正入力・通信復旧の確認
      （静的フォールバック、Geminiの再試行とモデル切り替え、時間予算、
      入力検証。`backend/internal/httpapi/router_test.go`で検証）
- [x] デモデータと発表用シナリオ
      （`frontend/src/features/site-model/sample.ts`と
      [production-verification.md](production-verification.md)の縦断手順）
- [x] Cloudflare Pages／Render／Neonへ接続
      （3環境とも公開・疎通済み。2026年9月8日にログインから保存・復元までの
      縦断確認も完了。[production-verification.md](production-verification.md)）

## 残っている作業

発表時点で未完だったものです。急ぎではありません。

### sqlcクエリ

`db/queries/projects.sql`と`db/sqlc.yaml`は用意されていますが、
生成先の`backend/internal/dbgen`が存在せず、`backend/internal/project/postgres.go`は
生SQLで実装されています。動作はしているため、sqlcへ寄せるかどうかは判断が要ります。
