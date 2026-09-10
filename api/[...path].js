const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const TYPES = new Set(["movies", "series"]);

function send(res, status, body, contentType = "application/json; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const items = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.toUpperCase().startsWith("#EXTINF")) continue;

    const comma = line.indexOf(",");
    const title = comma >= 0 ? line.slice(comma + 1).trim() : "";

    const attr = (name) => {
      const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '="([^"]*)"', "i");
      const m = line.match(re);
      return m ? m[1] : "";
    };

    let url = "";
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) continue;
      if (!next.startsWith("#")) {
        url = next;
        i = j;
        break;
      }
    }

    if (!url) continue;

    items.push({
      name: attr("tvg-name") || title,
      title,
      logo: attr("tvg-logo"),
      group: attr("group-title"),
      tvg_id: attr("tvg-id"),
      url
    });
  }
  return items;
}

function filesFor(type) {
  const dir = path.join(DATA_DIR, type);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith(".m3u"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function fileFor(type, category) {
  const wanted = category.toLowerCase().endsWith(".m3u")
    ? category.slice(0, -4)
    : category;

  const found = filesFor(type).find(
    f => f.slice(0, -4).toLowerCase() === wanted.toLowerCase()
  );
  return found ? path.join(DATA_DIR, type, found) : null;
}

function categoryId(filename) {
  return filename.slice(0, -4);
}

function categoryInfo(type, filename) {
  const full = path.join(DATA_DIR, type, filename);
  let count = 0;
  let name = categoryId(filename);

  try {
    const items = parseM3U(fs.readFileSync(full, "utf8"));
    count = items.length;
    const groups = [...new Set(items.map(x => x.group).filter(Boolean))];
    if (groups.length === 1) name = groups[0];
  } catch (_) {}

  const id = categoryId(filename);
  return {
    id,
    name,
    count,
    api: `/api/${type}/${encodeURIComponent(id)}`,
    m3u: `/api/${type}/${encodeURIComponent(filename)}`
  };
}

function getRequestPath(req) {
  // Vercel catch-all functions expose the path as req.query.path.
  // req.url is kept as a fallback for local/other Node runtimes.
  if (req.query && req.query.path) {
    const raw = Array.isArray(req.query.path) ? req.query.path.join("/") : req.query.path;
    return "/" + String(raw).replace(/^\/+/, "");
  }

  const raw = String(req.url || "").split("?")[0];
  return raw.replace(/^\/+api\/?/, "/").replace(/^\/+/, "/");
}

module.exports = (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");

  if (req.method !== "GET") {
    return send(res, 405, { error: "Method Not Allowed" });
  }

  try {
    const requestPath = getRequestPath(req);
    const parts = requestPath.split("/").filter(Boolean).map(safeDecode);

    // GET /api
    if (parts.length === 0) {
      return send(res, 200, {
        status: "ok",
        name: "MOOM Films & Series API",
        version: "2.0.0",
        endpoints: {
          movies: "/api/movies",
          series: "/api/series",
          search: "/api/search?q=اسم"
        }
      });
    }

    // GET /api/movies or /api/series
    if (parts.length === 1 && TYPES.has(parts[0].toLowerCase())) {
      const type = parts[0].toLowerCase();
      const categories = filesFor(type).map(f => categoryInfo(type, f));
      return send(res, 200, {
        status: "ok",
        type,
        count: categories.length,
        categories
      });
    }

    // GET /api/movies/CATEGORY or /api/movies/CATEGORY.m3u
    if (parts.length >= 2 && TYPES.has(parts[0].toLowerCase())) {
      const type = parts[0].toLowerCase();
      const category = parts.slice(1).join("/");
      const isM3U = category.toLowerCase().endsWith(".m3u");
      const fullPath = fileFor(type, category);

      if (!fullPath) {
        return send(res, 404, {
          status: "error",
          error: "Category not found",
          type,
          category
        });
      }

      const text = fs.readFileSync(fullPath, "utf8");

      if (isM3U) {
        return send(res, 200, text, "application/vnd.apple.mpegurl; charset=utf-8");
      }

      const items = parseM3U(text);
      return send(res, 200, {
        status: "ok",
        type,
        category: categoryId(path.basename(fullPath)),
        count: items.length,
        items
      });
    }

    // GET /api/search?q=...
    if (parts[0].toLowerCase() === "search") {
      const q = String((req.query && (req.query.q || req.query.query)) || "").trim().toLowerCase();
      if (!q) return send(res, 400, { error: "Missing q parameter" });

      const results = [];
      for (const type of TYPES) {
        for (const filename of filesFor(type)) {
          const full = path.join(DATA_DIR, type, filename);
          let items = [];
          try { items = parseM3U(fs.readFileSync(full, "utf8")); } catch (_) {}
          for (const item of items) {
            const hay = `${item.name} ${item.title} ${item.group} ${item.tvg_id}`.toLowerCase();
            if (hay.includes(q)) {
              results.push({ type, category: categoryId(filename), ...item });
              if (results.length >= 200) break;
            }
          }
          if (results.length >= 200) break;
        }
        if (results.length >= 200) break;
      }
      return send(res, 200, { status: "ok", query: q, count: results.length, items: results });
    }

    return send(res, 404, { status: "error", error: "Not found", path: requestPath });
  } catch (error) {
    console.error(error);
    return send(res, 500, {
      status: "error",
      error: "Internal Server Error",
      message: error.message
    });
  }
};
