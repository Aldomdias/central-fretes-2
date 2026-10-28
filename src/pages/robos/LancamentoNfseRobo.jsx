import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CABECALHO_ENVIAR_NFSE,
  CABECALHO_PENDENTES_NFSE,
  CABECALHO_MODELO_NFSE,
  EXEMPLO_MODELO_NFSE,
  aplicarLog,
  aplicarResultado,
  lerLogLancamento,
  lerPendencias,
  entradaVazia,
  lerEntradaNfse,
  linhasEnviarNfse,
  linhasPendentesNfse,
  motivoCurto,
  linhasParaScriptNfse,
  montarLancamentoNfse,
  novaEntradaNfse,
} from '../../utils/robos/lancamentoNfse';
import {
  abaParaMatriz,
  baixarMatrizXlsx,
  baixarXlsx,
  carregarParametros,
  criarIndices,
  hojeIso,
  naoAntesDeHoje,
  isoParaBr,
  normalizarCnpj,
  numeroPlanilha,
  lerPlanilhaArquivo,
  lerResultadoCsv,
  tsvParaMatriz,
  valorParaSap,
} from '../../utils/robos/lancamentoComum';
import { gerarScriptNfse } from '../../utils/robos/sapLancamentoVbs';
import { registrarLancamentos } from '../../services/robosLancamentosService';
import { buscarNaFila, salvarNaFila } from '../../services/robosFilaService';
import { CHAVE_LOTE_NFSE, itemFilaNfse, numerosDaFila } from '../../utils/robos/filaRobo';
import { getSupabaseAcessoPublico } from '../../lib/supabaseClient';
import AvisoFila from './AvisoFila';
import { carregarSessao } from '../../utils/authLocal';
import ParametrosLancamentoCard from './ParametrosLancamentoCard';
import { nfComSufixoF } from '../../utils/robos/nfsePdf';
import ScriptParaCopiar from './ScriptParaCopiar';
import { BaixarPlanilhaRobo, passosMacroExcel } from './MacroExcel';
import { gerarMacroNfse, matrizDadosMacro } from '../../utils/robos/sapMacroExcel';

const CHAVE_LOTE = CHAVE_LOTE_NFSE;

function ler(chave, padrao) {
  try { return JSON.parse(window.localStorage.getItem(chave) || 'null') ?? padrao; } catch { return padrao; }
}
function gravar(chave, valor) {
  try { window.localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem localStorage */ }
}

