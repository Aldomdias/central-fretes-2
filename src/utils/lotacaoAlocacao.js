import { normalizarTexto, paraNumero } from './lotacaoTables.js';

// Fase 1 da Lotacao nativa: a carga deixa de ser "linha importada do Excel" e
// passa a ter ciclo de vida, dono do valor e trilha de alteracao.

export const STATUS_OPERACIONAL = [
  { id: 'PLANEJADA', label: 'Planejada', ordem: 1 },
  { id: 'EM_COTACAO', label: 'Em cotação', ordem: 2 },
  { id: 'ALOCADA', label: 'Alocada', ordem: 3 },
  { id: 'EM_TRANSITO', label: 'Em trânsito', ordem: 4 },
  { id: 'ENTREGUE', label: 'Entregue', ordem: 5 },
  { id: 'FATURADA', label: 'Faturada', ordem: 6 },
];

const STATUS_IDS = new Set(STATUS_OPERACIONAL.map((item) => item.id));

export const VALOR_FONTES = [
  { id: 'TABELA', label: 'Tabela vigente' },
  { id: 'COTACAO', label: 'Cotação' },
  { id: 'MANUAL', label: 'Manual' },
];

// Campos que passam a ser da Operacao: o import do fluxo nao pode sobrescrever
// o que foi preenchido aqui, senao a proxima planilha apaga a alocacao.
export const CAMPOS_DA_OPERACAO = [
  'status_operacional',
  'transportadora',
  'placa_cavalo',
  'placa_carreta',
  'valor_fonte',
  'valor_tabela',
  'valor_target',
  'valor_antt',
  'tabela_id',
  'tabela_nome',
  'tabela_rota_id',
  'alocado_em',
  'alocado_por',
  'observacao_alocacao',
];

export function normalizarStatusOperacional(status = '') {
  const bruto = normalizarTexto(status).replace(/\s+/g, '_');
  return STATUS_IDS.has(bruto) ? bruto : '';
}

export function labelStatusOperacional(status = '') {
  const id = normalizarStatusOperacional(status);
  return STATUS_OPERACIONAL.find((item) => item.id === id)?.label || id;
}

function temTransportadora(carga = {}) {
  return Boolean(normalizarTexto(carga.transportadora || ''));
}

function temPlaca(carga = {}) {
  return Boolean(normalizarTexto(carga.placaCavalo || ''));
}

// Carga importada do fluxo nao tem status_operacional. Em vez de mostrar tudo
// como "Planejada", deduz pelo que a planilha ja preencheu.
export function derivarStatusOperacional(carga = {}) {
  const explicito = normalizarStatusOperacional(carga.statusOperacional);
  if (explicito) return explicito;

  const temCte = Boolean(carga.cteRaw) || (Array.isArray(carga.ctes) && carga.ctes.length > 0);
  if (carga.finalizado || temCte) return 'FATURADA';
  if (carga.descarga) return 'ENTREGUE';
  if (carga.coletaRealizada) return 'EM_TRANSITO';
  if (temTransportadora(carga) && temPlaca(carga)) return 'ALOCADA';
  return 'PLANEJADA';
}

export function valorAutorizadoCarga(carga = {}) {
  const candidatos = [carga.valorComparacao, carga.freteCantu, carga.freteTransp];
  for (const item of candidatos) {
    const numero = paraNumero(item);
    if (numero !== null && numero > 0) return numero;
  }
  return 0;
}

export function pendenciasDaCarga(carga = {}) {
  const pendencias = [];
  const status = derivarStatusOperacional(carga);
  const encerrada = status === 'ENTREGUE' || status === 'FATURADA';
  const valor = valorAutorizadoCarga(carga);

  if (!temTransportadora(carga)) pendencias.push({ id: 'SEM_TRANSPORTADORA', label: 'Sem transportadora', grave: true });
  if (!temPlaca(carga) && !encerrada) pendencias.push({ id: 'SEM_PLACA', label: 'Sem placa', grave: false });
  if (valor <= 0) pendencias.push({ id: 'SEM_VALOR', label: 'Sem valor autorizado', grave: true });
  if (!normalizarTexto(carga.tipoVeiculo || '')) pendencias.push({ id: 'SEM_TIPO_VEICULO', label: 'Sem tipo de veículo', grave: false });

  const target = paraNumero(carga.valorTarget);
  if (valor > 0 && target !== null && target > 0 && valor > target * 1.0001) {
    pendencias.push({ id: 'ACIMA_TARGET', label: 'Valor acima do target', grave: true });
  }

  const antt = paraNumero(carga.valorAntt);
  if (valor > 0 && antt !== null && antt > 0 && valor < antt * 0.9999) {
    pendencias.push({ id: 'ABAIXO_ANTT', label: 'Valor abaixo do piso ANTT', grave: true });
  }

  if (temTransportadora(carga) && valor > 0 && !carga.valorFonte) {
    pendencias.push({ id: 'SEM_ORIGEM_VALOR', label: 'Origem do valor não registrada', grave: false });
  }

  return pendencias;
}

