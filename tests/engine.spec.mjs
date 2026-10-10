// engine.spec.mjs — behavioral unit tests for the game engine
// These tests run the engine inside a browser context via page.evaluate
import { test, expect } from '@playwright/test';

// ── Regression tests for specific bugs ────────────────────────────────────────

const HTTP = () => `http://127.0.0.1:${process.env.TEST_HTTP_PORT}`;
const PAGE_URL = () => `${HTTP()}/?test=1&signal=local&signalHost=127.0.0.1&signalPort=${process.env.TEST_PEER_PORT}`;

// Helper: import engine module in page context and return a serializable result
async function engineEval(page, fn) {
  return page.evaluate(async (fnSrc) => {
    const mod = await import('/engine.js');
    const evalFn = new Function('mod', `return (${fnSrc})(mod)`);
    return evalFn(mod);
  }, fn.toString());
}

test.describe('Engine: eat food → body grows and score increases', () => {
  test('eating food increments score and grows body', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, EAT_R, INIT_SEGS } = await import('/engine.js');
      const eng = createEngine();
      const res = eng.addPlayer('p1', 'Alice');
      if (!res.player) return { error: res.error };

      // Place food exactly on the head
      const head = res.player.body[0];
      eng.food.push({ id: 9999, x: head[0], y: head[1], color: '#fff', value: 1 });
      const foodBefore = eng.food.length;
      const lenBefore = res.player.body.length;

      // Tick until food is eaten (max 5 ticks)
      let ate = false;
      for (let i = 0; i < 5; i++) {
        eng.step();
        const p = eng.players[0];
        if (p.score > 0) { ate = true; break; }
      }

      const p = eng.players[0];
      return {
        ate,
        score: p.score,
        bodyLength: p.body.length,
        foodCountAfter: eng.food.length,
        lenBefore,
        foodBefore,
      };
    });

    expect(result.error).toBeUndefined();
    expect(result.ate).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.bodyLength).toBeGreaterThan(result.lenBefore);
  });
});

test.describe('Engine: head hits other body → death + food scatter', () => {
  test('attacker dies and scatters food when hitting another body', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, BODY_R, SPAWN_MS } = await import('/engine.js');
      const eng = createEngine();
      const r1 = eng.addPlayer('p1', 'Alice');
      const r2 = eng.addPlayer('p2', 'Bob');
      if (!r1.player || !r2.player) return { error: 'addPlayer failed' };

      // Force spawn protection off
      r1.player.spawnTime = Date.now() - SPAWN_MS - 100;
      r2.player.spawnTime = Date.now() - SPAWN_MS - 100;

      // Place p1's head on top of p2's body segment 5 (far from p2 head to avoid head-on)
      const seg = r2.player.body[5];
      r1.player.body[0] = [seg[0], seg[1]];
      r1.player.inputAngle = 0;
      r1.player.angle = 0;

      const foodBefore = eng.food.length;
      eng.step();

      const p1 = eng.players.find(p => p.id === 'p1');
      const foodAfter = eng.food.length;

      return {
        p1Alive: p1.alive,
        p2Alive: eng.players.find(p => p.id === 'p2').alive,
        foodIncreased: foodAfter > foodBefore,
        foodBefore,
        foodAfter,
      };
    });

    expect(result.error).toBeUndefined();
    expect(result.p1Alive).toBe(false);
    expect(result.p2Alive).toBe(true);
    expect(result.foodIncreased).toBe(true);
  });

  test('head-on collision kills both players', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, SPAWN_MS, HEAD_ON_R } = await import('/engine.js');
      const eng = createEngine();
      const r1 = eng.addPlayer('p1', 'Alice');
      const r2 = eng.addPlayer('p2', 'Bob');

      r1.player.spawnTime = Date.now() - SPAWN_MS - 100;
      r2.player.spawnTime = Date.now() - SPAWN_MS - 100;

      // Move heads together
      r1.player.body[0] = [2000, 2000];
      r2.player.body[0] = [2000 + HEAD_ON_R - 5, 2000];

      eng.step();

      return {
        p1Alive: eng.players.find(p => p.id === 'p1').alive,
        p2Alive: eng.players.find(p => p.id === 'p2').alive,
      };
    });

    expect(result.p1Alive).toBe(false);
    expect(result.p2Alive).toBe(false);
  });

  test('spawn-protected player cannot be killed by collision', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, BODY_R, SPAWN_MS } = await import('/engine.js');
      const eng = createEngine();
      const r1 = eng.addPlayer('p1', 'Alice');
      const r2 = eng.addPlayer('p2', 'Bob');

      // p1 has spawn protection; p2 does not
      r1.player.spawnTime = Date.now(); // still protected
      r2.player.spawnTime = Date.now() - SPAWN_MS - 100;

      // Shove p1's head onto p2's body
      const seg = r2.player.body[2];
      r1.player.body[0] = [seg[0], seg[1]];

      eng.step();

      return {
        p1Alive: eng.players.find(p => p.id === 'p1').alive,
      };
    });

    expect(result.p1Alive).toBe(true);
  });
});

