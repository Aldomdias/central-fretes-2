import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
const tracking = await server.ssrLoadModule('/src/utils/trackingCubagem.js');
const enrichment = await server.ssrLoadModule('/src/services/realizadoTrackingEnrichment.js');
const pesos = await server.ssrLoadModule('/src/utils/pesoRealizadoSimulador.js');
const motor = await server.ssrLoadModule('/src/utils/calculoFrete.js');
await server.close();

function enriquecer(rawRows, pesoCte = 295.2) {
  const mapaChaveCte = new Map();
  for (const raw of rawRows) tracking.adicionarTrackingNoMapa(mapaChaveCte, '2227919', tracking.criarTrackingAgregado(raw, 'RAW_CHAVE_CTE'), raw.cubagem_final || raw.cubagem_total || 0);
  return enrichment.enriquecerRealizadoComTracking([{ chaveCte: '2227919', peso: pesoCte }], { mapaChaveCte }).linhas[0];
}
// Caso identificado no Tracking: oito unidades, total ja calculado 0,984 m3.
const raw = { chave_nfe: '123', cubagem_unitaria: 0.123, cubagem_total: 0.984, cubagem_final: 0.984, peso_cubado: 0.123, peso: 188, qtd_volumes: 8 };
function tabela(fator) {
  return { nome: 'PAJUCARA', origens: [{ cidade: 'Duque de Caxias', canal: 'B2C', generalidades: { tipoCalculo: 'PERCENTUAL', cubagem: fator }, rotas: [{ nomeRota: 'Sao Paulo', ibgeDestino: '3550308' }], cotacoes: [{ rota: 'Sao Paulo', pesoMin: 0, pesoMax: 999999, rsKg: 1 }] }] };
}

test('caso 2227919 preserva total 0,984 em vez de multiplicar oito vezes', () => {
  const row = enriquecer([raw]);
  assert.equal(tracking.cubagemTrackingParaCalculo(row), 0.984);
  assert.equal(pesos.resolverPesoCteRealizado(row, { ignorarCubagem: false }), 188);
  assert.equal(pesos.resolverPesoCteRealizado(row, { ignorarCubagem: true }), 295.2);
});

test('simulador aplica fator de cada tabela e mantem peso fisico quando maior', () => {
  const row = enriquecer([raw]);
  for (const [fator, esperado] of [[100, 188], [170, 188], [200, 196.8], [300, 295.2]]) {
    const itens = motor.simularSimples({ transportadoras: [tabela(fator)], origem: 'Duque de Caxias', canal: 'B2C', peso: pesos.resolverPesoCteRealizado(row, {}), cubagem: tracking.cubagemTrackingParaCalculo(row), valorNF: 1000, destinoCodigo: '3550308', fatorCubagemPadrao: 300 });
    assert.equal(itens.length, 1);
    assert.ok(Math.abs(itens[0].detalhes.frete.pesoConsiderado - esperado) < 0.000001);
    assert.equal(itens[0].detalhes.frete.fatorCubagem, fator);
  }
});

test('padrao 300 da auditoria so e aplicado quando a tabela nao define fator', () => {
  const row = enriquecer([raw]);
  const entrada = { transportadoras: [tabela(undefined)], origem: 'Duque de Caxias', canal: 'B2C', peso: 188, cubagem: tracking.cubagemTrackingParaCalculo(row), valorNF: 1000, destinoCodigo: '3550308' };
  assert.equal(motor.simularSimples({ ...entrada, fatorCubagemPadrao: 300 })[0].detalhes.frete.pesoConsiderado, 295.2);
  assert.equal(motor.simularSimples(entrada)[0].detalhes.frete.pesoConsiderado, 188);
});

test('mesma NF repetida conta uma vez e NFs diferentes somam', () => {
  const repetida = enriquecer([raw, raw]);
  assert.equal(tracking.cubagemTrackingParaCalculo(repetida), 0.984);
  const distintas = enriquecer([raw, { ...raw, chave_nfe: '456' }]);
  assert.equal(tracking.cubagemTrackingParaCalculo(distintas), 1.968);
});

test('sem Tracking nao inventa peso fisico e mantem modo CT-e', () => {
  const row = enrichment.enriquecerRealizadoComTracking([{ peso: 25, pesoTracking: 999, cubagemTotal: 100 }], {}).linhas[0];
  assert.equal(row.trackingMatch, false);
  assert.equal(row.cubagemTotal, 0);
  assert.equal(pesos.resolverPesoCteRealizado(row, {}), 25);
});


test('cubagem ausente ou rejeitada nao usa a grade como substituta do Tracking', () => {
  const itens = motor.simularSimples({ transportadoras: [tabela(200)], origem: 'Duque de Caxias', canal: 'B2C', peso: 25, cubagem: 0, valorNF: 1000, destinoCodigo: '3550308', gradeCanal: [{ peso: 25, cubagem: 5, valorNF: 1000 }], fatorCubagemPadrao: 300, cubagemSomenteInformada: true });
  assert.equal(itens[0].detalhes.frete.pesoConsiderado, 25);
});
