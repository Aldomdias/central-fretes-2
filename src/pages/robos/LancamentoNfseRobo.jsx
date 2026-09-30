import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CABECALHO_ENVIAR_NFSE,
  CABECALHO_HISTORICO_NFSE,
  aplicarResultado,
  lerEntradaNfse,
  linhasEnviarNfse,
  linhasHistoricoNfse,
  linhasParaScriptNfse,
  montarLancamentoNfse,
} from '../../utils/robos/lancamentoNfse';
import {
  abaParaMatriz,
  baixarArquivo,
  baixarXlsx,
  carregarParametros,
  criarIndices,
  extrairParametrosDeArquivo,
  hojeIso,
  isoParaBr,
  lerPlanilhaArquivo,
  lerResultadoCsv,
  salvarParametros,
  tsvParaMatriz,
} from '../../utils/robos/lancamentoComum';
import { PASTA_NFSE, gerarScriptNfse } from '../../utils/robos/sapLancamentoVbs';

const CHAVE_LOTE = 'central_fretes_robo_nfse_lote_v1';
const CHAVE_HISTORICO = 'central_fretes_robo_nfse_historico_v1';

function ler(chave, padrao) {
  try { return JSON.parse(window.localStorage.getItem(chave) || 'null') ?? padrao; } catch { return padrao; }
}
function gravar(chave, valor) {
  try { window.localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem localStorage */ }
}

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const moeda = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const passoStyle = { display: 'flex', gap: 12, alignItems: 'flex-start' };
const numStyle = { width: 26, height: 26, borderRadius: '50%', background: '#0f172a', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flex: '0 0 auto' };
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', fontSize: 12, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' };

