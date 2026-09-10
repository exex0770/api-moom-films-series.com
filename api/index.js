const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.end(typeof data === "string" ? data : JSON.stringify(data));
}

function getFiles(type) {
  const dir = path.join(DATA_DIR, type);

  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
    .filter(file => file.toLowerCase().endsWith(".m3u"));
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line.startsWith("#EXTINF")) {
      continue;
    }

    const comma = line.indexOf(",");
    const title = comma >= 0
      ? line.substring(comma + 1).trim()
      : "";

    const getAttr = (name) => {
      const regex = new RegExp(name + '="([^"]*)"', "i");
      const match = line.match(regex);
      return match ? match[1] : "";
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

    result.push({
      name: getAttr("tvg-name") || title,
      title: title,
      logo: getAttr("tvg-logo"),
      group: getAttr("group-title"),
      tvg_id: getAttr("tvg-id"),
      url: url
    });
  }

  return result;
}

function getCategories(type) {
  const files = getFiles(type);

  return files.map(file => {
    const fullPath = path.join(DATA_DIR, type, file);
    const text = fs.readFileSync(fullPath, "utf8");
    const items = parseM3U(text);

    return {
      id: file.replace(/\.m3u$/i, ""),
      name: items[0]?.group || file.replace(/\.m3u$/i, ""),
      count: items.length,
      api: `/api/${type}/${encodeURIComponent(
        file.replace(/\.m3u$/i, "")
      )}`,
      m3u: `/api/${type}/${encodeURIComponent(file)}`
    };
  });
}

module.exports = (req, res) => {
  try {
    const url = (req.url || "").split("?")[0];

    // الصفحة الرئيسية
    if (url === "/api" || url === "/api/") {
      return send(res, 200, {
        status: "ok",
        name: "MOOM Films & Series API",
        movies: "/api/movies",
        series: "/api/series"
      });
    }

    // أقسام الأفلام
    if (url === "/api/movies") {
      return send(res, 200, {
        type: "movies",
        categories: getCategories("movies")
      });
    }

    // أقسام المسلسلات
    if (url === "/api/series") {
      return send(res, 200, {
        type: "series",
        categories: getCategories("series")
      });
    }

    // قسم محدد
    const match = url.match(
      /^\/api\/(movies|series)\/(.+)$/
    );

    if (match) {
      const type = match[1];
      let category = decodeURIComponent(match[2]);

      const isM3U = category.toLowerCase().endsWith(".m3u");

      if (isM3U) {
        category = category.substring(
          0,
          category.length - 4
        );
      }

      const file = category + ".m3u";
      const fullPath = path.join(
        DATA_DIR,
        type,
        file
      );

      if (!fs.existsSync(fullPath)) {
        return send(res, 404, {
          error: "Category not found",
          category: category
        });
      }

      const text = fs.readFileSync(
        fullPath,
        "utf8"
      );

      // طلب M3U مباشر
      if (isM3U) {
        return send(
          res,
          200,
          text,
          "audio/x-mpegurl; charset=utf-8"
        );
      }

      // طلب JSON
      return send(res, 200, {
        type: type,
        category: category,
        count: parseM3U(text).length,
        items: parseM3U(text)
      });
    }

    return send(res, 404, {
      error: "Not found"
    });

  } catch (error) {
    console.error(error);

    return send(res, 500, {
      error: "Internal Server Error",
      message: error.message
    });
  }
};
