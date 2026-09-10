/**
 * Temporary mailbox for Qwen signup verification.
 *
 * Primary: temp-mail.org browser session + its authenticated inbox API.
 * Fallbacks: tuamaeaquelaursa browser inbox, mail.tm and Guerrilla.
 */

import type { Page } from "playwright";

export type TempMailProvider =
  | "temp-mail.org"
  | "tuamaeaquelaursa"
  | "mail.tm"
  | "guerrillamail";

export interface TempMailbox {
  email: string;
  provider: TempMailProvider;
  token?: string;
  /** guerrilla sid */
  sidToken?: string;
  login?: string;
  domain?: string;
  password?: string;
  /** browser-inbox mode keeps the inbox page open */
  browserInbox?: boolean;
}

export interface TempMessage {
  id: string;
  subject: string;
  from: string;
  text: string;
  html: string;
  receivedAt?: string;
}

export interface VerificationPayload {
  code?: string;
  link?: string;
  message: TempMessage;
}

const URSA_URL = "https://tuamaeaquelaursa.com/";
const BROWSER_INBOX_WAIT_MS = 180_000;
const TEMP_MAIL_ORG_URL = "https://temp-mail.org/en/";
const TEMP_MAIL_ORG_API = "https://web2.temp-mail.org";

const URSA_SELECTORS = {
  input: "input.email-section-input-email",
  suffix: ".email-section-input-suffix",
  inboxReady: ".all-messages, .the-message, .message-details-body, body",
  inboxList: ".all-messages, .the-message, body",
  messageRow: ".the-message",
  messageFrom: ".the-message-from",
  messageSubject: ".the-message-subject",
  messageBody: ".message-details-body",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "user-agent": "qwenbridge-temp-mail/1.0",
        accept: "application/json",
        ...(init?.headers || {}),
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 200)}`);
    }
    if (!text?.trim()) return [] as T;
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

function randomLocalPart(prefix = "qwen"): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${rand}`.toLowerCase();
}

function randomPassword(): string {
  return `Qwen@${Math.random().toString(36).slice(2, 10)}Aa1!`;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").join("\n");
  }
  return "";
}

function messageFrom(value: unknown): string {
  if (typeof value === "string") return value;
  const record = objectRecord(value);
  return (
    stringValue(record?.address) ||
    stringValue(record?.email) ||
    stringValue(record?.name)
  );
}

async function createTempMailOrgMailbox(
  page: Page,
): Promise<TempMailbox> {
  const mailboxResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().replace(/\/$/, "") === `${TEMP_MAIL_ORG_API}/mailbox` &&
      response.ok(),
    { timeout: 45_000 },
  );

  await page.goto(TEMP_MAIL_ORG_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const payload = objectRecord((await (await mailboxResponse).json()) as unknown);
  const email = stringValue(payload?.mailbox).trim();
  const token = stringValue(payload?.token).trim();
  if (!email.includes("@") || !token) {
    throw new Error("temp-mail.org: resposta da caixa sem e-mail/token");
  }

  await page
    .locator("#mail")
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => {});

  const [login, domain] = email.split("@");
  return {
    email,
    provider: "temp-mail.org",
    token,
    login,
    domain,
    browserInbox: true,
  };
}

async function fetchTempMailOrgFromPage(
  page: Page,
  mailbox: TempMailbox,
  pathname: string,
): Promise<unknown> {
  if (!mailbox.token) {
    throw new Error("temp-mail.org: token da caixa ausente");
  }

  const url = `${TEMP_MAIL_ORG_API}${pathname}`;
  const token = mailbox.token;
  const response = (await page.evaluate(
    `(async () => {
      const result = await fetch(${JSON.stringify(url)}, {
        headers: { authorization: 'Bearer ' + ${JSON.stringify(token)} },
      });
      return { ok: result.ok, status: result.status, body: await result.text() };
    })()`,
  )) as { ok?: unknown; status?: unknown; body?: unknown };

  if (response.ok !== true) {
    throw new Error(
      `temp-mail.org: inbox HTTP ${typeof response.status === "number" ? response.status : "?"}`,
    );
  }

  const body = stringValue(response.body);
  return body.trim() ? (JSON.parse(body) as unknown) : {};
}

