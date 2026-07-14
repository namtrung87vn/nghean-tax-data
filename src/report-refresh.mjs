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
  const status = data.seed ? "SEED" : data.stale ? "PARTIAL/STALE" : data.ok ? "LIVE" : "ERROR";
  rows.push({
    name,
    status,
    count: Array.isArray(data.items) ? data.items.length : 0,
    fetched: Number(data.fetchedItemCount || 0),
    source: data.sourceMode || "-",
    error: String(data.lastError || "").replaceAll("|", "/").slice(0, 240),
  });
}

console.log(`# Báo cáo cập nhật dữ liệu (${mode})`);
console.log("");
console.log("| Bộ dữ liệu | Trạng thái | Tổng lưu | Vừa lấy | Nguồn | Lỗi/ghi chú |");
console.log("|---|---:|---:|---:|---|---|");
for (const row of rows) {
  console.log(`| ${row.name} | ${row.status} | ${row.count} | ${row.fetched} | ${row.source} | ${row.error} |`);
}
console.log("");
console.log("> LIVE mới xác nhận nguồn được tải thành công. SEED/PARTIAL nghĩa là Mini App vẫn đang dùng dữ liệu dự phòng hoặc chưa lấy đủ phân trang.");
