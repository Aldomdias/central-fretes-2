// Robo local de boletos: le a pasta sincronizada do SharePoint ("Verum protocolo - Boletos"), confere cada PDF
// com a fatura liberada e guarda o boleto no sistema (mesmo registro do botao "Conferir pasta de boletos").
//
// Uso:  node scripts/robo-boletos-pasta.mjs            -> confere e guarda
//       node scripts/robo-boletos-pasta.mjs --simular  -> so mostra o que faria, nao grava nada
// Pasta: variavel BOLETOS_PASTA ou o padrao abaixo. Log em logs/robo-boletos/AAAA-MM-DD.log.
//
// Regra (automatico, sem ninguem olhando, entao conservador):
// - so considera faturas que aguardam boleto (liberadas, nao pagas, fora de antecipacao);
// - acha a fatura pelo numero do nome do arquivo; se houver mais de uma, desempata pelo nome da transportadora
//   e depois pelo VALOR lido no boleto;
// - so guarda quando valor e vencimento do boleto batem com a fatura; o resto fica listado para o painel.
// - fecha o ciclo no Diagnostico: fatura LANCADA (partida/lancamento), em aberto, com boleto guardado (pelo robo ou
//   pelo painel) e sem encaminhamento vira "Encaminhada ao financeiro - Boleto na pasta" (mesma marcacao do
//   Diagnostico). Encaminhamento ja feito (ex.: dados bancarios) nunca e sobrescrito.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { casarBoletosComFaturas, decodificarBoleto, divergenciasBoleto, lerNomeBoleto } from '../src/utils/boletosPasta.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIMULAR = process.argv.includes('--simular');
const PASTA = process.env.BOLETOS_PASTA || path.join(process.env.USERPROFILE || '', 'CantuStore', 'Gestão de Documentos - Verum protocolo - Boletos');
const USUARIO = 'Robo Boletos (PC)';
const STATUS_EXIGE_BOLETO = ['PRONTA_PARA_PAGAMENTO', 'LIBERADA_COM_DESCONTO', 'ENVIADA_AO_FINANCEIRO'];
// A pasta e esvaziada depois de processada: o boleto de fatura ainda em auditoria tambem e guardado agora e passa a
// contar quando a fatura for liberada. Canceladas, substituidas e pagas ficam de fora.
const STATUS_AINDA_EM_AUDITORIA = ['RECEBIDA', 'COM_DIVERGENCIA', 'REAUDITADA_CENTRAL', 'AGUARDANDO_TRANSPORTADORA'];
const STATUS_CANDIDATAS = [...STATUS_EXIGE_BOLETO, ...STATUS_AINDA_EM_AUDITORIA];
const STATUS_PAGAS = ['PAGA', 'PAGA_COM_DESCONTO', 'PAGA_COM_DIVERGENCIA'];
const BUCKET = 'boletos-financeiro';

const faturaPaga = (f) => STATUS_PAGAS.includes(f.status) || Boolean(f.data_pagamento) || Number(f.valor_pago || 0) > 0
  || String(f.partida || '').trim().startsWith('200');
