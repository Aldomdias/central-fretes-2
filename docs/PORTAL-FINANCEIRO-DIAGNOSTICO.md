# Portal Financeiro / Diagnóstico — regras, dependências e testes

Status: **implementado e testado só localmente** (worktree `.codex-build-portal-financeiro`). Nada publicado e nenhuma
migration aplicada no Supabase hospedado. Leitura de boletos: ver `PORTAL-FINANCEIRO-BOLETOS-PASTA.md`.

## O que comprova o quê
| Fato | Evidência exigida |
|---|---|
| Lançamento | `partida` ou `lancamento_financeiro` na fatura (documento 19… do SAP). Estorno sem relançamento **anula** o lançamento. |
| Encaminhamento ao financeiro | `encaminhado_financeiro_em` + `encaminhamento_tipo` (BOLETO_NA_PASTA / DADOS_BANCARIOS) + evidência (protocolo/anexos). |
| Programação | `data_previsao_pagamento` + `programacao_confirmada = true` (origem FINANCEIRO ou SAP_HANA). **Não é pagamento.** |
| Pagamento | partida **200…** válida, compensada (`Status comp. = 1`), sem estorno, ainda não usada por outra fatura → `pagamento_confirmado = true` + `pagamento_campos_vinculo`. Data prevista ou data de compensação isolada **não** comprovam. |
| Estorno | documento **17…** com vínculo explícito ao documento original (`Documento original`/`Documento estornado`/`Anula documento`) que exista entre os lançamentos 19… da mesma referência. Documento 17 isolado é só indício (`REVISAR_INDICIO`). |

## Estorno SAP (`avaliarEstornoSap` / `registrarEstornosSapFaturas`)
- Movimentos agrupados por referência **e raiz de CNPJ da linha do SAP = raiz do CNPJ da fatura** (obrigatório), candidata única.
- Tipos: 17… ESTORNO, 19… LANCAMENTO, demais OUTRO (compensação 200… nunca conta como relançamento).
- Relançamento = documento 19… válido, diferente do anulado, posterior ao estorno (pode ter outro número).
- Estornada sem relançamento: fora de em aberto, vencidas, a vencer, totais, laudo, fila de protocolo e exportações normais; só aparece no
  card **Estornadas no SAP**. O histórico (`sap_estornos_fatura`, `auditoria_fatura_historico`) é preservado.

## Conciliação de pagamentos SAP (`conciliarPagamentosSap`)
1. Busca exata pelo número (comportamento anterior, inalterado).
2. Só se falhar: busca flexível por referência — zeros à esquerda, sufixo de ano, e número mais curto (≥ 4 dígitos) contido como
   **sequência contínua** no mais longo, nos dois sentidos.
3. A flexível exige **todos**: referência, CNPJ/fornecedor, empresa (quando os dois lados informam), valor, moeda, vencimento e pagamento
   efetivo. Qualquer divergência → `DADOS_DIVERGENTES`; múltiplos candidatos nunca vinculam sozinhos.
4. Os campos que sustentaram o vínculo ficam em `campos_vinculo` → `faturas.pagamento_campos_vinculo` e aparecem como "Vínculo SAP ✓".
- Nome parecido não vincula. Valor e vencimento isolados não vinculam.

## Programação SAP/HANA
Botão **Importar programação SAP/HANA** (Diagnóstico → Previsão de pagamento). Planilha com colunas `Referência` (ou Fatura), `CNPJ`,
`Data programada` e, opcional, `Valor`. Casa **uma** fatura em aberto por referência + raiz do CNPJ (+ valor); sem CNPJ, ambíguo ou
divergente vai para revisão e não altera nada. Grava origem `SAP_HANA`, `programacao_confirmada = true`, preserva a data anterior em
`financeiro_previsao_historico`. A fatura continua em aberto até o pagamento efetivo.
**Dependência:** o layout real do relatório de programação do SAP/HANA não está no projeto; os nomes de coluna acima são os aceitos hoje.

## Auditoria na tabela do Diagnóstico
Coluna **Resultado da auditoria** (separada de "Auditados"): Não iniciada · Em conferência · Sem divergência · Com divergência ·
Divergência em tratativa · Divergência tratada. Mostra diferença (apurada), tooltip com cobrado/apurado/pendentes e motivo principal
(sem tabela, sem cálculo, N divergentes). Uma conferência concluída pode seguir com divergência em tratativa. Também sai na exportação.
Card **Pagas com desconto** (`PAGA_COM_DESCONTO` com partida/`pagamento_confirmado`).

## Protocolo por auditor
Cards Financeiro: Aguardam encaminhamento · Encaminhadas sem/com previsão · Programadas pelo Financeiro · Pagas — todos só para fatura **ativa e em aberto**
(Pagas inclui as pagas antigas com partida). **Exportar fila de protocolo**: ordenada por auditor → vencimento → número, com total por auditor,
sem pagas/estornadas/canceladas/duplicadas; sem partida da fatura exporta as partidas dos CT-es. Não existe outra planilha consolidada no projeto
para manter layout; o formato novo é independente.

## Migration pendente (aplicar manualmente após a revisão)
`supabase/migrations/20261118_002_portal_financeiro_diagnostico.sql` — colunas em `faturas` (encaminhamento, programação, pagamento, estorno SAP)
e tabelas `financeiro_previsao_historico`, `financeiro_encaminhamentos`, `sap_estornos_fatura`, `boleto_arquivo_versoes` (único por fatura+hash),
`boleto_pasta_leituras`. RLS ligado com a policy `central_fretes_access` para `anon, authenticated` (`using (true)`) — **mesmo modelo aberto das demais
tabelas do projeto**; o bloqueio de segurança real (anon aberto) é anterior a esta entrega e deve ser tratado à parte.
Tolerância: sem a migration, baixa SAP, protocolo, previsão e estorno continuam funcionando sem a evidência nova; "Encaminhar ao financeiro" em lote avisa que a migration falta.

## Testes (18/11/2026)
- Focados (domínio, diagnóstico, laudo, conciliação SAP, boletos): **46 passam**.
- Suíte completa `node --test test/*.test.js`: as falhas restantes já existem no `origin/main` (parser Verum, DOCCOB, laudo consolidado, arquivos
  `calculoFrete`, `freteCalcEngine`, `importadorTemplatePadrao*`, `realizadoLocalEngine`, `robosLancamento*`, `testeRapidoTransportadora`, vitest ausente).
- Build `vite build`: ok (avisos antigos de chunks grandes e chave duplicada em `SimuladorPage.jsx`).

## Ainda sem validação com dados reais
Layout real do export SAP (colunas de estorno, `Vencimento`, `Empresa`), layout do relatório de programação, pasta real de boletos, migration no banco,
evidências na tela com dados gravados.
