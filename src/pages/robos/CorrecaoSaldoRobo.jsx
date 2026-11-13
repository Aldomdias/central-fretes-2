import { useMemo, useState } from 'react';
import { TRANSACAO_SAP, dataSapValida, extrairChavesDeTexto, isoParaSap, removerDuplicadas } from '../../utils/robos/reprocessarCte';
import { MACRO_SALDO, NOME_DADOS_SALDO, PASTA_SALDO, gerarMacroSaldo, matrizDadosSaldo } from '../../utils/robos/correcaoSaldoMacro';
import { PLANILHA_ROBO } from '../../utils/robos/sapMacroExcel';
import { baixarMatrizXlsx } from '../../utils/robos/lancamentoComum';
import { getSupabaseAcessoPublico } from '../../lib/supabaseClient';
import { carregarSessao } from '../../utils/authLocal';

// Nome de quem baixou os dados: vai para o "Lancado por" do acompanhamento.
function usuarioLogado() {
  const sessao = carregarSessao();
  return sessao?.nome || sessao?.email || '';
}
import { BaixarPlanilhaRobo, passosMacroExcel } from './MacroExcel';
import ScriptParaCopiar from './ScriptParaCopiar';

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
                Vão no arquivo <b>{fmt(chaves.length)}</b> chave(s): o robô corrige só elas. <button type="button" className="btn-secondary" onClick={() => { setChaves([]); setColado(''); }} style={{ marginLeft: 8 }}>Limpar</button>
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