// ─── tuamaeaquelaursa (browser inbox — glm style) ───────────────────────────

export async function createUrsaMailbox(page: Page): Promise<TempMailbox> {
  // Match glm: use the address generated by the site (do NOT invent a local-part).
  // Custom local-parts often break delivery / inbox routing on tuamaeaquelaursa.
  await page.goto(URSA_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.waitForSelector(URSA_SELECTORS.input, { timeout: 30_000 });
  await sleep(1_000);

  const input = page.locator(URSA_SELECTORS.input).first();
  let email = "";
  for (let i = 0; i < 12; i++) {
    const name = (await input.inputValue().catch(() => "")).trim();
    const domain = (
      (await page.locator(URSA_SELECTORS.suffix).first().textContent()) || ""
    ).trim();
    if (name && domain) {
      email = domain.startsWith("@")
        ? `${name}${domain}`
        : `${name}@${domain.replace(/^@/, "")}`;
      break;
    }
    // reload for a fresh address if empty
    if (i > 0 && i % 3 === 0) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForSelector(URSA_SELECTORS.input, { timeout: 15_000 }).catch(() => {});
    }
    await sleep(500);
  }

  if (!email.includes("@")) {
    throw new Error("tuamaeaquelaursa: não foi possível ler o e-mail gerado pelo site");
  }

  const login = email.split("@")[0];
  const inboxUrl = `https://tuamaeaquelaursa.com/${login}`;
  await page.goto(inboxUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page
    .waitForSelector(URSA_SELECTORS.inboxReady, {
      timeout: BROWSER_INBOX_WAIT_MS,
    })
    .catch(() => {});

  return {
    email,
    provider: "tuamaeaquelaursa",
    login,
    domain: email.split("@")[1],
    browserInbox: true,
  };
}

async function reloadUrsaInbox(page: Page, login: string): Promise<void> {
  const url = page.url().includes("tuamaeaquelaursa.com")
    ? page.url()
    : `https://tuamaeaquelaursa.com/${login}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page
    .waitForSelector(URSA_SELECTORS.inboxList, { timeout: 30_000 })
    .catch(() => {});
  await sleep(1_200);
}

export async function listUrsaMessages(
  page: Page,
): Promise<Array<{ from: string; subject: string; index: number }>> {
  const rows = page.locator(URSA_SELECTORS.messageRow);
  const count = await rows.count();
  const items: Array<{ from: string; subject: string; index: number }> = [];
  for (let i = 0; i < count; i++) {
    const from = (
      (await rows
        .nth(i)
        .locator(URSA_SELECTORS.messageFrom)
        .textContent()
        .catch(() => "")) || ""
    ).trim();
    const subject = (
      (await rows
        .nth(i)
        .locator(URSA_SELECTORS.messageSubject)
        .textContent()
        .catch(() => "")) || ""
    ).trim();
    // also accept row text if sub-selectors missing
    const rowText = (
      (await rows.nth(i).innerText().catch(() => "")) || ""
    ).trim();
    items.push({
      from: from || rowText.slice(0, 80),
      subject: subject || rowText.slice(0, 120),
      index: i,
    });
  }
  return items;
}

function messageLooksLikeQwen(from: string, subject: string): boolean {
  const blob = `${from} ${subject}`.toLowerCase();
  return /qwen|alibaba|aliyun|verify|verifica|activa|confirma|security|account|e-mail|email/i.test(
    blob,
  );
}

export async function listTempMailOrgMessages(
  page: Page,
  mailbox: TempMailbox,
): Promise<TempMessage[]> {
  const payload = objectRecord(
    await fetchTempMailOrgFromPage(page, mailbox, "/messages"),
  );
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  return messages.flatMap((value) => {
    const message = objectRecord(value);
    const id = stringValue(message?._id) || stringValue(message?.id);
    if (!id) return [];
    return [
      {
        id,
        from: messageFrom(message?.from),
        subject: stringValue(message?.subject),
        text:
          stringValue(message?.bodyText) || stringValue(message?.bodyPreview),
        html: stringValue(message?.bodyHtml),
        receivedAt: stringValue(message?.receivedAt) || undefined,
      },
    ];
  });
}

async function getTempMailOrgMessage(
  page: Page,
  mailbox: TempMailbox,
  summary: TempMessage,
): Promise<TempMessage> {
  const payload = objectRecord(
    await fetchTempMailOrgFromPage(
      page,
      mailbox,
      `/messages/${encodeURIComponent(summary.id)}`,
    ),
  );
  return {
    id: stringValue(payload?._id) || stringValue(payload?.id) || summary.id,
    from: messageFrom(payload?.from) || summary.from,
    subject: stringValue(payload?.subject) || summary.subject,
    text:
      stringValue(payload?.bodyText) ||
      stringValue(payload?.text) ||
      summary.text,
    html: stringValue(payload?.bodyHtml) || stringValue(payload?.html),
    receivedAt: stringValue(payload?.receivedAt) || summary.receivedAt,
  };
}

export async function waitForTempMailOrgVerificationLink(
  page: Page,
  mailbox: TempMailbox,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    onPoll?: (info: {
      elapsedMs: number;
      messages: number;
      sample?: string;
    }) => void;
  } = {},
): Promise<VerificationPayload> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const started = Date.now();
  const deadline = started + timeoutMs;

  while (Date.now() < deadline) {
    const messages = await listTempMailOrgMessages(page, mailbox);
    options.onPoll?.({
      elapsedMs: Date.now() - started,
      messages: messages.length,
      sample: messages[0]
        ? `${messages[0].from} | ${messages[0].subject}`.slice(0, 80)
        : undefined,
    });

    const preferred = messages.find((message) =>
      messageLooksLikeQwen(message.from, message.subject),
    );
    const summary = preferred ?? messages[0];
    if (summary) {
      const message = await getTempMailOrgMessage(page, mailbox, summary);
      const verification = extractVerification(message);
      if (verification.link || verification.code) {
        return { ...verification, message };
      }
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timeout aguardando e-mail de verificação no temp-mail.org (${mailbox.email})`,
  );
}

