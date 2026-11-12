import test from 'node:test';
import assert from 'node:assert/strict';

import { escolherMelhorTabela, expandirTabelasAlternativasOficiais, aplicarVigenciaNoGrupo, calcularCtePelaTabelaLotacao, processarCte, motivoTransferenciaCte, normalizarTransportadoras } from '../src/services/auditoriaCteProcessamentoService.js';
import { montarCorrecoesCalculoFatura } from '../src/utils/correcoesCalculoFatura.js';

const contextoLotacao = (totalOrigensFracionado = 0) => ({
  tabelas: [{
    id: 'lotacao-scapini',
    nome: 'SCAPINI TRANSPORTE E LOGISTICA LTDA',
    rotas: [{
      origem: 'Itupeva',
      uf_origem: 'SP',
      destino: 'Goiania',
      uf_destino: 'GO',
      tipo_veiculo: 'CARRETA',
      valor: 7207.5,
    }],
  }],
  origensFracionadoPorNome: new Map([['scapini e', totalOrigensFracionado]]),
});

const cteLotacao = (overrides = {}) => ({
  transportadora: 'SCAPINI TRANSPORTE E LOGISTICA LTDA',
  cidade_origem: 'ITUPEVA',
  uf_origem: 'SP',
  cidade_destino: 'GOIÂNIA',
  uf_destino: 'GO',
  canal: 'B2C',
  valor_cte: 7500,
  ...overrides,
});

test('Lotação exclusiva ignora o canal B2C e calcula pela tabela vinculada', () => {
  const resultado = calcularCtePelaTabelaLotacao(cteLotacao(), contextoLotacao(0));
  assert.equal(resultado.tipo_calculo, 'LOTACAO');
  assert.equal(resultado.status_calculo, 'CALCULADO');
  assert.equal(resultado.valor_calculado, 7207.5);
});

test('transportadora mista usa fracionado no B2C e Lotação no INTERCOMPANY', () => {
  assert.equal(calcularCtePelaTabelaLotacao(cteLotacao(), contextoLotacao(2)), null);
  const resultado = calcularCtePelaTabelaLotacao(cteLotacao({ canal: 'INTERCOMPANY' }), contextoLotacao(2));
  assert.equal(resultado.tipo_calculo, 'LOTACAO');
  assert.equal(resultado.valor_calculado, 7207.5);
});

test('Lotação identificada informa claramente quando a rota não existe', () => {
  const resultado = calcularCtePelaTabelaLotacao(cteLotacao({ cidade_destino: 'UBERLANDIA', uf_destino: 'MG' }), contextoLotacao(0));
  assert.equal(resultado.status_calculo, 'SEM_ROTA_LOTACAO');
  assert.match(resultado.motivo_sem_calculo, /não cadastrada/i);
});

test('escolherMelhorTabela escolhe o candidato com menor divergência absoluta do valor pago no CT-e', () => {
  const candidatos = [
    { tabelaId: 'principal', variante: 'Principal', valorCalculado: 100 },
    { tabelaId: 'otr', variante: 'OTR / Fora de estrada', valorCalculado: 142 },
    { tabelaId: 'rodas', variante: 'Rodas', valorCalculado: 138 },
  ];

  const melhor = escolherMelhorTabela(candidatos, 140);
  assert.equal(melhor.tabelaId, 'otr', 'deve escolher a tabela cujo valor calculado fica mais perto do valor pago');
  assert.ok(Math.abs(melhor.divergencia - 2) < 1e-9);
});

test('escolherMelhorTabela ignora candidatos sem valor calculado válido', () => {
  const candidatos = [
    { tabelaId: 'sem-cotacao', variante: 'Rodas', valorCalculado: 0 },
    { tabelaId: 'principal', variante: 'Principal', valorCalculado: 100 },
  ];
  const melhor = escolherMelhorTabela(candidatos, 100);
  assert.equal(melhor.tabelaId, 'principal');
});

test('escolherMelhorTabela retorna null quando não há candidatos calculáveis (caso de uma única tabela não muda nada)', () => {
  assert.equal(escolherMelhorTabela([], 100), null);
  assert.equal(escolherMelhorTabela([{ tabelaId: 'x', valorCalculado: 0 }], 100), null);
});

