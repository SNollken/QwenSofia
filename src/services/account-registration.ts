import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";
import { addAccount, removeAccount } from "../core/accounts.ts";
import { config } from "../core/config.ts";
import {
  accountHasCapturedHeaders,
  ensureAccountHeaders,
  initPlaywrightForAccount,
} from "./playwright.ts";
import {
  createTempMailbox,
  extractVerification,
  generateAccountPassword,
  generateDisplayName,
  listUrsaMessages,
  waitForTempMailOrgVerificationLink,
  waitForUrsaVerificationLink,
  waitForVerificationEmail,
  type TempMailbox,
} from "./temp-mail.ts";
import {
  isAccessVerificationVisible,
  isCaptchaFailed,
} from "./aliyun-captcha-solver.ts";

export type RegistrationState =
  | "queued"
  | "preparing-email"
  | "opening-browser"
  | "filling-form"
  | "solving-captcha"
  | "pending_activation"
  | "waiting-verification"
  | "applying-verification"
  | "capturing-session"
  | "authenticating"
  | "completed"
  | "failed";

export interface RegistrationJob {
  id: string;
  email: string;
  state: RegistrationState;
  message: string;
  createdAt: number;
  updatedAt: number;
  accountId?: string;
  ready?: boolean;
  error?: string;
  provider?: string;
  verificationCode?: string;
  hasCookies?: boolean;
}

export interface RegistrationRequest {
  email?: string;
  password?: string;
  displayName?: string;
  useTempEmail?: boolean;
}

export interface ManualCaptchaPoint {
  x: number;
  y: number;
  t: number;
}

export interface ManualCaptchaDrag {
  points: ManualCaptchaPoint[];
}

export interface ManualCaptchaPointer {
  phase: "start" | "move" | "end" | "cancel";
  point?: ManualCaptchaPoint;
}

type ManualCaptchaBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ManualCaptchaSession = {
  captcha: Locator;
  page: Page;
  submittedAt?: number;
  submitting: boolean;
  pointerBox?: ManualCaptchaBox;
  pointerInputStart?: { x: number; y: number };
  pointerMouseStart?: { x: number; y: number };
  pointerDown: boolean;
  pointerQueue: Promise<void>;
};

const jobs = new Map<string, RegistrationJob>();
const manualCaptchaSessions = new Map<string, ManualCaptchaSession>();
const MAX_JOB_AGE_MS = 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function publicJob(job: RegistrationJob): RegistrationJob {
  return { ...job };
}

function setJob(
  job: RegistrationJob,
  state: RegistrationState,
  message: string,
  error?: string,
): void {
  job.state = state;
  job.message = message;
  job.updatedAt = Date.now();
  job.error = error;
  console.log(
    `🧾 [Registration] ${job.id.slice(0, 8)} | ${state} | ${message}`,
  );
}

function pruneJobs(): void {
  const cutoff = Date.now() - MAX_JOB_AGE_MS;
  for (const [id, job] of jobs) {
    if (job.updatedAt < cutoff) jobs.delete(id);
  }
}

export function listRegistrationJobs(): RegistrationJob[] {
  pruneJobs();
  return [...jobs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicJob);
}

export function getRegistrationJob(id: string): RegistrationJob | undefined {
  const job = jobs.get(id);
  return job ? publicJob(job) : undefined;
}

export async function clickByText(
  page: Page,
  texts: string[],
): Promise<boolean> {
  for (const text of texts) {
    const loc = page.getByText(text, { exact: false }).first();
    if (await loc.isVisible().catch(() => false)) {
      try {
        await loc.click({ timeout: 5_000 });
        return true;
      } catch {
      }
    }
  }
  return false;
}

export async function clickSignupSwitch(page: Page): Promise<boolean> {
  const signupSwitch = page
    .locator(".qwenchat-auth-pc-switch-button")
    .filter({
      hasText:
        /Inscrever-se|Inscrever|Sign up|Create account|Cadastrar|Registrar/i,
    })
    .first();
  if (await signupSwitch.isVisible().catch(() => false)) {
    try {
      await signupSwitch.evaluate((element) => {
        (element as HTMLElement).click();
      });
      return true;
    } catch {
    }
  }

  return clickByText(page, [
    "Inscrever-se",
    "Inscrever",
    "Sign up",
    "Create account",
    "Cadastrar",
    "Registrar",
  ]);
}

export async function fillByName(
  page: Page,
  name: string,
  value: string,
): Promise<boolean> {
  const selector = `input[name="${name}"]`;
  if (!(await page.locator(selector).count())) return false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const field = page.locator(`${selector}:visible`).first();
    try {
      await field.waitFor({ state: "visible", timeout: 5_000 });
      await field.fill(value, { timeout: 5_000 });
      await field.evaluate(
        (element, nextValue) => {
          const input = element as HTMLInputElement;
          const proto = Object.getPrototypeOf(input);
          const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
          descriptor?.set?.call(input, nextValue);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        },
        value,
        { timeout: 5_000 },
      );
      if ((await field.inputValue({ timeout: 5_000 })) === value) return true;
    } catch {
    }
    await sleep(300);
  }

  return false;
}

async function collectSessionSignal(page: Page): Promise<{
  cookieCount: number;
  hasAuthCookie: boolean;
  localToken: string;
  url: string;
}> {
  const cookies = await page.context().cookies();
  const hasAuthCookie = cookies.some(
    (c) =>
      /token|session|auth|acw_tc|tfstk|cna|isg|sca|ssxmod/i.test(c.name) &&
      Boolean(c.value),
  );
  const localToken = await page
    .evaluate(() => {
      try {
        return (
          localStorage.getItem("qwen_token") ||
          localStorage.getItem("access_token") ||
          localStorage.getItem("token") ||
          ""
        );
      } catch {
        return "";
      }
    })
    .catch(() => "");
  return {
    cookieCount: cookies.length,
    hasAuthCookie,
    localToken,
    url: page.url(),
  };
}

async function pageShowsActivationPending(page: Page): Promise<boolean> {
  const text = await page.locator("body").innerText().catch(() => "");
  return /pendente de ativa|pending activation|ative a sua conta|activate your account|e-mail de verifica|verification email|verifique o seu e-mail|check your email|reenviar e-mail|resend email/i.test(
    text,
  );
}

