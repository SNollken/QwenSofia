export const remoteBrowserHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Navegador do cadastro</title>
  <style>
    :root{color-scheme:dark}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:#09090b;color:#eee;font:14px system-ui,sans-serif}body{display:grid;grid-template-rows:auto 1fr;overflow:hidden}#status{padding:8px 12px;background:#171218;border-bottom:1px solid #3a2933;color:#d8cbd3}#screen{min-width:0;min-height:0;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#111}#screen canvas{outline:none}
  </style>
</head>
<body>
  <div id="status" role="status" aria-live="polite">Conectando ao navegador seguro do cadastro…</div>
  <div id="screen" aria-label="Navegador interativo do cadastro"></div>
  <script type="module">
    import RFB from "/novnc/core/rfb.js";
    const status = document.querySelector("#status");
    const screen = document.querySelector("#screen");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const host = location.hostname.includes(":") ? "[" + location.hostname + "]" : location.hostname;
    const rfb = new RFB(screen, protocol + "//" + host + ":6080", { shared: true });
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.viewOnly = false;
    rfb.focusOnClick = true;
    rfb.showDotCursor = true;
    rfb.addEventListener("connect", () => {
      status.textContent = "Conectado. Use o mouse normalmente no navegador abaixo.";
    });
    rfb.addEventListener("disconnect", (event) => {
      status.textContent = event.detail.clean
        ? "Navegador desconectado. Feche e abra novamente para reconectar."
        : "Não foi possível conectar. Confirme que o túnel local está ativo.";
    });
    rfb.addEventListener("securityfailure", () => {
      status.textContent = "A conexão segura com o navegador foi recusada.";
    });
  </script>
</body>
</html>`;
