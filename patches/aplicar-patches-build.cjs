#!/usr/bin/env node
/**
 * Aplicador central dos patches ativos no build/dev.
 *
 * Mantém o package.json simples e evita quebrar o build por esquecer um patch no script.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const patches = [
  'patches/implementar-fluxo-pesquisar-ctes-realizado.cjs',
  'patches/corrigir-feedback-calculo-origem-e-volumes-realizado.cjs',
  'patches/corrigir-indicadores-ganhos-negociacao.cjs',
  'patches/corrigir-volumes-pedidos-ganhos-service.cjs',
];

for (const patch of patches) {
  const fullPath = path.join(process.cwd(), patch);
  console.log(`\nAplicando ${patch}...`);
  const result = spawnSync(process.execPath, [fullPath], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(`Falha ao aplicar ${patch}.`);
    process.exit(result.status || 1);
  }
}

console.log('\nPatches ativos aplicados com sucesso.');
