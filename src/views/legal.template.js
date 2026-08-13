const COMPANY_NAME = "Norte Sul Sementes LTDA";
const APP_NAME = "Norte Sul Chat";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderLegalPage({ title, description, content }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${safeDescription}">
  <meta name="robots" content="index, follow">
  <title>${safeTitle} | ${APP_NAME}</title>
  <style>
    :root { color-scheme: light; --background: #f4f7f2; --surface: #fff; --text: #203027; --muted: #5d6b62; --primary: #1f6b45; --primary-dark: #164d33; --border: #dce5de; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--background); color: var(--text); font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 16px; line-height: 1.7; }
    header { background: linear-gradient(135deg, var(--primary-dark), var(--primary)); color: #fff; padding: 2.5rem 1.25rem; }
    header div, main, footer div { width: min(100%, 860px); margin: 0 auto; }
    .eyebrow { margin: 0 0 .5rem; color: #d9f2e3; font-size: .85rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(2rem, 6vw, 3.25rem); line-height: 1.15; }
    header p:last-of-type { max-width: 680px; margin: 1rem 0 0; color: #edf8f1; }
    nav { display: flex; flex-wrap: wrap; gap: .75rem 1.25rem; margin-top: 1.5rem; }
    nav a { color: #fff; font-weight: 650; }
    main { margin-top: 2rem; margin-bottom: 2rem; padding: clamp(1.25rem, 4vw, 2.75rem); background: var(--surface); border: 1px solid var(--border); border-radius: 16px; box-shadow: 0 16px 45px rgba(30, 63, 43, .08); }
    h2 { margin: 2rem 0 .65rem; color: var(--primary-dark); font-size: 1.35rem; line-height: 1.3; }
    h2:first-child { margin-top: 0; }
    p, ul { margin: .65rem 0 1rem; }
    ul { padding-left: 1.4rem; }
    li + li { margin-top: .35rem; }
    a { color: var(--primary); text-underline-offset: 3px; }
    .notice { margin: 1.5rem 0; padding: 1rem 1.15rem; background: #eef7f1; border-left: 4px solid var(--primary); border-radius: 8px; }
    footer { padding: 0 1.25rem 2.5rem; color: var(--muted); font-size: .9rem; text-align: center; }
    @media (max-width: 900px) { main { margin: 1rem; } header { padding-top: 2rem; } }
  </style>
</head>
<body>
  <header>
    <div>
      <p class="eyebrow">${COMPANY_NAME}</p>
      <h1>${safeTitle}</h1>
      <p>Informações legais do ${APP_NAME}, canal de atendimento da Norte Sul Sementes pela API oficial do WhatsApp Business Platform da Meta.</p>
      <nav aria-label="Páginas legais">
        <a href="/politica-de-privacidade">Política de Privacidade</a>
        <a href="/termos-de-servico">Termos de Serviço</a>
        <a href="/exclusao-de-dados">Exclusão de Dados</a>
      </nav>
    </div>
  </header>
  <main>${content}</main>
  <footer><div>© ${new Date().getUTCFullYear()} ${COMPANY_NAME}. Todos os direitos reservados.</div></footer>
</body>
</html>`;
}

module.exports = { renderLegalPage, escapeHtml };
