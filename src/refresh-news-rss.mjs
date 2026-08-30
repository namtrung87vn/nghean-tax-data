import { readDataset, saveSuccess } from "./store.mjs";

const MIN_ITEMS = 8;

const FEEDS = {
  thue: {
    queries: [
      '"Thuế tỉnh Nghệ An"',
      '"Thuế Nghệ An"',
      '"Cục Thuế Nghệ An"',
      '"Thuế cơ sở" "Nghệ An"',
    ],
    requiredWords: ["thuế", "nghệ an"],
  },
  kinhte: {
    queries: [
      '"Nghệ An" "kinh tế"',
      '"Nghệ An" doanh nghiệp',
      '"Nghệ An" đầu tư',
      '"Nghệ An" sản xuất kinh doanh',
    ],
    requiredWords: ["nghệ an"],
  },
  thongbao: {
    queries: [
      '"Thuế tỉnh Nghệ An" thông báo',
      '"Thuế Nghệ An" quyết định',
      '"Thuế Nghệ An" cảnh báo',
      '"Thuế Nghệ An"',
    ],
    requiredWords: ["nghệ an"],
  },
};

const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36",
  accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
  "accept-language": "vi-VN,vi;q=0.9,en;q=0.6",
};

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function stripHtml(value = "") {
  return decodeXml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const m = String(block).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decodeXml(m[1]) : "";
}

function attr(block, tagName, attrName) {
  const m = String(block).match(
    new RegExp(`<${tagName}\\b[^>]*\\b${attrName}=["']([^"']+)["'][^>]*>`, "i")
  );
  return m ? decodeXml(m[1]) : "";
}

function normalizeDate(value = "") {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getFullYear()}`;
}

function titleWithoutPublisher(value = "") {
  // Google News thường nối " - Tên báo" ở cuối.
  const title = stripHtml(value);
  const parts = title.split(" - ");
  return parts.length > 1 ? parts.slice(0, -1).join(" - ").trim() : title;
}

function parseRss(xml, tab) {
  const blocks = String(xml).match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const out = [];

  for (const block of blocks) {
    const title = titleWithoutPublisher(tag(block, "title"));
    const link = stripHtml(tag(block, "link")) || attr(block, "link", "href");
    const pubDate = tag(block, "pubDate") || tag(block, "dc:date");
    const description = tag(block, "description");
    const source = stripHtml(tag(block, "source"));
    const imageUrl =
      attr(block, "media:content", "url") ||
      attr(block, "media:thumbnail", "url") ||
      (description.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1] || "");

    if (!title || !/^https?:\/\//i.test(link)) continue;

    out.push({
      tab,
      title,
      url: link,
      date: normalizeDate(pubDate),
      imageUrl: decodeXml(imageUrl),
      summary: stripHtml(description).slice(0, 500),
      publisher: source,
      publishedAt: Number.isFinite(new Date(pubDate).getTime())
        ? new Date(pubDate).toISOString()
        : "",
    });
  }

  return out;
}

function key(item) {
  return `${String(item.title || "").toLowerCase().replace(/\s+/g, " ").trim()}|${item.date || ""}`;
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    const k = key(item);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function relevant(item, cfg) {
  const text = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  return (cfg.requiredWords || []).every((word) => text.includes(word.toLowerCase()));
}

async function fetchText(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.includes("<item")) throw new Error("RSS không có item");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function googleUrl(query) {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=vi&gl=VN&ceid=VN:vi`;
}

function bingUrl(query) {
  const q = encodeURIComponent(query);
  return `https://www.bing.com/news/search?q=${q}&format=rss&setlang=vi-VN`;
}

async function fetchQuery(query, tab) {
  const errors = [];

  for (const url of [googleUrl(query), bingUrl(query)]) {
    try {
      const xml = await fetchText(url);
      const items = parseRss(xml, tab);
      if (items.length) {
        console.log(`[rss] ${tab}: ${items.length} tin từ ${new URL(url).hostname} với query ${query}`);
        return { items, sourceUrl: url };
      }
    } catch (error) {
      errors.push(`${new URL(url).hostname}: ${error?.message || error}`);
    }
  }

  console.warn(`[rss] ${tab}: query ${query} lỗi: ${errors.join(" | ")}`);
  return { items: [], sourceUrl: "" };
}

async function refreshTab(tab) {
  const dataset = `news-${tab}`;
  const current = await readDataset(dataset);
  const currentCount = Array.isArray(current.items) ? current.items.length : 0;

  const healthy =
    current.ok &&
    !current.seed &&
    !current.stale &&
    !current.partial &&
    Number(current.fetchedItemCount || 0) >= MIN_ITEMS &&
    currentCount >= MIN_ITEMS;

  if (healthy) {
    console.log(`[rss] ${dataset}: nguồn chính đang tốt (${currentCount} tin), không thay.`);
    return;
  }

  const cfg = FEEDS[tab];
  let items = [];
  let firstSourceUrl = "";

  for (const query of cfg.queries) {
    const result = await fetchQuery(query, tab);
    if (!firstSourceUrl && result.sourceUrl) firstSourceUrl = result.sourceUrl;
    items.push(...result.items);
    items = unique(items);

    const strictItems = items.filter((item) => relevant(item, cfg));
    if (strictItems.length >= MIN_ITEMS) {
      items = strictItems;
      break;
    }
  }

  let strict = unique(items.filter((item) => relevant(item, cfg)));

  // Với tab thông báo, số bài có chữ "thông báo/quyết định/cảnh báo" có thể ít.
  // Ưu tiên các bài đúng từ khóa rồi mới bổ sung các tin Thuế Nghệ An mới nhất.
  if (tab === "thongbao") {
    const noticeRe = /\b(thông báo|quyết định|cảnh báo|công khai|hướng dẫn|triển khai|chính sách)\b/i;
    const preferred = strict.filter((item) => noticeRe.test(`${item.title} ${item.summary}`));
    const preferredKeys = new Set(preferred.map(key));
    strict = [...preferred, ...strict.filter((item) => !preferredKeys.has(key(item)))];
  }

  strict.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  if (strict.length < MIN_ITEMS) {
    throw new Error(`${dataset}: RSS chỉ lấy được ${strict.length}/${MIN_ITEMS} tin phù hợp.`);
  }

  // Giữ tối đa 60 tin để Mini App nhẹ.
  strict = strict.slice(0, 60);

  await saveSuccess(dataset, strict, {
    sourceMode: "news-rss-fallback",
    sourceUrl: firstSourceUrl,
    sourceStatus: 200,
    fetchedItemCount: strict.length,
    partial: false,
    stale: false,
    lastError: "",
    diagnostics: {
      fallback: "Google News RSS / Bing News RSS",
      reason: "Nguồn nghean.gdt.gov.vn không truy cập ổn định từ GitHub-hosted runner.",
    },
  });

  console.log(`[rss] ${dataset}: đã thay dữ liệu stale bằng ${strict.length} tin RSS.`);
}

for (const tab of Object.keys(FEEDS)) {
  try {
    await refreshTab(tab);
  } catch (error) {
    console.error(`[rss] news-${tab} thất bại: ${error?.message || error}`);
    process.exitCode = 1;
  }
}
