# Melhorias pendentes

## Segurança da plataforma

Registrado em 17/09/2026 por solicitação do usuário. Status: pendente de implementação, para executar assim que possível. Este registro não agenda nem inicia implantação.

Objetivo: proteger os dados das empresas com autenticação confiável, autorização efetiva, isolamento de dados, rastreabilidade e recuperação.

Avaliação e evidências: [Relatório de segurança de 17/09/2026](AVALIACAO_SEGURANCA_2026-09-17.md).

### Prioridade imediata — falhas críticas

- [ ] Preparar contenção do acesso anônimo às tabelas de usuários, pagamentos e tokens/respostas do portal, considerando os consumidores da API e o login legado.
- [ ] Concluir migração para Supabase Auth como fonte única da identidade; bloquear login quando a autenticação falhar.
- [ ] Remover senhas em texto puro do cadastro, payloads e armazenamento do navegador; realizar redefinição segura de credenciais legadas.
- [ ] Remover conta administrativa com senha fixa e fallback de autenticação local em produção.
- [ ] Aplicar grants e políticas RLS por perfil e operação; impedir alteração indevida de perfis e permissões.
- [ ] Proteger o portal de transportadoras com validação restrita de token, validade, revogação e vínculo ao processo/transportadora.

### Prioridade alta — proteção estrutural

- [ ] Revisar tabelas sem RLS, políticas permissivas, views e funções RPC privilegiadas; restringir execução anônima.
- [ ] Definir matriz de permissões de consulta, edição, aprovação e operações financeiras.
- [ ] Exigir MFA para administradores e acessos financeiros sensíveis; verificar proteção contra tentativas repetidas de login.
- [ ] Se houver múltiplas empresas na mesma plataforma, implementar e testar isolamento por empresa no banco, arquivos e operações da API.
- [ ] Atualizar ou substituir o parser xlsx vulnerável e atualizar dependências de desenvolvimento/build com validação de compatibilidade.
- [ ] Unificar expiração, logout, desativação de usuários e revogação de sessões com a autenticação real.

### Operação e manutenção contínua

- [ ] Proteger a trilha de auditoria contra alteração por usuários comuns e registrar identidade derivada da sessão.
- [ ] Validar backups e executar teste de restauração; definir objetivos de recuperação.
- [ ] Configurar monitoramento, alertas e procedimento de resposta a incidentes.
- [ ] Revisar cabeçalhos HTTP/CSP, limites de importação, chamadas de API e processamentos pesados.
- [ ] Mapear dados pessoais/bancários, retenção, exportações, caches locais e acesso a backups/repositório.
- [ ] Avaliar a segurança do segundo projeto Supabase usado pela integração de solicitações.
- [ ] Incorporar revisões periódicas de dependências, Advisors e permissões.

### Sequência para colocar em funcionamento

1. Validar recuperação e preparar homologação e plano de contenção.
2. Implementar autenticação e autorização em conjunto, com migração de usuários e compatibilidade dos fluxos existentes.
3. Corrigir portal, RPCs/views e dependências.
4. Testar acessos permitidos e negados por perfil, operação e empresa; validar importação, negociação, auditoria e financeiro.
5. Implantar de forma coordenada e acompanhar erros e tentativas de acesso.

Critérios de conclusão: sem acesso anônimo a dados privados; sem senhas legadas no navegador; manipulação de localStorage não concede acesso; separação de permissões efetiva no banco; recuperação testada; riscos remanescentes documentados. Consultar o relatório para os critérios detalhados e limitações da avaliação.
