const http = require("node:http");
const { execFile } = require("node:child_process");

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "0.0.0.0";
const IDX_URL = "https://www.idx.co.id/id/perusahaan-tercatat/keterbukaan-informasi";
const CURL_BIN = process.platform === "win32" ? "curl.exe" : "curl";

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
      {
        maxBuffer: 1024 * 1024 * 4
      },
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");

  if (url.pathname !== "/idx") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
    return;
  }

  try {
    const target = url.searchParams.get("url") || IDX_URL;

    if (target !== IDX_URL) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Unsupported url" }));
      return;
    }

    const html = await fetchWithCurl(target);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(html);
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log("IDX proxy listening on http://" + HOST + ":" + PORT + "/idx");
});
