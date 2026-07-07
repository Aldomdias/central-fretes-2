import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  'https://kvzclgsifzklxexysktw.supabase.co',
  'sb_publishable_H2ppjz1T0oVDBm14cOA5aw_HZrQcoqM'
);
const id = 'f5992365-a9cb-4e98-87b4-c4d70471fc6d';
const { count: itensCount } = await supabase.from('tabelas_negociacao_itens').select('id', { count: 'exact', head: true }).eq('tabela_negociacao_id', id);
const { count: taxasCount } = await supabase.from('tabelas_negociacao_taxas_destino').select('id', { count: 'exact', head: true }).eq('tabela_negociacao_id', id);
console.log('Itens:', itensCount, 'Taxas:', taxasCount);