test.describe('Engine: unique name enforcement', () => {
  test('duplicate name (case-insensitive) is rejected', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine } = await import('/engine.js');
      const eng = createEngine();
      eng.addPlayer('p1', 'Alice');
      const res = eng.addPlayer('p2', 'alice'); // lowercase dupe
      return { error: res.error, hasPlayer: !!res.player };
    });

    expect(result.hasPlayer).toBe(false);
    expect(result.error).toMatch(/taken/i);
  });

  test('whitespace-trimmed names are deduplicated', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine } = await import('/engine.js');
      const eng = createEngine();
      eng.addPlayer('p1', 'Alice');
      const res = eng.addPlayer('p2', '  Alice  ');
      return { error: res.error };
    });

    expect(result.error).toMatch(/taken/i);
  });
});

test.describe('Engine: 10 player cap', () => {
  test('11th player is rejected', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, MAX_PLAYERS } = await import('/engine.js');
      const eng = createEngine();
      for (let i = 0; i < MAX_PLAYERS; i++) {
        eng.addPlayer('p' + i, 'Player' + i);
      }
      const res = eng.addPlayer('p99', 'Overflow');
      return { error: res.error, playerCount: eng.players.length };
    });

    expect(result.error).toMatch(/full/i);
    expect(result.playerCount).toBe(10);
  });
});

test.describe('Engine: distinct colors per player', () => {
  test('each player gets a unique color', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, MAX_PLAYERS } = await import('/engine.js');
      const eng = createEngine();
      for (let i = 0; i < MAX_PLAYERS; i++) {
        eng.addPlayer('p' + i, 'P' + i);
      }
      const colors = eng.players.map(p => p.color);
      const unique = new Set(colors);
      return { colors, uniqueCount: unique.size, total: colors.length };
    });

    expect(result.uniqueCount).toBe(result.total);
    expect(result.total).toBe(10);
  });
});

test.describe('Engine: input validation', () => {
  test('non-finite angle is ignored', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine } = await import('/engine.js');
      const eng = createEngine();
      eng.addPlayer('p1', 'Alice');
      const angleBefore = eng.players[0].inputAngle;
      const r1 = eng.setInput('p1', NaN);
      const r2 = eng.setInput('p1', Infinity);
      const r3 = eng.setInput('p1', 'hello');
      return {
        r1, r2, r3,
        angleUnchanged: eng.players[0].inputAngle === angleBefore,
      };
    });

    expect(result.r1).toBe(false);
    expect(result.r2).toBe(false);
    expect(result.r3).toBe(false);
    expect(result.angleUnchanged).toBe(true);
  });

  test('dead player input is ignored', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, SPAWN_MS } = await import('/engine.js');
      const eng = createEngine();
      const r = eng.addPlayer('p1', 'Alice');
      r.player.alive = false;
      r.player.spawnTime = 0;
      const res = eng.setInput('p1', 1.5);
      return { res };
    });

    expect(result.res).toBe(false);
  });
});

