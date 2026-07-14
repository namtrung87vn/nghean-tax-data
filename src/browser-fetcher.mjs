import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.mjs";
import { sleep, uniqueBy } from "./utils.mjs";

let browserPromise = null;
let contextPromise = null;

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(
      "Chưa cài Playwright. Trên GitHub Actions cần chạy: npm install --no-save --no-package-lock playwright@1.61.1 && npx playwright install chromium --with-deps"
    );
  }
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await loadPlaywright();
      const executableCandidates = [
        process.env.PLAYWRIGHT_EXECUTABLE_PATH,
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
      ].filter(Boolean);
      const executablePath = executableCandidates.find((file) => fsSync.existsSync(file));
      return chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: [
          "--disable-dev-shm-usage",
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-setuid-sandbox",
        ],
      });
    })();
  }
  return browserPromise;
}

async function getContext() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const browser = await getBrowser();
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        locale: "vi-VN",
        timezoneId: "Asia/Ho_Chi_Minh",
        viewport: { width: 1440, height: 1100 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        extraHTTPHeaders: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.7,en;q=0.6",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          "Upgrade-Insecure-Requests": "1",
        },
      });
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      });
      return context;
    })();
  }
  return contextPromise;
}

export async function closeBrowser() {
  try {
    const context = await contextPromise;
    await context?.close();
  } catch {}
  try {
    const browser = await browserPromise;
    await browser?.close();
  } catch {}
  contextPromise = null;
  browserPromise = null;
}

function candidateUrls(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    const list = [String(pathOrUrl)];
    try {
      const parsed = new URL(pathOrUrl);
      if (parsed.hostname === "nghean.gdt.gov.vn") {
        const alternate = new URL(pathOrUrl);
        alternate.protocol = parsed.protocol === "https:" ? "http:" : "https:";
        list.push(alternate.toString());
      }
    } catch {}
    return uniqueBy(list, (x) => x);
  }
  const pathname = String(pathOrUrl).startsWith("/") ? String(pathOrUrl) : `/${pathOrUrl}`;
  return uniqueBy(
    [
      `https://nghean.gdt.gov.vn${pathname}`,
      `http://nghean.gdt.gov.vn${pathname}`,
    ],
    (x) => x
  );
}

async function newPage() {
  const context = await getContext();
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(config.browserTimeoutMs);
  page.setDefaultTimeout(config.browserTimeoutMs);
  await page.route("**/*", async (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    const url = request.url();
    if (
      resourceType === "font" ||
      resourceType === "media" ||
      /google-analytics|googletagmanager|doubleclick|analytics\.js/i.test(url)
    ) {
      await route.abort();
      return;
    }
    await route.continue();
  });
  return page;
}

async function gotoPage(page, url, referer = "") {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: config.browserTimeoutMs,
    referer: referer || undefined,
  });
  await page.waitForTimeout(config.browserSettleMs);
  const html = await page.content();
  if (!html || html.length < 500) {
    throw new Error(`Trình duyệt nhận HTML quá ngắn (${html.length} byte) tại ${page.url() || url}`);
  }
  return {
    text: html,
    url: page.url() || url,
    status: response?.status() || 200,
    page,
  };
}

export async function browserFetchFromCandidates(paths, options = {}) {
  if (!config.browserEnabled) throw new Error("Browser fallback đang tắt.");
  const all = [];
  for (const item of Array.isArray(paths) ? paths : [paths]) {
    all.push(...candidateUrls(item));
  }
  const urls = uniqueBy(all, (x) => x);
  const errors = [];

  for (const url of urls) {
    const page = await newPage();
    try {
      const result = await gotoPage(page, url, options.referer || "");
      return result;
    } catch (error) {
      errors.push(`${url}: ${error?.message || error}`);
      await page.close().catch(() => {});
      if (config.browserRetryDelayMs > 0) await sleep(config.browserRetryDelayMs);
    }
  }
  throw new Error(errors.join(" | "));
}


