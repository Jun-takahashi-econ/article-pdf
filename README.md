# article-pdf

開いている記事の本文だけを抜き出し、テキスト付きのPDFにしてOneDriveに保存する、Chrome / Edge の拡張機能です。
The Economist・Financial Times・日本経済新聞に対応しています（その他のサイトも本文の抽出を試みます）。

## セットアップ（PCごとに1回）

Node.js 18以上が必要です。新しいPCでは、Claude Code に「READMEのセットアップを手伝って」と頼めば、この手順を案内してくれます。

1. このリポジトリをクローンする。保存先は自動で OneDrive の `ArticlePDF` になります。
   変える場合は、リポジトリ直下に `config.json` を作ります。
   ```json
   {"outDir": "C:\\Users\\xxx\\OneDrive - 大学名\\ArticlePDF"}
   ```
2. リポジトリのフォルダで次を実行する（「動作確認: OK」と保存先が表示されれば完了）
   ```
   node native-host/install.mjs
   ```
3. ブラウザに拡張機能を読み込む
   1. `chrome://extensions`（Edgeは `edge://extensions`）を開き、「デベロッパーモード」をオン
   2. 「パッケージ化されていない拡張機能を読み込む」（Edgeは「展開して読み込み」）で、このリポジトリの `extension` フォルダを選ぶ
   3. パズルの形のアイコンから「Article PDF」をピン留め

## 使い方

記事を開いて、ツールバーの「Article PDF」のボタンを押します（`Alt+Shift+P` でも可）。
数秒で、画面右下に「保存しました」と保存先が表示されます。

## 更新

1. リポジトリで `git pull`
2. `chrome://extensions` で「Article PDF」の再読み込みボタン（↻）を押す

---

取得したPDFは私的利用（ご自身の学習用）の範囲でご利用ください。
