const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const IDX_DISCLOSURE_URL = "https://www.idx.co.id/id/perusahaan-tercatat/keterbukaan-informasi";
const IDX_LOOKBACK_HOURS = Number(process.env.IDX_LOOKBACK_HOURS || 2);
const MAX_SEND_PER_RUN = Number(process.env.MAX_IDX_SEND_PER_RUN || 5);
const STATE_FILE = process.env.IDX_STATE_FILE || path.join(__dirname, "idx-sent.json");
const CURL_BIN = process.platform === "win32" ? "curl.exe" : "curl";

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  requireEnv("TELEGRAM_BOT_TOKEN");
  requireEnv("TELEGRAM_CHAT_ID");

  const testMode = process.argv.includes("--test");
  const html = await fetchWithCurl(IDX_DISCLOSURE_URL);
  let items = parseIdxDisclosures(html);

  if (!testMode) {
    const cutoffTime = Date.now() - IDX_LOOKBACK_HOURS * 60 * 60 * 1000;
    items = items.filter(item => item.timestamp >= cutoffTime);
  }

  const sentKeys = testMode ? new Set() : loadSentKeys();
  let sent = 0;

  for (const item of items) {
    if (sent >= MAX_SEND_PER_RUN) break;

    const key = item.idx_id || item.link;
    if (!testMode && sentKeys.has(key)) continue;

    await sendTelegram(item);
    sentKeys.add(key);
    sent++;

    console.log("sent:", item.title);
  }

  if (!testMode) {
    saveSentKeys(sentKeys);
  }

  console.log(JSON.stringify({
    ok: true,
    checked_items: items.length,
    sent: sent,
    test_mode: testMode
  }));
}

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error("Missing environment variable: " + name);
  }
}

function fetchWithCurl(url) {
  return new Promise((resolve, reject) => {
    execFile(
      CURL_BIN,
      [
        "-L",
        "--fail",
        "--silent",
        "--show-error",
        "-A",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        url
      ],
      { maxBuffer: 1024 * 1024 * 4 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        resolve(stdout);
      }
    );
  });
}

function loadSentKeys() {
  try {
    return new Set(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")));
  } catch {
    return new Set();
  }
}

function saveSentKeys(sentKeys) {
  const keys = [...sentKeys].slice(-1000);
  fs.writeFileSync(STATE_FILE, JSON.stringify(keys, null, 2));
}

async function sendTelegram(item) {
  const caption = [
    item.source,
    "",
    item.title,
    "",
    item.link
  ].join("\n");

  if (isPdfUrl(item.link)) {
    const result = await telegramRequest("sendDocument", {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      document: item.link,
      caption: caption.slice(0, 1024)
    });

    if (result.ok) return;
    console.log("sendDocument fallback:", JSON.stringify(result));
  }

  const result = await telegramRequest("sendMessage", {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: caption,
    disable_web_page_preview: false
  });

  if (!result.ok) {
    throw new Error("Telegram error: " + JSON.stringify(result));
  }
}

async function telegramRequest(method, body) {
  const url = "https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN + "/" + method;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return await res.json();
}

function parseIdxDisclosures(html) {
  const script = getNuxtScript(html);
  if (!script) return [];

  const values = getNuxtValues(script);
  const disclosureArray = extractJsArray(script, "Disclosure");
  if (!disclosureArray) return [];

  return splitTopLevelObjects(disclosureArray.slice(1, -1))
    .map(block => parseIdxDisclosureBlock(block, values))
    .filter(Boolean)
    .sort((a, b) => b.timestamp - a.timestamp);
}

function getNuxtScript(html) {
  const match = String(html || "").match(/<script>window\.__NUXT__=([\s\S]*?)<\/script>/);
  return match ? "window.__NUXT__=" + match[1] : "";
}

function getNuxtValues(script) {
  const paramsMatch = script.match(/window\.__NUXT__=\(function\(([^)]*)\)/);
  const argsStart = script.lastIndexOf("}(");
  const argsEnd = script.lastIndexOf("));");

  if (!paramsMatch || argsStart === -1 || argsEnd === -1 || argsEnd <= argsStart) {
    return {};
  }

  const params = paramsMatch[1].split(",").map(value => value.trim());
  const args = splitTopLevel(script.slice(argsStart + 2, argsEnd));
  const values = {};

  for (let i = 0; i < params.length; i++) {
    values[params[i]] = parseJsAtom(args[i], {});
  }

  return values;
}

function extractJsArray(script, key) {
  const start = script.indexOf(key + ":[");
  if (start === -1) return "";

  const arrayStart = script.indexOf("[", start);
  if (arrayStart === -1) return "";

  const arrayEnd = findMatching(script, arrayStart, "[", "]");
  return arrayEnd === -1 ? "" : script.slice(arrayStart, arrayEnd + 1);
}

function parseIdxDisclosureBlock(block, values) {
  const title = resolveJsValue(getObjectValue(block, "JudulPengumuman"), values);
  const issuer = resolveJsValue(getObjectValue(block, "Kode_Emiten"), values).trim();
  const announcedAt = resolveJsValue(getObjectValue(block, "TglPengumuman"), values);
  const createdAt = resolveJsValue(getObjectValue(block, "CreatedDate"), values);
  const number = resolveJsValue(getObjectValue(block, "NoPengumuman"), values);
  const id = resolveJsValue(getObjectValue(block, "Id2"), values);
  const link = normalizeIdxLink(resolveJsValue(getObjectValue(block, "FullSavePath"), values)) || IDX_DISCLOSURE_URL;
  const timestamp = parseIdxTimestamp(announcedAt || createdAt);
  const titleParts = [];

  if (issuer) titleParts.push(issuer);
  if (title) titleParts.push(title);
  if (!titleParts.length || !link) return null;

  return {
    source: "IDX Keterbukaan Informasi",
    title: titleParts.join(" - "),
    link: link,
    timestamp: timestamp,
    published_at: new Date(timestamp).toISOString(),
    idx_id: id,
    idx_number: number
  };
}

function parseIdxTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return Date.now();

  const normalized = /\dT\d/.test(text) && !/(Z|[+-]\d\d:?\d\d)$/.test(text)
    ? text + "+07:00"
    : text;

  return Date.parse(normalized) || Date.now();
}