/**
 * Poll tuamaeaquelaursa inbox in the browser, open the Qwen message,
 * extract the activation link and return it.
 */
export async function waitForUrsaVerificationLink(
  page: Page,
  mailbox: TempMailbox,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    onPoll?: (info: {
      elapsedMs: number;
      messages: number;
      sample?: string;
    }) => void;
  } = {},
): Promise<VerificationPayload> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const login = mailbox.login || mailbox.email.split("@")[0];
  const started = Date.now();
  const deadline = started + timeoutMs;

  // ensure we're on the inbox
  if (!page.url().includes("tuamaeaquelaursa.com")) {
    await page.goto(`https://tuamaeaquelaursa.com/${login}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }

  while (Date.now() < deadline) {
    const msgs = await listUrsaMessages(page);
    options.onPoll?.({
      elapsedMs: Date.now() - started,
      messages: msgs.length,
      sample: msgs[0]
        ? `${msgs[0].from} | ${msgs[0].subject}`.slice(0, 80)
        : undefined,
    });

    // Prefer Qwen-looking messages; else try any non-empty message.
    let idx = msgs.findIndex((m) => messageLooksLikeQwen(m.from, m.subject));
    if (idx < 0 && msgs.length > 0) idx = 0;

    if (idx >= 0) {
      const row = page.locator(URSA_SELECTORS.messageRow).nth(idx);
      await row.click().catch(async () => {
        await row.locator("a").first().click().catch(() => {});
      });
      await page
        .waitForSelector(URSA_SELECTORS.messageBody, { timeout: 20_000 })
        .catch(() => {});
      await sleep(1_200);

      const body = page.locator(URSA_SELECTORS.messageBody).first();
      const html = (await body.innerHTML().catch(() => "")) || "";
      const text = (await body.innerText().catch(() => "")) || "";
      const pageHtml = await page.content().catch(() => "");

      // Prefer explicit verify anchors in the message body
      const hrefs = await page
        .$$eval(
          `${URSA_SELECTORS.messageBody} a[href], a[href]`,
          (as) => as.map((a) => (a as HTMLAnchorElement).href).filter(Boolean),
        )
        .catch(() => [] as string[]);

      let link =
        hrefs.find((h) =>
          /qwen|verify|activ|confirm|token=|check|validat/i.test(h),
        ) || hrefs.find((h) => /https?:\/\//i.test(h) && !/tuamaeaquelaursa/i.test(h));

      if (!link) {
        const extracted = extractVerification({
          id: `ursa-${idx}`,
          subject: msgs[idx]?.subject || "",
          from: msgs[idx]?.from || "",
          text: text + "\n" + pageHtml,
          html: html + "\n" + pageHtml,
        });
        link = extracted.link;
      }

      // Also try clicking the verify link directly in the inbox body (headless-friendly)
      if (!link) {
        const verifyA = page
          .locator(`${URSA_SELECTORS.messageBody} a`)
          .filter({ hasText: /verify|verifica|activa|confirm|ativar/i })
          .first();
        if (await verifyA.isVisible().catch(() => false)) {
          link = (await verifyA.getAttribute("href").catch(() => null)) || undefined;
        }
      }

      if (link) {
        return {
          link,
          message: {
            id: `ursa-${idx}`,
            subject: msgs[idx]?.subject || "verification",
            from: msgs[idx]?.from || "",
            text,
            html,
          },
        };
      }
    }

    await reloadUrsaInbox(page, login);
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timeout aguardando e-mail de verificação na tuamaeaquelaursa (${mailbox.email})`,
  );
}

