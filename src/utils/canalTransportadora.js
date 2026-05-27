export const CANAL_A_DEFINIR = 'A DEFINIR';

export const CANAIS_OPERACIONAIS = ['ATACADO', 'B2C', 'INTERCOMPANY', 'REVERSA', CANAL_A_DEFINIR];

const CANAIS_B2C = [
  'B2C', 'VIA VAREJO', 'MERCADO LIVRE', 'MERCADOR LIVRE', 'B2W', 'MAGAZINE LUIZA',
  'CARREFOUR', 'CANTU PNEUS', 'GPA', 'COLOMBO', 'AMAZON', 'INTER', 'ANYMARKET', 'ANY MARKET',
  'BRADESCO SHOP', 'ITAU SHOP', 'ITAU SHOP', 'SHOPEE', '99', 'MUSTANG', 'LIVELO', 'COOPERA',
  'MARKETPLACE', 'MARKET PLACE', 'ECOMMERCE', 'E-COMMERCE',
];

const CANAIS_ATACADO = ['ATACADO', 'B2B', 'B 2 B'];

export function normalizarTextoCanal(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

export function normalizarNomeTransportadora(value = '') {
  return normalizarTextoCanal(value)
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizarCanalOperacional(value = '', { permitirInferencia = true } = {}) {
  const canal = normalizarTextoCanal(value);
  if (!canal) return '';
  if (canal.includes('A DEFINIR') || canal.includes('SEM TABELA') || canal.includes('SEM VINCULO')) return CANAL_A_DEFINIR;
  if (canal.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (canal.includes('REVERSA')) return 'REVERSA';
  if (CANAIS_ATACADO.some((item) => canal === item || canal.includes(item))) return 'ATACADO';
  if (CANAIS_B2C.some((item) => canal === item || canal.includes(item))) return 'B2C';
  return permitirInferencia ? canal : CANAL_A_DEFINIR;
}

export function canalEhIndefinido(value = '') {
  return normalizarCanalOperacional(value) === CANAL_A_DEFINIR;
}

