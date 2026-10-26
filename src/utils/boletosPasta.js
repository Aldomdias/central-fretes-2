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
const RE_LINHA = /(\d{5})\.?(\d{5})\s+(\d{5})\.?(\d{6})\s+(\d{5})\.?(\d{6})\s+(\d)\s+(\d{4})(\d{10})/;

// Fator de vencimento (regra vigente desde 22/02/2025: 1000 = 22/02/2025). Retorna 'AAAA-MM-DD' ou null.
function fatorParaData(fator) {
  const f = Number(fator);
  if (!f) return null;
  const base = Date.UTC(2025, 1, 22);
  return new Date(base + (f - 1000) * 86400000).toISOString().slice(0, 10);
}

// Procura a linha digitavel no texto do PDF e decodifica valor e vencimento.
export function decodificarBoleto(texto) {
  const m = String(texto || '').replace(/¦/g, ' ').replace(/[ \t]+/g, ' ').match(RE_LINHA);
  if (!m) return null;
  return {
    linhaDigitavel: `${m[1]}.${m[2]} ${m[3]}.${m[4]} ${m[5]}.${m[6]} ${m[7]} ${m[8]}${m[9]}`,
    banco: m[1].slice(0, 3),
    vencimento: fatorParaData(m[8]),
    valor: Number(m[9]) / 100,
  };
}

// Le o PDF (pdfjs, no navegador) e devolve { linhaDigitavel, banco, vencimento, valor } ou { erro }.
export async function lerBoletoPdf(arquivo) {
  try {
    const { paginasDoPdf } = await import('./robos/nfsePdf');
    const paginas = await paginasDoPdf(arquivo);
    const texto = paginas.map((l) => l.join('\n')).join('\n');
    if (!texto.trim()) return { erro: 'PDF sem texto (imagem)' };
    return decodificarBoleto(texto) || { erro: 'Linha digitavel nao encontrada' };
  } catch (e) {
    return { erro: `Falha ao ler PDF: ${e.message}` };
  }
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
