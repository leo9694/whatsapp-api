# API do Norte Sul Chat

Base URL de produção: `https://whatsapp-api.nortesulsementes.com`

As rotas `/api/*` aceitam o header `X-API-Key` quando `INTERNAL_API_KEY` estiver configurada. Essa chave é uma proteção temporária entre servidores e não deve ser inserida em frontend público. Uma autenticação de usuários deverá substituí-la antes da exposição direta a navegadores.

## Status

### `GET /api/status`

Retorna a disponibilidade do banco, do Socket.IO e a presença da configuração do WhatsApp, sem expor segredos.

## Conversas

### `POST /api/conversations`

Cria ou recupera somente o contato e uma conversa local `OPEN`. Esta operação **não envia mensagem à Meta**. O telefone é normalizado para dígitos e deve conter DDI, DDD e número.

```json
{
  "name": "Leo teste",
  "phone": "556696988891"
}
```

Retorna HTTP `201` quando cria a conversa e `200` quando reutiliza uma conversa `OPEN`:

```json
{
  "success": true,
  "data": {
    "conversation": { "id": 123, "status": "OPEN" },
    "contact": { "id": 45, "name": "Leo teste", "waId": "556696988891" },
    "created": true
  }
}
```

### `GET /api/conversations`

Query params:

- `page`: página, padrão 1.
- `limit`: 1 a 100, padrão 30.
- `search`: nome, perfil, telefone ou WA ID.
- `status`: `OPEN`, `CLOSED` ou `ARCHIVED`.

```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 30, "total": 0, "totalPages": 0 }
}
```

### `GET /api/conversations/:id`

Retorna conversa, contato e `serviceWindow`.

### Janela de atendimento

Toda conversa retornada pela API inclui:

```json
{
  "serviceWindow": {
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
}
```

Enviar um template marca a conversa como iniciada e `waitingForCustomerReply=true`, mas não abre a janela livre. Somente uma mensagem real `INBOUND` do cliente define `openedAt`, `expiresAt = inbound + 24 horas` e `canSendFreeform=true`. Cada nova mensagem inbound renova as 24 horas. Após a expiração, `canSendFreeform=false` e `requiresTemplate=true`; não é necessário job para encerrar a janela.

Por compatibilidade, a resposta também inclui `canSendFreeText` e `metaWindow`. O frontend deve preferir `serviceWindow` e `canSendFreeform` em novas implementações.

### `GET /api/conversations/:id/messages`

Aceita `page` e `limit`. Cada página é devolvida em ordem cronológica para renderização no chat; a paginação busca primeiro as mensagens mais recentes.

Mensagens de template são persistidas imediatamente após a Meta retornar o `wamid` e podem ser reconstruídas sem consultar novamente a Meta:

```json
{
  "id": 123,
  "wamid": "wamid...",
  "direction": "OUTBOUND",
  "type": "template",
  "status": "DELIVERED",
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

### `POST /api/conversations/:id/messages`

Envia uma mensagem real pela Cloud API e persiste a mensagem outbound.

```json
{ "text": "Olá" }
```

### `POST /api/conversations/:id/read`

Zera `unreadCount` e, quando existe um wamid inbound, solicita à Meta a marcação como lida.

### `PATCH /api/conversations/:id/status`

```json
{ "status": "CLOSED" }
```

Aceita `OPEN`, `CLOSED` e `ARCHIVED`.

## Endpoint técnico legado

### `POST /api/messages/text`

```json
{ "to": "5565XXXXXXXX", "text": "Mensagem" }
```

Esse endpoint é mantido para operações técnicas. O Nginx de produção bloqueia seu acesso público; prefira o envio por `conversationId`.

## Webhook e rotas públicas

- `GET|POST /webhook/whatsapp`
- `GET /health`
- `GET /politica-de-privacidade`
- `GET /termos-de-servico`
- `GET /exclusao-de-dados`

## Socket.IO

URL: `https://whatsapp-api.nortesulsementes.com`

Eventos emitidos:

- `conversation:new`
- `conversation:updated`
- `message:new`
- `message:status`
- `conversation:read`
- `conversation:status`

Somente origens listadas em `FRONTEND_URLS` podem conectar a partir de navegadores.

## Exemplo com fetch

```js
const response = await fetch(
  "https://whatsapp-api.nortesulsementes.com/api/conversations?page=1&limit=30",
  { headers: { "X-API-Key": process.env.INTERNAL_API_KEY } },
);
const conversations = await response.json();
```

O exemplo pressupõe execução em um backend/BFF. Não exponha `INTERNAL_API_KEY` em JavaScript público.

## Exemplo com socket.io-client

```js
import { io } from "socket.io-client";

const socket = io("https://whatsapp-api.nortesulsementes.com", {
  transports: ["websocket"],
  auth: { apiKey: process.env.INTERNAL_API_KEY },
});

socket.on("message:new", ({ conversationId, message }) => {
  console.log(conversationId, message);
});
```

