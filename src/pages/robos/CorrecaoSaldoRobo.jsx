import { useEffect, useMemo, useState } from 'react';
import { TRANSACAO_SAP, dataSapValida, extrairChavesDeTexto, isoParaSap, removerDuplicadas } from '../../utils/robos/reprocessarCte';
import { MACRO_SALDO, NOME_DADOS_SALDO, PASTA_SALDO, gerarMacroSaldo, matrizDadosSaldo } from '../../utils/robos/correcaoSaldoMacro';
import { PLANILHA_ROBO } from '../../utils/robos/sapMacroExcel';
import { baixarMatrizXlsx } from '../../utils/robos/lancamentoComum';
import { getSupabaseAcessoPublico } from '../../lib/supabaseClient';
import { carregarSessao } from '../../utils/authLocal';
import { carregarPendentesSaldo, descartarPendentesSaldo } from '../../services/robosParametrosService';
import { BaixarPlanilhaRobo, passosMacroExcel } from './MacroExcel';
import ScriptParaCopiar from './ScriptParaCopiar';

// Nome de quem baixou os dados: vai para o "Lancado por" do acompanhamento.
function usuarioLogado() {
  const sessao = carregarSessao();
  return sessao?.nome || sessao?.email || '';
}

function dataHoraBr(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

const CHAVE_PARAMS = 'central_fretes_robo_correcao_saldo_v1';

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

// Robo "Correcao de saldo": substitui a planilha "Ajuste de saldo". Fica na planilha unica do robo
// (botao Corrigir saldo); aqui a Central so monta o arquivo de dados.
export default function CorrecaoSaldoRobo() {
  const salvo = useMemo(lerParams, []);
  const [dataInicial, setDataInicial] = useState(salvo.dataInicial || '');
  const [dataFinal, setDataFinal] = useState(salvo.dataFinal || '');
  const [ignorar, setIgnorar] = useState(salvo.ignorar ?? 'EBAZAR');
  const [colado, setColado] = useState('');
  const [chaves, setChaves] = useState([]);
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');
  const [macroTela, setMacroTela] = useState(null);
  const [fila, setFila] = useState(null); // rodadas da Escrituracao com CT-e parados por erro de saldo
  const [filaErro, setFilaErro] = useState('');
  const [origemChaves, setOrigemChaves] = useState('');

  async function atualizarFila() {
    setFilaErro('');
    const r = await carregarPendentesSaldo();
    if (r.ok) setFila(r.rodadas);
    else { setFila([]); setFilaErro(r.motivo || 'Não consegui ler a fila.'); }
  }
  useEffect(() => { atualizarFila(); }, []);

  // Carrega as chaves da fila (uma rodada ou todas), sem repetir e sem as transportadoras ignoradas.
  function usarFila(rodadas) {
    const lista = ignorar.split(/[,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
    const itens = rodadas.flatMap((r) => r.itens);
    const ignoradas = itens.filter((i) => lista.some((t) => String(i.transportadora || '').toUpperCase().includes(t)));
    const usadas = removerDuplicadas(itens.filter((i) => !ignoradas.includes(i)).map((i) => i.chave));
    if (!usadas.length) { setErro('Nenhuma chave pendente para carregar.'); return; }
    setChaves(usadas);
    setOrigemChaves(`fila da escrituração (${rodadas.length} rodada${rodadas.length > 1 ? 's' : ''})`);
    setErro('');
    setFeedback(`${fmt(usadas.length)} chave(s) com erro de saldo carregada(s) da escrituração${ignoradas.length ? `; ${fmt(ignoradas.length)} ignorada(s) pela transportadora` : ''}. Agora baixe os dados para o Excel (passo 1).`);
  }

  async function descartar(rodada) {
    if (!window.confirm(`Tirar da fila os ${fmt(rodada.itens.length)} CT-e desta rodada? Faça isso depois que a correção de saldo deles rodou.`)) return;
    const r = await descartarPendentesSaldo(rodada.chave, usuarioLogado());
    if (!r.ok) { setErro(r.motivo || 'Não consegui tirar da fila.'); return; }
    atualizarFila();
  }

  const iniSap = isoParaSap(dataInicial);
  const fimSap = isoParaSap(dataFinal);

  function salvarParams() {
    try { window.localStorage.setItem(CHAVE_PARAMS, JSON.stringify({ dataInicial, dataFinal, ignorar })); } catch { /* so na sessao */ }
  }

  function validarDatas() {
    if (!dataSapValida(iniSap)) { setErro('Informe a data inicial do período.'); return false; }
    if (fimSap && !dataSapValida(fimSap)) { setErro('Data final inválida.'); return false; }
    if (fimSap && dataFinal < dataInicial) { setErro('A data final não pode ser anterior à inicial.'); return false; }
    setErro('');
    return true;
  }

  function usarColadas() {
    const { chaves: lista, invalidas } = extrairChavesDeTexto(colado);
    if (!lista.length) { setErro('Nenhuma chave de 44 dígitos encontrada no texto colado.'); return; }
    const unicas = removerDuplicadas(lista);
    setChaves(unicas);
    setErro('');
    setFeedback(`${fmt(unicas.length)} chave(s): o robô corrige só essas (se estiverem com erro de saldo no período)${invalidas.length ? `; ${fmt(invalidas.length)} item(ns) ignorado(s) por não terem 44 dígitos` : ''}.`);
  }

  async function baixarDados() {
    if (!validarDatas()) return;
    try {
      salvarParams();
      const lista = ignorar.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
      await baixarMatrizXlsx(NOME_DADOS_SALDO, matrizDadosSaldo({ chaves, dataInicial: iniSap, dataFinal: fimSap, ignorar: lista, central: getSupabaseAcessoPublico(), usuario: usuarioLogado() }));
      setFeedback(`Dados baixados (${NOME_DADOS_SALDO})${chaves.length ? ` com ${fmt(chaves.length)} chave(s)` : ''}. Na planilha do robô, com o SAP logado, clique em Corrigir saldo e escolha esse arquivo.`);
    } catch (e) { setErro(e.message); }
  }

  function verMacro() {
    const m = gerarMacroSaldo();
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
          passos={passosMacroExcel(macroTela.macro, PLANILHA_ROBO.nome, <>A cada rodada: baixe <b>Dados para o Excel</b> na Central, abra a planilha do robô com o SAP logado, clique no botão (ou <b>Alt+F8</b> → <code>{macroTela.macro}</code> → Executar) e escolha o arquivo de dados. Log e resultado ficam em <code>{PASTA_SALDO}</code>.</>)}
        />
      ) : null}
      {erro ? <div style={{ padding: 12, borderRadius: 8, background: '#fee2e2', color: '#991b1b' }}>{erro}</div> : null}
      {feedback && !erro ? <div style={{ padding: 12, borderRadius: 8, background: '#dcfce7', color: '#166534' }}>{feedback}</div> : null}

      <div className="panel-card" style={{ borderLeft: '4px solid #c2410c' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="panel-title" style={{ margin: 0 }}>Pendentes da escrituração (erro de saldo)</div>
          <button type="button" className="btn-secondary" onClick={atualizarFila}>Atualizar</button>
        </div>
        <p style={{ margin: '4px 0 10px', fontSize: 13 }}>Cada vez que o robô de <b>Escrituração</b> roda, os CT-e que continuam sem MIRO por <b>erro de saldo</b> vêm para cá. Carregue as chaves, siga no passo 1 e, depois que a correção rodar, tire a rodada da fila.</p>
        {filaErro ? <div style={{ padding: 8, borderRadius: 8, background: '#fee2e2', color: '#991b1b', fontSize: 13 }}>{filaErro}</div> : null}
        {fila === null ? <div style={{ fontSize: 13, color: '#64748b' }}>Carregando…</div> : null}
        {fila && !fila.length && !filaErro ? <div style={{ fontSize: 13, color: '#64748b' }}>Nenhum pendente. Os erros de saldo aparecem aqui depois que o robô de Escrituração rodar.</div> : null}
        {fila && fila.length ? (
          <table className="sim-analise-tabela" style={{ width: '100%' }}>
            <thead><tr><th>Rodada da escrituração</th><th>CT-es</th><th>Transportadoras</th><th>Por</th><th /></tr></thead>
            <tbody>
              {fila.map((r) => (
                <tr key={r.chave}>
                  <td><strong>{dataHoraBr(r.gerado_em)}</strong></td>
                  <td>{fmt(r.itens.length)}</td>
                  <td style={{ fontSize: 12 }}>{[...new Set(r.itens.map((i) => i.transportadora).filter(Boolean))].slice(0, 4).join(', ')}{new Set(r.itens.map((i) => i.transportadora).filter(Boolean)).size > 4 ? '…' : ''}</td>
                  <td style={{ fontSize: 12 }}>{r.gerado_por || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn-primary" style={{ padding: '2px 10px' }} onClick={() => usarFila([r])}>Carregar chaves</button>{' '}
                    <button type="button" className="btn-secondary" style={{ padding: '2px 10px' }} onClick={() => descartar(r)} title="Tirar da fila (depois de corrigir)">Tirar da fila</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {fila && fila.length > 1 ? <div style={{ marginTop: 8 }}><button type="button" className="btn-secondary" onClick={() => usarFila(fila)}>Carregar todas ({fmt(new Set(fila.flatMap((r) => r.itens.map((i) => i.chave))).size)})</button></div> : null}
      </div>

      <div className="panel-card">
        <div className="panel-title">Período do log</div>
        <p>Mesmas datas da tabela “Data inicial / Data final” da planilha Ajuste de saldo. Data final vazia = sem limite superior.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field"><label>Data inicial</label><input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} /></div>
          <div className="field"><label>Data final</label><input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} /></div>
          <div className="field" style={{ minWidth: 220 }}><label>Ignorar transportadoras (contém)</label><input value={ignorar} onChange={(e) => setIgnorar(e.target.value)} placeholder="EBAZAR" /></div>
        </div>
      </div>

      <div className="panel-card">
        <div style={passoStyle}>
          <span style={numStyle}>1</span>
          <div style={{ flex: 1 }}>
            <div className="panel-title" style={{ margin: 0 }}>Baixar os dados para a planilha do robô</div>
            <p style={{ margin: '4px 0 10px' }}>
              Na planilha do robô, <b>▶ Corrigir saldo</b> faz o que a planilha “Ajuste de saldo” fazia: exporta da <b>{TRANSACAO_SAP}</b> os CT-e com mensagem de <b>saldo</b>, lê o preço líquido dos pedidos na <b>ME2L</b> (layout DEFAULT),
              calcula o <b>valor líquido correto = valor do CT-e × preço líquido ÷ valor bruto do pedido</b>, mostra quantos achou e, com o seu OK, troca o valor líquido no pedido, salva e reprocessa cada CT-e.
              No fim, grava na base de partidas da Central cada CT-e que ficou escriturado (com o documento da MIRO).
            </p>
            {chaves.length ? (
              <div style={{ marginBottom: 10, padding: 8, borderRadius: 8, background: '#fff7ed', color: '#9a3412', fontSize: 13 }}>
                Vão no arquivo <b>{fmt(chaves.length)}</b> chave(s){origemChaves ? ` (${origemChaves})` : ''}: o robô corrige só elas. <button type="button" className="btn-secondary" onClick={() => { setChaves([]); setColado(''); setOrigemChaves(''); }} style={{ marginLeft: 8 }}>Limpar</button>
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn-primary" onClick={baixarDados}>Baixar dados para o Excel (.xlsx)</button>
              <BaixarPlanilhaRobo gerar={gerarMacroSaldo} />
            </div>
            <details style={{ marginTop: 8, fontSize: 13 }}>
              <summary style={{ cursor: 'pointer', color: '#64748b' }}>Outras opções</summary>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <button type="button" className="btn-secondary" onClick={verMacro} title="Para montar ou atualizar a planilha do robo">Código da macro (Excel)</button>
              </div>
            </details>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div style={passoStyle}>
          <span style={numStyle}>2</span>
          <div style={{ flex: 1 }}>
            <div className="panel-title" style={{ margin: 0 }}>Opcional: corrigir só chaves específicas</div>
            <p style={{ margin: '4px 0 10px' }}>Cole as chaves antes de baixar os dados: o robô exporta o relatório normalmente, mas só corrige essas.</p>
            <textarea value={colado} onChange={(e) => setColado(e.target.value)} rows={3} placeholder="Chaves de 44 dígitos (uma por linha)" style={{ width: '100%', boxSizing: 'border-box' }} />
            <div style={{ marginTop: 6 }}><button type="button" className="btn-secondary" onClick={usarColadas} disabled={!colado.trim()}>Usar chaves coladas</button></div>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-title">Como rodar</div>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
          <li>Preencha o período e clique em <b>Baixar dados para o Excel</b>.</li>
          <li>Com o SAP logado, abra a planilha do robô, clique em <b>▶ Corrigir saldo</b> (ou <b>Alt+F8</b> → <code>{MACRO_SALDO}</code>) e escolha o arquivo baixado. Ela mostra quantos CT-e achou e pergunta antes de mexer nos pedidos.</li>
          <li>Não mexa no SAP até a mensagem final. Log, resultado (<code>resultado_correcao_saldo.csv</code>) e partidas gravadas ficam em <code>{PASTA_SALDO}</code>.</li>
          <li style={{ color: '#64748b' }}>É a mesma planilha do Lançamento NFS-e/CT-e e da Escrituração (um botão para cada).</li>
        </ol>
      </div>
    </div>
  );
}
