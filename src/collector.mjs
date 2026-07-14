import { config } from "./config.mjs";
import { fetchFromCandidates, fetchTextDetailed } from "./fetcher.mjs";
import {
  extractFeedbackHtml,
  findViewAllUrl,
  findViewAllUrls,
  parseDnrrvt,
  parseDocuments,
  parseDvc,
  parseMaxPage,
  parseNews,
  parsePageLinks,
  parsePaginationUrls,
  parseSearchFormAction,
  parseTthc,
  parseVideos,
} from "./parsers.mjs";
import { markFailure, readDataset, saveSuccess } from "./store.mjs";
import {
  crawlReader,
  readDnrrvtPage,
  readDocumentsPage,
  readNewsPage,
  readTthcPage,
} from "./reader-fallback.mjs";
import { absoluteUrl, uniqueBy } from "./utils.mjs";
import {
  browserCrawlDocumentForm,
  browserCrawlPaged,
  browserExtractNewsItems,
  browserFetchFromCandidates,
  cacheArticleImages,
} from "./browser-fetcher.mjs";

const NEWS = {
  thue: {
    marker: "cucthue",
    paths: [
      "/wps/portal/news/list?1dmy&current=true&urile=wcm:path:/nghean/site/news/cucthue",
      "/wps/portal/?uri=nm:oid:Z6_049IL8VSOJDB70IERMA7G92021",
    ],
  },
  kinhte: {
    marker: "economy",
    paths: [
      "/wps/portal/news/list?1dmy&current=true&urile=wcm:path:/nghean/site/news/economy",
      "/wps/portal/?uri=nm:oid:Z6_049IL8VSOJDB70IERMA7G920A4",
    ],
  },
  thongbao: {
    marker: "annocement",
    paths: [
      "/wps/portal/news/list?1dmy&current=true&urile=wcm:path:/nghean/site/news/annocement",
      "/wps/portal/?uri=nm:oid:Z6_049IL8VSOJDB70IERMA7G920Q3",
    ],
  },
};

const DOCS = {
  huongdan: [
    "/wps/portal/?uri=nm:oid:Z6_049IL8VSO39F80IE3NQ7HJ2692",
  ],
  khac: [
    "/wps/portal/?uri=nm:oid:Z6_049IL8VSO3VHF0I1AMGLAN38M0",
  ],
  nganh: [
    "/wps/portal/?uri=nm:oid:Z6_049IL8VSOJHE00IHBC611510D2",
    "/wps/portal/?uri=nm:oid:Z6_049IL8VSOJHE00IHBC611518V5",
  ],
};

function readerUrls(paths) {
  const out = [];
  for (const pathOrUrl of paths || []) {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      out.push(pathOrUrl);
      continue;
    }
    const path = String(pathOrUrl).startsWith("/") ? String(pathOrUrl) : `/${pathOrUrl}`;
    // Reader thường ổn định hơn với HTTPS; vẫn giữ HTTP làm dự phòng.
    out.push(`https://nghean.gdt.gov.vn${path}`);
    out.push(`http://nghean.gdt.gov.vn${path}`);
  }
  return uniqueBy(out, (x) => x);
}

async function mergeCurrent(dataset, freshItems, keyFn) {
  const current = await readDataset(dataset);
  const oldItems = Array.isArray(current.items) ? current.items : [];
  return {
    current,
    items: uniqueBy([...(freshItems || []), ...oldItems], keyFn),
  };
}

function joinedErrors(errors) {
  return errors.filter(Boolean).join(" | ").slice(0, 8000);
}

