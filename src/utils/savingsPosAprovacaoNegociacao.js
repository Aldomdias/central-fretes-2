import { classificarCteNaGrade } from './paretoReajuste.js';
import { GRADE_FRETE_PADRAO } from './gradeFreteConfig.js';

// AMBOS = uma tabela/CT-e que atende B2C e Atacado ao mesmo tempo, então entra na
// comparação dos dois canais. Fora isso, B2C e Atacado são mercados de preço
// diferentes e não podem ser misturados na mesma rota+faixa.
function categoriaCanalSaving(canal = '') {
  const value = String(canal || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  if (!value) return '';
  if (value.includes('AMBOS') || value.includes('TODOS')) return 'AMBOS';
  if (value.includes('B2C') || value.includes('ECOMMERCE') || value.includes('E-COMMERCE') || value.includes('MARKET')) return 'B2C';
  return 'ATACADO';
}

function canalCompativelSaving(canalRow = '', canalAlvo = '') {
  if (!canalAlvo) return true;
  const categoriaRow = categoriaCanalSaving(canalRow);
  const categoriaAlvo = categoriaCanalSaving(canalAlvo);
  if (!categoriaRow) return false;
  return categoriaRow === categoriaAlvo || categoriaRow === 'AMBOS';
}

export const MESES_BASE_SAVING_PADRAO = 3;

function isoDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^20\d{2}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function dateFromIso(value) {
  const iso = isoDate(value);
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function addDaysIso(value, days) {
  const date = dateFromIso(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return toIsoDate(date);
}

function addMonthsIso(value, months) {
  const date = dateFromIso(value);
  if (!date) return '';
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toIsoDate(date);
}

// Janela "base" (histórico, antes da aprovação) e janela "atual" (da aprovação até hoje),
// mesma lógica temporal do Reajuste (calcularJanelaItem em reajustesLocal.js), mas aqui
// aplicada por rota+faixa de peso em vez de só por transportadora.
export function calcularJanelasSaving(dataAprovacao, mesesBase = MESES_BASE_SAVING_PADRAO) {
  const aprovacao = isoDate(dataAprovacao);
  if (!aprovacao) return null;
  const hoje = toIsoDate(new Date());
  return {
    inicioBase: addMonthsIso(aprovacao, -Math.max(1, Number(mesesBase) || MESES_BASE_SAVING_PADRAO)),
    fimBase: addDaysIso(aprovacao, -1),
    inicioAtual: aprovacao,
    fimAtual: hoje >= aprovacao ? hoje : aprovacao,
  };
}

function tituloCase(valor = '') {
  return String(valor || '').trim().toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// Rota por cidade (não só UF): mais precisa pra comparar preço de mercado, já que
// cidades diferentes do mesmo estado podem ter frete bem diferente. Cai pra UF
// quando a cidade não está preenchida no CT-e.
export function rotuloRota(row = {}) {
  const cidadeOrigem = tituloCase(row.cidadeOrigem || row.cidade_origem || '');
  const cidadeDestino = tituloCase(row.cidadeDestino || row.cidade_destino || '');
  const ufOrigem = String(row.ufOrigem || row.uf_origem || '').trim().toUpperCase();
  const ufDestino = String(row.ufDestino || row.uf_destino || '').trim().toUpperCase();
  const origem = cidadeOrigem ? `${cidadeOrigem}${ufOrigem ? '/' + ufOrigem : ''}` : ufOrigem;
  const destino = cidadeDestino ? `${cidadeDestino}${ufDestino ? '/' + ufDestino : ''}` : ufDestino;
  if (!origem && !destino) return 'Sem rota';
  return `${origem || '?'} → ${destino || '?'}`;
}

function numero(valor) {
  return Number(valor || 0) || 0;
}

// Agrupa linhas RAW de realizado (CT-e a CT-e) por rota (UF origem-destino) + faixa de peso
// da grade de frete, somando frete/NF/peso/CT-es de cada grupo.
export function agruparRealizadoPorRotaFaixa(rows = [], { grade = GRADE_FRETE_PADRAO, canalPadrao = '' } = {}) {
  const mapa = new Map();
  (rows || []).forEach((row) => {
    if (!canalCompativelSaving(row.canal, canalPadrao)) return;
    const rota = rotuloRota(row);
    const faixa = classificarCteNaGrade(
      { peso: row.peso ?? row.pesoDeclarado ?? row.pesoCubado, canal: row.canal, valorNF: row.valorNF },
      grade,
      canalPadrao
    ).peso;
    const chave = `${rota}||${faixa}`;
    const atual = mapa.get(chave) || { rota, faixa, ctes: 0, valorCte: 0, valorNF: 0, peso: 0 };
    atual.ctes += 1;
    atual.valorCte += numero(row.valorCte);
    atual.valorNF += numero(row.valorNF);
    atual.peso += numero(row.peso ?? row.pesoDeclarado ?? row.pesoCubado);
    mapa.set(chave, atual);
  });
  return mapa;
}

// Compara os grupos rota+faixa da janela "base" (histórico) com os da janela "atual",
// calculando o percentual de frete/NF de cada janela, a variação e o saving (diferença
// de percentual x valor de NF atual). Só considera rota+faixa presentes na janela atual
// (é lá que o saving se realiza) e que também têm histórico base pra comparar.
export function calcularSavingPorRotaFaixa(linhasBase = [], linhasAtual = [], opcoes = {}) {
  const gruposBase = agruparRealizadoPorRotaFaixa(linhasBase, opcoes);
  const gruposAtual = agruparRealizadoPorRotaFaixa(linhasAtual, opcoes);

  const linhas = [];
  gruposAtual.forEach((atual, chave) => {
    const base = gruposBase.get(chave);
    if (!base || base.valorNF <= 0 || atual.valorNF <= 0) return;
    const pctBase = base.valorCte / base.valorNF;
    const pctAtual = atual.valorCte / atual.valorNF;
    const diffPct = pctBase - pctAtual;
    const saving = diffPct * atual.valorNF;
    linhas.push({
      rota: atual.rota,
      faixa: atual.faixa,
      ctesBase: base.ctes,
      ctesAtual: atual.ctes,
      valorNFAtual: atual.valorNF,
      valorCteBase: base.valorCte,
      valorCteAtual: atual.valorCte,
      pctBase,
      pctAtual,
      diffPct,
      saving,
    });
  });

  linhas.sort((a, b) => b.saving - a.saving);

  const totais = linhas.reduce((acc, item) => {
    acc.saving += item.saving;
    acc.valorNFAtual += item.valorNFAtual;
    acc.valorCteBase += item.valorCteBase;
    acc.valorCteAtual += item.valorCteAtual;
    return acc;
  }, { saving: 0, valorNFAtual: 0, valorCteBase: 0, valorCteAtual: 0 });
  const somaNfBaseComparavel = linhas.reduce((acc, item) => acc + (item.pctBase ? item.valorNFAtual : 0), 0);
  totais.pctBaseMedio = somaNfBaseComparavel > 0
    ? linhas.reduce((acc, item) => acc + item.pctBase * item.valorNFAtual, 0) / somaNfBaseComparavel
    : 0;
  totais.pctAtualMedio = totais.valorNFAtual > 0 ? totais.valorCteAtual / totais.valorNFAtual : 0;

  return { linhas, totais };
}

function chaveFluxoLotacao(row = {}) {
  const limpar = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  return [limpar(row.origem), limpar(row.destino), limpar(row.tipoVeiculo || row.tipo_veiculo || 'GERAL')].join('|');
}

function valorRealizadoLotacao(row = {}) {
  return numero(row.valorComparacao ?? row.valor_comparacao ?? row.freteTransp ?? row.frete_transp ?? row.freteCantu ?? row.frete_cantu);
}

// Em lotação cada registro é uma viagem/DIST. A referência é o custo médio
// histórico de todas as transportadoras no mesmo fluxo e tipo de veículo.
export function calcularSavingLotacaoPorFluxo(cargasBase = [], cargasAtual = []) {
  const agrupar = (rows) => {
    const mapa = new Map();
    (rows || []).forEach((row) => {
      const valor = valorRealizadoLotacao(row);
      if (!(valor > 0)) return;
      const chave = chaveFluxoLotacao(row);
      const atual = mapa.get(chave) || {
        rota: `${row.origem || '?'} → ${row.destino || '?'}`,
        faixa: row.tipoVeiculo || row.tipo_veiculo || 'Geral', viagens: 0, valor: 0,
      };
      atual.viagens += 1;
      atual.valor += valor;
      mapa.set(chave, atual);
    });
    return mapa;
  };
  const base = agrupar(cargasBase);
  const atual = agrupar(cargasAtual);
  const linhas = [];
  atual.forEach((fluxoAtual, chave) => {
    const fluxoBase = base.get(chave);
    if (!fluxoBase?.viagens || !fluxoAtual.viagens) return;
    const mediaBase = fluxoBase.valor / fluxoBase.viagens;
    const mediaAtual = fluxoAtual.valor / fluxoAtual.viagens;
    linhas.push({
      rota: fluxoAtual.rota, faixa: fluxoAtual.faixa,
      ctesBase: fluxoBase.viagens, ctesAtual: fluxoAtual.viagens,
      valorNFAtual: fluxoAtual.valor, valorCteBase: fluxoBase.valor, valorCteAtual: fluxoAtual.valor,
      pctBase: mediaBase, pctAtual: mediaAtual, diffPct: mediaBase - mediaAtual,
      saving: (mediaBase - mediaAtual) * fluxoAtual.viagens, unidade: 'VIAGEM',
    });
  });
  linhas.sort((a, b) => b.saving - a.saving);
  const totais = linhas.reduce((acc, linha) => {
    acc.saving += linha.saving;
    acc.valorNFAtual += linha.valorNFAtual;
    acc.valorCteBase += linha.valorCteBase;
    acc.valorCteAtual += linha.valorCteAtual;
    acc.viagensAtual += linha.ctesAtual;
    acc.viagensBase += linha.ctesBase;
    return acc;
  }, { saving: 0, valorNFAtual: 0, valorCteBase: 0, valorCteAtual: 0, viagensAtual: 0, viagensBase: 0 });
  totais.pctBaseMedio = totais.viagensBase ? totais.valorCteBase / totais.viagensBase : 0;
  totais.pctAtualMedio = totais.viagensAtual ? totais.valorCteAtual / totais.viagensAtual : 0;
  return { linhas, totais, tipoCalculo: 'LOTACAO_FLUXO' };
}