async function pageShowsAccessVerification(page: Page): Promise<boolean> {
  const text = await page.locator("body").innerText().catch(() => "");
  return /access verification|verify that you are a real person|complete the operation to verify|segurança|security verification|human verification|verifica(?:r|ção) de (?:acesso|segurança)/i.test(
    text,
  );
}

async function openActivationLink(
  page: Page,
  job: RegistrationJob,
  link: string,
): Promise<void> {
  // Open verification link in a NEW tab of the SAME browser.
  // Do NOT navigate away from the Qwen "pending activation" confirmation screen.
  setJob(
    job,
    "applying-verification",
    `Abrindo link de verificação em nova aba (sem sair da tela de confirmação): ${link.slice(0, 90)}…`,
  );

  const ctx = page.context();
  const verifyPage = await ctx.newPage();
  try {
    await verifyPage.goto(link, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await sleep(2_500);

    for (const label of [
      "Ativar",
      "Activate",
      "Verify",
      "Verificar",
      "Confirm",
      "Confirmar",
      "Continue",
      "Continuar",
    ]) {
      const btn = verifyPage
        .getByRole("button", { name: new RegExp(label, "i") })
        .first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        await sleep(1_000);
      }
      const linkBtn = verifyPage.getByText(label, { exact: false }).first();
      if (await linkBtn.isVisible().catch(() => false)) {
        await linkBtn.click().catch(() => {});
      }
    }
    await sleep(2_000);
  } finally {
    // keep browser open; closing only the verification tab is fine
    await verifyPage.close().catch(() => {});
  }

  // Stay on the original Qwen confirmation tab and click "Verifique novamente"
  await page.bringToFront().catch(() => {});
  await sleep(1_000);
  if (await pageShowsActivationPending(page)) {
    await clickByText(page, [
      "Verifique novamente",
      "Check again",
      "Refresh",
    ]).catch(() => false);
    await sleep(2_000);
  }
}


async function clickResendActivation(page: Page): Promise<boolean> {
  // Qwen pending screen: "Reenviar e-mail" / "Verifique novamente"
  const labels = [
    "Reenviar e-mail",
    "Reenviar",
    "Resend email",
    "Resend",
    "Verifique novamente",
    "Check again",
  ];
  for (const label of labels) {
    const btn = page.getByText(label, { exact: false }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await sleep(1_500);
      return true;
    }
  }
  return false;
}

/**
 * Open mail.tm in a second tab of the SAME browser, login with mailbox credentials,
 * open first message and extract activation link from DOM/HTML.
 */
