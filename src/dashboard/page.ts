export const dashboardHtml = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QwenSofia</title><style>
:root{color-scheme:dark;--bg:#09090b;--bg-soft:#111013;--panel:rgba(23,20,26,.94);--panel-strong:#19151d;--line:#342936;--muted:#aea3b0;--text:#fff8fc;--accent-start:#e85b94;--accent-end:#ff92bd;--accent-soft:rgba(232,91,148,.18);--green:#6fcb9d;--red:#ed778f;--yellow:#d7b66f;--shadow:0 18px 42px rgba(0,0,0,.28)}
*{box-sizing:border-box}body{min-height:100vh;margin:0;background:radial-gradient(66rem 42rem at 105% -18%,rgba(225,74,136,.16),transparent 56%),radial-gradient(50rem 34rem at -15% 100%,rgba(124,48,89,.1),transparent 58%),linear-gradient(145deg,#09090b 0%,#0d0b10 48%,#111013 100%);color:var(--text);font:14px ui-sans-serif,Segoe UI,Arial,sans-serif;letter-spacing:.005em}
button,input{font:inherit}
.top{min-height:76px;border-bottom:1px solid rgba(200,161,187,.14);display:flex;align-items:center;justify-content:space-between;padding:0 max(28px,calc((100vw - 1180px)/2));background:rgba(9,9,11,.78);backdrop-filter:blur(18px);position:sticky;top:0;z-index:2}
.brand{display:flex;align-items:center;font-weight:760;font-size:18px;letter-spacing:-.02em}.brand-copy{display:flex;align-items:center;gap:10px}
.endpoint{color:#d5cad5;font:12px ui-monospace,monospace;border:1px solid rgba(201,163,188,.22);border-radius:999px;padding:6px 10px;background:rgba(29,23,31,.76)}
.nav{display:flex;gap:5px;padding:4px;border:1px solid rgba(201,163,188,.16);border-radius:12px;background:rgba(24,20,26,.74)}
.nav button,.ghost{color:#c6bbc6;background:transparent;border:1px solid transparent;border-radius:8px;padding:8px 13px;cursor:pointer;transition:.16s ease}
.nav button.active{color:#fff;border-color:rgba(255,150,193,.42);background:linear-gradient(135deg,rgba(232,91,148,.3),rgba(255,146,189,.2));box-shadow:inset 0 1px rgba(255,255,255,.14)}.nav button:hover,.ghost:hover{color:#fff;background:rgba(255,255,255,.06)}
.wrap{max-width:1180px;margin:0 auto;padding:34px 28px 48px}
.muted{color:var(--muted)}
.actions{display:flex;gap:9px;flex-wrap:wrap}
.btn{border:1px solid rgba(255,167,204,.4);border-radius:10px;padding:10px 14px;background:linear-gradient(135deg,var(--accent-start),var(--accent-end));color:#fff;font-weight:750;cursor:pointer;box-shadow:0 8px 18px rgba(213,61,123,.19);transition:transform .16s ease,filter .16s ease}.btn:hover{filter:brightness(1.07);transform:translateY(-1px)}.btn:disabled{cursor:wait;opacity:.7;transform:none}
.btn.secondary{color:#eee6ee;background:rgba(42,34,45,.84);border-color:#4a394c;box-shadow:none}.btn.danger{background:rgba(103,41,58,.7);color:#ffe2e8;border-color:#81465a;box-shadow:none}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:0 0 16px;flex-wrap:wrap}.section-head h2{margin:0 0 5px;font-size:24px;letter-spacing:-.035em}.section-kicker{color:#ff9ac2;font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;margin:0 0 8px}
.grid{display:grid;gap:10px}.accounts-grid{grid-template-columns:repeat(auto-fill,minmax(330px,1fr));align-items:stretch}
.card{border:1px solid rgba(202,164,188,.18);border-radius:15px;background:linear-gradient(145deg,rgba(28,23,31,.97),rgba(18,16,21,.97));padding:15px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px;box-shadow:var(--shadow);transition:border-color .16s ease,transform .16s ease}.card:hover{border-color:rgba(255,151,194,.36);transform:translateY(-1px)}
.accounts-grid .card{align-items:stretch;flex-direction:column}.accounts-grid .identity{width:100%}.accounts-grid .meta{width:100%;justify-content:flex-end}
.accounts-grid .meta .btn{flex:0 0 30%;max-width:170px}
.accounts-grid .meta .btn.danger:only-of-type{flex:0 0 auto;margin-left:auto;min-width:132px}
.card.job{align-items:flex-start}
.identity{min-width:0}.account-email{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-id{font:11px ui-monospace,monospace;margin-top:4px;opacity:.75}
.badge{border:1px solid rgba(97,209,124,.42);background:rgba(38,101,58,.34);color:#a7f3ba;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:750;white-space:nowrap}.badge.off{border-color:rgba(255,123,135,.36);background:rgba(111,38,48,.34);color:#ffc0c8}.badge.cool{border-color:rgba(243,201,105,.38);background:rgba(105,78,23,.28);color:#ffe19a}
.empty{border:1px dashed rgba(202,164,188,.3);border-radius:15px;padding:24px;color:var(--muted);background:rgba(24,20,26,.58)}
.error{color:var(--red);margin-top:6px}
dialog{border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--text);padding:0;width:min(460px,92vw)}
dialog::backdrop{background:rgba(0,0,0,.55)}
#captchaDialog{width:min(1100px,96vw)}
.modal{padding:18px}
.modal h3{margin:0 0 6px}
.fields{display:grid;gap:12px;margin:16px 0}
label{display:grid;gap:6px;color:var(--muted)}
input{background:#151118;border:1px solid var(--line);border-radius:8px;color:var(--text);padding:10px 12px}input:focus{outline:0;border-color:#ff8fba;box-shadow:0 0 0 3px rgba(232,91,148,.14)}
.modal-actions{display:flex;justify-content:flex-end;gap:8px}
.notice{border:1px solid #3a3320;background:#1a160c;color:#e6d39a;border-radius:8px;padding:10px 12px;margin:0 0 14px;font-size:13px}
.captcha-stage{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#111;margin:16px 0}.captcha-stage iframe{display:block;width:100%;height:min(70vh,720px);border:0}.captcha-stage img{display:block;width:100%;touch-action:none;user-select:none;cursor:grab}.captcha-stage img.dragging{cursor:grabbing}
.meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
[hidden]{display:none !important}
.jobs{margin-top:36px;padding-top:30px;border-top:1px solid rgba(202,164,188,.16)}.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));gap:12px}.metric-card{position:relative;overflow:hidden;align-items:start;display:grid;gap:8px;min-height:144px;padding:18px}.metric-card::after{content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,var(--accent-start),var(--accent-end))}.metric-card:nth-child(1)::after{background:var(--green)}.metric-card:nth-child(3)::after{background:var(--yellow)}.metric-value{font-size:27px;letter-spacing:-.04em}.metric-label{color:#d2c6d1;font-size:12px;font-weight:750;text-transform:uppercase;letter-spacing:.075em}.metric-action{align-self:end;justify-self:start;padding:0;border:0;background:transparent;color:#ffadd0;font-weight:750;cursor:pointer}.metric-action:hover{color:#fff;text-decoration:underline}
@media(max-width:680px){.top{padding:12px 16px;gap:12px;align-items:flex-start;flex-direction:column}.brand-copy{flex-wrap:wrap}.wrap{padding:24px 16px 36px}.section-head{align-items:flex-start;flex-direction:column}.actions{width:100%}.actions .btn{flex:1}.accounts-grid{grid-template-columns:1fr}.card{align-items:flex-start;flex-direction:column}.card .meta{width:100%}.nav{width:100%}.nav button{flex:1}.endpoint{font-size:11px}}
</style></head><body>
<header class="top">
  <div class="brand"><span class="brand-copy">QwenSofia <span class="endpoint" id="endpoint">127.0.0.1</span></span></div>
  <nav class="nav">
    <button type="button" class="active" id="accountsBtn">Contas</button>
    <button type="button" id="metricsBtn">Métricas</button>
  </nav>
</header>
<main class="wrap">
  <div id="accountsView">
    <div class="section-head">
      <div>
        <div class="section-kicker">Gerenciamento do pool</div>
        <h2>Fila de contas</h2>
        <div class="muted" id="summary">Carregando contas…</div>
      </div>
      <div class="actions">
        <button type="button" class="btn secondary" id="refreshBtn">Atualizar</button>
        <button type="button" class="btn secondary" id="authAllBtn">Autenticar todas</button>
        <button type="button" class="btn secondary" id="addBtn">Adicionar conta</button>
        <button type="button" class="btn secondary" id="autoBtn">Criar automática</button>
        <button type="button" class="btn" id="createBtn">Criar conta</button>
      </div>
    </div>

    <section id="accounts" class="grid accounts-grid"></section>

    <section class="jobs">
      <div class="section-head">
        <div>
          <div class="section-kicker">Acompanhamento</div>
          <h2>Criação de contas</h2>
          <div class="muted">Acompanhe cadastros e verificações em andamento.</div>
        </div>
      </div>
      <div id="jobs" class="grid"></div>
    </section>
  </div>

  <section id="metricsView" hidden>
    <div class="section-head">
      <div>
        <div class="section-kicker">Visão em tempo real</div>
        <h2>Métricas do serviço</h2>
        <div class="muted" id="metricsUpdated">Carregando métricas…</div>
      </div>
    </div>
    <div id="metricsCards" class="metric-grid"></div>
  </section>
</main>

<dialog id="accountDialog">
  <form class="modal" id="addForm">
    <h3>Adicionar conta existente</h3>
    <div class="muted">As credenciais são criptografadas no banco local e a conta é autenticada automaticamente.</div>
    <div class="fields">
      <label>E-mail<input name="email" type="email" required></label>
      <label>Senha<input name="password" type="password" required></label>
    </div>
    <div class="modal-actions">
      <button type="button" class="ghost" data-close>Cancelar</button>
      <button class="btn">Adicionar</button>
    </div>
  </form>
</dialog>

<dialog id="concurrencyDialog">
  <form class="modal" id="concurrencyForm">
    <h3>Concorrência por conta</h3>
    <div class="muted">Define quantas requisições a mesma conta pode processar ao mesmo tempo.</div>
    <div class="fields">
      <label>Requisições simultâneas por conta<input id="concurrencyInput" name="maxConcurrent" type="number" min="1" max="100" step="1" required></label>
    </div>
    <div class="notice">A alteração é aplicada imediatamente e fica salva para os próximos reinícios.</div>
    <div class="modal-actions">
      <button type="button" class="ghost" data-close>Cancelar</button>
      <button class="btn">Salvar limite</button>
      <button type="button" class="btn secondary" id="restartConcurrencyBtn">Salvar e reiniciar agora</button>
    </div>
  </form>
</dialog>

<dialog id="createDialog">
  <form class="modal" id="createForm">
    <h3>Criar uma conta Qwen</h3>
    <div class="muted">O navegador preencherá o cadastro, autenticará a sessão e adicionará a conta ao pool automaticamente.</div>
    <div class="fields">
      <label>Nome de exibição<input name="displayName" required></label>
      <label>E-mail que você controla<input name="email" type="email" required></label>
      <label>Senha (mínimo 8 caracteres)<input name="password" type="password" minlength="8" required></label>
    </div>
    <div class="notice">Quando o Qwen pedir CAPTCHA, ele aparece neste painel para você arrastar a peça. O restante continua automático.</div>
    <div class="modal-actions">
      <button type="button" class="ghost" data-close>Cancelar</button>
      <button class="btn">Iniciar criação</button>
    </div>
  </form>
</dialog>

<dialog id="captchaDialog">
  <div class="modal">
    <h3>Resolver CAPTCHA</h3>
    <div class="muted" id="captchaStatus">Conectando ao navegador do cadastro…</div>
    <div class="captcha-stage">
      <iframe id="captchaRemote" title="Navegador interativo do cadastro" src="about:blank"></iframe>
      <img id="captchaImage" alt="Captura de compatibilidade do CAPTCHA" draggable="false" hidden>
    </div>
    <div class="notice">Esta é a janela real do cadastro. Use o mouse diretamente nela e arraste o botão roxo do CAPTCHA.</div>
    <div class="modal-actions">
      <button type="button" class="ghost" id="captchaCloseBtn">Fechar</button>
    </div>
  </div>
</dialog>

<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

async function api(url, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {}),
  };
  const r = await fetch(url, { ...options, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
  return data;
}

function cooldownBadge(cooldown) {
  if (!cooldown || !cooldown.remainingMs || cooldown.remainingMs <= 0) return "";
  const mins = Math.max(1, Math.ceil(cooldown.remainingMs / 60000));
  return '<span class="badge cool">Cooldown ' + mins + "m</span>";
}

function accountCard(a) {
  const authBadge = a.authenticated
    ? '<span class="badge">Ativa</span>'
    : '<span class="badge off">Inativa</span>';
  const authBtn = a.authenticated
    ? ""
    : '<button type="button" class="btn secondary" data-auth="' + esc(a.id) + '">Autenticar</button>';
  return (
    '<article class="card">' +
      '<div class="identity"><strong class="account-email">' + esc(a.email) + '</strong><div class="muted account-id">' + esc(a.id) + "</div></div>" +
      '<div class="meta">' +
        authBadge +
        cooldownBadge(a.cooldown) +
        authBtn +
        '<button type="button" class="btn danger" data-remove="' + esc(a.id) + '">Remover</button>' +
      "</div>" +
    "</article>"
  );
}

function jobCard(j) {
  const ready = j.ready
    ? ' · pronta'
    : (j.state === 'pending_activation'
      ? ' · pendente e-mail'
      : (j.state === 'completed' ? ' · incompleta' : ''));
  const badgeClass = j.state === 'failed'
    ? 'off'
    : (j.ready
      ? ''
      : (j.state === 'pending_activation'
        ? 'cool'
        : (j.state === 'completed' ? 'cool' : '')));
  const captchaAction = j.state === 'solving-captcha'
    ? '<button type="button" class="btn secondary" data-captcha="' + esc(j.id) + '">Resolver CAPTCHA</button>'
    : '';
  return (
    '<article class="card job">' +
      "<div><strong>" + esc(j.email) + '</strong><div class="muted">' + esc(j.message) + "</div>" +
      (j.provider ? '<div class="muted">provider: ' + esc(j.provider) + '</div>' : '') +
      (j.verificationCode ? '<div class="muted">código: ' + esc(j.verificationCode) + '</div>' : '') +
      (j.error ? '<div class="error">' + esc(j.error) + "</div>" : "") +
      "</div>" +
      '<div class="meta">' + captchaAction + '<span class="badge ' + badgeClass + '">' + esc(j.state) + ready + "</span></div>" +
    "</article>"
  );
}

function metricCard(label, value, detail, action = "") {
  return (
    '<article class="card metric-card">' +
      '<div class="metric-label">' + esc(label) + '</div>' +
      '<strong class="metric-value">' + esc(value) + '</strong>' +
      '<div class="muted">' + esc(detail) + '</div>' +
      action +
    '</article>'
  );
}

let activeView = "accounts";
let captchaJobId = "";
let captchaPointerId = null;
let captchaStartedAt = 0;
let captchaImageUrl = "";
let captchaRefreshTimer = null;
let captchaSubmitting = false;
let captchaPointerStart = Promise.resolve();
let captchaPendingMove = null;
let captchaMovePromise = null;
let captchaPointerError = null;
const CAPTCHA_REFRESH_DELAY_MS = 750;
const CAPTCHA_DRAG_REFRESH_DELAY_MS = 100;

function setCaptchaStatus(message) {
  $("#captchaStatus").textContent = message;
}

function clearCaptchaImage() {
  if (captchaImageUrl) URL.revokeObjectURL(captchaImageUrl);
  captchaImageUrl = "";
  $("#captchaImage").removeAttribute("src");
}

function resetCaptchaDialog() {
  if (captchaPointerId !== null) cancelCaptchaPointer();
  if (captchaRefreshTimer) clearTimeout(captchaRefreshTimer);
  captchaRefreshTimer = null;
  captchaJobId = "";
  captchaPointerId = null;
  captchaSubmitting = false;
  captchaPendingMove = null;
  captchaMovePromise = null;
  captchaPointerError = null;
  $("#captchaImage").classList.remove("dragging");
  $("#captchaRemote").src = "about:blank";
  clearCaptchaImage();
}

function stopCaptchaRefresh() {
  if (captchaRefreshTimer) clearTimeout(captchaRefreshTimer);
  captchaRefreshTimer = null;
}

function scheduleCaptchaRefresh(delay = CAPTCHA_REFRESH_DELAY_MS) {
  stopCaptchaRefresh();
  if (!captchaJobId) return;
  captchaRefreshTimer = setTimeout(() => {
    captchaRefreshTimer = null;
    loadCaptchaImage();
  }, delay);
}

function closeCaptchaDialog() {
  const dialog = $("#captchaDialog");
  if (dialog.open) dialog.close();
  else resetCaptchaDialog();
}

async function loadCaptchaImage() {
  const jobId = captchaJobId;
  if (!jobId) return;
  stopCaptchaRefresh();
  try {
    const response = await fetch(
      "/api/admin/registrations/" + encodeURIComponent(jobId) + "/captcha",
      { cache: "no-store" },
    );
    if (jobId !== captchaJobId) return;
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setCaptchaStatus(data.error || "O desafio não está mais disponível.");
      return;
    }
    const nextUrl = URL.createObjectURL(await response.blob());
    if (jobId !== captchaJobId) {
      URL.revokeObjectURL(nextUrl);
      return;
    }
    clearCaptchaImage();
    captchaImageUrl = nextUrl;
    $("#captchaImage").src = nextUrl;
    setCaptchaStatus(
      captchaPointerId !== null
        ? "Movimento ao vivo: continue arrastando até encaixar a peça."
        : "Clique e arraste a peça ou o botão roxo até o encaixe. Atualização automática ativa.",
    );
  } catch (error) {
    setCaptchaStatus(error.message || "Não foi possível carregar o desafio.");
  } finally {
    if (jobId === captchaJobId) {
      scheduleCaptchaRefresh(
        captchaPointerId !== null
          ? CAPTCHA_DRAG_REFRESH_DELAY_MS
          : CAPTCHA_REFRESH_DELAY_MS,
      );
    }
  }
}

function openCaptchaDialog(jobId) {
  resetCaptchaDialog();
  captchaJobId = jobId;
  $("#captchaDialog").showModal();
  setCaptchaStatus("Abrindo a janela real do cadastro no seu PC…");
  $("#captchaRemote").src = "/remote-browser?job=" + encodeURIComponent(jobId);
}

function captchaPoint(event) {
  const rect = $("#captchaImage").getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    t: Date.now() - captchaStartedAt,
  };
}

function sendCaptchaPointer(jobId, phase, point) {
  return api(
    "/api/admin/registrations/" + encodeURIComponent(jobId) + "/captcha/pointer",
    {
      method: "POST",
      body: JSON.stringify(point ? { phase, point } : { phase }),
    },
  );
}

function beginCaptchaPointer(point) {
  const jobId = captchaJobId;
  captchaPendingMove = null;
  captchaMovePromise = null;
  captchaPointerError = null;
  captchaPointerStart = sendCaptchaPointer(jobId, "start", point);
  captchaPointerStart.catch((error) => {
    captchaPointerError = error;
    setCaptchaStatus(error.message || "Não foi possível iniciar o arraste ao vivo.");
  });
}

function queueCaptchaMove(point) {
  captchaPendingMove = point;
  if (captchaMovePromise) return captchaMovePromise;
  const jobId = captchaJobId;
  captchaMovePromise = (async () => {
    await captchaPointerStart;
    while (captchaPendingMove && jobId === captchaJobId) {
      const nextPoint = captchaPendingMove;
      captchaPendingMove = null;
      await sendCaptchaPointer(jobId, "move", nextPoint);
    }
  })()
    .catch((error) => {
      captchaPointerError = error;
      setCaptchaStatus(error.message || "O movimento ao vivo foi interrompido.");
    })
    .finally(() => {
      captchaMovePromise = null;
    });
  return captchaMovePromise;
}

async function finishCaptchaPointer(point) {
  const jobId = captchaJobId;
  if (!jobId) return;
  captchaSubmitting = true;
  setCaptchaStatus("Finalizando o arraste e verificando o CAPTCHA…");
  try {
    await queueCaptchaMove(point);
    if (captchaPointerError) throw captchaPointerError;
    await sendCaptchaPointer(jobId, "end", point);
    setCaptchaStatus("Verificando o CAPTCHA…");
    setTimeout(load, 800);
  } catch (error) {
    await sendCaptchaPointer(jobId, "cancel").catch(() => {});
    setCaptchaStatus(error.message || "O arraste não pôde ser enviado.");
  } finally {
    captchaSubmitting = false;
    captchaPendingMove = null;
    captchaMovePromise = null;
    captchaPointerError = null;
    captchaPointerId = null;
    $("#captchaImage").classList.remove("dragging");
    scheduleCaptchaRefresh(150);
  }
}

async function cancelCaptchaPointer() {
  const jobId = captchaJobId;
  const movePromise = captchaMovePromise;
  captchaPendingMove = null;
  if (!jobId) return;
  try {
    await captchaPointerStart.catch(() => {});
    if (movePromise) await movePromise;
    await sendCaptchaPointer(jobId, "cancel");
  } catch {}
}

function showView(view) {
  activeView = view;
  const metrics = view === "metrics";
  $("#accountsView").hidden = metrics;
  $("#metricsView").hidden = !metrics;
  $("#accountsBtn").classList.toggle("active", !metrics);
  $("#metricsBtn").classList.toggle("active", metrics);
}

async function loadMetrics() {
  try {
    const d = await api("/health");
    const runtime = d.accountRuntime || {};
    const concurrency = d.accountConcurrency || {};
    const cache = (d.metrics && d.metrics.cache) || {};
    const cards = [
      metricCard("Estado", d.status || "desconhecido", "Saúde geral do QwenSofia"),
      metricCard("Navegadores", runtime.initialized || 0, (runtime.withHeaders || 0) + " com bx-ua em cache"),
      metricCard("Requisições", concurrency.activeRequests || 0, (concurrency.queuedRequests || 0) + " aguardando na fila"),
      metricCard("Concorrência", concurrency.limitPerAccount || 0, "limite por conta · pico " + (concurrency.peakActivePerAccount || 0), '<button type="button" class="metric-action" id="concurrencyBtn">Alterar limite</button>'),
      metricCard("Cache", cache.connected ? "Conectado" : "Indisponível", (cache.keysCount || 0) + " chave(s) · " + (cache.memoryUsage || "0KB")),
    ];
    $("#metricsCards").innerHTML = cards.join("");
    $("#metricsUpdated").textContent = "Atualizado em " + new Date(d.timestamp || Date.now()).toLocaleString("pt-BR");
  } catch (e) {
    $("#metricsUpdated").innerHTML = '<span class="error">' + esc(e.message) + '</span>';
    $("#metricsCards").innerHTML = '<div class="empty">Não foi possível carregar as métricas.</div>';
  }
}

async function load() {
  try {
    const d = await api("/api/admin/overview");
    const base = (d.proxy && d.proxy.baseUrl) || (location.origin + "/v1");
    $("#endpoint").textContent = base.endsWith("/v1") ? base.slice(0, -3) : base;

    const ac = d.autoCreator || {};
    let acText = "auto-create desativado";
    if (ac.enabled) {
      if (ac.busy) acText = "criando… " + (ac.message || "");
      else if (ac.lastEmail) acText = "última auto: " + ac.lastEmail;
      else acText = ac.message || "auto-create ativo";
    }
    const accounts = Array.isArray(d.accounts) ? d.accounts : [];
    updateBulkAuthentication(d.bulkAuthentication);
    const registrations = Array.isArray(d.registrations) ? d.registrations : [];
    $("#summary").textContent = accounts.length + " conta(s) salva(s) — " + acText;
    $("#accounts").innerHTML = accounts.length
      ? accounts.map(accountCard).join("")
      : '<div class="empty"><strong>Nenhuma conta salva</strong><p>Adicione uma conta existente ou inicie um cadastro.</p></div>';
    $("#jobs").innerHTML = registrations.length
      ? registrations.map(jobCard).join("")
      : '<div class="empty">Nenhum cadastro executado neste runtime.</div>';
    if (
      captchaJobId &&
      !registrations.some((job) => job.id === captchaJobId && job.state === "solving-captcha")
    ) {
      closeCaptchaDialog();
    }
  } catch (e) {
    $("#summary").innerHTML = '<span class="error">' + esc(e.message) + "</span>";
    $("#accounts").innerHTML =
      '<div class="empty"><strong>Falha ao carregar contas</strong><p>' +
      esc(e.message) +
      "</p></div>";
  }
}

async function addAccount(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = { ...Object.fromEntries(f.entries()), authenticate: true };
  try {
    const r = await api("/api/admin/accounts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    e.target.closest("dialog").close();
    e.target.reset();
    if (r.authError) alert("Conta adicionada, mas autenticação automática falhou: " + r.authError);
    load();
  } catch (x) {
    alert(x.message);
  }
}

async function createAccount(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api("/api/admin/registrations", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(f.entries())),
    });
    e.target.closest("dialog").close();
    e.target.reset();
    load();
  } catch (x) {
    alert(x.message);
  }
}

async function authenticate(id, button) {
  button.disabled = true;
  button.textContent = "Autenticando…";
  try {
    await api("/api/admin/accounts/" + id + "/authenticate", { method: "POST" });
    load();
  } catch (e) {
    alert(e.message);
    button.disabled = false;
    button.textContent = "Autenticar";
  }
}

async function authenticateAll() {
  const inactive = [...document.querySelectorAll("[data-auth]")].length;
  if (inactive === 0) {
    alert("Todas as contas já estão ativas.");
    return;
  }
  if (!confirm("Autenticar " + inactive + " conta(s) inativa(s), uma por vez? As contas já ativas não serão interrompidas.")) return;
  try {
    await api("/api/admin/accounts/authenticate-all", { method: "POST" });
    load();
  } catch (e) {
    alert(e.message);
  }
}

async function removeAccount(id) {
  if (!confirm("Remover esta conta e sua sessão local?")) return;
  try {
    await api("/api/admin/accounts/" + id, { method: "DELETE" });
    load();
  } catch (e) {
    alert(e.message);
  }
}

async function autoCreateOne() {
  const ok = confirm(
    "Criar 1 conta automática (email/senha aleatórios), autenticar e adicionar ao pool? Se o Qwen pedir CAPTCHA, ele aparecerá neste painel para você resolver; depois o restante continua automático."
  );
  if (!ok) return;
  try {
    const r = await api("/api/admin/account-creator/run", {
      method: "POST",
      body: JSON.stringify({ count: 1 }),
    });
    alert(r.message || "Criação iniciada.");
    load();
  } catch (e) {
    alert(e.message);
  }
}

async function saveConcurrency(e) {
  e.preventDefault();
  const value = Number(new FormData(e.target).get("maxConcurrent"));
  try {
    await api("/api/admin/account-concurrency", {
      method: "PUT",
      body: JSON.stringify({ maxConcurrent: value }),
    });
    $("#concurrencyDialog").close();
    loadMetrics();
  } catch (x) {
    alert(x.message);
  }
}

function updateBulkAuthentication(status) {
  const button = $("#authAllBtn");
  if (!status || !status.running) {
    button.disabled = false;
    button.textContent = "Autenticar todas";
    return;
  }
  button.disabled = true;
  button.textContent = "Autenticando " + status.completed + "/" + status.total;
}

async function saveConcurrencyAndRestart() {
  const form = $("#concurrencyForm");
  if (!form.reportValidity()) return;
  if (!confirm("Salvar o novo limite e reiniciar o QwenSofia agora? Requisições em andamento serão interrompidas.")) return;
  const button = $("#restartConcurrencyBtn");
  button.disabled = true;
  button.textContent = "Reiniciando…";
  const value = Number(new FormData(form).get("maxConcurrent"));
  try {
    await api("/api/admin/account-concurrency/restart", {
      method: "PUT",
      body: JSON.stringify({ maxConcurrent: value }),
    });
    $("#concurrencyDialog").close();
    alert("Limite salvo. O QwenSofia está reiniciando; aguarde alguns segundos antes de usar o painel.");
  } catch (x) {
    alert(x.message);
    button.disabled = false;
    button.textContent = "Salvar e reiniciar agora";
  }
}

// Event bindings (no inline handlers for critical actions)
$("#accountsBtn").addEventListener("click", () => {
  showView("accounts");
  load();
});
$("#metricsBtn").addEventListener("click", () => {
  showView("metrics");
  loadMetrics();
});
$("#refreshBtn").addEventListener("click", load);
$("#authAllBtn").addEventListener("click", authenticateAll);
$("#addBtn").addEventListener("click", () => $("#accountDialog").showModal());
$("#createBtn").addEventListener("click", () => $("#createDialog").showModal());
$("#autoBtn").addEventListener("click", autoCreateOne);
$("#captchaCloseBtn").addEventListener("click", closeCaptchaDialog);
$("#captchaDialog").addEventListener("close", resetCaptchaDialog);
$("#addForm").addEventListener("submit", addAccount);
$("#createForm").addEventListener("submit", createAccount);
$("#concurrencyForm").addEventListener("submit", saveConcurrency);
$("#restartConcurrencyBtn").addEventListener("click", saveConcurrencyAndRestart);
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => btn.closest("dialog").close());
});
$("#accounts").addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  const authId = t.getAttribute("data-auth");
  const removeId = t.getAttribute("data-remove");
  if (authId) authenticate(authId, t);
  if (removeId) removeAccount(removeId);
});
$("#jobs").addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const captchaId = target.getAttribute("data-captcha");
  if (captchaId) openCaptchaDialog(captchaId);
});
$("#captchaImage").addEventListener("pointerdown", (event) => {
  if (!captchaJobId || captchaSubmitting || !event.currentTarget.src) return;
  event.preventDefault();
  captchaPointerId = event.pointerId;
  captchaStartedAt = Date.now();
  beginCaptchaPointer(captchaPoint(event));
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.classList.add("dragging");
  setCaptchaStatus("Movimento ao vivo iniciado. Arraste devagar para acompanhar a peça.");
  scheduleCaptchaRefresh(CAPTCHA_DRAG_REFRESH_DELAY_MS);
});
$("#captchaImage").addEventListener("pointermove", (event) => {
  if (event.pointerId !== captchaPointerId) return;
  queueCaptchaMove(captchaPoint(event));
});
$("#captchaImage").addEventListener("pointerup", async (event) => {
  if (event.pointerId !== captchaPointerId) return;
  event.currentTarget.releasePointerCapture(event.pointerId);
  await finishCaptchaPointer(captchaPoint(event));
});
$("#captchaImage").addEventListener("pointercancel", async (event) => {
  if (event.pointerId !== captchaPointerId) return;
  await cancelCaptchaPointer();
  captchaPointerId = null;
  event.currentTarget.classList.remove("dragging");
  setCaptchaStatus("Arraste cancelado. Tente novamente.");
  scheduleCaptchaRefresh(150);
});
$("#metricsCards").addEventListener("click", (e) => {
  if (!(e.target instanceof HTMLElement) || e.target.id !== "concurrencyBtn") return;
  $("#concurrencyInput").value = String($("#concurrencyBtn").closest(".metric-card").querySelector(".metric-value").textContent);
  $("#concurrencyDialog").showModal();
});

load();
setInterval(() => activeView === "metrics" ? loadMetrics() : load(), 30000);
</script>
</body></html>`;