function mesmaRota(linha, carga) {
  return normalizarTexto(linha.origem) === normalizarTexto(carga.origem)
    && normalizarTexto(linha.destino) === normalizarTexto(carga.destino);
}

function mesmoTipo(linha, carga) {
  const tipoCarga = normalizarTexto(carga.tipoVeiculo || '');
  if (!tipoCarga) return true;
  const tipoLinha = normalizarTexto(linha.tipo || '');
  if (!tipoLinha) return false;
  return tipoLinha === tipoCarga || tipoLinha.includes(tipoCarga) || tipoCarga.includes(tipoLinha);
}

export function tabelaVigenteNaData(tabela = {}, dataRef = null) {
  const inicio = tabela.vigenciaInicio ? new Date(tabela.vigenciaInicio) : null;
  const fim = tabela.vigenciaFim ? new Date(tabela.vigenciaFim) : null;
  if (!inicio && !fim) return true; // tabela sem vigencia declarada continua valendo
  const ref = dataRef ? new Date(dataRef) : new Date();
  if (Number.isNaN(ref.getTime())) return true;
  if (inicio && !Number.isNaN(inicio.getTime()) && ref < inicio) return false;
  if (fim && !Number.isNaN(fim.getTime()) && ref > fim) return false;
  return true;
}

function pisoAnttDaRota(tabelas = [], carga = {}) {
  const antt = tabelas.find((tabela) => normalizarTexto(tabela.tipo) === 'ANTT');
  if (!antt) return null;
  const valores = (antt.linhas || [])
    .filter((linha) => mesmaRota(linha, carga) && mesmoTipo(linha, carga))
    .map((linha) => paraNumero(linha.valor))
    .filter((valor) => valor !== null);
  if (!valores.length) return null;
  return Math.max(...valores);
}

// Ranking de transportadoras para a carga: casa origem+destino+tipo contra as
// tabelas cadastradas e devolve do mais barato para o mais caro.
export function rankingTransportadorasParaCarga(tabelas = [], carga = {}) {
  if (!carga?.origem || !carga?.destino) return [];
  const dataRef = carga.coletaPlanejada || carga.coletaRealizada || null;
  const opcoes = [];

  tabelas
    .filter((tabela) => normalizarTexto(tabela.tipo) !== 'ANTT')
    .filter((tabela) => tabelaVigenteNaData(tabela, dataRef))
    .forEach((tabela) => {
      (tabela.linhas || []).forEach((linha) => {
        if (!mesmaRota(linha, carga)) return;
        if (!mesmoTipo(linha, carga)) return;
        const valor = paraNumero(linha.valor);
        if (valor === null) return;
        opcoes.push({
          tabelaId: tabela.id,
          tabelaNome: tabela.nome,
          rotaId: linha.id,
          transportadora: linha.transportadora || tabela.nome,
          origem: linha.origem,
          destino: linha.destino,
          tipoVeiculo: linha.tipo || '',
          valor,
          target: paraNumero(linha.target),
          pedagio: paraNumero(linha.pedagio),
          prazo: linha.prazo || '',
          km: paraNumero(linha.km),
          freteAntt: paraNumero(linha.freteAntt),
          vigenciaInicio: tabela.vigenciaInicio || '',
          vigenciaFim: tabela.vigenciaFim || '',
        });
      });
    });

  // Mesma transportadora pode aparecer em varias linhas da mesma rota: fica a menor.
  const melhorPorTransportadora = new Map();
  opcoes.forEach((opcao) => {
    const chave = normalizarTexto(opcao.transportadora);
    const atual = melhorPorTransportadora.get(chave);
    if (!atual || opcao.valor < atual.valor) melhorPorTransportadora.set(chave, opcao);
  });

  const pisoAntt = pisoAnttDaRota(tabelas, carga);
  const lista = [...melhorPorTransportadora.values()].sort((a, b) => a.valor - b.valor);

  return lista.map((opcao, index) => ({
    ...opcao,
    posicao: index + 1,
    melhorPreco: index === 0,
    pisoAntt,
    abaixoAntt: pisoAntt !== null && opcao.valor < pisoAntt * 0.9999,
    acimaTarget: opcao.target !== null && opcao.target > 0 && opcao.valor > opcao.target * 1.0001,
    diferencaMelhor: index === 0 ? 0 : opcao.valor - lista[0].valor,
  }));
}

