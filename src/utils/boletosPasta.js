// Conferencia da pasta de boletos: cada arquivo se chama "<numero da fatura> - <transportadora>.pdf".
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const soDigitos = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '');
const IGNORAR = new Set(['transportes', 'transporte', 'transportadora', 'logistica', 'ltda', 'eireli', 'cargas', 'carga', 'servicos', 'express', 'encomendas', 'de', 'da', 'do', 'dos', 'das', 'e', 'me', 'sa', 'epp']);
const tokens = (v) => norm(v).split(' ').filter((t) => t.length >= 2 && !IGNORAR.has(t));

// "104682 - TRANSUL.pdf" -> { numero: '104682', transportadora: 'TRANSUL', arquivo }. Sem numero no inicio: null.
export function lerNomeBoleto(nomeArquivo) {
  const base = String(nomeArquivo || '').split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,4}$/i, '').trim();
  const m = base.match(/^(\d+)\s*-?\s*(.*)$/);
  if (!m) return null;
  return { numero: soDigitos(m[1]), transportadora: m[2].trim(), arquivo: nomeArquivo };
}

function nomeCombina(nomeArquivo, transportadoraFatura) {
  const a = tokens(nomeArquivo);
  const b = tokens(transportadoraFatura);
  if (!a.length || !b.length) return false;
  const textoB = ` ${norm(transportadoraFatura)} `;
  return a.some((t) => b.some((u) => u === t || u.startsWith(t) || t.startsWith(u)) || textoB.includes(t));
}

// Retorna { porFatura: Map(faturaId -> {arquivo, certeza}), semFatura: [arquivos], duvidosos: [{arquivo, faturas}] }.
// certeza: 'CONFIRMADO' (numero + transportadora) ou 'SO_NUMERO' (numero bate, nome diferente).
export function casarBoletosComFaturas(nomesArquivos, faturas) {
  const porNumero = new Map();
  (faturas || []).forEach((f) => {
    const n = soDigitos(f.numero_fatura);
    if (!n) return;
    if (!porNumero.has(n)) porNumero.set(n, []);
    porNumero.get(n).push(f);
  });
  const porFatura = new Map();
  const semFatura = [];
  const duvidosos = [];
  (nomesArquivos || []).forEach((arquivo) => {
    const info = lerNomeBoleto(arquivo);
    if (!info) { semFatura.push({ arquivo, motivo: 'Nome fora do padrao (numero - transportadora)' }); return; }
    const candidatas = porNumero.get(info.numero) || [];
    if (!candidatas.length) { semFatura.push({ arquivo, ...info, motivo: 'Fatura nao esta entre as que aguardam boleto' }); return; }
    const combinam = candidatas.filter((f) => nomeCombina(info.transportadora, f.transportadora));
    if (combinam.length === 1) { porFatura.set(String(combinam[0].id), { arquivo, certeza: 'CONFIRMADO' }); return; }
    if (combinam.length > 1) { duvidosos.push({ arquivo, faturas: combinam }); return; }
    if (candidatas.length === 1) { porFatura.set(String(candidatas[0].id), { arquivo, certeza: 'SO_NUMERO' }); return; }
    duvidosos.push({ arquivo, faturas: candidatas });
  });
  return { porFatura, semFatura, duvidosos };
}

// ---- Leitura do conteudo do boleto (linha digitavel: banco, fator de vencimento e valor) ----
// Entre os blocos aceita espaco ou ponto: o OCR de boleto escaneado as vezes le o espaco como ponto.
const RE_LINHA = /(\d{5})[.\s]?(\d{5})[.\s]+(\d{5})[.\s]?(\d{6})[.\s]+(\d{5})[.\s]?(\d{6})[.\s]+(\d)[.\s]+(\d{4})(\d{10})/;

// Fator de vencimento (regra vigente desde 22/02/2025: 1000 = 22/02/2025). Retorna 'AAAA-MM-DD' ou null.
function fatorParaData(fator) {
  const f = Number(fator);
  if (!f) return null;
  const base = Date.UTC(2025, 1, 22);
  return new Date(base + (f - 1000) * 86400000).toISOString().slice(0, 10);
}

// Ultimo bloco da linha digitavel (DV + fator + valor, 1 + 14 digitos), isolado. Usado quando o OCR estraga um
// digito do inicio da linha (ex.: "23790.497?04"): o fim ainda da valor e vencimento.
const RE_FIM_LINHA = /(?:^|[\s.])(\d)\s+(\d{4})(\d{10})(?!\d)/g;
const dataBr = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

