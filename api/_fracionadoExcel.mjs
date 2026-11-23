// Gerador do Excel padrao do portal de frete fracionado.
// Usado nos DOIS lados: o portal do transportador (api/fracionado-cotacao/[token].js embute o
// codigo desta funcao na pagina) e a tela de gestao (src/utils/fracionadoModelo.js).
// IMPORTANTE: a funcao precisa ser autocontida (so usa o parametro XLSX), pois e serializada com toString().
//
// Layout compativel com o importador de templates (aba FICHA DE CADASTRO + aba TABELA):
//   PERCENTUAL : linha de regioes, linha "ESTADO DESTINO | FRETE (%) | MINIMO (R$)...", uma linha por UF
//   FAIXA_PESO : linha de regioes, linha "ESTADO DESTINO | FAIXA PESO | FRETE (R$) | AD VALOREM..." (colunas
//                de ad valorem ficam ocultas, preenchidas com os dados gerais), uma linha por UF x faixa
export function montarPlanilhaFracionado(XLSX, o) {
  var pct = o.modalidade !== 'FAIXA_PESO';
  var R = o.regioes;
  var g = o.gerais || {};
  var canalTxt = o.canal === 'ATACADO' ? 'Atacado' : 'B2C';
  var NAVY = '06183D';
  var L = 'CBD5E1';
  function fill(rgb) { return { patternType: 'solid', fgColor: { rgb: rgb } }; }
  function bd(rgb, st) { var b = { style: st || 'thin', color: { rgb: rgb } }; return { top: b, bottom: b, left: b, right: b }; }
  function num(v) { return v === null || v === undefined || v === '' || isNaN(Number(v)) ? '' : Number(v); }
  function aplica(ws, r, c, estilo, z) {
    var a = XLSX.utils.encode_cell({ r: r, c: c });
    if (!ws[a]) ws[a] = { t: 's', v: '' };
    ws[a].s = estilo;
    if (z) ws[a].z = z;
  }
  function banner(ws, nCols, titulo, instr, legenda) {
    var linhas = [titulo, instr, legenda];
    var estilos = [
      { font: { bold: true, sz: 16, color: { rgb: 'FFFFFF' } }, fill: fill(NAVY), alignment: { vertical: 'center', horizontal: 'left' } },
      { font: { sz: 11, color: { rgb: '334155' } }, alignment: { vertical: 'center', wrapText: true } },
      { font: { bold: true, sz: 10, color: { rgb: '92400E' } }, fill: fill('FEF3C7'), alignment: { vertical: 'center' } },
    ];
    var merges = [];
    for (var r = 0; r < 3; r += 1) {
      for (var c = 0; c < nCols; c += 1) aplica(ws, r, c, estilos[r]);
      merges.push({ s: { r: r, c: 0 }, e: { r: r, c: nCols - 1 } });
    }
    ws['!rows'] = [{ hpt: 32 }, { hpt: 34 }, { hpt: 20 }, { hpt: 8 }];
    return merges;
  }

  // ---------------- FICHA ----------------
  var fichaRows = [
    ['Transportadora', o.transportadora, 'f'], ['CNPJ', o.cnpj || '', 'f'], ['Canal', o.canal, 'f'], ['Origem', o.origem || '', 'f'],
    ['Prazo médio (dias)', num(g.prazo), 'i'], ['GRIS (%)', num(g.gris), 'i'], ['Ad valorem mínimo (R$)', num(g.advalorem_min), 'i'], ['Ad valorem (%)', num(g.advalorem), 'i'],
    ['Pedágio (R$)', num(g.pedagio), 'i'], ['TAS (R$)', num(g.tas), 'i'], ['TDA (R$)', num(g.tda), 'i'],
    ['ICMS incluso nos valores (SIM ou NAO)', g.icms_incluso || '', 'i'], ['Vigência a partir de', g.vigencia || '', 'i'],
  ];
  var aoaF = [['FICHA DE CADASTRO — ' + o.transportadora + ' · ' + canalTxt], ['Preencha as células AMARELAS com os dados gerais da tabela. Informe se os valores já incluem ICMS (SIM ou NAO).'], ['Legenda:   AMARELO = você preenche   ·   CINZA = informação já cadastrada'], []];
  fichaRows.forEach(function (x) { aoaF.push([x[0], x[1]]); });
  var wf = XLSX.utils.aoa_to_sheet(aoaF);
  var mf = banner(wf, 2, aoaF[0][0], aoaF[1][0], aoaF[2][0]);
  fichaRows.forEach(function (x, i) {
    var r = 4 + i;
    aplica(wf, r, 0, { font: { bold: true, sz: 11 }, fill: fill('F1F5F9'), alignment: { vertical: 'center' }, border: bd(L) });
    aplica(wf, r, 1, { font: { sz: 11, bold: x[2] === 'f' }, fill: fill(x[2] === 'i' ? 'FFF7CC' : 'F1F5F9'), alignment: { horizontal: 'left', vertical: 'center' }, border: bd(x[2] === 'i' ? 'F59E0B' : L) }, x[2] === 'i' && typeof x[1] === 'number' ? '#,##0.00' : null);
  });
  wf['!merges'] = mf;
  wf['!cols'] = [{ wch: 42 }, { wch: 34 }];

  // ---------------- TABELA ----------------
  var aoa = [];
  var nCols;
  var cols;
  var merges;
  var ws;
  var HR = 4; // linha das regioes
  var primeiraDados = 6;
  var titulo = 'TABELA DE FRETE FRACIONADO — ' + o.transportadora + ' · ' + canalTxt + (o.origem ? ' · origem ' + o.origem : '') + ' · ' + (pct ? 'Frete percentual' : 'Frete por faixa de peso');
  var instr = pct
    ? 'Preencha somente as colunas AMARELAS: FRETE (%) sobre o valor da NF e MÍNIMO (R$) por UF de destino e região. Deixe em branco o que você não atende.'
    : 'Preencha somente as células AMARELAS: FRETE (R$) de cada faixa de peso por UF e região. Na faixa "Acima de X kg" informe o R$ por kg excedente. Deixe em branco o que você não atende.';
  var legenda = 'Legenda:   AMARELO = você preenche   ·   CINZA = informação da linha (não alterar)';
  var i;
  var r;
  var c;
  var uf;
  if (pct) {
    nCols = 1 + R.length * 2;
    var r0 = ['']; var r1 = ['ESTADO DESTINO'];
    R.forEach(function (rg) { r0.push(rg, ''); r1.push('FRETE (%)', 'MÍNIMO (R$)'); });
    aoa = [[titulo], [instr], [legenda], [], r0, r1];
    o.ufs.forEach(function (u) {
      var row = [u];
      R.forEach(function (rg) { var x = o.valor(u, rg, '') || {}; row.push(num(x.p), num(x.m)); });
      aoa.push(row);
    });
    ws = XLSX.utils.aoa_to_sheet(aoa);
    merges = banner(ws, nCols, titulo, instr, legenda);
    R.forEach(function (rg, k) { merges.push({ s: { r: HR, c: 1 + k * 2 }, e: { r: HR, c: 2 + k * 2 } }); });
    aplica(ws, HR, 0, { fill: fill(NAVY), border: bd('FFFFFF') });
    aplica(ws, HR + 1, 0, { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: fill(NAVY), alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: bd('FFFFFF') });
    R.forEach(function (rg, k) {
      var cor = k % 2 ? '2B5C8F' : '1E3A5F';
      for (c = 1 + k * 2; c <= 2 + k * 2; c += 1) {
        aplica(ws, HR, c, { font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } }, fill: fill(cor), alignment: { horizontal: 'center', vertical: 'center' }, border: bd('FFFFFF') });
        aplica(ws, HR + 1, c, { font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } }, fill: fill('B45309'), alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: bd('FFFFFF') });
      }
    });
    for (r = primeiraDados; r < aoa.length; r += 1) {
      aplica(ws, r, 0, { font: { bold: true, sz: 11 }, fill: fill('F1F5F9'), alignment: { horizontal: 'center', vertical: 'center' }, border: bd(L) });
      for (c = 1; c < nCols; c += 1) {
        aplica(ws, r, c, { font: { sz: 11 }, fill: fill('FFF7CC'), alignment: { horizontal: 'right', vertical: 'center' }, border: bd('F59E0B') }, '#,##0.00');
      }
    }
    cols = [{ wch: 17 }];
    R.forEach(function () { cols.push({ wch: 12 }, { wch: 13 }); });
    ws['!freeze'] = { xSplit: 1, ySplit: HR + 2 };
    ws['!views'] = [{ state: 'frozen', xSplit: 1, ySplit: HR + 2 }];
  } else {
    nCols = 2 + R.length * 3;
    var q0 = ['', '']; var q1 = ['ESTADO DESTINO', 'FAIXA PESO'];
    R.forEach(function (rg) { q0.push(rg, '', ''); q1.push('FRETE (R$)', 'AD VALOREM (%)', 'AD VALOREM MÍNIMO (R$)'); });
    aoa = [[titulo], [instr], [legenda], [], q0, q1];
    o.ufs.forEach(function (u) {
      o.faixas.forEach(function (f) {
        var aberta = f.max === null || f.max === undefined;
        var row = [u, aberta ? f.label + ' (R$/kg excedente)' : f.label];
        R.forEach(function (rg) {
          var x = o.valor(u, rg, f.label) || {};
          row.push(num(x.v), aberta ? '' : num(g.advalorem), aberta ? '' : num(g.advalorem_min));
        });
        aoa.push(row);
      });
    });
    ws = XLSX.utils.aoa_to_sheet(aoa);
    merges = banner(ws, 2 + R.length, titulo, instr, legenda);
    // colunas de ad valorem ficam ocultas: o banner so cobre as colunas visiveis, mas estiliza as ocultas tambem
    aplica(ws, HR, 0, { fill: fill(NAVY), border: bd('FFFFFF') });
    aplica(ws, HR, 1, { fill: fill(NAVY), border: bd('FFFFFF') });
    aplica(ws, HR + 1, 0, { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: fill(NAVY), alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: bd('FFFFFF') });
    aplica(ws, HR + 1, 1, { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: fill(NAVY), alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: bd('FFFFFF') });
    R.forEach(function (rg, k) {
      var cor = k % 2 ? '2B5C8F' : '1E3A5F';
      for (c = 2 + k * 3; c <= 4 + k * 3; c += 1) {
        aplica(ws, HR, c, { font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } }, fill: fill(cor), alignment: { horizontal: 'center', vertical: 'center' }, border: bd('FFFFFF') });
        aplica(ws, HR + 1, c, { font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } }, fill: fill(c === 2 + k * 3 ? 'B45309' : '64748B'), alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: bd('FFFFFF') });
      }
    });
    var nf = o.faixas.length;
    for (r = primeiraDados; r < aoa.length; r += 1) {
      var bloco = Math.floor((r - primeiraDados) / nf);
      var primeira = (r - primeiraDados) % nf === 0;
      var fundoFixo = bloco % 2 ? 'E2E8F0' : 'F1F5F9';
      var topo = primeira ? { style: 'medium', color: { rgb: '1E3A5F' } } : { style: 'thin', color: { rgb: L } };
      var bordaFixa = { top: topo, bottom: { style: 'thin', color: { rgb: L } }, left: { style: 'thin', color: { rgb: L } }, right: { style: 'thin', color: { rgb: L } } };
      aplica(ws, r, 0, { font: { bold: true, sz: 11 }, fill: fill(fundoFixo), alignment: { horizontal: 'center', vertical: 'center' }, border: bordaFixa });
      aplica(ws, r, 1, { font: { sz: 11 }, fill: fill(fundoFixo), alignment: { horizontal: 'left', vertical: 'center' }, border: bordaFixa });
      R.forEach(function (rg, k) {
        var cf = 2 + k * 3;
        aplica(ws, r, cf, { font: { sz: 11 }, fill: fill('FFF7CC'), alignment: { horizontal: 'right', vertical: 'center' }, border: { top: topo, bottom: { style: 'thin', color: { rgb: 'F59E0B' } }, left: { style: 'thin', color: { rgb: 'F59E0B' } }, right: { style: 'thin', color: { rgb: 'F59E0B' } } } }, '#,##0.00');
        aplica(ws, r, cf + 1, { font: { sz: 11, color: { rgb: '94A3B8' } }, fill: fill('F1F5F9'), border: bd(L) }, '#,##0.00');
        aplica(ws, r, cf + 2, { font: { sz: 11, color: { rgb: '94A3B8' } }, fill: fill('F1F5F9'), border: bd(L) }, '#,##0.00');
      });
    }
    cols = [{ wch: 17 }, { wch: 30 }];
    R.forEach(function () { cols.push({ wch: 13 }, { wch: 12, hidden: true }, { wch: 14, hidden: true }); });
    ws['!freeze'] = { xSplit: 2, ySplit: HR + 2 };
    ws['!views'] = [{ state: 'frozen', xSplit: 2, ySplit: HR + 2 }];
  }
  ws['!merges'] = merges;
  ws['!cols'] = cols;
  ws['!rows'] = [{ hpt: 32 }, { hpt: 34 }, { hpt: 20 }, { hpt: 8 }, { hpt: 24 }, { hpt: 34 }];
  ws['!autofilter'] = { ref: XLSX.utils.encode_cell({ r: HR + 1, c: 0 }) + ':' + XLSX.utils.encode_cell({ r: aoa.length - 1, c: pct ? 0 : 1 }) };

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wf, 'FICHA DE CADASTRO');
  XLSX.utils.book_append_sheet(wb, ws, 'TABELA');

  // ---------------- ATENDIMENTO (cidade -> regiao/rota, prazo e taxas) ----------------
  if (o.cidades && o.cidades.length) {
    var cab = ['IBGE', 'UF DESTINO', 'CIDADE DE DESTINO', 'REGIÃO (rota)', 'PRAZO (DIAS)', 'TDA (R$)', 'TRT (R$)', 'SUFRAMA (R$)', 'OUTRAS TAXAS (R$)'];
    var aoaA = [
      ['ATENDIMENTO — ' + o.transportadora + ' · ' + canalTxt],
      ['Para cada cidade atendida informe a REGIÃO (rota da tabela: CAPITAL, INTERIOR 1 a INTERIOR 9 ou METROPOLITANA) e o PRAZO de entrega em dias. TDA, TRT, Suframa e outras taxas são opcionais. Cidades sem prazo são consideradas não atendidas.'],
      ['Legenda:   AMARELO = você preenche   ·   CINZA = cidade (não alterar)'],
      cab,
    ];
    o.cidades.forEach(function (m) {
      aoaA.push([m.ibge, m.uf, m.cidade, m.regiao || '', num(m.prazo), num(m.tda), num(m.trt), num(m.suframa), num(m.outras)]);
    });
    var wa = XLSX.utils.aoa_to_sheet(aoaA);
    var ma = banner(wa, cab.length, aoaA[0][0], aoaA[1][0], aoaA[2][0]);
    for (c = 0; c < cab.length; c += 1) {
      aplica(wa, 3, c, { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: fill(c < 3 ? '1E3A5F' : 'B45309'), alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: bd('FFFFFF') });
    }
    for (r = 4; r < aoaA.length; r += 1) {
      for (c = 0; c < cab.length; c += 1) {
        var fixo = c < 3;
        aplica(wa, r, c, { font: { sz: 11, bold: c === 2 }, fill: fill(fixo ? 'F1F5F9' : 'FFF7CC'), alignment: { horizontal: c === 3 ? 'center' : (c >= 4 ? 'right' : 'left'), vertical: 'center' }, border: bd(fixo ? L : 'F59E0B') }, c >= 5 ? '#,##0.00' : (c === 4 ? '0' : null));
      }
    }
    wa['!merges'] = ma;
    wa['!cols'] = [{ wch: 11 }, { wch: 11 }, { wch: 34 }, { wch: 16 }, { wch: 13 }, { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 16 }];
    wa['!rows'] = [{ hpt: 32 }, { hpt: 48 }, { hpt: 20 }, { hpt: 34 }];
    wa['!autofilter'] = { ref: 'A4:' + XLSX.utils.encode_cell({ r: aoaA.length - 1, c: cab.length - 1 }) };
    wa['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];
    XLSX.utils.book_append_sheet(wb, wa, 'ATENDIMENTO');
  }
  return wb;
}
