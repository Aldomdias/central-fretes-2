import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  'https://kvzclgsifzklxexysktw.supabase.co',
  'sb_publishable_H2ppjz1T0oVDBm14cOA5aw_HZrQcoqM'
);
const { data } = await supabase.from('transportadora_vinculos').select('*').ilike('nome_cte', '%GUANABARA%');
console.log(JSON.stringify(data, null, 2));
