# article-pdf

[The Economist](https://www.economist.com/)や[Financial Times](https://www.ft.com/)の記事のURLをアプリに渡すと、ログイン済みブラウザで記事を開き、本文だけを抽出して
テキストレイヤー付きの綺麗なPDFを出力するツールです。
webで記事を印刷するとレイアウトが大きく崩れてしまいますが、このアプリを使うとレイアウト崩れは発生しにくいのが特徴です。

## 仕組み

```
記事URL → pdf.mjs（Chrome/Edgeを自動操縦）→ 本文抽出 → PDF → OneDrive/ArticlePDF/
```

- ログインセッションは専用プロファイル（`~/.article-pdf-profile`）に保存。初回ログイン後は自動
- プロファイルは媒体共通なので、The EconomistとFTのログインは同居できます（片方を入れても他方は消えません）
- 記事冒頭の写真、本文中のグラフ・図表も取り込みます。音声プレーヤーの残骸やニュースレター勧誘は自動で除去
- 記事ページの背景色（FTのベージュ等）もPDFに再現します。ダークモード等で背景が暗い場合は白のまま
- PDFは `日付_タイトル.pdf` の形式で保存
- 日常利用はターミナル不要：**SaveArticle**（Windows: .vbs / Mac: .app）をダブルクリック → URLを貼ってEnter
- The Economistを短時間に続けて保存したいときは[拡張機能版](#拡張機能版試作)を使ってください（自動操縦のブラウザはBoT対策で数時間ブロックされるため）

### 対応サイト

| サイト | ログイン | 備考 |
|---|---|---|
| The Economist | `node pdf.mjs --login` | 既定。`--login economist` でも同じ |
| Financial Times | `node pdf.mjs --login ft` | 個人契約アカウント |
| その他 | – | ログイン不要な記事なら、そのままURLを渡せば本文抽出を試みます |

媒体固有の設定（ログインURL・見出しの色・グラフ埋め込みのホスト名・背景色の予備値など）は `pdf.mjs` 冒頭の
`SITES` テーブルに集約してあります。新しい媒体はここに1エントリ足せば対応できます。
拡張機能版は `extension/extract.js` に同じ表を持っているので、媒体を足すときは両方に追加してください。

---

## セットアップ（Claude Code用）

新しいPCでは、このリポジトリをクローンした後、Claude Code に以下の指示書をそのまま貼り付けてください。
対話しながら全自動でセットアップが完了します（約5分）。

> **指示書（ここからコピー）**
>
> クローン済みの article-pdf リポジトリをセットアップして。手順:
>
> 1. **Node.js確認**: Node.js 18以上があるか確認。なければインストール
>    （Windows: wingetでLTS、管理者権限がなければ nodejs.org のzip版を展開してPATHを通す。Mac: `brew install node`）
> 2. **依存関係**: リポジトリ内で `npm install`
> 3. **保存先設定**: OneDriveのパスを検出して候補を私に提示し（Windowsは環境変数 `OneDrive` / `OneDriveCommercial`、
>    Macは `~/Library/CloudStorage/OneDrive-*`）、保存先が決まったらリポジトリ直下に
>    `config.json` を `{"outDir": "<保存先パス>"}` で作成（JSONなのでWindowsのバックスラッシュはエスケープ）
> 4. **初回ログイン**: `node pdf.mjs --login` を実行（FTも使う場合は続けて `node pdf.mjs --login ft`）。このコマンドはブラウザを開いた後、
>    ターミナルでのEnter入力を待ち続けるので、バックグラウンド実行にして
>    「フラグファイルが作られたらEnter（改行）をstdinに送るパイプ」等で制御すること。
>    ブラウザが開いたら私にログインを促し、完了の合図を待ってからEnterを送る
> 5. **動作確認**: 記事URLを私に1つ聞いて `node pdf.mjs "<URL>"` を実行。
>    ログの「出力先:」が意図通りか、PDFファイルが実際に生成されたかを確認
> 6. **ワンクリック起動の設定**:
>    - Windows: `SaveArticle.vbs` へのショートカット（.lnk）をデスクトップと
>      `%APPDATA%\Microsoft\Windows\Start Menu\Programs\` に作成し、
>      スタート/タスクバーへのピン留め方法を案内。最後に .vbs 起動テストをして入力ボックスが出ることを確認
>    - Mac: `SaveArticle.app` の隔離属性解除（`xattr -cr`）とDockへのピン留めを案内
> 7. **拡張機能版（Economist用）**: `node native-host/install.mjs` を実行し、「動作確認: OK」と保存先が
>    3の保存先と一致することを確認。続けて、Chrome/Edgeで `extension` フォルダを読み込む手順
>    （README「拡張機能版」の導入2〜5）を私に案内する。「注意: 管理ポリシーで…」と出た場合はその内容を伝える
>
> **(ここまでコピー)**

### ハマりどころ（Claude Code・人間共通）

- `pdf.mjs --login` は **stdinのEnter待ち**でブロックする。自動化する場合は上記4の方法で
- `SaveArticle.ps1` は **UTF-8 BOM付き**で保存すること。BOMなしだとWindows PowerShell 5.1が
  日本語をShift-JISと誤読して構文エラーになり、「ダブルクリックしても何も起きない」状態になる
- `config.json` のパスはバックスラッシュをエスケープ（例: `{"outDir": "C:\\Users\\xxx\\OneDrive - 大学名\\ArticlePDF"}`）

---

## セットアップ（手動）

```bash
cd article-pdf
npm install
node pdf.mjs --login      # The Economist: ブラウザが開くのでログイン → ターミナルに戻ってEnter
node pdf.mjs --login ft   # FTも使う場合（同じプロファイルに追加されます）
```

保存先を明示する場合はリポジトリ直下に `config.json` を作成:

```json
{"outDir": "C:\\Users\\xxx\\ArticlePDF"}
```

`config.json` はマシンごとの設定なのでgit管理対象外（.gitignore済み）。PCごとに作成してください。

**出力先の優先順位**

1. 環境変数 `ARTICLE_PDF_OUT`
2. `config.json` の `outDir`（推奨）
3. OneDrive自動検出 → `OneDrive/ArticlePDF/`
4. どれもなければ `~/Documents/ArticlePDF/`

実行時に「出力先: ...」と表示されるので確認できます。

---

## 日常の使い方

### アプリ版（推奨・ターミナル不要）

1. 記事のURLをコピー
2. **SaveArticle** のアイコンをダブルクリック
3. 入力ボックスにURLを貼り付けてEnter
4. 完了すると OneDrive の `ArticlePDF` フォルダにPDFが保存され、通知が出ます

**Windows（SaveArticle.vbs）**
- ダブルクリックで入力ボックスが開きます（黒いコンソール画面は出ません）
- ピン留め: ショートカット（.lnk）を作って右クリック →「スタートにピン留めする」
- `SaveArticle.vbs` と `SaveArticle.ps1` は本体スクリプトを相対参照しているため、リポジトリフォルダに置いたままにしてください

**Mac（SaveArticle.app）**
- リポジトリフォルダの中に置いたまま使ってください（本体スクリプトを相対参照しているため）
- アイコンはDockにドラッグしてピン留めできます
- 初回のみ隔離属性の解除が必要:
  ```bash
  xattr -cr path/to/article-pdf/SaveArticle.app
  chmod +x path/to/article-pdf/SaveArticle.app/Contents/MacOS/launcher
  ```
  それでも「開けません」と出る場合は右クリック →「開く」

### コマンド版

```bash
node pdf.mjs "https://www.economist.com/...記事URL..."
```

Macで `epdf <URL>` の一発にするには `~/.zshrc` に:

```bash
alias epdf='node path/to/article-pdf/pdf.mjs'
```

## 拡張機能版（試作）

The Economistは、自動操縦のブラウザで記事を続けて開くとBoT対策（DataDome）が働き、
「アクセスは一時的に制限されています」と表示されて数時間使えなくなります。拡張機能版は、
普段のブラウザで開いている記事をそのままPDFにするので（自動操縦をしない）、この制限を受けません。

```
普段のChrome/Edgeで記事を開く → ツールバーのボタン（または Alt+Shift+P）→ OneDrive/ArticlePDF/
```

保存先は `pdf.mjs` と同じです（`config.json` の `outDir` → OneDrive/ArticlePDF の順。`out-dir.mjs` で共通化）。
拡張機能はダウンロードフォルダの中にしか書き込めないため、PC側の小さな受け口（`native-host/host.mjs`）が書き込みを担当します。

**導入（PCごとに1回・Chrome/Edge共通）**

1. リポジトリ直下で受け口を登録: `node native-host/install.mjs`
   （「動作確認: OK」と保存先が表示されれば完了。管理者権限は不要）
2. アドレスバーに `chrome://extensions`（Edgeは `edge://extensions`）と入力
3. 「デベロッパーモード」をオン
4. 「パッケージ化されていない拡張機能を読み込む」（Edgeは「展開して読み込み」）→ このリポジトリの `extension` フォルダを選択
5. ツールバーのパズルアイコンから「Article PDF」をピン留め

- 拡張機能のIDは `extension/manifest.json` の `key` で `hdmldbmbchckngilggannebonadijpej` に固定しています。
  受け口はこのIDの拡張機能からしか呼び出せません（`native-host/install.mjs` の `EXTENSION_ID`）
- 受け口には node の場所を絶対パスで登録するので、Node.jsを入れ直したら1をもう一度実行してください
- 登録の解除は `node native-host/install.mjs --uninstall`

**使い方**

- 記事を開いてボタンを押す（ショートカット `Alt+Shift+P`。変更は `chrome://extensions/shortcuts`）
- 画面右下に進捗が出て、数秒で「保存しました」と保存先が表示されます。同じ記事を保存し直すと上書きします（`pdf.mjs` と同じ）
- 受け口が使えないPC（未登録、管理ポリシーで禁止）では、ダウンロードフォルダ内の `ArticlePDF/` に保存し、その理由を表示します
- 保存の瞬間、ブラウザ上部に「デバッグを開始しました」という帯が一瞬出ます。PDF印刷に使う仕組みで、
  拡張機能自身の印刷用タブにだけ接続します（記事のタブには接続しません）
- この仕組みが使えない環境（管理ポリシー等）では印刷画面が開くので、送信先で「PDFに保存」を選んでください
- 記事以外のページ（ブラウザの設定画面など）で押すと、ボタンの下に理由が表示されます
- コードを更新したら、拡張機能の管理画面で「Article PDF」の再読み込みボタンを押してください

**pdf.mjs版との違い（試作時点）**

- iframeのグラフは画面の表示を撮影して取り込むため、解像度は画面に依存します（静的なグラフ画像は原寸）
- 開いている記事の画面は書き換えません（抽出はページの複製に対して行い、終わると読んでいた位置に戻ります）

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| 「本文を抽出できませんでした」 | セッション切れの可能性。エラーメッセージに出るコマンド（`node pdf.mjs --login` / `--login ft`）で再ログイン |
| 「アクセスは一時的に制限されています」（Economist） | 自動操縦のブラウザがBoT対策（DataDome）に検知されたもので、ログインし直しても解決しません。普段のブラウザでは読めるので[拡張機能版](#拡張機能版試作)で保存してください。`pdf.mjs` での再試行は制限を長引かせるので、数時間あけてください |
| 拡張機能で「OneDrive保存の設定がまだです」と出る | そのPCで `node native-host/install.mjs` を実行してください。実行済みなら、出力の「保存先」と「動作確認: OK」を確認 |
| 拡張機能で「管理ポリシーで…止められています」と出る | ブラウザの管理ポリシー（大学PC等）で受け口が禁止されています。PDFはダウンロードフォルダ内の `ArticlePDF/` に保存されます |
| 冒頭の写真が入らない | 実行ログの「冒頭画像:」を確認。記事によっては本文中に取り込まれている（その場合は重複を避けるためヘッダーには入れません） |
| SaveArticleをダブルクリックしても何も起きない | `SaveArticle.ps1` がUTF-8 BOM付きか確認（上記ハマりどころ参照）。`powershell -File SaveArticle.ps1` を直接実行するとエラーが見えます |
| ChromeもEdgeも見つからないと言われる | `CHROME_PATH=/path/to/chrome node pdf.mjs <URL>` で実行ファイルを指定 |
| config.jsonが効いていない | 実行時ログの「出力先:」を確認。JSONのバックスラッシュのエスケープ漏れに注意 |
| グラフ・画像が欠ける | 静的画像・canvas・インタラクティブなグラフ（`infographics.economist.com` 等のiframe）を自動で取り込むよう対応済み。それでも欠ける場合はネットワークが遅い可能性があるので再実行を。実行ログの「グラフ救済: N/M件」で取り込めたグラフ数を確認できます |

- ChromeかEdgeを自動検出します（大学PCならEdgeは確実に入っています）
- ログインセッションはPCごとに保存されるため、PCごとに初回 `--login` が必要です
- スクリプトは意図的に可視モード（ウィンドウが一瞬開く）で動きます。headlessはpaywallサイトに弾かれやすいためです

## 注意

取得したPDFは私的利用（ご自身の学習用）の範囲でご利用ください。