test.describe('Engine: respawn', () => {
  test('respawn restores player to alive with fresh score', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, SPAWN_MS, INIT_SEGS } = await import('/engine.js');
      const eng = createEngine();
      eng.addPlayer('p1', 'Alice');
      const p = eng.players[0];
      p.alive = false; p.body = []; p.score = 42;
      const ok = eng.respawn('p1');
      return {
        ok,
        alive: p.alive,
        score: p.score,
        bodyLen: p.body.length,
        hasProtection: (Date.now() - p.spawnTime) < SPAWN_MS,
      };
    });

    expect(result.ok).toBe(true);
    expect(result.alive).toBe(true);
    expect(result.score).toBe(0);
    expect(result.bodyLen).toBe(14); // INIT_SEGS
    expect(result.hasProtection).toBe(true);
  });
});

// ── Bug: pickColor was sequential not random ───────────────────────────────────
test.describe('Engine: pickColor is random', () => {
  test('10-player color assignment is not always the same order', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, PLAYER_COLORS } = await import('/engine.js');
      // Run many fresh engines and collect first-player colors
      const firsts = new Set();
      for (let run = 0; run < 30; run++) {
        const eng = createEngine();
        eng.addPlayer('p0', 'P0');
        firsts.add(eng.players[0].color);
      }
      return { uniqueFirsts: firsts.size };
    });

    // If truly random, multiple different first colors should appear across 30 runs
    expect(result.uniqueFirsts).toBeGreaterThan(1);
  });
});

// ── Bug: huge finite angle hangs while loops in step ─────────────────────────
test.describe('Engine: huge finite angle does not hang', () => {
  test('setInput with 1e300 completes within timeout and normalizes', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine } = await import('/engine.js');
      const eng = createEngine();
      eng.addPlayer('p1', 'Alice');
      const ok = eng.setInput('p1', 1e300);
      if (!ok) return { ok };
      const angleBefore = eng.players[0].inputAngle;
      // step() must complete quickly (no infinite loop)
      const t0 = performance.now();
      eng.step();
      const elapsed = performance.now() - t0;
      return { ok, angle: angleBefore, elapsed, angleFinite: isFinite(angleBefore) };
    });

    expect(result.ok).toBe(true);
    expect(result.elapsed).toBeLessThan(500); // must complete in well under 500ms
    expect(result.angleFinite).toBe(true);
  });
});

// ── Bug: body unbounded ────────────────────────────────────────────────────────
test.describe('Engine: body segment cap', () => {
  test('body is capped at MAX_BODY_SEGS even with huge score', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, MAX_BODY_SEGS } = await import('/engine.js');
      if (!MAX_BODY_SEGS) return { skip: true };
      const eng = createEngine();
      eng.addPlayer('p1', 'Alice');
      const p = eng.players[0];
      // Force enormous score → targetLen would be huge without cap
      p.score = 100000;
      // Run a few steps so growth can process
      for (let i = 0; i < 5; i++) eng.step();
      return { bodyLen: p.body.length, cap: MAX_BODY_SEGS };
    });

    if (!result.skip) {
      expect(result.bodyLen).toBeLessThanOrEqual(result.cap);
    }
  });
});

// ── Bug: food unbounded ────────────────────────────────────────────────────────
test.describe('Engine: food count cap', () => {
  test('food is capped at MAX_FOOD_ITEMS even after scatter from large bodies', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, SPAWN_MS, MAX_FOOD_ITEMS, HEAD_ON_R } = await import('/engine.js');
      if (!MAX_FOOD_ITEMS) return { skip: true };
      const eng = createEngine();
      // Two players with large bodies; kill via head-on collision.
      eng.addPlayer('p1', 'A');
      eng.addPlayer('p2', 'B');
      const [p1, p2] = eng.players;
      // Grow bodies to near cap to maximise scatter food on death.
      while (p1.body.length < 400) p1.body.push([...p1.body[p1.body.length - 1]]);
      while (p2.body.length < 400) p2.body.push([...p2.body[p2.body.length - 1]]);
      p1.spawnTime = Date.now() - SPAWN_MS - 100;
      p2.spawnTime = Date.now() - SPAWN_MS - 100;
      // Force heads together for a head-on kill.
      p1.body[0] = [2000, 2000];
      p2.body[0] = [2000 + HEAD_ON_R - 5, 2000];
      eng.step();
      return { foodLen: eng.food.length, cap: MAX_FOOD_ITEMS, p1Alive: p1.alive, p2Alive: p2.alive };
    });

    if (!result.skip) {
      expect(result.p1Alive).toBe(false);
      expect(result.p2Alive).toBe(false);
      expect(result.foodLen).toBeLessThanOrEqual(result.cap);
    }
  });
});

