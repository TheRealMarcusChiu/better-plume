// render.js — canvas rendering with underwater aesthetic
import { WORLD_W, WORLD_H } from './engine.js';

const PLANKTON_N = 280;
const MM_W = 160, MM_H = 128; // minimap size

let plankton = null;
const burstParticles = [];
const seenBurstIds = new Set(); // deduplicate bursts by evId across repeated snapshots
let camX = 2000, camY = 2000;
let _lastT = 0;

function rnd(a, b) { return a + Math.random() * (b - a); }

function initPlankton() {
  plankton = Array.from({ length: PLANKTON_N }, () => ({
    wx: rnd(0, WORLD_W),
    wy: rnd(0, WORLD_H),
    r: rnd(0.4, 1.8),
    vx: (Math.random() - 0.5) * 0.12,
    vy: (Math.random() - 0.5) * 0.12,
    phase: rnd(0, Math.PI * 2),
    rate: rnd(0.008, 0.022),
  }));
}

function lerp(a, b, t) { return a + (b - a) * t; }

function w2s(wx, wy, cw, ch) {
  return [
    (wx - camX) + cw * 0.5,
    (wy - camY) + ch * 0.5,
  ];
}

export function moveCamera(tx, ty, dt) {
  const k = 1 - Math.exp(-0.09 * dt);
  camX = lerp(camX, tx, k);
  camY = lerp(camY, ty, k);
}

export function setCameraImmediate(x, y) { camX = x; camY = y; }

export function addBurst(burst) {
  const now = performance.now();
  for (const [bx, by] of burst.body) {
    if (burstParticles.length > 1200) break;
    burstParticles.push({
      x: bx, y: by,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6,
      color: burst.color,
      birth: now,
      life: 500 + rnd(0, 400),
    });
  }
}

// ── Background layers ─────────────────────────────────────────────────────────

