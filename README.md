# article-pdf

[The Economist](https://www.economist.com/)や[Financial Times](https://www.ft.com/)の記事から本文だけを抜き出し、
テキストレイヤー付きの綺麗なPDFにしてOneDriveに保存するツールです。
webで記事を印刷するとレイアウトが大きく崩れてしまいますが、このツールを使うとレイアウト崩れは発生しにくいのが特徴です。

## 2つの保存方法と使い分け

| | 拡張機能（Article PDF） | SaveArticle（pdf.mjs） |
|---|---|---|
| 操作 | 普段のChrome/Edgeで記事を開き、ツールバーのボタンを押す | アイコンをダブルクリックしてURLを貼る |
| しくみ | 開いているページをそのまま読み取る | 専用のブラウザを自動操縦して記事を開く |
| The Economist | **こちらを使う**（続けて何本でも保存できる） | 続けて使うとBoT対策で数時間ブロックされる |
| Financial Times | 使える | 使える |
| 保存先 | OneDrive/ArticlePDF（共通） | OneDrive/ArticlePDF（共通） |

The EconomistはBoT対策（DataDome）を使っており、自動操縦のブラウザで記事を続けて開くと
「アクセスは一時的に制限されています」と表示されて数時間使えなくなります。拡張機能は自動操縦をしないので、この制限を受けません。

どちらの方法でも、仕上がりは同じです。

- 記事冒頭の写真と、本文中のグラフ・図表を取り込みます（インタラクティブなグラフは表示を画像化）
- 音声プレーヤーの残骸やニュースレター勧誘は自動で除去します
- 記事ページの背景色（FTのベージュ等）を再現します。ダークモード等で背景が暗い場合は白のまま
- ファイル名は `日付_タイトル.pdf`。同じ記事を保存し直すと上書きします

### 対応サイト

| サイト | 拡張機能 | SaveArticleで使う場合のログイン |
|---|---|---|
| The Economist | 対応 | `node pdf.mjs --login`（`--login economist` でも同じ） |
| Financial Times | 対応 | `node pdf.mjs --login ft` |
| その他 | 本文抽出を試みます | ログイン不要な記事なら、そのままURLを渡せば本文抽出を試みます |

媒体固有の設定（ログインURL・見出しの色・グラフ埋め込みのホスト名・背景色の予備値など）は `pdf.mjs` 冒頭の
`SITES` テーブルに集約してあります。新しい媒体はここに1エントリ足せば対応できます。
拡張機能は `extension/extract.js` に同じ表を持っているので、媒体を足すときは両方に追加してください。

---

## セットアップ（Claude Code用）

新しいPCでは、このリポジトリをクローンした後、Claude Code に以下の指示書をそのまま貼り付けてください。
対話しながらセットアップが完了します（約10分）。

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
> 4. **拡張機能の受け口**: `node native-host/install.mjs` を実行し、「動作確認: OK」と、表示された保存先が
>    3の保存先と一致することを確認。「注意: 管理ポリシーで…」と出た場合はその内容を私に伝える
> 5. **拡張機能の読み込み**: README「拡張機能を読み込む」の手順を私に案内する（ブラウザの操作なので私が行う）。
>    読み込みが終わったら、Economistの記事で拡張機能のボタンを押してもらい、保存先にPDFができたか確認
> 6. **SaveArticle（FT用）**: FTのログイン用に `node pdf.mjs --login ft` を実行。このコマンドはブラウザを開いた後、
>    ターミナルでのEnter入力を待ち続けるので、バックグラウンド実行にして
>    「フラグファイルが作られたらEnter（改行）をstdinに送るパイプ」等で制御すること。
>    ブラウザが開いたら私にログインを促し、完了の合図を待ってからEnterを送る。
>    その後、FTの記事URLを私に1つ聞いて `node pdf.mjs "<URL>"` を実行し、ログの「出力先:」とPDFの生成を確認
> 7. **ワンクリック起動の設定**:
>    - Windows: `SaveArticle.vbs` へのショートカット（.lnk）をデスクトップと
>      `%APPDATA%\Microsoft\Windows\Start Menu\Programs\` に作成し、
>      スタート/タスクバーへのピン留め方法を案内。最後に .vbs 起動テストをして入力ボックスが出ることを確認
>    - Mac: `SaveArticle.app` の隔離属性解除（`xattr -cr`）とDockへのピン留めを案内
>
> **(ここまでコピー)**

### 拡張機能を読み込む（Chrome/Edge共通・PCごとに1回）

1. アドレスバーに `chrome://extensions`（Edgeは `edge://extensions`）と入力
2. 「デベロッパーモード」（Edgeは「開発者モード」）をオン
3. 「パッケージ化されていない拡張機能を読み込む」（Edgeは「展開して読み込み」）→ このリポジトリの `extension` フォルダを選択
4. ツールバーのパズルの形のアイコンから「Article PDF」をピン留め

読み込んだ `extension` フォルダは移動・削除しないでください（ブラウザはそこから読み込み続けます）。

### ハマりどころ（Claude Code・人間共通）

- `pdf.mjs --login` は **stdinのEnter待ち**でブロックする。自動化する場合は上記6の方法で
- `SaveArticle.ps1` は **UTF-8 BOM付き**で保存すること。BOMなしだとWindows PowerShell 5.1が
  日本語をShift-JISと誤読して構文エラーになり、「ダブルクリックしても何も起きない」状態になる
- `config.json` のパスはバックスラッシュをエスケープ（例: `{"outDir": "C:\\Users\\xxx\\OneDrive - 大学名\\ArticlePDF"}`）

---

## セットアップ（手動）

```bash
cd article-pdf
npm install
node native-host/install.mjs   # 拡張機能の受け口を登録（「動作確認: OK」と保存先が出る）
node pdf.mjs --login ft        # SaveArticleでFTを使う場合: ブラウザが開くのでログイン → ターミナルに戻ってEnter
node pdf.mjs --login           # SaveArticleでEconomistも使う場合（同じプロファイルに追加されます）
```

続けて、上の「拡張機能を読み込む」の手順でブラウザに読み込みます。

保存先を明示する場合はリポジトリ直下に `config.json` を作成:

```json
{"outDir": "C:\\Users\\xxx\\ArticlePDF"}
```

`config.json` はマシンごとの設定なのでgit管理対象外（.gitignore済み）。PCごとに作成してください。

**保存先の優先順位**（拡張機能・SaveArticle共通。`out-dir.mjs`）

1. 環境変数 `ARTICLE_PDF_OUT`
2. `config.json` の `outDir`（推奨）
3. OneDrive自動検出 → `OneDrive/ArticlePDF/`
4. どれもなければ `~/Documents/ArticlePDF/`

SaveArticleは実行時に「出力先: ...」、受け口の登録時は「保存先: ...」と表示されるので確認できます。

---

## 日常の使い方

### 拡張機能（The Economistはこちら）

1. 普段のChrome/Edgeで記事を開く
2. ツールバーの「Article PDF」のボタンを押す（ショートカット `Alt+Shift+P`。変更は `chrome://extensions/shortcuts`）
3. 画面右下に進捗が出て、数秒で「保存しました」と保存先が表示されます

- 処理中は記事のタブを表示したままにしてください（別のタブに切り替えると、グラフの撮影ができません）
- 保存の瞬間、ブラウザ上部に「デバッグを開始しました」という帯が一瞬出ます。PDF印刷に使う仕組みで、
  拡張機能自身の印刷用タブにだけ接続します（記事のタブには接続しません）
- 記事以外のページ（ブラウザの設定画面など）で押すと、ボタンの下に理由が表示されます

### SaveArticle（URLだけで保存したいとき・FT等）

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

**コマンド版**

```bash
node pdf.mjs "https://www.ft.com/content/...記事URL..."
```

Macで `epdf <URL>` の一発にするには `~/.zshrc` に `alias epdf='node path/to/article-pdf/pdf.mjs'` を追加します。

---

## 更新のしかた

1. リポジトリで `git pull`
2. `chrome://extensions`（Edgeは `edge://extensions`）で「Article PDF」の再読み込みボタン（↻）を押す

SaveArticleは `git pull` だけで新しくなります。Node.jsを入れ直した（場所が変わった）ときは、
`node native-host/install.mjs` をもう一度実行してください（受け口には node の場所を登録しているため）。

---

## 拡張機能のしくみ

```
記事のタブ（普段のブラウザ）── 本文・グラフを抽出 ──→ 印刷用タブ（拡張機能自身のページ）── PDF化
                                                                     │
                                       受け口 native-host/host.mjs ←─┘ → OneDrive/ArticlePDF/
```

- 抽出は記事ページの複製に対して行うので、読んでいる画面は書き換えません（終わると読んでいた位置に戻ります）
- 拡張機能はダウンロードフォルダの中にしか書き込めないため、PC側の受け口（Chrome/EdgeのNative Messaging）が
  保存先への書き込みを担当します。受け口が使えないPC（未登録、管理ポリシーで禁止）では、
  ダウンロードフォルダ内の `ArticlePDF/` に保存し、その理由を表示します
- 拡張機能のIDは `extension/manifest.json` の `key` で `hdmldbmbchckngilggannebonadijpej` に固定しています。
  受け口はこのIDの拡張機能からしか呼び出せません（`native-host/install.mjs` の `EXTENSION_ID`）
- 受け口の登録はユーザー単位（Windowsはレジストリ、Mac/Linuxは各ブラウザの設定フォルダ）で、管理者権限は不要です。
  解除は `node native-host/install.mjs --uninstall`
- PDF印刷の仕組み（デバッガー）が使えない環境では印刷画面が開くので、送信先で「PDFに保存」を選んでください
- インタラクティブなグラフは画面の表示を撮影して取り込むため、解像度は画面に依存します（静的なグラフ画像は原寸）

---

## トラブルシューティング

**拡張機能**

| 症状 | 対処 |
|------|------|
| ボタンが「!」になり、何も保存されない | 記事以外のページ（ブラウザの設定画面、新しいタブなど）で押しています。記事のタブで押してください |
| 「OneDrive保存の設定がまだです」と出る | そのPCで `node native-host/install.mjs` を実行してください。実行済みなら、出力の「保存先」と「動作確認: OK」を確認 |
| 「管理ポリシーで…止められています」と出る | ブラウザの管理ポリシー（大学PC等）で受け口が禁止されています。PDFはダウンロードフォルダ内の `ArticlePDF/` に保存されます |
| 「本文を抽出できませんでした」と出る | 記事が全文表示されているか（ログイン状態）を確認してください |
| 「サイトの確認画面が表示されています」と出る | 画面の指示に従って確認を済ませ、記事が表示されてからもう一度押してください |

**SaveArticle（pdf.mjs）**

| 症状 | 対処 |
|------|------|
| 「BoT対策(DataDome)でアクセスが一時的に制限されました」（Economist） | 自動操縦のブラウザが検知されたもので、ログインし直しても解決しません。普段のブラウザでは読めるので拡張機能で保存してください。SaveArticleでの再試行は制限を長引かせるので、数時間あけてください |
| 「本文を抽出できませんでした」 | セッション切れの可能性。エラーメッセージに出るコマンド（`node pdf.mjs --login` / `--login ft`）で再ログイン |
| 冒頭の写真が入らない | 実行ログの「冒頭画像:」を確認。記事によっては本文中に取り込まれている（その場合は重複を避けるためヘッダーには入れません） |
| SaveArticleをダブルクリックしても何も起きない | `SaveArticle.ps1` がUTF-8 BOM付きか確認（上記ハマりどころ参照）。`powershell -File SaveArticle.ps1` を直接実行するとエラーが見えます |
| ChromeもEdgeも見つからないと言われる | `CHROME_PATH=/path/to/chrome node pdf.mjs <URL>` で実行ファイルを指定 |
| config.jsonが効いていない | 実行時ログの「出力先:」を確認。JSONのバックスラッシュのエスケープ漏れに注意 |
| グラフ・画像が欠ける | ネットワークが遅い可能性があるので再実行を。実行ログの「グラフ救済: N/M件」で取り込めたグラフ数を確認できます |

- SaveArticleはChromeかEdgeを自動検出します（大学PCならEdgeは確実に入っています）
- SaveArticleのログインセッションはPCごとに保存されるため、PCごとに初回 `--login` が必要です
- SaveArticleは意図的に可視モード（ウィンドウが一瞬開く）で動きます。headlessはpaywallサイトに弾かれやすいためです

## 注意

取得したPDFは私的利用（ご自身の学習用）の範囲でご利用ください。
