# API do Norte Sul Chat

Base URL de produção: `https://whatsapp-api.nortesulsementes.com`

As rotas `/api/*` aceitam o header `X-API-Key` quando `INTERNAL_API_KEY` estiver configurada. Essa chave é uma proteção temporária entre servidores e não deve ser inserida em frontend público. Uma autenticação de usuários deverá substituí-la antes da exposição direta a navegadores.

## Status

### `GET /api/status`

Retorna a disponibilidade do banco, do Socket.IO e a presença da configuração do WhatsApp, sem expor segredos.

## Canais WhatsApp

O backend atende dois números da mesma WABA. O recurso `WhatsAppChannel` identifica o número usado por cada conversa e por todas as operações relacionadas:

| Canal | `phoneNumberId` | Padrão |
|---|---|---:|
| Norte Sul Sementes | `1226938830493899` | Sim |
| Norte Sul \| Atendimento Comercial | `1272418099287669` | Não |

### `GET /api/whatsapp/channels`

Lista apenas canais ativos, sem retornar token ou outro segredo:

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "phoneNumberId": "1226938830493899",
      "displayPhoneNumber": "+55 65 4042-0707",
      "displayName": "Norte Sul Sementes",
      "isDefault": true
    }
  ]
}
```

O webhook resolve o canal por `metadata.phone_number_id`. Eventos de IDs desconhecidos são confirmados para a Meta, registrados de forma segura e ignorados, sem contaminar conversas existentes.

## Conversas

### `POST /api/conversations`

Cria ou recupera somente o contato e uma conversa local `OPEN`. Esta operação **não envia mensagem à Meta**. O telefone é normalizado para dígitos e deve conter DDI, DDD e número.

```json
{
  "name": "Leo teste",
  "phone": "556696988891",
  "channelId": 2
}
```

`channelId` é opcional. Também é possível informar `phoneNumberId`; sem ambos, o canal padrão é usado. O mesmo contato pode manter uma conversa `OPEN` independente em cada canal.

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
- `channelId`: ID interno do canal.
- `phoneNumberId`: ID oficial do número na Meta.

```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 30, "total": 0, "totalPages": 0 }
}
```

### `GET /api/conversations/:id`

Retorna conversa, contato, `serviceWindow` e o objeto `channel` com os metadados seguros do número.

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

Esse endpoint é mantido para operações técnicas e continua usando `WHATSAPP_PHONE_NUMBER_ID`, o canal padrão. O Nginx de produção bloqueia seu acesso público; prefira o envio por `conversationId`, que seleciona automaticamente o canal da conversa.

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

Os eventos de conversa, mensagem e chamada incluem `channel` (e `phoneNumberId` onde já fazia parte do contrato), permitindo separar as duas caixas de entrada no frontend.

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

Upload e envio usam automaticamente o `phoneNumberId` do canal da conversa. O frontend não precisa, e não deve, enviar token da Meta.

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

## WhatsApp Calling

Implementação baseada na WhatsApp Business Calling API oficial da Meta para Graph API `v26.0`. Todas as rotas abaixo exigem `X-API-Key`. O access token permanece exclusivamente no backend.

### Arquitetura e WebRTC

```text
WhatsApp do cliente ↔ Meta Calling API ↔ gateway Pion ICE-FULL ↔ navegador do atendente
                                      ↕
                              Express/Socket.IO/PostgreSQL
