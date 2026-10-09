import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { aliquotaDaRota, calcularBruto, liquidoDoBruto } from '../utils/lotacaoCotacaoCalculo';
import { VEICULO_PADRAO, chaveRota, mesmaCidade, norm, splitCidade, veiculoExcluido } from '../utils/lotacaoCotacaoChave';
import { chaveRota as chaveRotaTabela, salvarTabelasLotacao, upsertTabelaLotacao, carregarTabelasLotacao } from '../utils/lotacaoTables';
import { salvarTabelaLotacaoSupabase, lotacaoSupabaseConfigurado } from './lotacaoSupabaseService';

const LOTE = 500;
const arred = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function client() {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  return getSupabaseClient();
}

const TIPO_REF = { REF_CASA: 'TransGP (casa)', REF_ANTT: 'ANTT' };
export const nomeTipoRef = (tipo) => TIPO_REF[tipo] || tipo;

// KM calculado pela internet (rota rodoviaria), gravado em simulador_configuracoes.
export async function carregarKmRotas() {
  try {
    const { data } = await client().from('simulador_configuracoes').select('valor').eq('chave', 'lotacao_km_rotas').maybeSingle();
    return data?.valor && typeof data.valor === 'object' ? data.valor : {};
  } catch { return {}; }
}

// nome do municipio (sem acento) -> UF, so quando o nome e unico no Brasil.
let cacheUf = null;
export async function carregarMapaUfMunicipios() {
  if (cacheUf) return cacheUf;
  const mapa = new Map();
  try {
    const sb = client();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('ibge_municipios').select('nome_municipio_sem_acento,nome_municipio,sigla_uf').range(from, from + 999);
      if (error) throw error;
      (data || []).forEach((m) => {
        const k = norm(m.nome_municipio_sem_acento || m.nome_municipio);
        if (!k) return;
        if (!mapa.has(k)) mapa.set(k, m.sigla_uf);
        else if (mapa.get(k) !== m.sigla_uf) mapa.set(k, null);
      });
      if (!data || data.length < 1000) break;
    }
  } catch { /* sem IBGE: segue so com as UFs conhecidas */ }
  cacheUf = mapa;
  return mapa;
}

function erroMigracaoTipo(error) {
  if (/tipo/i.test(error?.message || '') && /column|schema/i.test(error?.message || '')) {
    return new Error('Aplique a migration 20261009_002_lotacao_cotacao_referencias.sql no Supabase.');
  }
  return error;
}

async function inserirRotasNovas(sb, cotacaoId, novas) {
  const linhas = novas.map((r) => ({ cotacao_id: cotacaoId, ...r }));
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await sb.from('lotacao_cotacao_rotas').upsert(linhas.slice(i, i + LOTE), { onConflict: 'cotacao_id,chave', ignoreDuplicates: true });
    if (error) throw error;
  }
}

