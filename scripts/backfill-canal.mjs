// Reclassifica o `canal` de realizado_local_ctes a partir dos arquivos-fonte,
// em cascata: 1) Escritório de venda (DE-PARA, Canal Final) 2) Canais 3) Transportadora.
// Uso:
//   node scripts/backfill-canal.mjs <depara.ods> <arquivo1.xlsx> [arquivo2.xlsx ...]            (dry-run)
//   node scripts/backfill-canal.mjs --apply <depara.ods> <arquivo1.xlsx> [...]                  (grava)
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const files = args.filter((a) => a !== '--apply');
const deparaPath = files.shift();
if (!deparaPath || !files.length) { console.error('Uso: [--apply] <depara.ods> <arquivos...>'); process.exit(1); }

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
const normTransp = (v) => norm(v).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

// Mapeamento "Canais" -> canal canônico (só retorna se reconhecer).
const B2C = ['B2C', 'VIA VAREJO', 'MERCADO LIVRE', 'MERCADOR LIVRE', 'B2W', 'MAGAZINE LUIZA', 'CARREFOUR', 'CANTU PNEUS', 'GPA', 'COLOMBO', 'AMAZON', 'INTER', 'ANYMARKET', 'ANY MARKET', 'BRADESCO SHOP', 'ITAU SHOP', 'SHOPEE', '99', 'MUSTANG', 'LIVELO', 'COOPERA', 'MARKETPLACE', 'MARKET PLACE', 'ECOMMERCE', 'E-COMMERCE'];
const ATA = ['ATACADO', 'B2B', 'B 2 B'];
function mapCanais(v) {
  const c = norm(v);
  if (!c) return '';
  if (c.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (c.includes('REVERSA')) return 'REVERSA';
  if (ATA.some((i) => c === i || c.includes(i))) return 'ATACADO';
  if (B2C.some((i) => c === i || c.includes(i))) return 'B2C';
  return '';
}

// 1) DE-PARA Escritório de venda -> Canal Final.
const dp = XLSX.readFile(deparaPath);
const drows = XLSX.utils.sheet_to_json(dp.Sheets[dp.SheetNames[0]], { defval: '' });
const mapDP = new Map();
for (const r of drows) {
  const cf = String(r['Canal Final'] || r['Canal'] || '').trim().toUpperCase();
  if (!cf) continue;
  for (const code of [r['Código 1'], r['Código 2']]) { const k = norm(code); if (k && !mapDP.has(k)) mapDP.set(k, cf); }
}
console.log(`DE-PARA: ${mapDP.size} códigos`);

// 3) Parametrização por transportadora.
const paramTransp = new Map();
{
  const { data, error } = await sb.from('canal_transportadora_parametrizacoes').select('transportadora_normalizada, canal');
  if (error) console.warn('parametrizações indisponíveis:', error.message);
  for (const r of data || []) { const k = r.transportadora_normalizada || ''; if (k) paramTransp.set(k, String(r.canal || '').toUpperCase()); }
}
console.log(`Parametrizações transportadora: ${paramTransp.size}`);

// Lê arquivos e monta chave -> canal pela cascata.
const chaveCanal = new Map();
const fonte = { escritorio: 0, canais: 0, transportadora: 0, ebazar: 0, adefinir: 0 };
for (const f of files) {
  const wb = XLSX.readFile(f);
  const ws = wb.Sheets['Registros'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  for (const r of rows) {
    let chave = ''; for (const [k, v] of Object.entries(r)) if (norm(k) === 'CHAVE CTE') chave = String(v).replace(/\D/g, '');
    if (!chave || chaveCanal.has(chave)) continue;
    const ebazar = normTransp(r['Transportadora']).includes('EBAZAR') || norm(r['Tomador de serviço'] || r['Tomador de serviÃ§o']).includes('EBAZAR');
    const esc = mapDP.get(norm(r['Escritório de venda'] || r['EscritÃ³rio de venda']));
    const can = esc ? '' : mapCanais(r['Canais']);
    const tr = (esc || can) ? '' : paramTransp.get(normTransp(r['Transportadora']));
    let canal = esc || can || tr || '';
    if (esc) fonte.escritorio++;
    else if (can) fonte.canais++;
    else if (tr) fonte.transportadora++;
    else if (ebazar) { canal = 'EBAZAR'; fonte.ebazar++; }
    else { canal = 'A DEFINIR'; fonte.adefinir++; }
    chaveCanal.set(chave, canal);
  }
  console.log(`  lido ${f.split(/[\\/]/).pop()} (mapa=${chaveCanal.size})`);
}
console.log(`Chaves com canal definido: ${chaveCanal.size}`);
console.log(`Fonte: escritório=${fonte.escritorio} canais=${fonte.canais} transportadora=${fonte.transportadora} ebazar=${fonte.ebazar} adefinir=${fonte.adefinir}`);

// Varre a base (keyset por id) e compara.
const mudancas = {}; const pendentes = [];
let lastId = '00000000-0000-0000-0000-000000000000';
let total = 0;
for (;;) {
  const { data, error } = await sb.from('realizado_local_ctes').select('id, chave_cte, canal').gt('id', lastId).order('id', { ascending: true }).limit(1000);
  if (error) { console.error('Erro ao varrer:', error.message); process.exit(1); }
  if (!data.length) break;
  for (const r of data) {
    total++;
    const novo = chaveCanal.get(r.chave_cte);
    if (novo && novo !== (r.canal || '')) {
      const k = `${r.canal || '(vazio)'} -> ${novo}`; mudancas[k] = (mudancas[k] || 0) + 1;
      pendentes.push({ chave: r.chave_cte, canal: novo });
    }
  }
  lastId = data[data.length - 1].id;
}
console.log(`\nBase: ${total} linhas | MUDARIAM: ${pendentes.length}`);
console.log('Top mudanças:', JSON.stringify(Object.entries(mudancas).sort((a, b) => b[1] - a[1]).slice(0, 20), null, 1));

if (!APPLY) { console.log('\n[DRY-RUN] nada gravado. Rode com --apply para gravar.'); process.exit(0); }

console.log('\nGRAVANDO...');
let ok = 0, fail = 0; const CONC = 25;
for (let i = 0; i < pendentes.length; i += CONC) {
  await Promise.all(pendentes.slice(i, i + CONC).map(async ({ chave, canal }) => {
    const { error } = await sb.from('realizado_local_ctes').update({ canal }).eq('chave_cte', chave);
    if (error) fail++; else ok++;
  }));
  if ((i / CONC) % 40 === 0) console.log(`  ${ok + fail}/${pendentes.length}`);
}
console.log(`CONCLUIDO: ok=${ok} fail=${fail}`);
