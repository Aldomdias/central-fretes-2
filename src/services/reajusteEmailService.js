const MESES_LONGOS = [
  'janeiro', 'fevereiro', 'mar\u00e7o', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function numero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escaparHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function mesValido(value) {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(String(value || ''));
}

function mesAnterior(data = new Date()) {
  const ano = data.getFullYear();
  const mes = data.getMonth();
  const anterior = new Date(ano, mes - 1, 1);
  return `${anterior.getFullYear()}-${String(anterior.getMonth() + 1).padStart(2, '0')}`;
}

export function formatarMesLongoEmail(mes = '') {
  if (!mesValido(mes)) return '';
  const [ano, numeroMes] = mes.split('-');
  return `${MESES_LONGOS[Number(numeroMes) - 1]}/${ano}`;
}

export function formatarMoedaEmail(value) {
  return numero(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

export function formatarMoedaCompactaEmail(value) {
  const total = numero(value);
  const absoluto = Math.abs(total);
  if (absoluto >= 1000000) {
    return `R$ ${(total / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  }
  if (absoluto >= 1000) {
    return `R$ ${(total / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  }
  return formatarMoedaEmail(total);
}

export function formatarPercentualEmail(value) {
  return numero(value).toLocaleString('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function obterPeriodoPadraoEmailReajuste(serie = {}, hoje = new Date()) {
  const linhas = (serie.meses || [])
    .filter((linha) => mesValido(linha.mes))
    .sort((a, b) => a.mes.localeCompare(b.mes));
  const ultimoFechado = mesAnterior(hoje);
  const linhasComImpacto = linhas.filter((linha) => (
    numero(linha.impactoRealizadoSolicitado) > 0
    || numero(linha.impactoRealizadoRepassado) > 0
  ));
  const mesesComImpacto = linhasComImpacto.map((linha) => linha.mes);
  const meses = linhas.map((linha) => linha.mes);
  const basePeriodo = mesesComImpacto.length ? mesesComImpacto : meses;
  const mesesFechados = basePeriodo.filter((mes) => mes <= ultimoFechado);
  const elegiveis = mesesFechados.length ? mesesFechados : basePeriodo;
  return {
    mesInicial: elegiveis[0] || '',
    mesFinal: elegiveis.at(-1) || '',
    somenteMesesFechados: true,
  };
}

function classificarCurva(linhas = []) {
  const total = linhas.reduce((acc, linha) => acc + linha.repassado, 0);
  let acumulado = 0;
  return linhas.map((linha) => {
    acumulado += linha.repassado;
    const percentualAcumulado = total ? acumulado / total : 0;
    const curva = percentualAcumulado <= 0.8 ? 'A' : percentualAcumulado <= 0.95 ? 'B' : 'C';
    return { ...linha, curva, percentualAcumulado };
  });
}

function gerarLeituraExecutiva(dados) {
  const frases = [];
  if (dados.melhorMes) {
    frases.push(
      `O maior impacto repassado ocorreu em ${dados.melhorMes.mesLabel}, ` +
      `com ${formatarMoedaEmail(dados.melhorMes.repassado)}.`
    );
  }
  frases.push(
    `No per\u00edodo, a negocia\u00e7\u00e3o conteve ${formatarMoedaEmail(dados.totais.segurado)}, ` +
    `equivalente a ${formatarPercentualEmail(dados.totais.percentualSegurado)} do valor solicitado.`
  );
  const curvaA = dados.transportadoras.filter((linha) => linha.curva === 'A').slice(0, 3);
  if (curvaA.length) {
    frases.push(
      `A Curva A est\u00e1 concentrada em ${curvaA.map((linha) => linha.transportadora).join(', ')}.`
    );
  }
  const ganho = dados.reducoes[0];
  if (ganho?.segurado > 0) {
    frases.push(
      `${ganho.transportadora} apresentou a maior redu\u00e7\u00e3o capturada, ` +
      `com ${formatarMoedaEmail(ganho.segurado)} segurados.`
    );
  }
  return frases;
}

export function gerarDadosEmailReajuste(serie = {}, filtros = {}, hoje = new Date()) {
  const ultimoFechado = mesAnterior(hoje);
  const somenteFechados = filtros.somenteMesesFechados !== false;
  const mesesDisponiveis = (serie.meses || [])
    .filter((linha) => mesValido(linha.mes))
    .sort((a, b) => a.mes.localeCompare(b.mes));
  const padrao = obterPeriodoPadraoEmailReajuste(serie, hoje);
  const mesInicial = mesValido(filtros.mesInicial) ? filtros.mesInicial : padrao.mesInicial;
  const mesFinalInformado = mesValido(filtros.mesFinal) ? filtros.mesFinal : padrao.mesFinal;
  const mesFinal = somenteFechados && mesFinalInformado > ultimoFechado ? ultimoFechado : mesFinalInformado;

  const meses = mesesDisponiveis
    .filter((linha) => (!mesInicial || linha.mes >= mesInicial) && (!mesFinal || linha.mes <= mesFinal))
    .map((linha) => {
      const solicitado = numero(linha.impactoRealizadoSolicitado);
      const repassado = numero(linha.impactoRealizadoRepassado);
      const segurado = Math.max(solicitado - repassado, 0);
      return {
        mes: linha.mes,
        mesLabel: formatarMesLongoEmail(linha.mes),
        solicitado,
        repassado,
        segurado,
        percentualSegurado: solicitado ? segurado / solicitado : 0,
      };
    });

  const totais = meses.reduce((acc, linha) => ({
    solicitado: acc.solicitado + linha.solicitado,
    repassado: acc.repassado + linha.repassado,
    segurado: acc.segurado + linha.segurado,
  }), { solicitado: 0, repassado: 0, segurado: 0 });
  totais.percentualSegurado = totais.solicitado ? totais.segurado / totais.solicitado : 0;

  const porTransportadora = new Map();
  (serie.porItem || [])
    .filter((linha) => (!mesInicial || linha.mes >= mesInicial) && (!mesFinal || linha.mes <= mesFinal))
    .forEach((linha) => {
      const nome = String(linha.transportadora || 'Sem transportadora').trim() || 'Sem transportadora';
      const atual = porTransportadora.get(nome) || {
        transportadora: nome,
        solicitado: 0,
        repassado: 0,
        segurado: 0,
      };
      const solicitado = numero(linha.impactoRealizadoSolicitado);
      const repassado = numero(linha.impactoRealizadoRepassado);
      atual.solicitado += solicitado;
      atual.repassado += repassado;
      atual.segurado += Math.max(solicitado - repassado, 0);
      porTransportadora.set(nome, atual);
    });

  const transportadoras = classificarCurva(
    [...porTransportadora.values()]
      .map((linha) => ({
        ...linha,
        percentualReducao: linha.solicitado ? linha.segurado / linha.solicitado : 0,
      }))
      .sort((a, b) => b.repassado - a.repassado || b.solicitado - a.solicitado)
  );
  const reducoes = [...transportadoras]
    .filter((linha) => linha.segurado > 0)
    .sort((a, b) => b.segurado - a.segurado)
    .slice(0, 8);
  const melhorMes = [...meses].sort((a, b) => b.repassado - a.repassado)[0] || null;

  const dados = {
    mesInicial,
    mesFinal,
    somenteMesesFechados: somenteFechados,
    periodoLabel: mesInicial === mesFinal
      ? formatarMesLongoEmail(mesFinal)
      : `${formatarMesLongoEmail(mesInicial)} a ${formatarMesLongoEmail(mesFinal)}`,
    meses,
    totais,
    transportadoras: transportadoras.slice(0, 10),
    reducoes,
    melhorMes,
    geradoEm: hoje.toISOString(),
  };
  dados.assunto = gerarAssuntoEmailReajuste(dados);
  dados.leituraExecutiva = gerarLeituraExecutiva(dados);
  return dados;
}

export function gerarAssuntoEmailReajuste(dados = {}) {
  return `Impacto dos reajustes de frete - fechado at\u00e9 ${formatarMesLongoEmail(dados.mesFinal)}`;
}

function formatarMesCurtoEmail(mes = '') {
  if (!mesValido(mes)) return '';
  const [ano, numeroMes] = mes.split('-');
  const abreviacoes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${abreviacoes[Number(numeroMes) - 1]}/${ano}`;
}

function formatarMoedaInteiraEmail(value) {
  return numero(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

export function gerarHtmlEmailReajuste(dados = {}) {
  const maxMes = Math.max(...(dados.meses || []).map((linha) => linha.solicitado), 1);
  const barrasMensais = (dados.meses || []).map((linha) => {
    const larguraSolicitado = Math.max((linha.solicitado / maxMes) * 100, linha.solicitado ? 2 : 0);
    const larguraRepassado = Math.max((linha.repassado / maxMes) * 100, linha.repassado ? 2 : 0);
    const larguraSegurado = Math.max((linha.segurado / maxMes) * 100, linha.segurado ? 4 : 0);
    return `
      <tr>
        <td style="width:85px;padding:8px 10px 8px 0;font-weight:700;color:#111827;">${escaparHtml(formatarMesCurtoEmail(linha.mes))}</td>
        <td style="padding:8px 0;">
          <div style="font-size:12px;color:#374151;margin-bottom:4px;">Solicitado &mdash; ${escaparHtml(formatarMoedaInteiraEmail(linha.solicitado))}</div>
          <div style="background:#e5e7eb;border-radius:999px;height:10px;"><div style="background:#2563eb;border-radius:999px;height:10px;width:${larguraSolicitado.toFixed(1)}%;"></div></div>
          <div style="font-size:12px;color:#374151;margin:7px 0 4px;">Repassado &mdash; ${escaparHtml(formatarMoedaInteiraEmail(linha.repassado))}</div>
          <div style="background:#e5e7eb;border-radius:999px;height:10px;"><div style="background:#f97316;border-radius:999px;height:10px;width:${larguraRepassado.toFixed(1)}%;"></div></div>
          <div style="font-size:12px;color:#047857;margin:7px 0 4px;">Segurado &mdash; ${escaparHtml(formatarMoedaInteiraEmail(linha.segurado))}</div>
          <div style="background:#e5e7eb;border-radius:999px;height:10px;"><div style="background:#10b981;border-radius:999px;height:10px;width:${larguraSegurado.toFixed(1)}%;"></div></div>
        </td>
      </tr>`;
  }).join('');

  const resumoMensal = (dados.meses || []).map((linha) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;">${escaparHtml(formatarMesCurtoEmail(linha.mes))}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;">${escaparHtml(formatarMoedaInteiraEmail(linha.solicitado))}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;">${escaparHtml(formatarMoedaInteiraEmail(linha.repassado))}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#047857;font-weight:700;">${escaparHtml(formatarMoedaInteiraEmail(linha.segurado))}</td>
    </tr>`).join('');

  const topTransportadoras = (dados.transportadoras || []).map((linha, indice) => `
    <tr>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;">${indice + 1}</td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;font-weight:700;">${escaparHtml(linha.transportadora)}</td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:center;"><span style="display:inline-block;border-radius:999px;background:${linha.curva === 'A' ? '#fee2e2' : linha.curva === 'B' ? '#fef3c7' : '#e0f2fe'};color:${linha.curva === 'A' ? '#991b1b' : linha.curva === 'B' ? '#92400e' : '#075985'};padding:3px 9px;font-size:12px;font-weight:700;">Curva ${linha.curva}</span></td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right;">${escaparHtml(formatarMoedaInteiraEmail(linha.solicitado))}</td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${escaparHtml(formatarMoedaInteiraEmail(linha.repassado))}</td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right;color:#047857;">${escaparHtml(formatarMoedaInteiraEmail(linha.segurado))}</td>
    </tr>`).join('');

  const reducoes = (dados.reducoes || []).slice(0, 5).map((linha) => `
    <tr>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;font-weight:700;">${escaparHtml(linha.transportadora)}</td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right;">${escaparHtml(formatarMoedaInteiraEmail(linha.solicitado))}</td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right;">${escaparHtml(formatarMoedaInteiraEmail(linha.repassado))}</td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right;color:#047857;font-weight:700;">${escaparHtml(formatarMoedaInteiraEmail(linha.segurado))}</td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right;color:#047857;font-weight:700;">${escaparHtml(formatarPercentualEmail(linha.percentualReducao))}</td>
    </tr>`).join('');

  const concentracaoTop = dados.totais.repassado
    ? (dados.transportadoras || []).reduce((acc, linha) => acc + linha.repassado, 0) / dados.totais.repassado
    : 0;
  const curvaA = (dados.transportadoras || []).filter((linha) => linha.curva === 'A').slice(0, 5);
  const ganhos = (dados.reducoes || []).slice(0, 5);
  const mesFinalLongo = formatarMesLongoEmail(dados.mesFinal);
  const mesFinalNome = mesFinalLongo.split('/')[0] || '';
  const mesesBase = (dados.meses || []).map((linha) => formatarMesLongoEmail(linha.mes)).join(', ');
  const mesAtual = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const observacaoMesAtual = dados.somenteMesesFechados && dados.mesFinal < mesAtual
    ? ` ${formatarMesLongoEmail(mesAtual)} foi desconsiderado por n\u00e3o estar fechado.`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaparHtml(dados.assunto)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="display:none;max-height:0;overflow:hidden;">Resumo dos impactos dos reajustes de frete, fechado at\u00e9 ${escaparHtml(mesFinalLongo)}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="760" cellpadding="0" cellspacing="0" style="width:760px;max-width:96%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="background:#111827;padding:28px 32px;color:#ffffff;">
          <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#93c5fd;font-weight:700;">Reajustes de frete</div>
          <h1 style="margin:8px 0 6px;font-size:25px;line-height:1.25;">Impacto fechado at\u00e9 ${escaparHtml(mesFinalLongo)}</h1>
          <p style="margin:0;color:#d1d5db;font-size:14px;line-height:1.5;">An\u00e1lise dos impactos solicitados, valores repassados e redu\u00e7\u00f5es capturadas nas negocia\u00e7\u00f5es.</p>
        </td></tr>
        <tr><td style="padding:26px 32px 10px;">
          <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Bom dia,</p>
          <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Segue a vis\u00e3o consolidada dos reajustes de frete, considerando ${dados.somenteMesesFechados ? 'somente os meses fechados' : 'o per\u00edodo selecionado'} at\u00e9 <strong>${escaparHtml(mesFinalLongo)}</strong>.</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">O impacto solicitado pelas transportadoras foi de <strong>${escaparHtml(formatarMoedaEmail(dados.totais.solicitado))}</strong>. Ap\u00f3s as negocia\u00e7\u00f5es e limita\u00e7\u00f5es de repasse, o impacto efetivamente repassado ficou em <strong>${escaparHtml(formatarMoedaEmail(dados.totais.repassado))}</strong>, gerando uma conten\u00e7\u00e3o de aproximadamente <strong style="color:#047857;">${escaparHtml(formatarMoedaEmail(dados.totais.segurado))}</strong>, equivalente a <strong>${escaparHtml(formatarPercentualEmail(dados.totais.percentualSegurado))}</strong> do valor solicitado.</p>
        </td></tr>
        <tr><td style="padding:0 32px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="width:33.3%;padding:8px;"><div style="border:1px solid #dbeafe;background:#eff6ff;border-radius:14px;padding:16px;"><div style="font-size:12px;color:#1d4ed8;font-weight:700;text-transform:uppercase;">Solicitado</div><div style="font-size:24px;font-weight:800;color:#111827;margin-top:6px;">${escaparHtml(formatarMoedaCompactaEmail(dados.totais.solicitado))}</div><div style="font-size:12px;color:#374151;margin-top:4px;">Cen\u00e1rio inicial</div></div></td>
            <td style="width:33.3%;padding:8px;"><div style="border:1px solid #fed7aa;background:#fff7ed;border-radius:14px;padding:16px;"><div style="font-size:12px;color:#c2410c;font-weight:700;text-transform:uppercase;">Repassado</div><div style="font-size:24px;font-weight:800;color:#111827;margin-top:6px;">${escaparHtml(formatarMoedaCompactaEmail(dados.totais.repassado))}</div><div style="font-size:12px;color:#374151;margin-top:4px;">Impacto efetivo</div></div></td>
            <td style="width:33.3%;padding:8px;"><div style="border:1px solid #bbf7d0;background:#f0fdf4;border-radius:14px;padding:16px;"><div style="font-size:12px;color:#047857;font-weight:700;text-transform:uppercase;">Segurado</div><div style="font-size:24px;font-weight:800;color:#047857;margin-top:6px;">${escaparHtml(formatarMoedaCompactaEmail(dados.totais.segurado))}</div><div style="font-size:12px;color:#374151;margin-top:4px;">${escaparHtml(formatarPercentualEmail(dados.totais.percentualSegurado))} do solicitado</div></div></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:0 32px 22px;"><div style="border:1px solid #e5e7eb;border-radius:14px;padding:18px;background:#ffffff;">
          <h2 style="margin:0 0 12px;font-size:18px;color:#111827;">Evolu\u00e7\u00e3o m\u00eas a m\u00eas</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${barrasMensais}</table>
          <div style="font-size:12px;color:#6b7280;margin-top:12px;">Azul: solicitado | Laranja: repassado | Verde: impacto segurado.</div>
        </div></td></tr>
        <tr><td style="padding:0 32px 22px;">
          <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">Resumo mensal fechado</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-size:14px;">
            <tr style="background:#f9fafb;"><th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb;">M\u00eas</th><th align="right" style="padding:10px;border-bottom:1px solid #e5e7eb;">Solicitado</th><th align="right" style="padding:10px;border-bottom:1px solid #e5e7eb;">Repassado</th><th align="right" style="padding:10px;border-bottom:1px solid #e5e7eb;">Segurado</th></tr>
            ${resumoMensal}
            <tr style="background:#f9fafb;font-weight:800;"><td style="padding:10px;">Total at\u00e9 ${escaparHtml(mesFinalNome)}</td><td style="padding:10px;text-align:right;">${escaparHtml(formatarMoedaInteiraEmail(dados.totais.solicitado))}</td><td style="padding:10px;text-align:right;">${escaparHtml(formatarMoedaInteiraEmail(dados.totais.repassado))}</td><td style="padding:10px;text-align:right;color:#047857;">${escaparHtml(formatarMoedaInteiraEmail(dados.totais.segurado))}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 32px 22px;">
          <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">Principais respons\u00e1veis pelo impacto repassado</h2>
          <p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#374151;">O top 10 concentra aproximadamente <strong>${escaparHtml(formatarPercentualEmail(concentracaoTop))}</strong> de todo o impacto repassado at\u00e9 ${escaparHtml(mesFinalNome)}, sendo o principal grupo de acompanhamento.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-size:13px;">
            <tr style="background:#f9fafb;"><th style="padding:9px;border-bottom:1px solid #e5e7eb;">#</th><th align="left" style="padding:9px;border-bottom:1px solid #e5e7eb;">Transportadora</th><th style="padding:9px;border-bottom:1px solid #e5e7eb;">Classe</th><th align="right" style="padding:9px;border-bottom:1px solid #e5e7eb;">Solicitado</th><th align="right" style="padding:9px;border-bottom:1px solid #e5e7eb;">Repassado</th><th align="right" style="padding:9px;border-bottom:1px solid #e5e7eb;">Segurado</th></tr>
            ${topTransportadoras}
          </table>
        </td></tr>
        <tr><td style="padding:0 32px 22px;">
          <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">Maiores redu\u00e7\u00f5es capturadas</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-size:13px;">
            <tr style="background:#f9fafb;"><th align="left" style="padding:9px;border-bottom:1px solid #e5e7eb;">Transportadora</th><th align="right" style="padding:9px;border-bottom:1px solid #e5e7eb;">Solicitado</th><th align="right" style="padding:9px;border-bottom:1px solid #e5e7eb;">Repassado</th><th align="right" style="padding:9px;border-bottom:1px solid #e5e7eb;">Segurado</th><th align="right" style="padding:9px;border-bottom:1px solid #e5e7eb;">Redu\u00e7\u00e3o</th></tr>
            ${reducoes}
          </table>
        </td></tr>
        <tr><td style="padding:0 32px 28px;"><div style="border-left:5px solid #2563eb;background:#eff6ff;padding:16px 18px;border-radius:12px;">
          <h2 style="margin:0 0 8px;font-size:17px;color:#111827;">Leitura executiva</h2>
          <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#1f2937;">At\u00e9 ${escaparHtml(mesFinalNome)}, o impacto dos reajustes totalizou <strong>${escaparHtml(formatarMoedaEmail(dados.totais.repassado))}</strong> em valor repassado. Mesmo com o volume solicitado elevado, a negocia\u00e7\u00e3o segurou aproximadamente <strong>${escaparHtml(formatarMoedaEmail(dados.totais.segurado))}</strong> frente ao cen\u00e1rio inicial.</p>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#1f2937;">A recomenda\u00e7\u00e3o \u00e9 manter acompanhamento especial nas transportadoras da Curva A${curvaA.length ? `, principalmente ${escaparHtml(curvaA.map((linha) => linha.transportadora).join(', '))}` : ''}. Em paralelo, os principais ganhos de negocia\u00e7\u00e3o vieram de ${escaparHtml(ganhos.map((linha) => linha.transportadora).join(', ') || 'transportadoras com redu\u00e7\u00e3o capturada')}.</p>
        </div></td></tr>
        <tr><td style="background:#f9fafb;padding:18px 32px;color:#6b7280;font-size:12px;line-height:1.5;">Base considerada: realizado carregado e meses ${dados.somenteMesesFechados ? 'fechados' : 'selecionados'} de ${escaparHtml(mesesBase)}.${escaparHtml(observacaoMesAtual)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function gerarTextoSimplesEmailReajuste(dados = {}) {
  return [
    'Bom dia,',
    '',
    `Segue a vis\u00e3o consolidada dos reajustes de frete at\u00e9 ${formatarMesLongoEmail(dados.mesFinal)}.`,
    '',
    `Solicitado: ${formatarMoedaEmail(dados.totais?.solicitado)}`,
    `Repassado: ${formatarMoedaEmail(dados.totais?.repassado)}`,
    `Segurado: ${formatarMoedaEmail(dados.totais?.segurado)} (${formatarPercentualEmail(dados.totais?.percentualSegurado)})`,
    '',
    'O detalhamento visual est\u00e1 no corpo HTML gerado pela Central de Fretes.',
  ].join('\n');
}

export async function copiarHtmlEmailReajuste(html, textoAlternativo = '') {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([textoAlternativo || html], { type: 'text/plain' }),
      }),
    ]);
    return;
  }

  const container = document.createElement('div');
  container.contentEditable = 'true';
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.innerHTML = html;
  document.body.appendChild(container);
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(container);
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand('copy');
  selection.removeAllRanges();
  container.remove();
}

export function baixarHtmlEmailReajuste(html, nomeArquivo) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function nomeArquivoEmailReajuste(dados = {}) {
  const [ano = '', mes = ''] = String(dados.mesFinal || '').split('-');
  const nomeMes = MESES_LONGOS[Number(mes) - 1] || mes || 'periodo';
  return `email-impacto-reajustes-ate-${nomeMes}-${ano || 'atual'}.html`;
}

function textoParaBase64Utf8(texto = '') {
  const bytes = new TextEncoder().encode(String(texto));
  let binario = '';
  bytes.forEach((byte) => {
    binario += String.fromCharCode(byte);
  });
  return btoa(binario).replace(/.{1,76}/g, '$&\r\n').trim();
}

function assuntoMime(assunto = '') {
  return `=?UTF-8?B?${textoParaBase64Utf8(assunto).replace(/\s/g, '')}?=`;
}

export function gerarEmlEmailReajuste(dados = {}, html = '') {
  const boundary = `central-fretes-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const assunto = dados.assunto || gerarAssuntoEmailReajuste(dados);
  const texto = gerarTextoSimplesEmailReajuste(dados);
  const corpoHtml = html || gerarHtmlEmailReajuste(dados);

  return [
    `Subject: ${assuntoMime(assunto)}`,
    'From:',
    'To:',
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'X-Unsent: 1',
    'Content-Type: multipart/alternative;',
    ` boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    textoParaBase64Utf8(texto),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    textoParaBase64Utf8(corpoHtml),
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export function nomeArquivoEmlReajuste(dados = {}) {
  const [ano = '', mes = ''] = String(dados.mesFinal || '').split('-');
  const nomeMes = MESES_LONGOS[Number(mes) - 1] || mes || 'periodo';
  return `email-impacto-reajustes-outlook-ate-${nomeMes}-${ano || 'atual'}.eml`;
}

export function baixarEmlOutlookReajuste(dados = {}, html = '') {
  const eml = gerarEmlEmailReajuste(dados, html);
  const blob = new Blob([eml], { type: 'message/rfc822;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivoEmlReajuste(dados);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