export default function LancamentoNfseRobo() {
  const [parametros, setParametros] = useState(carregarParametros);
  const [colado, setColado] = useState('');
  const [entradas, setEntradas] = useState(() => ler(CHAVE_LOTE, { entradas: [] }).entradas || []);
  const [vencimento, setVencimento] = useState(() => ler(CHAVE_LOTE, {}).vencimento || hojeIso());
  const [manuais, setManuais] = useState(() => ler(CHAVE_LOTE, {}).manuais || {});
  const [removidos, setRemovidos] = useState(() => ler(CHAVE_LOTE, {}).removidos || []);
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');
  const refParam = useRef(null);
  const refArquivo = useRef(null);
  const refResultado = useRef(null);

  const indices = useMemo(() => criarIndices(parametros), [parametros]);
  const base = useMemo(
    () => montarLancamentoNfse(entradas, indices, { vencimento }).filter((l) => !removidos.includes(l.id)),
    [entradas, indices, vencimento, removidos],
  );
  const linhas = useMemo(() => base.map((l) => ({ ...l, ...(manuais[l.id] || {}) })), [base, manuais]);

  useEffect(() => { gravar(CHAVE_LOTE, { entradas, vencimento, manuais, removidos }); }, [entradas, vencimento, manuais, removidos]);

  const comErro = linhas.filter((l) => l.erros.length);
  const prontas = linhas.filter((l) => !l.erros.length);
  const semPedido = prontas.filter((l) => !l.pedido).length;
  const semMiro = prontas.filter((l) => l.pedido && !l.miro).length;
  const concluidas = linhas.filter((l) => l.miro).length;
  const semTabelas = !parametros.filiais.length || !parametros.escritorios.length;

  async function importarParametros(arquivo) {
    if (!arquivo) return;
    setErro(''); setFeedback('');
    try {
      const r = await extrairParametrosDeArquivo(arquivo);
      const novo = salvarParametros(r);
      setParametros(novo);
      setFeedback(`Tabelas atualizadas: ${fmt(novo.filiais.length)} filiais e ${fmt(novo.escritorios.length)} escritorios/centros de custo.`);
    } catch (e) { setErro(e.message || 'Nao consegui ler as tabelas.'); }
    finally { if (refParam.current) refParam.current.value = ''; }
  }

  function carregarEntradas(matriz, origem) {
    try {
      const lista = lerEntradaNfse(matriz);
      setEntradas(lista); setManuais({}); setRemovidos([]);
      setErro('');
      setFeedback(`${fmt(lista.length)} nota(s) carregada(s) de ${origem}.`);
    } catch (e) { setErro(e.message); }
  }

  async function carregarArquivo(arquivo) {
    if (!arquivo) return;
    try {
      const XLSX = await import('xlsx');
      const wb = await lerPlanilhaArquivo(arquivo);
      const nome = wb.SheetNames.includes('Preencher Dados') ? 'Preencher Dados' : wb.SheetNames[0];
      carregarEntradas(abaParaMatriz(XLSX, wb.Sheets[nome]), arquivo.name);
    } catch (e) { setErro(e.message || 'Nao consegui ler o arquivo.'); }
    finally { if (refArquivo.current) refArquivo.current.value = ''; }
  }

  function editar(id, campo, valor) {
    setManuais((atual) => ({ ...atual, [id]: { ...(atual[id] || {}), [campo]: valor } }));
  }

  function baixarScript() {
    setErro('');
    if (!prontas.length) { setErro('Nao ha notas prontas para lancar.'); return; }
    if (comErro.length) { setErro(`${comErro.length} nota(s) com pendencia. Corrija ou remova antes de gerar o script.`); return; }
    try {
      baixarArquivo('lancar-nfse.vbs', gerarScriptNfse({ linhas: linhasParaScriptNfse(prontas) }));
      setFeedback(`Script baixado com ${fmt(prontas.length)} nota(s) (${fmt(semPedido)} sem pedido, ${fmt(semMiro)} so com pedido). Com o SAP aberto e logado, de dois cliques nele. O resultado fica em ${PASTA_NFSE}\\resultado_nfse.csv.`);
    } catch (e) { setErro(e.message); }
  }

  async function importarResultado(arquivo) {
    if (!arquivo) return;
    try {
      const texto = await arquivo.text();
      const { linhas: novas, atualizadas } = aplicarResultado(linhas, lerResultadoCsv(texto));
      const mapa = {};
      novas.forEach((l) => { mapa[l.id] = { ...(manuais[l.id] || {}), pedido: l.pedido, miro: l.miro }; });
      setManuais((a) => ({ ...a, ...mapa }));
      setErro('');
      setFeedback(atualizadas ? `Resultado aplicado em ${fmt(atualizadas)} nota(s).` : 'Nenhuma nota do arquivo bate com o lote atual (confira se e o resultado deste lote).');
    } catch (e) { setErro(e.message || 'Nao consegui ler o resultado.'); }
    finally { if (refResultado.current) refResultado.current.value = ''; }
  }

  async function baixarEnviar() {
    const dados = linhasEnviarNfse(linhas);
    if (!dados.length) { setErro('Ainda nao ha pedido/MIRO para enviar.'); return; }
    await baixarXlsx('nfse-resumo-enviar.xlsx', dados, CABECALHO_ENVIAR_NFSE);
  }

  function salvarHistorico() {
    const novos = linhasHistoricoNfse(linhas);
    if (!novos.length) { setErro('Nenhuma nota com MIRO para guardar no historico.'); return; }
    const atual = ler(CHAVE_HISTORICO, []);
    const chaves = new Set(atual.map((h) => `${h['NF Serviço']}|${h['CNPJ Transp.']}|${h.NrMIRO}`));
    const inedito = novos.filter((h) => !chaves.has(`${h['NF Serviço']}|${h['CNPJ Transp.']}|${h.NrMIRO}`));
    gravar(CHAVE_HISTORICO, [...atual, ...inedito].slice(-20000));
    setErro('');
    setFeedback(`${fmt(inedito.length)} nota(s) adicionada(s) ao historico (${fmt(atual.length + inedito.length)} no total).`);
  }

  async function baixarHistorico() {
    const h = ler(CHAVE_HISTORICO, []);
    if (!h.length) { setErro('O historico esta vazio.'); return; }
    await baixarXlsx('nfse-lancados-historico.xlsx', h, CABECALHO_HISTORICO_NFSE);
  }

  function limparLote() {
    setEntradas([]); setManuais({}); setRemovidos([]); setColado(''); setErro(''); setFeedback('');
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {erro ? <div style={{ padding: 12, borderRadius: 8, background: '#fee2e2', color: '#991b1b' }}>{erro}</div> : null}
      {feedback && !erro ? <div style={{ padding: 12, borderRadius: 8, background: '#dcfce7', color: '#166534' }}>{feedback}</div> : null}

      <div className="panel-card">
        <div className="panel-title">Tabelas de parametros</div>
        <p>Filiais (empresa e centro pelo CNPJ do tomador) e Escritorios BI (centro de custo). Importe uma vez o <code>Parâmetros.xlsx</code> (ou qualquer planilha de lançamento que tenha as abas Filiais_Cantu e Escritorios BI); ficam guardadas neste navegador.</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input ref={refParam} type="file" accept=".xlsx,.xlsm,.xls" onChange={(e) => importarParametros(e.target.files?.[0])} />
          <span style={{ color: semTabelas ? '#b91c1c' : '#334155' }}>
            {semTabelas ? 'Tabelas ainda nao importadas.' : `${fmt(parametros.filiais.length)} filiais · ${fmt(parametros.escritorios.length)} centros de custo · atualizado em ${isoParaBr((parametros.atualizadoEm || '').slice(0, 10))}`}
          </span>
        </div>
      </div>

      <div className="panel-card">
        <div style={passoStyle}>
          <span style={numStyle}>1</span>
          <div style={{ flex: 1 }}>
            <div className="panel-title" style={{ margin: 0 }}>Notas de serviço (NFS-e)</div>
            <p style={{ margin: '4px 0 10px' }}>Cole as linhas copiadas do Excel (com o cabeçalho) ou carregue o arquivo. Colunas da antiga aba “Preencher Dados”: NF, Transportadora, CNPJ Transp, Data Emissão, Valor, Cod, CFOP, CNPJ Tomador, EscrV, Fatura.</p>
            <textarea value={colado} onChange={(e) => setColado(e.target.value)} rows={4} placeholder="Cole aqui (Ctrl+V) as linhas do Excel, inclusive a linha de cabeçalho" style={{ width: '100%', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
              <button type="button" className="btn-primary" disabled={!colado.trim() || semTabelas} onClick={() => carregarEntradas(tsvParaMatriz(colado), 'colagem')}>Carregar notas coladas</button>
              <input ref={refArquivo} type="file" accept=".xlsx,.xlsm,.xls,.csv" disabled={semTabelas} onChange={(e) => carregarArquivo(e.target.files?.[0])} />
              {entradas.length ? <button type="button" className="btn-secondary" onClick={limparLote}>Limpar lote</button> : null}
            </div>
            {semTabelas ? <div style={{ marginTop: 6, color: '#b91c1c', fontSize: 12 }}>Importe as tabelas de parametros acima antes de carregar as notas.</div> : null}
          </div>
        </div>

        {linhas.length ? (
          <>
            <div className="summary-strip" style={{ marginTop: 14 }}>
              <div className="summary-card"><span>Notas</span><strong>{fmt(linhas.length)}</strong></div>
              <div className="summary-card"><span>Com pendência</span><strong style={{ color: comErro.length ? '#b91c1c' : undefined }}>{fmt(comErro.length)}</strong></div>
              <div className="summary-card"><span>Sem pedido</span><strong>{fmt(semPedido)}</strong></div>
              <div className="summary-card"><span>Pedido sem MIRO</span><strong>{fmt(semMiro)}</strong></div>
              <div className="summary-card"><span>Concluídas</span><strong>{fmt(concluidas)}</strong></div>
              <div className="summary-card"><span>Valor total</span><strong style={{ fontSize: 15 }}>{moeda(linhas.reduce((s, l) => s + (l.valor || 0), 0))}</strong></div>
            </div>
            <div className="field" style={{ marginTop: 10, maxWidth: 220 }}>
              <label>Vencimento (todas as notas)</label>
              <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
            </div>
            <div style={{ overflowX: 'auto', marginTop: 10, maxHeight: 420, overflowY: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>{['Emp', 'NF', 'Transportadora', 'CNPJ Transp', 'Emissão', 'Valor', 'Cod', 'CFOP', 'Centro', 'C.Custo', 'Fatura', 'Pedido', 'MIRO', ''].map((c) => <th key={c} style={th}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.id} style={{ background: l.erros.length ? '#fef2f2' : undefined }} title={l.erros.join('; ')}>
                      <td style={td}>{l.emp || '—'}</td>
                      <td style={td}>{l.nf}</td>
                      <td style={td}>{l.transportadora}</td>
                      <td style={td}>{l.cnpjTransp}</td>
                      <td style={td}>{isoParaBr(l.dataEmissao)}</td>
                      <td style={td}>{moeda(l.valor)}</td>
                      <td style={td}>{l.codImp}</td>
                      <td style={td}>{l.cfop}</td>
                      <td style={td}>{l.centro || '—'}</td>
                      <td style={td}>{l.cc || '—'}</td>
                      <td style={td}>{l.fatura}</td>
                      <td style={td}><input style={{ width: 96 }} value={l.pedido} onChange={(e) => editar(l.id, 'pedido', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="pedido" /></td>
                      <td style={td}><input style={{ width: 96 }} value={l.miro} onChange={(e) => editar(l.id, 'miro', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="MIRO" /></td>
                      <td style={td}>
                        {l.erros.length ? <span style={{ color: '#b91c1c', marginRight: 8 }}>{l.erros[0]}</span> : null}
                        <button type="button" className="btn-link" onClick={() => setRemovidos((a) => [...a, l.id])}>remover</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Preencher o campo Pedido à mão equivale ao botão “Criar Miro (exceção)” da planilha: o robô pula o pedido e lança só a MIRO.</div>
          </>
        ) : null}
      </div>

      <div className="panel-card">
        <div style={passoStyle}>
          <span style={numStyle}>2</span>
          <div>
            <div className="panel-title" style={{ margin: 0 }}>Criar pedido e MIRO no SAP</div>
            <p style={{ margin: '4px 0 10px' }}>Gera o script com as notas acima. Ele cria o pedido (ME21N) das notas sem pedido e depois a MIRO das que têm pedido e ainda não têm MIRO. Para no primeiro erro e mostra qual nota falhou; ao rodar de novo, pula o que já tem número.</p>
            <button type="button" className="btn-primary" disabled={!prontas.length} onClick={baixarScript}>Baixar script de lançamento (.vbs)</button>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div style={passoStyle}>
          <span style={numStyle}>3</span>
          <div>
            <div className="panel-title" style={{ margin: 0 }}>Trazer o resultado e enviar</div>
            <p style={{ margin: '4px 0 10px' }}>Depois de rodar, carregue o arquivo <code>{PASTA_NFSE}\resultado_nfse.csv</code> para preencher os números de pedido e MIRO. Em seguida baixe o resumo para envio e guarde no histórico.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input ref={refResultado} type="file" accept=".csv,.txt" onChange={(e) => importarResultado(e.target.files?.[0])} />
              <button type="button" className="btn-secondary" onClick={baixarEnviar}>Baixar resumo (Enviar) .xlsx</button>
              <button type="button" className="btn-secondary" onClick={salvarHistorico}>Guardar lançadas no histórico</button>
              <button type="button" className="btn-secondary" onClick={baixarHistorico}>Baixar histórico .xlsx</button>
            </div>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-title">Como rodar</div>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Abra o SAP Logon e entre no sistema (scripting habilitado, como na planilha).</li>
          <li>Se o navegador avisar sobre o download do .vbs, escolha “Manter”. Se vier como <code>.vbs.txt</code>, renomeie para <code>.vbs</code>.</li>
          <li>Dê dois cliques no arquivo e não mexa no SAP até a mensagem final. Se der erro, a mensagem diz qual nota; corrija no SAP e rode de novo.</li>
        </ol>
      </div>
    </div>
  );
}
