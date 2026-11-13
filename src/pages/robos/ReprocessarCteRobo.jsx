import { useMemo, useRef, useState } from 'react';
import {
  LOTE_PADRAO,
  PASTA_EXPORTACAO,
  TRANSPORTADORAS_IGNORADAS_PADRAO,
  TRANSACAO_SAP,
  baixarTexto,
  chavesDoRelatorioSap,
  dataSapValida,
  dividirEmLotes,
  extrairChavesDeTexto,
  gerarScriptExportacaoVbs,
  gerarScriptReprocessarVbs,
  isoParaSap,
  lerArquivoRelatorioSap,
  removerDuplicadas,
} from '../../utils/robos/reprocessarCte';
import { NOME_DADOS_REPROCESSAR, gerarMacroReprocessar, matrizDadosReprocessar } from '../../utils/robos/reprocessarCteMacro';
import { PLANILHA_ROBO } from '../../utils/robos/sapMacroExcel';
import { getSupabaseAcessoPublico } from '../../lib/supabaseClient';
import { baixarMatrizXlsx } from '../../utils/robos/lancamentoComum';
import { BaixarPlanilhaRobo, passosMacroExcel } from './MacroExcel';
import ScriptParaCopiar from './ScriptParaCopiar';

const CHAVE_PARAMS = 'central_fretes_robo_reprocessar_cte_v1';

function lerParams() {
  try {
    return { ...JSON.parse(window.localStorage.getItem(CHAVE_PARAMS) || '{}') };
  } catch {
    return {};
  }
}

function fmt(n) {
  return Number(n || 0).toLocaleString('pt-BR');
}

const passoStyle = { display: 'flex', gap: 12, alignItems: 'flex-start' };
const numStyle = { width: 26, height: 26, borderRadius: '50%', background: '#0f172a', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flex: '0 0 auto' };

