# Guia de Integração — Norte Sul WhatsApp API

Este documento ensina outro backend, serviço interno ou BFF a se conectar à API do **Norte Sul Chat**. Ele cobre autenticação, conversas, mensagens, templates, mídias, janela de atendimento, Socket.IO e tratamento de erros.

## 1. Informações essenciais

| Item | Valor |
|---|---|
| Base URL | `https://whatsapp-api.nortesulsementes.com` |
| Autenticação REST | Header `X-API-Key` |
| Tempo real | Socket.IO autenticado |
| Formato principal | JSON |
| Uploads | `multipart/form-data` |
| Telefone | Somente dígitos, com DDI + DDD + número |

Solicite ao responsável pela API uma chave própria para o projeto consumidor. Nunca envie ou registre no Git a chave usada em produção.

```dotenv
NORTE_SUL_WHATSAPP_API_URL=https://whatsapp-api.nortesulsementes.com
NORTE_SUL_WHATSAPP_API_KEY=chave-fornecida-pelo-responsavel
```

## 2. Arquitetura recomendada

Use a API a partir de um ambiente confiável:

```text
Browser ou aplicativo
        ↓
Backend/BFF do projeto consumidor
        ↓  X-API-Key
Norte Sul WhatsApp API
        ↓
Meta WhatsApp Cloud API
```

Não coloque `X-API-Key` em bundles de frontend, aplicativos distribuídos, URLs, query strings ou armazenamento público. Se o projeto possui frontend, seu backend deve atuar como proxy/BFF.

## 3. Teste rápido de conexão

O endpoint público de saúde não exige chave:

```bash
curl -sS https://whatsapp-api.nortesulsementes.com/health
```

Resposta:

```json
{ "status": "ok" }
```

Para confirmar autenticação e dependências:

```bash
curl -sS https://whatsapp-api.nortesulsementes.com/api/status \
  -H "X-API-Key: $NORTE_SUL_WHATSAPP_API_KEY"
```

```json
{
  "status": "ok",
  "whatsapp": { "configured": true },
  "database": { "connected": true },
  "socket": { "enabled": true }
}
```

## 4. Cliente JavaScript pronto

Um cliente reutilizável está disponível em [`docs/examples/norte-sul-whatsapp-client.js`](examples/norte-sul-whatsapp-client.js). Ele funciona com Node.js 20+ e runtimes que implementam `fetch`, `FormData` e `Blob`.

```js
const { NorteSulWhatsAppClient } = require("./norte-sul-whatsapp-client");

const whatsapp = new NorteSulWhatsAppClient({
  baseUrl: process.env.NORTE_SUL_WHATSAPP_API_URL,
  apiKey: process.env.NORTE_SUL_WHATSAPP_API_KEY,
});

const status = await whatsapp.status();
console.log(status);
```

O cliente normaliza os dois formatos de sucesso existentes na API:

```json
{ "success": true, "data": {} }
```

e respostas legadas que retornam o objeto diretamente.

## 5. Fluxo completo de atendimento

O fluxo recomendado é:

1. Criar ou recuperar a conversa local com `POST /api/conversations`.
2. Ler `conversation.serviceWindow`.
3. Se `requiresTemplate=true`, consultar um template aprovado e enviá-lo.
4. Aguardar a resposta do cliente.
5. Quando uma mensagem inbound chegar, `canSendFreeform=true` por 24 horas.
6. Durante a janela, enviar texto ou mídia livre.
7. Acompanhar mensagens e status via Socket.IO.

```js
const result = await whatsapp.createConversation({
  name: "Cliente Teste",
  phone: "556696988891",
});

const { conversation } = result;

if (conversation.serviceWindow.requiresTemplate) {
  console.log("É necessário enviar um template aprovado.");
} else {
  await whatsapp.sendText(conversation.id, "Olá! Como podemos ajudar?");
}
```

## 6. Catálogo de endpoints

Todas as rotas `/api/*` exigem `X-API-Key`.

