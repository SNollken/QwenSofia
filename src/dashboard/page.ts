export const dashboardHtml = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QwenSofia</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23e85b94'/%3E%3Ctext x='32' y='43' text-anchor='middle' font-size='36' font-family='Arial' font-weight='700' fill='white'%3EQ%3C/text%3E%3C/svg%3E"><style>
:root{color-scheme:dark;--bg:#09090b;--bg-soft:#111013;--panel:rgba(23,20,26,.94);--panel-strong:#19151d;--line:#342936;--muted:#aea3b0;--text:#fff8fc;--accent-start:#e85b94;--accent-end:#ff92bd;--accent-soft:rgba(232,91,148,.18);--green:#6fcb9d;--red:#ed778f;--yellow:#d7b66f;--blue:#7b9ef5;--shadow:0 18px 42px rgba(0,0,0,.28)}
*{box-sizing:border-box}body{min-height:100vh;margin:0;background:radial-gradient(66rem 42rem at 105% -18%,rgba(225,74,136,.16),transparent 56%),radial-gradient(50rem 34rem at -15% 100%,rgba(124,48,89,.1),transparent 58%),linear-gradient(145deg,#09090b 0%,#0d0b10 48%,#111013 100%);color:var(--text);font:14px ui-sans-serif,Segoe UI,Arial,sans-serif;letter-spacing:.005em}
button,input{font:inherit}
.top{min-height:76px;border-bottom:1px solid rgba(200,161,187,.14);display:flex;align-items:center;justify-content:space-between;padding:0 max(28px,calc((100vw - 1180px)/2));background:rgba(9,9,11,.78);backdrop-filter:blur(18px);position:sticky;top:0;z-index:2}
.brand{display:flex;align-items:center;font-weight:760;font-size:18px;letter-spacing:-.02em}.brand-copy{display:flex;align-items:center;gap:10px}.brand-icon{width:28px;height:28px;display:grid;place-items:center;color:#ffadd0;border:1px solid rgba(255,150,193,.3);border-radius:8px;background:var(--accent-soft)}
.instance-dots{display:flex;gap:6px;align-items:center}.instance-dot{width:10px;height:10px;border-radius:50%;background:var(--red);transition:background .3s}.instance-dot.on{background:var(--green)}.instance-dot-label{font-size:11px;color:var(--muted);margin-right:2px}
.endpoint{color:#d5cad5;font:12px ui-monospace,monospace;border:1px solid rgba(201,163,188,.22);border-radius:999px;padding:6px 10px;background:rgba(29,23,31,.76)}
.nav{display:flex;gap:5px;padding:4px;border:1px solid rgba(201,163,188,.16);border-radius:12px;background:rgba(24,20,26,.74)}
.nav button,.ghost{color:#c6bbc6;background:transparent;border:1px solid transparent;border-radius:8px;padding:8px 13px;cursor:pointer;transition:.16s ease}
.nav button.active{color:#fff;border-color:rgba(255,150,193,.42);background:linear-gradient(135deg,rgba(232,91,148,.3),rgba(255,146,189,.2));box-shadow:inset 0 1px rgba(255,255,255,.14)}.nav button:hover,.ghost:hover{color:#fff;background:rgba(255,255,255,.06)}
.wrap{max-width:1180px;margin:0 auto;padding:34px 28px 48px}
.muted{color:var(--muted)}
.actions{display:flex;gap:9px;flex-wrap:wrap}
.btn{border:1px solid rgba(255,167,204,.4);border-radius:10px;padding:10px 14px;background:linear-gradient(135deg,var(--accent-start),var(--accent-end));color:#fff;font-weight:750;cursor:pointer;box-shadow:0 8px 18px rgba(213,61,123,.19);transition:transform .16s ease,filter .16s ease}.btn:hover{filter:brightness(1.07);transform:translateY(-1px)}.btn:disabled{cursor:wait;opacity:.7;transform:none}.btn-icon{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:-2px;margin-right:6px}
.btn.secondary{color:#eee6ee;background:rgba(42,34,45,.84);border-color:#4a394c;box-shadow:none}.btn.danger{background:rgba(103,41,58,.7);color:#ffe2e8;border-color:#81465a;box-shadow:none}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:0 0 16px;flex-wrap:wrap}.section-head h2{margin:0 0 5px;font-size:24px;letter-spacing:-.035em}.section-kicker{color:#ff9ac2;font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;margin:0 0 8px}
.grid{display:grid;gap:10px}.accounts-grid{grid-template-columns:repeat(auto-fill,minmax(330px,1fr));align-items:stretch}
.card{border:1px solid rgba(202,164,188,.18);border-radius:15px;background:linear-gradient(145deg,rgba(28,23,31,.97),rgba(18,16,21,.97));padding:15px 16px;display:flex;align-items:center;justify-content:space-between;gap:14px;box-shadow:var(--shadow);transition:border-color .16s ease,transform .16s ease}.card:hover{border-color:rgba(255,151,194,.36);transform:translateY(-1px)}
.accounts-grid .card{align-items:stretch;flex-direction:column}.accounts-grid .identity{width:100%}.accounts-grid .meta{width:100%;justify-content:flex-end}
.accounts-grid .meta .btn{flex:0 0 30%;max-width:170px}
.accounts-grid .meta .btn.danger:only-of-type{flex:0 0 auto;margin-left:auto;min-width:132px}
.card.job{align-items:flex-start}
.identity{min-width:0}.account-email{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account-id{font:11px ui-monospace,monospace;margin-top:4px;opacity:.75}
.badge{border:1px solid rgba(97,209,124,.42);background:rgba(38,101,58,.34);color:#a7f3ba;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:750;white-space:nowrap}.badge.off{border-color:rgba(255,123,135,.36);background:rgba(111,38,48,.34);color:#ffc0c8}.badge.cool{border-color:rgba(243,201,105,.38);background:rgba(105,78,23,.28);color:#ffe19a}.badge.blue{border-color:rgba(123,158,245,.42);background:rgba(38,58,101,.34);color:#a7c4f3}.badge.purple{border-color:rgba(200,91,164,.42);background:rgba(100,38,80,.34);color:#ffa4d4}
.empty{border:1px dashed rgba(202,164,188,.3);border-radius:15px;padding:24px;color:var(--muted);background:rgba(24,20,26,.58)}
.error{color:var(--red);margin-top:6px}
dialog{border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--text);padding:0;width:min(460px,92vw)}dialog::backdrop{background:rgba(0,0,0,.55)}
#captchaDialog{width:min(1100px,96vw)}
.modal{padding:18px}.modal h3{margin:0 0 6px}
.fields{display:grid;gap:12px;margin:16px 0}
label{display:grid;gap:6px;color:var(--muted)}
input{background:#151118;border:1px solid var(--line);border-radius:8px;color:var(--text);padding:10px 12px}input:focus{outline:0;border-color:#ff8fba;box-shadow:0 0 0 3px rgba(232,91,148,.14)}
.modal-actions{display:flex;justify-content:flex-end;gap:8px}
.notice{border:1px solid #3a3320;background:#1a160c;color:#e6d39a;border-radius:8px;padding:10px 12px;margin:0 0 14px;font-size:13px}
.captcha-stage{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#111;margin:16px 0}.captcha-stage iframe{display:block;width:100%;height:min(70vh,720px);border:0}.captcha-stage img{display:block;width:100%;touch-action:none;user-select:none;cursor:grab}.captcha-stage img.dragging{cursor:grabbing}
.meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
[hidden]{display:none !important}
.jobs{margin-top:36px;padding-top:30px;border-top:1px solid rgba(202,164,188,.16)}
.metrics{margin:0 0 36px}
.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));gap:12px}
.metric-card{position:relative;overflow:hidden;align-items:start;display:grid;gap:8px;min-height:144px;padding:18px}.metric-card::after{content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,var(--accent-start),var(--accent-end))}
.metric-card:nth-child(1)::after{background:var(--green)}
.metric-card:nth-child(2)::after{background:var(--blue)}
.metric-card:nth-child(3)::after{background:var(--yellow)}
.metric-card:nth-child(4)::after{background:var(--accent-start)}
.metric-value{font-size:27px;letter-spacing:-.04em}.metric-label{color:#d2c6d1;font-size:12px;font-weight:750;text-transform:uppercase;letter-spacing:.075em}.metric-action{align-self:end;justify-self:start;padding:0;border:0;background:transparent;color:#ffadd0;font-weight:750;cursor:pointer}.metric-action:hover{color:#fff;text-decoration:underline}
.instance-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-bottom:28px}
.instance-card{position:relative;overflow:hidden;border:1px solid rgba(202,164,188,.18);border-radius:15px;background:linear-gradient(145deg,rgba(28,23,31,.97),rgba(18,16,21,.97));padding:18px;box-shadow:var(--shadow);display:grid;gap:10px}
.instance-card .header{display:flex;justify-content:space-between;align-items:center}
.instance-card .label{font-weight:760;font-size:16px}.instance-card .port{font:12px ui-monospace,monospace;color:var(--muted)}
.instance-card .stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.instance-card .stat{display:grid;gap:2px}.stat-val{font-size:20px;font-weight:700;letter-spacing:-.03em}.stat-key{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.instance-card.offline{opacity:.5;border-color:rgba(237,119,143,.3)}
.instance-card .bar{height:3px;border-radius:2px;background:var(--line);overflow:hidden;margin-top:4px}.instance-card .bar-fill{height:100%;border-radius:2px;transition:width .4s}
.filter-bar{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap}
.filter-bar button{font-size:12px;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--muted);cursor:pointer;transition:.16s}.filter-bar button.active{color:#fff;border-color:rgba(255,150,193,.42);background:rgba(232,91,148,.2)}.filter-bar button:hover{color:#fff;background:rgba(255,255,255,.06)}
.group-label{font-size:13px;font-weight:700;color:var(--muted);margin:20px 0 10px;padding-bottom:6px;border-bottom:1px solid rgba(202,164,188,.1);text-transform:uppercase;letter-spacing:.08em}
@media(max-width:680px){.top{padding:12px 16px;gap:12px;align-items:flex-start;flex-direction:column}.wrap{padding:24px 16px 36px}.section-head{align-items:flex-start;flex-direction:column}.actions{width:100%}.actions .btn{flex:1}.accounts-grid{grid-template-columns:1fr}.card{align-items:flex-start;flex-direction:column}.card .meta{width:100%}.nav{width:100%}.nav button{flex:1}.endpoint{font-size:11px}.instance-grid{grid-template-columns:1fr}}
</style></head><body>
<header class="top">
  <div class="brand"><span class="brand-copy"><span class="brand-icon" aria-hidden="true"><svg class="btn-icon" style="margin:0" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect></svg></span>QwenSofia <span class="endpoint" id="endpoint">127.0.0.1:3000</span></span>
    <span class="instance-dots" id="instanceDots"></span>
  </div>
  <div class="actions">
    <button type="button" class="btn secondary" id="refreshBtn"><svg class="btn-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0 2 5.5"></path><polyline points="20 4 20 11 13 11"></polyline></svg>Atualizar</button>
    <button type="button" class="btn secondary" id="authAllBtn"><svg class="btn-icon" aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>Autenticar todas</button>
    <button type="button" class="btn secondary" id="addBtn"><svg class="btn-icon" aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2"></rect><line x1="4" y1="10" x2="20" y2="10"></line></svg>Adicionar conta</button>
    <button type="button" class="btn secondary" id="autoBtn"><svg class="btn-icon" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"></circle><circle cx="5" cy="6" r="1"></circle><circle cx="19" cy="8" r="1"></circle><circle cx="17" cy="17" r="1"></circle><circle cx="6" cy="16" r="1"></circle></svg>Criar automatica</button>
    <button type="button" class="btn" id="createBtn"><svg class="btn-icon" aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line></svg>Criar conta</button>
  </div>
</header>
<main class="wrap">
    <section class="metrics">
      <div class="section-head"><div><div class="section-kicker">Infraestrutura</div><h2>Instancias</h2><div class="muted" id="instancesUpdated">Carregando...</div></div></div>
      <div id="instanceCards" class="instance-grid"></div>
    </section>

    <section class="metrics">
      <div class="section-head"><div><div class="section-kicker">Visao em tempo real</div><h2>Metricas agregadas</h2><div class="muted" id="metricsUpdated">Carregando metricas...</div></div></div>
      <div id="metricsCards" class="metric-grid"></div>
    </section>

    <section id="activeAccountsSection" class="metrics" hidden>
      <div class="section-head"><div><div class="section-kicker">Em processamento</div><h2>Contas atendendo requests</h2><div class="muted">Atualizado junto com as metricas.</div></div></div>
      <div id="activeAccounts" class="grid accounts-grid"></div>
    </section>

    <div class="section-head">
      <div>
        <div class="section-kicker">Gerenciamento do pool</div>
        <h2>Fila de contas</h2>
        <div class="muted" id="summary">Carregando contas...</div>
      </div>
    </div>
    <div id="filterBar" class="filter-bar"></div>
    <section id="accounts" class="grid accounts-grid"></section>

    <section class="jobs">
      <div class="section-head"><div><div class="section-kicker">Acompanhamento</div><h2>Criacao de contas</h2><div class="muted">Acompanhe cadastros e verificacoes em andamento.</div></div></div>
      <div id="jobs" class="grid"></div>
    </section>
</main>

<dialog id="accountDialog">
  <form class="modal" id="addForm">
    <h3>Adicionar conta existente</h3>
    <div class="muted">As credenciais sao criptografadas no banco local e a conta e autenticada automaticamente.</div>
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
    <h3>Concorrencia por conta</h3>
    <div class="muted">Define quantas requisicoes a mesma conta pode processar ao mesmo tempo.</div>
    <div class="fields">
      <label>Requisicoes simultaneas por conta<input id="concurrencyInput" name="maxConcurrent" type="number" min="1" max="100" step="1" required></label>
    </div>
    <div class="notice">A alteracao e aplicada imediatamente e fica salva para os proximos reinicios.</div>
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
    <div class="muted">O navegador preenchera o cadastro, autenticara a sessao e adicionara a conta ao pool automaticamente.</div>
    <div class="fields">
      <label>Nome de exibicao<input name="displayName" required></label>
      <label>E-mail que voce controla<input name="email" type="email" required></label>
      <label>Senha (minimo 8 caracteres)<input name="password" type="password" minlength="8" required></label>
    </div>
    <div class="notice">Quando o Qwen pedir CAPTCHA, ele aparece neste painel para voce arrastar a peca. O restante continua automatico.</div>
    <div class="modal-actions">
      <button type="button" class="ghost" data-close>Cancelar</button>
      <button class="btn">Iniciar criacao</button>
    </div>
  </form>
</dialog>

<dialog id="captchaDialog">
  <div class="modal">
    <h3>Resolver CAPTCHA</h3>
    <div class="muted" id="captchaStatus">Conectando ao navegador do cadastro...</div>
    <div class="captcha-stage">
      <iframe id="captchaRemote" title="Navegador interativo do cadastro" src="about:blank"></iframe>
      <img id="captchaImage" alt="Captura de compatibilidade do CAPTCHA" draggable="false" hidden>
    </div>
    <div class="notice">Esta e a janela real do cadastro. Use o mouse diretamente nela e arraste o botao roxo do CAPTCHA.</div>
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

const INSTANCE_COLORS = { 3001: '#7b9ef5', 3002: '#e85b94', 3003: '#d7b66f', 3004: '#6fcb9d' };
const INSTANCE_LABELS = { 3001: 'Direto', 3002: 'Tor 1', 3003: 'Tor 2', 3004: 'Tor 3' };
let currentFilter = 'all';

async function api(url, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
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

function instanceCard(inst) {
  const color = INSTANCE_COLORS[inst.port] || '#fff';
  const offClass = inst.online ? '' : ' offline';
  const statusBadge = inst.online
    ? '<span class="badge">Online</span>'
    : '<span class="badge off">Offline</span>';
  const pct = inst.online && inst.initialized > 0 ? Math.round((inst.withHeaders / inst.initialized) * 100) : 0;
  return '<article class="card instance-card' + offClass + '">' +
    '<div class="header"><span class="label" style="color:' + color + '">' + esc(inst.label) + '</span>' + statusBadge + '</div>' +
    '<div class="port">:' + inst.port + (inst.port === 3001 ? ' (IP direto)' : ' (SOCKS5 Tor)') + '</div>' +
    (inst.online ? (
      '<div class="stats">' +
        '<div class="stat"><span class="stat-val">' + (inst.initialized || 0) + '</span><span class="stat-key">Browsers</span></div>' +
        '<div class="stat"><span class="stat-val">' + (inst.withHeaders || 0) + '</span><span class="stat-key">Com headers</span></div>' +
        '<div class="stat"><span class="stat-val">' + (inst.activeRequests || 0) + '</span><span class="stat-key">Requests</span></div>' +
        '<div class="stat"><span class="stat-val">' + (inst.queuedRequests || 0) + '</span><span class="stat-key">Na fila</span></div>' +
      '</div>' +
      '<div class="bar"><div class="bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>'
    ) : '<div class="muted">Instancia nao respondeu</div>') +
  '</article>';
}

function accountCard(a) {
  const authBadge = a.authenticated ? '<span class="badge">Ativa</span>' : '<span class="badge off">Inativa</span>';
  const authBtn = a.authenticated ? "" : '<button type="button" class="btn secondary" data-auth="' + esc(a.id) + '">Autenticar</button>';
  const port = a._port || 0;
  const label = INSTANCE_LABELS[port] || '';
  const color = INSTANCE_COLORS[port] || '';
  var instanceBadge = '';
  if (label) {
    var badgeStyle = 'background:' + color + '22;border-color:' + color + '66;color:' + color;
    instanceBadge = '<span class="badge" style="' + badgeStyle + '">' + esc(label) + ' (:' + port + ')</span>';
  }
  var cleanEmail = String(a.email || '').replace(/ \\[300\\d\\]$/, '');
  return '<article class="card" data-port="' + port + '">' +
    '<div class="identity"><strong class="account-email">' + esc(cleanEmail) + '</strong><div class="muted account-id">' + esc(a.id) + '</div></div>' +
    '<div class="meta">' + instanceBadge + authBadge + cooldownBadge(a.cooldown) + authBtn +
    '<button type="button" class="btn danger" data-remove="' + esc(a.id) + '">Remover</button></div>' +
  '</article>';
}

function jobCard(j) {
  const ready = j.ready ? ' - pronta' : (j.state === 'pending_activation' ? ' - pendente e-mail' : (j.state === 'completed' ? ' - incompleta' : ''));
  const badgeClass = j.state === 'failed' ? 'off' : (j.ready ? '' : (j.state === 'pending_activation' ? 'cool' : (j.state === 'completed' ? 'cool' : '')));
  const captchaAction = j.state === 'solving-captcha' && !j.localBrowser ? '<button type="button" class="btn secondary" data-captcha="' + esc(j.id) + '">Resolver CAPTCHA</button>' : (j.state === 'solving-captcha' ? '<span class="notice">Use a janela do Chrome aberta neste PC.</span>' : '');
  const localChromeAction = j.localBrowser && j.state !== 'failed' && j.state !== 'completed' ? '<button type="button" class="btn secondary" data-show-chrome="' + esc(j.id) + '" data-job-state="' + esc(j.state) + '">Abrir Chrome</button>' : '';
  return '<article class="card job"><div><strong>' + esc(j.email) + '</strong><div class="muted">' + esc(j.message) + '</div>' +
    (j.provider ? '<div class="muted">provider: ' + esc(j.provider) + '</div>' : '') +
    (j.verificationCode ? '<div class="muted">codigo: ' + esc(j.verificationCode) + '</div>' : '') +
    (j.error ? '<div class="error">' + esc(j.error) + '</div>' : '') +
    '</div><div class="meta">' + captchaAction + localChromeAction + '<span class="badge ' + badgeClass + '">' + esc(j.state) + ready + '</span></div></article>';
}

function metricCard(label, value, detail, action) {
  return '<article class="card metric-card"><div class="metric-label">' + esc(label) + '</div><strong class="metric-value">' + esc(value) + '</strong><div class="muted">' + esc(detail) + '</div>' + (action || '') + '</article>';
}

function activeAccountCard(account, usage) {
  const active = usage.activeRequests || 0;
  const queued = usage.queuedRequests || 0;
  var cleanEmail = esc(account ? String(account.email).replace(/ \\[300\\d\\]$/, '') : usage.accountId);
  return '<article class="card"><div class="identity"><strong class="account-email">' + cleanEmail + '</strong><div class="muted account-id">' + esc(usage.accountId) + '</div></div><div class="meta"><span class="badge">' + active + ' request' + (active === 1 ? '' : 's') + '</span>' + (queued ? '<span class="badge cool">' + queued + ' na fila</span>' : '') + '</div></article>';
}

function renderInstances(instances) {
  $("#instanceCards").innerHTML = (instances || []).map(instanceCard).join("");
  var dots = (instances || []).map(function(inst) {
    return '<span class="instance-dot-label">' + esc(inst.label) + '</span><span class="instance-dot' + (inst.online ? ' on' : '') + '"></span>';
  }).join("");
  $("#instanceDots").innerHTML = dots;
  var online = (instances || []).filter(function(i) { return i.online; }).length;
  $("#instancesUpdated").textContent = online + "/4 instancias online";
}

function renderFilters(accounts) {
  var ports = {};
  accounts.forEach(function(a) { if (a._port) ports[a._port] = INSTANCE_LABELS[a._port] || a._port; });
  var html = '<button class="' + (currentFilter === 'all' ? 'active' : '') + '" data-filter="all">Todas (' + accounts.length + ')</button>';
  Object.keys(ports).sort().forEach(function(p) {
    var count = accounts.filter(function(a) { return String(a._port) === p; }).length;
    html += '<button class="' + (currentFilter === p ? 'active' : '') + '" data-filter="' + p + '">' + esc(ports[p]) + ' (' + count + ')</button>';
  });
  $("#filterBar").innerHTML = html;
}

function renderMetrics(health, accounts) {
  var rt = health.accountRuntime || {};
  var cc = health.accountConcurrency || {};
  var authed = accounts.filter(function(a) { return a.authenticated; }).length;
  var cards = [
    metricCard("Browsers Ativos", rt.initialized || 0, (rt.withHeaders || 0) + " com headers em cache"),
    metricCard("Contas", accounts.length, authed + " autenticadas, " + (accounts.length - authed) + " inativas"),
    metricCard("Requests", cc.activeRequests || 0, (cc.queuedRequests || 0) + " aguardando na fila"),
    metricCard("Concorrencia", cc.limitPerAccount || 2, "por conta", '<button class="metric-action" id="concurrencyBtn">Alterar limite</button>')
  ];
  $("#metricsCards").innerHTML = cards.join("");
  $("#metricsUpdated").textContent = "Atualizado em " + new Date(health.timestamp || Date.now()).toLocaleString("pt-BR");
  var byId = new Map(accounts.map(function(a) { return [a.id, a]; }));
  var active = (cc.accounts || []).filter(function(u) { return u.activeRequests > 0 || u.queuedRequests > 0; });
  $("#activeAccountsSection").hidden = active.length === 0;
  $("#activeAccounts").innerHTML = active.map(function(u) { return activeAccountCard(byId.get(u.accountId) || { email: u.accountId }, u); }).join("");
}

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

function setCaptchaStatus(message) { $("#captchaStatus").textContent = message; }
function clearCaptchaImage() { if (captchaImageUrl) URL.revokeObjectURL(captchaImageUrl); captchaImageUrl = ""; $("#captchaImage").removeAttribute("src"); }
function resetCaptchaDialog() {
  if (captchaPointerId !== null) cancelCaptchaPointer();
  if (captchaRefreshTimer) clearTimeout(captchaRefreshTimer);
  captchaRefreshTimer = null; captchaJobId = ""; captchaPointerId = null; captchaSubmitting = false;
  captchaPendingMove = null; captchaMovePromise = null; captchaPointerError = null;
  $("#captchaImage").classList.remove("dragging"); $("#captchaRemote").src = "about:blank"; clearCaptchaImage();
}
function stopCaptchaRefresh() { if (captchaRefreshTimer) clearTimeout(captchaRefreshTimer); captchaRefreshTimer = null; }
function scheduleCaptchaRefresh(delay) {
  stopCaptchaRefresh(); if (!captchaJobId) return;
  captchaRefreshTimer = setTimeout(function() { captchaRefreshTimer = null; loadCaptchaImage(); }, delay || CAPTCHA_REFRESH_DELAY_MS);
}

async function loadCaptchaImage() {
  if (!captchaJobId) return;
  try {
    var resp = await fetch("/api/admin/registrations/" + captchaJobId + "/captcha-screenshot");
    if (!resp.ok) { scheduleCaptchaRefresh(2000); return; }
    clearCaptchaImage();
    var blob = await resp.blob();
    captchaImageUrl = URL.createObjectURL(blob);
    var img = $("#captchaImage");
    img.src = captchaImageUrl; img.hidden = false;
    scheduleCaptchaRefresh();
  } catch { scheduleCaptchaRefresh(2000); }
}

function captchaPoint(event) {
  var img = event.currentTarget;
  var rect = img.getBoundingClientRect();
  return { x: Math.round(((event.clientX - rect.left) / rect.width) * 100), y: Math.round(((event.clientY - rect.top) / rect.height) * 100) };
}

async function sendCaptchaPointer(jobId, action, point) {
  return api("/api/admin/registrations/" + jobId + "/captcha-pointer", { method: "POST", body: JSON.stringify({ action: action, ...(point || {}) }) });
}

async function beginCaptchaPointer(point) {
  captchaPointerStart = sendCaptchaPointer(captchaJobId, "start", point).catch(function(e) { captchaPointerError = e; });
}

function queueCaptchaMove(point) {
  if (!captchaJobId) return;
  captchaPendingMove = point;
  if (captchaMovePromise) return;
  function flush() {
    var p = captchaPendingMove; captchaPendingMove = null;
    if (!p || !captchaJobId) { captchaMovePromise = null; return; }
    captchaMovePromise = sendCaptchaPointer(captchaJobId, "move", p).catch(function(){}).then(flush);
  }
  flush();
}

async function finishCaptchaPointer(point) {
  var jobId = captchaJobId;
  captchaPointerId = null;
  captchaPendingMove = null;
  $("#captchaImage").classList.remove("dragging");
  if (!jobId) return;
  captchaSubmitting = true;
  setCaptchaStatus("Enviando posicao final...");
  stopCaptchaRefresh();
  try {
    await captchaPointerStart.catch(function(){});
    if (captchaMovePromise) await captchaMovePromise;
    if (captchaPointerError) throw captchaPointerError;
    await sendCaptchaPointer(jobId, "end", point);
    setCaptchaStatus("Verificando resultado...");
    scheduleCaptchaRefresh(150);
  } catch (e) {
    setCaptchaStatus("Erro no arraste: " + (e.message || e) + ". Tente novamente.");
    scheduleCaptchaRefresh(150);
  }
  captchaSubmitting = false;
  captchaPointerError = null;
}

async function cancelCaptchaPointer() {
  var jobId = captchaJobId;
  var movePromise = captchaMovePromise;
  captchaPendingMove = null;
  if (!jobId) return;
  try { await captchaPointerStart.catch(function(){}); if (movePromise) await movePromise; await sendCaptchaPointer(jobId, "cancel"); } catch {}
}

function openCaptchaDialog(jobId) {
  captchaJobId = jobId;
  var dlg = $("#captchaDialog");
  setCaptchaStatus("Conectando ao navegador do cadastro...");
  dlg.showModal();
  loadCaptchaImage();
}

function closeCaptchaDialog() {
  resetCaptchaDialog();
  var dlg = $("#captchaDialog");
  if (dlg.open) dlg.close();
}

var allAccounts = [];

async function load() {
  try {
    var results = await Promise.all([api("/api/admin/overview"), api("/health").catch(function(e) { return e; })]);
    var d = results[0];
    var health = results[1];
    var accounts = Array.isArray(d.accounts) ? d.accounts : [];
    allAccounts = accounts;

    // Instances
    var instances = (health instanceof Error) ? [] : (health.instances || []);
    if (instances.length === 0 && d.instances) instances = d.instances;
    renderInstances(instances);

    // Metrics
    if (health instanceof Error) {
      $("#metricsUpdated").innerHTML = '<span class="error">' + esc(health.message) + '</span>';
      $("#metricsCards").innerHTML = '<div class="empty">Nao foi possivel carregar as metricas.</div>';
    } else {
      renderMetrics(health, accounts);
    }

    updateBulkAuthentication(d.bulkAuthentication);
    var registrations = Array.isArray(d.registrations) ? d.registrations : [];
    var ac = d.autoCreator || {};
    var acText = "auto-create desativado";
    if (ac.enabled) {
      if (ac.busy) acText = "criando... " + (ac.message || "");
      else if (ac.lastEmail) acText = "ultima auto: " + ac.lastEmail;
      else acText = ac.message || "auto-create ativo";
    }
    var authed = accounts.filter(function(a) { return a.authenticated; }).length;
    $("#summary").textContent = accounts.length + " conta(s) (" + authed + " ativas) - " + acText;

    // Filters
    renderFilters(accounts);

    // Accounts
    renderAccountList();

    // Jobs
    $("#jobs").innerHTML = registrations.length ? registrations.map(jobCard).join("") : '<div class="empty">Nenhum cadastro executado neste runtime.</div>';
    if (captchaJobId && !registrations.some(function(job) { return job.id === captchaJobId && job.state === "solving-captcha"; })) closeCaptchaDialog();
  } catch (e) {
    $("#summary").innerHTML = '<span class="error">' + esc(e.message) + '</span>';
    $("#accounts").innerHTML = '<div class="empty"><strong>Falha ao carregar contas</strong><p>' + esc(e.message) + '</p></div>';
  }
}

function renderAccountList() {
  var filtered = currentFilter === 'all' ? allAccounts : allAccounts.filter(function(a) { return String(a._port) === currentFilter; });
  if (filtered.length === 0) {
    $("#accounts").innerHTML = '<div class="empty"><strong>Nenhuma conta</strong><p>Nenhuma conta nesta instancia.</p></div>';
    return;
  }
  if (currentFilter === 'all') {
    var groups = {};
    filtered.forEach(function(a) {
      var key = a._port || 0;
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    });
    var html = '';
    Object.keys(groups).sort().forEach(function(p) {
      html += '<div class="group-label" style="grid-column:1/-1">' + esc(INSTANCE_LABELS[p] || 'Porta ' + p) + ' (' + groups[p].length + ' contas)</div>';
      html += groups[p].map(accountCard).join('');
    });
    $("#accounts").innerHTML = html;
  } else {
    $("#accounts").innerHTML = filtered.map(accountCard).join('');
  }
}

async function addAccount(e) {
  e.preventDefault();
  var f = new FormData(e.target);
  var payload = Object.assign({}, Object.fromEntries(f.entries()), { authenticate: true });
  try {
    var r = await api("/api/admin/accounts", { method: "POST", body: JSON.stringify(payload) });
    e.target.closest("dialog").close(); e.target.reset();
    if (r.authError) alert("Conta adicionada, mas autenticacao falhou: " + r.authError);
    load();
  } catch (x) { alert(x.message); }
}

async function createAccount(e) {
  e.preventDefault();
  var f = new FormData(e.target);
  try {
    await api("/api/admin/registrations", { method: "POST", body: JSON.stringify(Object.fromEntries(f.entries())) });
    e.target.closest("dialog").close(); e.target.reset(); load();
  } catch (x) { alert(x.message); }
}

async function authenticate(id, button) {
  button.disabled = true; button.textContent = "Autenticando...";
  try { await api("/api/admin/accounts/" + id + "/authenticate", { method: "POST" }); load(); }
  catch (e) { alert(e.message); button.disabled = false; button.textContent = "Autenticar"; }
}

async function authenticateAll() {
  var inactive = document.querySelectorAll("[data-auth]").length;
  if (inactive === 0) { alert("Todas as contas ja estao ativas."); return; }
  if (!confirm("Autenticar " + inactive + " conta(s) inativa(s)?")) return;
  try { await api("/api/admin/accounts/authenticate-all", { method: "POST" }); load(); }
  catch (e) { alert(e.message); }
}

async function removeAccount(id) {
  if (!confirm("Remover esta conta e sua sessao local?")) return;
  try { await api("/api/admin/accounts/" + id, { method: "DELETE" }); load(); }
  catch (e) { alert(e.message); }
}

async function autoCreateOne() {
  if (!confirm("Criar 1 conta automatica?")) return;
  try { var r = await api("/api/admin/account-creator/run", { method: "POST", body: JSON.stringify({ count: 1 }) }); alert(r.message || "Criacao iniciada."); load(); }
  catch (e) { alert(e.message); }
}

async function saveConcurrency(e) {
  e.preventDefault();
  var value = Number(new FormData(e.target).get("maxConcurrent"));
  try { await api("/api/admin/account-concurrency", { method: "PUT", body: JSON.stringify({ maxConcurrent: value }) }); $("#concurrencyDialog").close(); load(); }
  catch (x) { alert(x.message); }
}

function updateBulkAuthentication(status) {
  var button = $("#authAllBtn");
  var lockIcon = '<svg class="btn-icon" aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
  if (!status || !status.running) { button.disabled = false; button.innerHTML = lockIcon + "Autenticar todas"; return; }
  button.disabled = true; button.innerHTML = lockIcon + "Autenticando " + status.completed + "/" + status.total;
}

async function saveConcurrencyAndRestart() {
  var form = $("#concurrencyForm");
  if (!form.reportValidity()) return;
  if (!confirm("Salvar o novo limite e reiniciar o QwenSofia agora?")) return;
  var button = $("#restartConcurrencyBtn");
  button.disabled = true; button.textContent = "Reiniciando...";
  var value = Number(new FormData(form).get("maxConcurrent"));
  try { await api("/api/admin/account-concurrency/restart", { method: "PUT", body: JSON.stringify({ maxConcurrent: value }) }); $("#concurrencyDialog").close(); alert("Limite salvo. QwenSofia reiniciando."); }
  catch (x) { alert(x.message); button.disabled = false; button.textContent = "Salvar e reiniciar agora"; }
}

// Event bindings
$("#refreshBtn").addEventListener("click", load);
$("#authAllBtn").addEventListener("click", authenticateAll);
$("#addBtn").addEventListener("click", function() { $("#accountDialog").showModal(); });
$("#createBtn").addEventListener("click", function() { $("#createDialog").showModal(); });
$("#autoBtn").addEventListener("click", autoCreateOne);
$("#captchaCloseBtn").addEventListener("click", closeCaptchaDialog);
$("#captchaDialog").addEventListener("close", resetCaptchaDialog);
$("#addForm").addEventListener("submit", addAccount);
$("#createForm").addEventListener("submit", createAccount);
$("#concurrencyForm").addEventListener("submit", saveConcurrency);
$("#restartConcurrencyBtn").addEventListener("click", saveConcurrencyAndRestart);
document.querySelectorAll("[data-close]").forEach(function(btn) { btn.addEventListener("click", function() { btn.closest("dialog").close(); }); });
$("#accounts").addEventListener("click", function(e) {
  var t = e.target; if (!(t instanceof HTMLElement)) return;
  var authId = t.getAttribute("data-auth"); var removeId = t.getAttribute("data-remove");
  if (authId) authenticate(authId, t); if (removeId) removeAccount(removeId);
});
$("#filterBar").addEventListener("click", function(e) {
  var t = e.target; if (!(t instanceof HTMLElement) || !t.hasAttribute("data-filter")) return;
  currentFilter = t.getAttribute("data-filter");
  renderFilters(allAccounts); renderAccountList();
});
$("#jobs").addEventListener("click", function(e) {
  var target = e.target; if (!(target instanceof HTMLElement)) return;
  var captchaId = target.getAttribute("data-captcha");
  if (captchaId) openCaptchaDialog(captchaId);
  if (target.hasAttribute("data-show-chrome")) {
    target.disabled = true;
    fetch("http://127.0.0.1:9223/show", { method: "POST" }).then(async function(response) {
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || "Nao foi possivel abrir o Chrome.");
      if (!result.registrationPageFound && target.getAttribute("data-job-state") === "solving-captcha") alert("Chrome abriu mas a aba do CAPTCHA nao existe mais.");
    }).catch(function(error) { alert("Nao foi possivel abrir o Chrome local: " + error.message); }).finally(function() { target.disabled = false; });
  }
});
$("#metricsCards").addEventListener("click", function(e) {
  if (!(e.target instanceof HTMLElement) || e.target.id !== "concurrencyBtn") return;
  $("#concurrencyInput").value = String(e.target.closest(".metric-card").querySelector(".metric-value").textContent);
  $("#concurrencyDialog").showModal();
});
$("#captchaImage").addEventListener("pointerdown", function(event) {
  if (!captchaJobId || captchaSubmitting || !event.currentTarget.src) return;
  event.preventDefault(); captchaPointerId = event.pointerId; captchaStartedAt = Date.now();
  beginCaptchaPointer(captchaPoint(event)); event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.classList.add("dragging"); setCaptchaStatus("Arraste devagar para acompanhar a peca.");
  scheduleCaptchaRefresh(CAPTCHA_DRAG_REFRESH_DELAY_MS);
});
$("#captchaImage").addEventListener("pointermove", function(event) { if (event.pointerId !== captchaPointerId) return; queueCaptchaMove(captchaPoint(event)); });
$("#captchaImage").addEventListener("pointerup", async function(event) {
  if (event.pointerId !== captchaPointerId) return;
  event.currentTarget.releasePointerCapture(event.pointerId); await finishCaptchaPointer(captchaPoint(event));
});
$("#captchaImage").addEventListener("pointercancel", async function(event) {
  if (event.pointerId !== captchaPointerId) return; await cancelCaptchaPointer();
  captchaPointerId = null; event.currentTarget.classList.remove("dragging");
  setCaptchaStatus("Arraste cancelado. Tente novamente."); scheduleCaptchaRefresh(150);
});

load();
setInterval(load, 15000);
</script>
</body></html>`;
