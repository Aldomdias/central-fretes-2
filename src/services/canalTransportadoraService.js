import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { CANAL_A_DEFINIR, normalizarNomeTransportadora } from '../utils/canalTransportadora';

export const CANAIS_PARAMETRIZAVEIS = ['ATACADO', 'B2C', 'INTERCOMPANY', 'REVERSA'];

function ensureSupabase() {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  return getSupabaseClient();
}

function normalizarPendencia(row = {}) {
  return {
    transportadora: row.transportadora || '',
    transportadoraNormalizada: row.transportadora_normalizada || normalizarNomeTransportadora(row.transportadora),
    canalOriginal: row.canal_original || '',
    motivo: row.motivo || 'Sem tabela/vinculo cadastrado',
    quantidadeTotal: Number(row.quantidade_total || 0),
    quantidadeCtes: Number(row.quantidade_ctes || 0),
    quantidadeTracking: Number(row.quantidade_tracking || 0),
    valorTotalCte: Number(row.valor_total_cte || 0),
    valorTotalNf: Number(row.valor_total_nf || 0),
    pesoTotal: Number(row.peso_total || 0),
    primeiraOcorrencia: row.primeira_ocorrencia || '',
    ultimaOcorrencia: row.ultima_ocorrencia || '',
    basesAfetadas: row.bases_afetadas || '',
  };
}

export async function listarPendenciasCanalTransportadora() {
  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from('pendencias_canal_transportadora')
    .select('*')
    .order('quantidade_total', { ascending: false });

  if (error) {
    throw new Error(`Erro ao carregar pendencias de canal. Rode a migration de canal. Detalhe: ${error.message}`);
  }

  return (data || []).map(normalizarPendencia);
}

export async function definirCanalTransportadora({ transportadora, canal, usuario = '' }) {
  const supabase = ensureSupabase();
  const canalFinal = String(canal || '').trim().toUpperCase();
  if (!transportadora) throw new Error('Transportadora obrigatoria.');
  if (!CANAIS_PARAMETRIZAVEIS.includes(canalFinal)) throw new Error('Canal invalido.');

  const args = {
    p_transportadora: transportadora,
    p_canal: canalFinal,
    p_usuario: usuario || null,
  };

  const { data, error } = await supabase.rpc('aplicar_parametrizacao_canal_transportadora', args);
  if (!error) return data || { ok: true };

  const transportadoraNormalizada = normalizarNomeTransportadora(transportadora);
  const { error: upsertError } = await supabase
    .from('canal_transportadora_parametrizacoes')
    .upsert({
      transportadora,
      transportadora_normalizada: transportadoraNormalizada,
      canal: canalFinal,
      origem: 'manual',
      usuario,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'transportadora_normalizada' });

  if (upsertError) {
    throw new Error(`Erro ao salvar parametrizacao de canal. Detalhe: ${upsertError.message}`);
  }

  await Promise.all([
    supabase.from('realizado_local_ctes').update({ canal: canalFinal }).eq('transportadora', transportadora).eq('canal', CANAL_A_DEFINIR),
    supabase.from('tracking_rows').update({ canal: canalFinal }).eq('transportadora', transportadora).eq('canal', CANAL_A_DEFINIR),
  ]);

  return { ok: true, fallback: true };
}

