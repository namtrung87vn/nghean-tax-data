const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
};

const TAX_SITE_HOST = "nghean.gdt.gov.vn";
const TAX_SITE_HTTP_ORIGIN = `http://${TAX_SITE_HOST}`;
const TAX_SITE_REQUEST_TIMEOUT_MS = 12000;
const ALLOWED_FETCH_HOSTS = new Set([
  "nghean.gdt.gov.vn",
  "www.gdt.gov.vn",
  "web.gdt.gov.vn",
  "hoadondientu.gdt.gov.vn",
  "dichvucong.gdt.gov.vn",
]);

function buildTaxSiteFetchUrls(url) {
  const raw = String(url || "").replace(/&amp;/g, "&").trim();
  if (!raw) return [raw];

  try {
    const parsed = new URL(raw, TAX_SITE_HTTP_ORIGIN);
    if (parsed.hostname !== TAX_SITE_HOST) return [parsed.toString()];

    // Từ tháng 7/2026, nhiều trang con của cổng Thuế Nghệ An trả/redirect ổn định
    // ở HTTP trong khi URL HTTPS sâu có thể timeout. Thử HTTP trước, HTTPS sau.
    const httpUrl = new URL(parsed.toString());
    httpUrl.protocol = "http:";

    const httpsUrl = new URL(parsed.toString());
    httpsUrl.protocol = "https:";

    return Array.from(new Set([httpUrl.toString(), httpsUrl.toString()]));
  } catch {
    return [raw];
  }
}

async function fetchWithTimeout(url, init = {}, timeoutMs = TAX_SITE_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const externalSignal = init.signal;
  let onAbort = null;

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else {
      onAbort = () => controller.abort(externalSignal.reason);
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort(`Timeout ${timeoutMs}ms`), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal && onAbort) externalSignal.removeEventListener("abort", onAbort);
  }
}

async function fetchTaxSite(url, init = {}) {
  const urls = buildTaxSiteFetchUrls(url);
  let lastError = null;
  let bestResponse = null;

  for (const candidate of urls) {
    try {
      const res = await fetchWithTimeout(candidate, init);
      if (res.ok) return res;

      // Giữ response tốt nhất để trả lỗi có ý nghĩa sau khi đã thử cả HTTP/HTTPS.
      if (!bestResponse || res.status < bestResponse.status) bestResponse = res;
      lastError = new Error(`HTTP ${res.status} for ${candidate}`);
    } catch (err) {
      lastError = err;
    }
  }

  if (bestResponse) return bestResponse;
  throw lastError || new Error(`Fetch failed for ${url}`);
}

function parseAndAllowUrl(rawUrl, allowedHosts = ALLOWED_FETCH_HOSTS) {
  try {
    const u = new URL(String(rawUrl || "").replace(/&amp;/g, "&"));
    if (!["http:", "https:"].includes(u.protocol)) return null;
    if (!allowedHosts.has(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

function withCorsHeaders(headers = {}) {
  return { ...headers, ...CORS_HEADERS };
}

function corsText(text, status = 200, headers = {}) {
  return new Response(text, { status, headers: withCorsHeaders(headers) });
}



function handleOptions() {
  return new Response(null, { status: 204, headers: withCorsHeaders() });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return handleOptions();
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      return jsonResponse(
        { error: true, message: err?.message || "Worker error" },
        500
      );
    }
  },
};



function parseVideoListFromHtml(html, baseUrl) {
  const out = [];
  const decoded = decodeHtml(html); // biến &#39; thành '

  // cắt theo <li> (mỗi video là 1 li)
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRegex.exec(decoded))) {
    const li = m[1];
    if (!/(?:playClip\s*\(|jwplayer\(\)\.load\s*\()/i.test(li)) continue;

    // Cổng cũ dùng playClip('URL',...), cổng hiện tại có chỗ dùng jwplayer().load('URL').
    const urlMatch =
      li.match(/playClip\(\s*'([^']*)'/i) ||
      li.match(/jwplayer\(\)\.load\(\s*(?:\[\s*\{[^}]*file\s*:\s*)?'([^']*)'/i);
    let videoUrl = urlMatch ? urlMatch[1].trim() : "";
    videoUrl = videoUrl.replace(/&amp;/g, "&");
    if (videoUrl) videoUrl = makeAbsoluteUrl(baseUrl, videoUrl);

    // title: ưu tiên text trong <a>...</a>
    let title = "";
    const aMatch = li.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    if (aMatch) title = decodeHtml(stripTags(aMatch[1])).trim();

    // date: lấy trong <p class="post_meta">dd/mm/yyyy</p>
    let date = "";
    const dMatch = li.match(/class="post_meta"[^>]*>\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (dMatch) date = dMatch[1];

    // thumb: <img src="...">
    let thumb = "";
    const imgMatch = li.match(/<img[^>]+src\s*=\s*"([^"]+)"/i);
    if (imgMatch) thumb = makeAbsoluteUrl(baseUrl, imgMatch[1].replace(/&amp;/g, "&"));

    out.push({
      title,
      date,
      videoUrl,
      thumb,
      thumbUrl: thumb,
      playable: !!videoUrl,
    });
  }
  return out;
}

function parseNextPageUrl(html, baseUrl) {
  const decoded = decodeHtml(html || "");

  // tìm <a ... _nextPage ...> (không phụ thuộc thứ tự thuộc tính)
  const tagMatch = decoded.match(/<a\b[^>]*_nextPage[^>]*>/i);
  if (!tagMatch) return null;

  // lấy href dù dùng ' hoặc "
  const hrefMatch = tagMatch[0].match(/href\s*=\s*(['"])(.*?)\1/i);
  if (!hrefMatch) return null;

  const href = decodeHtml(hrefMatch[2]).replace(/&amp;/g, "&").trim();
  return makeAbsoluteUrl(baseUrl, href);
}


async function fetchVideoPage(page, headers) {
  let url = VIDEO_URL;
  let html = "";

  for (let i = 1; i <= page; i++) {
    const cacheKey = `https://cache.local/videos?page=${i}`;
    const cache = caches.default;

    if (i === page) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        html = await cached.text();
        break;
      }
    }

    const res = await fetchTaxSite(url, { headers });
    if (!res.ok) throw new Error(`Không lấy được video page ${i} – HTTP ${res.status}`);
    html = await res.text();

    if (i === page) {
      await cache.put(cacheKey, new Response(html, { headers: { "Cache-Control": "public, max-age=21600" } }));
      break;
    }

    const next = parseNextPageUrl(html, "https://nghean.gdt.gov.vn");
    if (!next) break;
    url = next;
  }

  const items = parseVideoListFromHtml(html, "https://nghean.gdt.gov.vn");
  const nextUrl = parseNextPageUrl(html, "https://nghean.gdt.gov.vn");

  return { page, items, hasNext: !!nextUrl };
}






// ================== CẤU HÌNH TAB VĂN BẢN ==================
// entryUrl: link Z6_... (trang 1) như đang dùng
// actionUrl: giá trị thuộc tính action="" của form name="searchvbpq"
//            trên từng tab (anh xem nguồn trang và copy đúng vào đây).
const DOC_TAB_CONFIG = {
  huongdan: {
    name: "Văn bản hướng dẫn",
    entryUrl:
      "https://nghean.gdt.gov.vn/wps/portal/?uri=nm:oid:Z6_049IL8VSO39F80IE3NQ7HJ2692",
    actionUrl:
    "https://nghean.gdt.gov.vn/wps/portal/!ut/p/z1/04_Sj9CPykssy0xPLMnMz0vMAfIjo8ziDUwsPX0swoL9jS3dLAw8XY39As09vIzMLI30wwkpiAJJ4wCOBkD9URAlMBOc_DxcDTx9wny9fQ1cjJ0dzWAKcJtRkBthkOmoqAgA5XjAcA!!/dz/d5/L2dBISEvZ0FBIS9nQSEh/",
  },
  khac: {
    name: "Văn bản khác",
    entryUrl:
      "https://nghean.gdt.gov.vn/wps/portal/?uri=nm:oid:Z6_049IL8VSO3VHF0I1AMGLAN38M0",
    actionUrl:
    "https://nghean.gdt.gov.vn/wps/portal/!ut/p/z1/04_Sj9CPykssy0xPLMnMz0vMAfIjo8ziDUwsPX0swoL9vTxcDQw8PZyczQwNTQ0NXIz0wwkpiAJJ4wCOBkD9URAlMBOc_IBGePqE-Xr7GrgYOzuawRTgNqMgN8Ig01FREQC7CyJ2/dz/d5/L2dBISEvZ0FBIS9nQSEh/",
  },
  // ⬇️ THÊM MỚI: tab Văn bản Ngành Thuế
  nganh: {
    name: "Văn bản ngành Thuế",
    // Link mở trang “Hệ thống văn bản ngành Thuế”
    // (cùng kiểu với các link Z6_... khác)
    entryUrl:
      "https://nghean.gdt.gov.vn/wps/portal/?uri=nm:oid:Z6_049IL8VSOJHE00IHBC611510D2",

    // GIÁ TRỊ action="" của <form name="searchvbpq"> trên trang “văn bản ngành”
    // Anh mở nguồn trang, tìm <form ... name="searchvbpq"> rồi copy NGUYÊN
    // cái action vào đây (giống cách anh đã làm với huongdan/khac).
    actionUrl:
      "https://nghean.gdt.gov.vn/wps/portal/!ut/p/z1/04_Sj9CPykssy0xPLMnMz0vMAfIjo8ziDUwsPX0swoL9vTxcDQw8PZyczQwNTQ0NXIz0wwkpiAJJ4wCOBkD9URAlMBOc_IBGePqE-Xr7GrgYOzuawRTgNqMgN8Ig01FREQC7CyJ2/dz/d5/L2dBISEvZ0FBIS9nQSEh/",
  },
};



// tối đa số trang văn bản cần lấy (web đang là 65 trang)
const DOC_MAX_PAGES = 65;

// ================== CẤU HÌNH TAB TIN TỨC ==================
const NEWS_HUB_URL =
  "https://nghean.gdt.gov.vn/wps/portal/?uri=nm:oid:Z6_049IL8VSOR7Q70IUIPB11B1OI1";
const TAX_HOME_URL = "https://nghean.gdt.gov.vn/wps/portal/nghean";

const TAB_CONFIG = {
  thue: {
    name: "Tin Thuế tỉnh/thành phố",
    url: () =>
      "https://nghean.gdt.gov.vn/wps/portal/news/list?1dmy&current=true&urile=wcm:path:/nghean/site/news/cucthue",
    marker: "cucthue",
  },
  kinhte: {
    name: "Thông tin kinh tế",
    url: () =>
      "https://nghean.gdt.gov.vn/wps/portal/news/list?1dmy&current=true&urile=wcm:path:/nghean/site/news/economy",
    marker: "economy",
  },
  thongbao: {
    name: "Thông báo",
    url: () =>
      "https://nghean.gdt.gov.vn/wps/portal/news/list?1dmy&current=true&urile=wcm:path:/nghean/site/news/annocement",
    marker: "annocement", // trang gốc viết sai annocement
  },
};
// ==============================
// THỦ TỤC HÀNH CHÍNH (TTHC) - NEW
// ==============================

const TTHC_TABS = {
  hienthanh: {
    title: "Bộ thủ tục hành chính thuế hiện hành",
    url: "https://nghean.gdt.gov.vn/wps/portal/?uri=nm:oid:Z6_049IL8VSOJ8800IHMB7OA4E7E1",
  },
  phananh: {
    title: "Tiếp nhận phản ánh, kiến nghị",
    url: "https://nghean.gdt.gov.vn/wps/portal/?uri=nm:oid:Z6_QOHUBB1A088P60A15IU4CO0031",
  },
};

const TTHC_CONFIG = {
  // Tab "Bộ TTHC hiện hành"
  hienthanh: {
    entryUrl: "https://nghean.gdt.gov.vn/wps/portal/home/tthc",
  },
  // Tab "Phản ánh, kiến nghị"
  phananh: {
    url: "https://nghean.gdt.gov.vn/wps/portal/home/tthc/phananh",
  },
};

// ================== DỮ LIỆU GIỚI THIỆU TĨNH ==================
const INTRO_DATA = {
  tochuc: [
    {
      id: "intro-0",
      title: "Nhiệm vụ ban biên tập",
      date: "05/04/2011",
      link:
        "https://nghean.gdt.gov.vn/wps/portal/?1dmy&page=6_049IL8VSO3VHF0I1AMGLAN3IT5&urile=wcm:path:/nghean/site/intro/gtbbt/51eee00046621b7e8fb28f844940dfd3",
    },
    {
      id: "intro-1",
      title: "Lịch sử Cục thuế Nghệ An",
      date: "08/08/2011",
      link:
        "https://nghean.gdt.gov.vn/wps/portal/?1dmy&page=6_049IL8VSO3VHF0I1AMGLAN3IT5&urile=wcm:path:/nghean/site/intro/tcct/8ddd800047e1f6c0b64eff313809786d",
    },
    {
      id: "intro-2",
      title:
        "Chức năng, nhiệm vụ, quyền hạn tổ chức Thuế tỉnh Nghệ An",
      date: "08/08/2011",
      link:
        "https://nghean.gdt.gov.vn/wps/portal/?1dmy&page=6_049IL8VSO3VHF0I1AMGLAN3IT5&urile=wcm:path:/nghean/site/intro/tcct/20204e0047e1f605b635ff313809786d",
    },
    {
      id: "intro-3",
      title: "Thông tin ban lãnh đạo Thuế tỉnh Nghệ An",
      date: "08/08/2011",
      link:
        "https://nghean.gdt.gov.vn/wps/portal/?1dmy&page=6_049IL8VSO3VHF0I1AMGLAN3IT5&urile=wcm:path:/nghean/site/intro/tcct/e441890047e1f44ab61cff313809786d",
    },
    {
      id: "intro-4",
      title: "Cơ cấu tổ chức Thuế tỉnh Nghệ An",
      date: "08/08/2011",
      // link đầy đủ vào Cơ cấu tổ chức Thuế tỉnh Nghệ An
      link:
        "https://nghean.gdt.gov.vn/wps/portal/intro?1dmy=&page=6_049IL8VSO3VHF0I1AMGLAN3IT5&urile=wcm:path:/nghean/site/intro/tcct/e441890047e1f44ab61cff313809786d",
    },
  ],
  diachi: [
    {
      id: "diachi-0",
      title: "Địa chỉ cơ quan Thuế",
      date: "",
      link:
        "https://nghean.gdt.gov.vn/wps/portal/?uri=nm:oid:Z6_049IL8VSO3VHF0I1AMGLAN3SQ7",
    },
  ],
};


// URL bảng danh sách TTHC (đảm bảo có đầy đủ cột như HTML bạn gửi)
// Nếu sau này bạn muốn đổi sang URL khác thì chỉ cần đổi biến này.
const TTHC_ALLLIST_URL =
  "https://nghean.gdt.gov.vn/wps/portal/?uri=nm:oid:Z6_049IL8VSOJOAE0I1MJ5KSF0UE3";

const TTHC_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6h
const tthcCache = new Map(); // tabKey -> { ts, items }

// ================== TTHC ==================




async function handleTTHC(request, env, ctx) {
  try {
    const { searchParams } = new URL(request.url);
    const tab = (searchParams.get("tab") || "hienthanh").toLowerCase();
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "20", 10);

    if (!TTHC_TABS[tab]) {
      return jsonResponse({ error: true, message: `tab không hợp lệ: ${tab}` }, 400);
    }

    if (tab === "phananh") {
      const data = await fetchTTHCFeedback(tab, ctx);
      return jsonResponse(data);
    }

    const data = await fetchTTHCListPaged(tab, page, pageSize, ctx);
    return jsonResponse(data);
  } catch (e) {
    return jsonResponse(
      { error: true, message: e?.message || "TTHC error", stack: String(e?.stack || "") },
      500
    );
  }
}

function findViewAllUrl(html, baseUrl) {
  // Bắt link kiểu ">>Xem toàn bộ danh sách" / "Xem ... danh sách"
  const m = html.match(/<a[^>]+href="([^"]+)"[^>]*>\s*(?:&gt;&gt;|»|&raquo;)?\s*Xem[\s\S]*?danh\s*sách[\s\S]*?<\/a>/i);
  if (!m) return "";
  return makeAbsoluteUrl(baseUrl, decodeHtml(m[1]));
}

async function fetchTTHCListPaged(tab, page, pageSize, ctx) {
  const cacheKey = new Request(`https://cache.local/tthc/${tab}/all`, { method: "GET" });
  const cache = caches.default;

  let cached = await cache.match(cacheKey);
  let allItems;

  if (cached) {
    allItems = await cached.json();
  } else {
    const entryUrl = TTHC_TABS[tab].url;
    const baseUrl = "https://nghean.gdt.gov.vn";

    // 1) Lấy HTML mặc định (thường chỉ 3 dòng)
    let html = await fetchHtml(entryUrl);

    // 2) Nếu có link “Xem toàn bộ danh sách” thì fetch thêm để lấy full
    const viewAllUrl = findViewAllUrl(html, baseUrl);
    if (viewAllUrl) {
      try {
        const htmlAll = await fetchHtml(viewAllUrl);
        const parsedAll = parseTTHCListFromHtml(htmlAll, baseUrl);
        if (parsedAll.length > 3) {
          allItems = parsedAll;
        } else {
          allItems = parseTTHCListFromHtml(html, baseUrl);
        }
      } catch {
        allItems = parseTTHCListFromHtml(html, baseUrl);
      }
    } else {
      allItems = parseTTHCListFromHtml(html, baseUrl);
    }

    const resp = new Response(JSON.stringify(allItems), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=21600",
      },
    });

    // module worker: nên dùng ctx.waitUntil để khỏi chặn response
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cache.put(cacheKey, resp));
    else await cache.put(cacheKey, resp);
  }

  const total = allItems.length;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  return {
    tab,
    page,
    pageSize,
    total,
    items: allItems.slice(start, end),
    hasNext: end < total,
  };
}
function parseCellLink(tdHtml, baseUrl) {
  const a = tdHtml.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
  if (a) {
    return {
      text: decodeHtml(stripTags(a[2])).trim() || "-",
      url: makeAbsoluteUrl(baseUrl, decodeHtml(a[1])),
    };
  }
  const text = decodeHtml(stripTags(tdHtml)).trim();
  return { text: text || "-", url: "" };
}