// ─── mail.tm API fallback ───────────────────────────────────────────────────

async function createMailTmMailbox(): Promise<TempMailbox> {
  const domainsRaw = await fetchJson<
    | Array<{ domain: string; isActive?: boolean }>
    | { "hydra:member"?: Array<{ domain: string; isActive?: boolean }> }
  >("https://api.mail.tm/domains");

  const domains = Array.isArray(domainsRaw)
    ? domainsRaw
    : domainsRaw["hydra:member"] || [];
  const domain =
    domains.find((d) => d.isActive !== false)?.domain || domains[0]?.domain;
  if (!domain) throw new Error("mail.tm: nenhum domínio disponível");

  const address = `${randomLocalPart()}@${domain}`;
  const password = randomPassword();

  await fetchJson("https://api.mail.tm/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, password }),
  });

  const tokenRes = await fetchJson<{ token: string }>(
    "https://api.mail.tm/token",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, password }),
    },
  );

  return {
    email: address,
    provider: "mail.tm",
    token: tokenRes.token,
    password,
    domain,
    login: address.split("@")[0],
    browserInbox: false,
  };
}

function normalizeMailTmList(data: unknown): Array<{
  id: string;
  subject?: string;
  from?: { address?: string } | string;
  intro?: string;
  text?: string;
  html?: string[] | string;
  createdAt?: string;
}> {
  if (Array.isArray(data)) return data as any[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj["hydra:member"])) return obj["hydra:member"] as any[];
    if (Array.isArray(obj.member)) return obj.member as any[];
  }
  return [];
}

async function listMailTmMessages(box: TempMailbox): Promise<TempMessage[]> {
  if (!box.token) return [];
  const data = await fetchJson<unknown>("https://api.mail.tm/messages", {
    headers: { authorization: `Bearer ${box.token}` },
  });
  const members = normalizeMailTmList(data);
  const messages: TempMessage[] = [];
  for (const m of members) {
    let full: any = m;
    try {
      full = await fetchJson<any>(`https://api.mail.tm/messages/${m.id}`, {
        headers: { authorization: `Bearer ${box.token}` },
      });
    } catch {
      // keep list item
    }
    const html = Array.isArray(full.html)
      ? full.html.join("\n")
      : full.html || "";
    const from =
      typeof full.from === "string"
        ? full.from
        : full.from?.address ||
          (typeof m.from === "string" ? m.from : m.from?.address) ||
          "";
    messages.push({
      id: String(full.id || m.id),
      subject: full.subject || m.subject || "",
      from,
      text: full.text || full.intro || m.intro || m.text || "",
      html,
      receivedAt: full.createdAt || m.createdAt,
    });
  }
  return messages;
}

// ─── Guerrilla fallback ─────────────────────────────────────────────────────