| Método | Rota | Finalidade |
|---|---|---|
| `GET` | `/health` | Saúde básica, pública |
| `GET` | `/api/status` | Banco, WhatsApp e Socket.IO |
| `POST` | `/api/conversations` | Criar ou recuperar contato/conversa local |
| `GET` | `/api/conversations` | Listar conversas |
| `GET` | `/api/conversations/:id` | Consultar conversa |
| `GET` | `/api/conversations/:id/messages` | Histórico de mensagens |
| `POST` | `/api/conversations/:id/messages` | Enviar texto livre |
| `POST` | `/api/conversations/:id/read` | Marcar conversa como lida |
| `PATCH` | `/api/conversations/:id/status` | Fechar, reabrir ou arquivar |
| `GET` | `/api/templates` | Listar templates da WABA |
| `GET` | `/api/templates/:name` | Detalhar template |
| `POST` | `/api/templates/preview` | Renderizar preview sem enviar |
| `POST` | `/api/conversations/:id/messages/template` | Enviar template aprovado |
| `POST` | `/api/conversations/:id/messages/image` | Enviar imagem |
| `POST` | `/api/conversations/:id/messages/document` | Enviar documento |
| `POST` | `/api/conversations/:id/messages/video` | Enviar vídeo |
| `POST` | `/api/conversations/:id/messages/audio` | Enviar áudio/voice message |
| `GET` | `/api/media/:mediaId` | Obter mídia autenticada |

## 7. Conversas

### Criar ou recuperar conversa

```http
POST /api/conversations
Content-Type: application/json
X-API-Key: ...
```

```json
{
  "name": "Leo teste",
  "phone": "+55 (66) 9698-8891"
}
```

A API normaliza o telefone para dígitos. `name` deve ter de 2 a 160 caracteres. O número normalizado deve conter de 10 a 15 dígitos e começar com um dígito diferente de zero.

- HTTP `201`: contato/conversa criados.
- HTTP `200`: conversa `OPEN` existente reutilizada.
- Esta operação é somente local e não envia mensagem ao WhatsApp.

```json
{
  "success": true,
  "data": {
    "conversation": {
      "id": 123,
      "status": "OPEN",
      "unreadCount": 0,
      "serviceWindow": {
        "canSendFreeform": false,
        "requiresTemplate": true
      }
    },
    "contact": {
      "id": 45,
      "waId": "556696988891",
      "phone": "556696988891",
      "name": "Leo teste"
    },
    "created": true
  }
}
```

### Listar conversas

```http
GET /api/conversations?page=1&limit=30&status=OPEN&search=Leo
```

Query params:

| Campo | Padrão | Regra |
|---|---:|---|
| `page` | `1` | Inteiro maior que zero |
| `limit` | `30` | De 1 a 100 |
| `status` | — | `OPEN`, `CLOSED` ou `ARCHIVED` |
| `search` | — | Nome, perfil, telefone ou WA ID; máximo 100 caracteres |

```json
{
  "data": [
    {
      "id": 123,
      "status": "OPEN",
      "unreadCount": 2,
      "lastMessageAt": "2026-08-14T12:30:00.000Z",
      "contact": {},
      "lastMessage": {},
      "serviceWindow": {}
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 30,
    "total": 1,
    "totalPages": 1
  }
}
```

### Consultar conversa

```http
GET /api/conversations/123
```

Retorna a conversa diretamente, incluindo `contact`, `serviceWindow`, `canSendFreeform` e `requiresTemplate`.

### Alterar status local

```http
PATCH /api/conversations/123/status
Content-Type: application/json
```

```json
{ "status": "CLOSED" }
```

Valores: `OPEN`, `CLOSED` ou `ARCHIVED`. Esta operação altera apenas o estado local da conversa.

### Marcar como lida

```http
POST /api/conversations/123/read
```

Zera `unreadCount`. Quando existe uma mensagem inbound com `wamid`, a API também solicita à Meta que ela seja marcada como lida.

## 8. Janela de atendimento de 24 horas

Use sempre `serviceWindow` para decidir qual envio oferecer ao usuário:

```json
{
  "conversationInitiated": true,
  "initiatedAt": "2026-08-14T12:00:00.000Z",
  "initialTemplateWamid": "wamid...",
  "initialTemplateStatus": "DELIVERED",
  "waitingForCustomerReply": true,
  "canSendFreeform": false,
  "requiresTemplate": true,
  "openedAt": null,
  "expiresAt": null
}
```

