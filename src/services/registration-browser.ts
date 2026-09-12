import {
  chromium,
  type Browser,
  type BrowserContext,
} from "playwright";

export interface RegistrationBrowser {
  context: BrowserContext;
  local: boolean;
  close(): Promise<void>;
}

interface RegistrationBrowserOptions {
  headless: boolean;
  display?: string;
  viewport: { width: number; height: number };
  locale: string;
  args: string[];
}

async function requestLocalBrowser(helperUrl: string): Promise<void> {
  const response = await fetch(`${helperUrl.replace(/\/$/, "")}/launch`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `worker local respondeu ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`,
    );
  }
}

async function connectLocalBrowser(
  cdpUrl: string,
  helperUrl: string,
): Promise<RegistrationBrowser> {
  await requestLocalBrowser(helperUrl);

  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 30_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`não foi possível conectar ao Chrome deste PC: ${message}`);
  }

  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    throw new Error("o Chrome local não expôs um contexto de navegador.");
  }

  for (const page of context.pages()) {
    await page.close().catch(() => {});
  }

  return {
    context,
    local: true,
    close: () => browser.close(),
  };
}

export async function launchRegistrationBrowser(
  profilePath: string,
  options: RegistrationBrowserOptions,
): Promise<RegistrationBrowser> {
  const cdpUrl = process.env.ACCOUNT_CREATOR_CDP_URL?.trim();
  const helperUrl = process.env.ACCOUNT_CREATOR_LOCAL_HELPER_URL?.trim();
  if (cdpUrl || helperUrl) {
    if (!cdpUrl || !helperUrl) {
      throw new Error(
        "cadastro local exige ACCOUNT_CREATOR_CDP_URL e ACCOUNT_CREATOR_LOCAL_HELPER_URL.",
      );
    }
    return connectLocalBrowser(cdpUrl, helperUrl);
  }

  const context = await chromium.launchPersistentContext(profilePath, {
    headless: options.headless,
    env: options.display
      ? { ...process.env, DISPLAY: options.display }
      : undefined,
    viewport: options.viewport,
    locale: options.locale,
    args: options.args,
  });
  return {
    context,
    local: false,
    close: () => context.close(),
  };
}
