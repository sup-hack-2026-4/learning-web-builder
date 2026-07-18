# learning-web-builder

学生が静的な紹介サイトを「生成して終わり」にせず、変更理由と品質改善を記録しながら学べるWeb制作ツールです。

## MVPで確認できること

- 題材からサンプルサイトを生成（API停止時は静的JSONへ自動フォールバック）
- `SiteModel`からHTML・CSS・JavaScriptを生成し、sandbox付きiframeで表示
- 色・余白・フォント・セクション表示をリアルタイム変更
- プレビュー上の要素選択と、監修済み固定解説の表示
- 変更理由を学習メモとして保存
- 見出し構造・画像のalt・モバイル対応の品質チェック
- コード、学習メモ、品質レポート、AI利用記録、READMEをZIP出力
- ブラウザへの自動一時保存

## 構成

```text
frontend/     React + TypeScript + Vite
backend/      Go + chi API
db/           PostgreSQLマイグレーションとsqlc設定
openapi/      API契約
docs/         設計・役割分担・開発規約
.github/      CI、PR・Issueテンプレート、CODEOWNERS
```

## 必要環境

- Node.js 24.14以上
- npm 11以上
- Go 1.26以上
- PostgreSQL 17（DB機能を開発する場合。Neonも利用可能）

## 初回セットアップ

```powershell
cd frontend
Copy-Item .env.example .env.local
npm.cmd install

cd ../backend
Copy-Item .env.example .env
go mod download
```

秘密情報はGitへ追加しないでください。初期状態ではAPIキーやDBなしでもサンプルモードで動作します。

## 開発サーバー

ターミナル1:

```powershell
cd backend
go run ./cmd/api
```

ターミナル2:

```powershell
cd frontend
npm.cmd run dev
```

- フロントエンド: http://localhost:5173
- API: http://localhost:8080/api/v1/health

## 動作確認

```powershell
cd frontend
npm.cmd run lint
npm.cmd run test
npm.cmd run build

cd ../backend
go test ./...
```

詳しい設計は[docs/architecture.md](docs/architecture.md)、共同開発手順は[CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。
