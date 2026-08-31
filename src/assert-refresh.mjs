import fs from "node:fs/promises";
import path from "node:path";

const mode = process.env.MODE || "full";
const dataDir = path.resolve(process.cwd(), "docs/data");

const critical =
  mode === "news"
    ? ["news-thue", "news-kinhte", "news-thongbao"]
    : [
        "news-thue",
        "news-kinhte",
        "news-thongbao",
        "docs-huongdan",
        "docs-khac",
        "docs-nganh",
        "tthc",
        "dnrrvt",
      ];

const minimum = {
  "news-thue": 5,
  "news-kinhte": 5,
  "news-thongbao": 5,
  "docs-huongdan": 5,
  "docs-khac": 10,
  "docs-nganh": 3,
  tthc: 6,
  dnrrvt: 10,
};

const OFFICIAL_NEWS_HOST = "nghean.gdt.gov.vn";
const bad = [];

function isOfficialNewsUrl(raw = "") {
  try {
    const u = new URL(String(raw));
    return ["http:", "https:"].includes(u.protocol) &&
      u.hostname === OFFICIAL_NEWS_HOST;
  } catch {
    return false;
  }
}

for (const name of critical) {
  let data = {};

  try {
    data = JSON.parse(
      await fs.readFile(path.join(dataDir, `${name}.json`), "utf8")
    );
  } catch {
    bad.push(`${name}: không đọc được JSON`);
    continue;
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const count = items.length;
  const min = minimum[name] || 1;

  if (
    !data.ok ||
    data.seed ||
    data.stale ||
    data.partial ||
    Number(data.fetchedItemCount || 0) < min ||
    count < min
  ) {
    bad.push(
      `${name}: tổng ${count}, vừa lấy ${data.fetchedItemCount || 0}, ` +
      `tối thiểu ${min}, seed=${Boolean(data.seed)}, ` +
      `stale=${Boolean(data.stale)}, partial=${Boolean(data.partial)}, ` +
      `source=${data.sourceMode || "-"}`
    );
    continue;
  }

  if (name.startsWith("news-")) {
    const diag = data.diagnostics?.browser || {};
    const finalizer = data.diagnostics?.finalizer || {};

    if (data.sourceMode !== "browser") {
      bad.push(`${name}: nguồn tin không phải browser chính thức (${data.sourceMode || "-"})`);
      continue;
    }

    if (diag.firstPageValidated !== true) {
      bad.push(`${name}: Browser không xác nhận trang danh sách chính thức`);
      continue;
    }

    if (finalizer.trusted !== true) {
      bad.push(`${name}: finalizer chưa xác nhận dữ liệu Browser là tin cậy`);
      continue;
    }

    const external = items.filter((item) => !isOfficialNewsUrl(item?.url));
    if (external.length) {
      bad.push(`${name}: có ${external.length} URL bài viết không thuộc ${OFFICIAL_NEWS_HOST}`);
      continue;
    }
  }
}

if (bad.length) {
  console.error("Cập nhật chưa đạt yêu cầu dữ liệu chính thức:");
  for (const line of bad) console.error(`- ${line}`);
  console.error("Workflow dừng để không đẩy dữ liệu sai lên GitHub Pages.");
  process.exit(1);
}

console.log("Tất cả bộ dữ liệu quan trọng đạt yêu cầu.");