async function createGuerrillaMailbox(): Promise<TempMailbox> {
  const data = await fetchJson<{
    email_addr: string;
    sid_token: string;
  }>(
    "https://api.guerrillamail.com/ajax.php?f=get_email_address&ip=127.0.0.1&agent=Mozilla_QwenBridge",
  );
  if (!data.email_addr || !data.sid_token) {
    throw new Error("guerrillamail: resposta inválida");
  }
  const [login, domain] = data.email_addr.split("@");
  return {
    email: data.email_addr,
    provider: "guerrillamail",
    sidToken: data.sid_token,
    login,
    domain,
    browserInbox: false,
  };
}

async function listGuerrillaMessages(box: TempMailbox): Promise<TempMessage[]> {
  if (!box.sidToken) return [];
  await fetchJson(
    `https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${encodeURIComponent(box.sidToken)}`,
  ).catch(() => null);

  const data = await fetchJson<{
    list?: Array<{
      mail_id: string;
      mail_from: string;
      mail_subject: string;
      mail_excerpt?: string;
      mail_timestamp?: number;
    }>;
  }>(
    `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${encodeURIComponent(box.sidToken)}`,
  );

  const list = data.list || [];
  const messages: TempMessage[] = [];
  for (const m of list) {
    if (
      /welcome|guerrillamail/i.test(m.mail_subject || "") &&
      /guerrilla/i.test(m.mail_from || "")
    ) {
      continue;
    }
    const full = await fetchJson<{
      mail_id: string;
      mail_from: string;
      mail_subject: string;
      mail_body?: string;
      mail_timestamp?: number;
    }>(
      `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(m.mail_id)}&sid_token=${encodeURIComponent(box.sidToken)}`,
    );
    messages.push({
      id: String(full.mail_id || m.mail_id),
      subject: full.mail_subject || m.mail_subject || "",
      from: full.mail_from || m.mail_from || "",
      text: full.mail_body || m.mail_excerpt || "",
      html: full.mail_body || "",
      receivedAt: full.mail_timestamp
        ? new Date(full.mail_timestamp * 1000).toISOString()
        : undefined,
    });
  }
  return messages;
}

// ─── public API ─────────────────────────────────────────────────────────────

