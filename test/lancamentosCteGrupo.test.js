import test from 'node:test';
import assert from 'node:assert/strict';
import { casarLancamentoPeloGrupo } from '../src/utils/lancamentosCteSap.js';

const FLORESTA = '11111111000100';
const TAPATI = '22222222000100';
const linha = (cnpj, numero, serie, montante) => ({ cnpj_emitente: cnpj, numero_cte: numero, serie_cte: serie, montante, lancamento_contabil: '5100000001' });

test('CT-e lancado no CNPJ de outra empresa do grupo casa pelo numero, serie e valor', () => {
  const casadas = casarLancamentoPeloGrupo({ numero: '1234', serie: '1', valor: 500 }, [linha(TAPATI, '1234', '1', -500)]);
  assert.equal(casadas.length, 1);
  assert.equal(casadas[0].cnpj_emitente, TAPATI);
});

test('mesmo numero na outra empresa com valor diferente nao casa', () => {
  assert.deepEqual(casarLancamentoPeloGrupo({ numero: '1234', serie: '1', valor: 500 }, [linha(TAPATI, '1234', '1', -820)]), []);
});

test('serie diferente nao casa e dois CNPJs que servem e ambiguo', () => {
  assert.deepEqual(casarLancamentoPeloGrupo({ numero: '1234', serie: '1', valor: 500 }, [linha(TAPATI, '1234', '2', -500)]), []);
  assert.deepEqual(casarLancamentoPeloGrupo({ numero: '1234', serie: '1', valor: 500 }, [linha(TAPATI, '1234', '1', -500), linha(FLORESTA.replace(/00$/, '99'), '1234', '1', -500)]), []);
});

test('estorno junto do lancamento vem junto (a situacao decide se segue lancado)', () => {
  const casadas = casarLancamentoPeloGrupo({ numero: '77', serie: '1', valor: 100 }, [linha(TAPATI, '77', '1', -100), linha(TAPATI, '77', '1', 100)]);
  assert.equal(casadas.length, 2);
});
