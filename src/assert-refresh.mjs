import fs from "node:fs/promises";
import path from "node:path";

const mode = process.env.MODE || "full";
const dataDir = path.resolve(process.cwd(), "docs/data");
const critical = mode === "news"
  ? ["news-thue", "news-kinhte", "news-thongbao"]
  : ["news-thue", "news-kinhte", "news-thongbao", "docs-huongdan", "docs-khac", "docs-nganh", "tthc", "dnrrvt"];

const minimum = {
  "news-thue": 8,
  "news-kinhte": 8,
  "news-thongbao": 8,
  "docs-huongdan": 5,
  "docs-khac": 10,
  "docs-nganh": 3,
  tthc: 6,
  dnrrvt: 10,
};

const bad = [];
for (const name of critical) {
  let data = {};
  try {
    data = JSON.parse(await fs.readFile(path.join(dataDir, `${name}.json`), "utf8"));
  } catch {
    bad.push(`${name}: không đọc được JSON`);
    continue;
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const count = items.length;
  const min = minimum[name] || 1;
  const diag = data.diagnostics?.browser || {};

  if (!data.ok || data.seed || data.stale || data.partial || Number(data.fetchedItemCount || 0) < min || count < min) {
    bad.push(
      `${name}: tổng ${count}, vừa lấy ${data.fetchedItemCount || 0}, tối thiểu ${min}, seed=${Boolean(data.seed)}, stale=${Boolean(data.stale)}, partial=${Boolean(data.partial)}`
    );
    continue;
  }

  if (name.startsWith("news-")) {
    const images = items.filter((item) => item.imagePath || item.imageUrl || item.thumb || item.thumbUrl).length;
    if (images < Math.min(3, count)) {
      bad.push(`${name}: chỉ ${images}/${count} tin có thumbnail`);
    }
    if (data.sourceMode === "browser" && diag.firstPageValidated === false) {
      bad.push(`${name}: Chromium không xác nhận trang danh sách thật`);
    }
  }
}

if (bad.length) {
  console.error("Cập nhật chưa đạt yêu cầu live đầy đủ:");
  for (const line of bad) console.error(`- ${line}`);
  console.error("Dữ liệu cũ vẫn được giữ; workflow đỏ để tránh hiểu nhầm là đã lấy đủ.");
  process.exit(1);
}
console.log("Tất cả bộ dữ liệu quan trọng đã được tải live từ đúng trang danh sách.");
