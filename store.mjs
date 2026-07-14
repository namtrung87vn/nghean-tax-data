import { absoluteUrl, decodeHtml, safeDecodeURIComponent, sanitizeHtml, stripTags, uniqueBy } from "./utils.mjs";

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(['"])([\\s\\S]*?)\\1`, "i");
  return tag.match(re)?.[2] || "";
}

function contextAround(html, index, radius = 1400) {
  return html.slice(Math.max(0, index - radius), Math.min(html.length, index + radius));
}

export function parseNews(html, baseUrl, tab, marker) {
  const items = [];
  const anchorRe = /<a\b[^>]*href\s*=\s*(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  const badImage = /(?:banner|logo|home\.|blank\.|favicon|loading|icon|sub_banner|spacer|pixel|thuevietnam|tracuuthongtin)/i;
  let m;
  while ((m = anchorRe.exec(html))) {
    const rawHref = decodeHtml(m[2]).replace(/&amp;/g, "&");
    const decodedHref = safeDecodeURIComponent(rawHref).toLowerCase();
    const wanted = marker
      ? decodedHref.includes(`/news/${marker}/`) || decodedHref.includes(`/site/news/${marker}/`)
      : decodedHref.includes("/site/news/");
    if (!wanted) continue;
    const title = stripTags(m[3]);
    if (!title || title.length < 8 || /^xem (thêm|chi tiết)$/i.test(title)) continue;

    const start = Math.max(0, m.index - 1500);
    const end = Math.min(html.length, anchorRe.lastIndex + 3000);
    const ctx = html.slice(start, end);
    const localAnchorIndex = m.index - start;

    let date = "";
    const afterAnchor = ctx.slice(localAnchorIndex);
    const beforeAnchor = ctx.slice(0, localAnchorIndex);
    date = afterAnchor.match(/\(?\b(\d{2}\/\d{2}\/\d{4})\b\)?/)?.[1]
      || beforeAnchor.match(/\(?\b(\d{2}\/\d{2}\/\d{4})\b\)?(?![\s\S]*\d{2}\/\d{2}\/\d{4})/)?.[1]
      || "";

    let imageUrl = "";
    let bestScore = Number.POSITIVE_INFINITY;
    const imgRe = /<img\b[^>]*src\s*=\s*(['"])(.*?)\1[^>]*>/gi;
    let im;
    while ((im = imgRe.exec(ctx))) {
      const src = decodeHtml(im[2]);
      if (!src || badImage.test(src)) continue;
      const distance = Math.abs(im.index - localAnchorIndex);
      const directionPenalty = im.index > localAnchorIndex + 1500 ? 1000 : 0;
      const score = distance + directionPenalty;
      if (score < bestScore) {
        bestScore = score;
        imageUrl = absoluteUrl(baseUrl, src);
      }
    }

    let summary = "";
    const summaryArea = ctx.slice(localAnchorIndex, Math.min(ctx.length, localAnchorIndex + 2600));
    const paragraphs = [...summaryArea.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((x) => stripTags(x[1]))
      .filter((x) => x.length >= 35 && x.length <= 1200 && x !== title);
    if (paragraphs.length) summary = paragraphs[0];

    items.push({
      tab,
      title,
      url: absoluteUrl(baseUrl, rawHref),
      date,
      imageUrl,
      summary,
    });
  }
  return uniqueBy(items, (x) => x.url);
}

export function parsePageLinks(html, baseUrl, maxPages = 10) {
  const found = new Map();
  const aRe = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  let m;
  while ((m = aRe.exec(html))) {
    const tag = m[0];
    const href = attr(tag, "href");
    if (!href) continue;
    const id = attr(tag, "id");
    let page = Number(id.match(/linkToPage_(\d+)/i)?.[1]);
    if (!page) page = Number(stripTags(tag).match(/^\s*(\d+)\s*$/)?.[1]);
    if (!page || page < 2 || page > maxPages) continue;
    found.set(page, absoluteUrl(baseUrl, href));
  }
  return found;
}

export function parseDocuments(html, baseUrl, tab) {
  const table = html.match(/<table\b[^>]*class\s*=\s*(['"])[^'"]*ta_border[^'"]*\1[^>]*>[\s\S]*?<\/table>/i)?.[0] || "";
  if (!table) return [];
  const rows = table.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  const items = [];
  for (const row of rows) {
    if (/Số\s*hiệu\s*văn\s*bản/i.test(stripTags(row))) continue;
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((x) => x[1]);
    if (cells.length < 4) continue;
    const code = stripTags(cells[1]);
    const date = stripTags(cells[2]);
    const titleCell = cells[3];
    const title = stripTags(titleCell.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || titleCell.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] || titleCell);
    const href = titleCell.match(/<a\b[^>]*href\s*=\s*(['"])(.*?)\1[^>]*>[\s\S]*?(?:Thông tin văn bản|Chi tiết)[\s\S]*?<\/a>/i)?.[2]
      || titleCell.match(/<a\b[^>]*href\s*=\s*(['"])(.*?)\1/i)?.[2]
      || "";
    if (!title || title.length < 5) continue;
    items.push({ tab, title, date, code, viewUrl: href ? absoluteUrl(baseUrl, href) : "" });
  }
  return uniqueBy(items, (x) => `${x.code}|${x.date}|${x.title}`);
}

export function parseSearchFormAction(html, baseUrl) {
  const forms = html.match(/<form\b[^>]*>/gi) || [];
  for (const tag of forms) {
    const name = attr(tag, "name");
    const id = attr(tag, "id");
    if (!/searchvbpq/i.test(name) && !/searchvbpq/i.test(id)) continue;
    const action = attr(tag, "action");
    if (action) return absoluteUrl(baseUrl, action);
  }
  return "";
}

export function parseMaxPage(html, hardMax = 65) {
  let max = 1;
  for (const m of html.matchAll(/(?:gotoPage\s*\(|linkToPage_)(\d+)/gi)) {
    max = Math.max(max, Number(m[1]) || 1);
  }
  return Math.min(max, hardMax);
}

function parseCellLink(cell, baseUrl) {
  const a = cell.match(/<a\b[^>]*href\s*=\s*(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i);
  return {
    text: stripTags(a?.[3] || cell) || "-",
    url: a?.[2] ? absoluteUrl(baseUrl, a[2]) : "",
  };
}

function parseLinks(cell, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(cell || ""))) {
    const text = stripTags(m[3]);
    const url = absoluteUrl(baseUrl, m[2]);
    if (text || url) out.push({ text: text || "Tải văn bản", url });
  }
  return uniqueBy(out, (x) => `${x.text}|${x.url}`);
}

export function parseTthc(html, baseUrl) {
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) || [];
  const items = [];
  let runningIndex = 0;

  for (const table of tables) {
    const plain = stripTags(table);
    if (!/ta_border/i.test(table) || !/Tên thủ tục hành chính|Cơ quan thực hiện/i.test(plain)) continue;

    const tableIndex = html.indexOf(table);
    const before = html.slice(Math.max(0, tableIndex - 3000), tableIndex);
    const headings = [...before.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
    const group = stripTags(headings.at(-1)?.[1] || "") || "Thủ tục hành chính";
    const rows = table.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];

    for (const row of rows) {
      if (/<th\b/i.test(row)) continue;
      const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1]);
      if (cells.length < 5) continue;
      const stt = stripTags(cells[0]);
      if (!/^\d+$/.test(stt)) continue;
      const a = cells[1].match(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i);
      const title = stripTags(a?.[3] || cells[1]);
      if (!title) continue;

      const vbqdDocs = parseLinks(cells[3], baseUrl);
      const qdcbDocs = parseLinks(cells[4], baseUrl);
      runningIndex += 1;
      items.push({
        id: `tthc-${runningIndex}`,
        stt,
        group,
        title,
        link: a?.[2] ? absoluteUrl(baseUrl, a[2]) : "",
        agency: stripTags(cells[2]) || "-",
        vbqdDocs,
        qdcbDocs,
        vbqdText: vbqdDocs.map((x) => x.text).join(", ") || "-",
        vbqdUrl: vbqdDocs[0]?.url || "",
        qdcbText: qdcbDocs.map((x) => x.text).join(", ") || "-",
        qdcbUrl: qdcbDocs[0]?.url || "",
      });
    }
  }

  return uniqueBy(items, (x) => x.link || `${x.group}|${x.stt}|${x.title}`);
}

export function findViewAllUrls(html, baseUrl) {
  const out = [];
  const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const tag of anchors) {
    const text = stripTags(tag).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    if (!text.includes("xem") || !text.includes("toan bo") || (!text.includes("danh sach") && !text.includes("thu tuc"))) continue;
    const href = attr(tag, "href");
    if (href) out.push(absoluteUrl(baseUrl, href));
  }
  return uniqueBy(out, (x) => x);
}

export function findViewAllUrl(html, baseUrl) {
  return findViewAllUrls(html, baseUrl)[0] || "";
}

export function parsePaginationUrls(html, baseUrl, maxItems = 100) {
  const out = [];
  const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  for (const tag of anchors) {
    const id = attr(tag, "id");
    const title = attr(tag, "title");
    const text = stripTags(tag);
    const isPager = /(?:linkToPage_\d+|_nextPage|_lastPage)/i.test(id)
      || /link to (?:page|next page|last page)/i.test(title)
      || (/^\d+$/.test(text) && /class\s*=\s*(["'])[^"']*page/i.test(contextAround(html, html.indexOf(tag), 500)));
    if (!isPager) continue;
    const href = attr(tag, "href");
    if (href) out.push(absoluteUrl(baseUrl, href));
    if (out.length >= maxItems) break;
  }
  return uniqueBy(out, (x) => x);
}

export function extractFeedbackHtml(html, baseUrl) {
  const content = html.match(/<div\b[^>]*id\s*=\s*(['"])contentBody\1[^>]*>([\s\S]*?)<\/div>/i)?.[2]
    || html.match(/<div\b[^>]*class\s*=\s*(['"])[^'"]*wpsPortletBody[^'"]*\1[^>]*>([\s\S]*?)<\/div>/i)?.[2]
    || html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    || "";
  return sanitizeHtml(content, baseUrl);
}

export function parseVideos(html, baseUrl) {
  const items = [];
  const liList = html.match(/<li\b[\s\S]*?<\/li>/gi) || [];
  for (const li of liList) {
    if (!/playClip\s*\(|jwplayer\s*\(.*?\)\.load\s*\(/i.test(li)) continue;
    const title = stripTags(li.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "");
    if (!title) continue;
    const date = li.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)?.[1] || "";
    const img = li.match(/<img\b[^>]*src\s*=\s*(['"])(.*?)\1/i)?.[2] || "";
    const decoded = decodeHtml(li);
    const video = decoded.match(/playClip\s*\(\s*'([^']*)'/i)?.[1]
      || decoded.match(/\.load\s*\(\s*'([^']*)'\s*\)/i)?.[1]
      || "";
    items.push({
      title,
      date,
      videoUrl: video ? absoluteUrl(baseUrl, video) : "",
      thumb: img ? absoluteUrl(baseUrl, img) : "",
      thumbUrl: img ? absoluteUrl(baseUrl, img) : "",
      playable: Boolean(video),
    });
  }
  return uniqueBy(items, (x) => `${x.title}|${x.videoUrl}`);
}

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
  dsnnrrcvt: "Danh sách doanh nghiệp rủi ro cao về thuế",
  dngtgt: "Danh sách địa điểm bán hàng hoàn thuế GTGT",
  vbhd: "Văn bản, hướng dẫn chung về chính sách thuế mới",
};

export function parseDvc(html, baseUrl) {
  const items = [];
  const re = /<a\b[^>]*href\s*=\s*(['"])(.*?)\1[^>]*>[\s\S]*?<img\b[^>]*src\s*=\s*(['"])(.*?)\3[^>]*>[\s\S]*?<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = decodeHtml(m[2]);
    const src = decodeHtml(m[4]);
    const filename = src.split("?")[0].split("/").pop()?.replace(/\.(gif|png|jpe?g|webp)$/i, "").toLowerCase() || "";
    const title = DVC_TITLE_MAP[filename];
    if (!title) continue;
    items.push({ id: `dvc-${items.length + 1}`, title, url: absoluteUrl(baseUrl, href), imageUrl: absoluteUrl(baseUrl, src), rawImageUrl: absoluteUrl(baseUrl, src) });
  }
  return uniqueBy(items, (x) => x.url);
}

export function parseDnrrvt(html, baseUrl) {
  const table = html.match(/<table\b[^>]*class\s*=\s*(['"])[^'"]*ta_border[^'"]*\1[^>]*>[\s\S]*?<\/table>/i)?.[0] || "";
  if (!table) return [];
  const rows = table.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  const items = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((x) => x[1]);
    if (cells.length < 5) continue;
    const text = stripTags(row).toLowerCase();
    if (text.includes("ngày quyết định") && text.includes("số quyết định")) continue;
    const ngayQd = stripTags(cells[0]);
    const soQd = stripTags(cells[1]);
    const coQuan = stripTags(cells[2]);
    if (!ngayQd && !soQd) continue;
    const qdHref = cells[3].match(/href\s*=\s*(['"])(.*?)\1/i)?.[2] || "";
    const dsHref = cells[4].match(/href\s*=\s*(['"])(.*?)\1/i)?.[2] || "";
    items.push({ ngayQd, soQd, coQuan, qdFileUrl: qdHref ? absoluteUrl(baseUrl, qdHref) : "", dsDnFileUrl: dsHref ? absoluteUrl(baseUrl, dsHref) : "" });
  }
  return uniqueBy(items, (x) => `${x.soQd}|${x.ngayQd}|${x.coQuan}`);
}
