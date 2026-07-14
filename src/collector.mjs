import { config } from "./config.mjs";
import { fetchFromCandidates, fetchTextDetailed } from "./fetcher.mjs";
import {
  extractFeedbackHtml,
  findViewAllUrl,
  parseDnrrvt,
  parseDocuments,
  parseDvc,
  parseMaxPage,
  parseNews,
  parsePageLinks,
  parseSearchFormAction,
  parseTthc,
  parseVideos,
} from "./parsers.mjs";
import { markFailure, saveSuccess } from "./store.mjs";
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

export async function collectNewsTab(tab) {
  const cfg = NEWS[tab];
  if (!cfg) throw new Error(`Tab tin không hợp lệ: ${tab}`);
  const dataset = `news-${tab}`;
  try {
    const first = await firstWorking(cfg.paths);
    let items = parseNews(first.text, first.url, tab, cfg.marker);
    const links = parsePageLinks(first.text, first.url, config.maxNewsPages);

    for (const [, pageUrl] of [...links.entries()].sort((a, b) => a[0] - b[0])) {
      try {
        const page = await fetchTextDetailed(pageUrl, { retries: 1, timeoutMs: config.requestTimeoutMs });
        items.push(...parseNews(page.text, page.url, tab, cfg.marker));
      } catch (error) {
        console.warn(`[collector] ${dataset} bỏ qua một trang:`, error.message);
      }
    }

    items = uniqueBy(items, (x) => x.url);
    await saveSuccess(dataset, items, { sourceUrl: first.url, sourceStatus: first.status });
    console.log(`[collector] ${dataset}: ${items.length} mục`);
    return items;
  } catch (error) {
    await markFailure(dataset, error);
    console.error(`[collector] ${dataset} lỗi:`, error.message);
    throw error;
  }
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
  try {
    const first = await firstWorking(paths);
    let items = parseDocuments(first.text, first.url, tab);
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
            const before = items.length;
            items.push(...parsed);
            items = uniqueBy(items, (x) => `${x.code}|${x.date}|${x.title}`);
            if (items.length === before && maxPage === 1) break;
          }
        } catch (error) {
          console.warn(`[collector] ${dataset} trang ${pageNum} lỗi:`, error.message);
          if (maxPage === 1) break;
        }
      }
    }

    items = uniqueBy(items, (x) => `${x.code}|${x.date}|${x.title}`);
    await saveSuccess(dataset, items, { sourceUrl: first.url, sourceStatus: first.status });
    console.log(`[collector] ${dataset}: ${items.length} mục`);
    return items;
  } catch (error) {
    await markFailure(dataset, error);
    console.error(`[collector] ${dataset} lỗi:`, error.message);
    throw error;
  }
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
  try {
    const first = await firstWorking(paths);
    let items = parseTthc(first.text, first.url);
    const viewAll = findViewAllUrl(first.text, first.url);
    if (viewAll) {
      try {
        const all = await fetchTextDetailed(viewAll, { retries: 1 });
        const parsed = parseTthc(all.text, all.url);
        if (parsed.length >= items.length) items = parsed;
      } catch (error) {
        console.warn("[collector] tthc link xem toàn bộ lỗi:", error.message);
      }
    }
    await saveSuccess(dataset, items, { sourceUrl: first.url, sourceStatus: first.status });
    console.log(`[collector] ${dataset}: ${items.length} mục`);
    return items;
  } catch (error) {
    await markFailure(dataset, error);
    console.error(`[collector] ${dataset} lỗi:`, error.message);
    throw error;
  }
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
  try {
    const first = await firstWorking(paths);
    let items = parseDnrrvt(first.text, first.url);
    const links = parsePageLinks(first.text, first.url, 100);
    for (const [, pageUrl] of [...links.entries()].sort((a, b) => a[0] - b[0])) {
      try {
        const page = await fetchTextDetailed(pageUrl, { retries: 1, cookie: first.cookie, headers: { referer: first.url } });
        items.push(...parseDnrrvt(page.text, page.url));
      } catch (error) {
        console.warn("[collector] dnrrvt bỏ qua một trang:", error.message);
      }
    }
    items = uniqueBy(items, (x) => `${x.soQd}|${x.ngayQd}|${x.coQuan}`);
    await saveSuccess(dataset, items, { sourceUrl: first.url, sourceStatus: first.status });
    console.log(`[collector] ${dataset}: ${items.length} mục`);
    return items;
  } catch (error) {
    await markFailure(dataset, error);
    console.error(`[collector] ${dataset} lỗi:`, error.message);
    throw error;
  }
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
