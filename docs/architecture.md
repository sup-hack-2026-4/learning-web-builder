# アーキテクチャ

発表スライドへ貼り付けられる構成図は
[SVG版](assets/backend-architecture.svg)と
[PNG版](assets/backend-architecture.png)にあります。
本番環境の縦断確認は
[production-verification.md](production-verification.md)に沿って実施します。

## 基本方針

編集の正本はReactコンポーネントではなく`SiteModel`です。同じモデルからプレビュー、品質判定、ZIP提出物を生成し、画面と提出コードの不一致を防ぎます。

```text
題材入力
  ↓
Go API ── Gemini（失敗時は静的サンプル）
  ↓ Zodで検証
SiteModel（Zustand + localStorage）
  ├─ buildSiteArtifacts → iframe srcdoc
  ├─ qualityChecks      → 品質レポート
  ├─ learningNotes      → 学習メモ
  └─ JSZip              → 提出物一式
```

## セキュリティ境界

- iframeには`sandbox="allow-scripts"`のみを付与し、親画面へのDOMアクセスを許可しない
- ユーザー入力はHTML属性・本文へ入れる前にエスケープする
- iframeとの通信は`postMessage`のメッセージ型と送信元ウィンドウを確認する
- Geminiの出力はGo側の構造検証後、フロント側でもZod検証する
- Clerkのトークン検証はGo側で行い、クライアントのユーザーIDを信用しない
- APIキー、Clerk秘密鍵、DB接続文字列はバックエンド環境変数だけに保存する

## MVPの境界

今回の初期実装は、静的紹介サイト1テンプレートの縦断動作を対象にします。教員ダッシュボード、成績連携、不正判定、自由コード編集、公開機能は含みません。
