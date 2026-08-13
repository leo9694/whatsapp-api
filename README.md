# Norte Sul WhatsApp API

Backend Node.js 20+ com Express, PostgreSQL, Prisma e Socket.IO para receber o webhook oficial do WhatsApp Cloud API e oferecer uma API de atendimento ao futuro frontend do **Norte Sul Chat**.

O projeto é deliberadamente passivo: ao iniciar, não chama a API da Meta, não registra, remove ou migra números, não assina `subscribed_apps`, não altera WABA, PIN, callback ou qualquer configuração do aplicativo existente **chatapp**. Também não envia respostas automáticas. O envio só ocorre quando alguém chama manualmente `POST /api/messages/text`.

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
NODE_ENV=production
```

- `WHATSAPP_VERIFY_TOKEN`: valor secreto criado por você; deve ser igual ao informado na configuração do webhook na Meta.
- `HOST`: mantenha `127.0.0.1` em produção para aceitar conexões apenas do proxy local.
- `WHATSAPP_ACCESS_TOKEN`: token da API, usado somente no endpoint manual de envio.
- `WHATSAPP_PHONE_NUMBER_ID`: ID do número usado na URL de envio.
- `WHATSAPP_WABA_ID`: ID da WABA, reservado para uso futuro; nenhuma configuração é alterada por este projeto.
- `META_GRAPH_API_VERSION`: versão da Graph API usada no envio manual.
- `PRIVACY_CONTACT_EMAIL`: email exibido na página de solicitação de exclusão de dados; pode ficar vazio.
- `DATABASE_URL`: conexão PostgreSQL exclusiva da aplicação, preferencialmente via `127.0.0.1`.
- `FRONTEND_URLS`: array JSON ou lista separada por vírgulas com as origens permitidas pelo CORS e Socket.IO.
- `INTERNAL_API_KEY`: proteção temporária das rotas `/api/*`; envie-a em `X-API-Key`. Não exponha essa chave no frontend público.

O arquivo `.env` é ignorado pelo Git. Tokens e segredos não são registrados nos logs.

## Páginas legais

As páginas públicas usadas na configuração do aplicativo Meta são:

- Política de Privacidade: `https://whatsapp-api.nortesulsementes.com/politica-de-privacidade`
- Termos de Serviço: `https://whatsapp-api.nortesulsementes.com/termos-de-servico`
- Exclusão de Dados: `https://whatsapp-api.nortesulsementes.com/exclusao-de-dados`

Elas não exigem login, não utilizam banco de dados, formulários, cookies, trackers ou ferramentas de analytics.

## API de atendimento e Socket.IO

Os endpoints de conversas, mensagens, leitura, status da API e eventos Socket.IO estão documentados em [`docs/API.md`](docs/API.md). O backend persiste contatos, conversas e mensagens no PostgreSQL e usa `wamid` como chave de idempotência.

Comandos do Prisma:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

Em produção, use migrations versionadas com `prisma migrate deploy`; não substitua esse fluxo por `prisma db push`.

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

O envio manual abaixo é o único endpoint que chama a API da Meta:

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
