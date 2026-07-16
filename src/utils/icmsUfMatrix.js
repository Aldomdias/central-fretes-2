import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';

export const ICMS_UF_MATRIX_KEY = 'central-fretes:icms-uf-matrix-v1';
const TABELA_CONFIG = 'simulador_configuracoes';
const CHAVE_ICMS_UF = 'matriz_icms_uf';

export const UFS_BR = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value)
    .replace(/R\$/gi, '')
    .replace(/%/g, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normUf(value) {
  return String(value || '').trim().toUpperCase().slice(0, 2);
}

function normText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function campo(row = {}, nomes = []) {
  const keys = Object.keys(row || {});
  for (const nome of nomes) {
    const alvo = String(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const key = keys.find((k) => String(k).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase() === alvo);
    if (key && row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
  }
  return '';
}

export function normalizarLinhaIcms(row = {}) {
  const ufOrigem = normUf(campo(row, ['UF_ORIGEM', 'UF ORIGEM', 'ORIGEM', 'UF Origem']));
  const ufDestino = normUf(campo(row, ['UF_DESTINO', 'UF DESTINO', 'DESTINO', 'UF Destino']));
  const aliquota = toNumber(campo(row, ['ALIQUOTA', 'ALÍQUOTA', 'ICMS', 'ALIQUOTA_ICMS', 'ALÍQUOTA ICMS']));
  if (!UFS_BR.includes(ufOrigem) || !UFS_BR.includes(ufDestino) || aliquota <= 0) return null;
  return {
    transportadora: String(campo(row, ['TRANSPORTADORA', 'TRANSPORTADORA_TABELA', 'TRANSPORTADORA TABELA']) || row.transportadora || '').trim(),
    cidadeOrigem: String(campo(row, ['CIDADE_ORIGEM', 'CIDADE ORIGEM', 'ORIGEM_CIDADE', 'ORIGEM CIDADE']) || row.cidadeOrigem || '').trim(),
    canal: String(campo(row, ['CANAL']) || row.canal || '').trim().toUpperCase(),
    ufOrigem,
    ufDestino,
    aliquota,
    observacao: String(campo(row, ['OBS', 'OBSERVACAO', 'OBSERVAÇÃO']) || '').trim(),
  };
}

export function carregarMatrizIcmsUf() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ICMS_UF_MATRIX_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((row) => row?.ufOrigem && row?.ufDestino && Number(row?.aliquota) > 0) : [];
  } catch {
    return [];
  }
}

export function salvarMatrizIcmsUf(linhas = []) {
  const mapa = new Map();
  (linhas || []).forEach((row) => {
    const normalizada = normalizarLinhaIcms(row) || row;
    const ufOrigem = normUf(normalizada.ufOrigem);
    const ufDestino = normUf(normalizada.ufDestino);
    const aliquota = toNumber(normalizada.aliquota);
    if (!UFS_BR.includes(ufOrigem) || !UFS_BR.includes(ufDestino) || aliquota <= 0) return;
    const transportadora = String(normalizada.transportadora || '').trim();
    const cidadeOrigem = String(normalizada.cidadeOrigem || '').trim();
    const canal = String(normalizada.canal || '').trim().toUpperCase();
    mapa.set(`${normText(transportadora)}-${normText(cidadeOrigem)}-${canal}-${ufOrigem}-${ufDestino}`, {
      transportadora,
      cidadeOrigem,
      canal,
      ufOrigem,
      ufDestino,
      aliquota,
      observacao: String(normalizada.observacao || '').trim(),
    });
  });
  const lista = Array.from(mapa.values()).sort((a, b) => a.ufOrigem.localeCompare(b.ufOrigem) || a.ufDestino.localeCompare(b.ufDestino));
  localStorage.setItem(ICMS_UF_MATRIX_KEY, JSON.stringify(lista));
  return lista;
}

function erroTabelaInexistente(error) {
  const msg = String(error?.message || error?.details || '').toLowerCase();
  const code = String(error?.code || '');
  return code === '42P01' || msg.includes('does not exist') || msg.includes('schema cache');
}

export async function carregarMatrizIcmsUfCentralizada() {
  const local = carregarMatrizIcmsUf();
  if (!isSupabaseConfigured()) return { linhas: local, fonte: 'local', mensagem: 'Supabase não configurado; usando matriz local deste navegador.' };

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(TABELA_CONFIG)
      .select('valor, updated_at')
      .eq('chave', CHAVE_ICMS_UF)
      .maybeSingle();
    if (error) throw error;
    if (Array.isArray(data?.valor)) {
      const linhas = salvarMatrizIcmsUf(data.valor);
      return { linhas, fonte: 'supabase', mensagem: `Matriz ICMS carregada do Supabase${data.updated_at ? ` (${new Date(data.updated_at).toLocaleString('pt-BR')})` : ''}.` };
    }
    return { linhas: local, fonte: 'local', mensagem: 'Nenhuma matriz ICMS publicada no Supabase; usando matriz local.' };
  } catch (error) {
    return {
      linhas: local,
      fonte: 'local',
      mensagem: erroTabelaInexistente(error)
        ? 'Tabela simulador_configuracoes ainda não existe; matriz ICMS ficou local.'
        : `Erro ao carregar matriz ICMS do Supabase; usando local. ${error.message || ''}`,
    };
  }
}

