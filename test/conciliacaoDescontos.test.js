import test from 'node:test';
import assert from 'node:assert/strict';
import { conciliarDescontos, montarDescontosEnviados } from '../src/utils/conciliacaoDescontos.js';

test('usa protocolos da auditoria e legado como fonte de descontos enviados', () => {
  const enviados = montarDescontosEnviados([
    { id: 'p1', protocolo: 'FIN-1', numero_fatura: '10', transportadora: 'ABC Transportes Ltda', desconto_total: 50, enviado_em: '2026-09-01T10:00:00Z', ativo: true },
    { id: 'p2', desconto_total: 20, ativo: false },
  ], [{ id: 'l1', numero_fatura: '11', transportadora: 'XPTO', desconto_enviado: 10 }]);
  assert.equal(enviados.length, 2);
  assert.equal(enviados[0].origem, 'PROTOCOLO_AUDITORIA');
  assert.equal(enviados[1].origem, 'PLANILHA_LEGADA');
});

test('concilia por valor, transportadora e janela de data sem reutilizar realizado', () => {
  const enviados = [
    { id: 'e1', transportadora: 'ABC Transportes Ltda', desconto_enviado: 50, data_envio: '2026-09-01' },
    { id: 'e2', transportadora: 'ABC Transportes', desconto_enviado: 50, data_envio: '2026-09-02' },
  ];
  const realizados = [{ id: 'r1', transportadora_nome: 'ABC TRANSPORTES S.A.', valor: 50, data_lancamento: '2026-09-05' }];
  const resultado = conciliarDescontos(enviados, realizados);
  assert.equal(resultado[0].status_conciliacao, 'REALIZADO');
  assert.equal(resultado[0].realizado.id, 'r1');
  assert.equal(resultado[1].status_conciliacao, 'PENDENTE');
});

test('nao concilia somente pelo valor quando a transportadora diverge', () => {
  const [resultado] = conciliarDescontos(
    [{ id: 'e1', transportadora: 'Transportadora Alfa', desconto_enviado: 100, data_envio: '2026-09-01' }],
    [{ id: 'r1', transportadora_nome: 'Transportadora Beta', valor: 100, data_lancamento: '2026-09-03' }],
  );
  assert.equal(resultado.status_conciliacao, 'PENDENTE');
});

test('remove repeticao do mesmo arquivo, fatura e desconto antes da conciliacao', () => {
  const repetido = { id: 'l1', arquivo_origem: 'PROTOCOLO 01-09.xlsx', numero_fatura: '1917782', transportadora: 'EXPRESSO LEOMAR', desconto_enviado: 57.12 };
  const enviados = montarDescontosEnviados([], [repetido, { ...repetido, id: 'l2', linha_hash: 'outro-hash' }]);
  assert.equal(enviados.length, 1);
});