Regras:

- Enviar template não abre a janela livre.
- Uma mensagem real recebida do cliente abre a janela por 24 horas.
- Cada nova mensagem inbound renova a expiração por mais 24 horas.
- `canSendFreeform=true`: texto e mídia livre podem ser enviados.
- `requiresTemplate=true`: use um template aprovado.
- A API rejeita texto ou mídia livre quando a janela está fechada.
- `waitingForCustomerReply` volta para `false` quando o cliente responde.

Os campos `metaWindow` e `canSendFreeText` são aliases de compatibilidade. Integrações novas devem usar `serviceWindow` e `canSendFreeform`.

## 9. Histórico e formato das mensagens

```http
GET /api/conversations/123/messages?page=1&limit=30
```

A API busca as mensagens mais recentes da página e as devolve em ordem cronológica.

Campos comuns:

```json
{
  "id": 100,
  "wamid": "wamid...",
  "conversationId": 123,
  "direction": "INBOUND",
  "type": "text",
  "text": "Olá",
  "status": "RECEIVED",
  "messageTimestamp": "2026-08-14T12:30:00.000Z",
  "createdAt": "2026-08-14T12:30:01.000Z"
}
```

Direções:

- `INBOUND`: cliente → empresa.
- `OUTBOUND`: empresa → cliente.

Status:

- `RECEIVED`, `SENT`, `DELIVERED`, `READ` ou `FAILED`.

Tipos comuns:

- `text`, `template`, `image`, `document`, `video`, `audio`, `sticker`.

Mensagens de mídia possuem:

```json
{
  "type": "audio",
  "media": {
    "mediaId": "123456",
    "mimeType": "audio/ogg; codecs=opus",
    "filename": null,
    "caption": null,
    "sha256": "...",
    "voice": true,
    "durationSeconds": null,
    "url": "/api/media/123456"
  }
}
```

Mensagens de template possuem a renderização persistida:

```json
{
  "type": "template",
  "text": "Olá Leonardo, seu pedido 123 foi aprovado.",
  "template": {
    "name": "pedido_aprovado",
    "language": "pt_BR",
    "category": "UTILITY",
    "header": "Pedido 123",
    "body": "Olá Leonardo, seu pedido 123 foi aprovado.",
    "footer": "Norte Sul Sementes",
    "buttons": []
  }
}
```

## 10. Envio de texto

Disponível apenas quando `serviceWindow.canSendFreeform=true`.

```http
POST /api/conversations/123/messages
Content-Type: application/json
```

```json
{ "text": "Olá! Como podemos ajudar?" }
```

O texto deve ter de 1 a 4096 caracteres. A resposta HTTP é `201` e contém a Message criada.

```js
await whatsapp.sendText(123, "Olá! Como podemos ajudar?");
```

## 11. Templates

### Listar templates

```http
GET /api/templates?status=APPROVED&language=pt_BR&page=1&limit=30
```

Filtros opcionais:

- `status`, `language`, `category`, `search`, `page`, `limit`.
- `refresh=true` ignora o cache de 5 minutos e consulta novamente a Meta.

```js
const result = await whatsapp.listTemplates({
  status: "APPROVED",
  language: "pt_BR",
});

for (const item of result.data) {
  console.log(item.template.name, item.template.body?.text);
}
```

### Detalhar template

```http
GET /api/templates/pedido_aprovado?language=pt_BR
```

Retorna `{ template, raw }`, com conteúdo normalizado e objeto sanitizado da Meta. Nunca retorna access token.

### Preview sem envio

```http
POST /api/templates/preview
Content-Type: application/json
```

```json
{
  "name": "pedido_aprovado",
  "language": "pt_BR",
  "parameters": {
    "header": ["123"],
    "body": ["Leonardo", "123"]
  }
}
```

Esse endpoint não envia mensagem. Ele informa `missingParameters` e `valid`.

### Enviar template

```http
POST /api/conversations/123/messages/template
Content-Type: application/json
```

