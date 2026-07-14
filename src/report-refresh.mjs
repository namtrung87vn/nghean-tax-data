import fs from "node:fs/promises";
import path from "node:path";

const mode = process.env.MODE || "full";
const dataDir = path.resolve(process.cwd(), "docs/data");
const names = mode === "news"
  ? ["news-thue", "news-kinhte", "news-thongbao"]
  : [
      "news-thue", "news-kinhte", "news-thongbao",
      "docs-huongdan", "docs-khac", "docs-nganh",
      "tthc", "tthc-phananh", "dnrrvt", "dvc", "videos",
    ];

const rows = [];
for (const name of names) {
  let data = {};
  try {
    data = JSON.parse(await fs.readFile(path.join(dataDir, `${name}.json`), "utf8"));
  } catch {}
  const status = data.seed ? "SEED" : data.stale || data.partial ? "PARTIAL/STALE" : data.ok ? "LIVE" : "ERROR";
  const browser = data.diagnostics?.browser || {};
  const items = Array.isArray(data.items) ? data.items : [];
  rows.push({
    name,
    status,
    count: items.length,
    fetched: Number(data.fetchedItemCount || 0),
    source: data.sourceMode || "-",
    firstPage: Number(browser.firstPageItemCount || 0),
    pages: Number(browser.visitedPages || 0),
    images: items.filter((item) => item.imagePath || item.imageUrl || item.thumb || item.thumbUrl).length,
    error: String(data.lastError || "").replaceAll("|", "/").slice(0, 240),
  });
}

console.log(`# Báo cáo cập nhật dữ liệu (${mode})`);
console.log("");
console.log("| Bộ dữ liệu | Trạng thái | Tổng | Vừa lấy | Trang đầu | Số trang | Có ảnh | Nguồn | Lỗi/ghi chú |");
console.log("|---|---:|---:|---:|---:|---:|---:|---|---|");
for (const row of rows) {
  console.log(`| ${row.name} | ${row.status} | ${row.count} | ${row.fetched} | ${row.firstPage} | ${row.pages} | ${row.images} | ${row.source} | ${row.error} |`);
}
console.log("");
console.log("> LIVE + Trang đầu ≥ 8 đối với tin tức mới xác nhận Chromium đã mở đúng trang danh sách. SEED/PARTIAL nghĩa là Mini App đang dùng dữ liệu dự phòng hoặc chưa lấy đủ phân trang.");
