import { useEffect, useMemo, useRef, useState } from 'react';
import ParametrosLancamentoCard from './ParametrosLancamentoCard';
import {
  CABECALHO_ENVIAR_CTE,
  CABECALHO_LANCAMENTO_CTE,
  extrairCte,
  podeIrParaRobo,
  linhasEnviarCte,
  linhasLancamentoCte,
  linhasParaScriptCte,
  montarLancamentoCte,
} from '../../utils/robos/lancamentoCte';
import {
  baixarMatrizXlsx,
  baixarXlsx,
  carregarParametros,
  criarIndices,
  hojeIso,
  naoAntesDeHoje,
  isoParaBr,
  lerResultadoCsv,
} from '../../utils/robos/lancamentoComum';
import { registrarLancamentos } from '../../services/robosLancamentosService';
import { buscarNaFila, salvarNaFila } from '../../services/robosFilaService';
import { CHAVE_LOTE_CTE, itemFilaCte, numerosDaFila } from '../../utils/robos/filaRobo';
import { getSupabaseAcessoPublico } from '../../lib/supabaseClient';
import AvisoFila from './AvisoFila';
import { carregarSessao } from '../../utils/authLocal';
import ScriptParaCopiar from './ScriptParaCopiar';
import { BaixarPlanilhaRobo, passosMacroExcel } from './MacroExcel';
import { gerarMacroCte, matrizDadosMacro, matrizEscritorios } from '../../utils/robos/sapMacroExcel';

