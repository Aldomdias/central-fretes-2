export const STORAGE_KEYS = {
  rascunhos: 'formatacao_tabelas_rascunhos_v1',
  cadastros: 'formatacao_tabelas_cadastros_v1',
  ibge: 'formatacao_tabelas_ibge_v1',
  faixas: 'formatacao_tabelas_faixas_v1',
};

const UF_POR_CODIGO = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

const MUNICIPIOS_FIXOS = [
  { codigo_municipio_completo: '4208203', nome_municipio: 'Itajaí', nome_municipio_sem_acento: 'Itajai', uf: 'SC' },
  { codigo_municipio_completo: '4211306', nome_municipio: 'Navegantes', nome_municipio_sem_acento: 'Navegantes', uf: 'SC' },
  { codigo_municipio_completo: '3505708', nome_municipio: 'Barueri', nome_municipio_sem_acento: 'Barueri', uf: 'SP' },
  { codigo_municipio_completo: '3506003', nome_municipio: 'Bauru', nome_municipio_sem_acento: 'Bauru', uf: 'SP' },
  { codigo_municipio_completo: '3550308', nome_municipio: 'São Paulo', nome_municipio_sem_acento: 'Sao Paulo', uf: 'SP' },
  { codigo_municipio_completo: '3106200', nome_municipio: 'Belo Horizonte', nome_municipio_sem_acento: 'Belo Horizonte', uf: 'MG' },
  { codigo_municipio_completo: '3205002', nome_municipio: 'Serra', nome_municipio_sem_acento: 'Serra', uf: 'ES' },
  { codigo_municipio_completo: '5300108', nome_municipio: 'Brasília', nome_municipio_sem_acento: 'Brasilia', uf: 'DF' },
];

function uid(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function limparTexto(valor = '') {
  return String(valor ?? '').trim().replace(/\s+/g, ' ');
}

export function normalizarChave(valor = '') {
  return limparTexto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export function criarFormularioInicial() {
  return {
    id: uid('fmt'),
    nomeFormatacao: '',
    transportadoraModo: 'existente',
    transportadoraId: '',
    transportadoraNome: '',
    origemModo: 'existente',
    origemId: '',
    origemNome: '',
    codigoOrigem: '',
    origemIbge: '',
    canal: 'ATACADO',
    metodoEnvio: 'Normal',
    regraCalculo: 'Sem regra',
    tipoCalculo: 'FAIXA_PESO',
    modeloFaixaId: 'b2b-padrao',
    vigenciaInicial: '',
    vigenciaFinal: '',
  };
}

export function criarRotaInicial() {
  return {
    id: uid('rota'),
    ibgeDestino: '',
    prazo: '',
    cotacaoBase: 'Interior 1',
  };
}

export function criarQuebraFaixaInicial() {
  return {
    id: uid('qf'),
    ibgeDestino: '',
    prazo: '',
    cotacaoBase: 'Interior 1',
    cepInicial: '',
    cepFinal: '',
  };
}

export function criarFreteInicial() {
  return {
    id: uid('frete'),
    cotacao: '',
    cotacaoBase: '',
    faixaNome: '',
    pesoInicial: '',
    pesoFinal: '',
    freteValor: '',
    fretePercentual: '',
    freteMinimo: '',
    taxaAplicada: '',
    excedente: '',
    origemImportacao: 'manual',
  };
}

export function carregarRascunhos() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.rascunhos) || '[]');
  } catch {
    return [];
  }
}

export function salvarRascunhos(lista = []) {
  localStorage.setItem(STORAGE_KEYS.rascunhos, JSON.stringify(lista));
}

export function construirCadastroBase(transportadoras = []) {
  const base = { transportadoras: [], origens: [] };
  const transportadorasLista = Array.isArray(transportadoras) ? transportadoras : [];

  base.transportadoras = transportadorasLista.map((item) => ({
    id: item.id,
    nome: item.nome,
    status: item.status,
  }));

  base.origens = transportadorasLista.flatMap((transportadora) =>
    (transportadora.origens || []).map((origem) => ({
      id: origem.id,
      transportadoraId: transportadora.id,
      transportadoraNome: transportadora.nome,
      nome: origem.cidade || origem.nome || '',
      canal: origem.canal || 'ATACADO',
      codigo: origem.codigo || origem.codigoOrigem || origem.codigo_unidade || `UND${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`,
      ibge: origem.ibge || origem.ibgeOrigem || origem.codigoIbge || '',
    }))
  );

  return base;
}

