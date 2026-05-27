const patches = [
  'implementar-fluxo-pesquisar-ctes-realizado.cjs',
  'corrigir-feedback-calculo-origem-e-volumes-realizado.cjs',
  'corrigir-indicadores-ganhos-negociacao.cjs',
  'corrigir-volumes-pedidos-ganhos-service.cjs',
  'excluir-rodada-negociacao.cjs',
  'criar-laudo-geral-rodadas-negociacao.cjs',
  'ajustar-laudo-rodadas-visoes-analiticas.cjs',
  'ajustar-laudo-rodadas-faixas-individuais.cjs',
  'salvar-faixas-b2c-na-rodada.cjs',
  'laudo-usar-faixas-b2c-salvas.cjs',
  'recalcular-realizado-mesma-base.cjs',
  'ajustar-laudo-faixas-por-grade-canal.cjs',
  'ajustar-laudo-cotacao-faixa-colunas.cjs',
  '416k-pareto-cidades-volume.cjs',
  'fix-cotacao-comercial-laudo.cjs',
  '416w-rota-comercial-dados.cjs',
  '416x-salvar-detalhes-laudo.cjs',
  '416z1-calculo-nome-cotacao.cjs',
  '416z2-simulador-nome-rota.cjs',
  '416z3-service-ctes-detalhes.cjs',
  '416z4-utils-pareto-faixas.cjs',
  '416z5-template-secoes-laudo.cjs',
];

for (const patch of patches) {
  console.log('\n>> Rodando patch:', patch);
  require('./' + patch);
}
