import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.png':'image/png'};
const port = Number(process.argv[2] || process.env.PORT || 4173);
const server = http.createServer(async (req, res) => {
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
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use (a previous preview server is still running?).\n` +
      `Stop it with:  npx kill-port ${port}   or:  netstat -ano | findstr :${port}  then  taskkill /PID <pid> /F\n` +
      `Or serve on another port:  npm run dev -- ${port + 1}`);
    process.exit(1);
  }
  throw error;
});
server.listen(port, '127.0.0.1', () => console.log(`Quranic Words: http://localhost:${port}`));
