import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
function lerEnv(n) {
  const raw = fs.existsSync('.env') ? fs.readFileSync('.env','utf8') : '';
  const l = raw.split(/\r?\n/).find(l => l.trim().startsWith(n+'='));
  return l ? l.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'') : '';
}
const sb = createClient(lerEnv('VITE_SUPABASE_URL'), lerEnv('VITE_SUPABASE_ANON_KEY'));
const { data } = await sb.from('tabelas_negociacao').select('id,transportadora,origem,uf_origem').order('transportadora');
data.forEach(t => console.log(t.id, '|', t.transportadora, '|', t.origem, t.uf_origem));
