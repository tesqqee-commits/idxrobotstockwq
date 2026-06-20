const { execFile } = require("node:child_process");

const IDX_URL = "https://www.idx.co.id/id/perusahaan-tercatat/keterbukaan-informasi";
const CURL_BIN = "curl";

module.exports = async function handler(req, res) {
  if (process.env.IDX_PROXY_TOKEN) {
    const token = req.headers["x-proxy-token"];
    if (token !== process.env.IDX_PROXY_TOKEN) {
      res.status(401).json({
        ok: false,
        error: "Unauthorized"
      });
      return;
    }
  }

  const target = req.query.url || IDX_URL;

  if (target !== IDX_URL) {
    res.status(400).json({
      ok: false,
      error: "Unsupported url"
    });
    return;
  }

  try {
    const html = await fetchWithCurl(target);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(html);
  } catch (curlError) {
    try {
      const html = await fetchWithNode(target);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-IDX-Fetcher", "node-fetch");
      res.status(200).send(html);
    } catch (fetchError) {
      res.status(502).json({
        ok: false,
        error: "curl: " + curlError.message + " | fetch: " + fetchError.message
      });
    }
  }
};

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

async function fetchWithNode(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Referer": "https://www.idx.co.id/"
    }
  });

  if (!response.ok) {
    throw new Error("HTTP " + response.status);
  }

  return await response.text();
}