// Importa uma tabela de referencia (linhas ja lidas por importarTabelaLotacao).
// base: 'LIQUIDO' (valor sem ICMS) ou 'BRUTO' (com ICMS); guarda sempre os dois.
export async function importarReferencia({ cotacaoId, tipo, nome, arquivo, linhas, base, matriz, rotasPorChave }) {
  const sb = client();
  const { error: eDel } = await sb.from('lotacao_cotacao_convites').delete().eq('cotacao_id', cotacaoId).eq('tipo', tipo);
  if (eDel) throw erroMigracaoTipo(eDel);

  const porChave = new Map();
  linhas.forEach((l) => {
    const valor = Number(l.valor);
    if (!(valor > 0) || mesmaCidade(l.origem, l.destino) || veiculoExcluido(l.tipo)) return;
    const chave = chaveRota(l.origem, l.destino);
    const atual = porChave.get(chave);
    if (!atual || valor < atual.valor) porChave.set(chave, { ...l, chave, valor });
  });

  const novas = [];
  porChave.forEach((l, chave) => {
    if (rotasPorChave.has(chave)) return;
    novas.push({
      chave,
      origem: splitCidade(l.origem).cidade,
      uf_origem: String(l.ufOrigem || splitCidade(l.origem).uf || '').toUpperCase(),
      destino: splitCidade(l.destino).cidade,
      uf_destino: String(l.ufDestino || splitCidade(l.destino).uf || '').toUpperCase(),
      tipo_veiculo: VEICULO_PADRAO,
      km: Number(l.km) || null,
      viagens: 0,
      frete_medio: null,
      target: null,
    });
  });
  if (novas.length) await inserirRotasNovas(sb, cotacaoId, novas);
  const todasRotas = new Map(rotasPorChave);
  novas.forEach((r) => todasRotas.set(r.chave, r));

  const { data: convite, error: eIns } = await sb.from('lotacao_cotacao_convites').insert({
    cotacao_id: cotacaoId, transportadora: nome, tipo, status: 'ENVIADO', enviado_em: new Date().toISOString(), respondente_nome: arquivo || null,
  }).select().single();
  if (eIns) throw erroMigracaoTipo(eIns);

  const agora = new Date().toISOString();
  const propostas = [];
  porChave.forEach((l, chave) => {
    const rota = todasRotas.get(chave);
    const { aliquota } = aliquotaDaRota(matriz, rota?.uf_origem, rota?.uf_destino);
    let liquido; let bruto; let icms;
    if (base === 'BRUTO') {
      bruto = arred(l.valor);
      liquido = liquidoDoBruto(bruto, aliquota);
      icms = arred(bruto - liquido);
    } else {
      liquido = arred(l.valor);
      ({ bruto, icms } = calcularBruto(liquido, aliquota));
    }
    propostas.push({ convite_id: convite.id, cotacao_id: cotacaoId, chave, valor_liquido: liquido, pedagio: 0, aliquota_icms: aliquota, icms_valor: icms, valor_bruto: bruto, updated_at: agora });
  });
  for (let i = 0; i < propostas.length; i += LOTE) {
    const { error } = await sb.from('lotacao_cotacao_propostas').upsert(propostas.slice(i, i + LOTE), { onConflict: 'convite_id,chave' });
    if (error) throw error;
  }
  return { rotas: propostas.length, novasRotas: novas.length };
}

// Importa, pelo admin, a planilha-modelo preenchida por um transportador.
export async function importarPropostasConvite({ convite, cotacaoId, itens, rotasPorChave, matriz, eixos }) {
  const sb = client();
  const agora = new Date().toISOString();
  const propostas = [];
  itens.forEach((it) => {
    const rota = rotasPorChave.get(it.chave);
    if (!rota || !(it.liquido > 0)) return;
    const { aliquota } = aliquotaDaRota(matriz, rota.uf_origem, rota.uf_destino);
    const { bruto, icms } = calcularBruto(it.liquido, aliquota);
    propostas.push({
      convite_id: convite.id, cotacao_id: cotacaoId, chave: it.chave, valor_liquido: arred(it.liquido), pedagio: 0, aliquota_icms: aliquota,
      icms_valor: icms, valor_bruto: bruto, prazo_dias: it.prazo || null, observacao: it.obs || null, updated_at: agora,
    });
  });
  if (!propostas.length) throw new Error('Nenhuma linha com valor líquido reconhecida na planilha.');
  await sb.from('lotacao_cotacao_propostas').delete().eq('convite_id', convite.id);
  for (let i = 0; i < propostas.length; i += LOTE) {
    const { error } = await sb.from('lotacao_cotacao_propostas').upsert(propostas.slice(i, i + LOTE), { onConflict: 'convite_id,chave' });
    if (error) throw error;
  }
  await sb.from('lotacao_cotacao_convites').update({ status: 'ENVIADO', enviado_em: agora }).eq('id', convite.id);
  if (eixos === 5 || eixos === 6) await sb.from('lotacao_cotacao_convites').update({ eixos }).eq('id', convite.id); // coluna so existe apos a migration
  return propostas.length;
}

