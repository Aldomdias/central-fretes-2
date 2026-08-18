export * from './freteDatabaseService.base.js';
import * as base from './freteDatabaseService.base.js';

function normalizarNomeTransportadora(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\b(LTDA|EIRELI|S\/?A|SA|ME|EPP)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function selecionarTransportadoraExata(baseTransportadoras = [], nomeTransportadora = '') {
  const alvo = normalizarNomeTransportadora(nomeTransportadora);
  if (!alvo) return [];
  const lista = Array.isArray(baseTransportadoras) ? baseTransportadoras : [];

  const exatas = lista.filter((item) => normalizarNomeTransportadora(item?.nome) === alvo);
  if (exatas.length) return exatas;

  return lista.filter((item) => {
    const nome = normalizarNomeTransportadora(item?.nome);
    return nome && (nome.includes(alvo) || alvo.includes(nome));
  });
}

function destinosDaBaseSelecionada(baseTransportadoras = [], ufDestino = '') {
  const uf = String(ufDestino || '').trim().toUpperCase();
  const ufPorPrefixo = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
    '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC', '43': 'RS',
    '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
  };
  const destinos = new Set();
  (baseTransportadoras || []).forEach((transportadora) => {
    (transportadora?.origens || []).forEach((origem) => {
      (origem?.rotas || []).forEach((rota) => {
        const ibge = String(rota?.ibgeDestino || rota?.ibge_destino || '').replace(/\D/g, '').slice(0, 7);
        if (!ibge) return;
        if (uf && ufPorPrefixo[ibge.slice(0, 2)] !== uf) return;
        destinos.add(ibge);
      });
    });
  });
  return [...destinos];
}

export async function buscarBaseSimulacaoDb(args = {}) {
  const {
    nomeTransportadora = '',
    origem = '',
    canal = '',
    destinoCodigo = '',
    destinoCodigos = [],
    ufDestino = '',
  } = args || {};

  if (!String(nomeTransportadora || '').trim()) {
    return base.buscarBaseSimulacaoDb(args);
  }

  if (!String(origem || '').trim()) {
    const selecionada = await base.carregarBaseTransportadorasDb([nomeTransportadora]);
    return selecionarTransportadoraExata(selecionada, nomeTransportadora);
  }

  const baseSelecionadaBruta = await base.buscarBaseSimulacaoDb(args);
  const baseSelecionada = selecionarTransportadoraExata(baseSelecionadaBruta, nomeTransportadora);
  if (!baseSelecionada.length) return [];

  const destinosInformados = Array.from(new Set([
    ...(Array.isArray(destinoCodigos) ? destinoCodigos : []),
    destinoCodigo,
  ].map((item) => String(item || '').trim()).filter(Boolean)));

  const destinosAlvo = destinosInformados.length
    ? destinosInformados
    : destinosDaBaseSelecionada(baseSelecionada, ufDestino);

  if (!destinosAlvo.length) return baseSelecionada;

  const concorrentes = await base.buscarBaseSimulacaoDb({
    origem,
    canal,
    destinoCodigos: destinosAlvo,
    ufDestino,
  });

  return Array.isArray(concorrentes) && concorrentes.length ? concorrentes : baseSelecionada;
}