function normalizeIdxLink(value) {
  const link = String(value || "").trim();
  if (!link) return "";
  if (/^https?:\/\//i.test(link)) return link;
  if (link.startsWith("//")) return "https:" + link;
  if (link.startsWith("/")) return "https://www.idx.co.id" + link;

  return "https://www.idx.co.id/" + link;
}

function getObjectValue(block, key) {
  const index = block.indexOf(key + ":");
  if (index === -1) return "";

  let start = index + key.length + 1;
  while (/\s/.test(block[start] || "")) start++;

  if (block[start] === "\"") {
    const end = findStringEnd(block, start);
    return end === -1 ? "" : block.slice(start, end + 1);
  }

  let end = start;
  while (end < block.length && !/[,\]}]/.test(block[end])) end++;

  return block.slice(start, end).trim();
}

function resolveJsValue(raw, values) {
  const value = parseJsAtom(raw, values);
  return value == null ? "" : String(value);
}

function parseJsAtom(raw, values) {
  const value = String(raw || "").trim();
  if (!value) return "";

  if (value[0] === "\"") {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }

  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (Object.prototype.hasOwnProperty.call(values, value)) return values[value];

  return value;
}

function splitTopLevelObjects(value) {
  return splitTopLevel(value).filter(part => part.trim().startsWith("{"));
}

function splitTopLevel(value) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = "";

  for (let i = 0; i < value.length; i++) {
    const char = value[i];

    if (quote) {
      if (char === "\\" && i + 1 < value.length) {
        i++;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === "{" || char === "[") {
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
    } else if (char === "," && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }

  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function findMatching(value, start, open, close) {
  let depth = 0;
  let quote = "";

  for (let i = start; i < value.length; i++) {
    const char = value[i];

    if (quote) {
      if (char === "\\" && i + 1 < value.length) {
        i++;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === open) {
      depth++;
    } else if (char === close) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function findStringEnd(value, start) {
  for (let i = start + 1; i < value.length; i++) {
    if (value[i] === "\\" && i + 1 < value.length) {
      i++;
    } else if (value[i] === "\"") {
      return i;
    }
  }

  return -1;
}

function isPdfUrl(value) {
  return /\.pdf($|[?#])/i.test(String(value || ""));
}
