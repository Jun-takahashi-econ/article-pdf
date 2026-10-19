/**
 * host.mjs — 拡張機能から受け取ったPDFを、pdf.mjs と同じ保存先(OneDrive/ArticlePDF 等)に書き込む受け口。
 *
 * ブラウザの拡張機能はダウンロードフォルダの中にしか書き込めないため、Chrome/Edge の
 * Native Messaging でこのスクリプトを起動してもらい、書き込みだけを任せる。
 * 呼び出せるのは登録時に許可した拡張機能(Article PDF)だけ(install.mjs 参照)。
 *
 * 通信の形式: 4バイト(リトルエンディアン)の長さ + JSON。1通受け取るごとに1通返す。
 *   { type: "save", filename, data(base64) } → { ok: true, path } / { ok: false, error }
 *   { type: "ping" }                          → { ok: true, outDir }
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveOutDir } from "../out-dir.mjs";

function handle(msg) {
  try {
    if (msg?.type === "ping") return { ok: true, outDir: resolveOutDir() };
    if (msg?.type !== "save") throw new Error(`未対応のメッセージです: ${msg?.type}`);
    // ファイル名だけを使う(フォルダ指定や Windows で使えない文字は受け付けない)
    const name = path.basename(String(msg.filename || "")).replace(/[\\/:*?"<>|]/g, "_");
    if (!/\.pdf$/i.test(name)) throw new Error("PDF以外は保存しません");
    const outDir = resolveOutDir();
    mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, name);
    // 同じ記事を保存し直したときは上書きする(pdf.mjs と同じ)
    writeFileSync(outPath, Buffer.from(String(msg.data || ""), "base64"));
    return { ok: true, path: outPath };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function reply(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

// PDFは数MBになり、標準入力には細切れで届くので、1通分そろうまで溜めてから読む
let chunks = [];
let size = 0;
process.stdin.on("data", (chunk) => {
  chunks.push(chunk);
  size += chunk.length;
  for (;;) {
    if (size < 4) return;
    let buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, size);
    const len = buf.readUInt32LE(0);
    if (size < 4 + len) {
      chunks = [buf];
      return;
    }
    let msg = null;
    try {
      msg = JSON.parse(buf.subarray(4, 4 + len).toString("utf8"));
    } catch {
      // 壊れたメッセージは無視して次へ
    }
    reply(msg ? handle(msg) : { ok: false, error: "メッセージを読めませんでした" });
    buf = buf.subarray(4 + len);
    chunks = buf.length ? [buf] : [];
    size = buf.length;
  }
});
