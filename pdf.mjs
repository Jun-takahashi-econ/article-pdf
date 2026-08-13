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

// ---- サイト定義 ----
// サイト固有の知識はここだけに置く。新しい媒体はエントリを1つ足せば動く。
// 未定義サイトでも DEFAULT_SITE で汎用ツールとして成立する(本文抽出はReadability任せ)。
const DEFAULT_SITE = {
  name: null,          // null なら Readability の siteName を使う
  loginUrl: null,      // null なら --login の対象にできない
  accent: "#333333",
  chartFrame: /datawrapper|flourish|flo\.uri\.sh|infogram/i,
  // 記事末尾(■以降)で落としたい、そのサイト特有の勧誘ブロックの言い回し。
  // 汎用の勧誘パターン(sign up / subscriber-only / newsletter)は常に適用される。
  junkText: null,
};

const SITES = {
  "economist.com": {
    name: "The Economist",
    loginUrl: "https://www.economist.com/",
    accent: "#e3120b",
    chartFrame: /infographics\.economist\.com|interactive\.economist\.com|datawrapper/i,
    // 紙版の号を宣伝するカード(表紙画像つきで1ページ丸ごと使う)。
    // 「This article appeared in the ... print edition」の行は出典情報なので残す。
    junkText: /discover stories from this section|explore the edition/i,
  },
};

// hostname の末尾一致で解決(www.ft.com → ft.com)。未定義サイトは DEFAULT_SITE。
function resolveSite(url) {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { ...DEFAULT_SITE, key: null, alias: null };
  }
  for (const [domain, site] of Object.entries(SITES)) {
    if (host === domain || host.endsWith(`.${domain}`)) {
      return { ...DEFAULT_SITE, ...site, key: domain, alias: domain.split(".")[0] };
    }
  }
  return { ...DEFAULT_SITE, key: null, alias: null };
}

// --login の引数("ft" / "ft.com" / URL)を SITES のキーに解決する。省略時は従来どおりEconomist。
function resolveSiteKey(token) {
  if (!token) return "economist.com";
  const t = token
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  for (const domain of Object.keys(SITES)) {
    if (t === domain || t === domain.split(".")[0]) return domain;
  }
  return null;
}

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
  defaultViewport: { width: 1280, height: 1600, deviceScaleFactor: 2 },
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1280,900"],
});

