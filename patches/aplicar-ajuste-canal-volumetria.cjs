const fs = require('fs');
const path = require('path');

const root = process.cwd();

function filePath(rel) {
  return path.join(root, rel);
}

function read(rel) {
  const full = filePath(rel);
  if (!fs.existsSync(full)) throw new Error(`Arquivo não encontrado: ${rel}`);
  return fs.readFileSync(full, 'utf8');
}

function write(rel, content) {
  fs.writeFileSync(filePath(rel), content, 'utf8');
  console.log(`OK: ${rel}`);
}

function replaceOrThrow(content, pattern, replacement, label) {
  if (!pattern.test(content)) throw new Error(`Padrão não encontrado: ${label}`);
  return content.replace(pattern, replacement);
}

function patchTrackingLocal() {
  const rel = 'src/utils/trackingLocal.js';
  let content = read(rel);

  const categoriaCanalNova = `function categoriaCanal(value) {
  const canal = normalizeLoose(value);
  if (!canal) return '';

  const mapaExato = new Map([
    ['MERCADO LIVRE', 'B2C'],
    ['MERCADOR LIVRE', 'B2C'],
    ['SHOPEE', 'B2C'],
    ['MAGAZINE LUIZA', 'B2C'],
    ['MAGALU', 'B2C'],
    ['B2C', 'B2C'],
    ['AMAZON', 'B2C'],
    ['INTER', 'B2C'],
    ['VIA VAREJO', 'B2C'],
    ['CARREFOUR', 'B2C'],
    ['CANTU PNEUS', 'B2C'],
    ['ITAU SHOP', 'B2C'],
    ['ITAÚ SHOP', 'B2C'],
    ['ITA SHOP', 'B2C'],
    ['99', 'B2C'],
    ['MUSTANG', 'B2C'],
    ['LIVELO', 'B2C'],
    ['BRADESCO SHOP', 'B2C'],
    ['BRASIL SHOP', 'B2C'],
    ['BRAZIL SHOP', 'B2C'],
    ['COOPERA', 'B2C'],
    ['B2B', 'ATACADO'],
    ['ATACADO', 'ATACADO'],
  ]);

  if (mapaExato.has(canal)) return mapaExato.get(canal);

  const b2cContem = [
    'MERCADO LIVRE', 'MERCADOR LIVRE', 'SHOPEE', 'MAGAZINE', 'MAGALU',
    'AMAZON', 'INTER', 'VIA VAREJO', 'VAREJO', 'CARREFOUR', 'CANTU PNEUS',
    'ITAU', 'ITAÚ', '99', 'MUSTANG', 'LIVELO', 'BRADESCO', 'BRASIL SHOP',
    'BRAZIL SHOP', 'COOPERA', 'ECOMMERCE', 'E COMMERCE', 'E-COMMERCE',
    'MARKETPLACE', 'MARKET PLACE', 'ANYMARKET', 'ANY MARKET', 'ME2'
  ];

  if (b2cContem.some((item) => canal.includes(item))) return 'B2C';

  const atacadoContem = ['ATACADO', 'B2B', 'B 2 B'];
  if (atacadoContem.some((item) => canal === item || canal.includes(item))) return 'ATACADO';

  return 'NAO_CLASSIFICADO';
}

function headerKey`;

  content = replaceOrThrow(
    content,
    /function categoriaCanal\(value\) \{[\s\S]*?\n\}\n\nfunction headerKey/,
    categoriaCanalNova,
    'substituir categoriaCanal'
  );

  content = content.replace(
    /canal: categoriaCanal\(canalOriginal \|\| regiao \|\| modoEnvio\),/,
    "canal: categoriaCanal(canalOriginal || text(get(linha, col.loja)) || regiao || modoEnvio),"
  );

  if (!content.includes('function normalizarCanalTrackingRow')) {
    const helper = `function normalizarCanalTrackingRow(row = {}) {
  const canalOriginal = row.canalOriginal || row.raw?.Canal || row.raw?.canal || row.canal || '';
  const canalClassificado = categoriaCanal(canalOriginal || row.canal || row.loja || row.regiao || row.modoEnvio);
  return {
    ...row,
    canalOriginal,
    canal: canalClassificado || row.canal || '',
    canalNaoClassificado: canalClassificado === 'NAO_CLASSIFICADO',
  };
}

`;
    content = content.replace(/function isEbazar\(value\) \{/, helper + 'function isEbazar(value) {');
  }

  if (!content.includes('const rowNormalizado = normalizarCanalTrackingRow(row);')) {
    content = content.replace(
      /export function filtrarTrackingLocal\(row = \{\}, filtros = \{\}\) \{\n/,
      "export function filtrarTrackingLocal(row = {}, filtros = {}) {\n  const rowNormalizado = normalizarCanalTrackingRow(row);\n  row = rowNormalizado;\n"
    );
  }

  content = content.replace(
    /const row = cursor\.value;\n\s+if \(filtrarTrackingLocal\(row, filtros\)\) \{/,
    "const row = normalizarCanalTrackingRow(cursor.value);\n      if (filtrarTrackingLocal(row, filtros)) {"
  );

  write(rel, content);
}

function patchTrackingCteLink() {
  const rel = 'src/utils/trackingCteLink.js';
  let content = read(rel);

  if (!content.includes('function complementarTrackingComCte')) {
    const helper = `function getUfByIbgeCte(ibge = '') {
  const codigo = onlyDigits(ibge).slice(0, 2);
  const mapa = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
    '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
    '41': 'PR', '42': 'SC', '43': 'RS',
    '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
  };
  return mapa[codigo] || '';
}

function complementarTrackingComCte(row = {}, matches = []) {
  const cte = matches[0] || {};
  const out = { ...row };
  const campos = [];

  const setIfEmpty = (field, label, value) => {
    if (String(out[field] || '').trim()) return;
    const val = String(value || '').trim();
    if (!val) return;
    out[field] = val;
    campos.push(label);
  };

  setIfEmpty('cidadeOrigem', 'Origem', pickFirst(cte.cidadeOrigem, cte.origem, cte.raw?.cidadeOrigem, cte.raw?.origem));
  setIfEmpty('ufOrigem', 'UF origem', pickFirst(cte.ufOrigem, cte.uf_origem, cte.raw?.ufOrigem, getUfByIbgeCte(cte.ibgeOrigem)));
  setIfEmpty('ibgeOrigem', 'IBGE origem', onlyDigits(pickFirst(cte.ibgeOrigem, cte.ibge_origem, cte.raw?.ibgeOrigem)).slice(0, 7));

  setIfEmpty('cidadeDestino', 'Destino', pickFirst(cte.cidadeDestino, cte.destino, cte.raw?.cidadeDestino, cte.raw?.destino));
  setIfEmpty('ufDestino', 'UF destino', pickFirst(cte.ufDestino, cte.uf_destino, cte.raw?.ufDestino, getUfByIbgeCte(cte.ibgeDestino)));
  setIfEmpty('ibgeDestino', 'IBGE destino', onlyDigits(pickFirst(cte.ibgeDestino, cte.ibge_destino, cte.raw?.ibgeDestino)).slice(0, 7));

  if (!out.chaveRotaIbge && out.ibgeOrigem && out.ibgeDestino) {
    out.chaveRotaIbge = `${out.ibgeOrigem}-${out.ibgeDestino}`;
  }

  out.enderecoComplementadoPorCte = campos.length > 0;
  out.camposComplementadosPorCte = campos.join(', ');
  return out;
}

`;
    content = content.replace(/export function relacionarTrackingComCtes\(trackingRows = \[\], cteRows = \[\]\) \{/, helper + 'export function relacionarTrackingComCtes(trackingRows = [], cteRows = []) {');
  }

  content = content.replace(
    /return \{\n\s+\.\.\.row,\n\s+qtdCtesVinculados:/,
    "return {\n      ...complementarTrackingComCte(row, matches),\n      qtdCtesVinculados:"
  );

  write(rel, content);
}

function patchFerramentasPage() {
  const rel = 'src/pages/FerramentasPage.jsx';
  let content = read(rel);

  content = content.replace(
    /const CANAIS = \['', 'ATACADO', 'B2C', 'INTERCOMPANY', 'REVERSA'\];/,
    "const CANAIS = ['', 'ATACADO', 'B2C'];"
  );

  if (!content.includes("ws['!views']")) {
    content = content.replace(
      /ws\['!autofilter'\] = \{ ref: XLSX\.utils\.encode_range\(range\) \};/,
      "ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };\n  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];"
    );
  }

  content = content.replace(
    /const abas = \{\n\s+Volumetria,\n\s+Detalhe_Notas: config\.incluirDetalhe \? detalheNotas : \[\],\n\s+Resumo: resumo,\n\s+\};\n\n\s+if \(config\.vincularCtes\) \{\n\s+abas\.Validacao_CTE_Interna = rowsBase\.map\(vinculoCteInternoRow\);\n\s+\}/,
    "const abas = {\n        Volumetria_Agrupada: volumetria,\n        Detalhe_Notas: config.incluirDetalhe ? detalheNotas : [],\n      }"
  );

  content = content.replace(
    /const abas = \{\n\s+Volumetria: volumetria,\n\s+Detalhe_Notas: config\.incluirDetalhe \? detalheNotas : \[\],\n\s+Resumo: resumo,\n\s+\};\n\n\s+if \(config\.vincularCtes\) \{\n\s+abas\.Validacao_CTE_Interna = rowsBase\.map\(vinculoCteInternoRow\);\n\s+\}/,
    "const abas = {\n        Volumetria_Agrupada: volumetria,\n        Detalhe_Notas: config.incluirDetalhe ? detalheNotas : [],\n      }"
  );

  content = content.replace(
    /const abas = \{\n\s+Volumetria: volumetria,\n\s+Detalhe_Notas: config\.incluirDetalhe \? detalheNotas : \[\],\n\s+Resumo: resumo,\n\s+\};/,
    "const abas = {\n        Volumetria_Agrupada: volumetria,\n        Detalhe_Notas: config.incluirDetalhe ? detalheNotas : [],\n      };"
  );

  content = content.replace(
    /A aba Volumetria agrupa por origem\/destino\/faixa\./,
    'A aba Volumetria_Agrupada agrupa por origem/destino/faixa.'
  );

  write(rel, content);
}

try {
  patchTrackingLocal();
  patchTrackingCteLink();
  patchFerramentasPage();
  console.log('\nPatch aplicado. Rode npm run build antes de subir.');
} catch (error) {
  console.error('\nERRO AO APLICAR PATCH:');
  console.error(error.message || error);
  process.exit(1);
}