export function encontrarTransportadoraExistente(cadastros, idOuNome) {
  const chave = normalizarChave(idOuNome);
  return (cadastros?.transportadoras || []).find(
    (item) => item.id === idOuNome || normalizarChave(item.nome) === chave
  );
}

export function encontrarOrigemExistente(cadastros, idOuNome) {
  const chave = normalizarChave(idOuNome);
  return (cadastros?.origens || []).find(
    (item) => item.id === idOuNome || normalizarChave(item.nome) === chave
  );
}

export function proximoCodigoOrigem(cadastros) {
  const numeros = (cadastros?.origens || [])
    .map((item) => String(item.codigo || '').match(/(\d+)/))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);

  const proximo = (numeros.length ? Math.max(...numeros) : 0) + 1;
  return `UND${String(proximo).padStart(3, '0')}`;
}

export function modelosFaixaPadrao() {
  return [
    {
      id: 'b2c-padrao',
      nome: 'B2C padrão',
      canal: 'B2C',
      itens: [
        { id: uid('fx'), pesoInicial: 0, pesoFinal: 2 },
        { id: uid('fx'), pesoInicial: 2, pesoFinal: 5 },
        { id: uid('fx'), pesoInicial: 5, pesoFinal: 10 },
        { id: uid('fx'), pesoInicial: 10, pesoFinal: 15 },
        { id: uid('fx'), pesoInicial: 15, pesoFinal: 20 },
      ],
    },
    {
      id: 'b2b-padrao',
      nome: 'B2B padrão',
      canal: 'ATACADO',
      itens: [
        { id: uid('fx'), pesoInicial: 0, pesoFinal: 20 },
        { id: uid('fx'), pesoInicial: 20, pesoFinal: 30 },
        { id: uid('fx'), pesoInicial: 30, pesoFinal: 50 },
        { id: uid('fx'), pesoInicial: 50, pesoFinal: 70 },
        { id: uid('fx'), pesoInicial: 70, pesoFinal: 100 },
      ],
    },
  ];
}

export function carregarModelosFaixa() {
  try {
    const salvos = JSON.parse(localStorage.getItem(STORAGE_KEYS.faixas) || 'null');
    if (Array.isArray(salvos) && salvos.length) return salvos;
  } catch {}
  const padrao = modelosFaixaPadrao();
  localStorage.setItem(STORAGE_KEYS.faixas, JSON.stringify(padrao));
  return padrao;
}

export function salvarModelosFaixa(modelos = []) {
  localStorage.setItem(STORAGE_KEYS.faixas, JSON.stringify(modelos));
}

export function adicionarModeloFaixa(modelos = [], modelo) {
  return [...modelos, { ...modelo, id: modelo.id || uid('faixa-modelo') }];
}

export function atualizarModeloFaixa(modelos = [], modeloAtualizado) {
  return modelos.map((item) => (item.id === modeloAtualizado.id ? modeloAtualizado : item));
}

export function carregarBaseIbge() {
  try {
    const base = JSON.parse(localStorage.getItem(STORAGE_KEYS.ibge) || '[]');
    if (Array.isArray(base) && base.length) return base;
  } catch {}
  return MUNICIPIOS_FIXOS;
}

export function salvarBaseIbge(base = []) {
  localStorage.setItem(STORAGE_KEYS.ibge, JSON.stringify(base));
}

export function obterUfPorCodigoIbge(ibge = '') {
  const codigo = String(ibge || '').replace(/\D/g, '').slice(0, 2);
  return UF_POR_CODIGO[codigo] || '';
}

export function obterUfDoDestino(ibgeDestino, baseIbge = []) {
  const chave = String(ibgeDestino || '').replace(/\D/g, '');
  if (!chave) return '';
  const lista = baseIbge?.length ? baseIbge : MUNICIPIOS_FIXOS;
  const item = lista.find((registro) => {
    const codigo = String(
      registro.codigo_municipio_completo ??
      registro.codigoMunicipioCompleto ??
      registro.codigo ??
      registro.ibge ??
      registro.municipio_ibge ??
      ''
    ).replace(/\D/g, '');
    return codigo === chave;
  });
  return limparTexto(item?.uf || item?.sigla_uf || item?.UF || obterUfPorCodigoIbge(chave)).toUpperCase();
}