```json
{
  "templateName": "pedido_aprovado",
  "language": "pt_BR",
  "components": [
    {
      "type": "header",
      "parameters": [{ "type": "text", "text": "123" }]
    },
    {
      "type": "body",
      "parameters": [
        { "type": "text", "text": "Leonardo" },
        { "type": "text", "text": "123" }
      ]
    }
  ]
}
```

Somente templates com status `APPROVED` são aceitos. A API obtém o telefone pela conversa; o consumidor nunca informa token, WABA ou Phone Number ID.

## 12. Upload e envio de mídias

Uploads usam `multipart/form-data`. Não defina manualmente o header `Content-Type`; `fetch` adicionará o boundary correto.

### Limites

| Tipo | MIME aceitos | Limite |
|---|---|---:|
| Imagem | JPEG, PNG | 5 MB |
| Áudio | AAC, MP4, MPEG, AMR, OGG/Opus; WebM é convertido | 16 MB |
| Vídeo | MP4, 3GPP | 16 MB |
| Documento | TXT, PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX | 100 MB |

A API valida tamanho, MIME declarado e assinatura básica do conteúdo. Arquivos temporários e conversões são removidos depois do processamento.

### Envio genérico com Blob/File

```js
const form = new FormData();
form.append("file", blob, "arquivo.pdf");
form.append("caption", "Documento solicitado");

const response = await fetch(
  `${API_URL}/api/conversations/123/messages/document`,
  {
    method: "POST",
    headers: { "X-API-Key": API_KEY },
    body: form,
  },
);
```

Campos adicionais:

| Rota | Campos opcionais |
|---|---|
| `image` | `caption` |
| `document` | `caption`, `filename` |
| `video` | `caption` |
| `audio` | `voice=true` ou `voice=false` |

Texto e mídias livres exigem janela de atendimento aberta.

### Arquivo local no Node.js 20+

```js
const fs = require("node:fs/promises");

const bytes = await fs.readFile("./pedido.pdf");
const file = new Blob([bytes], { type: "application/pdf" });

await whatsapp.sendDocument(123, file, {
  filename: "pedido.pdf",
  caption: "Segue o pedido",
});
```

### Gravação do navegador

Navegadores Chromium geralmente produzem `audio/webm;codecs=opus`. A API converte WebM temporariamente para OGG/Opus antes de enviar à Meta.

```js
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
const chunks = [];

recorder.ondataavailable = (event) => {
  if (event.data.size) chunks.push(event.data);
};

recorder.onstop = async () => {
  const blob = new Blob(chunks, { type: recorder.mimeType });
  await whatsapp.sendAudio(123, blob, {
    filename: "gravacao.webm",
    voice: true,
  });
};
```

Em frontend público, envie esse Blob ao seu próprio BFF; não instancie o cliente com a chave secreta no browser.

## 13. Download e exibição de mídia

`media.url` é uma rota relativa protegida. O backend busca a URL temporária na Meta e transmite o arquivo; o access token da Meta nunca é entregue ao consumidor.

```js
const blob = await whatsapp.getMediaBlob(message.media.url);
const objectUrl = URL.createObjectURL(blob);
audioElement.src = objectUrl;
audioElement.onended = () => URL.revokeObjectURL(objectUrl);
```

Uma tag `<audio src="...">` não consegue incluir `X-API-Key`. Busque o Blob autenticado e use `URL.createObjectURL`, ou crie um endpoint temporário autenticado no seu BFF.

Não trate a URL ou o media ID da Meta como armazenamento permanente. A implementação atual não mantém cópia permanente das mídias na VPS.

## 14. Socket.IO

Instale no projeto consumidor:

```bash
npm install socket.io-client
```

```js
const { io } = require("socket.io-client");

const socket = io(process.env.NORTE_SUL_WHATSAPP_API_URL, {
  transports: ["websocket"],
  auth: { apiKey: process.env.NORTE_SUL_WHATSAPP_API_KEY },
});

socket.on("connect", () => console.log("WhatsApp em tempo real conectado"));
socket.on("connect_error", (error) => console.error(error.message));

socket.on("conversation:new", ({ conversation }) => {});
socket.on("conversation:updated", (conversation) => {});
socket.on("message:new", ({ conversationId, message }) => {});
socket.on("message:status", ({ conversationId, messageId, wamid, status }) => {});
socket.on("conversation:read", ({ conversationId, unreadCount }) => {});
socket.on("conversation:status", ({ conversationId, status }) => {});
```

