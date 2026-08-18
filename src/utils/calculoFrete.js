export * from './calculoFrete.base.js';
import * as base from './calculoFrete.base.js';

function normalizarNome(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\b(LTDA|EIRELI|S\/?A|SA|ME|EPP)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mesmoNome(a = '', b = '') {
  const na = normalizarNome(a);
  const nb = normalizarNome(b);
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)));
}

function destinosTransportadora(transportadoras = [], nomeTransportadora = '', origem = '') {
  const origemNorm = normalizarNome(origem);
  const set = new Set();
  (transportadoras || []).forEach((transportadora) => {
    if (!mesmoNome(transportadora?.nome, nomeTransportadora)) return;
    (transportadora?.origens || []).forEach((origemItem) => {
      if (origemNorm && normalizarNome(origemItem?.cidade) !== origemNorm) return;
      (origemItem?.rotas || []).forEach((rota) => {
        const ibge = String(rota?.ibgeDestino || rota?.ibge_destino || '').replace(/\D/g, '').slice(0, 7);
        if (ibge) set.add(ibge);
      });
    });
  });
  return [...set];
}

export function simularPorTransportadora(args = {}) {
  const {
    transportadoras = [],
    nomeTransportadora = '',
    canal = '',
    origem = '',
    destinoCodigos = [],
    peso,
    valorNF,
    cubagem = 0,
    cidadePorIbge,
    gradeCanal = [],
    indicePorDestino,
    ignorarCubagem = false,
  } = args;

  const destinos = (Array.isArray(destinoCodigos) && destinoCodigos.length)
    ? [...new Set(destinoCodigos.map((item) => String(item || '').trim()).filter(Boolean))]
    : destinosTransportadora(transportadoras, nomeTransportadora, origem);

  if (!destinos.length) return base.simularPorTransportadora(args);

  const resultados = destinos.flatMap((destinoCodigo) => base.simularSimples({
    transportadoras,
    origem,
    canal,
    peso,
    valorNF,
    cubagem,
    destinoCodigo,
    cidadePorIbge,
    gradeCanal,
    indicePorDestino,
    ignorarCubagem,
  }));

  return resultados.sort((a, b) => {
    const destinoA = String(a?.ibgeDestino || '');
    const destinoB = String(b?.ibgeDestino || '');
    if (destinoA !== destinoB) return destinoA.localeCompare(destinoB);
    return Number(a?.ranking || 999) - Number(b?.ranking || 999)
      || Number(a?.total || 0) - Number(b?.total || 0);
  });
}

export function analisarTransportadoraPorGrade(args = {}) {
  const resumoSelecionada = base.analisarTransportadoraPorGrade(args);
  const concorrencia = base.analisarOrigemPorGrade({
    transportadoras: args.transportadoras,
    canal: args.canal,
    origem: args.origem || '',
    ufDestino: args.ufDestino || '',
    grade: args.grade || [],
    cidadePorIbge: args.cidadePorIbge,
  });

  const destinosSelecionada = new Set(
    destinosTransportadora(args.transportadoras || [], args.nomeTransportadora || '', args.origem || '')
  );

  const detalhesCompetitivos = (concorrencia?.detalhes || []).filter((item) =>
    destinosSelecionada.has(String(item?.ibgeDestino || ''))
  );

  return {
    ...resumoSelecionada,
    detalhesSelecionada: resumoSelecionada?.detalhes || [],
    detalhes: detalhesCompetitivos.length ? detalhesCompetitivos : (resumoSelecionada?.detalhes || []),
    concorrentes: concorrencia?.porTransportadora || [],
    totalConcorrentes: new Set(detalhesCompetitivos.map((item) => normalizarNome(item?.transportadora)).filter(Boolean)).size,
  };
}
