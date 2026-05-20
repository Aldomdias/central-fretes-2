Pacote: Tabelas em Negociação V2

Arquivos alterados:
- src/pages/TabelasNegociacaoPage.jsx
- src/pages/ImportacaoPage.jsx
- src/services/tabelasNegociacaoService.js

Principais melhorias:
1) Negociações agrupadas visualmente por transportadora/canal/tipo.
2) Criação de várias origens na mesma transportadora usando o campo Origem(s), separado por ponto e vírgula. Ex.: Itajaí/SC; Joinville/SC.
3) Botão Nova origem para criar outra origem dentro da mesma transportadora.
4) Botão Nova rodada para abrir nova rodada da origem selecionada.
5) Importação passa a mostrar origem e rodada no seletor de negociação.
6) Ao salvar resultado da simulação, a negociação sai automaticamente da simulação (incluir_simulacao = false).
7) Aprovação permite promover automaticamente a tabela aprovada para o cadastro oficial de transportadoras, origens, rotas, cotações e taxas.

Aplicação:
unzip -o fix-tabelas-negociacao-v2-completo.zip
npm run build

git restore dist && git clean -fd dist/assets
git add src/pages/TabelasNegociacaoPage.jsx src/pages/ImportacaoPage.jsx src/services/tabelasNegociacaoService.js
git commit -m "feat: estruturar rodadas e origens em negociacao"
git push origin main

Build testado com sucesso neste pacote.