export async function browserExtractNewsItems(page, tab, marker) {
  return page.evaluate(({ tabValue, markerValue }) => {
    const clean = (value = "") => String(value).replace(/\s+/g, " ").trim();
    const absolute = (value = "") => {
      try { return new URL(value, location.href).href; } catch { return ""; }
    };
    const badTitle = /^(xem thêm|xem chi tiết|chi tiết)$/i;
    const badImage = /banner|logo|home\.|blank\.|favicon|loading|icon|sub_banner|spacer|pixel|thuevietnam|tracuuthongtin/i;
    const blocks = Array.from(document.querySelectorAll("div.news"));
    const items = [];

    for (const block of blocks) {
      const anchors = Array.from(block.querySelectorAll("a[href]"));
      const titleLink = anchors.find((anchor) => {
        const text = clean(anchor.textContent);
        if (text.length < 8 || badTitle.test(text)) return false;
        const href = absolute(anchor.getAttribute("href") || "");
        const decoded = (() => { try { return decodeURIComponent(href); } catch { return href; } })().toLowerCase();
        // Nếu URL công khai rõ chuyên mục khác thì loại. URL WebSphere mã hóa dài không có marker vẫn được nhận.
        if (decoded.includes("/site/news/") && markerValue && !decoded.includes(`/site/news/${markerValue}/`)) return false;
        return true;
      });
      if (!titleLink) continue;

      const title = clean(titleLink.textContent);
      const url = absolute(titleLink.getAttribute("href") || "");
      if (!title || !url) continue;
      const text = clean(block.textContent);
      const date = text.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)?.[1] || "";
      const image = Array.from(block.querySelectorAll("img")).find((img) => {
        const src = img.currentSrc || img.getAttribute("data-src") || img.getAttribute("data-original") || img.getAttribute("src") || "";
        return src && !badImage.test(src);
      });
      const rawImage = image
        ? image.currentSrc || image.getAttribute("data-src") || image.getAttribute("data-original") || image.getAttribute("src") || ""
        : "";
      const paragraph = Array.from(block.querySelectorAll("p"))
        .map((node) => clean(node.textContent))
        .find((value) => value.length >= 30 && value !== title) || "";
      items.push({
        tab: tabValue,
        title,
        url,
        date,
        imageUrl: absolute(rawImage),
        summary: paragraph,
      });
    }

    // Một số trang cũ không bọc từng tin bằng div.news. Khi đó lấy anchor thuộc đúng chuyên mục.
    if (items.length < 5) {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      for (const anchor of anchors) {
        const title = clean(anchor.textContent);
        if (title.length < 8 || badTitle.test(title)) continue;
        const url = absolute(anchor.getAttribute("href") || "");
        let decoded = url;
        try { decoded = decodeURIComponent(url); } catch {}
        decoded = decoded.toLowerCase();
        if (markerValue && !decoded.includes(`/news/${markerValue}/`) && !decoded.includes(`/site/news/${markerValue}/`)) continue;
        const holder = anchor.closest("li, article, tr, div") || anchor.parentElement;
        const holderText = clean(holder?.textContent || "");
        const date = holderText.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)?.[1] || "";
        const image = holder?.querySelector?.("img");
        const rawImage = image
          ? image.currentSrc || image.getAttribute("data-src") || image.getAttribute("data-original") || image.getAttribute("src") || ""
          : "";
        const summary = clean(holder?.querySelector?.("p")?.textContent || "");
        items.push({ tab: tabValue, title, url, date, imageUrl: absolute(rawImage), summary });
      }
    }
    return items;
  }, { tabValue: tab, markerValue: marker });
}

export async function browserCrawlPaged({
  startPaths,
  parseItems,
  parseLinks,
  maxPages = 20,
  validateFirstPage,
  extractFromPage,
}) {
  const first = await browserFetchFromCandidates(startPaths);
  const queue = [{ url: first.url, text: first.text, page: first.page }];
  const queued = new Set([first.url]);
  const visited = [];
  const errors = [];
  let items = [];
  let firstPageItemCount = 0;
  let firstPageValidated = false;

  while (queue.length && visited.length < maxPages) {
    const current = queue.shift();
    if (!current?.url || visited.includes(current.url)) {
      await current?.page?.close().catch(() => {});
      continue;
    }

    let page = current.page;
    let text = current.text;
    let finalUrl = current.url;
    try {
      if (!page) {
        page = await newPage();
        const loaded = await gotoPage(page, current.url, first.url);
        text = loaded.text;
        finalUrl = loaded.url;
      }
      const parsed = typeof extractFromPage === "function"
        ? (await extractFromPage(page, finalUrl, text)) || []
        : parseItems(text, finalUrl) || [];
      if (visited.length === 0) {
        firstPageItemCount = parsed.length;
        firstPageValidated = typeof validateFirstPage === "function"
          ? Boolean(validateFirstPage({ html: text, url: finalUrl, items: parsed }))
          : parsed.length > 0;
      }
      items.push(...parsed);
      visited.push(finalUrl);

      const links = (parseLinks(text, finalUrl) || []).slice(0, maxPages * 4);
      for (const link of links) {
        if (!link || queued.has(link) || visited.includes(link)) continue;
        queued.add(link);
        queue.push({ url: link, text: null, page: null });
      }
    } catch (error) {
      errors.push(`${current.url}: ${error?.message || error}`);
    } finally {
      await page?.close().catch(() => {});
    }
  }

  return {
    items,
    firstUrl: first.url,
    firstStatus: first.status,
    firstPageItemCount,
    firstPageValidated,
    visitedPages: visited.length,
    visitedUrls: visited,
    errors,
    exhausted: queue.length === 0,
    hitPageLimit: queue.length > 0 && visited.length >= maxPages,
  };
}

