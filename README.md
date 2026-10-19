# article-pdf

[The Economist](https://www.economist.com/)や[Financial Times](https://www.ft.com/)の記事から本文だけを抜き出し、
テキストレイヤー付きの綺麗なPDFにしてOneDriveに保存する、Chrome/Edgeの拡張機能です。
webで記事を印刷するとレイアウトが大きく崩れてしまいますが、この拡張機能を使うとレイアウト崩れは発生しにくいのが特徴です。

```
普段のChrome/Edgeで記事を開く → ツールバーのボタン（または Alt+Shift+P）→ OneDrive/ArticlePDF/
```

- 記事冒頭の写真と、本文中のグラフ・図表を取り込みます（インタラクティブなグラフは表示を画像化）
- 音声プレーヤーの残骸やニュースレター勧誘は自動で除去します
- 記事ページの背景色（FTのベージュ等）を再現します。ダークモード等で背景が暗い場合は白のまま
- ファイル名は `日付_タイトル.pdf`。同じ記事を保存し直すと上書きします
- 開いているページをそのまま読み取るので、続けて何本保存してもサイトのBoT対策に止められません

### 対応サイト

| サイト | 備考 |
|---|---|
| The Economist | 本文末尾の ■ を目印に、号の宣伝カードや勧誘を除去 |
| Financial Times | 背景色（ベージュ）を再現 |
| その他 | Readabilityで本文抽出を試みます |

記事は普段のブラウザで開くので、ログインもいつものブラウザのものがそのまま使われます。

媒体固有の設定（見出しの色・グラフ埋め込みのホスト名・背景色の予備値など）は `extension/extract.js` 冒頭の
`SITES` テーブルに集約してあります。新しい媒体はここに1エントリ足せば対応できます。

---

## セットアップ（Claude Code用）

新しいPCでは、このリポジトリをクローンした後、Claude Code に以下の指示書をそのまま貼り付けてください。
対話しながらセットアップが完了します（約5分）。

> **指示書（ここからコピー）**
>
> クローン済みの article-pdf リポジトリをセットアップして。手順:
>
> 1. **Node.js確認**: Node.js 18以上があるか確認。なければインストール
>    （Windows: wingetでLTS、管理者権限がなければ nodejs.org のzip版を展開してPATHを通す。Mac: `brew install node`）
> 2. **保存先設定**: OneDriveのパスを検出して候補を私に提示し（Windowsは環境変数 `OneDrive` / `OneDriveCommercial`、
>    Macは `~/Library/CloudStorage/OneDrive-*`）、保存先が決まったらリポジトリ直下に
>    `config.json` を `{"outDir": "<保存先パス>"}` で作成（JSONなのでWindowsのバックスラッシュはエスケープ）
> 3. **受け口の登録**: `node native-host/install.mjs` を実行し、「動作確認: OK」と、表示された保存先が
>    2の保存先と一致することを確認。「注意: 管理ポリシーで…」と出た場合はその内容を私に伝える
> 4. **拡張機能の読み込み**: README「拡張機能を読み込む」の手順を私に案内する（ブラウザの操作なので私が行う）。
>    読み込みが終わったら、記事を開いて拡張機能のボタンを押してもらい、保存先にPDFができたか確認
>
> **(ここまでコピー)**

### 拡張機能を読み込む（Chrome/Edge共通・PCごとに1回）

1. アドレスバーに `chrome://extensions`（Edgeは `edge://extensions`）と入力
2. 「デベロッパーモード」（Edgeは「開発者モード」）をオン
3. 「パッケージ化されていない拡張機能を読み込む」（Edgeは「展開して読み込み」）→ このリポジトリの `extension` フォルダを選択
4. ツールバーのパズルの形のアイコンから「Article PDF」をピン留め

読み込んだ `extension` フォルダは移動・削除しないでください（ブラウザはそこから読み込み続けます）。

### ハマりどころ

- `config.json` のパスはバックスラッシュをエスケープ（例: `{"outDir": "C:\\Users\\xxx\\OneDrive - 大学名\\ArticlePDF"}`）
- 受け口には node の場所を登録するので、Node.jsを入れ直した（場所が変わった）ときは `node native-host/install.mjs` を再実行

---

## セットアップ（手動）

```bash
cd article-pdf
node native-host/install.mjs   # 受け口を登録（「動作確認: OK」と保存先が出る）
```

続けて、上の「拡張機能を読み込む」の手順でブラウザに読み込みます。`npm install` は不要です（外部の依存なし）。

保存先を明示する場合はリポジトリ直下に `config.json` を作成:

```json
{"outDir": "C:\\Users\\xxx\\ArticlePDF"}
```

`config.json` はマシンごとの設定なのでgit管理対象外（.gitignore済み）。PCごとに作成してください。

**保存先の優先順位**（`native-host/out-dir.mjs`）

1. 環境変数 `ARTICLE_PDF_OUT`
2. `config.json` の `outDir`（推奨）
3. OneDrive自動検出 → `OneDrive/ArticlePDF/`
4. どれもなければ `~/Documents/ArticlePDF/`

受け口の登録時に「保存先: ...」と表示されるので確認できます。

---

## 日常の使い方

1. 普段のChrome/Edgeで記事を開く
2. ツールバーの「Article PDF」のボタンを押す（ショートカット `Alt+Shift+P`。変更は `chrome://extensions/shortcuts`）
3. 画面右下に進捗が出て、数秒で「保存しました」と保存先が表示されます

- 処理中は記事のタブを表示したままにしてください（別のタブに切り替えると、グラフの撮影ができません）
- 保存の瞬間、ブラウザ上部に「デバッグを開始しました」という帯が一瞬出ます。PDF印刷に使う仕組みで、
  拡張機能自身の印刷用タブにだけ接続します（記事のタブには接続しません）
- 記事以外のページ（ブラウザの設定画面など）で押すと、ボタンの下に理由が表示されます

---

## 更新のしかた

1. リポジトリで `git pull`
2. `chrome://extensions`（Edgeは `edge://extensions`）で「Article PDF」の再読み込みボタン（↻）を押す

---

## しくみ

```
記事のタブ（普段のブラウザ）── 本文・グラフを抽出 ──→ 印刷用タブ（拡張機能自身のページ）── PDF化
                                                                     │
                                       受け口 native-host/host.mjs ←─┘ → OneDrive/ArticlePDF/
```

| ファイル | 役割 |
|---|---|
| `extension/background.js` | ボタンの処理、グラフの撮影、印刷用タブの管理 |
| `extension/extract.js` | 記事タブの中で本文・グラフ・冒頭写真を抜き出し、PDF用のHTMLを組み立てる |
| `extension/render.js` | 印刷用タブでPDFに印刷し、受け口（使えなければダウンロードフォルダ）に保存する |
| `extension/vendor/Readability.js` | 本文抽出ライブラリ（[@mozilla/readability](https://github.com/mozilla/readability) 0.5.0 のコピー） |
| `native-host/host.mjs` | 受け取ったPDFを保存先に書き込む受け口 |
| `native-host/install.mjs` | 受け口をChrome/Edgeに登録する（`--uninstall` で解除） |

- 抽出は記事ページの複製に対して行うので、読んでいる画面は書き換えません（終わると読んでいた位置に戻ります）
- 拡張機能はダウンロードフォルダの中にしか書き込めないため、PC側の受け口（Chrome/EdgeのNative Messaging）が
  保存先への書き込みを担当します。受け口が使えないPC（未登録、管理ポリシーで禁止）では、
  ダウンロードフォルダ内の `ArticlePDF/` に保存し、その理由を表示します
- 拡張機能のIDは `extension/manifest.json` の `key` で `hdmldbmbchckngilggannebonadijpej` に固定しています。
  受け口はこのIDの拡張機能からしか呼び出せません（`native-host/install.mjs` の `EXTENSION_ID`）
- 受け口の登録はユーザー単位（Windowsはレジストリ、Mac/Linuxは各ブラウザの設定フォルダ）で、管理者権限は不要です
- PDF印刷の仕組み（デバッガー）が使えない環境では印刷画面が開くので、送信先で「PDFに保存」を選んでください
- インタラクティブなグラフは画面の表示を撮影して取り込むため、解像度は画面に依存します（静的なグラフ画像は原寸）

以前は、ブラウザを自動操縦して記事を開く `pdf.mjs`（SaveArticle）を使っていました。The EconomistのBoT対策（DataDome）が
自動操縦のブラウザを検知し、続けて保存すると数時間ブロックされるようになったため、拡張機能に置き換えました。

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| ボタンが「!」になり、何も保存されない | 記事以外のページ（ブラウザの設定画面、新しいタブなど）で押しています。記事のタブで押してください |
| 「OneDrive保存の設定がまだです」と出る | そのPCで `node native-host/install.mjs` を実行してください。実行済みなら、出力の「保存先」と「動作確認: OK」を確認 |
| 「管理ポリシーで…止められています」と出る | ブラウザの管理ポリシー（大学PC等）で受け口が禁止されています。PDFはダウンロードフォルダ内の `ArticlePDF/` に保存されます |
| 「本文を抽出できませんでした」と出る | 記事が全文表示されているか（ログイン状態）を確認してください |
| 「サイトの確認画面が表示されています」と出る | 画面の指示に従って確認を済ませ、記事が表示されてからもう一度押してください |
| 保存先が意図と違う | `node native-host/install.mjs` の「保存先:」を確認。`config.json` のバックスラッシュのエスケープ漏れに注意 |
| グラフが欠ける | 処理中に別のタブへ切り替えていないか確認し、記事のタブを表示したままもう一度押してください |

## 注意

取得したPDFは私的利用（ご自身の学習用）の範囲でご利用ください。
