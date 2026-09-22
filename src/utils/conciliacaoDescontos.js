function normalizarNome(valor = '') {
  return String(valor)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\b(LTDA|EIRELI|ME|EPP|SA|S A|TRANSPORTADORAS?|TRANSPORTES?|LOGISTICA|RODOVIARIOS?)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function tokens(valor) {
  return new Set(normalizarNome(valor).split(/\s+/).filter((item) => item.length > 1));
}

function similaridadeNome(a, b) {
  const na = normalizarNome(a);
  const nb = normalizarNome(b);
  if (!na || !nb) return 0;
  if (na === nb || na.includes(nb) || nb.includes(na)) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  const intersecao = [...ta].filter((item) => tb.has(item)).length;
  return intersecao / Math.max(ta.size, tb.size, 1);
}

function diasEntre(inicio, fim) {
  if (!inicio || !fim) return null;
  const a = new Date(`${String(inicio).slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${String(fim).slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function montarDescontosEnviados(protocolos = [], legados = []) {
  const futuros = protocolos
    .filter((row) => row.ativo !== false && Number(row.desconto_total || 0) > 0)
    .map((row) => ({
      id: row.id,
      origem: 'PROTOCOLO_AUDITORIA',
      protocolo: row.protocolo,
      data_envio: row.enviado_em?.slice(0, 10) || row.created_at?.slice(0, 10) || null,
      numero_fatura: row.numero_fatura,
      transportadora: row.transportadora,
      cnpj: row.cnpj_transportadora,
      desconto_enviado: Number(row.desconto_total || 0),
      centro_custo_desconto: row.centro_custo_codigo,
      arquivo_origem: null,
    }));
  const chavesLegado = new Set();
  const historicos = legados
    .filter((row) => {
      const chave = `${row.arquivo_origem || ''}|${row.numero_fatura || ''}|${Number(row.desconto_enviado || 0).toFixed(2)}`;
      if (chavesLegado.has(chave)) return false;
      chavesLegado.add(chave);
      return true;
    })
    .map((row) => ({ ...row, origem: 'PLANILHA_LEGADA' }));
  return [...futuros, ...historicos];
}

export function conciliarDescontos(enviados = [], realizados = [], { tolerancia = 0.01, janelaDias = 180 } = {}) {
  const usados = new Set();
  return [...enviados]
    .sort((a, b) => String(a.data_envio || '').localeCompare(String(b.data_envio || '')))
    .map((enviado) => {
      const valorEnviado = Number(enviado.desconto_enviado || 0);
      const candidatos = realizados
        .filter((realizado) => !usados.has(realizado.id))
        .map((realizado) => {
          const diferenca = Number((Number(realizado.valor || 0) - valorEnviado).toFixed(2));
          const similaridade = similaridadeNome(enviado.transportadora, realizado.transportadora_nome);
          const dias = diasEntre(enviado.data_envio, realizado.data_lancamento);
          const dentroJanela = dias === null || (dias >= -7 && dias <= janelaDias);
          const valorBate = Math.abs(diferenca) <= tolerancia;
          const centroBate = enviado.centro_custo_desconto && realizado.centro_lucro
            ? normalizarNome(realizado.centro_lucro).includes(normalizarNome(enviado.centro_custo_desconto))
            : false;
          const elegivel = valorBate && dentroJanela && (similaridade >= 0.5 || centroBate);
          const score = (valorBate ? 100 : 0) + similaridade * 30 + (centroBate ? 10 : 0) - Math.max(dias || 0, 0) / 100;
          return { realizado, diferenca, similaridade, dias, elegivel, score };
        })
        .filter((item) => item.elegivel)
        .sort((a, b) => b.score - a.score);
      const melhor = candidatos[0];
      if (!melhor) return { ...enviado, status_conciliacao: 'PENDENTE', desconto_realizado: 0, diferenca: -valorEnviado, realizado: null };
      usados.add(melhor.realizado.id);
      return {
        ...enviado,
        status_conciliacao: candidatos.length > 1 && Math.abs(candidatos[0].score - candidatos[1].score) < 1 ? 'REVISAR' : 'REALIZADO',
        desconto_realizado: Number(melhor.realizado.valor || 0),
        diferenca: melhor.diferenca,
        realizado: melhor.realizado,
      };
    });
}
