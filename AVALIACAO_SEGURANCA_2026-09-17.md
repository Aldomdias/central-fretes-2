# Avaliação de segurança — Central de Fretes

Data: 17/09/2026. Escopo: código atual do workspace, dependências npm e metadados/permissões do projeto Supabase Central de Fretes, identificado pela URL configurada no projeto. Foram usados apenas consultas de leitura e Security Advisors. Não foram consultados valores de senhas, executadas alterações de dados, migrations ou testes destrutivos.

## Resultado

Risco crítico. A autenticação e as permissões de páginas no navegador não constituem uma barreira efetiva para os dados. O banco permite acesso anônimo a tabelas de usuários e pagamentos. A adequação deve começar pela autenticação real e autorização no banco, em uma implantação coordenada.

## Achados e correções

| Prioridade | Evidência | Impacto | Correção necessária |
|---|---|---|---|
| P0 — crítico | `usuarios_central_all`: ALL para anon/authenticated, USING true e WITH CHECK true; anon tem SELECT/INSERT/UPDATE/DELETE. Teste em transação READ ONLY com SET LOCAL ROLE anon confirmou existência de registros legíveis. | Leitura e alteração de contas, perfis e credenciais sem identidade autenticada. Escrita não foi exercitada; permissão confirmada no catálogo. | Migrar credenciais para Supabase Auth; vincular perfil a auth.users.id; remover acesso anônimo e impedir que usuários alterem o próprio perfil/permissões. |
| P0 — crítico | `src/services/usuariosSupabaseService.js:4` seleciona senha junto com todos os usuários; `src/utils/authLocal.js:211` salva a lista no localStorage; login compara senha diretamente. Coluna senha é text no banco. | O desenho armazena/transmite senhas em texto puro, inclusive no navegador antes do login. Valores reais não foram lidos nesta avaliação. | Eliminar leitura/escrita de senha no cadastro, forçar redefinição por fluxo seguro e depois remover a coluna e caches legados. Apenas colocar hash nessa tabela mantendo a comparação no cliente não resolve. |
| P0 — crítico | `financeiro_pagamentos`: ALL para anon/authenticated com condições true; teste de leitura como anon confirmou registros legíveis. | Dados financeiros acessíveis sem login; políticas e grants também autorizam alteração/exclusão. | RLS por função e operação; consulta, lançamento, aprovação e pagamento com permissões separadas e identidade derivada da sessão. |
| P0 — crítico | `src/utils/authLocal.js:380`: sessão local criada antes de signInWithPassword e erros do Auth não bloqueiam entrada. `:453` restaura sessão pela base local. Há conta administrativa com senha fixa no seed (`:145`). | Entrada sem autenticação válida, possível falsificação de sessão/perfil no navegador e retorno à base local quando a consulta remota falha. | Supabase Auth como fonte única da identidade; falha de autenticação bloqueia entrada; remover seed administrativo de produção e fallback local de autenticação. |
| P0 — crítico | `auditoria_cte_portal_tokens_all` e `auditoria_cte_portal_respostas_all`: ALL para public com condições true e grants de CRUD para anon. | Segredo do link do portal pode ser enumerado; respostas e associação a processos podem ser adulteradas. | Retirar acesso direto anônimo às tabelas; endpoint restrito valida hash do token, validade, revogação, transportadora/processo e CT-e. Não retornar outros tokens nem permitir alterar status de validação interna. |
| P1 — alto | Advisors identificaram 2 tabelas públicas sem RLS: simulacao_realizado_mensal e canal_transportadora_parametrizacoes. Das 99 tabelas public, 97 têm RLS habilitada; várias das verificadas usam condições true. | Ter RLS habilitada não garante autorização; acesso depende também de grants e políticas reais. | Inventariar todas as tabelas; revogar grants desnecessários e criar políticas específicas para SELECT/INSERT/UPDATE/DELETE. Evitar permissões globais para authenticated. |
| P1 — alto | 28 funções SECURITY DEFINER executáveis por anon e também por authenticated segundo Advisors. Exemplos incluem funções de consulta, processamento e truncar_realizado_ctes_import_tmp. | Funções privilegiadas podem contornar RLS; risco concreto depende das validações de cada corpo. Nenhuma função mutante foi executada. | Revisar corpo e EXECUTE de cada RPC; remover acesso anônimo; preferir SECURITY INVOKER e verificar auth.uid()/permissões em operações sensíveis. |
| P1 — alto | 5 views comuns sem security_invoker; 1 view materializada selecionável por anon/authenticated. | Consultas podem expor dados que as políticas das tabelas pretendem restringir. | Avaliar security_invoker=true nas views e restringir grants; tratar materializada separadamente, pois não herda proteção por linha das tabelas de origem. |
| P1 — alto | npm audit: 9 pacotes sinalizados, sendo 6 altos, 2 moderados e 1 baixo; xlsx 0.18.5 possui avisos de prototype pollution e ReDoS e não tem correção disponível pelo fluxo padrão do npm audit. | Planilhas não confiáveis atingem o parser no navegador; outros avisos afetam principalmente ferramentas de desenvolvimento/build. A contagem não representa 9 explorações comprovadas da aplicação. | Atualizar/substituir parser conforme distribuição oficial e testar importações reais; impor limites de bytes/linhas/tempo. Atualizar Vite e dependências de build com compatibilidade verificada; não usar audit fix --force sem revisão. |
| P2 — médio | Advisors: 72 funções sem search_path fixo, 2 extensões em public. | Configuração inadequada amplia risco em funções privilegiadas e dificulta isolamento. | Fixar search_path com referências qualificadas; avaliar mover extensões após mapear dependências. |
| P2 — médio | Sessão local dura 24h; expiração em App.jsx limpa sessão local, mas não chama sairSupabaseAuth como o botão de logout. | Ciclos de vida das duas sessões podem divergir. | Unificar sessão e logout com Auth; tratar desativação, revogação, expiração e troca de senha no fluxo autorizado. |

