import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { extname, join, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const root = join(__dirname, 'public');
const port = process.env.PORT ? Number(process.env.PORT) : 5173;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, code, headers, stream) {
  res.writeHead(code, headers);
  if (stream) stream.pipe(res); else res.end();
}

const server = createServer(async (req, res) => {
  try {
    const url = (req.url || '/').split('?')[0];
    let path = decodeURIComponent(url);
    if (path === '/' || path === '') path = '/index.html';
    const file = resolve(root, `.${path}`);
    const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
    if (!file.startsWith(rootPrefix)) {
      return send(res, 403, { 'content-type': 'text/plain' });
    }
    const st = await stat(file);
    if (st.isDirectory()) {
      return send(res, 403, { 'content-type': 'text/plain' });
    }
    const ext = extname(file).toLowerCase();
    const ctype = types[ext] || 'application/octet-stream';
    send(res, 200, { 'content-type': ctype }, createReadStream(file));
  } catch (e) {
    if (req.url === '/' || req.url === '/index.html') {
      // If index missing, show a tiny hint
      const html = `<!doctype html><meta charset=utf-8><title>Server</title><pre>No index.html found.</pre>`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, () => {
  console.log(`Dev server running at http://localhost:${port}`);
});
