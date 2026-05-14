import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA_TRACKING = 'tracking_rows';
const CHUNK_SIZE = 500;

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function cubagemTotal(row = {}) {
  const cubagemUnitaria = toNumber(row.cubagem);
  const volumes = toNumber(row.qtdVolumes || row.volume || row.volumes);
  return cubagemUnitaria * Math.max(volumes || 1, 1);
}

function toDbRow(row = {}) {
  const data = row.data || row.dataFaturamento || '';
  return {
    id: String(row.id || row.chaveNfe || row.notaFiscal || `${Date.now()}-${Math.random()}`).slice(0, 240),
    data,
    competencia: row.competencia || (data ? String(data).slice(0, 7) : ''),
    nota_fiscal: row.notaFiscal || row.numeroNf || row.nfNumero || '',
    chave_nfe: row.chaveNfe || '',
    chave_cte: row.chaveCte || '',
    cte_numero: row.cteNumero || '',
    pedido: row.pedido || '',
    pedido_erp: row.pedidoErp || '',
    canal: row.canal || '',
    canal_original: row.canalOriginal || '',
    transportadora: row.transportadora || '',
    cidade_origem: row.cidadeOrigem || '',
    uf_origem: row.ufOrigem || '',
    ibge_origem: row.ibgeOrigem || '',
    cidade_destino: row.cidadeDestino || '',
    uf_destino: row.ufDestino || '',
    ibge_destino: row.ibgeDestino || '',
    chave_rota_ibge: row.chaveRotaIbge || (row.ibgeOrigem && row.ibgeDestino ? `${row.ibgeOrigem}-${row.ibgeDestino}` : ''),
    peso: toNumber(row.peso),
    peso_declarado: toNumber(row.pesoDeclarado),
    peso_cubado: toNumber(row.pesoCubado || row.pesoCubadoOriginal),
    cubagem_unitaria: toNumber(row.cubagem),
    cubagem_total: cubagemTotal(row),
    valor_nf: toNumber(row.valorNF),
    qtd_volumes: toNumber(row.qtdVolumes),
    previsao_cliente: row.previsaoCliente || null,
    previsao_transportadora: row.prevTransportadora || null,
    data_transporte: row.dataTransporte || null,
    data_entrega: row.entrega || null,
    arquivo_origem: row.arquivoOrigem || '',
    aba_origem: row.abaOrigem || '',
    linha_excel: toNumber(row.linhaExcel),
    ibge_ok: Boolean(row.ibgeOk),
    raw: row.raw || null,
    updated_at: new Date().toISOString(),
  };
}

export async function subirTrackingSupabase(rows = [], onProgress) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const supabase = getSupabaseClient();
  const payload = (rows || []).map(toDbRow);
  let enviados = 0;

  for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
    const chunk = payload.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase
      .from(TABELA_TRACKING)
      .upsert(chunk, { onConflict: 'id' });
    if (error) throw new Error(`Erro ao salvar Tracking no Supabase: ${error.message}`);
    enviados += chunk.length;
    onProgress?.({ enviados, total: payload.length, percentual: Math.round((enviados / Math.max(payload.length, 1)) * 100) });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { enviados, total: payload.length };
}
    