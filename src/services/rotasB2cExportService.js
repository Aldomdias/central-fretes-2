// Exportação da malha B2C: transportadora x origem x destino x prazo.
// Lê origens/transportadoras inteiras (tabelas pequenas) e as rotas por
// origem com paginação por id (keyset) — a tabela rotas passa de 1M de linhas,
// então nunca varre a base inteira com OFFSET.
import { getSupabaseClient } from '../lib/supabaseClient';
import { carregarMunicipiosIbgeDb } from './freteDatabaseService';

const PAGE = 1000;
const PARALELO = 4;
const CAMPOS_ROTA = 'id,ibge_destino,nome_rota,canal,prazo_entrega_dias,cep_inicial,cep_final,inicio_vigencia,fim_vigencia';

const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');

// Mesma lista de canais B2C usada pelos motores (freteDatabaseService).
const CANAIS_B2C = [
  'B2C', 'VIA VAREJO', 'MERCADO LIVRE', 'MERCADOR LIVRE', 'B2W', 'MAGAZINE LUIZA', 'CARREFOUR', 'CANTU PNEUS',
  'GPA', 'COLOMBO', 'AMAZON', 'INTER', 'ANYMARKET', 'ANY MARKET', 'BRADESCO SHOP', 'ITAU SHOP', 'SHOPEE', '99',
  'MUSTANG', 'LIVELO', 'COOPERA', 'MARKETPLACE', 'MARKET PLACE', 'ECOMMERCE', 'E-COMMERCE',
];

// Origem serve ao B2C quando o canal é B2C/marketplace ou AMBOS/TODOS (combo
// ATACADO+B2C). Canal vazio é ATACADO por padrão no cadastro.
export function canalServeB2c(canal) {
  const c = norm(canal);
  if (!c) return false;
  if (c.includes('AMBOS') || c.includes('TODOS')) return true;
  if (c.includes('REVERSA') || c.includes('INTERCOMPANY')) return false;
  const partes = c.split(/\+|\sE\s|\/|,/).map((s) => s.trim()).filter(Boolean);
  return partes.some((p) => p !== 'ATACADO' && p !== 'B2B' && CANAIS_B2C.some((b) => p === b || p.includes(b)));
}

function ativo(status) {
  const s = norm(status || 'ATIVA');
  return s === 'ATIVA' || s === 'ATIVO';
}

function ensureClient() {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase não configurado.');
  return client;
}

async function comRetry(fn, tentativas = 4) {
  let ultima;
  for (let i = 0; i < tentativas; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const resp = await fn();
    if (!resp.error) return resp;
    ultima = resp;
    const transitorio = resp.error.code === '57014' || /timeout|504|fetch/i.test(resp.error.message || '');
    if (!transitorio || i === tentativas - 1) return resp;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }
  return ultima;
}

async function buscarTodos(supabase, tabela, campos) {
  const linhas = [];
  let ultimoId = null;
  for (;;) {
    let q = supabase.from(tabela).select(campos).order('id', { ascending: true }).limit(PAGE);
    if (ultimoId !== null) q = q.gt('id', ultimoId);
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await comRetry(() => q);
    if (error) throw error;
    const rows = data || [];
    linhas.push(...rows);
    if (rows.length < PAGE) break;
    ultimoId = rows[rows.length - 1].id;
  }
  return linhas;
}

