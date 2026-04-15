import { supabase } from '../lib/supabaseClient';

export async function salvarSnapshotTransportadoras(transportadoras) {
  if (!supabase) return { ok: false, modo: 'local' };
  const payload = { nome: `snapshot-${new Date().toISOString()}`, payload: transportadoras };
  const { error } = await supabase.from('frete_snapshots').insert(payload);
  return { ok: !error, error, modo: 'supabase' };
}
