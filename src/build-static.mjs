import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.mjs";
import { INTRO_DATA } from "./static-data.mjs";

const docsDir = path.resolve(process.cwd(), "docs");
const dataDir = config.dataDir;

async function readJson(file, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(docsDir, { recursive: true });

const files = (await fs.readdir(dataDir)).filter((name) => name.endsWith(".json")).sort();
const datasets = {};
for (const file of files) {
  const name = file.replace(/\.json$/, "");
  const data = await readJson(path.join(dataDir, file), {});
  const items = Array.isArray(data.items) ? data.items : [];
  datasets[name] = {
    ok: Boolean(data.ok && items.length > 0),
    stale: Boolean(data.stale),
    seed: Boolean(data.seed),
    itemCount: items.length,
    updatedAt: data.updatedAt || null,
    lastAttemptAt: data.lastAttemptAt || null,
    sourceUrl: data.sourceUrl || "",
    lastError: data.lastError || "",
  };
}

const required = [
  "news-thue",
  "news-kinhte",
  "news-thongbao",
  "docs-huongdan",
  "docs-khac",
  "docs-nganh",
  "tthc",
  "tthc-phananh",
  "dnrrvt",
  "dvc",
  "videos",
];
const requiredOk = required.every((name) => datasets[name]?.itemCount > 0);
const degraded = Object.values(datasets).some((item) => item.stale || !item.ok);
const generatedAt = new Date().toISOString();

const health = {
  ok: requiredOk,
  degraded,
  service: "nghean-tax-github-pages",
  generatedAt,
  sourceHost: "nghean.gdt.gov.vn",
  requiredDatasets: required,
  datasets,
};

await fs.writeFile(path.join(docsDir, "health.json"), JSON.stringify(health, null, 2), "utf8");
await fs.writeFile(path.join(docsDir, "intro-tochuc.json"), JSON.stringify(INTRO_DATA.tochuc, null, 2), "utf8");
await fs.writeFile(path.join(docsDir, "intro-diachi.json"), JSON.stringify(INTRO_DATA.diachi, null, 2), "utf8");
await fs.writeFile(path.join(docsDir, ".nojekyll"), "", "utf8");

const rows = Object.entries(datasets)
  .map(([name, item]) => {
    const status = item.itemCount > 0 ? (item.stale ? "Dữ liệu dự phòng" : "Đang hoạt động") : "Chưa có dữ liệu";
    const cls = item.itemCount > 0 ? (item.stale ? "warn" : "ok") : "bad";
    return `<tr>
      <td><a href="data/${encodeURIComponent(name)}.json">${esc(name)}</a></td>
      <td class="num">${item.itemCount}</td>
      <td><span class="badge ${cls}">${esc(status)}</span></td>
      <td>${esc(item.updatedAt || "—")}</td>
      <td class="message">${esc(item.lastError || "")}</td>
    </tr>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Dữ liệu Thuế Nghệ An</title>
  <style>
    :root{font-family:Arial,sans-serif;color:#172033;background:#f5f7fb}body{margin:0;padding:24px}.wrap{max-width:1120px;margin:auto}.head{background:white;border:1px solid #e1e6ef;border-radius:16px;padding:20px;margin-bottom:16px}.status{display:inline-block;padding:6px 10px;border-radius:999px;font-weight:700;background:${requiredOk ? "#dcfce7" : "#fee2e2"};color:${requiredOk ? "#166534" : "#991b1b"}}table{width:100%;border-collapse:collapse;background:white;border:1px solid #e1e6ef;border-radius:16px;overflow:hidden}th,td{text-align:left;padding:11px;border-bottom:1px solid #edf0f5;vertical-align:top}th{background:#f8fafc}.num{text-align:right}.badge{display:inline-block;padding:4px 8px;border-radius:999px;font-size:12px;white-space:nowrap}.ok{background:#dcfce7;color:#166534}.warn{background:#fef3c7;color:#92400e}.bad{background:#fee2e2;color:#991b1b}.message{font-size:12px;max-width:420px;word-break:break-word;color:#64748b}a{color:#075dbb;text-decoration:none}code{background:#eef2f7;padding:2px 5px;border-radius:5px}@media(max-width:720px){body{padding:12px}.message{display:none}th,td{padding:8px;font-size:13px}}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="head">
      <span class="status">${requiredOk ? "HỆ THỐNG CÓ DỮ LIỆU" : "HỆ THỐNG THIẾU DỮ LIỆU"}</span>
      <h1>Dữ liệu công khai Thuế Nghệ An</h1>
      <p>Trang này do GitHub Actions cập nhật tự động. Khi nguồn Thuế lỗi, hệ thống giữ lại bản hợp lệ gần nhất.</p>
      <p><b>Tạo lúc:</b> ${esc(generatedAt)} · <a href="health.json">Mở health.json</a></p>
    </section>
    <table>
      <thead><tr><th>Bộ dữ liệu</th><th>Số mục</th><th>Trạng thái</th><th>Cập nhật</th><th>Lỗi gần nhất</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>`;

await fs.writeFile(path.join(docsDir, "index.html"), html, "utf8");
console.log(`Đã tạo trang tĩnh: ${files.length} bộ dữ liệu.`);
