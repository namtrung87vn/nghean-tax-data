import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "docs/data");
const DATASETS = ["news-thue", "news-kinhte", "news-thongbao"];
const OFFICIAL_HOST = "nghean.gdt.gov.vn";
const MIN_ITEMS = 5;

function parseDate(value = "") {
  const m = String(value).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) return null;
  return d;
}

function formatDate(d) {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function repairSuspiciousDate(item) {
  const currentYear = new Date().getUTCFullYear();
  const parsed = parseDate(item.date);
  const suspicious =
    !parsed ||
    parsed.getUTCFullYear() < 2000 ||
    parsed.getUTCFullYear() > currentYear + 1;

  if (!suspicious) return item.date || "";

  // Chỉ sửa trường hợp rõ ràng: ngày hiện tại vô lý nhưng tiêu đề có
  // một ngày hợp lệ gần hiện tại (ví dụ 20/10/1930-20/10/2025).
  const matches = String(item.title || "").match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || [];
  const candidates = matches
    .map(parseDate)
    .filter(Boolean)
    .filter((d) => d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= currentYear + 1)
    .sort((a, b) => b.getTime() - a.getTime());

  return candidates.length ? formatDate(candidates[0]) : (item.date || "");
}

function dateTs(value) {
  return parseDate(value)?.getTime() || 0;
}

function canonicalNewsKey(item) {
  try {
    const u = new URL(item.url);
    const urile = u.searchParams.get("urile");
    if (urile) return urile;
    return `${u.hostname}${u.pathname}${u.search}`;
  } catch {
    return `${item.title || ""}|${item.date || ""}`;
  }
}

function isOfficialArticleUrl(raw = "") {
  try {
    const u = new URL(String(raw));
    return ["http:", "https:"].includes(u.protocol) && u.hostname === OFFICIAL_HOST;
  } catch {
    return false;
  }
}

function isUsableOfficialImage(raw = "") {
  if (!raw) return false;
  try {
    const u = new URL(String(raw));
    if (u.hostname !== OFFICIAL_HOST) return false;

    const full = u.toString();
    return (
      /\/wps\/wcm\/connect\//i.test(full) ||
      /\.(?:jpg|jpeg|png|gif|webp|bmp)(?:$|[?#])/i.test(full) ||
      /image|thumbnail|thumb|photo|anh/i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

async function processDataset(name) {
  const file = path.join(DATA_DIR, `${name}.json`);
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  const diag = data?.diagnostics?.browser || {};

  const rawItems = Array.isArray(data.items) ? data.items : [];
  const officialItems = rawItems.filter((item) => isOfficialArticleUrl(item?.url));

  const browserIsGood =
    data.ok === true &&
    data.sourceMode === "browser" &&
    diag.firstPageValidated === true &&
    Array.isArray(diag.errors) &&
    diag.errors.length === 0 &&
    Number(data.fetchedItemCount || 0) >= MIN_ITEMS &&
    officialItems.length >= MIN_ITEMS;

  if (!browserIsGood) {
    throw new Error(
      `${name}: dữ liệu Browser chưa đủ tin cậy. ` +
      `source=${data.sourceMode || "-"}, firstPageValidated=${Boolean(diag.firstPageValidated)}, ` +
      `errors=${Array.isArray(diag.errors) ? diag.errors.length : "?"}, ` +
      `fetched=${data.fetchedItemCount || 0}, official=${officialItems.length}`
    );
  }

  const seen = new Set();
  const cleaned = [];

  for (const original of officialItems) {
    const item = { ...original };

    item.date = repairSuspiciousDate(item);

    // Không để URL trang HTML bị hiểu nhầm là thumbnail.
    if (!isUsableOfficialImage(item.imageUrl)) {
      item.imageUrl = "";
    }
    if (item.originalImageUrl && !isUsableOfficialImage(item.originalImageUrl)) {
      item.originalImageUrl = "";
    }

    const key = canonicalNewsKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(item);
  }

  cleaned.sort((a, b) => {
    const diff = dateTs(b.date) - dateTs(a.date);
    if (diff) return diff;
    return String(a.title || "").localeCompare(String(b.title || ""), "vi");
  });

  const now = new Date().toISOString();

  const output = {
    ...data,
    ok: true,
    updatedAt: now,
    sourceUpdatedAt: now,
    lastAttemptAt: now,
    stale: false,
    partial: false,
    seed: false,
    lastError: "",
    sourceMode: "browser",
    fetchedItemCount: cleaned.length,
    itemCount: cleaned.length,
    items: cleaned,
    officialOnly: true,
    diagnostics: {
      ...(data.diagnostics || {}),
      finalizer: {
        officialHost: OFFICIAL_HOST,
        officialItemCount: cleaned.length,
        hitPageLimitWasAccepted:
          Boolean(diag.hitPageLimit) &&
          diag.firstPageValidated === true &&
          Array.isArray(diag.errors) &&
          diag.errors.length === 0,
        note:
          "Giới hạn số trang là giới hạn lịch sử có chủ đích; không coi là stale khi trang đầu hợp lệ và không có lỗi crawl.",
      },
    },
  };

  await fs.writeFile(file, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`[finalize] ${name}: ${cleaned.length} tin chính thức, stale=false, partial=false`);
}

for (const name of DATASETS) {
  await processDataset(name);
}
