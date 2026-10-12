// A static file server plus two tiny JSON routes standing in for the
// `getCrewFile`/`apply` RPCs — no framework, no plugin host, same spirit as
// bb-canvas/e2e/serve.mjs. The crew file lives in memory only, seeded from
// fixture.yaml at startup; nothing here writes back to the repo.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

let yaml = await readFile(join(root, "fixture.yaml"), "utf8");

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  if (path === "/api/crew" && req.method === "GET") return send(res, 200, { yaml });
  if (path === "/api/apply" && req.method === "POST") {
    const body = await readBody(req);
    yaml = body.yaml;
    return send(res, 200, { results: [] });
  }

  const filePath = path === "/" ? "/index.html" : path;
  try {
    const content = await readFile(join(root, filePath));
    res.writeHead(200, { "content-type": TYPES[extname(filePath)] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(4174, "127.0.0.1", () => {
  console.log("e2e fixture server on http://127.0.0.1:4174");
});
