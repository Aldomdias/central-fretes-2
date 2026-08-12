const NOMES_MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const NOMES_MES_LONGO = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
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

function formatarMoedaEmail(value) {
  return numero(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
}

function formatarMoedaInteiraEmail(value) {
  return numero(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function formatarMoedaCompactaEmail(value) {
  const total = numero(value);
  const absoluto = Math.abs(total);
  if (absoluto >= 1000000) return `R$ ${(total / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (absoluto >= 1000) return `R$ ${(total / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return formatarMoedaEmail(total);
}

function formatarPercentualEmail(value) {
  return numero(value).toLocaleString('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Monta os dados agregados (visão ano a ano + detalhe do ano mais recente)
 * a partir das linhas cruas de descontos_obtidos_sap (ano, mes, transportadora_nome,
 * valor, regra_aplicada) — mesmo shape retornado por listarResumoDescontosObtidos.
 */
export function gerarDadosEmailDescontosObtidos(linhas = []) {
  const porAno = new Map();
  linhas.forEach((l) => {
    porAno.set(l.ano, (porAno.get(l.ano) || 0) + numero(l.valor));
  });
  const anos = Array.from(porAno.keys()).sort((a, b) => a - b);
  const anoRecente = anos[anos.length - 1];
  const anoAnterior = anos[anos.length - 2];
  const totalRecente = porAno.get(anoRecente) || 0;
  const totalAnterior = anoAnterior != null ? (porAno.get(anoAnterior) || 0) : null;
  const variacaoAnual = totalAnterior ? (totalRecente - totalAnterior) / totalAnterior : null;

  const linhasRecente = linhas.filter((l) => l.ano === anoRecente);
  const mapaMes = new Map();
  for (let m = 1; m <= 12; m += 1) mapaMes.set(m, 0);
  linhasRecente.forEach((l) => mapaMes.set(l.mes, (mapaMes.get(l.mes) || 0) + numero(l.valor)));
  const meses = Array.from(mapaMes.entries())
    .map(([mes, valor]) => ({ mes, mesLabel: `${NOMES_MES_CURTO[mes - 1]}/${anoRecente}`, valor }))
    .filter((linha) => linha.valor > 0);

  const mapaTransp = new Map();
  linhasRecente.forEach((l) => {
    const nome = l.transportadora_nome || 'Não identificado';
    mapaTransp.set(nome, (mapaTransp.get(nome) || 0) + numero(l.valor));
  });
  const transportadoras = Array.from(mapaTransp.entries())
    .map(([nome, valor]) => ({ nome, valor }))
    .sort((a, b) => b.valor - a.valor);
  const top10 = transportadoras.slice(0, 10);
  const concentracaoTop10 = totalRecente
    ? top10.reduce((acc, t) => acc + t.valor, 0) / totalRecente
    : 0;

  const totalPorAno = anos.map((a) => ({ ano: a, valor: porAno.get(a) || 0 }));
  const melhorMes = [...meses].sort((a, b) => b.valor - a.valor)[0] || null;

  const leituraExecutiva = [];
  leituraExecutiva.push(
    `No total, ${escaparHtml(String(anoRecente))} acumula ${formatarMoedaEmail(totalRecente)} em desconto financeiro obtido junto às transportadoras.`
  );
  if (totalAnterior != null) {
    leituraExecutiva.push(
      `Frente a ${anoAnterior} (${formatarMoedaEmail(totalAnterior)}), a variação foi de ${variacaoAnual >= 0 ? '+' : ''}${formatarPercentualEmail(variacaoAnual)}.`
    );
  }
  if (melhorMes) {
    leituraExecutiva.push(`O mês de maior desconto obtido em ${anoRecente} foi ${melhorMes.mesLabel}, com ${formatarMoedaEmail(melhorMes.valor)}.`);
  }
  if (top10.length) {
    leituraExecutiva.push(
      `As 10 maiores transportadoras concentram ${formatarPercentualEmail(concentracaoTop10)} do total do ano, lideradas por ${escaparHtml(top10[0].nome)} (${formatarMoedaEmail(top10[0].valor)}).`
    );
  }

  const dados = {
    anos,
    anoRecente,
    anoAnterior,
    totalRecente,
    totalAnterior,
    variacaoAnual,
    totalPorAno,
    meses,
    melhorMes,
    transportadoras: top10,
    concentracaoTop10,
    leituraExecutiva,
    geradoEm: new Date().toISOString(),
  };
  dados.assunto = `Descontos de Auditoria de Fretes — visão anual e detalhamento de ${anoRecente}`;
  return dados;
}

export function gerarHtmlEmailDescontosObtidos(dados = {}) {
  const maxMes = Math.max(...(dados.meses || []).map((l) => l.valor), 1);
  const barrasMensais = (dados.meses || []).map((linha) => {
    const largura = Math.max((linha.valor / maxMes) * 100, linha.valor ? 2 : 0);
    return `
      <tr>
        <td style="width:70px;padding:8px 10px 8px 0;font-weight:700;color:#111827;">${escaparHtml(linha.mesLabel)}</td>
        <td style="padding:8px 0;">
          <div style="font-size:12px;color:#374151;margin-bottom:4px;">${escaparHtml(formatarMoedaInteiraEmail(linha.valor))}</div>
          <div style="background:#e5e7eb;border-radius:999px;height:10px;"><div style="background:#4a3aa7;border-radius:999px;height:10px;width:${largura.toFixed(1)}%;"></div></div>
        </td>
      </tr>`;
  }).join('');

  const totalPorAno = (dados.totalPorAno || []).map((linha) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;">${escaparHtml(String(linha.ano))}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${escaparHtml(formatarMoedaInteiraEmail(linha.valor))}</td>
    </tr>`).join('');

  const topTransportadoras = (dados.transportadoras || []).map((linha, indice) => `
    <tr>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;">${indice + 1}</td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;font-weight:700;">${escaparHtml(linha.nome)}</td>
      <td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right;color:#047857;font-weight:700;">${escaparHtml(formatarMoedaInteiraEmail(linha.valor))}</td>
    </tr>`).join('');

  const anoRecenteLabel = dados.anoRecente;
  const anoAnteriorLabel = dados.anoAnterior;
  const variacaoTexto = dados.variacaoAnual === null || dados.variacaoAnual === undefined
    ? '—'
    : `${dados.variacaoAnual >= 0 ? '+' : ''}${formatarPercentualEmail(dados.variacaoAnual)}`;
  const corVariacao = (dados.variacaoAnual || 0) >= 0 ? '#047857' : '#b91c1c';

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaparHtml(dados.assunto)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="display:none;max-height:0;overflow:hidden;">Descontos obtidos junto às transportadoras — visão anual e detalhamento de ${escaparHtml(String(anoRecenteLabel))}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="760" cellpadding="0" cellspacing="0" style="width:760px;max-width:96%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="background:#111827;padding:28px 32px;color:#ffffff;">
          <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#93c5fd;font-weight:700;">Descontos de Auditoria de Fretes (SAP)</div>
          <h1 style="margin:8px 0 6px;font-size:25px;line-height:1.25;">Visão anual e detalhamento de ${escaparHtml(String(anoRecenteLabel))}</h1>
          <p style="margin:0;color:#d1d5db;font-size:14px;line-height:1.5;">Descontos obtidos pela auditoria de fretes junto às transportadoras — financeiramente efetivados e comprovados no extrato contábil do SAP.</p>
        </td></tr>
        <tr><td style="padding:26px 32px 10px;">
          <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Bom dia,</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Segue a visão consolidada dos descontos de auditoria de fretes, com o comparativo ano a ano e o detalhamento mês a mês de <strong>${escaparHtml(String(anoRecenteLabel))}</strong>.</p>
        </td></tr>
        <tr><td style="padding:0 32px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${anoAnteriorLabel != null ? `<td style="width:33.3%;padding:8px;"><div style="border:1px solid #e5e7eb;background:#f9fafb;border-radius:14px;padding:16px;"><div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;">Total ${escaparHtml(String(anoAnteriorLabel))}</div><div style="font-size:22px;font-weight:800;color:#111827;margin-top:6px;">${escaparHtml(formatarMoedaCompactaEmail(dados.totalAnterior))}</div></div></td>` : ''}
            <td style="width:33.3%;padding:8px;"><div style="border:1px solid #bbf7d0;background:#f0fdf4;border-radius:14px;padding:16px;"><div style="font-size:12px;color:#047857;font-weight:700;text-transform:uppercase;">Total ${escaparHtml(String(anoRecenteLabel))}</div><div style="font-size:22px;font-weight:800;color:#047857;margin-top:6px;">${escaparHtml(formatarMoedaCompactaEmail(dados.totalRecente))}</div></div></td>
            <td style="width:33.3%;padding:8px;"><div style="border:1px solid #e5e7eb;background:#f9fafb;border-radius:14px;padding:16px;"><div style="font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;">Variação anual</div><div style="font-size:22px;font-weight:800;color:${corVariacao};margin-top:6px;">${escaparHtml(variacaoTexto)}</div></div></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:0 32px 22px;"><div style="border:1px solid #e5e7eb;border-radius:14px;padding:18px;background:#ffffff;">
          <h2 style="margin:0 0 12px;font-size:18px;color:#111827;">Evolução mês a mês em ${escaparHtml(String(anoRecenteLabel))}</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${barrasMensais || '<tr><td style="padding:8px;color:#6b7280;font-size:13px;">Sem lançamentos ainda neste ano.</td></tr>'}</table>
        </div></td></tr>
        <tr><td style="padding:0 32px 22px;">
          <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">Total por ano</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-size:14px;">
            <tr style="background:#f9fafb;"><th align="left" style="padding:10px;border-bottom:1px solid #e5e7eb;">Ano</th><th align="right" style="padding:10px;border-bottom:1px solid #e5e7eb;">Desconto obtido</th></tr>
            ${totalPorAno}
          </table>
        </td></tr>
        <tr><td style="padding:0 32px 22px;">
          <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">Top 10 transportadoras em ${escaparHtml(String(anoRecenteLabel))}</h2>
          <p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#374151;">Concentram aproximadamente <strong>${escaparHtml(formatarPercentualEmail(dados.concentracaoTop10))}</strong> do total do ano.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-size:13px;">
            <tr style="background:#f9fafb;"><th style="padding:9px;border-bottom:1px solid #e5e7eb;">#</th><th align="left" style="padding:9px;border-bottom:1px solid #e5e7eb;">Transportadora</th><th align="right" style="padding:9px;border-bottom:1px solid #e5e7eb;">Desconto obtido</th></tr>
            ${topTransportadoras || '<tr><td colspan="3" style="padding:9px;color:#6b7280;">Sem dados.</td></tr>'}
          </table>
        </td></tr>
        <tr><td style="padding:0 32px 28px;"><div style="border-left:5px solid #4a3aa7;background:#f5f3ff;padding:16px 18px;border-radius:12px;">
          <h2 style="margin:0 0 8px;font-size:17px;color:#111827;">Leitura executiva</h2>
          ${(dados.leituraExecutiva || []).map((frase) => `<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#1f2937;">${frase}</p>`).join('')}
        </div></td></tr>
        <tr><td style="background:#f9fafb;padding:18px 32px;color:#6b7280;font-size:12px;line-height:1.5;">Base: extrato contábil do SAP importado no Central de Fretes. Gerado em ${escaparHtml(new Date(dados.geradoEm || Date.now()).toLocaleString('pt-BR'))}.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function gerarTextoSimplesEmailDescontosObtidos(dados = {}) {
  const linhas = [
    'Bom dia,',
    '',
    `Segue a visão consolidada dos descontos de auditoria de fretes, ano a ano e detalhado em ${dados.anoRecente}.`,
    '',
    `Total ${dados.anoRecente}: ${formatarMoedaEmail(dados.totalRecente)}`,
  ];
  if (dados.anoAnterior != null) {
    linhas.push(`Total ${dados.anoAnterior}: ${formatarMoedaEmail(dados.totalAnterior)}`);
  }
  linhas.push('', 'O detalhamento visual está no corpo HTML gerado pela Central de Fretes.');
  return linhas.join('\n');
}

export async function copiarHtmlEmailDescontosObtidos(html, textoAlternativo = '') {
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

export function baixarHtmlEmailDescontosObtidos(html, nomeArquivo) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function nomeArquivoEmailDescontosObtidos(dados = {}) {
  return `email-descontos-obtidos-${dados.anoRecente || 'atual'}.html`;
}

function textoParaBase64Utf8(texto = '') {
  const bytes = new TextEncoder().encode(String(texto));
  let binario = '';
  bytes.forEach((byte) => { binario += String.fromCharCode(byte); });
  return btoa(binario).replace(/.{1,76}/g, '$&\r\n').trim();
}

function assuntoMime(assunto = '') {
  return `=?UTF-8?B?${textoParaBase64Utf8(assunto).replace(/\s/g, '')}?=`;
}

export function gerarEmlEmailDescontosObtidos(dados = {}, html = '') {
  const boundary = `central-fretes-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const assunto = dados.assunto || 'Descontos de Auditoria de Fretes';
  const texto = gerarTextoSimplesEmailDescontosObtidos(dados);
  const corpoHtml = html || gerarHtmlEmailDescontosObtidos(dados);

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

export function nomeArquivoEmlDescontosObtidos(dados = {}) {
  return `email-descontos-obtidos-outlook-${dados.anoRecente || 'atual'}.eml`;
}

export function baixarEmlOutlookDescontosObtidos(dados = {}, html = '') {
  const eml = gerarEmlEmailDescontosObtidos(dados, html);
  const blob = new Blob([eml], { type: 'message/rfc822;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivoEmlDescontosObtidos(dados);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
