// 1メッセージでプレビューするURLの上限（Chatの応答期限30秒に収めるため）
const MAX_PREVIEWS = 5;
const MAX_TEXT_LENGTH = 1000;
const MAX_DESCRIPTION_LENGTH = 300;

const URL_PATTERN = /https?:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]+/g;

// プレビューしないホスト（Google Chatが自前で展開するもの）
const SKIP_HOSTS = [/(^|\.)google\.com$/];

// ページのHTMLからoEmbedを見つけられない、またはHTMLの取得が重いサイト
const OEMBED_PROVIDERS = [
  {
    // Gyazo TeamsのURLも公開URLの形にそろえて問い合わせる
    pattern: /^https?:\/\/(?:[a-zA-Z0-9-]+\.)?gyazo\.com\/([a-zA-Z0-9]+)/,
    endpoint: "https://api.gyazo.com/api/oembed",
    normalize: m => `https://gyazo.com/${m[1]}`
  },
  {
    pattern: /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/\w+\/status\/\d+/,
    endpoint: "https://publish.twitter.com/oembed",
    normalize: m => m[0]
  },
  {
    pattern: /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//,
    endpoint: "https://www.youtube.com/oembed",
    normalize: m => m.input
  }
];

function extractUrls(text) {
  return [...text.matchAll(URL_PATTERN)].map(m => m[0].replace(/[.,;:!?'"]+$/, ""));
}

function getHost(url) {
  const m = url.match(/^https?:\/\/([^/?#:]+)/i);
  return m ? m[1].toLowerCase() : "";
}

function isSkipped(url) {
  const host = getHost(url);
  return SKIP_HOSTS.some(p => p.test(host));
}

function decodeHtml(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—" };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] !== "#") return named[e.toLowerCase()] ?? all;
    const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function htmlToText(html) {
  return decodeHtml(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
}

function truncate(s, length) {
  return s.length > length ? s.slice(0, length) + "…" : s;
}

// Chatの画像はHTTPSでしか表示できないので、それ以外は捨てる
function resolveImageUrl(path, baseUrl) {
  if (!path) return "";
  if (/^https:\/\//i.test(path)) return path;
  if (path.startsWith("//")) return "https:" + path;
  if (path.startsWith("/") && /^https:/i.test(baseUrl)) return baseUrl.match(/^https:\/\/[^/?#]+/i)[0] + path;
  return "";
}

function getHeader(res, name) {
  const headers = res.getHeaders();
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : "";
}

function fetchUrl(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    return res.getResponseCode() === 200 ? res : null;
  } catch(e) {
    console.log("fetchUrl error:", url, e.toString());
    return null;
  }
}

function fetchJson(url) {
  const res = fetchUrl(url);
  if (!res) return null;
  try {
    return JSON.parse(res.getContentText());
  } catch(e) {
    return null;
  }
}

// Shift_JISなどUTF-8以外のページも読めるようにする
function readHtml(res, contentType) {
  const html = res.getContentText("UTF-8");
  const charset = (contentType.match(/charset=["']?([\w-]+)/i) || html.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  if (!charset || /^utf-?8$/i.test(charset)) return html;
  try {
    return res.getContentText(charset);
  } catch(e) {
    return html;
  }
}

function parseAttributes(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attrs[m[1].toLowerCase()] = decodeHtml(m[2] ?? m[3] ?? m[4]);
  }
  return attrs;
}

function parseHead(html) {
  const end = html.search(/<\/head>/i);
  const head = end >= 0 ? html.slice(0, end) : html;
  const meta = {};
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (key && attrs.content && !(key in meta)) meta[key] = attrs.content.trim();
  }
  const oembedLink = [...head.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => parseAttributes(tag))
    .find(attrs => /alternate/i.test(attrs.rel || "") && attrs.type === "application/json+oembed");
  const title = head.match(/<title[^>]*>([^<]*)/i);
  return { meta, oembedUrl: oembedLink?.href, title: title ? decodeHtml(title[1]).trim() : "" };
}

function previewFromOembed(json, url) {
  if (json.type === "photo" && json.url) {
    return { url, title: json.title || "", imageUrl: json.url };
  }
  // Xのoembedは本文をblockquoteの<p>に入れて返す
  const paragraph = (json.html || "").match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  const preview = {
    url,
    title: json.title || json.author_name || "",
    subtitle: (json.title && json.author_name) || json.provider_name,
    text: paragraph ? htmlToText(paragraph[1]) : "",
    imageUrl: resolveImageUrl(json.thumbnail_url, url)
  };
  return preview.title || preview.text ? preview : null;
}

function previewFromPage(url) {
  const res = fetchUrl(url);
  if (!res) return null;
  const contentType = getHeader(res, "Content-Type");
  if (/^image\//i.test(contentType)) {
    return /^https:/i.test(url) ? { url, title: "", imageUrl: url } : null;
  }
  if (!/html/i.test(contentType)) return null;

  const { meta, oembedUrl, title } = parseHead(readHtml(res, contentType));
  if (oembedUrl) {
    const json = fetchJson(oembedUrl);
    const preview = json && previewFromOembed(json, url);
    if (preview) return preview;
  }
  const preview = {
    url,
    title: meta["og:title"] || meta["twitter:title"] || title,
    subtitle: meta["og:site_name"] || getHost(url),
    text: truncate(meta["og:description"] || meta["twitter:description"] || meta["description"] || "", MAX_DESCRIPTION_LENGTH),
    imageUrl: resolveImageUrl(meta["og:image"] || meta["twitter:image"], url)
  };
  return preview.title || preview.text ? preview : null;
}

function buildPreview(url) {
  for (const provider of OEMBED_PROVIDERS) {
    const m = url.match(provider.pattern);
    if (!m) continue;
    const json = fetchJson(`${provider.endpoint}?format=json&url=${encodeURIComponent(provider.normalize(m))}`);
    const preview = json && previewFromOembed(json, url);
    if (preview) return preview;
    break;
  }
  return previewFromPage(url);
}

function buildCard(preview, index) {
  const widgets = [];
  if (preview.text) {
    widgets.push({ textParagraph: { text: escapeHtml(truncate(preview.text, MAX_TEXT_LENGTH)).replace(/\n/g, "<br>") } });
  }
  if (preview.imageUrl) {
    widgets.push({
      image: {
        imageUrl: preview.imageUrl,
        altText: preview.title || "preview",
        onClick: { openLink: { url: preview.url } }
      }
    });
  } else {
    // 画像が無いカードは押して開けないので、元ページへのボタンを付ける
    widgets.push({ buttonList: { buttons: [{ text: "開く", onClick: { openLink: { url: preview.url } } }] } });
  }

  const card = { sections: [{ widgets }] };
  if (preview.title) {
    card.header = { title: truncate(preview.title, 200), subtitle: preview.subtitle || "" };
  }
  return { cardId: `preview-${index}`, card };
}

// 呼び出したユーザーの権限でメッセージを作る
function createChatMessage(spaceName, message) {
  try {
    const url = `https://chat.googleapis.com/v1/${spaceName}/messages?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`;
    const res = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(message),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) return true;
    console.log("createChatMessage error:", res.getResponseCode(), res.getContentText());
  } catch(e) {
    console.log("createChatMessage error:", e.toString());
  }
  return false;
}

function postAdditionalCards(spaceName, cards) {
  createChatMessage(spaceName, { cardsV2: cards });
}

function textMessage(text) {
  return { hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text } } } } };
}

function onMessage(event) {
  const isSlashCommand = !!event.chat?.appCommandPayload;
  const payload = isSlashCommand
    ? event.chat.appCommandPayload
    : event.chat?.messagePayload;

  if (!payload?.message) {
    console.log("message not found");
    return {};
  }

  const message = payload.message;
  const space = payload.space;
  const text = message.text || "";
  const matchedUrl = message.matchedUrl?.url;

  // URLに含まれる@はメンションとみなさない
  const isMention = text.replace(URL_PATTERN, "").includes('@');
  const isLinkPreview = !!matchedUrl && !isSlashCommand && !isMention;

  // リンクプレビュー（URLのみ貼った場合）は、失敗しても何も返さない
  if (isLinkPreview && isSkipped(matchedUrl)) return {};

  // インラインで差し込むカードはmatchedUrlのものにするため先頭に置く
  const urls = [...new Set([matchedUrl, ...extractUrls(text)].filter(Boolean))]
    .filter(url => !isSkipped(url))
    .slice(0, MAX_PREVIEWS);

  if (!urls.length) return isLinkPreview ? {} : textMessage("URLを含めてください");

  // スラッシュコマンドの発言は本人とアプリにしか見えないので、本人の発言として投稿し直す
  const argumentText = (message.argumentText ?? text.replace(/^\/\S+/, "")).trim();
  const reposted = isSlashCommand && createChatMessage(space.name, {
    text: argumentText,
    thread: message.thread?.name ? { name: message.thread.name } : undefined
  });

  const previews = urls.map(buildPreview);
  const cards = previews.map((preview, i) => preview && buildCard(preview, i));

  // スラッシュコマンド、@メンション → 全部返す
  if (!isLinkPreview) {
    const available = cards.filter(Boolean);
    if (!available.length) return reposted ? {} : textMessage("プレビューを取得できませんでした");
    // 投稿し直せなかったときは、他の人にもURLが見えるようにカードに本文を添える
    const reply = isSlashCommand && !reposted ? { text: argumentText, cardsV2: available } : { cardsV2: available };
    return {
      hostAppDataAction: { chatDataAction: { createMessageAction: { message: reply } } }
    };
  }

  // リンクプレビュー：1枚目はインライン、2枚目以降は別送信
  const rest = cards.slice(1).filter(Boolean);
  if (rest.length) {
    postAdditionalCards(space.name, rest);
  }
  if (!cards[0]) return {};
  return {
    hostAppDataAction: { chatDataAction: { updateInlinePreviewAction: { cardsV2: [cards[0]] } } }
  };
}