let contadorUid = 0;
const novoUid = () => { contadorUid += 1; return `u${Date.now().toString(36)}${contadorUid}`; };

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const moeda = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const passoStyle = { display: 'flex', gap: 12, alignItems: 'flex-start' };
const numStyle = { width: 26, height: 26, borderRadius: '50%', background: '#0f172a', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flex: '0 0 auto' };
const th = { textAlign: 'left', padding: '6px 6px', fontSize: 11, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#f8fafc' };
const td = { padding: '3px 4px', fontSize: 12, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' };
const inp = { padding: '4px 5px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' };
const calc = { ...td, color: '#334155', background: '#f8fafc' };

// Campos digitaveis da grade, na ordem das colunas (e da antiga aba "Preencher Dados").
const COLUNAS = [
  { campo: 'nf', titulo: 'NF', w: 78 },
  { campo: 'transportadora', titulo: 'Transportadora', w: 150 },
  { campo: 'cnpjTransp', titulo: 'CNPJ Transp', w: 128 },
  { campo: 'dataEmissao', titulo: 'Data emissão', w: 122, tipo: 'date' },
  { campo: 'valor', titulo: 'Valor', w: 82 },
  { campo: 'codImp', titulo: 'Cod', w: 46, maiusc: true },
  { campo: 'cfop', titulo: 'CFOP', w: 70, maiusc: true },
  { campo: 'cnpjTomador', titulo: 'CNPJ Tomador', w: 128, lista: 'dl-filiais' },
  { campo: 'escrV', titulo: 'EscrV', w: 60, maiusc: true, listaEmp: true },
  { campo: 'fatura', titulo: 'Fatura', w: 70 },
  { campo: 'vencimento', titulo: 'Vencimento', w: 122, tipo: 'date' },
];

export default function LancamentoNfseRobo() {
  const inicial = useMemo(() => ler(CHAVE_LOTE, {}), []);
  const [parametros, setParametros] = useState(carregarParametros);
  const [entradas, setEntradas] = useState(() => (inicial.entradas || []).map((e) => ({ ...novaEntradaNfse(e.uid || novoUid()), ...e })));
  const [manuais, setManuais] = useState(inicial.manuais || {});
  const [vencimento, setVencimento] = useState(naoAntesDeHoje(inicial.vencimento));
  const [colado, setColado] = useState('');
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');
  const [focar, setFocar] = useState(null);
  const [scriptTela, setScriptTela] = useState(null); // script aberto na tela para copiar
  const refArquivo = useRef(null);
  const refResultado = useRef(null);
  const refPdf = useRef(null);
  const [falhasPdf, setFalhasPdf] = useState([]);
  const [ccEdit, setCcEdit] = useState({}); // texto do C.Custo sendo digitado, por linha
  const refGrade = useRef(null);

  const indices = useMemo(() => criarIndices(parametros), [parametros]);
  const calculadas = useMemo(
    () => montarLancamentoNfse(entradas.filter((e) => !entradaVazia(e)), indices, { vencimento }),
    [entradas, indices, vencimento],
  );
  const porUid = useMemo(() => new Map(calculadas.map((l) => [l.uid, l])), [calculadas]);
  const linhas = useMemo(() => calculadas.map((l) => ({ ...l, ...(manuais[l.uid] || {}) })), [calculadas, manuais]);

  useEffect(() => { gravar(CHAVE_LOTE, { entradas, vencimento, manuais }); }, [entradas, vencimento, manuais]);

  // depois de adicionar uma linha, leva o cursor para o NF dela
  useEffect(() => {
    if (!focar) return;
    const el = refGrade.current?.querySelector(`[data-uid="${focar}"][data-campo="nf"]`);
    if (el) el.focus();
    setFocar(null);
  }, [focar, entradas]);

  const opcoesEscr = useMemo(() => {
    const porEmp = new Map();
    (parametros.escritorios || []).forEach((e) => {
      const emp = String(e.conc).slice(0, 4);
      if (!porEmp.has(emp)) porEmp.set(emp, []);
      porEmp.get(emp).push(String(e.conc).slice(4));
    });
    return porEmp;
  }, [parametros.escritorios]);

  // C.Custo (titulo) -> [{ emp, escr }]: digitar o centro de custo preenche o escritorio de vendas
  const ccParaEscr = useMemo(() => {
    const mapa = new Map();
    (parametros.escritorios || []).forEach((e) => {
      const conc = String(e.conc);
      const k = String(e.titulo || '').toUpperCase();
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push({ emp: conc.slice(0, 4), escr: conc.slice(4), nd: conc.toUpperCase().includes('N/D') });
    });
    return mapa;
  }, [parametros.escritorios]);

  function digitarCentroCusto(uid, texto, emp, escrAtual) {
    const valor = texto.toUpperCase().trim();
    setCcEdit((a) => ({ ...a, [uid]: texto.toUpperCase() }));
    // EscrV N/D: aceita qualquer centro de custo, mesmo sem cadastro
    if (String(escrAtual || '').trim().toUpperCase() === 'N/D') {
      setCampo(uid, 'ccDireto', valor);
      return;
    }
    const achados = ccParaEscr.get(valor) || [];
    // centro de custo cadastrado como N/D (sem escritorio de vendas): aceita sem vinculo
    if (achados.some((a) => a.nd)) {
      setCampo(uid, 'escrV', 'N/D');
      setCampo(uid, 'ccDireto', valor);
      return;
    }
    setCampo(uid, 'ccDireto', '');
    const certos = emp ? achados.filter((a) => a.emp === emp) : achados;
    const escrs = [...new Set(certos.map((a) => a.escr))];
    if (escrs.length === 1) setCampo(uid, 'escrV', escrs[0]);
  }

  const comErro = linhas.filter((l) => l.erros.length);
  const prontas = linhas.filter((l) => !l.erros.length);
  const semPedido = prontas.filter((l) => !l.pedido).length;
  const semMiro = prontas.filter((l) => l.pedido && !l.miro).length;
  const falhasSap = linhas.filter((l) => l.falhaSap && !l.miro);
  const concluidas = linhas.filter((l) => l.miro).length;
  const semTabelas = !parametros.filiais.length || !parametros.escritorios.length;

  // ---------------------------------------------------------------- grade
  function setCampo(uid, campo, valor) {
    setEntradas((atual) => atual.map((e) => (e.uid === uid ? { ...e, [campo]: valor } : e)));
  }

  function adicionarLinha(base = {}) {
    const uid = novoUid();
    setEntradas((atual) => [...atual, novaEntradaNfse(uid, base)]);
    setFocar(uid);
  }

  function duplicarLinha(uid) {
    setEntradas((atual) => {
      const i = atual.findIndex((e) => e.uid === uid);
      if (i < 0) return atual;
      const copia = { ...atual[i], uid: novoUid(), nf: '' };
      return [...atual.slice(0, i + 1), copia, ...atual.slice(i + 1)];
    });
  }

  function removerLinha(uid) {
    setEntradas((atual) => atual.filter((e) => e.uid !== uid));
    setManuais((a) => { const n = { ...a }; delete n[uid]; return n; });
  }

  function editarResultado(uid, campo, valor) {
    setManuais((a) => ({ ...a, [uid]: { ...(a[uid] || {}), [campo]: valor } }));
  }

  // Acrescenta linhas (vindas de colagem ou arquivo) depois de tirar as linhas em branco.
  // Com mesclar (arquivo preenchido de volta): a nota que ja esta na grade (mesma NF + CNPJ do
  // prestador) so recebe os campos preenchidos no arquivo; as demais entram como novas.
  function acrescentar(lista, origem, { mesclar = false } = {}) {
    const paraGrade = (e) => ({ ...e, valor: e.valor === null || e.valor === undefined ? '' : valorParaSap(e.valor) });
    const chave = (e) => `${nfComSufixoF(e.nf)}/${normalizarCnpj(e.cnpjTransp)}`.toUpperCase();
    const novas = lista.map((e) => novaEntradaNfse(novoUid(), paraGrade(e)));
    setEntradas((atual) => {
      const base = atual.filter((e) => !entradaVazia(e));
      if (!mesclar) return [...base, ...novas];
      const indice = new Map(base.map((e, i) => [chave(e), i]));
      const resultado = [...base];
      const soNovas = [];
      novas.forEach((n) => {
        const i = indice.get(chave(n));
        if (i === undefined) { soNovas.push(n); return; }
        const preenchidos = Object.fromEntries(Object.entries(n).filter(([c, v]) => c !== 'uid' && String(v ?? '').trim() !== ''));
        resultado[i] = { ...resultado[i], ...preenchidos };
      });
      return [...resultado, ...soNovas];
    });
    setErro('');
    setFeedback(mesclar
      ? `${fmt(lista.length)} nota(s) lida(s) de ${origem}: as que ja estavam na grade foram completadas e as demais adicionadas.`
      : `${fmt(novas.length)} nota(s) adicionada(s) de ${origem}.`);
  }

  // Baixa a grade como planilha (mesmas colunas do modelo): da para completar o que falta no Excel
  // (ex.: EscrV) e voltar com "Importar arquivo", que completa as notas ja na grade.
  async function baixarPreenchido() {
    const dados = entradas.filter((e) => !entradaVazia(e)).map((e) => ({
      NF: e.nf,
      Transportadora: e.transportadora,
      'CNPJ Transp': e.cnpjTransp,
      'Data Emissão': isoParaBr(e.dataEmissao) || e.dataEmissao,
      Valor: numeroPlanilha(e.valor) ?? '',
      Cod: e.codImp,
      CFOP: e.cfop,
      'CNPJ Tomador': e.cnpjTomador,
      EscrV: e.escrV,
      Fatura: e.fatura,
    }));
    if (!dados.length) { setErro('A grade esta vazia.'); return; }
    await baixarXlsx('nfse-para-completar.xlsx', dados, CABECALHO_MODELO_NFSE);
  }

  function colarMatriz(matriz, origem) {
    try {
      // com cabecalho (nomes das colunas) ou so os dados, na ordem das colunas da grade
      const temCabecalho = matriz[0]?.some((c) => /^(nf|cnpj)/i.test(String(c).trim()));
      acrescentar(lerEntradaNfse(temCabecalho ? matriz : [CABECALHO_MODELO_NFSE, ...matriz]), origem);
      setColado('');
    } catch (e) { setErro(e.message); }
  }

  function aoColarNaGrade(ev) {
    const texto = ev.clipboardData?.getData('text') || '';
    if (!/[\t\n]/.test(texto.trim())) return; // colagem simples: segue normal no campo
    ev.preventDefault();
    colarMatriz(tsvParaMatriz(texto), 'colagem');
  }

  async function importarArquivo(arquivo) {
    if (!arquivo) return;
    try {
      const XLSX = await import('xlsx');
      const wb = await lerPlanilhaArquivo(arquivo);
      const nome = wb.SheetNames.includes('Preencher Dados') ? 'Preencher Dados' : wb.SheetNames[0];
      acrescentar(lerEntradaNfse(abaParaMatriz(XLSX, wb.Sheets[nome])), arquivo.name, { mesclar: true });
    } catch (e) { setErro(e.message || 'Nao consegui ler o arquivo.'); }
    finally { if (refArquivo.current) refArquivo.current.value = ''; }
  }

  // Le os PDFs das NFS-e (varios de uma vez) e acrescenta uma linha por nota. Cod e CFOP vem da regra: IN se o liquido for
  // menor que o bruto (impostos), senao IQ; CFOP 1933AA no mesmo municipio e 2933AA em outro. EscrV e Fatura ficam para preencher.
  async function importarPdfs(arquivos) {
    const lista = Array.from(arquivos || []);
    if (!lista.length) return;
    setErro(''); setFeedback('');
    try {
      const { lerNfsePdf } = await import('../../utils/robos/nfsePdf');
      const { ocrDaPagina, encerrarOcr } = await import('../../utils/robos/nfseOcr');
      let ocrUsado = 0;
      const ocr = async (pdf, n) => {
        ocrUsado += 1;
        setFeedback(`Lendo por OCR a pagina ${n} (PDF sem texto)... pode levar alguns segundos por pagina.`);
        return ocrDaPagina(pdf, n);
      };
      const lidas = [];
      const falhas = [];
      for (const arq of lista) {
        try {
          const { totalPaginas, notas } = await lerNfsePdf(arq, { ocr });
          for (const n of notas) {
            const nome = totalPaginas > 1 ? `${arq.name} (pag. ${n.pagina})` : arq.name;
            if (n.semTexto) falhas.push({ arquivo: nome, motivo: 'PDF sem texto (imagem escaneada): digite a nota na grade', faltando: '', nf: '' });
            else if (n.faltando.length) falhas.push({ arquivo: nome, motivo: 'Layout nao reconhecido ou campos nao encontrados', faltando: n.faltando.join(', '), nf: n.dados.nf || '' });
            else lidas.push({ dados: n.dados, arquivo: nome, ocr: n.ocr });
          }
        } catch (e) { falhas.push({ arquivo: arq.name, motivo: `Nao consegui abrir o PDF (${String(e?.message || e).slice(0, 60)})`, faltando: '', nf: '' }); }
      }
      const existentes = new Set(entradas.map((e) => `${e.nf}/${e.cnpjTransp}`.toUpperCase()));
      const novas = [];
      lidas.forEach(({ dados: d, arquivo, ocr: viaOcr }) => {
        const chave = `${d.nf}/${d.cnpjTransp}`.toUpperCase();
        if (existentes.has(chave)) { falhas.push({ arquivo, motivo: 'Repetida: a nota ja esta na grade (ou em outro PDF do lote)', faltando: '', nf: d.nf }); return; }
        existentes.add(chave);
        novas.push({ nf: d.nf, transportadora: d.transportadora, cnpjTransp: d.cnpjTransp, dataEmissao: d.dataEmissao, valor: d.valor, codImp: d.codImp, cfop: d.cfop, cnpjTomador: d.cnpjTomador, ocr: Boolean(viaOcr) });
      });
      if (ocrUsado) await encerrarOcr();
      setFalhasPdf(falhas);
      if (novas.length) acrescentar(novas, `${fmt(novas.length)} PDF(s)`);
      const naoLidas = falhas.filter((f) => !f.motivo.startsWith('Repetida')).length;
      const repetidas = falhas.length - naoLidas;
      if (naoLidas) setErro(`${fmt(naoLidas)} PDF(s) nao foram lidos${repetidas ? ` e ${fmt(repetidas)} eram repetidos` : ''}. Baixe o relatorio abaixo para ver quais e por que.`);
      else if (novas.length) setFeedback(`${fmt(novas.length)} nota(s) lida(s) do PDF${repetidas ? ` (${fmt(repetidas)} repetida(s) ignorada(s))` : ''}. Preencha o EscrV (e a Fatura). Cod (IN/IQ) e CFOP (1933AA/2933AA) vieram da nota; confira.${novas.some((n) => n.ocr) ? ' As marcadas com OCR foram lidas por imagem: confira CNPJ e valor.' : ''}`);
    } catch (e) { setErro(e.message || 'Nao consegui ler os PDFs.'); }
    finally { if (refPdf.current) refPdf.current.value = ''; }
  }

  // Relatorio dos PDFs que nao entraram na grade (nao lidos ou repetidos), para tratar na mao.
  async function baixarRelatorioPdf() {
    if (!falhasPdf.length) return;
    await baixarXlsx('nfse-pdf-nao-lidos.xlsx', falhasPdf.map((f) => ({ Arquivo: f.arquivo, Motivo: f.motivo, 'Campos nao encontrados': f.faltando, 'NF lida': f.nf })), ['Arquivo', 'Motivo', 'Campos nao encontrados', 'NF lida']);
  }

  async function baixarModelo() {
    await baixarXlsx('modelo-importacao-nfse.xlsx', [EXEMPLO_MODELO_NFSE], CABECALHO_MODELO_NFSE);
  }

  function limparTudo() {
    setEntradas([]); setManuais({}); setColado(''); setErro(''); setFeedback('');
  }

  // ---------------------------------------------------------------- SAP
  // Fila do robo (robos_fila): guarda as notas mandadas para o robo, com tudo para lancar de novo de
  // qualquer computador, e o que saiu no SAP. Falha aqui nao atrapalha o lancamento.
  function guardarNaFila(lista, extra = {}) {
    const porUid = new Map(entradas.map((e) => [e.uid, e]));
    const sessao = carregarSessao();
    return salvarNaFila(lista.map((l) => ({ ...itemFilaNfse(l, porUid.get(l.uid)), ...extra })), sessao?.nome || sessao?.email || '').catch(() => null);
  }

  // Traz para a tela o que a planilha do robo ja mandou direto para a fila (pedido, MIRO, falha).
  // Devolve a lista com os numeros aplicados.
  async function trazerDaFila(lista) {
    const mudou = numerosDaFila(lista, await buscarNaFila('NFSE', lista.map((l) => l.id)));
    if (!mudou.length) return { lista, mudou: 0 };
    const porUid = new Map(mudou.map((l) => [l.uid, l]));
    setManuais((a) => {
      const n = { ...a };
      mudou.forEach((l) => { n[l.uid] = { ...(a[l.uid] || {}), pedido: l.pedido, miro: l.miro, ...(l.falhaSap ? { falhaSap: l.falhaSap } : {}) }; });
      return n;
    });
    registrarHistorico(mudou.filter((l) => l.miro), true);
    return { lista: lista.map((l) => porUid.get(l.uid) || l), mudou: mudou.length };
  }

  useEffect(() => {
    if (!linhas.length) return;
    trazerDaFila(linhas).then((r) => { if (r.mudou) setFeedback(`${fmt(r.mudou)} nota(s) atualizada(s) com o que a planilha do robo mandou para a Central.`); }).catch(() => null);
  // so ao abrir a tela
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Planilha do robo no Excel: o codigo da macro e copiado uma vez; a cada lote baixa so os dados (.xlsx).
  function verMacro() {
    const m = gerarMacroNfse();
    setScriptTela({ script: m.codigo, nome: 'Robo Lancamento.xlsm', macro: m.macro });
  }

  async function baixarDadosMacro() {
    setErro('');
    if (!prontas.length) { setErro('Nao ha notas prontas para lancar.'); return; }
    if (comErro.length) { setErro(`${comErro.length} nota(s) com pendencia. Corrija ou remova antes de gerar os dados.`); return; }
    try {
      const { lista } = await trazerDaFila(prontas);
      const linhasScript = linhasParaScriptNfse(lista);
      gerarScriptNfse({ linhas: linhasScript }); // mesma validacao do script
      const m = gerarMacroNfse();
      await baixarMatrizXlsx('dados-robo-nfse.xlsx', matrizDadosMacro(linhasScript, m, getSupabaseAcessoPublico()));
      guardarNaFila(lista, { descartado: false });
      setFeedback(`Dados de ${fmt(prontas.length)} nota(s) baixados (dados-robo-nfse.xlsx). Na planilha do robo, com o SAP logado, rode a macro ${m.macro} e escolha esse arquivo. O resultado_nfse.csv fica na pasta da planilha do robo (no fim ela oferece abrir a pasta).`);
    } catch (e) { setErro(e.message); }
  }

  // Aceita varios arquivos de uma vez: resultado_nfse.csv, pendencias_nfse.csv e/ou log_lancamento_nfse.txt.
  // Pedido/MIRO vem do resultado ou do log; as falhas (pendencias ou "ERRO em" do log) marcam a nota.
  async function importarResultado(arquivos) {
    const lista = [...(arquivos || [])];
    if (!lista.length) return;
    try {
      let atual = linhas;
      let ambiguas = 0;
      const falhas = new Map();
      for (const arquivo of lista) {
        const texto = await arquivo.text();
        lerPendencias(texto).forEach((v, k) => falhas.set(k, v));
        const logPorNf = lerLogLancamento(texto);
        const r = logPorNf.size ? aplicarLog(atual, logPorNf) : aplicarResultado(atual, lerResultadoCsv(texto));
        atual = r.linhas;
        ambiguas += r.ambiguas || 0;
      }
      const antes = new Map(linhas.map((l) => [l.uid, l]));
      const atualizadas = atual.filter((l) => l.pedido !== antes.get(l.uid)?.pedido || l.miro !== antes.get(l.uid)?.miro).length;
      const contagemNf = new Map();
      atual.forEach((l) => { const nf = String(l.nf || '').toUpperCase(); contagemNf.set(nf, (contagemNf.get(nf) || 0) + 1); });
      let marcadas = 0;
      const mapa = {};
      atual.forEach((l) => {
        const nf = String(l.nf || '').toUpperCase();
        const m = { ...(manuais[l.uid] || {}), pedido: l.pedido, miro: l.miro };
        const falha = contagemNf.get(nf) === 1 ? falhas.get(nf) : null;
        if (l.miro) delete m.falhaSap;
        else if (falha) { m.falhaSap = falha; marcadas += 1; }
        mapa[l.uid] = m;
      });
      setManuais((a) => ({ ...a, ...mapa }));
      guardarNaFila(atual.map((l) => ({ ...l, falhaSap: mapa[l.uid]?.falhaSap })).filter((l) => l.pedido || l.miro || l.falhaSap));
      setErro('');
      const r = atualizadas ? await registrarHistorico(atual, true) : null;
      const aviso = ambiguas ? ` ${fmt(ambiguas)} nota(s) com NF repetida no lote ficaram de fora (o log nao traz o CNPJ).` : '';
      const textoFalhas = marcadas ? ` ${fmt(marcadas)} nota(s) falharam no SAP: veja o motivo na grade e use "Baixar pendentes do SAP".` : '';
      if (!atualizadas && !marcadas) setFeedback(`Nenhuma nota do arquivo bate com o lote atual (confira se e o resultado deste lote).${aviso}`);
      else setFeedback(`Resultado aplicado em ${fmt(atualizadas)} nota(s).${textoFalhas}${aviso}${textoHistorico(r)}`);
    } catch (e) { setErro(e.message || 'Nao consegui ler o resultado.'); }
    finally { if (refResultado.current) refResultado.current.value = ''; }
  }

  async function baixarPendentes() {
    const dados = linhasPendentesNfse(linhas);
    if (!dados.length) { setErro('Nenhuma nota com falha no SAP.'); return; }
    await baixarXlsx('nfse-pendentes-sap.xlsx', dados, CABECALHO_PENDENTES_NFSE);
  }

  // Tira do lote as notas que ja tem MIRO (ja estao no historico): sobram so as que faltam lancar.
  function manterSoPendentes() {
    const concluidasUids = new Set(linhas.filter((l) => l.miro).map((l) => l.uid));
    if (!concluidasUids.size) { setErro('Nenhuma nota com MIRO para tirar do lote.'); return; }
    if (!window.confirm(`Tirar do lote as ${concluidasUids.size} nota(s) que ja tem MIRO? Elas continuam no historico.`)) return;
    setEntradas((a) => a.filter((e) => !concluidasUids.has(e.uid)));
    setManuais((a) => Object.fromEntries(Object.entries(a).filter(([uid]) => !concluidasUids.has(uid))));
    setErro('');
    setFeedback(`${fmt(concluidasUids.size)} nota(s) com MIRO saíram do lote. Corrija as que sobraram e gere os dados de novo: o robo so lanca o que falta.`);
  }

  async function baixarEnviar() {
    const dados = linhasEnviarNfse(linhas);
    if (!dados.length) { setErro('Ainda nao ha pedido/MIRO para enviar.'); return; }
    await baixarXlsx('nfse-resumo-enviar.xlsx', dados, CABECALHO_ENVIAR_NFSE);
  }

  async function registrarHistorico(lista, automatico = false) {
    const com = lista.filter((l) => l.miro || l.pedido);
    if (!com.length) { if (!automatico) setErro('Nenhuma nota com pedido ou MIRO para registrar no historico.'); return null; }
    const sessao = carregarSessao();
    const r = await registrarLancamentos('NFSE', com, sessao?.nome || sessao?.email || '');
    return r;
  }

  function textoHistorico(r) {
    if (!r) return '';
    const onde = r.onde === 'banco' ? 'no historico' : 'no historico (so neste navegador: migration pendente)';
    return ` ${fmt(r.novos)} nova(s) registrada(s) ${onde}.`;
  }

  async function guardarHistoricoManual() {
    const r = await registrarHistorico(linhas);
    if (r) { setErro(''); setFeedback(`Historico atualizado.${textoHistorico(r)}`); }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <AvisoFila tipo="NFSE" />
      {scriptTela ? <ScriptParaCopiar script={scriptTela.script} nomeArquivo={scriptTela.nome} onFechar={() => setScriptTela(null)} titulo={scriptTela.macro ? 'Código da macro (Excel)' : undefined} passos={scriptTela.macro ? passosMacroExcel(scriptTela.macro) : undefined} /> : null}
      {erro ? <div style={{ padding: 12, borderRadius: 8, background: '#fee2e2', color: '#991b1b' }}>{erro}</div> : null}
      {feedback && !erro ? <div style={{ padding: 12, borderRadius: 8, background: '#dcfce7', color: '#166534' }}>{feedback}</div> : null}

      <ParametrosLancamentoCard parametros={parametros} onChange={setParametros} onErro={setErro} onFeedback={setFeedback} />

      <div className="panel-card">
        <div style={passoStyle}>
          <span style={numStyle}>1</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="panel-title" style={{ margin: 0 }}>Notas de serviço (NFS-e)</div>
            <p style={{ margin: '4px 0 10px' }}>Preencha direto na grade, como numa planilha: uma nota por linha. Empresa, centro e centro de custo aparecem sozinhos. Também dá para <b>colar linhas do Excel</b> em qualquer célula, <b>importar um arquivo</b> ou partir do <b>modelo</b>.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="btn-primary" disabled={semTabelas} onClick={() => adicionarLinha()}>+ Adicionar linha</button>
              <label className="btn-secondary" style={{ cursor: semTabelas ? 'default' : 'pointer', opacity: semTabelas ? 0.5 : 1 }}>
                Importar arquivo
                <input ref={refArquivo} type="file" accept=".xlsx,.xlsm,.xls,.csv" disabled={semTabelas} style={{ display: 'none' }} onChange={(e) => importarArquivo(e.target.files?.[0])} />
              </label>
              <label className="btn-secondary" style={{ cursor: semTabelas ? 'default' : 'pointer', opacity: semTabelas ? 0.5 : 1 }} title="Escolha um ou vários PDFs de NFS-e (padrão nacional): lê NF, prestador, CNPJs, data e valor">
                Ler PDFs das notas
                <input ref={refPdf} type="file" accept=".pdf,application/pdf" multiple disabled={semTabelas} style={{ display: 'none' }} onChange={(e) => importarPdfs(e.target.files)} />
              </label>
              {falhasPdf.length ? <button type="button" className="btn-secondary" onClick={baixarRelatorioPdf} title="Lista os PDFs que nao foram lidos ou eram repetidos, com o motivo">Baixar relatório dos PDFs não lidos ({falhasPdf.length})</button> : null}
              {entradas.length ? <button type="button" className="btn-secondary" onClick={baixarPreenchido} title="Baixa a grade em Excel para completar o que falta (ex.: EscrV) e voltar com Importar arquivo">Baixar planilha preenchida (.xlsx)</button> : null}
              <button type="button" className="btn-secondary" onClick={baixarModelo}>Baixar modelo de importação (.xlsx)</button>
              {entradas.length ? <button type="button" className="btn-secondary" onClick={limparTudo}>Limpar tudo</button> : null}
              <div className="field" style={{ marginLeft: 'auto' }}>
                <label>Vencimento padrão</label>
                <input type="date" min={hojeIso()} value={vencimento} onChange={(e) => setVencimento(naoAntesDeHoje(e.target.value))} title="Nunca antes de hoje: data passada da erro na MIRO" />
              </div>
            </div>
            {semTabelas ? <div style={{ marginTop: 6, color: '#b91c1c', fontSize: 12 }}>Importe as tabelas de parâmetros acima antes de lançar notas.</div> : null}

            <datalist id="dl-filiais">
              {(parametros.filiais || []).map((f) => <option key={f.cnpj} value={f.cnpj} label={`${f.emp} / ${f.centro}`} />)}
            </datalist>
            {[...new Set(linhas.map((l) => l.emp).filter(Boolean))].map((emp) => (
              <datalist key={emp} id={`dl-escr-${emp}`}>
                {(opcoesEscr.get(emp) || []).map((c) => <option key={c} value={c} />)}
              </datalist>
            ))}

            <div ref={refGrade} onPaste={aoColarNaGrade} style={{ overflow: 'auto', marginTop: 12, maxHeight: 460, border: '1px solid #e2e8f0', borderRadius: 6 }}>
              <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th style={th}>#</th>
                    {COLUNAS.map((c) => <th key={c.campo} style={th}>{c.titulo}</th>)}
                    <th style={th}>Emp</th>
                    <th style={th}>Centro</th>
                    <th style={th}>C.Custo</th>
                    <th style={th}>Pedido</th>
                    <th style={th}>MIRO</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {entradas.length === 0 ? (
                    <tr><td style={{ ...td, padding: 14, color: '#64748b' }} colSpan={COLUNAS.length + 7}>Nenhuma nota ainda. Clique em “+ Adicionar linha”, cole do Excel ou importe um arquivo.</td></tr>
                  ) : null}
                  {entradas.map((e, idx) => {
                    const l = porUid.get(e.uid);
                    const m = manuais[e.uid] || {};
                    const temErro = l && l.erros.length > 0;
                    return (
                      <tr key={e.uid} style={{ background: temErro ? '#fef2f2' : undefined }}>
                        <td style={{ ...td, color: '#94a3b8' }}>{idx + 1}</td>
                        {COLUNAS.map((c) => (
                          <td key={c.campo} style={td}>
                            <input
                              style={{ ...inp, width: c.w }}
                              type={c.tipo || 'text'}
                              data-uid={e.uid}
                              data-campo={c.campo}
                              value={e[c.campo] ?? ''}
                              list={c.lista || (c.listaEmp && l?.emp ? `dl-escr-${l.emp}` : undefined)}
                              placeholder={c.campo === 'vencimento' ? isoParaBr(vencimento) : undefined}
                              onChange={(ev) => setCampo(e.uid, c.campo, c.maiusc ? ev.target.value.toUpperCase() : ev.target.value)}
                              onKeyDown={(ev) => { if (ev.key === 'Enter' && c.campo === 'fatura' && idx === entradas.length - 1) { ev.preventDefault(); adicionarLinha(); } }}
                            />
                          </td>
                        ))}
                        <td style={calc}>{l?.emp || '—'}</td>
                        <td style={calc}>{l?.centro || '—'}</td>
                        <td style={calc}>
                          <input
                            style={{ ...inp, width: 100 }}
                            value={ccEdit[e.uid] ?? (l?.cc || '')}
                            placeholder="C.Custo"
                            title="Digite o centro de custo para preencher o EscrV sozinho"
                            onChange={(ev) => digitarCentroCusto(e.uid, ev.target.value, l?.emp, e.escrV)}
                            onBlur={() => setCcEdit((a) => { const n = { ...a }; delete n[e.uid]; return n; })}
                          />
                        </td>
                        <td style={td}><input style={{ ...inp, width: 92 }} value={m.pedido || ''} onChange={(ev) => editarResultado(e.uid, 'pedido', ev.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="pedido" /></td>
                        <td style={td}><input style={{ ...inp, width: 92 }} value={m.miro || ''} onChange={(ev) => editarResultado(e.uid, 'miro', ev.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="MIRO" /></td>
                        <td style={td}>
                          {e.ocr ? (
                            <span style={{ color: '#b45309', marginRight: 8 }} title="Lida por OCR (imagem): confira CNPJ, data e valor com a nota">
                              OCR: conferir <button type="button" className="btn-link" onClick={() => setCampo(e.uid, 'ocr', false)}>ok</button>
                            </span>
                          ) : null}
                          {temErro ? <span style={{ color: '#b91c1c', marginRight: 8 }} title={l.erros.join('; ')}>{l.erros[0]}</span> : null}
                          {l && l.falhaSap && !l.miro ? <span style={{ color: '#b45309', marginRight: 8 }} title={l.falhaSap.motivo}>SAP ({l.falhaSap.etapa}): {motivoCurto(l.falhaSap.motivo).slice(0, 60)}</span> : null}
                          <button type="button" className="btn-link" onClick={() => duplicarLinha(e.uid)}>duplicar</button>{' '}
                          <button type="button" className="btn-link" onClick={() => removerLinha(e.uid)}>remover</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Dica: na última célula da última linha (Fatura), Enter cria a próxima linha. Preencher o Pedido à mão equivale ao botão “Criar Miro (exceção)”: o robô pula o pedido e lança só a MIRO.</div>

            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>Colar várias linhas do Excel (alternativa)</summary>
              <textarea value={colado} onChange={(ev) => setColado(ev.target.value)} rows={3} placeholder="Cole aqui (Ctrl+V) as linhas do Excel, com ou sem a linha de cabeçalho" style={{ width: '100%', boxSizing: 'border-box', marginTop: 6 }} />
              <button type="button" className="btn-secondary" style={{ marginTop: 6 }} disabled={!colado.trim()} onClick={() => colarMatriz(tsvParaMatriz(colado), 'colagem')}>Adicionar à grade</button>
            </details>

            {linhas.length ? (
              <div className="summary-strip" style={{ marginTop: 14 }}>
                <div className="summary-card"><span>Notas</span><strong>{fmt(linhas.length)}</strong></div>
                <div className="summary-card"><span>Com pendência</span><strong style={{ color: comErro.length ? '#b91c1c' : undefined }}>{fmt(comErro.length)}</strong></div>
                <div className="summary-card"><span>Sem pedido</span><strong>{fmt(semPedido)}</strong></div>
                <div className="summary-card"><span>Pedido sem MIRO</span><strong>{fmt(semMiro)}</strong></div>
                <div className="summary-card"><span>Falha no SAP</span><strong style={{ color: falhasSap.length ? '#b45309' : undefined }}>{fmt(falhasSap.length)}</strong></div>
                <div className="summary-card"><span>Concluídas</span><strong>{fmt(concluidas)}</strong></div>
                <div className="summary-card"><span>Valor total</span><strong style={{ fontSize: 15 }}>{moeda(linhas.reduce((s, l) => s + (l.valor || 0), 0))}</strong></div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div style={passoStyle}>
          <span style={numStyle}>2</span>
          <div>
            <div className="panel-title" style={{ margin: 0 }}>Criar pedido e MIRO no SAP (planilha do robô)</div>
            <p style={{ margin: '4px 0 10px' }}>Baixe os dados e rode na planilha do robô (Excel): ela cria o pedido (ME21N) das notas sem pedido e depois a MIRO das que têm pedido e ainda não têm MIRO. Se uma nota falhar (ex.: precisa de aprovação), o robô pula, segue com as demais e no fim lista as pendências; ao rodar de novo, pula o que já tem número.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn-primary" disabled={!prontas.length} onClick={baixarDadosMacro} title="Planilha comum (sem codigo) com as notas, para a planilha do robo">Baixar dados para o Excel (.xlsx)</button>
              <button type="button" className="btn-secondary" onClick={verMacro} title="Codigo da macro para a planilha do robo no Excel (copiar uma vez)">Código da macro (Excel)</button>
              <BaixarPlanilhaRobo gerar={gerarMacroNfse} />
            </div>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div style={passoStyle}>
          <span style={numStyle}>3</span>
          <div>
            <div className="panel-title" style={{ margin: 0 }}>Trazer o resultado e enviar</div>
            <p style={{ margin: '4px 0 10px' }}>Depois de rodar, carregue o <code>resultado_nfse.csv</code> e, se houver, o <code>pendencias_nfse.csv</code> (pode selecionar os dois juntos; o <code>log_lancamento_nfse.txt</code> também serve, inclusive de outra máquina) para preencher os números de pedido e MIRO e marcar as notas que falharam no SAP. Para tratar as falhas: baixe as pendentes, corrija e use “Deixar só as pendentes no lote” antes de gerar os dados de novo. As notas com MIRO entram sozinhas no histórico (aba “Acompanhamento de lançamentos”). Em seguida baixe o resumo para envio.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input ref={refResultado} type="file" accept=".csv,.txt" multiple onChange={(e) => importarResultado(e.target.files)} />
              <button type="button" className="btn-secondary" disabled={!falhasSap.length} onClick={baixarPendentes} title="Notas que o robo pulou, com o motivo do SAP">Baixar pendentes do SAP ({fmt(falhasSap.length)})</button>
              <button type="button" className="btn-secondary" onClick={manterSoPendentes} title="Tira do lote as notas que ja tem MIRO">Deixar só as pendentes no lote</button>
              <button type="button" className="btn-secondary" onClick={baixarEnviar}>Baixar resumo (Enviar) .xlsx</button>
              <button type="button" className="btn-secondary" onClick={guardarHistoricoManual}>Registrar no histórico</button>
            </div>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-title">Como rodar</div>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Uma vez só: baixe a <b>Planilha do robô (.xlsm)</b>, salve na sua pasta de trabalho e, no arquivo, clique com o botão direito → Propriedades → marque <b>Desbloquear</b>.</li>
          <li>Abra o SAP Logon e entre no sistema (scripting habilitado, como na planilha).</li>
          <li>A cada lote: baixe os <b>Dados para o Excel</b>, abra a planilha do robô, clique em <b>▶ Lançar NFS-e</b> e escolha o arquivo de dados. Não mexa no SAP até a mensagem final.</li>
          <li>O resultado vai direto para a Central (no fim aparece “Resultado já enviado”). Se aparecer que não chegou, importe o <code>resultado_nfse.csv</code> no passo 3: ele fica na pasta da planilha do robô, junto com o log e as pendências.</li>
        </ol>
      </div>
    </div>
  );
}
