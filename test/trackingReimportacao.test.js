import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/services/trackingSupabaseService.js', import.meta.url), 'utf8')
  .replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
const chave = '1'.repeat(44);

function preparar(registros = [], falha = false) {
  let base = registros.map((r) => ({ ...r }));
  let gravacoes = 0;
  const client = { from() {
    let campo, valores, inicio, fim;
    const query = {
      select() { return query; },
      in(c, v) { campo = c; valores = v; return query; },
      order() { return query; },
      range(i, f) { inicio = i; fim = f; return query; },
      then(resolve) { return Promise.resolve({ data: base.filter((r) => valores.includes(r[campo])).slice(inicio, fim + 1), error: falha ? { message: 'consulta falhou' } : null }).then(resolve); },
      async upsert(rows) {
        gravacoes++;
        for (const row of rows) {
          const idx = base.findIndex((r) => r.id === row.id);
          if (idx < 0) base.push({ ...row }); else base[idx] = { ...row };
        }
        return { error: null };
      },
    };
    return query;
  } };
  const context = vm.createContext({
    getSupabaseClient: () => client, isSupabaseConfigured: () => true,
    getChaveNfeLookup: (r) => r.chaveNfe || '', buildTrackingId: (r) => r.id,
    resolverCubagemFinal: () => ({ cubagemAplicada: 0 }), setTimeout,
  });
  vm.runInContext(source, context);
  return { enviar: context.subirTrackingSupabase, base: () => base, gravacoes: () => gravacoes };
}

test('NF recebe CT-e e entrega no registro existente e reenvio não duplica', async () => {
  const app = preparar([{ id: `nf-${chave}`, chave_nfe: chave }]);
  const row = { id: `cte-nf-${'2'.repeat(44)}-${chave}`, chaveNfe: chave, chaveCte: '2'.repeat(44), entrega: '2026-09-18' };
  await app.enviar([row, row]);
  await app.enviar([row]);
  assert.equal(app.base().length, 1);
  assert.equal(app.base()[0].id, `nf-${chave}`);
  assert.equal(app.base()[0].chave_cte, row.chaveCte);
  assert.equal(app.base()[0].data_entrega, row.entrega);
  await app.enviar([{ chaveNfe: chave }]);
  assert.equal(app.base()[0].data_entrega, row.entrega);
  assert.equal(app.base()[0].chave_cte, row.chaveCte);
});

test('reutiliza ID legado combinado e inclui NF nova com ID estável', async () => {
  const app = preparar([{ id: 'cte-nf-legado', chave_nfe: chave }]);
  await app.enviar([{ chaveNfe: chave, id: 'outro-id' }, { chaveNfe: '3'.repeat(44), id: 'id-com-cte' }]);
  assert.equal(app.base().length, 2);
  assert.equal(app.base()[0].id, 'cte-nf-legado');
  assert.equal(app.base()[1].id, `nf-${'3'.repeat(44)}`);
});

test('falha de consulta ou duplicados existentes cancelam antes de gravar', async () => {
  for (const app of [preparar([], true), preparar([{ id: 'a', chave_nfe: chave }, { id: 'b', chave_nfe: chave }])]) {
    await assert.rejects(app.enviar([{ chaveNfe: chave }]));
    assert.equal(app.gravacoes(), 0);
  }
});

test('linha sem chave NF cancela o arquivo inteiro antes de gravar', async () => {
  const app = preparar();
  await assert.rejects(app.enviar([{ chaveNfe: chave }, { id: 'sem-chave' }]), /sem chave da NF/);
  assert.equal(app.gravacoes(), 0);
});

function prepararLimpeza(registros, permitirExcluir = true) {
  let base = registros.map((r) => ({ ...r }));
  const client = { from() {
    let filtro, ids, limite = Infinity, excluir = false, contar = false;
    const query = {
      select(_campos, options) { contar = options?.head || false; return query; },
      or(f) { filtro = f; return query; },
      order() { return query; }, limit(n) { limite = n; return query; },
      in(_campo, v) { ids = v; return query; }, delete() { excluir = true; return query; },
      then(resolve) {
        if (excluir && ids.reduce((total, id) => total + encodeURIComponent(id).length + 6, 0) > 5000) {
          return Promise.resolve({ data: null, error: { message: 'Bad Request: URL muito longa' } }).then(resolve);
        }
        const candidatos = base.filter((row) => filtro.split(',').some((parte) => {
          const [campo, , padrao] = parte.split('.');
          return new RegExp(`^${padrao.replace(/_/g, '.')}$`).test(row[campo] || '');
        }) && (!ids || ids.includes(row.id))).slice(0, limite);
        if (excluir && permitirExcluir) base = base.filter((r) => !candidatos.includes(r));
        return Promise.resolve({ data: excluir && !permitirExcluir ? [] : candidatos, count: contar ? candidatos.length : null, error: null }).then(resolve);
      },
    };
    return query;
  } };
  const context = vm.createContext({ getSupabaseClient: () => client, isSupabaseConfigured: () => true, setTimeout });
  vm.runInContext(source, context);
  return { contar: context.contarTrackingCompetencia, limpar: context.limparTrackingCompetencia, base: () => base };
}

test('limpeza usa emissão NF, exclui duplicados em lotes e preserva demais meses', async () => {
  const setembro = `322609${'1'.repeat(38)}`;
  const agosto = `322608${'1'.repeat(38)}`;
  const app = prepararLimpeza([
    ...Array.from({ length: 501 }, (_, i) => ({ id: `cte-nf-${'2'.repeat(44)}-${String(i).padStart(44, '0')}`, chave_nfe: setembro, data: '2026-10-01' })),
    { id: `nf-${setembro}`, chave_nfe: '' },
    { id: 'agosto', chave_nfe: agosto, data: '2026-09-01' },
    { id: 'sem-chave', chave_nfe: '', data: '2026-09-01' },
  ]);
  assert.equal(await app.contar('2026-09'), 502);
  assert.equal((await app.limpar('2026-09')).excluidos, 502);
  assert.equal(await app.contar('2026-09'), 0);
  assert.deepEqual(app.base().map((r) => r.id), ['agosto', 'sem-chave']);
});

test('limpeza valida competência e interrompe quando exclusão não tem permissão', async () => {
  const app = prepararLimpeza([{ id: 'a', chave_nfe: `322609${'1'.repeat(38)}` }], false);
  for (const competencia of ['', '2026-00', '2026-13', '26-09']) {
    await assert.rejects(app.limpar(competencia), /competência válida/);
  }
  await assert.rejects(app.limpar('2026-09'), /permissão de exclusão/);
  assert.equal(app.base().length, 1);
});
