# Matriz de repaginação AMD Log

Atualizada em 25/11/2026. Esta matriz acompanha a branch local `repaginacao-amd-log`.

## Legenda

- **Visual**: tela aberta no navegador na largura indicada, sem erro de página e sem rolagem horizontal global.
- **Build**: rota inventariada, coberta pelo shell responsivo e compilada, mas ainda sem inspeção visual individual.
- Tabelas densas preservam seus dados e usam rolagem horizontal dentro do próprio painel.

## Inventário e cobertura

| Grupo | Tela/rota | Ação principal | Risco no celular | Ajuste aplicado | Validação |
|---|---|---|---|---|---|
| Início | Minha Área de Trabalho (`dashboard`) | Abrir e personalizar atalhos | Dashboard fixo e extenso | Blocos por permissão, 3 modelos, fixar/remover/reordenar, persistência por usuário | Visual 390/1440 |
| Início | Conceito visual (`conceito-app`) | Consultar referência visual | Conteúdo demonstrativo largo | Shell, tema e contenção global | Build |
| Simulação | Simulador (`simulador`) | Simular e comparar fretes | Formulários e comparações densas | Formulários em coluna; tabelas contidas | Build |
| Simulação | Simulador Reversa (`simulador-reversa`) | Simular logística reversa | Grade e resultados largos | Shell e contenção global | Build |
| Simulação | Catálogo de produtos (`produtos-catalogo`) | Manter produtos | Tabela de cadastro | Tabela contida e controles de toque | Build |
| Simulação | Negociações (`tabelas-negociacao`) | Comparar propostas e laudos | Editor e tabelas muito largos | Página sem overflow global; tabelas internas roláveis | Visual 390 |
| Simulação | Reajustes (`reajustes`) | Analisar impacto | Gráficos e tabelas densas | Shell e contenção global | Build |
| Simulação | Perda no Realizado (`perda-realizado`) | Simular realizado | Filtros e resultados extensos | Grade de filtros em coluna; resultados contidos | Build |
| Simulação | Oportunidade por origem (`oportunidade-origem`) | Analisar origens | Tabela analítica | Contenção global | Build |
| Simulação | Oportunidade por transportadora (`oportunidade-transportadora`) | Analisar transportadoras | Tabela analítica | Contenção global | Build |
| Simulação | Saída de transportadora (`simular-saida-transportadora`) | Simular retirada | Formulário e tabela | Grade em coluna e tabela contida | Build |
| Simulação | Tabela padrão B2C (`tabela-padrao-b2c`) | Manter tabela | Edição tabular | Tabela contida | Build |
| Simulação | Gestão de contratos (`gestao-contratos`) | Acompanhar contratos | Tabela mínima de 1280 px | Rolagem interna já existente, shell responsivo | Build |
| Operação | Tracking (`tracking`) | Acompanhar entregas | Filtros e tabela | Shell e filtros responsivos | Visual 390 |
| Operação | Consulta Tracking (`consulta-tracking`) | Pesquisar entrega | Detalhes extensos | Formulário em coluna e contenção | Build |
| Operação | Acompanhar entregas (`tracking-prazos`) | Gerir prazos | Painel analítico | Shell responsivo | Build |
| Operação | Torre de controle (`torre-controle`) | Monitorar operação | KPIs e tabela | Breakpoints existentes + shell | Build |
| Operação | Painel operação (`painel-operacao`) | Tratar cargas | Cards e ações densas | Shell e controles de toque | Build |
| Operação | Lotação tabelas (`lotacao`) | Manter tabelas | Editor tabular | Contenção global | Build |
| Operação | Cotação lotação (`lotacao-cotacao`) | Cotar carga | Formulário largo | Formulário em coluna | Build |
| Operação | Lotação operação (`lotacao-operacao`) | Executar jornada | Ações em linha | Shell e controles de toque | Build |
| Operação | Autorizações B2C (`autorizacoes-transporte-b2c`) | Decidir autorização | Tabela e modal | Tabela/modal contidos | Build |
| Operação | Autorizações Atacado (`autorizacoes-transporte-atacado`) | Decidir autorização | Tabela e modal | Tabela/modal contidos | Build |
| Operação | Autorizações Lotação (`autorizacoes-transporte-lotacao`) | Decidir autorização | Tabela e modal | Tabela/modal contidos | Build |
| Operação | Autorizações Suprimentos (`autorizacoes-suprimentos`) | Decidir proposta | Tabela e modal | Tabela/modal contidos | Build |
| Auditoria | CT-e (`cte`) | Lançar/consultar CT-e | Formulário e listagem | Atalho direto na home; página sem overflow global | Visual 390 |
| Auditoria | CT-e origem/destino (`cte-origem-destino`) | Conferir municípios | Tabela larga | Contenção global | Build |
| Auditoria | Diagnóstico CT-e (`auditoria-cte`) | Recalcular e diagnosticar | Muitos filtros e detalhes | Shell, filtros em coluna, tabelas contidas | Build |
| Auditoria | Alerta de valor (`alertas-cte-valor`) | Tratar alertas | Tabela | Contenção global | Build |
| Auditoria | E-commerce (`auditoria-ecommerce`) | Auditar divergências | Comparação densa | Tabelas contidas | Build |
| Auditoria | Lotação (`lotacao-auditoria`) | Auditar viagens | Tabela e detalhes | Contenção global | Build |
| Auditoria | Painel auditoria (`painel-auditoria`) | Acompanhar produtividade | KPIs e tabelas | Shell responsivo | Build |
| Auditoria | Faturas (`faturas`) | Auditar carteira | Filtros, tabela e milhares de linhas | Sem overflow global; tabela preservada no painel | Visual 390 |
| Auditoria | Gestão auditoria (`gestao-auditoria-fretes`) | Gerir carteira e SLA | Dashboard denso | Shell, grades e tabelas contidas | Build |
| Auditoria | Central financeira (`financeiro-auditoria`) | Acompanhar SAP/financeiro | Tabela e modais | Contenção global | Build |
| Auditoria | Tratativas (`tratativas`) | Registrar tratativas | Tabela/formulário | Formulário em coluna | Build |
| Auditoria | Base CT-e (`gestao-base-cte`) | Gerir base | Tabela e importação | Contenção global | Build |
| Auditoria | Prazos (`avaliacao-prazos`) | Avaliar SLA | Gráficos e tabela | Shell responsivo | Build |
| Auditoria | Prazo pagamento (`prazo-pagamento`) | Analisar pagamento | Tabela | Contenção global | Build |
| Financeiro | Importar descontos (`importar-descontos-obtidos`) | Importar planilha | Dropzone e resultado | Controles de toque | Build |
| Financeiro | Central de controle (`painel-descontos-obtidos`) | Acompanhar descontos | Dashboard e tabela | Shell responsivo | Build |
| Automação | Robôs (`robos`) | Executar/acompanhar robôs | Cards e históricos | Shell responsivo | Build |
| Cadastros | Importação (`importacao`) | Importar bases | Formulários e status | Formulários em coluna | Build |
| Cadastros | Formatação de tabelas (`formatacao`) | Preparar tabela | Editor largo | Contenção global | Build |
| Cadastros | Importar template (`importar-template`) | Importar tabela | Formulário e prévia | Formulário em coluna | Build |
| Cadastros | Importação IA (`importacao-ia-tabelas`) | Interpretar tabela | Prévia tabular | Contenção global | Build |
| Cadastros | Consulta IBGE (`consulta-ibge`) | Pesquisar município | Formulário | Shell responsivo | Build |
| Cadastros | Matriz ICMS (`icms-uf`) | Manter matriz | Matriz larga | Contenção global | Build |
| Cadastros | Transportadoras (`transportadoras`) | Manter origens/rotas | Editor e abas densas | Shell, formulários e tabelas contidas | Build |
| Administração | Usuários (`usuarios`) | Gerir perfis e permissões | Formulário/tabela | Formulário em coluna | Build |
| Administração | Usuários ativos (`usuarios-ativos`) | Ver sessões | Tabela | Contenção global | Build |
| Geral | Ferramentas (`ferramentas`) | Executar utilitários | Cards variados | Shell responsivo | Build |
| Conta | Alterar senha (`minha-senha`) | Atualizar credencial | Formulário | Uma coluna no celular | Build |

