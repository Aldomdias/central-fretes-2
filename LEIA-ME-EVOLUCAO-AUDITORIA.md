# AMDLog — Evolução Módulos Auditoria
## Arquivos gerados — como aplicar no Codex

---

## ESTRUTURA DE ARQUIVOS

```
output/
├── supabase/migrations/
│   └── 20260524_001_audit_evolutions.sql   ← RODAR NO SUPABASE PRIMEIRO
├── src/
│   ├── App.jsx                              ← SUBSTITUIR
│   ├── components/
│   │   ├── Sidebar.jsx                      ← SUBSTITUIR
│   │   └── SlaAuditoriaConfig.jsx           ← NOVO
│   ├── pages/
│   │   ├── LotacaoAuditoriaPage.jsx         ← SUBSTITUIR (Fase 1)
│   │   ├── PainelAuditoriaPage.jsx          ← NOVO (Fase 2)
│   │   ├── PainelOperacaoPage.jsx           ← NOVO (Fase 2)
│   │   ├── FaturasPage.jsx                  ← NOVO (Fase 4)
│   │   └── TratativasPage.jsx               ← NOVO (Fase 9)
│   ├── services/
│   │   └── lotacaoSupabaseService.js        ← SUBSTITUIR (campos novos + funções)
│   └── utils/
│       └── authLocal.js                     ← SUBSTITUIR (novos perfis/páginas)
```

---

## PASSO 1 — Migration SQL no Supabase

Acesse o **SQL Editor** do seu projeto Supabase e execute:

```
supabase/migrations/20260524_001_audit_evolutions.sql
```

O que a migration cria:
- Colunas novas em `lotacao_lancamentos` (auditor, status auditoria, valores)
- Tabela `audit_pendencias` — excedentes enviados para operação
- Tabela `audit_historico_eventos` — timeline de aprovações
- Tabela `audit_solicitacoes_informacao` — CT-e/DIST não encontrado
- Tabela `audit_sla_config` — configurações de SLA/e-mail
- Tabela `faturas` — cabeçalho de faturas
- Tabela `fatura_detalhes` — CT-es de cada fatura
- Tabela `tratativas` + `tratativa_historico` — casos críticos
- Tabela `simulation_reports` — laudos do simulador
- Função `gerar_protocolo_tratativa()` para protocolo automático

---

## PASSO 2 — Substituir arquivos no projeto

Substitua (não renomeie) os arquivos conforme a estrutura acima.

> O arquivo `lotacaoSupabaseService_PATCH.js` é apenas referência — use o `lotacaoSupabaseService.js` completo.

---

## PASSO 3 — Integrar SlaAuditoriaConfig no FerramentasPage

Em `FerramentasPage.jsx`, adicione dentro de uma aba/seção para gestores:

```jsx
import SlaAuditoriaConfig from '../components/SlaAuditoriaConfig';

// Dentro do JSX, em seção visível apenas para GESTAO:
{sessao?.perfil === 'GESTAO' && (
  <SlaAuditoriaConfig canal="LOTACAO" />
)}
```

---

## PASSO 4 — Build e teste

```bash
npm run build
# ou
npm run dev
```

---

## O QUE FOI IMPLEMENTADO

### Fase 1 — Auditoria Lotação ✅
- Observação obrigatória quando valor lançado excede o saldo
- Botão bloqueado com mensagem clara: "Informe uma justificativa para enviar à operação"
- Campos gravados: `audited_by_user_id`, `audited_by_name`, `audited_by_email`, `audited_at`, `audit_status`, `audit_exceeded_amount`, `audit_allowed_amount`, `audit_entered_amount`
- Status diferenciado: `AUDITADO_OK` vs `EXCEDEU_AGUARDANDO_OPERACAO`
- Tabela de histórico mostra auditor e justificativa
- Pendência criada com dados do auditor para a operação ver

