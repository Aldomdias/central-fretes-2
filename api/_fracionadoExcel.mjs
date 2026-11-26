// Gerador do Excel padrao do portal de frete fracionado.
// Usado nos DOIS lados: o portal do transportador (api/fracionado-cotacao/[token].js embute o
// codigo desta funcao na pagina) e a tela de gestao (src/utils/fracionadoModelo.js).
// IMPORTANTE: a funcao precisa ser autocontida (so usa o parametro XLSX), pois e serializada com toString().
//
// Layout compativel com o importador de templates (aba FICHA DE CADASTRO + aba TABELA):
//   PERCENTUAL : linha de regioes, linha "ESTADO DESTINO | FRETE (%) | MINIMO (R$) | KG GARANTIA (R$/KG)...", uma linha por UF
//   FAIXA_PESO : linha de regioes, linha "ESTADO DESTINO | FAIXA PESO | FRETE (R$) | AD VALOREM..." (colunas
//                de ad valorem ficam ocultas, preenchidas com os dados gerais), uma linha por UF x faixa
// Premissas da negociacao (portal + Excel). Vao tambem para o futuro termo de aceite.
export const PREMISSAS_FRACIONADO = [
  'Pagamento somente de CT-es <b>ENTREGUES</b>: as faturas devem conter apenas CT-es já entregues. Na auditoria, fatura com CT-e ainda não entregue não será paga.',
  'A entrega é comprovada por integração: <b>B2C via API</b> e <b>Atacado via EDI</b>.',
  'Cubagem: vale a informada na <b>nossa nota fiscal</b>. Não é aceita cubagem manual; será pago o que estiver na NF. Se não concordar com a cubagem, a transportadora tem direito de não coletar.',
  'Faturas com no máximo <b>500 CT-es</b> cada.',
  'Só consideramos faturas enviadas devidamente pelo <b>EDI DOCCOB</b>. Fatura não recebida por DOCCOB: a transportadora terá que comprovar o envio; caso contrário, deverá refazer a fatura e enviá-la novamente, com o prazo de pagamento ajustado à nova data.',
  'Prazo de pagamento padrão: <b>35 dias após o faturamento</b> (semanal ou quinzenal). Prazo menor depende de aprovação da diretoria.',
];

