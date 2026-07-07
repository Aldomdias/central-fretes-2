import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  'https://kvzclgsifzklxexysktw.supabase.co',
  'sb_publishable_H2ppjz1T0oVDBm14cOA5aw_HZrQcoqM'
);

const { data: tabelas } = await supabase
  .from('tabelas_negociacao')
  .select('id, transportadora, transportadora_base_nome, canal, origem, uf_origem, tipo_negociacao, status, incluir_simulacao')
  .ilike('transportadora', '%TAM%')
  .ilike('transportadora', '%REAJUSTE%');
console.log('Negociacoes TAM REAJUSTE:', JSON.stringify(tabelas, null, 2));
