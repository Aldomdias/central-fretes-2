// Backfill de tomador_servico em realizado_local_ctes a partir dos arquivos-fonte.
// Uso: node scripts/backfill-tomador.mjs <arquivo1.xlsx> <arquivo2.xlsx> ...
// Atualiza SOMENTE linhas cujo tomador_servico esteja vazio/null e cuja chave
// exista nos arquivos. Nunca sobrescreve tomador já preenchido.
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
    const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ntext = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const files = process.argv.slice(2);
if (!files.length) { console.error('Informe os arquivos .xlsx'); process.exit(1); }

const map = new Map();
for (const f of files) {
  const wb = XLSX.readFile(f);
  const ws = wb.Sheets['Registros'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  for (const r of rows) {
    let chave = '', tom = '';
    for (const [k, v] of Object.entries(r)) {
      const nk = norm(k);
      if (nk === 'chave cte') chave = String(v).replace(/\D/g, '');
      if (nk === 'tomador de servico') tom = ntext(v);
    }
    if (chave && tom && !map.has(chave)) map.set(chave, tom);
  }
}
console.log(`Mapa chave->tomador: ${map.size} chaves`);

// 1) Buscar todas as chaves do banco com tomador vazio (keyset por id, estável).
const PAGE = 1000;
let lastId = '00000000-0000-0000-0000-000000000000';
const pendSet = new Set();
for (;;) {
  const { data, error } = await sb
    .from('realizado_local_ctes')
    .select('id,chave_cte')
    .or('tomador_servico.is.null,tomador_servico.eq.')
    .gt('id', lastId)
    .order('id', { ascending: true })
    .limit(PAGE);
  if (error) { console.error('Erro ao listar:', error.message); process.exit(1); }
  if (!data.length) break;
  for (const r of data) if (map.has(r.chave_cte)) pendSet.add(r.chave_cte);
  lastId = data[data.length - 1].id;
  if (data.length < PAGE) break;
}
const pendentes = [...pendSet];
console.log(`Linhas vazias que serão corrigidas: ${pendentes.length}`);

// 2) Atualizar em lotes com concorrência limitada.
let ok = 0, fail = 0;
const CONC = 25;
for (let i = 0; i < pendentes.length; i += CONC) {
  const slice = pendentes.slice(i, i + CONC);
  await Promise.all(slice.map(async (chave) => {
    const { error } = await sb
      .from('realizado_local_ctes')
      .update({ tomador_servico: map.get(chave) })
      .eq('chave_cte', chave)
      .or('tomador_servico.is.null,tomador_servico.eq.');
    if (error) { fail++; } else { ok++; }
  }));
  if ((i / CONC) % 20 === 0) console.log(`  progresso: ${ok + fail}/${pendentes.length} (ok=${ok} fail=${fail})`);
}
console.log(`CONCLUIDO: ok=${ok} fail=${fail}`);