function extractFirstHref(html, baseUrl) {
  const m = html.match(/href\s*=\s*(['"])(.*?)\1/i);
  if (!m) return "";
  return makeAbsoluteUrl(baseUrl, m[2].replace(/&amp;/g, "&"));
}

function parseDocLinks(cellHtml, baseUrl) {
  const out = [];
  const re = /<a[^>]+href\s*=\s*(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(cellHtml || ""))) {
    const url = makeAbsoluteUrl(baseUrl, (m[2] || "").replace(/&amp;/g, "&"));
    const code = decodeHtml(stripTags(m[3] || "")).trim();
    if (code) out.push({ code, url });
  }
  return out;
}




// --- Tìm link "xem toàn bộ/hiển thị toàn bộ" để lấy đủ danh sách ---
function findAllListUrl(html) {
  const aTags = html.match(/<a\b[^>]*href="[^"]+"[^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const a of aTags) {
    const hrefMatch = a.match(/href="([^"]+)"/i);
    if (!hrefMatch) continue;

    const rawHref = decodeHtml(hrefMatch[1] || "").trim();
    const text = removeDiacritics(stripTags(a)).toLowerCase();

    // các biến thể thường gặp
    const ok =
      (text.includes("xem") && text.includes("toan bo")) ||
      (text.includes("hien thi") && text.includes("toan bo"));

    // thêm điều kiện "danh sach" để chắc chắn hơn
    if (ok && (text.includes("danh sach") || text.includes("thu tuc"))) {
      return normalizeUrl(rawHref);
    }
  }
  return null;
}

function removeDiacritics(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function normalizeUrl(link) {
  let u = decodeHtml(link || "").trim();
  if (!u) return u;
  if (u.startsWith("/")) return "https://nghean.gdt.gov.vn" + u;
  if (u.startsWith("wps/")) return "https://nghean.gdt.gov.vn/" + u;
  if (!/^https?:\/\//i.test(u)) {
    return "https://nghean.gdt.gov.vn" + (u.startsWith("?") ? "/wps/portal/" + u : "/" + u);
  }
  return u;
}

// --- Parse bảng đủ cột giống trang thuế ---
// Bảng trên trang thuế có class "ta_border" và cột VBQĐ / QĐCB :contentReference[oaicite:2]{index=2}

function parseTTHCListFromHtml(html, baseUrl) {
  const items = [];

  const tableMatch =
    html.match(/<table[^>]*class="[^"]*ta_border[^"]*"[^>]*>[\s\S]*?<\/table>/i) ||
    html.match(/<table[^>]*class="ta_border"[^>]*>[\s\S]*?<\/table>/i);

  if (!tableMatch) return items;

  const tableHtml = tableMatch[0];
  const trList = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const tr of trList) {
    if (/<th[\s\S]*?>/i.test(tr)) continue;

    const tds = tr.match(/<td[\s\S]*?<\/td>/gi) || [];
    if (tds.length < 5) continue; // phải đủ 5 cột

    const stt = decodeHtml(stripTags(tds[0])).trim();
    if (!/^\d+$/.test(stt)) continue;

    const tdName = tds[1];
    const aMatch = tdName.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!aMatch) continue;

    let link = decodeHtml(aMatch[1]).trim();
    link = makeAbsoluteUrl(baseUrl, link);

    const title = decodeHtml(stripTags(aMatch[2])).trim();
    const agency = decodeHtml(stripTags(tds[2])).trim() || "-";

    const vbqd = parseCellLink(tds[3], baseUrl);
    const qdcb = parseCellLink(tds[4], baseUrl);

    items.push({
      id: `tthc-${stt}`,
      stt,
      title,
      link,
      agency,
      vbqdText: vbqd.text,
      vbqdUrl: vbqd.url,
      qdcbText: qdcb.text,
      qdcbUrl: qdcb.url,
    });
  }

  return items;
}

