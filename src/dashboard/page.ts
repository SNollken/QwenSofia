export const dashboardHtml = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QwenSofia</title><style>
:root{color-scheme:dark;--bg:#07090d;--panel:#0e1218;--line:#252b35;--muted:#929aa7;--text:#edf1f7;--green:#48a64c;--blue:#62a5ff;--red:#ef6b6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px Inter,Segoe UI,Arial,sans-serif}
button,input{font:inherit}
.top{height:72px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:#0c1015}
.brand{display:flex;align-items:center;gap:13px;font-weight:700;font-size:17px}
.logo{width:30px;height:30px;border-radius:9px;background:linear-gradient(145deg,#7bb8ff,#7357e8);display:grid;place-items:center}
.endpoint{color:var(--muted);font:12px ui-monospace,monospace;border:1px solid var(--line);border-radius:5px;padding:6px 9px}
.nav{display:flex;gap:9px}
.nav button,.ghost{color:#b8c0cc;background:transparent;border:1px solid transparent;border-radius:7px;padding:9px 12px;cursor:pointer}
.nav button.active,.nav button:hover,.ghost:hover{border-color:var(--line);background:#141922}
.wrap{max-width:1050px;margin:0 auto;padding:26px}
.status{display:flex;align-items:center;justify-content:space-between;border:1px solid var(--line);border-radius:9px;padding:15px 17px;background:linear-gradient(120deg,#0e1319,#0a0d12);margin-bottom:28px}
.status-title{display:flex;gap:12px;align-items:center}
.dot{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 10px #48a64c}
.muted{color:var(--muted)}
.actions{display:flex;gap:9px;flex-wrap:wrap}
.btn{border:0;border-radius:7px;padding:10px 14px;background:var(--green);color:white;font-weight:650;cursor:pointer}
.btn.secondary{background:#1b222d;border:1px solid #303846}
.btn.danger{background:#3a181b;color:#ffb9bd;border:1px solid #642b31}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:12px;margin:0 0 14px;flex-wrap:wrap}
.section-head h2{margin:0 0 5px;font-size:21px}
.grid{display:grid;gap:12px}
.card{border:1px solid var(--line);border-radius:9px;background:var(--panel);padding:15px 17px;display:flex;align-items:center;justify-content:space-between;gap:14px}
.card.job{align-items:flex-start}
.identity{display:flex;align-items:center;gap:12px;min-width:0}
.avatar{width:36px;height:36px;border-radius:10px;background:#1a2433;display:grid;place-items:center;font-weight:700;color:#9ec1ff;flex:0 0 auto}
.badge{border:1px solid #2f6b36;background:#143018;color:#8fd392;border-radius:999px;padding:5px 10px;font-size:12px;white-space:nowrap}
.badge.off{border-color:#5a3030;background:#2a1517;color:#ffb4b4}
.badge.cool{border-color:#5a4a20;background:#2a2310;color:#e6c46a}
.empty{border:1px dashed var(--line);border-radius:9px;padding:22px;color:var(--muted)}
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
</style></head><body>
<header class="top">
  <div class="brand"><span class="logo">Q</span>QwenSofia <span class="endpoint" id="endpoint">127.0.0.1</span></div>
  <nav class="nav">
    <button type="button" class="active">Contas</button>
    <button type="button" onclick="location.href='/metrics'">Métricas</button>
    <button type="button" id="configBtn">Configuração</button>
  </nav>
</header>
<main class="wrap">
  <section class="status">
    <div class="status-title">
      <span class="dot"></span>
      <div>
        <strong>Servidor local ativo</strong>
        <div class="muted" id="serverText">Carregando endpoint…</div>
      </div>
    </div>
    <button type="button" class="btn secondary" id="copyBtn">Copiar endpoint</button>
  </section>

  <div class="section-head">
    <div>
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

  <section id="accounts" class="grid"></section>

  <section class="jobs">
    <div class="section-head">
      <div>
        <h2>Criação de contas</h2>
        <div class="muted">Acompanhe cadastros e verificações em andamento.</div>
      </div>
    </div>
    <div id="jobs" class="grid"></div>
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

<dialog id="configDialog">
  <div class="modal">
    <h3>Configuração do cliente</h3>
    <div class="fields">
      <label>Base URL<input id="baseUrl" readonly></label>
      <label>API key<input value="Use o valor de API_KEY do seu .env" readonly></label>
      <label>Token administrativo opcional<input id="adminToken" type="password" placeholder="Valor de ADMIN_TOKEN"></label>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn secondary" id="saveTokenBtn">Salvar token</button>
      <button type="button" class="btn" data-close-config>Fechar</button>
    </div>
  </div>
</dialog>

<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function adminToken() {
  return localStorage.getItem("qwenbridge.adminToken") || "";
}

async function api(url, options = {}) {
  const token = adminToken();
  const headers = {
    "content-type": "application/json",
    ...(token ? { "X-Admin-Token": token } : {}),
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
    ? '<span class="badge">Autenticada</span>'
    : '<span class="badge off">Inativa</span>';
  const authBtn = a.authenticated
    ? ""
    : '<button type="button" class="btn secondary" data-auth="' + esc(a.id) + '">Autenticar</button>';
  return (
    '<article class="card">' +
      '<div class="identity">' +
        '<span class="avatar">' + esc(initials(a.email)) + "</span>" +
        "<div><strong>" + esc(a.email) + '</strong><div class="muted">' + esc(a.id) + "</div></div>" +
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

async function load() {
  try {
    const d = await api("/api/admin/overview");
    const base = (d.proxy && d.proxy.baseUrl) || (location.origin + "/v1");
    $("#endpoint").textContent = base.endsWith("/v1") ? base.slice(0, -3) : base;
    $("#serverText").textContent = "Clientes OpenAI e Anthropic podem usar " + base;
    $("#baseUrl").value = base;

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
      (String(e.message).includes("Token")
        ? " Abra Configuração e informe o ADMIN_TOKEN."
        : "") +
      "</p></div>";
  }
}

function openConfig() {
  $("#adminToken").value = adminToken();
  $("#configDialog").showModal();
}

function saveAdminToken() {
  localStorage.setItem("qwenbridge.adminToken", $("#adminToken").value || "");
  load();
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

// Event bindings (no inline handlers for critical actions)
$("#configBtn").addEventListener("click", openConfig);
$("#copyBtn").addEventListener("click", () => {
  navigator.clipboard.writeText($("#baseUrl").value || location.origin + "/v1");
});
$("#refreshBtn").addEventListener("click", load);
$("#addBtn").addEventListener("click", () => $("#accountDialog").showModal());
$("#createBtn").addEventListener("click", () => $("#createDialog").showModal());
$("#autoBtn").addEventListener("click", autoCreateOne);
$("#addForm").addEventListener("submit", addAccount);
$("#createForm").addEventListener("submit", createAccount);
$("#saveTokenBtn").addEventListener("click", saveAdminToken);
$("#adminToken").addEventListener("change", saveAdminToken);

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => btn.closest("dialog").close());
});
document.querySelectorAll("[data-close-config]").forEach((btn) => {
  btn.addEventListener("click", () => $("#configDialog").close());
});

$("#accounts").addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  const authId = t.getAttribute("data-auth");
  const removeId = t.getAttribute("data-remove");
  if (authId) authenticate(authId, t);
  if (removeId) removeAccount(removeId);
});

load();
setInterval(load, 5000);
</script>
</body></html>`;
