import * as XLSX from 'xlsx';

export const STORAGE_KEYS = {
  drafts: 'formatacao_tabelas_rascunhos_v3',
  ibge: 'formatacao_tabelas_ibge_base_v1',
};

export const TIPOS_CALCULO = ['PERCENTUAL', 'FAIXA DE PESO'];
export const METODOS_ENVIO = ['Normal', 'Expresso'];
export const REGRAS_CALCULO = ['Maior valor', 'Menor valor', 'Sem regra'];

export const FAIXAS_PADRAO = {
  B2C: [
    { nome: '0 a 10', pesoMinimo: 0, pesoLimite: 10 },
    { nome: '10 a 20', pesoMinimo: 10.001, pesoLimite: 20 },
    { nome: '20 a 30', pesoMinimo: 20.001, pesoLimite: 30 },
    { nome: '30 a 50', pesoMinimo: 30.001, pesoLimite: 50 },
  ],
  ATACADO: [
    { nome: '0 a 20', pesoMinimo: 0, pesoLimite: 20 },
    { nome: '20 a 50', pesoMinimo: 20.001, pesoLimite: 50 },
    { nome: '50 a 100', pesoMinimo: 50.001, pesoLimite: 100 },
    { nome: '100 a 200', pesoMinimo: 100.001, pesoLimite: 200 },
  ],
};

export function criarFormularioInicial() {
  const hoje = new Date();
  const final = new Date(hoje.getFullYear() + 3, 11, 31);
  return {
    id: gerarId(),
    nomeFormatacao: '',
    transportadora: '',
    transportadoraModo: 'existente',
    transportadoraExistente: '',
    codigoUnidade: '',
    origemNome: '',
    origemModo: 'existente',
    origemExistenteKey: '',
    origemIbge: '',
    canal: 'ATACADO',
    metodoEnvio: 'Normal',
    regraCalculo: 'Maior valor',
    tipoCalculo: 'PERCENTUAL',
    vigenciaInicial: formatarDataInput(hoje),
    vigenciaFinal: formatarDataInput(final),
    observacoes: '',
    rotas: [],
    quebrasFaixa: [],
    fretes: [],
    modelosFaixa: FAIXAS_PADRAO,
    baseIbgeResumo: null,
    atualizadoEm: new Date().toISOString(),
  };
}