try {
  // ---- 初回ログインモード ----
  if (arg === "--login") {
    const key = resolveSiteKey(process.argv[3]);
    if (!key) {
      console.error(`未対応のサイトです: ${process.argv[3]}`);
      console.error(`指定できるのは: ${Object.keys(SITES).map((d) => d.split(".")[0]).join(", ")}`);
      process.exit(1);
    }
    const loginSite = { ...DEFAULT_SITE, ...SITES[key] };
    const page = await browser.newPage();
    await page.goto(loginSite.loginUrl, { waitUntil: "domcontentloaded" });
    // Chromeプロファイルは全サイト共通なので、複数媒体のCookieが同居する
    // (FTにログインしてもEconomistのセッションは消えない)。
    console.log(`${loginSite.name} にログインしてください。完了したらこのターミナルでEnterを押してください。`);
    await new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("", () => { rl.close(); resolve(); });
    });
    console.log(`ログインセッションを ${PROFILE_DIR} に保存しました。`);
    process.exit(0);
  }

  // ---- 記事PDF化モード ----
  const url = arg;
  const site = resolveSite(url);
  const page = await browser.newPage();
  console.log(`取得中: ${url}`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 90_000 });

  // 遅延読み込み対策: ページ全体をゆっくりスクロールして画像/グラフの読み込みを誘発する
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let y = 0;
      const step = () => {
        y += 400;
        window.scrollTo(0, y);
        if (y >= document.body.scrollHeight) return resolve();
        setTimeout(step, 120);
      };
      step();
    });
    window.scrollTo(0, 0);
  });

  // グラフ画像のsrcを確定させる。The Economistのグラフは srcset / data-src 付きの遅延読み込み画像で、
  // 未読み込み時の src は空/プレースホルダ。実体URLを解決せずに srcset を消すと、抽出後に
  // 「本文だけでグラフが空」になる(このツールの主な不具合原因)。
  await page.evaluate(() => {
    const isPlaceholder = (u) =>
      !u ||
      u.startsWith("data:") ||
      // キーワード直後に区切り(. / ? # または末尾)を要求し、'spacer-chart.png' のような
      // 正当なファイル名を誤ってプレースホルダ扱いしないようにする(image-placeholder.svg等は引き続き一致)。
      /\b(blank|placeholder|spacer|1x1|transparent)(?:\.|\/|\?|#|$)/i.test(u);
    // srcset から最大解像度の候補URLを取り出す(グラフは高解像度の方が読みやすい)
    const largestFromSrcset = (srcset) => {
      if (!srcset) return null;
      let best = null;
      let bestW = -1;
      // 候補の区切りは「カンマ + 空白」。単純な split(",") は使えない —
      // The EconomistのCloudflare画像URL(/cdn-cgi/image/width=1424,quality=100,format=auto/…)は
      // URL自体にカンマを含むため、split(",")だと1つのURLが断片に割れる。すると最大幅の候補が
      // "format=auto/…/FNC219.png" のような壊れた相対URLになり、絶対化で 404 → Next.jsが
      // placeholder.svg に差し替え、グラフが白紙で出力される(本不具合の根本原因)。
      for (const part of srcset.split(/,\s+(?=\S)/)) {
        const [u, d] = part.trim().split(/\s+/);
        if (!u) continue;
        const w = d ? parseInt(d, 10) || 1 : 1;
        if (w > bestW) { bestW = w; best = u; }
      }
      return best;
    };
    const abs = (u) => {
      try { return new URL(u, location.href).href; } catch { return u; }
    };
    for (const img of document.querySelectorAll("img")) {
      // 実体URLの候補を優先度順に評価(プレースホルダは除外)
      const real = [
        largestFromSrcset(img.getAttribute("srcset")),
        largestFromSrcset(img.getAttribute("data-srcset")),
        img.getAttribute("data-src"),
        img.getAttribute("data-original"),
        img.getAttribute("data-lazy-src"),
        img.currentSrc,
        img.getAttribute("src"),
      ].find((u) => u && !isPlaceholder(u));
      if (real) {
        img.setAttribute("src", abs(real)); // 実URLを確定
        img.removeAttribute("srcset");       // 可変ソースは不要(誤って小さい/空を選ばせない)
      }
      // 実URLが見つからない場合は srcset/data-* を残し、Readability側の遅延画像復元に委ねる
      img.removeAttribute("loading");
      img.setAttribute("loading", "eager");
    }
  });

  // 解決した画像が実際に読み込まれる(デコードされる)まで待つ。1枚ごとにタイムアウトを設け、
  // 1枚の失敗で全体が止まらないようにする。
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images].map(
        (img) =>
          new Promise((resolve) => {
            if (img.complete && img.naturalWidth > 2) return resolve();
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
            setTimeout(done, 8000); // 1枚あたり最大8秒
          })
      )
    );
  });
  await new Promise((r) => setTimeout(r, 800)); // IntersectionObserver等の最終差し替え待ち

  // ---- 本文に混入する非本文要素をDOMから除去 ----
  // 音声プレーヤーとニュースレター勧誘はReadabilityが本文と判定してしまう位置にあり、
  // PDFに「Listen to this story / AI Narrated / 0:00 / 0:00」や購読案内が残る。
  // 抽出後の文字列置換は本文を巻き添えにしやすいので、抽出前にDOMから外す。
  const cleaned = await page.evaluate((junkTextSrc) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const out = { player: 0, promo: 0 };

    // 1) 音声プレーヤー。Economistは <audio> と「Listen to this story」「AI Narrated」の
    //    ラベルを小さなコンテナにまとめている。再生時間表示(0:00 / 0:00)はネイティブ
    //    コントロールのshadow DOM由来なので、<audio>ごと外せば一緒に消える。
    for (const media of document.querySelectorAll("audio, video")) {
      let target = media;
      // ラベルを巻き取れるところまで親をたどる。本文を含む器は絶対に消さないため、
      // 「<p>を含まない」「テキストが十分短い」の両方を満たす間だけ上がる。
      for (let i = 0; i < 4; i++) {
        const p = target.parentElement;
        if (!p || /^(BODY|MAIN|ARTICLE|SECTION)$/.test(p.tagName)) break;
        if (p.querySelector("p")) break;
        if (norm(p.textContent).length > 200) break;
        target = p;
      }
      target.remove();
      out.player++;
    }
    // <audio>を持たないプレーヤー実装向けの保険。ラベル完全一致の最小要素だけを消す
    // (部分一致で親ごと消すと本文が飛ぶ)。
    const LABEL = /^(listen to this story|ai[\s-]*narrated)$/i;
    for (const el of document.querySelectorAll("figcaption, span, div, p, button")) {
      if (!el.isConnected) continue;
      if (!LABEL.test(norm(el.textContent))) continue;
      if ([...el.children].some((c) => LABEL.test(norm(c.textContent)))) continue; // 最小要素に限定
      el.remove();
      out.player++;
    }

    // 2) 末尾のニュースレター勧誘。本文中にも "sign up" は出うるので、必ず位置で限定する
    //    — Economistは本文の終わりを ■ (U+25A0) で示すので、その後ろだけを対象にする。
    //    __NEXT_DATA__ のJSONにも ■ が入っているため script/style は走査から外す。
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (nd) =>
        nd.parentElement && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(nd.parentElement.tagName)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    let endNode = null;
    let nd;
    while ((nd = walker.nextNode())) if (nd.nodeValue.includes("■")) endNode = nd;
    const endEl = endNode?.parentElement || null;

    if (endEl) {
      // 勧誘特有の言い回しに限定する。単に "newsletter" を含むだけの関連記事見出し
      // (「Plot Twist newsletter: ...」等)を巻き込まないため。
      const patterns = [
        "\\bsign up (?:to|for)\\b",
        "subscriber[-\\s]only\\b",
        "\\b(?:weekly|daily|monthly)\\b[^.]{0,40}\\bnewsletter\\b",
      ];
      if (junkTextSrc) patterns.push(junkTextSrc);
      const PROMO = new RegExp(patterns.join("|"), "i");
      const hits = [];
      for (const el of document.querySelectorAll("p, div, section, aside")) {
        if (!(endEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        if (el.contains(endEl)) continue;
        const t = norm(el.textContent);
        if (!t || t.length > 400 || !PROMO.test(t)) continue;
        hits.push(el);
      }
      // 勧誘カードは入れ子になっているので、一番外側だけを消してカードごと落とす
      for (const el of hits) {
        if (hits.some((o) => o !== el && o.contains(el))) continue;
        el.remove();
        out.promo++;
      }
    }
    return out;
  }, site.junkText?.source ?? null);
  if (cleaned.player || cleaned.promo)
    console.log(`本文の残骸を除去: プレーヤー${cleaned.player}件 / 購読案内${cleaned.promo}件`);

  // ---- グラフの位置にマーカーを挿入 ----
  // The Economistのグラフは多くが infographics.economist.com の iframe、または <figure> 内の画像。
  // Readabilityはこれらを「本文ではない」と判断して削除してしまう(本文だけ残りグラフが消える)。
  // そこで各グラフ候補の直前に一意なマーカー段落を挿入する。マーカー(テキスト)はReadabilityに
  // 残るので、抽出後に本文中のマーカーを実際のグラフ画像へ置き換えれば、正しい位置に差し込める。
  // 本文外(広告・関連記事)の候補はマーカーが残らないため、自動的に除外される。
  // 正規表現はevaluateに直接渡せない(別コンテキスト)ので source 文字列で渡して組み直す
  const candidates = await page.evaluate((chartFrameSrc) => {
    const list = [];
    // 遅延読み込みのプレースホルダ(例: image-placeholder.svg)を実画像と誤認しないための判定。
    // プレースホルダURLをグラフのsrcとして記録すると、後段で本物の画像と取り違えて白紙になる。
    const isPlaceholder = (u) =>
      !u ||
      u.startsWith("data:") ||
      // キーワード直後に区切り(. / ? # または末尾)を要求し、'spacer-chart.png' のような
      // 正当なファイル名を誤ってプレースホルダ扱いしないようにする(image-placeholder.svg等は引き続き一致)。
      /\b(blank|placeholder|spacer|1x1|transparent)(?:\.|\/|\?|#|$)/i.test(u);
    const chartFrameRe = new RegExp(chartFrameSrc, "i");
    const isChartFrame = (s) => chartFrameRe.test(s);
    const mark = (el, kind, src) => {
      const idx = list.length;
      el.setAttribute("data-rescue", String(idx));
      const m = document.createElement("p");
      m.textContent = `[[CHART_${idx}]]`;
      el.parentNode.insertBefore(m, el);
      list.push({ idx, kind, src: src || null });
    };
    // インタラクティブ・グラフ(iframe埋め込み)
    for (const f of document.querySelectorAll("iframe")) {
      const s = f.getAttribute("src") || "";
      const r = f.getBoundingClientRect();
      if (isChartFrame(s) && r.width >= 200 && r.height >= 120) mark(f, "shot", s);
    }
    // 静的グラフ(figure内の画像)
    for (const fig of document.querySelectorAll("figure")) {
      if (fig.closest("[data-rescue]")) continue;
      const r = fig.getBoundingClientRect();
      if (r.width < 200 || r.height < 120) continue;
      const img = fig.querySelector("img");
      // 実際に表示中の画像URL(currentSrc)を優先。プレースホルダは実画像扱いしない。
      const src = img && [img.currentSrc, img.getAttribute("src")].find((u) => u && !isPlaceholder(u));
      if (src) mark(fig, "img", src);
      // 実URLが取れない画像グラフ(プレースホルダのまま等)やSVG/canvasは、表示をスクショして救済
      else if (img || fig.querySelector("svg, canvas")) mark(fig, "shot", null);
    }
    // figure外の大きな単独SVG/canvasチャート
    for (const el of document.querySelectorAll("svg, canvas")) {
      if (el.closest("figure") || el.closest("[data-rescue]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 250 && r.height >= 150) mark(el, "shot", null);
    }
    return list;
  }, site.chartFrame.source);

  // Readabilityをページに注入して本文抽出
  const readabilityPath = require.resolve("@mozilla/readability/Readability.js");
  await page.addScriptTag({ content: readFileSync(readabilityPath, "utf8") });

  const article = await page.evaluate(() => {
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
    const hint = site.loginUrl
      ? `\`node pdf.mjs --login ${site.alias}\` を試してください。`
      : "このサイトはログイン定義がないため、ブラウザで開ける記事か確認してください。";
    throw new Error(`本文を抽出できませんでした。未ログインまたはpaywallの可能性があります。${hint}`);
  }

  // ---- 本文に残ったマーカーを実際のグラフ画像に置き換える ----
  // マーカーが本文(article.content)に残っている候補=本文内のグラフ。これらだけを画像化して
  // 差し込む。広告や関連記事はマーカーが残らないので素通り(=除外)される。
  let rescued = 0;
  for (const c of candidates) {
    const token = `[[CHART_${c.idx}]]`;
    if (!article.content.includes(token)) continue; // 本文外は除外
    let dataUri = null;
    if (c.kind === "img" && c.src) {
      // Readabilityが既にこの画像を本文に残していれば二重挿入を防ぐ(静的グラフ記事対策)
      const key = c.src.split(/[?#]/)[0].split("/").pop().replace(/\.[a-z0-9]+$/i, "");
      if (key && article.content.includes(key)) {
        article.content = article.content.split(token).join(""); // マーカーだけ除去
        continue;
      }
      // 画像グラフ: 認証済みページ内で取得してデータURI化(レンダリング時の再取得失敗を防ぐ)
      dataUri = await page.evaluate(async (src) => {
        try {
          const res = await fetch(src, { credentials: "include" });
          if (!res.ok) return null;
          const blob = await res.blob();
          return await new Promise((resolve) => {
            const fr = new FileReader();
            fr.onloadend = () => resolve(fr.result);
            fr.onerror = () => resolve(null);
            fr.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      }, c.src);
    }
    if (!dataUri) {
      // iframe/SVG/canvas、または画像取得失敗時: 表示そのものをスクリーンショットして画像化
      try {
        const handle = await page.$(`[data-rescue="${c.idx}"]`);
        if (handle) {
          await handle.evaluate((el) => el.scrollIntoView({ block: "center" }));
          await new Promise((r) => setTimeout(r, 600)); // iframe内グラフの描画安定待ち
          const b64 = await handle.screenshot({ encoding: "base64", type: "png" });
          dataUri = `data:image/png;base64,${b64}`;
        }
      } catch {
        // 失敗時はマーカーを空に置換し、本文だけ残す
      }
    }
    const replacement = dataUri ? `<img src="${dataUri}" alt="chart">` : "";
    article.content = article.content.split(token).join(replacement);
    if (dataUri) rescued++;
  }
  console.log(`グラフ救済: ${rescued}/${candidates.length}件`);

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
  header { border-bottom: 2px solid ${site.accent}; margin-bottom: 1.4em; padding-bottom: 0.8em; }
  .site { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 9pt;
          letter-spacing: 0.08em; text-transform: uppercase; color: ${site.accent}; }
  h1 { font-size: 22pt; line-height: 1.25; margin: 0.3em 0 0.2em; }
  .meta { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #666; }
  img, figure { max-width: 100%; height: auto; margin: 1em auto; display: block; }
  /* グラフが大きくてもページ境界で途切れず、1ページに収まるよう調整 */
  img, figure, svg { break-inside: avoid; page-break-inside: avoid; }
  img { max-height: 230mm; object-fit: contain; }
  figcaption { font-size: 9.5pt; color: #666; text-align: center; }
  h2, h3 { line-height: 1.3; margin-top: 1.6em; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #444; }
  a { color: inherit; text-decoration: none; }
  p { margin: 0 0 0.9em; }
</style>
</head>
<body>
  <header>
    <div class="site">${site.name || article.siteName}</div>
    <h1>${article.title}</h1>
    <div class="meta">${[article.byline, dateStr].filter(Boolean).join(" · ")}</div>
  </header>
  ${article.content}
</body>
</html>`;

  const renderPage = await browser.newPage();
  // 元ページのCookieを引き継ぐ(CDNが認証/Refererを見てグラフ画像を弾くのを防ぐ)
  try {
    const cookies = await page.cookies();
    if (cookies.length) await renderPage.setCookie(...cookies);
  } catch {}
  await renderPage.setContent(html, { waitUntil: "networkidle0", timeout: 60_000 });
  // 画像のデコード完了を待つ
  await renderPage.evaluate(() =>
    Promise.allSettled([...document.images].map((i) => i.decode().catch(() => {})))
  );
  // 読み込めなかった画像があれば警告(グラフが空のまま出力されるのを検知できるように)
  const failedImgs = await renderPage.evaluate(() =>
    [...document.images]
      // 幅・高さの両方を確認(高さ0の部分デコード=実質白紙、を幅>0だけでは見逃すため)
      .filter((i) => !(i.complete && i.naturalWidth > 2 && i.naturalHeight > 2))
      .map((i) => i.src)
  );
  if (failedImgs.length) {
    console.warn(`警告: ${failedImgs.length}枚の画像を読み込めませんでした(グラフが欠ける可能性があります):`);
    for (const s of failedImgs.slice(0, 5)) console.warn(`  - ${s}`);
  }

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