```

O gateway mantém uma sessão WebRTC estável com a Meta e uma conexão separada com cada navegador. Ele retransmite RTP Opus sem gravar áudio. O Express controla autorização, presença, estados e transferências; SDP não é persistido nem enviado em eventos públicos.

O serviço HTTP do gateway escuta somente em `127.0.0.1:3025`, exige bearer próprio e anuncia o IP público da VPS na faixa UDP configurada. Se redes de atendentes bloquearem UDP, avalie TURN próprio após testes reais; ele não é requisito automático desta instalação.

### Estados internos

| Estado | Uso |
|---|---|
| `RINGING` | chamada inbound tocando ou outbound tocando |
| `CONNECTING` | sinalização/WebRTC em negociação |
| `ACTIVE` | chamada atendida; define `answeredAt` |
| `REJECTED` | chamada recusada |
| `MISSED` | encerrada sem `start_time`/atendimento |
| `BUSY` | falha normalizada como ocupado |
| `FAILED` | falha técnica retornada pela Meta |
| `ENDED` | chamada atendida e encerrada |

`durationSeconds` é calculado entre `answeredAt` e `endedAt`, ou usa a duração oficial do webhook `terminate` quando presente. Chamadas não alteram a janela de 24 horas das mensagens.

### Eventos Socket.IO

- `call:incoming`
- `call:ringing`
- `call:connecting`
- `call:active`
- `call:rejected`
- `call:ended`
- `call:failed`
- `call:updated`
- `call:claimed`
- `call:transfer:incoming`
- `call:transfer:accepted`
- `call:transfer:rejected`
- `call:transfer:cancelled`
- `call:transfer:expired`
- `call:transfer:completed`
- `call:transferred:away`

Exemplo de chamada recebida:

```json
{
  "callId": "wacid...",
  "conversationId": 123,
  "contact": { "id": 10, "name": "Cliente", "phone": "5566..." },
  "phoneNumberId": "...",
  "channel": { "id": 2, "phoneNumberId": "1272418099287669", "displayName": "Norte Sul | Atendimento Comercial" },
  "direction": "INBOUND",
  "status": "RINGING",
  "startedAt": "2026-08-24T20:00:00.000Z"
}
```

### Chamada recebida

1. Escute `call:incoming` no socket privado do atendente.
2. Solicite o microfone com `navigator.mediaDevices.getUserMedia({ audio: true })`.
3. Crie uma offer WebRTC do navegador e envie-a para `POST /api/calls/:callId/media`.
4. Aplique a answer retornada pelo gateway e aguarde a conexão ICE.
5. Confirme em `POST /api/calls/:callId/media-ready`.
6. O backend só aceita a chamada na Meta depois de detectar RTP recente do atendente.

A chamada de `media-ready` pode ser feita assim que o navegador aplicar a answer. A API aguarda por até `CALL_MEDIA_READY_WAIT_MS` (8 segundos por padrão) pelo primeiro RTP, evitando falhas intermitentes causadas pela negociação ICE ainda em andamento. Se o prazo terminar, retorna HTTP 409 e o frontend deve encerrar essa sessão de mídia ou permitir nova tentativa; nunca deve apresentar a chamada como conectada.

```js
const joined = await fetch(`${API}/api/calls/${encodeURIComponent(callId)}/media`, {
  method: "POST",
  headers: { ...authHeaders, "X-Agent-Token": signedAgentToken, "Content-Type": "application/json" },
  body: JSON.stringify({ session: { sdpType: "offer", sdp: peer.localDescription.sdp } }),
}).then((response) => response.json());
await peer.setRemoteDescription({ type: "answer", sdp: joined.data.session.sdp });
await fetch(`${API}/api/calls/${encodeURIComponent(callId)}/media-ready`, {
  method: "POST", headers: { ...authHeaders, "X-Agent-Token": signedAgentToken },
});
```

Endpoints inbound:

- `POST /api/calls/:callId/media`
- `POST /api/calls/:callId/media-ready`
- `POST /api/calls/:callId/reject`
- `POST /api/calls/:callId/terminate`

`X-Agent-Token` é um token HMAC de 90 segundos emitido pelo servidor autenticado do frontend. Ele contém `sub`, `name`, `iss`, `aud`, `iat` e `exp`; o segredo compartilhado nunca deve chegar ao navegador. Estados inválidos retornam HTTP 409.

### Transferência direta

1. Consulte `GET /api/call-agents` e escolha um atendente `AVAILABLE`.
2. O atendente atual chama `POST /api/calls/:callId/transfer` com `{ "targetAgentId": "72" }`.
3. O destino recebe `call:transfer:incoming` e aceita ou recusa.
4. Ao aceitar, o destino conecta seu navegador em `/media`, passando `transferId`.
5. `/media-ready` com o mesmo `transferId` conclui a troca somente se houver RTP recente.

Endpoints:

- `GET /api/call-agents`
- `POST /api/calls/:callId/transfer`
- `POST /api/calls/:callId/transfer/:transferId/accept`
- `POST /api/calls/:callId/transfer/:transferId/reject`
- `POST /api/calls/:callId/transfer/:transferId/cancel`

Há no máximo uma transferência aberta por chamada. O destino deve estar online e sem chamada ativa. Rejeição, cancelamento, expiração ou falha de mídia preservam o agente original; a conclusão atualiza atomicamente o responsável da chamada e da conversa e só depois desconecta o navegador anterior. Nenhuma operação de transferência chama `terminate` na Meta.

### Histórico

- `GET /api/calls?page=1&limit=30&conversationId=&contactId=&direction=&status=&date=2026-08-24`
- `GET /api/conversations/:id/calls?page=1&limit=30`

A paginação é obrigatória e os limites aceitos são de 1 a 100 itens.

### Permissão e chamada outbound

Consulte a permissão atual:

```http
GET /api/conversations/123/call-permission?id=72&name=LEONARDO&director=false
```

A resposta normalizada contém `status`, `canCall`, `requestedAt`, `grantedAt` e `expiresAt`. O endpoint legado `GET /calls/permission` permanece compatível.

Solicite permissão durante uma janela de atendimento aberta:

```http
POST /api/conversations/123/calls/permission
Content-Type: application/json

