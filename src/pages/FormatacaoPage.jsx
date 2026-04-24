import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';

const UF_POR_CODIGO = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

const ORIGENS_FIXAS = {
  ITAJAI: { cidade: 'Itajai', uf: 'SC', ibge: '4208203' },
  'ITAJAÍ': { cidade: 'Itajai', uf: 'SC', ibge: '4208203' },
  BARUERI: { cidade: 'Barueri', uf: 'SP', ibge: '3505708' },
  CONTAGEM: { cidade: 'Contagem', uf: 'MG', ibge: '3118601' },
};

const MODELOS_FAIXA = {
  B2B: [
    { faixaPeso: '0 a 20 kg', pesoInicial: 0, pesoFinal: 20 },
    { faixaPeso: '20 a 30 kg', pesoInicial: 20, pesoFinal: 30 },
    { faixaPeso: '30 a 50 kg', pesoInicial: 30, pesoFinal: 50 },
    { faixaPeso: '50 a 70 kg', pesoInicial: 50, pesoFinal: 70 },
    { faixaPeso: '70 a 100 kg', pesoInicial: 70, pesoFinal: 100 },
    { faixaPeso: '100 a 150 kg', pesoInicial: 100, pesoFinal: 150 },
    { faixaPeso: '150 a 200 kg', pesoInicial: 150, pesoFinal: 200 },
    { faixaPeso: '200 a 300 kg', pesoInicial: 200, pesoFinal: 300 },
    { faixaPeso: 'Acima de 300 kg (KG excedente)', pesoInicial: 300, pesoFinal: 999999999 },
  ],
  B2C: [
    { faixaPeso: '0 a 2 kg', pesoInicial: 0, pesoFinal: 2 },
    { faixaPeso: '2 a 5 kg', pesoInicial: 2, pesoFinal: 5 },
    { faixaPeso: '5 a 10 kg', pesoInicial: 5, pesoFinal: 10 },
    { faixaPeso: '10 a 15 kg', pesoInicial: 10, pesoFinal: 15 },
    { faixaPeso: '15 a 20 kg', pesoInicial: 15, pesoFinal: 20 },
    { faixaPeso: '20 a 30 kg', pesoInicial: 20, pesoFinal: 30 },
    { faixaPeso: 'Acima de 300 kg (KG excedente)', pesoInicial: 300, pesoFinal: 999999999 },
  ],
};

const COTACOES_BASE = ['CAPITAL', 'INTERIOR 1', 'INTERIOR 2', 'INTERIOR 3', 'INTERIOR 4', 'INTERIOR 5', 'INTERIOR 6', 'INTERIOR 7', 'INTERIOR 8', 'INTERIOR 9'];
const CODIGO_UNIDADE = { ATACADO: '0001 - B2B', B2C: '0001 - B2C' };

function limpar(txt) {
  return String(txt ?? '').trim();
}

function normalizar(txt) {
  return limpar(txt)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function numero(txt) {
  if (txt === null || txt === undefined || txt === '') return null;
  if (typeof txt === 'number') return Number.isFinite(txt) ? txt : null;
  const s = String(txt).trim();
  if (!s) return null;
  const t = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function excelDateValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    const ano = d.getFullYear();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }
  return String(value);
}

function ufPorIbge(ibge) {
  const codigo = String(ibge ?? '').replace(/\D/g, '');
  return UF_POR_CODIGO[codigo.slice(0, 2)] || '';
}

function montarCotacaoFinal(origem, ibgeDestino, cotacaoBase) {
  const uf = ufPorIbge(ibgeDestino);
  return [limpar(origem), uf, limpar(cotacaoBase).toUpperCase()].filter(Boolean).join(' - ');
}

function extrairFaixa(texto) {
  const bruto = limpar(texto);
  const up = normalizar(bruto);
  if (up.includes('ACIMA DE 300')) {
    return { faixaPeso: 'Acima de 300 kg (KG excedente)', pesoInicial: 300, pesoFinal: 999999999 };
  }
  const m = bruto.match(/(\d+[.,]?\d*)\s*(?:a|até|ate|-|\/)\s*(\d+[.,]?\d*)/i);
  if (!m) return { faixaPeso: bruto, pesoInicial: null, pesoFinal: null };
  return { faixaPeso: bruto, pesoInicial: numero(m[1]), pesoFinal: numero(m[2]) };
}

