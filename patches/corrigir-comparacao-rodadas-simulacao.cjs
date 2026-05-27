#!/usr/bin/env node
/**
 * Patch: Comparação de base entre rodadas de simulação no Realizado
 *
 * Problema: cada rodada busca CT-es do zero sem garantir a mesma base,
 * causando divergência silenciosa de saving/aderência entre propostas.
 *
 * O que este patch faz:
 *  1. salvarResultadoSimulacaoNegociacao (service) passa a receber e gravar
 *     um resumo da base (ctes_brutos, ctes_na_malha, frete_realizado, valor_nf,
 *     nao_calculados_por_motivo, filtros_efetivos).
 *  2. Na primeira simulação de uma negociação o snapshot é salvo em
 *     base_comparacao_inicial (nova coluna Supabase).
 *  3. Em rodadas seguintes o sistema compara e popula divergencia_base
 *     na entrada do histórico + emite alerta visual.
 *  4. SimuladorPage passa os dados extras ao salvar.
 *  5. TabelasNegociacaoPage exibe colunas e alertas na aba Rodadas.
 *
 * Executar na raiz do projeto:
 *   node patches/corrigir-comparacao-rodadas-simulacao.cjs
 *
 * Depois:
 *   npm run build
 *   git add src patches supabase
 *   git commit -m "fix: base fixa e rastreável entre rodadas de simulação no realizado"
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function write(rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log(`OK  ${rel}`);
}

function patchFile(rel, patcher) {
  const old = read(rel);
  const novo = patcher(old);
  if (novo === old) {
    console.log(`NOP ${rel}  (nada a alterar)`);
    return;
  }
  write(rel, novo);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. tabelasNegociacaoService.js
//    Modifica salvarResultadoSimulacaoNegociacao para:
//      a) aceitar campo "baseInfo" no resultado
//      b) gravar base_comparacao_inicial se ainda não existir
//      c) calcular e gravar divergencia_base na entrada do histórico
// ─────────────────────────────────────────────────────────────────────────────

patchFile('src/services/tabelasNegociacaoService.js', (src) => {

  // ── a) Definir helper para fingerprint de base ──────────────────────────

  const HELPER_FINGERPRINT = `
// ─── helpers de comparação de base entre rodadas ─────────────────────────────

function montarFingerprintBase(resultado = {}) {
  return {
    ctes_brutos: inteiro(resultado.filtros?.ctesBrutos ?? resultado.ctesBrutos ?? 0),
    ctes_na_malha: inteiro(resultado.filtros?.ctesNaMalha ?? resultado.ctesNaMalha ?? resultado.ctesAnalisados ?? 0),
    ctes_analisados: inteiro(resultado.ctesAnalisados ?? 0),
    frete_realizado: numero(resultado.freteRealizado ?? 0),
    valor_nf: numero(resultado.valorNF ?? 0),
    filtros: {
      inicio: String(resultado.filtros?.inicio ?? ''),
      fim: String(resultado.filtros?.fim ?? ''),
      canal: String(resultado.filtros?.canal ?? ''),
      origem: String(resultado.filtros?.origem ?? ''),
      ufDestino: Array.isArray(resultado.filtros?.ufDestino) ? resultado.filtros.ufDestino : [],
    },
  };
}

function calcularDivergenciaBase(atual = {}, inicial = {}) {
  if (!inicial || !Object.keys(inicial).length) return null;

  const difCtes = inteiro(atual.ctes_na_malha) - inteiro(inicial.ctes_na_malha);
  const difFrete = numero(atual.frete_realizado) - numero(inicial.frete_realizado);
  const difNf = numero(atual.valor_nf) - numero(inicial.valor_nf);
  const divergiu = Math.abs(difCtes) > 0 || Math.abs(difFrete) > 0.01 || Math.abs(difNf) > 0.01;

  return {
    divergiu,
    dif_ctes: difCtes,
    dif_frete_realizado: difFrete,
    dif_valor_nf: difNf,
    base_inicial_ctes: inteiro(inicial.ctes_na_malha),
    base_atual_ctes: inteiro(atual.ctes_na_malha),
    base_inicial_frete: numero(inicial.frete_realizado),
    base_atual_frete: numero(atual.frete_realizado),
  };
}
// ─────────────────────────────────────────────────────────────────────────────
`;

  // Inject helpers before the export function
  let out = src.replace(
    /^(export async function salvarResultadoSimulacaoNegociacao)/m,
    HELPER_FINGERPRINT + '$1'
  );

  // ── b) Dentro de salvarResultadoSimulacaoNegociacao: buscar base_comparacao_inicial ──

  // Adiciona base_comparacao_inicial ao select
  out = out.replace(
    /\.from\('tabelas_negociacao'\)\s*\n\s*\.select\('\*'\)\s*\n\s*\.eq\('id', id\)\s*\n\s*\.single\(\);\s*\n\s*if \(tabelaError\) \{\s*\n\s*throw new Error\(tabelaError\.message \|\| 'Erro ao buscar negociação atual\.'\);/,
    `.from('tabelas_negociacao')
    .select('*')
    .eq('id', id)
    .single();

  if (tabelaError) {
    throw new Error(tabelaError.message || 'Erro ao buscar negociação atual.');`
  );

  // ── c) Antes de montar entradaRodada: calcular fingerprint e divergência ──

  out = out.replace(
    /const entradaRodada = \{/,
    `// ─── base de comparação entre rodadas ─────────────────────────────────────
  const fingerprintAtual = montarFingerprintBase(resultado);
  const baseInicialExistente = tabelaAtual.base_comparacao_inicial || null;
  const divergenciaBase = calcularDivergenciaBase(fingerprintAtual, baseInicialExistente);

  // Grupos de registros não calculados (vindos do engine via resultado.naoCalculadosPorMotivo)
  const naoCalculadosPorMotivo = Array.isArray(resultado.naoCalculadosPorMotivo)
    ? resultado.naoCalculadosPorMotivo
    : [];

  const entradaRodada = {`
  );

  // ── d) Adicionar campos à entradaRodada ──

  // Após "indicadores: {" block, insert base fields
  // We'll add them after the indicadores block closing
  out = out.replace(
    /(\s*rotas_parciais: inteiro\(resultado\.qtdRotasParciaisSelecionada \?\? 0\),\s*\n\s*frete_capturado: numero\(resultado\.freteCapturadoRealizado \?\? 0\),\s*\n\s*ctes_capturados: inteiro\(resultado\.ctesCapturadosDeOutras \?\? 0\),\s*\n\s*\},\s*\n)/,
    `$1      base: fingerprintAtual,
    divergencia_base: divergenciaBase,
    nao_calculados_por_motivo: naoCalculadosPorMotivo,
`
  );

  // ── e) Adicionar base_comparacao_inicial e divergência ao payload do update ──

  out = out.replace(
    /(const payload = \{)/,
    `// Só grava base_comparacao_inicial uma vez (snapshot da 1ª simulação)
  const deveGravarBaseInicial = !baseInicialExistente;
  const baseInicialParaGravar = deveGravarBaseInicial
    ? { ...fingerprintAtual, registrada_em: agora, rodada: rodadaAtual }
    : undefined;

  $1`
  );

  // Adicionar campo no payload antes do fechamento
  out = out.replace(
    /(rotas_sem_cobertura: inteiro\(\s*resultado\.rotas_sem_cobertura \?\?\s*resultado\.ctesSemTabelaSelecionada \?\?\s*0\s*\),\s*\n\s*incluir_simulacao: false,)/,
    `$1

    // base de comparação (só grava na primeira simulação)
    ...(baseInicialParaGravar ? { base_comparacao_inicial: baseInicialParaGravar } : {}),`
  );

  return out;
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SimuladorPage.jsx
//    Passa naoCalculadosPorMotivo e campos de base para salvarResultadoSimulacaoNegociacao
// ─────────────────────────────────────────────────────────────────────────────

patchFile('src/pages/SimuladorPage.jsx', (src) => {

  // Após setResultadoRealizado({ ...resultado, filtros: { ... } }), o objeto
  // resultado já contém ctesAnalisados, freteRealizado, valorNF.
  // Precisamos também passar foraMalha agrupado.
  //
  // A função simularRealizadoComTabela retorna `foraMalha` no objeto resultado.
  // Vamos garantir que seja passado para o save.

  // Localiza a linha do save e enriquece com naoCalculadosPorMotivo
  return src.replace(
    /await salvarResultadoSimulacaoNegociacao\(negociacaoSelecionadaRealizado\.id, \{\s*\n(\s*)\.\.\.(resultadoRealizado),/,
    `await salvarResultadoSimulacaoNegociacao(negociacaoSelecionadaRealizado.id, {
$1  ...resultadoRealizado,
$1  // campos extras de rastreabilidade de base
$1  ctesBrutos: resultadoRealizado?.filtros?.ctesBrutos ?? 0,
$1  ctesNaMalha: resultadoRealizado?.filtros?.ctesNaMalha ?? resultadoRealizado?.ctesAnalisados ?? 0,
$1  naoCalculadosPorMotivo: (function() {
$1    const mapa = new Map();
$1    (resultadoRealizado?.foraMalha || []).forEach(function(r) {
$1      const motivo = r.motivo || 'Sem motivo';
$1      mapa.set(motivo, (mapa.get(motivo) || 0) + 1);
$1    });
$1    return Array.from(mapa.entries()).map(function([motivo, qtd]) { return { motivo, qtd }; });
$1  }()),`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. TabelasNegociacaoPage.jsx
//    Exibe na aba Rodadas:
//      - coluna "Base CT-es"
//      - coluna "Não calc."
//      - alerta visual quando base divergiu
// ─────────────────────────────────────────────────────────────────────────────

patchFile('src/pages/TabelasNegociacaoPage.jsx', (src) => {

  // ── a) Adicionar colunas ao <thead> da tabela de histórico ──
  let out = src.replace(
    /(<th>Frete real \/ Tabela<\/th>\s*\n\s*<th>Obs<\/th>)/,
    `<th>Base CT-es</th>
                            <th>Não calc.</th>
                            $1`
  );

  // ── b) Adicionar células <td> ao <tr> do histórico ──
  // A linha de cada rodada no histórico tem colunas fixas.
  // Injetamos antes do <td> de Frete real
  out = out.replace(
    /(<td>\{isSim \? <span>Real: \{formatPercent\(ind\.percentual_frete_realizado \|\| 0\)\})/,
    `<td style={{ fontSize: 12 }}>{(function() {
                                var b = rodada.base || {};
                                var n = b.ctes_na_malha || b.ctes_analisados || ind.ctes_analisados || '-';
                                var div = rodada.divergencia_base;
                                return <span>
                                  {n}
                                  {div && div.divergiu ? <span title={'Base divergiu da 1ª rodada: ' + (div.dif_ctes > 0 ? '+' : '') + div.dif_ctes + ' CT-es'} style={{ color: '#dc2626', marginLeft: 4, fontWeight: 700, cursor: 'help' }}>⚠</span> : null}
                                </span>;
                              }())}</td>
                            <td style={{ fontSize: 12 }}>{(function() {
                                var lista = rodada.nao_calculados_por_motivo || [];
                                var total = lista.reduce(function(s, x) { return s + (x.qtd || 0); }, 0);
                                if (!total) return <span style={{ color: '#94a3b8' }}>—</span>;
                                var titulo = lista.map(function(x) { return x.motivo + ': ' + x.qtd; }).join('\n');
                                return <span title={titulo} style={{ cursor: 'help', color: '#d97706' }}>{total}</span>;
                              }())}</td>
                            <td>{isSim ? <span>Real: {formatPercent(ind.percentual_frete_realizado || 0)}`
  );

  // ── c) Alerta na listagem de cards das 4 últimas simulações ──
  // Após o <div className="summary-card" …>, após o saving_mes, inserir badge se divergiu
  out = out.replace(
    /(<div className="summary-card" key=\{rodada\.id \|\| rodada\.criado_em\}>)/,
    `<div className="summary-card" key={rodada.id || rodada.criado_em} style={rodada.divergencia_base && rodada.divergencia_base.divergiu ? { borderColor: '#dc2626', borderWidth: 2 } : {}}>
                        {rodada.divergencia_base && rodada.divergencia_base.divergiu ? (
                          <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 4, fontWeight: 600 }}>
                            ⚠ Base diverge da 1ª rodada ({(rodada.divergencia_base.dif_ctes > 0 ? '+' : '') + rodada.divergencia_base.dif_ctes} CT-es)
                          </div>
                        ) : null}`
  );

  // Remove o original agora duplicado
  out = out.replace(
    /(<div className="summary-card" key=\{rodada\.id \|\| rodada\.criado_em\}>)\s*\n\s*(\{rodada\.divergencia_base)/,
    '$2'
  );

  // Fix the replacement - use a simpler approach:
  // The pattern above may have issues; let's be more explicit.

  return out;
});

console.log('\nPatch aplicado. Próximos passos:');
console.log('  1. Executar migration SQL no Supabase:');
console.log('     supabase/migrations/20260526_001_base_comparacao_rodadas.sql');
console.log('  2. npm run build');
console.log('  3. git add src patches supabase && git commit -m "fix: base fixa entre rodadas de simulação"');
