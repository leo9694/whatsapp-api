# Norte Sul WhatsApp API

Backend Node.js 20+ com Express, PostgreSQL, Prisma e Socket.IO para receber o webhook oficial do WhatsApp Cloud API e oferecer uma API de atendimento ao futuro frontend do **Norte Sul Chat**.

O projeto é deliberadamente passivo: ao iniciar, não chama a API da Meta, não registra, remove ou migra números, não assina `subscribed_apps`, não altera WABA, PIN, callback ou qualquer configuração do aplicativo existente **chatapp**. Também não envia respostas automáticas nem inicia chamadas sozinho. Mensagens e ações de chamada só ocorrem por requisições autenticadas e explícitas à API.

## Instalação e execução

```bash
npm install
cp .env.example .env
npm start
```

Para desenvolvimento, com reinício automático:

```bash
npm run dev
```

A aplicação escuta internamente em `127.0.0.1:3000` (ou no endereço e porta definidos em `HOST` e `PORT`) e deve ser publicada externamente pelo Nginx.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

```dotenv
PORT=3000
HOST=127.0.0.1
WHATSAPP_VERIFY_TOKEN=crie-um-segredo-longo-e-exclusivo
WHATSAPP_ACCESS_TOKEN=token-de-acesso-fornecido-pela-meta
WHATSAPP_PHONE_NUMBER_ID=id-do-numero-no-novo-app
WHATSAPP_WABA_ID=id-da-conta-whatsapp-business
META_GRAPH_API_VERSION=v26.0
PRIVACY_CONTACT_EMAIL=privacidade@exemplo.com
DATABASE_URL=postgresql://usuario:senha@127.0.0.1:5432/norte_sul_whatsapp
FRONTEND_URLS=["https://chat.nortesulsementes.com"]
INTERNAL_API_KEY=chave-temporaria-entre-servidores
CALL_MEDIA_GATEWAY_ENABLED=false
CALL_AGENT_AUTH_REQUIRED=false
CALL_AGENT_AUTH_SECRET=segredo-aleatorio-compartilhado-com-o-frontend
CALL_TRANSFER_TIMEOUT_SECONDS=30
MEDIA_GATEWAY_URL=http://127.0.0.1:3025
MEDIA_GATEWAY_TOKEN=segredo-aleatorio-exclusivo-do-gateway
MEDIA_PUBLIC_IP=IP_PUBLICO_DA_VPS
MEDIA_HTTP_PORT=3025
MEDIA_UDP_MIN_PORT=40000
MEDIA_UDP_MAX_PORT=40100
NODE_ENV=production
```

- `WHATSAPP_VERIFY_TOKEN`: valor secreto criado por você; deve ser igual ao informado na configuração do webhook na Meta.
- `HOST`: mantenha `127.0.0.1` em produção para aceitar conexões apenas do proxy local.
- `WHATSAPP_ACCESS_TOKEN`: token da API, usado somente no endpoint manual de envio.
- `WHATSAPP_PHONE_NUMBER_ID`: ID padrão do número; conversas recebidas guardam seu próprio `phone_number_id` para suportar múltiplos números.
- `WHATSAPP_WABA_ID`: ID da WABA, reservado para uso futuro; nenhuma configuração é alterada por este projeto.
- `META_GRAPH_API_VERSION`: versão da Graph API usada em mensagens, mídias, templates e chamadas.
- `PRIVACY_CONTACT_EMAIL`: email exibido na página de solicitação de exclusão de dados; pode ficar vazio.
- `DATABASE_URL`: conexão PostgreSQL exclusiva da aplicação, preferencialmente via `127.0.0.1`.
- `FRONTEND_URLS`: array JSON ou lista separada por vírgulas com as origens permitidas pelo CORS e Socket.IO.
- `INTERNAL_API_KEY`: proteção temporária das rotas `/api/*`; envie-a em `X-API-Key`. Não exponha essa chave no frontend público.
- `CALL_AGENT_AUTH_SECRET`: segredo HMAC de no mínimo 32 caracteres, igual no servidor do frontend; autentica a identidade real do atendente sem expor o segredo ao navegador.
- `CALL_MEDIA_GATEWAY_ENABLED` e `CALL_AGENT_AUTH_REQUIRED`: feature flags para ativação gradual do gateway e da autenticação individual.
- `CALL_MEDIA_READY_WAIT_MS`: janela curta (padrão 8 segundos) em que a API aguarda o primeiro RTP do microfone antes de rejeitar a ativação.
- `MEDIA_GATEWAY_URL`/`MEDIA_GATEWAY_TOKEN`: canal local autenticado entre Express e o gateway Pion.
- `MEDIA_PUBLIC_IP` e `MEDIA_UDP_MIN_PORT`/`MEDIA_UDP_MAX_PORT`: IP anunciado no ICE e faixa UDP pública exclusiva da mídia.

O arquivo `.env` é ignorado pelo Git. Tokens e segredos não são registrados nos logs.

## Páginas legais

As páginas públicas usadas na configuração do aplicativo Meta são:

- Política de Privacidade: `https://whatsapp-api.nortesulsementes.com/politica-de-privacidade`
- Termos de Serviço: `https://whatsapp-api.nortesulsementes.com/termos-de-servico`
- Exclusão de Dados: `https://whatsapp-api.nortesulsementes.com/exclusao-de-dados`

Elas não exigem login, não utilizam banco de dados, formulários, cookies, trackers ou ferramentas de analytics.

## API de atendimento e Socket.IO

Os endpoints de conversas, mensagens, leitura, status da API e eventos Socket.IO estão documentados em [`docs/API.md`](docs/API.md). O backend persiste contatos, conversas e mensagens no PostgreSQL e usa `wamid` como chave de idempotência.