// Envia a proposta avaliada para a Tabela de Lotacao (lugar oficial). Substitui a tabela
// anterior da mesma transportadora. basePublicada: 'BRUTO' (com ICMS) ou 'LIQUIDO'.
export async function oficializarProposta({ nome, propostas, rotasPorChave, basePublicada }) {
  const linhas = [];
  propostas.forEach((p, i) => {
    const rota = rotasPorChave.get(p.chave);
    if (!rota) return;
    const valor = basePublicada === 'LIQUIDO' ? Number(p.valor_liquido) : Number(p.valor_bruto);
    if (!(valor > 0)) return;
    const item = {
      id: `rota-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      sheetName: 'Cotação online',
      excelRow: i + 1,
      transportadora: nome,
      origem: rota.origem,
      ufOrigem: rota.uf_origem || '',
      destino: rota.destino,
      ufDestino: rota.uf_destino || '',
      tipo: rota.tipo_veiculo,
      km: rota.km ? Number(rota.km) : null,
      prazo: p.prazo_dias ? String(p.prazo_dias) : '',
      icms: p.aliquota_icms != null ? Number(p.aliquota_icms) / 100 : null,
      pedagio: null,
      target: valor,
      freteAnttOficial: null,
      freteAntt: null,
      diferencaAntt: null,
      valor,
      valorFonte: basePublicada === 'LIQUIDO' ? 'Cotação online - líquido (sem ICMS)' : 'Cotação online - bruto (com ICMS)',
    };
    item.chave = chaveRotaTabela(item);
    linhas.push(item);
  });
  if (!linhas.length) throw new Error('A proposta não tem linhas válidas para enviar.');

  const tabela = {
    id: `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    nome,
    tipo: 'TRANSPORTADORA',
    modelo: 'COTAÇÃO ONLINE',
    fileName: 'Cotação online',
    createdAt: new Date().toISOString(),
    linhas,
    totalLinhas: linhas.length,
    rotasUnicas: new Set(linhas.map((l) => l.chave)).size,
    origens: new Set(linhas.map((l) => `${l.origem}/${l.ufOrigem}`)).size,
    destinos: new Set(linhas.map((l) => `${l.destino}/${l.ufDestino}`)).size,
    abasImportadas: [{ nome: 'Cotação online', rotas: linhas.length }],
    abasIgnoradas: [],
    fontesValor: { [linhas[0].valorFonte]: linhas.length },
    resumoFontesValor: `${linhas[0].valorFonte}: ${linhas.length}`,
  };

  if (lotacaoSupabaseConfigurado()) {
    await salvarTabelaLotacaoSupabase(tabela);
  } else {
    salvarTabelasLotacao(upsertTabelaLotacao(carregarTabelasLotacao(), tabela));
  }
  return { linhas: linhas.length };
}

// Periodo coberto pelo realizado (cargas) para calcular a media mensal de viagens.
export async function carregarPeriodoRealizado() {
  try {
    const sb = client();
    const [a, b] = await Promise.all([
      sb.from('lotacao_cargas').select('coleta_realizada').not('coleta_realizada', 'is', null).order('coleta_realizada', { ascending: true }).limit(1),
      sb.from('lotacao_cargas').select('coleta_realizada').not('coleta_realizada', 'is', null).order('coleta_realizada', { ascending: false }).limit(1),
    ]);
    const ini = a.data?.[0]?.coleta_realizada;
    const fim = b.data?.[0]?.coleta_realizada;
    if (!ini || !fim) return null;
    const dias = (new Date(fim).getTime() - new Date(ini).getTime()) / 86400000;
    return { inicio: ini, fim, meses: Math.max(1, Math.round((dias / 30.4375) * 10) / 10) };
  } catch { return null; }
}
