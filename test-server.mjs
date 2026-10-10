// test-server.mjs — minimal static file server for tests and dev
import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2] || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
};

const server = createServer(async (req, res) => {
  let pathname = new URL(req.url, `http://localhost`).pathname;
  if (pathname === '/') pathname = '/index.html';
  const filePath = join(ROOT, pathname);

  // Security: no directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end(); return;
  }

  try {
    await stat(filePath);
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found: ' + pathname);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`static server → http://127.0.0.1:${PORT}`);
});

export default server;
