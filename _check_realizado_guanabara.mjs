import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  'https://kvzclgsifzklxexysktw.supabase.co',
  'sb_publishable_H2ppjz1T0oVDBm14cOA5aw_HZrQcoqM'
);
const { data, count, error } = await supabase
  .from('realizado_local_ctes')
  .select('transportadora, canal, cidade_origem, uf_origem, cidade_destino, uf_destino, data_emissao', { count: 'exact' })
  .ilike('transportadora', '%GUANABARA%')
  .limit(5);
console.log('count:', count, 'erro:', error);
console.log('amostra:', JSON.stringify(data, null, 2));
