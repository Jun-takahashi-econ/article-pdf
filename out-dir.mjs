/**
 * out-dir.mjs — PDFの保存先を決める。pdf.mjs と、拡張機能から受け取ったPDFを書き込む
 * native-host/host.mjs で共通(どちらで保存しても同じフォルダに入るように)。
 *
 * 優先順位: 環境変数 ARTICLE_PDF_OUT > config.json の outDir > OneDrive自動検出 > ~/Documents/ArticlePDF
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export function resolveOutDir() {
  const config = readConfig();
  const oneDrive = detectOneDrive();
  return (
    process.env.ARTICLE_PDF_OUT ||
    config.outDir ||
    (oneDrive
      ? path.join(oneDrive, "ArticlePDF")
      : path.join(homedir(), "Documents", "ArticlePDF"))
  );
}