export default function ReprocessarCteRobo() {
  const salvo = useMemo(lerParams, []);
  const [dataInicial, setDataInicial] = useState(salvo.dataInicial || '');
  const [dataFinal, setDataFinal] = useState(salvo.dataFinal || '');
  const [lote, setLote] = useState(salvo.lote || LOTE_PADRAO);
  const [ignorar, setIgnorar] = useState(salvo.ignorar ?? TRANSPORTADORAS_IGNORADAS_PADRAO.join(', '));
  const [deduplicar, setDeduplicar] = useState(salvo.deduplicar ?? true);
  const [chaves, setChaves] = useState([]);
  const [origem, setOrigem] = useState('');
  const [stats, setStats] = useState(null);
  const [colado, setColado] = useState('');
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');
  const [macroTela, setMacroTela] = useState(null);
  const inputRef = useRef(null);

  const iniSap = isoParaSap(dataInicial);
  const fimSap = isoParaSap(dataFinal);
  const loteNum = Math.max(1, Math.floor(Number(lote)) || LOTE_PADRAO);
  const chavesFinais = useMemo(() => (deduplicar ? removerDuplicadas(chaves) : chaves), [chaves, deduplicar]);
  const lotes = useMemo(() => dividirEmLotes(chavesFinais, loteNum), [chavesFinais, loteNum]);

  function salvarParams(patch = {}) {
    try {
      window.localStorage.setItem(CHAVE_PARAMS, JSON.stringify({ dataInicial, dataFinal, lote, ignorar, deduplicar, ...patch }));
    } catch { /* sem localStorage: segue so na sessao */ }
  }

  function validarDatas() {
    if (!dataSapValida(iniSap)) { setErro('Informe a data inicial do período.'); return false; }
    if (fimSap && !dataSapValida(fimSap)) { setErro('Data final inválida.'); return false; }
    if (fimSap && dataFinal < dataInicial) { setErro('A data final não pode ser anterior à inicial.'); return false; }
    setErro('');
    return true;
  }

  function gerarExportacao() {
    if (!validarDatas()) return;
    try {
      salvarParams();
      baixarTexto('1-exportar-relatorio-cte.vbs', gerarScriptExportacaoVbs({ dataInicial: iniSap, dataFinal: fimSap }));
      setFeedback('Script baixado. Com o SAP aberto e logado, dê dois cliques nele. Ao terminar, carregue o arquivo exportado no passo 2.');
    } catch (e) { setErro(e.message); }
  }

  async function carregarArquivo(arquivo) {
    if (!arquivo) return;
    setErro(''); setFeedback('');
    try {
      const matriz = await lerArquivoRelatorioSap(arquivo);
      const lista = ignorar.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
      const r = chavesDoRelatorioSap(matriz, { ignorarTransportadoras: lista });
      setChaves(r.chaves);
      setStats(r.stats);
      setOrigem(arquivo.name);
      salvarParams();
      setFeedback(`${fmt(r.chaves.length)} chave(s) lida(s) de ${arquivo.name}.`);
    } catch (e) {
      setErro(e.message || 'Não consegui ler o arquivo.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function usarColadas() {
    const { chaves: lista, invalidas } = extrairChavesDeTexto(colado);
    if (!lista.length) { setErro('Nenhuma chave de 44 dígitos encontrada no texto colado.'); return; }
    setChaves(lista);
    setStats({ linhasLidas: lista.length + invalidas.length, ignoradasTransportadora: 0, semChaveValida: invalidas.length, chavesBrutas: lista.length });
    setOrigem('colagem manual');
    setErro('');
    setFeedback(`${fmt(lista.length)} chave(s) usada(s)${invalidas.length ? `; ${fmt(invalidas.length)} item(ns) ignorado(s) por não terem 44 dígitos` : ''}.`);
  }

  function limpar() {
    setChaves([]); setStats(null); setOrigem(''); setColado(''); setErro(''); setFeedback('');
  }

  function gerarReprocessamento() {
    if (!validarDatas()) return;
    if (!chavesFinais.length) { setErro('Carregue o arquivo do SAP (ou cole as chaves) antes.'); return; }
    try {
      salvarParams();
      baixarTexto('2-reprocessar-cte.vbs', gerarScriptReprocessarVbs({ chaves: chavesFinais, dataInicial: iniSap, dataFinal: fimSap, lote: loteNum }));
      setFeedback(`Script baixado com ${fmt(chavesFinais.length)} chave(s) em ${fmt(lotes.length)} lote(s). Com o SAP aberto, dê dois cliques nele. O andamento fica em ${PASTA_EXPORTACAO}\\log_reprocessar.txt.`);
    } catch (e) { setErro(e.message); }
  }

  // Planilha do robo no Excel: baixa so os dados (periodo, lote, ignoradas e, se carregadas, as chaves).
  async function baixarDadosMacro() {
    if (!validarDatas()) return;
    try {
      salvarParams();
      const lista = ignorar.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
      await baixarMatrizXlsx(NOME_DADOS_REPROCESSAR, matrizDadosReprocessar({ chaves: chavesFinais, dataInicial: iniSap, dataFinal: fimSap, lote: loteNum, ignorar: lista, deduplicar, central: getSupabaseAcessoPublico() }));
      setFeedback(chavesFinais.length
        ? `Dados baixados (${NOME_DADOS_REPROCESSAR}) com ${fmt(chavesFinais.length)} chave(s) em ${fmt(lotes.length)} lote(s). Na planilha do robô, com o SAP logado, clique em Escriturar CT-e e escolha esse arquivo.`
        : `Dados baixados (${NOME_DADOS_REPROCESSAR}). Na planilha do robô, com o SAP logado, clique em Escriturar CT-e e escolha esse arquivo: ela exporta o relatório, tira ${lista.length ? lista.join(', ') : 'as ignoradas'} e reprocessa em lotes de ${fmt(loteNum)}.`);
    } catch (e) { setErro(e.message); }
  }

  function verMacro() {
    const m = gerarMacroReprocessar();
    setMacroTela({ script: m.codigo, macro: m.macro });
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {macroTela ? (
        <ScriptParaCopiar
          script={macroTela.script}
          nomeArquivo={PLANILHA_ROBO.nome}
          onFechar={() => setMacroTela(null)}
          titulo="Código da macro (Excel)"
          passos={passosMacroExcel(macroTela.macro, PLANILHA_ROBO.nome, <>A cada rodada: baixe <b>Dados para o Excel</b> na Central, abra a planilha do robô com o SAP logado, clique no botão (ou <b>Alt+F8</b> → <code>{macroTela.macro}</code> → Executar) e escolha o arquivo de dados. O log fica em <code>{PASTA_EXPORTACAO}</code>.</>)}
        />
      ) : null}
      {erro ? <div style={{ padding: 12, borderRadius: 8, background: '#fee2e2', color: '#991b1b' }}>{erro}</div> : null}
      {feedback && !erro ? <div style={{ padding: 12, borderRadius: 8, background: '#dcfce7', color: '#166534' }}>{feedback}</div> : null}

      <div className="panel-card">
        <div className="panel-title">Período do relatório</div>
        <p>Mesmas datas das células “Data inicial / Data final” da planilha. Data final vazia = sem limite superior (usa as opções de seleção do SAP).</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field"><label>Data inicial</label><input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} /></div>
          <div className="field"><label>Data final</label><input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} /></div>
          <div className="field"><label>Chaves por lote</label><input type="number" min="1" max="1000" value={lote} onChange={(e) => setLote(e.target.value)} style={{ width: 100 }} /></div>
          <div className="field" style={{ minWidth: 220 }}><label>Ignorar transportadoras (contém)</label><input value={ignorar} onChange={(e) => setIgnorar(e.target.value)} placeholder="EBAZAR" /></div>
        </div>
      </div>

      <div className="panel-card">
        <div style={passoStyle}>
          <span style={numStyle}>1</span>
          <div style={{ flex: 1 }}>
            <div className="panel-title" style={{ margin: 0 }}>Baixar os dados para a planilha do robô</div>
            <p style={{ margin: '4px 0 10px' }}>Planilha comum (sem código) com o período, o tamanho do lote e as transportadoras ignoradas. Na planilha do robô, <b>▶ Escriturar CT-e</b> faz tudo o que a planilha antiga fazia: abre a <b>{TRANSACAO_SAP}</b>, filtra o erro de saldo, exporta para <code>{PASTA_EXPORTACAO}</code>, tira as transportadoras ignoradas e as chaves repetidas, mostra quantas achou e reprocessa em lotes. No fim, consulta o log de novo e grava na base de partidas da Central cada CT-e que ganhou MIRO (não precisa esperar a importação do relatório do SAP).</p>
            {chavesFinais.length ? (
              <div style={{ marginBottom: 10, padding: 8, borderRadius: 8, background: '#fff7ed', color: '#9a3412', fontSize: 13 }}>
                Vão no arquivo as <b>{fmt(chavesFinais.length)}</b> chave(s) carregadas abaixo ({fmt(lotes.length)} lote(s)): o robô reprocessa só elas, sem exportar o relatório. Para o fluxo completo, clique em <b>Limpar</b> nas chaves.
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn-primary" onClick={baixarDadosMacro} title="Planilha comum (sem codigo) para a planilha do robo">Baixar dados para o Excel (.xlsx)</button>
              <BaixarPlanilhaRobo gerar={gerarMacroReprocessar} />
            </div>
            <details style={{ marginTop: 8, fontSize: 13 }}>
              <summary style={{ cursor: 'pointer', color: '#64748b' }}>Outras opções</summary>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <button type="button" className="btn-secondary" onClick={verMacro} title="Para montar ou atualizar a planilha do robo">Código da macro (Excel)</button>
                <button type="button" className="btn-secondary" onClick={gerarExportacao} title="Alternativa antiga, onde o antivirus deixa rodar .vbs">Script de exportação (.vbs)</button>
                <button type="button" className="btn-secondary" onClick={gerarReprocessamento} disabled={!chavesFinais.length} title="Alternativa antiga: precisa das chaves carregadas abaixo">Script de reprocessamento (.vbs)</button>
              </div>
            </details>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div style={passoStyle}>
          <span style={numStyle}>2</span>
          <div style={{ flex: 1 }}>
            <div className="panel-title" style={{ margin: 0 }}>Opcional: reprocessar só chaves específicas</div>
            <p style={{ margin: '4px 0 10px' }}>Se já tem as chaves (o arquivo <code>CT-esErro</code> exportado, .xlsx ou .txt, ou uma lista colada), carregue aqui antes de baixar os dados: o robô pula a exportação e reprocessa só essas. Do arquivo exportado, a Central tira as transportadoras ignoradas e fica só com a “Chave CTe”.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.txt,.csv" onChange={(e) => carregarArquivo(e.target.files?.[0])} />
              {chaves.length ? <button type="button" className="btn-secondary" onClick={limpar}>Limpar</button> : null}
            </div>
            <textarea value={colado} onChange={(e) => setColado(e.target.value)} rows={3} placeholder="…ou cole aqui as chaves de 44 dígitos (uma por linha)" style={{ width: '100%', boxSizing: 'border-box' }} />
            <div style={{ marginTop: 6 }}><button type="button" className="btn-secondary" onClick={usarColadas} disabled={!colado.trim()}>Usar chaves coladas</button></div>
          </div>
        </div>

        {stats ? (
          <div className="summary-strip" style={{ marginTop: 14 }}>
            <div className="summary-card"><span>Origem</span><strong style={{ fontSize: 14 }}>{origem}</strong></div>
            <div className="summary-card"><span>Chaves a reprocessar</span><strong>{fmt(chavesFinais.length)}</strong></div>
            <div className="summary-card"><span>Lotes de {fmt(loteNum)}</span><strong>{fmt(lotes.length)}</strong></div>
            <div className="summary-card"><span>Ignoradas (transportadora)</span><strong>{fmt(stats.ignoradasTransportadora)}</strong></div>
            <div className="summary-card"><span>Sem chave válida</span><strong>{fmt(stats.semChaveValida)}</strong></div>
            <div className="summary-card"><span>Repetidas removidas</span><strong>{fmt(deduplicar ? chaves.length - chavesFinais.length : 0)}</strong></div>
          </div>
        ) : null}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
          <input type="checkbox" checked={deduplicar} onChange={(e) => { setDeduplicar(e.target.checked); salvarParams({ deduplicar: e.target.checked }); }} />
          Remover chaves repetidas (o relatório traz uma linha por mensagem de erro)
        </label>
      </div>

      <div className="panel-card">
        <div className="panel-title">Como rodar</div>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Preencha o período e clique em <b>Baixar dados para o Excel</b> (passo 1).</li>
          <li>Com o SAP logado, abra a planilha do robô, clique em <b>▶ Escriturar CT-e</b> e escolha o arquivo baixado. Ela mostra quantas chaves achou e pergunta antes de reprocessar.</li>
          <li>Não mexa no SAP até a mensagem final. O andamento fica em <code>{PASTA_EXPORTACAO}\log_reprocessar.txt</code>; as partidas gravadas, em <code>partidas_gravadas.csv</code>.</li>
          <li style={{ color: '#64748b' }}>É a mesma planilha do Lançamento NFS-e/CT-e e da Correção de saldo (um botão para cada). Primeira vez: baixe a <b>Planilha do robô (.xlsm)</b>, salve na sua pasta e, no arquivo, botão direito → Propriedades → marque <b>Desbloquear</b>.</li>
        </ol>
      </div>
    </div>
  );
}
