import type { Page } from "playwright";

/**
 * Aliyun puzzle captcha solver for Qwen "Access Verification".
 *
 * Policy:
 * - Capture the captcha currently on screen
 * - Solve it with vision + live slider correction
 * - NEVER click refresh / reload the captcha
 *
 * page.evaluate must use STRING scripts (tsx injects __name into function bodies).
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CaptchaSolveResult {
  ok: boolean;
  attempts: number;
  offsetPx?: number;
  confidence?: number;
  error?: string;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function pageText(page: Page): Promise<string> {
  return (await page.locator("body").innerText().catch(() => "")) || "";
}

export async function isAccessVerificationVisible(page: Page): Promise<boolean> {
  const text = await pageText(page);
  if (
    /access verification|verify that you are a real person|verification failed|complete the operation to verify/i.test(
      text,
    )
  ) {
    return true;
  }
  return (
    (await page
      .locator(
        "#aliyunCaptcha-window-float, #aliyunCaptcha-sliding-slider, #aliyunCaptcha-puzzle",
      )
      .count()) > 0
  );
}

export async function isCaptchaFailed(page: Page): Promise<boolean> {
  const text = await pageText(page);
  return /verification failed|try again|falha na verifica|tente novamente/i.test(
    text,
  );
}

type PuzzleGeometry = {
  ready: boolean;
  missing: string[];
  gapXNatural: number;
  confidence: number;
  targetDisplayX: number;
  puzzleLeft: number;
  imgBox: { x: number; y: number; width: number; height: number };
  slider: { x: number; y: number; width: number; height: number };
  maxTravel: number;
  bgSrc?: string;
};

async function waitPuzzleReady(
  page: Page,
  timeoutMs = 12_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(`(() => {
      const vis = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      };
      const imgOk = (el) => vis(el) && !!(el.currentSrc || el.src) && el.complete !== false && (el.naturalWidth || 0) > 0;
      const bg = document.getElementById('aliyunCaptcha-img');
      const pz = document.getElementById('aliyunCaptcha-puzzle');
      const slider = document.getElementById('aliyunCaptcha-sliding-slider');
      return imgOk(bg) && imgOk(pz) && vis(slider);
    })()`);
    if (ready) return true;
    await sleep(200);
  }
  return false;
}

/**
 * Analyze the currently visible captcha only (no refresh).
 */
