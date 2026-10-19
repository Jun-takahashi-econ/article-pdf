// extract.js — 記事タブの中(拡張機能専用の隔離された実行環境)で動き、本文とグラフを抜き出して
// PDF用のHTMLを組み立てる。本文の抽出はReadabilityに任せ、Readabilityが落としてしまう
// グラフ・冒頭写真の救済と、本文に紛れ込む音声プレーヤー・勧誘の除去をここで行う。
//
// 開いているページは書き換えない。読者が見ているタブそのものが対象なので、マーカー
// ([[CHART_0]])の挿入や音声プレーヤーの除去を実ページに行うと読書画面が崩れる。
// 位置・大きさの計測(レイアウトが要る)だけを実ページで行い、書き換えはすべて複製したDOMに行う。
(() => {
  if (globalThis.__articlePdf) return;

  // ---- サイト定義 ----
  // サイト固有の知識はここだけに置く。新しい媒体はエントリを1つ足せば動く。
  // 未定義サイトでも DEFAULT_SITE で汎用ツールとして成立する(本文抽出はReadability任せ)。
  //
  // og:image は冒頭画像の代わりに使わない。og:image は「記事を代表する画像」であって
  // 「冒頭に表示されている画像」とは限らず、実測ではEconomistのgraphic-detail記事で
  // 本文1枚目のグラフのPNGが入っていた(og:image=20260620_WOT187.png ↔ 本文のiframe 20260620_WOC187)。
  // 使うと冒頭にグラフが二重に出る。
  const DEFAULT_SITE = {
    name: null, // null なら Readability の siteName を使う
    accent: "#333333",
    chartFrame: /datawrapper|flourish|flo\.uri\.sh|infogram/i,
    // 本文の終わり以降で落としたい、そのサイト特有の勧誘ブロックの言い回し。
    // 汎用の勧誘パターン(sign up / subscriber-only / newsletter)は常に適用される。
    junkText: null,
    // 本文の終わりを示す記号(Economistの ■ など)。位置の基準として最も正確なので
    // 持っているサイトでは使う。null のサイトは「本文らしい最後の段落」で代用する。
    bodyEndMark: null,
    // 記事の背景色。ページから読み取れなかったときだけ使う(pageBackground 参照)。null なら白。
    background: null,
  };
  const SITES = {
    "economist.com": {
      name: "The Economist",
      accent: "#e3120b",
      chartFrame: /infographics\.economist\.com|interactive\.economist\.com|datawrapper/i,
      // 紙版の号を宣伝するカード(表紙画像つきで1ページ丸ごと使う)。
      // 「This article appeared in the ... print edition」の行は出典情報なので残す。
      junkText: /discover stories from this section|explore the edition/i,
      bodyEndMark: "■",
    },
    "ft.com": {
      name: "Financial Times",
      accent: "#0d7680",
      // 実機で確認した範囲では、FTの図表は figure.n-content-image の静的画像で配信されており
      // グラフのiframeは出てこなかった(静的画像は figure の経路で拾える)。iframeを使う経路は
      // Flourish — ft.comのページ設定に useFlourish / useFlourishIFrame のフラグがある — と、
      // FT自身のグラフィックスホスト ig.ft.com に絞る。Datawrapper/Infogramは痕跡がないので外した。
      chartFrame: /ig\.ft\.com|flo\.uri\.sh|public\.flourish\.studio/i,
      background: "#fff1e5", // FTの紙面色(ベージュ)
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

  // srcset から最大解像度の候補URLを取り出す(グラフは高解像度の方が読みやすい)。
  // 候補の区切りは「カンマ + 空白」。単純な split(",") は使えない — EconomistのCloudflare
  // 画像URL(/cdn-cgi/image/width=1424,quality=100,format=auto/…)はURL自体にカンマを含むため、
  // 1つのURLが断片に割れて "format=auto/…/FNC219.png" のような壊れた相対URLになり、
  // 404 → Next.jsが placeholder.svg に差し替え、グラフが白紙で出力される(過去の不具合の根本原因)。
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

  // 画像は記事ページの中で取得してデータURI化する(PDFへの印刷は拡張機能のタブで行うので、
  // そこから読み込ませるとCDNが認証やRefererを見て弾くことがある)。
  // 認証付きを先に試す(Economistの画像は記事と同一オリジンなのでこれで通る)。FTのように画像が
  // 別ホストのCDN(images.ft.com)にある場合、認証付きリクエストにはCORSが許可されず fetch が
  // 例外になるが、認証なしなら許可される。両方試す。
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
    await sleep(600); // iframe内グラフの描画安定待ち
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

  // 記事の背景色(FTのベージュ等)。本文の段落から親へたどり、最初に色が塗られている要素の
  // 背景色を使う。暗い色(ダークモード等)はPDFの黒い文字と合わないので使わない(null = 白)。
  function pageBackground() {
    const start =
      [...document.querySelectorAll("p")].find(
        (p) => !p.closest("nav, footer, aside") && norm(p.textContent).length >= 200
      ) || document.body;
    for (let el = start; el; el = el.parentElement) {
      const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(
        getComputedStyle(el).backgroundColor
      );
      if (!m) continue;
      const alpha = m[4] === undefined ? 1 : parseFloat(m[4]) / (m[5] ? 100 : 1);
      if (alpha < 0.5) continue; // 透明 = その親の色が見えている
      const [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.round(parseFloat(v)));
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return luminance > 0.75 ? `rgb(${r}, ${g}, ${b})` : null;
    }
    return null;
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
  // 音声プレーヤーとニュースレター勧誘はReadabilityが本文と判定してしまう位置にあり、
  // PDFに「Listen to this story / AI Narrated / 0:00 / 0:00」や購読案内が残る。
  // 抽出後の文字列置換は本文を巻き添えにしやすいので、抽出前にDOMから外す。
  function stripJunk(doc, site) {
    const out = { player: 0, promo: 0 };

    // 1) 音声プレーヤー。Economistは <audio> と「Listen to this story」「AI Narrated」の
    //    ラベルを小さなコンテナにまとめている。再生時間表示(0:00 / 0:00)はネイティブ
    //    コントロールのshadow DOM由来なので、<audio>ごと外せば一緒に消える。
    for (const media of doc.querySelectorAll("audio, video")) {
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
    for (const el of doc.querySelectorAll("figcaption, span, div, p, button")) {
      if (!el.isConnected) continue;
      if (!LABEL.test(norm(el.textContent))) continue;
      if ([...el.children].some((c) => LABEL.test(norm(c.textContent)))) continue; // 最小要素に限定
      el.remove();
      out.player++;
    }

    // 2) 末尾のニュースレター勧誘。本文中にも "sign up" は出うるので、必ず位置で限定する。
    //    勧誘特有の言い回しに限定する。単に "newsletter" を含むだけの関連記事見出し
    //    (「Plot Twist newsletter: ...」等)を巻き込まないため。
    const patterns = [
      "\\bsign up (?:to|for)\\b",
      "subscriber[-\\s]only\\b",
      "\\b(?:weekly|daily|monthly)\\b[^.]{0,40}\\bnewsletter\\b",
    ];
    if (site.junkText) patterns.push(site.junkText.source);
    const PROMO = new RegExp(patterns.join("|"), "i");

    // 位置の基準になる「本文の終わり」を決める。末尾マーク(Economistの ■)があれば
    // それが最も正確。無い媒体(FT等)ではマークを待っても永久に来ないので、
    // 本文らしい最後の段落で代用する。ここで諦めると除去そのものが起きず、
    // 「SITESに1エントリ足せば動く」という前提が媒体ごとに崩れてしまう。
    const endElFromMark = () => {
      if (!site.bodyEndMark) return null;
      // __NEXT_DATA__ のJSONにも ■ が入っているため script/style は走査から外す。
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
    // 最後の「まとまった散文の段落」を本文の終わりとみなす。勧誘文自体を基準にすると
    // それが除去対象から外れてしまうので、PROMOに当たる段落は基準に採らない。
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
      // 勧誘カードは入れ子になっているので、一番外側だけを消してカードごと落とす
      for (const el of hits) {
        if (hits.some((o) => o !== el && o.contains(el))) continue;
        el.remove();
        out.promo++;
      }
    }
    return out;
  }

  // ---- 冒頭画像(hero)の候補 ----
  // Readabilityは「最もスコアの高い1つの部分木」を本文とするため、スコア源になる
  // テキストを持たない冒頭写真は本文の外に置かれ、マーカー方式では拾えない
  // (実測: Economistの冒頭写真のfigureは本文コンテナとは別サブツリーにある)。
  // そこでマーカー方式とは独立に探し、PDFではヘッダー直後へ差し込む。
  // 除去対象の中にある画像を選ばないよう、候補を上から順に返し、呼び出し側で絞る。
  function heroCandidates(realOf) {
    // figcaptionは説明と出典を別要素に分けていることがあり、textContentをそのまま読むと
    // 区切りが失われて "…webPhotograph: Reuters" のように繋がる。ブロック単位で読んで繋ぐ。
    const captionOf = (fig) => {
      let fc = fig?.querySelector("figcaption");
      if (!fc) return "";
      // 単なるラッパーで包まれているだけなら中に降りる
      for (let i = 0; i < 3 && fc.children.length === 1 && fc.children[0].textContent === fc.textContent; i++)
        fc = fc.children[0];
      const parts = [...fc.childNodes]
        .map((n) => norm(n.nodeType === Node.TEXT_NODE ? n.nodeValue : n.textContent))
        .filter(Boolean);
      return parts.join(" / ") || norm(fc.textContent);
    };
    // 冒頭画像は見出しの近くにある。本文の途中に出てくる図表を拾わないよう縦位置で絞る
    // (実測: 冒頭写真は見出しの240〜300px下、本文1枚目のグラフは1300px以上下)。
    const h1 = document.querySelector("h1");
    const limit = (h1 ? docTop(h1) : 0) + 1500;
    const list = [];
    for (const img of document.querySelectorAll("img")) {
      if (img.closest("nav, footer, aside")) continue;
      if (img.closest('[class*="masthead" i], [class*="advert" i], [class*="related" i]')) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 300 || r.height < 150) continue; // ロゴ・アイコン・サムネイルを除外
      const top = docTop(img);
      if (top > limit) continue;
      const src = realOf(img);
      if (!src) continue;
      // 「Chart: ...」等のキャプションを持つものは図表。冒頭画像として扱わない
      // (グラフ候補の側が本文の正しい位置に差し込む)。
      const cap = captionOf(img.closest("figure"));
      if (/^(chart|map|table|graphic|figure)\s*:/i.test(cap)) continue;
      list.push({ img, src, top, cap });
    }
    return list.sort((a, b) => a.top - b.top);
  }

  // ---- グラフ候補 ----
  // The Economistのグラフは多くが infographics.economist.com の iframe、または <figure> 内の画像。
  // Readabilityはこれらを「本文ではない」と判断して削除してしまう(本文だけ残りグラフが消える)。
  // そこで各グラフ候補の直前に一意なマーカー段落を挿入する。マーカー(テキスト)はReadabilityに
  // 残るので、抽出後に本文中のマーカーを実際のグラフ画像へ置き換えれば、正しい位置に差し込める。
  // 本文外(広告・関連記事)の候補はマーカーが残らないため、自動的に除外される。
  // ここでは候補を集めるだけ(マーカーの挿入は複製DOMに対して行う)。
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
    // インタラクティブ・グラフ(iframe埋め込み)
    for (const f of document.querySelectorAll("iframe")) {
      const s = f.getAttribute("src") || "";
      const r = f.getBoundingClientRect();
      if (chartFrame.test(s) && r.width >= 200 && r.height >= 120) mark(f, "shot", s);
    }
    // 静的グラフ(figure内の画像)
    for (const fig of document.querySelectorAll("figure")) {
      if (insideMarked(fig)) continue;
      const r = fig.getBoundingClientRect();
      if (r.width < 200 || r.height < 120) continue;
      const img = fig.querySelector("img");
      const src = img && realOf(img);
      if (src) mark(fig, "img", src);
      // 実URLが取れない画像グラフ(プレースホルダのまま等)やSVG/canvasは、表示をスクショして救済
      else if (img || fig.querySelector("svg, canvas")) mark(fig, "shot", null);
    }
    // figure外の大きな単独SVG/canvasチャート
    for (const el of document.querySelectorAll("svg, canvas")) {
      if (el.closest("figure") || insideMarked(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 250 && r.height >= 150) mark(el, "shot", null);
    }
    return list;
  }

  const pageHtml = (site, article, dateStr, heroHtml, background) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(article.title)}</title>
<style>
  @page { margin: 0; }
  /* 記事ページの背景色。@page の余白が0なので、ページの端まで塗られる */
  ${background ? `html, body { background: ${background}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }` : ""}
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
  /* 冒頭画像は本文の図表より控えめに。1ページ目が写真で埋まらないよう高さを抑える */
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
    const background = pageBackground() || site.background;

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
      // <time datetime> を最優先。無い場合は Readability が article:published_time / JSON-LD から
      // 拾った publishedTime を使う(<time>の表示文字列は "3 hours ago" 等になりうるので最後の手段)。
      date: time?.getAttribute("datetime") || parsed.publishedTime || time?.textContent || "",
    };

    // ---- 本文に残ったマーカーを実際のグラフ画像に置き換える ----
    // マーカーが本文に残っている候補=本文内のグラフ。これらだけを画像化して差し込む。
    // 冒頭画像がここで本文に差し込まれた場合、ヘッダーには入れない(二重になるため)。
    // ただしその判定は画像が実際に本文へ入ったと確認できてからにする。マーカーが残っただけでは
    // 差し込みの成否は決まらず(取得失敗ならマーカーは空文字になる)、先に判定すると
    // ヘッダー側のフォールバックまで潰して写真が消える。
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

    // ファイル名は YYYY-MM-DD_slug.pdf に揃えたいので、ISO形式でない日付は採用しない
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
      html: pageHtml(site, article, dateStr, heroHtml, background),
      filename,
      stats: { charts: rescued, chartCandidates: list.length, hero: heroStatus, background, ...cleaned },
    };
  }

  globalThis.__articlePdf = { run, toast };
})();
