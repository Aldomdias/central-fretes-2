// Modelo de planilha de lotacao IGUAL ao do portal de cotacao
// (api/lotacao-cotacao/[token].js -> baixarModelo/importar): mesmas colunas,
// cores (amarelo = preenche, cinza = rota, azul = calculado), eixos 5/6 por
// linha + eixos padrao no topo, ANTT de referencia e bruto calculado.
// Diferenca da Gestao: coluna "Transportadora" na frente, para incluir varias
// tabelas numa planilha so, e rotas novas podem ser acrescentadas no fim.
import * as XLSXBasic from 'xlsx';

const sa = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

const numero = (v) => {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v).replace(/R\$/gi, '').replace(/\s/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const CAB = ['Transportadora', 'Origem', 'UF origem', 'Destino', 'UF destino', 'Veículo', 'Eixos (5 ou 6)', 'KM', 'Média mensal (viagens)', 'ANTT ref. líquido (R$)', 'ICMS %', 'Valor líquido (R$)', 'Valor bruto total (R$)', 'Prazo (dias)', 'Observação', 'CHAVE (não alterar)', 'ANTT 5 eixos (aux)', 'ANTT 6 eixos (aux)'];
// f = informacao da rota, i = voce preenche, c = calculado
const TIPO = ['i', 'f', 'f', 'f', 'f', 'f', 'i', 'f', 'f', 'c', 'c', 'i', 'c', 'i', 'i', 'f', 'f', 'f'];

// linhas: [{ transportadora, origem, ufOrigem, destino, ufDestino, tipo, eixos, km, viagens, aliquota, liquido, prazo, obs, chave, antt5, antt6 }]
export async function baixarModeloLotacaoGestao({ titulo = 'TABELA DE LOTAÇÃO', linhas = [], eixosPadrao = 5, nomeArquivo = 'tabela-lotacao' } = {}) {
  const { default: XLSX } = await import('xlsx-js-style');
  const HR = 4;
  const NC = CAB.length;
  const L = 'CBD5E1';
  const aoa = [
    [titulo],
    ['Preencha somente as colunas AMARELAS: Transportadora, Eixos (5 ou 6), Valor líquido (sem ICMS), Prazo e Observação. O ICMS, o piso ANTT de referência e o Valor bruto total são calculados. Rotas novas: acrescente linhas no fim com Origem, UF, Destino, UF, Veículo e KM. Várias transportadoras podem ir na mesma planilha (uma tabela por nome).'],
    ['Legenda:   AMARELO = você preenche   ·   CINZA = informação da rota   ·   AZUL = calculado automaticamente'],
    ['EIXOS PADRÃO (5 ou 6)  →', '', '', eixosPadrao],
    CAB,
  ];
  linhas.forEach((r) => {
    aoa.push([
      r.transportadora || '', r.origem || '', r.ufOrigem || '', r.destino || '', r.ufDestino || '', r.tipo || 'CARRETA',
      Number(r.eixos) === 6 ? 6 : Number(r.eixos) === 5 ? 5 : eixosPadrao,
      r.km || '', r.viagens ? Math.round(r.viagens * 10) / 10 : '', '', r.aliquota != null ? r.aliquota : '',
      r.liquido > 0 ? r.liquido : '', '', r.prazo || '', r.obs || '', r.chave || '',
      r.antt5 != null ? r.antt5 : '', r.antt6 != null ? r.antt6 : '',
    ]);
  });
  // algumas linhas em branco para rotas novas
  for (let i = 0; i < 20; i += 1) aoa.push(new Array(NC).fill(''));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const borda = { top: { style: 'thin', color: { rgb: L } }, bottom: { style: 'thin', color: { rgb: L } }, left: { style: 'thin', color: { rgb: L } }, right: { style: 'thin', color: { rgb: L } } };
  const bordaAmarela = { top: { style: 'thin', color: { rgb: 'F59E0B' } }, bottom: { style: 'thin', color: { rgb: 'F59E0B' } }, left: { style: 'thin', color: { rgb: 'F59E0B' } }, right: { style: 'thin', color: { rgb: 'F59E0B' } } };
  const est = (r, c, s, z) => {
    const a = XLSX.utils.encode_cell({ r, c });
    if (!ws[a]) ws[a] = { t: 's', v: '' };
    ws[a].s = s;
    if (z) ws[a].z = z;
  };
  const amarelo = { patternType: 'solid', fgColor: { rgb: 'FEF3C7' } };
  est(0, 0, { font: { bold: true, sz: 16, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '06183D' } }, alignment: { vertical: 'center', horizontal: 'left' } });
  for (let c = 1; c < 15; c += 1) est(0, c, { fill: { patternType: 'solid', fgColor: { rgb: '06183D' } } });
  est(1, 0, { font: { sz: 11, color: { rgb: '334155' } }, alignment: { wrapText: true, vertical: 'center' } });
  est(2, 0, { font: { bold: true, sz: 11, color: { rgb: '92400E' } }, fill: amarelo, alignment: { vertical: 'center' } });
  est(3, 0, { font: { bold: true, sz: 11, color: { rgb: '92400E' } }, fill: amarelo, alignment: { vertical: 'center' } });
  est(3, 1, { fill: amarelo });
  est(3, 2, { fill: amarelo });
  est(3, 3, { font: { bold: true, sz: 12 }, fill: { patternType: 'solid', fgColor: { rgb: 'FFF7CC' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: borda });

  const corCab = { f: '1E3A5F', i: 'B45309', c: '475569' };
  const corCel = { f: 'F1F5F9', i: 'FFF7CC', c: 'E0F0FF' };
  for (let c = 0; c < NC; c += 1) {
    est(HR, c, { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: corCab[TIPO[c]] } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: borda });
  }
  const numericas = [6, 7, 8, 9, 10, 11, 12, 13, 16, 17];
  for (let k = HR + 1; k < aoa.length; k += 1) {
    const ex = k + 1;
    // G = eixos, J = ANTT ref, K = ICMS %, L = liquido, M = bruto, Q/R = ANTT 5/6 aux
    ws[`J${ex}`] = { t: 'n', f: `IF(G${ex}=6,IF(R${ex}="","",R${ex}),IF(Q${ex}="","",Q${ex}))` };
    ws[`M${ex}`] = { t: 'n', f: `IF(L${ex}>0,L${ex}/(1-N(K${ex})/100),"")` };
    for (let c = 0; c < NC; c += 1) {
      let z = null;
      if (c === 6 || c === 7 || c === 13) z = '#,##0';
      else if (c === 8) z = '#,##0.0';
      else if (c === 9 || c === 11 || c === 12 || c === 16 || c === 17) z = '#,##0.00';
      else if (c === 10) z = '0.00"%"';
      est(k, c, {
        font: { sz: 11, bold: c === 0 || c === 1 || c === 3 || c === 12, color: { rgb: c >= 15 ? '94A3B8' : '0F172A' } },
        fill: { patternType: 'solid', fgColor: { rgb: corCel[TIPO[c]] } },
        alignment: { horizontal: numericas.includes(c) ? 'right' : 'left', vertical: 'center' },
        border: TIPO[c] === 'i' ? bordaAmarela : borda,
      }, z);
    }
  }
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 12 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 14 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 14 } }, { s: { r: 3, c: 0 }, e: { r: 3, c: 2 } }];
  ws['!rows'] = [{ hpt: 32 }, { hpt: 48 }, { hpt: 22 }, { hpt: 24 }, { hpt: 34 }];
  ws['!cols'] = [{ wch: 26 }, { wch: 28 }, { wch: 9 }, { wch: 28 }, { wch: 9 }, { wch: 18 }, { wch: 11 }, { wch: 8 }, { wch: 12 }, { wch: 17 }, { wch: 9 }, { wch: 19 }, { wch: 21 }, { wch: 12 }, { wch: 32 }, { wch: 40, hidden: true }, { wch: 12, hidden: true }, { wch: 12, hidden: true }];
  ws['!autofilter'] = { ref: `A${HR + 1}:O${aoa.length}` };
  ws['!views'] = [{ state: 'frozen', ySplit: HR + 1, xSplit: 0 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tabela');
  XLSX.writeFile(wb, `${nomeArquivo.replace(/[^a-z0-9]+/gi, '-')}.xlsx`);
}

// Le a planilha (modelo da Gestao OU modelo baixado no portal).
// Devolve { titulo, eixosPadrao, linhas: [{ transportadora, origem, ufOrigem, destino, ufDestino, tipo, eixos, km, liquido, prazo, obs, chave }] }
export async function lerPlanilhaLotacaoGestao(file) {
  const wb = XLSXBasic.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSXBasic.utils.sheet_to_json(ws, { header: 1, defval: '' });
  let hi = -1;
  for (let r = 0; r < Math.min(rows.length, 15); r += 1) {
    // celula a celula: a linha de instrucoes tambem cita "Origem/Destino"
    const cels = rows[r].map(sa);
    if (cels.some((c) => c.startsWith('ORIGEM')) && cels.some((c) => c.startsWith('DESTINO'))) { hi = r; break; }
  }
  if (hi < 0) throw new Error(`${file.name}: não encontrei o cabeçalho. Use o modelo baixado na Gestão ou no portal.`);

  const titulo = String(rows[0]?.[0] || '');
  const nomeTitulo = (titulo.split(/\s[—–]\s/).slice(1).join(' ') || '').trim();
  let eixosPadrao = null;
  for (let q = 0; q < hi; q += 1) {
    rows[q].forEach((c, z) => {
      if (!sa(c).startsWith('EIXOS')) return;
      const ev = rows[q].slice(z + 1).map(Number).find((x) => x === 5 || x === 6);
      if (ev) eixosPadrao = ev;
    });
  }
  const cab = rows[hi].map(sa);
  const col = (re) => cab.findIndex((c) => re.test(c));
  const cT = col(/^TRANSPORTADORA/);
  const cO = col(/^ORIGEM/);
  const cUo = col(/^UF ORIGEM/);
  const cD = col(/^DESTINO/);
  const cUd = col(/^UF DESTINO/);
  const cV = col(/^VEICULO|^TIPO/);
  const cE = col(/^EIXOS/);
  const cK = col(/^KM/);
  const cL = col(/^VALOR LIQUIDO|^LIQUIDO/);
  const cZ = col(/^PRAZO/);
  const cOb = col(/^OBS/);
  const cCh = col(/^CHAVE/);
  if (cL < 0) throw new Error(`${file.name}: coluna "Valor líquido" não encontrada. Use o modelo baixado na Gestão ou no portal.`);
  if (cO < 0 || cD < 0) throw new Error(`${file.name}: colunas Origem e Destino não encontradas.`);

  const linhas = [];
  rows.slice(hi + 1).forEach((row, i) => {
    const liquido = numero(row[cL]);
    const origem = String(row[cO] ?? '').trim();
    const destino = String(row[cD] ?? '').trim();
    if (!(liquido > 0) || !origem || !destino) return;
    const ev = cE >= 0 ? Number(row[cE]) : null;
    linhas.push({
      linhaPlanilha: hi + i + 2,
      transportadora: cT >= 0 ? String(row[cT] ?? '').trim() : '',
      origem,
      ufOrigem: cUo >= 0 ? String(row[cUo] ?? '').trim() : '',
      destino,
      ufDestino: cUd >= 0 ? String(row[cUd] ?? '').trim() : '',
      tipo: cV >= 0 ? String(row[cV] ?? '').trim() : '',
      eixos: ev === 5 || ev === 6 ? ev : eixosPadrao,
      km: cK >= 0 ? numero(row[cK]) : null,
      liquido,
      prazo: cZ >= 0 ? String(row[cZ] ?? '').trim() : '',
      obs: cOb >= 0 ? String(row[cOb] ?? '').trim() : '',
      chave: cCh >= 0 ? String(row[cCh] ?? '').trim() : '',
    });
  });
  return { titulo, nomeTitulo, eixosPadrao: eixosPadrao || 5, linhas };
}
