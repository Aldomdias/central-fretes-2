// Excel "bonito" e reaproveitavel: cabecalho azul, linhas zebradas, bordas, R$ contabil, datas reais,
// filtro automatico e cabecalho congelado (mesmo padrao da exportacao de faturas da Auditoria).
//
// colunas: [{ titulo, largura?, tipo?: 'texto' | 'moeda' | 'numero' | 'inteiro' | 'data' | 'datahora' | 'centro' }]
// linhas:  arrays na mesma ordem das colunas (datas podem vir como Date ou string ISO)
// resumo:  opcional, [[rotulo, valor], ...] -> aba "Filtros" com o que foi aplicado na tela
function paraData(v) {
  if (!v) return '';
  if (v instanceof Date) return v;
  const texto = String(v);
  const d = texto.includes('T') ? new Date(texto) : new Date(`${texto.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? texto : d;
}

const CONTAB = '_-"R$"\\ * #,##0.00_-;\\-"R$"\\ * #,##0.00_-;_-"R$"\\ * "-"??_-;_-@_-';
const fonte = (extra = {}) => ({ name: 'Calibri', sz: 11, color: { rgb: 'FF1F2937' }, ...extra });
const preenche = (rgb) => ({ patternType: 'solid', fgColor: { rgb }, bgColor: { rgb } });
const borda = { style: 'thin', color: { rgb: 'FFD1D5DB' } };
const bordas = { top: borda, bottom: borda, left: borda, right: borda };

// Monta uma aba formatada (cabeçalho azul, zebrado, R$ contábil, filtro e cabeçalho congelado).
// tipos extras: 'percentual' (valor já em %, ex.: 12.5) e 'texto_longo' (quebra linha).
function valorTipado(tipo, valor) {
  if (tipo === 'data' || tipo === 'datahora') return paraData(valor);
  if (['moeda', 'numero', 'inteiro', 'percentual'].includes(tipo)) return valor === '' || valor == null ? '' : Number(valor || 0);
  return valor == null ? '' : valor;
}

function estiloCelula(ws, ref, tipo, fundo, extraFonte = {}) {
  const horizontal = ['moeda', 'numero', 'percentual'].includes(tipo) ? 'right'
    : ['inteiro', 'data', 'datahora', 'centro'].includes(tipo) ? 'center' : 'left';
  ws[ref].s = { font: fonte(extraFonte), fill: fundo, border: bordas, alignment: { vertical: 'center', horizontal, wrapText: tipo === 'texto_longo' } };
  if (tipo === 'moeda' && ws[ref].t === 'n') ws[ref].z = CONTAB;
  if (tipo === 'numero' && ws[ref].t === 'n') ws[ref].z = '#,##0.00';
  if (tipo === 'inteiro' && ws[ref].t === 'n') ws[ref].z = '#,##0';
  if (tipo === 'percentual' && ws[ref].t === 'n') ws[ref].z = '0.0"%"';
  if (tipo === 'data' && ws[ref].t === 'd') ws[ref].z = 'dd/mm/yyyy';
  if (tipo === 'datahora' && ws[ref].t === 'd') ws[ref].z = 'dd/mm/yyyy hh:mm';
}

const ESTILO_CABECALHO = { font: fonte({ bold: true, color: { rgb: 'FFFFFFFF' } }), fill: preenche('FF1E3A8A'), alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: bordas };

// Aba de resumo: titulo, linhas de informacao e blocos de tabela empilhados
// ({ titulo, colunas, linhas, totais? }), cada um com cabecalho azul e total em negrito.
function montarAbaBlocos(XS, { titulo = '', informacoes = [], blocos = [] } = {}) {
  const ws = {};
  let r = 0;
  let maxCol = 1;
  const por = (c, linha, v, s) => { const ref = XS.utils.encode_cell({ r: linha, c }); ws[ref] = typeof v === 'number' ? { t: 'n', v } : v instanceof Date ? { t: 'd', v } : { t: 's', v: String(v ?? '') }; if (s) ws[ref].s = s; return ref; };
  const merges = [];
  const linhasAltura = [];
  if (titulo) {
    por(0, r, titulo, { font: fonte({ bold: true, sz: 16, color: { rgb: 'FF1E3A8A' } }) });
    linhasAltura[r] = { hpt: 26 };
    r += 1;
  }
  informacoes.forEach((info) => { por(0, r, info, { font: fonte({ color: { rgb: 'FF475569' } }) }); r += 1; });
  if (titulo || informacoes.length) r += 1;
  for (const b of blocos) {
    const n = b.colunas.length;
    maxCol = Math.max(maxCol, n);
    por(0, r, b.titulo, { font: fonte({ bold: true, sz: 12, color: { rgb: 'FFFFFFFF' } }), fill: preenche('FF334155'), alignment: { vertical: 'center' } });
    for (let c = 1; c < n; c += 1) por(c, r, '', { fill: preenche('FF334155') });
    if (n > 1) merges.push({ s: { r, c: 0 }, e: { r, c: n - 1 } });
    linhasAltura[r] = { hpt: 20 };
    r += 1;
    b.colunas.forEach((col, c) => por(c, r, col.titulo, ESTILO_CABECALHO));
    linhasAltura[r] = { hpt: 30 };
    r += 1;
    (b.linhas || []).forEach((linha, i) => {
      const fundo = preenche(i % 2 === 0 ? 'FFFFFFFF' : 'FFF1F5F9');
      b.colunas.forEach((col, c) => { const ref = por(c, r, valorTipado(col.tipo, linha[c])); estiloCelula(ws, ref, col.tipo || 'texto', fundo, linha.destaque ? { bold: true } : {}); });
      r += 1;
    });
    if (b.totais) {
      b.colunas.forEach((col, c) => { const ref = por(c, r, valorTipado(col.tipo, b.totais[c])); estiloCelula(ws, ref, col.tipo || 'texto', preenche('FFDBEAFE'), { bold: true }); });
      r += 1;
    }
    r += 1;
  }
  const larguras = [];
  blocos.forEach((b) => b.colunas.forEach((col, c) => { larguras[c] = Math.max(larguras[c] || 0, col.largura || 16); }));
  ws['!cols'] = Array.from({ length: maxCol }, (_, c) => ({ wch: larguras[c] || 16 }));
  ws['!rows'] = linhasAltura;
  ws['!merges'] = merges;
  ws['!ref'] = `A1:${XS.utils.encode_col(maxCol - 1)}${Math.max(r, 1)}`;
  return ws;
}

function montarAbaFormatada(XS, colunas = [], linhas = [], totais = null, simples = false) {
  const corpo = linhas.map((linha) => linha.map((valor, i) => {
    const tipo = colunas[i]?.tipo;
    if (tipo === 'data' || tipo === 'datahora') return paraData(valor);
    if (['moeda', 'numero', 'inteiro', 'percentual'].includes(tipo)) return valor === '' || valor == null ? '' : Number(valor || 0);
    return valor == null ? '' : valor;
  }));
  const cabecalho = colunas.map((c) => c.titulo);
  const ws = XS.utils.aoa_to_sheet([cabecalho, ...corpo], { cellDates: true });
  const total = colunas.length;

  for (let col = 0; col < total; col += 1) {
    const ref = XS.utils.encode_cell({ r: 0, c: col });
    ws[ref].s = { font: fonte({ bold: true, color: { rgb: 'FFFFFFFF' } }), fill: preenche('FF1E3A8A'), alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: bordas };
  }
  if (simples) {
    // aba grande: so cabecalho estilizado + formato de numero (estilo em toda celula pesa demais)
    corpo.forEach((_, i) => colunas.forEach((c, col) => {
      const ref = XS.utils.encode_cell({ r: i + 1, c: col });
      if (!ws[ref] || ws[ref].t !== 'n' && ws[ref].t !== 'd') return;
      if (c.tipo === 'moeda') ws[ref].z = '#,##0.00';
      if (c.tipo === 'data') ws[ref].z = 'dd/mm/yyyy';
    }));
  } else corpo.forEach((_, i) => {
    const fundo = preenche(i % 2 === 0 ? 'FFFFFFFF' : 'FFF1F5F9');
    for (let col = 0; col < total; col += 1) {
      const ref = XS.utils.encode_cell({ r: i + 1, c: col });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      const tipo = colunas[col]?.tipo || 'texto';
      const horizontal = ['moeda', 'numero', 'percentual'].includes(tipo) ? 'right'
        : ['inteiro', 'data', 'datahora', 'centro'].includes(tipo) ? 'center' : 'left';
      ws[ref].s = { font: fonte(), fill: fundo, border: bordas, alignment: { vertical: 'center', horizontal, wrapText: tipo === 'texto_longo' } };
      if (tipo === 'moeda' && ws[ref].t === 'n') ws[ref].z = CONTAB;
      if (tipo === 'numero' && ws[ref].t === 'n') ws[ref].z = '#,##0.00';
      if (tipo === 'percentual' && ws[ref].t === 'n') ws[ref].z = '0.0"%"';
      if (tipo === 'data' && ws[ref].t === 'd') ws[ref].z = 'dd/mm/yyyy';
      if (tipo === 'datahora' && ws[ref].t === 'd') ws[ref].z = 'dd/mm/yyyy hh:mm';
    }
  });
  ws['!cols'] = colunas.map((c) => ({ wch: c.largura || 16 }));
  ws['!rows'] = [{ hpt: 32 }];
  if (totais) {
    const r = corpo.length + 1;
    colunas.forEach((c, col) => {
      const ref = XS.utils.encode_cell({ r, c: col });
      const v = valorTipado(c.tipo, totais[col]);
      ws[ref] = typeof v === 'number' ? { t: 'n', v } : { t: 's', v: String(v ?? '') };
      estiloCelula(ws, ref, c.tipo || 'texto', preenche('FFDBEAFE'), { bold: true });
    });
  }
  const ultima = corpo.length + 1 + (totais ? 1 : 0);
  const ultimaCol = XS.utils.encode_col(Math.max(total - 1, 0));
  ws['!autofilter'] = { ref: `A1:${ultimaCol}${ultima}` };
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  ws['!ref'] = `A1:${ultimaCol}${ultima}`;
  return ws;
}

// Várias abas no mesmo arquivo: abas = [{ nome, colunas, linhas }]
export async function exportarExcelMultiAbas({ nomeArquivo, abas = [], retornarBytes = false }) {
  const { default: XS } = await import('xlsx-js-style');
  const wb = XS.utils.book_new();
  const usados = new Set();
  for (const aba of abas) {
    let nome = String(aba.nome || 'Aba').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    while (usados.has(nome)) nome = `${nome.slice(0, 28)}_${usados.size}`;
    usados.add(nome);
    const ws = aba.blocos ? montarAbaBlocos(XS, aba) : montarAbaFormatada(XS, aba.colunas || [], aba.linhas || [], aba.totais || null, aba.simples === true);
    XS.utils.book_append_sheet(wb, ws, nome);
  }
  if (retornarBytes) return XS.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true, compression: true });
  XS.writeFile(wb, nomeArquivo, { cellDates: true, compression: true });
  return null;
}

export async function exportarExcelFormatado({ nomeArquivo, aba = 'Dados', colunas = [], linhas = [], resumo = null, retornarBytes = false }) {
  const { default: XS } = await import('xlsx-js-style');
  const ws = montarAbaFormatada(XS, colunas, linhas);

  const wb = XS.utils.book_new();
  XS.utils.book_append_sheet(wb, ws, String(aba).slice(0, 31));

  if (resumo?.length) {
    const wr = XS.utils.aoa_to_sheet([['Filtro', 'Valor'], ...resumo]);
    ['A1', 'B1'].forEach((ref) => { wr[ref].s = { font: fonte({ bold: true, color: { rgb: 'FFFFFFFF' } }), fill: preenche('FF1E3A8A'), border: bordas }; });
    resumo.forEach((_, i) => ['A', 'B'].forEach((c) => {
      const ref = `${c}${i + 2}`;
      if (wr[ref]) wr[ref].s = { font: fonte({ bold: c === 'A' }), border: bordas };
    }));
    wr['!cols'] = [{ wch: 26 }, { wch: 60 }];
    XS.utils.book_append_sheet(wb, wr, 'Filtros');
  }

  if (retornarBytes) return XS.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true, compression: true });
  XS.writeFile(wb, nomeArquivo, { cellDates: true, compression: true });
  return null;
}