export async function salvarMatrizIcmsUfCentralizada(linhas = []) {
  const normalizada = salvarMatrizIcmsUf(linhas);
  if (!isSupabaseConfigured()) return { linhas: normalizada, fonte: 'local', mensagem: 'Matriz salva apenas neste navegador. Supabase não configurado.' };

  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from(TABELA_CONFIG)
    .upsert({
      chave: CHAVE_ICMS_UF,
      valor: normalizada,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'chave' });

  if (error) {
    if (erroTabelaInexistente(error)) {
      return { linhas: normalizada, fonte: 'local', mensagem: 'Matriz salva localmente, mas falta a tabela simulador_configuracoes no Supabase.' };
    }
    throw error;
  }

  return { linhas: normalizada, fonte: 'supabase', mensagem: 'Matriz ICMS salva no Supabase e sincronizada para todos os ambientes.' };
}

export function resolverAliquotaIcmsUf(ufOrigem, ufDestino) {
  return resolverAliquotaIcmsUfContexto({ ufOrigem, ufDestino });
}

export function resolverAliquotaIcmsUfContexto({ ufOrigem, ufDestino, transportadora = '', cidadeOrigem = '', canal = '' } = {}) {
  const origem = normUf(ufOrigem);
  const destino = normUf(ufDestino);
  if (!origem || !destino) return null;
  const transpNorm = normText(transportadora);
  const cidadeNorm = normText(cidadeOrigem);
  const canalNorm = String(canal || '').trim().toUpperCase();
  const candidatos = carregarMatrizIcmsUf()
    .filter((row) => row.ufOrigem === origem && row.ufDestino === destino)
    .filter((row) => !row.transportadora || normText(row.transportadora) === transpNorm)
    .filter((row) => !row.cidadeOrigem || normText(row.cidadeOrigem) === cidadeNorm)
    .filter((row) => !row.canal || String(row.canal).trim().toUpperCase() === canalNorm)
    .map((row) => ({
      row,
      score: (row.transportadora ? 4 : 0) + (row.cidadeOrigem ? 2 : 0) + (row.canal ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const linha = candidatos[0]?.row;
  if (!linha) return null;
  return {
    aliquota: Number(linha.aliquota),
    origem: linha.transportadora || linha.cidadeOrigem || linha.canal ? 'excecao_icms_transportadora' : 'matriz_icms_uf',
    ufOrigem: origem,
    ufDestino: destino,
  };
}

export function modeloMatrizIcmsUf() {
  return UFS_BR.flatMap((ufOrigem) => UFS_BR.map((ufDestino) => ({
    TRANSPORTADORA: '',
    CIDADE_ORIGEM: '',
    CANAL: '',
    UF_ORIGEM: ufOrigem,
    UF_DESTINO: ufDestino,
    ALIQUOTA: ufOrigem === ufDestino ? 17 : '',
    OBSERVACAO: '',
  })));
}