### Fase 2 — Painéis separados ✅
- **PainelAuditoriaPage**: cards de faturas pendentes, excedentes, SLA, alertas visuais 24h/48h, filtros por transportadora/auditor/carteira
- **PainelOperacaoPage**: cards de aprovação, valor pendente/aprovado/recusado, botão analisar/aprovar/recusar com modal, alerta SLA no topo

### Fase 3 — Configurações SLA/e-mails ✅
- **SlaAuditoriaConfig**: prazos configuráveis, listas de e-mail por nível, ativo/inativo, salvo no Supabase
- Funções `carregarSlaConfigSupabase` / `salvarSlaConfigSupabase` no service

### Fase 4 — Módulo Faturas ✅
- **FaturasPage**: importação de arquivo xlsx (abas Faturas + Detalhes)
- Cards: total faturas, valor, divergência, pendentes, vencidas
- Tabela com vencimento destacado em vermelho
- Detalhe por CT-e com divergências destacadas
- Funções: `carregarFaturasSupabase`, `salvarFaturaSupabase`, `salvarDetalhesFaturaSupabase`

### Fase 9 — Tratativas ✅
- **TratativasPage**: formulário, filtros, tabela com destaque de prazo vencido
- Protocolo automático via trigger SQL
- Histórico de eventos por tratativa
- Funções: `carregarTratativasSupabase`, `salvarTratativaSupabase`, `registrarHistoricoTratativaSupabase`

### Service atualizado ✅
- `lotacaoSupabaseService.js`: novos campos em lancamentoParaDb/dbParaLancamento
- Novas funções exportadas para todas as novas tabelas
- Suporte a: pendências, histórico, SLA config, solicitações de informação, faturas, tratativas, laudos simulador

### Permissões ✅
- `authLocal.js`: novos módulos adicionados a MODULOS_SISTEMA
- Perfil `AUDITORIA_LOTACAO` recebe: painel-auditoria, faturas, tratativas
- Perfil `OPERACAO_LOTACAO` recebe: painel-operacao, tratativas

---

## FASES PENDENTES (próximos entregáveis)

- **Fase 5** — Refazer fatura / nova versão / exportação DocCob
- **Fase 6** — Fluxo de solicitação de informação CT-e/DIST + vínculo manual assistido
- **Fase 7** — Módulo Custos Adicionais / Cotações
- **Fase 8** — Torre de Controle usando Supabase (atualmente usa trackingLocal)
- **Fase 10** — Laudo do transportador no Simulador Realizado

---

## CRITÉRIOS DE ACEITE ATENDIDOS

- [x] 1. Observação obrigatória em excedente na Auditoria Lotação
- [x] 2. Usuário auditor gravado no registro
- [x] 3. Operação vê quem auditou e a justificativa (PainelOperacaoPage + modal)
- [x] 4. Painéis separados para Auditoria e Operação
- [x] 5. Operação recebe/visualiza pendências com SLA
- [x] 6. Configuração em Ferramentas para prazos e e-mails (somente gestor)
- [ ] 7. Fluxo de solicitação de informação CT-e/DIST — Fase 6
- [ ] 8. Busca CT-e + vínculo manual — Fase 6
- [x] 9. Filtros por transportadora, auditor, status, vencimento no painel
- [x] 10. Módulo de Faturas baseado no layout Verum
- [x] 11. Importação do arquivo de faturas (cabeçalho + detalhes)
- [x] 12. Faturas vinculam CT-es por número fatura/série
- [ ] 13. Refazer fatura — Fase 5
- [ ] 14. Custos adicionais — Fase 7
- [ ] 15. Torre de Controle via Supabase — Fase 8
- [x] 16. Tratativas para casos críticos
- [ ] 17. Laudo do transportador no Simulador — Fase 10
- [ ] 18. Laudos salvos no Supabase — Fase 10
- [x] 19. Nada existente removido
- [ ] 20. Build — verificar após aplicar todos os arquivos
