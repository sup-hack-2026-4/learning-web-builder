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
  │                     └ annotateCode → コード表示（選択要素の行・未記録の変更行）
  ├─ qualityChecks      → 品質レポート
  │                     └ axe-core → 検査用iframeで実測し、指摘を日本語へ変換
  ├─ learningNotes      → 学習メモ（理由＋そのとき変わったコード）
  └─ JSZip              → 提出物一式
```

## セキュリティ境界

- iframeには`sandbox="allow-scripts"`のみを付与し、親画面へのDOMアクセスを許可しない
- ユーザー入力はHTML属性・本文へ入れる前にエスケープする
- iframeとの通信は`postMessage`のメッセージ型と送信元ウィンドウを確認する
- axeの検査用iframeもプレビューと同じ`sandbox="allow-scripts"`のまま動かし、結果は`postMessage`でのみ受け取る
- Geminiの出力はGo側の構造検証後、フロント側でもZod検証する
- Clerkのトークン検証はGo側で行い、クライアントのユーザーIDを信用しない
- APIキー、Clerk秘密鍵、DB接続文字列はバックエンド環境変数だけに保存する

## 画像の扱い

外部ストレージを持たない構成のため、画像はJPEGのデータURIとして`SiteModel`へ載せます。

- アップロード時にブラウザ側で長辺1280pxまで縮小し、上限に収まるまでJPEGの品質を落とす
- 上限は1枚200KiB・合計600KiB・全体で4枚（base64部分の長さで判定）。
  保存APIのボディ上限は1MiBで、本文や学習メモも同じリクエストに乗るため、画像だけで使い切らない
- 提出物のHTMLは`images/<ファイル名>`を相対パスで参照し、ZIPへ実ファイルとして同梱する。
  プレビューとaxeの検査用文書は`srcdoc`で開くため、相対パスの解決先が無い。この2つだけデータURIへ差し替える
- サーバー側は形式・サイズ・枚数に加えて、base64を復号してJPEGの開始マーカーまで確かめる。
  ファイル名はZIPの中でそのままパスになるため、`^[a-z0-9-]{1,40}\.jpg$`に限定する
- `image`は任意項目。保存済みの古いプロジェクトはこの項目を持たないため、
  欠けている場合は従来のプレースホルダーを表示する
- 一覧API(`GET /api/v1/projects`)は画像を落として返す。一覧はタイトルの表示にしか使わないため、
  画像込みのモデルを全件運ぶ必要がない。読み込み時は個別取得で画像ごと受け取る

大量の画像や高解像度の原本が必要になった段階で、R2やS3などのストレージへ移すか判断します。
その場合も、期限付き署名URLではなく永続的な識別子をモデルへ持たせます。

## MVPの境界

今回の初期実装は、静的紹介サイト1テンプレートの縦断動作を対象にします。教員ダッシュボード、成績連携、不正判定、自由コード編集、公開機能は含みません。
