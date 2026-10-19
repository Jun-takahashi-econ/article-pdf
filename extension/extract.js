// extract.js — 記事タブの中(拡張機能専用の隔離された実行環境)で動き、本文とグラフを抜き出して
// PDF用のHTMLを組み立てる。処理内容は pdf.mjs の抽出部分の移植。
//
// pdf.mjs との違いは、開いているページを書き換えないこと。拡張機能では読者が見ている
// タブそのものが対象なので、マーカー([[CHART_0]])の挿入や音声プレーヤーの除去を実ページに
// 行うと読書画面が崩れる。位置・大きさの計測(レイアウトが要る)だけを実ページで行い、
// 書き換えはすべて複製したDOMに対して行う。
(() => {
  if (globalThis.__articlePdf) return;

  // ---- サイト定義(pdf.mjs の SITES と同じ内容。ログイン関連は拡張機能では不要) ----
  const DEFAULT_SITE = {
    name: null,
    accent: "#333333",
    chartFrame: /datawrapper|flourish|flo\.uri\.sh|infogram/i,
    junkText: null,
    bodyEndMark: null,
  };
  const SITES = {
    "economist.com": {
      name: "The Economist",
      accent: "#e3120b",
      chartFrame: /infographics\.economist\.com|interactive\.economist\.com|datawrapper/i,
      junkText: /discover stories from this section|explore the edition/i,
      bodyEndMark: "■",
    },
    "ft.com": {
      name: "Financial Times",
      accent: "#0d7680",
      chartFrame: /ig\.ft\.com|flo\.uri\.sh|public\.flourish\.studio/i,
    },
  };
  const resolveSite = (host) => {
    host = host.toLowerCase();
    for (const [domain, site] of Object.entries(SITES)) {
      if (host === domain || host.endsWith(`.${domain}`)) return { ...DEFAULT_SITE, ...site };
    }
    return { ...DEFAULT_SITE };
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const abs = (u) => {
    try { return new URL(u, location.href).href; } catch { return u; }
  };
  // 画像URLの「ファイル名(拡張子なし)」。同じ画像がCDNの変換URL越しに別表記で現れるため、
  // 抽出済み本文に既にその画像が入っているかの照合キーとして使う。
  const fileKey = (u) =>
    u.split(/[?#]/)[0].split("/").pop().replace(/\.[a-z0-9]+$/i, "");
  const docTop = (el) => Math.round(el.getBoundingClientRect().top + window.scrollY);

  // 遅延読み込みのプレースホルダ(例: image-placeholder.svg)を実画像と誤認しないための判定。
  // キーワード直後に区切りを要求し、'spacer-chart.png' のような正当なファイル名は通す。
  const isPlaceholder = (u) =>
    !u ||
    u.startsWith("data:") ||
    /\b(blank|placeholder|spacer|1x1|transparent)(?:\.|\/|\?|#|$)/i.test(u);

  // srcset から最大解像度の候補URLを取り出す。候補の区切りは「カンマ + 空白」で、
  // EconomistのCloudflare画像URL(/cdn-cgi/image/width=1424,quality=100,format=auto/…)は
  // URL自体にカンマを含むため単純な split(",") は使えない(pdf.mjs の同名関数を参照)。
  const largestFromSrcset = (srcset) => {
    if (!srcset) return null;
    let best = null;
    let bestW = -1;
    for (const part of srcset.split(/,\s+(?=\S)/)) {
      const [u, d] = part.trim().split(/\s+/);
      if (!u) continue;
      const w = d ? parseInt(d, 10) || 1 : 1;
      if (w > bestW) { bestW = w; best = u; }
    }
    return best;
  };

  // 認証付きを先に試し、別ホストのCDN(FTの images.ft.com 等)で弾かれたら認証なしで取り直す。
  const toDataUri = (blob) =>
    new Promise((resolve) => {
      const fr = new FileReader();
      fr.onloadend = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  async function fetchAsDataUri(u) {
    for (const credentials of ["include", "omit"]) {
      try {
        const res = await fetch(u, { credentials });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (!blob.size) continue;
        const dataUri = await toDataUri(blob);
        if (dataUri) return dataUri;
      } catch {
        // 次の方式で取り直す
      }
    }
    return null;
  }

  // ---- 進捗表示 ----
  // ページのスタイルの影響を受けないよう、閉じたShadow DOMの中に描く。
  let toastHost = null;
  let toastBox = null;
  let toastTimer = null;
  function toast(text, kind = "info", hideAfter = 0) {
    if (!toastHost) {
      toastHost = document.createElement("article-pdf-toast");
      const root = toastHost.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = `
        .box { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; max-width: 380px;
               padding: 10px 14px; border-radius: 8px; color: #fff; background: #333;
               font: 13px/1.5 -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
               box-shadow: 0 4px 16px rgba(0,0,0,.25); white-space: pre-wrap; overflow-wrap: anywhere; }
        .ok { background: #1b7a43; }
        .error { background: #b3261e; }`;
      toastBox = document.createElement("div");
      root.append(style, toastBox);
    }
    if (!toastHost.isConnected) document.documentElement.appendChild(toastHost);
    toastBox.className = `box ${kind}`;
    toastBox.textContent = text;
    toastHost.style.display = "";
    clearTimeout(toastTimer);
    if (hideAfter) toastTimer = setTimeout(() => toastHost.remove(), hideAfter);
  }

  // 要素の表示をスクリーンショットして画像化する(iframeのグラフ、SVG/canvas、取得に失敗した画像)。
  // 撮影はタブの「見えている範囲」しかできないため、要素を画面内に入れてから撮る。
  async function capture(el) {
    const tall = el.getBoundingClientRect().height > innerHeight * 0.9;
    el.scrollIntoView({ block: tall ? "start" : "center" });
    // 画面上部に固定表示されるヘッダーと重ならないよう、縦長の要素は少し下げる
    if (tall) window.scrollBy(0, -80);
    await sleep(600); // iframe内グラフの描画安定待ち(pdf.mjs と同じ)
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    if (toastHost) toastHost.style.display = "none"; // 進捗表示が写り込まないように
    try {
      const res = await chrome.runtime.sendMessage({
        type: "capture",
        rect: { x: r.left, y: r.top, width: r.width, height: r.height },
        viewport: { width: innerWidth, height: innerHeight },
      });
      return res?.dataUri || null;
    } catch {
      return null;
    } finally {
      if (toastHost) toastHost.style.display = "";
    }
  }

  // 複製したDOMと実ページの要素を対応づける。cloneNode は要素を同じ順序で複製するので、
  // 両方を同じ順に走査すれば1対1に対応する。
  function cloneWithMap() {
    const clone = document.cloneNode(true);
    const map = new Map();
    const a = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
    const b = clone.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
    let x;
    let y;
    while ((x = a.nextNode()) && (y = b.nextNode())) map.set(x, y);
    return { clone, map };
  }

  // ---- 本文に混入する非本文要素を(複製DOMから)除去 ----
  // 音声プレーヤーとニュースレター勧誘はReadabilityが本文と判定してしまう位置にある。
  // 詳しい判断基準は pdf.mjs の同じ処理のコメントを参照。
  function stripJunk(doc, site) {
    const out = { player: 0, promo: 0 };

    for (const media of doc.querySelectorAll("audio, video")) {
      let target = media;
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
    const LABEL = /^(listen to this story|ai[\s-]*narrated)$/i;
    for (const el of doc.querySelectorAll("figcaption, span, div, p, button")) {
      if (!el.isConnected) continue;
      if (!LABEL.test(norm(el.textContent))) continue;
      if ([...el.children].some((c) => LABEL.test(norm(c.textContent)))) continue;
      el.remove();
      out.player++;
    }

    const patterns = [
      "\\bsign up (?:to|for)\\b",
      "subscriber[-\\s]only\\b",
      "\\b(?:weekly|daily|monthly)\\b[^.]{0,40}\\bnewsletter\\b",
    ];
    if (site.junkText) patterns.push(site.junkText.source);
    const PROMO = new RegExp(patterns.join("|"), "i");

    const endElFromMark = () => {
      if (!site.bodyEndMark) return null;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (nd) =>
          nd.parentElement && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(nd.parentElement.tagName)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      let endNode = null;
      let nd;
      while ((nd = walker.nextNode())) if (nd.nodeValue.includes(site.bodyEndMark)) endNode = nd;
      return endNode?.parentElement || null;
    };
    const endElFromProse = () => {
      let last = null;
      for (const p of doc.querySelectorAll("p")) {
        if (p.closest("nav, footer, aside, form")) continue;
        const t = norm(p.textContent);
        if (t.length < 200 || PROMO.test(t)) continue;
        last = p;
      }
      return last;
    };
    const endEl = endElFromMark() || endElFromProse();

    if (endEl) {
      const hits = [];
      for (const el of doc.querySelectorAll("p, div, section, aside")) {
        if (!(endEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        if (el.contains(endEl)) continue;
        const t = norm(el.textContent);
        if (!t || t.length > 400 || !PROMO.test(t)) continue;
        hits.push(el);
      }
      for (const el of hits) {
        if (hits.some((o) => o !== el && o.contains(el))) continue;
        el.remove();
        out.promo++;
      }
    }
    return out;
  }

  // ---- 冒頭画像(hero)の候補 ----
  // Readabilityは冒頭写真を本文の外に置くため、本文とは独立に探す(pdf.mjs 参照)。
  // 除去対象の中にある画像を選ばないよう、候補を上から順に返し、呼び出し側で絞る。
  function heroCandidates(realOf) {
    const captionOf = (fig) => {
      let fc = fig?.querySelector("figcaption");
      if (!fc) return "";
      for (let i = 0; i < 3 && fc.children.length === 1 && fc.children[0].textContent === fc.textContent; i++)
        fc = fc.children[0];
      const parts = [...fc.childNodes]
        .map((n) => norm(n.nodeType === Node.TEXT_NODE ? n.nodeValue : n.textContent))
        .filter(Boolean);
      return parts.join(" / ") || norm(fc.textContent);
    };
    const h1 = document.querySelector("h1");
    const limit = (h1 ? docTop(h1) : 0) + 1500;
    const list = [];
    for (const img of document.querySelectorAll("img")) {
      if (img.closest("nav, footer, aside")) continue;
      if (img.closest('[class*="masthead" i], [class*="advert" i], [class*="related" i]')) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 300 || r.height < 150) continue;
      const top = docTop(img);
      if (top > limit) continue;
      const src = realOf(img);
      if (!src) continue;
      const cap = captionOf(img.closest("figure"));
      if (/^(chart|map|table|graphic|figure)\s*:/i.test(cap)) continue;
      list.push({ img, src, top, cap });
    }
    return list.sort((a, b) => a.top - b.top);
  }

  // ---- グラフ候補 ----
  // Readabilityはiframeや図を本文ではないと判断して落とすため、各候補の直前にマーカー段落を
  // 入れておき、抽出後にマーカーを画像へ置き換える(pdf.mjs 参照)。ここでは候補を集めるだけ。
  function chartCandidates(chartFrame, realOf) {
    const list = [];
    const marked = new Set();
    const insideMarked = (el) => {
      for (let p = el; p; p = p.parentElement) if (marked.has(p)) return true;
      return false;
    };
    const mark = (el, kind, src) => {
      marked.add(el);
      list.push({ el, kind, src: src || null });
    };
    for (const f of document.querySelectorAll("iframe")) {
      const s = f.getAttribute("src") || "";
      const r = f.getBoundingClientRect();
      if (chartFrame.test(s) && r.width >= 200 && r.height >= 120) mark(f, "shot", s);
    }
    for (const fig of document.querySelectorAll("figure")) {
      if (insideMarked(fig)) continue;
      const r = fig.getBoundingClientRect();
      if (r.width < 200 || r.height < 120) continue;
      const img = fig.querySelector("img");
      const src = img && realOf(img);
      if (src) mark(fig, "img", src);
      else if (img || fig.querySelector("svg, canvas")) mark(fig, "shot", null);
    }
    for (const el of document.querySelectorAll("svg, canvas")) {
      if (el.closest("figure") || insideMarked(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 250 && r.height >= 150) mark(el, "shot", null);
    }
    return list;
  }

  const pageHtml = (site, article, dateStr, heroHtml) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(article.title)}</title>
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
  img, figure, svg { break-inside: avoid; page-break-inside: avoid; }
  img { max-height: 230mm; object-fit: contain; }
  figcaption { font-size: 9.5pt; color: #666; text-align: center; }
  figure.hero { margin: 0 0 1.6em; }
  figure.hero img { width: 100%; max-height: 120mm; object-fit: contain; margin: 0; }
  figure.hero figcaption { font-size: 9pt; color: #666; text-align: left; margin-top: 0.4em; }
  h2, h3 { line-height: 1.3; margin-top: 1.6em; }
  blockquote { border-left: 3px solid #ccc; margin-left: 0; padding-left: 1em; color: #444; }
  a { color: inherit; text-decoration: none; }
  p { margin: 0 0 0.9em; }
</style>
</head>
<body>
  <header>
    <div class="site">${esc(site.name || article.siteName)}</div>
    <h1>${esc(article.title)}</h1>
    <div class="meta">${esc([article.byline, dateStr].filter(Boolean).join(" · "))}</div>
  </header>
  ${heroHtml}
  ${article.content}
</body>
</html>`;

  let running = false;

  async function run() {
    if (running) return { ok: false, error: "このタブは処理中です。" };
    running = true;
    const startY = window.scrollY;
    try {
      return await extract();
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    } finally {
      window.scrollTo(0, startY); // 読んでいた位置に戻す
      running = false;
    }
  }

  async function extract() {
    const site = resolveSite(location.hostname);
    // BoT対策(DataDome)の確認画面は captcha-delivery.com の iframe で出る。普段のブラウザなら
    // 画面の指示どおりに確認を済ませれば記事に戻れるので、本文抽出の失敗として扱わない。
    if (document.querySelector('iframe[src*="captcha-delivery.com"]')) {
      throw new Error("サイトの確認画面が表示されています。画面の指示に従って確認を済ませ、記事が表示されてからもう一度押してください。");
    }
    toast("記事を読み込んでいます…");

    // 遅延読み込み対策: ページ全体をスクロールして画像/グラフの読み込みを誘発する
    for (let y = 400; ; y += 400) {
      window.scrollTo(0, y);
      if (y >= document.body.scrollHeight) break;
      await sleep(120);
    }
    await sleep(800); // IntersectionObserver等の最終差し替え待ち

    // 画像の実体URLを確定させる(プレースホルダや小さいsrcset候補を避ける)。実ページは触らず控えておく。
    const realSrc = new Map();
    for (const img of document.querySelectorAll("img")) {
      const real = [
        largestFromSrcset(img.getAttribute("srcset")),
        largestFromSrcset(img.getAttribute("data-srcset")),
        img.getAttribute("data-src"),
        img.getAttribute("data-original"),
        img.getAttribute("data-lazy-src"),
        img.currentSrc,
        img.getAttribute("src"),
      ].find((u) => u && !isPlaceholder(u));
      if (real) realSrc.set(img, abs(real));
    }
    const realOf = (img) => realSrc.get(img) || null;

    const heroes = heroCandidates(realOf);
    const charts = chartCandidates(site.chartFrame, realOf);

    // ---- ここから先の書き換えはすべて複製DOMに対して行う ----
    const { clone, map } = cloneWithMap();
    if (toastHost) map.get(toastHost)?.remove();
    for (const [img, src] of realSrc) {
      const c = map.get(img);
      if (!c) continue;
      c.setAttribute("src", src);
      c.removeAttribute("srcset"); // 可変ソースは不要(誤って小さい/空を選ばせない)
    }
    const cleaned = stripJunk(clone, site);

    const hero = heroes.find((h) => map.get(h.img)?.isConnected) || null;

    const list = [];
    for (const c of charts) {
      const ce = map.get(c.el);
      if (!ce?.isConnected) continue; // 勧誘カード等と一緒に除去された候補
      const idx = list.length;
      const m = clone.createElement("p");
      m.textContent = `[[CHART_${idx}]]`;
      ce.parentNode.insertBefore(m, ce);
      list.push({ ...c, idx, isHero: !!hero && c.el.contains(hero.img) });
    }

    const parsed = new Readability(clone).parse();
    if (!parsed || !parsed.content || parsed.content.length < 500) {
      throw new Error("本文を抽出できませんでした。記事が全文表示されているか(ログイン状態)を確認してください。");
    }
    const time = document.querySelector("time");
    const article = {
      title: parsed.title,
      byline: parsed.byline || "",
      content: parsed.content,
      siteName: parsed.siteName || location.hostname,
      // <time datetime> を最優先(pdf.mjs と同じ優先順位)
      date: time?.getAttribute("datetime") || parsed.publishedTime || time?.textContent || "",
    };

    // ---- 本文に残ったマーカーを実際のグラフ画像に置き換える ----
    let rescued = 0;
    let heroInBody = false;
    const inBody = list.filter((c) => article.content.includes(`[[CHART_${c.idx}]]`));
    for (const [i, c] of inBody.entries()) {
      toast(`グラフを取り込んでいます (${i + 1}/${inBody.length})…`);
      const token = `[[CHART_${c.idx}]]`;
      let dataUri = null;
      if (c.kind === "img" && c.src) {
        // Readabilityが既にこの画像を本文に残していれば二重挿入を防ぐ
        const key = fileKey(c.src);
        if (key && article.content.includes(key)) {
          article.content = article.content.split(token).join("");
          if (c.isHero) heroInBody = true;
          continue;
        }
        dataUri = await fetchAsDataUri(c.src);
      }
      if (!dataUri) dataUri = await capture(c.el);
      const replacement = dataUri ? `<img src="${dataUri}" alt="chart">` : "";
      article.content = article.content.split(token).join(replacement);
      if (dataUri) {
        rescued++;
        if (c.isHero) heroInBody = true; // 差し込めたときだけヘッダー側を抑止する
      }
    }

    // Readabilityが残した画像も埋め込んでおく。PDFへの印刷は拡張機能のタブで行うので、
    // 記事サイトの画像をそこから読み込ませない(認証やRefererで弾かれることがある)。
    const holder = document.createElement("template");
    holder.innerHTML = article.content;
    for (const img of holder.content.querySelectorAll("img")) {
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
      img.removeAttribute("loading");
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) continue;
      const dataUri = await fetchAsDataUri(abs(src));
      if (dataUri) img.setAttribute("src", dataUri);
    }
    article.content = holder.innerHTML;

    // ---- 冒頭画像 ----
    // 写真は本質的な要素ではないため、取得に失敗しても静かに諦める。
    let heroHtml = "";
    let heroStatus = "none";
    if (hero && !heroInBody) {
      const key = fileKey(hero.src);
      if (key && article.content.includes(key)) {
        heroStatus = "in-body";
      } else {
        const dataUri = await fetchAsDataUri(hero.src);
        if (dataUri) {
          const cap = hero.cap ? `<figcaption>${esc(hero.cap)}</figcaption>` : "";
          heroHtml = `<figure class="hero"><img src="${dataUri}" alt="">${cap}</figure>`;
          heroStatus = "added";
        } else {
          heroStatus = "failed";
        }
      }
    }

    // ファイル名は YYYY-MM-DD_slug.pdf(pdf.mjs と同じ形式)
    const rawDate = article.date || "";
    const isoDate = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0, 10) : "";
    const dateStr = isoDate || rawDate.slice(0, 40);
    const slug = article.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    const filename = `${isoDate || new Date().toISOString().slice(0, 10)}_${slug || "article"}.pdf`;

    return {
      ok: true,
      html: pageHtml(site, article, dateStr, heroHtml),
      filename,
      stats: { charts: rescued, chartCandidates: list.length, hero: heroStatus, ...cleaned },
    };
  }

  globalThis.__articlePdf = { run, toast };
})();