// Origens B2C ativas com a transportadora (para montar os filtros da tela).
export async function listarOrigensB2cDb() {
  const supabase = ensureClient();
  const [origens, transportadoras] = await Promise.all([
    buscarTodos(supabase, 'origens', '*'),
    buscarTodos(supabase, 'transportadoras', 'id,nome,status'),
  ]);
  const transpPorId = new Map(transportadoras.map((t) => [t.id, t]));
  return origens
    .filter((o) => ativo(o.status) && canalServeB2c(o.canal))
    .map((o) => {
      const t = transpPorId.get(o.transportadora_id);
      if (!t || !ativo(t.status)) return null;
      return {
        origemId: o.id,
        transportadora: t.nome || '',
        origem: o.cidade || '',
        ufOrigem: String(o.uf || o.estado || '').toUpperCase().slice(0, 2),
        codigoCentro: o.codigo_centro || '',
        canal: o.canal || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.transportadora.localeCompare(b.transportadora) || a.origem.localeCompare(b.origem));
}

async function rotasDaOrigem(supabase, origemId) {
  const linhas = [];
  let ultimoId = null;
  for (;;) {
    let q = supabase.from('rotas').select(CAMPOS_ROTA).eq('origem_id', origemId).order('id', { ascending: true }).limit(PAGE);
    if (ultimoId !== null) q = q.gt('id', ultimoId);
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await comRetry(() => q);
    if (error) throw error;
    const rows = data || [];
    linhas.push(...rows);
    if (rows.length < PAGE) break;
    ultimoId = rows[rows.length - 1].id;
  }
  return linhas;
}

function vigente(rota, hoje) {
  const ini = String(rota.inicio_vigencia || '').slice(0, 10);
  const fim = String(rota.fim_vigencia || '').slice(0, 10);
  if (ini && ini > hoje) return false;
  if (fim && fim < hoje) return false;
  return true;
}

// Monta as linhas da exportação.
// agrupar=true: 1 linha por transportadora+origem+IBGE destino, com o menor e o
// maior prazo (as faixas de CEP de um mesmo município viram uma linha só).
// Vigência não filtra por padrão: as rotas da base não trazem início/fim
// preenchidos de forma confiável e o filtro zerava a exportação.
export async function exportarRotasB2cDb({ origens = [], somenteVigentes = false, agrupar = true, onProgress } = {}) {
  const supabase = ensureClient();
  const hoje = new Date().toISOString().slice(0, 10);

  onProgress?.({ etapa: 'Carregando municípios IBGE…', feitas: 0, total: origens.length, linhas: 0 });
  const municipios = await carregarMunicipiosIbgeDb().catch(() => []);
  const municipioPorIbge = new Map((municipios || []).map((m) => [String(m.ibge).slice(0, 7), m]));

  const saida = [];
  let feitas = 0;
  let semIbge = 0;
  const fila = [...origens];

  async function worker() {
    while (fila.length) {
      const origem = fila.shift();
      // eslint-disable-next-line no-await-in-loop
      const rotas = await rotasDaOrigem(supabase, origem.origemId);
      const grupos = new Map();
      rotas.forEach((r) => {
        if (r.canal && !canalServeB2c(r.canal)) return;
        if (somenteVigentes && !vigente(r, hoje)) return;
        const ibge = String(r.ibge_destino || '').replace(/\D/g, '').slice(0, 7);
        if (!ibge) semIbge += 1;
        const mun = municipioPorIbge.get(ibge);
        const prazo = r.prazo_entrega_dias == null || r.prazo_entrega_dias === '' ? null : Number(r.prazo_entrega_dias);
        const base = {
          transportadora: origem.transportadora,
          origem: origem.origem,
          ufOrigem: origem.ufOrigem,
          codigoCentro: origem.codigoCentro,
          canal: origem.canal,
          ibgeDestino: ibge,
          cidadeDestino: mun?.cidade || r.nome_rota || '',
          ufDestino: mun?.uf || '',
        };
        if (!agrupar) {
          saida.push({
            ...base,
            nomeRota: r.nome_rota || '',
            cepInicial: r.cep_inicial || '',
            cepFinal: r.cep_final || '',
            prazo,
            inicioVigencia: String(r.inicio_vigencia || '').slice(0, 10),
            fimVigencia: String(r.fim_vigencia || '').slice(0, 10),
          });
          return;
        }
        const chave = ibge || `ROTA:${norm(r.nome_rota)}`;
        const atual = grupos.get(chave);
        if (!atual) {
          grupos.set(chave, { ...base, prazoMin: prazo, prazoMax: prazo, faixasCep: 1 });
        } else {
          atual.faixasCep += 1;
          if (prazo != null) {
            if (atual.prazoMin == null || prazo < atual.prazoMin) atual.prazoMin = prazo;
            if (atual.prazoMax == null || prazo > atual.prazoMax) atual.prazoMax = prazo;
          }
        }
      });
      if (agrupar) saida.push(...grupos.values());
      feitas += 1;
      onProgress?.({ etapa: `${origem.transportadora} — ${origem.origem}`, feitas, total: origens.length, linhas: saida.length });
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALELO, origens.length || 1) }, worker));

  saida.sort((a, b) => a.transportadora.localeCompare(b.transportadora)
    || a.origem.localeCompare(b.origem)
    || String(a.ufDestino).localeCompare(String(b.ufDestino))
    || String(a.cidadeDestino).localeCompare(String(b.cidadeDestino)));
  return { linhas: saida, semIbge };
}

function celulaCsv(v) {
  if (v == null) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV com ; e BOM (abre direto no Excel pt-BR). Excel tem limite de 1.048.576
// linhas por aba; acima disso o CSV continua completo, mas o Excel corta.
export function baixarCsvRotasB2c(linhas, agrupar, nomeArquivo) {
  const colunas = agrupar
    ? [
      ['Transportadora', 'transportadora'], ['Origem', 'origem'], ['UF origem', 'ufOrigem'], ['Centro', 'codigoCentro'], ['Canal', 'canal'],
      ['IBGE destino', 'ibgeDestino'], ['Cidade destino', 'cidadeDestino'], ['UF destino', 'ufDestino'],
      ['Prazo (dias)', 'prazoMin'], ['Prazo máximo (dias)', 'prazoMax'], ['Faixas de CEP', 'faixasCep'],
    ]
    : [
      ['Transportadora', 'transportadora'], ['Origem', 'origem'], ['UF origem', 'ufOrigem'], ['Centro', 'codigoCentro'], ['Canal', 'canal'],
      ['IBGE destino', 'ibgeDestino'], ['Cidade destino', 'cidadeDestino'], ['UF destino', 'ufDestino'], ['Nome rota', 'nomeRota'],
      ['CEP inicial', 'cepInicial'], ['CEP final', 'cepFinal'], ['Prazo (dias)', 'prazo'],
      ['Início vigência', 'inicioVigencia'], ['Fim vigência', 'fimVigencia'],
    ];
  const partes = [colunas.map(([t]) => celulaCsv(t)).join(';')];
  linhas.forEach((l) => partes.push(colunas.map(([, k]) => celulaCsv(l[k])).join(';')));
  const blob = new Blob(['﻿', partes.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nomeArquivo}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
