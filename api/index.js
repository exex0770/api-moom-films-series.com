Enterconst fs = require("fs");
const path = require("path");

const ROOT = path.join(process.cwd(), "data");

function send(res, status, body, type="application/json; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function safeType(t) {
  return t === "series" ? "series" : "movies";
}

function files(type) {
  const dir = path.join(ROOT, safeType(type));
  try { return fs.readdirSync(dir).filter(x => x.toLowerCase().endsWith(".m3u")); }
  catch { return []; }
}

function readFile(type, file) {
  const p = path.join(ROOT, safeType(type), file);
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

function attrs(line) {
  const a={}; let m;
  const re=/([\w-]+)="([^"]*)"/g;
  while((m=re.exec(line))) a[m[1]]=m[2];
  return a;
}

function parse(text) {
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/), out=[];
  for(let i=0;i<lines.length;i++){
    const l=lines[i].trim();
    if(!l.startsWith("#EXTINF")) continue;
    const k=l.indexOf(",");
    const title=k>=0?l.slice(k+1).trim():"";
    let url="";
    for(let j=i+1;j<lines.length;j++){
      const n=lines[j].trim();
      if(!n) continue;
      if(!n.startsWith("#")){ url=n; i=j; break; }
    }
    const a=attrs(l);
    out.push({
      name:a["tvg-name"]||title, title, url,
      logo:a["tvg-logo"]||"",
      group:a["group-title"]||a["group"]||"",
      tvgId:a["tvg-id"]||""
    });
  }
  return out;
}

function categoryList(type) {
  return files(type).map(file => {
    const text=readFile(type,file);
    const items=parse(text);
    return {
      id:file.replace(/\.m3u$/i,""),
      name:items[0]?.group || file.replace(/\.m3u$/i,""),
      count:items.length,
      endpoint:`/api/${type}/${encodeURIComponent(file.replace(/\.m3u$/i,""))}`
    };
  });
}

module.exports=(req,res)=>{
  const p=(req.url||"").split("?")[0].replace(/\/+$/,"");

  if(p==="/api" || p==="/api/"){
    return send(res,200,{
      name:"M3U Categories API",
      movies:"/api/movies",
      series:"/api/series",
      categoryExamples:"/api/movies/action",
      m3uCategoryExamples:"/api/movies/action.m3u"
    });
  }

  const m=p.match(/^\/api\/(movies|series)$/);
  if(m){
    return send(res,200,categoryList(m[1]));
  }

  const c=p.match(/^\/api\/(movies|series)\/([^/]+?)(?:\.m3u)?$/);
  if(c){
    const type=safeType(c[1]), id=decodeURIComponent(c[2]);
    const file=id.endsWith(".m3u")?id:id+".m3u";
    const text=readFile(type,file);
    if(!text) return send(res,404,{error:"Category not found"});
    if(p.toLowerCase().endsWith(".m3u"))
      return send(res,200,text,"audio/x-mpegurl; charset=utf-8");
    return send(res,200,parse(text));
  }

  return send(res,404,{error:"Not found"});
};
