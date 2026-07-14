import fs from "node:fs/promises";
import path from "node:path";

const mode = process.env.MODE || "full";
const dataDir = path.resolve(process.cwd(), "docs/data");
const critical = mode === "news"
  ? ["news-thue", "news-kinhte", "news-thongbao"]
  : ["news-thue", "news-kinhte", "news-thongbao", "docs-huongdan", "docs-khac", "docs-nganh", "tthc", "dnrrvt"];

const bad = [];
for (const name of critical) {
  let data = {};
  try {
    data = JSON.parse(await fs.readFile(path.join(dataDir, `${name}.json`), "utf8"));
  } catch (error) {
    bad.push(`${name}: không đọc được JSON`);
    continue;
  }
  const count = Array.isArray(data.items) ? data.items.length : 0;
  if (!data.ok || data.seed || data.stale || Number(data.fetchedItemCount || 0) <= 0) {
    bad.push(`${name}: ${data.seed ? "seed" : data.stale ? "stale/partial" : "chưa tải live"}, tổng ${count}, vừa lấy ${data.fetchedItemCount || 0}`);
  }
}

if (bad.length) {
  console.error("Cập nhật chưa đạt yêu cầu live đầy đủ:");
  for (const line of bad) console.error(`- ${line}`);
  console.error("Dữ liệu cũ vẫn được giữ và đã commit; workflow đỏ để không gây hiểu nhầm là đã lấy đủ.");
  process.exit(1);
}
console.log("Tất cả bộ dữ liệu quan trọng đã được tải live.");
