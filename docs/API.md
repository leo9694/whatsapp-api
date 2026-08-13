# API do Norte Sul Chat

Base URL de produção: `https://whatsapp-api.nortesulsementes.com`

As rotas `/api/*` aceitam o header `X-API-Key` quando `INTERNAL_API_KEY` estiver configurada. Essa chave é uma proteção temporária entre servidores e não deve ser inserida em frontend público. Uma autenticação de usuários deverá substituí-la antes da exposição direta a navegadores.

## Status

### `GET /api/status`

Retorna a disponibilidade do banco, do Socket.IO e a presença da configuração do WhatsApp, sem expor segredos.

## Conversas

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

Retorna conversa e contato.

### `GET /api/conversations/:id/messages`

Aceita `page` e `limit`. Cada página é devolvida em ordem cronológica para renderização no chat; a paginação busca primeiro as mensagens mais recentes.

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
