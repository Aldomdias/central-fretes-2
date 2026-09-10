# Integração via API — Fluxo de Cargas (Central Fretes)

Documento de integração para o RPA (ou sistema de origem das cargas) enviar e
consultar dados do fluxo de cargas diretamente na Central Fretes, substituindo
o processo manual atual (planilha → MDlog).

Este contrato segue o mesmo padrão do mapeamento tentado anteriormente com a
Hubylog, adaptado para o endpoint hospedado pela Central Fretes.

---

## 1. Base da integração

| Item | Valor |
|---|---|
| URL base | `https://central-fretes-2.vercel.app/api/fluxo-cargas` |
| Autenticação | Header `x-api-key` |
| Chave de API | `ae11e08026eba9acd4a34c2efe345454fb6ee54a9a714ce7` *(gerada agora — trocar antes de produção se preferirem outra)* |
| Formato | JSON (`Content-Type: application/json`) |
| Chave de correlação do processo | `tipo` + `numero_id` (identifica o mesmo processo em todas as fases) |

> Se no futuro for configurado um domínio próprio (ex.: `amdlog.com.br`) apontando
> para este mesmo projeto Vercel, basta trocar a URL base — o restante do
> contrato não muda.

---

## 2. Enviar dados (RPA → Central Fretes)

```
PUT /api/fluxo-cargas
x-api-key: <chave>
Content-Type: application/json
```

Pode ser chamado quantas vezes forem necessárias para o mesmo processo — cada
chamada atualiza (upsert) só os campos enviados, sem apagar os demais. Isso
permite mandar os dados fase a fase, conforme forem ficando disponíveis.

### Campos sempre obrigatórios

| Campo | Tipo | Descrição |
|---|---|---|
| `tipo` | string | Tipo do processo (ex.: `DIST`) |
| `numero_id` | string | Identificador único do processo/carga |

### Campos por fase (todos opcionais, envie o que tiver disponível no momento)

**Fase 1 — Geração da carga**
`solicitante`, `origem`, `cod_filial`, `categoria`, `cubagem`,
`data_coleta_solicitada`, `peso_total`, `valor_total_aproximado`, `destinos` (lista)

**Fase 2 — Cotação**
`subcontratacao`, `previsao_coleta`, `transportadora`, `bp`, `frete_cantu`,
`frete_transportadora`

**Fase 3 — Caminhão designado**
`nome_motorista`, `telefone_motorista`, `placa_cavalo`, `placa_carreta`,
`placa_carreta_extra`, `tipo_veiculo`

**Fase 4 — Chegada na origem**
`chegada_fornecedor`

**Fase 5 — Operação / doca**
`inicio_operacao`, `fim_operacao`, `doca`, `porcentagem_separacao`

**Fase 6 — Anexo de faturamento**
`numeracao_lacre`, `data_anexo_faturamento`, `info_faturamento` (objeto)

**Fase 7 — Liberação do caminhão**
`info_liberacao` (objeto)

**Fase 8 — Chegada na filial**
`chegada_caminhao_filial`

**Fase 9 — Descarga no destino**
`descarga_filial`

**Fase 10 — Comprovante de entrega**
`anexo_comprovante` (objeto)

> Qualquer campo enviado fora dessa lista é aceito e guardado (não é rejeitado),
> mas fica separado como dado complementar até ser formalmente mapeado.

### Exemplo de chamada (Fase 1)

```json
PUT /api/fluxo-cargas
{
  "tipo": "DIST",
  "numero_id": "TESTEDIST0009",
  "solicitante": "hendrix.santos@parceirocantu.com.br",
  "origem": "ITAJAI",
  "cod_filial": "4201",
  "destinos": ["SANTOS"],
  "categoria": "CARGA",
  "cubagem": 120,
  "peso_total": 5850,
  "data_coleta_solicitada": "2026-03-07"
}
```

### Resposta de sucesso

```json
{
  "succeeded": true,
  "data": "5e2257f9-7a83-48aa-99a6-7d4fa3e111f7",
  "error": null
}
```

### Resposta de erro

```json
{
  "succeeded": false,
  "error": "descrição do problema"
}
```

| Código HTTP | Situação |
|---|---|
| 200 | Gravado com sucesso |
| 400 | Faltou `tipo` ou `numero_id` |
| 401 | `x-api-key` ausente ou inválida |
| 500 | Erro interno |

---

## 3. Consultar um processo (Central Fretes → RPA/MDlog)

```
GET /api/fluxo-cargas?tipo=DIST&numero_id=TESTEDIST0009
x-api-key: <chave>
```

Retorna o estado atual e completo do processo, com todos os campos já
recebidos até o momento (de todas as fases enviadas).

### Resposta de sucesso

```json
{
  "succeeded": true,
  "data": {
    "id": "...",
    "tipo": "DIST",
    "numero_id": "TESTEDIST0009",
    "origem": "ITAJAI",
    "destinos": ["SANTOS"],
    "transportadora": null,
    "...": "demais campos já recebidos"
  },
  "error": null
}
```

### Resposta quando o processo não existe

```json
{ "succeeded": false, "error": "Processo não encontrado." }
```
(HTTP 404)

---

## 4. Diferenças observadas no teste realizado (TESTEDIST0009)

O teste enviado usou alguns nomes de campo fora do padrão acima
(`destino` no singular em vez de `destinos`, `data_coleta_solicitada_1`,
e campos extras como `qtd_sku`, `qtd_pneu`, `status_geral`, `prioridade`,
`data_modificacao`, `data_geracao`). O endpoint aceita e guarda esses campos
extras sem erro, mas recomendamos ajustar o script para os nomes oficiais
acima antes de ir para produção, para que a informação fique disponível nos
campos corretos do sistema.

---

## 5. Pendências antes de ativar em produção

- [ ] Confirmar domínio de produção definitivo
- [ ] Confirmar/gerar a chave de API final
- [ ] Ajustar o script do RPA para os nomes de campo oficiais (seção 4)