test('escolherMelhorTabela com um único candidato válido sempre o retorna (comportamento de tabela única preservado)', () => {
  const candidatos = [{ tabelaId: 'unica', variante: 'Principal', valorCalculado: 250 }];
  const melhor = escolherMelhorTabela(candidatos, 999);
  assert.equal(melhor.tabelaId, 'unica');
});

// ─── expandirTabelasAlternativasOficiais (rotas/cotacoes, estrutura oficial) ───

function origemBase(overrides = {}) {
  return {
    id: 'origem-1',
    cidade: 'Serra',
    canal: 'ATACADO',
    rotas: [
      { id: 'r1', nomeRota: 'Vitoria', ibgeOrigem: '3205002', ibgeDestino: '3205309', grupoTabelaAlternativa: null },
      { id: 'r2', nomeRota: 'Vitoria', ibgeOrigem: '3205002', ibgeDestino: '3205309', grupoTabelaAlternativa: 'OTR / Fora de estrada' },
    ],
    cotacoes: [
      { id: 'c1', rota: 'Vitoria', pesoMin: 0, pesoMax: 100, valorFixo: 100, grupoTabelaAlternativa: null },
      { id: 'c2', rota: 'Vitoria', pesoMin: 0, pesoMax: 100, valorFixo: 180, grupoTabelaAlternativa: 'OTR / Fora de estrada' },
    ],
    ...overrides,
  };
}

test('expandirTabelasAlternativasOficiais não altera transportadoras sem grupo alternativo (sem regressão)', () => {
  const transportadoras = [
    {
      id: 't1',
      nome: 'Transportadora X',
      origens: [
        {
          id: 'origem-1',
          cidade: 'Serra',
          rotas: [{ id: 'r1', nomeRota: 'Vitoria', grupoTabelaAlternativa: null }],
          cotacoes: [{ id: 'c1', rota: 'Vitoria', valorFixo: 100, grupoTabelaAlternativa: null }],
        },
      ],
    },
  ];

  const expandido = expandirTabelasAlternativasOficiais(transportadoras);
  assert.equal(expandido.length, 1, 'sem grupo alternativo cadastrado, não deve gerar entradas sintéticas');
  assert.equal(expandido[0].origens[0].rotas.length, 1);
  assert.equal(expandido[0].origens[0].cotacoes.length, 1);
});

test('expandirTabelasAlternativasOficiais gera uma entrada sintética por grupo e filtra a principal', () => {
  const transportadoras = [
    { id: 't1', nome: 'Transportadora X', origens: [origemBase()] },
  ];

  const expandido = expandirTabelasAlternativasOficiais(transportadoras);
  assert.equal(expandido.length, 2, 'deve gerar 1 entrada principal + 1 entrada sintética pro grupo OTR');

  const principal = expandido.find((t) => !t.tabelaAlternativaDe);
  const alternativa = expandido.find((t) => t.tabelaAlternativaDe);

  assert.ok(principal, 'entrada principal deve existir');
  assert.ok(alternativa, 'entrada alternativa deve existir');
  assert.equal(alternativa.varianteTabela, 'OTR / Fora de estrada');
  assert.equal(alternativa.nome, 'Transportadora X', 'mesma transportadora, pra agrupar pelo nome');

  // Principal só deve ver as linhas sem grupo (comportamento igual ao de hoje).
  assert.equal(principal.origens[0].rotas.length, 1);
  assert.equal(principal.origens[0].rotas[0].id, 'r1');
  assert.equal(principal.origens[0].cotacoes[0].valorFixo, 100);

  // Alternativa só deve ver as linhas do grupo dela.
  assert.equal(alternativa.origens[0].rotas.length, 1);
  assert.equal(alternativa.origens[0].rotas[0].id, 'r2');
  assert.equal(alternativa.origens[0].cotacoes[0].valorFixo, 180);
});

