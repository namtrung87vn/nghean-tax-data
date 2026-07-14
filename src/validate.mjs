import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd(), "docs");
const requiredFiles = [
  "health.json",
  "intro-tochuc.json",
  "intro-diachi.json",
  "data/news-thue.json",
  "data/news-kinhte.json",
  "data/news-thongbao.json",
  "data/docs-huongdan.json",
  "data/docs-khac.json",
  "data/docs-nganh.json",
  "data/tthc.json",
  "data/tthc-phananh.json",
  "data/dnrrvt.json",
  "data/dvc.json",
  "data/videos.json",
];

let failed = false;
for (const rel of requiredFiles) {
  const file = path.join(root, rel);
  try {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    if (rel.startsWith("data/") && !Array.isArray(data.items)) {
      throw new Error("thiếu mảng items");
    }
    console.log(`OK ${rel}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${rel}: ${error.message}`);
  }
}

if (failed) process.exit(1);
console.log("Kiểm tra dữ liệu tĩnh đạt yêu cầu.");