// Nếu trang entry chỉ hiện vài dòng + có link "Xem toàn bộ danh sách" thì follow link đó
async function fetchTTHCAllHtml(entryUrl, headers) {
  const res = await fetchTaxSite(entryUrl, { headers });
  if (!res.ok) throw new Error(`Không lấy được TTHC – HTTP ${res.status}`);
  let html = await res.text();

  // tìm "Xem toàn bộ danh sách"
  const allLinkMatch = html.match(
    /Xem\s*toàn\s*bộ\s*danh\s*sách[\s\S]*?<a[^>]+href\s*=\s*(['"])(.*?)\1/i
  );
  if (allLinkMatch && allLinkMatch[2]) {
    const fullUrl = makeAbsoluteUrl("https://nghean.gdt.gov.vn", allLinkMatch[2].replace(/&amp;/g, "&"));
    const res2 = await fetchTaxSite(fullUrl, { headers });
    if (res2.ok) html = await res2.text();
  }

  return html;
}




// Cloudflare email protection decoder
function decodeCfEmail(hex) {
  try {
    const key = parseInt(hex.slice(0, 2), 16);
    let out = "";
    for (let i = 2; i < hex.length; i += 2) {
      const code = parseInt(hex.slice(i, i + 2), 16) ^ key;
      out += String.fromCharCode(code);
    }
    return out;
  } catch {
    return "";
  }
}
function cleanupFeedbackHtml(html) {
  let out = html || "";

  // Replace <a class="__cf_email__" data-cfemail="...">[email&#160;protected]</a>
  out = out.replace(
    /<a[^>]+class="__cf_email__"[^>]+data-cfemail="([0-9a-fA-F]+)"[^>]*>[\s\S]*?<\/a>/g,
    (_, hex) => decodeCfEmail(hex) || ""
  );

  // Remove CF decode script if exists
  out = out.replace(/<script[^>]*data-cfasync[^>]*>[\s\S]*?<\/script>/gi, "");

  // N?u v?n còn d?ng “[email protected]” thì thay b?ng email th?t (n?u b?n bi?t chính xác)
  out = out.replace(/\[email\s*protected\]/gi, "");

  return out;
}
async function fetchTTHCFeedback(tab, ctx) {
  const url = TTHC_TABS[tab].url;

  const cacheKey = new Request(`https://cache.local/tthc/${tab}/content`, { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const html = await fetchHtml(url);
  let contentHtml = extractMainContent(html);

  // Fix “email protected”
  contentHtml = cleanupFeedbackHtml(contentHtml);

  const data = {
    tab,
    title: TTHC_TABS[tab].title,
    url,
    contentHtml,
  };

  const resp = new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=21600",
    },
  });

  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cache.put(cacheKey, resp));
  else await cache.put(cacheKey, resp);

  return data;
}
function extractContentBody(html) {
  const m = html.match(/<div[^>]+id="contentBody"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return "";

  let body = m[1];

  // remove script/style
  body = body.replace(/<script[\s\S]*?<\/script>/gi, "");
  body = body.replace(/<style[\s\S]*?<\/style>/gi, "");

  // decode cloudflare protected emails
  body = decodeCloudflareEmails(body);

  return body.trim();
}

function decodeCloudflareEmails(html) {
  if (!html) return html;

  // <span class="__cf_email__" data-cfemail="...">[email&#160;protected]</span>
  html = html.replace(
    /<[^>]*data-cfemail\s*=\s*(['"])([0-9a-fA-F]+)\1[^>]*>[\s\S]*?<\/[^>]+>/gi,
    (_full, _q, hex) => {
      const email = decodeCfEmail(hex);
      return email || "";
    }
  );

  // href="/cdn-cgi/l/email-protection#xxxx"
  html = html.replace(
    /\/cdn-cgi\/l\/email-protection#([0-9a-fA-F]+)/gi,
    (_m, hex) => {
      const email = decodeCfEmail(hex);
      return email ? `mailto:${email}` : "#";
    }
  );

  // fallback: nếu vẫn còn "[email protected]" thì cố replace bằng email thường (nếu có)
  const plainEmail = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (plainEmail) {
    html = html.replace(/\[email(?:&#160;|&nbsp;|\s)*protected\]/gi, plainEmail);
  }

  return html;
}
function replaceEmailProtected(html) {
  let s = String(html || "");

  // dạng: data-cfemail="xxxx"
  s = s.replace(
    /<span[^>]+data-cfemail="([0-9a-fA-F]+)"[^>]*>[\s\S]*?<\/span>/gi,
    (_, hex) => decodeCfEmail(hex)
  );

  // dạng: href="/cdn-cgi/l/email-protection#xxxx"
  s = s.replace(
    /<a[^>]+href="\/cdn-cgi\/l\/email-protection#([0-9a-fA-F]+)"[^>]*>[\s\S]*?<\/a>/gi,
    (_, hex) => decodeCfEmail(hex)
  );

  return s;
}
// ---------- helpers ----------
async function fetchHtml(url) {
  const res = await fetchTaxSite(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      "accept-language": "vi-VN,vi;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`Fetch fail ${res.status} for ${url}`);
  return await res.text();
}



// Parse table TTHC: <table class="ta_border"> ... <tr> ... <td>STT</td> <td><a ...>Tên thủ tục</a></td> ...


function parseDocCell(tdHtml = "") {
  if (!tdHtml) return { code: "", url: "" };

  const code = decodeHtml(stripTags(tdHtml)).replace(/\s+/g, " ").trim();
  const m = tdHtml.match(/href=["']([^"']+)["']/i);
  const url = m ? makeAbsoluteUrl("https://nghean.gdt.gov.vn", decodeHtml(m[1]).trim()) : "";

  return { code, url };
}


function stripTags(html) {
  return (html || "").replace(/<[^>]+>/g, "");
}

// lấy phần nội dung chính (đủ dùng). Nếu sau này bạn muốn “đẹp y hệt” thì mình tinh chỉnh selector tiếp.
function extractMainContent(html) {
  // ưu tiên lấy vùng có table hoặc vùng portlet body
  const tableMatch = html.match(/<table[^>]*class="ta_border"[^>]*>[\s\S]*?<\/table>/i);
  if (tableMatch) return tableMatch[0];

  const portletMatch = html.match(/<div class="wpsPortletBody">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i);
  if (portletMatch) return portletMatch[1];

  // fallback: body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
}

// dùng json(...) của bạn nếu đã có; nếu chưa có thì thêm:
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}



// ================== HÀM CHUNG ==================

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handleHealth(request) {
  const checks = [
    ["home", "https://nghean.gdt.gov.vn/wps/portal/nghean", /Thuế|Thue/i],
    ["news", TAB_CONFIG.thue.url(), /Tin|news|cucthue/i],
    ["docs", DOC_TAB_CONFIG.huongdan.entryUrl, /Văn bản|van ban|ta_border/i],
    ["tthc", TTHC_TABS.hienthanh.url, /thủ tục|thu tuc|ta_border/i],
  ];

  const results = await Promise.all(
    checks.map(async ([name, url, marker]) => {
      const started = Date.now();
      try {
        const res = await fetchTaxSite(url, {
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; NgheAnTaxMiniApp/2.0)",
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "vi-VN,vi;q=0.9",
          },
        });
        const text = await res.text();
        return {
          name,
          ok: res.ok && marker.test(text),
          status: res.status,
          finalUrl: res.url,
          contentType: res.headers.get("content-type") || "",
          bytes: text.length,
          markerFound: marker.test(text),
          ms: Date.now() - started,
        };
      } catch (error) {
        return { name, ok: false, error: String(error?.message || error), ms: Date.now() - started };
      }
    })
  );

  return jsonResponse({
    ok: results.every((x) => x.ok),
    workerTime: new Date().toISOString(),
    sourceHost: TAX_SITE_HOST,
    results,
  }, results.every((x) => x.ok) ? 200 : 503);
}

async function handleRequest(request, env, ctx){
  const url = new URL(request.url);
  const { pathname, searchParams } = url;

  try {
    if (GITHUB_STATIC_ROUTES.has(pathname)) {
      return handleGithubPagesDataRoute(request, env, ctx);
    }
    if (pathname === "/health") {
      return handleHealth(request);
    }
    if (pathname === "/videos") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    
      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      };
    
      const data = await fetchVideoPage(page, headers);
      return json(data);
    }
    // /dnrrvt?page=1
    //const url = new URL(request.url);
    if (url.pathname === "/dnrrvt") {
      return handleDNRRVT(request, env, ctx);
    }

    if (pathname === "/list") {
      const tab = searchParams.get("tab") || "thue";
      const list = await fetchNewsList(tab);
      return jsonResponse(list);
    }
    // ⬇️ THÊM MỚI: API tin tức theo trang
    if (pathname === "/news") {
      const tab = searchParams.get("tab") || "thue";
      const page = parseInt(searchParams.get("page") || "1", 10);
      const data = await fetchNewsPage(tab, page);
      return jsonResponse(data);
    }
    if (pathname === "/intro") {
      const tab = searchParams.get("tab") || "tochuc";
      const data = INTRO_DATA[tab] || [];
      return jsonResponse(data);
    }
     //ví dụ trong handleRequest:
     if (pathname === "/tthc") {
      return handleTTHC(request, env, ctx);
    }

    // ====== API VĂN BẢN THUẾ TỈNH ======
    if (pathname === "/docs") {
      const tab = searchParams.get("tab") || "huongdan";
      const page = parseInt(searchParams.get("page") || "1", 10);
    
      const result = await fetchDocsPage(tab, page);
      return jsonResponse(result);
    }
    if (pathname === "/dvc") {
      return handleDVC(request);
    }
    // ================= HDDT (Tra cứu hóa đơn điện tử) =================
if (pathname === "/hddt/captcha") {
  return handleHDDTCaptcha(request);
}
if (pathname === "/hddt/search") {
  return handleHDDTSearch(request);
}
    
   // ================= XUẤT CẢNH (NNT có thông báo về xuất cảnh) =================
if (pathname === "/xc/captcha") {
  return handleXCCaptcha(request);
}
if (pathname === "/xc/search") {
  return handleXCSearch(request);
}
if (pathname === "/xc/cqts") {
  return handleXCCqts(request);
}
if (pathname === "/xc/detail") {
  return handleXCDetail(request);
}
if (pathname === "/img") {
      return handleImgProxy(request);
    }
    if (pathname === "/article") {
      const articleUrl = searchParams.get("url");
      if (!articleUrl) {
        return jsonResponse({ error: true, message: "Thiếu tham số url" }, 400);
      }
      const detail = await fetchArticleDetail(articleUrl);
      return jsonResponse(detail);
    }

    return new Response(
      'Worker OK. Kiểm tra /health; API: /news, /docs, /tthc, /dvc, /videos, /dnrrvt, /article.',
      { status: 200 }
    );
  } catch (err) {
    return jsonResponse(
      {
        error: true,
        message: err.message || "Unknown error",
      },
      500
    );
  }
}

// ====== DỊCH VỤ CÔNG ======
const DVC_URL =
  "https://nghean.gdt.gov.vn/wps/portal/?uri=nm:oid:Z6_049IL8VSO3AM00I1935RNOCEO2";

const DVC_TITLE_MAP = {
  tracuuthongtinnnt: "Tra cứu thông tin người nộp thuế",
  nophsthuequamang: "Nộp hồ sơ kê khai thuế qua mạng",
  quyettoanthuetncn: "Quyết toán thuế TNCN (cá nhân)",
  htkk: "Hỗ trợ kê khai thuế",
  tracuuhoadon: "Tra cứu thông tin hóa đơn",
  tncnonline: "TNCN Online",
  quanlyhanhnghedichvuthue: "Quản lý hành nghề dịch vụ thuế",
  chuyenmuchoadon: "Chuyên mục hóa đơn",
  congkhaithongtin: "Công khai thông tin hộ kinh doanh nộp thuế khoán",
  qdcuongche: "Quyết định cưỡng chế về hóa đơn",
  dsnnrrcvt: "Danh sách DN thuộc loại rủi ro cao về thuế",
  dngtgt: "DS địa điểm bán hàng hoàn thuế GTGT (NNN)",
  vbhd: "Văn bản, hướng dẫn chung về chính sách thuế mới",
  ccntCT: "Công khai cưỡng chế nợ thuế",
  ntCT: "Công khai khoản nợ thuế",
};

function fileKeyFromUrl(u = "") {
  try {
    const clean = u.split("?")[0];
    const name = clean.substring(clean.lastIndexOf("/") + 1);
    return name.replace(/\.(gif|png|jpg|jpeg|webp)$/i, "").toLowerCase();
  } catch {
    return "";
  }
}

// rule giống script trên trang Thuế
function fixGlobalContextHref(href = "") {
  return href.replace(
    "?WCM_GLOBAL_CONTEXT=/",
    "?1dmy&current=true&urile=wcm:path:/"
  );
}

// Parse trực tiếp toàn HTML: bắt mọi <a href> ... <img src> (không dựa vào div/ul/li để tránh đứt block)
function parseDVCFromHtml(html, baseUrl, workerOrigin) {
  const results = [];
  const seen = new Set();

  const re =
    /<a[^>]+href=(["'])([^"'<>]+)\1[^>]*>[\s\S]*?<img[^>]+src=(["'])([^"']+)\3/gi;

  let m;
  while ((m = re.exec(html))) {
    let href = decodeHtml(m[2] || "").trim().replace(/&amp;/g, "&");
    let src = decodeHtml(m[4] || "").trim().replace(/&amp;/g, "&");

    // bỏ logo/background/home...
    const key = fileKeyFromUrl(src);
    if (!key) continue;
    if (key === "logo" || key === "background" || key === "home") continue;

    href = fixGlobalContextHref(href);

    // nếu href là javascript: ... thì bóc url thật trong dấu '...'
    if (/^javascript:/i.test(href)) {
      const mm = href.match(/'(https?:\/\/[^']+)'/i);
      if (mm) href = mm[1];
      else continue;
    }

    // chuẩn hóa absolute url
    const absHref = makeAbsoluteUrl(baseUrl, href);
    const absImg = makeAbsoluteUrl(baseUrl, src);

    // lọc những item không phải dịch vụ (tránh bắt nhầm icon khác)
    // trong HTML bạn gửi, icon dịch vụ nằm trong "dich vu cong_files/" hoặc ảnh WCM connect
    if (
      !DVC_TITLE_MAP[key] &&
      !/dich vu cong_files/i.test(absImg) &&
      !/\/wps\/wcm\/connect\//i.test(absImg)
    ) {
      continue;
    }

    const title = DVC_TITLE_MAP[key] || "Dịch vụ công";

    const dedupKey = absHref + "|" + key;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    // proxy ảnh qua worker để tránh hotlink
    const proxyImg = `${workerOrigin}/img?u=${encodeURIComponent(absImg)}`;

    results.push({
      id: `dvc-${results.length + 1}`,
      title,
      url: absHref,
      imageUrl: proxyImg,
      rawImageUrl: absImg,
    });
  }

  return results;
}

async function handleDVC(request) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.max(
    1,
    Math.min(30, parseInt(url.searchParams.get("pageSize") || "12", 10))
  );

  const html = await fetchHtml(DVC_URL);
  const origin = `${url.protocol}//${url.host}`;

  const all = parseDVCFromHtml(html, DVC_URL, origin);
  const total = all.length;

  const start = (page - 1) * pageSize;
  const items = all.slice(start, start + pageSize);

  return jsonResponse({
    tab: "dvc",
    page,
    pageSize,
    total,
    hasNext: start + pageSize < total,
    items,
  });
}

// ====== PROXY ẢNH ======
async function handleImgProxy(request) {
  const url = new URL(request.url);
  const u = url.searchParams.get("u");
  if (!u) return new Response("Missing u", { status: 400 });

  let target;
  try {
    target = new URL(u);
  } catch {
    return new Response("Bad u", { status: 400 });
  }

  if (!["http:", "https:"].includes(target.protocol) || !ALLOWED_FETCH_HOSTS.has(target.hostname)) {
    return new Response("Host not allowed", { status: 403 });
  }

  const res = await fetchTaxSite(target.toString(), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      // nhiều server ảnh cần referer để không hotlink
      referer: "https://nghean.gdt.gov.vn/",
    },
  });

  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "public, max-age=86400");

  return new Response(res.body, {
    status: res.status,
    headers,
  });
}



