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

  return (
    <div style={{ display: 'grid', gap: 16 }}>
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
          <div>
            <div className="panel-title" style={{ margin: 0 }}>Exportar o relatório do SAP</div>
            <p style={{ margin: '4px 0 10px' }}>Gera o script que abre a transação <b>{TRANSACAO_SAP}</b>, aplica o período, filtra o erro de saldo e exporta para <code>{PASTA_EXPORTACAO}</code> (limpando a pasta antes). Equivale ao botão “1. Executar” da planilha.</p>
            <button type="button" className="btn-primary" onClick={gerarExportacao}>Baixar script de exportação (.vbs)</button>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div style={passoStyle}>
          <span style={numStyle}>2</span>
          <div style={{ flex: 1 }}>
            <div className="panel-title" style={{ margin: 0 }}>Carregar as chaves</div>
            <p style={{ margin: '4px 0 10px' }}>Selecione o arquivo exportado (<code>CT-esErro</code>, .xlsx ou .txt). O robô tira as transportadoras ignoradas e fica só com a “Chave CTe” — o que o Power Query da planilha fazia. Também dá para colar as chaves manualmente.</p>
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
        {chaves.length ? (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <input type="checkbox" checked={deduplicar} onChange={(e) => { setDeduplicar(e.target.checked); salvarParams({ deduplicar: e.target.checked }); }} />
            Remover chaves repetidas (o relatório traz uma linha por mensagem de erro)
          </label>
        ) : null}
      </div>

      <div className="panel-card">
        <div style={passoStyle}>
          <span style={numStyle}>3</span>
          <div>
            <div className="panel-title" style={{ margin: 0 }}>Reprocessar no SAP</div>
            <p style={{ margin: '4px 0 10px' }}>Gera o script que cola cada lote na seleção múltipla, executa e manda reprocessar, e grava um log do andamento. Equivale à macro “Reprocessar”.</p>
            <button type="button" className="btn-primary" onClick={gerarReprocessamento} disabled={!chavesFinais.length}>Baixar script de reprocessamento (.vbs)</button>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-title">Como rodar</div>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Abra o SAP Logon e entre no sistema (o scripting do SAP GUI precisa estar habilitado — o mesmo requisito da planilha).</li>
          <li>Se o navegador avisar sobre o download do .vbs, escolha “Manter”. Dê dois cliques no arquivo para executar.</li>
          <li>Não mexa no SAP enquanto o script roda. Ao terminar aparece uma mensagem.</li>
        </ol>
      </div>
    </div>
  );
}