async function analyzePuzzle(page: Page): Promise<PuzzleGeometry | null> {
  const result = await page.evaluate(`(async () => {
    const visibleRect = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const imageReady = (el) => {
      if (!el) return false;
      return visibleRect(el) && !!(el.currentSrc || el.src) && el.complete !== false && (el.naturalWidth || 0) > 0;
    };

    const bgImg = document.getElementById('aliyunCaptcha-img');
    const pzImg = document.getElementById('aliyunCaptcha-puzzle');
    const imgBox = document.getElementById('aliyunCaptcha-img-box');
    const slider = document.getElementById('aliyunCaptcha-sliding-slider');
    const track =
      document.getElementById('aliyunCaptcha-sliding-body') ||
      document.getElementById('aliyunCaptcha-sliding-text')?.parentElement ||
      (slider && slider.parentElement);

    const missing = [];
    if (!imageReady(bgImg)) missing.push('background');
    if (!imageReady(pzImg)) missing.push('puzzle');
    if (!visibleRect(slider)) missing.push('slider');
    if (missing.length) {
      return {
        ready: false,
        missing,
        gapXNatural: 0,
        confidence: 0,
        targetDisplayX: 0,
        puzzleLeft: 0,
        imgBox: { x: 0, y: 0, width: 0, height: 0 },
        slider: { x: 0, y: 0, width: 0, height: 0 },
        maxTravel: 0,
        bgSrc: '',
      };
    }

    const loadToCanvas = async (imgEl) => {
      const w = imgEl.naturalWidth || imgEl.width;
      const h = imgEl.naturalHeight || imgEl.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no canvas');
      try {
        ctx.drawImage(imgEl, 0, 0, w, h);
        return { w, h, data: ctx.getImageData(0, 0, w, h).data };
      } catch (e) {
        const src = imgEl.currentSrc || imgEl.src;
        const resp = await fetch(src, { credentials: 'include', mode: 'cors' }).catch(() => fetch(src));
        if (!resp || !resp.ok) throw new Error('fetch img failed');
        const blob = await resp.blob();
        const bmp = await createImageBitmap(blob);
        const cleanCanvas = document.createElement('canvas');
        cleanCanvas.width = w;
        cleanCanvas.height = h;
        const cleanCtx = cleanCanvas.getContext('2d', { willReadFrequently: true });
        if (!cleanCtx) throw new Error('no clean canvas');
        cleanCtx.drawImage(bmp, 0, 0, w, h);
        bmp.close();
        return { w, h, data: cleanCtx.getImageData(0, 0, w, h).data };
      }
    };

    let bg, pz;
    try {
      bg = await loadToCanvas(bgImg);
      pz = await loadToCanvas(pzImg);
    } catch (e) {
      return {
        ready: false,
        missing: ['image-bytes:' + String((e && e.message) || e)],
        gapXNatural: 0,
        confidence: 0,
        targetDisplayX: 0,
        puzzleLeft: 0,
        imgBox: { x: 0, y: 0, width: 0, height: 0 },
        slider: { x: 0, y: 0, width: 0, height: 0 },
        maxTravel: 0,
        bgSrc: '',
      };
    }

    // Piece bounds from alpha channel
    let left = pz.w, top = pz.h, right = 0, bottom = 0, alphaCount = 0;
    for (let y = 0; y < pz.h; y++) {
      for (let x = 0; x < pz.w; x++) {
        const a = pz.data[(y * pz.w + x) * 4 + 3];
        if (a > 20) {
          alphaCount++;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (alphaCount < 20) {
      left = 0; top = 0; right = pz.w - 1; bottom = pz.h - 1;
    }
    const pieceW = Math.max(8, right - left + 1);

    // Grayscale + Sobel edges on background
    const gray = new Float32Array(bg.w * bg.h);
    for (let i = 0; i < bg.w * bg.h; i++) {
      const o = i * 4;
      gray[i] = 0.299 * bg.data[o] + 0.587 * bg.data[o + 1] + 0.114 * bg.data[o + 2];
    }
    const edges = new Float32Array(bg.w * bg.h);
    for (let y = 1; y < bg.h - 1; y++) {
      for (let x = 1; x < bg.w - 1; x++) {
        const gx =
          -gray[(y - 1) * bg.w + (x - 1)] + gray[(y - 1) * bg.w + (x + 1)] +
          -2 * gray[y * bg.w + (x - 1)] + 2 * gray[y * bg.w + (x + 1)] +
          -gray[(y + 1) * bg.w + (x - 1)] + gray[(y + 1) * bg.w + (x + 1)];
        const gy =
          -gray[(y - 1) * bg.w + (x - 1)] - 2 * gray[(y - 1) * bg.w + x] - gray[(y - 1) * bg.w + (x + 1)] +
          gray[(y + 1) * bg.w + (x - 1)] + 2 * gray[(y + 1) * bg.w + x] + gray[(y + 1) * bg.w + (x + 1)];
        edges[y * bg.w + x] = Math.sqrt(gx * gx + gy * gy);
      }
    }

    // Contour points of piece
    const contour = [];
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const a = pz.data[(y * pz.w + x) * 4 + 3];
        if (a <= 20) continue;
        let boundary = false;
        for (let oy = -1; oy <= 1 && !boundary; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const nx = x + ox, ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= pz.w || ny >= pz.h) { boundary = true; break; }
            if (pz.data[(ny * pz.w + nx) * 4 + 3] <= 20) { boundary = true; break; }
          }
        }
        if (boundary) contour.push(x - left, y);
      }
    }
    const sampled = [];
    for (let i = 0; i < contour.length; i += 2) {
      if ((i / 2) % 2 === 0) sampled.push(contour[i], contour[i + 1]);
    }
    if (sampled.length < 8) {
      for (let y = top; y <= bottom; y += 2) {
        for (let x = left; x <= right; x += 2) {
          if (pz.data[(y * pz.w + x) * 4 + 3] > 20) sampled.push(x - left, y);
        }
      }
    }

    // Ensemble: contour-edge + darker hole score
    const maxOx = Math.max(10, bg.w - pieceW - 2);
    let bestX = 10;
    let bestScore = -Infinity;
    const scores = [];
    for (let ox = 10; ox <= maxOx; ox++) {
      let edgeSum = 0, brightSum = 0, brightSq = 0, n = 0;
      for (let k = 0; k < sampled.length; k += 2) {
        const bx = ox + sampled[k];
        const by = sampled[k + 1];
        if (bx <= 0 || bx >= bg.w - 1 || by <= 0 || by >= bg.h - 1) continue;
        edgeSum += edges[by * bg.w + bx];
        const g = gray[by * bg.w + bx];
        brightSum += g;
        brightSq += g * g;
        n++;
      }
      if (!n) continue;
      const meanB = brightSum / n;
      const stdB = Math.sqrt(Math.max(0, brightSq / n - meanB * meanB));
      const meanE = edgeSum / n;
      // Gap hole: high edge alignment at contour, lower texture variance, slightly darker
      const score = meanE * 1.15 - stdB * 0.4 - meanB * 0.1;
      scores.push([ox, score]);
      if (score > bestScore) {
        bestScore = score;
        bestX = ox;
      }
    }

    // Local refine
    const refineFrom = Math.max(10, bestX - 8);
    const refineTo = Math.min(maxOx, bestX + 8);
    for (let ox = refineFrom; ox <= refineTo; ox++) {
      let edgeSum = 0, brightSum = 0, brightSq = 0, n = 0;
      for (let k = 0; k < sampled.length; k += 2) {
        const bx = ox + sampled[k];
        const by = sampled[k + 1];
        if (bx <= 0 || bx >= bg.w - 1 || by <= 0 || by >= bg.h - 1) continue;
        edgeSum += edges[by * bg.w + bx];
        const g = gray[by * bg.w + bx];
        brightSum += g;
        brightSq += g * g;
        n++;
      }
      if (!n) continue;
      const meanB = brightSum / n;
      const stdB = Math.sqrt(Math.max(0, brightSq / n - meanB * meanB));
      const meanE = edgeSum / n;
      const score = meanE * 1.15 - stdB * 0.4 - meanB * 0.1;
      if (score > bestScore) {
        bestScore = score;
        bestX = ox;
      }
    }

    const imgBoxRect = (imgBox || bgImg).getBoundingClientRect();
    const pzRect = pzImg.getBoundingClientRect();
    const sliderRect = slider.getBoundingClientRect();
    const trackRect = (track || slider.parentElement).getBoundingClientRect();
    const maxTravel = Math.max(20, trackRect.width - sliderRect.width - 2);

    const scaleX = imgBoxRect.width / Math.max(1, bg.w);
    // bestX is where piece content should align; subtract piece's internal left padding
    const targetLeftNatural = Math.max(0, bestX - left);
    const targetDisplayX = targetLeftNatural * scaleX;

    scores.sort((a, b) => b[1] - a[1]);
    const second = scores[1] ? scores[1][1] : bestScore - 1;
    const confidence = Math.max(
      0,
      Math.min(1, (bestScore - second) / Math.max(1, Math.abs(bestScore)) + 0.4),
    );

    return {
      ready: true,
      missing: [],
      gapXNatural: bestX,
      confidence,
      targetDisplayX,
      puzzleLeft: pzRect.left,
      imgBox: {
        x: imgBoxRect.x,
        y: imgBoxRect.y,
        width: imgBoxRect.width,
        height: imgBoxRect.height,
      },
      slider: {
        x: sliderRect.x,
        y: sliderRect.y,
        width: sliderRect.width,
        height: sliderRect.height,
      },
      maxTravel,
      bgSrc: String(bgImg.currentSrc || bgImg.src || ''),
    };
  })()`);

  return result as PuzzleGeometry | null;
}