function drawBackground(ctx, cw, ch) {
  ctx.fillStyle = '#020c18';
  ctx.fillRect(0, 0, cw, ch);
  const g = ctx.createRadialGradient(cw * 0.5, ch * 0.5, 0, cw * 0.5, ch * 0.5, Math.hypot(cw, ch) * 0.55);
  g.addColorStop(0, 'rgba(8,24,44,0.7)');
  g.addColorStop(1, 'rgba(1,4,12,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
}

function drawCaustics(ctx, cw, ch, t) {
  ctx.save();
  ctx.lineWidth = 1;
  const lines = 10;
  for (let i = 0; i < lines; i++) {
    const baseY = ((i / lines) * ch * 2.5 - (camY % (ch * 0.25)) * 0.15) % (ch * 1.2) - ch * 0.1;
    const ph = t * 0.0006 + i * 0.71;
    ctx.beginPath();
    ctx.moveTo(-20, baseY);
    for (let x = 0; x <= cw + 40; x += 32) {
      const y = baseY
        + Math.sin(x * 0.0035 + ph) * 28
        + Math.sin(x * 0.0082 + ph * 1.4) * 14
        + Math.sin(x * 0.017 + ph * 0.7) * 7;
      ctx.lineTo(x, y);
    }
    const alpha = (0.018 + 0.012 * Math.sin(t * 0.0009 + i * 1.1));
    ctx.strokeStyle = `rgba(0,200,220,${alpha})`;
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlankton(ctx, cw, ch, t, dt) {
  ctx.save();
  for (const p of plankton) {
    p.wx = (p.wx + p.vx * dt + WORLD_W) % WORLD_W;
    p.wy = (p.wy + p.vy * dt + WORLD_H) % WORLD_H;
    p.phase += p.rate * dt;
    const [sx, sy] = w2s(p.wx, p.wy, cw, ch);
    if (sx < -4 || sx > cw + 4 || sy < -4 || sy > ch + 4) continue;
    const alpha = 0.25 + 0.22 * Math.sin(p.phase);
    ctx.fillStyle = `rgba(120,230,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(sx, sy, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── World boundary ────────────────────────────────────────────────────────────

function drawBoundary(ctx, cw, ch) {
  const [x0, y0] = w2s(0, 0, cw, ch);
  const [x1, y1] = w2s(WORLD_W, WORLD_H, cw, ch);

  ctx.save();
  ctx.strokeStyle = 'rgba(0,210,230,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  if (y0 > 0) ctx.fillRect(0, 0, cw, y0);
  if (y1 < ch) ctx.fillRect(0, y1, cw, ch - y1);
  if (x0 > 0) ctx.fillRect(0, y0, x0, y1 - y0);
  if (x1 < cw) ctx.fillRect(x1, y0, cw - x1, y1 - y0);
  ctx.restore();
}

// ── Food ──────────────────────────────────────────────────────────────────────

function drawFood(ctx, cw, ch, food, t) {
  for (const [fx, fy, fcolor] of food) {
    const [sx, sy] = w2s(fx, fy, cw, ch);
    if (sx < -18 || sx > cw + 18 || sy < -18 || sy > ch + 18) continue;

    const pulse = 0.8 + 0.2 * Math.sin(t * 0.003 + fx * 0.005 + fy * 0.003);
    const gr = 9 * pulse;
    const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
    grd.addColorStop(0, fcolor + 'dd');
    grd.addColorStop(0.35, fcolor + '77');
    grd.addColorStop(1, fcolor + '00');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(sx, sy, gr, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Players ───────────────────────────────────────────────────────────────────

function segDir(body, i) {
  const a = body[Math.max(0, i - 1)];
  const b = body[Math.min(body.length - 1, i + 1)];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

function drawTendril(ctx, sx, sy, perpAngle, side, t, color, waveOff) {
  const wave = Math.sin(t * 0.0018 + waveOff) * 0.35;
  const ang = perpAngle + side * (Math.PI / 2 + wave);
  const len = 24;
  const bend = 0.5 + Math.sin(t * 0.002 + waveOff * 1.3) * 0.2;

  const cp1x = sx + Math.cos(ang) * len * 0.5;
  const cp1y = sy + Math.sin(ang) * len * 0.5;
  const cp2x = sx + Math.cos(ang + bend * side) * len * 0.9;
  const cp2y = sy + Math.sin(ang + bend * side) * len * 0.9;
  const ex = sx + Math.cos(ang + bend * side * 1.5) * len * 1.3;
  const ey = sy + Math.sin(ang + bend * side * 1.5) * len * 1.3;

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
  const grd = ctx.createLinearGradient(sx, sy, ex, ey);
  grd.addColorStop(0, color + '90');
  grd.addColorStop(1, color + '00');
  ctx.strokeStyle = grd;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawPlayer(ctx, cw, ch, player, isLocal, t) {
  if (!player.alive || !player.body || player.body.length === 0) return;
  const body = player.body;
  const n = body.length;
  const color = player.color;

  // Tendrils (behind body)
  ctx.save();
  for (let i = 3; i < n - 2; i += 4) {
    const [sx, sy] = w2s(body[i][0], body[i][1], cw, ch);
    if (sx < -60 || sx > cw + 60 || sy < -60 || sy > ch + 60) continue;
    const ang = segDir(body, i);
    const woff = body[i][0] * 0.007 + body[i][1] * 0.005;
    drawTendril(ctx, sx, sy, ang, 1, t, color, woff);
    drawTendril(ctx, sx, sy, ang, -1, t, color, woff + 1.2);
  }
  ctx.restore();

  // Body (tail → head for correct z-order)
  ctx.save();
  ctx.shadowBlur = 10;
  ctx.shadowColor = color;

  for (let i = n - 1; i >= 0; i--) {
    const [sx, sy] = w2s(body[i][0], body[i][1], cw, ch);
    if (sx < -20 || sx > cw + 20 || sy < -20 || sy > ch + 20) continue;

    const frac = i / n;       // 0=head,1=tail
    const alpha = 0.6 + 0.4 * (1 - frac);
    const baseR = i === 0 ? 10 : lerp(8, 3.5, frac);

    if (i === 0) {
      // Head: outer glow halo
      const gr = 26;
      const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
      grd.addColorStop(0, color + 'ff');
      grd.addColorStop(0.28, color + 'aa');
      grd.addColorStop(0.65, color + '44');
      grd.addColorStop(1, color + '00');
      ctx.globalAlpha = 1;
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(sx, sy, gr, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, baseR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  ctx.globalAlpha = 1;

  // Spawn protection
  if (player.prot) {
    const [hx, hy] = w2s(body[0][0], body[0][1], cw, ch);
    const pulse = 0.4 + 0.35 * Math.sin(t * 0.006);
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(hx, hy, 28 + pulse * 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Name tag
  if (n > 0) {
    const [hx, hy] = w2s(body[0][0], body[0][1], cw, ch);
    ctx.save();
    ctx.font = `${isLocal ? 'bold ' : ''}11px Inter,system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(player.name + (isLocal ? ' ★' : ''), hx, hy - 20);
    ctx.restore();
  }
}

// ── Burst particles ───────────────────────────────────────────────────────────

function drawBursts(ctx, cw, ch) {
  const now = performance.now();
  ctx.save();
  let i = burstParticles.length;
  while (i--) {
    const p = burstParticles[i];
    const age = now - p.birth;
    if (age >= p.life) { burstParticles.splice(i, 1); continue; }
    p.x += p.vx; p.y += p.vy; p.vx *= 0.96; p.vy *= 0.96;
    const [sx, sy] = w2s(p.x, p.y, cw, ch);
    ctx.globalAlpha = 1 - age / p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ── Minimap ───────────────────────────────────────────────────────────────────

export function drawMinimap(ctx, players, localId, cw, ch) {
  const mx = cw - MM_W - 12;
  const my = ch - MM_H - 12;
  const sx = MM_W / WORLD_W;
  const sy = MM_H / WORLD_H;

  ctx.save();

  ctx.fillStyle = 'rgba(2,10,22,0.82)';
  ctx.strokeStyle = 'rgba(0,200,220,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(mx, my, MM_W, MM_H);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.rect(mx, my, MM_W, MM_H);
  ctx.clip();

  for (const p of players) {
    if (!p.alive || !p.body || p.body.length === 0) continue;
    const [bx, by] = p.body[0];
    const px = mx + bx * sx;
    const py = my + by * sy;
    const isMe = p.id === localId;

    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(px, py, isMe ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();

    if (isMe) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 6.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();
}

// ── Main render ───────────────────────────────────────────────────────────────

export function render(canvas, state, localId, t) {
  if (!plankton) initPlankton();
  const ctx = canvas.getContext('2d');
  const cw = canvas.width, ch = canvas.height;
  const dt = _lastT ? Math.min(t - _lastT, 50) : 16;
  _lastT = t;

  const local = state?.players?.find(p => p.id === localId && p.alive);
  if (local && local.body.length > 0) {
    moveCamera(local.body[0][0], local.body[0][1], dt);
  }

  drawBackground(ctx, cw, ch);
  drawCaustics(ctx, cw, ch, t);
  drawPlankton(ctx, cw, ch, t, dt);
  drawBoundary(ctx, cw, ch);

  if (state) {
    if (state.food) drawFood(ctx, cw, ch, state.food, t);
    if (state.bursts) {
      for (const b of state.bursts) {
        if (b.evId != null) {
          if (seenBurstIds.has(b.evId)) continue;
          seenBurstIds.add(b.evId);
        }
        addBurst(b);
      }
    }
    drawBursts(ctx, cw, ch);
    if (state.players) {
      for (const p of state.players) drawPlayer(ctx, cw, ch, p, p.id === localId, t);
    }
    drawMinimap(ctx, state.players || [], localId, cw, ch);
  }
}
