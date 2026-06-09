import {
  REGIOES_BRASIL,
  UFS_BRASIL,
  obterRegiaoPorUf,
} from './avaliacaoPrazosService';
import { carregarSnapshotNuvemAvaliacao } from './avaliacaoPrazosSnapshotService';

export const REGIOES_BASE_SNAPSHOT = Object.keys(REGIOES_BRASIL);

function upper(valor = '') {
  return String(valor ?? '').trim().toUpperCase();
}

function numero(valor = 0) {
  return Number(valor || 0);
}

function inteiro(valor = 0) {
  return Math.round(numero(valor));
}

function normalizarMapaUf(lista = []) {
  const porUf = new Map((lista || []).map((item) => [upper(item.uf), item]));
  return UFS_BRASIL.map((uf) => {
    const item = porUf.get(uf) || {};
    return {
      uf,
      regiao: item.regiao || obterRegiaoPorUf(uf),
      qtdRotas: inteiro(item.qtdRotas ?? item.qtd_rotas),
      qtdTransportadoras: inteiro(item.qtdTransportadoras ?? item.qtd_transportadoras),
      qtdTransportadorasOficiais: inteiro(item.qtdTransportadorasOficiais ?? item.qtd_transportadoras_oficiais),
      menorPrazo: inteiro(item.menorPrazo ?? item.menor_prazo),
      menorPrazoOficial: inteiro(item.menorPrazoOficial ?? item.menor_prazo_oficial),
      prazoMedio: numero(item.prazoMedio ?? item.prazo_medio),
    };
  });
}

export function snapshotCombinaRegiao(meta = {}, regiao = '', canal = 'ATACADO') {
  const filtros = meta.filtros || {};
  const regiaoAlvo = upper(regiao);
  const canalAlvo = upper(canal);
  const regiaoSnapshot = upper(filtros.regiaoOrigem);
  const canalSnapshot = upper(filtros.canal || 'ATACADO');
  const fonte = upper(filtros.fonteTabela || 'OFICIAL');
  return regiaoSnapshot === regiaoAlvo
    && (!canalAlvo || canalSnapshot === canalAlvo)
    && (fonte === 'OFICIAL' || !filtros.fonteTabela);
}

export function agruparSnapshotsRegionais(listaMeta = [], canal = 'ATACADO') {
  const porRegiao = {};
  REGIOES_BASE_SNAPSHOT.forEach((regiao) => {
    const item = (listaMeta || []).find((meta) => snapshotCombinaRegiao(meta, regiao, canal));
    if (item) porRegiao[regiao] = item;
  });
  return {
    porRegiao,
    regioesPresentes: Object.keys(porRegiao),
    regioesFaltando: REGIOES_BASE_SNAPSHOT.filter((regiao) => !porRegiao[regiao]),
    totalLinhas: Object.values(porRegiao).reduce((acc, item) => acc + inteiro(item.totalLinhas), 0),
  };
}

export function extrairUfDestinoRota(rota = {}) {
  if (rota.ufDestino) return upper(rota.ufDestino).slice(0, 2);
  const partes = String(rota.rotaKey || '').split('|');
  if (partes.length >= 4) {
    const uf = upper(partes[3]).slice(0, 2);
    if (UFS_BRASIL.includes(uf)) return uf;
  }
  const match = String(rota.rotaLabel || '').match(/→\s*[^/]*\/([A-Z]{2})\s*$/);
  return match ? match[1] : '';
}

export function extrairUfOrigemRota(rota = {}) {
  if (rota.ufOrigem) return upper(rota.ufOrigem).slice(0, 2);
  const partes = String(rota.rotaKey || '').split('|');
  if (partes.length >= 2) {
    const uf = upper(partes[1]).slice(0, 2);
    if (UFS_BRASIL.includes(uf)) return uf;
  }
  const match = String(rota.rotaLabel || '').match(/^[^→]*\/([A-Z]{2})\s*→/);
  return match ? match[1] : '';
}

function normalizarBusca(valor = '') {
  return String(valor ?? '').trim().toLowerCase();
}

