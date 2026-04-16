import { calcularFreteFaixaPeso, calcularFretePercentual } from '../services/freteCalcEngine';

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  return Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0;
}

function norm(value) {
  return String(value || '').trim().toUpperCase();
}

function compact(value) {
  return String(value || '').replace(/\D/g, '');
}

function matchDestino(input, codigo) {
  if (!input) return true;
  const raw = compact(input);
  const target = compact(codigo);
  if (!raw || !target) return false;
  if (raw.length === 8) return target === raw.slice(0, 7);
  return target === raw;
}

function uniqueBy(list, keyFn) {
  const seen = new Set();
  return list.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extrairBaseReal(transportadoras = []) {
  const flat = [];

  (transportadoras || []).forEach((transportadora) => {
    (transportadora.origens || []).forEach((origem) => {
      const canal = norm(origem.canal || 'ATACADO');
      const rotas = (origem.rotas || []).filter((rota) => rota && rota.ibgeDestino);
      const cotacoes = origem.cotacoes || [];
      const taxasEspeciais = origem.taxasEspeciais || [];
      const generalidades = origem.generalidades || {};

      rotas.forEach((rota) => {
        flat.push({
          transportadoraId: transportadora.id,
          transportadora: transportadora.nome,
          origemId: origem.id,
          origemCidade: origem.cidade,
          origemIbge: rota.ibgeOrigem || '',
          canal,
          rota,
          cotacoes: cotacoes.filter((cotacao) => norm(cotacao.rota) === norm(rota.nomeRota)),
          cotacoesFallback: cotacoes,
          taxasEspeciais,
          generalidades,
        });
      });
    });
  });

  return flat;
}

function escolherCotacao({ item, peso }) {
  const lista = (item.cotacoes?.length ? item.cotacoes : item.cotacoesFallback || []).filter(Boolean);
  if (!lista.length) return null;
  const pesoNumero = toNumber(peso);

  const porFaixa = lista.find((cotacao) => {
    const min = toNumber(cotacao.pesoMin ?? cotacao.pesoInicial ?? 0);
    const maxBruto = cotacao.pesoMax ?? cotacao.pesoFinal ?? cotacao.pesoLimite ?? 999999999;
    const max = maxBruto === '' ? 999999999 : toNumber(maxBruto || 999999999);
    return pesoNumero >= min && pesoNumero <= (max || 999999999);
  });

  return porFaixa || lista[0];
}

function escolherTaxaDestino(item) {
  return (item.taxasEspeciais || []).find(
    (taxa) => compact(taxa.ibgeDestino) === compact(item.rota.ibgeDestino),
  ) || {};
}

function calcularItem(item, peso, valorNF) {
  const cotacao = escolherCotacao({ item, peso });
  if (!cotacao) return null;

  const taxaDestino = escolherTaxaDestino(item);
  const tipo = norm(item.generalidades?.tipoCalculo || 'PERCENTUAL');
  const calculator = tipo.includes('FAIXA') ? calcularFreteFaixaPeso : calcularFretePercentual;
  const calculo = calculator({
    rota: item.rota,
    cotacao,
    generalidades: item.generalidades,
    taxaDestino,
    pesoKg: peso,
    valorNf: valorNF,
  });

  const pesoNumero = toNumber(peso);
  const nfNumero = toNumber(valorNF);
  const pesoMin = toNumber(cotacao.pesoMin ?? cotacao.pesoInicial ?? 0);
  const pesoMax = toNumber(cotacao.pesoMax ?? cotacao.pesoFinal ?? cotacao.pesoLimite ?? 999999999);
  const percentual = toNumber(cotacao.percentual ?? cotacao.fretePercentual);
  const rsKg = toNumber(cotacao.rsKg);
  const valorFixo = toNumber(cotacao.valorFixo ?? cotacao.taxaAplicada);
  const excesso = toNumber(cotacao.excesso ?? cotacao.excessoPeso);
  const fretePeso = rsKg * pesoNumero;
  const fretePercentual = nfNumero * (percentual / 100);
  const freteBaseInformado = calculo.tipoCalculo === 'FAIXA_DE_PESO' ? valorFixo : Math.max(fretePeso, fretePercentual, valorFixo);

  return {
    transportadora: item.transportadora,
    transportadoraId: item.transportadoraId,
    origem: item.origemCidade,
    origemIbge: item.origemIbge,
    destinoCodigo: String(item.rota.ibgeDestino || ''),
    destino: String(item.rota.ibgeDestino || ''),
    prazo: toNumber(item.rota.prazoEntregaDias),
    canal: item.canal,
    rotaNome: item.rota.nomeRota || '',
    total: calculo.total,
    subtotal: calculo.subtotal,
    icms: calculo.icms,
    valorBase: calculo.valorBase,
    freteBaseInformado,
    pesoFaixaMin: pesoMin,
    pesoFaixaMax: pesoMax || 999999999,
    percentualAplicado: percentual,
    rsKgAplicado: rsKg,
    valorFixoAplicado: valorFixo,
    excessoKg: Math.max(0, pesoNumero - pesoMax),
    excessoValorKg: excesso,
    valorExcedente: calculo.valorExcedente || 0,
    valorNF: nfNumero,
    peso: pesoNumero,
    minimoRota: toNumber(item.rota.valorMinimoFrete),
    tipoCalculo: calculo.tipoCalculo,
    taxas: calculo.taxas,
    descricao: `Origem ${item.origemCidade} • Destino IBGE ${item.rota.ibgeDestino}`,
  };
}

function rankear(resultados = []) {
  const ordenados = [...resultados].sort((a, b) => a.total - b.total || a.prazo - b.prazo || a.transportadora.localeCompare(b.transportadora));
  const lider = ordenados[0]?.total ?? 0;
  const segundo = ordenados[1]?.total ?? lider;

  return ordenados.map((item, idx) => ({
    ...item,
    posicao: idx + 1,
    savingSegundo: idx === 0 ? Math.max(segundo - item.total, 0) : 0,
    diferencaLider: idx === 0 ? 0 : Math.max(item.total - lider, 0),
    reducaoNecessariaPct: idx === 0 || item.total <= 0 ? 0 : Math.max(((item.total - lider) / item.total) * 100, 0),
  }));
}

function calcularCenario(flatBase, { origem, canal, peso, valorNF, destinoCodigo }) {
  const candidatos = flatBase.filter((item) =>
    norm(item.canal) === norm(canal)
    && norm(item.origemCidade) === norm(origem)
    && matchDestino(destinoCodigo, item.rota.ibgeDestino),
  );

  return rankear(
    candidatos
      .map((item) => calcularItem(item, peso, valorNF))
      .filter(Boolean),
  );
}

export function simularSimples({ transportadoras, origem, canal, peso, valorNF, destinoCodigo }) {
  const flatBase = extrairBaseReal(transportadoras);
  return calcularCenario(flatBase, { origem, canal, peso, valorNF, destinoCodigo });
}

export function simularPorTransportadora({ transportadoras, nomeTransportadora, canal, origem, destinoCodigos, peso, valorNF }) {
  const flatBase = extrairBaseReal(transportadoras);
  const destinosFiltro = (destinoCodigos || []).map(compact).filter(Boolean);

  const cenarios = flatBase.filter((item) =>
    norm(item.transportadora) === norm(nomeTransportadora)
    && norm(item.canal) === norm(canal)
    && (!origem || norm(item.origemCidade) === norm(origem))
    && (!destinosFiltro.length || destinosFiltro.includes(compact(item.rota.ibgeDestino))),
  );

  return cenarios.map((cenario) => {
    const ranking = calcularCenario(flatBase, {
      origem: cenario.origemCidade,
      canal: cenario.canal,
      peso,
      valorNF,
      destinoCodigo: cenario.rota.ibgeDestino,
    });

    return ranking.find((item) => norm(item.transportadora) === norm(nomeTransportadora));
  }).filter(Boolean);
}

export function analisarTransportadoraPorGrade({ transportadoras, nomeTransportadora, canal, grade }) {
  const flatBase = extrairBaseReal(transportadoras);
  const cenariosTransportadora = uniqueBy(
    flatBase.filter((item) => norm(item.transportadora) === norm(nomeTransportadora) && norm(item.canal) === norm(canal)),
    (item) => `${norm(item.origemCidade)}|${compact(item.rota.ibgeDestino)}|${norm(item.canal)}`,
  );

  const linhas = [];

  cenariosTransportadora.forEach((cenario) => {
    (grade || []).forEach((parametro) => {
      const ranking = calcularCenario(flatBase, {
        origem: cenario.origemCidade,
        canal,
        peso: parametro.peso,
        valorNF: parametro.valorNF,
        destinoCodigo: cenario.rota.ibgeDestino,
      });

      const linha = ranking.find((item) => norm(item.transportadora) === norm(nomeTransportadora));
      if (linha) {
        linhas.push({
          ...linha,
          peso: toNumber(parametro.peso),
          valorNF: toNumber(parametro.valorNF),
        });
      }
    });
  });

  const rotasAvaliadas = linhas.length;
  const vitorias = linhas.filter((item) => item.posicao === 1).length;
  const aderencia = rotasAvaliadas ? (vitorias / rotasAvaliadas) * 100 : 0;
  const saving = linhas.filter((item) => item.posicao === 1).reduce((acc, item) => acc + (item.savingSegundo || 0), 0);

  return { rotasAvaliadas, vitorias, aderencia, saving, linhas };
}

export function analisarCoberturaTabela({ transportadoras, canal, origem, transportadora }) {
  const flatBase = extrairBaseReal(transportadoras).filter((item) => norm(item.canal) === norm(canal));
  const universo = flatBase.filter((item) => !origem || norm(item.origemCidade) === norm(origem));
  const destinos = uniqueBy(universo, (item) => compact(item.rota.ibgeDestino)).map((item) => ({
    codigo: String(item.rota.ibgeDestino),
    cidade: item.rota.nomeRota || `IBGE ${item.rota.ibgeDestino}`,
    origem: item.origemCidade,
  }));
  const origens = origem
    ? [origem]
    : uniqueBy(universo, (item) => norm(item.origemCidade)).map((item) => item.origemCidade);

  const baseSelecionada = universo.filter((item) => !transportadora || norm(item.transportadora) === norm(transportadora));
  const cobertos = new Set(baseSelecionada.map((item) => `${norm(item.origemCidade)}|${compact(item.rota.ibgeDestino)}`));

  const listaFaltantes = [];
  origens.forEach((origemAtual) => {
    destinos.forEach((destinoAtual) => {
      const key = `${norm(origemAtual)}|${compact(destinoAtual.codigo)}`;
      if (!cobertos.has(key)) {
        listaFaltantes.push({
          origem: origemAtual,
          codigo: destinoAtual.codigo,
          cidade: destinoAtual.cidade,
          uf: '',
        });
      }
    });
  });

  const total = origens.length * destinos.length;
  const faltantes = listaFaltantes.length;
  const cobertas = total - faltantes;
  const percentual = total ? (cobertas / total) * 100 : 0;

  return { total, cobertas, faltantes, percentual, listaFaltantes };
}
