import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CABECALHO_ENVIAR_NFSE,
  CABECALHO_MODELO_NFSE,
  EXEMPLO_MODELO_NFSE,
  aplicarResultado,
  entradaVazia,
  lerEntradaNfse,
  linhasEnviarNfse,
  linhasParaScriptNfse,
  montarLancamentoNfse,
  novaEntradaNfse,
} from '../../utils/robos/lancamentoNfse';
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
  tsvParaMatriz,
  valorParaSap,
} from '../../utils/robos/lancamentoComum';
import { PASTA_NFSE, gerarScriptNfse } from '../../utils/robos/sapLancamentoVbs';
import { registrarLancamentos } from '../../services/robosLancamentosService';
import { carregarSessao } from '../../utils/authLocal';
import ParametrosLancamentoCard from './ParametrosLancamentoCard';

const CHAVE_LOTE = 'central_fretes_robo_nfse_lote_v2';

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
  const [vencimento, setVencimento] = useState(inicial.vencimento || hojeIso());
  const [colado, setColado] = useState('');
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');
  const [focar, setFocar] = useState(null);
  const refArquivo = useRef(null);
  const refResultado = useRef(null);
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

  const comErro = linhas.filter((l) => l.erros.length);
  const prontas = linhas.filter((l) => !l.erros.length);
  const semPedido = prontas.filter((l) => !l.pedido).length;
  const semMiro = prontas.filter((l) => l.pedido && !l.miro).length;
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
  function acrescentar(lista, origem) {
    const novas = lista.map((e) => novaEntradaNfse(novoUid(), { ...e, valor: e.valor === null || e.valor === undefined ? '' : valorParaSap(e.valor) }));
    setEntradas((atual) => [...atual.filter((e) => !entradaVazia(e)), ...novas]);
    setErro('');
    setFeedback(`${fmt(novas.length)} nota(s) adicionada(s) de ${origem}.`);
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
      acrescentar(lerEntradaNfse(abaParaMatriz(XLSX, wb.Sheets[nome])), arquivo.name);
    } catch (e) { setErro(e.message || 'Nao consegui ler o arquivo.'); }
    finally { if (refArquivo.current) refArquivo.current.value = ''; }
  }

  async function baixarModelo() {
    await baixarXlsx('modelo-importacao-nfse.xlsx', [EXEMPLO_MODELO_NFSE], CABECALHO_MODELO_NFSE);
  }

  function limparTudo() {
    setEntradas([]); setManuais({}); setColado(''); setErro(''); setFeedback('');
  }

  // ---------------------------------------------------------------- SAP
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
      const { linhas: novas, atualizadas } = aplicarResultado(linhas, lerResultadoCsv(await arquivo.text()));
      const mapa = {};
      novas.forEach((l) => { mapa[l.uid] = { ...(manuais[l.uid] || {}), pedido: l.pedido, miro: l.miro }; });
      setManuais((a) => ({ ...a, ...mapa }));
      setErro('');
      const r = atualizadas ? await registrarHistorico(novas, true) : null;
      setFeedback(atualizadas ? `Resultado aplicado em ${fmt(atualizadas)} nota(s).${textoHistorico(r)}` : 'Nenhuma nota do arquivo bate com o lote atual (confira se e o resultado deste lote).');
    } catch (e) { setErro(e.message || 'Nao consegui ler o resultado.'); }
    finally { if (refResultado.current) refResultado.current.value = ''; }
  }

  async function baixarEnviar() {
    const dados = linhasEnviarNfse(linhas);
    if (!dados.length) { setErro('Ainda nao ha pedido/MIRO para enviar.'); return; }
    await baixarXlsx('nfse-resumo-enviar.xlsx', dados, CABECALHO_ENVIAR_NFSE);
  }

  async function registrarHistorico(lista, automatico = false) {
    const com = lista.filter((l) => l.miro);
    if (!com.length) { if (!automatico) setErro('Nenhuma nota com MIRO para registrar no historico.'); return null; }
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
              <button type="button" className="btn-secondary" onClick={baixarModelo}>Baixar modelo de importação (.xlsx)</button>
              {entradas.length ? <button type="button" className="btn-secondary" onClick={limparTudo}>Limpar tudo</button> : null}
              <div className="field" style={{ marginLeft: 'auto' }}>
                <label>Vencimento padrão</label>
                <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
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
                        <td style={calc}>{l?.cc || '—'}</td>
                        <td style={td}><input style={{ ...inp, width: 92 }} value={m.pedido || ''} onChange={(ev) => editarResultado(e.uid, 'pedido', ev.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="pedido" /></td>
                        <td style={td}><input style={{ ...inp, width: 92 }} value={m.miro || ''} onChange={(ev) => editarResultado(e.uid, 'miro', ev.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="MIRO" /></td>
                        <td style={td}>
                          {temErro ? <span style={{ color: '#b91c1c', marginRight: 8 }} title={l.erros.join('; ')}>{l.erros[0]}</span> : null}
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
            <p style={{ margin: '4px 0 10px' }}>Depois de rodar, carregue o arquivo <code>{PASTA_NFSE}\resultado_nfse.csv</code> para preencher os números de pedido e MIRO. As notas com MIRO entram sozinhas no histórico (aba “Acompanhamento de lançamentos”). Em seguida baixe o resumo para envio.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input ref={refResultado} type="file" accept=".csv,.txt" onChange={(e) => importarResultado(e.target.files?.[0])} />
              <button type="button" className="btn-secondary" onClick={baixarEnviar}>Baixar resumo (Enviar) .xlsx</button>
              <button type="button" className="btn-secondary" onClick={guardarHistoricoManual}>Registrar no histórico</button>
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