const DVC_LINKS_URL =
  "https://nghean.gdt.gov.vn/wps/portal/?uri=nm:oid:Z6_049IL8VSO3VHF0I1AMGLAN3SQ7";

async function fetchDVCLinks(ctx) {
  const html = await fetchHtml(DVC_LINKS_URL);
  const baseUrl = "https://nghean.gdt.gov.vn";

  // 1) Lấy danh sách option trong dropdown "Liên kết website"
  const options = [];
  const optRe = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = optRe.exec(html))) {
    const rawValue = decodeHtml(m[1] || "").trim();
    const title = decodeHtml(stripTags(m[2] || "")).replace(/\s+/g, " ").trim();

    if (!title) continue;
    if (/lựa\s*chọn/i.test(title)) continue;

    // value đôi khi là javascript:..., cố gắng bóc url trong ''
    let url = rawValue;
    const jsUrl = rawValue.match(/'(https?:\/\/[^']+)'/i);
    if (jsUrl) url = jsUrl[1];

    // chỉ nhận link http(s)
    if (!/^https?:\/\//i.test(url)) continue;

    options.push({ title, url });
  }

  // 2) (Tuỳ chọn) Lấy ảnh (nếu trang có các <img> trong khu vực liên kết)
  const imgs = [];
  const imgRe = /<img[^>]+src="([^"]+)"/gi;
  while ((m = imgRe.exec(html))) {
    const src = decodeHtml(m[1] || "").trim();
    if (!src) continue;
    const abs = makeAbsoluteUrl(baseUrl, src);
    // lọc ảnh rác
    if (!/\.(gif|png|jpg|jpeg)(\?|$)/i.test(abs)) continue;
    imgs.push(abs);
  }

  // Gán ảnh theo thứ tự (nếu có), không có thì để null
  const items = options.map((it, idx) => ({
    id: `dvc-${idx + 1}`,
    title: it.title,
    url: it.url,
    img: imgs[idx] || null,
  }));

  return {
    source: DVC_LINKS_URL,
    total: items.length,
    items,
  };
}





function makeAbsoluteUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}


function decodeHtml(str = "") {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCharCode(parseInt(code, 10))
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

// ================== PARSE DANH SÁCH TIN TỪ 1 TRANG ==================

function parseNewsAnchorsByMarker(html, baseUrl, tab) {
  const config = TAB_CONFIG[tab] || TAB_CONFIG.thue;
  const marker = String(config.marker || "").toLowerCase();
  const decoded = decodeHtml(String(html || ""));
  const out = [];
  const seen = new Set();
  const anchorRe = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = anchorRe.exec(decoded))) {
    const rawHref = (m[2] || "").replace(/&amp;/g, "&").trim();
    const hrefLower = rawHref.toLowerCase();
    if (!marker || !hrefLower.includes(marker)) continue;

    const title = decodeHtml(stripTags(m[3] || "")).replace(/\s+/g, " ").trim();
    if (!title || /^(xem\s*thêm|về\s*trang|in\s*bài|gửi\s*bài)$/i.test(title)) continue;

    const url = makeAbsoluteUrl(baseUrl, rawHref);
    if (seen.has(url)) continue;
    seen.add(url);

    // Lấy ngữ cảnh quanh anchor để tìm ngày và thumbnail mà không phụ thuộc class CSS.
    const before = decoded.slice(Math.max(0, m.index - 700), m.index);
    const after = decoded.slice(anchorRe.lastIndex, Math.min(decoded.length, anchorRe.lastIndex + 700));
    const context = before + m[0] + after;
    const dates = context.match(/\(?\b(\d{2}\/\d{2}\/\d{4})\b\)?/g) || [];
    const date = dates.length ? dates[0].replace(/[()]/g, "") : "";

    let listImage = "";
    const imgs = [...context.matchAll(/<img[^>]+src\s*=\s*(["'])(.*?)\1/gi)];
    if (imgs.length) {
      const rawImg = imgs[imgs.length - 1][2].replace(/&amp;/g, "&");
      listImage = makeAbsoluteUrl(baseUrl, rawImg);
    }

    out.push({ tab, title, url, date, listImage });
  }
  return out;
}

function parseNewsListFromHtml(html, baseUrl, tab) {
  const items = [];

  // Lấy phần <ul> bên trong <div class="list_news">
  let listHtml = html;
  const listMatch = html.match(
    /<div[^>]+class="[^">]*list_news[^">]*"[^>]*>\s*<ul>([\s\S]*?)<\/ul>\s*<\/div>/i
  );
  if (listMatch) {
    listHtml = listMatch[1];
  }

  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRegex.exec(listHtml))) {
    const liHtml = m[1];

    // phải có span.newtitle thì mới là 1 tin
    if (!/class="[^">]*newtitle[^">]*"/i.test(liHtml)) continue;

    // ---- link + title ----
    const linkMatch =
      liHtml.match(
        /<span[^>]*class="[^">]*newtitle[^">]*"[^>]*>[\s\S]*?<a[^>]+href\s*=\s*(['"])([^'"]+)\1[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/span>/i
      ) ||
      liHtml.match(
        /<a[^>]+href\s*=\s*(['"])([^'"]+)\1[^>]*>([\s\S]*?)<\/a>/i
      );
    if (!linkMatch) continue;

    const href = linkMatch[2].replace(/&amp;/g, "&");
    const hrefAbs = makeAbsoluteUrl(baseUrl, href);
    const title = decodeHtml(stripTags(linkMatch[3])).trim();
    if (!title) continue;

    // ---- NGÀY: ưu tiên <span class="datespan">(dd/mm/yyyy)</span> ----
    let date = "";
    const dateSpanMatch = liHtml.match(
      /<span[^>]*class="[^">]*datespan[^">]*"[^>]*>\s*\(?(\d{2}\/\d{2}\/\d{4})\)?\s*<\/span>/i
    );
    if (dateSpanMatch) {
      date = dateSpanMatch[1];
    } else {
      const dateMatches = liHtml.match(/(\d{2}\/\d{2}\/\d{4})/g);
      if (dateMatches && dateMatches.length) {
        date = dateMatches[0]; // lấy NGÀY ĐẦU TIÊN
      }
    }

    // ---- ẢNH thumbnail ở list ----
    let listImage = "";
    const imgMatch = liHtml.match(
      /<img[^>]+src\s*=\s*(['"])([^'"]+)\1[^>]*>/i
    );
    if (imgMatch) {
      listImage = makeAbsoluteUrl(
        baseUrl,
        imgMatch[2].replace(/&amp;/g, "&")
      );
    }

    items.push({
      tab,
      title,
      url: hrefAbs,
      date,
      listImage,
    });
  }

  return items.length ? items : parseNewsAnchorsByMarker(html, baseUrl, tab);
}

// ================== LẤY DANH SÁCH TIN TỪNG TRANG (PHÂN TRANG MỚI) ==================
async function fetchNewsPage(tabKey, page) {
  const config = TAB_CONFIG[tabKey] || TAB_CONFIG["thue"];
  const entryUrl = config.url();
  const MAX_PAGES = 10; // tối đa crawl 10 trang tin

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  };

  // Trang muốn lấy (1..MAX_PAGES)
  const targetPage = Math.max(1, Math.min(page || 1, MAX_PAGES));

  // Lưu URL từng trang và HTML / baseUrl tương ứng
  const pageLinks = { 1: entryUrl };
  const htmlByPage = {};
  const baseUrlByPage = {};
  const fetchedPages = new Set();
  const queue = [1];

  // BFS qua các trang, giống fetchNewsList nhưng dừng sớm khi đã có trang cần
  while (
    !htmlByPage[targetPage] &&
    queue.length > 0 &&
    fetchedPages.size < MAX_PAGES
  ) {
    const pageNum = queue.shift();
    if (fetchedPages.has(pageNum)) continue;

    const pageUrl = pageLinks[pageNum];
    if (!pageUrl) {
      fetchedPages.add(pageNum);
      continue;
    }

    const res = await fetchTaxSite(pageUrl, { headers });
    if (!res.ok) {
      // nếu trang lỗi thì bỏ qua
      fetchedPages.add(pageNum);
      continue;
    }

    const baseUrl = res.url || pageUrl;
    const html = await res.text();

    baseUrlByPage[pageNum] = baseUrl;
    htmlByPage[pageNum] = html;

    // Phân tích <div class="page"> của CHÍNH trang này để tìm thêm các trang khác
    const pageDivMatch = html.match(
      /<div[^>]+class="[^">]*page[^">]*"[^>]*>([\s\S]*?)<\/div>/i
    );
    if (pageDivMatch) {
      const pagerHtml = pageDivMatch[1];
      const aRegex = /<a([^>]*?)>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = aRegex.exec(pagerHtml))) {
        const attrs = m[1];

        // Chỉ quan tâm các thẻ có id dạng linkToPage_X
        const idMatch = attrs.match(/id="[^"]*linkToPage_([0-9]+)[^"]*"/i);
        if (!idMatch) continue;

        const otherPageNum = parseInt(idMatch[1], 10);
        if (
          !otherPageNum ||
          otherPageNum < 1 ||
          otherPageNum > MAX_PAGES
        ) {
          continue;
        }

        const hrefMatch = attrs.match(/href="([^"]+)"/i);
        if (!hrefMatch) continue;

        const href = hrefMatch[1];
        const absUrl = makeAbsoluteUrl(baseUrl, href);

        if (!pageLinks[otherPageNum]) {
          pageLinks[otherPageNum] = absUrl;
        }

        if (
          !fetchedPages.has(otherPageNum) &&
          !queue.includes(otherPageNum)
        ) {
          queue.push(otherPageNum);
        }
      }
    }

    fetchedPages.add(pageNum);
  }

  // Nếu URL danh sách sâu không phản hồi, trang 1 dùng trang Tin tức tổng hợp làm dự phòng.
  if (!htmlByPage[targetPage]) {
    if (targetPage === 1) {
      for (const fallbackUrl of [NEWS_HUB_URL, TAX_HOME_URL]) {
        try {
          const fallbackRes = await fetchTaxSite(fallbackUrl, { headers });
          if (!fallbackRes.ok) continue;
          const fallbackHtml = await fallbackRes.text();
          const fallbackItems = parseNewsAnchorsByMarker(
            fallbackHtml,
            fallbackRes.url || fallbackUrl,
            tabKey
          );
          if (fallbackItems.length) {
            return {
              tab: tabKey,
              page: 1,
              items: fallbackItems.map((it) => ({
                tab: it.tab,
                title: it.title,
                url: it.url,
                date: it.date,
                imageUrl:
                  it.listImage ||
                  "https://nghean.gdt.gov.vn/wps/themes/html/GDT/css/images/home.png",
              })),
              hasNext: false,
              fallback: true,
            };
          }
        } catch {}
      }
    }

    const pageNums = Object.keys(pageLinks).map((n) => parseInt(n, 10));
    const maxPage = pageNums.length ? Math.max(...pageNums) : 1;
    return { tab: tabKey, page: targetPage, items: [], hasNext: targetPage < maxPage };
  }

  // Lấy HTML & baseUrl của trang cần
  const html = htmlByPage[targetPage];
  const baseUrl = baseUrlByPage[targetPage] || entryUrl;

  // Parse danh sách tin từ HTML
  const rawItems = parseNewsListFromHtml(html, baseUrl, tabKey);

  // ===== Lọc theo marker (cucthue / economy / annocement) giống bản cũ =====
  const marker = config.marker;
  let items = rawItems;

  if (marker && rawItems.some((it) => it.url.includes(marker))) {
    items = rawItems.filter((it) => it.url.includes(marker));
  } else if (rawItems.some((it) => it.url.includes("/site/news/"))) {
    items = rawItems.filter((it) => it.url.includes("/site/news/"));
  }

  // Bỏ trùng URL trong cùng 1 trang
  const seenUrls = new Set();
  const uniqueItems = [];
  for (const it of items) {
    if (seenUrls.has(it.url)) continue;
    seenUrls.add(it.url);
    uniqueItems.push(it);
  }

  // Bổ sung ảnh (nếu thiếu thì dùng ảnh mặc định)
  const result = [];
  for (const it of uniqueItems) {
    let imageUrl = it.listImage || "";
    if (!imageUrl) {
      imageUrl =
        "https://nghean.gdt.gov.vn/wps/themes/html/GDT/css/images/home.png";
    }

    result.push({
      tab: it.tab,
      title: it.title,
      url: it.url,
      date: it.date,
      imageUrl,
    });
  }

  // Tính maxPage từ tất cả pageLinks đã phát hiện (có thể đến 10)
  const pageNums = Object.keys(pageLinks).map((n) => parseInt(n, 10));
  const maxPage = pageNums.length ? Math.max(...pageNums) : targetPage;

  return {
    tab: tabKey,
    page: targetPage,
    items: result,
    hasNext: targetPage < maxPage,
  };
}


// ================== LẤY DANH SÁCH TIN THEO NHIỀU TRANG ==================

async function fetchNewsList(tab) {
  const config = TAB_CONFIG[tab] || TAB_CONFIG["thue"];
  const entryUrl = config.url();
  const MAX_PAGES = 10; // tối đa 10 trang giống bên Tin tức

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  };

  const rawItems = [];

  // pageLinks[pageNum] = absolute URL của trang đó
  const pageLinks = {};
  pageLinks[1] = entryUrl;

  // hàng đợi số trang cần crawl
  const queue = [1];
  const fetchedPages = new Set();

  while (queue.length > 0 && fetchedPages.size < MAX_PAGES) {
    const pageNum = queue.shift();
    if (fetchedPages.has(pageNum)) continue;

    const pageUrl = pageLinks[pageNum];
    if (!pageUrl) continue;

    const res = await fetchTaxSite(pageUrl, { headers });
    if (!res.ok) {
      // nếu trang lỗi thì bỏ qua, tiếp trang khác
      fetchedPages.add(pageNum);
      continue;
    }

    const baseUrl = res.url || pageUrl;
    const html = await res.text();

    // ==== LẤY DANH SÁCH TIN TRANG HIỆN TẠI ====
    rawItems.push(...parseNewsListFromHtml(html, baseUrl, tab));

    // ==== TÌM LINK CÁC TRANG KHÁC TRONG <div class="page"> ====
    const pageDivMatch = html.match(
      /<div[^>]+class="[^">]*page[^">]*"[^>]*>([\s\S]*?)<\/div>/i
    );

    if (pageDivMatch) {
      const pagerHtml = pageDivMatch[1];

      // bắt tất cả thẻ <a ...>...</a>
      const aRegex = /<a([^>]*?)>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = aRegex.exec(pagerHtml))) {
        const attrs = m[1];

        // chỉ lấy những thẻ có id chứa linkToPage_X
        const idMatch = attrs.match(/id="[^"]*linkToPage_([0-9]+)[^"]*"/i);
        if (!idMatch) continue;

        const otherPageNum = parseInt(idMatch[1], 10);
        if (!otherPageNum || otherPageNum < 1 || otherPageNum > MAX_PAGES) {
          continue;
        }

        const hrefMatch = attrs.match(/href="([^"]+)"/i);
        if (!hrefMatch) continue;

        const href = hrefMatch[1];
        const absUrl = makeAbsoluteUrl(baseUrl, href);

        if (!pageLinks[otherPageNum]) {
          pageLinks[otherPageNum] = absUrl;
        }

        if (
          !fetchedPages.has(otherPageNum) &&
          !queue.includes(otherPageNum)
        ) {
          queue.push(otherPageNum);
        }
      }
    }

    fetchedPages.add(pageNum);
  }

  // ==== LỌC THEO MARKER (cucthue / economy / annocement) ====
  const marker = config.marker;
  let items = rawItems;

  if (marker && rawItems.some((it) => it.url.includes(marker))) {
    items = rawItems.filter((it) => it.url.includes(marker));
  } else if (rawItems.some((it) => it.url.includes("/site/news/"))) {
    items = rawItems.filter((it) => it.url.includes("/site/news/"));
  }

  // ==== BỎ TRÙNG THEO URL BÀI VIẾT ====
  const seenUrls = new Set();
  const uniqueItems = [];
  for (const it of items) {
    if (seenUrls.has(it.url)) continue;
    seenUrls.add(it.url);
    uniqueItems.push(it);
  }

  // ==== BỔ SUNG ẢNH (nếu thiếu thì dùng icon mặc định) ====
  const result = [];
  for (const it of uniqueItems) {
    let imageUrl = it.listImage || "";
    if (!imageUrl) {
      imageUrl =
        "https://nghean.gdt.gov.vn/wps/themes/html/GDT/css/images/home.png";
    }

    result.push({
      tab: it.tab,
      title: it.title,
      url: it.url,
      date: it.date,
      imageUrl,
    });
  }

  return result;
}


