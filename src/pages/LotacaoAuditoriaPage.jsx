import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buscarCargaPorDistOuCte,
  carregarFluxoCargasLotacao,
  carregarFluxoCargasLotacaoCompleto,
  carregarLancamentosAuditoria,
  carregarSolicitacoesPagamento,
  criarLancamentoAuditoria,
  criarSolicitacaoPagamento,
  cteJaLancado,
  ctesLancadosCarga,
  formatarDataCurta,
  formatarMoeda,
  lancamentosDaCarga,
  normalizarTexto,
  salvarLancamentosAuditoria,
  salvarSolicitacoesPagamento,
  separarCtes,
  saldoDisponivelCarga,
  solicitacoesDaCarga,
  totalAdicionalAutorizadoCarga,
  totalAutorizadoCarga,
  totalLancadoCarga,
} from '../utils/lotacaoFluxoCargas';
import {
  buscarCtesLotacaoAuditoriaSupabase,
  carregarCargasLotacaoSupabase,
  carregarLancamentosAuditoriaSupabase,
  carregarPendenciasAuditoriaSupabase,
  carregarSolicitacoesSupabase,
  carregarTabelasLotacaoSupabase,
  registrarEventoHistoricoSupabase,
  salvarLancamentoAuditoriaSupabase,
  salvarPendenciaAuditoriaSupabase,
  salvarSolicitacaoSupabase,
} from '../services/lotacaoSupabaseService';
import {
  carregarTabelasLotacao,
  pesquisarRotaLotacao,
} from '../utils/lotacaoTables';
import { carregarSessao } from '../utils/authLocal';

function classeSaldo(valor) {
  if (valor < -0.01) return 'negativo';
  if (valor > 0.01) return 'positivo';
  return '';
}

function pendenciaParaMovimentoAutorizacao(pendencia = {}) {
  return {
    id: pendencia.id,
    tipo: 'EXCEDENTE_AUDITORIA',
    origemSolicitacao: 'AUDITORIA',
    cargaId: pendencia.carga_id || '',
    dist: pendencia.dist || '',
    distKey: pendencia.dist_key || '',
    cte: pendencia.cte || '',
    fatura: pendencia.fatura || '',
    transportadora: pendencia.transportadora || '',
    valorAutorizadoCarga: pendencia.valor_original ?? pendencia.valor_autorizado,
    valorLancado: pendencia.valor_lancado,
    excedente: pendencia.valor_excedente,
    valorAdicional: pendencia.valor_adicional_aprovado ?? pendencia.valor_excedente,
    valorAdicionalAprovado: pendencia.valor_adicional_aprovado,
    valorFinalAutorizado: pendencia.valor_final_autorizado,
    status: pendencia.status || '',
    observacao: pendencia.observation || '',
    resposta: pendencia.resposta_operacao || pendencia.motivo_recusa || '',
    criadoEm: pendencia.created_at || '',
    atualizadoEm: pendencia.updated_at || '',
  };
}

function adicionarHorasIso(dataBase, horas) {
  const base = dataBase ? new Date(dataBase) : new Date();
  if (Number.isNaN(base.getTime())) return new Date().toISOString();
  return new Date(base.getTime() + (Number(horas || 0) * 3600000)).toISOString();
}

function cteParaFiltrosRota(cte = {}) {
  return {
    origem: cte.cidade_origem || '',
    destino: cte.cidade_destino || '',
    transportadora: cte.transportadora || cte.transportadora_contratada || '',
    tipo: '',
  };
}

function scoreSugestaoHistorico(carga = {}, cte = {}) {
  const origem = normalizarTexto(cte.cidade_origem || '');
  const destino = normalizarTexto(cte.cidade_destino || '');
  const transp = normalizarTexto(cte.transportadora || cte.transportadora_contratada || '');
  const cteNumero = normalizarTexto(cte.numero_cte || '');
  let score = 0;
  const motivos = [];
  if (cteNumero && normalizarTexto(carga.cteRaw || '').includes(cteNumero)) {
    score += 45;
    motivos.push('CT-e encontrado na carga');
  }
  if (origem && normalizarTexto(carga.origem).includes(origem)) {
    score += 18;
    motivos.push('mesma origem');
  }
  if (destino && normalizarTexto(carga.destino).includes(destino)) {
    score += 18;
    motivos.push('mesmo destino');
  }
  if (transp && normalizarTexto(carga.transportadora).includes(transp)) {
    score += 14;
    motivos.push('mesma transportadora');
  }
  const emissao = cte.emissao ? new Date(cte.emissao).getTime() : 0;
  const dataCarga = new Date(carga.coletaRealizada || carga.coletaPlanejada || carga.importadoEm || 0).getTime();
  if (emissao && dataCarga) {
    const dias = Math.abs(emissao - dataCarga) / 86400000;
    if (dias <= 7) {
      score += 10;
      motivos.push('data próxima');
    } else if (dias <= 30) {
      score += 4;
      motivos.push('mesmo período aproximado');
    }
  }
  const valorCte = Number(cte.valor_cte || 0);
  const valorCarga = Number(carga.valorComparacao || 0);
  if (valorCte && valorCarga) {
    const dif = Math.abs(valorCte - valorCarga) / Math.max(valorCte, valorCarga);
    if (dif <= 0.12) {
      score += 8;
      motivos.push('valor próximo');
    }
  }
  return { score, motivos };
}

