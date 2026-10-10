// engine.js — pure game simulation, no DOM dependencies
'use strict';

export const WORLD_W = 4000;
export const WORLD_H = 4000;
export const MAX_PLAYERS = 10;
export const TICK_RATE = 30;
export const SPEED = 2.8;        // px per tick
export const SEG_DIST = 9;       // px between body segments
export const EAT_R = 14;         // food eat radius px
export const BODY_R = 7;         // body collision radius px
export const HEAD_ON_R = 22;     // head-on collision radius px
export const SPAWN_MS = 5000;    // spawn protection ms
export const INIT_SEGS = 14;     // starting body length
export const TARGET_FOOD = 220;  // target food count in world
export const GROWTH = 3;         // body segments added per food
export const MAX_TURN = 0.10;    // max radians turn per tick
// Hard caps to keep snapshots bounded (≤ 256 KiB at 10 players).
// A growing 10-player room reaches MAX_BODY_SEGS after ~129 food eaten each.
export const MAX_BODY_SEGS = 400;
export const MAX_FOOD_ITEMS = 600;

export const PLAYER_COLORS = [
  '#00e5ff', '#ff6b6b', '#a8ff78', '#ffd93d', '#c77dff',
  '#ff9a3c', '#ff6ec7', '#00d4aa', '#4cc9f0', '#f72585',
];

let _foodSeq = 0;
let _burstSeq = 0;

function rnd(min, max) { return min + Math.random() * (max - min); }
function d2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

