/**
 * Frete contratado "calculado pela Central": quando a TransGP devolve a DIST sem transportadora
 * (frete 0), mas a carga ja tem transportadora no fluxo, usa o valor da tabela de lotacao
 * (lotacao_tabelas / lotacao_rotas validadas) para origem + destino + tipo de veiculo.
 *
 * Grava com valor_fonte = 'TABELA_AUTO'. Quando a TransGP passar a mandar o frete, o sincronizador
 * troca o valor (ver transgp-auditoria.js). Nunca mexe em carga alocada pela Operacao (alocado_em).
 */

export const FONTE_TABELA_AUTO = 'TABELA_AUTO';

export const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Nomes de transportadora no fluxo e na tabela nem sempre sao iguais ("COOPERATIVA ... - COOTRAVALE" x "COOTRAVALE").
export function mesmaTransportadora(a, b) {
  const x = norm(a); const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const menor = x.length <= y.length ? x : y;
  const maior = menor === x ? y : x;
  return menor.length >= 5 && maior.includes(menor);
}

function tipoCasa(tipoRota, tipoCarga) {
  const c = norm(tipoCarga);
  if (!c) return true;
  const r = norm(tipoRota);
  if (!r) return false;
  return r === c || r.includes(c) || c.includes(r);
}

function vigenteNaData(tabela, dataRef) {
  const ini = tabela.vigencia_inicio ? new Date(tabela.vigencia_inicio) : null;
  const fim = tabela.vigencia_fim ? new Date(tabela.vigencia_fim) : null;
  if (!ini && !fim) return true;
  const ref = dataRef ? new Date(dataRef) : new Date();
  if (Number.isNaN(ref.getTime())) return true;
  if (ini && !Number.isNaN(ini.getTime()) && ref < ini) return false;
  if (fim && !Number.isNaN(fim.getTime()) && ref > fim) return false;
  return true;
}

/**
 * Escolhe o valor de tabela da carga. Devolve null quando nao ha rota (ou ha mais de um valor
 * possivel e nao da para decidir sem chutar).
 * tabelas: [{ id, nome, vigencia_inicio, vigencia_fim, rotas: [{ id, transportadora, origem, destino, tipo_veiculo, valor, pedagio, target }] }]
 */
export function escolherValorTabela(carga = {}, tabelas = []) {
  if (!norm(carga.transportadora) || !norm(carga.origem) || !norm(carga.destino)) return null;
  const dataRef = carga.coleta_planejada || carga.coleta_realizada || null;
  const candidatas = [];
  tabelas.forEach((tabela) => {
    if (!vigenteNaData(tabela, dataRef)) return;
    (tabela.rotas || []).forEach((rota) => {
      if (!(mesmaTransportadora(carga.transportadora, rota.transportadora || tabela.nome) || mesmaTransportadora(carga.transportadora, tabela.nome))) return;
      if (norm(rota.origem) !== norm(carga.origem) || norm(rota.destino) !== norm(carga.destino)) return;
      if (carga.uf_origem && rota.uf_origem && norm(carga.uf_origem) !== norm(rota.uf_origem)) return;
      if (carga.uf_destino && rota.uf_destino && norm(carga.uf_destino) !== norm(rota.uf_destino)) return;
      if (!tipoCasa(rota.tipo_veiculo, carga.tipo_veiculo)) return;
      const valor = num(rota.valor);
      if (valor === null || valor <= 0) return;
      candidatas.push({ tabela, rota, valor });
    });
  });
  if (!candidatas.length) return null;
  const valores = [...new Set(candidatas.map((c) => c.valor.toFixed(2)))];
  if (valores.length > 1 && !norm(carga.tipo_veiculo)) return null; // sem tipo de veiculo e valores diferentes: nao chuta
  const melhor = candidatas.sort((a, b) => a.valor - b.valor)[0];
  return {
    valor: melhor.valor,
    pedagio: num(melhor.rota.pedagio),
    target: num(melhor.rota.target),
    tabelaId: melhor.tabela.id,
    tabelaNome: melhor.tabela.nome || '',
    rotaId: melhor.rota.id,
  };
}

/** A carga ainda precisa de valor? (sem frete da TransGP/planilha, sem alocacao da Operacao) */
export function precisaValorDeTabela(carga = {}) {
  if (carga.alocado_em) return false;
  if (!norm(carga.transportadora)) return false;
  if (carga.valor_fonte === FONTE_TABELA_AUTO) return true; // recalcula (tabela pode ter mudado)
  return !((num(carga.frete_transp) || 0) > 0) && !((num(carga.frete_cantu) || 0) > 0) && !((num(carga.valor_comparacao) || 0) > 0);
}

