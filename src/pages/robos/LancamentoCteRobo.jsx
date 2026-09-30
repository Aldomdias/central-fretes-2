import { useEffect, useMemo, useRef, useState } from 'react';
import ParametrosLancamentoCard from './ParametrosLancamentoCard';
import {
  CABECALHO_ENVIAR_CTE,
  CABECALHO_LANCAMENTO_CTE,
  docnumsDoExport1,
  extrairCte,
  linhasConsultaSe16n,
  linhasEnviarCte,
  linhasLancamentoCte,
  linhasParaScriptCte,
  montarLancamentoCte,
  partidasDoExport2,
} from '../../utils/robos/lancamentoCte';
import {
  abaParaMatriz,
  baixarArquivo,
  baixarXlsx,
  carregarParametros,
  criarIndices,
  hojeIso,
  isoParaBr,
  lerPlanilhaArquivo,
  lerResultadoCsv,
} from '../../utils/robos/lancamentoComum';
import { PASTA_CTE, gerarScriptCte } from '../../utils/robos/sapLancamentoVbs';
import { PASTA_ETAPAS_CTE, gerarScriptConsultaNotasCte, gerarScriptPartidasCte } from '../../utils/robos/sapConsultasCte';

const CHAVE = 'central_fretes_robo_cte_lote_v1';

function ler(padrao) {
  try { return JSON.parse(window.localStorage.getItem(CHAVE) || 'null') ?? padrao; } catch { return padrao; }
}

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const moeda = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const passoStyle = { display: 'flex', gap: 12, alignItems: 'flex-start' };
const numStyle = { width: 26, height: 26, borderRadius: '50%', background: '#0f172a', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flex: '0 0 auto' };
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', fontSize: 12, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' };