## Diferenças entre código e banco

A migration `20260902131033_controle_admin_finalizar_tarefas_pesadas.sql` autoriza RPC administrativa por ID/e-mail enviados pelo cliente e concede EXECUTE a anon. Isso não comprova quem está fazendo a chamada. As duas funções administrativas dessa migration não foram encontradas no banco consultado; portanto este é um problema do código a corrigir antes de aplicar a migration, não uma RPC ativa confirmada.

O catálogo de produtos já está presente no banco e suas políticas atuais usam true para todas as operações. Revisar grants e exigir permissões de cadastro, incluindo estoque e centros de distribuição.

## Sequência recomendada

1. **Contenção urgente:** validar backup e restauração, inventariar consumidores da API e restringir temporariamente a exposição dos endpoints afetados. Restringir apenas a página da hospedagem não protege a API do Supabase. Não deixar os dados abertos enquanto se trabalha na migração. A retirada imediata de anon pode interromper o login legado e precisa de tratamento operacional explícito.
2. **Identidade:** migrar para Supabase Auth por convite/redefinição de senha, sem transportar senhas legadas; remover fallback e seed; alinhar Minha Senha e Gestão de Usuários ao Auth. Habilitar MFA para administradores e financeiro; verificar regras de senha, proteção contra tentativas repetidas e criação de contas.
3. **Autorização:** matriz de acesso por perfil, módulo, operação e carteira/transportadora quando aplicável. Perfis administrados em tabela protegida ou app_metadata, nunca user_metadata editável. Criar grants e RLS juntamente com revisão de RPCs/views. A interface apenas reflete essas regras.
4. **Portal e integridade financeira:** validação de token em endpoint restrito, expiração/revogação e limites de chamadas; operações sensíveis em transações com validação de estado e trilha de auditoria protegida contra edição por usuários comuns.
5. **Dependências e operação:** parser de planilhas corrigido, atualização de ferramentas, limites de importação e RPCs pesadas, cabeçalhos HTTP/CSP ajustados aos recursos usados, alertas de acesso e procedimento de resposta a incidentes.
6. **Dados e privacidade:** mapear dados pessoais/bancários, retenção e exclusão, exportações, backups e caches locais. Definir quem pode acessar e por quanto tempo. Uma avaliação técnica não atesta conformidade jurídica com a LGPD.

## Critérios de aceite

- Sem sessão: sem acesso a usuários, pagamentos, tokens internos e dados operacionais privados via API, views ou RPCs.
- Usuário de consulta não escreve; auditor não executa operações financeiras; usuário comum não altera perfil, permissões ou identidade da trilha de auditoria.
- Nenhuma senha legada no payload, bundle ou localStorage; conta administrativa sem credencial fixa.
- Alterar localStorage ou parâmetros ID/e-mail não concede acesso no banco.
- Links do portal não permitem enumerar outros processos/transportadoras; token expirado/revogado é negado.
- Logout, desativação, troca de senha e expiração têm comportamento verificado; considerar validade restante de JWTs na revogação.
- Testes positivos e negativos de RLS por operação e perfil; regressão dos fluxos de importação, auditoria, negociação e financeiro em homologação antes da implantação.
- Advisors e npm audit reexecutados; riscos remanescentes documentados, com responsável e prazo.

## Limites e pontos ainda não validados

Não houve pentest HTTP completo, tentativa de escrita, acesso a valores de credenciais ou auditoria do histórico Git. Não foi verificado o estado atual dos cabeçalhos da hospedagem, configuração de MFA/rate limits do Auth, backup/PITR ou logs históricos. Não há buckets de Storage no projeto consultado. A integração com o segundo projeto Supabase (`centralSolicitacoesService.js`) também requer avaliação própria. A `.env` está versionada; a configuração usa nome de chave pública e não foi confirmado segredo privilegiado exposto. Auditar histórico e artefatos antes de decidir rotações. Há backups e dist no repositório; avaliar confidencialidade e acesso ao repositório sem assumir exposição pública.

O acesso como anon foi confirmado por impersonação do papel no banco, não por requisição HTTP externa. As permissões e políticas indicam risco de exposição pela Data API; revisar também schemas expostos e configurações efetivas da API.

## Referências

- [Supabase — RLS, grants, views e testes](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase — segurança da API](https://supabase.com/docs/guides/api/securing-your-api)
- [Aviso de prototype pollution no SheetJS](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)
- [Aviso de ReDoS no SheetJS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)

As configurações do banco foram verificadas diretamente em 17/09/2026. O relatório não altera a plataforma nem representa certificação de segurança.
