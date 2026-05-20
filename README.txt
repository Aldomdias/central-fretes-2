Ajuste completo do Simulador Realizado:

1) Opções avançadas recolhidas/expansíveis.
2) UF destino no realizado passa a listar apenas UFs cobertas pela transportadora/tabela selecionada quando possível.
3) Quando não comparar com concorrentes, o quadro mostra apenas Vencedor vs Realizado e Perdedor/Acima do Realizado.
4) Novo painel principal: Resultado da negociação — somente CT-es/rotas que a tabela ganha.
   - aderência
   - faturamento período/mês/12 meses
   - saving período/mês/12 meses
   - % NF antes e % NF tabela
   - cargas/dia e cargas/mês
   - volumes/dia e volumes/mês
   - cubagem/dia e cubagem/mês
5) Visão geral do recorte ficou abaixo como apoio/contexto.
6) Proteção contra cubagem do Tracking fora do padrão:
   - se a cubagem vier muito acima do limite operacional estimado, ela é desconsiderada;
   - o cálculo passa a usar o peso real;
   - aparece alerta na tela e no detalhe do CT-e.

Arquivo alterado:
src/pages/SimuladorPage.jsx

Comandos:
unzip -o fix-simulador-visao-negociacao-cubagem.zip
npm run build
git restore dist && git clean -fd dist/assets
git add src/pages/SimuladorPage.jsx
git commit -m "feat: melhorar visao da negociacao e tratar cubagem outlier"
git push origin main

Build validado com sucesso.
