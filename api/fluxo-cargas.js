/**
 * Integração via API do fluxo de cargas (mapeamento "Fluxo de Cargas" da Cantu).
 *
 * A Hubylog não conseguiu concluir essa integração pelo lado deles, então o
 * fluxo passa a ser recebido diretamente aqui. Cada processo é identificado
 * pela combinação tipo+numero_id e evolui por PUTs parciais conforme cada
 * fase é concluída (geração, cotação, caminhão, chegadas, operação,
 * faturamento, liberação, descarga, comprovante).
 *
 * PUT  /api/fluxo-cargas  -> cria ou atualiza campos do processo (upsert parcial)
 * GET  /api/fluxo-cargas?tipo=DIST&numero_id=9665 -> consulta o processo
 *
 * Autenticação: header `x-api-key` deve bater com FLUXO_CARGAS_API_KEY.
 */
import { createClient } from '@supabase/supabase-js';

// Campos que o mapeamento documenta explicitamente, fase a fase. Qualquer
// campo enviado fora desta lista cai em `extra` para não perder dado
// enquanto o schema da integradora ainda diverge do documento (ex.: no
// teste TESTEDIST0009 vieram `destino` no singular e `data_coleta_solicitada_1`).
const CAMPOS_MAPEADOS = new Set([
  'solicitante', 'origem', 'cod_filial', 'categoria', 'cubagem',
  'data_coleta_solicitada', 'peso_total', 'valor_total_aproximado', 'destinos',
  'subcontratacao', 'previsao_coleta', 'transportadora', 'bp', 'frete_cantu',
  'frete_transportadora',
  'nome_motorista', 'telefone_motorista', 'placa_cavalo', 'placa_carreta',
  'placa_carreta_extra', 'tipo_veiculo',
  'chegada_fornecedor',
  'inicio_operacao', 'fim_operacao', 'doca', 'porcentagem_separacao',
  'numeracao_lacre', 'data_anexo_faturamento', 'info_faturamento',
  'info_liberacao',
  'chegada_caminhao_filial',
  'descarga_filial',
  'anexo_comprovante',
]);

function getClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error('Integração indisponível: configure SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.');
  }
  return createClient(url, serviceRole, { auth: { persistSession: false } });
}

function autenticado(req) {
  const esperado = process.env.FLUXO_CARGAS_API_KEY;
  if (!esperado) return true; // sem chave configurada ainda: não bloqueia em dev
  return req.headers['x-api-key'] === esperado;
}

export default async function handler(req, res) {
  if (!autenticado(req)) {
    return res.status(401).json({ succeeded: false, error: 'x-api-key inválida ou ausente.' });
  }

  let supabase;
  try {
    supabase = getClient();
  } catch (error) {
    return res.status(500).json({ succeeded: false, error: error.message });
  }

  if (req.method === 'GET') {
    const { tipo, numero_id: numeroId } = req.query || {};
    if (!tipo || !numeroId) {
      return res.status(400).json({ succeeded: false, error: 'Informe tipo e numero_id.' });
    }
    const { data, error } = await supabase
      .from('fluxo_cargas_processos')
      .select('*')
      .eq('tipo', tipo)
      .eq('numero_id', numeroId)
      .maybeSingle();
    if (error) return res.status(500).json({ succeeded: false, error: error.message });
    if (!data) return res.status(404).json({ succeeded: false, error: 'Processo não encontrado.' });
    return res.status(200).json({ succeeded: true, data, error: null });
  }

  if (req.method === 'PUT') {
    const corpo = req.body || {};
    const { tipo, numero_id: numeroId } = corpo;
    if (!tipo || !numeroId) {
      return res.status(400).json({ succeeded: false, error: 'Informe tipo e numero_id.' });
    }

    const mapeados = {};
    const extras = {};
    for (const [chave, valor] of Object.entries(corpo)) {
      if (chave === 'tipo' || chave === 'numero_id') continue;
      if (CAMPOS_MAPEADOS.has(chave)) mapeados[chave] = valor;
      else extras[chave] = valor;
    }

    // Busca o registro atual para mesclar `extra` em vez de sobrescrever
    // (cada fase manda um subconjunto de campos extras diferente).
    const { data: existente } = await supabase
      .from('fluxo_cargas_processos')
      .select('extra')
      .eq('tipo', tipo)
      .eq('numero_id', numeroId)
      .maybeSingle();

    const extraMesclado = { ...(existente?.extra || {}), ...extras };

    const { data, error } = await supabase
      .from('fluxo_cargas_processos')
      .upsert(
        {
          tipo,
          numero_id: numeroId,
          ...mapeados,
          extra: extraMesclado,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tipo,numero_id' },
      )
      .select('id')
      .single();

    if (error) return res.status(500).json({ succeeded: false, error: error.message });
    return res.status(200).json({ succeeded: true, data: data.id, error: null });
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ succeeded: false, error: 'Método não permitido. Use GET ou PUT.' });
}