{
  "body": "Podemos ligar para ajudar no seu atendimento?",
  "agent": { "id": "72", "name": "LEONARDO" }
}
```

Fora da janela de atendimento, use um template de `call_permission_request` aprovado; o endpoint livre não contorna a regra da Meta.

A decisão do cliente chega no webhook oficial de `messages` como uma mensagem interativa do tipo `call_permission_reply`. Os estados `PENDING`, `GRANTED`, `DENIED`, `EXPIRED` e `REVOKED` são persistidos em `CallPermission`, sempre vinculados à conversa e ao canal correto. A mudança é enviada ao atendente pelo evento privado `call:permission:updated`; ela apenas habilita o botão e nunca inicia uma chamada automaticamente.

Primeiro conecte o navegador ao gateway:

```http
POST /api/conversations/123/calls/media
Content-Type: application/json

{ "session": { "sdpType": "offer", "sdp": "v=0..." } }
```

Depois inicie somente após o usuário conceder permissão:

```http
POST /api/conversations/123/calls
Content-Type: application/json

{
  "mediaSessionId": "sessao-provisoria-retornada"
}
```

Antes do `connect`, o backend exige mídia pronta e consulta `GET /{PHONE_NUMBER_ID}/call_permissions` com `start_call.can_perform_action=true`. Sem permissão retorna HTTP 409 com `CALL_PERMISSION_REQUIRED`. A answer da Meta é aplicada internamente à sessão estável do gateway.

Ao criar a chamada, o backend emite `call:outgoing` e continua usando os eventos `call:ringing`, `call:active`, `call:failed` e `call:ended` para atualizar o navegador.

### Segurança e limitações

- `phone_number_id` vem da conversa/canal e não é assumido globalmente; `WHATSAPP_PHONE_NUMBER_ID` é apenas fallback para conversas antigas.
- Toda ação exige API key; mídia e transferência exigem também identidade HMAC do atendente.
- Tokens, APP_SECRET e SDP nunca aparecem em logs.
- A API do gateway não é publicada no Nginx e usa um bearer separado.
- O rate limit é 30 ações/minuto e 120 consultas/minuto por origem.
- O webhook responde HTTP 200 antes do processamento assíncrono e mensagens normais são processadas independentemente de falhas em chamadas.
- Não há SIP, PSTN, VIP Solutions, gravação nem transcrição nesta implementação.
- O backend não habilita Calling, não assina o campo `calls` e não altera configurações da Meta automaticamente.

### Referências oficiais da Meta

- [Calling API — referência](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/reference)
- [Chamadas iniciadas pelo usuário](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/user-initiated-calls)
- [Chamadas iniciadas pela empresa](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/business-initiated-calls)
- [Permissões de chamada](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/user-call-permissions)
- [Padrões de integração WebRTC/SIP](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/integration-patterns)
- [Solução de problemas](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/troubleshooting)
