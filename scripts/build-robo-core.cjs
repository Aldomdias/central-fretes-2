// Gera api/_robo-core.mjs: o nucleo do Robo Auditor empacotado para rodar na Vercel (Node),
// trocando import.meta.env (Vite) por process.env. Rode `npm run build:robo` quando mudar
// src/utils/auditoriaRoboCore.js ou algo que ele importa, e commite o arquivo gerado.
const path = require('path');
const esbuild = require(path.resolve('node_modules/esbuild'));
esbuild.build({
  entryPoints: ['src/utils/auditoriaRoboCore.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'api/_robo-core.mjs',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': 'process.env.SUPABASE_URL',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': 'process.env.SUPABASE_ANON_KEY',
    'import.meta.env': '{}',
  },
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
}).then(() => console.log('api/_robo-core.mjs gerado')).catch((e) => { console.error(e.message); process.exit(1); });
