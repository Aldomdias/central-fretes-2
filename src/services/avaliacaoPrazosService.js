import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

export const REGIOES_BRASIL = {
  NORTE: ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'],
  NORDESTE: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
  'CENTRO-OESTE': ['DF', 'GO', 'MT', 'MS'],
  SUDESTE: ['ES', 'MG', 'RJ', 'SP'],
  SUL: ['PR', 'RS', 'SC'],
};

export const UFS_BRASIL = Object.values(REGIOES_BRASIL).flat();

const CAMPOS_PRAZO = [
  'prazo',
  'prazo_entrega',
  'prazo_dias',
  'prazo_em_dias',
  'lead_time',
  'leadtime',
  'dias_entrega',
  'tempo_entrega',
];

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

function obterPrazo(item = {}) {
  const dados = objetoSeguro(item.dados_originais);
  const valor = obterPrimeiro([item, dados], CAMPOS_PRAZO);
  return inteiro(valor);
}

export function obterRegiaoPorUf(uf = '') {
  const ufNormalizada = upper(uf).slice(0, 2);
  return Object.entries(REGIOES_BRASIL).find(([, ufs]) => ufs.includes(ufNormalizada))?.[0] || '';
}

function montarLinhaCobertura(tabela = {}, item = {}) {
  const dados = objetoSeguro(item.dados_originais);
  const cidadeOrigem = texto(obterPrimeiro([item, dados, tabela], ['cidade_origem', 'origem', 'cidadeOrigem']));
  const ufOrigem = upper(obterPrimeiro([item, dados, tabela], ['uf_origem', 'ufOrigem'])).slice(0, 2);
  const cidadeDestino = texto(obterPrimeiro([item, dados, tabela], ['cidade_destino', 'destino', 'cidadeDestino']));
  const ufDestino = upper(obterPrimeiro([item, dados, tabela], ['uf_destino', 'ufDestino'])).slice(0, 2);
  const transportadora = texto(obterPrimeiro([item, dados, tabela], ['transportadora', 'nome_transportadora', 'transportadora_nome']));
  const canal = upper(obterPrimeiro([item, dados, tabela], ['canal'])) || 'N/I';
  const tipoTabela = upper(obterPrimeiro([item, dados, tabela], ['tipo_tabela', 'tipoTabela'])) || 'N/I';
  const modalidade = texto(obterPrimeiro([tabela, item, dados], ['modalidade', 'tipo_veiculo', 'modalidade_tabela', 'tipoVeiculo']));
  const status = upper(obterPrimeiro([tabela, item, dados], ['status'])) || 'N/I';
  const prazo = obterPrazo(item);

  const rotaKey = [
    normalizar(cidadeOrigem),
    ufOrigem,
    normalizar(cidadeDestino),
    ufDestino,
    canal,
  ].join('|');

  return {
    id: item.id || `${tabela.id || 'sem-tabela'}-${rotaKey}-${transportadora}`,
    tabelaId: tabela.id || item.tabela_negociacao_id || '',
    tabelaNome: texto(tabela.descricao || tabela.nome || tabela.origem_importacao || tabela.id || 'Tabela sem descrição'),
    transportadora,
    canal,
    tipoTabela,
    tipoNegociacao: upper(tabela.tipo_negociacao || ''),
    modalidade,
    status,
    cidadeOrigem,
    ufOrigem,
    regiaoOrigem: obterRegiaoPorUf(ufOrigem),
    cidadeDestino,
    ufDestino,
    regiaoDestino: obterRegiaoPorUf(ufDestino),
    prazo,
    prazoLabel: prazo > 0 ? `${prazo} dia${prazo === 1 ? '' : 's'}` : 'Sem prazo',
    faixaPeso: texto(item.faixa_peso || dados.faixa_peso),
    tipoVeiculo: texto(item.tipo_veiculo || dados.tipo_veiculo),
    valorReferencia: numero(item.valor_lotacao || item.frete_minimo || item.taxa_aplicada || dados.valor_lotacao || dados.frete_minimo),
    observacao: texto(item.observacao || dados.observacao || tabela.observacao),
    rotaKey,
    rotaLabel: `${cidadeOrigem || 'Origem N/I'}${ufOrigem ? `/${ufOrigem}` : ''} → ${cidadeDestino || 'Destino N/I'}${ufDestino ? `/${ufDestino}` : ''}`,
  };
}

