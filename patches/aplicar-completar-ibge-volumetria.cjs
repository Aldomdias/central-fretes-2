const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'src', 'pages', 'FerramentasPage.jsx');
if (!fs.existsSync(filePath)) {
  console.error('Arquivo não encontrado:', filePath);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

const helper = `
const UF_POR_PREFIXO_IBGE_VOL = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

function onlyDigitsVol(value = '') {
  return String(value || '').replace(/\\D/g, '');
}

function normalizarCidadeVol(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function ufPorIbgeVol(ibge = '') {
  return UF_POR_PREFIXO_IBGE_VOL[onlyDigitsVol(ibge).slice(0, 2)] || '';
}

function escolherMelhorReferenciaVol(atual = {}, novo = {}) {
  if (!atual?.ibge && novo?.ibge) return novo;
  if (!atual?.uf && novo?.uf) return novo;
  return atual;
}

function registrarReferenciaCidadeVol(mapCidade, mapCidadeUf, cidade, uf, ibge) {
  const cidadeKey = normalizarCidadeVol(cidade);
  if (!cidadeKey) return;
  const ufFinal = String(uf || ufPorIbgeVol(ibge) || '').trim().toUpperCase().slice(0, 2);
  const ibgeFinal = onlyDigitsVol(ibge).slice(0, 7);
  if (!ufFinal && !ibgeFinal) return;

  const ref = { uf: ufFinal, ibge: ibgeFinal };
  if (ufFinal) {
    const exactKey = \`\${cidadeKey}|\${ufFinal}\`;
    mapCidadeUf.set(exactKey, escolherMelhorReferenciaVol(mapCidadeUf.get(exactKey), ref));
  }

  const atual = mapCidade.get(cidadeKey);
  if (!atual) {
    mapCidade.set(cidadeKey, { ...ref, conflito: false });
    return;
  }

  const atualUf = atual.uf || ufPorIbgeVol(atual.ibge);
  const novoUf = ref.uf || ufPorIbgeVol(ref.ibge);
  const conflito = Boolean(atualUf && novoUf && atualUf !== novoUf);
  mapCidade.set(cidadeKey, conflito ? { ...atual, conflito: true } : escolherMelhorReferenciaVol(atual, ref));
}

function buscarReferenciaCidadeVol(mapCidade, mapCidadeUf, cidade, uf = '') {
  const cidadeKey = normalizarCidadeVol(cidade);
  if (!cidadeKey) return null;
  const ufKey = String(uf || '').trim().toUpperCase().slice(0, 2);
  if (ufKey) {
    const exact = mapCidadeUf.get(\`\${cidadeKey}|\${ufKey}\`);
    if (exact) return exact;
  }
  const generic = mapCidade.get(cidadeKey);
  if (!generic || generic.conflito) return null;
  return generic;
}

function completarUfIbgePorRecorrencia(rows = []) {
  const origemCidade = new Map();
  const origemCidadeUf = new Map();
  const destinoCidade = new Map();
  const destinoCidadeUf = new Map();

  (rows || []).forEach((row) => {
    registrarReferenciaCidadeVol(origemCidade, origemCidadeUf, row.cidadeOrigem || row.Origem, row.ufOrigem || row.UF_Origem, row.ibgeOrigem || row.IBGE_Origem);
    registrarReferenciaCidadeVol(destinoCidade, destinoCidadeUf, row.cidadeDestino || row.Destino, row.ufDestino || row.UF_Destino, row.ibgeDestino || row.IBGE_Destino);
  });

  return (rows || []).map((row) => {
    const refOrigem = buscarReferenciaCidadeVol(origemCidade, origemCidadeUf, row.cidadeOrigem || row.Origem, row.ufOrigem || row.UF_Origem);
    const refDestino = buscarReferenciaCidadeVol(destinoCidade, destinoCidadeUf, row.cidadeDestino || row.Destino, row.ufDestino || row.UF_Destino);
    const ibgeOrigem = onlyDigitsVol(row.ibgeOrigem || row.IBGE_Origem || refOrigem?.ibge || '').slice(0, 7);
    const ibgeDestino = onlyDigitsVol(row.ibgeDestino || row.IBGE_Destino || refDestino?.ibge || '').slice(0, 7);
    const ufOrigem = String(row.ufOrigem || row.UF_Origem || refOrigem?.uf || ufPorIbgeVol(ibgeOrigem) || '').trim().toUpperCase().slice(0, 2);
    const ufDestino = String(row.ufDestino || row.UF_Destino || refDestino?.uf || ufPorIbgeVol(ibgeDestino) || '').trim().toUpperCase().slice(0, 2);

    return {
      ...row,
      ufOrigem,
      ibgeOrigem,
      ufDestino,
      ibgeDestino,
      chaveRotaIbge: ibgeOrigem && ibgeDestino ? \`\${ibgeOrigem}-\${ibgeDestino}\` : row.chaveRotaIbge,
    };
  });
}
`;

if (!content.includes('function completarUfIbgePorRecorrencia')) {
  const marker = 'function safeSheetName';
  const idx = content.indexOf(marker);
  if (idx === -1) {
    console.error('Ponto de inserção não encontrado: function safeSheetName');
    process.exit(1);
  }
  content = content.slice(0, idx) + helper + '\n' + content.slice(idx);
}

if (!content.includes('rowsBase = completarUfIbgePorRecorrencia(rowsBase);')) {
  const target = 'const volumetria = montarVolumetria(rowsBase, config, grade);';
  if (!content.includes(target)) {
    console.error('Ponto de aplicação não encontrado:', target);
    process.exit(1);
  }
  content = content.replace(target, 'rowsBase = completarUfIbgePorRecorrencia(rowsBase);\n      ' + target);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('OK: FerramentasPage.jsx ajustado para completar UF/IBGE por recorrência de cidade.');