function rotaCombinaFiltrosSnapshot(rota = {}, filtros = {}) {
  if (filtros.regiaoOrigem && upper(rota.regiaoOrigem) !== upper(filtros.regiaoOrigem)) return false;
  if (filtros.ufOrigem && extrairUfOrigemRota(rota) !== upper(filtros.ufOrigem)) return false;

  const ufDestino = extrairUfDestinoRota(rota);
  const regiaoDestino = rota.regiaoDestino || obterRegiaoPorUf(ufDestino);
  if (filtros.ufDestino && ufDestino !== upper(filtros.ufDestino)) return false;
  if (filtros.regiaoDestino && upper(regiaoDestino) !== upper(filtros.regiaoDestino)) return false;

  if (filtros.transportadora) {
    const alvo = normalizarBusca(filtros.transportadora);
    const nomes = [
      ...(Array.isArray(rota.melhoresTransportadoras) ? rota.melhoresTransportadoras : []),
      rota.transportadora,
    ].map((nome) => normalizarBusca(nome)).filter(Boolean);
    if (!nomes.some((nome) => nome.includes(alvo) || alvo.includes(nome))) return false;
  }

  const busca = normalizarBusca(filtros.busca);
  if (busca) {
    const alvo = normalizarBusca([
      rota.rotaLabel,
      rota.rotaKey,
      rota.canal,
      rota.regiaoOrigem,
      rota.regiaoDestino,
      ufDestino,
      extrairUfOrigemRota(rota),
      ...(Array.isArray(rota.melhoresTransportadoras) ? rota.melhoresTransportadoras : []),
    ].join(' '));
    if (!alvo.includes(busca)) return false;
  }

  return true;
}

function mesclarMapas(mapas = []) {
  const acumulado = new Map(
    UFS_BRASIL.map((uf) => [uf, {
      uf,
      regiao: obterRegiaoPorUf(uf),
      qtdRotas: 0,
      qtdTransportadoras: 0,
      qtdTransportadorasOficiais: 0,
      menorPrazo: 0,
      menorPrazoOficial: 0,
      prazoMedio: 0,
      pesoPrazo: 0,
    }]),
  );

  mapas.forEach((mapa) => {
    normalizarMapaUf(mapa).forEach((item) => {
      if (!item.qtdRotas && !item.qtdTransportadoras && !item.qtdTransportadorasOficiais) return;
      const dest = acumulado.get(item.uf);
      dest.qtdRotas += item.qtdRotas;
      dest.qtdTransportadoras += item.qtdTransportadoras;
      dest.qtdTransportadorasOficiais += item.qtdTransportadorasOficiais;
      if (item.menorPrazo > 0) {
        dest.menorPrazo = dest.menorPrazo > 0 ? Math.min(dest.menorPrazo, item.menorPrazo) : item.menorPrazo;
      }
      if (item.menorPrazoOficial > 0) {
        dest.menorPrazoOficial = dest.menorPrazoOficial > 0
          ? Math.min(dest.menorPrazoOficial, item.menorPrazoOficial)
          : item.menorPrazoOficial;
      }
      if (item.prazoMedio > 0 && item.qtdRotas > 0) {
        dest.prazoMedio += item.prazoMedio * item.qtdRotas;
        dest.pesoPrazo += item.qtdRotas;
      }
    });
  });

  return Array.from(acumulado.values()).map((item) => ({
    uf: item.uf,
    regiao: item.regiao,
    qtdRotas: item.qtdRotas,
    qtdTransportadoras: item.qtdTransportadoras,
    qtdTransportadorasOficiais: item.qtdTransportadorasOficiais,
    menorPrazo: item.menorPrazo,
    menorPrazoOficial: item.menorPrazoOficial,
    prazoMedio: item.pesoPrazo > 0 ? Number((item.prazoMedio / item.pesoPrazo).toFixed(2)) : 0,
  }));
}

function mesclarKpis(lista = [], mapa = []) {
  const base = {
    registros: 0,
    oficiais: 0,
    negociacao: 0,
    transportadoras: 0,
    transportadorasOficiais: 0,
    menorPrazo: 0,
    prazoMedio: 0,
    rotas: 0,
    rotasOficiais: 0,
    rotasBaixaCobertura: 0,
    ufsSemCoberturaOficial: 0,
  };

  let pesoPrazo = 0;
  lista.forEach((kpis) => {
    base.registros += inteiro(kpis.registros);
    base.oficiais += inteiro(kpis.oficiais);
    base.negociacao += inteiro(kpis.negociacao);
    base.transportadoras += inteiro(kpis.transportadoras);
    base.transportadorasOficiais += inteiro(kpis.transportadorasOficiais);
    base.rotas += inteiro(kpis.rotas);
    base.rotasOficiais += inteiro(kpis.rotasOficiais);
    base.rotasBaixaCobertura += inteiro(kpis.rotasBaixaCobertura);
    if (kpis.menorPrazo > 0) {
      base.menorPrazo = base.menorPrazo > 0 ? Math.min(base.menorPrazo, kpis.menorPrazo) : kpis.menorPrazo;
    }
    if (kpis.prazoMedio > 0 && kpis.registros > 0) {
      base.prazoMedio += numero(kpis.prazoMedio) * inteiro(kpis.registros);
      pesoPrazo += inteiro(kpis.registros);
    }
  });

  base.prazoMedio = pesoPrazo > 0 ? Number((base.prazoMedio / pesoPrazo).toFixed(2)) : 0;
  const ufsComOficial = mapa.filter((uf) => uf.qtdTransportadorasOficiais > 0).length;
  base.ufsSemCoberturaOficial = Math.max(0, 27 - ufsComOficial);
  return base;
}

