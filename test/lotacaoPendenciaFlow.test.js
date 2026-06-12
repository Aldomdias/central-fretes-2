import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_AGUARDANDO_COMPLEMENTO_OPERACAO,
  TIPO_SOLICITACAO_EXCECAO_SEM_CTE,
  isStatusAguardandoOperacao,
  isSolicitacaoExcecaoSemCte,
  montarComentarioDevolucaoOperacao,
} from '../src/services/lotacaoPendenciaFlow.js';

test('status de complemento reaparece como pendente na Operacao', () => {
  assert.equal(
    isStatusAguardandoOperacao(STATUS_AGUARDANDO_COMPLEMENTO_OPERACAO),
    true,
  );
});

test('historico da devolucao preserva resposta e justificativa anteriores', () => {
  const comentario = montarComentarioDevolucaoOperacao({
    resposta_operacao: 'Resposta inicial incompleta',
    justificativa_operacao: 'Nao informou a DIST',
  }, 'Informar a DIST correta e anexar comprovante.');

  assert.match(comentario, /Informar a DIST correta/);
  assert.match(comentario, /Resposta inicial incompleta/);
  assert.match(comentario, /Nao informou a DIST/);
});

test('excecao sem chave CTe e reconhecida para validacao manual', () => {
  assert.equal(
    isSolicitacaoExcecaoSemCte({ tipo: TIPO_SOLICITACAO_EXCECAO_SEM_CTE }),
    true,
  );
  assert.equal(
    isSolicitacaoExcecaoSemCte({
      descricao_problema: [
        'Questionamento para Operação — Auditoria Lotação',
        'Tipo de solicitação: Exceção sem chave CT-e/CTU',
      ].join('\n'),
    }),
    true,
  );
});
