import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
function lerEnv(n) {
  const raw = fs.existsSync('.env') ? fs.readFileSync('.env','utf8') : '';
  const l = raw.split(/\r?\n/).find(l => l.trim().startsWith(n+'='));
  return l ? l.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'') : '';
}
const sb = createClient(lerEnv('VITE_SUPABASE_URL'), lerEnv('VITE_SUPABASE_ANON_KEY'));
const { data } = await sb.from('tabelas_negociacao').select('resumo_simulacao').eq('id','5ce9dae6-c92a-40e2-b005-da7bf2a2001e').single();
const hist = data?.resumo_simulacao?.historico_rodadas || [];
hist.forEach(r => console.log('Rodada:', r.rodada, '| Tipo:', r.tipo_registro, '| ID:', r.id));
