import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  'https://kvzclgsifzklxexysktw.supabase.co',
  'sb_publishable_H2ppjz1T0oVDBm14cOA5aw_HZrQcoqM'
);
const { data } = await supabase
  .from('realizado_local_ctes')
  .select('transportadora')
  .ilike('transportadora', '%GUANABARA%')
  .limit(1000);
const distintos = new Set((data || []).map(r => r.transportadora));
console.log('Nomes distintos GUANABARA no realizado_local_ctes:', JSON.stringify([...distintos]));