Recomendações:

- Reconecte automaticamente e, após reconectar, sincronize conversas/mensagens por REST.
- Use `message.id` ou `wamid` para evitar duplicidade visual.
- `message:new` pode chegar para a mesma mensagem que acabou de ser devolvida por um POST; faça merge por ID.
- O banco usa `wamid` único para idempotência dos webhooks.

## 15. Rate limits

- Envios de texto, template e mídia: até 20 requisições por minuto por origem/IP.
- Download de mídia: até 120 requisições por minuto por origem/IP.

Quando limitado, aguarde o período indicado nos headers de rate limit. Não repita envios automaticamente sem verificar se a mensagem já foi criada.

## 16. Erros e tratamento recomendado

Formato padronizado:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dados inválidos."
  }
}
```

Status comuns:

| HTTP | Significado | Ação recomendada |
|---:|---|---|
| `400` | Payload inválido ou janela fechada | Corrigir dados ou usar template |
| `401` | API key ausente/incorreta | Corrigir segredo no backend |
| `404` | Conversa/template não encontrado | Atualizar referência local |
| `413` | Arquivo acima do limite | Reduzir arquivo |
| `415` | MIME/conteúdo não suportado | Converter para formato aceito |
| `422` | Conversão de áudio falhou | Gravar novamente ou usar OGG/Opus |
| `429` | Rate limit | Aguardar e aplicar backoff |
| `500/502/503` | Falha interna, Meta ou dependência | Registrar contexto e tentar depois com cautela |

Exemplo:

```js
try {
  await whatsapp.sendText(123, "Olá");
} catch (error) {
  console.error({
    status: error.status,
    code: error.code,
    message: error.message,
  });
}
```

Não registre API keys, tokens, conteúdos sensíveis ou o objeto completo da requisição em logs.

## 17. Rotas que projetos consumidores não devem usar

- `/webhook/whatsapp` é exclusivo da Meta.
- `/api/messages/text` é um endpoint técnico legado e está bloqueado pelo Nginx público.
- Páginas legais são públicas, mas não fazem parte do fluxo de integração.
- Projetos consumidores nunca devem chamar diretamente a Graph API usando as credenciais desta aplicação.

## 18. Checklist para conectar um novo projeto

- [ ] Receber `API_URL` e uma `API_KEY` por canal seguro.
- [ ] Armazenar a chave somente no backend/BFF.
- [ ] Testar `/health` e `/api/status`.
- [ ] Criar/reutilizar conversa por telefone.
- [ ] Respeitar `serviceWindow.requiresTemplate`.
- [ ] Implementar templates aprovados para janela fechada.
- [ ] Implementar merge de mensagens por `id`/`wamid`.
- [ ] Conectar Socket.IO e ressincronizar por REST após reconexão.
- [ ] Buscar mídias como Blob autenticado.
- [ ] Tratar 401, 413, 415, 429 e erros temporários.
- [ ] Nunca expor a API key em frontend ou Git.

## 19. Exemplo mínimo de integração

```js
const { NorteSulWhatsAppClient } = require("./norte-sul-whatsapp-client");

const api = new NorteSulWhatsAppClient({
  baseUrl: process.env.NORTE_SUL_WHATSAPP_API_URL,
  apiKey: process.env.NORTE_SUL_WHATSAPP_API_KEY,
});

async function iniciarAtendimento({ name, phone }) {
  const { conversation, created } = await api.createConversation({ name, phone });

  if (conversation.serviceWindow.requiresTemplate) {
    const templates = await api.listTemplates({ status: "APPROVED", language: "pt_BR" });
    return { conversation, created, action: "SELECT_TEMPLATE", templates: templates.data };
  }

  return { conversation, created, action: "FREEFORM_ALLOWED" };
}
```

Para detalhes internos e formatos adicionais, consulte também [`docs/API.md`](API.md).
