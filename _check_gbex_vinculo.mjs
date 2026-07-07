import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  'https://kvzclgsifzklxexysktw.supabase.co',
  'sb_publishable_H2ppjz1T0oVDBm14cOA5aw_HZrQcoqM'
);

const { data: tabelas } = await supabase
  .from('tabelas_negociacao')
  .select('id, transportadora, transportadora_base_nome, canal, origem, uf_origem, tipo_negociacao, status, incluir_simulacao')
  .ilike('transportadora', '%Gbex%');
console.log('Negociacoes Gbex:', JSON.stringify(tabelas, null, 2));

const { data: vinculos, error } = await supabase.from('transportadora_vinculos').select('*').ilike('nome_tabela', '%Gbex%');
console.log('Vinculos Gbex:', JSON.stringify(vinculos, null, 2), 'erro:', error);
