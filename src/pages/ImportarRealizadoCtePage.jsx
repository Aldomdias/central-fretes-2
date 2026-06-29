import { useMemo, useState } from 'react';
import { parseRealizadoCtesFile, formatDateBr } from '../utils/realizadoCtes';
import {
  importarRealizadoMensalEnxuto,
  listarPendenciasIbgeRealizadoMensal,
  verificarCompetenciaRealizadoMensal,
} from '../services/realizadoMensalService';

function monthNow() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatInt(value) {
  return Number(value || 0).toLocaleString('pt-BR');
}

// Descobre a competência dominante (YYYY-MM) a partir das datas de emissão do
// arquivo. Usado para alertar quando o mês selecionado não bate com o conteúdo
// (causa comum de CT-es "sumirem" por terem sido gravados na competência errada).
function detectarCompetenciaArquivo(registros = []) {
  const contagem = new Map();
  for (const r of registros) {
    const comp = String(r?.competencia || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(comp)) contagem.set(comp, (contagem.get(comp) || 0) + 1);
  }
  if (!contagem.size) return { dominante: '', distintas: [], total: 0 };

  const distintas = Array.from(contagem.entries()).sort((a, b) => b[1] - a[1]);
  const total = distintas.reduce((acc, [, qtd]) => acc + qtd, 0);
  return { dominante: distintas[0][0], distintas, total };
}

function StatusCard({ label, value, subtitle }) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {subtitle ? <span>{subtitle}</span> : null}
    </div>
  );
}

