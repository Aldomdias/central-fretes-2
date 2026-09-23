import { describe, expect, test } from 'vitest';
import { agruparDetalhesVerum, detalhesDaFatura } from '../src/utils/auditoriaFretesImport.js';

describe('detalhesDaFatura', () => {
  test('nao mistura CT-es de transportadoras diferentes com o mesmo numero de fatura', () => {
    const rowsDetalhes = [
      { 'Numero Fatura': '44', Transportadora: 'FORTRANSLOG', 'CNPJ Transportadora': '11111111000111', 'Chave CTe': 'CTE-FORT-1' },
      { 'Numero Fatura': '44', Transportadora: 'FORTRANSLOG', 'CNPJ Transportadora': '11111111000111', 'Chave CTe': 'CTE-FORT-2' },
      { 'Numero Fatura': '44', Transportadora: 'EDUARDO JOSE DA SILVA', 'CNPJ Transportadora': '04069247670', 'Chave CTe': 'CTE-EDU-1' },
    ];
    const grupos = agruparDetalhesVerum(rowsDetalhes);

    const doFortranslog = detalhesDaFatura(grupos, '44', '', '11111111000111', 'FORTRANSLOG');
    const doEduardo = detalhesDaFatura(grupos, '44', '', '04069247670', 'EDUARDO JOSE DA SILVA');

    expect(doFortranslog).toHaveLength(2);
    expect(doFortranslog.map((r) => r['Chave CTe'])).toEqual(['CTE-FORT-1', 'CTE-FORT-2']);

    expect(doEduardo).toHaveLength(1);
    expect(doEduardo.map((r) => r['Chave CTe'])).toEqual(['CTE-EDU-1']);
  });

  test('ainda casa por numero quando so ha uma transportadora com aquele numero e serie diverge', () => {
    const rowsDetalhes = [
      { 'Numero Fatura - Serie': '999-2', Transportadora: 'UNICA TRANSPORTES', 'CNPJ Transportadora': '22222222000122', 'Chave CTe': 'CTE-UNICA-1' },
    ];
    const grupos = agruparDetalhesVerum(rowsDetalhes);
    const resultado = detalhesDaFatura(grupos, '999', '9', '22222222000122', 'UNICA TRANSPORTES');
    expect(resultado).toHaveLength(1);
  });
});
