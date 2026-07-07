import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  'https://kvzclgsifzklxexysktw.supabase.co',
  'sb_publishable_H2ppjz1T0oVDBm14cOA5aw_HZrQcoqM'
);
const { data, error } = await supabase.from('transportadora_vinculos').select('*').ilike('nome_tabela', '%TAM%');
console.log('Vinculos TAM:', JSON.stringify(data, null, 2), 'erro:', error);