export function gerarId() {
  return `fmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatarDataInput(data) {
  return data.toISOString().slice(0, 10);
}

export function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function montarNomeAutomatico(form) {
  const partes = [form.transportadora, form.origemNome || form.codigoUnidade, form.canal].filter(Boolean);
  return partes.join(' | ');
}

export function salvarRascunhos(rascunhos) {
  localStorage.setItem(STORAGE_KEYS.drafts, JSON.stringify(rascunhos));
}

export function carregarRascunhos() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.drafts) || '[]');
  } catch {
    return [];
  }
}

export function salvarBaseIbge(base) {
  localStorage.setItem(STORAGE_KEYS.ibge, JSON.stringify(base));
}

export function carregarBaseIbge() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.ibge) || 'null');
  } catch {
    return null;
  }
}

export function lerArquivoComoArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export async function importarBaseIbge(file) {
  const buffer = await lerArquivoComoArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: 'array' });
  const primeiraAba = workbook.SheetNames[0];
  const sheet = workbook.Sheets[primeiraAba];
  const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  let headerIndex = linhas.findIndex((row) => String(row[0] || '').trim() === 'UF' && String(row[10] || '').trim() === 'Município');
  if (headerIndex < 0) headerIndex = 0;

  const headers = linhas[headerIndex].map((h) => String(h || '').trim());
  const data = linhas.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell || '').trim() !== ''));

  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const municipios = [];
  const faixasCep = [];

  data.forEach((row, index) => {
    const codigo = somenteDigitos(row[idx['Código Município Completo']]);
    const nomeMunicipio = String(row[idx['Nome_Município']] || '').trim();
    const uf = String(row[idx['Nome_UF']] || row[idx['UF']] || '').trim();
    if (!codigo || !nomeMunicipio) return;

    const municipio = {
      id: `${codigo}-${index}`,
      codigoMunicipioCompleto: codigo,
      municipioIbge: somenteDigitos(row[idx['Município']]),
      uf,
      siglaUf: String(row[idx['Nome_UF']] || '').trim() || String(row[idx['UF']] || '').trim(),
      nomeMunicipio,
      nomeMunicipioSemAcento: String(row[idx['Nome_Município Sem acento']] || '').trim(),
      nomeBusca: normalizarTexto(`${nomeMunicipio} ${uf}`),
      concat: String(row[idx['CONCATENAR']] || '').trim(),
    };
    municipios.push(municipio);

    [['INICIAL', 'FINAL'], ['INICIAL.1', 'FINAL.1'], ['INICIAL.2', 'FINAL.2']].forEach((par, ordem) => {
      const ini = somenteDigitos(row[idx[par[0]]]);
      const fim = somenteDigitos(row[idx[par[1]]]);
      if (!ini || !fim) return;
      faixasCep.push({
        id: `${codigo}-${ordem + 1}`,
        codigoMunicipioCompleto: codigo,
        municipioIbge: municipio.municipioIbge,
        nomeMunicipio,
        uf,
        cepInicial: ini,
        cepFinal: fim,
        ordemFaixa: ordem + 1,
        origemDado: 'IMPORTACAO_XLSB',
      });
    });
  });

  const base = {
    importadoEm: new Date().toISOString(),
    origemArquivo: file.name,
    municipios,
    faixasCep,
    resumo: {
      totalMunicipios: municipios.length,
      totalFaixas: faixasCep.length,
    },
  };

  salvarBaseIbge(base);
  return base;
}

export function buscarIbgePorOrigem(baseIbge, origemNome) {
  if (!baseIbge || !origemNome) return null;
  const alvo = normalizarTexto(origemNome);
  const exato = baseIbge.municipios.find((item) => item.nomeBusca === alvo || normalizarTexto(item.nomeMunicipio) === alvo);
  if (exato) return exato;
  return baseIbge.municipios.find((item) => item.nomeBusca.includes(alvo) || alvo.includes(normalizarTexto(item.nomeMunicipio)));
}

export async function importarRotas(file) {
  const buffer = await lerArquivoComoArrayBuffer(file);
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  return rows
    .map((row, index) => ({
      id: gerarId(),
      cotacao: String(row['Cotação'] || row['COTACAO'] || row['Rota do frete'] || '').trim(),
      ibgeDestino: somenteDigitos(row['Código IBGE Destino'] || row['IBGE destino'] || row['IBGE Destino'] || row['Codigo IBGE Destino']),
      prazo: numeroOuTexto(row['Prazo de entrega'] || row['Prazo'] || row['PRAZO']),
      ordem: index + 1,
    }))
    .filter((item) => item.cotacao || item.ibgeDestino || item.prazo);
}

export async function importarQuebras(file) {
  const buffer = await lerArquivoComoArrayBuffer(file);
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  return rows
    .map((row, index) => ({
      id: gerarId(),
      cotacao: String(row['Cotação'] || row['COTACAO'] || '').trim(),
      ibgeDestino: somenteDigitos(row['Código IBGE Destino'] || row['IBGE destino'] || row['IBGE Destino']),
      cepInicial: somenteDigitos(row['CEP inicial'] || row['CEP Inicial']),
      cepFinal: somenteDigitos(row['CEP final'] || row['CEP Final']),
      prazo: numeroOuTexto(row['Prazo de entrega'] || row['Prazo']),
      ordem: index + 1,
    }))
    .filter((item) => item.cotacao || item.ibgeDestino || item.cepInicial || item.cepFinal || item.prazo);
}

export async function importarFretes(file) {
  const buffer = await lerArquivoComoArrayBuffer(file);
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  return rows
    .map((row, index) => ({
      id: gerarId(),
      rotaFrete: String(row['Rota do frete'] || '').trim(),
      pesoMinimo: numero(row['Peso mínimo']),
      pesoLimite: numero(row['Peso limite']),
      excessoPeso: numero(row['Excesso de peso']),
      taxaAplicada: numero(row['Taxa aplicada']),
      fretePercentual: numero(row['Frete percentual']),
      freteMinimo: numero(row['Frete mínimo']),
      faixaNome: String(row['Faixa'] || row['Faixa de peso'] || '').trim(),
      ordem: index + 1,
    }))
    .filter((item) => item.rotaFrete || item.faixaNome || item.fretePercentual || item.freteMinimo);
}

export function gerarFretesAutomaticos(form) {
  const rotas = form.rotas || [];
  if (!rotas.length) return [];

  const cotacoesUnicas = Array.from(
    new Set(
      rotas
        .map((rota) => String(rota.cotacao || '').trim())
        .filter(Boolean),
    ),
  );

  if (!cotacoesUnicas.length) return [];

  if (String(form.tipoCalculo).toUpperCase() === 'PERCENTUAL') {
    return cotacoesUnicas.map((cotacao) => ({
      id: gerarId(),
      rotaFrete: cotacao,
      faixaNome: '',
      pesoMinimo: 0,
      pesoLimite: 999999999,
      excessoPeso: 0,
      taxaAplicada: 0,
      fretePercentual: 0,
      freteMinimo: 0,
    }));
  }

  const modelo = form.modelosFaixa?.[form.canal] || FAIXAS_PADRAO.ATACADO;
  const linhas = [];
  cotacoesUnicas.forEach((cotacao) => {
    modelo.forEach((faixa) => {
      linhas.push({
        id: gerarId(),
        rotaFrete: cotacao,
        faixaNome: faixa.nome,
        pesoMinimo: faixa.pesoMinimo,
        pesoLimite: faixa.pesoLimite,
        excessoPeso: 0,
        taxaAplicada: 0,
        fretePercentual: 0,
        freteMinimo: 0,
      });
    });
  });
  return linhas;
}

export function validarFormacao(form) {
  const erros = [];
  const alertas = [];

  if (!form.transportadora) erros.push('Preencha a transportadora.');
  if (!form.codigoUnidade) erros.push('Preencha o código da unidade / origem.');
  if (!form.origemNome) erros.push('Preencha a origem.');
  if (!form.origemIbge) alertas.push('IBGE de origem ainda não foi identificado automaticamente.');
  if (!form.rotas.length) erros.push('Inclua ao menos uma rota padrão.');
  if (!form.fretes.length) alertas.push('Ainda não existem fretes preenchidos/importados.');

  form.rotas.forEach((rota, index) => {
    if (!rota.cotacao) erros.push(`Rota ${index + 1}: informe a cotação.`);
    if (!rota.ibgeDestino) erros.push(`Rota ${index + 1}: informe o IBGE destino.`);
    if (rota.prazo === '' || rota.prazo === null || rota.prazo === undefined) erros.push(`Rota ${index + 1}: informe o prazo.`);
  });

  form.quebrasFaixa.forEach((item, index) => {
    if (!item.cotacao || !item.ibgeDestino || !item.cepInicial || !item.cepFinal) {
      erros.push(`Quebra ${index + 1}: preencha cotação, IBGE destino e faixa CEP completa.`);
    }
  });

  if (form.quebrasFaixa.length) alertas.push('Existem quebras de faixas cadastradas. Elas devem prevalecer sobre a base padrão de IBGE.');

  return { erros, alertas };
}

export function exportarModeloRotas() {
  const dados = [{ Cotação: '', 'Código IBGE Destino': '', 'Prazo de entrega': '' }];
  return baixarWorkbook('modelo-rotas-simples.xlsx', 'Rotas', dados);
}

export function exportarModeloQuebras() {
  const dados = [{ Cotação: '', 'Código IBGE Destino': '', 'CEP inicial': '', 'CEP final': '', 'Prazo de entrega': '' }];
  return baixarWorkbook('modelo-quebra-faixas.xlsx', 'Quebra de Faixas', dados);
}

export function exportarModeloFretes(form) {
  const dados = montarLinhasFreteExportacao(form, true);
  return baixarWorkbook('modelo-fretes.xlsx', 'Valores de frete', dados);
}

export async function exportarPacoteCompleto(form) {
  const baseNome = slug(montarNomeAutomatico(form) || 'formatacao');
  const arquivoRotas = `${baseNome}-rotas.xlsx`;
  const arquivoFretes = `${baseNome}-fretes.xlsx`;

  const rotasArray = gerarWorkbookArray([
    {
      nomeAba: 'Prazos de frete',
      dados: montarLinhasRotasExportacao(form),
    },
    {
      nomeAba: 'Quebra de Faixas',
      dados: montarLinhasQuebrasExportacao(form),
    },
  ]);

  const fretesArray = gerarWorkbookArray([
    {
      nomeAba: 'Valores de frete',
      dados: montarLinhasFreteExportacao(form, false),
    },
  ]);

  const zipBlob = criarZipSimples([
    { nome: arquivoRotas, bytes: new Uint8Array(rotasArray) },
    { nome: arquivoFretes, bytes: new Uint8Array(fretesArray) },
  ]);

  baixarBlob(zipBlob, `${baseNome}-pacote-completo.zip`);
}

export function montarLinhasRotasExportacao(form) {
  return (form.rotas || []).map((rota) => ({
    'Nome da transportadora': form.transportadora,
    'Código da unidade': form.codigoUnidade,
    Canal: form.canal,
    Cotação: rota.cotacao,
    'Código IBGE Origem': form.origemIbge || '',
    'Código IBGE Destino': rota.ibgeDestino,
    'CEP inicial': '',
    'CEP final': '',
    'Método de envio': form.metodoEnvio,
    'Prazo de entrega': rota.prazo,
    'Início da vigência': form.vigenciaInicial,
    'Término da vigência': form.vigenciaFinal,
  }));
}

export function montarLinhasQuebrasExportacao(form) {
  return (form.quebrasFaixa || []).map((rota) => ({
    'Nome da transportadora': form.transportadora,
    'Código da unidade': form.codigoUnidade,
    Canal: form.canal,
    Cotação: rota.cotacao,
    'Código IBGE Origem': form.origemIbge || '',
    'Código IBGE Destino': rota.ibgeDestino,
    'CEP inicial': rota.cepInicial,
    'CEP final': rota.cepFinal,
    'Método de envio': form.metodoEnvio,
    'Prazo de entrega': rota.prazo,
    'Início da vigência': form.vigenciaInicial,
    'Término da vigência': form.vigenciaFinal,
  }));
}

export function montarLinhasFreteExportacao(form, vazio = false) {
  const base = vazio && !form.fretes.length ? gerarFretesAutomaticos(form) : form.fretes;
  return (base || []).map((item) => ({
    'Nome da transportadora': form.transportadora,
    'Código da unidade': form.codigoUnidade,
    Canal: form.canal,
    'Regra de cálculo': form.regraCalculo,
    'Tipo de cálculo': form.tipoCalculo,
    'Rota do frete': item.rotaFrete,
    'Peso mínimo': item.pesoMinimo,
    'Peso limite': item.pesoLimite,
    'Excesso de peso': item.excessoPeso,
    'Taxa aplicada': item.taxaAplicada,
    'Frete percentual': item.fretePercentual,
    'Frete mínimo': item.freteMinimo,
    'Início da vigência': form.vigenciaInicial,
    'Fim da vigência': form.vigenciaFinal,
  }));
}

function baixarWorkbook(nomeArquivo, nomeAba, dados) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(dados);
  XLSX.utils.book_append_sheet(wb, ws, nomeAba);
  XLSX.writeFile(wb, nomeArquivo);
}

function somenteDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

function numero(valor) {
  if (valor === '' || valor === null || valor === undefined) return 0;
  const convertido = Number(String(valor).replace(',', '.'));
  return Number.isFinite(convertido) ? convertido : 0;
}

function numeroOuTexto(valor) {
  if (valor === '' || valor === null || valor === undefined) return '';
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : String(valor).trim();
}

function slug(valor) {
  return normalizarTexto(valor).toLowerCase().replace(/\s+/g, '-');
}


function gerarWorkbookArray(abAs = []) {
  const wb = XLSX.utils.book_new();
  abAs.forEach(({ nomeAba, dados }) => {
    const linhas = Array.isArray(dados) && dados.length ? dados : [{}];
    const ws = XLSX.utils.json_to_sheet(linhas);
    XLSX.utils.book_append_sheet(wb, ws, nomeAba);
  });
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}

function baixarBlob(blob, nomeArquivo) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function criarZipSimples(arquivos) {
  const encoder = new TextEncoder();
  const arquivosValidos = (arquivos || []).filter((item) => item?.nome && item?.bytes);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  arquivosValidos.forEach((arquivo) => {
    const nomeBytes = encoder.encode(arquivo.nome);
    const data = arquivo.bytes instanceof Uint8Array ? arquivo.bytes : new Uint8Array(arquivo.bytes);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nomeBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nomeBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nomeBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nomeBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nomeBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nomeBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  });

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const endHeader = new Uint8Array(22);
  const endView = new DataView(endHeader.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, arquivosValidos.length, true);
  endView.setUint16(10, arquivosValidos.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, endHeader], { type: 'application/zip' });
}


export function construirCadastroBase(transportadoras = []) {
  const nomesTransportadoras = Array.from(
    new Set(
      (transportadoras || [])
        .map((item) => String(item?.nome || '').trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const origemMap = new Map();
  (transportadoras || []).forEach((transportadora) => {
    const nomeTransportadora = String(transportadora?.nome || '').trim();
    (transportadora?.origens || []).forEach((origem) => {
      const nome = String(origem?.cidade || '').trim();
      const canal = String(origem?.canal || 'ATACADO').trim().toUpperCase();
      if (!nome) return;
      const key = `${normalizarTexto(nome)}|${canal}`;
      if (!origemMap.has(key)) {
        origemMap.set(key, {
          key,
          nome,
          canal,
          transportadoras: nomeTransportadora ? [nomeTransportadora] : [],
        });
      } else if (nomeTransportadora) {
        const atual = origemMap.get(key);
        if (!atual.transportadoras.includes(nomeTransportadora)) {
          atual.transportadoras.push(nomeTransportadora);
        }
      }
    });
  });

  const origens = Array.from(origemMap.values())
    .sort((a, b) => `${a.nome}|${a.canal}`.localeCompare(`${b.nome}|${b.canal}`, 'pt-BR'))
    .map((item, index) => ({
      ...item,
      transportadoras: [...item.transportadoras].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      codigo: `UND${String(index + 1).padStart(3, '0')}`,
    }));

  return { transportadoras: nomesTransportadoras, origens };
}

export function proximoCodigoOrigem(cadastroBase, incremento = 0) {
  const total = Array.isArray(cadastroBase?.origens) ? cadastroBase.origens.length : 0;
  return `UND${String(total + 1 + incremento).padStart(3, '0')}`;
}

export function encontrarTransportadoraExistente(cadastroBase, nome) {
  const alvo = normalizarTexto(nome);
  return (cadastroBase?.transportadoras || []).find((item) => normalizarTexto(item) === alvo) || '';
}

export function encontrarOrigemExistente(cadastroBase, nome, canal) {
  const chave = `${normalizarTexto(nome)}|${String(canal || 'ATACADO').trim().toUpperCase()}`;
  return (cadastroBase?.origens || []).find((item) => item.key === chave) || null;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
