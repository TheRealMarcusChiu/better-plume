// public-signaling.spec.mjs — real WebRTC smoke test via default PeerJS cloud signaling (api.peerjs.com)
// Set BASE_URL env to test against a deployed site; otherwise falls back to local test server.
import { test, expect } from '@playwright/test';

function baseURL() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const h = process.env.TEST_HTTP_PORT;
  if (!h) throw new Error('TEST_HTTP_PORT not set and BASE_URL not provided');
  return `http://127.0.0.1:${h}`;
}

// Uses default peerOpts={} — no signal=local — so PeerJS connects to api.peerjs.com
function publicURL(extra = '') {
  return `${baseURL()}/?test=1${extra}`;
}

test.setTimeout(60000);

test('public PeerJS signaling: host and guest connect and both enter game', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hostPage = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();

  // Collect console errors for diagnosis
  const hostErrors = [];
  const guestErrors = [];
  hostPage.on('console', m => { if (m.type() === 'error') hostErrors.push(m.text()); });
  guestPage.on('console', m => { if (m.type() === 'error') guestErrors.push(m.text()); });

  await hostPage.goto(publicURL());

  // Host creates room
  await hostPage.click('#btn-create');
  await hostPage.fill('#inp-name-c', 'PubHost');
  await hostPage.click('#btn-go-create');

  // Wait for host to be assigned a room code (PeerJS open event)
  await hostPage.waitForSelector('#hud:not([hidden])', { timeout: 45000 });
  const roomCode = await hostPage.$eval('#room-code-disp', el => el.textContent.trim());
  expect(roomCode).toMatch(/^[A-Z]{6}$/);

  // Guest joins via public signaling using the room code
  await guestPage.goto(publicURL());
  await guestPage.click('#btn-join');
  await guestPage.fill('#inp-name-j', 'PubGuest');
  await guestPage.fill('#inp-code', roomCode);
  await guestPage.click('#btn-go-join');

  await guestPage.waitForSelector('#hud:not([hidden])', { timeout: 45000 });

  // Verify both pages are in-game
  const hostHudVisible = await hostPage.$eval('#hud', el => !el.hidden);
  const guestHudVisible = await guestPage.$eval('#hud', el => !el.hidden);
  expect(hostHudVisible).toBe(true);
  expect(guestHudVisible).toBe(true);

  // Verify guest received a game state with both players
  const playerCount = await guestPage.evaluate(() => window.__plume?.renderState?.players?.length);
  expect(playerCount).toBeGreaterThanOrEqual(2);

  // Verify host engine has both players
  const hostPlayerCount = await hostPage.evaluate(() => window.__plume?.engine?.players?.length);
  expect(hostPlayerCount).toBeGreaterThanOrEqual(2);

  if (hostErrors.length || guestErrors.length) {
    console.log('Host errors:', hostErrors);
    console.log('Guest errors:', guestErrors);
  }

  await hostCtx.close();
  await guestCtx.close();
});

test('public PeerJS signaling: guest input is replicated to host engine', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const hostPage = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();

  await hostPage.goto(publicURL());
  await hostPage.click('#btn-create');
  await hostPage.fill('#inp-name-c', 'SyncHost');
  await hostPage.click('#btn-go-create');
  await hostPage.waitForSelector('#hud:not([hidden])', { timeout: 45000 });
  const roomCode = await hostPage.$eval('#room-code-disp', el => el.textContent.trim());

  await guestPage.goto(publicURL());
  await guestPage.click('#btn-join');
  await guestPage.fill('#inp-name-j', 'SyncGuest');
  await guestPage.fill('#inp-code', roomCode);
  await guestPage.click('#btn-go-join');
  await guestPage.waitForSelector('#hud:not([hidden])', { timeout: 45000 });

  // Wait for guest to appear in host engine
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const n = await hostPage.evaluate(() => window.__plume?.engine?.players?.length);
    if (n >= 2) break;
    await hostPage.waitForTimeout(200);
  }
  const guestId = await guestPage.evaluate(() => window.__plume?.myId);
  const hostHasGuest = await hostPage.evaluate(id =>
    !!window.__plume?.engine?.players?.find(p => p.id === id), guestId);
  expect(hostHasGuest).toBe(true);

  // Record guest head position on host, then send directional input, wait, compare
  const pos1 = await hostPage.evaluate(id => {
    const p = window.__plume?.engine?.players?.find(p => p.id === id);
    return p?.body?.[0] ? [...p.body[0]] : null;
  }, guestId);
  expect(pos1).not.toBeNull();

  await guestPage.evaluate(() => window.__plume?.setAimAngle(0));
  await guestPage.waitForTimeout(1200);

  const pos2 = await hostPage.evaluate(id => {
    const p = window.__plume?.engine?.players?.find(p => p.id === id);
    return p?.body?.[0] ? [...p.body[0]] : null;
  }, guestId);
  expect(pos2).not.toBeNull();
  expect(pos1[0]).not.toBe(pos2[0]);

  await hostCtx.close();
  await guestCtx.close();
});
