import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

export const REGIOES_BRASIL = {
  NORTE: ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'],
  NORDESTE: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
  'CENTRO-OESTE': ['DF', 'GO', 'MT', 'MS'],
  SUDESTE: ['ES', 'MG', 'RJ', 'SP'],
  SUL: ['PR', 'RS', 'SC'],
};

export const UFS_BRASIL = Object.values(REGIOES_BRASIL).flat();

const PREFIXO_IBGE_UF = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
  41: 'PR', 42: 'SC', 43: 'RS',
  50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

const UF_IBGE_PREFIXO = Object.entries(PREFIXO_IBGE_UF).reduce((acc, [prefixo, uf]) => {
  acc[uf] = prefixo;
  return acc;
}, {});

function obterUfPorIbge(valor = '') {
  const codigo = String(valor ?? '').trim();
  return PREFIXO_IBGE_UF[codigo.slice(0, 2)] || '';
}


const OPCOES_FILTRO_PADRAO = {
  canais: ['ATACADO', 'B2C'],
  tiposTabela: [],
  status: [],
  transportadoras: [],
  modalidades: [],
  ufsOrigem: UFS_BRASIL,
  resumoGlobal: {},
};

function normalizarArrayOpcoes(valor, limite = 1000) {
  if (!Array.isArray(valor)) return [];
  return [...new Set(valor.map((item) => texto(item)).filter(Boolean))]
    .slice(0, limite)
    .sort((a, b) => a.localeCompare(b));
}

// Só tenta montar dropdown de transportadoras quando o recorte já foi estreitado
// além de canal/fonte — evita timeout e aviso amarelo só com ATACADO selecionado.
export function recortePermiteListaTransportadoras(filtros = {}) {
  return Boolean(
    String(filtros.busca || '').trim() ||
    String(filtros.transportadora || '').trim() ||
    String(filtros.ufOrigem || '').trim() ||
    String(filtros.ufDestino || '').trim() ||
    String(filtros.regiaoOrigem || '').trim() ||
    String(filtros.regiaoDestino || '').trim() ||
    String(filtros.modalidade || '').trim() ||
    String(filtros.tipoTabela || '').trim() ||
    String(filtros.status || '').trim() ||
    String(filtros.comPrazo || '').trim()
  );
}

async function carregarTransportadorasRecorteLeve(filtros = {}, limite = 500) {
  const supabase = exigirSupabase();
  const vistos = new Set();
  const lista = [];

  for (let offset = 0; offset < 5000 && lista.length < limite; offset += 1000) {
    let consulta = supabase
      .from('mvw_avaliacao_prazos_cobertura')
      .select('transportadora')
      .not('transportadora', 'is', null)
      .order('transportadora', { ascending: true, nullsFirst: false })
      .range(offset, offset + 999);

    consulta = aplicarFiltrosMv(consulta, filtros);
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await consulta;
    if (error) {
      if (/statement timeout|timeout/i.test(error.message || '')) break;
      throw new Error(error.message || 'Erro ao carregar transportadoras do recorte.');
    }

    (data || []).forEach((item) => {
      const nome = texto(item.transportadora);
      const chave = normalizar(nome);
      if (!nome || vistos.has(chave)) return;
      vistos.add(chave);
      lista.push(nome);
    });

    if (!data?.length || data.length < 1000) break;
  }

  return lista.slice(0, limite).sort((a, b) => a.localeCompare(b));
}


const CAMPOS_VIEW = [
  'id',
  'tabela_negociacao_id',
  'transportadora',
  'canal',
  'tipo_tabela',
  'tipo_negociacao',
  'status',
  'tabela_nome',
  'origem_importacao',
  'modalidade',
  'cidade_origem',
  'uf_origem',
  'ibge_origem',
  'cidade_destino',
  'uf_destino',
  'ibge_destino',
  'prazo',
  'valor_referencia',
  'observacao',
  'fonte_tabela',
  'fonte_label',
  'fonte_prioridade',
].join(',');

const CAMPOS_VIEW_FALLBACK = [
  'id',
  'tabela_negociacao_id',
  'transportadora',
  'canal',
  'tipo_tabela',
  'tipo_negociacao',
  'status',
  'tabela_nome',
  'origem_importacao',
  'modalidade',
  'cidade_origem',
  'uf_origem',
  'ibge_origem',
  'cidade_destino',
  'uf_destino',
  'ibge_destino',
  'prazo',
  'valor_referencia',
  'observacao',
].join(',');

const PAGE_SIZE = 1000;
const SUPABASE_LOTE_MAX = 1000;
const CONCORRENCIA = 6;

function texto(valor = '') {
  return String(valor ?? '').trim();
}

function upper(valor = '') {
  return texto(valor).toUpperCase();
}

