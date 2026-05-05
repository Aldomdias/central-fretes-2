import { useMemo, useState } from 'react';
import {
  buscarCargaPorDistOuCte,
  carregarFluxoCargasLotacao,
  carregarLancamentosAuditoria,
  carregarSolicitacoesPagamento,
  criarLancamentoAuditoria,
  criarSolicitacaoPagamento,
  formatarDataCurta,
  formatarMoeda,
  lancamentosDaCarga,
  salvarLancamentosAuditoria,
  salvarSolicitacoesPagamento,
  separarCtes,
  textoSolicitacaoPagamento,
  totalLancadoCarga,
  atualizarStatusSolicitacao,
} from '../utils/lotacaoFluxoCargas';

function classeSaldo(valor) {
  if (valor < -0.01) return 'negativo';
  if (valor > 0.01) return 'positivo';
  return '';
}

function ListaResultados({ resultados, selecionada, onSelecionar }) {
  if (!resultados.length) return null;
  return (
    <div className="mini-list top-space-sm">
      {resultados.map((item) => (
        <button
          key={item.id}
          type="button"
          className={selecionada?.id === item.id ? 'mini-list-row clickable active' : 'mini-list-row clickable'}
          onClick={() => onSelecionar(item)}
        >
          <span>
            <strong>{item.dist}</strong> · {item.transportadora} · {item.origem} x {item.destino}
          </span>
          <strong>{formatarMoeda(item.valorComparacao)}</strong>
        </button>
      ))}
    </div>
  );
}

function ResumoCarga({ carga, lancamentos }) {
  if (!carga) return null;
  const totalLancado = totalLancadoCarga(lancamentos, carga);
  const saldo = (Number(carga.valorComparacao) || 0) - totalLancado;
  const ctes = carga.ctes?.length ? carga.ctes : separarCtes(carga.cteRaw);

  return (
    <div className="panel-card lotacao-auditoria-carga-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Carga encontrada</div>
          <p>{carga.dist} · {carga.transportadora} · {carga.origem} x {carga.destino}</p>
        </div>
        <span className="status-pill dark">{ctes.length > 1 ? `${ctes.length} CT-es` : '1 CT-e'}</span>
      </div>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card">
          <span>Valor auditável</span>
          <strong>{formatarMoeda(carga.valorComparacao)}</strong>
          <small>Sem pedágio e com ajuste de ICMS</small>
        </div>
        <div className="summary-card">
          <span>Total já lançado</span>
          <strong>{formatarMoeda(totalLancado)}</strong>
          <small>{lancamentosDaCarga(lancamentos, carga).length} lançamento(s)</small>
        </div>
        <div className="summary-card">
          <span>Saldo disponível</span>
          <strong className={classeSaldo(saldo)}>{formatarMoeda(saldo)}</strong>
          <small>Base para próximos CT-es</small>
        </div>
        <div className="summary-card">
          <span>Pedágio separado</span>
          <strong>{formatarMoeda(carga.pedagio)}</strong>
          <small>Não entra na comparação</small>
        </div>
      </div>

      <div className="sim-analise-resumo top-space-sm">
        <div>
          <span>Frete Cantu</span>
          <strong>{formatarMoeda(carga.freteCantu)}</strong>
        </div>
        <div>
          <span>Frete Transportadora</span>
          <strong>{formatarMoeda(carga.freteTransp)}</strong>
        </div>
        <div>
          <span>ICMS removido</span>
          <strong>{formatarMoeda(carga.icmsRemovido)}</strong>
        </div>
        <div>
          <span>Tipo de veículo</span>
          <strong>{carga.tipoVeiculo}</strong>
        </div>
        <div>
          <span>Data coleta</span>
          <strong>{formatarDataCurta(carga.coletaRealizada || carga.coletaPlanejada)}</strong>
        </div>
        <div>
          <span>CT-e(s)</span>
          <strong>{carga.cteRaw || '-'}</strong>
        </div>
      </div>

      <div className="hint-box compact top-space-sm">
        Regra aplicada: {carga.regraCalculo}. {carga.icmsEstimado ? `Alíquota usada: ${carga.aliquotaIcmsUsada}%.` : 'Quando V e W estavam diferentes, o sistema usou o valor sem ICMS informado.'}
      </div>
    </div>
  );
}