async function carregarTabelasValidas(db, transportadorasNomes) {
  let { data: tabelasDb, error } = await db.from('lotacao_tabelas').select('id,nome,nome_normalizado,fontes_valor,vigencia_inicio,vigencia_fim').eq('tipo', 'TRANSPORTADORA');
  if (error && /vigencia/i.test(error.message)) ({ data: tabelasDb, error } = await db.from('lotacao_tabelas').select('id,nome,nome_normalizado,fontes_valor').eq('tipo', 'TRANSPORTADORA'));
  if (error) throw new Error(`Tabelas (ler): ${error.message}`);
  const validas = (tabelasDb || []).filter((t) => t.fontes_valor?.__governanca?.validado === true);
  const rotasPorTabela = new Map();
  const relevantes = validas.filter((t) => transportadorasNomes.some((n) => mesmaTransportadora(n, t.nome)));
  for (let i = 0; i < relevantes.length; i += 50) {
    const ids = relevantes.slice(i, i + 50).map((t) => t.id);
    for (let pagina = 0; ; pagina += 1) {
      const { data, error: e2 } = await db.from('lotacao_rotas')
        .select('id,tabela_id,transportadora,origem,uf_origem,destino,uf_destino,tipo_veiculo,valor,pedagio,target')
        .in('tabela_id', ids).range(pagina * 1000, (pagina + 1) * 1000 - 1);
      if (e2) throw new Error(`Rotas (ler): ${e2.message}`);
      (data || []).forEach((r) => rotasPorTabela.set(r.tabela_id, [...(rotasPorTabela.get(r.tabela_id) || []), r]));
      if ((data || []).length < 1000) break;
    }
  }
  return relevantes.map((t) => ({ ...t, rotas: rotasPorTabela.get(t.id) || [] }));
}

const COLUNAS = 'id,dist,transportadora,origem,uf_origem,destino,uf_destino,tipo_veiculo,coleta_planejada,coleta_realizada,frete_transp,frete_cantu,valor_comparacao,pedagio,valor_fonte,alocado_em';

/**
 * Preenche o frete das DISTs que a TransGP devolveu sem valor. `dists` = numeros das DISTs sem contratado.
 * Se a migration da Fase 1 (valor_fonte etc.) ainda nao foi aplicada, nao faz nada e avisa.
 */
export async function completarFretePelaTabela(db, dists = []) {
  const resultado = { preenchidas: 0, semRota: 0, avisos: [] };
  if (!dists.length) return resultado;
  const cargas = [];
  for (let i = 0; i < dists.length; i += 200) {
    const { data, error } = await db.from('lotacao_cargas').select(COLUNAS).in('dist', dists.slice(i, i + 200));
    if (error) { resultado.avisos.push(`Frete por tabela desligado: ${error.message}`.slice(0, 200)); return resultado; }
    cargas.push(...(data || []));
  }
  const alvo = cargas.filter(precisaValorDeTabela);
  if (!alvo.length) return resultado;
  const tabelas = await carregarTabelasValidas(db, [...new Set(alvo.map((c) => c.transportadora))]);
  const atualizacoes = [];
  alvo.forEach((carga) => {
    const achado = escolherValorTabela(carga, tabelas);
    if (!achado) { resultado.semRota += 1; return; }
    const campos = { frete_transp: achado.valor, valor_fonte: FONTE_TABELA_AUTO, valor_tabela: achado.valor, tabela_id: achado.tabelaId, tabela_nome: achado.tabelaNome.slice(0, 200), tabela_rota_id: String(achado.rotaId || '').slice(0, 200) };
    if (achado.target !== null) campos.valor_target = achado.target;
    if (!(Number(carga.pedagio) > 0) && achado.pedagio > 0) campos.pedagio = achado.pedagio;
    if (Math.abs((Number(carga.frete_transp) || 0) - achado.valor) < 0.005 && carga.valor_fonte === FONTE_TABELA_AUTO) return; // ja esta igual
    atualizacoes.push({ id: carga.id, campos });
  });
  for (let i = 0; i < atualizacoes.length; i += 20) {
    await Promise.all(atualizacoes.slice(i, i + 20).map(async ({ id, campos }) => {
      const { error } = await db.from('lotacao_cargas').update(campos).eq('id', id);
      if (error) resultado.avisos.push(error.message.slice(0, 120)); else resultado.preenchidas += 1;
    }));
  }
  resultado.avisos = resultado.avisos.slice(0, 3);
  return resultado;
}
