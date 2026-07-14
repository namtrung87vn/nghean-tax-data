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
  let directItems = [];
  let readerItems = [];
  let sourceUrl = "";
  let sourceStatus = 200;

  try {
    const first = await firstWorking(cfg.paths);
    sourceUrl = first.url;
    sourceStatus = first.status;
    directItems = await crawlPagedGet(
      first,
      (text, baseUrl) => parseNews(text, baseUrl, tab, cfg.marker),
      config.maxNewsPages
    );
  } catch (error) {
    errors.push(`Trực tiếp: ${error?.message || error}`);
  }

  // GitHub-hosted runner hiện bị nguồn Thuế từ chối/timeout. Dùng Reader như một IP trung gian hợp lệ.
  if (directItems.length < 10) {
    try {
      const result = await crawlReader(
        readerUrls(cfg.paths),
        (url) => readNewsPage(url, tab, cfg.marker),
        config.maxReaderNewsPages
      );
      readerItems = result.items;
      if (!sourceUrl && result.firstSuccessUrl) sourceUrl = result.firstSuccessUrl;
      if (result.errors.length) errors.push(`Reader: ${result.errors.join(" ; ")}`);
    } catch (error) {
      errors.push(`Reader: ${error?.message || error}`);
    }
  }

  const fresh = uniqueBy([...directItems, ...readerItems], (x) => x.url);
  if (fresh.length === 0) {
    const error = new Error(joinedErrors(errors) || "Không thu được tin trực tiếp hoặc qua Reader.");
    await markFailure(dataset, error);
    console.error(`[collector] ${dataset} lỗi:`, error.message);
    throw error;
  }

  const merged = await mergeCurrent(dataset, fresh, (x) => x.url || `${x.date}|${x.title}`);
  const partial = fresh.length < 10;
  const sourceMode = directItems.length && readerItems.length ? "direct+reader" : readerItems.length ? "reader" : "direct";
  await saveSuccess(dataset, merged.items, {
    sourceUrl,
    sourceStatus,
    sourceMode,
    fetchedItemCount: fresh.length,
    partial,
    stale: partial,
    lastError: partial ? joinedErrors(errors) || `Mới lấy được ${fresh.length} mục; giữ thêm dữ liệu cũ.` : "",
  });
  console.log(`[collector] ${dataset}: mới ${fresh.length}, tổng lưu ${merged.items.length}, nguồn ${sourceMode}`);
  return merged.items;
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
  let directItems = [];
  let readerItems = [];
  let sourceUrl = "";
  let sourceStatus = 200;

  try {
    const first = await firstWorking(paths);
    sourceUrl = first.url;
    sourceStatus = first.status;
    directItems = parseDocuments(first.text, first.url, tab);
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
          if (parsed.length === 0) {
            emptyPages += 1;
            if (maxPage === 1 || emptyPages >= 2) break;
          } else {
            emptyPages = 0;
            const before = directItems.length;
            directItems.push(...parsed);
            directItems = uniqueBy(directItems, (x) => `${x.code}|${x.date}|${x.title}`);
            if (directItems.length === before && maxPage === 1) break;
          }
        } catch (error) {
          errors.push(`Trang POST ${pageNum}: ${error?.message || error}`);
          if (maxPage === 1) break;
        }
      }
    }
  } catch (error) {
    errors.push(`Trực tiếp: ${error?.message || error}`);
  }

  if (directItems.length < 10) {
    try {
      const result = await crawlReader(
        readerUrls(paths),
        (url) => readDocumentsPage(url, tab),
        config.maxReaderDocPages
      );
      readerItems = result.items;
      if (!sourceUrl && result.firstSuccessUrl) sourceUrl = result.firstSuccessUrl;
      if (result.errors.length) errors.push(`Reader: ${result.errors.join(" ; ")}`);
    } catch (error) {
      errors.push(`Reader: ${error?.message || error}`);
    }
  }

  const key = (x) => `${x.code}|${x.date}|${x.title}`;
  const fresh = uniqueBy([...directItems, ...readerItems], key);
  if (fresh.length === 0) {
    const error = new Error(joinedErrors(errors) || "Không thu được danh sách văn bản.");
    await markFailure(dataset, error);
    console.error(`[collector] ${dataset} lỗi:`, error.message);
    throw error;
  }

  const merged = await mergeCurrent(dataset, fresh, key);
  const partial = fresh.length < 10;
  const sourceMode = directItems.length && readerItems.length ? "direct+reader" : readerItems.length ? "reader" : "direct";
  await saveSuccess(dataset, merged.items, {
    sourceUrl,
    sourceStatus,
    sourceMode,
    fetchedItemCount: fresh.length,
    partial,
    stale: partial,
    lastError: partial ? joinedErrors(errors) || `Mới lấy được ${fresh.length} văn bản; giữ thêm dữ liệu cũ.` : "",
  });
  console.log(`[collector] ${dataset}: mới ${fresh.length}, tổng lưu ${merged.items.length}, nguồn ${sourceMode}`);
  return merged.items;
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
  let directItems = [];
  let readerItems = [];
  let sourceUrl = "";
  let sourceStatus = 200;

  try {
    const first = await firstWorking(paths);
    sourceUrl = first.url;
    sourceStatus = first.status;
    directItems = parseTthc(first.text, first.url);
    const viewAllUrls = findViewAllUrls(first.text, first.url);
    for (const viewAll of viewAllUrls) {
      try {
        const all = await fetchTextDetailed(viewAll, { retries: 1, cookie: first.cookie, headers: { referer: first.url } });
        const crawled = await crawlPagedGet(all, (text, baseUrl) => parseTthc(text, baseUrl), 60);
        directItems.push(...crawled);
      } catch (error) {
        errors.push(`Xem toàn bộ: ${error?.message || error}`);
      }
    }
  } catch (error) {
    errors.push(`Trực tiếp: ${error?.message || error}`);
  }

  if (directItems.length < 10) {
    try {
      const result = await crawlReader(
        readerUrls(paths),
        (url) => readTthcPage(url),
        40
      );
      readerItems = result.items;
      if (!sourceUrl && result.firstSuccessUrl) sourceUrl = result.firstSuccessUrl;
      if (result.errors.length) errors.push(`Reader: ${result.errors.join(" ; ")}`);
    } catch (error) {
      errors.push(`Reader: ${error?.message || error}`);
    }
  }

  const key = (x) => x.link || `${x.group}|${x.title}`;
  const fresh = uniqueBy([...directItems, ...readerItems], key);
  if (fresh.length === 0) {
    const error = new Error(joinedErrors(errors) || "Không thu được thủ tục hành chính.");
    await markFailure(dataset, error);
    throw error;
  }
  const merged = await mergeCurrent(dataset, fresh, key);
  const partial = fresh.length < 10;
  const sourceMode = directItems.length && readerItems.length ? "direct+reader" : readerItems.length ? "reader" : "direct";
  await saveSuccess(dataset, merged.items, {
    sourceUrl, sourceStatus, sourceMode, fetchedItemCount: fresh.length,
    partial, stale: partial,
    lastError: partial ? joinedErrors(errors) || `Mới lấy được ${fresh.length} thủ tục; giữ thêm dữ liệu cũ.` : "",
  });
  console.log(`[collector] ${dataset}: mới ${fresh.length}, tổng lưu ${merged.items.length}, nguồn ${sourceMode}`);
  return merged.items;
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
  let directItems = [];
  let readerItems = [];
  let sourceUrl = "";
  let sourceStatus = 200;

  try {
    const first = await firstWorking(paths);
    sourceUrl = first.url;
    sourceStatus = first.status;
    directItems = await crawlPagedGet(first, (text, baseUrl) => parseDnrrvt(text, baseUrl), 100);
  } catch (error) {
    errors.push(`Trực tiếp: ${error?.message || error}`);
  }

  if (directItems.length < 20) {
    try {
      const result = await crawlReader(
        readerUrls(paths),
        (url) => readDnrrvtPage(url),
        100
      );
      readerItems = result.items;
      if (!sourceUrl && result.firstSuccessUrl) sourceUrl = result.firstSuccessUrl;
      if (result.errors.length) errors.push(`Reader: ${result.errors.join(" ; ")}`);
    } catch (error) {
      errors.push(`Reader: ${error?.message || error}`);
    }
  }

  const key = (x) => `${x.soQd}|${x.ngayQd}|${x.coQuan}`;
  const fresh = uniqueBy([...directItems, ...readerItems], key);
  if (fresh.length === 0) {
    const error = new Error(joinedErrors(errors) || "Không thu được danh sách doanh nghiệp rủi ro cao.");
    await markFailure(dataset, error);
    throw error;
  }
  const merged = await mergeCurrent(dataset, fresh, key);
  const partial = fresh.length < 20;
  const sourceMode = directItems.length && readerItems.length ? "direct+reader" : readerItems.length ? "reader" : "direct";
  await saveSuccess(dataset, merged.items, {
    sourceUrl, sourceStatus, sourceMode, fetchedItemCount: fresh.length,
    partial, stale: partial,
    lastError: partial ? joinedErrors(errors) || `Mới lấy được ${fresh.length} mục; giữ thêm dữ liệu cũ.` : "",
  });
  console.log(`[collector] ${dataset}: mới ${fresh.length}, tổng lưu ${merged.items.length}, nguồn ${sourceMode}`);
  return merged.items;
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
