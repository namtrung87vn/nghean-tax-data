import { config } from "./config.mjs";
import { absoluteUrl, sleep, uniqueBy } from "./utils.mjs";

let nextAllowedAt = 0;

function stripFence(text = "") {
  return String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonLoose(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const clean = stripFence(value);
  try {
    return JSON.parse(clean);
  } catch {}
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(clean.slice(start, end + 1));
    } catch {}
  }
  return null;
}

function unwrapReaderPayload(payload) {
  const queue = [payload];
  const visited = new Set();
  while (queue.length) {
    const value = queue.shift();
    if (value == null || visited.has(value)) continue;
    if (typeof value === "object") visited.add(value);
    const parsed = parseJsonLoose(value);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) return parsed;
    if (parsed && typeof parsed === "object") {
      queue.push(parsed.data, parsed.content, parsed.result, parsed.output, parsed.text);
    }
  }
  return null;
}

async function waitForRateLimit() {
  const now = Date.now();
  if (nextAllowedAt > now) await sleep(nextAllowedAt - now);
  nextAllowedAt = Date.now() + config.readerDelayMs;
}

export async function readerStructured(targetUrl, schema, instruction) {
  if (!config.readerEnabled) throw new Error("Reader fallback đang tắt.");
  await waitForRateLimit();

  const endpoint = `https://r.jina.ai/${targetUrl}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.readerTimeoutMs);
  try {
    const headers = new Headers({
      accept: "application/json",
      "x-respond-with": "readerlm-v2",
      "x-json-schema": JSON.stringify(schema),
      "x-instruction": instruction,
      "x-timeout": "45",
      "x-use-final-url": "true",
    });
    if (process.env.JINA_API_KEY) {
      headers.set("authorization", `Bearer ${process.env.JINA_API_KEY}`);
    }

    const response = await fetch(endpoint, { headers, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Reader HTTP ${response.status}: ${text.slice(0, 220)}`);
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    const structured = unwrapReaderPayload(payload);
    if (!structured) {
      throw new Error(`Reader không trả JSON đúng cấu trúc: ${text.slice(0, 240)}`);
    }
    return structured;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Reader timeout ${config.readerTimeoutMs}ms tại ${targetUrl}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const PAGINATION = {
  type: "array",
  items: { type: "string" },
};

const NEWS_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          date: { type: "string" },
          imageUrl: { type: "string" },
          summary: { type: "string" },
        },
        required: ["title", "url"],
      },
    },
    paginationUrls: PAGINATION,
  },
  required: ["items"],
};

const DOC_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string" },
          date: { type: "string" },
          title: { type: "string" },
          viewUrl: { type: "string" },
          downloadUrl: { type: "string" },
        },
        required: ["title"],
      },
    },
    paginationUrls: PAGINATION,
  },
  required: ["items"],
};

const TTHC_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          stt: { type: "string" },
          group: { type: "string" },
          title: { type: "string" },
          link: { type: "string" },
          agency: { type: "string" },
          vbqdText: { type: "string" },
          qdcbText: { type: "string" },
        },
        required: ["title"],
      },
    },
    paginationUrls: PAGINATION,
    viewAllUrls: PAGINATION,
  },
  required: ["items"],
};

const DNRR_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ngayQd: { type: "string" },
          soQd: { type: "string" },
          coQuan: { type: "string" },
          qdFileUrl: { type: "string" },
          dsDnFileUrl: { type: "string" },
        },
        required: ["soQd"],
      },
    },
    paginationUrls: PAGINATION,
  },
  required: ["items"],
};

function asAbsolute(baseUrl, value = "") {
  if (!value) return "";
  return absoluteUrl(baseUrl, value);
}

function normalizeDate(value = "") {
  const match = String(value).match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  if (!match) return String(value).trim();
  return `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}/${match[3]}`;
}

export async function readNewsPage(url, tab, marker) {
  const raw = await readerStructured(
    url,
    NEWS_SCHEMA,
    `Trích xuất tất cả bài trong danh sách tin thuộc chuyên mục ${marker}. Không lấy menu, banner, tin ở cột bên hoặc mục khác. Với mỗi bài lấy tiêu đề, URL chi tiết tuyệt đối, ngày dd/mm/yyyy, URL ảnh thumbnail thực của bài và đoạn mô tả ngắn. Lấy tất cả URL phân trang/Trang tiếp theo thuộc đúng danh sách này.`
  );
  const items = (raw.items || [])
    .map((item) => ({
      tab,
      title: String(item.title || "").trim(),
      url: asAbsolute(url, item.url),
      date: normalizeDate(item.date),
      imageUrl: asAbsolute(url, item.imageUrl),
      summary: String(item.summary || "").replace(/\s+/g, " ").trim(),
    }))
    .filter((item) => item.title.length >= 8 && item.url);
  return {
    items: uniqueBy(items, (x) => x.url),
    paginationUrls: uniqueBy((raw.paginationUrls || []).map((x) => asAbsolute(url, x)).filter(Boolean), (x) => x),
  };
}

