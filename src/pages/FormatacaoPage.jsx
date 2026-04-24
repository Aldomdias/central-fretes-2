import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';

const ORIGENS_FIXAS = {
  ITAJAI: { uf: 'SC', ibge: '4208203' },
  'ITAJAÍ': { uf: 'SC', ibge: '4208203' },
  CURITIBA: { uf: 'PR', ibge: '4106902' },
  BARUERI: { uf: 'SP', ibge: '3505708' },
  CONTAGEM: { uf: 'MG', ibge: '3118601' },
  SERRA: { uf: 'ES', ibge: '3205002' },
};

const COTACOES = ['CAPITAL', 'INTERIOR 1', 'INTERIOR 2', 'INTERIOR 3', 'INTERIOR 4', 'INTERIOR 5', 'INTERIOR 6', 'INTERIOR 7', 'INTERIOR 8', 'INTERIOR 9'];

const FAIXAS_PADRAO = {
  ATACADO: [
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
    { faixaPeso: '30 a 50 kg', pesoInicial: 30, pesoFinal: 50 },
    { faixaPeso: '50 a 70 kg', pesoInicial: 50, pesoFinal: 70 },
    { faixaPeso: '70 a 100 kg', pesoInicial: 70, pesoFinal: 100 },
    { faixaPeso: 'Acima de 100 kg (KG excedente)', pesoInicial: 100, pesoFinal: 999999999 },
  ],
};

const CODIGO_UNIDADE = {
  ATACADO: '0001 - B2B',
  B2C: '0001 - B2C',
};

function limpar(v) {
  return String(v ?? '').trim();
}

function normalizar(v) {
  return limpar(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function numero(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return v;
  const s = limpar(v);
  if (!s) return '';
  const t = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(t);
  return Number.isFinite(n) ? n : '';
}

function hojeISO(anos = 0) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + anos);
  return d.toISOString().slice(0, 10);
}

function baixarWorkbook(nome, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, rows }) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, nome);
}

function ufPorIbge(ibge) {
  const c = String(ibge || '').replace(/\D/g, '').slice(0, 2);
  const mapa = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
    '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC', '43': 'RS',
    '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
  };
  return mapa[c] || '';
}

function montarCotacaoFinal(origem, ibgeDestino, cotacaoBase) {
  return [limpar(origem), ufPorIbge(ibgeDestino), limpar(cotacaoBase).toUpperCase()].filter(Boolean).join(' - ');
}

function extrairFaixa(texto) {
  const bruto = limpar(texto);
  const up = normalizar(bruto);
  if (up.includes('ACIMA DE 300')) return { faixaPeso: 'Acima de 300 kg (KG excedente)', pesoInicial: 300, pesoFinal: 999999999 };
  if (up.includes('ACIMA DE 100')) return { faixaPeso: 'Acima de 100 kg (KG excedente)', pesoInicial: 100, pesoFinal: 999999999 };
  const m = bruto.match(/(\d+[.,]?\d*)\s*(?:a|até|ate|-|\/)\s*(\d+[.,]?\d*)/i);
  if (!m) return { faixaPeso: bruto, pesoInicial: '', pesoFinal: '' };
  return { faixaPeso: bruto, pesoInicial: numero(m[1]), pesoFinal: numero(m[2]) };
}

function parseHeader(rows) {
  return (rows[0] || []).map((v) => normalizar(v));
}

