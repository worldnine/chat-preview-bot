# chat-preview-bot

Google ChatにURLを貼ると、画像や本文をプレビュー表示するBot。Gyazo、X（Twitter）、YouTubeのほか、oEmbedかOGPに対応したサイトなら展開できます。Google Apps Scriptで動作します。

## 機能

- リンクプレビューに登録したドメインのURLをそのまま貼る → 1件インラインプレビュー
- `/preview URL1 URL2 ...` → どのサイトのURLでも展開（最大5件）。コマンドの発言は本人にしか見えないので、`/preview`の後ろの文章を本人の発言として投稿し直し、その下にカードを付ける
- `@preview URL1 URL2 ...` → どのサイトのURLでも展開（最大5件）

| URL | 表示内容 |
|---|---|
| Gyazo、画像のURL | 画像 |
| X（Twitter）の投稿 | 投稿者と本文 |
| YouTubeなどoEmbedに対応したサイト | タイトル、作者、サムネイル |
| その他のサイト | OGPのタイトル、説明文、画像 |

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
- **リンクプレビュー**：`gyazo.com`、`*.gyazo.com`、`x.com`、`twitter.com`を追加（登録できるのは5パターンまで）
- **スラッシュコマンド**：`/preview`（コマンドID: 1）を追加
- **公開設定**：使用するユーザーまたはGoogleグループのメールアドレスを追加

### 4. Google ChatにBotを追加

スペースの「アプリと統合」→「アプリを追加」でpreviewを検索して追加。

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
- リンクプレビューはGoogle Chatの仕様上1メッセージ1URLのみ。複数URLや、リンクプレビューに登録していないサイトは`/preview`または`@preview`を使ってください
- スラッシュコマンドはコマンドIDを見ていないので、名前を`/gyazo`のままにしても動きます
- `/preview`で投稿し直したメッセージには、送信者の名前とあわせてアプリ名が表示されます。投稿し直せなかったときは、カードに本文を添えて返します
- Xの本文は公式のoEmbedで取得します。添付画像は表示されず、鍵アカウントや削除済みの投稿は展開しません
- 自動アクセスを拒否するサイト（medium.comなど）は展開できません
- `google.com`のURLはGoogle Chatが自前で展開するので無視します
