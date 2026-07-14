import fs from "node:fs";
import path from "node:path";

function loadEnvFile(file = path.resolve(process.cwd(), ".env")) {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const num = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

export const config = {
  dataDir: path.resolve(process.cwd(), process.env.DATA_DIR || "./docs/data"),
  sourceBases: String(process.env.SOURCE_BASES || "http://nghean.gdt.gov.vn,https://nghean.gdt.gov.vn")
    .split(",")
    .map((x) => x.trim().replace(/\/+$/, ""))
    .filter(Boolean),
  requestTimeoutMs: num("REQUEST_TIMEOUT_MS", 20000),
  requestRetries: num("REQUEST_RETRIES", 1),
  maxNewsPages: num("MAX_NEWS_PAGES", 10),
  maxDocPages: num("MAX_DOC_PAGES", 65),
  readerEnabled: String(process.env.READER_ENABLED || "true").toLowerCase() !== "false",
  readerTimeoutMs: num("READER_TIMEOUT_MS", 90000),
  readerDelayMs: num("READER_DELAY_MS", 3500),
  maxReaderNewsPages: num("MAX_READER_NEWS_PAGES", 15),
  maxReaderDocPages: num("MAX_READER_DOC_PAGES", 30),
  browserEnabled: String(process.env.BROWSER_ENABLED || "true").toLowerCase() !== "false",
  browserTimeoutMs: num("BROWSER_TIMEOUT_MS", 90000),
  browserSettleMs: num("BROWSER_SETTLE_MS", 2200),
  browserRetryDelayMs: num("BROWSER_RETRY_DELAY_MS", 1200),
  maxBrowserNewsPages: num("MAX_BROWSER_NEWS_PAGES", 30),
  maxBrowserDocPages: num("MAX_BROWSER_DOC_PAGES", 80),
  cacheImages: String(process.env.CACHE_IMAGES || "true").toLowerCase() !== "false",
  maxCachedImages: num("MAX_CACHED_IMAGES", 120),
};