function FormLancamento({ carga, lancamentos, onRegistrar }) {
  const ctes = carga?.ctes?.length ? carga.ctes : separarCtes(carga?.cteRaw || '');
  const [form, setForm] = useState({ cte: ctes[0] || '', valorLancado: '', fatura: '', observacao: '' });

  if (!carga) return null;

  const totalLancado = totalLancadoCarga(lancamentos, carga);
  const saldo = (Number(carga.valorComparacao) || 0) - totalLancado;
  const valorDigitado = Number(String(form.valorLancado || '').replace(',', '.')) || 0;
  const excedentePrevisto = Math.max(0, valorDigitado - Math.max(0, saldo));

  const registrar = () => {
    if (!valorDigitado || valorDigitado <= 0) return;
    onRegistrar(form);
    setForm({ cte: ctes[0] || '', valorLancado: '', fatura: '', observacao: '' });
  };

  const atualizar = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Registrar lançamento auditado</div>
          <p>Informe o CT-e ou a DIST, o valor lançado e a fatura. Se passar do saldo, será aberta uma solicitação de autorização.</p>
        </div>
      </div>

      <div className="form-grid three">
        <label className="field">
          CT-e auditado
          {ctes.length ? (
            <select value={form.cte} onChange={(event) => atualizar('cte', event.target.value)}>
              {ctes.map((cte) => <option key={cte} value={cte}>{cte}</option>)}
              <option value="DIST">Lançamento pela DIST</option>
              <option value="OUTRO">Outro CT-e</option>
            </select>
          ) : (
            <input value={form.cte} onChange={(event) => atualizar('cte', event.target.value)} placeholder="CT-e ou DIST" />
          )}
        </label>
        <label className="field">
          Valor lançado
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.valorLancado}
            onChange={(event) => atualizar('valorLancado', event.target.value)}
            placeholder="Ex.: 5000"
          />
        </label>
        <label className="field">
          Fatura
          <input value={form.fatura} onChange={(event) => atualizar('fatura', event.target.value)} placeholder="Número da fatura" />
        </label>
      </div>

      <label className="field">
        Observação
        <textarea value={form.observacao} onChange={(event) => atualizar('observacao', event.target.value)} placeholder="Observação da auditoria ou justificativa" />
      </label>

      <div className="sim-analise-resumo">
        <div>
          <span>Saldo antes do lançamento</span>
          <strong>{formatarMoeda(saldo)}</strong>
        </div>
        <div>
          <span>Valor digitado</span>
          <strong>{formatarMoeda(valorDigitado)}</strong>
        </div>
        <div>
          <span>Excedente previsto</span>
          <strong className={excedentePrevisto > 0 ? 'negativo' : ''}>{formatarMoeda(excedentePrevisto)}</strong>
        </div>
      </div>

      {excedentePrevisto > 0 && (
        <div className="hint-box compact error-text">
          Este lançamento passa do saldo da DIST. Ao registrar, o sistema cria uma solicitação pendente para a equipe de transporte aprovar ou recusar.
        </div>
      )}

      <div className="actions-right">
        <button type="button" className="btn-primary" disabled={!valorDigitado || valorDigitado <= 0} onClick={registrar}>
          {excedentePrevisto > 0 ? 'Registrar e abrir solicitação' : 'Registrar auditado'}
        </button>
      </div>
    </div>
  );
}

