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
export const MODALIDADES_FRACIONADO = { PERCENTUAL: 'Frete percentual', FAIXA_PESO: 'Frete por faixa de peso', PROPRIA: 'Tabela própria (anexo + generalidades)' };

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

export function origensDoConviteFracionado(convite) {
  const l = Array.isArray(convite?.origens) ? convite.origens.map((x) => String(x || '').trim()).filter(Boolean) : [];
  return l.length ? l : [String(convite?.origem || '').trim()];
}

// Gera (e baixa) o Excel de UM canal e UMA origem no layout padrao (FICHA + TABELA + ATENDIMENTO).
// respostas / atendimento = linhas de fracionado_respostas / fracionado_atendimento do convite.
export async function baixarExcelFracionado({ convite, canal, origem = '', respostas, atendimento }) {
  const { default: XS } = await import('xlsx-js-style');
  const { montarPlanilhaFracionado, COLS_ATEND_FRACIONADO } = await import('../../api/_fracionadoExcel.mjs');
  const mapa = new Map();
  (respostas || []).filter((r) => r.canal === canal && (r.origem || '') === origem)
    .forEach((r) => mapa.set(`${r.uf_destino}|${r.regiao}|${r.faixa || ''}`, r));
  const cidades = (atendimento || []).filter((a) => a.canal === canal && (a.origem || '') === origem)
    .sort((a, b) => (a.uf === b.uf ? a.cidade.localeCompare(b.cidade, 'pt-BR') : a.uf.localeCompare(b.uf)))
    .map((a) => ({ ibge: a.ibge, uf: a.uf, cidade: a.cidade, regiao: a.regiao || '', prazo: a.prazo_dias, tx: Object.fromEntries(COLS_ATEND_FRACIONADO.map(([k, , col]) => [k, col ? a[col] : a.taxas_destino?.[k]])) }));
  const pct = convite.modalidade !== 'FAIXA_PESO';
  const wb = montarPlanilhaFracionado(XS, {
    transportadora: convite.transportadora, cnpj: convite.respondente_cnpj || '', canal, origem, modalidade: convite.modalidade,
    faixas: faixasDoConviteFracionado(convite, canal), ufs: UFS_FRACIONADO, regioes: REGIOES_FRACIONADO,
    gerais: convite.dados_gerais?.[canal] || {}, cidades, colsAtend: COLS_ATEND_FRACIONADO,
    valor: (uf, rg, fl) => { const x = mapa.get(`${uf}|${rg}|${fl}`); return x ? { p: x.frete_percentual, m: x.frete_minimo, k: x.frete_kg, v: x.frete_valor } : null; },
  });
  const slug = (t) => String(t || '').replace(/[^a-z0-9]+/gi, '-');
  XS.writeFile(wb, `tabela-fracionado-${pct ? 'percentual' : 'faixa-peso'}-${canal.toLowerCase()}${origem ? `-${slug(origem)}` : ''}-${slug(convite.transportadora)}.xlsx`);
}