// Monta os campos da alocacao a partir da opcao escolhida no ranking. O valor
// vira snapshot na carga: reimportar a tabela depois nao muda o que foi autorizado.
export function montarAlocacaoPorTabela(opcao = {}, { usuario = '', observacao = '' } = {}) {
  return {
    statusOperacional: 'ALOCADA',
    transportadora: opcao.transportadora || '',
    valorFonte: 'TABELA',
    valorComparacao: opcao.valor ?? null,
    valorTabela: opcao.valor ?? null,
    valorTarget: opcao.target ?? null,
    valorAntt: opcao.pisoAntt ?? opcao.freteAntt ?? null,
    pedagio: opcao.pedagio ?? null,
    tabelaId: opcao.tabelaId || '',
    tabelaNome: opcao.tabelaNome || '',
    tabelaRotaId: opcao.rotaId || '',
    alocadoEm: new Date().toISOString(),
    alocadoPor: usuario || '',
    observacaoAlocacao: observacao || '',
  };
}

const ROTULOS_TRILHA = {
  statusOperacional: 'Status',
  transportadora: 'Transportadora',
  placaCavalo: 'Placa cavalo',
  placaCarreta: 'Placa carreta',
  valorComparacao: 'Valor autorizado',
  valorFonte: 'Origem do valor',
  tabelaNome: 'Tabela',
  observacaoAlocacao: 'Observação',
};

// Diff campo a campo para virar linha na trilha de auditoria.
export function diffAlocacao(cargaAntes = {}, alteracoes = {}) {
  const eventos = [];
  Object.entries(alteracoes).forEach(([campo, valorNovo]) => {
    if (!(campo in ROTULOS_TRILHA)) return;
    const anterior = cargaAntes[campo];
    if (String(anterior ?? '') === String(valorNovo ?? '')) return;
    eventos.push({
      campo: ROTULOS_TRILHA[campo],
      valorAnterior: anterior === null || anterior === undefined ? '' : String(anterior),
      valorNovo: valorNovo === null || valorNovo === undefined ? '' : String(valorNovo),
    });
  });
  return eventos;
}

function dataDia(valor) {
  if (!valor) return '';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return '';
  return data.toISOString().slice(0, 10);
}

// Painel diario: cargas filtradas, com as pendencias graves na frente.
export function montarPainelAlocacao(cargas = [], { data = '', status = '', origem = '', busca = '' } = {}) {
  const buscaKey = normalizarTexto(busca);
  const origemKey = normalizarTexto(origem);

  const lista = cargas
    .map((carga) => {
      const statusOperacional = derivarStatusOperacional(carga);
      const pendencias = pendenciasDaCarga(carga);
      return {
        ...carga,
        statusOperacional,
        statusLabel: labelStatusOperacional(statusOperacional),
        pendencias,
        temPendenciaGrave: pendencias.some((item) => item.grave),
        valorAutorizado: valorAutorizadoCarga(carga),
        diaColeta: dataDia(carga.coletaPlanejada || carga.coletaRealizada),
      };
    })
    .filter((carga) => {
      if (data && carga.diaColeta !== data) return false;
      if (status && carga.statusOperacional !== status) return false;
      if (origemKey && !normalizarTexto(carga.origem).includes(origemKey)) return false;
      if (buscaKey) {
        const alvo = [carga.dist, carga.destino, carga.transportadora, carga.placaCavalo, carga.referencia]
          .map((item) => normalizarTexto(item || ''))
          .join(' ');
        if (!alvo.includes(buscaKey)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.temPendenciaGrave !== b.temPendenciaGrave) return a.temPendenciaGrave ? -1 : 1;
      return String(a.diaColeta).localeCompare(String(b.diaColeta));
    });

  const porStatus = STATUS_OPERACIONAL.map((item) => ({
    ...item,
    total: lista.filter((carga) => carga.statusOperacional === item.id).length,
  }));

  return {
    cargas: lista,
    porStatus,
    total: lista.length,
    comPendencia: lista.filter((carga) => carga.pendencias.length > 0).length,
    comPendenciaGrave: lista.filter((carga) => carga.temPendenciaGrave).length,
  };
}