// Procura a linha digitavel no texto do PDF e decodifica valor e vencimento.
// Sem a linha completa, aceita so o bloco final quando o vencimento dele aparece escrito no proprio boleto
// (dupla checagem); nesse caso linhaDigitavel volta null e parcial: true.
export function decodificarBoleto(texto) {
  const limpo = String(texto || '').replace(/¦/g, ' ').replace(/[ \t]+/g, ' ');
  const m = limpo.match(RE_LINHA);
  if (m) {
    return {
      linhaDigitavel: `${m[1]}.${m[2]} ${m[3]}.${m[4]} ${m[5]}.${m[6]} ${m[7]} ${m[8]}${m[9]}`,
      banco: m[1].slice(0, 3),
      vencimento: fatorParaData(m[8]),
      valor: Number(m[9]) / 100,
    };
  }
  for (const f of limpo.matchAll(RE_FIM_LINHA)) {
    const vencimento = fatorParaData(f[2]);
    const valor = Number(f[3]) / 100;
    if (vencimento && valor > 0 && limpo.includes(dataBr(vencimento))) {
      return { linhaDigitavel: null, banco: null, vencimento, valor, parcial: true };
    }
  }
  return null;
}

// Boleto sem linha digitavel (PIX / "comprovante de entrega" do SSW etc.): confere se o texto do PDF traz o valor
// e o vencimento da fatura escritos (ex.: "412,32" e "26/11/2026"). Retorna true so com os dois.
export function textoTrazValorEVencimento(texto, fatura) {
  const t = String(texto || '');
  const venc = String(fatura?.data_vencimento || '').slice(0, 10);
  const valor = Number(fatura?.valor_fatura || 0);
  if (!venc || !(valor > 0) || !t.includes(dataBr(venc))) return false;
  const comMilhar = valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const semMilhar = valor.toFixed(2).replace('.', ',');
  const re = (v) => new RegExp(`(^|[^\\d.,])${v.replace(/\./g, '\\.')}(?![\\d])`);
  return re(comMilhar).test(t) || re(semMilhar).test(t);
}

// Fatura cujo numero bateu so pelo numero (transportadora do arquivo diferente): o boleto quase certamente e de
// outra fatura que nao esta no sistema (ex.: "6 - R O C EXPRESSO" x fatura 6 da GRAMADO).
export function nomeDoArquivoCombina(nomeArquivo, transportadoraFatura) {
  const info = lerNomeBoleto(nomeArquivo);
  return Boolean(info) && nomeCombina(info.transportadora, transportadoraFatura);
}

// Le o PDF (pdfjs, no navegador) e devolve { linhaDigitavel, banco, vencimento, valor } ou { erro }.
export async function lerBoletoPdf(arquivo) {
  try {
    const { abrirPdf, paginasDoPdf } = await import('./robos/nfsePdf');
    const paginas = await paginasDoPdf(arquivo);
    const texto = paginas.map((l) => l.join('\n')).join('\n');
    const leitura = decodificarBoleto(texto);
    if (leitura) return { ...leitura, origemLeitura: 'TEXTO' };
    // Digitalizacao ou texto sem linha reconhecivel: tenta OCR local nas paginas, sem enviar o
    // documento para servicos externos.
    const pdf = await abrirPdf(arquivo);
    const { ocrDaPagina } = await import('./robos/nfseOcr');
    const linhasOcr = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      // eslint-disable-next-line no-await-in-loop
      linhasOcr.push(...await ocrDaPagina(pdf, n));
    }
    return decodificarBoleto(linhasOcr.join('\n'))
      ? { ...decodificarBoleto(linhasOcr.join('\n')), origemLeitura: 'OCR' }
      : { erro: texto.trim() ? 'Linha digitável não encontrada após OCR' : 'PDF digitalizado ilegível após OCR', origemLeitura: 'OCR' };
  } catch (e) {
    return { erro: `Falha ao ler PDF: ${e.message}` };
  }
}

// Leitura incremental: arquivo cujo hash (conteudo) ja tem versao gravada reaproveita valor/vencimento/linha
// digitavel e nao passa de novo pelo PDF/OCR. Arquivo novo ou alterado e lido normalmente.
// versoesPorHash: Map(hash -> registro de boleto_arquivo_versoes). leitor: (arquivo) => Promise<leitura>.
export async function lerBoletoIncremental(arquivo, hash, versoesPorHash = new Map(), leitor = lerBoletoPdf) {
  const versao = versoesPorHash.get(hash);
  if (versao && (versao.linha_digitavel || versao.valor != null)) {
    return {
      linhaDigitavel: versao.linha_digitavel || null,
      valor: versao.valor != null ? Number(versao.valor) : null,
      vencimento: versao.vencimento ? String(versao.vencimento).slice(0, 10) : null,
      origemLeitura: versao.origem_leitura || 'CACHE', reaproveitada: true, hash,
    };
  }
  return { ...(await leitor(arquivo)), hash };
}

// Compara o boleto lido com a fatura: [] quando bate, senao lista de divergencias.
export function divergenciasBoleto(leitura, fatura) {
  if (!leitura || leitura.erro) return [];
  const out = [];
  const valorFatura = Number(fatura.valor_fatura || 0);
  if (Math.abs(leitura.valor - valorFatura) > 0.01) out.push('valor');
  const venc = String(fatura.data_vencimento || '').slice(0, 10);
  if (venc && leitura.vencimento && venc !== leitura.vencimento) out.push('vencimento');
  return out;
}
