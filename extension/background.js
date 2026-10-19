// background.js — ツールバーのボタン(またはショートカット)で、開いている記事をPDFに保存する。
//
// EconomistはBoT対策(DataDome)で自動操縦ブラウザを止めるため、pdf.mjs のようにブラウザを
// 自動操縦して記事を開く方式では、短時間に続けて保存するとブロックされる。拡張機能は
// 読者が普段のブラウザで開いたページをそのまま読むだけなので、自動操縦の痕跡が出ない。
// PDFへの印刷は拡張機能自身のタブ(render.html)で行い、記事のタブには関与させない。

const jobs = new Map(); // render.html に渡す整形済みHTML(id → job)
const busy = new Set(); // 処理中の記事タブ(二重押し防止)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 記事タブの中の進捗表示(extract.js が提供)を呼ぶ。表示できなくても処理は止めない。
const toast = (tabId, text, kind = "info", hideAfter = 0) =>
  chrome.scripting
    .executeScript({
      target: { tabId },
      func: (t, k, h) => globalThis.__articlePdf?.toast(t, k, h),
      args: [text, kind, hideAfter],
    })
    .catch(() => {});

const badge = (tabId, text, color) => {
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (color) chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
};

const DEFAULT_TITLE = "この記事をPDFに保存";
const NOT_ARTICLE = "記事のページを開いてから押してください。ブラウザの設定画面や新しいタブなどは読み取れません。";

// 記事タブに進捗表示を出せないページ(chrome:// の設定画面など)では、ボタンの下に吹き出しを
// 出して理由を伝える。吹き出しはボタンを押した直後にしか開けないので、すぐに呼ぶこと。
async function notice(tab, text) {
  badge(tab.id, "!", "#b3261e");
  chrome.action.setTitle({ tabId: tab.id, title: `Article PDF: ${text}` }).catch(() => {});
  try {
    await chrome.action.setPopup({ tabId: tab.id, popup: `notice.html#${encodeURIComponent(text)}` });
    await chrome.action.openPopup({ windowId: tab.windowId });
  } catch {
    // 吹き出しを開けない古いブラウザでは、ボタンの「!」とマウスを乗せたときの説明で伝える
  } finally {
    // 次にボタンを押したときは、また保存処理が動くように戻す
    await chrome.action.setPopup({ tabId: tab.id, popup: "" }).catch(() => {});
  }
}

async function savePdf(tab) {
  chrome.action.setTitle({ tabId: tab.id, title: DEFAULT_TITLE }).catch(() => {});
  if (tab.url && !/^https?:/i.test(tab.url)) return notice(tab, NOT_ARTICLE);
  if (busy.has(tab.id)) return toast(tab.id, "このタブは処理中です。", "info", 3000);
  busy.add(tab.id);
  badge(tab.id, "…", "#555555");
  let injected = false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["vendor/Readability.js", "extract.js"],
    });
    injected = true;
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.__articlePdf.run(),
    });
    if (!result?.ok) throw new Error(result?.error || "本文を抽出できませんでした。");
    console.log("抽出結果:", result.filename, result.stats);

    const id = crypto.randomUUID();
    const job = { html: result.html, filename: result.filename, sourceTabId: tab.id, renderTabId: null };
    jobs.set(id, job);
    await toast(tab.id, "PDFを作成しています…");
    // 印刷用のタブは裏で開く(読んでいる記事の表示は切り替えない)
    const renderTab = await chrome.tabs.create({
      url: chrome.runtime.getURL(`render.html#${id}`),
      active: false,
      index: tab.index + 1,
      openerTabId: tab.id,
    });
    job.renderTabId = renderTab.id;
  } catch (err) {
    busy.delete(tab.id);
    // ページに入り込めなかった(Chromeのウェブストア、PDFビューアなど)ときは、進捗表示も出せない
    if (!injected) return notice(tab, NOT_ARTICLE);
    badge(tab.id, "!", "#b3261e");
    await toast(tab.id, `保存できませんでした:\n${err?.message || err}`, "error", 10000);
  }
}

chrome.action.onClicked.addListener(savePdf);

// 記事タブの見えている範囲を撮影し、指定の矩形で切り抜く。
async function captureRect(tab, { rect, viewport }) {
  // 撮影できるのは「そのウィンドウで今表示されているタブ」だけ。処理中に別のタブへ
  // 切り替えられた場合に、別のページを写してしまわないよう確認する。
  const current = await chrome.tabs.get(tab.id);
  if (!current.active) return { error: "記事のタブが表示されていないため撮影できませんでした" };

  let dataUrl = null;
  for (let i = 0; !dataUrl; i++) {
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    } catch (err) {
      if (i >= 2) throw err;
      await sleep(600); // 撮影は1秒あたりの回数に上限がある
    }
  }
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  // 撮影画像はデバイスピクセル単位なので、CSSピクセルとの倍率を実寸から求める
  const scale = bmp.width / viewport.width;
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(viewport.width, rect.x + rect.width);
  const y1 = Math.min(viewport.height, rect.y + rect.height);
  const sx = Math.round(x0 * scale);
  const sy = Math.round(y0 * scale);
  const sw = Math.min(bmp.width - sx, Math.round((x1 - x0) * scale));
  const sh = Math.min(bmp.height - sy, Math.round((y1 - y0) * scale));
  if (sw < 2 || sh < 2) return { error: "撮影範囲が空です" };

  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { dataUri: `data:image/png;base64,${btoa(bin)}` };
}

async function finishJob(msg, renderTabId) {
  const job = jobs.get(msg.id);
  if (!job) return;
  jobs.delete(msg.id);
  const { sourceTabId } = job;
  busy.delete(sourceTabId);
  if (msg.ok) {
    badge(sourceTabId, "");
    const notes = [
      msg.note,
      msg.failedImages ? `(${msg.failedImages}枚の画像を読み込めませんでした)` : "",
    ].filter(Boolean);
    await toast(sourceTabId, [`保存しました:\n${msg.path}`, ...notes].join("\n"), "ok", notes.length ? 15000 : 8000);
    chrome.tabs.remove(renderTabId).catch(() => {});
  } else if (msg.fallback) {
    // デバッガーが使えない環境では、印刷画面から保存してもらう
    badge(sourceTabId, "");
    await toast(
      sourceTabId,
      "自動保存ができない環境のため、印刷画面を開きました。送信先で「PDFに保存」を選んでください。",
      "info",
      12000
    );
  } else {
    badge(sourceTabId, "!", "#b3261e");
    await toast(sourceTabId, `保存できませんでした:\n${msg.error}`, "error", 10000);
    chrome.tabs.remove(renderTabId).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case "capture":
      captureRect(sender.tab, msg).then(sendResponse, (err) =>
        sendResponse({ error: String(err?.message || err) })
      );
      return true; // 非同期で応答する
    case "job":
      sendResponse(jobs.get(msg.id) || null);
      return false;
    case "render-result":
      finishJob(msg, sender.tab.id);
      sendResponse({ received: true });
      return false;
  }
  return false;
});

// 印刷用のタブが途中で閉じられたら、記事タブの「処理中」を解除する
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [id, job] of jobs) {
    if (job.renderTabId !== tabId) continue;
    jobs.delete(id);
    busy.delete(job.sourceTabId);
    badge(job.sourceTabId, "");
  }
  busy.delete(tabId);
});
