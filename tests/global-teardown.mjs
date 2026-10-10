export default async function globalTeardown() {
  if (global.__testHttpServer) {
    await new Promise(r => global.__testHttpServer.close(r));
  }
  if (global.__testPeerProc) {
    global.__testPeerProc.kill('SIGTERM');
  }
  console.log('[teardown] servers stopped');
}