export default function LancamentoCteRobo() {
  const inicial = useMemo(() => ler({}), []);
  const [parametros, setParametros] = useState(carregarParametros);
  const [cts, setCts] = useState(inicial.cts || []);
  const [partidasArr, setPartidasArr] = useState(inicial.partidas || []);
  const [docnums, setDocnums] = useState(inicial.docnums || []);
  const [vencimento, setVencimento] = useState(inicial.vencimento || hojeIso());
  const [manuais, setManuais] = useState(inicial.manuais || {});
  const [removidos, setRemovidos] = useState(inicial.removidos || []);
  const [falhasXml, setFalhasXml] = useState([]);
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');
  const refXml = useRef(null);
  const refPasta = useRef(null);
  const refE1 = useRef(null);
  const refE2 = useRef(null);
  const refRes = useRef(null);

  useEffect(() => {
    try { window.localStorage.setItem(CHAVE, JSON.stringify({ cts, partidas: partidasArr, docnums, vencimento, manuais, removidos })); } catch { /* sem localStorage */ }
  }, [cts, partidasArr, docnums, vencimento, manuais, removidos]);

  const indices = useMemo(() => criarIndices(parametros), [parametros]);
  const partidas = useMemo(() => new Map(partidasArr), [partidasArr]);
  const base = useMemo(
    () => montarLancamentoCte(cts, indices, partidas, { vencimento }).filter((l) => !removidos.includes(l.id)),
    [cts, indices, partidas, vencimento, removidos],
  );
  const linhas = useMemo(() => base.map((l) => {
    const m = manuais[l.id] || {};
    const novo = { ...l, ...m };
    if (novo.cc) novo.erros = novo.erros.filter((e) => !/centro de custo/.test(e));
    return novo;
  }), [base, manuais]);

  const semTabelas = !parametros.filiais.length || !parametros.escritorios.length;
  const comErro = linhas.filter((l) => l.erros.length);
  const prontas = linhas.filter((l) => !l.erros.length);
  const semPedido = prontas.filter((l) => !l.pedido).length;
  const semMiro = prontas.filter((l) => l.pedido && !l.miro).length;
  const comCc = linhas.filter((l) => l.cc).length;
  const consultas = useMemo(() => linhasConsultaSe16n(linhas), [linhas]);

  function editar(id, campo, valor) {
    setManuais((a) => ({ ...a, [id]: { ...(a[id] || {}), [campo]: valor } }));
  }

  async function importarXmls(lista) {
    const arquivos = Array.from(lista || []).filter((f) => /\.xml$/i.test(f.name));
    if (!arquivos.length) { setErro('Nenhum arquivo .xml encontrado na selecao.'); return; }
    setErro(''); setFeedback('');
    const novos = [];
    const falhas = [];
    for (const f of arquivos) {
      try { novos.push(extrairCte(await f.text(), f.name)); } catch (e) { falhas.push(`${f.name}: ${e.message}`); }
    }
    setFalhasXml(falhas);
    setCts(novos);
    setManuais({}); setRemovidos([]); setPartidasArr([]); setDocnums([]);
    setFeedback(`${fmt(novos.length)} XML(s) lido(s)${falhas.length ? `; ${fmt(falhas.length)} com problema (veja abaixo)` : ''}.`);
    if (refXml.current) refXml.current.value = '';
    if (refPasta.current) refPasta.current.value = '';
  }

  async function lerExportacao(arquivo) {
    const XLSX = await import('xlsx');
    const wb = await lerPlanilhaArquivo(arquivo);
    return abaParaMatriz(XLSX, wb.Sheets[wb.SheetNames[0]]);
  }

  function baixar(nome, fabrica, msg) {
    setErro('');
    try { baixarArquivo(nome, fabrica()); setFeedback(msg); } catch (e) { setErro(e.message); }
  }

  async function carregarExport1(arquivo) {
    if (!arquivo) return;
    try {
      const nums = docnumsDoExport1(await lerExportacao(arquivo));
      if (!nums.length) throw new Error('Nao encontrei numeros de documento na 1a coluna do arquivo.');
      setDocnums(nums); setErro('');
      setFeedback(`${fmt(nums.length)} documento(s) lido(s) do EXPORT1. Agora gere o script do passo 2c.`);
    } catch (e) { setErro(e.message || 'Nao consegui ler o EXPORT1.'); }
    finally { if (refE1.current) refE1.current.value = ''; }
  }

  async function carregarExport2(arquivo) {
    if (!arquivo) return;
    try {
      const mapa = partidasDoExport2(await lerExportacao(arquivo));
      if (!mapa.size) throw new Error('Nao encontrei partidas (coluna "Chave NF") no arquivo.');
      setPartidasArr([...mapa.entries()]); setErro('');
      setFeedback(`${fmt(mapa.size)} partida(s) lida(s) do EXPORT2. Os centros de custo foram preenchidos onde foi possivel.`);
    } catch (e) { setErro(e.message || 'Nao consegui ler o EXPORT2.'); }
    finally { if (refE2.current) refE2.current.value = ''; }
  }

  function baixarLancamento() {
    if (!prontas.length) { setErro('Nao ha CT-e prontos para lancar.'); return; }
    if (comErro.length) { setErro(`${comErro.length} CT-e com pendencia. Corrija ou remova antes de gerar o script.`); return; }
    baixar('lancar-cte.vbs', () => gerarScriptCte({ linhas: linhasParaScriptCte(prontas) }),
      `Script baixado com ${fmt(prontas.length)} CT-e (${fmt(semPedido)} sem pedido, ${fmt(semMiro)} so com pedido). Com o SAP aberto, de dois cliques nele. Resultado em ${PASTA_CTE}\\resultado_cte.csv.`);
  }

  async function importarResultado(arquivo) {
    if (!arquivo) return;
    try {
      const mapa = lerResultadoCsv(await arquivo.text());
      let n = 0;
      const novos = {};
      linhas.forEach((l) => {
        const r = mapa.get(l.id);
        if (!r) return;
        n += 1;
        novos[l.id] = { ...(manuais[l.id] || {}), pedido: r.pedido || l.pedido, miro: r.miro || l.miro };
      });
      setManuais((a) => ({ ...a, ...novos })); setErro('');
      setFeedback(n ? `Resultado aplicado em ${fmt(n)} CT-e.` : 'Nenhum CT-e do arquivo bate com o lote atual.');
    } catch (e) { setErro(e.message || 'Nao consegui ler o resultado.'); }
    finally { if (refRes.current) refRes.current.value = ''; }
  }

  async function baixarEnviar() {
    const dados = linhasEnviarCte(linhas);
    if (!dados.length) { setErro('Ainda nao ha pedido/MIRO para enviar.'); return; }
    await baixarXlsx('cte-resumo-enviar.xlsx', dados, CABECALHO_ENVIAR_CTE);
  }

  function limpar() {
    setCts([]); setPartidasArr([]); setDocnums([]); setManuais({}); setRemovidos([]); setFalhasXml([]); setErro(''); setFeedback('');
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {erro ? <div style={{ padding: 12, borderRadius: 8, background: '#fee2e2', color: '#991b1b' }}>{erro}</div> : null}
      {feedback && !erro ? <div style={{ padding: 12, borderRadius: 8, background: '#dcfce7', color: '#166534' }}>{feedback}</div> : null}

      <ParametrosLancamentoCard parametros={parametros} onChange={setParametros} onErro={setErro} onFeedback={setFeedback} />

      <div className="panel-card">
        <div style={passoStyle}>
          <span style={numStyle}>1</span>
          <div style={{ flex: 1 }}>
            <div className="panel-title" style={{ margin: 0 }}>Importar os XMLs dos CT-e</div>
            <p style={{ margin: '4px 0 10px' }}>Selecione os XMLs (vários de uma vez) ou uma pasta. O robô lê série, número, valor, protocolo, tomador, ICMS e a NF de venda, e calcula empresa, centro, valor líquido e código de imposto (F1/F2) como a planilha fazia.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input ref={refXml} type="file" accept=".xml" multiple disabled={semTabelas} onChange={(e) => importarXmls(e.target.files)} />
              <label style={{ fontSize: 12 }}>ou pasta: <input ref={refPasta} type="file" webkitdirectory="" directory="" multiple disabled={semTabelas} onChange={(e) => importarXmls(e.target.files)} /></label>
              {cts.length ? <button type="button" className="btn-secondary" onClick={limpar}>Limpar lote</button> : null}
            </div>
            {semTabelas ? <div style={{ marginTop: 6, color: '#b91c1c', fontSize: 12 }}>Importe as tabelas de parâmetros acima antes de carregar os XMLs.</div> : null}
            {falhasXml.length ? <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>{falhasXml.slice(0, 5).map((f) => <div key={f}>{f}</div>)}{falhasXml.length > 5 ? <div>… e mais {falhasXml.length - 5}</div> : null}</div> : null}
          </div>
        </div>
      </div>

      {linhas.length ? (
        <>
          <div className="panel-card">
            <div style={passoStyle}>
              <span style={numStyle}>2</span>
              <div style={{ flex: 1 }}>
                <div className="panel-title" style={{ margin: 0 }}>Consultar o centro de custo no SAP</div>
                <p style={{ margin: '4px 0 10px' }}>O centro de custo vem da NF de venda do CT-e. São dois scripts, com uma leitura de arquivo no meio: (a) SE16N acha o número do documento de cada NF de venda; (b) você carrega o arquivo; (c) ZSD0004 busca as partidas desses documentos; (d) você carrega o segundo arquivo. Se preferir, pule e digite o centro de custo direto na tabela.</p>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b>2a</b>
                    <button type="button" className="btn-primary" disabled={!consultas.length} onClick={() => baixar('2a-consultar-notas-cte.vbs', () => gerarScriptConsultaNotasCte({ consultas }), `Script baixado (${fmt(consultas.length)} chave(s) de NF de venda). Rode com o SAP aberto; o resultado vai para ${PASTA_ETAPAS_CTE}\\EXPORT1.XLSX.`)}>Baixar script de consulta (SE16N)</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b>2b</b> <span>Carregar <code>EXPORT1.XLSX</code>:</span>
                    <input ref={refE1} type="file" accept=".xlsx,.xls" onChange={(e) => carregarExport1(e.target.files?.[0])} />
                    {docnums.length ? <span style={{ color: '#166534' }}>{fmt(docnums.length)} documento(s)</span> : null}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b>2c</b>
                    <button type="button" className="btn-primary" disabled={!docnums.length} onClick={() => baixar('2c-partidas-cte.vbs', () => gerarScriptPartidasCte({ docnums }), `Script baixado (${fmt(docnums.length)} documento(s)). Rode com o SAP aberto; o resultado vai para ${PASTA_ETAPAS_CTE}\\EXPORT2.XLSX.`)}>Baixar script de partidas (ZSD0004)</button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b>2d</b> <span>Carregar <code>EXPORT2.XLSX</code>:</span>
                    <input ref={refE2} type="file" accept=".xlsx,.xls" onChange={(e) => carregarExport2(e.target.files?.[0])} />
                    {partidasArr.length ? <span style={{ color: '#166534' }}>{fmt(partidasArr.length)} partida(s)</span> : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel-card">
            <div style={passoStyle}>
              <span style={numStyle}>3</span>
              <div style={{ flex: 1 }}>
                <div className="panel-title" style={{ margin: 0 }}>Conferir e lançar</div>
                <div className="summary-strip" style={{ marginTop: 10 }}>
                  <div className="summary-card"><span>CT-e</span><strong>{fmt(linhas.length)}</strong></div>
                  <div className="summary-card"><span>Com pendência</span><strong style={{ color: comErro.length ? '#b91c1c' : undefined }}>{fmt(comErro.length)}</strong></div>
                  <div className="summary-card"><span>Com centro de custo</span><strong>{fmt(comCc)}</strong></div>
                  <div className="summary-card"><span>Sem pedido</span><strong>{fmt(semPedido)}</strong></div>
                  <div className="summary-card"><span>Pedido sem MIRO</span><strong>{fmt(semMiro)}</strong></div>
                  <div className="summary-card"><span>Valor bruto</span><strong style={{ fontSize: 15 }}>{moeda(linhas.reduce((s, l) => s + l.bruto, 0))}</strong></div>
                </div>
                <div className="field" style={{ marginTop: 10, maxWidth: 220 }}>
                  <label>Vencimento (todos os CT-e)</label>
                  <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
                </div>
                <div style={{ overflowX: 'auto', marginTop: 10, maxHeight: 440, overflowY: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr>{['Emp', 'CT-e', 'Transportadora', 'Bruto', 'Líquido', 'ICMS', 'Imp.', 'Centro', 'C.Custo', 'Fatura', 'Pedido', 'MIRO', ''].map((c) => <th key={c} style={th}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {linhas.map((l) => (
                        <tr key={l.id} style={{ background: l.erros.length ? '#fef2f2' : undefined }} title={[...l.erros, ...l.avisos].join('; ')}>
                          <td style={td}>{l.emp || '—'}</td>
                          <td style={td}>{l.cte}</td>
                          <td style={td}>{l.transportadora}</td>
                          <td style={td}>{moeda(l.bruto)}</td>
                          <td style={td}>{moeda(l.liquido)}</td>
                          <td style={td}>{(l.icms * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</td>
                          <td style={td}>{l.codImp}</td>
                          <td style={td}>{l.centro || '—'}</td>
                          <td style={td}><input style={{ width: 96 }} value={l.cc} onChange={(e) => editar(l.id, 'cc', e.target.value.toUpperCase().trim())} placeholder="C4201…" /></td>
                          <td style={td}><input style={{ width: 70 }} value={l.fatura} onChange={(e) => editar(l.id, 'fatura', e.target.value)} placeholder="fatura" /></td>
                          <td style={td}><input style={{ width: 96 }} value={l.pedido} onChange={(e) => editar(l.id, 'pedido', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="pedido" /></td>
                          <td style={td}><input style={{ width: 96 }} value={l.miro} onChange={(e) => editar(l.id, 'miro', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="MIRO" /></td>
                          <td style={td}>
                            {l.erros.length ? <span style={{ color: '#b91c1c', marginRight: 8 }}>{l.erros[0]}</span> : l.avisos.length ? <span style={{ color: '#b45309', marginRight: 8 }}>{l.avisos[0]}</span> : null}
                            <button type="button" className="btn-link" onClick={() => setRemovidos((a) => [...a, l.id])}>remover</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 12, color: '#64748b' }}>Preencher o Pedido à mão equivale ao botão “Criar Miro (exceção)”: o robô pula o pedido e lança só a MIRO. Vencimento padrão = hoje.</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  <button type="button" className="btn-primary" disabled={!prontas.length} onClick={baixarLancamento}>Baixar script de lançamento (.vbs)</button>
                  <button type="button" className="btn-secondary" onClick={() => baixarXlsx('cte-lancamento.xlsx', linhasLancamentoCte(linhas), CABECALHO_LANCAMENTO_CTE)}>Baixar tabela (.xlsx)</button>
                </div>
              </div>
            </div>
          </div>

          <div className="panel-card">
            <div style={passoStyle}>
              <span style={numStyle}>4</span>
              <div>
                <div className="panel-title" style={{ margin: 0 }}>Trazer o resultado</div>
                <p style={{ margin: '4px 0 10px' }}>Depois de rodar, carregue <code>{PASTA_CTE}\resultado_cte.csv</code> para preencher pedido e MIRO. O script para no primeiro erro e diz qual CT-e falhou; ao rodar de novo pula o que já tem número.</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input ref={refRes} type="file" accept=".csv,.txt" onChange={(e) => importarResultado(e.target.files?.[0])} />
                  <button type="button" className="btn-secondary" onClick={baixarEnviar}>Baixar resumo (Enviar) .xlsx</button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      <div className="panel-card">
        <div className="panel-title">Como rodar</div>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Abra o SAP Logon e entre no sistema (scripting habilitado, como na planilha).</li>
          <li>Se o navegador avisar sobre o download do .vbs, escolha “Manter”. Se vier como <code>.vbs.txt</code>, renomeie para <code>.vbs</code>.</li>
          <li>Dê dois cliques no arquivo e não mexa no SAP até a mensagem final.</li>
        </ol>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Datas: emissão {linhas[0] ? isoParaBr(linhas[0].dataEmissao) : '—'} (primeiro CT-e). Vencimento usado: {isoParaBr(vencimento)}.</div>
      </div>
    </div>
  );
}