// ── Bug: body segment spacing shrinks to ~40px ─────────────────────────────────
test.describe('Engine: body segment spacing', () => {
  test('segments stay near SEG_DIST after many steps', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, SEG_DIST } = await import('/engine.js');
      const eng = createEngine();
      eng.addPlayer('p1', 'Alice');
      const p = eng.players[0];
      // Run 100 steps (well past the initial state)
      for (let i = 0; i < 100; i++) eng.step();

      // Check spacing between consecutive segments
      const body = p.body;
      let minDist = Infinity, maxDist = 0;
      for (let i = 1; i < body.length; i++) {
        const dx = body[i][0] - body[i-1][0], dy = body[i][1] - body[i-1][1];
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < minDist) minDist = d;
        if (d > maxDist) maxDist = d;
      }
      return { minDist, maxDist, SEG_DIST, bodyLen: body.length };
    });

    // After 100 steps, spacing should be close to SEG_DIST (within generous tolerance)
    // Before fix: max spacing would be ~9 but min could be ~2.8 (compressed)
    // After fix: all spacings should be near SEG_DIST
    expect(result.minDist).toBeGreaterThan(result.SEG_DIST * 0.5);
    expect(result.maxDist).toBeLessThan(result.SEG_DIST * 2.0);
    expect(result.bodyLen).toBe(14); // INIT_SEGS when score=0
  });
});

// ── Bug: death burst lost between 30Hz step and 12Hz snapshot ─────────────────
test.describe('Engine: death burst persistence', () => {
  test('burst from step N is included in snapshot called at step N+2', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, SPAWN_MS } = await import('/engine.js');
      const eng = createEngine();
      eng.addPlayer('p1', 'Alice');
      eng.addPlayer('p2', 'Bob');

      const p1 = eng.players[0];
      const p2 = eng.players[1];
      p1.spawnTime = Date.now() - SPAWN_MS - 100;
      p2.spawnTime = Date.now() - SPAWN_MS - 100;

      // Force p1 head onto p2 body
      p1.body[0] = [...p2.body[5]];
      p1.angle = 0; p1.inputAngle = 0;

      // Step (death occurs here)
      eng.step();

      // Step 2 more times without calling snapshot (simulating 30Hz vs 12Hz)
      eng.step();
      eng.step();

      // Now take a snapshot — burst should still be present
      const snap = eng.snapshot();
      return {
        burstCount: snap.bursts.length,
        anyBursts: snap.bursts.length > 0,
      };
    });

    expect(result.anyBursts).toBe(true);
  });
});

// ── Bug: 10 players + full food snapshot must fit in 256KiB ───────────────────
test.describe('Engine: snapshot size with full load', () => {
  test('10 players at max body + max food encodes under 256KiB', async ({ page }) => {
    await page.goto(PAGE_URL());

    const result = await page.evaluate(async () => {
      const { createEngine, MAX_BODY_SEGS, MAX_FOOD_ITEMS, PLAYER_COLORS } = await import('/engine.js');
      if (!MAX_BODY_SEGS || !MAX_FOOD_ITEMS) return { skip: true };
      const eng = createEngine();
      for (let i = 0; i < 10; i++) eng.addPlayer('p' + i, 'Player' + i);
      // Force all players to max body
      for (const p of eng.players) {
        while (p.body.length < MAX_BODY_SEGS) p.body.push([...p.body[p.body.length - 1]]);
      }
      // Force max food
      while (eng.food.length < MAX_FOOD_ITEMS) {
        eng.food.push({ id: eng.food.length + 9000, x: 100, y: 100, color: PLAYER_COLORS[0], value: 1 });
      }
      const snap = eng.snapshot();
      const json = JSON.stringify(snap);
      return { bytes: json.length, limit: 262144 };
    });

    if (!result.skip) {
      expect(result.bytes).toBeLessThan(result.limit);
    }
  });
});
