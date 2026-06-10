# article-pdf

URLを渡すと、ログイン済みのChromeプロファイルで記事を開き、本文だけを抽出して
テキストレイヤー付きの綺麗なPDFを出力するスクリプトです(OCR不要)。

## 前提

- macOSまたはWindows、Google Chrome(WindowsはEdgeでも可)インストール済み
- Node.js 18以上(`node -v` で確認。Macは `brew install node`、Windowsは https://nodejs.org のLTSインストーラ)

## セットアップ(初回のみ、約5分)

```bash
cd economist-pdf
npm install
node pdf.mjs --login
```

`--login` でChromeのウィンドウが開くので、The Economistに手動でログインし、
完了したらターミナルに戻ってEnterを押してください。
セッションは専用プロファイル(`~/.article-pdf-profile`)に保存され、以後は不要です。

## 使い方(アプリ版・推奨)

ターミナル不要。MacもWindowsも操作は同じです:

1. 記事のURLをコピー
2. SaveArticleのアイコンをダブルクリック
3. 入力ボックスが出るのでURLを貼り付けてEnter
4. 完了するとOneDriveの `ArticlePDF` フォルダにPDFが保存され、通知が出ます

### Mac: SaveArticle.app

- `economist-pdf` フォルダの中に置いたまま使ってください(本体スクリプトを相対参照しているため)
- アイコンはDockにドラッグしてピン留めできます
- **初回のみ**: ダウンロードしたアプリのため隔離属性の解除が必要です。ターミナルで一度だけ:
  ```bash
  xattr -cr ~/Downloads/economist-pdf/SaveArticle.app
  chmod +x ~/Downloads/economist-pdf/SaveArticle.app/Contents/MacOS/launcher
  ```
  それでも「開けません」と出る場合は右クリック→「開く」を試してください

### Windows: SaveArticle.vbs

- ダブルクリックで入力ボックスが開きます(黒いコンソール画面は出ません)
- タスクバー/スタートにピンしたい場合: SaveArticle.vbsを右クリック→「ショートカットの作成」→ショートカットをスタートにピン留め
- 中身は SaveArticle.ps1 を呼んでいるだけなので、両ファイルとも `economist-pdf` フォルダに置いたままにしてください

## 使い方(コマンド版)

```bash
node pdf.mjs "https://www.economist.com/...記事URL..."
```

PDFは `日付_タイトル.pdf` の形式で保存されます。

**出力先の優先順位**
1. 環境変数 `ARTICLE_PDF_OUT`
2. プロジェクト直下の `config.json` の `outDir`(推奨。例: `{"outDir": "/Users/jun/Library/CloudStorage/OneDrive-xxx/ArticlePDF"}`)
3. OneDriveが見つかれば `OneDrive/ArticlePDF/`(自動検出。Mac/Windows両対応)
4. どれもなければ `~/Documents/ArticlePDF/`

`config.json` はマシンごとの設定なのでgit管理対象外(.gitignore済み)。PCごとに作成してください。

実行時に「出力先: ...」と表示されるので確認できます。OneDrive内の別フォルダにしたい場合は
`ARTICLE_PDF_OUT` で明示してください。

## GoodNotes連携

OneDriveに出力されるので、iPadのGoodNotesからは「読み込む」→ OneDrive → ArticlePDF で取り込めます。
Macで `epdf <URL>` の一発にするには `~/.zshrc` に以下を追加します。

```bash
alias epdf='node ~/Downloads/economist-pdf/pdf.mjs'   # 置き場所に合わせて変更
```

## Windows(大学PC)での使い方

1. Node.js LTSをインストール(https://nodejs.org)。管理者権限が不要な「zip版(Binary)」でも動作します
2. この `economist-pdf` フォルダをOneDrive経由などでコピー
3. PowerShellで:

```powershell
cd path\to\economist-pdf
npm install
node pdf.mjs --login    # ブラウザが開くのでログイン → Enter
node pdf.mjs "記事URL"
```

- ChromeかEdgeを自動検出します(大学PCならEdgeは確実に入っています)
- OneDrive(大学アカウント含む)も自動検出し、`OneDrive\ArticlePDF\` に保存します
- ログインセッションは各PCごとに保存されるため、PCごとに初回 `--login` が必要です

## トラブルシューティング

- **「本文を抽出できませんでした」**: セッション切れの可能性。`node pdf.mjs --login` で再ログイン。
- **Chromeのパスが違う**: `CHROME_PATH=/path/to/chrome node pdf.mjs <URL>` で指定可能。
- **画像が欠ける**: 記事によってはインタラクティブ図表(SVG/canvas)がPDF化できない場合があります。
- スクリプトは意図的に可視モード(ウィンドウが一瞬開く)で動きます。headlessはpaywallサイトに弾かれやすいためです。

## 注意

取得したPDFは私的利用(ご自身の学習用)の範囲でご利用ください。
