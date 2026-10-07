# URA Norte Sul Sementes

## Fluxo

A API atende o cliente no gateway e reproduz `media-gateway/audio/menu.ogg`, convertido da gravação fornecida em Opus estéreo, 48 kHz, quadros de 20 ms. O arquivo é incorporado ao binário Go; o navegador não precisa ficar aberto para tocar a gravação. Nenhum webhook recebe teclas: elas são capturadas no RTP `telephone-event/8000` e deduplicadas por timestamp/evento conforme RFC 4733.

- 1: Financeiro; 2: Vendas; 3: Compras; 9: repetir a gravação.
- Os setores são mapeados pelo nome, independentemente da posição no app.
- Após escolher, chama apenas os membros disponíveis do setor com acesso ao número.
- Se o setor não tiver ninguém disponível, chama imediatamente os demais disponíveis com acesso ao número.
- Sem resposta no setor em 25 segundos, amplia o toque. Recusar fecha o aviso daquele atendente e não derruba a ligação do cliente.
- Sem escolha em 45 segundos, encaminha aos disponíveis. A tecla 9 renova esse prazo, sem ultrapassar o limite total de espera.
- Sem atendimento por 120 segundos desde o aceite pela URA, encerra para evitar uma chamada abandonada indefinidamente.
- O atendente se conecta à perna Meta já aceita; não existe segundo aceite ou renegociação do SDP. O fluxo anterior permanece nos números com URA desativada.

O atendimento automático envia `pre_accept`, aguarda ICE estável e envia `accept` com o mesmo SDP. Só após a confirmação do aceite inicia o silêncio, confirma DTLS e toca o menu. O gateway não escreve RTP enquanto o peer ainda está conectando, para não bloquear as consultas de estado. Após a escolha 1, 2 ou 3, toca uma vez `audio/aguarde.ogg` enquanto notifica o setor; ao conectar um atendente, interrompe a gravação.

Configuração e fase da URA ficam no PostgreSQL. Somente uma sessão assinada de diretoria do ambiente `production` pode alterar a configuração central. O ambiente local não substitui essa configuração e continua sujeito à posse exclusiva da API. Se a API reiniciar, chamadas aceitas e ainda aguardando são recuperadas para a fila geral; se o gateway também reiniciou e perdeu a mídia, são encerradas. Chamadas que ainda não haviam sido aceitas não são ressuscitadas.

## Instalação

Os dois repositórios devem conter esta implementação antes dos comandos abaixo. Faça a atualização sem ligações em andamento. Não modifique `.env`, tokens, Nginx, WABA ou dados de setores existentes. O gateway já precisa estar habilitado como no fluxo de chamadas atual.

Na API, aplique a migration aditiva e gere o cliente Prisma. Depois compile um novo binário, substituindo o anterior somente se os testes e o build passarem:

```bash
cd /opt/norte-sul-whatsapp-api
npx --no-install prisma migrate deploy &&
npx --no-install prisma generate &&
cd media-gateway &&
go test ./... &&
go build -trimpath -o bin/norte-sul-whatsapp-media.new . &&
mv bin/norte-sul-whatsapp-media.new bin/norte-sul-whatsapp-media &&
systemctl restart norte-sul-whatsapp-media &&
pm2 restart norte-sul-whatsapp
```

Confira os dois processos antes de ativar:

```bash
curl --retry 10 --retry-connrefused --retry-delay 2 --max-time 5 http://127.0.0.1:3025/health
curl --retry 10 --retry-connrefused --retry-delay 2 --max-time 5 http://127.0.0.1:3010/health
```

Após atualizar o app em `/var/www/fila-conferencia`, reinicie `fila-conferencia` e atualize o navegador com Ctrl+F5. Na configuração de chamadas, selecione o número, confira os setores Financeiro/Vendas/Compras, marque **Ativar URA** e salve. A gravação não é ativada automaticamente; salvar só permite habilitação quando a API consegue verificar que o gateway tem suporte à URA. As permissões de acesso ao número continuam valendo, além da participação no setor.

## Validação real

Teste 1/2/3, 9, opção inválida, ausência de seleção, setor offline, atendente ocupado, recusa e timeout. Confirme que os outros setores não tocam antes do fallback e que todos param ao alguém atender. Confirme áudio nos dois sentidos, encerramento pelo cliente durante o menu e coexistência de teste/produção. A falha de mídia Meta observada antes desta implementação não é considerada resolvida apenas pela implementação da URA: confirme ICE/DTLS e áudio na chamada real antes de manter o número habilitado.

Os testes locais usam serviços externos simulados e não fazem ligações reais. Para diagnosticar a chamada manual, consulte os eventos `call_ivr_start_failed`, `call_ivr_tick_failed` e o journal do gateway sem expor credenciais.

Fonte do transporte de teclas: [RFC 4733](https://www.rfc-editor.org/rfc/rfc4733).