function normalizar(valor = '') {
  return upper(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  let raw = String(valor).replace(/R\$/gi, '').replace(/%/g, '').trim();
  if (!raw) return 0;
  raw = raw.replace(/\s/g, '');
  const temVirgula = raw.includes(',');
  const temPonto = raw.includes('.');
  if (temVirgula && temPonto) raw = raw.replace(/\./g, '').replace(',', '.');
  else if (temVirgula) raw = raw.replace(',', '.');
  const n = Number(raw.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function inteiro(valor) {
  const n = Math.round(numero(valor));
  return Number.isFinite(n) ? n : 0;
}

function acumularPrazo(acumulador = {}, prazo = 0, { oficial = false } = {}) {
  if (!(prazo > 0)) return;
  acumulador.qtd += 1;
  acumulador.soma += prazo;
  if (acumulador.qtd === 1 || prazo < acumulador.min) acumulador.min = prazo;
  if (prazo > acumulador.max) acumulador.max = prazo;
  if (!oficial) return;
  acumulador.ofiQtd += 1;
  acumulador.ofiSoma += prazo;
  if (acumulador.ofiQtd === 1 || prazo < acumulador.ofiMin) acumulador.ofiMin = prazo;
}

function criarAcumuladorPrazos() {
  return { qtd: 0, soma: 0, min: 0, max: 0, ofiQtd: 0, ofiSoma: 0, ofiMin: 0 };
}

function resumirAcumuladorPrazos(acumulador = {}) {
  return {
    min: acumulador.qtd ? acumulador.min : 0,
    max: acumulador.qtd ? acumulador.max : 0,
    media: acumulador.qtd ? acumulador.soma / acumulador.qtd : 0,
    ofiMin: acumulador.ofiQtd ? acumulador.ofiMin : 0,
    ofiMedia: acumulador.ofiQtd ? acumulador.ofiSoma / acumulador.ofiQtd : 0,
  };
}

function objetoSeguro(valor) {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
}

function obterPrimeiro(objetos = [], campos = []) {
  for (const obj of objetos) {
    const seguro = objetoSeguro(obj);
    for (const campo of campos) {
      const valor = seguro[campo];
      if (valor !== null && valor !== undefined && texto(valor) !== '') return valor;
    }
  }
  return '';
}

export function obterRegiaoPorUf(uf = '') {
  const ufNormalizada = upper(uf).slice(0, 2);
  return Object.entries(REGIOES_BRASIL).find(([, ufs]) => ufs.includes(ufNormalizada))?.[0] || '';
}

function normalizarFonte(item = {}) {
  const fonte = upper(item.fonte_tabela || item.fonteTabela || '');
  if (fonte.includes('OFICIAL') || fonte.includes('CADASTR')) return 'OFICIAL';
  if (fonte.includes('REAJUST')) return 'REAJUSTE';
  if (fonte.includes('NEGOCI')) return 'NEGOCIACAO';

  const tipoNegociacao = upper(item.tipo_negociacao || '');
  if (tipoNegociacao.includes('REAJUST')) return 'REAJUSTE';
  if (item.tabela_negociacao_id) return 'NEGOCIACAO';
  return 'OFICIAL';
}

function fonteLabel(fonte) {
  if (fonte === 'OFICIAL') return 'Oficial / cadastrada';
  if (fonte === 'REAJUSTE') return 'Reajuste em negociaÃ§Ã£o';
  if (fonte === 'NEGOCIACAO') return 'Em negociaÃ§Ã£o';
  return 'NÃ£o identificada';
}

export function montarLinhaCobertura(item = {}) {
  const fonteTabela = normalizarFonte(item);
  const cidadeOrigem = texto(item.cidade_origem);
  const ufOrigem = upper(item.uf_origem || obterUfPorIbge(item.ibge_origem)).slice(0, 2);
  const cidadeDestino = texto(item.cidade_destino);
  const ufDestino = upper(item.uf_destino || obterUfPorIbge(item.ibge_destino)).slice(0, 2);
  const transportadora = texto(item.transportadora);
  const canal = upper(item.canal) || 'N/I';
  const tipoTabela = upper(item.tipo_tabela) || (fonteTabela === 'OFICIAL' ? 'OFICIAL' : 'N/I');
  const tipoNegociacao = upper(item.tipo_negociacao || '');
  const modalidade = texto(item.modalidade);
  const status = upper(item.status) || 'N/I';
  const prazo = inteiro(item.prazo);

  const rotaKey = [
    normalizar(cidadeOrigem),
    ufOrigem,
    normalizar(cidadeDestino),
    ufDestino,
    canal,
  ].join('|');

  const tabelaNome = texto(
    item.tabela_nome ||
    item.origem_importacao ||
    (fonteTabela === 'OFICIAL' ? `Cadastro oficial - ${transportadora}` : 'Tabela sem descriÃ§Ã£o')
  );

  return {
    id: item.id || `${item.tabela_negociacao_id || 'sem-tabela'}-${rotaKey}-${transportadora}-${fonteTabela}`,
    tabelaId: item.tabela_negociacao_id || item.id || '',
    tabelaNome,
    transportadora,
    canal,
    tipoTabela,
    tipoNegociacao,
    modalidade,
    status,
    fonteTabela,
    fonteLabel: texto(item.fonte_label) || fonteLabel(fonteTabela),
    fontePrioridade: numero(item.fonte_prioridade || (fonteTabela === 'OFICIAL' ? 1 : 2)),
    cidadeOrigem,
    ufOrigem,
    ibgeOrigem: texto(item.ibge_origem),
    regiaoOrigem: obterRegiaoPorUf(ufOrigem),
    cidadeDestino,
    ufDestino,
    ibgeDestino: texto(item.ibge_destino),
    regiaoDestino: obterRegiaoPorUf(ufDestino),
    prazo,
    prazoLabel: prazo > 0 ? `${prazo} dia${prazo === 1 ? '' : 's'}` : 'Sem prazo',
    valorReferencia: numero(item.valor_referencia),
    observacao: texto(item.observacao),
    rotaKey,
    rotaLabel: `${cidadeOrigem || 'Origem N/I'}${ufOrigem ? `/${ufOrigem}` : ''} â†’ ${cidadeDestino || 'Destino N/I'}${ufDestino ? `/${ufDestino}` : ''}`,
  };
}

async function consultarPaginaView(supabase, campos, inicio, fim, comCount = false) {
  let consulta = supabase
    .from('vw_avaliacao_prazos_cobertura')
    .select(campos, comCount ? { count: 'exact' } : undefined)
    .range(inicio, fim);

  consulta = consulta.order('fonte_prioridade', { ascending: true, nullsFirst: false })
    .order('transportadora', { ascending: true, nullsFirst: false });

  return consulta;
}

async function listarRotasAvaliacaoPrazos() {
  const supabase = getSupabaseClient();

  let campos = CAMPOS_VIEW;
  let primeiraConsulta = await consultarPaginaView(supabase, campos, 0, PAGE_SIZE - 1, true);

  // Permite a tela abrir em bases que ainda nÃ£o aplicaram a migration 4.36.2.
  // Nesse caso, a correÃ§Ã£o visual entra depois da migration, mas a tela nÃ£o quebra antes disso.
  if (primeiraConsulta.error && /fonte_|column|schema cache/i.test(primeiraConsulta.error.message || '')) {
    campos = CAMPOS_VIEW_FALLBACK;
    primeiraConsulta = await supabase
      .from('vw_avaliacao_prazos_cobertura')
      .select(campos, { count: 'exact' })
      .range(0, PAGE_SIZE - 1);
  }

  if (primeiraConsulta.error) {
    throw new Error(primeiraConsulta.error.message || 'Erro ao carregar rotas de prazos e cobertura.');
  }

  const total = Number(primeiraConsulta.count || 0);
  const paginas = [];
  for (let inicio = PAGE_SIZE; inicio < total; inicio += PAGE_SIZE) {
    paginas.push({ inicio, fim: Math.min(inicio + PAGE_SIZE - 1, total - 1) });
  }

  const todos = [...(primeiraConsulta.data || [])];
  const consultarPagina = (inicio, fim) => {
    if (campos === CAMPOS_VIEW) return consultarPaginaView(supabase, campos, inicio, fim, false);
    return supabase
      .from('vw_avaliacao_prazos_cobertura')
      .select(campos)
      .range(inicio, fim);
  };

  for (let indice = 0; indice < paginas.length; indice += CONCORRENCIA) {
    const grupo = paginas.slice(indice, indice + CONCORRENCIA);
    const resultados = await Promise.all(grupo.map(({ inicio, fim }) => consultarPagina(inicio, fim)));

    resultados.forEach(({ data, error }) => {
      if (error) throw new Error(error.message || 'Erro ao carregar rotas de prazos e cobertura.');
      todos.push(...(data || []));
    });
  }

  return todos;
}

export async function carregarAvaliacaoPrazosCobertura() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase nÃ£o configurado. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para carregar a avaliaÃ§Ã£o de prazos.');
  }

  const rotas = await listarRotasAvaliacaoPrazos();
  const linhas = (rotas || [])
    .map(montarLinhaCobertura)
    .filter((linha) => linha.transportadora && (linha.cidadeDestino || linha.ufDestino || linha.cidadeOrigem || linha.ufOrigem));

  return {
    tabelas: [],
    linhas,
    carregadoEm: new Date().toISOString(),
    resumoFonte: resumirFontes(linhas),
  };
}

export function resumirFontes(linhas = []) {
  return linhas.reduce((acc, linha) => {
    const fonte = linha.fonteTabela || 'N/I';
    acc[fonte] = (acc[fonte] || 0) + 1;
    return acc;
  }, {});
}

export function filtrarLinhasAvaliacao(linhas = [], filtros = {}) {
  const busca = normalizar(filtros.busca);
  return linhas.filter((linha) => {
    if (filtros.fonteTabela && linha.fonteTabela !== filtros.fonteTabela) return false;
    if (filtros.canal && linha.canal !== filtros.canal) return false;
    if (filtros.tipoTabela && linha.tipoTabela !== filtros.tipoTabela) return false;
    if (filtros.status && linha.status !== filtros.status) return false;
    if (filtros.transportadora && normalizar(linha.transportadora) !== normalizar(filtros.transportadora)) return false;
    if (filtros.ufOrigem && linha.ufOrigem !== filtros.ufOrigem) return false;
    if (filtros.ufDestino && linha.ufDestino !== filtros.ufDestino) return false;
    if (filtros.regiaoOrigem && linha.regiaoOrigem !== filtros.regiaoOrigem) return false;
    if (filtros.regiaoDestino && linha.regiaoDestino !== filtros.regiaoDestino) return false;
    if (filtros.modalidade && normalizar(linha.modalidade) !== normalizar(filtros.modalidade)) return false;
    if (filtros.comPrazo === 'COM_PRAZO' && linha.prazo <= 0) return false;
    if (filtros.comPrazo === 'SEM_PRAZO' && linha.prazo > 0) return false;
    if (busca) {
      const alvo = normalizar([
        linha.fonteLabel,
        linha.fonteTabela,
        linha.transportadora,
        linha.canal,
        linha.tipoTabela,
        linha.tipoNegociacao,
        linha.modalidade,
        linha.status,
        linha.cidadeOrigem,
        linha.ufOrigem,
        linha.cidadeDestino,
        linha.ufDestino,
        linha.tabelaNome,
        linha.observacao,
      ].join(' '));
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

export function consolidarRotas(linhas = []) {
  const mapa = new Map();

  linhas.forEach((linha) => {
    if (!mapa.has(linha.rotaKey)) {
      mapa.set(linha.rotaKey, {
        rotaKey: linha.rotaKey,
        rotaLabel: linha.rotaLabel,
        cidadeOrigem: linha.cidadeOrigem,
        ufOrigem: linha.ufOrigem,
        regiaoOrigem: linha.regiaoOrigem,
        cidadeDestino: linha.cidadeDestino,
        ufDestino: linha.ufDestino,
        regiaoDestino: linha.regiaoDestino,
        ibgeDestino: '',
        canal: linha.canal,
        transportadoras: new Set(),
        transportadorasOficiais: new Set(),
        transportadorasNegociacao: new Set(),
        melhoresTransportadoras: new Set(),
        prazos: criarAcumuladorPrazos(),
        qtdTabelas: 0,
        qtdOficiaisSemPrazo: 0,
      });
    }

    const rota = mapa.get(linha.rotaKey);
    const transportadoraNormalizada = normalizar(linha.transportadora);
    rota.qtdTabelas += 1;
    if (!rota.ibgeDestino && linha.ibgeDestino) rota.ibgeDestino = linha.ibgeDestino;
    rota.transportadoras.add(transportadoraNormalizada);
    if (linha.fonteTabela === 'OFICIAL') {
      rota.transportadorasOficiais.add(transportadoraNormalizada);
      if (!(linha.prazo > 0)) rota.qtdOficiaisSemPrazo += 1;
    } else {
      rota.transportadorasNegociacao.add(transportadoraNormalizada);
    }

    if (linha.prazo > 0) {
      const prazoAtual = rota.prazos.min;
      acumularPrazo(rota.prazos, linha.prazo, { oficial: linha.fonteTabela === 'OFICIAL' });
      if (prazoAtual === 0 || linha.prazo < prazoAtual) {
        rota.melhoresTransportadoras = new Set(linha.transportadora ? [linha.transportadora] : []);
      } else if (linha.prazo === rota.prazos.min && linha.transportadora) {
        rota.melhoresTransportadoras.add(linha.transportadora);
      }
    }
  });

  return Array.from(mapa.values()).map((rota) => {
    const resumoPrazos = resumirAcumuladorPrazos(rota.prazos);

    return {
      rotaKey: rota.rotaKey,
      rotaLabel: rota.rotaLabel,
      cidadeOrigem: rota.cidadeOrigem,
      ufOrigem: rota.ufOrigem,
      regiaoOrigem: rota.regiaoOrigem,
      cidadeDestino: rota.cidadeDestino,
      ufDestino: rota.ufDestino,
      regiaoDestino: rota.regiaoDestino,
      ibgeDestino: rota.ibgeDestino,
      canal: rota.canal,
      qtdTransportadoras: rota.transportadoras.size,
      qtdTransportadorasOficiais: rota.transportadorasOficiais.size,
      qtdTransportadorasNegociacao: rota.transportadorasNegociacao.size,
      qtdTabelas: rota.qtdTabelas,
      qtdOficiaisSemPrazo: rota.qtdOficiaisSemPrazo,
      menorPrazo: resumoPrazos.min,
      maiorPrazo: resumoPrazos.max,
      prazoMedio: resumoPrazos.media,
      menorPrazoOficial: resumoPrazos.ofiMin,
      melhoresTransportadoras: [...rota.melhoresTransportadoras],
    };
  }).sort((a, b) => a.qtdTransportadorasOficiais - b.qtdTransportadorasOficiais || a.qtdTransportadoras - b.qtdTransportadoras || a.rotaLabel.localeCompare(b.rotaLabel));
}

function montarItemLacuna(rota = {}, tipo = '', extras = {}) {
  return {
    tipo,
    rotaKey: rota.rotaKey,
    rotaLabel: rota.rotaLabel,
    cidadeOrigem: rota.cidadeOrigem,
    ufOrigem: rota.ufOrigem,
    regiaoOrigem: rota.regiaoOrigem,
    cidadeDestino: rota.cidadeDestino,
    ufDestino: rota.ufDestino,
    regiaoDestino: rota.regiaoDestino,
    ibgeDestino: rota.ibgeDestino || '',
    canal: rota.canal,
    qtdTransportadorasOficiais: rota.qtdTransportadorasOficiais || 0,
    qtdTransportadoras: rota.qtdTransportadoras || 0,
    qtdTransportadorasNegociacao: rota.qtdTransportadorasNegociacao || 0,
    menorPrazoOficial: rota.menorPrazoOficial || 0,
    ...extras,
  };
}

export function consolidarLacunasDeRotas(rotas = []) {
  const itens = [];

  rotas.forEach((rota) => {
    if (rota.qtdTransportadorasOficiais === 0) {
      itens.push(montarItemLacuna(rota, 'SEM_COBERTURA_OFICIAL', {
        severidade: 'critico',
        detalhe: rota.qtdTransportadorasNegociacao > 0 ? 'Somente negociação/reajuste' : 'Sem tabela oficial',
      }));
    } else if (rota.qtdTransportadorasOficiais === 1) {
      itens.push(montarItemLacuna(rota, 'UMA_OFICIAL', {
        severidade: 'alerta',
        detalhe: 'Apenas uma transportadora oficial',
      }));
    }
  });

  return montarResumoLacunas(itens);
}

export function consolidarLacunas(linhas = [], rotasPrecalculadas = null) {
  const rotas = rotasPrecalculadas || consolidarRotas(linhas);
  const itens = [];

  rotas.forEach((rota) => {
    if (rota.qtdTransportadorasOficiais === 0) {
      itens.push(montarItemLacuna(rota, 'SEM_COBERTURA_OFICIAL', {
        severidade: 'critico',
        detalhe: rota.qtdTransportadorasNegociacao > 0 ? 'Somente negociação/reajuste' : 'Sem tabela oficial',
      }));
    } else if (rota.qtdTransportadorasOficiais === 1) {
      itens.push(montarItemLacuna(rota, 'UMA_OFICIAL', {
        severidade: 'alerta',
        detalhe: 'Apenas uma transportadora oficial',
      }));
    }

    const oficiaisSemPrazo = rota.qtdOficiaisSemPrazo || 0;
    if (oficiaisSemPrazo > 0) {
      itens.push(montarItemLacuna(rota, 'SEM_PRAZO_OFICIAL', {
        severidade: 'alerta',
        qtdLinhasSemPrazo: oficiaisSemPrazo,
        detalhe: `${oficiaisSemPrazo} linha(s) oficial(is) sem prazo`,
      }));
    }
  });

  return montarResumoLacunas(itens);
}

function montarResumoLacunas(itens = []) {
  const resumo = {
    semCoberturaOficial: itens.filter((item) => item.tipo === 'SEM_COBERTURA_OFICIAL').length,
    umaOficial: itens.filter((item) => item.tipo === 'UMA_OFICIAL').length,
    semPrazoOficial: itens.filter((item) => item.tipo === 'SEM_PRAZO_OFICIAL').length,
    total: itens.length,
  };

  const ordem = { SEM_COBERTURA_OFICIAL: 0, UMA_OFICIAL: 1, SEM_PRAZO_OFICIAL: 2 };
  const ordenados = [...itens].sort((a, b) => {
    const pa = ordem[a.tipo] ?? 9;
    const pb = ordem[b.tipo] ?? 9;
    return pa - pb
      || (a.qtdTransportadorasOficiais - b.qtdTransportadorasOficiais)
      || a.rotaLabel.localeCompare(b.rotaLabel);
  });

  return { resumo, itens: ordenados.slice(0, 2000) };
}

export function consolidarUfDestino(linhas = []) {
  const mapa = new Map(UFS_BRASIL.map((uf) => [uf, {
    uf,
    regiao: obterRegiaoPorUf(uf),
    rotas: new Set(),
    transportadoras: new Set(),
    transportadorasOficiais: new Set(),
    prazos: criarAcumuladorPrazos(),
  }]));

  linhas.forEach((linha) => {
    const uf = linha.ufDestino;
    if (!uf) return;
    if (!mapa.has(uf)) {
      mapa.set(uf, {
        uf,
        regiao: obterRegiaoPorUf(uf),
        rotas: new Set(),
        transportadoras: new Set(),
        transportadorasOficiais: new Set(),
        prazos: criarAcumuladorPrazos(),
      });
    }
    const item = mapa.get(uf);
    item.rotas.add(linha.rotaKey);
    item.transportadoras.add(normalizar(linha.transportadora));
    if (linha.fonteTabela === 'OFICIAL') item.transportadorasOficiais.add(normalizar(linha.transportadora));
    acumularPrazo(item.prazos, linha.prazo, { oficial: linha.fonteTabela === 'OFICIAL' });
  });

  return Array.from(mapa.values()).map((item) => {
    const resumoPrazos = resumirAcumuladorPrazos(item.prazos);
    return {
      uf: item.uf,
      regiao: item.regiao,
      qtdRotas: item.rotas.size,
      qtdTransportadoras: item.transportadoras.size,
      qtdTransportadorasOficiais: item.transportadorasOficiais.size,
      menorPrazo: resumoPrazos.min,
      menorPrazoOficial: resumoPrazos.ofiMin,
      prazoMedio: resumoPrazos.media,
    };
  }).sort((a, b) => a.regiao.localeCompare(b.regiao) || a.uf.localeCompare(b.uf));
}

function linhaPertenceUfDestino(linha = {}, uf = '') {
  const ufNorm = upper(uf).slice(0, 2);
  if (!ufNorm) return false;
  if (upper(linha.ufDestino).slice(0, 2) === ufNorm) return true;
  const prefixo = UF_IBGE_PREFIXO[ufNorm];
  return Boolean(prefixo && String(linha.ibgeDestino || '').startsWith(prefixo));
}

export function consolidarTransportadorasUfDestino(linhas = [], uf = '', { somenteOficial = false } = {}) {
  const mapa = new Map();

  linhas.forEach((linha) => {
    if (!linhaPertenceUfDestino(linha, uf)) return;
    if (somenteOficial && linha.fonteTabela !== 'OFICIAL') return;

    const chave = normalizar(linha.transportadora);
    if (!chave) return;

    if (!mapa.has(chave)) {
      mapa.set(chave, {
        transportadora: linha.transportadora,
        oficial: linha.fonteTabela === 'OFICIAL',
        prazos: criarAcumuladorPrazos(),
        rotas: new Set(),
      });
    }

    const item = mapa.get(chave);
    item.rotas.add(linha.rotaKey);
    if (linha.fonteTabela === 'OFICIAL') item.oficial = true;
    acumularPrazo(item.prazos, linha.prazo, { oficial: linha.fonteTabela === 'OFICIAL' });
  });

  return Array.from(mapa.values())
    .map((item) => {
      const resumoPrazos = resumirAcumuladorPrazos(item.prazos);
      return {
        transportadora: item.transportadora,
        oficial: item.oficial,
        qtdRotas: item.rotas.size,
        menorPrazo: resumoPrazos.min,
        menorPrazoOficial: resumoPrazos.ofiMin,
        prazoMedio: resumoPrazos.media,
        prazoMedioOficial: resumoPrazos.ofiMedia,
        qtdComPrazo: item.prazos.qtd,
      };
    })
    .sort((a, b) => {
      const pa = a.prazoMedio || 9999;
      const pb = b.prazoMedio || 9999;
      return pa - pb || a.menorPrazo - b.menorPrazo || a.transportadora.localeCompare(b.transportadora);
    });
}

export async function carregarDetalheTransportadorasUf(filtros = {}, uf = '', linhasMemoria = []) {
  const memoria = consolidarTransportadorasUfDestino(linhasMemoria, uf);
  const linhasUf = linhasMemoria.filter((linha) => linhaPertenceUfDestino(linha, uf));
  const totalMemoria = linhasUf.length;
  const totalRecorte = inteiro(await contarRecorteUfDestino(filtros, uf));

  if (memoria.length > 0 && (totalMemoria >= totalRecorte || totalRecorte === 0)) {
    return { transportadoras: memoria, totalLinhas: totalMemoria, origem: 'memoria' };
  }

  if (memoria.length > 0 && totalMemoria > 0) {
    return { transportadoras: memoria, totalLinhas: totalMemoria, origem: 'memoria', parcial: totalRecorte > totalMemoria };
  }

  const acumulado = [];
  let offset = 0;
  let total = totalRecorte || null;
  const filtrosUf = { ...filtros, ufDestino: upper(uf).slice(0, 2) };

  while (total === null || offset < total) {
    // eslint-disable-next-line no-await-in-loop
    const pagina = await carregarLinhasAvaliacao(filtrosUf, {
      limite: SUPABASE_LOTE_MAX,
      offset,
      contar: offset === 0 && !total,
    });
    if (!total) total = pagina.total ?? 0;
    if (!pagina.linhas.length) break;
    acumulado.push(...pagina.linhas);
    offset += pagina.linhas.length;
    if (total !== null && offset >= total) break;
    if (acumulado.length >= 150000) break;
  }

  return {
    transportadoras: consolidarTransportadorasUfDestino(acumulado, uf),
    totalLinhas: acumulado.length,
    origem: 'servidor',
    parcial: total !== null && acumulado.length < total,
  };
}

async function contarRecorteUfDestino(filtros = {}, uf = '') {
  const supabase = exigirSupabase();
  let consulta = supabase
    .from('mvw_avaliacao_prazos_cobertura')
    .select('id', { count: 'exact', head: true });
  consulta = aplicarFiltrosMv(consulta, { ...filtros, ufDestino: upper(uf).slice(0, 2) });
  const { count, error } = await consulta;
  tratarErroRpc(error, 'a contagem da UF destino');
  return inteiro(count);
}

// ===========================================================================
// 4.36.2 â€” Camada server-side (materialized view + RPCs)
// Substitui o carregamento integral da base no navegador. As funÃ§Ãµes acima
// (filtrar/consolidar/resumir/carregarAvaliacaoPrazosCobertura) permanecem
// para compatibilidade, mas nÃ£o sÃ£o mais usadas no caminho quente da tela.
// ===========================================================================

const UFS_SET = new Set(UFS_BRASIL);

// Converte o objeto de filtros da tela nos parÃ¢metros nomeados das RPCs.
// String vazia vira undefined (a RPC trata ausÃªncia como "sem filtro").
function montarParametrosRpc(filtros = {}) {
  const limpar = (valor) => {
    const texto = String(valor ?? '').trim();
    return texto === '' ? null : texto;
  };
  return {
    p_fonte: filtros.fonteTabela === undefined ? 'OFICIAL' : String(filtros.fonteTabela ?? '').trim() || 'OFICIAL',
    p_busca: limpar(filtros.busca),
    p_canal: limpar(filtros.canal),
    p_tipo_tabela: limpar(filtros.tipoTabela),
    p_status: limpar(filtros.status),
    p_transportadora: limpar(filtros.transportadora),
    p_uf_origem: limpar(filtros.ufOrigem),
    p_uf_destino: limpar(filtros.ufDestino),
    p_regiao_origem: limpar(filtros.regiaoOrigem),
    p_regiao_destino: limpar(filtros.regiaoDestino),
    p_modalidade: limpar(filtros.modalidade),
    p_com_prazo: limpar(filtros.comPrazo),
  };
}

function exigirSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase nÃ£o configurado. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para carregar a avaliaÃ§Ã£o de prazos.');
  }
  return getSupabaseClient();
}

function humanizarErroConexao(mensagem = '') {
  const msg = String(mensagem || '');
  if (/failed to fetch|networkerror|load failed|network request failed|typeerror: failed to fetch/i.test(msg)) {
    return (
      'Não foi possível conectar ao Supabase (Failed to fetch). '
      + 'Verifique internet, se o projeto está ativo (não pausado no dashboard) e se VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY estão corretos. '
      + 'Se o recorte for grande, aplique também supabase/migrations/20260609_011_avaliacao_prazos_mapa_ibge_limites.sql no SQL Editor. '
      + 'Depois recarregue a página com Ctrl+F5.'
    );
  }
  return msg;
}

function tratarErroRpc(error, contexto) {
  if (!error) return;
  const msg = humanizarErroConexao(error.message || `Erro ao carregar ${contexto}.`);
  if (erroIndicaTimeout(msg)) {
    throw new Error(`Tempo de consulta excedido ao carregar ${contexto}. Reduza o intervalo de filtros ou aplique a migration 011 no Supabase.`);
  }
  if (/function .* does not exist|schema cache|404/i.test(msg)) {
    throw new Error(
      `As funções de servidor da Avaliação de Prazos (4.36.2) ainda não foram aplicadas no banco. `
      + 'Rode supabase/APLICAR_4362_COMPLETO.sql ou, se 006–010 já rodaram, supabase/migrations/20260609_011_avaliacao_prazos_mapa_ibge_limites.sql. '
      + `(${msg})`,
    );
  }
  throw new Error(msg);
}

function erroIndicaTimeout(mensagem = '') {
  return /timeout|statement timeout|excedido|canceling statement/i.test(String(mensagem || ''));
}

const LIMITE_RPC_ANALISE = 25000;
const LIMITE_CLIENTE_ANALISE = 350000;
const LIMITE_EXPORT_ANALISE = 350000;

// Carrega opções leves de filtro e resumo global por fonte.
// Não busca lista global de transportadoras para evitar timeout.
export async function carregarOpcoesAvaliacao() {
  const supabase = exigirSupabase();

  const { data, error } = await supabase.rpc('rpc_avaliacao_prazos_opcoes_leves');

  if (error) {
    // Fallback seguro: não bloqueia a tela se a RPC nova ainda não foi aplicada.
    return { ...OPCOES_FILTRO_PADRAO };
  }

  const opcoes = data || {};
  return {
    canais: normalizarArrayOpcoes(opcoes.canais, 100),
    tiposTabela: normalizarArrayOpcoes(opcoes.tiposTabela, 100),
    status: normalizarArrayOpcoes(opcoes.status, 100),
    transportadoras: [],
    modalidades: normalizarArrayOpcoes(opcoes.modalidades, 200),
    ufsOrigem: normalizarArrayOpcoes(opcoes.ufsOrigem, 27).filter((uf) => UFS_SET.has(uf)),
    resumoGlobal: objetoSeguro(opcoes.resumoGlobal),
  };
}

// Carrega nomes de transportadoras para o dropdown (leve — cadastro/rotas, não varre a MV inteira).
export async function carregarTransportadorasAvaliacao(filtros = {}) {
  const supabase = exigirSupabase();
  const params = montarParametrosRpc(filtros);

  const { data: rpcData, error: rpcError } = await supabase.rpc('rpc_avaliacao_prazos_transportadoras', {
    p_fonte: params.p_fonte,
    p_canal: params.p_canal,
    p_limite: 500,
  });

  if (!rpcError) {
    const lista = normalizarArrayOpcoes(
      (rpcData || []).map((item) => (typeof item === 'string' ? item : item?.transportadora)),
      500,
    );
    if (lista.length) return lista;
  }

  const { data, error } = await supabase
    .from('transportadoras')
    .select('nome')
    .not('nome', 'is', null)
    .order('nome', { ascending: true })
    .limit(500);

  if (!error) {
    const lista = normalizarArrayOpcoes((data || []).map((item) => item.nome), 500);
    if (lista.length) return lista;
  }

  if (String(filtros.canal || '').trim() || recortePermiteListaTransportadoras(filtros)) {
    return carregarTransportadorasRecorteLeve(filtros, 500);
  }

  return [];
}

// Atualiza dropdown de transportadoras conforme canal/recorte.
export async function carregarOpcoesRecorteAvaliacao(filtros = {}) {
  if (!String(filtros.canal || '').trim() && !recortePermiteListaTransportadoras(filtros)) {
    return { transportadoras: [], ignorado: true };
  }

  const transportadoras = await carregarTransportadorasAvaliacao(filtros);
  return { transportadoras, recorteParcial: false };
}

// Indicadores agregados do topo.
export async function carregarKpisAvaliacao(filtros = {}) {
  const supabase = exigirSupabase();
  const { data, error } = await supabase.rpc('rpc_avaliacao_prazos_kpis', montarParametrosRpc(filtros));
  tratarErroRpc(error, 'os indicadores');
  const linha = (Array.isArray(data) ? data[0] : data) || {};
  return {
    registros: inteiro(linha.registros),
    oficiais: inteiro(linha.oficiais),
    negociacao: inteiro(linha.negociacao),
    transportadoras: inteiro(linha.transportadoras),
    transportadorasOficiais: inteiro(linha.transportadoras_oficiais),
    menorPrazo: inteiro(linha.menor_prazo),
    prazoMedio: numero(linha.prazo_medio),
    rotas: inteiro(linha.rotas),
    rotasOficiais: inteiro(linha.rotas_oficiais),
    rotasBaixaCobertura: inteiro(linha.rotas_baixa_cobertura),
    ufsSemCoberturaOficial: inteiro(linha.ufs_sem_cobertura_oficial),
  };
}

// Cobertura por UF destino, jÃ¡ mesclada com o esqueleto das 27 UFs.
export async function carregarMapaUfAvaliacao(filtros = {}) {
  const supabase = exigirSupabase();
  const { data, error } = await supabase.rpc('rpc_avaliacao_prazos_uf', montarParametrosRpc(filtros));
  tratarErroRpc(error, 'o mapa por UF');

  const porUf = new Map((data || []).map((item) => [upper(item.uf), item]));
  return UFS_BRASIL.map((uf) => {
    const item = porUf.get(uf);
    return {
      uf,
      regiao: obterRegiaoPorUf(uf),
      qtdRotas: inteiro(item?.qtd_rotas),
      qtdTransportadoras: inteiro(item?.qtd_transportadoras),
      qtdTransportadorasOficiais: inteiro(item?.qtd_transportadoras_oficiais),
      menorPrazo: inteiro(item?.menor_prazo),
      menorPrazoOficial: inteiro(item?.menor_prazo_oficial),
      prazoMedio: numero(item?.prazo_medio),
    };
  }).sort((a, b) => a.regiao.localeCompare(b.regiao) || a.uf.localeCompare(b.uf));
}

function mapearRotaRpc(item = {}) {
  return {
    rotaKey: texto(item.rota_key),
    rotaLabel: texto(item.rota_label),
    canal: upper(item.canal) || 'N/I',
    regiaoOrigem: texto(item.regiao_origem),
    regiaoDestino: texto(item.regiao_destino),
    qtdTransportadoras: inteiro(item.qtd_transportadoras),
    qtdTransportadorasOficiais: inteiro(item.qtd_transportadoras_oficiais),
    qtdTransportadorasNegociacao: inteiro(item.qtd_transportadoras_negociacao),
    menorPrazo: inteiro(item.menor_prazo),
    maiorPrazo: inteiro(item.maior_prazo),
    prazoMedio: numero(item.prazo_medio),
    melhoresTransportadoras: texto(item.melhores_transportadoras)
      ? texto(item.melhores_transportadoras).split(',').map((t) => t.trim()).filter(Boolean)
      : [],
  };
}

// Rotas consolidadas. opcoes: { ordem, maxOficiais, somenteComPrazo, limite, offset }.
export async function carregarRotasAvaliacao(filtros = {}, opcoes = {}) {
  const supabase = exigirSupabase();
  const params = {
    ...montarParametrosRpc(filtros),
    p_ordem: opcoes.ordem || 'COBERTURA',
    p_max_oficiais: opcoes.maxOficiais ?? null,
    p_somente_com_prazo: Boolean(opcoes.somenteComPrazo),
    p_limite: opcoes.limite ?? 500,
    p_offset: opcoes.offset ?? 0,
  };
  const { data, error } = await supabase.rpc('rpc_avaliacao_prazos_rotas', params);
  tratarErroRpc(error, 'as rotas consolidadas');
  const linhas = data || [];
  return {
    rotas: linhas.map(mapearRotaRpc),
    total: inteiro(linhas[0]?.total),
  };
}

function mapearRotaRpcParaLacuna(rota = {}) {
  return {
    rotaKey: rota.rotaKey,
    rotaLabel: rota.rotaLabel,
    cidadeOrigem: '',
    ufOrigem: '',
    regiaoOrigem: rota.regiaoOrigem,
    cidadeDestino: '',
    ufDestino: '',
    regiaoDestino: rota.regiaoDestino,
    ibgeDestino: '',
    canal: rota.canal,
    qtdTransportadorasOficiais: rota.qtdTransportadorasOficiais,
    qtdTransportadoras: rota.qtdTransportadoras,
    qtdTransportadorasNegociacao: rota.qtdTransportadorasNegociacao,
    menorPrazoOficial: rota.menorPrazo,
  };
}

export async function carregarLacunasServidorAvaliacao(filtros = {}) {
  const rotasResp = await carregarRotasAvaliacao(filtros, { ordem: 'COBERTURA', maxOficiais: 1, limite: 2000 });
  const rotas = (rotasResp.rotas || []).map(mapearRotaRpcParaLacuna);
  return consolidarLacunasDeRotas(rotas);
}

function mapearKpisRpcPayload(payload = {}) {
  return {
    registros: inteiro(payload.registros),
    oficiais: inteiro(payload.oficiais),
    negociacao: inteiro(payload.negociacao),
    transportadoras: inteiro(payload.transportadoras),
    transportadorasOficiais: inteiro(payload.transportadoras_oficiais),
    menorPrazo: inteiro(payload.menor_prazo),
    prazoMedio: numero(payload.prazo_medio),
    rotas: inteiro(payload.rotas),
    rotasOficiais: inteiro(payload.rotas_oficiais),
    rotasBaixaCobertura: inteiro(payload.rotas_baixa_cobertura),
    ufsSemCoberturaOficial: inteiro(payload.ufs_sem_cobertura_oficial),
  };
}

function mapearMapaRpcLista(lista = []) {
  const porUf = new Map((lista || []).map((item) => [upper(item.uf), item]));
  return UFS_BRASIL.map((uf) => {
    const item = porUf.get(uf);
    return {
      uf,
      regiao: obterRegiaoPorUf(uf),
      qtdRotas: inteiro(item?.qtd_rotas),
      qtdTransportadoras: inteiro(item?.qtd_transportadoras),
      qtdTransportadorasOficiais: inteiro(item?.qtd_transportadoras_oficiais),
      menorPrazo: inteiro(item?.menor_prazo),
      menorPrazoOficial: inteiro(item?.menor_prazo_oficial),
      prazoMedio: numero(item?.prazo_medio),
    };
  }).sort((a, b) => a.regiao.localeCompare(b.regiao) || a.uf.localeCompare(b.uf));
}

function mapearLacunasRpcLista(lista = []) {
  const itens = (lista || []).map((item) => {
    const rota = mapearRotaRpcParaLacuna(mapearRotaRpc(item));
    if ((rota.qtdTransportadorasOficiais || 0) === 0) {
      return montarItemLacuna(rota, 'SEM_COBERTURA_OFICIAL', {
        severidade: 'critico',
        detalhe: rota.qtdTransportadorasNegociacao > 0 ? 'Somente negociação/reajuste' : 'Sem tabela oficial',
      });
    }
    return montarItemLacuna(rota, 'UMA_OFICIAL', {
      severidade: 'alerta',
      detalhe: 'Apenas uma transportadora oficial',
    });
  });
  return montarResumoLacunas(itens);
}

async function carregarAnaliseCompletaRpc(filtros = {}) {
  const supabase = exigirSupabase();
  const params = {
    ...montarParametrosRpc(filtros),
    p_limite_rotas_criticas: 500,
    p_limite_melhores: 20,
    p_limite_lacunas: 2000,
  };
  const { data, error } = await supabase.rpc('rpc_avaliacao_prazos_analise_completa', params);
  tratarErroRpc(error, 'a análise consolidada do recorte');
  return data || {};
}

async function carregarAnaliseAgregadaServidorSequencial(filtros = {}, { limiteRelatorio = 300, totalRecorte = 0, onProgress } = {}) {
  const kpis = await carregarKpisAvaliacao(filtros);
  if (typeof onProgress === 'function') onProgress({ baixado: 0, total: totalRecorte, percentual: 30 });

  const mapa = await carregarMapaUfAvaliacao(filtros);
  if (typeof onProgress === 'function') onProgress({ baixado: 0, total: totalRecorte, percentual: 50 });

  const rotasCriticas = await carregarRotasAvaliacao(filtros, { ordem: 'COBERTURA', maxOficiais: 1, limite: 500 });
  if (typeof onProgress === 'function') onProgress({ baixado: 0, total: totalRecorte, percentual: 65 });

  const melhoresPrazos = await carregarRotasAvaliacao(filtros, { ordem: 'PRAZO', somenteComPrazo: true, limite: 20 });
  const lacunas = await carregarLacunasServidorAvaliacao(filtros);
  if (typeof onProgress === 'function') onProgress({ baixado: 0, total: totalRecorte, percentual: 80 });

  const linhasPagina = await carregarLinhasAvaliacao(filtros, {
    limite: limiteRelatorio,
    offset: 0,
    contar: true,
  });

  if (typeof onProgress === 'function') {
    onProgress({ baixado: totalRecorte, total: totalRecorte, percentual: 100 });
  }

  return {
    kpis,
    mapa,
    rotasCriticas: rotasCriticas.rotas,
    melhoresPrazos: melhoresPrazos.rotas,
    lacunas,
    linhas: linhasPagina.linhas,
    totalLinhas: linhasPagina.total ?? totalRecorte,
    limitado: false,
    modo: 'servidor',
  };
}

async function carregarAnaliseAgregadaServidor(filtros = {}, { limiteRelatorio = 300, totalRecorte = 0, onProgress } = {}) {
  if (typeof onProgress === 'function') {
    onProgress({ baixado: 0, total: totalRecorte, percentual: 10 });
  }

  try {
    const pacote = await carregarAnaliseCompletaRpc(filtros);

    if (typeof onProgress === 'function') {
      onProgress({ baixado: 0, total: totalRecorte, percentual: 70 });
    }

    const linhasPagina = await carregarLinhasAvaliacao(filtros, {
      limite: limiteRelatorio,
      offset: 0,
      contar: true,
    });

    if (typeof onProgress === 'function') {
      onProgress({ baixado: totalRecorte, total: totalRecorte, percentual: 100 });
    }

    return {
      kpis: mapearKpisRpcPayload(pacote.kpis),
      mapa: mapearMapaRpcLista(pacote.mapa),
      rotasCriticas: (pacote.rotas_criticas || []).map(mapearRotaRpc),
      melhoresPrazos: (pacote.melhores_prazos || []).map(mapearRotaRpc),
      lacunas: mapearLacunasRpcLista(pacote.lacunas),
      linhas: linhasPagina.linhas,
      totalLinhas: linhasPagina.total ?? totalRecorte,
      limitado: false,
      modo: 'servidor',
    };
  } catch (error) {
    if (/does not exist|schema cache/i.test(error.message || '')) {
      return carregarAnaliseAgregadaServidorSequencial(filtros, { limiteRelatorio, totalRecorte, onProgress });
    }
    if (erroIndicaTimeout(error.message)) {
      return carregarAnaliseAgregadaServidorSequencial(filtros, { limiteRelatorio, totalRecorte, onProgress });
    }
    throw error;
  }
}


function aplicarFiltroUfOrigem(consulta, uf) {
  const ufNorm = upper(uf).slice(0, 2);
  const prefixo = UF_IBGE_PREFIXO[ufNorm];
  if (prefixo) return consulta.or(`uf_origem_f.eq.${ufNorm},ibge_origem.like.${prefixo}%`);
  return consulta.eq('uf_origem_f', ufNorm);
}

function aplicarFiltroRegiaoOrigem(consulta, regiao) {
  const ufs = REGIOES_BRASIL[upper(regiao)] || [];
  const partes = [];
  ufs.forEach((uf) => {
    partes.push(`uf_origem_f.eq.${uf}`);
    if (UF_IBGE_PREFIXO[uf]) partes.push(`ibge_origem.like.${UF_IBGE_PREFIXO[uf]}%`);
  });
  if (!partes.length) return consulta;
  return consulta.or(partes.join(','));
}

function aplicarFiltrosMv(consulta, filtros = {}) {
  const params = montarParametrosRpc(filtros);

  if (params.p_fonte) consulta = consulta.eq('fonte_tabela', params.p_fonte);
  if (params.p_canal) consulta = consulta.eq('canal_f', upper(params.p_canal));
  if (params.p_tipo_tabela) consulta = consulta.eq('tipo_tabela_f', upper(params.p_tipo_tabela));
  if (params.p_status) consulta = consulta.eq('status_f', upper(params.p_status));
  if (params.p_transportadora) consulta = consulta.eq('transportadora_norm', normalizar(params.p_transportadora));
  if (params.p_modalidade) consulta = consulta.eq('modalidade_norm', normalizar(params.p_modalidade));

  if (params.p_regiao_origem) consulta = aplicarFiltroRegiaoOrigem(consulta, params.p_regiao_origem);
  if (params.p_uf_origem) consulta = aplicarFiltroUfOrigem(consulta, params.p_uf_origem);

  if (params.p_uf_destino) {
    const uf = upper(params.p_uf_destino).slice(0, 2);
    const prefixo = UF_IBGE_PREFIXO[uf];
    if (prefixo) consulta = consulta.or(`uf_destino_f.eq.${uf},ibge_destino.like.${prefixo}%`);
    else consulta = consulta.eq('uf_destino_f', uf);
  }

  if (params.p_regiao_destino) {
    const ufs = REGIOES_BRASIL[upper(params.p_regiao_destino)] || [];
    const partes = [];
    ufs.forEach((uf) => {
      partes.push(`uf_destino_f.eq.${uf}`);
      if (UF_IBGE_PREFIXO[uf]) partes.push(`ibge_destino.like.${UF_IBGE_PREFIXO[uf]}%`);
    });
    if (partes.length) consulta = consulta.or(partes.join(','));
  }

  if (params.p_com_prazo === 'COM_PRAZO') consulta = consulta.gt('prazo', 0);
  if (params.p_com_prazo === 'SEM_PRAZO') consulta = consulta.or('prazo.is.null,prazo.lte.0');

  if (params.p_busca) {
    consulta = consulta.ilike('busca_norm', `%${normalizar(params.p_busca)}%`);
  }

  return consulta;
}

async function carregarPaginaLinhasMv(filtros = {}, { limite = 500, offset = 0, contar = false } = {}) {
  const supabase = exigirSupabase();

  let consulta = supabase
    .from('mvw_avaliacao_prazos_cobertura')
    .select(CAMPOS_VIEW, contar ? { count: 'exact' } : undefined);

  consulta = aplicarFiltrosMv(consulta, filtros)
    .order('fonte_prioridade', { ascending: true, nullsFirst: false })
    .order('transportadora', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .range(offset, offset + limite - 1);

  const { data, error, count } = await consulta;
  tratarErroRpc(error, 'as linhas paginadas do recorte');

  return {
    linhas: (data || []).map(montarLinhaCobertura),
    total: contar ? inteiro(count) : null,
  };
}


// Contagem rápida do recorte (head + count exact na MV).
export async function contarRecorteAvaliacao(filtros = {}) {
  const supabase = exigirSupabase();
  let consulta = supabase
    .from('mvw_avaliacao_prazos_cobertura')
    .select('id', { count: 'exact', head: true });
  consulta = aplicarFiltrosMv(consulta, filtros);
  const { count, error } = await consulta;
  tratarErroRpc(error, 'a contagem do recorte');
  return inteiro(count);
}

// Linhas detalhadas paginadas — prefere RPC (filtrada); MV direta como fallback.
async function carregarLinhasAvaliacaoRpc(filtros = {}, { limite = 500, offset = 0, contar = false } = {}) {
  const supabase = exigirSupabase();
  const params = {
    ...montarParametrosRpc(filtros),
    p_limite: limite,
    p_offset: offset,
  };
  const { data, error } = await supabase.rpc('rpc_avaliacao_prazos_linhas', params);
  tratarErroRpc(error, 'as linhas paginadas do recorte (RPC)');
  const linhas = (data || []).map((item) => montarLinhaCobertura({
    id: item.id,
    tabela_negociacao_id: item.tabela_negociacao_id,
    transportadora: item.transportadora,
    canal: item.canal,
    tipo_tabela: item.tipo_tabela,
    tipo_negociacao: item.tipo_negociacao,
    status: item.status,
    tabela_nome: item.tabela_nome,
    origem_importacao: item.origem_importacao,
    modalidade: item.modalidade,
    cidade_origem: item.cidade_origem,
    uf_origem: item.uf_origem,
    ibge_origem: item.ibge_origem,
    cidade_destino: item.cidade_destino,
    uf_destino: item.uf_destino,
    ibge_destino: item.ibge_destino,
    prazo: item.prazo,
    valor_referencia: item.valor_referencia,
    observacao: item.observacao,
    fonte_tabela: item.fonte_tabela,
    fonte_label: item.fonte_label,
    fonte_prioridade: item.fonte_prioridade,
  }));
  return {
    linhas,
    total: contar ? inteiro(data?.[0]?.total) : null,
  };
}

export async function carregarLinhasAvaliacao(filtros = {}, opcoes = {}) {
  const config = {
    limite: opcoes.limite ?? 500,
    offset: opcoes.offset ?? 0,
    contar: Boolean(opcoes.contar ?? opcoes.offset === 0),
  };

  try {
    return await carregarLinhasAvaliacaoRpc(filtros, config);
  } catch (error) {
    if (!erroIndicaTimeout(error.message) && !/does not exist|schema cache/i.test(error.message || '')) {
      throw error;
    }
    return carregarPaginaLinhasMv(filtros, config);
  }
}

export function consolidarKpisDeLinhas(linhas = [], rotasPrecalculadas = null) {
  const transportadoras = new Set();
  const transportadorasOficiais = new Set();
  const prazos = criarAcumuladorPrazos();
  let oficiais = 0;
  let negociacao = 0;

  linhas.forEach((linha) => {
    const transp = normalizar(linha.transportadora);
    if (transp) transportadoras.add(transp);
    if (linha.fonteTabela === 'OFICIAL') {
      oficiais += 1;
      if (transp) transportadorasOficiais.add(transp);
    } else {
      negociacao += 1;
    }
    acumularPrazo(prazos, linha.prazo);
  });

  const resumoPrazos = resumirAcumuladorPrazos(prazos);
  const rotas = rotasPrecalculadas || consolidarRotas(linhas);
  const ufsComOficial = new Set(
    linhas.filter((linha) => linha.fonteTabela === 'OFICIAL' && linha.ufDestino).map((linha) => linha.ufDestino),
  );

  return {
    registros: linhas.length,
    oficiais,
    negociacao,
    transportadoras: transportadoras.size,
    transportadorasOficiais: transportadorasOficiais.size,
    menorPrazo: resumoPrazos.min,
    prazoMedio: resumoPrazos.media,
    rotas: rotas.length,
    rotasOficiais: rotas.filter((rota) => rota.qtdTransportadorasOficiais > 0).length,
    rotasBaixaCobertura: rotas.filter((rota) => rota.qtdTransportadorasOficiais <= 1).length,
    ufsSemCoberturaOficial: Math.max(0, 27 - ufsComOficial.size),
  };
}

async function carregarAnaliseConsolidadaCliente(
  filtros = {},
  {
    limiteMaximo = 80000,
    limiteRelatorio = 300,
    onProgress,
    shouldCancel,
  } = {},
) {
  const { linhas, total, limitado } = await carregarAnalisePaginadaAvaliacao(filtros, {
    lote: SUPABASE_LOTE_MAX,
    limiteMaximo,
    onProgress,
    shouldCancel,
  });

  const rotas = consolidarRotas(linhas);
  const mapa = consolidarUfDestino(linhas);
  const kpis = consolidarKpisDeLinhas(linhas, rotas);
  const lacunas = consolidarLacunas(linhas, rotas);

  return {
    kpis,
    mapa,
    rotasCriticas: rotas
      .filter((rota) => rota.qtdTransportadorasOficiais <= 1)
      .sort((a, b) => a.qtdTransportadorasOficiais - b.qtdTransportadorasOficiais || a.qtdTransportadoras - b.qtdTransportadoras)
      .slice(0, 500),
    melhoresPrazos: rotas
      .filter((rota) => rota.menorPrazo > 0)
      .sort((a, b) => a.menorPrazo - b.menorPrazo || b.qtdTransportadorasOficiais - a.qtdTransportadorasOficiais)
      .slice(0, 20),
    lacunas,
    linhas,
    totalLinhas: total ?? linhas.length,
    limitado,
    modo: 'cliente',
  };
}

function deveConsolidarNoCliente(filtros = {}, totalRecorte = 0) {
  if (totalRecorte <= 0) return false;
  // Recortes grandes ou regionais: agregação no Supabase (RPC), sem baixar tudo no navegador.
  if (totalRecorte > LIMITE_RPC_ANALISE) return false;
  if (String(filtros.regiaoOrigem || '').trim() || String(filtros.regiaoDestino || '').trim()) return false;
  // Recortes pequenos e específicos: consolidação local (fallback se RPC falhar).
  return totalRecorte <= 12000;
}

function recorteExigeAgregacaoServidor(filtros = {}, totalRecorte = 0) {
  return totalRecorte > LIMITE_RPC_ANALISE
    || Boolean(String(filtros.regiaoOrigem || '').trim() || String(filtros.regiaoDestino || '').trim());
}

// Agregados para a tela — RPC em recortes pequenos; consolidação paginada em recortes regionais.
export async function carregarAnaliseServidorAvaliacao(filtros = {}, opcoes = {}) {
  const limiteRelatorio = opcoes.limiteRelatorio ?? 300;
  const totalRecorte = inteiro(opcoes.totalRecorte ?? await contarRecorteAvaliacao(filtros));

  if (deveConsolidarNoCliente(filtros, totalRecorte)) {
    return carregarAnaliseConsolidadaCliente(filtros, {
      limiteMaximo: totalRecorte,
      limiteRelatorio,
      onProgress: opcoes.onProgress,
      shouldCancel: opcoes.shouldCancel,
    });
  }

  try {
    return await carregarAnaliseAgregadaServidor(filtros, {
      limiteRelatorio,
      totalRecorte,
      onProgress: opcoes.onProgress,
    });
  } catch (error) {
    if (!erroIndicaTimeout(error.message) && !/does not exist|schema cache/i.test(error.message || '')) throw error;

    if (recorteExigeAgregacaoServidor(filtros, totalRecorte)) {
      throw new Error(
        `Recorte com ${inteiro(totalRecorte).toLocaleString('pt-BR')} linhas: agregação no servidor expirou. `
        + 'No Supabase SQL Editor, rode supabase/APLICAR_4362_006_a_009.sql e depois '
        + 'supabase/migrations/20260609_010_avaliacao_prazos_analise_completa.sql',
      );
    }

    if (totalRecorte > LIMITE_CLIENTE_ANALISE) {
      throw new Error(
        `Recorte com ${inteiro(totalRecorte).toLocaleString('pt-BR')} linhas: agregação expirou. Refine UF/transportadora ou aplique migrations 006–009 no Supabase.`,
      );
    }

    return carregarAnaliseConsolidadaCliente(filtros, {
      limiteMaximo: totalRecorte,
      limiteRelatorio,
      onProgress: opcoes.onProgress,
      shouldCancel: opcoes.shouldCancel,
    });
  }
}

// Baixa um recorte inteiro em lotes controlados, no padrão usado no Simulador.
// Não calcula tudo no banco: traz páginas pequenas e deixa a tela consolidar os cards.
export async function carregarAnalisePaginadaAvaliacao(
  filtros = {},
  {
    lote = SUPABASE_LOTE_MAX,
    limiteMaximo = 350000,
    onProgress,
    shouldCancel,
  } = {}
) {
  const acumulado = [];
  let offset = 0;
  let total = null;
  const tamanhoLote = Math.min(Math.max(inteiro(lote) || SUPABASE_LOTE_MAX, 1), SUPABASE_LOTE_MAX);

  while (total === null || offset < total) {
    if (typeof shouldCancel === 'function' && shouldCancel()) {
      return { linhas: acumulado, total: total ?? acumulado.length, cancelado: true, limitado: false };
    }

    const limite = Math.min(tamanhoLote, Math.max(limiteMaximo - acumulado.length, 0));
    if (limite <= 0) {
      return { linhas: acumulado, total: total ?? acumulado.length, cancelado: false, limitado: true };
    }

    // eslint-disable-next-line no-await-in-loop
    const pagina = await carregarPaginaLinhasMv(filtros, {
      limite,
      offset,
      contar: offset === 0,
    });

    if (offset === 0) total = pagina.total ?? 0;

    if (!pagina.linhas.length) {
      break;
    }

    acumulado.push(...pagina.linhas);
    offset += pagina.linhas.length;

    if (typeof onProgress === 'function') {
      onProgress({
        baixado: acumulado.length,
        total: total ?? acumulado.length,
        lote: pagina.linhas.length,
        concluido: total !== null && acumulado.length >= total,
        limitado: acumulado.length >= limiteMaximo && total !== null && total > acumulado.length,
      });
    }

    if (total !== null && acumulado.length >= total) break;
    if (acumulado.length >= limiteMaximo) break;
  }

  return {
    linhas: acumulado,
    total: total ?? acumulado.length,
    cancelado: false,
    limitado: total !== null && acumulado.length < total,
  };
}

// Busca em lotes para exportação CSV respeitando filtros.
export async function buscarLinhasParaExport(filtros = {}, { teto = LIMITE_EXPORT_ANALISE, lote = SUPABASE_LOTE_MAX } = {}) {
  const acumulado = [];
  let offset = 0;
  let total = Infinity;
  const tamanhoLote = Math.min(Math.max(inteiro(lote) || SUPABASE_LOTE_MAX, 1), SUPABASE_LOTE_MAX);

  while (offset < total && acumulado.length < teto) {
    const limite = Math.min(tamanhoLote, teto - acumulado.length);
    // eslint-disable-next-line no-await-in-loop
    const { linhas, total: totalServidor } = await carregarLinhasAvaliacao(filtros, { limite, offset });
    if (Number.isFinite(totalServidor) && totalServidor >= 0) total = totalServidor;
    if (!linhas.length) break;
    acumulado.push(...linhas);
    offset += linhas.length;
    if (total !== Infinity && offset >= total) break;
  }
  return { linhas: acumulado, total: Number.isFinite(total) ? total : acumulado.length, limitado: acumulado.length < total };
}

// Recarrega a materialized view no servidor (botÃ£o "Atualizar base").
export async function refreshBaseAvaliacao() {
  const supabase = exigirSupabase();
  const { data, error } = await supabase.rpc('rpc_avaliacao_prazos_refresh');
  tratarErroRpc(error, 'a atualizaÃ§Ã£o da base');
  return data || new Date().toISOString();
}



