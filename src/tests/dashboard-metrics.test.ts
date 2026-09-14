import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../dashboard/page.ts";
import { remoteBrowserHtml } from "../dashboard/remote-browser.ts";

test("dashboard renders metrics on the main accounts page", () => {
  assert.doesNotMatch(
    dashboardHtml,
    /id="metricsBtn"/,
    "Métricas must not require a separate panel",
  );
  assert.match(
    dashboardHtml,
    /<section class="metrics">/,
    "dashboard must render metrics within the main page",
  );
  assert.match(
    dashboardHtml,
    /api\(["']\/health["']/,
    "metrics view must load the public health snapshot",
  );
  assert.match(
    dashboardHtml,
    /metricCard\("Navegadores", runtime\.initialized/,
    "initialized browsers must be the primary account runtime metric",
  );
  assert.doesNotMatch(dashboardHtml, /metricCard\("Estado"/);
  assert.doesNotMatch(dashboardHtml, /metricCard\("Cache"/);
  assert.match(dashboardHtml, /id="activeAccountsSection"/);
  assert.match(dashboardHtml, /Contas atendendo requests/);
});

test("dashboard omits the obsolete configuration control", () => {
  assert.doesNotMatch(dashboardHtml, /id="configBtn"/);
  assert.doesNotMatch(dashboardHtml, /id="configDialog"/);
  assert.doesNotMatch(dashboardHtml, /class="status"/);
  assert.doesNotMatch(dashboardHtml, /id="copyBtn"/);
  assert.doesNotMatch(dashboardHtml, /id="serverText"/);
});

test("dashboard groups the pool into responsive account cards", () => {
  assert.match(dashboardHtml, /class="grid accounts-grid"/);
  assert.match(dashboardHtml, /class="section-kicker">Gerenciamento do pool/);
  assert.match(dashboardHtml, /class="account-email"/);
  assert.match(
    dashboardHtml,
    /\.accounts-grid \.card\{align-items:stretch;flex-direction:column\}/,
    "account actions must stack below the identity instead of competing for horizontal space",
  );
  assert.match(
    dashboardHtml,
    /\.btn\.danger:only-of-type\{flex:0 0 auto;margin-left:auto;min-width:132px\}/,
    "a lone remove action must retain a compact width",
  );
  assert.match(
    dashboardHtml,
    /\.accounts-grid \.meta \.btn\{flex:0 0 30%;max-width:170px\}/,
    "account actions must use a bounded fraction of the action row",
  );
  assert.match(dashboardHtml, /@media\(max-width:680px\)/);
});

test("dashboard offers a confirmed bulk authentication action", () => {
  assert.match(dashboardHtml, /id="authAllBtn"><svg class="btn-icon"[^>]*>.*?<\/svg>Autenticar todas/);
  assert.match(dashboardHtml, /accounts\/authenticate-all/);
  assert.match(dashboardHtml, /uma por vez/);
  assert.match(dashboardHtml, /button\.innerHTML = lockIcon \+ "Autenticar todas"/);
});

test("dashboard declares a QwenSofia favicon", () => {
  assert.match(dashboardHtml, /<link rel="icon" href="data:image\/svg\+xml,/);
});

test("dashboard opens the real account browser for CAPTCHA interaction", () => {
  assert.match(dashboardHtml, /id="captchaDialog"/);
  assert.match(dashboardHtml, /data-captcha=/);
  assert.match(dashboardHtml, /id="captchaRemote"/);
  assert.match(dashboardHtml, /\/remote-browser\?job=/);
  assert.match(dashboardHtml, /janela real do cadastro/);
  assert.doesNotMatch(dashboardHtml, /captchaRefreshBtn/);
});

test("dashboard directs local creator CAPTCHAs to the Windows Chrome window", () => {
  assert.match(dashboardHtml, /j\.state === 'solving-captcha' && !j\.localBrowser/);
  assert.match(dashboardHtml, /Use a janela do Chrome aberta neste PC/);
});

test("remote account browser uses an interactive local noVNC connection", () => {
  assert.match(remoteBrowserHtml, /import RFB from "\/novnc\/core\/rfb\.js"/);
  assert.match(remoteBrowserHtml, /host \+ ":6080"/);
  assert.match(remoteBrowserHtml, /rfb\.viewOnly = false/);
  assert.match(remoteBrowserHtml, /rfb\.scaleViewport = true/);
});

test("dashboard uses a black-cherry pink palette", () => {
  assert.match(dashboardHtml, /--bg:#09090b;.*--accent-start:#e85b94;--accent-end:#ff92bd/);
  assert.match(
    dashboardHtml,
    /background:linear-gradient\(135deg,var\(--accent-start\),var\(--accent-end\)\)/,
  );
  assert.doesNotMatch(dashboardHtml, /class="account-mark"/);
  assert.doesNotMatch(dashboardHtml, /class="avatar"/);
});

test("dashboard reuses the menu's outline SVG language in the controls", () => {
  assert.match(dashboardHtml, /class="brand-icon"/);
  assert.match(dashboardHtml, /<svg class="btn-icon" aria-hidden="true" viewBox="0 0 24 24">/);
  assert.match(dashboardHtml, /id="authAllBtn"><svg class="btn-icon"/);
  assert.match(dashboardHtml, /id="createBtn"><svg class="btn-icon"/);
});

test("dashboard refreshes metrics automatically and exposes concurrency control", () => {
  assert.doesNotMatch(dashboardHtml, /id="metricsRefreshBtn"/);
  assert.match(dashboardHtml, /setInterval\([^,]+, 30000\)/);
  assert.match(dashboardHtml, /id="concurrencyDialog"/);
  assert.match(dashboardHtml, /api\("\/api\/admin\/account-concurrency"/);
  assert.match(dashboardHtml, /Salvar e reiniciar agora/);
  assert.match(dashboardHtml, /account-concurrency\/restart/);
});
