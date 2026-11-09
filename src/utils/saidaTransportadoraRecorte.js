// Regras compartilhadas entre "Saída de transportadora" e o "Simulador do
// realizado", para que as duas telas usem a MESMA base de CT-es e o MESMO peso
// quando o usuário escolhe o mesmo mês/período.
import { resolverPesoCteRealizado } from './pesoRealizadoSimulador.js';

function isoValida(texto = '') {
  const s = String(texto || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [a, m, d] = s.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(a, m, 0)).getUTCDate();
  if (m < 1 || m > 12 || d < 1) return '';
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(d, ultimoDia)).padStart(2, '0')}`;
}

export function somarDiasIso(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

// Período por data de emissão, igual ao Simulador do realizado:
// início inclusivo e fim EXCLUSIVO (dia seguinte ao último dia pedido), pra não
// perder os CT-es emitidos ao longo do último dia (data_emissao é timestamp).
// A competência (mês) vira o intervalo do 1º ao último dia daquele mês.
export function intervaloEmissao({ competencia = '', dataInicio = '', dataFim = '' } = {}) {
  const ini = isoValida(dataInicio);
  const fim = isoValida(dataFim);
  if (ini || fim) {
    return { inicio: ini || '', fimExclusivo: fim ? somarDiasIso(fim, 1) : '' };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || '').trim());
  if (m) {
    const inicio = `${m[1]}-${m[2]}-01`;
    const ultimo = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
    return { inicio, fimExclusivo: somarDiasIso(`${m[1]}-${m[2]}-${String(ultimo).padStart(2, '0')}`, 1) };
  }
  return { inicio: '', fimExclusivo: '' };
}

// Quebra o intervalo em janelas de N dias (consultas menores usam o índice de
// data e não estouram timeout, como no Simulador do realizado).
export function janelasEmissao({ inicio, fimExclusivo }, diasPorJanela = 1) {
  if (!inicio || !fimExclusivo) return [{ inicio, fimExclusivo }];
  const janelas = [];
  let atual = inicio;
  while (atual < fimExclusivo) {
    const prox = somarDiasIso(atual, diasPorJanela);
    janelas.push({ inicio: atual, fimExclusivo: prox < fimExclusivo ? prox : fimExclusivo });
    atual = prox;
  }
  return janelas;
}

// Peso padrão do Simulador do realizado ("usar peso do CT-e" ligado, sem
// contingência): coluna `peso` do CT-e; `peso_declarado` só se não houver peso.
export function pesoComoSimuladorRealizado(cte = {}) {
  return resolverPesoCteRealizado(
    { peso: cte.peso, pesoDeclarado: cte.peso_declarado ?? cte.pesoDeclarado },
    { ignorarCubagem: true, percentualContingenciaPeso: 0 },
  );
}

// ── Padronização de cidade/UF pelo IBGE ──────────────────────────────────
// O texto do CT-e varia ("FEIRA DE SANTANA/", "Feira de Santana/BA", UF errada).
// Quando o IBGE do município está resolvido, nome e UF vêm do cadastro oficial.
const UF_POR_CODIGO_IBGE = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
  21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
  31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS',
  50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

function textoPadrao(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function montarMunicipioPorIbge(municipios = []) {
  const mapa = new Map();
  for (const item of municipios || []) {
    const ibge = String(item.ibge || item.codigo_ibge || item.codigo || '').replace(/\D/g, '').slice(0, 7);
    const cidade = item.cidade || item.nome || item.municipio || '';
    if (ibge.length === 7 && cidade && !mapa.has(ibge)) mapa.set(ibge, { cidade: textoPadrao(cidade), uf: textoPadrao(item.uf || item.estado || '') });
  }
  return mapa;
}

export function localPadronizado({ cidade = '', uf = '', ibge = '' } = {}, municipioPorIbge = new Map()) {
  const cod = String(ibge || '').replace(/\D/g, '').slice(0, 7);
  const oficial = cod ? municipioPorIbge.get(cod) : null;
  const ufIbge = cod.length >= 2 ? (UF_POR_CODIGO_IBGE[cod.slice(0, 2)] || '') : '';
  const cidadeLimpa = textoPadrao(String(cidade || '').replace(/\/\s*[A-Za-z]{0,2}\s*$/, ''));
  return {
    cidade: oficial?.cidade || cidadeLimpa,
    uf: oficial?.uf || ufIbge || textoPadrao(uf),
  };
}

export function rotuloLocal(cidade, uf) {
  return [cidade, uf].filter(Boolean).join('/');
}
