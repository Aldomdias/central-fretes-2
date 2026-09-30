import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chavesDoRelatorioSap, dividirEmLotes, dataSapValida, isoParaSap, extrairChavesDeTexto,
  gerarScriptExportacaoVbs, gerarScriptReprocessarVbs, removerDuplicadas,
} from '../src/utils/robos/reprocessarCte.js';

const K = (n) => String(n).padStart(44, '0');

test('extrai chaves do relatorio do SAP e ignora EBAZAR', () => {
  const matriz = [
    ['Relatorio de log'],
    ['Chave CTe', 'Serie CTe', 'Transportadora', 'Texto de mensagem'],
    [K(1), '1', 'TRANSP A', 'Saldo'],
    [K(2), '1', 'EBAZAR LTDA', 'Saldo'],
    [' ' + K(3), '1', 'Transportadora Ébazar', 'Saldo'],
    ['123', '1', 'TRANSP B', 'x'],
    [K(4), '1', 'TRANSP B', 'Saldo'],
  ];
  const r = chavesDoRelatorioSap(matriz);
  assert.deepEqual(r.chaves, [K(1), K(4)]);
  assert.equal(r.stats.ignoradasTransportadora, 2);
  assert.equal(r.stats.semChaveValida, 1);
});

test('erro claro quando nao ha coluna Chave CTe', () => {
  assert.throws(() => chavesDoRelatorioSap([['a', 'b'], [1, 2]]), /Chave CTe/);
});

test('lotes de 200 como na planilha', () => {
  const chaves = Array.from({ length: 450 }, (_, i) => K(i));
  assert.deepEqual(dividirEmLotes(chaves, 200).map((l) => l.length), [200, 200, 50]);
  assert.equal(removerDuplicadas([K(1), K(1), K(2)]).length, 2);
});

test('datas no formato SAP', () => {
  assert.equal(isoParaSap('2026-08-01'), '01.08.2026');
  assert.equal(dataSapValida('31.09.2026'), false); // a data que estava na planilha nao existia
  assert.equal(dataSapValida('30.09.2026'), true);
  assert.deepEqual(extrairChavesDeTexto(`${K(1)}\n${K(2)}; abc`).invalidas, ['abc']);
});

test('scripts VBS: linhas curtas e conteudo esperado', () => {
  const chaves = Array.from({ length: 450 }, (_, i) => K(i));
  const vbs = gerarScriptReprocessarVbs({ chaves, dataInicial: '01.08.2026', dataFinal: '30.09.2026' });
  assert.ok(vbs.split('\r\n').every((l) => l.length < 900));
  assert.ok(vbs.includes('For i = 0 To 2'));
  assert.ok(vbs.includes('/NZMMCTE_PED_LOG'));
  assert.ok(vbs.includes('btn[24]'));
  const exp = gerarScriptExportacaoVbs({ dataInicial: '01.08.2026' });
  assert.ok(exp.includes('doubleClickCurrentCell')); // sem data final usa opcoes de selecao
  assert.ok(exp.includes('CT-esErro'));
  assert.throws(() => gerarScriptReprocessarVbs({ chaves: [], dataInicial: '01.08.2026' }));
});