// Normalize angle to [-π, π] in O(1) — prevents infinite loops with huge inputs.
function normAngle(a) {
  return ((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
}

function safeSpawn(players) {
  const M = 300, SAFE2 = 250 * 250;
  for (let attempt = 0; attempt < 50; attempt++) {
    const x = rnd(M, WORLD_W - M);
    const y = rnd(M, WORLD_H - M);
    let ok = true;
    outer: for (const p of players) {
      if (!p.alive) continue;
      for (const s of p.body) {
        if (d2(x, y, s[0], s[1]) < SAFE2) { ok = false; break outer; }
      }
    }
    if (ok) return { x, y };
  }
  return { x: rnd(M, WORLD_W - M), y: rnd(M, WORLD_H - M) };
}

function makeBody(x, y, angle, len) {
  const body = [];
  for (let i = 0; i < len; i++) {
    body.push([
      x - Math.cos(angle) * i * SEG_DIST,
      y - Math.sin(angle) * i * SEG_DIST,
    ]);
  }
  return body;
}

export function createEngine() {
  const players = [];
  const food = [];
  const usedColors = new Set();
  let tick = 0;
  // Bursts accumulate across steps and are only cleared by flushBursts(),
  // called after each broadcast snapshot, so no deaths are lost between
  // the 30 Hz sim and 12 Hz snapshot cadence.
  let pendingBursts = [];

  function spawnFood(x, y, color, value = 1) {
    if (food.length >= MAX_FOOD_ITEMS) return;
    food.push({
      id: ++_foodSeq,
      x: Math.max(10, Math.min(WORLD_W - 10, Math.round(x))),
      y: Math.max(10, Math.min(WORLD_H - 10, Math.round(y))),
      color,
      value,
    });
  }

  function replenish() {
    while (food.length < TARGET_FOOD) {
      const c = PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
      spawnFood(rnd(80, WORLD_W - 80), rnd(80, WORLD_H - 80), c);
    }
  }

  // Randomly select from unused palette colors instead of sequential order.
  function pickColor() {
    const avail = PLAYER_COLORS.filter(c => !usedColors.has(c));
    if (avail.length > 0) return avail[Math.floor(Math.random() * avail.length)];
    return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
  }

  // Returns {player} on success or {error: string} on failure
  function addPlayer(id, rawName) {
    if (players.length >= MAX_PLAYERS) return { error: 'Room is full (10 players max).' };
    const name = rawName?.trim();
    if (!name || name.length > 32) return { error: 'Invalid name.' };
    const nameLow = name.toLowerCase();
    if (players.some(p => p.name.toLowerCase() === nameLow)) {
      return { error: `Name "${name}" is already taken. Choose another.` };
    }
    const color = pickColor();
    usedColors.add(color);
    const angle = rnd(0, Math.PI * 2);
    const { x, y } = safeSpawn(players);
    const player = {
      id, name, color,
      body: makeBody(x, y, angle, INIT_SEGS),
      angle, inputAngle: angle,
      score: 0, alive: true,
      spawnTime: Date.now(),
    };
    players.push(player);
    replenish();
    return { player };
  }

  function removePlayer(id) {
    const idx = players.findIndex(p => p.id === id);
    if (idx >= 0) {
      usedColors.delete(players[idx].color);
      players.splice(idx, 1);
    }
  }

  function setInput(id, angle) {
    if (typeof angle !== 'number' || !isFinite(angle)) return false;
    // Normalize huge finite angles to [-π, π] to prevent infinite loops in step.
    angle = normAngle(angle);
    const p = players.find(p => p.id === id && p.alive);
    if (p) { p.inputAngle = angle; return true; }
    return false;
  }

  function respawn(id) {
    const p = players.find(p => p.id === id && !p.alive);
    if (!p) return false;
    const angle = rnd(0, Math.PI * 2);
    const { x, y } = safeSpawn(players);
    p.body = makeBody(x, y, angle, INIT_SEGS);
    p.angle = angle; p.inputAngle = angle;
    p.score = 0; p.alive = true; p.spawnTime = Date.now();
    return true;
  }

  function killPlayer(p) {
    if (!p.alive) return;
    p.alive = false;
    const snap = p.body.map(s => [Math.round(s[0]), Math.round(s[1])]);
    pendingBursts.push({ evId: ++_burstSeq, id: p.id, color: p.color, body: snap });
    for (let i = 0; i < p.body.length; i += 2) {
      spawnFood(
        p.body[i][0] + rnd(-12, 12),
        p.body[i][1] + rnd(-12, 12),
        p.color,
      );
    }
    p.body = [];
  }

  function step() {
    tick++;
    const now = Date.now();
    const toKill = new Set();

    for (const p of players) {
      if (!p.alive) continue;

      // Smooth turn — O(1) via normAngle, safe for any finite inputAngle.
      const da = normAngle(p.inputAngle - p.angle);
      p.angle += Math.sign(da) * Math.min(Math.abs(da), MAX_TURN);

      // New head position
      let nx = p.body[0][0] + Math.cos(p.angle) * SPEED;
      let ny = p.body[0][1] + Math.sin(p.angle) * SPEED;

      // Wall bounce
      const M = 25;
      if (nx < M) { nx = M; p.angle = normAngle(Math.PI - p.angle); p.inputAngle = p.angle; }
      else if (nx > WORLD_W - M) { nx = WORLD_W - M; p.angle = normAngle(Math.PI - p.angle); p.inputAngle = p.angle; }
      if (ny < M) { ny = M; p.angle = normAngle(-p.angle); p.inputAngle = p.angle; }
      else if (ny > WORLD_H - M) { ny = WORLD_H - M; p.angle = normAngle(-p.angle); p.inputAngle = p.angle; }

      // Move head (float position for smooth following).
      p.body[0] = [nx, ny];

      // Following constraint: each segment trails the one ahead at SEG_DIST.
      // This preserves the initial 9 px spacing instead of compressing to ~2.8 px.
      for (let k = 1; k < p.body.length; k++) {
        const [ax, ay] = p.body[k - 1];
        const [bx, by] = p.body[k];
        const dist = Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
        if (dist > SEG_DIST) {
          const pull = (dist - SEG_DIST) / dist;
          p.body[k] = [bx + (ax - bx) * pull, by + (ay - by) * pull];
        }
      }
    }

    // Food collisions + growth
    for (const p of players) {
      if (!p.alive) continue;
      const [hx, hy] = p.body[0];
      for (let i = food.length - 1; i >= 0; i--) {
        if (d2(hx, hy, food[i].x, food[i].y) < EAT_R * EAT_R) {
          p.score += food[i].value;
          food.splice(i, 1);
        }
      }
      // Grow by appending tail copies; trim to hard cap.
      const targetLen = Math.min(INIT_SEGS + p.score * GROWTH, MAX_BODY_SEGS);
      while (p.body.length < targetLen) p.body.push([...p.body[p.body.length - 1]]);
      while (p.body.length > targetLen) p.body.pop();
    }

    // Player vs player collisions
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p.alive) continue;
      const protP = now - p.spawnTime < SPAWN_MS;

      for (let j = 0; j < players.length; j++) {
        if (i === j) continue;
        const o = players[j];
        if (!o.alive) continue;
        const protO = now - o.spawnTime < SPAWN_MS;

        if (!protP && !protO) {
          if (d2(p.body[0][0], p.body[0][1], o.body[0][0], o.body[0][1]) < HEAD_ON_R * HEAD_ON_R) {
            toKill.add(p); toKill.add(o); continue;
          }
        }

        if (!protP) {
          const [hx, hy] = p.body[0];
          for (let k = 1; k < o.body.length; k++) {
            if (d2(hx, hy, o.body[k][0], o.body[k][1]) < BODY_R * BODY_R) {
              toKill.add(p); break;
            }
          }
        }
      }
    }

    for (const p of toKill) killPlayer(p);
    replenish();
    return { tick };
  }

  // Called by host after broadcasting each snapshot to clear sent bursts.
  function flushBursts() {
    pendingBursts = [];
  }

  function snapshot() {
    return {
      t: 'snapshot',
      tick,
      players: players.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        score: p.score,
        alive: p.alive,
        prot: p.alive && (Date.now() - p.spawnTime < SPAWN_MS),
        body: p.body.map(s => [Math.round(s[0]), Math.round(s[1])]),
        angle: +p.angle.toFixed(4),
      })),
      food: food.map(f => [f.x, f.y, f.color, f.id]),
      bursts: pendingBursts.slice(),
    };
  }

  return {
    addPlayer, removePlayer, setInput, respawn, step, snapshot, flushBursts,
    get players() { return players; },
    get food() { return food; },
    get tick() { return tick; },
  };
}