async function scrapeMailTmInboxInBrowser(
  page: Page,
  job: RegistrationJob,
  mailbox: TempMailbox,
): Promise<string | undefined> {
  if (mailbox.provider !== "mail.tm" || !mailbox.password) return undefined;

  setJob(
    job,
    "pending_activation",
    "Inbox API vazia — abrindo mail.tm no mesmo navegador para buscar o link…",
  );

  const ctx = page.context();
  const inbox = await ctx.newPage();
  try {
    await inbox.goto("https://mail.tm/", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await sleep(2_000);

    // Try login UI (mail.tm SPA). Multiple selector strategies.
    // Open login if needed
    await inbox.getByText(/login|entrar|sign in/i).first().click({ timeout: 5_000 }).catch(() => {});
    await sleep(1_000);

    const emailSel = inbox.locator(
      'input[type="email"], input[name="address"], input[name="email"], input[placeholder*="mail" i]',
    ).first();
    const passSel = inbox.locator(
      'input[type="password"], input[name="password"]',
    ).first();

    if (await emailSel.isVisible().catch(() => false)) {
      await emailSel.fill(mailbox.email);
      await passSel.fill(mailbox.password || "");
      await inbox
        .locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Entrar")')
        .first()
        .click()
        .catch(async () => {
          await inbox.keyboard.press("Enter");
        });
      await sleep(3_000);
    } else {
      // Fallback: use API token in localStorage if page supports it
      if (mailbox.token) {
        await inbox.evaluate((token) => {
          try {
            localStorage.setItem("token", token);
            localStorage.setItem("authToken", token);
          } catch {}
        }, mailbox.token);
        await inbox.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
        await sleep(2_000);
      }
    }

    // Click first message-looking item
    const candidates = [
      'a[href*="message"]',
      '[class*="message"]',
      'li',
      'article',
      'div[role="listitem"]',
    ];
    for (const sel of candidates) {
      const items = inbox.locator(sel);
      const n = await items.count();
      for (let i = 0; i < Math.min(n, 8); i++) {
        const it = items.nth(i);
        const txt = ((await it.innerText().catch(() => "")) || "").toLowerCase();
        if (!txt) continue;
        if (/qwen|verify|activa|confirma|security|valid/.test(txt) || txt.length > 10) {
          await it.click().catch(() => {});
          await sleep(1_500);
          break;
        }
      }
    }

    // Extract link from opened message DOM
    const html = await inbox.content().catch(() => "");
    const bodyText = await inbox.locator("body").innerText().catch(() => "");
    const extracted = extractVerification({
      id: "browser-inbox",
      subject: "",
      from: "",
      text: bodyText,
      html,
    });
    if (extracted.link) {
      setJob(
        job,
        "applying-verification",
        `Link encontrado no mail.tm web: ${extracted.link.slice(0, 90)}…`,
      );
      return extracted.link;
    }

    // also scan anchors
    const hrefs = await inbox.$$eval("a[href]", (as) =>
      as.map((a) => (a as HTMLAnchorElement).href).filter(Boolean),
    );
    for (const href of hrefs) {
      if (/qwen|verify|activ|confirm|token=/i.test(href)) {
        return href;
      }
    }
  } catch (err) {
    setJob(
      job,
      "pending_activation",
      `Falha ao abrir mail.tm no browser: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    // Keep browser open: do not close context; closing only the inbox tab is OK
    await inbox.close().catch(() => {});
  }
  return undefined;
}

async function pageLooksAuthenticated(page: Page): Promise<boolean> {
  // Account still on explicit pending-activation banner is NOT ready.
  if (await pageShowsActivationPending(page)) return false;

  const signal = await collectSessionSignal(page);
  if (signal.localToken) return true;

  const url = signal.url;
  const onQwen =
    /chat\.qwen\.ai|qwen\.ai/i.test(url) &&
    !/\/auth|\/login|\/signup|\/register/i.test(url);

  // Real chat shell signals (logged-in home: "Qual é o plano...", Nova Conversa, composer)
  const chatShell = await page
    .locator(
      [
        'textarea',
        '[contenteditable="true"]',
        'button:has-text("Nova Conversa")',
        'button:has-text("New chat")',
        'button:has-text("Novo chat")',
        'text=/Qual é o plano para hoje/i',
        'text=/How can I help/i',
        'text=/Como posso ajud/i',
        '[placeholder*="ajud" i]',
        '[placeholder*="help" i]',
      ].join(", "),
    )
    .first()
    .isVisible()
    .catch(() => false);

  if (chatShell) return true;
  if (onQwen && signal.hasAuthCookie && signal.cookieCount >= 2) return true;
  return false;
}

async function detectCaptcha(page: Page): Promise<boolean> {
  if (await pageShowsAccessVerification(page)) return true;
  const selectors = [
    'iframe[src*="captcha"]',
    'iframe[src*="aliyun"]',
    'iframe[src*="nocaptcha"]',
    'iframe[src*="recaptcha"]',
    "#aliyunCaptcha-sliding-slider",
    ".nc_iconfont",
    ".btn_slide",
    '[class*="captcha"]',
    '[id*="captcha"]',
    '[class*="verify"]',
    "text=/verify you are human|security verification|slide to|arraste|verificação|human verification|Access Verification|real person/i",
  ];
  for (const sel of selectors) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function getManualCaptchaLocator(page: Page): Promise<Locator | undefined> {
  const selectors = [
    "#aliyunCaptcha-window-float",
    'iframe[src*="captcha" i]',
    'iframe[src*="aliyun" i]',
    'iframe[src*="nocaptcha" i]',
    'iframe[src*="recaptcha" i]',
  ];
  for (const selector of selectors) {
    const captcha = page.locator(selector).first();
    if (await captcha.isVisible().catch(() => false)) return captcha;
  }

  if (await pageShowsAccessVerification(page)) {
    const viewport = page.locator("body").first();
    if (await viewport.isVisible().catch(() => false)) return viewport;
  }
  return undefined;
}

function manualCaptchaError(message: string): Error {
  return new Error(`CAPTCHA manual: ${message}`);
}

function validateManualCaptchaDrag(input: ManualCaptchaDrag): void {
  if (!Array.isArray(input.points) || input.points.length < 2) {
    throw manualCaptchaError("envie ao menos dois pontos do arraste.");
  }
  if (input.points.length > 80) {
    throw manualCaptchaError("o arraste excede 80 pontos.");
  }

  let previousTime = -1;
  for (const point of input.points) {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isFinite(point.t) ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1 ||
      point.t < previousTime ||
      point.t > 15_000
    ) {
      throw manualCaptchaError("a trajetória recebida é inválida.");
    }
    previousTime = point.t;
  }
}

function validateManualCaptchaPoint(point: ManualCaptchaPoint | undefined): void {
  if (
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(point.t) ||
    point.x < 0 ||
    point.x > 1 ||
    point.y < 0 ||
    point.y > 1 ||
    point.t < 0 ||
    point.t > 15_000
  ) {
    throw manualCaptchaError("o ponto recebido é inválido.");
  }
}

function queueManualCaptchaOperation(
  session: ManualCaptchaSession,
  operation: () => Promise<void>,
): Promise<void> {
  const next = session.pointerQueue.then(operation);
  session.pointerQueue = next.catch(() => {});
  return next;
}

function getManualCaptchaSession(jobId: string): ManualCaptchaSession {
  const session = manualCaptchaSessions.get(jobId);
  if (!session || session.page.isClosed()) {
    manualCaptchaSessions.delete(jobId);
    throw manualCaptchaError("não há desafio aguardando neste cadastro.");
  }
  return session;
}

export async function getManualCaptchaScreenshot(jobId: string): Promise<Buffer> {
  const session = getManualCaptchaSession(jobId);
  if (!(await session.captcha.isVisible().catch(() => false))) {
    throw manualCaptchaError("o desafio atual não está mais visível.");
  }
  return session.captcha.screenshot({ type: "png" });
}

export async function submitManualCaptchaPointer(
  jobId: string,
  input: ManualCaptchaPointer,
): Promise<void> {
  const session = getManualCaptchaSession(jobId);
  await queueManualCaptchaOperation(session, async () => {
    if (session.submitting) {
      throw manualCaptchaError("o arraste anterior ainda está sendo enviado.");
    }

    if (input.phase === "cancel") {
      if (session.pointerDown && !session.page.isClosed()) {
        await session.page.mouse.up().catch(() => {});
      }
      session.pointerDown = false;
      session.pointerBox = undefined;
      session.pointerInputStart = undefined;
      session.pointerMouseStart = undefined;
      return;
    }
    if (!(["start", "move", "end"] as const).includes(input.phase)) {
      throw manualCaptchaError("a fase do arraste é inválida.");
    }
    validateManualCaptchaPoint(input.point);
    const point = input.point as ManualCaptchaPoint;

    if (input.phase === "start") {
      if (session.pointerDown) {
        throw manualCaptchaError("já há um arraste em andamento.");
      }
      const box = await session.captcha.boundingBox();
      if (!box) throw manualCaptchaError("o desafio atual não está mais visível.");
      const inputStart = {
        x: box.x + point.x * box.width,
        y: box.y + point.y * box.height,
      };
      const sliderBox = await session.page
        .locator("#aliyunCaptcha-sliding-slider")
        .first()
        .boundingBox()
        .catch(() => null);
      const mouseStart = sliderBox
        ? {
            x: sliderBox.x + Math.min(14, sliderBox.width / 2),
            y: sliderBox.y + sliderBox.height / 2,
          }
        : inputStart;
      await session.page.mouse.move(mouseStart.x, mouseStart.y);
      await session.page.mouse.down();
      session.pointerBox = box;
      session.pointerInputStart = inputStart;
      session.pointerMouseStart = mouseStart;
      session.pointerDown = true;
      return;
    }

    if (!session.pointerDown || !session.pointerBox) {
      throw manualCaptchaError("inicie o arraste antes de mover a peça.");
    }
    const inputPoint = {
      x: session.pointerBox.x + point.x * session.pointerBox.width,
      y: session.pointerBox.y + point.y * session.pointerBox.height,
    };
    const x = session.pointerInputStart && session.pointerMouseStart
      ? session.pointerMouseStart.x + inputPoint.x - session.pointerInputStart.x
      : inputPoint.x;
    const y = session.pointerInputStart && session.pointerMouseStart
      ? session.pointerMouseStart.y + inputPoint.y - session.pointerInputStart.y
      : inputPoint.y;
    try {
      await session.page.mouse.move(x, y);
      if (input.phase === "end") {
        await session.page.mouse.up();
        session.pointerDown = false;
        session.pointerBox = undefined;
        session.pointerInputStart = undefined;
        session.pointerMouseStart = undefined;
        session.submittedAt = Date.now();
      }
    } catch (error) {
      if (input.phase === "end" && !session.page.isClosed()) {
        await session.page.mouse.up().catch(() => {});
        session.pointerDown = false;
        session.pointerBox = undefined;
        session.pointerInputStart = undefined;
        session.pointerMouseStart = undefined;
      }
      throw error;
    }
  });
}

export async function submitManualCaptchaDrag(
  jobId: string,
  input: ManualCaptchaDrag,
): Promise<void> {
  validateManualCaptchaDrag(input);
  const session = getManualCaptchaSession(jobId);
  await session.pointerQueue;
  if (session.pointerDown) {
    throw manualCaptchaError("há um arraste ao vivo em andamento.");
  }
  if (session.submitting) {
    throw manualCaptchaError("o arraste anterior ainda está sendo enviado.");
  }

  const box = await session.captcha.boundingBox();
  if (!box) throw manualCaptchaError("o desafio atual não está mais visível.");

  session.submitting = true;
  let mouseDown = false;
  try {
    const toPagePoint = (point: ManualCaptchaPoint) => ({
      x: box.x + point.x * box.width,
      y: box.y + point.y * box.height,
    });
    const first = toPagePoint(input.points[0]);
    await session.page.mouse.move(first.x, first.y);
    await session.page.mouse.down();
    mouseDown = true;

    let previousTime = input.points[0].t;
    for (const point of input.points.slice(1)) {
      const waitMs = Math.max(0, point.t - previousTime);
      if (waitMs) await sleep(waitMs);
      const next = toPagePoint(point);
      await session.page.mouse.move(next.x, next.y);
      previousTime = point.t;
    }
    await session.page.mouse.up();
    mouseDown = false;
    session.submittedAt = Date.now();
  } finally {
    if (mouseDown && !session.page.isClosed()) {
      await session.page.mouse.up().catch(() => {});
    }
    session.submitting = false;
  }
}

export async function waitForManualCaptcha(
  page: Page,
  job: RegistrationJob,
  timeoutMs: number,
): Promise<void> {
  if (manualCaptchaSessions.has(job.id)) {
    throw manualCaptchaError("já há um desafio aguardando neste cadastro.");
  }

  const session: ManualCaptchaSession = {
    captcha: page.locator("#aliyunCaptcha-window-float").first(),
    page,
    submitting: false,
    pointerDown: false,
    pointerQueue: Promise.resolve(),
  };
  manualCaptchaSessions.set(job.id, session);
  const captcha = await getManualCaptchaLocator(page);
  if (!captcha) {
    manualCaptchaSessions.delete(job.id);
    return;
  }
  session.captcha = captcha;
  setJob(
    job,
    "solving-captcha",
    "CAPTCHA aparece aqui no painel. Arraste a peça para continuar o cadastro automático.",
  );

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (page.isClosed()) throw manualCaptchaError("o navegador do cadastro foi fechado.");
      if (await pageShowsActivationPending(page)) {
        setJob(job, "pending_activation", "CAPTCHA aceito. Confirmação de e-mail aberta.");
        return;
      }
      if (await pageLooksAuthenticated(page)) return;

      const currentCaptcha = await getManualCaptchaLocator(page);
      if (!currentCaptcha) {
        await sleep(500);
        if (!(await getManualCaptchaLocator(page))) {
          setJob(job, "filling-form", "CAPTCHA aceito. Continuando cadastro automático.");
          return;
        }
      } else {
        session.captcha = currentCaptcha;
      }

      if (session.submittedAt && (await isCaptchaFailed(page))) {
        session.submittedAt = undefined;
        setJob(
          job,
          "solving-captcha",
          "CAPTCHA recusado. O desafio atualizado está no painel; tente novamente.",
        );
      }
      await sleep(350);
    }
  } finally {
    await session.pointerQueue.catch(() => {});
    if (session.pointerDown && !page.isClosed()) {
      await page.mouse.up().catch(() => {});
      session.pointerDown = false;
      session.pointerBox = undefined;
      session.pointerInputStart = undefined;
      session.pointerMouseStart = undefined;
    }
    if (manualCaptchaSessions.get(job.id) === session) {
      manualCaptchaSessions.delete(job.id);
    }
  }

  throw manualCaptchaError("não foi resolvido no painel a tempo.");
}

async function handleCaptcha(
  page: Page,
  job: RegistrationJob,
  timeoutMs: number,
): Promise<void> {
  // Prefer Access Verification / puzzle detection
  const visible =
    (await detectCaptcha(page)) ||
    (await isAccessVerificationVisible(page)) ||
    (await pageShowsAccessVerification(page));
  if (!visible) return;

  await waitForManualCaptcha(page, job, timeoutMs);
}

export async function acceptRegistrationTerms(page: Page): Promise<void> {
  const checkbox = page
    .locator(
      '[role="checkbox"].qwenchat-auth-pc-register-policy-checkbox, .qwenchat-auth-pc-register-policy [role="checkbox"], input.ant-checkbox-input, input[type="checkbox"]',
    )
    .first();

  if (await checkbox.count()) {
    const role = await checkbox.getAttribute("role");
    const isAccepted = () =>
      role === "checkbox"
        ? checkbox.getAttribute("aria-checked").then((value) => value === "true")
        : checkbox.isChecked().catch(() => false);
    const checked = await isAccepted();

    if (!checked) {
      if (role === "checkbox") {
        await checkbox.click({ timeout: 2_000 }).catch(() => {});
      } else {
        await checkbox.check({ timeout: 2_000 }).catch(() => {});
      }

      if (!(await isAccepted())) {
        await checkbox.evaluate((element) => {
          if (element instanceof HTMLElement) element.click();
        });
      }

      if (!(await isAccepted())) {
        await checkbox.focus({ timeout: 2_000 });
        await checkbox.press("Space", { timeout: 2_000 });
      }
    }

    const accepted = await isAccepted();
    if (!accepted) {
      throw new Error("Não foi possível aceitar os termos do cadastro do Qwen.");
    }
    return;
  }

  const clicked = await clickByText(page, [
    "Estou de acordo",
    "I agree",
    "Termos de uso",
    "concordo",
  ]);
  if (!clicked) {
    throw new Error("Aceite dos termos não encontrado no formulário do Qwen.");
  }
}

export async function resubmitRegistrationAfterCaptcha(
  page: Page,
): Promise<boolean> {
  const confirmation = page.locator('input[name="checkPassword"]').first();
  const submit = page
    .locator(
      'button:has-text("Criar Conta"), button:has-text("Create Account"), button:has-text("Sign up")',
    )
    .first();
  if (
    !(await confirmation.isVisible().catch(() => false)) ||
    !(await submit.isVisible().catch(() => false))
  ) {
    return false;
  }

  await sleep(1_000);
  if (
    !(await confirmation.isVisible().catch(() => false)) ||
    !(await submit.isVisible().catch(() => false))
  ) {
    return false;
  }

  try {
    await acceptRegistrationTerms(page);
  } catch (error) {
    if (
      !(await confirmation.isVisible().catch(() => false)) ||
      !(await submit.isVisible().catch(() => false))
    ) {
      return false;
    }
    throw error;
  }
  if (await submit.isDisabled().catch(() => false)) {
    throw new Error(
      "O formulário de inscrição continua desabilitado após o CAPTCHA.",
    );
  }
  await submit.click({ timeout: 10_000 });
  return true;
}

/**
 * Real Qwen Studio auth form (2026):
 * Login: input[name=email] type=text, input[name=password], "Inscrever-se"
 * Signup: username, email (type=text), password, checkPassword, terms checkbox, "Criar Conta"
 */
export async function openSignupAndFill(
  page: Page,
  email: string,
  password: string,
  displayName: string,
): Promise<void> {
  await page.goto("https://chat.qwen.ai/auth", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await sleep(1_500);

  const signupFields = page
    .locator('input[name="username"], input[name="checkPassword"]')
    .first();
  let opened = await signupFields.isVisible().catch(() => false);
  let attemptedDirectNavigation = false;

  for (let attempt = 0; !opened && attempt < 5; attempt += 1) {
    const switched = await clickSignupSwitch(page);
    if (!switched && !attemptedDirectNavigation) {
      attemptedDirectNavigation = true;
      await page
        .goto("https://chat.qwen.ai/auth?tab=signup", {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        })
        .catch(() => {});
    }

    opened = await signupFields
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
  }

  if (!opened) {
    throw new Error(
      "O formulário de inscrição do Qwen não abriu após tentativas confirmadas.",
    );
  }

  const nameOk = await fillByName(page, "username", displayName);
  const emailOk = await fillByName(page, "email", email);
  const passOk = await fillByName(page, "password", password);
  const checkOk = await fillByName(page, "checkPassword", password);

  if (!emailOk) {
    // fallback selectors observed in live page
    const emailAlt = page.locator(
      'input[placeholder*="E-mail" i], input[placeholder*="Email" i], input[name="email"]',
    ).first();
    if (await emailAlt.count()) {
      await emailAlt.fill(email);
    } else {
      throw new Error(
        "Campo de e-mail não encontrado no formulário de inscrição do Qwen.",
      );
    }
  }
  if (!passOk) {
    const passAlt = page.locator('input[type="password"]').first();
    await passAlt.fill(password);
  }
  if (!checkOk) {
    const pws = page.locator('input[type="password"]');
    if ((await pws.count()) >= 2) await pws.nth(1).fill(password);
  }
  if (!nameOk) {
    await fillByName(page, "username", displayName).catch(() => {});
  }

  await acceptRegistrationTerms(page);

  await sleep(400);

  // Submit
  const submit = page.locator(
    'button[type="submit"], button:has-text("Criar Conta"), button:has-text("Create Account"), button:has-text("Sign up")',
  ).first();
  if (await submit.isDisabled().catch(() => false)) {
    throw new Error("O formulário de inscrição continua desabilitado após aceitar os termos.");
  }
  await submit.click({ timeout: 10_000 }).catch(async () => {
    await clickByText(page, ["Criar Conta", "Create Account", "Sign up"]);
  });

  await sleep(2_000);
}


async function fillOtpIfPresent(page: Page, code: string): Promise<boolean> {
  const selectors = [
    'input[name*="code" i]',
    'input[name*="otp" i]',
    'input[autocomplete="one-time-code"]',
    'input[inputmode="numeric"]',
    'input[placeholder*="code" i]',
    'input[placeholder*="código" i]',
    'input[placeholder*="verifica" i]',
    'input[maxlength="6"]',
    'input[maxlength="8"]',
  ];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      await loc.fill(code);
      await page
        .locator(
          'button[type="submit"], button:has-text("Verify"), button:has-text("Verificar"), button:has-text("Confirm"), button:has-text("Confirmar"), button:has-text("Continue"), button:has-text("Continuar")',
        )
        .first()
        .click()
        .catch(() => {});
      return true;
    }
  }
  // multi-box OTP
  const boxes = page.locator(
    'input[maxlength="1"][type="text"], input[maxlength="1"][type="tel"]',
  );
  const n = await boxes.count();
  if (n >= 4 && n <= 8 && code.length >= n) {
    for (let i = 0; i < n; i++) {
      await boxes.nth(i).fill(code[i] || "");
    }
    return true;
  }
  return false;
}

async function applyVerification(
  page: Page,
  job: RegistrationJob,
  mailbox: TempMailbox,
  signupStartedAt: number,
  mailPage?: Page,
  options: { autoVerifyEmail?: boolean; headless?: boolean } = {},
): Promise<void> {
  const autoVerify = options.autoVerifyEmail !== false;
  const headless = options.headless === true;

  setJob(
    job,
    "pending_activation",
    headless
      ? `Headless: aguardando e-mail e clicando no link automaticamente (${mailbox.email})…`
      : `Aguardando e-mail e clicando no link automaticamente (${mailbox.email})…`,
  );

  // If already fully logged into chat, done.
  if (await pageLooksAuthenticated(page)) {
    setJob(
      job,
      "applying-verification",
      "Qwen já está logado. Ativação concluída.",
    );
    return;
  }

  let verification: { code?: string; link?: string; message?: any } | null =
    null;
  let lastMsgCount = 0;
  let resendCount = 0;
  const timeoutMs = Math.min(config.accountCreator.timeoutMs, 360_000);
  const pollEvery = 4_000;
  const started = Date.now();
  const deadline = started + timeoutMs;
  const inboxPage = mailPage;

  while (Date.now() < deadline) {
    if (await pageLooksAuthenticated(page)) {
      setJob(
        job,
        "applying-verification",
        "Qwen logado durante a espera. Seguindo…",
      );
      return;
    }

    const elapsedMs = Date.now() - started;
    const pending = await pageShowsActivationPending(page);

    // Resend from confirmation screen (keeps Qwen tab; no focus war)
    if (
      pending &&
      resendCount < 4 &&
      elapsedMs > 35_000 &&
      elapsedMs > resendCount * 60_000
    ) {
      const ok = await clickResendActivation(page);
      if (ok) {
        resendCount += 1;
        setJob(
          job,
          "pending_activation",
          `Reenviei e-mail (#${resendCount}). Continuando poll da inbox…`,
        );
      }
    }

    if (inboxPage && mailbox.provider === "temp-mail.org" && autoVerify) {
      try {
        verification = await waitForTempMailOrgVerificationLink(
          inboxPage,
          mailbox,
          {
            timeoutMs: pollEvery + 8_000,
            pollIntervalMs: 2_500,
            onPoll: ({ messages, sample }) => {
              lastMsgCount = messages;
              setJob(
                job,
                "pending_activation",
                `Headless auto · inbox: ${messages} msg · ${Math.round(elapsedMs / 1000)}s${sample ? ` · ${sample}` : ""}`,
              );
            },
          },
        );
      } catch {
        setJob(
          job,
          "pending_activation",
          `Aguardando e-mail (auto-click) · inbox: ${lastMsgCount} msg · ${Math.round(elapsedMs / 1000)}s`,
        );
      }
    } else if (
      inboxPage &&
      mailbox.provider === "tuamaeaquelaursa" &&
      autoVerify
    ) {
      try {
        // Keep inbox page on the mailbox URL
        if (
          mailbox.login &&
          !inboxPage.url().includes(`tuamaeaquelaursa.com/${mailbox.login}`)
        ) {
          await inboxPage
            .goto(`https://tuamaeaquelaursa.com/${mailbox.login}`, {
              waitUntil: "domcontentloaded",
              timeout: 30_000,
            })
            .catch(() => {});
        }

        // Short dedicated wait slice
        verification = await waitForUrsaVerificationLink(inboxPage, mailbox, {
          timeoutMs: pollEvery + 8_000,
          pollIntervalMs: 2_500,
          onPoll: ({ messages, sample }) => {
            lastMsgCount = messages;
            setJob(
              job,
              "pending_activation",
              `Headless auto · inbox: ${messages} msg · ${Math.round(elapsedMs / 1000)}s${sample ? ` · ${sample}` : ""}`,
            );
          },
        });
      } catch {
        // slice timeout — continue outer loop
        const msgs = await listUrsaMessages(inboxPage).catch(() => []);
        lastMsgCount = msgs.length;
        setJob(
          job,
          "pending_activation",
          `Aguardando e-mail (auto-click) · inbox: ${msgs.length} msg · ${Math.round(elapsedMs / 1000)}s`,
        );
      }
    } else if (mailbox.provider !== "tuamaeaquelaursa" && autoVerify) {
      try {
        verification = await waitForVerificationEmail(mailbox, {
          timeoutMs: 10_000,
          pollIntervalMs: 2_500,
          sinceMs: signupStartedAt - 2_000,
          onPoll: ({ messages }) => {
            lastMsgCount = messages;
          },
        });
      } catch {
        // continue
      }
    }

    // AUTO CLICK / OPEN verification link as soon as we have it
    if (autoVerify && verification?.link) {
      setJob(
        job,
        "applying-verification",
        `E-mail chegou. Clicando/abrindo link automaticamente: ${verification.link.slice(0, 90)}…`,
      );
      await openActivationLink(page, job, verification.link);
      verification = null;

      // Give Qwen a moment to clear pending state
      for (let i = 0; i < 20; i++) {
        if (await pageLooksAuthenticated(page)) {
          setJob(
            job,
            "applying-verification",
            "Link confirmado e Qwen logado.",
          );
          return;
        }
        if (!(await pageShowsActivationPending(page))) break;
        await clickByText(page, [
          "Verifique novamente",
          "Check again",
          "Refresh",
        ]).catch(() => false);
        await sleep(2_000);
      }
      continue;
    }

    if (verification?.code) {
      job.verificationCode = verification.code;
      await fillOtpIfPresent(page, verification.code).catch(() => false);
    }

    await sleep(1_500);
  }

  if (await pageLooksAuthenticated(page)) {
    setJob(
      job,
      "applying-verification",
      "Timeout do poll, mas Qwen já está logado.",
    );
    return;
  }

  throw new Error(
    `Não chegou e-mail/link de verificação em ${Math.round(timeoutMs / 1000)}s (inbox msgs=${lastMsgCount}). Conta permanece pendente.`,
  );
}

