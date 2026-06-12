# article-pdf

[The Economist](https://www.economist.com/)の記事のURLをアプリに渡すと、ログイン済みブラウザで記事を開き、本文だけを抽出して
テキストレイヤー付きの綺麗なPDFを出力するツールです（OCR不要）。
PDFで保存→iPadのGoodNotes等からそのまま取り込めます。
GoodNotes等だとメモ機能や翻訳機能が充実しているので、英語新聞を無理なく読み進めることを習慣化できると思います。
webで記事を印刷するとレイアウトが大きく崩れてしまいますが、このアプリを使うとレイアウト崩れは発生しにくいのが特徴です。

## 仕組み

```
記事URL → pdf.mjs（Chrome/Edgeを自動操縦）→ 本文抽出 → PDF → OneDrive/ArticlePDF/
```

- ログインセッションは専用プロファイル（`~/.article-pdf-profile`）に保存。初回ログイン後は自動
- PDFは `日付_タイトル.pdf` の形式で保存
- 日常利用はターミナル不要：**SaveArticle**（Windows: .vbs / Mac: .app）をダブルクリック → URLを貼ってEnter

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
> 4. **初回ログイン**: `node pdf.mjs --login` を実行。このコマンドはブラウザを開いた後、
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
node pdf.mjs --login   # ブラウザが開くのでログイン → ターミナルに戻ってEnter
```

保存先を明示する場合はリポジトリ直下に `config.json` を作成:

```json
{"outDir": "C:\\Users\\xxx\\OneDrive - 大学名\\ArticlePDF"}
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

## GoodNotes連携

OneDriveに出力されるので、iPadのGoodNotesからは「読み込む」→ OneDrive → ArticlePDF で取り込めます。

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| 「本文を抽出できませんでした」 | セッション切れの可能性。`node pdf.mjs --login` で再ログイン |
| SaveArticleをダブルクリックしても何も起きない | `SaveArticle.ps1` がUTF-8 BOM付きか確認（上記ハマりどころ参照）。`powershell -File SaveArticle.ps1` を直接実行するとエラーが見えます |
| ChromeもEdgeも見つからないと言われる | `CHROME_PATH=/path/to/chrome node pdf.mjs <URL>` で実行ファイルを指定 |
| config.jsonが効いていない | 実行時ログの「出力先:」を確認。JSONのバックスラッシュのエスケープ漏れに注意 |
| 画像が欠ける | インタラクティブ図表（SVG/canvas）はPDF化できない場合があります |

- ChromeかEdgeを自動検出します（大学PCならEdgeは確実に入っています）
- ログインセッションはPCごとに保存されるため、PCごとに初回 `--login` が必要です
- スクリプトは意図的に可視モード（ウィンドウが一瞬開く）で動きます。headlessはpaywallサイトに弾かれやすいためです

## 注意

取得したPDFは私的利用（ご自身の学習用）の範囲でご利用ください。
