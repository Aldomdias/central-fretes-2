#!/usr/bin/env node
/**
 * Prompt 4.14 — Corrigir pedidos/volumes salvos na negociação
 *
 * Problema confirmado:
 * - Na tela de Tabelas em Negociação, os cards de Pedidos/Volumes continuam iguais entre rodadas.
 * - Isso acontece porque o salvamento da simulação grava pedidos_dia e volumes_dia a partir da base total analisada.
 * - A tela depois lê esses indicadores salvos e mostra o total, não somente o que a tabela ganhou/capturou.
 *
 * Regra correta:
 * - Indicadores principais da negociação = somente CT-es/volumes ganhos pela tabela.
 * - Base total continua salva no resumo como contexto, mas não deve alimentar os cards principais.
 */

const fs = require('fs');
const path = require('path');

const arquivo = path.join(process.cwd(), 'src/services/tabelasNegociacaoService.js');
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

const helper = `
function calcularIndicadoresGanhasResultado(resultado = {}) {
  const detalhes = Array.isArray(resultado.ctesDetalhes) ? resultado.ctesDetalhes : [];
  const ganhas = detalhes.filter((item) => item && (
    item.statusSelecionada === 'Ganharia' ||
    item.ganhouRealizado === true ||
    numero(item.savingSelecionada || 0) > 0
  ));

  const meses = Math.max(1, numero(resultado.meses || 1));
  const soma = (lista, campo) => lista.reduce((acc, item) => acc + numero(item?.[campo] || 0), 0);

  const ctesGanhas = ganhas.length || inteiro(resultado.ctesGanhariaSelecionada || resultado.ctesCapturadosDeOutras || 0);
  const volumesGanhas = ganhas.length
    ? soma(ganhas, 'volumes')
    : numero(resultado.volumesCapturados || 0);
  const pesoGanhas = ganhas.length ? soma(ganhas, 'peso') : numero(resultado.pesoCapturado || 0);
  const valorNFGanhas = ganhas.length ? soma(ganhas, 'valorNF') : numero(resultado.valorNFCapturado || 0);

  const pedidosMes = meses ? ctesGanhas / meses : ctesGanhas;
  const volumesMes = meses ? volumesGanhas / meses : volumesGanhas;

  return {
    ctesGanhas,
    volumesGanhas,
    pesoGanhas,
    valorNFGanhas,
    pedidosMes,
    pedidosDia: pedidosMes / 22,
    volumesMes,
    volumesDia: volumesMes / 22,
  };
}
`;

if (!src.includes('function calcularIndicadoresGanhasResultado(resultado = {})')) {
  substituir(
`function calcularDivergenciaBase(atual = {}, inicial = {}) {
  if (!inicial || !Object.keys(inicial).length) return null;

  const difCtes = inteiro(atual.ctes_na_malha) - inteiro(inicial.ctes_na_malha);
  const difFrete = numero(atual.frete_realizado) - numero(inicial.frete_realizado);
  const difNf = numero(atual.valor_nf) - numero(inicial.valor_nf);
  const divergiu = Math.abs(difCtes) > 0 || Math.abs(difFrete) > 0.01 || Math.abs(difNf) > 0.01;

  return {
    divergiu,
    dif_ctes: difCtes,
    dif_frete_realizado: difFrete,
    dif_valor_nf: difNf,
    base_inicial_ctes: inteiro(inicial.ctes_na_malha),
    base_atual_ctes: inteiro(atual.ctes_na_malha),
    base_inicial_frete: numero(inicial.frete_realizado),
    base_atual_frete: numero(atual.frete_realizado),
  };
}
`,
`function calcularDivergenciaBase(atual = {}, inicial = {}) {
  if (!inicial || !Object.keys(inicial).length) return null;

  const difCtes = inteiro(atual.ctes_na_malha) - inteiro(inicial.ctes_na_malha);
  const difFrete = numero(atual.frete_realizado) - numero(inicial.frete_realizado);
  const difNf = numero(atual.valor_nf) - numero(inicial.valor_nf);
  const divergiu = Math.abs(difCtes) > 0 || Math.abs(difFrete) > 0.01 || Math.abs(difNf) > 0.01;

  return {
    divergiu,
    dif_ctes: difCtes,
    dif_frete_realizado: difFrete,
    dif_valor_nf: difNf,
    base_inicial_ctes: inteiro(inicial.ctes_na_malha),
    base_atual_ctes: inteiro(atual.ctes_na_malha),
    base_inicial_frete: numero(inicial.frete_realizado),
    base_atual_frete: numero(atual.frete_realizado),
  };
}
${helper}
`,
    'adiciona helper para indicadores ganhos no service'
  );
} else {
  console.log('SKIP helper de indicadores ganhos no service já aplicado');
}

substituir(
`  const naoCalculadosPorMotivo = Array.isArray(resultado.naoCalculadosPorMotivo)
    ? resultado.naoCalculadosPorMotivo
    : [];
  const deveGravarBaseInicial = !baseInicialExistente;`,
`  const naoCalculadosPorMotivo = Array.isArray(resultado.naoCalculadosPorMotivo)
    ? resultado.naoCalculadosPorMotivo
    : [];
  const indicadoresGanhas = calcularIndicadoresGanhasResultado(resultado);
  const deveGravarBaseInicial = !baseInicialExistente;`,
  'calcula indicadores ganhos antes de salvar'
);

substituir(
`      pedidos_dia: numero(resultado.volumetria_dia ?? resultado.cargasDia ?? 0),
      volumes_dia: numero(resultado.volumesDia ?? 0),`,
`      pedidos_dia: numero(indicadoresGanhas.pedidosDia || resultado.volumetria_dia || resultado.cargasDia || 0),
      pedidos_ganhos_dia: numero(indicadoresGanhas.pedidosDia || 0),
      pedidos_ganhos_mes: numero(indicadoresGanhas.pedidosMes || 0),
      volumes_dia: numero(indicadoresGanhas.volumesDia || resultado.volumesDia || 0),
      volumes_ganhos_dia: numero(indicadoresGanhas.volumesDia || 0),
      volumes_ganhos_mes: numero(indicadoresGanhas.volumesMes || 0),
      volumes_capturados: numero(indicadoresGanhas.volumesGanhas || 0),`,
  'salva pedidos/volumes ganhos nos indicadores da rodada'
);

substituir(
`      ctes_capturados: inteiro(resultado.ctesCapturadosDeOutras ?? 0),`,
`      ctes_capturados: inteiro(indicadoresGanhas.ctesGanhas || resultado.ctesCapturadosDeOutras || 0),`,
  'salva CT-es capturados como CT-es ganhos'
);

substituir(
`      resultado.volumetria_dia ??
      resultado.cargasDia ??
      0`,
`      indicadoresGanhas.pedidosDia ??
      resultado.volumetria_dia ??
      resultado.cargasDia ??
      0`,
  'top-level volumetria_dia passa a usar pedidos ganhos'
);

if (alterou) {
  fs.writeFileSync(arquivo, src, 'utf8');
  console.log('\nPrompt 4.14 aplicado em tabelasNegociacaoService.js.');
} else {
  console.log('\nPrompt 4.14 já estava aplicado ou não encontrou trechos-alvo.');
}