export async function browserCrawlDocumentForm({
  startPaths,
  parseItems,
  parseMaxPage,
  maxPages = 80,
}) {
  const first = await browserFetchFromCandidates(startPaths);
  const page = first.page;
  const errors = [];
  const visitedUrls = [first.url];
  let items = [...(parseItems(first.text, first.url) || [])];
  const detectedMax = Math.max(1, Math.min(maxPages, Number(parseMaxPage(first.text, maxPages) || 1)));

  try {
    for (let pageNum = 2; pageNum <= detectedMax; pageNum++) {
      try {
        await page.goto(first.url, { waitUntil: "domcontentloaded", timeout: config.browserTimeoutMs });
        await page.waitForTimeout(700);
        const hasForm = await page.evaluate(() => {
          const form = document.forms?.searchvbpq || document.querySelector('form[name="searchvbpq"]');
          if (!form) return false;
          const pageInput = form.querySelector('input[name="page"]');
          const cmdInput = form.querySelector('input[name="cmd"]');
          if (pageInput) pageInput.value = "__PAGE__";
          if (cmdInput) cmdInput.value = "";
          return true;
        });
        if (!hasForm) break;
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: config.browserTimeoutMs }),
          page.evaluate((value) => {
            const form = document.forms?.searchvbpq || document.querySelector('form[name="searchvbpq"]');
            const pageInput = form?.querySelector('input[name="page"]');
            if (pageInput) pageInput.value = String(value);
            form?.submit();
          }, pageNum),
        ]);
        await page.waitForTimeout(config.browserSettleMs);
        const html = await page.content();
        const parsed = parseItems(html, page.url()) || [];
        visitedUrls.push(page.url());
        if (!parsed.length) break;
        const before = items.length;
        items.push(...parsed);
        items = uniqueBy(items, (x) => `${x.code || ""}|${x.date || ""}|${x.title || ""}`);
        if (items.length === before) break;
      } catch (error) {
        errors.push(`Trang ${pageNum}: ${error?.message || error}`);
        break;
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  return {
    items,
    firstUrl: first.url,
    firstStatus: first.status,
    firstPageItemCount: parseItems(first.text, first.url)?.length || 0,
    firstPageValidated: items.length > 0,
    visitedPages: visitedUrls.length,
    visitedUrls,
    errors,
  };
}

export async function cacheArticleImages(items, dataset) {
  if (!config.cacheImages || !Array.isArray(items) || !items.length) return items;
  const context = await getContext();
  const outputDir = path.resolve(process.cwd(), "docs/media", dataset);
  await fs.mkdir(outputDir, { recursive: true });
  let cached = 0;

  for (const item of items.slice(0, config.maxCachedImages)) {
    const source = String(item.imageUrl || item.thumbUrl || item.thumb || "").trim();
    if (!/^https?:\/\//i.test(source)) continue;
    const id = crypto.createHash("sha1").update(item.url || source).digest("hex").slice(0, 20);
    try {
      const response = await context.request.get(source, {
        timeout: config.browserTimeoutMs,
        headers: { Referer: item.url || "https://nghean.gdt.gov.vn/" },
      });
      if (!response.ok()) continue;
      const contentType = response.headers()["content-type"] || "";
      if (!contentType.startsWith("image/")) continue;
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const filename = `${id}.${ext}`;
      await fs.writeFile(path.join(outputDir, filename), await response.body());
      item.imagePath = `media/${dataset}/${filename}`;
      cached += 1;
    } catch {}
  }

  console.log(`[browser] ${dataset}: cache được ${cached} ảnh thumbnail.`);
  return items;
}