const emAntecipacao = (f) => /cess/i.test(String(f.atribuicao_sap || '').normalize('NFD').replace(/[̀-ͯ]/g, '')) && !faturaPaga(f);
const dinheiro = (v) => (v == null ? '-' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const nomeSeguro = (n) => String(n || 'boleto.pdf').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');

// ---- log ----
const pastaLog = path.join(RAIZ, 'logs', 'robo-boletos');
fs.mkdirSync(pastaLog, { recursive: true });
const arqLog = path.join(pastaLog, `${new Date().toISOString().slice(0, 10)}.log`);
const linhasLog = [];
const log = (msg) => {
  const l = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
  linhasLog.push(l);
  console.log(l);
};
const fecharLog = () => fs.appendFileSync(arqLog, `${linhasLog.join('\n')}\n\n`);

function lerEnv() {
  const env = {};
  ['.env', '.env.local'].forEach((nome) => {
    const p = path.join(RAIZ, nome);
    if (!fs.existsSync(p)) return;
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((l) => {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[2]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  });
  return env;
}

// ---- leitura do PDF: texto primeiro; sem linha digitavel (boleto escaneado), OCR local (tesseract) ----
let pdfjs = null;
async function abrirPdf(bytes) {
  if (!pdfjs) {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(RAIZ, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')).href;
  }
  return pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
}

// Mesmo motor do painel (tesseract, idioma por de public/ocr), tudo no PC: o boleto nao sai para servico externo.
let promessaOcr = null;
function obterOcr() {
  if (!promessaOcr) {
    promessaOcr = import('tesseract.js').then(({ createWorker }) => createWorker('por', 1, {
      langPath: path.join(RAIZ, 'public', 'ocr', 'lang'), gzip: true, cachePath: path.join(RAIZ, 'logs', 'ocr-cache'),
    }));
  }
  return promessaOcr;
}
async function encerrarOcr() {
  if (promessaOcr) await (await promessaOcr.catch(() => null))?.terminate();
  promessaOcr = null;
}

async function ocrDoPdf(bytes) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const doc = await abrirPdf(bytes);
  const worker = await obterOcr();
  const partes = [];
  for (let n = 1; n <= Math.min(doc.numPages, 3); n += 1) {
    // eslint-disable-next-line no-await-in-loop
    const pag = await doc.getPage(n);
    const vp = pag.getViewport({ scale: 3 });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // eslint-disable-next-line no-await-in-loop
    await pag.render({ canvasContext: ctx, viewport: vp }).promise;
    // eslint-disable-next-line no-await-in-loop
    const { data } = await worker.recognize(canvas.toBuffer('image/png'));
    partes.push(data.text || '');
    if (decodificarBoleto(partes.join('\n'))) break;
  }
  await doc.destroy();
  return partes.join('\n');
}

async function lerBoleto(bytes) {
  const leitura = decodificarBoleto(await textoDoPdf(bytes));
  if (leitura) return { ...leitura, origemLeitura: 'TEXTO' };
  const viaOcr = decodificarBoleto(await ocrDoPdf(bytes));
  if (viaOcr) return { ...viaOcr, origemLeitura: 'OCR' };
  return { erro: 'linha digitavel nao encontrada nem por OCR (conferir no painel)' };
}

async function textoDoPdf(bytes) {
  const doc = await abrirPdf(bytes);
  const partes = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    // eslint-disable-next-line no-await-in-loop
    const pag = await doc.getPage(n);
    // eslint-disable-next-line no-await-in-loop
    const conteudo = await pag.getTextContent();
    partes.push(conteudo.items.map((i) => i.str).join(' '));
  }
  await doc.destroy();
  return partes.join('\n');
}

// Registro da rodada (card Automacao > Robo de boletos). Sem a migration 20261125_012 a coluna detalhe nao existe:
// grava sem ela para o historico continuar.
let clienteRodada = null;
async function registrarRodada(payload) {
  if (!clienteRodada) return;
  const base = { origem: 'ROBO_PC', executado_por: USUARIO, total_arquivos: 0, novos: 0, repetidos: 0, ...payload };
  const { error } = await clienteRodada.from('boleto_pasta_leituras').insert(base);
  if (error && /detalhe/i.test(error.message || '')) {
    const { detalhe, ...semDetalhe } = base;
    await clienteRodada.from('boleto_pasta_leituras').insert(semDetalhe);
  }
}

// Fatura lancada e em aberto com boleto guardado -> encaminhada ao financeiro (BOLETO_NA_PASTA), igual ao botao do
// Diagnostico (marcarEncaminhamentoFinanceiro): grava na fatura, no historico de encaminhamentos e no da fatura.
async function encaminharComBoleto(sb) {
  const controle = (await buscarTodas(() => sb.from('fatura_boleto_controle').select('fatura_id,boleto_arquivo_nome,boleto_valor').eq('status', 'NA_PASTA').order('fatura_id')))
    .filter((c) => c.boleto_arquivo_nome);
  const porId = new Map(controle.map((c) => [String(c.fatura_id), c]));
  const ids = [...porId.keys()];
  const alvos = [];
  for (let i = 0; i < ids.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await sb.from('faturas')
      .select('id,numero_fatura,transportadora,status,partida,lancamento_financeiro,encaminhado_financeiro_em,data_pagamento,valor_pago')
      .in('id', ids.slice(i, i + 200));
    if (error) { log(`Encaminhamento nao verificado: ${error.message}`); return []; }
    (data || []).forEach((f) => {
      if (f.encaminhado_financeiro_em || faturaPaga(f) || ['CANCELADA', 'SUBSTITUIDA'].includes(f.status)) return;
      if (!(f.partida || f.lancamento_financeiro)) return; // ainda nao lancada: espera o lancamento
      alvos.push(f);
    });
  }
  const linhas = alvos.map((f) => `fatura ${f.numero_fatura} ${f.transportadora} (${porId.get(String(f.id)).boleto_arquivo_nome})`);
  if (SIMULAR || !alvos.length) return linhas;
  const agora = new Date().toISOString();
  const feitas = [];
  for (const f of alvos) {
    const evidencia = `Boleto na pasta: ${porId.get(String(f.id)).boleto_arquivo_nome}`;
    // So grava se continuar sem encaminhamento (alguem pode ter marcado no meio da rodada).
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await sb.from('faturas').update({
      encaminhado_financeiro_em: agora, encaminhado_financeiro_por: USUARIO, encaminhamento_tipo: 'BOLETO_NA_PASTA', encaminhamento_evidencia: evidencia,
    }).eq('id', f.id).is('encaminhado_financeiro_em', null).select('id');
    if (error) { log(`Erro ao encaminhar fatura ${f.numero_fatura}: ${error.message}`); continue; }
    if (!data?.length) continue;
    // eslint-disable-next-line no-await-in-loop
    await sb.from('financeiro_encaminhamentos').update({ ativo: false }).eq('fatura_id', f.id).eq('ativo', true);
    // eslint-disable-next-line no-await-in-loop
    await sb.from('financeiro_encaminhamentos').insert({ fatura_id: f.id, tipo: 'BOLETO_NA_PASTA', responsavel: USUARIO, evidencia, ativo: true, created_at: agora });
    // eslint-disable-next-line no-await-in-loop
    await sb.from('auditoria_fatura_historico').insert({
      id: crypto.randomUUID(), fatura_id: f.id, created_at: agora, acao: 'ENCAMINHADA_FINANCEIRO',
      descricao: `Encaminhada ao financeiro (Boleto na pasta) pelo robo de boletos: ${porId.get(String(f.id)).boleto_arquivo_nome}.`, usuario_nome: USUARIO, usuario_email: '',
    });
    feitas.push(`fatura ${f.numero_fatura} ${f.transportadora} (${porId.get(String(f.id)).boleto_arquivo_nome})`);
  }
  return feitas;
}

async function buscarTodas(consulta) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await consulta().range(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  log(`Inicio${SIMULAR ? ' (SIMULACAO, nada sera gravado)' : ''}. Pasta: ${PASTA}`);
  if (!fs.existsSync(PASTA)) throw new Error('Pasta nao encontrada. O OneDrive da empresa esta sincronizando?');
  const env = lerEnv();
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ausentes no .env');
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  clienteRodada = sb;

  const nomes = fs.readdirSync(PASTA).filter((n) => /\.pdf$/i.test(n));
  log(`${nomes.length} PDF(s) na pasta.`);

  const faturas = (await buscarTodas(() => sb.from('faturas')
    .select('id,numero_fatura,transportadora,valor_fatura,data_vencimento,status,data_pagamento,valor_pago,partida,atribuicao_sap')
    .in('status', STATUS_CANDIDATAS).order('id')))
    .filter((f) => !faturaPaga(f) && !emAntecipacao(f));
  const controle = await buscarTodas(() => sb.from('fatura_boleto_controle').select('*').order('fatura_id'));
  const controlePorFatura = new Map(controle.map((c) => [String(c.fatura_id), c]));
  // Boleto guardado antes da liberacao e fatura liberada com desconto: o valor do boleto pode nao valer mais.
  const avisosDesconto = faturas
    .filter((f) => f.status === 'LIBERADA_COM_DESCONTO')
    .map((f) => ({ f, c: controlePorFatura.get(String(f.id)) }))
    .filter(({ f, c }) => c?.boleto_valor != null && Math.abs(Number(c.boleto_valor) - Number(f.valor_fatura || 0)) > 0.01)
    .map(({ f, c }) => `fatura ${f.numero_fatura} ${f.transportadora}: liberada com desconto, boleto guardado ${dinheiro(c.boleto_valor)} x fatura ${dinheiro(f.valor_fatura)} (${c.boleto_arquivo_nome || ''})`);
  const versoes = await buscarTodas(() => sb.from('boleto_arquivo_versoes').select('fatura_id,hash_conteudo,arquivo_path,linha_digitavel,valor,vencimento,origem_leitura').order('created_at'));
  const versaoPorHash = new Map(versoes.map((v) => [v.hash_conteudo, v]));
  const nLiberadas = faturas.filter((f) => STATUS_EXIGE_BOLETO.includes(f.status)).length;
  log(`${faturas.length} fatura(s) candidatas (${nLiberadas} liberadas aguardando boleto, ${faturas.length - nLiberadas} ainda em auditoria); ${controle.length} ja com controle.`);

  const casamento = casarBoletosComFaturas(nomes, faturas);
  const faturaPorId = new Map(faturas.map((f) => [String(f.id), f]));
  const candidatosPorArquivo = new Map();
  casamento.porFatura.forEach((v, id) => candidatosPorArquivo.set(v.arquivo, { faturas: [faturaPorId.get(id)], certeza: v.certeza }));
  casamento.duvidosos.forEach((d) => candidatosPorArquivo.set(d.arquivo, { faturas: d.faturas, certeza: 'DUVIDA' }));

  const res = { guardados: [], jaGuardados: [], revisar: [], foraDoSistema: [] };
  const linhasVistas = new Map();
  const faturasUsadas = new Set();

  for (const nome of nomes) {
    const cand = candidatosPorArquivo.get(nome);
    if (!cand) {
      const info = lerNomeBoleto(nome);
      res.foraDoSistema.push(`${nome} — ${info ? 'nenhuma fatura em aberto com esse numero' : 'nome fora do padrao "numero - transportadora"'}`);
      continue;
    }
    const caminho = path.join(PASTA, nome);
    const bytes = fs.readFileSync(caminho); // arquivo "so online" e baixado pelo OneDrive nesta leitura
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    let leitura;
    const cache = versaoPorHash.get(hash);
    if (cache && (cache.linha_digitavel || cache.valor != null)) {
      leitura = { linhaDigitavel: cache.linha_digitavel, valor: cache.valor != null ? Number(cache.valor) : null, vencimento: cache.vencimento ? String(cache.vencimento).slice(0, 10) : null, origemLeitura: cache.origem_leitura || 'CACHE' };
    } else {
      try {
        // eslint-disable-next-line no-await-in-loop
        leitura = await lerBoleto(bytes);
      } catch (e) {
        leitura = { erro: `falha ao ler PDF: ${e.message}` };
      }
    }
    if (leitura.erro) { res.revisar.push(`${nome} — ${leitura.erro}`); continue; }

    // Desempate: entre as candidatas, as que batem valor e vencimento.
    const batem = cand.faturas.filter((f) => !divergenciasBoleto(leitura, f).length);
    if (batem.length !== 1) {
      const quais = cand.faturas.map((f) => `${f.numero_fatura} ${f.transportadora} ${dinheiro(f.valor_fatura)} venc ${String(f.data_vencimento || '').slice(0, 10)}`).join(' | ');
      res.revisar.push(`${nome} — boleto ${dinheiro(leitura.valor)} venc ${leitura.vencimento}: ${batem.length ? 'mais de uma fatura bate' : 'valor/vencimento nao batem'} (${quais})`);
      continue;
    }
    const fatura = batem[0];
    const id = String(fatura.id);
    if (leitura.linhaDigitavel && linhasVistas.has(leitura.linhaDigitavel)) { res.revisar.push(`${nome} — boleto repetido (igual a ${linhasVistas.get(leitura.linhaDigitavel)})`); continue; }
    if (leitura.linhaDigitavel) linhasVistas.set(leitura.linhaDigitavel, nome);
    if (faturasUsadas.has(id)) { res.revisar.push(`${nome} — outro arquivo ja casou com a fatura ${fatura.numero_fatura}`); continue; }
    faturasUsadas.add(id);

    const atual = controlePorFatura.get(id);
    if (atual?.boleto_arquivo_path && atual.boleto_linha_digitavel && atual.boleto_linha_digitavel === leitura.linhaDigitavel) {
      res.jaGuardados.push(`${nome} -> fatura ${fatura.numero_fatura}`);
      continue;
    }
    const resumo = `${nome} -> fatura ${fatura.numero_fatura} ${fatura.transportadora} (${dinheiro(leitura.valor)}, venc ${leitura.vencimento})${cand.certeza !== 'CONFIRMADO' ? ' [achada pelo valor]' : ''}${STATUS_EXIGE_BOLETO.includes(fatura.status) ? '' : ` [antecipado: fatura ${fatura.status}]`}`;
    if (SIMULAR) { res.guardados.push(resumo); continue; }

    // Mesmo fluxo do guardarBoletos do painel: sobe o PDF, grava o controle e a versao.
    const existente = versoes.find((v) => v.hash_conteudo === hash && String(v.fatura_id) === id);
    const reaproveitar = Boolean(existente?.arquivo_path);
    const arquivoPath = reaproveitar ? existente.arquivo_path : `${id}/${Date.now()}-${nomeSeguro(nome)}`;
    if (!reaproveitar) {
      // eslint-disable-next-line no-await-in-loop
      const { error } = await sb.storage.from(BUCKET).upload(arquivoPath, bytes, { upsert: false, contentType: 'application/pdf' });
      if (error) { res.revisar.push(`${nome} — erro ao subir o PDF: ${error.message}`); continue; }
    }
    const registro = {
      fatura_id: id, numero_fatura: fatura.numero_fatura || null, transportadora: fatura.transportadora || null,
      status: 'NA_PASTA', metodo: 'PASTA', confirmado_por: USUARIO, confirmado_email: '', confirmado_em: new Date().toISOString(),
      boleto_arquivo_nome: nome, boleto_arquivo_path: arquivoPath, boleto_valor: leitura.valor ?? null,
      boleto_vencimento: leitura.vencimento ?? null, boleto_linha_digitavel: leitura.linhaDigitavel ?? null,
      boleto_apagado_em: null, boleto_apagado_motivo: null,
      // O arquivo ja esta na pasta do financeiro: nao precisa ser copiado de novo pelo painel.
      boleto_copiado_em: new Date().toISOString(), boleto_copiado_por: USUARIO,
    };
    // eslint-disable-next-line no-await-in-loop
    const { error: erroCtrl } = await sb.from('fatura_boleto_controle').upsert(registro, { onConflict: 'fatura_id' });
    if (erroCtrl) {
      // eslint-disable-next-line no-await-in-loop
      if (!reaproveitar) await sb.storage.from(BUCKET).remove([arquivoPath]);
      res.revisar.push(`${nome} — erro ao gravar o controle: ${erroCtrl.message}`);
      continue;
    }
    if (!reaproveitar) {
      // eslint-disable-next-line no-await-in-loop
      await sb.from('boleto_arquivo_versoes').insert({
        fatura_id: id, hash_conteudo: hash, nome_arquivo: nome, arquivo_path: arquivoPath, valor: leitura.valor ?? null,
        vencimento: leitura.vencimento ?? null, linha_digitavel: leitura.linhaDigitavel ?? null, origem_leitura: leitura.origemLeitura || null,
        status_vinculo: 'LOCALIZADO_NA_PASTA', campos_comparados: { referencia: true, valor: true, vencimento: true },
        candidatos: [], confirmado_manualmente: false, confirmado_por: USUARIO,
      });
    }
    res.guardados.push(resumo);
  }

  const encaminhadas = await encaminharComBoleto(sb);

  log(`GUARDADOS ${SIMULAR ? '(simulado) ' : ''}${res.guardados.length}:`); res.guardados.forEach((l) => log(`  + ${l}`));
  log(`JA GUARDADOS ${res.jaGuardados.length}:`); res.jaGuardados.forEach((l) => log(`  = ${l}`));
  log(`PARA REVISAR NO PAINEL ${res.revisar.length}:`); res.revisar.forEach((l) => log(`  ! ${l}`));
  log(`BOLETO ANTECIPADO x DESCONTO ${avisosDesconto.length}:`); avisosDesconto.forEach((l) => log(`  ! ${l}`));
  log(`SEM FATURA CANDIDATA ${res.foraDoSistema.length}:`); res.foraDoSistema.forEach((l) => log(`  - ${l}`));
  log(`ENCAMINHADAS AO FINANCEIRO (boleto na pasta) ${SIMULAR ? '(simulado) ' : ''}${encaminhadas.length}:`); encaminhadas.forEach((l) => log(`  > ${l}`));

  if (!SIMULAR) {
    await registrarRodada({
      status: 'SUCESSO', total_arquivos: nomes.length, novos: res.guardados.length, repetidos: res.jaGuardados.length,
      erro: res.revisar.length ? `${res.revisar.length} para revisar` : null,
      detalhe: { guardados: res.guardados, revisar: res.revisar, foraDoSistema: res.foraDoSistema, avisosDesconto, encaminhadas, jaGuardados: res.jaGuardados.length },
    });
  }
}

main()
  .catch(async (e) => {
    log(`FALHA: ${e.message}`);
    process.exitCode = 1;
    if (!SIMULAR) await registrarRodada({ status: 'FALHA', erro: e.message }).catch(() => {});
  })
  .finally(async () => { await encerrarOcr().catch(() => {}); fecharLog(); });
