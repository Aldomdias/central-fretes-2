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
