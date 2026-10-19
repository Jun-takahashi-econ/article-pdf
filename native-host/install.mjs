/**
 * install.mjs — 拡張機能から指定のフォルダに直接保存するための受け口(host.mjs)を Chrome と Edge に登録する。
 * PCごとに1回だけ実行する。管理者権限は不要(ユーザー単位の登録)。
 *
 *   node native-host/install.mjs              # 登録
 *   node native-host/install.mjs --uninstall  # 登録の解除
 *
 * 登録先には node の場所を絶対パスで書き込むので、Node.js を入れ直して場所が変わったら再実行する。
 */

import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST_NAME = "com.article_pdf.save";
// extension/manifest.json の "key" から決まる拡張機能のID。key を変えたらここも合わせる。
// 受け口はこのIDの拡張機能からしか呼び出せない。
const EXTENSION_ID = "hdmldbmbchckngilggannebonadijpej";

const here = path.dirname(fileURLToPath(import.meta.url));
const hostScript = path.join(here, "host.mjs");
const manifestPath = path.join(here, `${HOST_NAME}.json`);
const isWin = process.platform === "win32";
const launcher = path.join(here, isWin ? "run.cmd" : "run.sh");

// Windows はレジストリに、Mac/Linux は各ブラウザの設定フォルダにマニフェストを置く
const REG_KEYS = [
  `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
  `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
];
const BROWSER_DIRS = {
  darwin: [
    "Library/Application Support/Google/Chrome",
    "Library/Application Support/Microsoft Edge",
    "Library/Application Support/Chromium",
  ],
  linux: [".config/google-chrome", ".config/microsoft-edge", ".config/chromium"],
};
// 入っていないブラウザの設定フォルダは作らない
const hostDirs = () =>
  (BROWSER_DIRS[process.platform] || [])
    .map((d) => path.join(homedir(), d))
    .filter((d) => existsSync(d))
    .map((d) => path.join(d, "NativeMessagingHosts"));

function install() {
  // ブラウザから起動されるときはPATHが通っていないことがあるので、node は絶対パスで書く。
  // Windows の @echo off は必須(コマンドが標準出力に出ると通信が壊れる)。
  // また cmd は .cmd ファイルを日本語版Windowsの文字コード(Shift_JIS系)で読むため、日本語を含む
  // パスを書き込むと壊れる。host.mjs は自身の場所(%~dp0)から参照し、node の場所に日本語が
  // 含まれる場合は PATH 上の node を使う。
  if (isWin) {
    const node = /^[\x20-\x7e]+$/.test(process.execPath) ? `"${process.execPath}"` : "node";
    writeFileSync(launcher, `@echo off\r\n${node} "%~dp0host.mjs" %*\r\n`);
  } else {
    writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${hostScript}" "$@"\n`);
    chmodSync(launcher, 0o755);
  }
  const manifest = JSON.stringify(
    {
      name: HOST_NAME,
      description: "Article PDF: 拡張機能から受け取ったPDFを保存先に書き込む",
      path: launcher,
      type: "stdio",
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    },
    null,
    2
  );
  writeFileSync(manifestPath, manifest);
  if (isWin) {
    for (const key of REG_KEYS) {
      execFileSync("reg", ["add", key, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], { stdio: "ignore" });
    }
    return ["Chrome", "Edge"];
  }
  const dirs = hostDirs();
  if (!dirs.length) throw new Error("Chrome / Edge の設定フォルダが見つかりません。ブラウザを一度起動してから再実行してください。");
  for (const d of dirs) {
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, `${HOST_NAME}.json`), manifest);
  }
  return dirs.map((d) => path.basename(path.dirname(d)));
}

function uninstall() {
  if (isWin) {
    for (const key of REG_KEYS) {
      try {
        execFileSync("reg", ["delete", key, "/f"], { stdio: "ignore" });
      } catch {
        // 登録されていなければ何もしない
      }
    }
  } else {
    for (const d of hostDirs()) rmSync(path.join(d, `${HOST_NAME}.json`), { force: true });
  }
  rmSync(manifestPath, { force: true });
  rmSync(launcher, { force: true });
}

// 組織が管理するPCでは、ポリシーで受け口が禁止されていることがある。その場合
// 拡張機能はダウンロードフォルダに保存するので、登録時点で分かるように知らせる(Windowsのみ)。
function policyWarnings() {
  if (!isWin) return [];
  const query = (args) => {
    try {
      return execFileSync("reg", ["query", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null; // キーや値が無い
    }
  };
  const warns = [];
  for (const [browser, key] of [["Chrome", "Google\\Chrome"], ["Edge", "Microsoft\\Edge"]]) {
    for (const hive of ["HKLM", "HKCU"]) {
      const base = `${hive}\\SOFTWARE\\Policies\\${key}`;
      if (/NativeMessagingUserLevelHosts\s+REG_DWORD\s+0x0\b/i.test(query([base, "/v", "NativeMessagingUserLevelHosts"]) || "")) {
        warns.push(`${browser}: 管理ポリシーで、ユーザー単位の受け口が無効になっています`);
      }
      if (query([`${base}\\NativeMessagingBlocklist`])) {
        warns.push(`${browser}: 管理ポリシーで、受け口の利用が制限されている可能性があります`);
      }
    }
  }
  return [...new Set(warns)];
}

// ブラウザと同じ起動方法で受け口を動かし、応答が返るか確かめる
function ping() {
  return new Promise((resolve, reject) => {
    const child = isWin
      ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `""${launcher}""`], {
          windowsVerbatimArguments: true,
        })
      : spawn(launcher);
    const out = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("受け口から応答がありません"));
    }, 10_000);
    child.stdout.on("data", (c) => out.push(c));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const buf = Buffer.concat(out);
      if (buf.length < 4) return reject(new Error("受け口から応答がありません"));
      const res = JSON.parse(buf.subarray(4, 4 + buf.readUInt32LE(0)).toString("utf8"));
      if (res.ok) resolve(res);
      else reject(new Error(res.error));
    });
    const body = Buffer.from(JSON.stringify({ type: "ping" }), "utf8");
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length, 0);
    child.stdin.end(Buffer.concat([head, body]));
  });
}

try {
  if (process.argv.includes("--uninstall")) {
    uninstall();
    console.log("受け口の登録を解除しました。拡張機能はダウンロードフォルダに保存するようになります。");
  } else {
    const browsers = install();
    const { outDir } = await ping();
    console.log(`受け口を登録しました(${browsers.join(" / ")})。動作確認: OK`);
    console.log(`保存先: ${outDir}`);
    console.log("ブラウザの再起動は不要です。拡張機能のボタンで保存すると、ここに直接保存されます。");
    for (const w of policyWarnings()) {
      console.log(`注意: ${w}。このブラウザではダウンロードフォルダに保存されます。`);
    }
  }
} catch (err) {
  console.error(`エラー: ${err.message}`);
  process.exitCode = 1;
}
