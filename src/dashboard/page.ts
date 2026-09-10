export const dashboardHtml = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QwenSofia</title><style>
:root{color-scheme:dark;--bg:#080b12;--bg-soft:#0d1120;--panel:rgba(19,24,37,.88);--panel-strong:#151b29;--line:#293146;--muted:#9da9bc;--text:#f3f6fc;--green:#61d17c;--blue:#8b9dff;--purple:#b188ff;--red:#ff7b87;--yellow:#f3c969;--shadow:0 18px 44px rgba(0,0,0,.24)}
*{box-sizing:border-box}body{min-height:100vh;margin:0;background:radial-gradient(circle at 10% -10%,rgba(93,104,239,.24),transparent 31rem),radial-gradient(circle at 100% 0,rgba(118,74,222,.14),transparent 24rem),var(--bg);color:var(--text);font:14px Inter,Segoe UI,Arial,sans-serif;letter-spacing:.005em}
button,input{font:inherit}
.top{min-height:76px;border-bottom:1px solid rgba(142,158,196,.17);display:flex;align-items:center;justify-content:space-between;padding:0 max(28px,calc((100vw - 1180px)/2));background:rgba(8,11,18,.74);backdrop-filter:blur(18px);position:sticky;top:0;z-index:2}
.brand{display:flex;align-items:center;font-weight:760;font-size:18px;letter-spacing:-.02em}.brand-copy{display:flex;align-items:center;gap:10px}
.endpoint{color:#c1c9dc;font:12px ui-monospace,monospace;border:1px solid rgba(147,159,195,.22);border-radius:999px;padding:6px 10px;background:rgba(18,23,35,.65)}
.nav{display:flex;gap:5px;padding:4px;border:1px solid rgba(147,159,195,.16);border-radius:12px;background:rgba(20,25,38,.65)}
.nav button,.ghost{color:#b9c3d7;background:transparent;border:1px solid transparent;border-radius:8px;padding:8px 13px;cursor:pointer;transition:.16s ease}
.nav button.active{color:#fff;border-color:rgba(148,157,255,.35);background:linear-gradient(135deg,rgba(117,133,255,.24),rgba(144,99,228,.20));box-shadow:inset 0 1px rgba(255,255,255,.12)}.nav button:hover,.ghost:hover{color:#fff;background:rgba(255,255,255,.06)}
.wrap{max-width:1180px;margin:0 auto;padding:34px 28px 48px}
.muted{color:var(--muted)}
.actions{display:flex;gap:9px;flex-wrap:wrap}
.btn{border:1px solid transparent;border-radius:10px;padding:10px 14px;background:linear-gradient(135deg,#56c974,#45ad66);color:#06140b;font-weight:750;cursor:pointer;box-shadow:0 8px 18px rgba(65,177,96,.18);transition:transform .16s ease,filter .16s ease}.btn:hover{filter:brightness(1.08);transform:translateY(-1px)}.btn:disabled{cursor:wait;opacity:.7;transform:none}
.btn.secondary{color:#e7edfb;background:rgba(37,46,66,.88);border-color:#35415a;box-shadow:none}.btn.danger{background:rgba(94,35,48,.72);color:#ffd1d6;border-color:#794052;box-shadow:none}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:0 0 16px;flex-wrap:wrap}.section-head h2{margin:0 0 5px;font-size:24px;letter-spacing:-.035em}.section-kicker{color:#9eabff;font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;margin:0 0 8px}
.grid{display:grid;gap:10px}.accounts-grid{grid-template-columns:repeat(auto-fill,minmax(330px,1fr));align-items:stretch}
.card{border:1px solid rgba(145,160,198,.18);border-radius:15px;background:linear-gradient(145deg,rgba(27,34,51,.95),rgba(16,20,31,.94));padding:15px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px;box-shadow:0 8px 22px rgba(0,0,0,.12);transition:border-color .16s ease,transform .16s ease}.card:hover{border-color:rgba(151,166,255,.38);transform:translateY(-1px)}
.accounts-grid .card{align-items:stretch;flex-direction:column}.accounts-grid .identity{width:100%}.accounts-grid .meta{width:100%;justify-content:flex-end}
.accounts-grid .meta .btn.danger:only-of-type{flex:0 0 auto;margin-left:auto;min-width:132px}
.card.job{align-items:flex-start}
.identity{display:flex;align-items:center;gap:12px;min-width:0}
.avatar{width:40px;height:40px;border-radius:13px;background:linear-gradient(145deg,#2e4160,#222b52);display:grid;place-items:center;font-weight:800;color:#d6e4ff;flex:0 0 auto}.account-email{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-id{font:11px ui-monospace,monospace;margin-top:4px;opacity:.75}
.badge{border:1px solid rgba(97,209,124,.42);background:rgba(38,101,58,.34);color:#a7f3ba;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:750;white-space:nowrap}.badge.off{border-color:rgba(255,123,135,.36);background:rgba(111,38,48,.34);color:#ffc0c8}.badge.cool{border-color:rgba(243,201,105,.38);background:rgba(105,78,23,.28);color:#ffe19a}
.empty{border:1px dashed rgba(145,160,198,.32);border-radius:15px;padding:24px;color:var(--muted);background:rgba(18,23,35,.55)}
.error{color:var(--red);margin-top:6px}
dialog{border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--text);padding:0;width:min(460px,92vw)}
dialog::backdrop{background:rgba(0,0,0,.55)}
.modal{padding:18px}
.modal h3{margin:0 0 6px}
.fields{display:grid;gap:12px;margin:16px 0}
label{display:grid;gap:6px;color:var(--muted)}
input{background:#0b0f14;border:1px solid var(--line);border-radius:8px;color:var(--text);padding:10px 12px}
.modal-actions{display:flex;justify-content:flex-end;gap:8px}
.notice{border:1px solid #3a3320;background:#1a160c;color:#e6d39a;border-radius:8px;padding:10px 12px;margin:0 0 14px;font-size:13px}
.meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
[hidden]{display:none !important}
.jobs{margin-top:36px;padding-top:30px;border-top:1px solid rgba(145,160,198,.16)}.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));gap:12px}.metric-card{position:relative;overflow:hidden;align-items:start;display:grid;gap:8px;min-height:144px;padding:18px}.metric-card::after{content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,var(--blue),var(--purple))}.metric-card:nth-child(1)::after{background:var(--green)}.metric-card:nth-child(3)::after{background:var(--yellow)}.metric-value{font-size:27px;letter-spacing:-.04em}.metric-label{color:#b7c2d8;font-size:12px;font-weight:750;text-transform:uppercase;letter-spacing:.075em}.metric-action{align-self:end;justify-self:start;padding:0;border:0;background:transparent;color:#b9c7ff;font-weight:750;cursor:pointer}.metric-action:hover{color:#fff;text-decoration:underline}
@media(max-width:680px){.top{padding:12px 16px;gap:12px;align-items:flex-start;flex-direction:column}.brand-copy{flex-wrap:wrap}.wrap{padding:24px 16px 36px}.section-head{align-items:flex-start;flex-direction:column}.actions{width:100%}.actions .btn{flex:1}.accounts-grid{grid-template-columns:1fr}.card{align-items:flex-start;flex-direction:column}.card .meta{width:100%}.card .meta .btn{flex:1}.nav{width:100%}.nav button{flex:1}.endpoint{font-size:11px}}
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
    <div class="notice">CAPTCHA e confirmação de e-mail, quando exigidos, precisam ser concluídos por você na janela do navegador.</div>
    <div class="modal-actions">
      <button type="button" class="ghost" data-close>Cancelar</button>
      <button class="btn">Iniciar criação</button>
    </div>
  </form>
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

function initials(email) {
  return String(email || "??").slice(0, 2).toUpperCase();
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
      '<div class="identity">' +
        '<span class="avatar">' + esc(initials(a.email)) + "</span>" +
        '<div><strong class="account-email">' + esc(a.email) + '</strong><div class="muted account-id">' + esc(a.id) + "</div></div>" +
      "</div>" +
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
  return (
    '<article class="card job">' +
      "<div><strong>" + esc(j.email) + '</strong><div class="muted">' + esc(j.message) + "</div>" +
      (j.provider ? '<div class="muted">provider: ' + esc(j.provider) + '</div>' : '') +
      (j.verificationCode ? '<div class="muted">código: ' + esc(j.verificationCode) + '</div>' : '') +
      (j.error ? '<div class="error">' + esc(j.error) + "</div>" : "") +
      "</div>" +
      '<span class="badge ' + badgeClass + '">' + esc(j.state) + ready + "</span>" +
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
    const registrations = Array.isArray(d.registrations) ? d.registrations : [];
    $("#summary").textContent = accounts.length + " conta(s) salva(s) — " + acText;
    $("#accounts").innerHTML = accounts.length
      ? accounts.map(accountCard).join("")
      : '<div class="empty"><strong>Nenhuma conta salva</strong><p>Adicione uma conta existente ou inicie um cadastro.</p></div>';
    $("#jobs").innerHTML = registrations.length
      ? registrations.map(jobCard).join("")
      : '<div class="empty">Nenhum cadastro executado neste runtime.</div>';
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
    "Criar 1 conta automática (email/senha aleatórios), autenticar e adicionar ao pool? Se o Qwen pedir CAPTCHA/verificação de e-mail, conclua na janela do navegador."
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
$("#addBtn").addEventListener("click", () => $("#accountDialog").showModal());
$("#createBtn").addEventListener("click", () => $("#createDialog").showModal());
$("#autoBtn").addEventListener("click", autoCreateOne);
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
$("#metricsCards").addEventListener("click", (e) => {
  if (!(e.target instanceof HTMLElement) || e.target.id !== "concurrencyBtn") return;
  $("#concurrencyInput").value = String($("#concurrencyBtn").closest(".metric-card").querySelector(".metric-value").textContent);
  $("#concurrencyDialog").showModal();
});

load();
setInterval(() => activeView === "metrics" ? loadMetrics() : load(), 30000);
</script>
</body></html>`;
