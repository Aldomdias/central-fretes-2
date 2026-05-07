import { useMemo, useState } from 'react';
import {
  buscarCargaPorDistOuCte,
  carregarFluxoCargasLotacao,
  carregarLancamentosAuditoria,
  carregarSolicitacoesPagamento,
  criarLancamentoAuditoria,
  criarSolicitacaoPagamento,
  cteJaLancado,
  ctesLancadosCarga,
  formatarDataCurta,
  formatarMoeda,
  lancamentosDaCarga,
  salvarLancamentosAuditoria,
  salvarSolicitacoesPagamento,
  separarCtes,
  saldoDisponivelCarga,
  solicitacoesDaCarga,
  totalAdicionalAutorizadoCarga,
  totalAutorizadoCarga,
  totalLancadoCarga,
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

function ResumoCarga({ carga, lancamentos, solicitacoes }) {
  if (!carga) return null;
  const totalLancado = totalLancadoCarga(lancamentos, carga);
  const autorizadoBase = Number(carga.valorComparacao) || 0;
  const adicionalAutorizado = totalAdicionalAutorizadoCarga(solicitacoes, carga);
  const totalAutorizado = totalAutorizadoCarga(solicitacoes, carga);
  const saldo = totalAutorizado - totalLancado;
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
          <span>Valor auditável base</span>
          <strong>{formatarMoeda(autorizadoBase)}</strong>
          <small>Sem pedágio e com ajuste de ICMS</small>
        </div>
        <div className="summary-card">
          <span>Adicional autorizado</span>
          <strong>{formatarMoeda(adicionalAutorizado)}</strong>
          <small>Aprovado pela operação</small>
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
          <span>Pedágio separado</span>
          <strong>{formatarMoeda(carga.pedagio)}</strong>
        </div>
        <div>
          <span>Tipo de veículo</span>
          <strong>{carga.tipoVeiculo}</strong>
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

function FormLancamento({ carga, lancamentos, solicitacoes, onRegistrar }) {
  const ctes = carga?.ctes?.length ? carga.ctes : separarCtes(carga?.cteRaw || '');
  const [form, setForm] = useState({ cte: ctes[0] || '', cteOutro: '', valorLancado: '', fatura: '', observacao: '' });

  if (!carga) return null;

  const totalLancado = totalLancadoCarga(lancamentos, carga);
  const saldo = saldoDisponivelCarga(lancamentos, solicitacoes, carga);
  const valorDigitado = Number(String(form.valorLancado || '').replace(',', '.')) || 0;
  const excedentePrevisto = Math.max(0, valorDigitado - Math.max(0, saldo));
  const cteEfetivo = form.cte === 'OUTRO' ? form.cteOutro : form.cte;
  const duplicado = cteJaLancado(lancamentos, carga, cteEfetivo);
  const ctesLancados = ctesLancadosCarga(lancamentos, carga);

  const registrar = () => {
    if (!valorDigitado || valorDigitado <= 0 || duplicado) return;
    onRegistrar({ ...form, cte: cteEfetivo });
    setForm({ cte: ctes.find((cte) => !cteJaLancado(lancamentos, carga, cte)) || 'OUTRO', cteOutro: '', valorLancado: '', fatura: '', observacao: '' });
  };

  const atualizar = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Registrar lançamento auditado</div>
          <p>Informe o CT-e, o valor lançado e a fatura. CT-e já utilizado na DIST fica bloqueado para evitar duplicidade.</p>
        </div>
      </div>

      <div className="form-grid three">
        <label className="field">
          CT-e auditado
          {ctes.length ? (
            <select value={form.cte} onChange={(event) => atualizar('cte', event.target.value)}>
              {ctes.map((cte) => {
                const usado = cteJaLancado(lancamentos, carga, cte);
                return <option key={cte} value={cte} disabled={usado}>{cte}{usado ? ' · já lançado' : ''}</option>;
              })}
              <option value="DIST">Lançamento pela DIST</option>
              <option value="OUTRO">Outro CT-e</option>
            </select>
          ) : (
            <input value={form.cte} onChange={(event) => atualizar('cte', event.target.value)} placeholder="CT-e ou DIST" />
          )}
        </label>
        {form.cte === 'OUTRO' && (
          <label className="field">
            Informar outro CT-e
            <input value={form.cteOutro} onChange={(event) => atualizar('cteOutro', event.target.value)} placeholder="Número do CT-e" />
          </label>
        )}
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
        <div>
          <span>Total já lançado</span>
          <strong>{formatarMoeda(totalLancado)}</strong>
        </div>
      </div>

      {ctesLancados.length > 0 && (
        <div className="hint-box compact">
          CT-e(s) já lançados nesta DIST: <strong>{ctesLancados.join(', ')}</strong>.
        </div>
      )}

      {duplicado && (
        <div className="hint-box compact error-text">
          Este CT-e já foi lançado nesta DIST. Não é permitido registrar o mesmo CT-e duas vezes.
        </div>
      )}

      {excedentePrevisto > 0 && !duplicado && (
        <div className="hint-box compact error-text">
          Este lançamento passa do saldo da DIST. Ao registrar, o sistema cria uma solicitação pendente na tela Lotação Operação para aprovação.
        </div>
      )}

      <div className="actions-right">
        <button type="button" className="btn-primary" disabled={!valorDigitado || valorDigitado <= 0 || duplicado || (form.cte === 'OUTRO' && !form.cteOutro.trim())} onClick={registrar}>
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
              <th>Saldo anterior</th>
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
                <td>{formatarMoeda(item.saldoAnterior ?? item.totalAnterior)}</td>
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

function MovimentosAutorizacao({ carga, solicitacoes }) {
  if (!carga) return null;
  const lista = solicitacoesDaCarga(solicitacoes, carga);
  if (!lista.length) return null;

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Autorizações e custos da operação</div>
          <p className="compact">Aprovações ficam na tela Lotação Operação e, quando aprovadas, aumentam o saldo disponível para auditoria.</p>
        </div>
      </div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Data</th>
              <th>Tipo</th>
              <th>Status</th>
              <th>Valor</th>
              <th>CT-e</th>
              <th>Observação</th>
              <th>Resposta</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((item) => (
              <tr key={item.id}>
                <td>{formatarDataCurta(item.criadoEm)}</td>
                <td>{item.tipo === 'CUSTO_ADICIONAL' ? item.tipoCusto || 'Custo adicional' : 'Excedente auditoria'}</td>
                <td><span className="status-pill">{item.status}</span></td>
                <td>{formatarMoeda(item.valorAdicional || item.excedente)}</td>
                <td>{item.cte || '-'}</td>
                <td>{item.observacao || '-'}</td>
                <td>{item.resposta || '-'}</td>
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
    setSolicitacoes(carregarSolicitacoesPagamento());
    setLancamentos(carregarLancamentosAuditoria());
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
    try {
      const solicitacoesAtuais = carregarSolicitacoesPagamento();
      const lancamentosAtuais = carregarLancamentosAuditoria();
      const lancamento = criarLancamentoAuditoria(selecionada, form, lancamentosAtuais, solicitacoesAtuais);
      const novosLancamentos = [lancamento, ...lancamentosAtuais];
      salvarLancamentosAuditoria(novosLancamentos);
      setLancamentos(novosLancamentos);

      if (lancamento.excedente > 0) {
        const solicitacao = criarSolicitacaoPagamento(selecionada, lancamento);
        const novasSolicitacoes = [solicitacao, ...solicitacoesAtuais];
        salvarSolicitacoesPagamento(novasSolicitacoes);
        setSolicitacoes(novasSolicitacoes);
        setMensagem('Lançamento registrado e solicitação criada para aprovação em Lotação Operação.');
      } else {
        setSolicitacoes(solicitacoesAtuais);
        setMensagem('Lançamento auditado registrado com sucesso.');
      }
    } catch (error) {
      setMensagem(error.message || String(error));
    }
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

      <ResumoCarga carga={selecionada} lancamentos={lancamentos} solicitacoes={solicitacoes} />
      <FormLancamento key={selecionada?.id || 'sem-carga'} carga={selecionada} lancamentos={lancamentos} solicitacoes={solicitacoes} onRegistrar={registrarLancamento} />
      <HistoricoLancamentos carga={selecionada} lancamentos={lancamentos} />
      <MovimentosAutorizacao carga={selecionada} solicitacoes={solicitacoes} />
    </div>
  );
}
