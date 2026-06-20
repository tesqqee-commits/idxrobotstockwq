const { execFile } = require("node:child_process");

const IDX_URL = "https://www.idx.co.id/id/perusahaan-tercatat/keterbukaan-informasi";
const CURL_BIN = "curl";

exports.handler = async event => {
  if (process.env.IDX_PROXY_TOKEN) {
    const token = event.headers["x-proxy-token"] || event.headers["X-Proxy-Token"];
    if (token !== process.env.IDX_PROXY_TOKEN) {
      return json(401, {
        ok: false,
        error: "Unauthorized"
      });
    }
  }

  const target = event.queryStringParameters && event.queryStringParameters.url || IDX_URL;

  if (target !== IDX_URL) {
    return json(400, {
      ok: false,
      error: "Unsupported url"
    });
  }

  try {
    const html = await fetchWithCurl(target);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: html
    };
  } catch (curlError) {
    try {
      const html = await fetchWithNode(target);

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-IDX-Fetcher": "node-fetch"
        },
        body: html
      };
    } catch (fetchError) {
      return json(502, {
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
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Referer": "https://www.idx.co.id/"
    }
  });

  if (!res.ok) {
    throw new Error("HTTP " + res.status);
  }

  return await res.text();
}

function json(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
}
