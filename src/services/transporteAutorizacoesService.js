import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

const TABELA = 'transporte_autorizacoes';

const soDigitos = (valor) => String(valor || '').replace(/\D/g, '');
const numero = (valor) => Number(valor || 0) || 0;

function exigirClient() {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado.');
  return getSupabaseClient();
}

export function normalizarCanalAutorizacao(canal) {
  return String(canal || '').toUpperCase().includes('B2C') ? 'B2C' : 'ATACADO';
}

export async function listarAutorizacoes({ canal, status } = {}) {
  let query = exigirClient().from(TABELA).select('*').eq('ativo', true).order('enviado_em', { ascending: false }).limit(2000);
  if (canal) query = query.eq('canal', canal);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(`Erro ao listar autorizacoes: ${error.message}. Rode a migration 20260923_003_transporte_autorizacoes.sql.`);
  return data || [];
}

// Pedido (Marketplace) e chave da NF de cada CT-e, pela base (tracking primeiro,
// realizado como reserva). Quem autoriza precisa desses dados na tela.
export async function buscarVinculoPorCte(chavesCte = []) {
  const mapa = new Map();
  const chaves = [...new Set(chavesCte.map(soDigitos).filter(Boolean))];
  if (!chaves.length || !isSupabaseConfigured()) return mapa;
  const client = getSupabaseClient();
  try {
    for (let i = 0; i < chaves.length; i += 100) {
      const lote = chaves.slice(i, i + 100);
      const { data } = await client.from('tracking_rows').select('chave_cte,chave_nfe,pedido_erp,mk:raw->>Pedido Marketplace').in('chave_cte', lote);
      (data || []).forEach((row) => {
        const chave = soDigitos(row.chave_cte);
        const atual = mapa.get(chave) || { chaveNfe: '', pedido: '' };
        mapa.set(chave, { chaveNfe: atual.chaveNfe || soDigitos(row.chave_nfe), pedido: atual.pedido || row.mk || row.pedido_erp || '' });
      });
      const faltamNfe = lote.filter((chave) => !mapa.get(chave)?.chaveNfe);
      if (faltamNfe.length) {
        const { data: realizado } = await client.from('realizado_local_ctes').select('chave_cte,chave_nfe').in('chave_cte', faltamNfe);
        (realizado || []).forEach((row) => {
          const chave = soDigitos(row.chave_cte);
          const atual = mapa.get(chave) || { chaveNfe: '', pedido: '' };
          if (soDigitos(row.chave_nfe)) mapa.set(chave, { ...atual, chaveNfe: soDigitos(row.chave_nfe) });
        });
      }
    }
  } catch (error) {
    console.warn('[Autorizacoes transporte] vinculo por CT-e indisponivel.', error?.message || error);
  }
  return mapa;
}

// Preenche pedido/NF que faltam nos itens da fila (enviados antes do vinculo).
export async function completarVinculosPendentes(itens = []) {
  const incompletos = itens.filter((item) => item.chave_cte && (!item.numero_pedido || !item.chave_nfe));
  if (!incompletos.length) return 0;
  const vinculos = await buscarVinculoPorCte(incompletos.map((item) => item.chave_cte));
  let atualizados = 0;
  for (const item of incompletos) {
    const achado = vinculos.get(soDigitos(item.chave_cte));
    const patch = {};
    if (!item.numero_pedido && achado?.pedido) patch.numero_pedido = achado.pedido;
    if (!item.chave_nfe && achado?.chaveNfe) patch.chave_nfe = achado.chaveNfe;
    if (!Object.keys(patch).length) continue;
    const { error } = await exigirClient().from(TABELA).update(patch).eq('id', item.id);
    if (!error) atualizados += 1;
  }
  return atualizados;
}

