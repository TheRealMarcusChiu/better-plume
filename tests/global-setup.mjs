import { spawn } from 'child_process';
import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HTTP_PORT = 18080;
const PEER_PORT = 19001;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.txt':  'text/plain',
};

let httpServer, peerProc;

export default async function globalSetup() {
  // 1. Static HTTP server
  await new Promise((resolve, reject) => {
    httpServer = createServer(async (req, res) => {
      let pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/') pathname = '/index.html';
      const fp = join(ROOT, pathname);
      if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      try {
        await stat(fp);
        const data = await readFile(fp);
        res.writeHead(200, {
          'Content-Type': MIME[extname(fp)] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      } catch {
        res.writeHead(404); res.end('not found');
      }
    });
    httpServer.listen(HTTP_PORT, '127.0.0.1', resolve);
    httpServer.once('error', reject);
  });
  console.log(`[setup] HTTP → http://127.0.0.1:${HTTP_PORT}`);

  // 2. PeerJS signaling server
  await new Promise((resolve, reject) => {
    peerProc = spawn(
      process.execPath,
      [join(ROOT, 'node_modules/.bin/peerjs'), '--port', PEER_PORT, '--path', '/peerjs'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let resolved = false;
    const tryResolve = () => { if (!resolved) { resolved = true; resolve(); } };

    const onData = chunk => {
      const s = chunk.toString();
      process.stdout.write(s);
      if (s.includes('Started') || s.includes('listen') || s.includes(String(PEER_PORT))) {
        tryResolve();
      }
    };
    peerProc.stdout.on('data', onData);
    peerProc.stderr.on('data', onData);

    setTimeout(tryResolve, 3000);

    peerProc.once('error', reject);
  });
  console.log(`[setup] PeerJS → ws://127.0.0.1:${PEER_PORT}/peerjs`);

  // Store refs for teardown
  global.__testHttpServer = httpServer;
  global.__testPeerProc = peerProc;
  global.__testHttpPort = HTTP_PORT;
  global.__testPeerPort = PEER_PORT;

  // Write config for tests to read
  process.env.TEST_HTTP_PORT = String(HTTP_PORT);
  process.env.TEST_PEER_PORT = String(PEER_PORT);
}