function sugerirHistoricoPorCte(cargas = [], cte = {}) {
  return (cargas || [])
    .map((carga) => ({ carga, ...scoreSugestaoHistorico(carga, cte) }))
    .filter((item) => item.score >= 18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function CardCteEncontrado({ cte, onUsar }) {
  if (!cte) return null;
  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Dados encontrados no CT-e</div>
          <p>{cte.numero_cte || '-'} · {cte.transportadora || cte.transportadora_contratada || '-'} · {cte.cidade_origem || '-'} x {cte.cidade_destino || '-'}</p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => onUsar(cte)}>Usar dados do CT-e</button>
      </div>
      <div className="sim-analise-resumo">
        <div><span>Chave CT-e</span><strong style={{ fontSize: '0.78rem' }}>{cte.chave_cte || '-'}</strong></div>
        <div><span>Emissão</span><strong>{formatarDataCurta(cte.emissao)}</strong></div>
        <div><span>Canal</span><strong>{cte.canal || '-'}</strong></div>
        <div><span>Valor CT-e</span><strong>{formatarMoeda(cte.valor_cte)}</strong></div>
        <div><span>Valor NF</span><strong>{formatarMoeda(cte.valor_nf)}</strong></div>
        <div><span>Peso</span><strong>{Number(cte.peso_declarado || cte.peso_cubado || 0).toLocaleString('pt-BR')} kg</strong></div>
        <div><span>Cubagem</span><strong>{Number(cte.metros_cubicos || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} m³</strong></div>
        <div><span>Volumes</span><strong>{Number(cte.volume || 0).toLocaleString('pt-BR')}</strong></div>
      </div>
    </div>
  );
}

function ValidacaoTabelaLotacao({ resultados }) {
  if (!resultados?.length) {
    return <div className="hint-box compact">Tabela de lotação não encontrada para esta rota/transportadora.</div>;
  }
  return (
    <div className="table-card lotacao-table-card">
      <div className="panel-title" style={{ padding: '0.75rem 1rem 0.25rem' }}>Tabela de lotação aplicável</div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead><tr><th>Transportadora</th><th>Origem</th><th>Destino</th><th>Tipo</th><th>Valor tabela</th></tr></thead>
          <tbody>
            {resultados.slice(0, 5).map((item, idx) => (
              <tr key={`${item.tabelaId || item.id}-${idx}`}>
                <td><strong>{item.tabelaNome || item.transportadora || '-'}</strong></td>
                <td>{item.origem}/{item.ufOrigem || ''}</td>
                <td>{item.destino}/{item.ufDestino || ''}</td>
                <td>{item.tipo || '-'}</td>
                <td><strong>{formatarMoeda(item.valor)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SugestoesHistorico({ sugestoes, onUsar }) {
  if (!sugestoes?.length) return <div className="hint-box compact">Nenhuma DIST provável encontrada no histórico por aproximação.</div>;
  return (
    <div className="table-card lotacao-table-card">
      <div className="panel-title" style={{ padding: '0.75rem 1rem 0.25rem' }}>DIST provável encontrada</div>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead><tr><th>DIST</th><th>CT-e</th><th>Transportadora</th><th>Rota</th><th>Data</th><th>Valor</th><th>Confiança</th><th>Motivo</th><th>Ação</th></tr></thead>
          <tbody>
            {sugestoes.map(({ carga, score, motivos }) => (
              <tr key={carga.id}>
                <td><strong>{carga.dist}</strong></td>
                <td>{carga.cteRaw || '-'}</td>
                <td>{carga.transportadora}</td>
                <td>{carga.origem} x {carga.destino}</td>
                <td>{formatarDataCurta(carga.coletaRealizada || carga.coletaPlanejada)}</td>
                <td>{formatarMoeda(carga.valorComparacao)}</td>
                <td>{score >= 70 ? 'Alta' : score >= 40 ? 'Média' : 'Baixa'}</td>
                <td>{motivos.join(', ') || '-'}</td>
                <td><button type="button" className="btn-secondary" onClick={() => onUsar(carga)}>Usar esta DIST</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
        <div><span>Frete Cantu</span><strong>{formatarMoeda(carga.freteCantu)}</strong></div>
        <div><span>Frete Transportadora</span><strong>{formatarMoeda(carga.freteTransp)}</strong></div>
        <div><span>ICMS removido</span><strong>{formatarMoeda(carga.icmsRemovido)}</strong></div>
        <div><span>Pedágio separado</span><strong>{formatarMoeda(carga.pedagio)}</strong></div>
        <div><span>Tipo de veículo</span><strong>{carga.tipoVeiculo}</strong></div>
        <div><span>CT-e(s)</span><strong>{carga.cteRaw || (carga.ctes || []).join('; ') || '-'}</strong></div>
      </div>

      <div className="hint-box compact top-space-sm">
        Regra aplicada: {carga.regraCalculo}.{' '}
        {carga.icmsEstimado
          ? `Alíquota usada: ${carga.aliquotaIcmsUsada}%.`
          : 'Quando V e W estavam diferentes, o sistema usou o valor sem ICMS informado.'}
      </div>
    </div>
  );
}

// ─── FORMULÁRIO DE LANÇAMENTO ─────────────────────────────────────────────────
// FASE 1: observação obrigatória quando há excedente + dados do auditor

function FormLancamento({ carga, lancamentos, solicitacoes, onRegistrar, salvando, usuarioAtual }) {
  const ctes = carga?.ctes?.length ? carga.ctes : separarCtes(carga?.cteRaw || '');
  const [form, setForm] = useState({
    cte: ctes[0] || '',
    cteOutro: '',
    valorLancado: '',
    fatura: '',
    observacao: '',
  });

  if (!carga) return null;

  const totalLancado = totalLancadoCarga(lancamentos, carga);
  const saldo = saldoDisponivelCarga(lancamentos, solicitacoes, carga);
  const valorDigitado = Number(String(form.valorLancado || '').replace(',', '.')) || 0;
  const excedentePrevisto = Math.max(0, valorDigitado - Math.max(0, saldo));
  const cteEfetivo = form.cte === 'OUTRO' ? form.cteOutro : form.cte;
  const duplicado = cteJaLancado(lancamentos, carga, cteEfetivo);
  const ctesLancados = ctesLancadosCarga(lancamentos, carga);

  // REGRA FASE 1: observação obrigatória quando excede o saldo
  const observacaoObrigatoria = excedentePrevisto > 0;
  const observacaoVazia = !form.observacao || !form.observacao.trim();
  const bloqueadoPorObservacao = observacaoObrigatoria && observacaoVazia;

  const registrar = () => {
    if (!valorDigitado || valorDigitado <= 0 || duplicado || bloqueadoPorObservacao) return;
    onRegistrar({
      ...form,
      cte: cteEfetivo,
      // Dados do auditor — gravados junto com o lançamento
      auditedByUserId: usuarioAtual?.id || '',
      auditedByName: usuarioAtual?.nome || '',
      auditedByEmail: usuarioAtual?.email || '',
      auditedAt: new Date().toISOString(),
      auditStatus: excedentePrevisto > 0 ? 'EXCEDEU_AGUARDANDO_OPERACAO' : 'AUDITADO_OK',
      auditExceededAmount: excedentePrevisto,
      auditAllowedAmount: Math.max(0, saldo),
      auditEnteredAmount: valorDigitado,
    });
    setForm({
      cte: ctes.find((c) => !cteJaLancado(lancamentos, carga, c)) || 'OUTRO',
      cteOutro: '',
      valorLancado: '',
      fatura: '',
      observacao: '',
    });
  };

  const atualizar = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  return (
    <div className="panel-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Registrar lançamento auditado</div>
          <p>Informe o CT-e, o valor lançado e a fatura. CT-e já utilizado na DIST fica bloqueado para evitar duplicidade.</p>
        </div>
        {usuarioAtual && (
          <span className="status-pill">
            Auditor: {usuarioAtual.nome || usuarioAtual.email}
          </span>
        )}
      </div>

      <div className="form-grid three">
        <label className="field">
          CT-e auditado
          {ctes.length ? (
            <select value={form.cte} onChange={(e) => atualizar('cte', e.target.value)}>
              {ctes.map((cte) => {
                const usado = cteJaLancado(lancamentos, carga, cte);
                return (
                  <option key={cte} value={cte} disabled={usado}>
                    {cte}{usado ? ' · já lançado' : ''}
                  </option>
                );
              })}
              <option value="DIST">Lançamento pela DIST</option>
              <option value="OUTRO">Outro CT-e</option>
            </select>
          ) : (
            <input value={form.cte} onChange={(e) => atualizar('cte', e.target.value)} placeholder="CT-e ou DIST" />
          )}
        </label>

        {form.cte === 'OUTRO' && (
          <label className="field">
            Informar outro CT-e
            <input
              value={form.cteOutro}
              onChange={(e) => atualizar('cteOutro', e.target.value)}
              placeholder="Número do CT-e"
            />
          </label>
        )}

        <label className="field">
          Valor lançado
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.valorLancado}
            onChange={(e) => atualizar('valorLancado', e.target.value)}
            placeholder="Ex.: 5000"
          />
        </label>

        <label className="field">
          Fatura
          <input
            value={form.fatura}
            onChange={(e) => atualizar('fatura', e.target.value)}
            placeholder="Número da fatura"
          />
        </label>
      </div>

      {/* OBSERVAÇÃO — obrigatória quando há excedente */}
      <label className="field" style={{ marginTop: '0.75rem' }}>
        Observação{observacaoObrigatoria ? <span style={{ color: '#c0392b', marginLeft: 4 }}>*</span> : ''}
        <textarea
          value={form.observacao}
          onChange={(e) => atualizar('observacao', e.target.value)}
          placeholder={
            observacaoObrigatoria
              ? 'Justificativa obrigatória — informe o motivo do excedente para a operação.'
              : 'Observação da auditoria ou justificativa'
          }
          style={{
            borderColor: observacaoObrigatoria && observacaoVazia ? '#c0392b' : undefined,
            minHeight: observacaoObrigatoria ? 80 : 60,
          }}
        />
      </label>

      {/* ALERTA FASE 1: observação obrigatória */}
      {observacaoObrigatoria && observacaoVazia && (
        <div className="hint-box compact error-text" style={{ marginTop: '0.5rem' }}>
          ⚠ Informe uma justificativa para enviar à operação. O campo Observação é obrigatório quando o valor lançado ultrapassa o saldo disponível.
        </div>
      )}

      <div className="sim-analise-resumo">
        <div><span>Saldo antes do lançamento</span><strong>{formatarMoeda(saldo)}</strong></div>
        <div><span>Valor digitado</span><strong>{formatarMoeda(valorDigitado)}</strong></div>
        <div>
          <span>Excedente previsto</span>
          <strong className={excedentePrevisto > 0 ? 'negativo' : ''}>{formatarMoeda(excedentePrevisto)}</strong>
        </div>
        <div><span>Total já lançado</span><strong>{formatarMoeda(totalLancado)}</strong></div>
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
          Este lançamento passa do saldo da DIST. Ao registrar, o sistema cria uma pendência para aprovação na tela Lotação Operação.
        </div>
      )}

      <div className="actions-right">
        <button
          type="button"
          className="btn-primary"
          disabled={
            salvando ||
            !valorDigitado ||
            valorDigitado <= 0 ||
            duplicado ||
            (form.cte === 'OUTRO' && !form.cteOutro.trim()) ||
            bloqueadoPorObservacao
          }
          title={bloqueadoPorObservacao ? 'Preencha a justificativa antes de registrar' : ''}
          onClick={registrar}
        >
          {salvando
            ? 'Salvando...'
            : excedentePrevisto > 0
            ? 'Registrar e abrir pendência'
            : 'Registrar auditado'}
        </button>
      </div>
    </div>
  );
}

function HistoricoLancamentos({ carga, lancamentos }) {
  if (!carga) return null;
  const lista = lancamentosDaCarga(lancamentos, carga);
  if (!lista.length) {
    return <div className="hint-box compact">Nenhum lançamento auditado para esta DIST.</div>;
  }

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
              <th>Data/Hora</th>
              <th>Auditor</th>
              <th>CT-e</th>
              <th>Fatura</th>
              <th>Valor lançado</th>
              <th>Saldo anterior</th>
              <th>Excedente</th>
              <th>Status</th>
              <th>Observação / Justificativa</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((item) => (
              <tr key={item.id}>
                <td>{formatarDataCurta(item.auditedAt || item.criadoEm)}</td>
                <td>
                  <span title={item.auditedByEmail || item.audited_by_email || ''}>
                    {item.auditedByName || item.audited_by_name || '-'}
                  </span>
                </td>
                <td>{item.cte || '-'}</td>
                <td>{item.fatura || '-'}</td>
                <td>{formatarMoeda(item.valorLancado)}</td>
                <td>{formatarMoeda(item.saldoAnterior ?? item.totalAnterior)}</td>
                <td className={item.excedente > 0 ? 'negativo' : ''}>{formatarMoeda(item.excedente)}</td>
                <td>
                  <span className={`status-pill ${item.excedente > 0 ? 'error' : ''}`}>
                    {item.auditStatus || item.audit_status || item.status}
                  </span>
                </td>
                <td>{item.observacao || item.audit_observation || '-'}</td>
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
          <p className="compact">
            Aprovações ficam na tela Lotação Operação e, quando aprovadas, aumentam o saldo disponível para auditoria.
          </p>
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

// ─── Painel de acompanhamento geral ──────────────────────────────────────────

function PainelAuditoriaGeral({ lancamentos, solicitacoes }) {
  const pendentes = (solicitacoes || []).filter((item) => item.status === 'PENDENTE' || item.status === 'EXCEDEU_AGUARDANDO_OPERACAO');
  const recentes = [...(lancamentos || [])]
    .sort((a, b) => new Date(b.auditedAt || b.criadoEm).getTime() - new Date(a.auditedAt || a.criadoEm).getTime())
    .slice(0, 80);

  return (
    <div className="table-card lotacao-table-card">
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Acompanhamento da auditoria</div>
          <p className="compact">Visão geral do que foi lançado e do que está aguardando aprovação da operação.</p>
        </div>
        <span className="status-pill dark">{pendentes.length} em aprovação</span>
      </div>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card">
          <span>Lançamentos registrados</span>
          <strong>{(lancamentos || []).length.toLocaleString('pt-BR')}</strong>
          <small>CT-e/fatura auditados</small>
        </div>
        <div className="summary-card">
          <span>Em aprovação</span>
          <strong>{pendentes.length.toLocaleString('pt-BR')}</strong>
          <small>excedentes pendentes</small>
        </div>
        <div className="summary-card">
          <span>Aprovados</span>
          <strong>{(solicitacoes || []).filter((item) => item.status === 'APROVADO' || item.status === 'APROVADO_OPERACAO').length.toLocaleString('pt-BR')}</strong>
          <small>liberam saldo adicional</small>
        </div>
        <div className="summary-card">
          <span>Recusados</span>
          <strong>{(solicitacoes || []).filter((item) => item.status === 'RECUSADO' || item.status === 'RECUSADO_OPERACAO').length.toLocaleString('pt-BR')}</strong>
          <small>sem liberação de saldo</small>
        </div>
      </div>

      {pendentes.length > 0 && (
        <div className="hint-box compact top-space-sm">
          Há {pendentes.length.toLocaleString('pt-BR')} solicitação(ões) aguardando a operação validar em Lotação Operação.
        </div>
      )}

      <div className="sim-analise-tabela-wrap top-space-sm">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Data</th>
              <th>Auditor</th>
              <th>DIST</th>
              <th>CT-e</th>
              <th>Fatura</th>
              <th>Valor lançado</th>
              <th>Excedente</th>
              <th>Status</th>
              <th>Justificativa</th>
            </tr>
          </thead>
          <tbody>
            {recentes.map((item) => (
              <tr key={item.id}>
                <td>{formatarDataCurta(item.auditedAt || item.criadoEm)}</td>
                <td>
                  <span title={item.auditedByEmail || ''}>
                    {item.auditedByName || '-'}
                  </span>
                </td>
                <td><strong>{item.dist}</strong></td>
                <td>{item.cte || '-'}</td>
                <td>{item.fatura || '-'}</td>
                <td>{formatarMoeda(item.valorLancado)}</td>
                <td className={item.excedente > 0 ? 'negativo' : ''}>{formatarMoeda(item.excedente)}</td>
                <td>
                  <span className={`status-pill ${item.excedente > 0 ? 'error' : ''}`}>
                    {item.auditStatus || item.status}
                  </span>
                </td>
                <td>{item.observacao || '-'}</td>
              </tr>
            ))}
            {!recentes.length && <tr><td colSpan="9">Nenhum lançamento registrado até agora.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function LotacaoAuditoriaPage() {
  const mounted = useRef(true);

  // Carrega usuário da sessão para rastrear quem auditou
  const [usuarioAtual] = useState(() => carregarSessao());

  const [baseFluxo, setBaseFluxo] = useState(() => carregarFluxoCargasLotacao());
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [fonteCargas, setFonteCargas] = useState('local');

  const [busca, setBusca] = useState('');
  const [selecionada, setSelecionada] = useState(null);
  const [ctesEncontrados, setCtesEncontrados] = useState([]);
  const [cteSelecionado, setCteSelecionado] = useState(null);
  const [tabelasLotacao, setTabelasLotacao] = useState([]);

  const [lancamentos, setLancamentos] = useState(() => carregarLancamentosAuditoria());
  const [solicitacoes, setSolicitacoes] = useState(() => carregarSolicitacoesPagamento());
  const [carregandoAuditoria, setCarregandoAuditoria] = useState(false);

  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState('');

  // ── Carrega cargas (Supabase > local) ──────────────────────────────────────
  useEffect(() => {
    mounted.current = true;
    setCarregandoHistorico(true);

    (async () => {
      try {
        const cargasSupabase = await carregarCargasLotacaoSupabase({});
        if (mounted.current && cargasSupabase.length > 0) {
          setBaseFluxo({ cargas: cargasSupabase, armazenamento: 'supabase' });
          setFonteCargas('supabase');
          return;
        }
      } catch (err) {
        console.warn('[Auditoria] Supabase indisponível para cargas, usando local:', err.message);
      }

      try {
        const base = await carregarFluxoCargasLotacaoCompleto();
        if (mounted.current) {
          setBaseFluxo(base);
          setFonteCargas('local');
        }
      } catch (err) {
        console.error('[Auditoria] Erro ao carregar histórico local:', err);
      }
    })().finally(() => {
      if (mounted.current) setCarregandoHistorico(false);
    });

    return () => { mounted.current = false; };
  }, []);

  // ── Carrega lançamentos e solicitações (Supabase > local) ──────────────────
  useEffect(() => {
    setCarregandoAuditoria(true);

    (async () => {
      try {
        const [lancs, sols, pends] = await Promise.all([
          carregarLancamentosAuditoriaSupabase(),
          carregarSolicitacoesSupabase(),
          carregarPendenciasAuditoriaSupabase({}).catch(() => null),
        ]);
        if (lancs !== null) {
          setLancamentos(lancs);
          salvarLancamentosAuditoria(lancs);
        }
        if (sols !== null) {
          const movimentosPendencias = Array.isArray(pends) ? pends.map(pendenciaParaMovimentoAutorizacao) : [];
          const solicitacoesComPendencias = [...movimentosPendencias, ...sols];
          setSolicitacoes(solicitacoesComPendencias);
          salvarSolicitacoesPagamento(solicitacoesComPendencias);
        }
      } catch (err) {
        console.warn('[Auditoria] Usando localStorage para lançamentos/solicitações:', err.message);
      } finally {
        setCarregandoAuditoria(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const resp = await carregarTabelasLotacaoSupabase();
        setTabelasLotacao(resp?.tabelas || []);
      } catch (error) {
        setTabelasLotacao(carregarTabelasLotacao());
      }
    })();
  }, []);

  const resultados = useMemo(
    () => buscarCargaPorDistOuCte(baseFluxo.cargas, busca),
    [baseFluxo.cargas, busca],
  );

  const tabelaAplicavel = useMemo(() => {
    if (!cteSelecionado && !selecionada) return [];
    const filtros = cteSelecionado ? cteParaFiltrosRota(cteSelecionado) : {
      origem: selecionada?.origem || '',
      destino: selecionada?.destino || '',
      transportadora: selecionada?.transportadora || '',
      tipo: selecionada?.tipoVeiculo || '',
    };
    return pesquisarRotaLotacao(tabelasLotacao, filtros).slice(0, 10);
  }, [tabelasLotacao, cteSelecionado, selecionada]);

  const sugestoesHistorico = useMemo(
    () => cteSelecionado ? sugerirHistoricoPorCte(baseFluxo.cargas, cteSelecionado) : [],
    [baseFluxo.cargas, cteSelecionado],
  );

  const pesquisar = useCallback(async () => {
    setMensagem('');
    let ctes = [];
    try {
      ctes = await buscarCtesLotacaoAuditoriaSupabase(busca);
      setCtesEncontrados(ctes);
      setCteSelecionado(ctes[0] || null);
    } catch (error) {
      setCtesEncontrados([]);
      setCteSelecionado(null);
      console.warn('[Auditoria] Falha ao buscar CT-e no realizado:', error.message);
    }
    if (!resultados.length && !ctes.length) {
      setSelecionada(null);
      setMensagem('Nenhuma DIST, CT-e ou chave CT-e encontrada no histórico/base CT-e.');
      return;
    }
    setSelecionada(resultados[0] || null);
  }, [busca, resultados]);

  // ── Registra lançamento com dados do auditor ──────────────────────────────
  const registrarLancamento = useCallback(async (form) => {
    if (!selecionada) return;
    setSalvando(true);
    setMensagem('');

    try {
      const lancamento = criarLancamentoAuditoria(selecionada, form, lancamentos, solicitacoes);

      // FASE 1: enriquecer com dados do auditor
      const lancamentoComAuditor = {
        ...lancamento,
        auditedByUserId: form.auditedByUserId || usuarioAtual?.id || '',
        auditedByName: form.auditedByName || usuarioAtual?.nome || '',
        auditedByEmail: form.auditedByEmail || usuarioAtual?.email || '',
        auditedAt: form.auditedAt || new Date().toISOString(),
        auditStatus: form.auditStatus || (lancamento.excedente > 0 ? 'EXCEDEU_AGUARDANDO_OPERACAO' : 'AUDITADO_OK'),
        auditExceededAmount: form.auditExceededAmount ?? lancamento.excedente,
        auditAllowedAmount: form.auditAllowedAmount ?? 0,
        auditEnteredAmount: form.auditEnteredAmount ?? lancamento.valorLancado,
        observacao: form.observacao || '',
        origemTela: 'AUDITORIA_LOTACAO',
      };

      const novosLancamentos = [lancamentoComAuditor, ...lancamentos];
      salvarLancamentosAuditoria(novosLancamentos);
      setLancamentos(novosLancamentos);

      try {
        await salvarLancamentoAuditoriaSupabase(lancamentoComAuditor);
      } catch (error) {
        console.warn('[Auditoria] Lançamento salvo localmente; falha ao salvar no Supabase:', error.message);
      }

      if (lancamentoComAuditor.excedente > 0) {
        const solicitacao = criarSolicitacaoPagamento(selecionada, lancamentoComAuditor);
        const pendenciaId = globalThis.crypto?.randomUUID?.();
        const solicitacaoComAuditor = {
          ...solicitacao,
          auditedByName: lancamentoComAuditor.auditedByName,
          auditedByEmail: lancamentoComAuditor.auditedByEmail,
          auditedAt: lancamentoComAuditor.auditedAt,
          observation: lancamentoComAuditor.observacao,
          status: 'EXCEDEU_AGUARDANDO_OPERACAO',
        };
        const novasSolicitacoes = [solicitacaoComAuditor, ...solicitacoes];
        salvarSolicitacoesPagamento(novasSolicitacoes);
        setSolicitacoes(novasSolicitacoes);

        try {
          await salvarSolicitacaoSupabase(solicitacaoComAuditor);
        } catch (error) {
          console.warn('[Auditoria] Solicitação salva localmente; falha ao salvar no Supabase:', error.message);
        }

        try {
          await salvarPendenciaAuditoriaSupabase({
            id: pendenciaId,
            lancamentoId: lancamentoComAuditor.id,
            dist: selecionada.dist,
            distKey: selecionada.distKey,
            cte: lancamentoComAuditor.cte,
            fatura: lancamentoComAuditor.fatura,
            transportadora: selecionada.transportadora,
            cargaId: selecionada.id,
            valorLancado: lancamentoComAuditor.valorLancado,
            valorAutorizado: lancamentoComAuditor.saldoAnterior,
            valorExcedente: lancamentoComAuditor.excedente,
            valorOriginal: Number(selecionada.valorComparacao) || 0,
            valorAdicionalAprovado: 0,
            valorFinalAutorizado: Number(selecionada.valorComparacao) || 0,
            prazoOperacaoEm: adicionarHorasIso(lancamentoComAuditor.auditedAt, 24),
            status: 'EXCEDEU_AGUARDANDO_OPERACAO',
            auditedByUserId: lancamentoComAuditor.auditedByUserId,
            auditedByName: lancamentoComAuditor.auditedByName,
            auditedByEmail: lancamentoComAuditor.auditedByEmail,
            auditedAt: lancamentoComAuditor.auditedAt,
            observation: lancamentoComAuditor.observacao,
          });
          if (pendenciaId) {
            await registrarEventoHistoricoSupabase({
              pendenciaId,
              lancamentoId: lancamentoComAuditor.id,
              userId: lancamentoComAuditor.auditedByUserId,
              userName: lancamentoComAuditor.auditedByName,
              userEmail: lancamentoComAuditor.auditedByEmail,
              acao: 'ENVIADO_OPERACAO',
              statusAnterior: 'AUDITORIA',
              statusNovo: 'EXCEDEU_AGUARDANDO_OPERACAO',
              comentario: lancamentoComAuditor.observacao,
              origemTela: 'AUDITORIA_LOTACAO',
            });
          }
        } catch (error) {
          console.warn('[Auditoria] Solicitação antiga salva; falha ao criar pendência no painel novo:', error.message);
        }

        setMensagem('✓ Lançamento registrado e pendência criada para aprovação em Lotação Operação.');
      } else {
        setMensagem('✓ Lançamento auditado registrado com sucesso.');
      }
    } catch (error) {
      setMensagem(`Erro ao registrar: ${error.message || String(error)}`);
    } finally {
      setSalvando(false);
    }
  }, [selecionada, lancamentos, solicitacoes, usuarioAtual]);

  const totalCargas = baseFluxo.cargas?.length || 0;

  return (
    <div className="page-shell lotacao-page lotacao-auditoria-page">
      <header className="page-top between">
        <div className="page-header">
          <span className="amd-mini-brand">Lotação · Auditoria</span>
          <h1>Auditoria de CT-e por DIST</h1>
          <p>
            Digite a DIST ou o CT-e para localizar a carga, validar o frete auditável e controlar o
            saldo lançado quando houver mais de um CT-e vinculado.
          </p>
        </div>
        {usuarioAtual && (
          <div style={{ textAlign: 'right', fontSize: '0.85rem', opacity: 0.75 }}>
            <div><strong>{usuarioAtual.nome}</strong></div>
            <div>{usuarioAtual.email}</div>
          </div>
        )}
      </header>

      {(carregandoHistorico || carregandoAuditoria) && (
        <div className="hint-box compact">
          {carregandoHistorico && 'Carregando histórico de cargas do Supabase...'}
          {!carregandoHistorico && carregandoAuditoria && 'Carregando lançamentos e solicitações...'}
        </div>
      )}

      {!carregandoHistorico && !carregandoAuditoria && (
        <div
          className="hint-box compact"
          style={{ background: fonteCargas === 'supabase' ? '#e8f5e9' : '#fff8e1' }}
        >
          {fonteCargas === 'supabase'
            ? `✓ ${totalCargas} cargas carregadas do Supabase.`
            : `⚠ ${totalCargas} cargas carregadas localmente.`}
        </div>
      )}

      <div className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Pesquisar carga</div>
            <p>Use DIST, CT-e, chave CT-e, NF ou chave NF para cruzar histórico, base CT-e e tabelas.</p>
          </div>
          <span className="status-pill dark">{totalCargas} cargas no histórico</span>
        </div>

        <div className="form-grid three">
          <label className="field full-span">
            DIST / CT-e / Chave CT-e / NF
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') pesquisar(); }}
              placeholder="Ex.: DIST-9372, 19379 ou chave CT-e"
            />
          </label>
        </div>
        <div className="actions-right">
          <button type="button" className="btn-primary" onClick={pesquisar}>
            Pesquisar
          </button>
        </div>
        {mensagem && <div className="hint-box compact">{mensagem}</div>}
        <ListaResultados
          resultados={resultados}
          selecionada={selecionada}
          onSelecionar={(carga) => {
            setSelecionada(carga);
            setCteSelecionado(null);
          }}
        />
        {ctesEncontrados.length > 1 && (
          <div className="mini-list top-space-sm">
            {ctesEncontrados.map((cte) => (
              <button
                key={cte.id || cte.chave_cte || cte.numero_cte}
                type="button"
                className={cteSelecionado?.id === cte.id ? 'mini-list-row clickable active' : 'mini-list-row clickable'}
                onClick={() => setCteSelecionado(cte)}
              >
                <span><strong>{cte.numero_cte || '-'}</strong> · {cte.transportadora || '-'} · {cte.cidade_origem || '-'} x {cte.cidade_destino || '-'}</span>
                <strong>{formatarMoeda(cte.valor_cte)}</strong>
              </button>
            ))}
          </div>
        )}
      </div>

      <CardCteEncontrado cte={cteSelecionado} onUsar={setCteSelecionado} />
      {(cteSelecionado || selecionada) && <ValidacaoTabelaLotacao resultados={tabelaAplicavel} />}
      {cteSelecionado && <SugestoesHistorico sugestoes={sugestoesHistorico} onUsar={setSelecionada} />}
      <ResumoCarga carga={selecionada} lancamentos={lancamentos} solicitacoes={solicitacoes} />
      <FormLancamento
        key={selecionada?.id || 'sem-carga'}
        carga={selecionada}
        lancamentos={lancamentos}
        solicitacoes={solicitacoes}
        onRegistrar={registrarLancamento}
        salvando={salvando}
        usuarioAtual={usuarioAtual}
      />
      <HistoricoLancamentos carga={selecionada} lancamentos={lancamentos} />
      <MovimentosAutorizacao carga={selecionada} solicitacoes={solicitacoes} />
    </div>
  );
}
