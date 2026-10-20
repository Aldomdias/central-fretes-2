// Excel "bonito" e reaproveitavel: cabecalho azul, linhas zebradas, bordas, R$ contabil, datas reais,
// filtro automatico e cabecalho congelado (mesmo padrao da exportacao de faturas da Auditoria).
//
// colunas: [{ titulo, largura?, tipo?: 'texto' | 'moeda' | 'numero' | 'inteiro' | 'data' | 'datahora' | 'centro' }]
// linhas:  arrays na mesma ordem das colunas (datas podem vir como Date ou string ISO)
// resumo:  opcional, [[rotulo, valor], ...] -> aba "Filtros" com o que foi aplicado na tela
export async function exportarExcelFormatado({ nomeArquivo, aba = 'Dados', colunas = [], linhas = [], resumo = null }) {
  const { default: XS } = await import('xlsx-js-style');
  const paraData = (v) => {
    if (!v) return '';
    if (v instanceof Date) return v;
    const texto = String(v);
    const d = texto.includes('T') ? new Date(texto) : new Date(`${texto.slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? texto : d;
  };
  const corpo = linhas.map((linha) => linha.map((valor, i) => {
    const tipo = colunas[i]?.tipo;
    if (tipo === 'data' || tipo === 'datahora') return paraData(valor);
    if (['moeda', 'numero', 'inteiro'].includes(tipo)) return valor === '' || valor == null ? '' : Number(valor || 0);
    return valor == null ? '' : valor;
  }));
  const cabecalho = colunas.map((c) => c.titulo);
  const ws = XS.utils.aoa_to_sheet([cabecalho, ...corpo], { cellDates: true });

  const CONTAB = '_-"R$"\\ * #,##0.00_-;\\-"R$"\\ * #,##0.00_-;_-"R$"\\ * "-"??_-;_-@_-';
  const fonte = (extra = {}) => ({ name: 'Calibri', sz: 11, color: { rgb: 'FF1F2937' }, ...extra });
  const preenche = (rgb) => ({ patternType: 'solid', fgColor: { rgb }, bgColor: { rgb } });
  const borda = { style: 'thin', color: { rgb: 'FFD1D5DB' } };
  const bordas = { top: borda, bottom: borda, left: borda, right: borda };
  const total = colunas.length;

  for (let col = 0; col < total; col += 1) {
    const ref = XS.utils.encode_cell({ r: 0, c: col });
    ws[ref].s = { font: fonte({ bold: true, color: { rgb: 'FFFFFFFF' } }), fill: preenche('FF1E3A8A'), alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: bordas };
  }
  corpo.forEach((_, i) => {
    const fundo = preenche(i % 2 === 0 ? 'FFFFFFFF' : 'FFF1F5F9');
    for (let col = 0; col < total; col += 1) {
      const ref = XS.utils.encode_cell({ r: i + 1, c: col });
      if (!ws[ref]) ws[ref] = { t: 's', v: '' };
      const tipo = colunas[col]?.tipo || 'texto';
      const horizontal = tipo === 'moeda' || tipo === 'numero' ? 'right'
        : ['inteiro', 'data', 'datahora', 'centro'].includes(tipo) ? 'center' : 'left';
      ws[ref].s = { font: fonte(), fill: fundo, border: bordas, alignment: { vertical: 'center', horizontal, wrapText: tipo === 'texto_longo' } };
      if (tipo === 'moeda' && ws[ref].t === 'n') ws[ref].z = CONTAB;
      if (tipo === 'numero' && ws[ref].t === 'n') ws[ref].z = '#,##0.00';
      if (tipo === 'data' && ws[ref].t === 'd') ws[ref].z = 'dd/mm/yyyy';
      if (tipo === 'datahora' && ws[ref].t === 'd') ws[ref].z = 'dd/mm/yyyy hh:mm';
    }
  });
  ws['!cols'] = colunas.map((c) => ({ wch: c.largura || 16 }));
  ws['!rows'] = [{ hpt: 32 }];
  const ultima = corpo.length + 1;
  const ultimaCol = XS.utils.encode_col(Math.max(total - 1, 0));
  ws['!autofilter'] = { ref: `A1:${ultimaCol}${ultima}` };
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  ws['!ref'] = `A1:${ultimaCol}${ultima}`;

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

  XS.writeFile(wb, nomeArquivo, { cellDates: true });
}