async function readPuzzleLeft(page: Page): Promise<number | null> {
  const left = await page.evaluate(`(() => {
    const el = document.getElementById('aliyunCaptcha-puzzle');
    if (!el) return null;
    const inlineLeft = Number.parseFloat(el.style.left);
    if (Number.isFinite(inlineLeft)) return inlineLeft;
    const computedLeft = Number.parseFloat(getComputedStyle(el).left);
    return Number.isFinite(computedLeft) ? computedLeft : null;
  })()`);
  return typeof left === "number" ? left : null;
}

async function resetSliderIfNeeded(page: Page): Promise<void> {
  // Soft reset: release any stuck mouse and click track start area without refresh button
  try {
    await page.mouse.up().catch(() => {});
  } catch {
    // ignore
  }
  await sleep(120);
}

async function humanDragWithLiveCorrection(
  page: Page,
  startX: number,
  startY: number,
  targetPuzzleLeft: number,
  maxTravel: number,
  biasPx = 0,
): Promise<number> {
  await page.mouse.move(startX, startY, { steps: 5 });
  await sleep(rand(90, 160));
  await page.mouse.down();
  await sleep(rand(60, 120));

  const initialLeft = (await readPuzzleLeft(page)) ?? targetPuzzleLeft - 120;
  let estimated = Math.max(
    12,
    Math.min(maxTravel, targetPuzzleLeft - initialLeft + biasPx),
  );
  // Aliyun slider travel is usually a bit longer than pure geometry
  estimated = Math.min(maxTravel, estimated * 1.03 + 3);

  const steps = 30 + Math.floor(Math.random() * 8);
  let curX = startX;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = 1 - Math.pow(1 - t, 3);
    curX =
      startX +
      estimated * eased +
      Math.sin(t * Math.PI * 2) * rand(0.1, 0.55);
    const y = startY + Math.sin(t * Math.PI) * rand(-0.8, 0.8);
    await page.mouse.move(curX, y, { steps: 1 });
    await sleep(rand(7, 18));
  }

  // Live correction while still holding
  for (let i = 0; i < 14; i++) {
    const left = await readPuzzleLeft(page);
    if (left == null) break;
    const err = targetPuzzleLeft - left;
    if (Math.abs(err) <= 0.9) break;
    const step = Math.max(-6, Math.min(6, err * 0.9));
    curX = Math.max(startX, Math.min(startX + maxTravel, curX + step));
    await page.mouse.move(curX, startY + rand(-0.3, 0.3), { steps: 2 });
    await sleep(rand(16, 34));
  }

  // Final micro align
  for (let i = 0; i < 4; i++) {
    const left = await readPuzzleLeft(page);
    if (left == null) break;
    const err = targetPuzzleLeft - left;
    if (Math.abs(err) <= 0.45) break;
    curX = Math.max(startX, Math.min(startX + maxTravel, curX + err));
    await page.mouse.move(curX, startY, { steps: 1 });
    await sleep(rand(18, 36));
  }

  await sleep(rand(80, 150));
  await page.mouse.up();
  return curX - startX;
}