function ValidacaoLista({ validacao }) {
  if (!validacao) return null;

  const itens = [
    ['Registros lidos', validacao.total],
    ['Com valor calculado', validacao.comValorCalculado],
    ['Sem valor calculado', validacao.semValorCalculado],
    ['Sem chave CT-e', validacao.semChave],
    ['Sem transportadora', validacao.semTransportadora],
    ['Sem origem', validacao.semOrigem],
    ['Sem UF origem', validacao.semUfOrigem],
    ['Sem destino', validacao.semDestino],
    ['Sem UF destino', validacao.semUfDestino],
    ['Sem peso', validacao.semPeso],
    ['Sem Valor CT-e', validacao.semValorCte],
    ['Sem Valor NF', validacao.semValorNf],
    ['Sem canal', validacao.semCanal],
  ];

  return (
    <div className="sim-table-wrap">
      <table className="sim-table">
        <thead>
          <tr>
            <th>Validação</th>
            <th>Qtd.</th>
          </tr>
        </thead>
        <tbody>
          {itens.map(([label, value]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{formatInt(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ImportarRealizadoCtePage() {
  const [competencia, setCompetencia] = useState(monthNow());
  const [arquivo, setArquivo] = useState(null);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');
  const [meta, setMeta] = useState(null);
  const [validacao, setValidacao] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [statusCompetencia, setStatusCompetencia] = useState(null);
  const [pendencias, setPendencias] = useState([]);
  const [progresso, setProgresso] = useState(null);
  const [modoSubstituir, setModoSubstituir] = useState(false);

  const podeImportar = useMemo(() => Boolean(competencia && arquivo && !processando), [competencia, arquivo, processando]);
  const possuiBaseNaCompetencia = Number(statusCompetencia?.detalhado || 0) > 0;

  async function consultarCompetencia() {
    if (!competencia) {
      setErro('Selecione uma competência/mês.');
      return null;
    }

    setErro('');
    setFeedback(`Consultando competência ${competencia}...`);

    try {
      const status = await verificarCompetenciaRealizadoMensal(competencia);
      setStatusCompetencia(status);
      setFeedback(
        `Competência ${competencia}: ${formatInt(status.detalhado)} CT-e(s) na base enxuta, ${formatInt(status.consolidado)} rota(s) consolidadas e ${formatInt(status.pendencias)} pendência(s) de IBGE.`
      );
      return status;
    } catch (error) {
      setErro(error.message || 'Erro ao consultar competência.');
      return null;
    }
  }

  async function carregarPendencias() {
    if (!competencia) return;

    setErro('');

    try {
      const data = await listarPendenciasIbgeRealizadoMensal(competencia, 100);
      setPendencias(data);
      setFeedback(`${formatInt(data.length)} pendência(s) de IBGE carregada(s) para conferência.`);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar pendências.');
    }
  }

  async function importar({ forcarSubstituir = false } = {}) {
    if (!competencia || !arquivo) {
      setErro('Selecione a competência e o arquivo de CT-e.');
      return;
    }

    setProcessando(true);
    setErro('');
    setResultado(null);
    setPendencias([]);
    setValidacao(null);
    setMeta(null);
    setProgresso({ etapa: 'leitura', mensagem: 'Lendo arquivo...', percentual: 5 });
    setFeedback('Lendo arquivo e validando colunas...');

    try {
      let substituir = Boolean(forcarSubstituir || modoSubstituir);
      let statusAtual = null;
      try {
        statusAtual = await verificarCompetenciaRealizadoMensal(competencia);
        setStatusCompetencia(statusAtual);
      } catch (statusError) {
        if (!substituir) throw statusError;
        setFeedback('Consulta da competência demorou demais. Seguindo com reimportação/substituição em lotes.');
      }

      const jaTemBase = Number(statusAtual?.detalhado || 0) > 0 || (substituir && !statusAtual);

      if (jaTemBase && !substituir) {
        setErro(
          `A competência ${competencia} já possui ${formatInt(statusAtual.detalhado)} CT-e(s). Para subir novamente, marque "Substituir competência existente" ou clique em "Reimportar e substituir competência".`
        );
        setFeedback('Importação bloqueada para evitar duplicidade.');
        return;
      }

      if (jaTemBase && substituir) {
        const confirmou = window.confirm(
          `A competência ${competencia} já tem ${formatInt(statusAtual.detalhado)} CT-e(s). Deseja apagar e subir novamente esta competência?`
        );

        if (!confirmou) {
          setFeedback('Reimportação cancelada. Nenhum dado foi alterado.');
          return;
        }
      }

      const { registros, meta: metaArquivo } = await parseRealizadoCtesFile(arquivo);
      setMeta(metaArquivo);

      // Guarda contra importar na competência errada: compara o mês selecionado
      // com a competência dominante das datas de emissão do próprio arquivo.
      const deteccao = detectarCompetenciaArquivo(registros);
      if (deteccao.dominante && deteccao.dominante !== competencia) {
        const pctDominante = deteccao.total > 0
          ? Math.round((deteccao.distintas[0][1] / deteccao.total) * 100)
          : 0;
        const confirmouCompetencia = window.confirm(
          `Atenção: você selecionou a competência ${competencia}, mas as datas de emissão do arquivo `
          + `indicam ${deteccao.dominante} (${pctDominante}% dos CT-es).\n\n`
          + `Se continuar, os CT-es serão gravados como ${competencia} e não aparecerão ao filtrar por ${deteccao.dominante}.\n\n`
          + `Clique em Cancelar para ajustar a competência para ${deteccao.dominante} antes de subir, `
          + `ou em OK para importar mesmo assim como ${competencia}.`
        );
        if (!confirmouCompetencia) {
          setFeedback(`Importação cancelada. Ajuste a competência para ${deteccao.dominante} (detectada no arquivo) e suba novamente.`);
          return;
        }
      }

      setProgresso({ etapa: 'validacao', mensagem: `${formatInt(registros.length)} CT-e(s) lidos. Validando campos...`, percentual: 15 });

      const resposta = await importarRealizadoMensalEnxuto({
        competencia,
        arquivoOrigem: arquivo.name,
        registros,
        substituir,
        onProgress: (event) => {
          if (event.etapa === 'validacao') {
            setValidacao(event.validacao);
            setProgresso({ etapa: 'validacao', mensagem: event.mensagem, percentual: 20 });
          }

          if (event.etapa === 'status') {
            setProgresso({ etapa: 'status', mensagem: event.mensagem, percentual: 18 });
          }

          if (event.etapa === 'reset') {
            setProgresso({ etapa: 'reset', mensagem: event.mensagem, percentual: 22 });
          }

          if (event.etapa === 'temporaria') {
            const total = Number(event.total || registros.length || 1);
            const enviados = Number(event.enviados || 0);
            const pct = total ? 20 + Math.round((enviados / total) * 45) : 25;
            setProgresso({
              etapa: 'temporaria',
              mensagem: `${formatInt(enviados)} de ${formatInt(total)} CT-e(s) enviados para a temporária...`,
              percentual: Math.min(65, pct),
            });
          }

          if (event.etapa === 'processamento') {
            setProgresso({ etapa: 'processamento', mensagem: event.mensagem, percentual: 75 });
          }

          if (event.etapa === 'concluido') {
            setProgresso({ etapa: 'concluido', mensagem: event.mensagem, percentual: 100 });
          }
        },
      });

      setResultado(resposta);
      setStatusCompetencia(resposta.statusFinal);

      if (Number(resposta.statusFinal?.pendencias || 0) > 0) {
        const lista = await listarPendenciasIbgeRealizadoMensal(competencia, 100);
        setPendencias(lista);
      }

      setFeedback(
        `${substituir ? 'Reimportação' : 'Importação'} concluída: ${formatInt(resposta.statusFinal?.detalhado)} CT-e(s) na base enxuta, ${formatInt(resposta.statusFinal?.consolidado)} rota(s) consolidadas e ${formatInt(resposta.statusFinal?.pendencias)} pendência(s) de IBGE.`
      );
    } catch (error) {
      setErro(error.message || 'Erro ao importar realizado mensal.');
    } finally {
      setProcessando(false);
    }
  }

  function limparSelecao() {
    setArquivo(null);
    setMeta(null);
    setValidacao(null);
    setResultado(null);
    setPendencias([]);
    setProgresso(null);
    setErro('');
    setFeedback('Seleção limpa. Escolha novamente o arquivo para subir.');

    const input = document.getElementById('realizado-cte-file-input');
    if (input) input.value = '';
  }

  return (
    <div className="page-shell realizado-page">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">AMD Log • Realizado CT-e</div>
          <h1>Importar Realizado CT-e</h1>
          <p>
            Importe ou reimporte o arquivo completo de CT-e por competência. A subida agora preserva valor calculado, diferença, status e campos de conciliação quando existirem no arquivo.
          </p>
        </div>
        <div className="actions-right wrap">
          <button className="btn-secondary" type="button" onClick={consultarCompetencia} disabled={processando || !competencia}>
            Consultar competência
          </button>
          <button className="btn-secondary" type="button" onClick={carregarPendencias} disabled={processando || !competencia}>
            Ver pendências IBGE
          </button>
          <button className="btn-secondary" type="button" onClick={limparSelecao} disabled={processando}>
            Limpar seleção
          </button>
        </div>
      </div>

      {erro ? <div className="sim-alert">{erro}</div> : null}
      {feedback ? <div className="sim-alert info">{feedback}</div> : null}

      {progresso ? (
        <div className="sim-alert info">
          <div className="sim-parametros-header">
            <div>
              <strong>Processamento: {progresso.etapa}</strong>
              <p>{progresso.mensagem}</p>
            </div>
            <span>{Number(progresso.percentual || 0).toLocaleString('pt-BR')}%</span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden', marginTop: 10 }}>
            <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, Number(progresso.percentual || 0)))}%`, borderRadius: 999, background: '#9153F0', transition: 'width 180ms ease' }} />
          </div>
        </div>
      ) : null}

      <div className="summary-strip">
        <StatusCard label="Competência" value={competencia || '—'} subtitle="Importação mensal" />
        <StatusCard label="Base enxuta" value={formatInt(statusCompetencia?.detalhado)} subtitle="CT-e(s) oficiais" />
        <StatusCard label="Consolidado" value={formatInt(statusCompetencia?.consolidado)} subtitle="rotas/mês" />
        <StatusCard label="Pendências IBGE" value={formatInt(statusCompetencia?.pendencias)} subtitle="fora da base enxuta" />
      </div>

      <div className="feature-grid two">
        <section className="panel-card">
          <div>
            <div className="panel-title">1. Selecionar competência e arquivo</div>
            <p>
              Use importação normal para mês novo. Para subir novamente um mês já existente, marque substituição ou use o botão de reimportação.
            </p>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>Competência</label>
              <input type="month" value={competencia} onChange={(event) => setCompetencia(event.target.value)} disabled={processando} />
            </div>
            <div className="field">
              <label>Arquivo CT-e completo</label>
              <input
                id="realizado-cte-file-input"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(event) => setArquivo(event.target.files?.[0] || null)}
                disabled={processando}
              />
            </div>
          </div>

          <label
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: 12,
              borderRadius: 12,
              background: modoSubstituir ? '#fff7ed' : '#f8fafc',
              border: `1px solid ${modoSubstituir ? '#fdba74' : '#e2e8f0'}`,
              margin: '12px 0',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={modoSubstituir}
              onChange={(event) => setModoSubstituir(event.target.checked)}
              disabled={processando}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>Substituir competência existente</strong>
              <br />
              <small>
                Use para subir novamente janeiro/fevereiro etc. O sistema apaga a competência atual e grava o novo arquivo, evitando duplicidade.
              </small>
            </span>
          </label>

          <div className="actions-right wrap" style={{ justifyContent: 'stretch' }}>
            <button className="btn-primary full" type="button" onClick={() => importar({ forcarSubstituir: false })} disabled={!podeImportar || modoSubstituir}>
              {processando ? 'Processando realizado...' : 'Importar mês novo'}
            </button>
            <button className="btn-primary full" type="button" onClick={() => importar({ forcarSubstituir: true })} disabled={!podeImportar}>
              {processando ? 'Reimportando...' : 'Reimportar e substituir competência'}
            </button>
          </div>

          {possuiBaseNaCompetencia ? (
            <div className="sim-alert info" style={{ marginTop: 12 }}>
              A competência {competencia} já possui <strong>{formatInt(statusCompetencia?.detalhado)}</strong> CT-e(s). Para subir novamente, use <strong>Reimportar e substituir competência</strong>.
            </div>
          ) : null}

          {arquivo ? <div className="import-meta-box">Arquivo selecionado: <strong>{arquivo.name}</strong></div> : null}
          {meta ? (
            <div className="import-meta-box">
              Leitura: aba {meta.aba || '—'} • {formatInt(meta.registrosValidos)} CT-e(s) válido(s) • {formatInt(meta.linhasOriginais)} linha(s)
              {typeof validacao?.comValorCalculado === 'number' ? (
                <> • {formatInt(validacao.comValorCalculado)} com valor calculado</>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="panel-card">
          <div>
            <div className="panel-title">2. Resultado esperado</div>
            <p>O processamento gera base oficial com os campos necessários para auditoria e resumo mensal.</p>
          </div>
          <div className="sim-analise-resumo top-space">
            <div><span>Base temporária</span><strong>limpa ao final</strong></div>
            <div><span>Base enxuta/local</span><strong>1 linha por CT-e</strong></div>
            <div><span>Cálculo</span><strong>valor calculado + diferença</strong></div>
            <div><span>Consolidado</span><strong>mês + transportadora + rota</strong></div>
          </div>
        </section>
      </div>

      <section className="table-card">
        <div className="sim-parametros-header">
          <div>
            <div className="panel-title">Validação do arquivo</div>
            <p>Antes de gravar na base oficial, o sistema valida campos mínimos e mostra se o arquivo contém valor calculado.</p>
          </div>
        </div>
        <ValidacaoLista validacao={validacao} />
      </section>

      {resultado ? (
        <section className="table-card">
          <div className="sim-parametros-header">
            <div>
              <div className="panel-title">Resultado do processamento</div>
              <p>Competência {competencia} processada com base enxuta, consolidado e limpeza automática da temporária.</p>
            </div>
          </div>
          <div className="summary-strip">
            <StatusCard label="Temporária enviada" value={formatInt(resultado.temporaria?.enviados)} subtitle="linhas processadas" />
            <StatusCard label="Base enxuta" value={formatInt(resultado.statusFinal?.detalhado)} subtitle="CT-e(s) com IBGE" />
            <StatusCard label="Consolidado" value={formatInt(resultado.statusFinal?.consolidado)} subtitle="rotas geradas" />
            <StatusCard label="Pendências" value={formatInt(resultado.statusFinal?.pendencias)} subtitle="sem IBGE" />
          </div>
        </section>
      ) : null}

      {pendencias.length ? (
        <section className="table-card">
          <div className="sim-parametros-header">
            <div>
              <div className="panel-title">Pendências de IBGE</div>
              <p>CT-e(s) que não entraram na base enxuta porque origem ou destino não encontrou IBGE na base de municípios.</p>
            </div>
            <span className="status-pill">{formatInt(pendencias.length)} na amostra</span>
          </div>
          <div className="sim-table-wrap">
            <table className="sim-table">
              <thead>
                <tr>
                  <th>CT-e</th>
                  <th>Emissão</th>
                  <th>Transportadora</th>
                  <th>Origem</th>
                  <th>Destino</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {pendencias.map((item) => (
                  <tr key={item.id || `${item.chave_cte}-${item.motivo}`}>
                    <td>{item.numero_cte || item.chave_cte}</td>
                    <td>{formatDateBr(item.data_emissao)}</td>
                    <td>{item.transportadora}</td>
                    <td>{item.cidade_origem}/{item.uf_origem}</td>
                    <td>{item.cidade_destino}/{item.uf_destino}</td>
                    <td>{item.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