// Auditoria -> fila do gestor do canal. Nao duplica CT-e que ja esta na fila
// (PENDENTE) ou ja autorizado.
export async function enviarParaAutorizacao(itens = [], usuarioNome = '') {
  const client = exigirClient();
  const chaves = itens.map((item) => soDigitos(item.chave_cte)).filter(Boolean);
  let existentes = new Set();
  if (chaves.length) {
    const { data, error } = await client.from(TABELA).select('chave_cte').eq('ativo', true).in('status', ['PENDENTE', 'AUTORIZADA']).in('chave_cte', chaves);
    if (error) throw new Error(`Erro ao verificar fila: ${error.message}`);
    existentes = new Set((data || []).map((row) => row.chave_cte));
  }
  const vinculos = await buscarVinculoPorCte(itens.filter((item) => !item.numero_pedido || !item.chave_nfe).map((item) => item.chave_cte));
  const novos = itens
    .filter((item) => soDigitos(item.chave_cte) || soDigitos(item.chave_nfe))
    .filter((item) => !existentes.has(soDigitos(item.chave_cte)))
    .map((item) => ({
      canal: normalizarCanalAutorizacao(item.canal),
      origem: 'AUDITORIA',
      status: 'PENDENTE',
      chave_cte: soDigitos(item.chave_cte) || null,
      chave_nfe: soDigitos(item.chave_nfe) || vinculos.get(soDigitos(item.chave_cte))?.chaveNfe || null,
      numero_pedido: item.numero_pedido || vinculos.get(soDigitos(item.chave_cte))?.pedido || null,
      transportadora: item.transportadora || null,
      cidade_origem: item.cidade_origem || null,
      cidade_destino: item.cidade_destino || null,
      valor_cte: numero(item.valor_cte),
      valor_calculado: numero(item.valor_calculado),
      valor_divergente: numero(item.valor_divergente),
      observacao_auditoria: item.observacao || null,
      enviado_por: usuarioNome || null,
      fatura_id: item.fatura_id || null,
    }));
  if (novos.length) {
    const { error } = await client.from(TABELA).insert(novos);
    if (error) throw new Error(`Erro ao enviar para autorizacao: ${error.message}`);
  }
  return { enviados: novos.length, jaNaFila: itens.length - novos.length };
}

