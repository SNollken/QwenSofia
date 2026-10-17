import type { Page } from "playwright";

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function gaussianRandom(rng: () => number): number {
  let u = 0,
    v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function logNormalDelay(
  rng: () => number,
  minMs: number,
  maxMs: number,
): number {
  const mu = Math.log((minMs + maxMs) / 2);
  const sigma = 0.4;
  const val = Math.exp(mu + sigma * gaussianRandom(rng));
  return Math.max(minMs, Math.min(maxMs, Math.round(val)));
}

function cubicBezier(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const mt = 1 - t;
  return (
    mt * mt * mt * p0 +
    3 * mt * mt * t * p1 +
    3 * mt * t * t * p2 +
    t * t * t * p3
  );
}

let globalSeed = Date.now();
function simpleRng(): number {
  globalSeed = (globalSeed * 1103515245 + 12345) & 0x7fffffff;
  return globalSeed / 0x7fffffff;
}

export function humanDelay(
  minMs: number,
  maxMs: number,
  rng: () => number = simpleRng,
): number {
  return logNormalDelay(rng, minMs, maxMs);
}

export async function humanType(
  page: Page,
  selector: string,
  text: string,
): Promise<void> {
  await page.focus(selector);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (simpleRng() < 0.03 && i > 0) {
      const wrongChar = String.fromCharCode(97 + Math.floor(simpleRng() * 26));
      await page.keyboard.type(wrongChar, {
        delay: logNormalDelay(simpleRng, 40, 120),
      });
      await sleep(logNormalDelay(simpleRng, 100, 300));
      await page.keyboard.press("Backspace");
      await sleep(logNormalDelay(simpleRng, 80, 200));
    }

    if (simpleRng() < 0.15 && char !== " " && i > 0) {
      await page.keyboard.down("Shift");
      await page.keyboard.type(char.toUpperCase(), {
        delay: logNormalDelay(simpleRng, 30, 90),
      });
      await page.keyboard.up("Shift");
      await sleep(logNormalDelay(simpleRng, 20, 60));
      await page.keyboard.press("Backspace");
      await sleep(logNormalDelay(simpleRng, 50, 150));
    }

    await page.keyboard.type(char, {
      delay: logNormalDelay(simpleRng, 35, 110),
    });

    if (char === " " || char === "." || char === ",") {
      if (simpleRng() < 0.4) {
        await sleep(logNormalDelay(simpleRng, 150, 500));
      }
    }

    if (simpleRng() < 0.05) {
      await sleep(logNormalDelay(simpleRng, 200, 800));
    }
  }
}

export async function humanMouseMove(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  options: { overshoot?: number; steps?: number; pauseAt?: number[] } = {},
): Promise<void> {
  const {
    overshoot = 5 + Math.floor(simpleRng() * 15),
    steps = 20 + Math.floor(simpleRng() * 15),
    pauseAt = [0.3, 0.7],
  } = options;

  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const overshootX = toX + (dx > 0 ? overshoot : -overshoot);
  const overshootY = toY + (dy > 0 ? overshoot * 0.3 : -overshoot * 0.3);

  const cp1x = fromX + dx * 0.25 + gaussianRandom(simpleRng) * distance * 0.1;
  const cp1y = fromY + dy * 0.25 + gaussianRandom(simpleRng) * distance * 0.1;
  const cp2x = fromX + dx * 0.75 + gaussianRandom(simpleRng) * distance * 0.08;
  const cp2y = fromY + dy * 0.75 + gaussianRandom(simpleRng) * distance * 0.08;

  await page.mouse.move(fromX, fromY);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;

    let x: number, y: number;
    if (t < 0.85) {
      const adjustedT = t / 0.85;
      x = cubicBezier(fromX, cp1x, cp2x, overshootX, adjustedT);
      y = cubicBezier(fromY, cp1y, cp2y, overshootY, adjustedT);
    } else {
      const correctionT = (t - 0.85) / 0.15;
      x = overshootX + (toX - overshootX) * correctionT;
      y = overshootY + (toY - overshootY) * correctionT;
    }

    x += gaussianRandom(simpleRng) * 1.5;
    y += gaussianRandom(simpleRng) * 1.5;

    await page.mouse.move(x, y, { steps: 2 });

    const shouldPause = pauseAt.some((p) => Math.abs(t - p) < 0.05);
    if (shouldPause && simpleRng() < 0.6) {
      await sleep(logNormalDelay(simpleRng, 15, 50));
    }

    await sleep(logNormalDelay(simpleRng, 8, 25));
  }

  await page.mouse.move(toX, toY);
}

export async function subtlePageActivity(page: Page): Promise<void> {
  if (page.isClosed()) return;

  const viewport = page.viewportSize();
  if (!viewport) return;

  const x = Math.floor(viewport.width * (0.25 + Math.random() * 0.5));
  const y = Math.floor(viewport.height * (0.25 + Math.random() * 0.5));
  await page.mouse.move(x, y, { steps: 6 + Math.floor(Math.random() * 8) });

  if (Math.random() < 0.35) {
    await page.mouse.wheel(0, Math.random() < 0.5 ? 60 : -60).catch(() => {});
  }

  await page
    .evaluate(() => {
      try {
        const target = document.querySelector(
          '[data-testid="sidebar"], .sidebar, nav, aside, main',
        );
        if (target) {
          target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          target.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        }
      } catch {
        // Best-effort keep-alive only.
      }
    })
    .catch(() => {});
}
