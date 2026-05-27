#!/usr/bin/env node
/**
 * Prompt 4.12 — Corrigir indicadores salvos da negociação para usar somente CT-es/volumes ganhos
 *
 * Problema identificado no teste:
 * - Na tela de Tabelas em Negociação, os cards de Pedidos e Volumes estavam usando a base total da rota/recorte.
 * - Por isso primeira e segunda rodada apareciam iguais nesses indicadores, mesmo quando a aderência/saving mudava.
 *
 * Regra correta:
 * - Na visão de negociação, Pedidos e Volumes devem representar somente o que a tabela ganharia/capturaria.
 * - A base total continua existindo como contexto do simulador, mas não deve alimentar os cards principais da negociação.
 */

const fs = require('fs');
const path = require('path');

const arquivo = path.join(process.cwd(), 'src/pages/TabelasNegociacaoPage.jsx');
let src = fs.readFileSync(arquivo, 'utf8');
let alterou = false;

function substituir(trecho, novo, descricao) {
  if (src.includes(trecho)) {
    src = src.replace(trecho, novo);
    alterou = true;
    console.log(`OK  ${descricao}`);
    return;
  }
  if (src.includes(novo)) {
    console.log(`SKIP ${descricao} já aplicado`);
    return;
  }
  console.warn(`WARN ${descricao} não encontrado`);
}

const helper = `function getIndicadoresGanhasTabela(resumo) {
  var detalhes = Array.isArray(resumo && resumo.ctesDetalhes) ? resumo.ctesDetalhes : [];
  var ganhas = detalhes.filter(function(item) {
    return item && (
      item.statusSelecionada === 'Ganharia' ||
      item.ganhouRealizado === true ||
      Number(item.savingSelecionada || 0) > 0
    );
  });

  var meses = Math.max(1, Number((resumo && resumo.meses) || 1));
  var soma = function(lista, campo) {
    return lista.reduce(function(acc, item) { return acc + Number((item && item[campo]) || 0); }, 0);
  };

  var ctesGanhas = ganhas.length || Number(
    (resumo && (resumo.ctesGanhariaSelecionada || resumo.ctesCapturadosDeOutras)) || 0
  );
  var volumesGanhas = ganhas.length
    ? soma(ganhas, 'volumes')
    : Number((resumo && resumo.volumesCapturados) || 0);

  var pedidosMes = meses ? ctesGanhas / meses : ctesGanhas;
  var volumesMes = meses ? volumesGanhas / meses : volumesGanhas;

  return {
    temGanhas: ctesGanhas > 0,
    ctesGanhas: ctesGanhas,
    volumesGanhas: volumesGanhas,
    pedidosMes: pedidosMes,
    pedidosDia: pedidosMes / 22,
    volumesMes: volumesMes,
    volumesDia: volumesMes / 22,
  };
}
`;

if (!src.includes('function getIndicadoresGanhasTabela(resumo)')) {
  substituir(
`function getRodadaAtualTabela(tabela) {
  var resumo = getResumoTabela(tabela);
  var hist = getHistoricoRodadasTabela(tabela);
  return Number(resumo.rodada_atual || (hist.length ? hist[hist.length - 1].rodada : 1) || 1);
}
`,
`function getRodadaAtualTabela(tabela) {
  var resumo = getResumoTabela(tabela);
  var hist = getHistoricoRodadasTabela(tabela);
  return Number(resumo.rodada_atual || (hist.length ? hist[hist.length - 1].rodada : 1) || 1);
}
${helper}
`,
    'adiciona helper de indicadores ganhos'
  );
} else {
  console.log('SKIP helper de indicadores ganhos já aplicado');
}

substituir(
`  var ultimaSim = resumo.ultima_simulacao && resumo.ultima_simulacao.indicadores ? resumo.ultima_simulacao.indicadores : {};
  var savingMes = Number(tabela.saving_projetado || ultimaSim.saving_mes || resumo.savingSelecionadaVsRealMes || resumo.savingSelecionadaVsReal || 0);
`,
`  var ultimaSim = resumo.ultima_simulacao && resumo.ultima_simulacao.indicadores ? resumo.ultima_simulacao.indicadores : {};
  var ganhos = getIndicadoresGanhasTabela(resumo);
  var savingMes = Number(tabela.saving_projetado || ultimaSim.saving_mes || resumo.savingSelecionadaVsRealMes || resumo.savingSelecionadaVsReal || 0);
`,
  'calcula indicadores ganhos dentro de getIndicadoresTabela'
);

substituir(
`  var pedidosDia = Number(tabela.volumetria_dia || ultimaSim.pedidos_dia || resumo.cargasDia || 0);
  var pedidosMes = pedidosDia * 22;
  var pedidosAno = pedidosMes * 12;
  var volumesDia = Number(ultimaSim.volumes_dia || resumo.volumesDia || 0);
  var volumesMes = volumesDia * 22;
  var volumesAno = volumesMes * 12;
`,
`  // Na tela de negociação, pedidos/volumes devem refletir somente as cargas ganhas/capturadas.
  // A base total do recorte continua no resumo do simulador, mas não deve alimentar os cards principais.
  var pedidosDia = Number(ultimaSim.pedidos_ganhos_dia || ganhos.pedidosDia || 0);
  if (!pedidosDia) pedidosDia = Number(tabela.volumetria_dia || ultimaSim.pedidos_dia || resumo.cargasDia || 0);
  var pedidosMes = Number(ultimaSim.pedidos_ganhos_mes || ganhos.pedidosMes || 0) || (pedidosDia * 22);
  var pedidosAno = pedidosMes * 12;
  var volumesDia = Number(ultimaSim.volumes_ganhos_dia || ganhos.volumesDia || 0);
  if (!volumesDia) volumesDia = Number(ultimaSim.volumes_dia || resumo.volumesDia || 0);
  var volumesMes = Number(ultimaSim.volumes_ganhos_mes || ganhos.volumesMes || 0) || (volumesDia * 22);
  var volumesAno = volumesMes * 12;
`,
  'usa pedidos e volumes ganhos nos cards da negociação'
);

substituir(
`    ctesCapturados: Number(ultimaSim.ctes_capturados || resumo.ctesCapturadosDeOutras || 0),
`,
`    ctesCapturados: Number(ultimaSim.ctes_capturados || ganhos.ctesGanhas || resumo.ctesCapturadosDeOutras || 0),
    volumesCapturados: Number(ultimaSim.volumes_capturados || ganhos.volumesGanhas || resumo.volumesCapturados || 0),
`,
  'expõe volumes capturados nos indicadores'
);

if (alterou) {
  fs.writeFileSync(arquivo, src, 'utf8');
  console.log('\nPrompt 4.12 aplicado em TabelasNegociacaoPage.jsx.');
} else {
  console.log('\nPrompt 4.12 já estava aplicado ou não encontrou trechos-alvo.');
}
