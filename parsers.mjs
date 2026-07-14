export function decodeHtml(input = "") {
  return String(input)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function stripTags(input = "") {
  return decodeHtml(String(input).replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function absoluteUrl(base, href = "") {
  try {
    return new URL(decodeHtml(href).replace(/&amp;/gi, "&"), base).toString();
  } catch {
    return decodeHtml(href);
  }
}

export function safeDecodeURIComponent(value = "") {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function uniqueBy(items, keyFn) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function paginate(items, page = 1, pageSize = 10) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.max(1, Math.min(100, Number(pageSize) || 10));
  const start = (safePage - 1) * safeSize;
  const list = Array.isArray(items) ? items : [];
  return {
    page: safePage,
    pageSize: safeSize,
    total: list.length,
    items: list.slice(start, start + safeSize),
    hasNext: start + safeSize < list.length,
  };
}

export function nowIso() {
  return new Date().toISOString();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeHtml(html = "", baseUrl = "") {
  let out = String(html || "");
  out = out.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style\b[\s\S]*?<\/style>/gi, "");
  out = out.replace(/\son\w+\s*=\s*(['"])[\s\S]*?\1/gi, "");
  out = out.replace(/\son\w+\s*=\s*[^\s>]+/gi, "");
  out = out.replace(/href\s*=\s*(['"])javascript:[\s\S]*?\1/gi, 'href="#"');
  out = out.replace(/href\s*=\s*(['"])(.*?)\1/gi, (_, q, href) => `href=${q}${absoluteUrl(baseUrl, href)}${q}`);
  out = out.replace(/src\s*=\s*(['"])(.*?)\1/gi, (_, q, src) => `src=${q}${absoluteUrl(baseUrl, src)}${q}`);
  return out.trim();
}