async function lerPrimeiraAba(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function baixarModeloTemplateRotas() {
  baixarWorkbook('Rotas-modelo-template.xlsx', [{
    name: 'Rotas',
    rows: [
      { 'IBGE DESTINO': '3205002', 'CIDADE DE DESTINO': 'Serra', 'UF DESTINO': 'ES', 'CEP INICIAL': '', 'CEP FINAL': '', PRAZO: 1, 'REGIÃO': 'CAPITAL' },
      { 'IBGE DESTINO': '3136702', 'CIDADE DE DESTINO': 'Juiz de Fora', 'UF DESTINO': 'MG', 'CEP INICIAL': '', 'CEP FINAL': '', PRAZO: 2, 'REGIÃO': 'INTERIOR 1' },
    ],
  }]);
}

function linhaModeloFrete(uf, faixa, valor, adVal) {
  const row = { 'UF DESTINO': uf, 'FAIXA PESO': faixa };
  COTACOES.forEach((c, idx) => {
    row[`${c} Frete kg (R$)`] = idx <= 1 ? valor : '';
    row[`${c} Ad Valorem(%)`] = idx <= 1 ? adVal : '';
  });
  return row;
}

function baixarModeloTemplateFretes(canal = 'ATACADO') {
  const excedente = canal === 'B2C' ? 'Acima de 100 kg (KG excedente)' : 'Acima de 300 kg (KG excedente)';
  const primeira = canal === 'B2C' ? '0 a 2 kg' : '0 a 20 kg';
  baixarWorkbook('Fretes-modelo-template.xlsx', [{
    name: 'Fretes',
    rows: [
      linhaModeloFrete('ES', primeira, 80, 0.03),
      linhaModeloFrete('ES', excedente, 0.95, 0.03),
    ],
  }]);
}

function exportarModeloManualRotas(rotas) {
  baixarWorkbook('modelo-rotas.xlsx', [{
    name: 'Rotas',
    rows: rotas.length
      ? rotas.map((r) => ({ 'IBGE DESTINO': r.ibgeDestino || '', PRAZO: r.prazo || '', 'COTAÇÃO BASE': r.cotacaoBase || '' }))
      : [{ 'IBGE DESTINO': '', PRAZO: '', 'COTAÇÃO BASE': '' }],
  }]);
}

function exportarModeloManualFretes(fretes) {
  baixarWorkbook('modelo-fretes.xlsx', [{
    name: 'Fretes',
    rows: fretes.length
      ? fretes.map((f) => ({
          'ROTA DO FRETE': f.cotacaoFinal || '',
          'FAIXA PESO': f.faixaPeso || '',
          'PESO MÍNIMO': f.pesoInicial || '',
          'PESO LIMITE': f.pesoFinal || '',
          'EXCESSO DE PESO': f.excessoPeso || '',
          'TAXA APLICADA': f.taxaAplicada || '',
          'FRETE PERCENTUAL': f.fretePercentual || '',
          'FRETE MÍNIMO': '',
        }))
      : [{
          'ROTA DO FRETE': '',
          'FAIXA PESO': '',
          'PESO MÍNIMO': '',
          'PESO LIMITE': '',
          'EXCESSO DE PESO': '',
          'TAXA APLICADA': '',
          'FRETE PERCENTUAL': '',
          'FRETE MÍNIMO': '',
        }],
  }]);
}

function exportarArquivoRotasFinal(dadosGerais, rotas) {
  const rows = rotas.map((r) => ({
    'Nome da transportadora': dadosGerais.nomeTransportadoraFinal || '',
    'Código da unidade': CODIGO_UNIDADE[dadosGerais.canal] || CODIGO_UNIDADE.ATACADO,
    Canal: dadosGerais.canal || 'ATACADO',
    Cotação: r.cotacaoFinal || '',
    'Código IBGE Origem': dadosGerais.ibgeOrigem || '',
    'Código IBGE Destino': r.ibgeDestino || '',
    'CEP inicial': r.cepInicial || '',
    'CEP final': r.cepFinal || '',
    'Método de envio': dadosGerais.metodoEnvio || 'Normal',
    'Prazo de entrega': r.prazo || '',
    'Início da vigência': dadosGerais.vigenciaInicial || '',
    'Término da vigência': dadosGerais.vigenciaFinal || '',
  }));
  baixarWorkbook('Rotas-para-subir.xlsx', [{ name: 'Prazos de frete', rows }]);
}

function exportarArquivoFretesFinal(dadosGerais, fretes) {
  const rows = fretes.map((f) => ({
    'Nome da transportadora': dadosGerais.nomeTransportadoraFinal || '',
    'Código da unidade': CODIGO_UNIDADE[dadosGerais.canal] || CODIGO_UNIDADE.ATACADO,
    Canal: dadosGerais.canal || 'ATACADO',
    'Regra de cálculo': dadosGerais.regraCalculo || 'Maior valor',
    'Tipo de cálculo': 'FAIXA',
    'Rota do frete': f.cotacaoFinal || '',
    'Peso mínimo': f.pesoInicial || '',
    'Peso limite': f.pesoFinal || '',
    'Excesso de peso': f.excessoPeso || '',
    'Taxa aplicada': f.taxaAplicada || '',
    'Frete percentual': f.fretePercentual || '',
    'Frete mínimo': '',
    'Início da vigência': dadosGerais.vigenciaInicial || '',
    'Fim da vigência': dadosGerais.vigenciaFinal || '',
  }));
  baixarWorkbook('Fretes-para-subir.xlsx', [{ name: 'Valores de frete', rows }]);
}

function buildOriginPayload(dadosGerais, rotas, fretes, existingOrigin) {
  return {
    ...(existingOrigin || {}),
    id: existingOrigin?.id,
    cidade: dadosGerais.origemNome,
    canal: dadosGerais.canal,
    status: 'Ativa',
    generalidades: {
      ...(existingOrigin?.generalidades || {}),
      tipoCalculo: 'FAIXA',
      regraCalculo: dadosGerais.regraCalculo || 'Maior valor',
    },
    rotas: rotas.map((r) => ({ ...r, id: r.id })),
    cotacoes: fretes.map((f) => ({ ...f, id: f.id })),
    taxasEspeciais: existingOrigin?.taxasEspeciais || [],
  };
}

export default function FormatacaoPage({ transportadoras = [], store }) {
  const inputRotasManual = useRef(null);
  const inputFretesManual = useRef(null);

  const [workflow, setWorkflow] = useState('');
  const [arquivoRotasTemplate, setArquivoRotasTemplate] = useState(null);
  const [arquivoFretesTemplate, setArquivoFretesTemplate] = useState(null);
  const [mensagem, setMensagem] = useState('');

  const [usarNovaTransportadora, setUsarNovaTransportadora] = useState(false);
  const [novaTransportadora, setNovaTransportadora] = useState('');

  const [dadosGerais, setDadosGerais] = useState({
    transportadora: transportadoras[0]?.nome || '',
    origemNome: '',
    ufOrigem: '',
    ibgeOrigem: '',
    canal: 'ATACADO',
    metodoEnvio: 'Normal',
    regraCalculo: 'Maior valor',
    vigenciaInicial: hojeISO(0),
    vigenciaFinal: hojeISO(2),
  });

  const [modelosFaixa, setModelosFaixa] = useState([
    { nome: 'B2B padrão', canal: 'ATACADO', itens: FAIXAS_PADRAO.ATACADO },
    { nome: 'B2C padrão', canal: 'B2C', itens: FAIXAS_PADRAO.B2C },
  ]);
  const [modeloFaixaSelecionado, setModeloFaixaSelecionado] = useState('B2B padrão');
  const [novoModeloNome, setNovoModeloNome] = useState('');

  const [rotas, setRotas] = useState([]);
  const [fretes, setFretes] = useState([]);

  const faixasAtuais = useMemo(() => {
    const encontrado = modelosFaixa.find((m) => m.nome === modeloFaixaSelecionado);
    return encontrado?.itens || (dadosGerais.canal === 'B2C' ? FAIXAS_PADRAO.B2C : FAIXAS_PADRAO.ATACADO);
  }, [modelosFaixa, modeloFaixaSelecionado, dadosGerais.canal]);

  const nomeTransportadoraFinal = usarNovaTransportadora ? limpar(novaTransportadora) : limpar(dadosGerais.transportadora);

  function atualizarOrigem(valor) {
    const fixa = ORIGENS_FIXAS[normalizar(valor)];
    setDadosGerais((prev) => ({ ...prev, origemNome: valor, ufOrigem: fixa?.uf || '', ibgeOrigem: fixa?.ibge || '' }));
    setRotas((prev) => prev.map((r) => ({ ...r, cotacaoFinal: montarCotacaoFinal(valor, r.ibgeDestino, r.cotacaoBase) })));
  }

  function criarModeloFaixaNovo() {
    if (!limpar(novoModeloNome)) return;
    const base = dadosGerais.canal === 'B2C' ? FAIXAS_PADRAO.B2C : FAIXAS_PADRAO.ATACADO;
    const novo = { nome: limpar(novoModeloNome), canal: dadosGerais.canal, itens: JSON.parse(JSON.stringify(base)) };
    setModelosFaixa((prev) => [...prev, novo]);
    setModeloFaixaSelecionado(novo.nome);
    setNovoModeloNome('');
    setMensagem(`Modelo de faixa "${novo.nome}" criado.`);
  }

  function atualizarItemFaixa(index, campo, valor) {
    setModelosFaixa((prev) =>
      prev.map((m) =>
        m.nome !== modeloFaixaSelecionado
          ? m
          : {
              ...m,
              itens: m.itens.map((item, idx) =>
                idx !== index ? item : { ...item, [campo]: campo === 'faixaPeso' ? String(valor ?? '') : numero(valor) }
              ),
            }
      )
    );
  }

  function adicionarFaixa() {
    setModelosFaixa((prev) => prev.map((m) => (m.nome !== modeloFaixaSelecionado ? m : { ...m, itens: [...m.itens, { faixaPeso: '', pesoInicial: '', pesoFinal: '' }] })));
  }

  function removerFaixa(index) {
    setModelosFaixa((prev) => prev.map((m) => (m.nome !== modeloFaixaSelecionado ? m : { ...m, itens: m.itens.filter((_, idx) => idx !== index) })));
  }

  function resetEscolha() {
    setWorkflow('');
    setMensagem('');
  }

  async function importarTemplatePreenchido() {
    if (!arquivoRotasTemplate || !arquivoFretesTemplate) {
      setMensagem('Selecione os dois arquivos do template.');
      return;
    }
    if (!dadosGerais.origemNome || !dadosGerais.ibgeOrigem) {
      setMensagem('Preencha a origem antes de importar o template.');
      return;
    }
    if (!nomeTransportadoraFinal) {
      setMensagem('Selecione uma transportadora existente ou marque nova transportadora e informe o nome.');
      return;
    }

    try {
      const rowsRotas = await lerPrimeiraAba(arquivoRotasTemplate);
      const rowsFretes = await lerPrimeiraAba(arquivoFretesTemplate);

      const hRot = parseHeader(rowsRotas);
      const idxIbgeDestino = hRot.findIndex((h) => h === 'IBGE DESTINO');
      const idxPrazo = hRot.findIndex((h) => h.startsWith('PRAZO'));
      const idxRegiao = hRot.findIndex((h) => h.startsWith('REGIAO') || h.startsWith('REGIÃO'));
      const idxCepIni = hRot.findIndex((h) => h === 'CEP INICIAL');
      const idxCepFim = hRot.findIndex((h) => h === 'CEP FINAL');

      const novasRotas = [];
      for (let i = 1; i < rowsRotas.length; i++) {
        const row = rowsRotas[i] || [];
        const ibgeDestino = limpar(row[idxIbgeDestino]);
        if (!ibgeDestino) continue;
        const cotacaoBase = limpar(row[idxRegiao]) || 'CAPITAL';
        novasRotas.push({
          id: `tr${i}`,
          ibgeDestino,
          prazo: limpar(row[idxPrazo]),
          cotacaoBase,
          cepInicial: limpar(row[idxCepIni]),
          cepFinal: limpar(row[idxCepFim]),
          cotacaoFinal: montarCotacaoFinal(dadosGerais.origemNome, ibgeDestino, cotacaoBase),
        });
      }

      const hFrete = parseHeader(rowsFretes);
      const idxUfDestino = hFrete.findIndex((h) => h === 'UF DESTINO');
      const idxFaixa = hFrete.findIndex((h) => h === 'FAIXA PESO');
      const blocos = [];
      (rowsFretes[0] || []).forEach((cell, c) => {
        const nome = limpar(cell);
        if (nome.endsWith('Frete kg (R$)')) {
          const base = nome.replace(' Frete kg (R$)', '');
          blocos.push({ cotacaoBase: base, freteCol: c, adValCol: c + 1 });
        }
      });

      const novasFretes = [];
      const ultimoFixo = {};
      for (let i = 1; i < rowsFretes.length; i++) {
        const row = rowsFretes[i] || [];
        const ufDestino = limpar(row[idxUfDestino]);
        const faixa = extrairFaixa(row[idxFaixa]);
        if (!ufDestino || !faixa.faixaPeso) continue;
        blocos.forEach((b) => {
          const freteKg = numero(row[b.freteCol]);
          const adVal = numero(row[b.adValCol]);
          if (freteKg === '' && adVal === '') return;
          const chave = `${ufDestino}|${b.cotacaoBase}`;
          const excedente = normalizar(faixa.faixaPeso).includes('ACIMA DE');
          let taxaAplicada = '';
          let excessoPeso = '';
          if (excedente) {
            taxaAplicada = ultimoFixo[chave] || '';
            excessoPeso = freteKg || '';
          } else {
            taxaAplicada = freteKg || '';
            ultimoFixo[chave] = freteKg || ultimoFixo[chave];
          }
          novasFretes.push({
            id: `tf${i}-${b.cotacaoBase}`,
            cotacaoFinal: [dadosGerais.origemNome, ufDestino, b.cotacaoBase].join(' - '),
            faixaPeso: faixa.faixaPeso,
            pesoInicial: faixa.pesoInicial,
            pesoFinal: faixa.pesoFinal,
            excessoPeso,
            taxaAplicada,
            fretePercentual: adVal || '',
          });
        });
      }

      setRotas(novasRotas);
      setFretes(novasFretes);
      setWorkflow('template');
      setMensagem('Template importado com sucesso.');
    } catch (error) {
      setMensagem(`Erro ao importar template: ${error.message}`);
    }
  }

  function entrarManual() {
    if (!dadosGerais.origemNome || !dadosGerais.ibgeOrigem) {
      setMensagem('Preencha a origem antes de entrar no fluxo manual.');
      return;
    }
    if (!nomeTransportadoraFinal) {
      setMensagem('Selecione uma transportadora existente ou marque nova transportadora e informe o nome.');
      return;
    }
    setWorkflow('manual');
    setMensagem('Fluxo manual da plataforma ativo.');
  }

  function adicionarRota() {
    setRotas((prev) => [...prev, { id: `r-${Date.now()}`, ibgeDestino: '', prazo: '', cotacaoBase: 'CAPITAL', cotacaoFinal: '' }]);
  }

  function atualizarRota(id, campo, valor) {
    setRotas((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, [campo]: String(valor ?? '') };
        next.cotacaoFinal = montarCotacaoFinal(dadosGerais.origemNome, next.ibgeDestino, next.cotacaoBase);
        return next;
      })
    );
  }

  function removerRota(id) {
    setRotas((prev) => prev.filter((r) => r.id !== id));
  }

  function aplicarFaixasEGerarFretes() {
    const unicas = Array.from(new Map(rotas.map((r) => [r.cotacaoFinal, r])).values()).filter((r) => r.cotacaoFinal);
    const gerados = [];
    unicas.forEach((rota) => {
      faixasAtuais.forEach((faixa, idx) => {
        gerados.push({
          id: `${rota.cotacaoFinal}-${idx}`,
          cotacaoFinal: rota.cotacaoFinal,
          faixaPeso: faixa.faixaPeso,
          pesoInicial: faixa.pesoInicial,
          pesoFinal: faixa.pesoFinal,
          excessoPeso: '',
          taxaAplicada: '',
          fretePercentual: '',
        });
      });
    });
    setFretes(gerados);
    setMensagem(`${gerados.length} linhas de frete geradas.`);
  }

  async function importarRotasManual(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await lerPrimeiraAba(file);
    const header = parseHeader(rows);
    const idxIbge = header.findIndex((h) => h === 'IBGE DESTINO');
    const idxPrazo = header.findIndex((h) => h.startsWith('PRAZO'));
    const idxCot = header.findIndex((h) => h === 'COTAÇÃO BASE' || h === 'COTACAO BASE');
    const novas = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const ibgeDestino = limpar(row[idxIbge]);
      if (!ibgeDestino) continue;
      const cotacaoBase = limpar(row[idxCot]) || 'CAPITAL';
      novas.push({
        id: `mr${i}`,
        ibgeDestino,
        prazo: limpar(row[idxPrazo]),
        cotacaoBase,
        cotacaoFinal: montarCotacaoFinal(dadosGerais.origemNome, ibgeDestino, cotacaoBase),
      });
    }
    setRotas(novas);
    setMensagem(`${novas.length} rotas importadas.`);
    event.target.value = '';
  }

  async function importarFretesManual(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = await lerPrimeiraAba(file);
    const header = parseHeader(rows);
    const idxRota = header.findIndex((h) => h === 'ROTA DO FRETE');
    const idxFaixa = header.findIndex((h) => h === 'FAIXA PESO');
    const idxPesoMin = header.findIndex((h) => h === 'PESO MÍNIMO' || h === 'PESO MINIMO');
    const idxPesoLim = header.findIndex((h) => h === 'PESO LIMITE');
    const idxExc = header.findIndex((h) => h === 'EXCESSO DE PESO');
    const idxTaxa = header.findIndex((h) => h === 'TAXA APLICADA');
    const idxPerc = header.findIndex((h) => h === 'FRETE PERCENTUAL');
    const novos = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const rota = limpar(row[idxRota]);
      if (!rota) continue;
      novos.push({
        id: `mf${i}`,
        cotacaoFinal: rota,
        faixaPeso: limpar(row[idxFaixa]),
        pesoInicial: limpar(row[idxPesoMin]),
        pesoFinal: limpar(row[idxPesoLim]),
        excessoPeso: limpar(row[idxExc]),
        taxaAplicada: limpar(row[idxTaxa]),
        fretePercentual: limpar(row[idxPerc]),
      });
    }
    setFretes(novos);
    setMensagem(`${novos.length} fretes importados.`);
    event.target.value = '';
  }

  function atualizarFrete(id, campo, valor) {
    setFretes((prev) => prev.map((f) => (f.id !== id ? f : { ...f, [campo]: String(valor ?? '') })));
  }

  function gerarArquivosFinais() {
    exportarArquivoRotasFinal({ ...dadosGerais, nomeTransportadoraFinal }, rotas);
    setTimeout(() => exportarArquivoFretesFinal({ ...dadosGerais, nomeTransportadoraFinal }, fretes), 400);
  }

  function incluirNaTransportadora() {
    if (!store || typeof store.salvarOrigem !== 'function' || typeof store.salvarTransportadora !== 'function') {
      setMensagem('Funções de salvar transportadora/origem não estão conectadas.');
      return;
    }

    const nome = nomeTransportadoraFinal;
    if (!nome) {
      setMensagem('Informe a transportadora.');
      return;
    }

    let targetTransportadora = transportadoras.find((t) => normalizar(t.nome) === normalizar(nome));
    let transportadoraId = targetTransportadora?.id;

    if (!targetTransportadora) {
      transportadoraId = `fmt-${Date.now()}`;
      store.salvarTransportadora({ id: transportadoraId, nome, status: 'Ativa', origens: [] });
      targetTransportadora = { id: transportadoraId, nome, origens: [] };
    }

    const origemExistente = (targetTransportadora.origens || []).find(
      (o) => normalizar(o.cidade) === normalizar(dadosGerais.origemNome) && normalizar(o.canal || 'ATACADO') === normalizar(dadosGerais.canal)
    );

    store.salvarOrigem(transportadoraId, buildOriginPayload({ ...dadosGerais, nomeTransportadoraFinal }, rotas, fretes, origemExistente));
    setMensagem(`Tabela incluída na transportadora ${nome}.`);
  }

  const tableStyle = { width: '100%', borderCollapse: 'collapse' };
  const thtd = { borderBottom: '1px solid var(--border-soft)', padding: '10px 8px', verticalAlign: 'top' };

  return (
    <div className="page-shell">
      <div className="page-top">
        <div className="page-header">
          <div className="amd-mini-brand">AMD Log</div>
          <h1>Formatação de Tabelas</h1>
          <p>Dois fluxos separados de verdade: template completo e preenchimento manual na plataforma.</p>
        </div>
        {workflow ? (
          <div className="toggle-row">
            <button className="botao-secundario" type="button" onClick={resetEscolha}>Voltar à escolha inicial</button>
          </div>
        ) : null}
      </div>

      {mensagem ? <section className="card-padrao panel-card"><p>{mensagem}</p></section> : null}

      <section className="card-padrao panel-card">
        <div className="panel-title">Configuração base</div>
        <div className="form-grid">
          <label>
            Origem
            <input value={dadosGerais.origemNome} onChange={(e) => atualizarOrigem(e.target.value)} placeholder="Ex.: Serra" />
          </label>
          <label>
            UF origem
            <input value={dadosGerais.ufOrigem} readOnly />
          </label>
          <label>
            IBGE origem
            <input value={dadosGerais.ibgeOrigem} readOnly />
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
            Início da vigência
            <input type="date" value={dadosGerais.vigenciaInicial} onChange={(e) => setDadosGerais((p) => ({ ...p, vigenciaInicial: e.target.value }))} />
          </label>
          <label>
            Término da vigência
            <input type="date" value={dadosGerais.vigenciaFinal} onChange={(e) => setDadosGerais((p) => ({ ...p, vigenciaFinal: e.target.value }))} />
          </label>
          <label className="checkbox-field">
            <span>Nova transportadora</span>
            <input type="checkbox" checked={usarNovaTransportadora} onChange={(e) => setUsarNovaTransportadora(e.target.checked)} />
          </label>
          {usarNovaTransportadora ? (
            <label>
              Nome da nova transportadora
              <input value={novaTransportadora} onChange={(e) => setNovaTransportadora(e.target.value)} placeholder="Ex.: Nova Cargas" />
            </label>
          ) : (
            <label>
              Transportadora existente
              <select value={dadosGerais.transportadora} onChange={(e) => setDadosGerais((p) => ({ ...p, transportadora: e.target.value }))}>
                {transportadoras.map((t) => <option key={t.id} value={t.nome}>{t.nome}</option>)}
              </select>
            </label>
          )}
        </div>
      </section>

      {!workflow ? (
        <div className="grade-dupla">
          <section className="card-padrao panel-card">
            <div className="panel-title">Fluxo 1 — Importar template completo</div>
            <p>Preencha origem, transportadora e canal aqui na tela. Depois anexe Rotas e Fretes do template.</p>
            <div className="toggle-row">
              <button className="botao-secundario" type="button" onClick={baixarModeloTemplateRotas}>Baixar modelo de Rotas</button>
              <button className="botao-secundario" type="button" onClick={() => baixarModeloTemplateFretes(dadosGerais.canal)}>Baixar modelo de Fretes</button>
            </div>
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
            <div className="toggle-row">
              <button className="botao-primario" type="button" onClick={importarTemplatePreenchido}>Importar e formatar automaticamente</button>
            </div>
          </section>

          <section className="card-padrao panel-card">
            <div className="panel-title">Fluxo 2 — Preencher manualmente na plataforma</div>
            <p>Escolha a origem, a transportadora, o canal, defina as faixas e monte a tabela dentro do sistema.</p>
            <div className="toggle-row">
              <button className="botao-primario" type="button" onClick={entrarManual}>Usar modelo criado na ferramenta</button>
            </div>
          </section>
        </div>
      ) : (
        <>
          {workflow === 'manual' ? (
            <>
              <section className="card-padrao panel-card">
                <div className="cabecalho-pagina">
                  <h3>Modelos de faixa</h3>
                  <div className="toggle-row">
                    <select value={modeloFaixaSelecionado} onChange={(e) => setModeloFaixaSelecionado(e.target.value)}>
                      {modelosFaixa.map((m) => <option key={m.nome} value={m.nome}>{m.nome}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-grid">
                  <label>
                    Novo modelo de faixa
                    <input value={novoModeloNome} onChange={(e) => setNovoModeloNome(e.target.value)} placeholder="Ex.: B2B especial" />
                  </label>
                  <div className="row-actions">
                    <button className="botao-secundario" type="button" onClick={criarModeloFaixaNovo}>Criar novo modelo</button>
                    <button className="botao-secundario" type="button" onClick={adicionarFaixa}>Adicionar faixa</button>
                  </div>
                </div>
                <table style={tableStyle}>
                  <thead><tr><th style={thtd}>Faixa</th><th style={thtd}>Peso mínimo</th><th style={thtd}>Peso limite</th><th style={thtd}>Ação</th></tr></thead>
                  <tbody>
                    {faixasAtuais.map((item, idx) => (
                      <tr key={`${modeloFaixaSelecionado}-${idx}`}>
                        <td style={thtd}><input value={item.faixaPeso} onChange={(e) => atualizarItemFaixa(idx, 'faixaPeso', e.target.value)} /></td>
                        <td style={thtd}><input value={item.pesoInicial} onChange={(e) => atualizarItemFaixa(idx, 'pesoInicial', e.target.value)} /></td>
                        <td style={thtd}><input value={item.pesoFinal} onChange={(e) => atualizarItemFaixa(idx, 'pesoFinal', e.target.value)} /></td>
                        <td style={thtd}><button className="botao-secundario" type="button" onClick={() => removerFaixa(idx)}>Remover</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="card-padrao panel-card">
                <div className="cabecalho-pagina">
                  <h3>Rotas</h3>
                  <div className="toggle-row">
                    <input ref={inputRotasManual} type="file" accept=".xlsx,.xls,.ods" style={{ display: 'none' }} onChange={importarRotasManual} />
                    <button className="botao-secundario" type="button" onClick={() => exportarModeloManualRotas(rotas)}>Exportar modelo</button>
                    <button className="botao-secundario" type="button" onClick={() => inputRotasManual.current?.click()}>Importar rotas</button>
                    <button className="botao-secundario" type="button" onClick={adicionarRota}>Adicionar rota</button>
                  </div>
                </div>
                <table style={tableStyle}>
                  <thead><tr><th style={thtd}>IBGE destino</th><th style={thtd}>Prazo</th><th style={thtd}>Cotação base</th><th style={thtd}>Cotação final</th><th style={thtd}>Ação</th></tr></thead>
                  <tbody>
                    {rotas.map((r) => (
                      <tr key={r.id}>
                        <td style={thtd}><input value={r.ibgeDestino} onChange={(e) => atualizarRota(r.id, 'ibgeDestino', e.target.value)} /></td>
                        <td style={thtd}><input value={r.prazo} onChange={(e) => atualizarRota(r.id, 'prazo', e.target.value)} /></td>
                        <td style={thtd}><select value={r.cotacaoBase} onChange={(e) => atualizarRota(r.id, 'cotacaoBase', e.target.value)}>{COTACOES.map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
                        <td style={thtd}><input value={r.cotacaoFinal} readOnly /></td>
                        <td style={thtd}><button className="botao-secundario" type="button" onClick={() => removerRota(r.id)}>Remover</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="card-padrao panel-card">
                <div className="cabecalho-pagina">
                  <h3>Fretes</h3>
                  <div className="toggle-row">
                    <input ref={inputFretesManual} type="file" accept=".xlsx,.xls,.ods" style={{ display: 'none' }} onChange={importarFretesManual} />
                    <button className="botao-primario" type="button" onClick={aplicarFaixasEGerarFretes}>Aplicar faixas e gerar fretes</button>
                    <button className="botao-secundario" type="button" onClick={() => exportarModeloManualFretes(fretes)}>Exportar modelo</button>
                    <button className="botao-secundario" type="button" onClick={() => inputFretesManual.current?.click()}>Importar fretes</button>
                  </div>
                </div>
                <table style={tableStyle}>
                  <thead><tr><th style={thtd}>Rota</th><th style={thtd}>Faixa</th><th style={thtd}>Peso mín.</th><th style={thtd}>Peso limite</th><th style={thtd}>Excesso</th><th style={thtd}>Taxa</th><th style={thtd}>% Frete</th></tr></thead>
                  <tbody>
                    {fretes.map((f) => (
                      <tr key={f.id}>
                        <td style={thtd}><input value={f.cotacaoFinal} readOnly /></td>
                        <td style={thtd}><input value={f.faixaPeso} readOnly /></td>
                        <td style={thtd}><input value={f.pesoInicial} readOnly /></td>
                        <td style={thtd}><input value={f.pesoFinal} readOnly /></td>
                        <td style={thtd}><input value={f.excessoPeso} onChange={(e) => atualizarFrete(f.id, 'excessoPeso', e.target.value)} /></td>
                        <td style={thtd}><input value={f.taxaAplicada} onChange={(e) => atualizarFrete(f.id, 'taxaAplicada', e.target.value)} /></td>
                        <td style={thtd}><input value={f.fretePercentual} onChange={(e) => atualizarFrete(f.id, 'fretePercentual', e.target.value)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          ) : (
            <section className="card-padrao panel-card">
              <div className="panel-title">Template importado</div>
              <p>{rotas.length} rotas carregadas.</p>
              <p>{fretes.length} fretes carregados.</p>
            </section>
          )}

          <section className="card-padrao panel-card">
            <div className="panel-title">Ações finais</div>
            <p>Nos dois fluxos você consegue gerar os 2 arquivos finais ou incluir direto na transportadora.</p>
            <div className="toggle-row">
              <button className="botao-primario" type="button" onClick={gerarArquivosFinais}>Gerar os 2 arquivos</button>
              <button className="botao-secundario" type="button" onClick={incluirNaTransportadora}>Incluir na transportadora</button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