// ================== LẤY DANH SÁCH VĂN BẢN (NHIỀU TRANG) ==================

// ================== LẤY DANH SÁCH VĂN BẢN 1 TRANG ==================
function parseNamedFormAction(html, formName, baseUrl) {
  const tags = String(html || "").match(/<form\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const nameMatch = tag.match(/\b(?:name|id)\s*=\s*(["'])(.*?)\1/i);
    if (!nameMatch || nameMatch[2] !== formName) continue;
    const actionMatch = tag.match(/\baction\s*=\s*(["'])(.*?)\1/i);
    if (!actionMatch) continue;
    return makeAbsoluteUrl(baseUrl, decodeHtml(actionMatch[2]).replace(/&amp;/g, "&"));
  }
  return "";
}

async function fetchHtmlSession(url, init = {}, cookie = "") {
  const headers = new Headers(init.headers || {});
  if (cookie) headers.set("Cookie", cookie);
  const res = await fetchTaxSite(url, { ...init, headers });
  const html = await res.text();
  const nextCookie = mergeCookieHeader(cookie, getSetCookies(res.headers));
  return { res, html, cookie: nextCookie, finalUrl: res.url || url };
}

async function fetchDocsPage(tabKey, page) {
  const config = DOC_TAB_CONFIG[tabKey];
  if (!config || !config.entryUrl) {
    throw new Error("Tab văn bản không hợp lệ hoặc thiếu cấu hình");
  }

  const safePage = Number.parseInt(page, 10);
  if (!Number.isFinite(safePage) || safePage < 1 || safePage > DOC_MAX_PAGES) {
    throw new Error("Số trang không hợp lệ");
  }

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.7",
  };

  // Luôn mở trang đầu để lấy action động và cookie phiên của WebSphere Portal.
  // Không dùng duy nhất URL /!ut/p/z1/... cứng vì URL này có thể đổi/hết hiệu lực.
  let session = await fetchHtmlSession(config.entryUrl, { method: "GET", headers });
  if (!session.res.ok) {
    throw new Error(`Không lấy được văn bản (${tabKey}) – HTTP ${session.res.status}`);
  }

  let html = session.html;
  const dynamicAction = parseNamedFormAction(html, "searchvbpq", session.finalUrl);

  if (safePage > 1) {
    const actionUrl = dynamicAction || config.actionUrl;
    if (!actionUrl) throw new Error(`Không tìm thấy action phân trang cho tab ${tabKey}`);

    const params = new URLSearchParams();
    params.set("page", String(safePage));
    params.set("cmd", "");

    session = await fetchHtmlSession(
      actionUrl,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Referer: session.finalUrl,
        },
        body: params.toString(),
      },
      session.cookie
    );

    if (!session.res.ok) {
      throw new Error(`Không lấy được văn bản trang ${safePage} – HTTP ${session.res.status}`);
    }
    html = session.html;
  }

  const baseDomain = session.finalUrl || TAX_SITE_HTTP_ORIGIN;
  const items = parseDocumentsFromHtml(html, baseDomain, tabKey);
  if (!items.length && !/Số\s*hiệu\s*văn\s*bản|ta_border/i.test(html)) {
    throw new Error("Trang nguồn không còn đúng cấu trúc danh sách văn bản");
  }

  const navMatch = html.match(/<ul[^>]+id=["']tableNavigator["'][^>]*>([\s\S]*?)<\/ul>/i);
  const hasNext = navMatch
    ? new RegExp(`gotoPage\\(\\s*${safePage + 1}\\s*\\)`).test(navMatch[1])
    : false;

  return { tab: tabKey, page: safePage, items, hasNext };
}


// Parse 1 trang HTML thành danh sách văn bản
function parseDocumentsFromHtml(html, baseUrl, tabKey) {
  const tableMatch = html.match(
    /<table[^>]+class="[^">]*ta_border[^">]*"[^>]*>([\s\S]*?)<\/table>/i
  );
  if (!tableMatch) {
    return [];
  }

  const tableHtml = tableMatch[1];
  const result = [];

  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(tableHtml))) {
    const rowHtml = trMatch[1];

    // Bỏ dòng tiêu đề
    if (/Số\s*hiệu\s*văn\s*bản/i.test(stripTags(rowHtml))) {
      continue;
    }

    const cells = [];
    const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml))) {
      cells.push(tdMatch[1]);
    }

    if (cells.length < 4) continue;

    const soHieu = decodeHtml(stripTags(cells[1])).trim(); // cột 1
    const date = decodeHtml(stripTags(cells[2])).trim();   // cột 2
    const colTitleHtml = cells[3];                         // cột 3

    // Tiêu đề
    let title = "";
    const titleMatch =
      colTitleHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i) ||
      colTitleHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    if (titleMatch) {
      title = decodeHtml(stripTags(titleMatch[1])).trim();
    } else {
      title = decodeHtml(stripTags(colTitleHtml)).trim();
    }

    // Link "Thông tin văn bản"
    let viewUrl = "";
    const linkMatch =
      colTitleHtml.match(
        /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?Thông tin văn bản[\s\S]*?<\/a>/i
      ) ||
      colTitleHtml.match(/<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<\/a>/i);

    if (linkMatch) {
      viewUrl = makeAbsoluteUrl(
        baseUrl,
        linkMatch[1].replace(/&amp;/g, "&")
      );
    }

    if (!title) continue;

    result.push({
      tab: tabKey,
      title,
      date,
      code: soHieu,
      viewUrl,
    });
  }

  return result;
}


// ================== LẤY CHI TIẾT BÀI ==================

async function fetchArticleDetail(articleUrl) {
  const safeUrl = parseAndAllowUrl(articleUrl, new Set([TAX_SITE_HOST, "www.gdt.gov.vn", "web.gdt.gov.vn"]));
  if (!safeUrl) throw new Error("URL bài viết không hợp lệ hoặc không thuộc hệ thống gdt.gov.vn");

  const res = await fetchTaxSite(safeUrl.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Không fetch được bài viết - HTTP ${res.status}`);
  }

  const html = await res.text();

  let title = "";
  let t =
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) {
    title = decodeHtml(stripTags(t[1])).trim();
  }

  let date = "";
  const d = html.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (d) date = d[1];

  let contentHtml = "";
  let c =
    html.match(
      /<div[^>]+class="[^"]*(ArticleContent|news-detail|newsContent|WordSection1)[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    ) ||
    html.match(
      /<td[^>]+class="[^"]*(NoiDung|content_news)[^">]*"[^>]*>([\s\S]*?)<\/td>/i
    );
  if (c) {
    contentHtml = c[2];
  } else {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    contentHtml = bodyMatch ? bodyMatch[1] : html;
  }

  const contentText = decodeHtml(stripTags(contentHtml)).trim();

  return {
    url: articleUrl,
    title,
    date,
    contentHtml,
    contentText,
  };
}

// ===== VIDEO =====
const VIDEO_URL =
  "https://nghean.gdt.gov.vn/wps/portal/video?1dmy&current=true&urile=wcm:path:/nghean/site/video"; 
// (nếu bạn đang dùng URL khác cho tab Video thì thay bằng URL bạn đang fetch)

async function handleVideos(request) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.max(1, Math.min(30, parseInt(url.searchParams.get("pageSize") || "10", 10)));

  const html = await fetchHtml(VIDEO_URL);
  const workerOrigin = `${url.protocol}//${url.host}`;
  const all = parseVideosFromHtml(html, "https://nghean.gdt.gov.vn", workerOrigin);

  const total = all.length;
  const start = (page - 1) * pageSize;
  const items = all.slice(start, start + pageSize);

  return jsonResponse({
    tab: "videos",
    page,
    pageSize,
    total,
    hasNext: start + pageSize < total,
    items,
  });
}

function parseVideosFromHtml(html, baseUrl, workerOrigin) {
  // Cắt vùng danh sách để giảm bắt nhầm
  const ulMatch = html.match(/<ul[^>]*class="thumbnail_list"[^>]*>([\s\S]*?)<\/ul>/i);
  const ulHtml = ulMatch ? ulMatch[1] : html;

  const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  const items = [];
  let m;

  while ((m = liRe.exec(ulHtml))) {
    const li = m[1];

    // title: lấy từ text trong <a> (sạch nhất)
    let title = "";
    const aMatch = li.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    if (aMatch) title = decodeHtml(stripTags(aMatch[1])).replace(/\s+/g, " ").trim();

    // date
    let date = "";
    const dMatch = li.match(/<p[^>]*class="post_meta"[^>]*>\s*([\s\S]*?)\s*<\/p>/i);
    if (dMatch) date = decodeHtml(stripTags(dMatch[1])).trim();

    // thumb
    let thumb = "";
    const imgMatch = li.match(/<img[^>]*src="([^"]+)"/i);
    if (imgMatch) {
      const raw = decodeHtml(imgMatch[1]).trim();
      const abs = makeAbsoluteUrl(baseUrl, raw);
      // proxy để khỏi hotlink
      thumb = `${workerOrigin}/img?u=${encodeURIComponent(abs)}`;
    }

    // videoUrl: parse playClip('URL''TITLE'...)
    let videoUrl = "";
    const onClickMatch = li.match(/onclick="playClip\(([\s\S]*?)\)"/i);
    if (onClickMatch) {
      const onClick = decodeHtml(onClickMatch[1]);

      // bắt chuỗi đầu tiên trong playClip('....'
      const urlMatch = onClick.match(/^\s*'([^']*)'/);
      if (urlMatch) {
        videoUrl = urlMatch[1] ? makeAbsoluteUrl(baseUrl, urlMatch[1].trim()) : "";
      }
    }

    // bỏ item rác
    if (!title && !date && !videoUrl) continue;

    items.push({
      title,
      date,
      thumb,
      videoUrl,
      playable: !!videoUrl, // <= quan trọng: 3 video mới sẽ playable=false vì URL rỗng từ website
    });
  }

  return items;
}

