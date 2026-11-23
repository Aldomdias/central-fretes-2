// Modelo padrao das tabelas de frete fracionado (portal do transportador).
// Mesmo layout dos templates Cantu aceitos em "Importar Template" (aba FICHA DE CADASTRO + aba TABELA),
// entao a resposta exportada daqui pode ser importada no sistema sem retrabalho.
// Espelha o que o portal (api/fracionado-cotacao/[token].js) gera para o transportador.

export const UFS_FRACIONADO = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
export const REGIOES_FRACIONADO = ['CAPITAL', 'INTERIOR 1', 'INTERIOR 2', 'INTERIOR 3', 'INTERIOR 4', 'INTERIOR 5', 'INTERIOR 6', 'INTERIOR 7', 'INTERIOR 8', 'INTERIOR 9', 'METROPOLITANA'];
export const FAIXAS_PADRAO_FRACIONADO = {
  B2C: '0-2, 2-5, 5-10, 10-20, 20-30, 30-50, 50-100, 100+',
  ATACADO: '0-10, 10-20, 20-30, 30-50, 50-70, 70-100, 100-150, 150-200, 200-300, 300-500, 500-1000, 1000+',
};
export const CANAIS_FRACIONADO = { B2C: 'B2C', ATACADO: 'Atacado', AMBOS: 'B2C + Atacado' };
export const MODALIDADES_FRACIONADO = { PERCENTUAL: 'Frete percentual', FAIXA_PESO: 'Frete por faixa de peso' };

// "0-2, 2-5, 100+" -> [{min,max,label}] (max null = faixa aberta, R$/kg excedente). [] se invalido.
export function parseFaixasFracionado(texto) {
  const out = [];
  for (const parte of String(texto || '').split(/[;,]/)) {
    const p = parte.trim().replace(/\s+/g, '');
    if (!p) continue;
    const aberta = p.match(/^(\d+(?:\.\d+)?)\+$/);
    if (aberta) { const min = Number(aberta[1]); out.push({ min, max: null, label: `Acima de ${min} kg` }); continue; }
    const m = p.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if (!m) return [];
    const min = Number(m[1]);
    const max = Number(m[2]);
    if (!(max > min)) return [];
    out.push({ min, max, label: `${min} a ${max} kg` });
  }
  return out.sort((a, b) => a.min - b.min);
}

export function canaisDoConviteFracionado(convite) {
  const c = String(convite?.canal || 'AMBOS').toUpperCase();
  if (c === 'B2C') return ['B2C'];
  if (c === 'ATACADO') return ['ATACADO'];
  return ['B2C', 'ATACADO'];
}

export function faixasDoConviteFracionado(convite, canal) {
  const f = parseFaixasFracionado(convite?.faixas?.[canal]);
  return f.length ? f : parseFaixasFracionado(FAIXAS_PADRAO_FRACIONADO[canal]);
}

const n = (v) => (v === null || v === undefined || v === '' ? '' : Number(v));

// Gera (e baixa) o Excel de UM canal no layout padrao. respostas = linhas de fracionado_respostas do canal.
export async function baixarExcelFracionado({ convite, canal, respostas }) {
  const { default: XS } = await import('xlsx-js-style');
  const pct = convite.modalidade !== 'FAIXA_PESO';
  const g = convite.dados_gerais?.[canal] || {};
  const R = REGIOES_FRACIONADO;
  const faixas = faixasDoConviteFracionado(convite, canal);
  const mapa = new Map();
  (respostas || []).filter((r) => r.canal === canal).forEach((r) => mapa.set(`${r.uf_destino}|${r.regiao}|${r.faixa || ''}`, r));

  const ficha = [
    ['FICHA DE CADASTRO', ''], ['Transportadora', convite.transportadora], ['CNPJ', convite.respondente_cnpj || ''],
    ['Canal', canal], ['Origem', convite.origem || ''], ['Prazo médio (dias)', g.prazo ?? ''], ['GRIS (%)', g.gris ?? ''],
    ['Ad valorem mínimo (R$)', g.advalorem_min ?? ''], ['Ad valorem (%)', g.advalorem ?? ''], ['Pedágio (R$)', g.pedagio ?? ''],
    ['TAS (R$)', g.tas ?? ''], ['TDA (R$)', g.tda ?? ''], ['ICMS incluso nos valores (SIM ou NAO)', g.icms_incluso || ''], ['Vigência a partir de', g.vigencia || ''],
  ];
  const aoa = [];
  const merges = [];
  let cols;
  if (pct) {
    const r0 = ['']; const r1 = ['ESTADO DESTINO'];
    R.forEach((r, i) => { r0.push(r, ''); r1.push('FRETE (%)', 'MÍNIMO (R$)'); merges.push({ s: { r: 0, c: 1 + i * 2 }, e: { r: 0, c: 2 + i * 2 } }); });
    aoa.push(r0, r1, []);
    UFS_FRACIONADO.forEach((uf) => {
      const row = [uf];
      R.forEach((r) => { const x = mapa.get(`${uf}|${r}|`); row.push(n(x?.frete_percentual), n(x?.frete_minimo)); });
      aoa.push(row);
    });
    cols = [{ wch: 16 }, ...R.flatMap(() => [{ wch: 12 }, { wch: 13 }])];
  } else {
    const r0 = ['', '']; const r1 = ['ESTADO DESTINO', 'FAIXA PESO'];
    R.forEach((r, i) => { r0.push(r, '', ''); r1.push('FRETE (R$)', 'AD VALOREM (%)', 'AD VALOREM MÍNIMO (R$)'); merges.push({ s: { r: 0, c: 2 + i * 3 }, e: { r: 0, c: 4 + i * 3 } }); });
    aoa.push(r0, r1);
    UFS_FRACIONADO.forEach((uf) => faixas.forEach((f) => {
      const row = [uf, f.label];
      R.forEach((r) => {
        const x = mapa.get(`${uf}|${r}|${f.label}`);
        row.push(n(x?.frete_valor), f.max == null ? '' : n(g.advalorem), f.max == null ? '' : n(g.advalorem_min));
      });
      aoa.push(row);
    }));
    cols = [{ wch: 16 }, { wch: 20 }, ...R.flatMap(() => [{ wch: 12 }, { wch: 14 }, { wch: 16 }])];
  }
  const ws = XS.utils.aoa_to_sheet(aoa);
  const wf = XS.utils.aoa_to_sheet(ficha);
  ws['!merges'] = merges; ws['!cols'] = cols; wf['!cols'] = [{ wch: 38 }, { wch: 30 }];
  const hd = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '1E3A5F' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
  for (let r = 0; r < 2; r += 1) for (let c = 0; c < cols.length; c += 1) {
    const a = XS.utils.encode_cell({ r, c });
    if (!ws[a]) ws[a] = { t: 's', v: '' };
    ws[a].s = hd;
  }
  ficha.forEach((_, q) => { const a = XS.utils.encode_cell({ r: q, c: 0 }); if (wf[a]) wf[a].s = { font: { bold: true } }; });
  ws['!views'] = [{ state: 'frozen', xSplit: pct ? 1 : 2, ySplit: 2 }];
  const wb = XS.utils.book_new();
  XS.utils.book_append_sheet(wb, wf, 'FICHA DE CADASTRO');
  XS.utils.book_append_sheet(wb, ws, 'TABELA');
  const nome = String(convite.transportadora || 'transportadora').replace(/[^a-z0-9]+/gi, '-');
  XS.writeFile(wb, `tabela-fracionado-${pct ? 'percentual' : 'faixa-peso'}-${canal.toLowerCase()}-${nome}.xlsx`);
}
