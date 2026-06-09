import { GRADE_FRETE_PADRAO, normalizarCanalGrade, normalizarGradeFrete, numeroGradeFrete } from './gradeFreteConfig.js';

function numero(valor) {
  return Number(valor || 0) || 0;
}

function linhasValidas(grade = [], campo = 'peso') {
  return (Array.isArray(grade) ? grade : [])
    .map((item) => numeroGradeFrete(item?.[campo]))
    .filter((valor) => valor > 0)
    .sort((a, b) => a - b);
}

function rotuloFaixa(valor, limites = [], unidade = '') {
  if (!limites.length || valor <= 0) return 'Sem faixa';
  const temFaixaAberta = limites[limites.length - 1] >= 999999;
  const limitesReais = temFaixaAberta ? limites.slice(0, -1) : limites;
  if (!limitesReais.length) return 'Sem faixa';
  const ultimoLimite = limitesReais[limitesReais.length - 1];
  const sufixo = unidade ? ` ${unidade}` : '';
  if (temFaixaAberta && valor > ultimoLimite) {
    return `Acima de ${ultimoLimite.toLocaleString('pt-BR')}${sufixo}`;
  }
  const limite = limitesReais.find((item) => valor <= item) || ultimoLimite;
  const indice = limitesReais.indexOf(limite);
  const anterior = indice > 0 ? limitesReais[indice - 1] : 0;
  if (!temFaixaAberta && indice === limitesReais.length - 1 && valor > limite) {
    return `Acima de ${limite.toLocaleString('pt-BR')}${sufixo}`;
  }
  return `${anterior.toLocaleString('pt-BR')} a ${limite.toLocaleString('pt-BR')}${sufixo}`;
}

export function classificarCteNaGrade(item = {}, gradeInformada = GRADE_FRETE_PADRAO, canalPadrao = '') {
  const grade = normalizarGradeFrete(gradeInformada || GRADE_FRETE_PADRAO);
  const canal = normalizarCanalGrade(item.canal || canalPadrao);
  const gradeCanal = grade[canal] || grade.ATACADO || [];
  const peso = numero(item.peso);
  const valorNF = numero(item.valorNF);
  const cubagem = numero(item.cubagem);

  return {
    canal,
    peso: rotuloFaixa(peso, linhasValidas(gradeCanal, 'peso'), 'kg'),
    valorNF: rotuloFaixa(valorNF, linhasValidas(gradeCanal, 'valorNF'), 'R$'),
    cubagem: rotuloFaixa(cubagem, linhasValidas(gradeCanal, 'cubagem'), 'm³'),
  };
}

function agregarDimensao(classificados = [], dimensao = 'peso') {
  const mapa = new Map();
  classificados.forEach(({ item, faixas }) => {
    const faixa = faixas[dimensao] || 'Sem faixa';
    const chave = `${faixas.canal}|${faixa}`;
    const atual = mapa.get(chave) || {
      chave,
      canal: faixas.canal,
      faixa,
      ctes: 0,
      volumes: 0,
      valorNF: 0,
      freteAtual: 0,
      freteNovo: 0,
    };
    atual.ctes += 1;
    atual.volumes += numero(item.volumes);
    atual.valorNF += numero(item.valorNF);
    atual.freteAtual += numero(item.freteRealizado);
    atual.freteNovo += numero(item.freteSelecionada);
    mapa.set(chave, atual);
  });

  const lista = [...mapa.values()].sort((a, b) => b.ctes - a.ctes || b.volumes - a.volumes);
  const total = lista.reduce((acc, item) => acc + item.ctes, 0);
  let acumulado = 0;
  return lista.map((item) => {
    const antes = acumulado;
    acumulado += item.ctes;
    return {
      ...item,
      impacto: item.freteNovo - item.freteAtual,
      percentual: total ? (item.ctes / total) * 100 : 0,
      percentualAcumulado: total ? (acumulado / total) * 100 : 0,
      pareto80: total ? (antes / total) * 100 < 80 : false,
    };
  });
}

export function montarParetoReajuste(ctes = [], grade = GRADE_FRETE_PADRAO, canalPadrao = '') {
  const individuais = (Array.isArray(ctes) ? ctes : [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      item,
      faixas: classificarCteNaGrade(item, grade, canalPadrao),
    }));

  return {
    criterio: 'CT-e individual classificado antes do agrupamento',
    totalCtes: individuais.length,
    peso: agregarDimensao(individuais, 'peso'),
    valorNF: agregarDimensao(individuais, 'valorNF'),
    cubagem: agregarDimensao(individuais, 'cubagem'),
  };
}