test('aplicarVigenciaNoGrupo: reajuste em vigor substitui a principal pela data de emissão', () => {
  const principal = { id: 'p', nome: 'FLORESTA' };
  const reajuste = { id: 'r', nome: 'FLORESTA', tabelaAlternativaDe: 'p', vigenciaInicio: '2026-10-01', vigenciaFim: '' };
  const antes = aplicarVigenciaNoGrupo([principal, reajuste], '2026-09-30');
  assert.deepEqual(antes.entradas.map((e) => e.id), ['p']);
  assert.equal(antes.porVigencia, false);
  const depois = aplicarVigenciaNoGrupo([principal, reajuste], '2026-10-01');
  assert.deepEqual(depois.entradas.map((e) => e.id), ['r']);
  assert.equal(depois.porVigencia, true);
});

test('aplicarVigenciaNoGrupo: sem vigência ou sem data de emissão mantém o comportamento anterior', () => {
  const principal = { id: 'p', nome: 'X' };
  const otr = { id: 'o', nome: 'X', tabelaAlternativaDe: 'p' };
  assert.deepEqual(aplicarVigenciaNoGrupo([principal, otr], '2026-10-01').entradas.map((e) => e.id), ['p', 'o']);
  const reajuste = { id: 'r', nome: 'X', tabelaAlternativaDe: 'p', vigenciaInicio: '2026-10-01' };
  assert.equal(aplicarVigenciaNoGrupo([principal, reajuste], '').entradas.length, 2);
});