function countNewsBlocks(html = "") {
  return (String(html).match(/class\s*=\s*(["'])[^"']*\bnews\b[^"']*\1/gi) || []).length;
}

function isRealNewsListPage({ html = "", url = "", items = [] }) {
  const hasListUrl = /\/news\/list(?:\?|$)/i.test(url) || /mapping=news\/list/i.test(url);
  const hasManyBlocks = countNewsBlocks(html) >= 5;
  const hasPager = /linkToPage_\d+|_nextPage|class\s*=\s*(["'])[^"']*\bpage\b/i.test(html);
  return items.length >= 5 && (hasListUrl || hasManyBlocks || hasPager);
}

function newsKey(item) {
  try {
    const url = new URL(item.url);
    const urile = url.searchParams.get("urile") || "";
    return urile || url.pathname + url.search;
  } catch {
    return item.url || `${item.date || ""}|${item.title || ""}`;
  }
}

function cleanNewsItems(items) {
  return uniqueBy(
    (items || []).filter((item) => item?.title && item?.url),
    newsKey
  );
}

async function firstWorking(paths, options = {}) {
  const errors = [];
  for (const path of paths) {
    try {
      return await fetchFromCandidates(path, options);
    } catch (error) {
      errors.push(`${path}: ${error?.message || error}`);
    }
  }
  throw new Error(errors.join(" | "));
}

async function crawlPagedGet(first, parseItems, maxPages = 10) {
  const queue = [{ url: first.url, text: first.text, cookie: first.cookie || "" }];
  const queued = new Set([first.url]);
  const visited = new Set();
  let items = [];
  let cookie = first.cookie || "";

  while (queue.length && visited.size < maxPages) {
    const current = queue.shift();
    if (!current?.url || visited.has(current.url)) continue;
    visited.add(current.url);

    let text = current.text;
    let finalUrl = current.url;
    if (typeof text !== "string") {
      const page = await fetchTextDetailed(current.url, {
        retries: 1,
        timeoutMs: config.requestTimeoutMs,
        cookie,
        headers: { referer: first.url },
      });
      text = page.text;
      finalUrl = page.url || current.url;
      cookie = page.cookie || cookie;
    }

    items.push(...parseItems(text, finalUrl));
    const links = parsePaginationUrls(text, finalUrl, maxPages * 3);
    for (const link of links) {
      if (!queued.has(link) && !visited.has(link) && queued.size < maxPages * 4) {
        queued.add(link);
        queue.push({ url: link });
      }
    }
  }

  return items;
}

export async function collectNewsTab(tab) {
  const cfg = NEWS[tab];
  if (!cfg) throw new Error(`Tab tin không hợp lệ: ${tab}`);
  const dataset = `news-${tab}`;
  const errors = [];
  let fresh = [];
  let sourceUrl = "";
  let sourceStatus = 200;
  let sourceMode = "";
  let partial = true;
  let debug = {};

  // Ưu tiên trình duyệt thật. Trang Thuế trả khác nhau cho fetch máy chủ và trình duyệt.
  try {
    const result = await browserCrawlPaged({
      startPaths: cfg.paths,
      parseItems: (html, baseUrl) => parseNews(html, baseUrl, tab, cfg.marker),
      parseLinks: (html, baseUrl) => parsePaginationUrls(html, baseUrl, config.maxBrowserNewsPages * 4),
      maxPages: config.maxBrowserNewsPages,
      validateFirstPage: isRealNewsListPage,
      extractFromPage: (page) => browserExtractNewsItems(page, tab, cfg.marker),
    });
    const browserItems = cleanNewsItems(result.items);
    debug.browser = {
      firstUrl: result.firstUrl,
      firstPageItemCount: result.firstPageItemCount,
      firstPageValidated: result.firstPageValidated,
      visitedPages: result.visitedPages,
      visitedUrls: result.visitedUrls,
      errors: result.errors,
      exhausted: result.exhausted,
      hitPageLimit: result.hitPageLimit,
    };
    if (!result.firstPageValidated) {
      throw new Error(
        `Trình duyệt không mở đúng trang danh sách: trang đầu chỉ nhận ${result.firstPageItemCount} tin tại ${result.firstUrl}`
      );
    }
    if (browserItems.length < 5) {
      throw new Error(`Trình duyệt chỉ lấy được ${browserItems.length} tin.`);
    }
    fresh = browserItems;
    sourceUrl = result.firstUrl;
    sourceStatus = result.firstStatus;
    sourceMode = "browser";
    partial = Boolean(result.errors.length || result.hitPageLimit);
  } catch (error) {
    errors.push(`Browser: ${error?.message || error}`);
  }

  // Dự phòng HTTP fetch, nhưng tuyệt đối không chấp nhận trang chủ 4 tin làm trang danh sách.
  if (!fresh.length) {
    try {
      const first = await firstWorking(cfg.paths);
      const firstItems = parseNews(first.text, first.url, tab, cfg.marker);
      if (!isRealNewsListPage({ html: first.text, url: first.url, items: firstItems })) {
        throw new Error(`Fetch trả sai trang/tóm tắt, chỉ có ${firstItems.length} tin tại ${first.url}`);
      }
      const directItems = await crawlPagedGet(
        first,
        (text, baseUrl) => parseNews(text, baseUrl, tab, cfg.marker),
        config.maxNewsPages
      );
      fresh = cleanNewsItems(directItems);
      sourceUrl = first.url;
      sourceStatus = first.status;
      sourceMode = "direct";
      partial = false;
    } catch (error) {
      errors.push(`Trực tiếp: ${error?.message || error}`);
    }
  }

  // Reader chỉ được dùng nếu trả ít nhất một trang danh sách thật, không trộn với seed cũ.
  if (!fresh.length && config.readerEnabled) {
    try {
      const result = await crawlReader(
        readerUrls(cfg.paths),
        (url) => readNewsPage(url, tab, cfg.marker),
        config.maxReaderNewsPages
      );
      const readerItems = cleanNewsItems(result.items);
      if (readerItems.length < 5) {
        throw new Error(`Reader chỉ lấy được ${readerItems.length} tin, không đủ xác nhận trang danh sách.`);
      }
      fresh = readerItems;
      sourceUrl = result.firstSuccessUrl || "";
      sourceMode = "reader";
      partial = Boolean(result.errors.length);
      debug.reader = { errors: result.errors, visitedPages: result.visitedPages };
    } catch (error) {
      errors.push(`Reader: ${error?.message || error}`);
    }
  }

  if (!fresh.length) {
    const error = new Error(joinedErrors(errors) || "Không mở được trang danh sách tin thật.");
    await markFailure(dataset, error);
    console.error(`[collector] ${dataset} lỗi:`, error.message);
    throw error;
  }

  // Không gộp tin live với seed cũ: đây chính là nguyên nhân tạo danh sách 4 tin mới + tin cũ sai thứ tự.
  fresh = await cacheArticleImages(fresh, dataset);
  await saveSuccess(dataset, fresh, {
    sourceUrl,
    sourceStatus,
    sourceMode,
    fetchedItemCount: fresh.length,
    partial,
    stale: partial,
    lastError: partial ? joinedErrors([...errors, ...(debug.browser?.errors || [])]) || "Đã lấy được dữ liệu nhưng chưa xác nhận hết tất cả trang." : "",
    diagnostics: debug,
  });
  console.log(`[collector] ${dataset}: thay mới ${fresh.length} tin, nguồn ${sourceMode}, partial=${partial}`);
  return fresh;
}

export async function collectAllNews() {
  const result = {};
  for (const tab of Object.keys(NEWS)) {
    try {
      result[tab] = await collectNewsTab(tab);
    } catch {
      result[tab] = null;
    }
  }
  return result;
}

export async function collectDocsTab(tab) {
  const paths = DOCS[tab];
  if (!paths) throw new Error(`Tab văn bản không hợp lệ: ${tab}`);
  const dataset = `docs-${tab}`;
  const errors = [];
  const key = (x) => `${x.code || ""}|${x.date || ""}|${x.title || ""}`;
  let fresh = [];
  let sourceUrl = "";
  let sourceStatus = 200;
  let sourceMode = "";
  let partial = true;
  let diagnostics = {};

  try {
    const result = await browserCrawlDocumentForm({
      startPaths: paths,
      parseItems: (html, baseUrl) => parseDocuments(html, baseUrl, tab),
      parseMaxPage,
      maxPages: config.maxBrowserDocPages,
    });
    const browserItems = uniqueBy(result.items || [], key);
    diagnostics.browser = {
      firstUrl: result.firstUrl,
      firstPageItemCount: result.firstPageItemCount,
      visitedPages: result.visitedPages,
      visitedUrls: result.visitedUrls,
      errors: result.errors,
    };
    if (!result.firstPageValidated || browserItems.length === 0) {
      throw new Error(`Trình duyệt không nhận được bảng văn bản tại ${result.firstUrl}.`);
    }
    fresh = browserItems;
    sourceUrl = result.firstUrl;
    sourceStatus = result.firstStatus;
    sourceMode = "browser";
    partial = Boolean(result.errors.length);
  } catch (error) {
    errors.push(`Browser: ${error?.message || error}`);
  }

  if (!fresh.length) {
    try {
      const first = await firstWorking(paths);
      sourceUrl = first.url;
      sourceStatus = first.status;
      let directItems = parseDocuments(first.text, first.url, tab);
      if (!directItems.length) throw new Error(`Không thấy bảng văn bản tại ${first.url}`);
      const actionUrl = parseSearchFormAction(first.text, first.url);
      const maxPage = Math.max(1, parseMaxPage(first.text, config.maxDocPages));
      let cookie = first.cookie || "";
      if (actionUrl) {
        let emptyPages = 0;
        const limit = maxPage > 1 ? maxPage : config.maxDocPages;
        for (let pageNum = 2; pageNum <= limit; pageNum++) {
          try {
            const body = new URLSearchParams({ page: String(pageNum), cmd: "" }).toString();
            const page = await fetchTextDetailed(actionUrl, {
              method: "POST",
              cookie,
              headers: {
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                referer: first.url,
              },
              body,
              retries: 1,
            });
            cookie = page.cookie || cookie;
            const parsed = parseDocuments(page.text, page.url || actionUrl, tab);
            if (!parsed.length) {
              emptyPages += 1;
              if (maxPage === 1 || emptyPages >= 2) break;
            } else {
              emptyPages = 0;
              const before = directItems.length;
              directItems = uniqueBy([...directItems, ...parsed], key);
              if (directItems.length === before && maxPage === 1) break;
            }
          } catch (error) {
            errors.push(`Trang POST ${pageNum}: ${error?.message || error}`);
            break;
          }
        }
      }
      fresh = uniqueBy(directItems, key);
      sourceMode = "direct";
      partial = false;
    } catch (error) {
      errors.push(`Trực tiếp: ${error?.message || error}`);
    }
  }

  if (!fresh.length && config.readerEnabled) {
    try {
      const result = await crawlReader(
        readerUrls(paths),
        (url) => readDocumentsPage(url, tab),
        config.maxReaderDocPages
      );
      fresh = uniqueBy(result.items || [], key);
      if (!fresh.length) throw new Error("Reader không trả văn bản.");
      sourceUrl = result.firstSuccessUrl || "";
      sourceMode = "reader";
      partial = Boolean(result.errors.length);
      diagnostics.reader = { errors: result.errors, visitedPages: result.visitedPages };
    } catch (error) {
      errors.push(`Reader: ${error?.message || error}`);
    }
  }

  if (!fresh.length) {
    const error = new Error(joinedErrors(errors) || "Không thu được danh sách văn bản.");
    await markFailure(dataset, error);
    throw error;
  }

  await saveSuccess(dataset, fresh, {
    sourceUrl,
    sourceStatus,
    sourceMode,
    fetchedItemCount: fresh.length,
    partial,
    stale: partial,
    lastError: partial ? joinedErrors(errors) || "Chưa xác nhận hết các trang văn bản." : "",
    diagnostics,
  });
  console.log(`[collector] ${dataset}: thay mới ${fresh.length} văn bản, nguồn ${sourceMode}`);
  return fresh;
}

export async function collectAllDocs() {
  const result = {};
  for (const tab of Object.keys(DOCS)) {
    try {
      result[tab] = await collectDocsTab(tab);
    } catch {
      result[tab] = null;
    }
  }
  return result;
}

export async function collectTthc() {
  const dataset = "tthc";
  const paths = [
    "/wps/portal/?uri=nm:oid:Z6_049IL8VSOJ8800IHMB7OA4E7E1",
    "/wps/portal/Home/tthc",
    "/wps/portal/home/tthc",
  ];
  const errors = [];
  const key = (x) => x.link || `${x.group || ""}|${x.title || ""}`;
  let fresh = [];
  let sourceUrl = "";
  let sourceStatus = 200;
  let sourceMode = "";
  let partial = true;
  let diagnostics = {};

  try {
    const result = await browserCrawlPaged({
      startPaths: paths,
      parseItems: (html, baseUrl) => parseTthc(html, baseUrl),
      parseLinks: (html, baseUrl) => uniqueBy([
        ...findViewAllUrls(html, baseUrl),
        ...parsePaginationUrls(html, baseUrl, config.maxBrowserDocPages * 4),
      ], (x) => x),
      maxPages: config.maxBrowserDocPages,
      validateFirstPage: ({ html, items }) => items.length >= 3 && /Tên thủ tục hành chính|Cơ quan thực hiện/i.test(html),
    });
    const browserItems = uniqueBy(result.items || [], key);
    diagnostics.browser = {
      firstUrl: result.firstUrl,
      firstPageItemCount: result.firstPageItemCount,
      visitedPages: result.visitedPages,
      visitedUrls: result.visitedUrls,
      errors: result.errors,
      exhausted: result.exhausted,
      hitPageLimit: result.hitPageLimit,
    };
    if (!result.firstPageValidated || browserItems.length < 3) {
      throw new Error(`Trình duyệt không mở đúng trang TTHC tại ${result.firstUrl}.`);
    }
    fresh = browserItems;
    sourceUrl = result.firstUrl;
    sourceStatus = result.firstStatus;
    sourceMode = "browser";
    partial = Boolean(result.errors.length || result.hitPageLimit);
  } catch (error) {
    errors.push(`Browser: ${error?.message || error}`);
  }

  if (!fresh.length) {
    try {
      const first = await firstWorking(paths);
      sourceUrl = first.url;
      sourceStatus = first.status;
      let directItems = parseTthc(first.text, first.url);
      const viewAllUrls = findViewAllUrls(first.text, first.url);
      for (const viewAll of viewAllUrls) {
        try {
          const all = await fetchTextDetailed(viewAll, { retries: 1, cookie: first.cookie, headers: { referer: first.url } });
          directItems.push(...await crawlPagedGet(all, (text, baseUrl) => parseTthc(text, baseUrl), 80));
        } catch (error) {
          errors.push(`Xem toàn bộ: ${error?.message || error}`);
        }
      }
      fresh = uniqueBy(directItems, key);
      if (fresh.length < 3) throw new Error(`Chỉ lấy được ${fresh.length} TTHC.`);
      sourceMode = "direct";
      partial = false;
    } catch (error) {
      errors.push(`Trực tiếp: ${error?.message || error}`);
    }
  }

  if (!fresh.length && config.readerEnabled) {
    try {
      const result = await crawlReader(readerUrls(paths), (url) => readTthcPage(url), 60);
      fresh = uniqueBy(result.items || [], key);
      if (fresh.length < 3) throw new Error(`Reader chỉ lấy được ${fresh.length} TTHC.`);
      sourceUrl = result.firstSuccessUrl || "";
      sourceMode = "reader";
      partial = Boolean(result.errors.length);
      diagnostics.reader = { errors: result.errors, visitedPages: result.visitedPages };
    } catch (error) {
      errors.push(`Reader: ${error?.message || error}`);
    }
  }

  if (!fresh.length) {
    const error = new Error(joinedErrors(errors) || "Không thu được thủ tục hành chính.");
    await markFailure(dataset, error);
    throw error;
  }

  await saveSuccess(dataset, fresh, {
    sourceUrl,
    sourceStatus,
    sourceMode,
    fetchedItemCount: fresh.length,
    partial,
    stale: partial,
    lastError: partial ? joinedErrors(errors) || "Chưa xác nhận hết các trang TTHC." : "",
    diagnostics,
  });
  console.log(`[collector] ${dataset}: thay mới ${fresh.length} thủ tục, nguồn ${sourceMode}`);
  return fresh;
}

export async function collectFeedback() {
  const dataset = "tthc-phananh";
  const paths = [
    "/wps/portal/?uri=nm:oid:Z6_QOHUBB1A088P60A15IU4CO0031",
    "/wps/portal/Home/tthc/phananh",
    "/wps/portal/home/tthc/phananh",
  ];
  try {
    const first = await firstWorking(paths);
    const contentHtml = extractFeedbackHtml(first.text, first.url);
    if (!contentHtml || contentHtml.length < 50) throw new Error("Không tìm thấy nội dung phản ánh, kiến nghị.");
    await saveSuccess(dataset, [{ contentHtml, title: "Tiếp nhận phản ánh, kiến nghị", url: first.url }], { sourceUrl: first.url, sourceStatus: first.status });
    console.log(`[collector] ${dataset}: đã cập nhật`);
    return contentHtml;
  } catch (error) {
    await markFailure(dataset, error);
    console.error(`[collector] ${dataset} lỗi:`, error.message);
    throw error;
  }
}

export async function collectVideos() {
  const dataset = "videos";
  const paths = [
    "/wps/portal/video?1dmy&current=true&urile=wcm:path:/nghean/site/video",
    "/wps/portal/?uri=nm:oid:Z6_049IL8VSOJOAE0I1MJ5KSF00A3",
    "/wps/portal",
  ];
  try {
    const first = await firstWorking(paths);
    let items = parseVideos(first.text, first.url);
    const links = parsePageLinks(first.text, first.url, 20);
    for (const [, pageUrl] of [...links.entries()].sort((a, b) => a[0] - b[0])) {
      try {
        const page = await fetchTextDetailed(pageUrl, { retries: 1 });
        items.push(...parseVideos(page.text, page.url));
      } catch (error) {
        console.warn("[collector] videos bỏ qua một trang:", error.message);
      }
    }
    items = uniqueBy(items, (x) => `${x.title}|${x.videoUrl}`);
    await saveSuccess(dataset, items, { sourceUrl: first.url, sourceStatus: first.status });
    console.log(`[collector] ${dataset}: ${items.length} mục`);
    return items;
  } catch (error) {
    await markFailure(dataset, error);
    console.error(`[collector] ${dataset} lỗi:`, error.message);
    throw error;
  }
}

export async function collectDvc() {
  const dataset = "dvc";
  const paths = ["/wps/portal", "/wps/portal/nghean", "/wps/portal/?uri=nm:oid:Z6_049IL8VSO3AM00I1935RNOCEO2"];
  try {
    const first = await firstWorking(paths);
    const items = parseDvc(first.text, first.url);
    await saveSuccess(dataset, items, { sourceUrl: first.url, sourceStatus: first.status });
    console.log(`[collector] ${dataset}: ${items.length} mục`);
    return items;
  } catch (error) {
    await markFailure(dataset, error);
    console.error(`[collector] ${dataset} lỗi:`, error.message);
    throw error;
  }
}

export async function collectDnrrvt() {
  const dataset = "dnrrvt";
  const paths = [
    "/wps/portal/Home/dnrrvt?1dmy&current=true&urile=wcm:path:/nghean/site/sa-dnrrcvt",
    "/wps/portal/Home/dnrrvt",
  ];
  const errors = [];
  const key = (x) => `${x.soQd || ""}|${x.ngayQd || ""}|${x.coQuan || ""}`;
  let fresh = [];
  let sourceUrl = "";
  let sourceStatus = 200;
  let sourceMode = "";
  let partial = true;
  let diagnostics = {};

  try {
    const result = await browserCrawlPaged({
      startPaths: paths,
      parseItems: (html, baseUrl) => parseDnrrvt(html, baseUrl),
      parseLinks: (html, baseUrl) => parsePaginationUrls(html, baseUrl, 400),
      maxPages: 100,
      validateFirstPage: ({ html, items }) => items.length >= 5 && /Ngày quyết định|Số quyết định/i.test(html),
    });
    const browserItems = uniqueBy(result.items || [], key);
    diagnostics.browser = {
      firstUrl: result.firstUrl,
      firstPageItemCount: result.firstPageItemCount,
      visitedPages: result.visitedPages,
      visitedUrls: result.visitedUrls,
      errors: result.errors,
      exhausted: result.exhausted,
      hitPageLimit: result.hitPageLimit,
    };
    if (!result.firstPageValidated || browserItems.length < 5) {
      throw new Error(`Trình duyệt không mở đúng danh sách DNRRVT tại ${result.firstUrl}.`);
    }
    fresh = browserItems;
    sourceUrl = result.firstUrl;
    sourceStatus = result.firstStatus;
    sourceMode = "browser";
    partial = Boolean(result.errors.length || result.hitPageLimit);
  } catch (error) {
    errors.push(`Browser: ${error?.message || error}`);
  }

  if (!fresh.length) {
    try {
      const first = await firstWorking(paths);
      const directItems = await crawlPagedGet(first, (text, baseUrl) => parseDnrrvt(text, baseUrl), 100);
      fresh = uniqueBy(directItems, key);
      if (fresh.length < 5) throw new Error(`Chỉ lấy được ${fresh.length} dòng DNRRVT.`);
      sourceUrl = first.url;
      sourceStatus = first.status;
      sourceMode = "direct";
      partial = false;
    } catch (error) {
      errors.push(`Trực tiếp: ${error?.message || error}`);
    }
  }

  if (!fresh.length && config.readerEnabled) {
    try {
      const result = await crawlReader(readerUrls(paths), (url) => readDnrrvtPage(url), 100);
      fresh = uniqueBy(result.items || [], key);
      if (fresh.length < 5) throw new Error(`Reader chỉ lấy được ${fresh.length} dòng DNRRVT.`);
      sourceUrl = result.firstSuccessUrl || "";
      sourceMode = "reader";
      partial = Boolean(result.errors.length);
      diagnostics.reader = { errors: result.errors, visitedPages: result.visitedPages };
    } catch (error) {
      errors.push(`Reader: ${error?.message || error}`);
    }
  }

  if (!fresh.length) {
    const error = new Error(joinedErrors(errors) || "Không thu được danh sách doanh nghiệp rủi ro cao.");
    await markFailure(dataset, error);
    throw error;
  }

  await saveSuccess(dataset, fresh, {
    sourceUrl,
    sourceStatus,
    sourceMode,
    fetchedItemCount: fresh.length,
    partial,
    stale: partial,
    lastError: partial ? joinedErrors(errors) || "Chưa xác nhận hết các trang DNRRVT." : "",
    diagnostics,
  });
  console.log(`[collector] ${dataset}: thay mới ${fresh.length} mục, nguồn ${sourceMode}`);
  return fresh;
}

export async function collectOthers() {
  const jobs = [collectTthc, collectFeedback, collectVideos, collectDvc, collectDnrrvt];
  const out = {};
  for (const job of jobs) {
    try {
      out[job.name] = await job();
    } catch {
      out[job.name] = null;
    }
  }
  return out;
}

export async function collectEverything() {
  return {
    news: await collectAllNews(),
    docs: await collectAllDocs(),
    others: await collectOthers(),
  };
}
