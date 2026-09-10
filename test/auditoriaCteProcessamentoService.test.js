import test from 'node:test';
import assert from 'node:assert/strict';

import { escolherMelhorTabela, expandirTabelasAlternativasOficiais } from '../src/services/auditoriaCteProcessamentoService.js';

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