const CHAVE = CHAVE_LOTE_CTE;

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
  const [vencimento, setVencimento] = useState(naoAntesDeHoje(inicial.vencimento));
  const [manuais, setManuais] = useState(inicial.manuais || {});
  const [removidos, setRemovidos] = useState(inicial.removidos || []);
  const [falhasXml, setFalhasXml] = useState([]);
  const [scriptTela, setScriptTela] = useState(null); // script aberto na tela para copiar
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');
  const refXml = useRef(null);
  const refPasta = useRef(null);
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
  // sem centro de custo mas com NF de venda: vai para o robo, que consulta no SAP antes de lancar
  const comErro = linhas.filter((l) => !podeIrParaRobo(l));
  const prontas = linhas.filter(podeIrParaRobo);
  const ccPeloRobo = prontas.filter((l) => l.erros.length).length;
  const semPedido = prontas.filter((l) => !l.pedido).length;
  const semMiro = prontas.filter((l) => l.pedido && !l.miro).length;
  const comCc = linhas.filter((l) => l.cc).length;
  // chaves das NFs de venda para a consulta do centro de custo (planilha do robo)

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

  // Fila do robo (robos_fila): guarda os CT-e mandados para o robo, com o XML lido, para lancar de novo
  // de qualquer computador, e o que saiu no SAP. Falha aqui nao atrapalha o lancamento.
  function guardarNaFila(lista, extra = {}) {
    const sessao = carregarSessao();
    const itens = lista.map((l) => ({ ...itemFilaCte(l, l.danfe ? partidas.get(l.danfe) : null, manuais[l.id]), ...extra }));
    return salvarNaFila(itens, sessao?.nome || sessao?.email || '').catch(() => null);
  }

  // Traz para a tela o que a planilha do robo ja mandou direto para a fila (pedido, MIRO).
  async function trazerDaFila(lista) {
    const mudou = numerosDaFila(lista, await buscarNaFila('CTE', lista.map((l) => l.id)));
    if (!mudou.length) return { lista, mudou: 0 };
    const porId = new Map(mudou.map((l) => [l.id, l]));
    setManuais((a) => {
      const n = { ...a };
      mudou.forEach((l) => { n[l.id] = { ...(a[l.id] || {}), pedido: l.pedido, miro: l.miro }; });
      return n;
    });
    registrarHistorico(mudou.filter((l) => l.miro));
    return { lista: lista.map((l) => porId.get(l.id) || l), mudou: mudou.length };
  }

  useEffect(() => {
    if (!linhas.length) return;
    trazerDaFila(linhas).then((r) => { if (r.mudou) setFeedback(`${fmt(r.mudou)} CT-e atualizado(s) com o que a planilha do robo mandou para a Central.`); }).catch(() => null);
  // so ao abrir a tela
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  // Planilha do robo no Excel: o codigo da macro e copiado uma vez; a cada lote baixa so os dados (.xlsx).
  function verMacro() {
    const m = gerarMacroCte();
    setScriptTela({ script: m.codigo, nome: 'Robo Lancamento.xlsm', macro: m.macro });
  }

  async function baixarDadosMacro() {
    setErro('');
    if (!prontas.length) { setErro('Nao ha CT-e prontos para lancar.'); return; }
    if (comErro.length) { setErro(`${comErro.length} CT-e com pendencia. Corrija ou remova antes de gerar os dados.`); return; }
    try {
      const { lista } = await trazerDaFila(prontas);
      const linhasScript = linhasParaScriptCte(lista);
      const semDados = linhasScript.filter((l) => !l.emp || !l.centro || !l.codImp || !l.dtEmissao || !l.dtVenc || !l.bruto || !l.liquido);
      if (semDados.length) throw new Error(`${semDados.length} CT-e sem empresa, centro, codigo de imposto, datas ou valores. Corrija antes de gerar os dados.`);
      const m = gerarMacroCte();
      await baixarMatrizXlsx('dados-robo-cte.xlsx', matrizDadosMacro(linhasScript, m, getSupabaseAcessoPublico()), [{ nome: 'Escritorios', matriz: matrizEscritorios(indices.escritorios) }]);
      guardarNaFila(lista, { descartado: false });
      setFeedback(`Dados de ${fmt(prontas.length)} CT-e baixados (dados-robo-cte.xlsx)${ccPeloRobo ? `; o robo consulta no SAP o centro de custo de ${fmt(ccPeloRobo)}` : ''}. Na planilha do robo, com o SAP logado, clique em Lancar CT-e e escolha esse arquivo. O resultado_cte.csv fica na pasta da planilha do robo (no fim ela oferece abrir a pasta).`);
    } catch (e) { setErro(e.message); }
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
      if (n) guardarNaFila(linhas.filter((l) => novos[l.id]).map((l) => ({ ...l, ...novos[l.id] })));
      let extra = '';
      if (n) {
        const r = await registrarHistorico(linhas.map((l) => ({ ...l, ...(novos[l.id] || {}) })));
        if (r) extra = ` ${fmt(r.novos)} novo(s) registrado(s) ${r.onde === 'banco' ? 'no historico' : 'no historico (so neste navegador: migration pendente)'}.`;
      }
      setFeedback(n ? `Resultado aplicado em ${fmt(n)} CT-e.${extra}` : 'Nenhum CT-e do arquivo bate com o lote atual.');
    } catch (e) { setErro(e.message || 'Nao consegui ler o resultado.'); }
    finally { if (refRes.current) refRes.current.value = ''; }
  }

  async function registrarHistorico(lista) {
    const com = lista.filter((l) => l.miro || l.pedido);
    if (!com.length) return null;
    const sessao = carregarSessao();
    return registrarLancamentos('CTE', com, sessao?.nome || sessao?.email || '');
  }

  async function guardarHistoricoManual() {
    const r = await registrarHistorico(linhas);
    if (!r) { setErro('Nenhum CT-e com MIRO para registrar no historico.'); return; }
    setErro(''); setFeedback(`Historico atualizado. ${fmt(r.novos)} novo(s) registrado(s).`);
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
      <AvisoFila tipo="CTE" />
      {scriptTela ? <ScriptParaCopiar script={scriptTela.script} nomeArquivo={scriptTela.nome} onFechar={() => setScriptTela(null)} titulo={scriptTela.macro ? 'Código da macro (Excel)' : undefined} passos={scriptTela.macro ? passosMacroExcel(scriptTela.macro) : undefined} /> : null}
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
                <div className="panel-title" style={{ margin: 0 }}>Conferir e lançar</div>
                <div className="summary-strip" style={{ marginTop: 10 }}>
                  <div className="summary-card"><span>CT-e</span><strong>{fmt(linhas.length)}</strong></div>
                  <div className="summary-card"><span>Com pendência</span><strong style={{ color: comErro.length ? '#b91c1c' : undefined }}>{fmt(comErro.length)}</strong></div>
                  <div className="summary-card"><span>C.Custo pelo robô</span><strong style={{ color: ccPeloRobo ? '#b45309' : undefined }}>{fmt(ccPeloRobo)}</strong></div>
                  <div className="summary-card"><span>Com centro de custo</span><strong>{fmt(comCc)}</strong></div>
                  <div className="summary-card"><span>Sem pedido</span><strong>{fmt(semPedido)}</strong></div>
                  <div className="summary-card"><span>Pedido sem MIRO</span><strong>{fmt(semMiro)}</strong></div>
                  <div className="summary-card"><span>Valor bruto</span><strong style={{ fontSize: 15 }}>{moeda(linhas.reduce((s, l) => s + l.bruto, 0))}</strong></div>
                </div>
                <div className="field" style={{ marginTop: 10, maxWidth: 220 }}>
                  <label>Vencimento (todos os CT-e)</label>
                  <input type="date" min={hojeIso()} value={vencimento} onChange={(e) => setVencimento(naoAntesDeHoje(e.target.value))} title="Nunca antes de hoje" />
                </div>
                <div style={{ overflowX: 'auto', marginTop: 10, maxHeight: 440, overflowY: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr>{['Emp', 'CT-e', 'Transportadora', 'Bruto', 'Líquido', 'ICMS', 'Imp.', 'Centro', 'C.Custo', 'Fatura', 'Pedido', 'MIRO', ''].map((c) => <th key={c} style={th}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {linhas.map((l) => (
                        <tr key={l.id} style={{ background: !podeIrParaRobo(l) ? '#fef2f2' : l.erros.length ? '#fff7ed' : undefined }} title={[...l.erros, ...l.avisos].join('; ')}>
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
                            {l.erros.length ? <span style={{ color: podeIrParaRobo(l) ? '#b45309' : '#b91c1c', marginRight: 8 }}>{l.erros[0]}</span> : l.avisos.length ? <span style={{ color: '#b45309', marginRight: 8 }}>{l.avisos[0]}</span> : null}
                            <button type="button" className="btn-link" onClick={() => setRemovidos((a) => [...a, l.id])}>remover</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 12, color: '#64748b' }}>Preencher o Pedido à mão equivale ao botão “Criar Miro (exceção)”: o robô pula o pedido e lança só a MIRO. Vencimento padrão = hoje.</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  <button type="button" className="btn-primary" disabled={!prontas.length} onClick={baixarDadosMacro} title="Planilha comum (sem codigo) com os CT-e, para a planilha do robo">Baixar dados para o Excel (.xlsx)</button>
                  <button type="button" className="btn-secondary" onClick={verMacro} title="Codigo da macro para a planilha do robo no Excel (copiar uma vez)">Código da macro (Excel)</button>
                  <BaixarPlanilhaRobo gerar={gerarMacroCte} />
                  <button type="button" className="btn-secondary" onClick={() => baixarXlsx('cte-lancamento.xlsx', linhasLancamentoCte(linhas), CABECALHO_LANCAMENTO_CTE)}>Baixar tabela (.xlsx)</button>
                </div>
              </div>
            </div>
          </div>

          <div className="panel-card">
            <div style={passoStyle}>
              <span style={numStyle}>3</span>
              <div>
                <div className="panel-title" style={{ margin: 0 }}>Trazer o resultado</div>
                <p style={{ margin: '4px 0 10px' }}>A planilha do robô manda pedido e MIRO direto para a Central (no fim aparece “Resultado já enviado”). Se aparecer que não chegou, carregue aqui o <code>resultado_cte.csv</code>, que fica na pasta da planilha do robô. Os CT-e com MIRO entram sozinhos no histórico; os que falharem aparecem em “Sem MIRO” (aba “Acompanhamento de lançamentos”). Ao rodar de novo, o robô pula o que já tem número.</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input ref={refRes} type="file" accept=".csv,.txt" onChange={(e) => importarResultado(e.target.files?.[0])} />
                  <button type="button" className="btn-secondary" onClick={baixarEnviar}>Baixar resumo (Enviar) .xlsx</button>
                  <button type="button" className="btn-secondary" onClick={guardarHistoricoManual}>Registrar no histórico</button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      <div className="panel-card">
        <div className="panel-title">Como rodar</div>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Uma vez só: baixe a <b>Planilha do robô (.xlsm)</b>, salve na sua pasta de trabalho e, no arquivo, clique com o botão direito → Propriedades → marque <b>Desbloquear</b>.</li>
          <li>Abra o SAP Logon e entre no sistema (scripting habilitado, como na planilha).</li>
          <li>Centro de custo: o que a Central não achar (em laranja na tabela) o robô consulta no SAP pela NF de venda antes de lançar. Se nem o SAP achar, o CT-e fica em “Sem MIRO” com o motivo; aí digite o centro de custo na tabela.</li>
          <li>Lançamento: baixe os <b>Dados para o Excel</b>, clique em <b>▶ Lançar CT-e</b> na planilha e escolha o arquivo. Não mexa no SAP até a mensagem final.</li>
        </ol>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Datas: emissão {linhas[0] ? isoParaBr(linhas[0].dataEmissao) : '—'} (primeiro CT-e). Vencimento usado: {isoParaBr(vencimento)}.</div>
      </div>
    </div>
  );
}
