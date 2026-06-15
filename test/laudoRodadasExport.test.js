import test from 'node:test';
import assert from 'node:assert/strict';
import {
  laudoRodadasExterno,
  textoLaudoRodadas,
  textoEmailLaudoRodadas,
  nomeArquivoSeguroLaudo,
} from '../src/utils/laudoRodadasExport.js';

test('laudoRodadasExterno identifica versão transportador', () => {
  assert.equal(laudoRodadasExterno({ tipo: 'transportador_rodadas' }, ''), true);
  assert.equal(laudoRodadasExterno({}, 'transportador'), true);
  assert.equal(laudoRodadasExterno({}, 'executivo'), false);
});

test('textoLaudoRodadas e textoEmailLaudoRodadas montam conteúdo distinto', () => {
  const laudo = {
    relatorioTexto: 'Resumo do laudo',
    assunto: 'Assunto teste',
    corpoEmail: 'Corpo do e-mail',
    laudoCompleto: 'Assunto: Assunto teste\n\nCorpo do e-mail',
  };
  assert.equal(textoLaudoRodadas(laudo), 'Resumo do laudo');
  assert.match(textoEmailLaudoRodadas(laudo), /Assunto: Assunto teste/);
  assert.match(textoEmailLaudoRodadas(laudo), /Corpo do e-mail/);
  assert.notEqual(textoLaudoRodadas(laudo), textoEmailLaudoRodadas(laudo));
});

test('nomeArquivoSeguroLaudo normaliza transportadora', () => {
  assert.equal(nomeArquivoSeguroLaudo('Brasil Web S/A'), 'brasil-web-s-a');
});
