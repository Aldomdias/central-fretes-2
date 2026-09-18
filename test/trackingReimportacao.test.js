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