// ===================== DNRRVT (Doanh nghiệp rủi ro cao về thuế) =====================

// Base + entry URL (tách dòng cho dễ nhìn, không bị “trắng” do quá dài)
const DNRRVT_BASE = "https://nghean.gdt.gov.vn";
const DNRRVT_ENTRY_URL =
  "https://nghean.gdt.gov.vn/wps/portal/Home/dnrrvt?1dmy&current=true&urile=wcm:path:/nghean/site/sa-dnrrcvt";

// Đổi version khi muốn xóa cache
const DNRRVT_CACHE_VER = "v102";

// ---------- utils ----------
function dnrrvtDecodeHtml(s) {
  if (!s) return "";
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function dnrrvtStripTags(s) {
  return (s || "").replace(/<[^>]*>/g, "");
}

// Resolve href đúng kiểu dnrrvt:
// - nếu href là p0/... hoặc /p0/... => phải ghép theo DNRRVT_ENTRY_URL (KHÔNG phải domain root)
function dnrrvtResolveHref(href) {
  const h = dnrrvtDecodeHtml((href || "").trim());
  if (!h) return "";

  // absolute
  if (/^https?:\/\//i.test(h)) return h;

  // loại fragment
  const noHash = h.split("#")[0];

  // case: p0/... hoặc /p0/...
  if (/^\/?p0\//i.test(noHash)) {
    // dùng ENTRY_URL làm base để ra .../dz/d5/.../p0/...
    return new URL(noHash.replace(/^\//, ""), DNRRVT_ENTRY_URL).toString();
  }

  // fallback normal relative
  return new URL(noHash, DNRRVT_ENTRY_URL).toString();
}

// Lấy href của <a id="pc..._linkToPage_N" ... href="...">
function parseDnrrvtLinkToPage(html, pageNumber) {
  if (!html) return "";

  const reTag = new RegExp(
    `<a\\b[^>]*\\bid\\s*=\\s*(['"])pc\\d+_linkToPage_${pageNumber}\\1[^>]*>`,
    "i"
  );
  const m = html.match(reTag);
  if (!m) return "";

  const tag = m[0];
  const hrefMatch = tag.match(/\bhref\s*=\s*(['"])(.*?)\1/i);
  if (!hrefMatch) return "";

  return dnrrvtResolveHref(hrefMatch[2]);
}

// max page dựa theo toàn bộ id linkToPage_X
function parseDnrrvtMaxPage(html) {
  let max = 1;
  const re = /_linkToPage_(\d+)/gi;
  let m;
  while ((m = re.exec(html))) {
    const n = parseInt(m[1], 10);
    if (!Number.isNaN(n)) max = Math.max(max, n);
  }
  return max;
}

// parse bảng ta_border -> items
function parseDnrrvtItems(html) {
  const tableMatch = html.match(
    /<table[^>]+class="[^"]*ta_border[^"]*"[\s\S]*?<\/table>/i
  );
  if (!tableMatch) return [];

  const tableHtml = tableMatch[0];
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;

  while ((tr = trRe.exec(tableHtml))) {
    const rowHtml = tr[1];

    // skip header
    const rowText = dnrrvtStripTags(dnrrvtDecodeHtml(rowHtml)).toLowerCase();
    if (
      rowText.includes("ngày quyết định") &&
      rowText.includes("số quyết định")
    ) {
      continue;
    }

    const tds = [];
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let td;
    while ((td = tdRe.exec(rowHtml))) {
      tds.push(td[1]);
    }
    if (tds.length < 5) continue;

    const ngayQd = dnrrvtStripTags(dnrrvtDecodeHtml(tds[0])).trim();
    const soQd = dnrrvtStripTags(dnrrvtDecodeHtml(tds[1])).trim();
    const coQuan = dnrrvtStripTags(dnrrvtDecodeHtml(tds[2])).trim();

    const qdHref = (tds[3].match(/href\s*=\s*(['"])(.*?)\1/i) || [])[2] || "";
    const dsHref = (tds[4].match(/href\s*=\s*(['"])(.*?)\1/i) || [])[2] || "";

    const qdFileUrl = qdHref ? new URL(dnrrvtDecodeHtml(qdHref), DNRRVT_BASE).toString() : "";
    const dsDnFileUrl = dsHref ? new URL(dnrrvtDecodeHtml(dsHref), DNRRVT_BASE).toString() : "";

    rows.push({ ngayQd, soQd, coQuan, qdFileUrl, dsDnFileUrl });
  }

  return rows;
}

// -------- cookie jar (đủ dùng) --------
function parseSetCookieToPair(setCookieStr) {
  // "NAME=VALUE; Path=/; HttpOnly" -> "NAME=VALUE"
  const first = (setCookieStr || "").split(";")[0].trim();
  if (!first || !first.includes("=")) return null;
  const idx = first.indexOf("=");
  return { name: first.slice(0, idx), value: first.slice(idx + 1) };
}

function mergeCookieHeader(oldCookie, setCookies) {
  const jar = new Map();

  (oldCookie || "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((kv) => {
      const idx = kv.indexOf("=");
      if (idx > 0) jar.set(kv.slice(0, idx), kv.slice(idx + 1));
    });

  for (const sc of setCookies || []) {
    const pair = parseSetCookieToPair(sc);
    if (pair) jar.set(pair.name, pair.value);
  }

  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function getSetCookies(headers) {
  // runtime mới có headers.getSetCookie()
  if (headers && typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const sc = headers ? headers.get("set-cookie") : null;
  return sc ? [sc] : [];
}

async function fetchHtmlWithCookie(url, cookie, extraHeaders = {}) {
  const headers = new Headers({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    ...extraHeaders,
  });

  if (cookie) headers.set("Cookie", cookie);

  const res = await fetchTaxSite(url, { headers, redirect: "follow" });
  const html = await res.text();

  const setCookies = getSetCookies(res.headers);
  const newCookie = mergeCookieHeader(cookie, setCookies);

  return { res, html, cookie: newCookie };
}

// -------- main fetch --------
async function fetchDNRRVTPage(page, ctx, noCache = false) {
  const cache = caches.default;
  const safePage = Math.max(1, parseInt(page || 1, 10) || 1);

  const cacheKey = new Request(
    `https://cache.local/dnrrvt/${DNRRVT_CACHE_VER}?page=${safePage}`,
    { method: "GET" }
  );

  if (!noCache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached.json();
  }

  let cookie = "";

  // 1) luôn fetch trang entry để lấy cookie + maxPage + linkToPage_X
  const entry = await fetchHtmlWithCookie(DNRRVT_ENTRY_URL, cookie);
  cookie = entry.cookie;
  const entryHtml = entry.html;
  const maxPage = parseDnrrvtMaxPage(entryHtml);

  // 2) xác định url cần fetch cho page
  let pageUrlUsed = DNRRVT_ENTRY_URL;
  if (safePage > 1) {
    const pageUrl = parseDnrrvtLinkToPage(entryHtml, safePage);
    pageUrlUsed = pageUrl || "";
    if (!pageUrlUsed) {
      const dataFail = {
        tab: "dnrrvt",
        page: safePage,
        items: [],
        hasNext: false,
        debug: {
          reason: "Không tìm thấy linkToPage_" + safePage,
          maxPage,
        },
      };
      if (!noCache) ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(dataFail))));
      return dataFail;
    }
  }

  // 3) fetch trang cần đọc (page 1 dùng entryHtml luôn để giảm request)
  let html = entryHtml;
  if (safePage > 1) {
    const r = await fetchHtmlWithCookie(pageUrlUsed, cookie, {
      Referer: DNRRVT_ENTRY_URL,
    });
    cookie = r.cookie;
    html = r.html;
  }

  const items = parseDnrrvtItems(html);

  // hasNext dựa vào maxPage (ổn định hơn nextPage anchor)
  const hasNext = safePage < maxPage;

  const data = {
    tab: "dnrrvt",
    page: safePage,
    items,
    hasNext,
    debug: {
      cookieLen: (cookie || "").length,
      htmlHasTable: /class="[^"]*ta_border/i.test(html),
      pageUrlUsed,
      maxPage,
    },
  };

  if (!noCache) {
    ctx.waitUntil(
      cache.put(
        cacheKey,
        new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json; charset=utf-8" },
        })
      )
    );
  }

  return data;
}

// -------- route handler: /dnrrvt?page=1&nocache=1 --------
async function handleDNRRVT(request, env, ctx) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const noCache = searchParams.get("nocache") === "1";

    const data = await fetchDNRRVTPage(page, ctx, noCache);
    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: true,
        message: String(e?.message || e),
        stack: String(e?.stack || ""),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
// ================= HDDT (Tra cứu hóa đơn điện tử) =================

const HDDT_CAPTCHA_URLS = [
  "https://hoadondientu.gdt.gov.vn:30000/captcha",
  "https://hoadondientu.gdt.gov.vn/captcha",
];

// ✅ BẮT BUỘC: bạn phải điền endpoint search thật vào đây (lấy trong F12 -> Network của hoadondientu)
const HDDT_SEARCH_URLS = [
  // ví dụ (CHỈ LÀ MẪU - BẠN PHẢI THAY):
  // "https://hoadondientu.gdt.gov.vn:30000/xxxxx/xxxxx",
];

async function fetchFirstOk(urls, init) {
  let lastErr = null;
  for (const u of urls) {
    try {
      const res = await fetch(u, init);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} for ${u}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Fetch failed");
}

function guessDataUrlFromContentType(ct, base64) {
  const type = (ct || "").split(";")[0].trim() || "image/png";
  return `data:${type};base64,${base64}`;
}

// Tách cookie từ Set-Cookie (đa số trường hợp cookie của site này không có Expires nên tách đơn giản được)
function pickCookiePair(setCookieLine = "") {
  // lấy "name=value" trước dấu ';'
  return setCookieLine.split(";")[0]?.trim() || "";
}

function getCookieFromResponse(res) {
  // CF Workers thường đọc được 1 chuỗi set-cookie; nếu có nhiều cookie đôi khi nó dồn chung.
  const sc = res.headers.get("set-cookie") || res.headers.get("Set-Cookie") || "";
  if (!sc) return "";

  // tách theo dấu phẩy nhưng chỉ khi sau đó là "key=value"
  const parts = sc.split(/,(?=[^;,=\s]+=[^;,]+)/g).map((s) => s.trim()).filter(Boolean);
  const pairs = parts.map(pickCookiePair).filter(Boolean);

  // gộp thành header Cookie: "a=b; c=d"
  return pairs.join("; ");
}

function normalizeCaptchaJson(data) {
  const ckey = data?.ckey || data?.cKey || data?.key || data?.ck || null;
  const cvalue = data?.cvalue || data?.cValue || data?.cv || null;

  let imageDataUrl =
    data?.imageDataUrl ||
    data?.image ||
    data?.captcha ||
    data?.img ||
    data?.data ||
    data?.base64 ||
    null;

  if (imageDataUrl && typeof imageDataUrl === "string" && !imageDataUrl.startsWith("data:")) {
    // đa số captcha là svg base64
    imageDataUrl = guessDataUrlFromContentType("image/svg+xml", imageDataUrl);
  }

  return { ...data, ckey, cvalue, imageDataUrl };
}

async function handleHDDTCaptcha(request) {
  const res = await fetchFirstOk(HDDT_CAPTCHA_URLS, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      // ✅ quan trọng: giống request thật
      "Origin": "https://hoadondientu.gdt.gov.vn",
      "Referer": "https://hoadondientu.gdt.gov.vn/",
    },
  });

  const cookie = getCookieFromResponse(res);
  const ct = res.headers.get("content-type") || "";

  if (ct.includes("application/json")) {
    const data = await res.json();
    const out = normalizeCaptchaJson(data);
    return jsonResponse({ ...out, cookie });
  }

  // Trường hợp trả về ảnh thẳng
  const ab = await res.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
  const imageDataUrl = guessDataUrlFromContentType(ct, b64);

  return jsonResponse({ imageDataUrl, ckey: null, cvalue: null, cookie });
}

async function handleHDDTSearch(request) {
  if (request.method !== "POST") {
    return jsonResponse({ error: true, message: "Method not allowed" }, 405);
  }

  const body = await request.json().catch(() => ({}));

  // Cho phép override để debug nhanh (không sửa worker): body.__searchUrl
  const urlFromBody = body?.__searchUrl;
  const urlList = urlFromBody ? [urlFromBody] : HDDT_SEARCH_URLS;

  if (!urlList || urlList.length === 0) {
    return jsonResponse(
      {
        error: true,
        message:
          "Chưa cấu hình HDDT_SEARCH_URL. Hãy mở F12 -> Network trên hoadondientu.gdt.gov.vn, thực hiện tra cứu, copy đúng endpoint và điền vào HDDT_SEARCH_URLS trong Worker.",
      },
      501
    );
  }

  const cookie = body?.cookie || "";

  // payload gửi lên endpoint search (tùy endpoint thật bạn lấy được)
  const payload = {
    nbmst: body.mst,      // nhiều API dùng id như trang web: nbmst/lhdon/khhdon/shdon/tgtthue/tgtttbso/cvalue
    lhdon: body.loai,
    khhdon: body.kyhieu,
    shdon: body.so,
    tgtthue: body.tongThue,
    tgtttbso: body.tongThanhToan,
    cvalue: body.captcha,
    ckey: body.ckey,
  };

  // Nhiều endpoint nhận x-www-form-urlencoded
  const form = new URLSearchParams();
  Object.entries(payload).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    form.set(k, String(v));
  });

  const init = {
    method: "POST",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Origin": "https://hoadondientu.gdt.gov.vn",
      "Referer": "https://hoadondientu.gdt.gov.vn/",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: form.toString(),
  };

  const res = await fetchFirstOk(urlList, init);
  const ct = res.headers.get("content-type") || "";

  if (ct.includes("application/json")) {
    const data = await res.json();
    return jsonResponse(data);
  }

  const text = await res.text();
  return corsText(text, 200, { "Content-Type": ct || "text/plain; charset=utf-8" });
}


// ================= XC (NNT có thông báo về xuất cảnh) =================

// ================= XUẤT CẢNH (NNT có thông báo về xuất cảnh) =================

const XC_HOSTS = {
  gdt: "https://www.gdt.gov.vn",
  nghean: "https://nghean.gdt.gov.vn",
};
const XC_ENTRY_PATH = "/wps/portal/Home/nt/xc";

function normalizeSpaces(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}



// Cloudflare Workers có thể gộp set-cookie thành 1 chuỗi -> tách tương đối an toàn
function splitSetCookie(setCookie) {
  if (!setCookie) return [];
  const s = String(setCookie);
  // tách theo ", " nhưng tránh cắt Expires=Wed, 21 Oct...
  return s.split(/,(?=\s*[^;=\s]+=[^;]+)/g).map((x) => x.trim()).filter(Boolean);
}
function joinCookies(setCookieHeaderValue) {
  const arr = splitSetCookie(setCookieHeaderValue);
  return arr
    .map((c) => c.split(";")[0].trim()) // lấy a=b
    .filter(Boolean)
    .join("; ");
}

function parseActionUrlFromHtml(html, origin) {
  // tìm đoạn: getElementById('frm_dngtgt').action = '...';
  const m =
    String(html).match(/getElementById\('frm_dngtgt'\)\.action\s*=\s*'([^']+)'/i) ||
    String(html).match(/frm_dngtgt'\)\.action\s*=\s*'([^']+)'/i);

  if (!m || !m[1]) return "";
  let path = m[1].replace(/#.*$/, "");
  if (!path.startsWith("/")) path = "/" + path;
  // actionUrl thường là path /wps/portal/!ut/p/... => ghép origin
  return origin + path;
}

function arrayBufferToBase64(ab) {
  const bytes = new Uint8Array(ab);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Chỉ lấy vùng kết quả (div.ckCtn) để tránh parse nhầm bảng form (formTbl)
function extractXcResultArea(html) {
  const s = String(html || "");
  const m = s.match(/<div[^>]*class=["'][^"']*\bckCtn\b[^"']*["'][^>]*>/i);
  if (!m || m.index == null) return "";
  const start = m.index + m[0].length;
  const rest = s.slice(start);
  const endRel = rest.search(/<\/form>/i);
  return endRel >= 0 ? rest.slice(0, endRel) : rest;
}

function pickBestTableFromArea(areaHtml) {
  const tables = [...String(areaHtml).matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((m) => m[0]);
  if (!tables.length) return "";

  // bỏ bảng formTbl nếu có
  const filtered = tables.filter((t) => {
    if (/class=["'][^"']*\bformTbl\b/i.test(t)) return false;
    // nếu trong bảng có "Mã xác nhận" + "Tìm kiếm" thì chắc là form
    if (/Mã\s*xác\s*nhận/i.test(t) && /Tìm\s*kiếm/i.test(t)) return false;
    return true;
  });

  const candidates = filtered.length ? filtered : tables;

  const score = (t) => {
    let s = 0;
    if (/\bSTT\b/i.test(t)) s += 120;
    if (/Mã\s*số\s*thuế|MST/i.test(t)) s += 80;
    if (/Tên\s*NNT|Người\s*nộp\s*thuế/i.test(t)) s += 60;
    if (/tạm\s*hoãn|gia\s*hạn|hủy\s*bỏ|xuất\s*cảnh/i.test(t)) s += 40;

    const th = (t.match(/<th\b/gi) || []).length;
    const tr = (t.match(/<tr\b/gi) || []).length;
    s += th * 4 + tr * 2;
    return s;
  };

  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0] || "";
}

function parseXcResultHtml(html) {
  const area = extractXcResultArea(html);
  const table = pickBestTableFromArea(area);
  const hasNext = /goToPage\(\s*\d+\s*\)/i.test(html);

  if (!table) {
    const plain = normalizeSpaces(stripTags(area || html));
    let message = "Không có kết quả. Có thể captcha sai hoặc không có dữ liệu phù hợp.";
    if (/mã\s*xác\s*nhận/i.test(plain) && /(không\s*đúng|sai)/i.test(plain)) {
      message = "Captcha không đúng. Vui lòng bấm đổi captcha và nhập lại.";
    } else if (/không\s*có\s*dữ\s*liệu|không\s*tìm\s*thấy/i.test(plain)) {
      message = "Không có dữ liệu phù hợp điều kiện tra cứu.";
    }
    return { headers: [], rows: [], message, hasNext };
  }

  const trList = [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
  if (!trList.length) return { headers: [], rows: [], message: "Bảng kết quả rỗng.", hasNext };

  const headerCells = [...trList[0].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => normalizeSpaces(stripTags(m[2])))
    .filter(Boolean);

  const rows = trList
    .slice(1)
    .map((tr) => {
      const cells = [...tr.matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
        .map((m) => normalizeSpaces(stripTags(m[2])));
      const obj = {};
      headerCells.forEach((h, i) => (obj[h || `col_${i}`] = cells[i] || ""));
      return obj;
    })
    .filter((r) => Object.values(r).some((v) => v && v !== "-" && v !== "—"));

  const message = rows.length ? "" : "Không có dữ liệu (có thể captcha sai hoặc không có kết quả).";
  return { headers: headerCells, rows, message, hasNext };
}

async function handleXCCaptcha(request) {
  const url = new URL(request.url);
  const hostKey = String(url.searchParams.get("host") || "gdt").toLowerCase();
  const origin = XC_HOSTS[hostKey] || XC_HOSTS.gdt;

  try {
    const captchaId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());

    // 1) GET trang để lấy cookie + actionUrl
    const pageRes = await fetch(origin + XC_ENTRY_PATH, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });

    const html = await pageRes.text();
    const setCookie = pageRes.headers.get("set-cookie") || "";
    const cookie = joinCookies(setCookie);
    const actionUrl = parseActionUrlFromHtml(html, origin);

    if (!cookie || !actionUrl) {
      return jsonResponse(
        { ok: false, message: "Không lấy được cookie/actionUrl từ trang Thuế." },
        500
      );
    }

    // 2) GET captcha bằng cookie
    const capRes = await fetch(`${origin}/wps/PA_CKTT/captcha.png?id=${encodeURIComponent(captchaId)}`, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": origin + XC_ENTRY_PATH,
        "Cookie": cookie,
      },
    });

    const ab = await capRes.arrayBuffer();
    const b64 = arrayBufferToBase64(ab);

    return jsonResponse({
      ok: true,
      cookie,
      actionUrl,
      captchaId,
      imageDataUrl: `data:image/png;base64,${b64}`,
    });
  } catch (e) {
    return jsonResponse({ ok: false, message: "Lỗi lấy captcha.", detail: String(e) }, 500);
  }
}

async function handleXCSearch(request) {
  // để bạn mở bằng trình duyệt cho dễ test
  if (request.method === "GET") {
    return jsonResponse({
      ok: true,
      message: "Dùng POST JSON. Gọi /xc/captcha trước để lấy cookie + actionUrl + captcha.",
      examplePostBody: {
        host: "gdt",
        cookie: "<cookie from /xc/captcha>",
        actionUrl: "<actionUrl from /xc/captcha>",
        captcha: "abcd",
        page: 1,
        cqt: "403",
        tin: "",
        tenTin: "",
        tinCn: "",
        tenTinCn: "",
        giayTo: "",
        ngayThTuStr: "",
        ngayThDenStr: "",
      },
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
  }

  const body = await request.json().catch(() => ({}));

  const cookie = String(body.cookie || "");
  const actionUrlRaw = String(body.actionUrl || "");
  const actionUrlObj = parseAndAllowUrl(actionUrlRaw, new Set(["www.gdt.gov.vn", "web.gdt.gov.vn", TAX_SITE_HOST]));
  const actionUrl = actionUrlObj ? actionUrlObj.toString() : "";
  const captcha = String(body.captcha || "").trim();
  const page = Number(body.page || 1) || 1;

  if (!cookie || !actionUrl) {
    return jsonResponse({ ok: false, needRefreshCaptcha: true, message: "Thiếu cookie/actionUrl. Hãy đổi captcha." }, 400);
  }
  if (!captcha) {
    return jsonResponse({ ok: false, needRefreshCaptcha: false, message: "Chưa nhập captcha." }, 400);
  }

  // ✅ đúng field là cqt (đừng dùng coQuanThue)
  const params = new URLSearchParams();
  params.set("loaiCk", "dngtgt");
  params.set("cmd", "search");
  params.set("pageNumber", String(page));

  params.set("cqt", String(body.cqt ?? "403"));
  params.set("tin", String(body.tin ?? ""));
  params.set("tenTin", String(body.tenTin ?? ""));
  params.set("tinCn", String(body.tinCn ?? ""));
  params.set("tenTinCn", String(body.tenTinCn ?? ""));
  params.set("giayTo", String(body.giayTo ?? ""));
  params.set("ngayThTuStr", String(body.ngayThTuStr ?? ""));
  params.set("ngayThDenStr", String(body.ngayThDenStr ?? ""));
  params.set("captcha", captcha);

  try {
    const res = await fetch(actionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0",
        "Cookie": cookie,
      },
      body: params.toString(),
    });

    const html = await res.text();
    const parsed = parseXcResultHtml(html);

    // chỉ yêu cầu đổi captcha nếu message có nhắc captcha sai
    const needRefreshCaptcha = /captcha|mã xác nhận/i.test(parsed.message || "");

    return jsonResponse({
      ok: true,
      page,
      needRefreshCaptcha,
      ...parsed,
    });
  } catch (e) {
    return jsonResponse({ ok: false, needRefreshCaptcha: false, message: "Lỗi tra cứu.", detail: String(e) }, 500);
  }
}
// ================= XNC / XUẤT CẢNH (GDT) =================
// Nguồn trang tra cứu: https://web.gdt.gov.vn/wps/portal/Home/nt/xc
const XC_ENTRY_URL = "https://web.gdt.gov.vn/wps/portal/Home/nt/xc";
const XC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// Danh sách CQTS đầy đủ (63 option) – lấy theo HTML form của GDT (id="cqt")
const XC_CQT_OPTIONS = [
  { value: "", label: "Tất cả" },
  { value: "0", label: "Cục Thuế" },
  { value: "827", label: "Chi cục Thuế Thương mại điện tử" },
  { value: "825", label: "Chi cục Thuế Doanh nghiệp lớn" },
  { value: "101", label: "Thuế Thành phố Hà Nội" },
  { value: "701", label: "Thuế Thành phố Hồ Chí Minh - Hồ Chí Minh" },
  { value: "717", label: "Thuế Thành phố Hồ Chí Minh - Bà Rịa - Vũng Tàu" },
  { value: "711", label: "Thuế Thành phố Hồ Chí Minh - Bình Dương" },
  { value: "223", label: "Thuế Tỉnh Bắc Ninh - Bắc Ninh" },
  { value: "221", label: "Thuế Tỉnh Bắc Ninh - Bắc Giang" },
  { value: "207", label: "Thuế Tỉnh Cao Bằng" },
  { value: "815", label: "Thuế Tỉnh Cà Mau - Cà Mau" },
  { value: "813", label: "Thuế Tỉnh Cà Mau - Bạc Liêu" },
  { value: "815", label: "Thuế Thành phố Cần Thơ - Cần Thơ" }, // nếu bạn muốn khớp tuyệt đối theo server, giữ list fetch động ở handleXCCqts()
  { value: "812", label: "Thuế Thành phố Cần Thơ - Hậu Giang" },
  { value: "814", label: "Thuế Thành phố Cần Thơ - Sóc Trăng" },
  { value: "503", label: "Thuế Thành phố Đà Nẵng - Đà Nẵng" },
  { value: "505", label: "Thuế Thành phố Đà Nẵng - Quảng Nam" },
  { value: "605", label: "Thuế Tỉnh Đắk Lắk - Đắk Lắk" },
  { value: "607", label: "Thuế Tỉnh Đắk Lắk - Phú Yên" },
  { value: "815", label: "Thuế Tỉnh Đồng Tháp - Đồng Tháp" },
  { value: "813", label: "Thuế Tỉnh Đồng Tháp - Tiền Giang" },
  { value: "713", label: "Thuế Tỉnh Đồng Nai - Bình Phước" },
  { value: "711", label: "Thuế Tỉnh Đồng Nai - Đồng Nai" },
  { value: "301", label: "Thuế Tỉnh Điện Biên" },
  { value: "603", label: "Thuế Tỉnh Gia Lai - Bình Định" },
  { value: "601", label: "Thuế Tỉnh Gia Lai - Gia Lai" },
  { value: "401", label: "Thuế Tỉnh Hà Tĩnh" },
  { value: "109", label: "Thuế Thành phố Hải Phòng - Hải Dương" },
  { value: "107", label: "Thuế Thành phố Hải Phòng - Hải Phòng" },
  { value: "111", label: "Thuế Tỉnh Hưng Yên - Hưng Yên" },
  { value: "113", label: "Thuế Tỉnh Hưng Yên - Thái Bình" },
  { value: "501", label: "Thuế Thành phố Huế" },
  { value: "705", label: "Thuế Tỉnh Lâm Đồng - Lâm Đồng" },
  { value: "707", label: "Thuế Tỉnh Lâm Đồng - Đắk Nông" },
  { value: "209", label: "Thuế Tỉnh Lạng Sơn" },
  { value: "305", label: "Thuế Tỉnh Lai Châu" },
  { value: "307", label: "Thuế Tỉnh Lào Cai - Lào Cai" },
  { value: "309", label: "Thuế Tỉnh Lào Cai - Yên Bái" },
  { value: "403", label: "Thuế Tỉnh Ninh Bình - Nam Định" },
  { value: "405", label: "Thuế Tỉnh Ninh Bình - Ninh Bình" },
  { value: "407", label: "Thuế Tỉnh Ninh Bình - Hà Nam" },
  { value: "409", label: "Thuế Tỉnh Nghệ An" },
  { value: "115", label: "Thuế Tỉnh Phú Thọ - Vĩnh Phúc" },
  { value: "117", label: "Thuế Tỉnh Phú Thọ - Phú Thọ" },
  { value: "517", label: "Thuế Tỉnh Quảng Ngãi - Quảng Ngãi" },
  { value: "519", label: "Thuế Tỉnh Quảng Ngãi - Kon Tum" },
  { value: "119", label: "Thuế Tỉnh Quảng Ninh" },
  { value: "415", label: "Thuế Tỉnh Quảng Trị - Quảng Bình" },
  { value: "417", label: "Thuế Tỉnh Quảng Trị - Quảng Trị" },
  { value: "609", label: "Thuế Tỉnh Khánh Hòa - Khánh Hòa" },
  { value: "611", label: "Thuế Tỉnh Khánh Hòa - Ninh Thuận" },
  { value: "303", label: "Thuế Tỉnh Sơn La" },
  { value: "709", label: "Thuế Tỉnh Tây Ninh - Tây Ninh" },
  { value: "707", label: "Thuế Tỉnh Tây Ninh - Long An" },
  { value: "203", label: "Thuế Tỉnh Thái Nguyên - Thái Nguyên" },
  { value: "205", label: "Thuế Tỉnh Thái Nguyên - Bắc Cạn" },
  { value: "419", label: "Thuế Tỉnh Thanh Hóa" },
  { value: "211", label: "Thuế Tỉnh Tuyên Quang - Tuyên Quang" },
  { value: "201", label: "Thuế Tỉnh Tuyên Quang - Hà Giang" },
  { value: "809", label: "Thuế Tỉnh Vĩnh Long - Vĩnh Long" },
  { value: "811", label: "Thuế Tỉnh Vĩnh Long - Bến Tre" },
  { value: "817", label: "Thuế Tỉnh Vĩnh Long - Trà Vinh" },
];

// ---- helpers ----
function xcNormalizeSpace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}
function xcAbsUrl(maybeRelative, baseUrl) {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return maybeRelative;
  }
}
function xcPickCookies(setCookieHeaders) {
  // setCookieHeaders: array of "Set-Cookie" header strings
  const jar = new Map();
  for (const sc of setCookieHeaders) {
    const part = (sc || "").split(";")[0];
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
async function xcFetchFollow(url, init = {}, max = 5) {
  // manual redirect to accumulate cookies across hops
  let current = url;
  let cookie = init.headers?.Cookie || "";
  const setCookies = [];

  for (let i = 0; i < max; i++) {
    const res = await fetch(current, {
      ...init,
      redirect: "manual",
      headers: {
        ...(init.headers || {}),
        "User-Agent": XC_UA,
        Cookie: cookie,
      },
    });

    const sc = res.headers.get("set-cookie");
    if (sc) setCookies.push(sc);

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) return { res, cookie: xcPickCookies(setCookies) || cookie, finalUrl: current };
      // update cookie with anything new
      const merged = xcPickCookies(setCookies);
      cookie = merged || cookie;
      current = xcAbsUrl(loc, current);
      continue;
    }

    const merged = xcPickCookies(setCookies);
    cookie = merged || cookie;
    return { res, cookie, finalUrl: res.url || current };
  }

  const res = await fetch(current, {
    ...init,
    headers: { ...(init.headers || {}), "User-Agent": XC_UA, Cookie: cookie },
  });
  return { res, cookie, finalUrl: res.url || current };
}

function xcParseActionUrl(html, baseUrl) {
  // ưu tiên form id="frm_dngtgt"
  const m =
    html.match(/<form[^>]*\bid=["']frm_dngtgt["'][^>]*\baction=["']([^"']+)["']/i) ||
    html.match(/<form[^>]*\baction=["']([^"']+)["'][^>]*>/i);
  if (!m) return null;
  return xcAbsUrl(m[1], baseUrl);
}

function xcParseCaptchaImgUrl(html, baseUrl) {
  // tìm img có src chứa 'captcha'
  const m =
    html.match(/<img[^>]*\bsrc=["']([^"']*captcha[^"']*)["'][^>]*>/i) ||
    html.match(/<img[^>]*\bid=["']?imgCaptcha["']?[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
  if (!m) return null;
  return xcAbsUrl(m[1], baseUrl);
}

function xcParseCqtsFromHtml(html) {
  const selectMatch = html.match(/<select[^>]*\bid=["']cqt["'][\s\S]*?<\/select>/i);
  if (!selectMatch) return XC_CQT_OPTIONS;

  const block = selectMatch[0];
  const opts = [];
  const re = /<option[^>]*\bvalue=["']?([^"'\s>]*)["']?[^>]*>([\s\S]*?)<\/option>/gi;
  let mm;
  while ((mm = re.exec(block))) {
    const value = mm[1] || "";
    const label = xcNormalizeSpace(decodeHtml(stripTags(mm[2] || "")));
    if (label) opts.push({ value, label });
  }
  return opts.length ? opts : XC_CQT_OPTIONS;
}

function xcParseResultTable(html, baseUrl) {
  const tableMatch = html.match(/<table[^>]*class=["'][^"']*ta_border[^"']*["'][\s\S]*?<\/table>/i);
  if (!tableMatch) return { headers: [], rows: [], rawFound: false };

  const table = tableMatch[0];

  // headers
  const headerRow = table.match(/<tr[^>]*>[\s\S]*?<th[\s\S]*?<\/tr>/i);
  const headers = [];
  if (headerRow) {
    const thRe = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let h;
    while ((h = thRe.exec(headerRow[0]))) {
      headers.push(xcNormalizeSpace(decodeHtml(stripTags(h[1] || ""))));
    }
  }

  // rows
  const rows = [];
  const trRe = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(table))) {
    const rowHtml = tr[0];
    if (!/<td/i.test(rowHtml)) continue;

    const tds = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let td;
    let detailUrl = null;

    while ((td = tdRe.exec(rowHtml))) {
      const cellHtml = td[1] || "";

      // bắt link "Xem chi tiết"
      if (!detailUrl && /xem\s*chi\s*ti[eế]t/i.test(cellHtml)) {
        const a = cellHtml.match(/<a[^>]*\bhref=["']([^"']+)["']/i);
        if (a) detailUrl = xcAbsUrl(a[1], baseUrl);
      }

      // nếu cell là ảnh tick -> "X"
      let txt = "";
      if (/<img/i.test(cellHtml)) {
        // trang GDT hay dùng ảnh -> coi như "X"
        txt = "X";
      } else {
        txt = xcNormalizeSpace(decodeHtml(stripTags(cellHtml)));
      }
      tds.push(txt);
    }

    rows.push({ cells: tds, detailUrl });
  }

  return { headers, rows, rawFound: true };
}

function xcParseDetail(html, baseUrl) {
  // cố gắng lấy table dữ liệu chính
  const tableMatch = html.match(/<table[^>]*class=["'][^"']*ta_border[^"']*["'][\s\S]*?<\/table>/i);
  if (!tableMatch) {
    return {
      title: "Chi tiết",
      headers: [],
      rows: [],
      note: "Không tìm thấy bảng chi tiết trong HTML (có thể site thay đổi cấu trúc).",
    };
  }
  const { headers, rows } = xcParseResultTable(tableMatch[0], baseUrl);
  return { title: "Chi tiết", headers, rows: rows.map((r) => r.cells) };
}

// ---- handlers ----
async function handleXCCqts(request) {
  // trả list CQTS đầy đủ cho dropdown
  return jsonResponse({ ok: true, cqts: XC_CQT_OPTIONS });
}



async function handleXCDetail(request) {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, message: "Use POST" }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const { cookie, detailUrl } = body || {};

  const safeDetailUrl = parseAndAllowUrl(detailUrl, new Set(["www.gdt.gov.vn", "web.gdt.gov.vn", TAX_SITE_HOST]));
  if (!cookie || !safeDetailUrl) {
    return jsonResponse({ ok: false, message: "Thiếu cookie hoặc detailUrl không hợp lệ" }, 400);
  }

  const res = await fetch(safeDetailUrl.toString(), {
    headers: { "User-Agent": XC_UA, Cookie: cookie, Accept: "text/html" },
  });
  const html = await res.text();
  const detail = xcParseDetail(html, res.url || detailUrl);

  return jsonResponse({ ok: true, detail });
}

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