export function encontrarMunicipioPorNome(baseIbge = [], nome = '') {
  const chave = normalizarChave(nome);
  if (!chave) return null;
  const lista = baseIbge?.length ? baseIbge : MUNICIPIOS_FIXOS;
  return lista.find((item) => {
    const candidatos = [item.nome_municipio, item.municipio, item.nome, item.nome_municipio_sem_acento]
      .filter(Boolean)
      .map((valor) => normalizarChave(valor));
    return candidatos.some((valor) => valor === chave || valor.includes(chave) || chave.includes(valor));
  }) || null;
}

export function montarCotacaoPadrao({ origem, ufDestino, cotacaoBase }) {
  return [limparTexto(origem), limparTexto(ufDestino).toUpperCase(), limparTexto(cotacaoBase)]
    .filter(Boolean)
    .join(' - ');
}

export function aplicarCotacaoPadraoNasRotas(rotas = [], dadosGerais = {}, baseIbge = []) {
  const origem = dadosGerais.origemNome || dadosGerais.origem || '';
  return (rotas || []).map((rota) => {
    const ufDestino = obterUfDoDestino(rota.ibgeDestino, baseIbge);
    const cotacao = montarCotacaoPadrao({ origem, ufDestino, cotacaoBase: rota.cotacaoBase || rota.cotacao || '' });
    return { ...rota, cotacao, cotacaoFinal: cotacao };
  });
}

export function obterCotacoesUnicasDasRotas(rotas = [], dadosGerais = {}, baseIbge = []) {
  const mapa = new Map();
  for (const rota of aplicarCotacaoPadraoNasRotas(rotas, dadosGerais, baseIbge)) {
    const chave = normalizarChave(rota.cotacaoFinal || rota.cotacao);
    if (chave && !mapa.has(chave)) mapa.set(chave, rota.cotacaoFinal || rota.cotacao);
  }
  return Array.from(mapa.values());
}

export function gerarFretesPorCotacaoFaixa({ rotas = [], dadosGerais = {}, baseIbge = [], tipoCalculo = 'FAIXA_PESO', modeloFaixa = null }) {
  const cotacoes = obterCotacoesUnicasDasRotas(rotas, dadosGerais, baseIbge);
  if (tipoCalculo === 'PERCENTUAL') {
    return cotacoes.map((cotacao) => ({
      ...criarFreteInicial(),
      cotacao,
      origemImportacao: 'gerado',
    }));
  }

  const itens = modeloFaixa?.itens || [];
  const linhas = [];
  cotacoes.forEach((cotacao) => {
    itens.forEach((faixa) => {
      linhas.push({
        ...criarFreteInicial(),
        cotacao,
        faixaNome: `${faixa.pesoInicial} a ${faixa.pesoFinal}`,
        pesoInicial: faixa.pesoInicial,
        pesoFinal: faixa.pesoFinal,
        origemImportacao: 'gerado',
      });
    });
  });
  return linhas;
}

export function validarModeloFaixa(modelo) {
  const erros = [];
  const itens = [...(modelo?.itens || [])].map((item) => ({
    ...item,
    pesoInicial: Number(item.pesoInicial),
    pesoFinal: Number(item.pesoFinal),
  }));
  if (!limparTexto(modelo?.nome)) erros.push('Informe o nome do modelo de faixa.');
  itens.forEach((item, index) => {
    if (!Number.isFinite(item.pesoInicial) || !Number.isFinite(item.pesoFinal)) {
      erros.push(`Linha ${index + 1}: informe peso inicial e final.`);
    } else if (item.pesoFinal <= item.pesoInicial) {
      erros.push(`Linha ${index + 1}: peso final deve ser maior que o inicial.`);
    }
  });
  const ordenados = itens
    .filter((i) => Number.isFinite(i.pesoInicial) && Number.isFinite(i.pesoFinal))
    .sort((a, b) => a.pesoInicial - b.pesoInicial);
  for (let i = 1; i < ordenados.length; i += 1) {
    if (ordenados[i].pesoInicial < ordenados[i - 1].pesoFinal) {
      erros.push(`Há sobreposição entre ${ordenados[i - 1].pesoInicial}-${ordenados[i - 1].pesoFinal} e ${ordenados[i].pesoInicial}-${ordenados[i].pesoFinal}.`);
      break;
    }
  }
  return erros;
}

export function exportarLinhasParaXlsx(XLSX, linhas = [], nomeArquivo = 'arquivo.xlsx', nomeAba = 'Dados') {
  const worksheet = XLSX.utils.json_to_sheet(linhas);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, nomeAba);
  XLSX.writeFile(workbook, nomeArquivo);
}

export function baixarArquivoTexto(conteudo, nomeArquivo) {
  const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}
