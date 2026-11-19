/**
 * Importa SO o Id do OMS para faturas que ja existem (aba Faturas da planilha da Verum). Grava apenas faturas.oms_invoice_id.
 * A regra de casamento esta em src/utils/omsIdFaturas.js.
 */
import { getSupabaseClient } from '../lib/supabaseClient';
import { casarIdsOms, lerLinhaFatura } from '../utils/omsIdFaturas';

export async function importarIdsOmsDaPlanilha(rows, { aoProgredir = () => {} } = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase nao configurado.');
  const numeros = [...new Set((rows || []).map((r) => lerLinhaFatura(r).numero).filter(Boolean))];
  if (!numeros.length) throw new Error('Nenhuma fatura encontrada na aba Faturas (confira a coluna "Numero Fatura").');

  const faturasBanco = [];
  for (let i = 0; i < numeros.length; i += 200) {
    const { data, error } = await supabase.from('faturas')
      .select('id, numero_fatura, serie_fatura, transportadora, cnpj_transportadora, oms_invoice_id')
      .in('numero_fatura', numeros.slice(i, i + 200));
    if (error) throw new Error(`Erro ao buscar faturas: ${error.message}`);
    faturasBanco.push(...(data || []));
    aoProgredir({ etapa: 'buscando', feitas: Math.min(i + 200, numeros.length), total: numeros.length });
  }

  const resultado = casarIdsOms(rows, faturasBanco);
  const falhas = [];
  const lote = [...resultado.gravar];
  let feitas = 0;
  async function worker() {
    while (lote.length) {
      const item = lote.shift();
      // Atualiza SO esta coluna e SO se ainda estiver vazia (nunca sobrescreve um Id ja gravado).
      const { error } = await supabase.from('faturas').update({ oms_invoice_id: item.omsId }).eq('id', item.id).is('oms_invoice_id', null);
      if (error) falhas.push({ numero: item.numero, motivo: error.message });
      feitas += 1;
      if (feitas % 25 === 0) aoProgredir({ etapa: 'gravando', feitas, total: resultado.gravar.length });
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return { ...resultado, falhas, gravadas: resultado.gravar.length - falhas.length };
}

export function resumirImportacaoIds(r) {
  const c = r.contagem;
  const partes = [
    `${r.gravadas} fatura(s) receberam o Id`,
    c.jaTinha ? `${c.jaTinha} ja tinham` : '',
    c.naoEncontrada ? `${c.naoEncontrada} nao encontrada(s) no sistema` : '',
    c.semId ? `${c.semId} sem Id valido na planilha` : '',
    c.ambigua ? `${c.ambigua} ambigua(s) (duplicidade)` : '',
    c.idDiferente ? `${c.idDiferente} com outro Id ja gravado` : '',
    c.idRepetido ? `${c.idRepetido} com Id repetido` : '',
    r.falhas.length ? `${r.falhas.length} falha(s) ao gravar` : '',
  ].filter(Boolean);
  return `${partes.join('; ')}.`;
}
