import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.mjs";
import { nowIso } from "./utils.mjs";

async function ensureDir() {
  await fs.mkdir(config.dataDir, { recursive: true });
}

function fileFor(name) {
  return path.join(config.dataDir, `${name}.json`);
}

export async function readDataset(name) {
  await ensureDir();
  try {
    const raw = await fs.readFile(fileFor(name), "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      ok: false,
      dataset: name,
      updatedAt: null,
      sourceUpdatedAt: null,
      lastAttemptAt: null,
      stale: true,
      seed: false,
      lastError: "Chưa có dữ liệu.",
      items: [],
    };
  }
}

export async function writeDataset(name, data) {
  await ensureDir();
  const file = fileFor(name);
  const tmp = `${file}.${process.pid}.tmp`;
  const payload = JSON.stringify({ ...data, dataset: name }, null, 2);
  await fs.writeFile(tmp, payload, "utf8");
  await fs.rename(tmp, file);
}

export async function saveSuccess(name, items, source = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`Từ chối ghi ${name}: danh sách mới rỗng.`);
  }
  const now = nowIso();
  const current = await readDataset(name);
  await writeDataset(name, {
    ok: true,
    updatedAt: now,
    sourceUpdatedAt: source.sourceUpdatedAt || now,
    lastAttemptAt: now,
    stale: Boolean(source.stale),
    partial: Boolean(source.partial),
    seed: false,
    lastError: source.lastError || "",
    sourceMode: source.sourceMode || "direct",
    sourceUrl: source.sourceUrl || "",
    sourceStatus: source.sourceStatus || 200,
    fetchedItemCount: Number(source.fetchedItemCount ?? items.length),
    itemCount: items.length,
    previousItemCount: Array.isArray(current.items) ? current.items.length : 0,
    items,
  });
}

export async function markFailure(name, error) {
  const current = await readDataset(name);
  await writeDataset(name, {
    ...current,
    ok: Array.isArray(current.items) && current.items.length > 0,
    stale: true,
    lastAttemptAt: nowIso(),
    lastError: String(error?.message || error || "Lỗi không xác định"),
    itemCount: Array.isArray(current.items) ? current.items.length : 0,
  });
}

export async function listDatasetNames() {
  await ensureDir();
  const files = await fs.readdir(config.dataDir);
  return files.filter((x) => x.endsWith(".json")).map((x) => x.replace(/\.json$/, ""));
}