async function waitCaptchaOutcome(
  page: Page,
  timeoutMs: number,
): Promise<"success" | "failed" | "pending"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isCaptchaFailed(page)) return "failed";
    if (!(await isAccessVerificationVisible(page))) return "success";

    const sliderVisible = await page
      .locator("#aliyunCaptcha-sliding-slider")
      .first()
      .isVisible()
      .catch(() => false);
    const text = await pageText(page);
    if (
      !sliderVisible &&
      !/access verification|verification failed/i.test(text)
    ) {
      return "success";
    }
    // success sometimes leaves modal briefly without failure text
    if (
      /pendente de ativa|pending activation|check your email|verifique/i.test(
        text,
      ) &&
      !/verification failed/i.test(text)
    ) {
      return "success";
    }
    await sleep(300);
  }
  if (await isCaptchaFailed(page)) return "failed";
  if (!(await isAccessVerificationVisible(page))) return "success";
  return "pending";
}

/**
 * Capture the captcha currently on screen and solve it.
 * Does NOT click refresh / reload.
 */
export async function solveAliyunPuzzleCaptcha(
  page: Page,
  options: {
    maxAttempts?: number;
    onAttempt?: (info: {
      attempt: number;
      offsetPx?: number;
      confidence?: number;
      status: string;
    }) => void;
  } = {},
): Promise<CaptchaSolveResult> {
  // Few attempts on the SAME captcha (re-drag with bias), never refresh.
  const maxAttempts = options.maxAttempts ?? 4;

  if (!(await isAccessVerificationVisible(page))) {
    return { ok: true, attempts: 0 };
  }

  const ready = await waitPuzzleReady(page, 12_000);
  if (!ready) {
    return {
      ok: false,
      attempts: 0,
      error: "Captcha na tela ainda não está pronto (imagens/slider)",
    };
  }

  // Capture once — prefer reusing analysis; re-analyze only if still same screen
  let lastBias = 0;
  let lastBgSrc = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    options.onAttempt?.({
      attempt,
      status: "capturando captcha atual da tela…",
    });

    await resetSliderIfNeeded(page);
    await sleep(250);

    let geo: PuzzleGeometry | null = null;
    try {
      geo = await analyzePuzzle(page);
    } catch (err) {
      options.onAttempt?.({
        attempt,
        status: `falha ao capturar: ${err instanceof Error ? err.message : String(err)}`,
      });
      await sleep(400);
      continue;
    }

    if (!geo?.ready) {
      options.onAttempt?.({
        attempt,
        status: `captcha incompleto: ${(geo?.missing || ["unknown"]).join(",")}`,
      });
      await sleep(500);
      continue;
    }

    // If Aliyun itself changed the image after a failed drag, just solve the new one
    // (still no manual refresh click from us).
    if (geo.bgSrc && lastBgSrc && geo.bgSrc !== lastBgSrc) {
      lastBias = 0;
      options.onAttempt?.({
        attempt,
        status: "nova imagem detectada (sem refresh manual) — resolvendo",
      });
    }
    lastBgSrc = geo.bgSrc || lastBgSrc;

    const slider = page.locator("#aliyunCaptcha-sliding-slider").first();
    const box = await slider.boundingBox();
    if (!box) {
      options.onAttempt?.({ attempt, status: "slider sem bounding box" });
      continue;
    }

    const targetPuzzleLeft = geo.targetDisplayX;
    const startX = box.x + Math.min(14, box.width / 2);
    const startY = box.y + box.height / 2;

    options.onAttempt?.({
      attempt,
      offsetPx: Math.round(geo.targetDisplayX + lastBias),
      confidence: geo.confidence,
      status: `resolvendo captcha atual · gap=${geo.gapXNatural} · conf=${(geo.confidence * 100).toFixed(0)}% · bias=${lastBias.toFixed(1)}`,
    });

    const traveled = await humanDragWithLiveCorrection(
      page,
      startX,
      startY,
      targetPuzzleLeft,
      geo.maxTravel,
      lastBias,
    );

    const outcome = await waitCaptchaOutcome(page, 4_500);
    if (outcome === "success") {
      return {
        ok: true,
        attempts: attempt,
        offsetPx: Math.round(traveled),
        confidence: geo.confidence,
      };
    }

    if (outcome === "failed") {
      // Do NOT refresh. Adjust bias and re-drag the captcha currently shown.
      // Alternate undershoot/overshoot corrections.
      const sign = attempt % 2 === 0 ? -1 : 1;
      lastBias += sign * (4 + attempt * 2);
      options.onAttempt?.({
        attempt,
        offsetPx: Math.round(traveled),
        confidence: geo.confidence,
        status: `falhou no captcha atual — reajustando arraste (sem recarregar) bias=${lastBias.toFixed(1)}`,
      });
      await sleep(500);
      continue;
    }

    // pending: still visible, try one more micro correction bias
    lastBias += 3;
    options.onAttempt?.({
      attempt,
      offsetPx: Math.round(traveled),
      confidence: geo.confidence,
      status: "ainda na tela — nova tentativa no mesmo captcha",
    });
    await sleep(400);
  }

  return {
    ok: false,
    attempts: maxAttempts,
    error:
      "Não resolveu o captcha atual após tentativas de arraste (sem recarregar a imagem)",
  };
}
