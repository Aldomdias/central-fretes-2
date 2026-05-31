# Correção 4.16AF

Arquivos corrigidos:
- src/pages/TabelasNegociacaoPage.jsx
- src/services/tabelasNegociacaoService.js

O que foi ajustado:
1. O botão agora apaga a análise da rodada sem apagar a importação real da tabela.
2. Ao salvar uma simulação, o sistema substitui a simulação anterior da mesma rodada e remove só marcador vazio de abertura/nova rodada.
3. Importações reais com rotas/fretes são preservadas no histórico.
4. Laudos continuam salvos em resumo_simulacao.laudos/laudosEmail e também no resumo da rodada quando vierem do simulador.
5. Incluído script opcional para restaurar o histórico da BRASIL WEB B2C ITAJAÍ/SC a partir do backup local.

Como aplicar:
1. Copie os arquivos src/pages/TabelasNegociacaoPage.jsx e src/services/tabelasNegociacaoService.js para o projeto.
2. Rode:
   npm.cmd run build
   git restore dist
   git clean -fd dist
   npm.cmd run dev

Se a importação/histórico da BRASIL WEB B2C ITAJAÍ/SC já foi apagada do Supabase:
1. Confirme que os backups estão na pasta backups/
2. Rode:
   node scripts/416af-restaurar-historico-brasilweb-b2c-itajai.mjs

Depois teste:
- Abrir Tabelas em Negociação
- Abrir BRASIL WEB B2C ITAJAÍ/SC
- Aba Rodadas
- O histórico deve manter a importação real da tabela
- O botão "Apagar análise" deve remover simulação/marcador da rodada, preservando importação real
- Ao simular e salvar novamente, deve aparecer nova simulação no histórico
