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

  const podeImportar = useMemo(() => Boolean(competencia && arquivo && !processando), [competencia, arquivo, processando]);

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

  async function importar() {
    if (!competencia || !arquivo) {
      setErro('Selecione a competência e o arquivo de CT-e.');
      return;
    }

    setProcessando(true);
    setErro('');
    setResultado(null);
    setPendencias([]);
    setProgresso({ etapa: 'leitura', mensagem: 'Lendo arquivo...', percentual: 5 });
    setFeedback('Lendo arquivo e validando colunas...');

    try {
      const statusAtual = await verificarCompetenciaRealizadoMensal(competencia);
      setStatusCompetencia(statusAtual);
      let substituir = false;

      if (Number(statusAtual?.detalhado || 0) > 0) {
        substituir = window.confirm(
          `A competência ${competencia} já tem ${formatInt(statusAtual.detalhado)} CT-e(s) na base enxuta. Deseja substituir essa competência?`
        );
        if (!substituir) {
          setFeedback('Importação cancelada para evitar duplicidade de competência.');
          return;
        }
      }

      const { registros, meta: metaArquivo } = await parseRealizadoCtesFile(arquivo);
      setMeta(metaArquivo);
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
          if (event.etapa === 'temporaria') {
            const total = Number(event.total || registros.length || 1);
            const enviados = Number(event.enviados || 0);
            const pct = total ? 20 + Math.round((enviados / total) * 45) : 25;
            setProgresso({ etapa: 'temporaria', mensagem: `${formatInt(enviados)} de ${formatInt(total)} CT-e(s) enviados para a temporária...`, percentual: Math.min(65, pct) });
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
        `Importação mensal concluída: ${formatInt(resposta.statusFinal?.detalhado)} CT-e(s) na base enxuta, ${formatInt(resposta.statusFinal?.consolidado)} rota(s) consolidadas e ${formatInt(resposta.statusFinal?.pendencias)} pendência(s) de IBGE.`
      );
    } catch (error) {
      setErro(error.message || 'Erro ao importar realizado mensal.');
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div className="page-shell realizado-page">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">AMD Log • Realizado CT-e</div>
          <h1>Importar Realizado CT-e</h1>
          <p>
            Importe o arquivo completo de CT-e por competência, gere uma base oficial enxuta com IBGE e consolide por rota/mês. A temporária é limpa automaticamente após o processamento.
          </p>
        </div>
        <div className="actions-right wrap">
          <button className="btn-secondary" onClick={consultarCompetencia} disabled={processando || !competencia}>
            Consultar competência
          </button>
          <button className="btn-secondary" onClick={carregarPendencias} disabled={processando || !competencia}>
            Ver pendências IBGE
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
        <StatusCard title="Competência" label="Competência" value={competencia || '—'} subtitle="Importação mensal" />
        <StatusCard label="Base enxuta" value={formatInt(statusCompetencia?.detalhado)} subtitle="CT-e(s) oficiais" />
        <StatusCard label="Consolidado" value={formatInt(statusCompetencia?.consolidado)} subtitle="rotas/mês" />
        <StatusCard label="Pendências IBGE" value={formatInt(statusCompetencia?.pendencias)} subtitle="fora da base enxuta" />
      </div>

      <div className="feature-grid two">
        <section className="panel-card">
          <div>
            <div className="panel-title">1. Selecionar competência e arquivo</div>
            <p>O arquivo completo fica apenas na temporária. Depois de gerar as bases oficiais, a temporária é limpa automaticamente.</p>
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Competência</label>
              <input type="month" value={competencia} onChange={(event) => setCompetencia(event.target.value)} disabled={processando} />
            </div>
            <div className="field">
              <label>Arquivo CT-e completo</label>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => setArquivo(event.target.files?.[0] || null)} disabled={processando} />
            </div>
          </div>
          <button className="btn-primary full" onClick={importar} disabled={!podeImportar}>
            {processando ? 'Processando realizado...' : 'Importar e gerar base enxuta'}
          </button>
          {arquivo ? <div className="import-meta-box">Arquivo selecionado: <strong>{arquivo.name}</strong></div> : null}
          {meta ? (
            <div className="import-meta-box">
              Leitura: aba {meta.aba || '—'} • {formatInt(meta.registrosValidos)} CT-e(s) válido(s) • {formatInt(meta.linhasOriginais)} linha(s)
            </div>
          ) : null}
        </section>

        <section className="panel-card">
          <div>
            <div className="panel-title">2. Resultado esperado</div>
            <p>O processamento gera duas bases oficiais e uma lista de pendências para corrigir cidade/UF sem IBGE.</p>
          </div>
          <div className="sim-analise-resumo top-space">
            <div><span>Base temporária</span><strong>limpa ao final</strong></div>
            <div><span>Base enxuta</span><strong>1 linha por CT-e</strong></div>
            <div><span>Chave rota</span><strong>IBGE origem-destino</strong></div>
            <div><span>Consolidado</span><strong>mês + transportadora + rota</strong></div>
          </div>
        </section>
      </div>

      <section className="table-card">
        <div className="sim-parametros-header">
          <div>
            <div className="panel-title">Validação do arquivo</div>
            <p>Antes de gravar na base oficial, o sistema valida campos mínimos e envia tudo para a temporária.</p>
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
