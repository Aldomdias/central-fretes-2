import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { carregarSessao } from '../utils/authLocal';

// Registro e status das importacoes (painel "Central de importacoes" do Dashboard).
// Tudo aqui e' informativo e tolerante a falha: sem a tabela (migration
// 20261113_001_importacoes_registro.sql) ou sem banco, a importacao segue normal.

const TABELA = 'importacoes_registro';
const LOCAL_KEY = 'amd_importacoes_registro_v1';

function lerLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch { return []; }
}

function gravarLocal(lista) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(lista.slice(0, 100))); } catch { /* sem localStorage */ }
}

function tabelaAusente(msg = '') {
  return /relation .* does not exist|could not find the table|schema cache|42P01|PGRST205/i.test(String(msg));
}

// tipo: chave do card (ex.: 'faturas-verum'). arquivos: File[] ou nomes.
export async function registrarImportacao({ tipo, arquivos = [], linhas = null, resumo = '', status = 'OK' } = {}) {
  if (!tipo) return;
  const sessao = carregarSessao();
  const nomes = Array.from(arquivos || []).map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean);
  const registro = {
    tipo,
    status,
    arquivos: nomes.slice(0, 20).join(', ').slice(0, 1000) || null,
    qtd_arquivos: nomes.length || null,
    linhas: Number.isFinite(Number(linhas)) && linhas !== null ? Math.round(Number(linhas)) : null,
    resumo: String(resumo || '').slice(0, 1000) || null,
    usuario: sessao?.nome || sessao?.email || null,
    criado_em: new Date().toISOString(),
  };
  // Copia local sempre (o painel mostra mesmo antes da migration rodar).
  gravarLocal([registro, ...lerLocal()]);
  window.dispatchEvent(new Event('importacoes-registro-atualizado'));
  if (!isSupabaseConfigured()) return;
  try {
    const { error } = await getSupabaseClient().from(TABELA).insert(registro);
    if (error && !tabelaAusente(error.message)) console.warn('[importacoes] registro nao gravado:', error.message);
  } catch (e) {
    console.warn('[importacoes] registro nao gravado:', e?.message || e);
  }
}

function comTimeout(promise, ms = 8000) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve({ data: null, error: { message: 'timeout' } }), ms))]);
}

// Maior valor de uma coluna (data) numa tabela, com filtro opcional. null se falhar.
async function maiorValor(tabela, coluna, filtro) {
  try {
    let q = getSupabaseClient().from(tabela).select(coluna).not(coluna, 'is', null);
    if (filtro) q = filtro(q);
    const { data, error } = await comTimeout(q.order(coluna, { ascending: false }).limit(1));
    if (error) return null;
    return data?.[0]?.[coluna] || null;
  } catch {
    return null;
  }
}

// Indicadores complementares tirados das proprias tabelas de dados (valem tambem
// para importacoes feitas antes do registro existir).
const INDICADORES = {
  'faturas-verum': [
    { rotulo: 'Fatura mais recente no sistema', tabela: 'faturas', coluna: 'created_at', tipo: 'datahora' },
    { rotulo: 'Maior emissão', tabela: 'faturas', coluna: 'data_emissao', tipo: 'data' },
  ],
  ctes: [
    { rotulo: 'CT-e mais recente na base (emissão)', tabela: 'realizado_local_ctes', coluna: 'data_emissao', tipo: 'data' },
    { rotulo: 'Base de CT-es atualizada em', tabela: 'realizado_local_ctes', coluna: 'created_at', tipo: 'datahora' },
  ],
  'sap-pagamentos': [
    { rotulo: 'Pagamentos (compensação) até', tabela: 'financeiro_pagamentos', coluna: 'data_pagamento', tipo: 'data', filtro: (q) => q.in('resultado', ['PAGO', 'DIVERGENTE']) },
    { rotulo: 'Partida de fatura gravada em', tabela: 'financeiro_pagamentos', coluna: 'imported_at', tipo: 'datahora', filtro: (q) => q.in('resultado', ['PARTIDA_LANCADA', 'LANCADA_FINANCEIRO']) },
    { rotulo: 'Partidas de CT-e até', tabela: 'ctes_lancamentos_sap', coluna: 'data_lancamento', tipo: 'data', filtro: (q) => q.or('arquivo_origem.is.null,arquivo_origem.not.like.ROBO*') },
    { rotulo: 'Partida de CT-e gravada em', tabela: 'ctes_lancamentos_sap', coluna: 'imported_at', tipo: 'datahora', filtro: (q) => q.or('arquivo_origem.is.null,arquivo_origem.not.like.ROBO*') },
  ],
};

// Retorna { [tipo]: { ultimo, ultimoOk, indicadores: [{rotulo, valor, tipo}] }, origem }
export async function carregarStatusImportacoes(tipos = []) {
  const porTipo = Object.fromEntries(tipos.map((t) => [t, { ultimo: null, ultimoOk: null, indicadores: [] }]));
  let registros = [];
  let origem = 'navegador';
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await comTimeout(getSupabaseClient().from(TABELA).select('*').order('criado_em', { ascending: false }).limit(300));
      if (!error) { registros = data || []; origem = 'banco'; }
    } catch { /* cai no local */ }
  }
  // Junta o local (cobre o caso da migration ainda nao aplicada) sem duplicar.
  const vistos = new Set(registros.map((r) => `${r.tipo}|${r.criado_em}`));
  lerLocal().forEach((r) => { if (!vistos.has(`${r.tipo}|${r.criado_em}`)) registros.push(r); });
  registros.sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
  registros.forEach((r) => {
    const alvo = porTipo[r.tipo];
    if (!alvo) return;
    if (!alvo.ultimo) alvo.ultimo = r;
    if (!alvo.ultimoOk && r.status === 'OK') alvo.ultimoOk = r;
  });

  if (isSupabaseConfigured()) {
    await Promise.all(tipos.flatMap((t) => (INDICADORES[t] || []).map(async (ind, i) => {
      const valor = await maiorValor(ind.tabela, ind.coluna, ind.filtro);
      porTipo[t].indicadores[i] = { rotulo: ind.rotulo, valor, tipo: ind.tipo };
    })));
    tipos.forEach((t) => { porTipo[t].indicadores = porTipo[t].indicadores.filter(Boolean); });
  }
  return { porTipo, origem };
}