## Preferências e acessibilidade

| Item | Resultado |
|---|---|
| Identidades AMD/Cantu | Seletor funcional e persistente; AMD usa ativo oficial existente. Cantu usa wordmark textual por falta de ativo oficial no repositório. |
| Claro/escuro/automático | Preferência independente da identidade, aplicada por variáveis compartilhadas. |
| Preferência por usuário | Persistência local usa ID/e-mail da sessão, seguindo o mecanismo local já adotado pelo projeto. |
| Permissões | Menu e blocos filtram com `usuarioTemAcesso`; atalhos sem permissão não são renderizados. |
| Menu compacto | Ícones têm título/rótulo acessível; rota atual permanece destacada. |
| Menu móvel | Drawer recolhível, backdrop e fechamento automático após navegação. |
| Reordenação | Botões nativos de subir/descer funcionam por toque e teclado; IDs estáveis preservam ordem. |

## Verificações executadas

| Verificação | Resultado |
|---|---|
| `npm run build` | Passou; avisos preexistentes de chunks acima de 500 kB e imports mistos. |
| Navegador desktop (1440 px) | Home renderizada, personalização e navegação disponíveis, sem overlay de erro. |
| Navegador celular (390 × 844) | Home, CT-e, faturas e negociações sem overflow horizontal global. |
| Identidade/tema | AMD → Cantu e automático → escuro aplicados no DOM e persistidos. |
| Menu móvel | Abre, permite navegar e fecha após seleção. |
| Testes (`npm test`) | Linha de base já falha: imports ESM sem extensão, `vitest` ausente e testes funcionais antigos. Não causado pela repaginação. |
| Auditoria de dependências | 16 vulnerabilidades preexistentes (2 baixas, 6 moderadas, 8 altas); nenhuma atualização forçada foi aplicada. |

## Pendências antes da publicação

1. Receber o ativo oficial da identidade Cantu para substituir o wordmark textual.
2. Fazer inspeção visual individual das rotas ainda marcadas como **Build**, com perfis representativos.
3. Exercitar gravações apenas com dados explicitamente autorizados para teste.
4. Corrigir ou aceitar formalmente as falhas preexistentes da suíte de testes.
5. Obter aprovação explícita do Aldo; até lá não fazer push, PR, preview hospedado, deploy ou migração remota.