// Taxas por cidade (aba ATENDIMENTO / passo 2 do portal): [chave, cabecalho, coluna propria em fracionado_atendimento ou null (vai no jsonb taxas_destino)]
// Baseado nas taxas por destino mais cadastradas hoje (taxas_especiais + taxas_extras). Taxa que nao estiver aqui entra em "Taxas adicionais" com as UFs.
export const COLS_ATEND_FRACIONADO = [
  ['tda', 'TDA (R$)', 'tda'], ['tdap', 'TDA (% NF)', null], ['tdam', 'TDA mínimo (R$)', null],
  ['tdr', 'TDR (R$)', null],
  ['trt', 'TRT (R$)', 'trt'], ['trtp', 'TRT (% NF)', null], ['trtm', 'TRT mínimo (R$)', null],
  ['suf', 'Suframa (R$)', 'suframa'],
  ['col', 'Taxa de coleta (R$)', null], ['ent', 'Taxa de entrega (R$)', null],
  ['ped', 'Pedágio do destino (R$ por 100 kg)', null], ['sec', 'SEC/CAT (R$)', null],
  ['trf', 'TRF / redespacho fluvial (% NF)', null], ['sfl', 'Seguro fluvial (% NF)', null],
  ['tzr', 'TZR - zona rural/restrita (% NF)', null], ['adf', 'Adicional de frete (%)', null],
  ['gris', 'GRIS (%) do destino', null], ['grm', 'GRIS mínimo (R$) do destino', null],
  ['adv', 'Ad valorem (%) do destino', null], ['adm', 'Ad valorem mínimo (R$) do destino', null],
];

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
  var compTxt = g.composicao === 'PESO_MAIS_PERCENTUAL' ? 'SOMA peso (R$/kg) + % NF' : g.composicao === 'MAIOR' ? 'MAIOR entre % NF, mínimo e kg' : '';
  var fichaRows = [
    ['Transportadora', o.transportadora, 'f'], ['CNPJ', o.cnpj || '', 'f'], ['Canal', o.canal, 'f'], ['Origem', o.origem || '', 'f'],
    ['Faturamento (SEMANAL ou QUINZENAL)', g.faturamento || '', 'i'], ['Prazo de pagamento após faturamento (dias) — padrão 35', num(g.prazo), 'i'], 
    ['GRIS (%)', num(g.gris), 'i'], ['GRIS mínimo (R$)', num(g.gris_min), 'i'], ['Ad valorem (%)', num(g.advalorem), 'i'], ['Ad valorem mínimo (R$)', num(g.advalorem_min), 'i'],
    ['Pedágio (R$ por fração de 100 kg)', num(g.pedagio), 'i'], ['TAS (R$)', num(g.tas), 'i'], ['CTRC / taxa por CT-e emitido (R$)', num(g.ctrc), 'i'],
    ['Cubagem (kg/m³)', num(g.cubagem), 'i'], ['Taxa emergencial (%)', num(g.emergencial), 'i'], ['Frete mínimo geral (R$)', num(g.frete_min), 'i'],
  ];
  if (pct) fichaRows.push(['Composição do frete (MAIOR ou SOMA)', compTxt, 'i']);
  var cad = o.cadastro || {};
  if (Object.keys(cad).length) {
    var cnpjs = cad.cnpj_origem || {};
    [['Razão social', cad.razao], ['Nome fantasia', cad.fantasia], ['Inscrição estadual', cad.ie], ['Endereço da matriz', cad.endereco]].forEach(function (x) { fichaRows.push([x[0], x[1] || '', 'f']); });
    Object.keys(cnpjs).forEach(function (k2) { fichaRows.push(['CNPJ emissor dos CT-es' + (k2 ? ' — ' + k2 : ''), String(cnpjs[k2]).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'), 'f']); });
    [['Comercial', 'com'], ['Operacional', 'op'], ['Financeiro', 'fin']].forEach(function (x) {
      var p = x[1];
      fichaRows.push(['Contato ' + x[0], [cad[p + '_nome'], cad[p + '_tel'] ? 'tel ' + cad[p + '_tel'] : '', cad[p + '_whats'] ? 'WhatsApp ' + cad[p + '_whats'] : '', cad[p + '_email']].filter(Boolean).join(' · '), 'f']);
    });
  }
  (o.premissas || []).forEach(function (p, k) { fichaRows.push(['Premissa ' + (k + 1), String(p).replace(/<[^>]+>/g, ''), 'f']); });
  fichaRows.push(['ICMS incluso nos valores (SIM ou NAO)', g.icms_incluso || '', 'i'], ['Vigência a partir de', g.vigencia || '', 'i'], ['Observações / outras condições', g.observacoes || '', 'i']);
  fichaRows.push(['TAXAS ADICIONAIS — unidade no nome: (R$) por CT-e, (%) da NF, (R$/KG) ou (R$/FRACAO)', 'Valor', 'h', ['Mínimo (R$)', 'Franquia kg (R$/KG) ou fração em kg (R$/FRACAO)', 'UFs (vazio = todas)']]);
  (g.taxas || []).forEach(function (t) { fichaRows.push(['Taxa adicional: ' + t.n + ' (' + (t.u || 'R$') + ')', num(t.v), 'i', [num(t.min), num(t.fr), t.ufs || '']]); });
  var aoaF = [['FICHA DE CADASTRO — ' + o.transportadora + ' · ' + canalTxt], ['Preencha as células AMARELAS com os dados gerais da tabela. Informe se os valores já incluem ICMS (SIM ou NAO). Para incluir taxa adicional, copie uma linha "Taxa adicional: NOME (UNIDADE)".'], ['Legenda:   AMARELO = você preenche   ·   CINZA = informação já cadastrada'], []];
  fichaRows.forEach(function (x) { aoaF.push([x[0], x[1]].concat(x[3] || [])); });
  var wf = XLSX.utils.aoa_to_sheet(aoaF);
  var mf = banner(wf, 5, aoaF[0][0], aoaF[1][0], aoaF[2][0]);
  fichaRows.forEach(function (x, i) {
    var r = 4 + i;
    if (x[2] === 'h') {
      for (var hc = 0; hc < 5; hc += 1) aplica(wf, r, hc, { font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } }, fill: fill('1E3A5F'), alignment: { vertical: 'center', wrapText: true }, border: bd('FFFFFF') });
      return;
    }
    aplica(wf, r, 0, { font: { bold: true, sz: 11 }, fill: fill('F1F5F9'), alignment: { vertical: 'center' }, border: bd(L) });
    aplica(wf, r, 1, { font: { sz: 11, bold: x[2] === 'f' }, fill: fill(x[2] === 'i' ? 'FFF7CC' : 'F1F5F9'), alignment: { horizontal: 'left', vertical: 'center' }, border: bd(x[2] === 'i' ? 'F59E0B' : L) }, x[2] === 'i' && typeof x[1] === 'number' ? '#,##0.00' : null);
    if (x[3]) for (var tc = 2; tc < 5; tc += 1) aplica(wf, r, tc, { font: { sz: 11 }, fill: fill('FFF7CC'), alignment: { horizontal: tc === 4 ? 'left' : 'right', vertical: 'center' }, border: bd('F59E0B') }, tc < 4 ? '#,##0.00' : null);
  });
  wf['!merges'] = mf;
  wf['!cols'] = [{ wch: 52 }, { wch: 34 }, { wch: 14 }, { wch: 22 }, { wch: 20 }];

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
    ? 'Preencha somente as colunas AMARELAS: FRETE (%) sobre o valor da NF, MÍNIMO (R$) e, se trabalhar com ele, KG GARANTIA (R$/kg — o frete fica o maior entre % da NF, mínimo e peso × R$/kg) por UF de destino e região. Deixe em branco o que você não atende.'
    : 'Preencha somente as células AMARELAS: FRETE (R$) de cada faixa de peso por UF e região. Na faixa "Acima de X kg" informe SÓ o R$ por KG excedente (não o preço da faixa nem valor por tonelada). Ex.: até 100 kg = R$ 150,00 e excedente R$ 1,20/kg → 130 kg paga 150,00 + 30 × 1,20 = R$ 186,00. Deixe em branco o que você não atende.';
  var legenda = 'Legenda:   AMARELO = você preenche   ·   CINZA = informação da linha (não alterar)';
  var i;
  var r;
  var c;
  var uf;
  if (pct) {
    nCols = 1 + R.length * 3;
    var r0 = ['']; var r1 = ['ESTADO DESTINO'];
    R.forEach(function (rg) { r0.push(rg, '', ''); r1.push('FRETE (%)', 'MÍNIMO (R$)', 'KG GARANTIA (R$/KG)'); });
    aoa = [[titulo], [instr], [legenda], [], r0, r1];
    o.ufs.forEach(function (u) {
      var row = [u];
      R.forEach(function (rg) { var x = o.valor(u, rg, '') || {}; row.push(num(x.p), num(x.m), num(x.k)); });
      aoa.push(row);
    });
    ws = XLSX.utils.aoa_to_sheet(aoa);
    merges = banner(ws, nCols, titulo, instr, legenda);
    R.forEach(function (rg, k) { merges.push({ s: { r: HR, c: 1 + k * 3 }, e: { r: HR, c: 3 + k * 3 } }); });
    aplica(ws, HR, 0, { fill: fill(NAVY), border: bd('FFFFFF') });
    aplica(ws, HR + 1, 0, { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: fill(NAVY), alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: bd('FFFFFF') });
    R.forEach(function (rg, k) {
      var cor = k % 2 ? '2B5C8F' : '1E3A5F';
      for (c = 1 + k * 3; c <= 3 + k * 3; c += 1) {
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
    R.forEach(function () { cols.push({ wch: 12 }, { wch: 13 }, { wch: 13 }); });
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
    var CA = o.colsAtend || [];
    var cab = ['IBGE', 'UF DESTINO', 'CIDADE DE DESTINO', 'REGIÃO (rota)', 'PRAZO (DIAS)'].concat(CA.map(function (x) { return String(x[1]).toUpperCase(); }));
    var aoaA = [
      ['ATENDIMENTO — ' + o.transportadora + ' · ' + canalTxt],
      ['Para cada cidade atendida informe a REGIÃO (rota da tabela: CAPITAL, INTERIOR 1 a INTERIOR 9 ou METROPOLITANA) e o PRAZO de entrega em dias. As taxas por cidade são opcionais (GRIS/ad valorem do destino só se diferentes da ficha). Cobra uma taxa por destino que não tem coluna aqui? Inclua na FICHA como "Taxa adicional: NOME (UNIDADE)" e informe as UFs. Cidades sem prazo são consideradas não atendidas.'],
      ['Legenda:   AMARELO = você preenche   ·   CINZA = cidade (não alterar)'],
      cab,
    ];
    o.cidades.forEach(function (m) {
      var tx = m.tx || {};
      aoaA.push([m.ibge, m.uf, m.cidade, m.regiao || '', num(m.prazo)].concat(CA.map(function (x) { return num(tx[x[0]]); })));
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
    wa['!cols'] = [{ wch: 11 }, { wch: 11 }, { wch: 34 }, { wch: 16 }, { wch: 13 }].concat(CA.map(function () { return { wch: 15 }; }));
    wa['!rows'] = [{ hpt: 32 }, { hpt: 60 }, { hpt: 20 }, { hpt: 48 }];
    wa['!autofilter'] = { ref: 'A4:' + XLSX.utils.encode_cell({ r: aoaA.length - 1, c: cab.length - 1 }) };
    wa['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];
    XLSX.utils.book_append_sheet(wb, wa, 'ATENDIMENTO');
  }
  return wb;
}
