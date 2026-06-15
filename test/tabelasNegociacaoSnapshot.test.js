import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  erroColunaResumoCapaAusente,
  extrairResumoCapaNegociacao,
  mesclarResumoCapaNaTabela,
} from '../src/utils/tabelasNegociacaoResumoCapa.js';
import { montarLaudoTransportadoraConsolidado } from '../src/utils/laudoTransportadoraConsolidado.js';

test('erroColunaResumoCapaAusente reconhece coluna ausente no Postgres e PostgREST', () => {
  assert.equal(
    erroColunaResumoCapaAusente({ message: 'column tabelas_negociacao.resumo_capa does not exist' }),
    true,
  );
  assert.equal(
    erroColunaResumoCapaAusente({ code: 'PGRST204', message: "Could not find the 'resumo_capa' column" }),
    true,
  );
  assert.equal(
    erroColunaResumoCapaAusente({ message: "Could not find the 'resumo_capa' column of 'tabelas_negociacao' in the schema cache" }),
    true,
  );
  assert.equal(erroColunaResumoCapaAusente({ message: 'column foo does not exist' }), false);
});

test('extrairResumoCapaNegociacao remove detalhes pesados', () => {
  const capa = extrairResumoCapaNegociacao({
    rodada_atual: 2,
    ctesAnalisados: 100,
    ctesDetalhes: new Array(500).fill({ chave: 'x' }),
    historico_rodadas: [{
      tipo_registro: 'SIMULACAO',
      rodada: 2,
      detalhes: new Array(200).fill({ a: 1 }),
      resumo: { savingSelecionadaVsRealMes: 1500, ctesDetalhes: [{ id: 1 }] },
      indicadores: { aderencia: 88, saving_mes: 1500 },
    }],
  });

  assert.equal(capa.rodada_atual, 2);
  assert.equal(capa.ctesAnalisados, 100);
  assert.equal(capa._capa, true);
  assert.equal(capa.ctesDetalhes, undefined);
  assert.equal(capa.historico_rodadas[0].detalhes, undefined);
  assert.equal(capa.historico_rodadas[0].resumo.ctesDetalhes, undefined);
});

test('mesclarResumoCapaNaTabela usa resumo_capa quando resumo_simulacao ausente', () => {
  const row = mesclarResumoCapaNaTabela({
    id: 'abc',
    transportadora: 'TESTE',
    resumo_capa: { rodada_atual: 3, savingSelecionadaVsRealMes: 900 },
  });

  assert.equal(row.resumo_simulacao.rodada_atual, 3);
  assert.equal(row.resumo_simulacao.savingSelecionadaVsRealMes, 900);
});

test('montarLaudoTransportadoraConsolidado agrega origens', () => {
  const laudo = montarLaudoTransportadoraConsolidado([
    {
      id: '1',
      transportadora: 'BRASIL WEB',
      canal: 'B2C',
      origem: 'Itajaí',
      uf_origem: 'SC',
      status: 'EM NEGOCIAÇÃO',
      saving_projetado: 1000,
      aderencia_projetada: 80,
      ctes_analisados: 50,
      ctes_atendidos: 40,
      resumo_simulacao: { rodada_atual: 1, ctesAnalisados: 50, ctesComTabelaSelecionada: 40 },
    },
    {
      id: '2',
      transportadora: 'BRASIL WEB',
      canal: 'ATACADO',
      origem: 'São Paulo',
      uf_origem: 'SP',
      status: 'EM TESTE',
      saving_projetado: 500,
      aderencia_projetada: 70,
      ctes_analisados: 30,
      ctes_atendidos: 20,
      resumo_simulacao: { rodada_atual: 2, ctesAnalisados: 30, ctesComTabelaSelecionada: 20 },
    },
  ], 'BRASIL WEB');

  assert.ok(laudo.versoes?.transportadora);
  assert.ok(laudo.versoes?.diretoria);
  assert.equal(laudo.versoes.transportadora.tipo, 'transportador_consolidado');
  assert.equal(laudo.origens.length, 2);
  assert.equal(laudo.totais.savingMes, 1500);
  assert.match(laudo.versoes.transportadora.assunto, /BRASIL WEB/);
  assert.match(laudo.versoes.diretoria.relatorioTexto, /Saving mensal estimado/i);
  assert.doesNotMatch(laudo.versoes.transportadora.relatorioTexto, /Saving mensal estimado/i);
});