export async function decidirAutorizacao({ id, autorizar, valorAutorizado, observacao, usuarioNome }) {
  const { error } = await exigirClient().from(TABELA).update({
    status: autorizar ? 'AUTORIZADA' : 'RECUSADA',
    valor_autorizado: autorizar ? numero(valorAutorizado) : 0,
    observacao_gestor: observacao || null,
    decidido_por: usuarioNome || null,
    decidido_em: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw new Error(`Erro ao registrar decisao: ${error.message}`);
}

// Liga chave do CT-e, chave da NF e pedido usando a base (tracking e realizado),
// pra o saldo lancado por qualquer um dos tres ja ficar vinculado ao CT-e — a
// auditoria depois so casa pela chave do CT-e, sem mexer em mais nada.
async function resolverVinculo({ chaveCte, chaveNfe, pedido }) {
  const client = exigirClient();
  const achado = { chaveCte: chaveCte || '', chaveNfe: chaveNfe || '', pedido: pedido || '' };
  const buscar = async (tabela, coluna, valor, select) => {
    const { data } = await client.from(tabela).select(select).eq(coluna, valor).limit(1);
    return data?.[0] || null;
  };
  try {
    let linha = null;
    if (chaveNfe) linha = await buscar('tracking_rows', 'chave_nfe', chaveNfe, 'chave_cte,chave_nfe,pedido,pedido_erp,mk:raw->>Pedido Marketplace');
    if (!linha && chaveNfe) linha = await buscar('realizado_local_ctes', 'chave_nfe', chaveNfe, 'chave_cte,chave_nfe');
    if (!linha && chaveCte) linha = await buscar('tracking_rows', 'chave_cte', chaveCte, 'chave_cte,chave_nfe,pedido,pedido_erp,mk:raw->>Pedido Marketplace');
    if (!linha && chaveCte) linha = await buscar('realizado_local_ctes', 'chave_cte', chaveCte, 'chave_cte,chave_nfe');
    if (!linha && pedido) {
      // "Numero do pedido" = Pedido Marketplace (o que a operacao usa); aceita tambem o ERP.
      linha = await buscar('tracking_rows', 'raw->>Pedido Marketplace', pedido, 'chave_cte,chave_nfe,pedido,pedido_erp,mk:raw->>Pedido Marketplace')
        || await buscar('tracking_rows', 'pedido_erp', pedido, 'chave_cte,chave_nfe,pedido,pedido_erp,mk:raw->>Pedido Marketplace')
        || await buscar('tracking_rows', 'pedido', pedido, 'chave_cte,chave_nfe,pedido,pedido_erp,mk:raw->>Pedido Marketplace');
    }
    if (linha) {
      achado.chaveCte = achado.chaveCte || soDigitos(linha.chave_cte);
      achado.chaveNfe = achado.chaveNfe || soDigitos(linha.chave_nfe);
      achado.pedido = linha.mk || achado.pedido || linha.pedido_erp || linha.pedido || '';
    }
  } catch (error) {
    console.warn('[Autorizacoes transporte] vinculo nao resolvido; segue com o que foi informado.', error?.message || error);
  }
  return achado;
}

// Gestor lanca a autorizacao antes da auditoria (chave do CT-e, da NF ou pedido).
export async function lancarSaldoAntecipado({ canal, chaveCte, chaveNfe, numeroPedido, valor, observacao, usuarioNome }) {
  const informado = { chaveCte: soDigitos(chaveCte), chaveNfe: soDigitos(chaveNfe), pedido: String(numeroPedido || '').replace(/^#/, '').trim() };
  if (!informado.chaveCte && !informado.chaveNfe && !informado.pedido) throw new Error('Informe a chave do CT-e, da nota fiscal ou o numero do pedido.');
  if (!(numero(valor) > 0)) throw new Error('Informe o valor autorizado.');
  const vinculo = await resolverVinculo(informado);
  if (!vinculo.chaveCte && !vinculo.chaveNfe) throw new Error('Pedido nao encontrado no tracking — informe a chave do CT-e ou da nota.');
  const agora = new Date().toISOString();
  const { error } = await exigirClient().from(TABELA).insert({
    canal: normalizarCanalAutorizacao(canal),
    origem: 'GESTOR',
    status: 'AUTORIZADA',
    chave_cte: vinculo.chaveCte || null,
    chave_nfe: vinculo.chaveNfe || null,
    numero_pedido: vinculo.pedido || null,
    valor_autorizado: numero(valor),
    observacao_gestor: observacao || null,
    enviado_por: usuarioNome || null,
    decidido_por: usuarioNome || null,
    decidido_em: agora,
  });
  if (error) throw new Error(`Erro ao lancar saldo: ${error.message}`);
  return { vinculadoCte: Boolean(vinculo.chaveCte), chaveCte: vinculo.chaveCte, chaveNfe: vinculo.chaveNfe, pedido: vinculo.pedido };
}

export async function desativarAutorizacao(id) {
  const { error } = await exigirClient().from(TABELA).update({ ativo: false }).eq('id', id);
  if (error) throw new Error(`Erro ao remover autorizacao: ${error.message}`);
}

// Decisoes do gestor (autorizou/recusou/na fila) por chave de CT-e ou NF, com
// justificativa e quem decidiu — pra mostrar no CT-e (tooltip da coluna Saldo).
export async function carregarDecisoesPorChave(chaves = []) {
  const mapa = new Map();
  if (!isSupabaseConfigured()) return mapa;
  const unicas = [...new Set(chaves.map(soDigitos).filter(Boolean))];
  const client = getSupabaseClient();
  try {
    for (let inicio = 0; inicio < unicas.length; inicio += 150) {
      const lote = unicas.slice(inicio, inicio + 150).join(',');
      const { data, error } = await client.from(TABELA)
        .select('id, canal, status, chave_cte, chave_nfe, valor_autorizado, valor_divergente, observacao_gestor, observacao_auditoria, decidido_por, decidido_em, enviado_por, enviado_em')
        .eq('ativo', true)
        .or(`chave_cte.in.(${lote}),chave_nfe.in.(${lote})`)
        .order('enviado_em', { ascending: false });
      if (error) throw error;
      (data || []).forEach((row) => {
        [row.chave_cte, row.chave_nfe].filter(Boolean).forEach((chave) => {
          if (!unicas.includes(chave)) return;
          const lista = mapa.get(chave) || [];
          if (!lista.some((item) => item.id === row.id)) lista.push(row);
          mapa.set(chave, lista);
        });
      });
    }
  } catch (error) {
    console.warn('[Autorizacoes transporte] decisoes indisponiveis.', error?.message || error);
  }
  return mapa;
}

// Saldo autorizado por chave (CT-e ou NF), somando se houver mais de uma.
// Retorna Map<chaveSoDigitos, valor>. Falha aqui nunca pode travar a auditoria.
export async function carregarSaldosAutorizadosPorChave(chaves = []) {
  const mapa = new Map();
  if (!isSupabaseConfigured()) return mapa;
  const unicas = [...new Set(chaves.map(soDigitos).filter(Boolean))];
  const client = getSupabaseClient();
  try {
    for (let inicio = 0; inicio < unicas.length; inicio += 150) {
      const lote = unicas.slice(inicio, inicio + 150).join(',');
      const { data, error } = await client.from(TABELA)
        .select('chave_cte, chave_nfe, valor_autorizado')
        .eq('ativo', true).eq('status', 'AUTORIZADA')
        .or(`chave_cte.in.(${lote}),chave_nfe.in.(${lote})`);
      if (error) throw error;
      (data || []).forEach((row) => {
        const chave = row.chave_cte && unicas.includes(row.chave_cte) ? row.chave_cte : row.chave_nfe;
        if (chave) mapa.set(chave, numero(mapa.get(chave)) + numero(row.valor_autorizado));
      });
    }
  } catch (error) {
    console.warn('[Autorizacoes transporte] saldos indisponiveis; seguindo sem eles.', error?.message || error);
  }
  return mapa;
}
