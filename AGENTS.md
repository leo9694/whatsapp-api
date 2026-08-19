# AGENTS.md

Estas instruções se aplicam a todo o repositório.

## Princípios

- Priorize eficiência e baixo consumo de tokens sem sacrificar qualidade, correção ou segurança.
- Analise somente os arquivos relevantes para a tarefa atual.
- Não explore o repositório inteiro sem uma necessidade concreta.
- Evite reler arquivos já compreendidos, salvo quando uma mudança posterior exigir nova validação.
- Use buscas direcionadas por nomes, símbolos, rotas e mensagens de erro antes de abrir arquivos completos.

## Alterações

- Faça mudanças mínimas, objetivas e estritamente relacionadas ao pedido.
- Não realize refatorações, renomeações ou melhorias fora do escopo.
- Preserve alterações existentes do usuário e não inclua arquivos não relacionados em commits.
- Siga os padrões e a estrutura já adotados pelo projeto.
- Não altere integrações, configurações de produção ou contratos públicos sem autorização explícita.

## Investigação de bugs

- Para bugs simples, confirme a causa provável com a menor inspeção suficiente.
- Para bugs complexos, investigue o fluxo afetado e reúna evidências antes de editar o código.
- Corrija a causa raiz quando ela estiver dentro do escopo; evite contornos frágeis.
- Nunca reduza validações, autenticação, privacidade ou segurança apenas para economizar tempo ou tokens.

## Testes e validação

- Rode primeiro apenas os testes diretamente relacionados à alteração.
- Amplie para a suíte completa somente quando o risco, o alcance da mudança ou uma falha justificar.
- Use verificações proporcionais ao impacto e informe claramente testes não executados ou limitações encontradas.
- Não declare sucesso sem evidência adequada.

## Comunicação

- Mantenha atualizações objetivas e evite repetir informações.
- Nas respostas finais, seja curto e destaque: resultado, arquivos alterados, testes executados e qualquer ação necessária do usuário.
- Inclua detalhes adicionais somente quando forem importantes para entendimento, segurança ou tomada de decisão.
