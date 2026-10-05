import test from 'node:test';
import assert from 'node:assert/strict';

import { escolherMelhorTabela, expandirTabelasAlternativasOficiais, aplicarVigenciaNoGrupo, calcularCtePelaTabelaLotacao } from '../src/services/auditoriaCteProcessamentoService.js';

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
