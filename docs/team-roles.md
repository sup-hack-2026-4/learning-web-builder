# 3人開発の初期分担案

## 担当A: 編集体験・デザイン

- 題材入力、編集パネル、プレビュー
- shadcn/uiコンポーネント
- レスポンシブ対応とアクセシビリティ

## 担当B: 生成・学習・品質

- `SiteModel`と`buildSiteArtifacts`
- 解説辞書、学習メモ、品質チェック
- ZIP出力とVitest／Playwright

## 担当C: API・データ・運用

- Go API、OpenAPI、Gemini連携
- Clerk、PostgreSQL、sqlc
- Render、Neon、GitHub Actions

境界を越える変更は、先にIssueで型・API契約を合意してください。`SiteModel`とOpenAPIの変更には全員のレビューを推奨します。