test('aplicarVigenciaNoGrupo: reajuste vencido sai e o mais recente vence; alternativa comum continua concorrendo', () => {
  const principal = { id: 'p', nome: 'X' };
  const otr = { id: 'o', nome: 'X', tabelaAlternativaDe: 'p' };
  const r1 = { id: 'r1', nome: 'X', tabelaAlternativaDe: 'p', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-09-30' };
  const r2 = { id: 'r2', nome: 'X', tabelaAlternativaDe: 'p', vigenciaInicio: '2026-10-01' };
  const r = aplicarVigenciaNoGrupo([principal, otr, r1, r2], '2026-11-05');
  assert.deepEqual(r.entradas.map((e) => e.id), ['r2', 'o']);
});

test('expandirTabelasAlternativasOficiais propaga a vigência do grupo para a entrada alternativa', () => {
  const base = [{
    id: 't1', nome: 'FLORESTA',
    origens: [{
      id: 'o1', cidade: 'X', rotas: [{ id: 'r1', grupoTabelaAlternativa: 'Reajuste 10/2026' }], cotacoes: [], taxasEspeciais: [],
      vigenciasAlternativas: { 'Reajuste 10/2026': { inicio: '2026-10-01', fim: '' } },
    }],
  }];
  const expandido = expandirTabelasAlternativasOficiais(base);
  const alt = expandido.find((e) => e.tabelaAlternativaDe);
  assert.equal(alt.vigenciaInicio, '2026-10-01');
});

// ─── Transferência entre unidades do grupo (tabela alternativa TRANSFERENCIA) ───
// Ex.: CSRG cobra 0,8% sobre a NF quando a CPX transfere para uma unidade do grupo.

const generalidadeTransf = { incideIcms: false, aliquotaIcms: 0, adValorem: 0, adValoremMinimo: 0, pedagio: 0, gris: 0, grisMinimo: 0, tas: 0, ctrc: 0, cubagem: 300, tipoCalculo: 'FAIXA_DE_PESO', freteMinimo: 0, regraCalculo: '', taxaEmergencial: 0 };
const rotaTransf = (grupo) => ({ id: `r-${grupo || 'principal'}`, nomeRota: 'Capital', ibgeOrigem: '2607901', ibgeDestino: '2611606', canal: 'ATACADO', prazoEntregaDias: 1, valorMinimoFrete: 0, grupoTabelaAlternativa: grupo });
const cotacaoPrincipalTransf = { id: 'c-principal', rota: 'Capital', pesoMin: 0, pesoMax: 99999, rsKg: 0, excesso: 0, percentual: 0, valorFixo: 500, grupoTabelaAlternativa: null };
const cotacaoTransf = { id: 'c-transf', rota: 'Capital', pesoMin: 0, pesoMax: 99999999, rsKg: 0, excesso: 0, percentual: 0.8, valorFixo: 0, grupoTabelaAlternativa: 'TRANSFERENCIA', tipoCalculo: 'PERCENTUAL', regraCalculo: 'Maior valor', freteMinimo: '0' };

function baseTransferencia({ comTabelaTransferencia = true } = {}) {
  return normalizarTransportadoras(expandirTabelasAlternativasOficiais([{
    id: 'csrg',
    nome: 'CSRG TRANSPORTES LTDA',
    cnpj: '46811890000112',
    origens: [{
      id: 'o-jaboatao',
      cidade: 'Jaboatão dos Guararapes',
      canal: 'ATACADO',
      cnpjRaiz: '46811890',
      generalidades: generalidadeTransf,
      generalidadesAlternativas: comTabelaTransferencia ? [{ ...generalidadeTransf, tipoCalculo: 'PERCENTUAL', grupoTabelaAlternativa: 'TRANSFERENCIA' }] : [],
      vigenciasAlternativas: {},
      rotas: comTabelaTransferencia ? [rotaTransf(null), rotaTransf('TRANSFERENCIA')] : [rotaTransf(null)],
      cotacoes: comTabelaTransferencia ? [cotacaoPrincipalTransf, cotacaoTransf] : [cotacaoPrincipalTransf],
      taxasEspeciais: [],
    }],
  }]));
}

const CNPJ_CPX = '10158356001930';
const CNPJ_CPX_OUTRA = '10158356000110';
const CNPJ_ITR = '15426874000100';
const CNPJ_CLIENTE = '99888777000100';

const cteTransferencia = (remetente, destinatario, extra = {}) => ({
  transportadora: 'CSRG TRANSPORTES LTDA',
  cnpj_transportadora: '46811890000112',
  cidade_origem: 'JABOATAO DOS GUARARAPES',
  uf_origem: 'PE',
  ibge_origem: '2607901',
  cidade_destino: 'RECIFE',
  uf_destino: 'PE',
  ibge_destino: '2611606',
  canal: 'ATACADO',
  peso: 100,
  valor_nf: 10000,
  valor_cte: 80,
  documento_remetente: remetente,
  documento_destinatario: destinatario,
  data_emissao: '2026-10-21',
  ...extra,
});

const calcularTransf = (cte, base = baseTransferencia()) => processarCte(cte, base, null, '', { ignorarCubagem: true });

test('transferência: CPX -> CPX usa a tabela TRANSFERENCIA automaticamente', () => {
  const r = calcularTransf(cteTransferencia(CNPJ_CPX, CNPJ_CPX_OUTRA));
  assert.equal(r.valor_calculado, 80);
  assert.equal(r.detalhes_calculo.transferencia_entre_unidades, true);
  assert.equal(r.detalhes_calculo.transferencia_motivo, 'cnpj_grupo');
});

test('transferência: CPX -> ITR (outra empresa do grupo) também é transferência', () => {
  assert.equal(calcularTransf(cteTransferencia(CNPJ_CPX, CNPJ_ITR)).valor_calculado, 80);
});

test('transferência: venda para cliente fica na tabela principal', () => {
  const r = calcularTransf(cteTransferencia(CNPJ_CPX, CNPJ_CLIENTE));
  assert.equal(r.valor_calculado, 500);
  assert.ok(!r.detalhes_calculo.transferencia_entre_unidades);
});

test('transferência: devolução de cliente para a CPX não é transferência', () => {
  assert.equal(calcularTransf(cteTransferencia(CNPJ_CLIENTE, CNPJ_CPX)).valor_calculado, 500);
});

test('transferência: mesma raiz fora do grupo não é transferência', () => {
  assert.equal(calcularTransf(cteTransferencia('11222333000100', '11222333000280')).valor_calculado, 500);
});

test('transferência: sem CNPJ do destinatário, TRANSFERENCIA concorre e vence se for a mais próxima (possível transferência)', () => {
  const r = calcularTransf(cteTransferencia(CNPJ_CPX, ''));
  assert.equal(r.valor_calculado, 80);
  assert.equal(r.detalhes_calculo.possivel_transferencia, true);
  assert.match(r.detalhes_calculo.aviso_transferencia, /Possível transferência/);
});

test('transferência: sem CNPJ do destinatário e cobrança de venda, fica na principal sem aviso', () => {
  const r = calcularTransf(cteTransferencia(CNPJ_CPX, '', { valor_cte: 500 }));
  assert.equal(r.valor_calculado, 500);
  assert.ok(!r.detalhes_calculo.possivel_transferencia);
});

test('transferência: com CNPJ de cliente, TRANSFERENCIA nem concorre (mesmo cobrando 0,8%)', () => {
  const r = calcularTransf(cteTransferencia(CNPJ_CPX, CNPJ_CLIENTE, { valor_cte: 80 }));
  assert.equal(r.valor_calculado, 500);
  assert.ok(!r.detalhes_calculo.possivel_transferencia);
});

test('transferência: sem remetente usa o emissor da chave da NF-e', () => {
  const cte = cteTransferencia('', CNPJ_ITR, { chave_nfe: '26261010158356001930550010006279091458855440' });
  assert.equal(calcularTransf(cte).valor_calculado, 80);
});

test('transferência manual (contingência do auditor) sem CNPJ do destinatário', () => {
  const r = calcularTransf(cteTransferencia(CNPJ_CPX, '', { transferencia_manual: true }));
  assert.equal(r.valor_calculado, 80);
  assert.equal(r.detalhes_calculo.transferencia_motivo, 'manual');
  assert.equal(r.detalhes_calculo.transferencia_manual, true);
});

test('transferência manual sem tabela TRANSFERENCIA cadastrada: principal com aviso', () => {
  const r = calcularTransf(cteTransferencia(CNPJ_CPX, '', { transferencia_manual: true }), baseTransferencia({ comTabelaTransferencia: false }));
  assert.equal(r.valor_calculado, 500);
  assert.match(r.detalhes_calculo.aviso_transferencia, /não tem tabela TRANSFERENCIA/);
});

test('motivoTransferenciaCte exige remetente e destinatário do grupo', () => {
  assert.equal(motivoTransferenciaCte({ documento_remetente: CNPJ_CPX, documento_destinatario: CNPJ_ITR }), 'cnpj_grupo');
  assert.equal(motivoTransferenciaCte({ documento_remetente: CNPJ_CPX, documento_destinatario: CNPJ_CLIENTE }), '');
  assert.equal(motivoTransferenciaCte({ documento_remetente: CNPJ_CLIENTE, documento_destinatario: CNPJ_CPX }), '');
  assert.equal(motivoTransferenciaCte({ transferencia_manual: true }), 'manual');
});

test('montarCorrecoesCalculoFatura leva a marcação manual de transferência para o recálculo', () => {
  const chave = '26261046811890000112570010000251181613632880';
  const { transferenciaPorChave } = montarCorrecoesCalculoFatura([
    { id: 'a', chave_cte: chave, transferencia_manual: true },
    { id: 'b', chave_cte: '26261046811890000112570010000251191613632881', transferencia_manual: false },
  ]);
  assert.deepEqual(Object.keys(transferenciaPorChave), [chave]);
});

// CT-e de transferência real chega SEM peso (não passa pelo Tracking): o motor
// principal não calcula e a contingência precisa aplicar a mesma regra.
test('transferência sem peso e sem CNPJ do destinatário: contingência aplica TRANSFERENCIA como possível', () => {
  const r = calcularTransf(cteTransferencia(CNPJ_CPX, '', { peso: 0 }));
  assert.equal(r.status_calculo, 'CALCULADO');
  assert.equal(r.valor_calculado, 80);
  assert.equal(r.detalhes_calculo.possivel_transferencia, true);
});

test('transferência sem peso marcada pelo auditor: calcula só pela TRANSFERENCIA', () => {
  const r = calcularTransf(cteTransferencia(CNPJ_CPX, '', { peso: 0, valor_cte: 500, transferencia_manual: true }));
  assert.equal(r.valor_calculado, 80);
  assert.equal(r.detalhes_calculo.transferencia_motivo, 'manual');
  assert.ok(!r.detalhes_calculo.possivel_transferencia);
});

test('venda sem peso com CNPJ de cliente: TRANSFERENCIA fora mesmo na contingência', () => {
  const r = calcularTransf(cteTransferencia(CNPJ_CPX, CNPJ_CLIENTE, { peso: 0 }));
  assert.equal(r.valor_calculado, 500);
  assert.ok(!r.detalhes_calculo.possivel_transferencia);
});