function dedupeRotas(lista = [], limite = 500) {
  const mapa = new Map();
  lista.forEach((rota) => {
    if (!rota?.rotaKey) return;
    if (!mapa.has(rota.rotaKey)) mapa.set(rota.rotaKey, rota);
  });
  return Array.from(mapa.values()).slice(0, limite);
}

function mesclarLacunas(lista = []) {
  const mapa = new Map();
  lista.forEach((pacote) => {
    (pacote?.itens || []).forEach((item) => {
      const chave = `${item.tipo}|${item.rotaKey}`;
      if (!mapa.has(chave)) mapa.set(chave, item);
    });
  });
  const itens = Array.from(mapa.values());
  return {
    resumo: {
      semCoberturaOficial: itens.filter((item) => item.tipo === 'SEM_COBERTURA_OFICIAL').length,
      umaOficial: itens.filter((item) => item.tipo === 'UMA_OFICIAL').length,
      semPrazoOficial: itens.filter((item) => item.tipo === 'SEM_PRAZO_OFICIAL').length,
      total: itens.length,
    },
    itens,
  };
}

export function mesclarSnapshotsAgregados(snapshots = []) {
  const mapa = mesclarMapas(snapshots.map((item) => item.analise?.mapa || []));
  const kpis = mesclarKpis(snapshots.map((item) => item.kpis || {}), mapa);
  const rotasCriticas = dedupeRotas(
    snapshots.flatMap((item) => item.analise?.rotasCriticas || []),
    500,
  );
  const melhoresPrazos = dedupeRotas(
    snapshots.flatMap((item) => item.analise?.melhoresPrazos || []),
    20,
  ).sort((a, b) => a.menorPrazo - b.menorPrazo || b.qtdTransportadorasOficiais - a.qtdTransportadorasOficiais);
  const lacunas = mesclarLacunas(snapshots.map((item) => item.analise?.lacunas || { itens: [] }));
  const totalLinhas = snapshots.reduce((acc, item) => acc + inteiro(item.analise?.totalLinhas), 0);

  return {
    kpis,
    analise: {
      linhas: [],
      totalLinhas,
      mapa,
      melhoresPrazos,
      rotasCriticas,
      lacunas,
    },
    modo: 'snapshot',
  };
}

function lacunaCombinaFiltrosSnapshot(item = {}, filtros = {}) {
  return rotaCombinaFiltrosSnapshot({
    rotaKey: item.rotaKey,
    rotaLabel: item.rotaLabel,
    regiaoOrigem: item.regiaoOrigem,
    regiaoDestino: item.regiaoDestino,
    ufOrigem: item.ufOrigem,
    ufDestino: item.ufDestino,
    canal: item.canal,
  }, filtros);
}

function mapaCombinaFiltrosSnapshot(item = {}, filtros = {}) {
  if (filtros.ufDestino && item.uf !== upper(filtros.ufDestino)) return false;
  if (filtros.regiaoDestino && upper(item.regiao) !== upper(filtros.regiaoDestino)) return false;
  return true;
}

function filtrosRefinamVisao(filtros = {}) {
  return Boolean(
    filtros.regiaoOrigem
    || filtros.regiaoDestino
    || filtros.ufOrigem
    || filtros.ufDestino
    || filtros.transportadora
    || filtros.busca
  );
}

