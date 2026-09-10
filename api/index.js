const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'data');

function filesFor(type) {
  const dir = path.join(ROOT, type);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.m3u')).sort((a,b)=>a.localeCompare(b));
}
function safeFile(type, name) {
  const file = path.basename(name);
  if (file !== name || !file.toLowerCase().endsWith('.m3u')) return null;
  const full = path.join(ROOT,type,file);
  return fs.existsSync(full) ? full : null;
}
function parseM3U(text) {
  const lines=text.split(/\r?\n/); const items=[];
  for(let i=0;i<lines.length;i++) {
    const line=lines[i].trim();
    if(!line.startsWith('#EXTINF:')) continue;
    const url=(lines[i+1]||'').trim(); if(!url || url.startsWith('#')) continue;
    const attrs={}; const re=/([\w-]+)="([^"]*)"/g; let m;
    while((m=re.exec(line))) attrs[m[1]]=m[2];
    const comma=line.indexOf(','); const name=comma>=0?line.slice(comma+1).trim():(attrs['tvg-name']||'');
    items.push({name, url, logo:attrs['tvg-logo']||'', group:attrs['group-title']||'', id:attrs['tvg-id']||'', file:null});
  }
  return items;
}
function catalog(type) {
  return filesFor(type).map(file=>({name:file.replace(/\.m3u$/i,''), file, endpoint:`/api/${type}/${encodeURIComponent(file.replace(/\.m3u$/i,''))}`}));
}
function json(res, data, status=200) { res.status(status).setHeader('Content-Type','application/json; charset=utf-8'); res.end(JSON.stringify(data)); }
module.exports = (req,res)=>{
  const raw=(req.url||'').split('?')[0].replace(/^\/+/,'').replace(/\/+$/,'');
  const parts=raw.split('/').filter(Boolean).map(decodeURIComponent);
  if(parts.length===0 || parts[0]!=='api') return json(res,{ok:true,name:'MOOM Films & Series API',version:'2.0.0',endpoints:['/api/movies','/api/series','/api/search?q=...']});
  if(parts.length===1) return json(res,{ok:true,name:'MOOM Films & Series API',version:'2.0.0',movies:catalog('movies'),series:catalog('series')});
  if(parts[1]==='search') {
    const q=String((req.url||'').split('?')[1]||'').split('&').map(x=>x.split('=')).find(x=>x[0]==='q')?.slice(1).join('=')||'';
    const query=decodeURIComponent(q).trim().toLowerCase();
    if(!query) return json(res,{ok:true,count:0,items:[]});
    const all=[]; for(const type of ['movies','series']) for(const file of filesFor(type)){ const items=parseM3U(fs.readFileSync(path.join(ROOT,type,file),'utf8')); for(const x of items){ if(x.name.toLowerCase().includes(query) || x.group.toLowerCase().includes(query)) all.push({...x,type,file}); }}
    return json(res,{ok:true,query,count:all.length,items:all});
  }
  const type=parts[1]; if(!['movies','series'].includes(type)) return json(res,{ok:false,error:'Unknown type'},404);
  if(parts.length===2) return json(res,{ok:true,type,count:filesFor(type).length,items:catalog(type)});
  let category=parts[2];
  if(category.toLowerCase().endsWith('.m3u')) category=category.slice(0,-4);
  const file=category+'.m3u'; const full=safeFile(type,file);
  if(!full) return json(res,{ok:false,error:'Category not found'},404);
  if(parts[2].toLowerCase().endsWith('.m3u')) { res.status(200).setHeader('Content-Type','audio/x-mpegurl; charset=utf-8'); return res.end(fs.readFileSync(full)); }
  const items=parseM3U(fs.readFileSync(full,'utf8')).map(x=>({...x,file}));
  return json(res,{ok:true,type,category,file,count:items.length,items});
};

