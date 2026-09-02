# 2週間MVPバックログ

2026年9月2日時点の状況です。チェックは、リポジトリの実装を確認できたものだけに付けています。

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
      （保存とマイグレーションは実装済み。sqlcのみ未完。下記参照）

## 2週目

- [x] 監修済み解説辞書の拡充
      （`frontend/src/features/explanations/dictionary.ts`。6要素すべてに個別の解説）
- [ ] axe-core結果の画面統合
      （`axe-core`は依存に入っているが、`frontend/src`から参照されていない。未着手）
- [x] Playwrightの主要デモシナリオ安定化
      （`frontend/e2e/builder.spec.ts`に34シナリオ。CIの`e2e`ジョブで実行）
- [x] API停止・不正入力・通信復旧の確認
      （静的フォールバック、Geminiの再試行とモデル切り替え、時間予算、
      入力検証。`backend/internal/httpapi/router_test.go`で検証）
- [x] デモデータと発表用シナリオ
      （`frontend/src/features/site-model/sample.ts`と
      [production-verification.md](production-verification.md)の縦断手順）
- [x] Cloudflare Pages／Render／Neonへ接続
      （3環境とも公開・疎通済み。ただし縦断確認は未了。下記参照）

## 残っている作業

### sqlcクエリ

`db/queries/projects.sql`と`db/sqlc.yaml`は用意されていますが、
生成先の`backend/internal/dbgen`が存在せず、`backend/internal/project/postgres.go`は
生SQLで実装されています。動作はしているため、sqlcへ寄せるかどうかは判断が要ります。

### axe-core結果の画面統合

`frontend/package.json`に`axe-core`はありますが、`frontend/src`から参照されていません。
品質チェックは`frontend/src/features/quality/evaluate-quality.ts`の独自判定のみです。

### 本番の縦断確認

接続と機能は揃っていますが、ログインを伴う手順（保存・上書き保存・復元・ログアウト）と
Neon側の確認が未了です。
手順は[production-verification.md](production-verification.md)にあります。