async function waitSession(
  page: Page,
  job: RegistrationJob,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const started = Date.now();
  while (Date.now() < deadline) {
    const signal = await collectSessionSignal(page);
    job.hasCookies = signal.cookieCount > 0;
    const elapsed = Date.now() - started;
    if (await pageShowsActivationPending(page)) {
      if (elapsed % 8_000 < 1_300) {
        setJob(
          job,
          "pending_activation",
          `Ainda na confirmação de e-mail… ${Math.round(elapsed / 1000)}s`,
        );
      }
    } else if (await pageLooksAuthenticated(page)) {
      setJob(
        job,
        "capturing-session",
        `Sessão autenticada (cookies=${signal.cookieCount}).`,
      );
      return true;
    } else if (elapsed % 12_000 < 1_300) {
      setJob(
        job,
        "capturing-session",
        `Aguardando login completo… ${Math.round(elapsed / 1000)}s · cookies=${signal.cookieCount}`,
      );
    }
    // keep solving captcha if it reappears
    if (await detectCaptcha(page)) {
      await handleCaptcha(page, job, config.accountCreator.timeoutMs).catch(() => {});
    }
    await sleep(1_200);
  }
  return false;
}

async function runRegistration(
  job: RegistrationJob,
  request: RegistrationRequest,
): Promise<void> {
  const accountId = crypto.randomUUID();
  const profilePath = path.resolve("data", "qwen_profiles", accountId);
  let context: BrowserContext | undefined;
  let persisted = false;
  let mailbox: TempMailbox | null = null;

  const explicitEmail = Boolean(request.email?.trim());
  const useTempEmail =
    request.useTempEmail === true ||
    (request.useTempEmail !== false && !explicitEmail);

  const password =
    request.password && request.password.length >= 8
      ? request.password
      : generateAccountPassword();
  const displayName = request.displayName?.trim() || generateDisplayName();

  try {
    let email = request.email?.trim() || "";

    fs.mkdirSync(profilePath, { recursive: true });
    // Qwen shows "Access Verification" captcha on signup. Headless almost always fails
    // there, so no activation email is ever sent. Default to HEADED for account creation.
    // Force headless only with ACCOUNT_CREATOR_FORCE_HEADLESS=true (not recommended).
    const forceHeadless =
      process.env.ACCOUNT_CREATOR_FORCE_HEADLESS === "true" ||
      process.env.ACCOUNT_CREATOR_FORCE_HEADLESS === "1";
    // Default HEADED so Aliyun/Access Verification can be solved. Headless blocks signup.
    const headless = forceHeadless;

    setJob(
      job,
      "opening-browser",
      headless
        ? "Abrindo navegador headless (pode falhar no CAPTCHA/Access Verification)…"
        : "Abrindo navegador do cadastro — se houver CAPTCHA, ele aparecerá no painel; depois o link do e-mail é clicado automático…",
    );
    context = await chromium.launchPersistentContext(profilePath, {
      headless,
      env: process.env.ACCOUNT_CREATOR_DISPLAY
        ? { ...process.env, DISPLAY: process.env.ACCOUNT_CREATOR_DISPLAY }
        : undefined,
      viewport: { width: 1280, height: 860 },
      locale: "pt-BR",
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
      ],
    });

    // glm-style: two tabs in the SAME browser
    // mailPage = tuamaeaquelaursa inbox | page = Qwen signup
    const mailPage = context.pages()[0] ?? (await context.newPage());
    const page = await context.newPage();
    let signupStartedAt = Date.now();

    if (useTempEmail || !email) {
      setJob(
        job,
        "preparing-email",
        "Criando e-mail na tuamaeaquelaursa (aba inbox; sem forçar foco depois)…",
      );
      // Create mailbox on mail tab, then immediately return focus to Qwen tab.
      mailbox = await createTempMailbox(mailPage);
      email = mailbox.email;
      job.email = email;
      job.provider = mailbox.provider;
      setJob(
        job,
        "preparing-email",
        `E-mail pronto: ${email} (${mailbox.provider}). Inbox fica em outra aba (clique nela se quiser).`,
      );
    } else {
      job.email = email;
      job.provider = "user-provided";
    }

    if (!email.includes("@")) throw new Error("E-mail inválido.");

    setJob(job, "filling-form", `Preenchendo inscrição do Qwen para ${email}…`);
    await page.bringToFront().catch(() => {});
    signupStartedAt = Date.now();
    await openSignupAndFill(page, email, password, displayName);

    // Wait briefly for post-submit state (captcha / pending / error)
    await sleep(2_000);
    if (await pageShowsAccessVerification(page) || (await detectCaptcha(page))) {
      await handleCaptcha(
        page,
        job,
        config.accountCreator.timeoutMs,
      );
    } else {
      await handleCaptcha(
        page,
        job,
        config.accountCreator.timeoutMs,
      );
    }

    if (
      !(await pageShowsAccessVerification(page)) &&
      !(await detectCaptcha(page)) &&
      !(await pageShowsActivationPending(page)) &&
      !(await pageLooksAuthenticated(page)) &&
      (await resubmitRegistrationAfterCaptcha(page))
    ) {
      setJob(
        job,
        "filling-form",
        "CAPTCHA concluído, mas o formulário continuou aberto. Reenviando o cadastro uma vez…",
      );
      await sleep(2_000);
      await handleCaptcha(
        page,
        job,
        config.accountCreator.timeoutMs,
      );
    }

    // HARD GATE: do not claim "pending email" unless Qwen actually shows activation screen
    // or we are already authenticated. Headless often dies at Access Verification with no email sent.
    if (await pageShowsAccessVerification(page)) {
      throw new Error(
        "Qwen manteve o CAPTCHA após a tentativa no painel. Abra o desafio novamente e tente outro arraste.",
      );
    }

    // Still on signup form? fields visible means submit failed
    const stillOnForm = await page
      .locator('input[name="email"], input[name="checkPassword"], button:has-text("Criar Conta")')
      .first()
      .isVisible()
      .catch(() => false);
    if (
      stillOnForm &&
      !(await pageShowsActivationPending(page)) &&
      !(await pageLooksAuthenticated(page))
    ) {
      const body = ((await page.locator("body").innerText().catch(() => "")) || "").slice(0, 240);
      throw new Error(
        `Cadastro não avançou da tela de inscrição (sem e-mail enviado). UI: ${body.replace(/\s+/g, " ")}`,
      );
    }

    if (await pageShowsActivationPending(page)) {
      setJob(
        job,
        "pending_activation",
        "Conta criada. Tela de confirmação de e-mail aberta. Aguardando link na inbox…",
      );
    } else if (await pageLooksAuthenticated(page)) {
      setJob(
        job,
        "capturing-session",
        "Conta já autenticada no Qwen após o cadastro.",
      );
    } else if (mailbox) {
      // Soft wait a few seconds for activation screen to appear
      setJob(
        job,
        "pending_activation",
        "Aguardando tela de confirmação de e-mail do Qwen…",
      );
      const softDeadline = Date.now() + 30_000;
      while (Date.now() < softDeadline) {
        if (await pageShowsActivationPending(page)) break;
        if (await pageLooksAuthenticated(page)) break;
        if (await pageShowsAccessVerification(page)) {
          throw new Error(
            "Access Verification apareceu após o envio. Resolva o CAPTCHA pelo painel.",
          );
        }
        await sleep(1_500);
      }
      if (
        !(await pageShowsActivationPending(page)) &&
        !(await pageLooksAuthenticated(page))
      ) {
        throw new Error(
          "Qwen não mostrou a tela de confirmação de e-mail. Cadastro provavelmente bloqueado; e-mail não será enviado.",
        );
      }
    }

    if (mailbox) {
      try {
        await applyVerification(page, job, mailbox, signupStartedAt, mailPage, { autoVerifyEmail: true, headless });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("abort:")) {
          setJob(
            job,
            "pending_activation",
            "Sessão parcial detectada; mantendo tela de confirmação e inbox abertas…",
          );
          await applyVerification(page, job, mailbox, signupStartedAt, mailPage, { autoVerifyEmail: true, headless });
        } else {
          throw err;
        }
      }

      // Only AFTER confirmation/login is ready: ensure chat session then pool auth
      setJob(
        job,
        "authenticating",
        "Confirmação ok / sessão detectada. Preparando autenticação no pool…",
      );
      await page.bringToFront().catch(() => {});

      if (!(await pageLooksAuthenticated(page))) {
        await page
          .goto("https://chat.qwen.ai/", {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          })
          .catch(() => {});
        await sleep(1_500);

        // If login form appears, fill credentials of the account just created
        const emailField = page
          .locator(
            'input[name="email"], input[type="email"], input[name="username"]',
          )
          .first();
        const passField = page.locator('input[type="password"]').first();
        if (
          (await emailField.isVisible().catch(() => false)) &&
          (await passField.isVisible().catch(() => false))
        ) {
          await emailField.fill(email);
          await passField.fill(password);
          await page
            .locator(
              'button[type="submit"], button:has-text("Log in"), button:has-text("Entrar"), button:has-text("Sign in")',
            )
            .first()
            .click()
            .catch(() => {});
          await sleep(2_000);
        }

        await handleCaptcha(
          page,
          job,
          config.accountCreator.timeoutMs,
        );
      } else {
        setJob(
          job,
          "authenticating",
          "Qwen já logado no chat. Indo autenticar no pool…",
        );
      }
    } else if (await pageShowsActivationPending(page)) {
      // User-provided email: keep browser open and wait for manual link click / activation.
      setJob(
        job,
        "pending_activation",
        "Pendente de ativação. Abra o link do e-mail (navegador permanece aberto)…",
      );
      const deadline = Date.now() + Math.min(config.accountCreator.timeoutMs, 600_000);
      while (Date.now() < deadline) {
        if (!(await pageShowsActivationPending(page)) && (await pageLooksAuthenticated(page))) {
          break;
        }
        await sleep(2_000);
      }
      if (await pageShowsActivationPending(page)) {
        throw new Error(
          "Conta ainda pendente de ativação (link do e-mail não confirmado).",
        );
      }
    }

    // Hard gate: never continue while activation is still pending.
    if (await pageShowsActivationPending(page)) {
      throw new Error(
        "Conta pendente de ativação. O link do e-mail ainda não foi confirmado no navegador.",
      );
    }

    setJob(job, "capturing-session", "E-mail ativado. Validando sessão autenticada…");
    const ok = await waitSession(
      page,
      job,
      Math.min(300_000, config.accountCreator.timeoutMs),
    );
    if (!ok || (await pageShowsActivationPending(page))) {
      throw new Error(
        "Sessão autenticada não obtida (ativação de e-mail ainda pendente).",
      );
    }

    // Keep browser open a bit after activation so cookies settle, then close profile for pool reuse.
    setJob(
      job,
      "capturing-session",
      "Ativação OK. Mantendo navegador aberto 3s para gravar sessão…",
    );
    await sleep(3_000);
    await context.close();
    context = undefined;

    setJob(
      job,
      "authenticating",
      "Salvando e autenticando no pool (pronto só após Playwright)…",
    );
    const account = addAccount(email, password, accountId);
    persisted = true;
    job.accountId = account.id;

    await initPlaywrightForAccount(account, config.playwright.headless);
    let hasHeaders = accountHasCapturedHeaders(account.id);
    if (!hasHeaders) {
      setJob(
        job,
        "authenticating",
        "Sessão aberta, capturando headers bx-* para o pool…",
      );
      hasHeaders = await ensureAccountHeaders(account.id, true);
    }
    if (!hasHeaders) {
      throw new Error(
        "Conta autenticou no browser, mas headers bx-ua não foram capturados (conta não está pronta para o proxy).",
      );
    }

    job.ready = true;
    setJob(
      job,
      "completed",
      "Conta PRONTA: e-mail/captcha + sessão + headers no pool.",
    );
  } catch (error) {
    if (persisted) removeAccount(accountId);
    await fs.promises
      .rm(profilePath, { recursive: true, force: true })
      .catch(() => {});
    job.ready = false;
    const message = error instanceof Error ? error.message : String(error);
    setJob(job, "failed", "Falha ao criar conta pronta.", message);
  } finally {
    await context?.close().catch(() => {});
  }
}

export function startRegistration(
  request: RegistrationRequest = {},
): RegistrationJob {
  const explicitEmail = Boolean(request.email?.trim());
  const useTempEmail =
    request.useTempEmail === true ||
    (request.useTempEmail !== false && !explicitEmail);

  if (!useTempEmail) {
    const email = request.email?.trim() || "";
    if (!email.includes("@")) throw new Error("Informe um e-mail válido.");
  }
  if (request.password && request.password.length < 8) {
    throw new Error("A senha deve ter pelo menos 8 caracteres.");
  }

  const now = Date.now();
  const job: RegistrationJob = {
    id: crypto.randomUUID(),
    email: request.email?.trim() || "(gerando e-mail temp…)",
    state: "queued",
    message:
      "Fila: temp-mail → form Qwen → captcha → verify e-mail → auth pool.",
    createdAt: now,
    updatedAt: now,
    ready: false,
  };
  jobs.set(job.id, job);
  void runRegistration(job, request);
  return publicJob(job);
}