export function filtrarAgregadosSnapshot({ kpis = {}, analise = {} }, filtros = {}) {
  const mapaBase = normalizarMapaUf(analise.mapa || []);
  const refinamentoOrigem = Boolean(filtros.ufOrigem || filtros.busca || filtros.transportadora);
  const mapaFiltrado = refinamentoOrigem
    ? mapaBase
    : mapaBase.filter((item) => mapaCombinaFiltrosSnapshot(item, filtros));
  const rotasCriticas = (analise.rotasCriticas || []).filter((rota) => rotaCombinaFiltrosSnapshot(rota, filtros));
  const melhoresPrazos = (analise.melhoresPrazos || []).filter((rota) => rotaCombinaFiltrosSnapshot(rota, filtros));
  const lacunasItens = (analise.lacunas?.itens || []).filter((item) => lacunaCombinaFiltrosSnapshot(item, filtros));
  const lacunas = {
    resumo: {
      semCoberturaOficial: lacunasItens.filter((item) => item.tipo === 'SEM_COBERTURA_OFICIAL').length,
      umaOficial: lacunasItens.filter((item) => item.tipo === 'UMA_OFICIAL').length,
      semPrazoOficial: lacunasItens.filter((item) => item.tipo === 'SEM_PRAZO_OFICIAL').length,
      total: lacunasItens.length,
    },
    itens: lacunasItens,
  };

  const refinamentoAtivo = filtrosRefinamVisao(filtros);
  let kpisFiltrados = { ...kpis };
  if (refinamentoAtivo) {
    const mapaParaKpi = refinamentoOrigem ? mapaBase : mapaFiltrado;
    const rotasMapa = mapaParaKpi.reduce((acc, uf) => acc + uf.qtdRotas, 0);
    kpisFiltrados = {
      ...kpis,
      registros: rotasMapa || kpis.registros,
      rotasBaixaCobertura: rotasCriticas.length,
      rotas: Math.max(rotasCriticas.length, melhoresPrazos.length) || kpis.rotas,
      ufsSemCoberturaOficial: mapaParaKpi.filter((uf) => !uf.qtdTransportadorasOficiais).length,
      menorPrazo: melhoresPrazos.reduce((min, rota) => {
        if (!rota.menorPrazo) return min;
        return min > 0 ? Math.min(min, rota.menorPrazo) : rota.menorPrazo;
      }, mapaParaKpi.reduce((min, uf) => {
        if (!uf.menorPrazo) return min;
        return min > 0 ? Math.min(min, uf.menorPrazo) : uf.menorPrazo;
      }, 0)),
      prazoMedio: (() => {
        let peso = 0;
        let soma = 0;
        mapaParaKpi.forEach((uf) => {
          if (uf.prazoMedio > 0 && uf.qtdRotas > 0) {
            soma += uf.prazoMedio * uf.qtdRotas;
            peso += uf.qtdRotas;
          }
        });
        return peso > 0 ? Number((soma / peso).toFixed(2)) : kpis.prazoMedio;
      })(),
    };
  }

  return {
    kpis: kpisFiltrados,
    analise: {
      ...analise,
      linhas: [],
      mapa: refinamentoOrigem ? mapaBase : (refinamentoAtivo ? mapaFiltrado : mapaBase),
      rotasCriticas,
      melhoresPrazos,
      lacunas,
    },
  };
}

export function selecionarSnapshotsPorFiltros(base = {}, filtros = {}) {
  const snapshots = base.snapshots || [];
  const regiaoOrigem = upper(filtros.regiaoOrigem);
  if (!regiaoOrigem) return snapshots;
  return snapshots.filter((item) => upper(item.filtros?.regiaoOrigem) === regiaoOrigem);
}

export function aplicarBaseSnapshot(base = {}, filtros = {}) {
  const selecionados = selecionarSnapshotsPorFiltros(base, filtros);
  if (!selecionados.length) {
    return {
      vazio: true,
      mensagem: filtros.regiaoOrigem
        ? `Nenhum snapshot carregado para origem ${filtros.regiaoOrigem}.`
        : 'Nenhum snapshot regional carregado.',
    };
  }
  const mesclado = mesclarSnapshotsAgregados(selecionados);
  const filtrado = filtrarAgregadosSnapshot(mesclado, filtros);
  return {
    vazio: false,
    ...filtrado,
    meta: {
      snapshotsUsados: selecionados.length,
      totalLinhas: mesclado.analise.totalLinhas,
      regioes: selecionados.map((item) => item.filtros?.regiaoOrigem).filter(Boolean),
    },
  };
}

export async function carregarBaseRegionalSnapshots(listaMeta = [], { canal = 'ATACADO' } = {}) {
  const agrupado = agruparSnapshotsRegionais(listaMeta, canal);
  const ids = Object.values(agrupado.porRegiao).map((item) => item.id);
  if (!ids.length) {
    throw new Error('Nenhum snapshot regional encontrado na nuvem. Salve Sul, Sudeste, Norte, Nordeste e Centro-Oeste antes.');
  }

  const carregados = await Promise.all(ids.map((id) => carregarSnapshotNuvemAvaliacao(id)));
  return {
    canal,
    carregadaEm: new Date().toISOString(),
    regioesPresentes: agrupado.regioesPresentes,
    regioesFaltando: agrupado.regioesFaltando,
    snapshots: carregados,
    totalLinhas: agrupado.totalLinhas,
  };
}
