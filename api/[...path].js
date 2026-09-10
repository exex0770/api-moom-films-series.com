const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");

function send(res, status, data, contentType = "application/json; charset=utf-8") {
  res.status(status);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=60");
  res.end(typeof data === "string" ? data : JSON.stringify(data));
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const items = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line.startsWith("#EXTINF")) continue;

    const comma = line.indexOf(",");
    const title = comma >= 0 ? line.slice(comma + 1).trim() : "";

    function attr(name) {
      const match = line.match(
        new RegExp(name + '="([^"]*)"', "i")
      );
      return match ? match[1] : "";
    }

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
      title: title,
      logo: attr("tvg-logo"),
      group: attr("group-title"),
      tvg_id: attr("tvg-id"),
      url: url
    });
  }

  return items;
}

function getCategoryFiles(type) {
  const dir = path.join(DATA_DIR, type);

  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith(".m3u"));
}

function getCategory(type, category) {
  const files = getCategoryFiles(type);

  const file = files.find(
    f => f.replace(/\.m3u$/i, "") === category
  );

  if (!file) return null;

  return path.join(DATA_DIR, type, file);
}

module.exports = (req, res) => {
  try {
    let url = (req.url || "").split("?")[0];

    // إزالة /api من البداية
    if (url.startsWith("/api/")) {
      url = url.substring(5);
    } else if (url === "/api") {
      url = "";
    }

    const parts = url
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);

    // /api
    if (parts.length === 0) {
      return send(res, 200, {
        status: "ok",
        name: "MOOM Films & Series API",
        movies: "/api/movies",
        series: "/api/series"
      });
    }

    // /api/movies أو /api/series
    if (parts.length === 1 && (parts[0] === "movies" || parts[0] === "series")) {
      const type = parts[0];

      const categories = getCategoryFiles(type).map(file => {
        const id = file.replace(/\.m3u$/i, "");
        const fullPath = path.join(DATA_DIR, type, file);

        let count = 0;
        let name = id;

        try {
          const text = fs.readFileSync(fullPath, "utf8");
          const items = parseM3U(text);
          count = items.length;

          if (items[0]?.group) {
            name = items[0].group;
          }
        } catch (_) {}

        return {
          id,
          name,
          count,
          api: `/api/${type}/${encodeURIComponent(id)}`,
          m3u: `/api/${type}/${encodeURIComponent(file)}`
        };
      });

      return send(res, 200, {
        type,
        categories
      });
    }

    // /api/movies/CATEGORY
    // /api/series/CATEGORY
    if (parts.length >= 2 && (parts[0] === "movies" || parts[0] === "series")) {
      const type = parts[0];

      let category = parts.slice(1).join("/");

      const isM3U = category.toLowerCase().endsWith(".m3u");

      if (isM3U) {
        category = category.slice(0, -4);
      }

      const fullPath = getCategory(type, category);

      if (!fullPath) {
        return send(res, 404, {
          error: "Category not found",
          type,
          category
        });
      }

      const text = fs.readFileSync(fullPath, "utf8");

      // إذا طلب M3U
      if (isM3U) {
        return send(
          res,
          200,
          text,
          "application/vnd.apple.mpegurl; charset=utf-8"
        );
      }

      // JSON
      const items = parseM3U(text);

      return send(res, 200, {
        type,
        category,
        count: items.length,
        items
      });
    }

    return send(res, 404, {
      error: "Not found",
      path: url
    });

  } catch (error) {
    console.error(error);

    return send(res, 500, {
      error: "Internal Server Error",
      message: error.message
    });
  }
};
