import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
http.createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${requested === '/' ? '/index.html' : requested}`);
    if (!file.startsWith(root + path.sep) && file !== root) {res.writeHead(403).end(); return;}
    let content;
    let isAppRoute = false;
    try {content = await readFile(file);}
    catch {
      if (!/^\/(?:q\/\d+\/\d+|dictionary|study(?:\/[^/]+)?|privacy)\/?$/.test(requested)) throw new Error('Not found');
      content = await readFile(path.join(root, 'index.html')); isAppRoute = true;
    }
    res.writeHead(200, {'Content-Type':isAppRoute ? types['.html'] : types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache'});
    res.end(content);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('Not found. Run npm run build first.'); }
}).listen(4173, '127.0.0.1', () => console.log('Quranic Words: http://localhost:4173'));
