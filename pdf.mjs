#!/usr/bin/env node
/**
 * pdf.mjs — URLを渡すと、ログイン済みChromeプロファイルで記事を開き、
 * Readabilityで本文抽出して綺麗なPDF(テキストレイヤー付き)を出力する。
 *
 * 使い方:
 *   node pdf.mjs --login            # 初回のみ: ブラウザが開くのでThe Economistにログイン
 *   node pdf.mjs <URL>              # 記事をPDF化
 *
 * 出力先: 環境変数 ARTICLE_PDF_OUT、未設定なら ~/Documents/ArticlePDF
 */

import puppeteer from "puppeteer-core";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const require = createRequire(import.meta.url);

const PROFILE_DIR = path.join(homedir(), ".article-pdf-profile");

// ---- 出力先の決定: ARTICLE_PDF_OUT > OneDrive自動検出 > ~/Documents/ArticlePDF ----
function detectOneDrive() {
  // Windows: 環境変数 OneDrive / OneDriveCommercial が自動で設定されている
  for (const v of ["OneDriveCommercial", "OneDrive"]) {
    if (process.env[v] && existsSync(process.env[v])) return process.env[v];
  }
  // macOS: ~/Library/CloudStorage/OneDrive-xxx
  const cs = path.join(homedir(), "Library", "CloudStorage");
  if (existsSync(cs)) {
    const od = readdirSync(cs).find((d) => d.startsWith("OneDrive"));
    if (od) return path.join(cs, od);
  }
  return null;
}

// config.json(プロジェクト直下、任意)で保存先を明示できる: {"outDir": "/path/to/folder"}
function readConfig() {
  const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "config.json");
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

const config = readConfig();
const oneDrive = detectOneDrive();
const OUT_DIR =
  process.env.ARTICLE_PDF_OUT ||
  config.outDir ||
  (oneDrive
    ? path.join(oneDrive, "ArticlePDF")
    : path.join(homedir(), "Documents", "ArticlePDF"));

// ---- Chrome実行パスの自動検出(CHROME_PATH指定があれば優先) ----
const CHROME_CANDIDATES = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
    // 大学PC等でChromeが入れられない場合はEdge(Chromium)でも動作する
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"],
};

const CHROME_PATH =
  process.env.CHROME_PATH ||
  (CHROME_CANDIDATES[process.platform] || []).find((p) => existsSync(p));

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node pdf.mjs <URL>  または  node pdf.mjs --login");
  process.exit(1);
}

if (!CHROME_PATH || !existsSync(CHROME_PATH)) {
  console.error("ChromeまたはEdgeが見つかりません。");
  console.error("環境変数 CHROME_PATH で実行ファイルの場所を指定してください。");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
console.log(`出力先: ${OUT_DIR}`);

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: false, // paywall系サイトはheadlessだと弾かれやすいため可視で起動
  userDataDir: PROFILE_DIR,
  defaultViewport: { width: 1280, height: 1600 },
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,900"],
});

try {
  // ---- 初回ログインモード ----
  if (arg === "--login") {
    const page = await browser.newPage();
    await page.goto("https://www.economist.com/", { waitUntil: "domcontentloaded" });
    console.log("ブラウザでログインしてください。完了したらこのターミナルでEnterを押してください。");
    await new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("", () => { rl.close(); resolve(); });
    });
    console.log(`ログインセッションを ${PROFILE_DIR} に保存しました。`);
    process.exit(0);
  }

  // ---- 記事PDF化モード ----
  const url = arg;
  const page = await browser.newPage();
  console.log(`取得中: ${url}`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 90_000 });

  // 遅延読み込み画像対策: ページ末尾までスクロール
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = () => {
        y += 800;
        window.scrollTo(0, y);
        if (y >= document.body.scrollHeight) return resolve();
        setTimeout(step, 150);
      };
      step();
    });
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 1500));

  // Readabilityをページに注入して本文抽出
  const readabilityPath = require.resolve("@mozilla/readability/Readability.js");
  await page.addScriptTag({ content: readFileSync(readabilityPath, "utf8") });

  const article = await page.evaluate(() => {
    // 相対URLを絶対URLに変換してから複製
    for (const img of document.querySelectorAll("img")) {
      if (img.src) img.setAttribute("src", img.src);
      img.removeAttribute("srcset");
      img.removeAttribute("loading");
    }
    const doc = document.cloneNode(true);
    const parsed = new Readability(doc).parse();
    if (!parsed) return null;
    const time = document.querySelector("time");
    return {
      title: parsed.title,
      byline: parsed.byline || "",
      content: parsed.content,
      siteName: parsed.siteName || location.hostname,
      date: time?.getAttribute("datetime") || time?.textContent || "",
    };
  });

  if (!article || !article.content || article.content.length < 500) {
    throw new Error(
      "本文を抽出できませんでした。未ログインまたはpaywallの可能性があります。`node pdf.mjs --login` を試してください。"
    );
  }

  // 整形済みHTMLでレンダリング
  const dateStr = article.date ? article.date.slice(0, 10) : "";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<base href="${url}">
<style>
  @page { margin: 0; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 12.5pt;
    line-height: 1.65;
    color: #111;
    max-width: 660px;
    margin: 0 auto;
    padding: 8px 0 24px;
  }
  header { border-bottom: 2px solid #e3120b; margin-bottom: 1.4em; padding-bottom: 0.8em; }
  .site { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 9pt;
          letter-spacing: 0.08em; text-transform: uppercase; color: #e3120b; }
  h1 { font-size: 22pt; line-height: 1.25; margin: 0.3em 0 0.2em; }
  .meta { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #666; }
  img, figure { max-width: 100%; height: auto; margin: 1em auto; display: block; }
  figcaption { font-size: 9.5pt; color: #666; text-align: center; }
  h2, h3 { line-height: 1.3; margin-top: 1.6em; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #444; }
  a { color: inherit; text-decoration: none; }
  p { margin: 0 0 0.9em; }
</style>
</head>
<body>
  <header>
    <div class="site">${article.siteName}</div>
    <h1>${article.title}</h1>
    <div class="meta">${[article.byline, dateStr].filter(Boolean).join(" · ")}</div>
  </header>
  ${article.content}
</body>
</html>`;

  const renderPage = await browser.newPage();
  await renderPage.setContent(html, { waitUntil: "networkidle0", timeout: 60_000 });
  // 画像のデコード完了を待つ
  await renderPage.evaluate(() =>
    Promise.allSettled([...document.images].map((i) => i.decode().catch(() => {})))
  );

  const slug = article.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const fname = `${dateStr || new Date().toISOString().slice(0, 10)}_${slug}.pdf`;
  const outPath = path.join(OUT_DIR, fname);

  await renderPage.pdf({
    path: outPath,
    format: "A4",
    printBackground: true,
    margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
  });

  console.log(`保存しました: ${outPath}`);
} catch (err) {
  console.error(`エラー: ${err.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