async function listarRotasAvaliacaoPrazos() {
  const supabase = getSupabaseClient();
  const pageSize = 1000;
  const campos = [
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

  const primeiraConsulta = await supabase
    .from('vw_avaliacao_prazos_cobertura')
    .select(campos, { count: 'exact' })
    .range(0, pageSize - 1);

  if (primeiraConsulta.error) {
    throw new Error(primeiraConsulta.error.message || 'Erro ao carregar rotas de prazos e cobertura.');
  }

  const total = Number(primeiraConsulta.count || 0);
  const paginas = [];
  for (let inicio = pageSize; inicio < total; inicio += pageSize) {
    paginas.push({ inicio, fim: Math.min(inicio + pageSize - 1, total - 1) });
  }

  const todos = [...(primeiraConsulta.data || [])];
  const concorrencia = 6;
  for (let indice = 0; indice < paginas.length; indice += concorrencia) {
    const grupo = paginas.slice(indice, indice + concorrencia);
    const resultados = await Promise.all(grupo.map(({ inicio, fim }) => (
      supabase
        .from('vw_avaliacao_prazos_cobertura')
        .select(campos)
        .range(inicio, fim)
    )));

    resultados.forEach(({ data, error }) => {
      if (error) throw new Error(error.message || 'Erro ao carregar rotas de prazos e cobertura.');
      todos.push(...(data || []));
    });
  }

  return todos;
}

export async function carregarAvaliacaoPrazosCobertura() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para carregar a avaliação de prazos.');
  }

  const supabase = getSupabaseClient();
  const { data: tabelas, error: erroTabelas } = await supabase
    .from('tabelas_negociacao')
    .select('*')
    .order('criado_em', { ascending: false });

  if (erroTabelas) throw new Error(erroTabelas.message || 'Erro ao carregar tabelas de negociação.');

  const rotas = await listarRotasAvaliacaoPrazos();
  const linhas = (rotas || [])
    .map((item) => montarLinhaCobertura({
      id: item.tabela_negociacao_id,
      descricao: item.tabela_nome,
      origem_importacao: item.origem_importacao,
      transportadora: item.transportadora,
      canal: item.canal,
      tipo_tabela: item.tipo_tabela,
      tipo_negociacao: item.tipo_negociacao,
      modalidade: item.modalidade,
      status: item.status,
      observacao: item.observacao,
    }, {
      ...item,
      valor_lotacao: item.valor_referencia,
    }))
    .filter((linha) => linha.transportadora && (linha.cidadeDestino || linha.ufDestino || linha.cidadeOrigem || linha.ufOrigem));

  return {
    tabelas: tabelas || [],
    linhas,
    carregadoEm: new Date().toISOString(),
  };
}

export function filtrarLinhasAvaliacao(linhas = [], filtros = {}) {
  const busca = normalizar(filtros.busca);
  return linhas.filter((linha) => {
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
        linha.transportadora,
        linha.canal,
        linha.tipoTabela,
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
        canal: linha.canal,
        linhas: [],
        transportadoras: new Set(),
        prazos: [],
      });
    }

    const rota = mapa.get(linha.rotaKey);
    rota.linhas.push(linha);
    rota.transportadoras.add(normalizar(linha.transportadora));
    if (linha.prazo > 0) rota.prazos.push(linha.prazo);
  });

  return Array.from(mapa.values()).map((rota) => {
    const menorPrazo = rota.prazos.length ? Math.min(...rota.prazos) : 0;
    const maiorPrazo = rota.prazos.length ? Math.max(...rota.prazos) : 0;
    const prazoMedio = rota.prazos.length ? rota.prazos.reduce((soma, valor) => soma + valor, 0) / rota.prazos.length : 0;
    const melhores = rota.linhas
      .filter((linha) => linha.prazo > 0 && linha.prazo === menorPrazo)
      .map((linha) => linha.transportadora)
      .filter(Boolean);

    return {
      ...rota,
      qtdTransportadoras: rota.transportadoras.size,
      qtdTabelas: rota.linhas.length,
      menorPrazo,
      maiorPrazo,
      prazoMedio,
      melhoresTransportadoras: [...new Set(melhores)],
    };
  }).sort((a, b) => a.qtdTransportadoras - b.qtdTransportadoras || a.menorPrazo - b.menorPrazo || a.rotaLabel.localeCompare(b.rotaLabel));
}

export function consolidarUfDestino(linhas = []) {
  const mapa = new Map(UFS_BRASIL.map((uf) => [uf, { uf, regiao: obterRegiaoPorUf(uf), rotas: new Set(), transportadoras: new Set(), prazos: [] }]));

  linhas.forEach((linha) => {
    const uf = linha.ufDestino;
    if (!uf) return;
    if (!mapa.has(uf)) mapa.set(uf, { uf, regiao: obterRegiaoPorUf(uf), rotas: new Set(), transportadoras: new Set(), prazos: [] });
    const item = mapa.get(uf);
    item.rotas.add(linha.rotaKey);
    item.transportadoras.add(normalizar(linha.transportadora));
    if (linha.prazo > 0) item.prazos.push(linha.prazo);
  });

  return Array.from(mapa.values()).map((item) => ({
    uf: item.uf,
    regiao: item.regiao,
    qtdRotas: item.rotas.size,
    qtdTransportadoras: item.transportadoras.size,
    menorPrazo: item.prazos.length ? Math.min(...item.prazos) : 0,
    prazoMedio: item.prazos.length ? item.prazos.reduce((soma, valor) => soma + valor, 0) / item.prazos.length : 0,
  })).sort((a, b) => a.regiao.localeCompare(b.regiao) || a.uf.localeCompare(b.uf));
}
