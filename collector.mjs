import dns from "node:dns";
import { config } from "./config.mjs";
import { sleep } from "./utils.mjs";

dns.setDefaultResultOrder("ipv4first");

const DEFAULT_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "vi-VN,vi;q=0.9,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
};

function cookiePairsFromResponse(headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  return values.map((x) => String(x).split(";")[0].trim()).filter(Boolean);
}

function mergeCookies(oldCookie = "", pairs = []) {
  const jar = new Map();
  for (const part of String(oldCookie).split(";")) {
    const p = part.trim();
    const idx = p.indexOf("=");
    if (idx > 0) jar.set(p.slice(0, idx), p.slice(idx + 1));
  }
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export async function fetchTextDetailed(url, options = {}) {
  const attempts = Math.max(1, Number(options.retries ?? config.requestRetries) + 1);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || config.requestTimeoutMs));
    try {
      const headers = new Headers({ ...DEFAULT_HEADERS, ...(options.headers || {}) });
      if (options.cookie) headers.set("cookie", options.cookie);
      const response = await fetch(url, {
        method: options.method || "GET",
        headers,
        body: options.body,
        redirect: "follow",
        signal: controller.signal,
      });
      const text = await response.text();
      const cookie = mergeCookies(options.cookie, cookiePairsFromResponse(response.headers));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} tại ${response.url || url}`);
      }
      if (!text || text.length < 100) {
        throw new Error(`Phản hồi quá ngắn (${text.length} byte) tại ${response.url || url}`);
      }
      return {
        text,
        url: response.url || url,
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        cookie,
      };
    } catch (error) {
      lastError = error?.name === "AbortError"
        ? new Error(`Timeout ${options.timeoutMs || config.requestTimeoutMs}ms tại ${url}`)
        : error;
      if (attempt < attempts) await sleep(Math.min(4000, 500 * 2 ** (attempt - 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error(`Không tải được ${url}`);
}

function candidateUrls(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    const list = [pathOrUrl];
    try {
      const u = new URL(pathOrUrl);
      if (u.hostname === "nghean.gdt.gov.vn") {
        const other = new URL(pathOrUrl);
        other.protocol = u.protocol === "http:" ? "https:" : "http:";
        list.push(other.toString());
      }
    } catch {}
    return [...new Set(list)];
  }
  const path = String(pathOrUrl).startsWith("/") ? String(pathOrUrl) : `/${pathOrUrl}`;
  return config.sourceBases.map((base) => `${base}${path}`);
}

export async function fetchFromCandidates(pathOrUrl, options = {}) {
  const errors = [];
  for (const url of candidateUrls(pathOrUrl)) {
    try {
      return await fetchTextDetailed(url, options);
    } catch (error) {
      errors.push(`${url}: ${error?.message || error}`);
    }
  }
  throw new Error(errors.join(" | "));
}
