const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    return handleGithubPagesDataRoute(request, env, ctx);
  },
};

// ================= GITHUB PAGES DATA GATEWAY =================
// Đặt Worker variable:
// GITHUB_DATA_BASE=https://TEN_GITHUB.github.io/nghean-tax-data
const GITHUB_STATIC_ROUTES = new Set([
  "/health",
  "/news",
  "/list",
  "/docs",
  "/tthc",
  "/videos",
  "/dvc",
  "/dnrrvt",
  "/intro",
]);

function githubCorsJson(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
      "Cache-Control": "public, max-age=120",
      ...extraHeaders,
    },
  });
}

function normalizeGithubDataBase(value = "") {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function githubSafeInt(value, fallback, min = 1, max = 100) {
  const number = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function githubPaginate(items, page, pageSize) {
  const list = Array.isArray(items) ? items : [];
  const safePage = githubSafeInt(page, 1, 1, 100000);
  const safeSize = githubSafeInt(pageSize, 10, 1, 100);
  const start = (safePage - 1) * safeSize;
  return {
    page: safePage,
    pageSize: safeSize,
    total: list.length,
    items: list.slice(start, start + safeSize),
    hasNext: start + safeSize < list.length,
  };
}

async function githubFetchJsonFile(base, relativePath, ctx) {
  const cleanPath = String(relativePath || "").replace(/^\/+/, "");
  const sourceUrl = `${base}/${cleanPath}`;
  const fallbackKey = new Request(`https://github-pages-fallback.local/${encodeURIComponent(base)}/${cleanPath}`);
  const fallbackCache = caches.default;

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "NgheanTaxMiniAppDataGateway/1.0",
      },
      cf: {
        cacheEverything: true,
        cacheTtl: 300,
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub Pages HTTP ${response.status} tại ${sourceUrl}`);
    }

    const data = await response.json();
    const stored = new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=604800",
      },
    });

    if (ctx?.waitUntil) ctx.waitUntil(fallbackCache.put(fallbackKey, stored));
    else await fallbackCache.put(fallbackKey, stored);

    return { data, staleGatewayCache: false, sourceUrl };
  } catch (error) {
    const cached = await fallbackCache.match(fallbackKey);
    if (!cached) throw error;
    const data = await cached.json();
    return {
      data,
      staleGatewayCache: true,
      sourceUrl,
      gatewayError: String(error?.message || error),
    };
  }
}

async function githubReadDataset(base, datasetName, ctx) {
  const result = await githubFetchJsonFile(base, `data/${datasetName}.json`, ctx);
  const payload = result.data && typeof result.data === "object" ? result.data : {};
  return {
    ...result,
    payload,
    items: Array.isArray(payload.items) ? payload.items : [],
  };
}

async function handleGithubPagesDataRoute(request, env, ctx) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const base = normalizeGithubDataBase(env?.GITHUB_DATA_BASE);

  if (!base) {
    return githubCorsJson(
      {
        error: true,
        message: "Chưa cấu hình GITHUB_DATA_BASE trong Worker.",
        example: "https://TEN_GITHUB.github.io/nghean-tax-data",
      },
      500
    );
  }

  try {
    if (pathname === "/health") {
      const result = await githubFetchJsonFile(base, "health.json", ctx);
      return githubCorsJson({
        ...result.data,
        gateway: "cloudflare-worker-github-pages",
        githubDataBase: base,
        gatewayCacheStale: result.staleGatewayCache,
        gatewayError: result.gatewayError || "",
        workerTime: new Date().toISOString(),
      });
    }

    if (pathname === "/intro") {
      const tab = url.searchParams.get("tab") === "diachi" ? "diachi" : "tochuc";
      const result = await githubFetchJsonFile(base, `intro-${tab}.json`, ctx);
      return githubCorsJson(Array.isArray(result.data) ? result.data : []);
    }

    if (pathname === "/news" || pathname === "/list") {
      const tabRaw = String(url.searchParams.get("tab") || "thue").toLowerCase();
      const tab = ["thue", "kinhte", "thongbao"].includes(tabRaw) ? tabRaw : "thue";
      const result = await githubReadDataset(base, `news-${tab}`, ctx);
      if (pathname === "/list") return githubCorsJson(result.items);
      const paged = githubPaginate(result.items, url.searchParams.get("page"), 10);
      return githubCorsJson({
        tab,
        ...paged,
        stale: Boolean(result.payload.stale || result.staleGatewayCache),
        updatedAt: result.payload.updatedAt || null,
        lastAttemptAt: result.payload.lastAttemptAt || null,
        lastError: result.payload.lastError || result.gatewayError || "",
      });
    }

    if (pathname === "/docs") {
      const tabRaw = String(url.searchParams.get("tab") || "huongdan").toLowerCase();
      const tab = ["huongdan", "khac", "nganh"].includes(tabRaw) ? tabRaw : "huongdan";
      const result = await githubReadDataset(base, `docs-${tab}`, ctx);
      const paged = githubPaginate(result.items, url.searchParams.get("page"), 10);
      return githubCorsJson({
        tab,
        ...paged,
        stale: Boolean(result.payload.stale || result.staleGatewayCache),
        updatedAt: result.payload.updatedAt || null,
        lastError: result.payload.lastError || result.gatewayError || "",
      });
    }

    if (pathname === "/tthc") {
      const tab = String(url.searchParams.get("tab") || "hienthanh").toLowerCase();
      if (tab === "phananh") {
        const result = await githubReadDataset(base, "tthc-phananh", ctx);
        const item = result.items[0] || {};
        return githubCorsJson({
          tab: "phananh",
          title: item.title || "Tiếp nhận phản ánh, kiến nghị",
          url: item.url || "",
          contentHtml: item.contentHtml || "<div>Chưa có nội dung.</div>",
          stale: Boolean(result.payload.stale || result.staleGatewayCache),
          updatedAt: result.payload.updatedAt || null,
          lastError: result.payload.lastError || result.gatewayError || "",
        });
      }
      const result = await githubReadDataset(base, "tthc", ctx);
      const paged = githubPaginate(
        result.items,
        url.searchParams.get("page"),
        githubSafeInt(url.searchParams.get("pageSize"), 20, 1, 100)
      );
      return githubCorsJson({
        tab: "hienthanh",
        ...paged,
        stale: Boolean(result.payload.stale || result.staleGatewayCache),
        updatedAt: result.payload.updatedAt || null,
        lastError: result.payload.lastError || result.gatewayError || "",
      });
    }

    if (pathname === "/videos") {
      const result = await githubReadDataset(base, "videos", ctx);
      const paged = githubPaginate(result.items, url.searchParams.get("page"), 10);
      return githubCorsJson({
        tab: "videos",
        ...paged,
        stale: Boolean(result.payload.stale || result.staleGatewayCache),
        updatedAt: result.payload.updatedAt || null,
        lastError: result.payload.lastError || result.gatewayError || "",
      });
    }

    if (pathname === "/dvc") {
      const result = await githubReadDataset(base, "dvc", ctx);
      const paged = githubPaginate(
        result.items,
        url.searchParams.get("page"),
        githubSafeInt(url.searchParams.get("pageSize"), 12, 1, 100)
      );
      return githubCorsJson({
        tab: "dvc",
        ...paged,
        stale: Boolean(result.payload.stale || result.staleGatewayCache),
        updatedAt: result.payload.updatedAt || null,
        lastError: result.payload.lastError || result.gatewayError || "",
      });
    }

    if (pathname === "/dnrrvt") {
      const result = await githubReadDataset(base, "dnrrvt", ctx);
      const paged = githubPaginate(result.items, url.searchParams.get("page"), 10);
      return githubCorsJson({
        tab: "dnrrvt",
        ...paged,
        stale: Boolean(result.payload.stale || result.staleGatewayCache),
        updatedAt: result.payload.updatedAt || null,
        lastError: result.payload.lastError || result.gatewayError || "",
      });
    }

    return githubCorsJson({ error: true, message: "Route GitHub Pages không hợp lệ." }, 404);
  } catch (error) {
    return githubCorsJson(
      {
        error: true,
        message: error?.message || "Không đọc được dữ liệu GitHub Pages.",
        githubDataBase: base,
      },
      502
    );
  }
}
// ================= END GITHUB PAGES DATA GATEWAY =================