export async function createTempMailbox(
  page?: Page,
): Promise<TempMailbox> {
  if (page) {
    try {
      return await createTempMailOrgMailbox(page);
    } catch (err) {
      console.warn(
        `[temp-mail] temp-mail.org falhou, tentando próximo provedor: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    try {
      return await createUrsaMailbox(page);
    } catch (err) {
      console.warn(
        `[temp-mail] tuamaeaquelaursa falhou, caindo para API: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const errors: string[] = [];
  try {
    return await createMailTmMailbox();
  } catch (err) {
    errors.push(`mail.tm: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return await createGuerrillaMailbox();
  } catch (err) {
    errors.push(
      `guerrillamail: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  throw new Error(`Falha ao criar e-mail temporário. ${errors.join(" | ")}`);
}

export async function listTempMessages(
  box: TempMailbox,
): Promise<TempMessage[]> {
  if (box.provider === "mail.tm") return listMailTmMessages(box);
  if (box.provider === "guerrillamail") return listGuerrillaMessages(box);
  return [];
}

export function extractVerification(message: TempMessage): {
  code?: string;
  link?: string;
} {
  const blob = [message.subject, message.text, message.html]
    .filter(Boolean)
    .join("\n");

  const linkPatterns = [
    /href=["'](https?:\/\/[^"']*(?:verify|confirm|activation|activate|email-verification|check|validat|ativar)[^"']*)["']/i,
    /href=["'](https?:\/\/[^"']*qwen[^"']*)["']/i,
    /(https?:\/\/[^\s"'<>]*(?:verify|confirm|activation|activate|email-verification|validat|ativar)[^\s"'<>]*)/i,
    /(https?:\/\/(?:chat\.)?qwen\.ai[^\s"'<>]*)/i,
    /(https?:\/\/[^\s"'<>]*(?:aliyun|alibaba|dashscope)[^\s"'<>]*(?:verify|confirm|activ)[^\s"'<>]*)/i,
    /(https?:\/\/[^\s"'<>]+\/[^\s"'<>]*(?:token|ticket|code)=[^\s"'<>]+)/i,
    /(https?:\/\/[^\s"'<>]{20,})/i,
  ];

  let link: string | undefined;
  for (const re of linkPatterns) {
    const m = blob.match(re);
    if (m?.[1]) {
      link = m[1]
        .replace(/&amp;/g, "&")
        .replace(/&#x2F;/gi, "/")
        .replace(/&quot;/g, "")
        .replace(/[),.;\]>]+$/, "");
      try {
        if (/%2F|%3A/i.test(link) && link.includes("http")) {
          const inner = decodeURIComponent(link);
          const nested = inner.match(/https?:\/\/[^\s"'<>]+/);
          if (nested?.[0]) link = nested[0];
        }
      } catch {
        // keep
      }
      if (
        /tuamaeaquelaursa|mail\.tm|guerrillamail|googleapis|gstatic|facebook/i.test(
          link,
        ) &&
        !/qwen|verify|activ|confirm/i.test(link)
      ) {
        continue;
      }
      break;
    }
  }

  const labeled = blob.match(
    /(?:code|código|verification(?:\s+code)?|otp|pin|codigo)\s*(?:is)?\s*[:：]?\s*([0-9]{4,8})/i,
  );

  return { code: labeled?.[1], link };
}

export async function waitForVerificationEmail(
  box: TempMailbox,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    sinceMs?: number;
    onPoll?: (info: {
      elapsedMs: number;
      messages: number;
      lastError?: string;
    }) => void;
    shouldAbort?: () => boolean | Promise<boolean>;
    /** required for tuamaeaquelaursa browser mode */
    page?: Page;
  } = {},
): Promise<VerificationPayload> {
  // Browser inbox path (glm / tuamaeaquelaursa)
  if (box.provider === "tuamaeaquelaursa" || box.browserInbox) {
    if (!options.page) {
      throw new Error(
        "tuamaeaquelaursa exige page Playwright aberta para ler o inbox",
      );
    }
    return waitForUrsaVerificationLink(options.page, box, {
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs ?? 5_000,
      onPoll: (info) =>
        options.onPoll?.({
          elapsedMs: info.elapsedMs,
          messages: info.messages,
          lastError: info.sample,
        }),
    });
  }

  const timeoutMs = options.timeoutMs ?? 180_000;
  const pollIntervalMs = options.pollIntervalMs ?? 3_000;
  const sinceMs = options.sinceMs ?? Date.now() - 5_000;
  const deadline = Date.now() + timeoutMs;
  const seen = new Set<string>();
  const started = Date.now();
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    if (options.shouldAbort && (await options.shouldAbort())) {
      throw new Error("abort: sessão já autenticada");
    }

    let messages: TempMessage[] = [];
    try {
      messages = await listTempMessages(box);
      lastError = undefined;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      messages = [];
    }

    options.onPoll?.({
      elapsedMs: Date.now() - started,
      messages: messages.length,
      lastError,
    });

    for (const msg of messages) {
      if (seen.has(msg.id)) continue;
      seen.add(msg.id);
      if (msg.receivedAt) {
        const ts = Date.parse(msg.receivedAt);
        if (Number.isFinite(ts) && ts + 60_000 < sinceMs) continue;
      }
      const extracted = extractVerification(msg);
      if (extracted.link || extracted.code) {
        return { ...extracted, message: msg };
      }
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timeout aguardando e-mail de verificação em ${box.email} (${Math.round(timeoutMs / 1000)}s)${lastError ? ` · lastError=${lastError}` : ""}`,
  );
}

export function generateAccountPassword(): string {
  return randomPassword();
}

export function generateDisplayName(): string {
  const names = [
    "Ana Silva",
    "Bruno Costa",
    "Carla Mendes",
    "Diego Rocha",
    "Elena Souza",
    "Felipe Lima",
    "Gabriela Nunes",
    "Henrique Alves",
  ];
  const base = names[Math.floor(Math.random() * names.length)];
  return `${base} ${Math.random().toString(36).slice(2, 5)}`;
}