Enquanto a autenticação definitiva não existir, a conexão Socket.IO também exige a chave interna quando configurada. Use esse fluxo apenas em um backend/BFF; não publique a chave no bundle do navegador.

## Templates

### `GET /api/templates`

Consulta todos os templates da WABA, seguindo a paginação da Graph API. Aceita `status`, `language`, `category`, `search`, `page`, `limit` e `refresh=true`. O cache em memória dura cinco minutos.

```js
async function listTemplates() {
  const response = await fetch(`${API}/api/templates?status=APPROVED`, { headers: authHeaders });
  return response.json();
}
```

### `GET /api/templates/:name?language=pt_BR`

Retorna o template normalizado e o objeto original sanitizado, com header, body, placeholders, exemplos, footer e botões.

### `POST /api/templates/preview`

Não envia mensagens.

```js
async function previewTemplate() {
  const response = await fetch(`${API}/api/templates/preview`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "pedido_aprovado",
      language: "pt_BR",
      parameters: { body: ["Leonardo", "12345"] },
    }),
  });
  return response.json();
}
```

### `POST /api/conversations/:id/messages/template`

Envia somente templates existentes com status `APPROVED`.

```js
async function sendTemplate(conversationId, templateName, language, components) {
  return fetch(`${API}/api/conversations/${conversationId}/messages/template`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ templateName, language, components }),
  }).then((response) => response.json());
}
```

## Mídias

Rotas:

- `GET /api/media/:mediaId`
- `POST /api/conversations/:id/messages/image`
- `POST /api/conversations/:id/messages/document`
- `POST /api/conversations/:id/messages/video`
- `POST /api/conversations/:id/messages/audio`

Os uploads são `multipart/form-data` com o campo `file`. Imagem/vídeo/documento aceitam `caption`; documento aceita `filename`; áudio aceita `voice=true|false`.

```js
async function sendMedia(conversationId, kind, file, fields = {}) {
  const form = new FormData();
  form.append("file", file);
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  return fetch(`${API}/api/conversations/${conversationId}/messages/${kind}`, {
    method: "POST",
    headers: authHeaders,
    body: form,
  }).then((response) => response.json());
}

const sendImage = (id, file, caption) => sendMedia(id, "image", file, { caption });
const sendDocument = (id, file, caption, filename) => sendMedia(id, "document", file, { caption, filename });
const sendVideo = (id, file, caption) => sendMedia(id, "video", file, { caption });
const sendAudio = (id, file, voice = false) => sendMedia(id, "audio", file, { voice });
```

Formatos e limites aplicados conforme a documentação atual da Meta:

| Tipo | MIME types | Limite |
|---|---|---:|
| Imagem | `image/jpeg`, `image/png` | 5 MB |
| Áudio | AAC, MP4, MPEG, AMR, OGG/Opus | 16 MB |
| Vídeo | MP4/H.264 + AAC, 3GPP | 16 MB |
| Documento | TXT, PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX | 100 MB |

O backend faz verificação básica da assinatura do arquivo, usa nomes temporários aleatórios e remove o arquivo após sucesso ou erro. Não há cache permanente de mídia nesta versão; a URL temporária da Meta não é persistida nem entregue ao frontend.

### Download e reprodução autenticados

Como `<audio src>` e `<video src>` não enviam `X-API-Key`, busque um Blob autenticado:

```js
async function getMediaBlob(mediaUrl) {
  const response = await fetch(`${API}${mediaUrl}`, { headers: authHeaders });
  if (!response.ok) throw new Error("Falha ao obter mídia");
  return response.blob();
}

async function playAudio(mediaUrl, audioElement) {
  const blob = await getMediaBlob(mediaUrl);
  const objectUrl = URL.createObjectURL(blob);
  audioElement.src = objectUrl;
  audioElement.onended = () => URL.revokeObjectURL(objectUrl);
  await audioElement.play();
}
```

Para imagem use o Blob em `img.src`; para vídeo em `video.src`; para documentos crie um `<a download>` usando a URL de objeto.

Mensagens de mídia emitidas em `message:new` incluem apenas uma URL interna:

```json
{
  "conversationId": 123,
  "message": {
    "type": "audio",
    "media": {
      "mediaId": "...",
      "mimeType": "audio/ogg",
      "voice": true,
      "url": "/api/media/MEDIA_ID"
    }
  }
}
```

### Áudio e voice messages

O payload da Cloud API para áudio usa o mesmo objeto `audio` por media ID. Para mensagens de voz, o arquivo enviado à Meta usa OGG com codec Opus. Como navegadores Chromium normalmente gravam `audio/webm;codecs=opus`, o backend aceita essa entrada e a converte temporariamente para OGG/Opus com o binário isolado da dependência `ffmpeg-static`. Nenhuma instalação global de FFmpeg é necessária.

## Respostas das novas rotas

Sucesso:

```json
{ "success": true, "data": {} }
```

Erro:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Dados inválidos." } }
```
