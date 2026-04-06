# gyazo-chat-bot

Google ChatでGyazoのURLを貼ると画像をプレビュー表示するBot。Google Apps Scriptで動作します。

## 機能

- GyazoのURLをそのまま貼る → 1枚インラインプレビュー
- `/gyazo URL1 URL2 ...` → 複数枚対応
- `@Gyazo Bot URL1 URL2 ...` → 複数枚対応

## セットアップ

### 1. Google Cloud Projectの作成

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. Google Chat APIを有効化
3. OAuth同意画面を設定（ユーザータイプ：内部）

### 2. Google Apps Scriptの作成

1. [Apps Script](https://script.google.com/) で新しいプロジェクトを作成
2. 「プロジェクトの設定」→「Google Cloud Platformプロジェクトを変更」で上記プロジェクトのIDを入力
3. `code.gs` の内容を貼り付けて保存
4. `appsscript.json` の内容を以下に置き換えて保存（「appsscript.jsonマニフェストファイルをエディタで表示する」を有効にすると編集できます）
5. 「デプロイ」→「テストデプロイ」でヘッドデプロイIDをコピー

### 3. Chat APIの設定

[Chat API設定画面](https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat) で以下を設定：

- **アプリ名**：任意
- **インタラクティブ機能**：有効
- **機能**：「スペースとグループの会話に参加する」にチェック
- **接続設定**：Apps Script → テストデプロイIDを入力
- **リンクプレビュー**：`gyazo.com` と `*.gyazo.com` を追加
- **スラッシュコマンド**：`/gyazo`（コマンドID: 1）を追加
- **公開設定**：使用するユーザーまたはGoogleグループのメールアドレスを追加

### 4. Google ChatにBotを追加

スペースの「アプリと統合」→「アプリを追加」で Gyazo Bot を検索して追加。

## appsscript.json

```json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/chat.messages.create",
    "https://www.googleapis.com/auth/script.external_request"
  ]
}
```

## 注意事項

- テストデプロイはコードを変更しても再デプロイ不要で常に最新を参照します
- 公開設定にGoogleグループのアドレスを指定すると複数ユーザーへの一括付与が可能です
- リンクプレビューはGoogle Chatの仕様上1メッセージ1URLのみ。複数URLは `/gyazo` または `@Gyazo Bot` を使ってください