Para conectar outro sistema, use o **[Guia de Integração](docs/INTEGRATION.md)**. Ele contém início rápido, fluxo completo de atendimento, exemplos cURL/JavaScript, cliente reutilizável, templates, mídias, Socket.IO, erros e checklist de segurança.

Comandos do Prisma:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

Em produção, use migrations versionadas com `prisma migrate deploy`; não substitua esse fluxo por `prisma db push`.

O backend trabalha simultaneamente com os dois números oficiais por meio de `WhatsAppChannel`. Cada conversa pertence a um canal, e mensagens, templates, mídias, permissões e chamadas outbound usam o `phone_number_id` desse canal. O número `1226938830493899` permanece default e `WHATSAPP_PHONE_NUMBER_ID` continua sendo apenas o fallback legado. Consulte canais em `GET /api/whatsapp/channels` e exemplos completos em [`docs/API.md`](docs/API.md).

## WhatsApp Calling

O backend processa o campo oficial `calls` no mesmo webhook existente, identifica o canal por `metadata.phone_number_id`, mantém histórico no PostgreSQL e oferece sinalização segura entre navegador e Meta para chamadas WebRTC. Não usa SIP, não persiste SDP e nunca expõe o token da Meta ao frontend.

Fluxos disponíveis:

- chamada recebida: `call:incoming` → SDP offer em `call:signal` → `pre-accept` → `accept`;
- recusar e encerrar chamadas;
- consultar histórico e estados em tempo real;
- solicitar e consultar permissão outbound, persistida em `CallPermission`;
- iniciar outbound somente quando a Meta retornar `start_call.can_perform_action=true`.
- transferir uma chamada ativa diretamente entre atendentes, sem encerrar a sessão do cliente na Meta.

Com o gateway ativado, o áudio segue `Meta ↔ gateway Pion (ICE-FULL) ↔ navegador`. Durante uma transferência, os dois navegadores podem preparar mídia, mas somente o atendente atual envia áudio ao cliente. A troca ocorre apenas após o novo atendente aceitar e o gateway detectar RTP recente; então a atribuição é persistida e a conexão do atendente anterior é encerrada. Rejeição, cancelamento, timeout ou falha de mídia mantêm a chamada com o atendente original.

Para receber chamadas, o campo webhook `calls` deve ser habilitado manualmente no aplicativo Meta. A resposta à solicitação de permissão chega pelo campo `messages`, como `interactive.call_permission_reply`; o backend persiste a decisão e emite `call:permission:updated`. O projeto não altera essas assinaturas. Endpoints, payloads, estados, Socket.IO e o fluxo do navegador estão em [`docs/API.md`](docs/API.md#whatsapp-calling).

Instalação incremental, portas, teste manual e rollback do gateway estão em [`docs/CALL_TRANSFER_DEPLOY.md`](docs/CALL_TRANSFER_DEPLOY.md).

## Endpoints e testes

Verifique a saúde do serviço:

```bash
curl http://127.0.0.1:3000/health
```

Resposta esperada: `{"status":"ok"}`.

Teste localmente a validação do webhook, substituindo o token pelo valor do seu `.env`:

```bash
curl "http://127.0.0.1:3000/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=SEU_VERIFY_TOKEN&hub.challenge=123456"
```

Com o token correto, retorna `123456` e HTTP 200; com token incorreto, HTTP 403.

Para simular um evento recebido sem acessar a Meta:

```bash
curl -X POST http://127.0.0.1:3000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[]}'
```

O webhook confirma HTTP 200 imediatamente e processa/loga o payload de forma protegida logo depois. IDs de mensagem repetidos em até cinco minutos são ignorados por uma estrutura temporária em memória, isolada para futura substituição por Redis ou banco.

Exemplo de envio manual de mensagem:

```bash
curl -X POST http://127.0.0.1:3000/api/messages/text \
  -H "Content-Type: application/json" \
  -d '{"to":"5565XXXXXXXX","text":"Mensagem de teste"}'
```

Use apenas dígitos no campo `to`. Não execute esse teste até preencher as credenciais e decidir enviar uma mensagem real.

## Configuração na Meta

No aplicativo **Norte Sul Chat**, configure:

- URL de callback: `https://whatsapp-api.nortesulsementes.com/webhook/whatsapp`
- Verify token: exatamente o mesmo valor de `WHATSAPP_VERIFY_TOKEN`

Não altere o webhook nem qualquer configuração do aplicativo **chatapp**. Este projeto não executa automaticamente inscrições ou mudanças na Meta.

## Produção com PM2

Gravações `audio/webm` produzidas por navegadores Chromium são convertidas para OGG/Opus antes do upload para a Meta. O binário usado nessa conversão é fornecido pela dependência local `ffmpeg-static`; não é necessário instalar FFmpeg globalmente na VPS.

Na pasta do projeto:

```bash
pm2 start src/server.js --name norte-sul-whatsapp
pm2 save
pm2 startup
```

Execute também o comando adicional que `pm2 startup` imprimir para habilitar a inicialização no boot.

## Nginx

Exemplo para `/etc/nginx/sites-available/whatsapp-api.nortesulsementes.com`:

```nginx
server {
    listen 80;
    server_name whatsapp-api.nortesulsementes.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Depois de criar e habilitar o site, valide e recarregue o Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/whatsapp-api.nortesulsementes.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## HTTPS com Certbot

Depois que o DNS do domínio apontar para a VPS e o Nginx responder em HTTP:

```bash
sudo apt update
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d whatsapp-api.nortesulsementes.com
sudo certbot renew --dry-run
```

O Certbot não é executado por este projeto. O endpoint público final será:

`https://whatsapp-api.nortesulsementes.com/webhook/whatsapp`
