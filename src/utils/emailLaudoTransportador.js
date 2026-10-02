// Gera um arquivo .eml (rascunho) pro laudo que vai pra transportadora.
// "X-Unsent: 1" faz o Outlook abrir o arquivo como e-mail novo, editavel e
// sem destinatario — o auditor so preenche o "Para" e envia. O laudo (HTML)
// ja vai anexado dentro do .eml.

function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

function base64Utf8(texto) {
  const bytes = new TextEncoder().encode(String(texto ?? ''));
  let binario = '';
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + passo));
  }
  return btoa(binario);
}

function quebrarLinhas(b64) {
  return b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

function assuntoCodificado(assunto) {
  return `=?UTF-8?B?${base64Utf8(assunto)}?=`;
}

export function slugArquivoEmail(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40);
}

function passo(numero, titulo, texto) {
  return `<tr>
    <td style="vertical-align:top;padding:8px 10px 8px 0;width:30px"><div style="width:26px;height:26px;border-radius:13px;background:#071d49;color:#fff;font-weight:700;text-align:center;line-height:26px;font-size:13px">${numero}</div></td>
    <td style="padding:8px 0;font-size:14px;color:#1e293b"><strong>${titulo}</strong><br>${texto}</td>
  </tr>`;
}

// resumo: { transportadora, faturas: [{numero, url}], totalCtes, divergentes,
// semCalculo, semEntrega, cobrancaAcima, totalDescontar, geradoEm, assinatura }
export function montarCorpoEmailLaudo(resumo = {}, formatarDinheiro = (v) => String(v)) {
  const faturas = Array.isArray(resumo.faturas) ? resumo.faturas : [];
  const nomeTransp = resumo.transportadora || 'Transportadora';
  const itensResumo = [
    ['Faturas analisadas', faturas.filter((f) => f.numero).map((f) => esc(f.numero)).join(', ') || null],
    ['CT-es no laudo', resumo.totalCtes],
    ['CT-es com divergência de valor', resumo.divergentes],
    ['CT-es sem entrega comprovada', resumo.semEntrega],
    ['Cobrança acima da tabela', resumo.cobrancaAcima == null ? null : formatarDinheiro(resumo.cobrancaAcima)],
    ['Valor a descontar', resumo.totalDescontar == null ? null : formatarDinheiro(resumo.totalDescontar)],
  ].filter(([, v]) => v != null && v !== '');
  const linhasResumo = itensResumo.map(([k, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5ebf5;color:#64748b;font-size:13px">${k}</td><td style="padding:6px 10px;border-bottom:1px solid #e5ebf5;font-weight:700;font-size:13px;text-align:right">${v}</td></tr>`).join('');
  const botoesPortal = faturas.filter((f) => f.url).map((f) => `<a href="${esc(f.url)}" style="display:inline-block;margin:4px 6px 4px 0;background:#0f6b3e;color:#fff;font-weight:700;padding:9px 14px;border-radius:7px;text-decoration:none;font-size:13px">${f.numero ? `Responder fatura ${esc(f.numero)}` : 'Responder o laudo'}</a>`).join('');

  return `<div style="font-family:Arial,sans-serif;color:#061a44;max-width:720px">
  <p style="font-size:14px">Prezados, ${esc(nomeTransp)},</p>
  <p style="font-size:14px;line-height:1.5">Segue em anexo o <strong>laudo de auditoria</strong> das faturas abaixo, com a conferência do frete cobrado versus a tabela contratada e a situação de entrega dos CT-es. Pedimos a análise e o retorno, <strong>por fatura</strong>, para que possamos liberar o pagamento.</p>

  <table style="border-collapse:collapse;width:100%;max-width:520px;border:1px solid #d6e0ef;margin:14px 0">${linhasResumo}</table>

  ${botoesPortal ? `<p style="font-size:14px;margin:14px 0 4px"><strong>Acesso direto para responder (sem precisar abrir o anexo):</strong></p><div>${botoesPortal}</div>` : ''}

  <h3 style="font-size:16px;margin:22px 0 6px;color:#071d49">Como analisar o laudo — passo a passo</h3>
  <table style="border-collapse:collapse;width:100%">
    ${passo(1, 'Abra o anexo', 'Salve o arquivo <b>.html</b> anexo e abra no seu navegador (Chrome, Edge). Ele funciona normalmente, sem instalar nada.')}
    ${passo(2, 'Veja o resumo no topo', 'Os cartões mostram quantos CT-es estão divergentes, o valor cobrado acima e o total a descontar. Se houver um aviso em vermelho, são CT-es <b>sem entrega comprovada</b>.')}
    ${passo(3, 'Clique na fatura', 'Clicando em cima da linha da fatura, abre a lista de todos os CT-es dela.')}
    ${passo(4, 'Clique no CT-e para ver o detalhe', 'Clicando em um CT-e abre o <b>cálculo completo</b>: tabela aplicada, peso, base do frete, taxas (GRIS, pedágio, etc.), ICMS e a diferença para o que foi cobrado. É aí que você confere onde está a divergência.')}
    ${passo(5, 'Use os filtros', 'Em “Situação” escolha <b>Somente divergentes</b> para ver apenas o que precisa de atenção. Também dá para buscar por fatura ou origem e exportar tudo para Excel.')}
    ${passo(6, 'Concorda com o laudo?', 'Clique em <b>“OK, confirmar”</b> na linha da fatura (ou em <b>“OK, confirmar todas as pendentes”</b> informando nome e e-mail). Sua confirmação fica registrada e liberamos a fatura.')}
    ${passo(7, 'Não concorda? Justifique', 'Clique em <b>“Contestar”</b>. Abre uma página onde, para cada CT-e, você informa se concorda ou não e escreve o <b>motivo/justificativa</b>.')}
    ${passo(8, 'CT-e sem entrega? Anexe o comprovante', 'No botão <b>“Responder entregas”</b> você informa a situação de cada CT-e, escreve a justificativa (ex.: entregue em dd/mm, recebido por fulano) e <b>anexa o comprovante de entrega</b> (canhoto, POD ou planilha).')}
  </table>

  <div style="margin:18px 0;padding:12px 14px;background:#eff6ff;border-radius:8px;color:#1e3a8a;font-size:13px;line-height:1.5">
    <strong>Importante:</strong> o pagamento da fatura só é liberado com <b>todos os CT-es entregues</b> e as divergências de valor resolvidas. Toda resposta (confirmação, contestação ou comprovante) é conferida pelo nosso time de auditoria.
  </div>

  <p style="font-size:14px">Em caso de dúvida, é só responder este e-mail.</p>
  <p style="font-size:14px;margin-top:18px">Atenciosamente,<br>${esc(resumo.assinatura || 'Equipe de Auditoria de Fretes')}</p>
  <p style="font-size:11px;color:#94a3b8;margin-top:18px">Laudo gerado em ${esc(resumo.geradoEm || new Date().toLocaleString('pt-BR'))}.</p>
</div>`;
}

export function montarEml({ assunto, corpoHtml, anexoHtml, anexoNome }) {
  const limite = `----=_Laudo_${Date.now().toString(36)}`;
  const partes = [
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    `Subject: ${assuntoCodificado(assunto)}`,
    `Content-Type: multipart/mixed; boundary="${limite}"`,
    '',
    `--${limite}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    quebrarLinhas(base64Utf8(`<!doctype html><html><head><meta charset="utf-8"></head><body>${corpoHtml}</body></html>`)),
  ];
  if (anexoHtml) {
    partes.push(
      `--${limite}`,
      `Content-Type: text/html; charset="UTF-8"; name="${anexoNome}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${anexoNome}"`,
      '',
      quebrarLinhas(base64Utf8(anexoHtml)),
    );
  }
  partes.push(`--${limite}--`, '');
  return partes.join('\r\n');
}
