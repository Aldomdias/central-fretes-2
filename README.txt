Correção: excedente em faixa aberta

Substitui:
src/services/freteCalcEngine.js

Resolve casos onde a tabela importada trouxe o R$/kg excedente no campo excesso_kg e valor_excedente ficou zerado.
Exemplo:
Faixa 300.001 até 999999999
excesso_kg = 1,04
peso considerado = 1941 kg

Agora o sistema entende:
limite excedente = 300 kg
R$/kg excedente = 1,04
peso excedente = 1641 kg
