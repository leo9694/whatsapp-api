const { renderLegalPage, escapeHtml } = require("../views/legal.template");

function sendPage(res, page) {
  res.status(200).type("html").send(renderLegalPage(page));
}

function privacyPolicy(_req, res) {
  sendPage(res, {
    title: "Política de Privacidade",
    description: "Política de Privacidade do aplicativo Norte Sul Chat.",
    content: `
      <h2>1. Sobre esta política</h2>
      <p>Esta Política de Privacidade explica como a <strong>Norte Sul Sementes LTDA</strong> trata dados pessoais no <strong>Norte Sul Chat</strong>, ferramenta utilizada para atendimento de clientes por meio da API oficial do WhatsApp Business Platform da Meta.</p>
      <h2>2. Dados que podem ser tratados</h2>
      <p>Durante uma conversa iniciada ou mantida pelo usuário no WhatsApp, podemos tratar informações fornecidas pelo próprio usuário ou disponibilizadas pelo serviço, incluindo:</p>
      <ul><li>número de telefone;</li><li>nome do perfil do WhatsApp;</li><li>conteúdo das mensagens;</li><li>arquivos e mídias enviados durante o atendimento;</li><li>informações necessárias para identificar clientes, pedidos, produtos ou solicitações.</li></ul>
      <h2>3. Como utilizamos os dados</h2>
      <p>Esses dados podem ser utilizados para:</p>
      <ul><li>realizar atendimento ao cliente e responder dúvidas;</li><li>fornecer informações sobre produtos;</li><li>acompanhar pedidos e solicitações;</li><li>permitir a comunicação entre clientes e funcionários autorizados da Norte Sul Sementes;</li><li>manter histórico de atendimento quando necessário.</li></ul>
      <h2>4. Compartilhamento e operadores do serviço</h2>
      <p>A Norte Sul Sementes não vende dados pessoais. Os dados podem ser processados ou transmitidos por provedores necessários ao funcionamento e à segurança do serviço, incluindo a Meta/WhatsApp e os fornecedores de infraestrutura utilizados pela aplicação. O acesso interno é limitado a funcionários e colaboradores autorizados conforme a necessidade do atendimento.</p>
      <h2>5. Segurança da informação</h2>
      <p>Adotamos medidas técnicas e organizacionais razoáveis para proteger os dados contra acesso não autorizado, alteração, perda, divulgação ou destruição indevida. Apesar desses cuidados, nenhum sistema conectado à internet é totalmente isento de riscos.</p>
      <h2>6. Retenção e exclusão</h2>
      <p>Os dados são mantidos pelo período necessário para realizar o atendimento, conservar o histórico quando necessário e cumprir obrigações legais, fiscais, regulatórias, contratuais ou de prevenção a fraudes. Quando não houver mais uma finalidade legítima para sua manutenção, os dados poderão ser eliminados ou anonimizados.</p>
      <p>Para conhecer o procedimento de solicitação, acesse a página de <a href="/exclusao-de-dados">Exclusão de Dados</a>.</p>
      <h2>7. Atualizações</h2>
      <p>Esta política poderá ser atualizada para refletir mudanças no serviço ou em nossos procedimentos. A versão vigente estará sempre disponível nesta página.</p>
    `,
  });
}

function termsOfService(_req, res) {
  sendPage(res, {
    title: "Termos de Serviço",
    description: "Termos de Serviço do aplicativo Norte Sul Chat.",
    content: `
      <h2>1. Sobre o serviço</h2>
      <p>O <strong>Norte Sul Chat</strong> é uma ferramenta da <strong>Norte Sul Sementes LTDA</strong> destinada à comunicação e ao atendimento de clientes por meio do WhatsApp.</p>
      <h2>2. Uso adequado</h2>
      <p>O serviço deve ser utilizado de maneira legítima e relacionada ao atendimento oferecido pela empresa. Não é permitido enviar conteúdo ilegal, abusivo, ameaçador, fraudulento, malicioso ou que possa comprometer o funcionamento ou a segurança do serviço.</p>
      <h2>3. Informações comerciais</h2>
      <p>Preços, disponibilidade, estoque, prazos, condições comerciais e demais informações apresentadas durante o atendimento podem sofrer alterações. Pedidos, reservas ou negociações somente serão considerados confirmados após a confirmação apropriada e expressa da Norte Sul Sementes pelos canais aplicáveis.</p>
      <h2>4. Disponibilidade</h2>
      <p>Buscamos manter o serviço disponível, mas ele pode sofrer interrupções temporárias decorrentes de manutenção, falhas técnicas, indisponibilidade do WhatsApp ou da Meta, problemas de conectividade e outros fatores fora do controle da empresa.</p>
      <h2>5. Privacidade</h2>
      <p>O tratamento de informações durante o atendimento é explicado em nossa <a href="/politica-de-privacidade">Política de Privacidade</a>. Ao utilizar o serviço, o usuário declara estar ciente dessas informações.</p>
      <h2>6. Alterações</h2>
      <p>Estes termos poderão ser atualizados para acompanhar mudanças no serviço, nas práticas da empresa ou nos requisitos aplicáveis. A versão vigente estará disponível nesta página.</p>
    `,
  });
}

function dataDeletion(_req, res) {
  const contactEmail = process.env.PRIVACY_CONTACT_EMAIL?.trim();
  const contactBlock = contactEmail
    ? `<div class="notice">Para solicitar a exclusão dos seus dados, envie um email para: <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>.</div>`
    : `<div class="notice">Para solicitar a exclusão dos seus dados, entre em contato pelo canal oficial de atendimento da Norte Sul Sementes.</div>`;

  sendPage(res, {
    title: "Exclusão de Dados",
    description: "Instruções para solicitar a exclusão de dados relacionados ao Norte Sul Chat.",
    content: `
      <h2>Como solicitar</h2>
      <p>O usuário pode solicitar a exclusão dos dados pessoais relacionados ao <strong>Norte Sul Chat</strong> entrando em contato com a <strong>Norte Sul Sementes LTDA</strong> pelo canal oficial de atendimento da empresa.</p>
      ${contactBlock}
      <h2>Identificação do solicitante</h2>
      <p>A solicitação deve conter informações suficientes para identificar o usuário e localizar os registros relacionados, especialmente o número de telefone utilizado nas conversas pelo WhatsApp. Informações adicionais poderão ser solicitadas para confirmar a identidade do titular e proteger os dados contra exclusões indevidas.</p>
      <h2>Análise e atendimento</h2>
      <p>Após a confirmação da identidade e a localização dos dados, a solicitação será analisada e atendida conforme os requisitos aplicáveis. A empresa poderá comunicar ao solicitante a conclusão do procedimento ou eventual impossibilidade justificada de exclusão integral.</p>
      <h2>Registros que podem ser conservados</h2>
      <p>Alguns registros podem ser mantidos quando necessários para cumprimento de obrigações legais, fiscais, regulatórias ou contratuais, exercício regular de direitos e prevenção de fraude. Nesses casos, o acesso será limitado à finalidade que justifica sua conservação.</p>
      <p>Consulte também nossa <a href="/politica-de-privacidade">Política de Privacidade</a>.</p>
    `,
  });
}

module.exports = { privacyPolicy, termsOfService, dataDeletion };
