# Regras do motor de calculo de frete

Estas regras foram validadas para o Simulador do Realizado e tabelas em negociacao.

## Calculo percentual

Calcular e comparar:

1. `peso considerado x kg garantia`;
2. `valor da NF x frete percentual`;
3. `frete minimo`.

O maior valor e a base do frete. Depois sao adicionados GRIS, Ad Valorem,
pedagio, TDA, TDR, TRT, SUFRAMA e outras taxas. O ICMS, quando aplicavel,
e calculado por dentro ao final.

Na importacao percentual, o campo `excesso_kg` representa o valor do
`kg garantia`.

## Calculo por faixa de peso

A base e:

`valor da faixa + percentual da NF + valor excedente`

O valor excedente e:

`peso excedente x valor por kg excedente`

Depois sao adicionadas as demais taxas e o ICMS.

## Taxas por destino

As taxas sao buscadas pelo IBGE exato do destino. TDA, TDR, TRT, SUFRAMA
e outras taxas sao somadas. GRIS e Ad Valorem especificos do destino
prevalecem sobre as generalidades.

## Cubagem do Tracking

O campo `CUBAGEM/M3` dos CSVs de Tracking representa a cubagem total do CT-e.
Ele nao deve ser multiplicado novamente pela quantidade de volumes.

O peso considerado e o maior entre peso fisico e cubagem total multiplicada
pelo fator de cubagem da tabela. O vinculo deve ocorrer pela chave exata do CT-e.