function HistoricoLancamentos({ carga, lancamentos }) {
  if (!carga) return null;
  const lista = lancamentosDaCarga(lancamentos, carga);
  if (!lista.length) return <div className="hint-box compact">Nenhum lançamento auditado para esta DIST.</div>;

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Lançamentos da DIST</div>
          <p className="compact">Controle de saldo por CT-e/fatura.</p>
        </div>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Data</th>
              <th>CT-e</th>
              <th>Fatura</th>
              <th>Valor lançado</th>
              <th>Total anterior</th>
              <th>Excedente</th>
              <th>Status</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((item) => (
              <tr key={item.id}>
                <td>{formatarDataCurta(item.criadoEm)}</td>
                <td>{item.cte || '-'}</td>
                <td>{item.fatura || '-'}</td>
                <td>{formatarMoeda(item.valorLancado)}</td>
                <td>{formatarMoeda(item.totalAnterior)}</td>
                <td className={item.excedente > 0 ? 'negativo' : ''}>{formatarMoeda(item.excedente)}</td>
                <td><span className="status-pill">{item.status}</span></td>
                <td>{item.observacao || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SolicitacoesPagamento({ solicitacoes, onAtualizar }) {
  const [resposta, setResposta] = useState('');
  const pendentes = solicitacoes.filter((item) => item.status === 'PENDENTE');
  const recentes = solicitacoes.slice(0, 80);

  const copiar = async (item) => {
    const texto = textoSolicitacaoPagamento(item);
    try {
      await navigator.clipboard.writeText(texto);
      window.alert('Mensagem copiada para a área de transferência.');
    } catch {
      window.prompt('Copie a mensagem abaixo:', texto);
    }
  };

  const emailHref = (item) => {
    const subject = encodeURIComponent(`Autorização de pagamento - ${item.dist}`);
    const body = encodeURIComponent(textoSolicitacaoPagamento(item));
    return `mailto:?subject=${subject}&body=${body}`;
  };

  if (!recentes.length) return null;

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Solicitações de autorização</div>
          <p className="compact">Quando o lançamento passa do saldo disponível, fica pendente para transporte aprovar ou recusar.</p>
        </div>
        <span className="status-pill dark">{pendentes.length} pendente(s)</span>
      </div>

      <label className="field small-width">
        Observação da resposta
        <input value={resposta} onChange={(event) => setResposta(event.target.value)} placeholder="Opcional" />
      </label>

      <div className="sim-analise-tabela-wrap top-space-sm">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Status</th>
              <th>DIST</th>
              <th>CT-e</th>
              <th>Transportadora</th>
              <th>Rota</th>
              <th>Valor lançado</th>
              <th>Excedente</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {recentes.map((item) => (
              <tr key={item.id}>
                <td><span className="status-pill">{item.status}</span></td>
                <td><strong>{item.dist}</strong></td>
                <td>{item.cte || '-'}</td>
                <td>{item.transportadora}</td>
                <td>{item.origem} x {item.destino}</td>
                <td>{formatarMoeda(item.valorLancado)}</td>
                <td className="negativo">{formatarMoeda(item.excedente)}</td>
                <td>
                  <div className="row-actions lotacao-auditoria-actions">
                    <button type="button" className="btn-secondary" onClick={() => copiar(item)}>Copiar</button>
                    <a className="btn-secondary link-button" href={emailHref(item)}>E-mail</a>
                    {item.status === 'PENDENTE' && (
                      <>
                        <button type="button" className="btn-primary" onClick={() => onAtualizar(item.id, 'APROVADO', resposta)}>Aprovar</button>
                        <button type="button" className="btn-danger" onClick={() => onAtualizar(item.id, 'RECUSADO', resposta)}>Recusar</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LotacaoAuditoriaPage() {
  const [baseFluxo] = useState(() => carregarFluxoCargasLotacao());
  const [busca, setBusca] = useState('');
  const [selecionada, setSelecionada] = useState(null);
  const [lancamentos, setLancamentos] = useState(() => carregarLancamentosAuditoria());
  const [solicitacoes, setSolicitacoes] = useState(() => carregarSolicitacoesPagamento());
  const [mensagem, setMensagem] = useState('');

  const resultados = useMemo(() => buscarCargaPorDistOuCte(baseFluxo.cargas, busca), [baseFluxo.cargas, busca]);

  const pesquisar = () => {
    if (!resultados.length) {
      setSelecionada(null);
      setMensagem('Nenhuma DIST ou CT-e encontrado no histórico local. Importe o fluxo de carga na tela Lotação Operação.');
      return;
    }
    setSelecionada(resultados[0]);
    setMensagem('');
  };

  const registrarLancamento = (form) => {
    if (!selecionada) return;
    const lancamento = criarLancamentoAuditoria(selecionada, form, lancamentos);
    const novosLancamentos = [lancamento, ...lancamentos];
    salvarLancamentosAuditoria(novosLancamentos);
    setLancamentos(novosLancamentos);

    if (lancamento.excedente > 0) {
      const solicitacao = criarSolicitacaoPagamento(selecionada, lancamento);
      const novasSolicitacoes = [solicitacao, ...solicitacoes];
      salvarSolicitacoesPagamento(novasSolicitacoes);
      setSolicitacoes(novasSolicitacoes);
      setMensagem('Lançamento registrado e solicitação de autorização criada para transporte.');
    } else {
      setMensagem('Lançamento auditado registrado com sucesso.');
    }
  };

  const atualizarSolicitacao = (id, status, observacao) => {
    const atualizadas = atualizarStatusSolicitacao(solicitacoes, id, status, observacao);
    salvarSolicitacoesPagamento(atualizadas);
    setSolicitacoes(atualizadas);
  };

  return (
    <div className="page-shell lotacao-page lotacao-auditoria-page">
      <header className="page-top between">
        <div className="page-header">
          <span className="amd-mini-brand">Lotação · Auditoria</span>
          <h1>Auditoria de CT-e por DIST</h1>
          <p>
            Digite a DIST ou o CT-e para localizar a carga, validar o frete auditável e controlar o saldo lançado quando houver mais de um CT-e vinculado.
          </p>
        </div>
      </header>

      <div className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Pesquisar carga</div>
            <p>Use o número da coluna B/DIST ou um dos CT-es da coluna CTE TRANSP.</p>
          </div>
          <span className="status-pill dark">{baseFluxo.cargas.length} cargas no histórico</span>
        </div>

        <div className="form-grid three">
          <label className="field full-span">
            DIST ou CT-e
            <input
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') pesquisar();
              }}
              placeholder="Ex.: DIST-9372 ou 19379"
            />
          </label>
        </div>
        <div className="actions-right">
          <button type="button" className="btn-primary" onClick={pesquisar}>Pesquisar</button>
        </div>
        {mensagem && <div className="hint-box compact">{mensagem}</div>}
        <ListaResultados resultados={resultados} selecionada={selecionada} onSelecionar={setSelecionada} />
      </div>

      <ResumoCarga carga={selecionada} lancamentos={lancamentos} />
      <FormLancamento key={selecionada?.id || 'sem-carga'} carga={selecionada} lancamentos={lancamentos} onRegistrar={registrarLancamento} />
      <HistoricoLancamentos carga={selecionada} lancamentos={lancamentos} />
      <SolicitacoesPagamento solicitacoes={solicitacoes} onAtualizar={atualizarSolicitacao} />
    </div>
  );
}
