// render.js — 整形済みHTMLをこのタブ(拡張機能のページ)に流し込み、自分自身をPDFに印刷して保存する。
// 印刷に使うデバッガー(DevToolsプロトコル)はこのタブにだけつなぐので、記事のタブには一切つながらない。
//
// 保存先は config.json の outDir(通常は OneDrive/ArticlePDF)。拡張機能はダウンロードフォルダの
// 中にしか書き込めないので、PC側の受け口(native-host/host.mjs)に書き込みを任せる。受け口が
// 使えないPC(未登録、管理ポリシーで禁止)ではダウンロードフォルダに保存し、その理由を伝える。

const HOST = "com.article_pdf.save";
const id = location.hash.slice(1);
const report = (msg) => chrome.runtime.sendMessage({ type: "render-result", id, ...msg });

// A4(単位はインチ)。余白の値も渡しているが、ページ側のCSSに @page { margin: 0 } があり、
// Chromeではそちらが優先されるので、実際の余白は0になる(左右の余白は本文の幅を絞って
// 作っている)。背景色がページの端まで塗られるのはこのため。
const PRINT_OPTIONS = {
  paperWidth: 8.27,
  paperHeight: 11.7,
  marginTop: 18 / 25.4,
  marginBottom: 18 / 25.4,
  marginLeft: 16 / 25.4,
  marginRight: 16 / 25.4,
  printBackground: true,
  generateTaggedPDF: true,
};

async function printToPdf(tabId) {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    const { data } = await chrome.debugger.sendCommand(target, "Page.printToPDF", PRINT_OPTIONS);
    return data;
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (item) => {
      if (settled || !item || item.state === "in_progress") return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      if (item.state === "complete") resolve(item.filename);
      else reject(new Error(`保存に失敗しました (${item.error || item.state})`));
    };
    const onChanged = async (delta) => {
      if (delta.id !== downloadId || !delta.state) return;
      const [item] = await chrome.downloads.search({ id: downloadId });
      finish(item);
    };
    chrome.downloads.onChanged.addListener(onChanged);
    // 登録より先に終わっていた場合に備えて、現在の状態も確認する
    chrome.downloads.search({ id: downloadId }).then(([item]) => finish(item));
  });
}

async function saveViaHost(base64, filename) {
  const res = await chrome.runtime.sendNativeMessage(HOST, { type: "save", filename, data: base64 });
  if (!res?.ok) throw new Error(res?.error || "受け口から応答がありません");
  return res.path;
}

// 受け口が使えない理由を、次に何をすればよいか分かる言葉にする
function hostProblem(err) {
  const m = String(err?.message || err);
  if (/not found/i.test(m)) return "このPCはOneDrive保存の設定がまだです(native-host/install.mjs を実行してください)";
  if (/forbidden/i.test(m)) return "このPCの管理ポリシーで、OneDriveへの直接保存が止められています";
  return `OneDriveに保存できませんでした(${m})`;
}

async function saveToDownloads(base64, filename) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // data: URL はサイズ上限に当たりうるので、このページで作ったBlob URLから保存する
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const download = (name) =>
    chrome.downloads.download({ url, filename: `ArticlePDF/${name}`, conflictAction: "uniquify", saveAs: false });
  try {
    let downloadId;
    try {
      downloadId = await download(filename);
    } catch (err) {
      // ファイル名の文字(日本語など)を扱えない環境では「Invalid filename」で拒否されるので、
      // 英数字だけの名前で保存し直す(実測: 文字コードがPOSIXのLinux)
      if (!/invalid filename/i.test(String(err?.message))) throw err;
      downloadId = await download(filename.replace(/[^\x21-\x7e]+/g, "").replace(/_-*\.pdf$/, "_article.pdf"));
    }
    return await waitForDownload(downloadId);
  } finally {
    URL.revokeObjectURL(url);
  }
}

(async () => {
  const job = await chrome.runtime.sendMessage({ type: "job", id });
  if (!job) {
    document.body.textContent = "対象の記事が見つかりませんでした。記事のタブでもう一度ボタンを押してください。";
    return;
  }
  const doc = new DOMParser().parseFromString(job.html, "text/html");
  document.head.replaceWith(document.adoptNode(doc.head));
  document.body.replaceWith(document.adoptNode(doc.body));
  // 印刷画面から保存する場合の既定のファイル名になる
  document.title = job.filename.replace(/\.pdf$/, "");

  // 画像の読み込み完了を待つ。このタブは裏で開いているため、decode() は表示されるまで
  // 終わらないことがある(実測でPNGがそうなった)。印刷時にはデコードされるので読み込みだけ待てばよい。
  await Promise.all(
    [...document.images].map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) return resolve();
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
          setTimeout(resolve, 8000); // 1枚あたり最大8秒(1枚の失敗で全体を止めない)
        })
    )
  );
  // 幅・高さの両方を確認(高さ0の部分デコード=実質白紙、を幅>0だけでは見逃すため)
  const failedImages = [...document.images].filter(
    (i) => !(i.complete && i.naturalWidth > 2 && i.naturalHeight > 2)
  ).length;

  const { id: tabId } = await chrome.tabs.getCurrent();
  let data;
  try {
    data = await printToPdf(tabId);
  } catch (err) {
    // 管理ポリシー等でデバッガーが使えない環境では、印刷画面からの保存に切り替える。
    // 印刷画面の余白も既定でCSSの @page に従うので、自動保存と同じ仕上がりになる。
    await report({ ok: false, fallback: true, error: String(err?.message || err) });
    await chrome.tabs.update(tabId, { active: true });
    window.print();
    return;
  }
  try {
    let path;
    let note = "";
    try {
      path = await saveViaHost(data, job.filename);
    } catch (err) {
      path = await saveToDownloads(data, job.filename);
      note = `${hostProblem(err)}。代わりにダウンロードフォルダに保存しました。`;
    }
    await report({ ok: true, path, note, failedImages });
  } catch (err) {
    await report({ ok: false, error: String(err?.message || err) });
  }
})();