function baixarWorkbook(nome, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, rows, header }) => {
    const ws = XLSX.utils.json_to_sheet(rows, { header });
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, nome);
}

function detectarCotacaoBase(regiao) {
  const t = normalizar(regiao);
  return COTACOES_BASE.find((c) => t.includes(c)) || limpar(regiao).toUpperCase();
}

async function lerPrimeiraAba(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function criarRotasExportacao({ transportadora, canal, origem, ibgeOrigem, metodoEnvio, vigenciaInicial, vigenciaFinal, rotas }) {
  return rotas.map((r) => ({
    'Nome da transportadora': transportadora,
    'Código da unidade': CODIGO_UNIDADE[canal] || CODIGO_UNIDADE.ATACADO,
    Canal: canal,
    Cotação: r.cotacaoFinal,
    'Código IBGE Origem': ibgeOrigem,
    'Código IBGE Destino': r.ibgeDestino,
    'CEP inicial': r.cepInicial || '',
    'CEP final': r.cepFinal || '',
    'Método de envio': metodoEnvio,
    'Prazo de entrega': r.prazo,
    'Início da vigência': vigenciaInicial,
    'Término da vigência': vigenciaFinal,
  }));
}

function criarFretesExportacao({ transportadora, canal, regraCalculo, tipoCalculo, vigenciaInicial, vigenciaFinal, fretes }) {
  return fretes.map((f) => {
    let pesoMinimo = f.pesoInicial ?? '';
    let pesoLimite = f.pesoFinal ?? '';
    if (normalizar(f.faixaPeso).includes('ACIMA DE 300')) {
      pesoMinimo = 300;
      pesoLimite = 999999999;
    }
    return {
      'Nome da transportadora': transportadora,
      'Código da unidade': CODIGO_UNIDADE[canal] || CODIGO_UNIDADE.ATACADO,
      Canal: canal,
      'Regra de cálculo': regraCalculo,
      'Tipo de cálculo': tipoCalculo,
      'Rota do frete': f.cotacaoFinal,
      'Peso mínimo': pesoMinimo,
      'Peso limite': pesoLimite,
      'Excesso de peso': f.excessoPeso ?? '',
      'Taxa aplicada': f.taxaAplicada ?? '',
      'Frete percentual': f.fretePercentual ?? '',
      'Frete mínimo': f.freteMinimo ?? '',
      'Início da vigência': vigenciaInicial,
      'Fim da vigência': vigenciaFinal,
    };
  });
}

async function importarTemplateSeparado(arquivoRotas, arquivoFretes) {
  const rowsRotas = await lerPrimeiraAba(arquivoRotas);
  const rowsFretes = await lerPrimeiraAba(arquivoFretes);

  const hRot = (rowsRotas[0] || []).map(normalizar);
  const idx = {
    cidadeOrigem: hRot.findIndex((h) => h === 'CIDADE DE ORIGEM'),
    ufOrigem: hRot.findIndex((h) => h === 'UF ORIGEM'),
    ibgeOrigem: hRot.findIndex((h) => h === 'IBGE ORIGEM'),
    ibgeDestino: hRot.findIndex((h) => h === 'IBGE DESTINO'),
    cidadeDestino: hRot.findIndex((h) => h === 'CIDADE DE DESTINO'),
    ufDestino: hRot.findIndex((h) => h === 'UF DESTINO'),
    cepInicial: hRot.findIndex((h) => h === 'CEP INICIAL'),
    cepFinal: hRot.findIndex((h) => h === 'CEP FINAL'),
    prazo: hRot.findIndex((h) => h.startsWith('PRAZO')),
    regiao: hRot.findIndex((h) => h.startsWith('REGIAO') || h.startsWith('REGIÃO')),
  };

  const rotas = [];
  for (let i = 1; i < rowsRotas.length; i++) {
    const row = rowsRotas[i] || [];
    const ibgeDestino = limpar(row[idx.ibgeDestino]);
    const cotacaoBase = detectarCotacaoBase(row[idx.regiao]);
    if (!ibgeDestino || !cotacaoBase) continue;
    const origem = limpar(row[idx.cidadeOrigem]);
    rotas.push({
      id: `r${i}`,
      ibgeDestino,
      prazo: limpar(row[idx.prazo]),
      cotacaoBase,
      origem,
      cidadeDestino: limpar(row[idx.cidadeDestino]),
      ufDestino: limpar(row[idx.ufDestino]).toUpperCase(),
      cepInicial: limpar(row[idx.cepInicial]),
      cepFinal: limpar(row[idx.cepFinal]),
      cotacaoFinal: montarCotacaoFinal(origem, ibgeDestino, cotacaoBase),
    });
  }

  const h1 = (rowsFretes[0] || []).map(limpar);
  const h2 = (rowsFretes[1] || []).map(normalizar);
  const cols = Math.max(h1.length, h2.length);
  const fixed = { origem: -1, ufDestino: -1, faixa: -1 };
  const blocos = [];
  for (let c = 0; c < cols; c++) {
    const a = normalizar(h1[c]);
    const b = h2[c];
    if (a === 'CIDADE DE ORIGEM') fixed.origem = c;
    if (a === 'UF DESTINO') fixed.ufDestino = c;
    if (a === 'FAIXA PESO') fixed.faixa = c;
    if (a && b === 'FRETE KG (R$)') blocos.push({ cotacaoBase: a, freteCol: c, adValCol: c + 1 });
  }

  const fretes = [];
  for (let r = 2; r < rowsFretes.length; r++) {
    const row = rowsFretes[r] || [];
    const origem = limpar(row[fixed.origem]);
    const ufDestino = limpar(row[fixed.ufDestino]).toUpperCase();
    const faixa = extrairFaixa(row[fixed.faixa]);
    if (!origem || !ufDestino || !faixa.faixaPeso) continue;

    for (const bloco of blocos) {
      const freteValor = numero(row[bloco.freteCol]);
      const fretePercentual = numero(row[bloco.adValCol]);
      if (freteValor === null && fretePercentual === null) continue;
      fretes.push({
        id: `f${r}-${bloco.cotacaoBase}`,
        cotacaoBase: bloco.cotacaoBase,
        cotacaoFinal: [origem, ufDestino, bloco.cotacaoBase].join(' - '),
        faixaPeso: faixa.faixaPeso,
        pesoInicial: faixa.pesoInicial,
        pesoFinal: faixa.pesoFinal,
        freteValor,
        fretePercentual,
        freteMinimo: '',
        taxaAplicada: '',
        excessoPeso: '',
      });
    }
  }

  const dadosGerais = {
    origemNome: rotas[0]?.origem || '',
    ufOrigem: limpar(rowsRotas[1]?.[idx.ufOrigem]).toUpperCase(),
    ibgeOrigem: limpar(rowsRotas[1]?.[idx.ibgeOrigem]),
  };

  return { rotas, fretes, dadosGerais };
}

export default function FormatacaoPage({ transportadoras = [], store }) {
  const inputImportarRotas = useRef(null);
  const inputImportarFretes = useRef(null);
  const [modoEntrada, setModoEntrada] = useState('escolha');
  const [arquivoRotasTemplate, setArquivoRotasTemplate] = useState(null);
  const [arquivoFretesTemplate, setArquivoFretesTemplate] = useState(null);
  const [carregandoTemplate, setCarregandoTemplate] = useState(false);
  const [secaoAberta, setSecaoAberta] = useState({ dados: true, rotas: true, fretes: true, publicar: true });
  const [mensagem, setMensagem] = useState('');

  const [dadosGerais, setDadosGerais] = useState({
    transportadora: transportadoras[0]?.nome || '',
    origemNome: '',
    ufOrigem: '',
    ibgeOrigem: '',
    canal: 'ATACADO',
    metodoEnvio: 'Normal',
    regraCalculo: 'Maior valor',
    tipoCalculo: 'FAIXA',
    modeloFaixa: 'B2B',
    vigenciaInicial: '',
    vigenciaFinal: '',
  });

  const [rotas, setRotas] = useState([]);
  const [fretes, setFretes] = useState([]);

  const faixasAtuais = useMemo(() => MODELOS_FAIXA[dadosGerais.modeloFaixa] || [], [dadosGerais.modeloFaixa]);

  function toggleSecao(chave) {
    setSecaoAberta((prev) => ({ ...prev, [chave]: !prev[chave] }));
  }

  function atualizarOrigem(valor) {
    const fixa = ORIGENS_FIXAS[normalizar(valor)];
    setDadosGerais((prev) => ({
      ...prev,
      origemNome: valor,
      ufOrigem: fixa?.uf || prev.ufOrigem,
      ibgeOrigem: fixa?.ibge || prev.ibgeOrigem,
    }));
    setRotas((prev) =>
      prev.map((r) => ({
        ...r,
        origem: valor,
        cotacaoFinal: montarCotacaoFinal(valor, r.ibgeDestino, r.cotacaoBase),
      }))
    );
  }

  function adicionarRota() {
    setRotas((prev) => [
      ...prev,
      {
        id: `r${Date.now()}`,
        ibgeDestino: '',
        prazo: '',
        cotacaoBase: 'CAPITAL',
        origem: dadosGerais.origemNome,
        cidadeDestino: '',
        ufDestino: '',
        cepInicial: '',
        cepFinal: '',
        cotacaoFinal: '',
      },
    ]);
  }

  function atualizarRota(id, campo, valor) {
    setRotas((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, [campo]: valor, origem: dadosGerais.origemNome };
        next.cotacaoFinal = montarCotacaoFinal(dadosGerais.origemNome, next.ibgeDestino, next.cotacaoBase);
        return next;
      })
    );
  }

  async function importarRotas(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await lerPrimeiraAba(file);
    const header = (rows[0] || []).map(normalizar);
    const idxIbge = header.findIndex((h) => h === 'IBGE DESTINO' || h === 'CÓDIGO IBGE DESTINO' || h === 'CODIGO IBGE DESTINO');
    const idxPrazo = header.findIndex((h) => h.startsWith('PRAZO'));
    const idxCot = header.findIndex((h) => h.startsWith('REGIAO') || h.startsWith('REGIÃO') || h === 'COTAÇÃO BASE' || h === 'COTACAO BASE' || h === 'COTAÇÃO');
    const idxCepIni = header.findIndex((h) => h === 'CEP INICIAL');
    const idxCepFim = header.findIndex((h) => h === 'CEP FINAL');

    const novas = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const ibgeDestino = limpar(row[idxIbge]);
      if (!ibgeDestino) continue;
      const cotacaoBase = idxCot >= 0 ? detectarCotacaoBase(row[idxCot]) : 'CAPITAL';
      novas.push({
        id: `ri${i}`,
        ibgeDestino,
        prazo: limpar(row[idxPrazo]),
        cotacaoBase,
        origem: dadosGerais.origemNome,
        cepInicial: idxCepIni >= 0 ? limpar(row[idxCepIni]) : '',
        cepFinal: idxCepFim >= 0 ? limpar(row[idxCepFim]) : '',
        cotacaoFinal: montarCotacaoFinal(dadosGerais.origemNome, ibgeDestino, cotacaoBase),
      });
    }
    setRotas(novas);
    setMensagem(`${novas.length} rotas importadas.`);
    event.target.value = '';
  }

  function aplicarFaixasEGerarFretes() {
    const unicas = Array.from(new Map(rotas.map((r) => [r.cotacaoFinal, r])).values());
    const gerados = [];
    unicas.forEach((rota) => {
      faixasAtuais.forEach((faixa, idx) => {
        gerados.push({
          id: `${rota.cotacaoFinal}-${idx}`,
          cotacaoBase: rota.cotacaoBase,
          cotacaoFinal: rota.cotacaoFinal,
          faixaPeso: faixa.faixaPeso,
          pesoInicial: faixa.pesoInicial,
          pesoFinal: faixa.pesoFinal,
          freteValor: '',
          fretePercentual: '',
          freteMinimo: '',
          taxaAplicada: '',
          excessoPeso: faixa.faixaPeso.includes('Acima de 300') ? '' : '',
        });
      });
    });
    setFretes(gerados);
    setMensagem(`${gerados.length} linhas de frete geradas.`);
  }

  async function importarFretes(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await lerPrimeiraAba(file);
    const header = (rows[0] || []).map(normalizar);
    const idx = {
      cotacao: header.findIndex((h) => h === 'ROTA DO FRETE' || h === 'COTAÇÃO' || h === 'COTACAO'),
      faixa: header.findIndex((h) => h === 'FAIXA PESO'),
      pesoInicial: header.findIndex((h) => h === 'PESO MÍNIMO' || h === 'PESO MINIMO' || h === 'PESO INICIAL'),
      pesoFinal: header.findIndex((h) => h === 'PESO LIMITE' || h === 'PESO FINAL'),
      excessoPeso: header.findIndex((h) => h === 'EXCESSO DE PESO'),
      taxaAplicada: header.findIndex((h) => h === 'TAXA APLICADA'),
      fretePercentual: header.findIndex((h) => h === 'FRETE PERCENTUAL' || h === 'AD VALOREM'),
      freteMinimo: header.findIndex((h) => h === 'FRETE MÍNIMO' || h === 'FRETE MINIMO'),
    };
    const novos = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const cotacaoFinal = limpar(row[idx.cotacao]);
      if (!cotacaoFinal) continue;
      novos.push({
        id: `fi${i}`,
        cotacaoFinal,
        faixaPeso: idx.faixa >= 0 ? limpar(row[idx.faixa]) : '',
        pesoInicial: idx.pesoInicial >= 0 ? limpar(row[idx.pesoInicial]) : '',
        pesoFinal: idx.pesoFinal >= 0 ? limpar(row[idx.pesoFinal]) : '',
        excessoPeso: idx.excessoPeso >= 0 ? limpar(row[idx.excessoPeso]) : '',
        taxaAplicada: idx.taxaAplicada >= 0 ? limpar(row[idx.taxaAplicada]) : '',
        fretePercentual: idx.fretePercentual >= 0 ? limpar(row[idx.fretePercentual]) : '',
        freteMinimo: idx.freteMinimo >= 0 ? limpar(row[idx.freteMinimo]) : '',
      });
    }
    setFretes(novos);
    setMensagem(`${novos.length} fretes importados.`);
    event.target.value = '';
  }

  function limparTudo() {
    setRotas([]);
    setFretes([]);
    setArquivoRotasTemplate(null);
    setArquivoFretesTemplate(null);
    setMensagem('');
    setModoEntrada('escolha');
  }

  async function importarTemplateAutomatico() {
    if (!arquivoRotasTemplate || !arquivoFretesTemplate) return;
    setCarregandoTemplate(true);
    try {
      const resultado = await importarTemplateSeparado(arquivoRotasTemplate, arquivoFretesTemplate);
      setDadosGerais((prev) => ({
        ...prev,
        origemNome: resultado.dadosGerais.origemNome || prev.origemNome,
        ufOrigem: resultado.dadosGerais.ufOrigem || prev.ufOrigem,
        ibgeOrigem: resultado.dadosGerais.ibgeOrigem || prev.ibgeOrigem,
      }));
      setRotas(resultado.rotas);
      setFretes(resultado.fretes);
      setModoEntrada('manual');
      setMensagem('Template padrão importado com sucesso.');
    } catch (error) {
      setMensagem(`Erro ao importar template: ${error.message}`);
    } finally {
      setCarregandoTemplate(false);
    }
  }

  function atualizarFrete(id, campo, valor) {
    setFretes((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));
  }

  function exportarRotas() {
    const rows = criarRotasExportacao({
      transportadora: dadosGerais.transportadora,
      canal: dadosGerais.canal,
      origem: dadosGerais.origemNome,
      ibgeOrigem: dadosGerais.ibgeOrigem,
      metodoEnvio: dadosGerais.metodoEnvio,
      vigenciaInicial: excelDateValue(dadosGerais.vigenciaInicial),
      vigenciaFinal: excelDateValue(dadosGerais.vigenciaFinal),
      rotas,
    });
    baixarWorkbook('Rotas-para-subir.xlsx', [{ name: 'Prazos de frete', rows }]);
  }

  function exportarFretes() {
    const rows = criarFretesExportacao({
      transportadora: dadosGerais.transportadora,
      canal: dadosGerais.canal,
      regraCalculo: dadosGerais.regraCalculo,
      tipoCalculo: dadosGerais.tipoCalculo === 'FAIXA' ? 'FAIXA' : 'PERCENTUAL',
      vigenciaInicial: excelDateValue(dadosGerais.vigenciaInicial),
      vigenciaFinal: excelDateValue(dadosGerais.vigenciaFinal),
      fretes,
    });
    baixarWorkbook('Fretes-para-subir.xlsx', [{ name: 'Valores de frete', rows }]);
  }

  function gerarArquivosParaSubir() {
    exportarRotas();
    setTimeout(() => exportarFretes(), 400);
  }

  function publicarDireto() {
    if (!store) {
      setMensagem('Store indisponível para publicar direto.');
      return;
    }
    const transportadora = (transportadoras || []).find((t) => t.nome === dadosGerais.transportadora);
    if (!transportadora) {
      setMensagem('Selecione uma transportadora existente para publicar direto.');
      return;
    }

    const origemExistente = (transportadora.origens || []).find(
      (o) => normalizar(o.cidade) === normalizar(dadosGerais.origemNome) &&
             normalizar(o.canal || 'ATACADO') === normalizar(dadosGerais.canal)
    );

    const rotasFormatadas = criarRotasExportacao({
      transportadora: dadosGerais.transportadora,
      canal: dadosGerais.canal,
      origem: dadosGerais.origemNome,
      ibgeOrigem: dadosGerais.ibgeOrigem,
      metodoEnvio: dadosGerais.metodoEnvio,
      vigenciaInicial: excelDateValue(dadosGerais.vigenciaInicial),
      vigenciaFinal: excelDateValue(dadosGerais.vigenciaFinal),
      rotas,
    });

    const cotacoesFormatadas = criarFretesExportacao({
      transportadora: dadosGerais.transportadora,
      canal: dadosGerais.canal,
      regraCalculo: dadosGerais.regraCalculo,
      tipoCalculo: dadosGerais.tipoCalculo === 'FAIXA' ? 'FAIXA' : 'PERCENTUAL',
      vigenciaInicial: excelDateValue(dadosGerais.vigenciaInicial),
      vigenciaFinal: excelDateValue(dadosGerais.vigenciaFinal),
      fretes,
    });

    const baseGeneralidades = origemExistente?.generalidades || {};
    const historicoAtual = Array.isArray(origemExistente?.historicoTabelas) ? origemExistente.historicoTabelas : [];
    const snapshotAnterior = origemExistente
      ? [{
          data: new Date().toISOString(),
          rotas: origemExistente.rotas || [],
          cotacoes: origemExistente.cotacoes || [],
        }]
      : [];

    const origemPayload = {
      ...(origemExistente || {}),
      cidade: dadosGerais.origemNome,
      canal: dadosGerais.canal,
      status: 'Ativa',
      generalidades: {
        ...baseGeneralidades,
        tipoCalculo: dadosGerais.tipoCalculo === 'FAIXA' ? 'FAIXA' : 'PERCENTUAL',
        regraCalculo: dadosGerais.regraCalculo,
      },
      rotas: rotasFormatadas,
      cotacoes: cotacoesFormatadas,
      historicoTabelas: [...historicoAtual, ...snapshotAnterior].slice(-2),
    };

    store.salvarOrigem(transportadora.id, origemPayload);
    setMensagem('Tabela publicada diretamente na transportadora/origem selecionada. O histórico anterior foi preservado.');
  }

  if (modoEntrada === 'escolha') {
    return (
      <div className="pagina">
        <div className="cabecalho-pagina">
          <div>
            <h2>Formatação de Tabelas</h2>
            <p>Escolha como deseja começar.</p>
          </div>
        </div>

        <div className="formatacao-escolha-grid">
          <section className="card-padrao">
            <div className="card-topo"><h3>Enviar template padrão</h3></div>
            <p className="formatacao-texto">Anexe os dois arquivos no padrão que você já recebe: Rotas e Fretes.</p>
            <div className="form-grid">
              <label>
                Arquivo de Rotas
                <input type="file" accept=".xlsx,.xls,.ods" onChange={(e) => setArquivoRotasTemplate(e.target.files?.[0] || null)} />
              </label>
              <label>
                Arquivo de Fretes
                <input type="file" accept=".xlsx,.xls,.ods" onChange={(e) => setArquivoFretesTemplate(e.target.files?.[0] || null)} />
              </label>
            </div>
            <div className="acoes-formulario">
              <button className="botao-primario" disabled={!arquivoRotasTemplate || !arquivoFretesTemplate || carregandoTemplate} onClick={importarTemplateAutomatico}>
                {carregandoTemplate ? 'Importando...' : 'Importar e formatar automaticamente'}
              </button>
            </div>
          </section>

          <section className="card-padrao">
            <div className="card-topo"><h3>Usar modelo criado na ferramenta</h3></div>
            <p className="formatacao-texto">Entre no fluxo manual, com abrir/fechar de seções, exportação no modelo exato e opção de publicar direto na transportadora.</p>
            <div className="acoes-formulario">
              <button className="botao-secundario" onClick={() => setModoEntrada('manual')}>
                Ir para o modelo criado
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <div>
          <h2>Formatação de Tabelas</h2>
          <p>Modele, exporte no padrão certo e publique direto quando necessário.</p>
        </div>
        <div className="acoes-formulario">
          <button className="botao-secundario" onClick={() => setModoEntrada('escolha')}>Voltar à escolha inicial</button>
          <button className="botao-secundario" onClick={limparTudo}>Limpar tudo</button>
        </div>
      </div>

      {mensagem ? <div className="formatacao-alerta">{mensagem}</div> : null}

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Dados gerais</h3>
          <button className="botao-secundario pequeno" onClick={() => toggleSecao('dados')}>{secaoAberta.dados ? 'Fechar' : 'Abrir'}</button>
        </div>
        {secaoAberta.dados && (
          <div className="form-grid">
            <label>
              Transportadora existente
              <select value={dadosGerais.transportadora} onChange={(e) => setDadosGerais((p) => ({ ...p, transportadora: e.target.value }))}>
                {transportadoras.map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
              </select>
            </label>
            <label>
              Origem
              <input value={dadosGerais.origemNome} onChange={(e) => atualizarOrigem(e.target.value)} placeholder="Ex.: Itajai" />
            </label>
            <label>
              UF origem
              <input value={dadosGerais.ufOrigem} onChange={(e) => setDadosGerais((p) => ({ ...p, ufOrigem: e.target.value.toUpperCase() }))} />
            </label>
            <label>
              IBGE origem
              <input value={dadosGerais.ibgeOrigem} onChange={(e) => setDadosGerais((p) => ({ ...p, ibgeOrigem: e.target.value }))} />
            </label>
            <label>
              Canal
              <select value={dadosGerais.canal} onChange={(e) => setDadosGerais((p) => ({ ...p, canal: e.target.value }))}>
                <option value="ATACADO">ATACADO</option>
                <option value="B2C">B2C</option>
              </select>
            </label>
            <label>
              Método de envio
              <select value={dadosGerais.metodoEnvio} onChange={(e) => setDadosGerais((p) => ({ ...p, metodoEnvio: e.target.value }))}>
                <option value="Normal">Normal</option>
                <option value="Expresso">Expresso</option>
              </select>
            </label>
            <label>
              Regra de cálculo
              <select value={dadosGerais.regraCalculo} onChange={(e) => setDadosGerais((p) => ({ ...p, regraCalculo: e.target.value }))}>
                <option value="Maior valor">Maior valor</option>
                <option value="Menor valor">Menor valor</option>
                <option value="Sem regra">Sem regra</option>
              </select>
            </label>
            <label>
              Modelo de faixa
              <select value={dadosGerais.modeloFaixa} onChange={(e) => setDadosGerais((p) => ({ ...p, modeloFaixa: e.target.value }))}>
                <option value="B2B">B2B</option>
                <option value="B2C">B2C</option>
              </select>
            </label>
            <label>
              Início da vigência
              <input type="date" value={dadosGerais.vigenciaInicial} onChange={(e) => setDadosGerais((p) => ({ ...p, vigenciaInicial: e.target.value }))} />
            </label>
            <label>
              Término da vigência
              <input type="date" value={dadosGerais.vigenciaFinal} onChange={(e) => setDadosGerais((p) => ({ ...p, vigenciaFinal: e.target.value }))} />
            </label>
          </div>
        )}
      </section>

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Rotas</h3>
          <div className="acoes-formulario">
            <button className="botao-secundario pequeno" onClick={() => toggleSecao('rotas')}>{secaoAberta.rotas ? 'Fechar' : 'Abrir'}</button>
            {secaoAberta.rotas && (
              <>
                <input ref={inputImportarRotas} type="file" accept=".xlsx,.xls,.ods" style={{ display: 'none' }} onChange={importarRotas} />
                <button className="botao-secundario" onClick={exportarRotas}>Exportar modelo</button>
                <button className="botao-secundario" onClick={() => inputImportarRotas.current?.click()}>Importar rotas</button>
                <button className="botao-secundario" onClick={adicionarRota}>Adicionar rota</button>
              </>
            )}
          </div>
        </div>

        {secaoAberta.rotas && (
          <div className="lista-tabela">
            <div className="linha cabecalho" style={{ gridTemplateColumns: '1fr 0.8fr 0.9fr 1.15fr 0.5fr' }}>
              <span>IBGE destino</span>
              <span>Prazo</span>
              <span>Cotação base</span>
              <span>Cotação final</span>
              <span>Ações</span>
            </div>

            {rotas.map((rota) => (
              <div key={rota.id} className="linha" style={{ gridTemplateColumns: '1fr 0.8fr 0.9fr 1.15fr 0.5fr', alignItems: 'center' }}>
                <input value={rota.ibgeDestino} onChange={(e) => atualizarRota(rota.id, 'ibgeDestino', e.target.value)} />
                <input value={rota.prazo} onChange={(e) => atualizarRota(rota.id, 'prazo', e.target.value)} />
                <select value={rota.cotacaoBase} onChange={(e) => atualizarRota(rota.id, 'cotacaoBase', e.target.value)}>
                  {COTACOES_BASE.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <span>{rota.cotacaoFinal}</span>
                <button className="botao-link" onClick={() => setRotas((prev) => prev.filter((x) => x.id !== rota.id))}>Remover</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Fretes</h3>
          <div className="acoes-formulario">
            <button className="botao-secundario pequeno" onClick={() => toggleSecao('fretes')}>{secaoAberta.fretes ? 'Fechar' : 'Abrir'}</button>
            {secaoAberta.fretes && (
              <>
                <input ref={inputImportarFretes} type="file" accept=".xlsx,.xls,.ods" style={{ display: 'none' }} onChange={importarFretes} />
                <button className="botao-primario" onClick={aplicarFaixasEGerarFretes}>Aplicar faixas e gerar fretes</button>
                <button className="botao-secundario" onClick={exportarFretes}>Exportar modelo</button>
                <button className="botao-secundario" onClick={() => inputImportarFretes.current?.click()}>Importar fretes</button>
                <button className="botao-secundario" onClick={gerarArquivosParaSubir}>Gerar os 2 arquivos</button>
              </>
            )}
          </div>
        </div>

        {secaoAberta.fretes && (
          <div className="lista-tabela">
            <div className="linha cabecalho" style={{ gridTemplateColumns: '1.3fr 0.9fr 0.6fr 0.6fr 0.7fr 0.7fr 0.6fr 0.6fr' }}>
              <span>Cotação</span>
              <span>Faixa</span>
              <span>Peso mín.</span>
              <span>Peso limite</span>
              <span>Excesso</span>
              <span>Taxa</span>
              <span>% Frete</span>
              <span>Frete mín.</span>
            </div>
            {fretes.map((f) => (
              <div key={f.id} className="linha" style={{ gridTemplateColumns: '1.3fr 0.9fr 0.6fr 0.6fr 0.7fr 0.7fr 0.6fr 0.6fr', alignItems: 'center' }}>
                <span>{f.cotacaoFinal}</span>
                <span>{f.faixaPeso}</span>
                <span>{f.pesoInicial}</span>
                <span>{f.pesoFinal}</span>
                <input value={f.excessoPeso ?? ''} onChange={(e) => atualizarFrete(f.id, 'excessoPeso', e.target.value)} />
                <input value={f.taxaAplicada ?? ''} onChange={(e) => atualizarFrete(f.id, 'taxaAplicada', e.target.value)} />
                <input value={f.fretePercentual ?? ''} onChange={(e) => atualizarFrete(f.id, 'fretePercentual', e.target.value)} />
                <input value={f.freteMinimo ?? ''} onChange={(e) => atualizarFrete(f.id, 'freteMinimo', e.target.value)} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card-padrao">
        <div className="card-topo">
          <h3>Publicar / substituir em transportadora</h3>
          <button className="botao-secundario pequeno" onClick={() => toggleSecao('publicar')}>{secaoAberta.publicar ? 'Fechar' : 'Abrir'}</button>
        </div>
        {secaoAberta.publicar && (
          <>
            <p className="formatacao-texto">Se a transportadora já existir, você pode substituir direto a origem correspondente. O sistema mantém o histórico da tabela anterior.</p>
            <div className="acoes-formulario">
              <button className="botao-primario" onClick={publicarDireto}>Publicar direto na transportadora</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