export async function readDocumentsPage(url, tab) {
  const raw = await readerStructured(
    url,
    DOC_SCHEMA,
    `Trích xuất tất cả dòng trong bảng văn bản của trang hiện tại. Không lấy menu hoặc tin bên cạnh. Lấy số hiệu, ngày ban hành, tên/trích yếu, URL chi tiết và URL tải file nếu có. Lấy mọi URL phân trang của đúng bảng văn bản.`
  );
  const items = (raw.items || [])
    .map((item) => ({
      tab,
      code: String(item.code || "").trim(),
      date: normalizeDate(item.date),
      title: String(item.title || "").replace(/\s+/g, " ").trim(),
      viewUrl: asAbsolute(url, item.viewUrl),
      downloadUrl: asAbsolute(url, item.downloadUrl),
    }))
    .filter((item) => item.title.length >= 5);
  return {
    items: uniqueBy(items, (x) => `${x.code}|${x.date}|${x.title}`),
    paginationUrls: uniqueBy((raw.paginationUrls || []).map((x) => asAbsolute(url, x)).filter(Boolean), (x) => x),
  };
}

export async function readTthcPage(url) {
  const raw = await readerStructured(
    url,
    TTHC_SCHEMA,
    `Trích xuất tất cả thủ tục hành chính trong các bảng chính. Với mỗi thủ tục lấy nhóm bảng, STT, tên thủ tục, URL chi tiết, cơ quan thực hiện, danh sách tên văn bản quy định và quyết định công bố. Lấy URL 'Xem toàn bộ danh sách' và các URL phân trang. Không lấy menu hoặc thông báo bên cạnh.`
  );
  const items = (raw.items || [])
    .map((item, index) => ({
      id: `tthc-reader-${index + 1}`,
      stt: String(item.stt || index + 1),
      group: String(item.group || "Thủ tục hành chính").trim(),
      title: String(item.title || "").replace(/\s+/g, " ").trim(),
      link: asAbsolute(url, item.link),
      agency: String(item.agency || "-").trim(),
      vbqdText: String(item.vbqdText || "-").trim(),
      qdcbText: String(item.qdcbText || "-").trim(),
      vbqdDocs: [],
      qdcbDocs: [],
    }))
    .filter((item) => item.title.length >= 8);
  return {
    items: uniqueBy(items, (x) => x.link || `${x.group}|${x.title}`),
    paginationUrls: uniqueBy((raw.paginationUrls || []).map((x) => asAbsolute(url, x)).filter(Boolean), (x) => x),
    viewAllUrls: uniqueBy((raw.viewAllUrls || []).map((x) => asAbsolute(url, x)).filter(Boolean), (x) => x),
  };
}

export async function readDnrrvtPage(url) {
  const raw = await readerStructured(
    url,
    DNRR_SCHEMA,
    `Trích xuất tất cả dòng của bảng Danh sách doanh nghiệp thuộc loại rủi ro cao về thuế. Lấy ngày quyết định, số quyết định, cơ quan ban hành, URL file quyết định và URL file danh sách doanh nghiệp. Lấy mọi URL phân trang của bảng này.`
  );
  const items = (raw.items || [])
    .map((item) => ({
      ngayQd: normalizeDate(item.ngayQd),
      soQd: String(item.soQd || "").trim(),
      coQuan: String(item.coQuan || "").trim(),
      qdFileUrl: asAbsolute(url, item.qdFileUrl),
      dsDnFileUrl: asAbsolute(url, item.dsDnFileUrl),
    }))
    .filter((item) => item.soQd);
  return {
    items: uniqueBy(items, (x) => `${x.soQd}|${x.ngayQd}|${x.coQuan}`),
    paginationUrls: uniqueBy((raw.paginationUrls || []).map((x) => asAbsolute(url, x)).filter(Boolean), (x) => x),
  };
}

export async function crawlReader(startUrls, readPage, maxPages = 10) {
  const queue = uniqueBy(startUrls.filter(Boolean), (x) => x).map((url) => ({ url }));
  const queued = new Set(queue.map((x) => x.url));
  const visited = new Set();
  let items = [];
  let firstSuccessUrl = "";
  const errors = [];

  while (queue.length && visited.size < maxPages) {
    const { url } = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    try {
      const page = await readPage(url);
      if (!firstSuccessUrl && page.items?.length) firstSuccessUrl = url;
      items.push(...(page.items || []));
      const links = [...(page.viewAllUrls || []), ...(page.paginationUrls || [])];
      for (const link of links) {
        if (!queued.has(link) && !visited.has(link) && queued.size < maxPages * 4) {
          queued.add(link);
          queue.push({ url: link });
        }
      }
    } catch (error) {
      errors.push(`${url}: ${error?.message || error}`);
    }
  }

  return { items, firstSuccessUrl, errors, visitedPages: visited.size };
}
