# Gateway e transferência de chamadas

## Arquitetura

O gateway Pion mantém a conexão ICE-FULL com a Meta e retransmite RTP Opus para o navegador do atendente. Ele foi escolhido no lugar do mediasoup porque a perna da Meta é ICE-LITE e requer o parceiro como ICE-FULL/controlling; o `WebRtcTransport` do mediasoup opera em ICE-LITE.

```text
Cliente WhatsApp ↔ Meta ↔ Pion na VPS ↔ navegador A/B
                           ↕
                 Express + PostgreSQL + Socket.IO
```

As rooms autenticadas são `agent:{id}` e `call:{id}`. A API individual exige `X-Agent-Token` HMAC curto além de `X-API-Key`.

## Rede

| Porta | Exposição | Uso |
|---|---|---|
| `3025/TCP` | somente `127.0.0.1` | Express → gateway |
| `40000-40100/UDP` | pública | ICE/RTP da Meta e navegadores |
| `443/TCP` | Nginx existente | frontend/API/Socket.IO |

PostgreSQL continua somente em loopback. Coturn não é instalado inicialmente; se o teste manual revelar redes que bloqueiam UDP, avalie TURN com credenciais temporárias e portas próprias.

## Instalação incremental

1. Mantenha `CALL_MEDIA_GATEWAY_ENABLED=false` e `CALL_AGENT_AUTH_REQUIRED=false`.
2. Gere dois segredos aleatórios diferentes, ambos com pelo menos 32 caracteres: `MEDIA_GATEWAY_TOKEN` e `CALL_AGENT_AUTH_SECRET`. Copie apenas o segundo também para o `.env` do frontend.
3. Gere o Prisma, aplique a migration e compile o gateway:

```bash
cd /opt/norte-sul-whatsapp-api
npm ci --omit=dev
npx prisma generate
npx prisma migrate deploy
install -d -m 0755 media-gateway/bin
cd media-gateway
go build -trimpath -o bin/norte-sul-whatsapp-media .
install -m 0644 norte-sul-whatsapp-media.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now norte-sul-whatsapp-media
curl http://127.0.0.1:3025/health
```

4. Valide backend, frontend e gateway. Então ative as duas flags, reinicie apenas os processos envolvidos e confira os logs sanitizados:

```bash
pm2 restart norte-sul-whatsapp --update-env
pm2 restart fila-conferencia --update-env
systemctl restart norte-sul-whatsapp-media
```

Não reinicie a VPS e não altere Nginx, webhook, WABA ou configurações da Meta.

## Teste manual

1. Cliente liga pelo WhatsApp.
2. Atendente A atende e confirma áudio nos dois sentidos.
3. A seleciona B e solicita transferência.
4. B aceita e aguarda a conexão de mídia.
5. Confirme áudio B ↔ cliente.
6. Confirme que A foi desconectado somente depois de B ficar pronto.
7. B encerra normalmente.
8. Repita os cenários de recusa, cancelamento e timeout; A deve continuar falando com o cliente.

Nenhuma chamada real é iniciada pelos testes automatizados.

## Rollback

1. Defina `CALL_MEDIA_GATEWAY_ENABLED=false` e `CALL_AGENT_AUTH_REQUIRED=false`.
2. Restaure o commit anterior do frontend para voltar ao fluxo direto legado.
3. Reinicie somente os dois processos PM2.
4. Pare o gateway com `systemctl disable --now norte-sul-whatsapp-media` se ele não for mais usado.

A migration pode permanecer aplicada: as novas colunas e a tabela são compatíveis e não alteram mensagens. Para restauração completa, use o backup de aplicação e banco criado antes do deploy.
