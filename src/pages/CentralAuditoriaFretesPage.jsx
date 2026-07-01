import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { carregarSessao } from '../utils/authLocal';
import {
  agruparDetalhesVerum,
  analisarLayoutVerum,
  chaveFatura,
  detalhesDaFatura,
  parseDetalheFaturaVerum,
  parseFaturaVerum,
} from '../utils/auditoriaFretesImport';
import {
  carregarDetalhesFaturaSupabase,
  limparDetalhesFaturaSupabase,
  salvarDetalhesFaturaSupabase,
  salvarFaturaSupabase,
} from '../services/lotacaoSupabaseService';
import {
  BOLETO_STATUS,
  FATURA_STATUS,
  SOLICITACAO_FINANCEIRA_TIPOS,
  calcularDashboard,
  conciliarPagamentos,
  diasAte,
  faixaVencimento,
  montarArquivoDoccobEdi,
  montarLinhasDoccob,
  montarNomeDoccob,
  normalizarChaveCte,
  statusSla,
} from '../utils/auditoriaFretesDomain';
import {
  atualizarFaturaAuditoria,
  atenderSolicitacaoFinanceira,
  buscarReferenciaCtes,
  carregarPlataformaAuditoria,
  criarProtocoloFinanceiro,
  criarSolicitacaoFinanceira,
  reauditarFatura,
  registrarDoccob,
  restaurarDemonstracaoAuditoria,
  salvarBoletoFinanceiro,
  salvarCarteiraAuditoria,
  salvarPagamentosFinanceiros,
  vincularNovaFatura,
} from '../services/auditoriaFretesService';

const TABS = [
  ['dashboard', 'Dashboard'],
  ['faturas', 'Faturas'],
  ['gestao', 'Centro de Gestores'],
  ['financeiro', 'Central Financeira'],
];

function dinheiro(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataBr(valor) {
  if (!valor) return '-';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : valor;
}

function nomeStatus(status = '') {
  return String(status).replaceAll('_', ' ');
}

function corAlerta(fatura) {
  const faixa = faixaVencimento(fatura);
  if (faixa === 'VENCIDA') return '#9b1111';
  if (faixa === 'CRITICO') return '#cf2f2f';
  if (faixa === 'LARANJA') return '#e67e22';
  if (faixa === 'AMARELO' || faixa === 'VENCENDO_7_DIAS') return '#b78700';
  return '#04a484';
}

function Card({ label, value, detail, color = '#9153F0' }) {
  return (
    <div className="summary-card audit-kpi" style={{ borderLeft: `4px solid ${color}` }}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function Status({ value }) {
  return <span className={`status-pill audit-status audit-status-${String(value || '').toLowerCase()}`}>{nomeStatus(value || '-')}</span>;
}

function Dashboard({ state }) {
  const resumo = useMemo(() => calcularDashboard(state.faturas), [state.faturas]);
  const boletosSemArquivo = state.boletos.filter((item) => ['PENDENTE', 'SEM_BOLETO'].includes(item.status)).length;
  const solicitacoesForaSla = state.solicitacoes.filter((item) => statusSla(item) === 'FORA_SLA').length;

  return (
    <>
      <div className="audit-section-title">Faturas</div>
      <div className="summary-strip audit-summary-grid">
        <Card label="Recebidas" value={resumo.recebidas} />
        <Card label="Em auditoria" value={resumo.emAuditoria} color="#315ee7" />
        <Card label="Aguardando transportadora" value={resumo.aguardandoTransportadora} color="#e67e22" />
        <Card label="Aguardando nova fatura" value={resumo.aguardandoNovaFatura} color="#b78700" />
        <Card label="Prontas para pagamento" value={resumo.prontas} color="#04a484" />
        <Card label="Enviadas ao financeiro" value={resumo.enviadas} color="#315ee7" />
        <Card label="Pagas" value={resumo.pagas} color="#14733b" />
        <Card label="Vencidas" value={resumo.vencidas} color="#9b1111" />
        <Card label="Vencendo em 3 dias" value={resumo.vencendo3} color="#e67e22" />
        <Card label="Vencendo em 7 dias" value={resumo.vencendo7} color="#b78700" />
      </div>

      <div className="audit-section-title">Financeiro</div>
      <div className="summary-strip audit-summary-grid">
        <Card label="Valor auditado" value={dinheiro(resumo.valorAuditado)} />
        <Card label="Valor divergente" value={dinheiro(resumo.valorDivergente)} color="#9b1111" />
        <Card label="Valor recuperado" value={dinheiro(resumo.valorRecuperado)} color="#04a484" />
        <Card label="Aguardando retorno" value={dinheiro(resumo.valorAguardando)} color="#e67e22" />
        <Card label="Pronto para pagamento" value={dinheiro(resumo.valorPronto)} color="#04a484" />
        <Card label="Enviado ao financeiro" value={dinheiro(resumo.valorEnviado)} color="#315ee7" />
        <Card label="Valor pago" value={dinheiro(resumo.valorPago)} color="#14733b" />
        <Card label="Sem boleto" value={boletosSemArquivo} color="#9b1111" />
        <Card label="Solicitacoes fora SLA" value={solicitacoesForaSla} color="#9b1111" />
      </div>

      <div className="audit-section-title">Operacao da auditoria</div>
      <div className="summary-strip audit-summary-grid">
        <Card label="CT-es auditados" value={resumo.ctesAuditados} />
        <Card label="CT-es divergentes" value={resumo.ctesDivergentes} color="#9b1111" />
        <Card label="CT-es sem calculo" value={resumo.ctesSemCalculo} color="#e67e22" />
        <Card label="CT-es sem tabela" value={resumo.ctesSemTabela} color="#b78700" />
      </div>
    </>
  );
}

function FaturaDetalhe({ state, fatura, onClose, onState }) {
  const sessao = carregarSessao();
  const detalheRef = useRef(null);
  const [tab, setTab] = useState('resumo');
  const [selecionados, setSelecionados] = useState([]);
  const [carregandoDetalhes, setCarregandoDetalhes] = useState(false);
  const [erroDetalhes, setErroDetalhes] = useState('');
  const [novaFaturaId, setNovaFaturaId] = useState('');
  const [reauditando, setReauditando] = useState(false);
  const [referenciaCtes, setReferenciaCtes] = useState(new Map());
  const detalhes = state.detalhes[fatura.id] || [];
  const divergencias = detalhes.filter((item) => Number(item.diferenca || 0) !== 0 || item.status === 'DIVERGENTE');
  const semCalculo = detalhes.filter((item) => !Number(item.calculado_frete || 0));
  const tratativas = state.tratativas.filter((item) => item.fatura_id === fatura.id || item.fatura === fatura.numero_fatura);
  const historico = state.historico.filter((item) => item.fatura_id === fatura.id);
  const faturaSubstituta = fatura.substituida_por_id
    ? state.faturas.find((item) => item.id === fatura.substituida_por_id)
    : null;
  const faturaOriginal = state.faturas.find((item) => item.substituida_por_id === fatura.id);
  const candidatasSubstituta = state.faturas.filter((item) =>
    item.id !== fatura.id
    && item.transportadora === fatura.transportadora
    && !['SUBSTITUIDA', 'CANCELADA'].includes(item.status));

  useEffect(() => {
    // O detalhe substitui a lista como uma tela propria; garante que abre no topo.
    detalheRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [fatura.id]);

  useEffect(() => {
    let ativo = true;
    setCarregandoDetalhes(true);
    setErroDetalhes('');
    carregarDetalhesFaturaSupabase(fatura.id)
      .then(async (lista) => {
        if (!ativo) return;
        onState((atual) => ({ ...atual, detalhes: { ...atual.detalhes, [fatura.id]: lista || [] } }));
        // Cruza com a base auditada para exibir rota, peso, canal e valores de referencia.
        const referencia = await buscarReferenciaCtes((lista || []).map((item) => item.chave_cte));
        if (ativo) setReferenciaCtes(referencia);
      })
      .catch((error) => {
        if (ativo) setErroDetalhes(error.message || String(error));
      })
      .finally(() => {
        if (ativo) setCarregandoDetalhes(false);
      });
    return () => {
      ativo = false;
    };
  }, [fatura.id]);

  const mudarStatus = async (status) => {
    const next = await atualizarFaturaAuditoria(state, { ...fatura, status }, {
      acao: 'STATUS_ALTERADO',
      status_anterior: fatura.status,
      status_novo: status,
      descricao: `Status alterado para ${nomeStatus(status)}.`,
      usuario_nome: sessao?.nome || sessao?.email || 'Usuario local',
      usuario_email: sessao?.email || '',
    });
    onState(next);
  };

  const baixarArquivo = (blob, nomeArquivo) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = nomeArquivo;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportarDoccob = async (formato) => {
    const linhas = montarLinhasDoccob(fatura, detalhes, selecionados);
    if (!linhas.length) return;
    const nome = montarNomeDoccob(fatura);
    if (formato === 'EDI') {
      // Layout PROCEDA 3.0A (registros fixos de 170 posicoes) para importacao no Verum.
      const conteudo = montarArquivoDoccobEdi(fatura, detalhes, selecionados);
      baixarArquivo(new Blob([conteudo], { type: 'text/plain;charset=utf-8' }), `${nome}.txt`);
      const next = await registrarDoccob(state, {
        fatura_id: fatura.id,
        nome_arquivo: `${nome}.txt`,
        formato: 'EDI',
        cte_ids: selecionados,
        quantidade_ctes: linhas.length,
        valor_total: linhas.reduce((total, item) => total + Number(item.Valor || 0), 0),
        gerado_por_nome: sessao?.nome || sessao?.email || 'Usuario local',
      });
      onState(next);
      return;
    }
    const ws = XLSX.utils.json_to_sheet(linhas);
    if (formato === 'CSV') {
      const csv = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
      const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${nome}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'DOCCOB');
      XLSX.writeFile(wb, `${nome}.xlsx`);
    }
    const next = await registrarDoccob(state, {
      fatura_id: fatura.id,
      nome_arquivo: `${nome}.${formato.toLowerCase()}`,
      formato,
      cte_ids: selecionados,
      quantidade_ctes: linhas.length,
      valor_total: linhas.reduce((total, item) => total + Number(item.Valor || 0), 0),
      gerado_por_nome: sessao?.nome || sessao?.email || 'Usuario local',
    });
    onState(next);
  };

  const reauditar = async () => {
    setReauditando(true);
    setErroDetalhes('');
    try {
      const next = await reauditarFatura(state, fatura, detalhes, sessao?.nome || sessao?.email || 'Usuario local');
      onState(next);
    } catch (error) {
      setErroDetalhes(error.message || String(error));
    } finally {
      setReauditando(false);
    }
  };

  const vincularSubstituta = async () => {
    const nova = state.faturas.find((item) => item.id === novaFaturaId);
    if (!nova) return;
    try {
      const next = await vincularNovaFatura(state, fatura, nova, sessao?.nome || sessao?.email || 'Usuario local');
      onState(next);
      setNovaFaturaId('');
      setErroDetalhes('');
    } catch (error) {
      setErroDetalhes(error.message || String(error));
    }
  };

  const selecionar = (id) => setSelecionados((lista) =>
    lista.includes(id) ? lista.filter((item) => item !== id) : [...lista, id]);

  const ctesNaBase = detalhes.filter((item) => referenciaCtes.has(normalizarChaveCte(item.chave_cte))).length;

  const tabelaCtes = (lista) => (
    <div className="sim-analise-tabela-wrap">
      {detalhes.length > 0 && (
        <p className="compact">
          {ctesNaBase} de {detalhes.length} CT-e(s) encontrados na base auditada
          {ctesNaBase < detalhes.length ? ' — os demais ainda nao foram processados na Auditoria CT-e.' : '.'}
        </p>
      )}
      <table className="sim-analise-tabela">
        <thead><tr><th></th><th>CT-e</th><th>Chave</th><th>Rota (base)</th><th>Canal</th><th>Peso</th><th>Valor</th><th>Calculado</th><th>Diferenca</th><th>Motivo</th><th>Status</th></tr></thead>
        <tbody>
          {lista.map((item) => {
            const base = referenciaCtes.get(normalizarChaveCte(item.chave_cte));
            return (
              <tr key={item.id}>
                <td><input type="checkbox" checked={selecionados.includes(item.id)} onChange={() => selecionar(item.id)} /></td>
                <td>{item.numero_cte || '-'}</td>
                <td><small>{item.chave_cte || '-'}</small></td>
                <td>{base ? <small>{base.cidade_origem || '?'}/{base.uf_origem || '?'} → {base.cidade_destino || '?'}/{base.uf_destino || '?'}</small> : <small className="error-text">Fora da base</small>}</td>
                <td>{base?.canal || '-'}</td>
                <td>{base?.peso ? Number(base.peso).toLocaleString('pt-BR') : '-'}</td>
                <td>{dinheiro(item.valor_frete)}</td>
                <td>{Number(item.calculado_frete || 0) ? dinheiro(item.calculado_frete) : 'Sem calculo'}</td>
                <td className={Number(item.diferenca || 0) ? 'negativo' : ''}>{dinheiro(item.diferenca)}</td>
                <td>{nomeStatus(item.motivo_divergencia || '-')}</td>
                <td><Status value={item.status} /></td>
              </tr>
            );
          })}
          {!lista.length && <tr><td colSpan="11">Nenhum CT-e nesta visao.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="panel-card audit-detail" ref={detalheRef}>
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Fatura {fatura.numero_fatura} - {fatura.transportadora}</div>
          <p>{dataBr(fatura.data_vencimento)} | {dinheiro(fatura.valor_fatura)} | Auditor: {fatura.auditor_nome || 'SEM AUDITOR DEFINIDO'}</p>
        </div>
        <button className="btn-secondary" onClick={onClose}>Fechar</button>
      </div>

      <div className="audit-flow">
        {['Recebimento', 'Reauditoria', 'Tratativas', 'DOCCOB', 'Nova fatura', 'Liberacao', 'Financeiro', 'Pagamento'].map((item) => <span key={item}>{item}</span>)}
      </div>

      <div className="tabs-row">
        {[
          ['resumo', 'Resumo'], ['ctes', `CT-es (${detalhes.length})`], ['divergencias', `Divergencias (${divergencias.length})`],
          ['sem-calculo', `Sem calculo (${semCalculo.length})`], ['tratativas', `Tratativas (${tratativas.length})`], ['historico', 'Historico'],
        ].map(([id, label]) => <button key={id} className={`toggle-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {carregandoDetalhes && <div className="hint-box compact">Carregando CT-es da fatura...</div>}
      {erroDetalhes && <div className="hint-box compact error-text">Erro ao carregar CT-es: {erroDetalhes}</div>}
      {tab === 'resumo' && (
        <>
          <div className="summary-strip">
            <Card label="Valor fatura" value={dinheiro(fatura.valor_fatura)} />
            <Card label="Valor calculado" value={dinheiro(fatura.valor_calculado)} color="#04a484" />
            <Card label="Diferenca" value={dinheiro(fatura.diferenca)} color={Number(fatura.diferenca) ? '#9b1111' : '#04a484'} />
            <Card label="Quantidade CT-es" value={fatura.ctes_totais || detalhes.length} />
          </div>
          <div className="form-grid three">
            <label className="field">Status
              <select value={fatura.status} onChange={(event) => mudarStatus(event.target.value)}>
                {FATURA_STATUS.map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
            <label className="field">Vencimento<input value={dataBr(fatura.data_vencimento)} readOnly /></label>
            <label className="field">Boleto<input value={nomeStatus(fatura.boleto_status || 'PENDENTE')} readOnly /></label>
          </div>
          {faturaSubstituta && (
            <div className="hint-box compact">
              Fatura substituida pela nova fatura <strong>{faturaSubstituta.numero_fatura}</strong> ({dinheiro(faturaSubstituta.valor_fatura)}, vencimento {dataBr(faturaSubstituta.data_vencimento)}).
            </div>
          )}
          {faturaOriginal && (
            <div className="hint-box compact">
              Esta e a nova fatura que substitui a fatura original <strong>{faturaOriginal.numero_fatura}</strong> ({dinheiro(faturaOriginal.valor_fatura)}).
            </div>
          )}
          {!faturaSubstituta && (
            <div className="form-grid three">
              <label className="field">Nova fatura (substituta)
                <select value={novaFaturaId} onChange={(event) => setNovaFaturaId(event.target.value)}>
                  <option value="">Selecione a fatura ja importada</option>
                  {candidatasSubstituta.map((item) => (
                    <option key={item.id} value={item.id}>{item.numero_fatura} - {dinheiro(item.valor_fatura)} - venc. {dataBr(item.data_vencimento)}</option>
                  ))}
                </select>
              </label>
              <div className="audit-form-actions">
                <button className="btn-secondary" disabled={!novaFaturaId} onClick={vincularSubstituta}>Vincular nova fatura</button>
              </div>
              <p className="compact">Importe a nova fatura pela aba Faturas e vincule aqui: a original passa a SUBSTITUIDA e as duas guardam o vinculo no historico.</p>
            </div>
          )}
        </>
      )}
      {tab === 'ctes' && tabelaCtes(detalhes)}
      {tab === 'divergencias' && tabelaCtes(divergencias)}
      {tab === 'sem-calculo' && tabelaCtes(semCalculo)}
      {tab === 'tratativas' && (
        <div className="audit-timeline">
          {tratativas.map((item) => <div key={item.id}><strong>{item.protocolo || 'Tratativa'}</strong><span>{item.descricao}</span><Status value={item.status} /></div>)}
          {!tratativas.length && <div>Nenhuma tratativa vinculada.</div>}
        </div>
      )}
      {tab === 'historico' && (
        <div className="audit-timeline">
          {historico.map((item) => <div key={item.id}><strong>{nomeStatus(item.acao)}</strong><span>{item.descricao}</span><small>{item.usuario_nome || 'Sistema'} | {new Date(item.created_at).toLocaleString('pt-BR')}</small></div>)}
          {!historico.length && <div>Nenhum evento registrado.</div>}
        </div>
      )}

      <div className="audit-action-bar">
        <span>{selecionados.length} CT-e(s) selecionado(s)</span>
        <button className="btn-primary" disabled={reauditando || carregandoDetalhes || !detalhes.length} onClick={reauditar}>
          {reauditando ? 'Reauditando...' : 'Reauditar CT-es'}
        </button>
        <button className="btn-secondary" disabled={!selecionados.length} onClick={() => exportarDoccob('EDI')}>Gerar DOCCOB EDI (Verum)</button>
        <button className="btn-secondary" disabled={!selecionados.length} onClick={() => exportarDoccob('CSV')}>Gerar DOCCOB CSV</button>
        <button className="btn-secondary" disabled={!selecionados.length} onClick={() => exportarDoccob('XLSX')}>Gerar DOCCOB XLSX</button>
        <button className="btn-secondary" onClick={() => mudarStatus('AGUARDANDO_NOVA_FATURA')}>Solicitar nova fatura</button>
        <button className="btn-primary" onClick={() => mudarStatus('PRONTA_PARA_PAGAMENTO')}>Liberar para pagamento</button>
      </div>
    </div>
  );
}

function Faturas({ state, onState }) {
  const sessao = carregarSessao();
  const arquivoRef = useRef(null);
  const [filtro, setFiltro] = useState('');
  const [status, setStatus] = useState('');
  const [aberta, setAberta] = useState(null);
  const [importando, setImportando] = useState(false);
  const [mensagemImportacao, setMensagemImportacao] = useState('');
  const lista = state.faturas.filter((fatura) => {
    const texto = `${fatura.numero_fatura} ${fatura.transportadora} ${fatura.auditor_nome}`.toLowerCase();
    return (!filtro || texto.includes(filtro.toLowerCase())) && (!status || fatura.status === status);
  });
  const faturaAtual = aberta ? state.faturas.find((item) => item.id === aberta.id) : null;

  // Detalhe abre como tela propria no lugar da lista; ao fechar, a lista volta
  // com busca e filtros preservados (o componente continua montado).
  if (faturaAtual) {
    return <FaturaDetalhe state={state} fatura={faturaAtual} onClose={() => setAberta(null)} onState={onState} />;
  }

  const importarFaturas = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setImportando(true);
    setMensagemImportacao('Lendo arquivo Verum...');
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      const nomeFaturas = workbook.SheetNames.find((nome) => nome.toLowerCase().includes('fatura')) || workbook.SheetNames[0];
      const nomeDetalhes = workbook.SheetNames.find((nome) => nome.toLowerCase().includes('detalhe')) || workbook.SheetNames[1];
      if (!nomeFaturas) throw new Error('Aba de faturas nao encontrada.');
      const rowsFaturas = XLSX.utils.sheet_to_json(workbook.Sheets[nomeFaturas], { defval: '' });
      const rowsDetalhes = nomeDetalhes
        ? XLSX.utils.sheet_to_json(workbook.Sheets[nomeDetalhes], { defval: '' })
        : [];
      const analise = analisarLayoutVerum(rowsFaturas, rowsDetalhes);
      if (!analise.faturasValidas) {
        throw new Error('Nenhuma fatura valida. Verifique Transportadora e Numero Fatura.');
      }
      setMensagemImportacao(
        `Arquivo lido: ${analise.faturasValidas} fatura(s) e ${analise.detalhesReconhecidos} CT-e(s) reconhecido(s). Gravando...`,
      );

      const grupos = agruparDetalhesVerum(rowsDetalhes);

      let faturasSalvas = 0;
      let detalhesSalvos = 0;
      let processadas = 0;
      for (const row of rowsFaturas) {
        processadas += 1;
        if (processadas % 5 === 0 || processadas === rowsFaturas.length) {
          setMensagemImportacao(
            `Processando ${processadas} de ${rowsFaturas.length} fatura(s)... `
            + `${faturasSalvas} gravada(s), ${detalhesSalvos} CT-e(s) vinculado(s).`,
          );
        }
        const fatura = parseFaturaVerum(row);
        if (!fatura.numero_fatura || !fatura.transportadora) continue;
        // Reimportacao atualiza a fatura existente em vez de duplicar:
        // reaproveita o id quando numero+serie+transportadora ja existem.
        const existente = state.faturas.find((item) =>
          chaveFatura(item.numero_fatura, item.serie_fatura) === chaveFatura(fatura.numero_fatura, fatura.serie_fatura)
          && String(item.transportadora || '').trim().toUpperCase() === String(fatura.transportadora || '').trim().toUpperCase());
        const resultado = await salvarFaturaSupabase({
          ...(existente?.id ? { id: existente.id } : {}),
          ...fatura,
          importado_por: sessao?.nome || sessao?.email || '',
          importado_em: new Date().toISOString(),
        });
        if (!resultado?.ok || !resultado.id) continue;
        faturasSalvas += 1;
        const detalhes = detalhesDaFatura(grupos, fatura.numero_fatura, fatura.serie_fatura)
          .map((item) => parseDetalheFaturaVerum(item, resultado.id, fatura));
        if (detalhes.length) {
          // Reimportacao: limpa os CT-es antigos da fatura para nao duplicar.
          if (existente?.id) await limparDetalhesFaturaSupabase(existente.id);
          await salvarDetalhesFaturaSupabase(detalhes);
          detalhesSalvos += detalhes.length;
        }
      }

      const atualizado = await carregarPlataformaAuditoria();
      onState(atualizado);
      const alertaVinculo = analise.detalhesNaoVinculados > 0
        ? ` ATENCAO: ${analise.detalhesNaoVinculados} CT-e(s) da aba Detalhes nao casaram com nenhuma fatura (confira Numero/Serie Fatura nas duas abas).`
        : '';
      setMensagemImportacao(
        `Importacao concluida: ${faturasSalvas} fatura(s), ${detalhesSalvos} CT-e(s) vinculado(s), `
        + `${analise.faturasIgnoradas} fatura(s) ignorada(s).${alertaVinculo}`,
      );
    } catch (error) {
      setMensagemImportacao(`Erro na importacao: ${error.message}`);
    } finally {
      setImportando(false);
    }
  };

  return (
    <>
      <div className="panel-card">
        <div className="section-row compact-top">
          <div><div className="panel-title">Carteira operacional de faturas</div><span>{lista.length} fatura(s)</span></div>
          <div className="actions-right">
            <button className="btn-primary" disabled={importando} onClick={() => arquivoRef.current?.click()}>
              {importando ? 'Importando...' : 'Importar fatura Verum'}
            </button>
            <input ref={arquivoRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={importarFaturas} />
          </div>
        </div>
        <div className="form-grid three">
          <label className="field">Busca<input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Fatura, transportadora ou auditor" /></label>
          <label className="field">Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option>{FATURA_STATUS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field">Visao<select><option>Minhas faturas</option><option>Todas as faturas</option><option>Sem auditor definido</option></select></label>
        </div>
        {mensagemImportacao && <div className="hint-box compact">{mensagemImportacao}</div>}
        <p className="compact">Layout esperado: abas Faturas e Detalhes, com Transportadora, Numero Fatura, Data Vencimento, Valor Fatura e Chave CTe.</p>
      </div>
      <div className="table-card">
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead><tr><th>Fatura</th><th>Transportadora</th><th>Vencimento</th><th>Valor</th><th>CT-es</th><th>Divergencia</th><th>Auditor</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {lista.map((fatura) => (
                <tr key={fatura.id}>
                  <td><strong>{fatura.numero_fatura}</strong></td>
                  <td>{fatura.transportadora}</td>
                  <td style={{ color: corAlerta(fatura), fontWeight: 700 }}>{dataBr(fatura.data_vencimento)}<small className="audit-days">{diasAte(fatura.data_vencimento)} dia(s)</small></td>
                  <td>{dinheiro(fatura.valor_fatura)}</td>
                  <td>{fatura.ctes_auditados || fatura.ctes_vinculados || 0}/{fatura.ctes_totais || 0}</td>
                  <td className={Number(fatura.diferenca) ? 'negativo' : ''}>{dinheiro(fatura.diferenca)}</td>
                  <td>{fatura.auditor_nome || <strong className="error-text">SEM AUDITOR DEFINIDO</strong>}</td>
                  <td><Status value={fatura.status} /></td>
                  <td><button className="btn-secondary audit-small-button" onClick={() => setAberta(fatura)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Gestao({ state, onState }) {
  const [editando, setEditando] = useState(null);
  const [auditor, setAuditor] = useState('');
  const [email, setEmail] = useState('');
  const carteiras = state.carteiras.map((carteira) => {
    const faturas = state.faturas.filter((item) => item.transportadora === carteira.transportadora);
    return {
      ...carteira,
      quantidade: faturas.length,
      valor: faturas.reduce((total, item) => total + Number(item.valor_fatura || 0), 0),
      vencidas: faturas.filter((item) => faixaVencimento(item) === 'VENCIDA').length,
      vencendo: faturas.filter((item) => ['CRITICO', 'LARANJA', 'AMARELO', 'VENCENDO_7_DIAS'].includes(faixaVencimento(item))).length,
      aguardando: faturas.filter((item) => ['AGUARDANDO_TRANSPORTADORA', 'AGUARDANDO_NOVA_FATURA'].includes(item.status)).length,
    };
  });

  const atribuir = async () => {
    if (!editando || !auditor.trim()) return;
    let next = await salvarCarteiraAuditoria(state, { ...editando, auditor_nome: auditor.trim(), auditor_email: email.trim() });
    const relacionadas = next.faturas.filter((item) => item.transportadora === editando.transportadora);
    for (const fatura of relacionadas) {
      next = await atualizarFaturaAuditoria(next, { ...fatura, auditor_nome: auditor.trim(), auditor_email: email.trim() }, {
        acao: 'AUDITOR_ATRIBUIDO', descricao: `Carteira atribuida a ${auditor.trim()}.`, usuario_nome: carregarSessao()?.nome || 'Gestao',
      });
    }
    onState(next);
    setEditando(null);
    setAuditor('');
    setEmail('');
  };

  return (
    <>
      <div className="summary-strip">
        <Card label="Auditores ativos" value={new Set(carteiras.filter((item) => item.auditor_nome).map((item) => item.auditor_nome)).size} />
        <Card label="Transportadoras" value={carteiras.length} />
        <Card label="Sem responsavel" value={carteiras.filter((item) => !item.auditor_nome).length} color="#9b1111" />
        <Card label="Faturas vencidas" value={carteiras.reduce((total, item) => total + item.vencidas, 0)} color="#9b1111" />
      </div>
      <div className="table-card">
        <div className="panel-title audit-table-title">Distribuicao de carteiras</div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead><tr><th>Auditor</th><th>Transportadora</th><th>Faturas</th><th>Valor em aberto</th><th>Vencidas</th><th>Vencendo</th><th>Aguardando retorno</th><th></th></tr></thead>
            <tbody>
              {carteiras.map((item) => (
                <tr key={item.id}>
                  <td>{item.auditor_nome || <strong className="error-text">SEM AUDITOR DEFINIDO</strong>}</td>
                  <td><strong>{item.transportadora}</strong></td><td>{item.quantidade}</td><td>{dinheiro(item.valor)}</td>
                  <td>{item.vencidas}</td><td>{item.vencendo}</td><td>{item.aguardando}</td>
                  <td><button className="btn-secondary audit-small-button" onClick={() => { setEditando(item); setAuditor(item.auditor_nome || ''); setEmail(item.auditor_email || ''); }}>Atribuir auditor</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editando && (
        <div className="panel-card">
          <div className="panel-title">Atribuir {editando.transportadora}</div>
          <div className="form-grid three">
            <label className="field">Auditor<input value={auditor} onChange={(e) => setAuditor(e.target.value)} placeholder="Nome" /></label>
            <label className="field">E-mail<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@empresa.com" /></label>
            <div className="audit-form-actions"><button className="btn-secondary" onClick={() => setEditando(null)}>Cancelar</button><button className="btn-primary" onClick={atribuir}>Salvar distribuicao</button></div>
          </div>
        </div>
      )}
    </>
  );
}

function Financeiro({ state, onState }) {
  const sessao = carregarSessao();
  const pagamentoRef = useRef(null);
  const [subtab, setSubtab] = useState('protocolos');
  const [faturaId, setFaturaId] = useState('');
  const [canal, setCanal] = useState('VERUM_SAP');
  const [tipo, setTipo] = useState(SOLICITACAO_FINANCEIRA_TIPOS[0]);
  const [descricao, setDescricao] = useState('');
  const [buscaFinanceiro, setBuscaFinanceiro] = useState('');
  const [solicitacaoAberta, setSolicitacaoAberta] = useState(null);
  const [respostaFinanceiro, setRespostaFinanceiro] = useState('');
  const [referenciaAnexo, setReferenciaAnexo] = useState('');
  const [erroFinanceiro, setErroFinanceiro] = useState('');
  const fatura = state.faturas.find((item) => item.id === faturaId);

  const enviar = async () => {
    if (!fatura) return;
    let next = await criarProtocoloFinanceiro(state, {
      fatura_ids: [fatura.id],
      valor: Number(fatura.valor_fatura || 0),
      canal,
      lote: `${new Date().toLocaleDateString('pt-BR')} 16:00`,
      responsavel_nome: sessao?.nome || sessao?.email || 'Usuario local',
    });
    next = await atualizarFaturaAuditoria(next, { ...fatura, status: 'ENVIADA_AO_FINANCEIRO', canal_envio_financeiro: canal }, {
      acao: 'ENVIADA_AO_FINANCEIRO', status_anterior: fatura.status, status_novo: 'ENVIADA_AO_FINANCEIRO',
      descricao: `Envio realizado pelo canal ${nomeStatus(canal)}.`, usuario_nome: sessao?.nome || 'Usuario local',
    });
    onState(next);
    setFaturaId('');
  };

  const abrirSolicitacao = async () => {
    if (!descricao.trim()) return;
    const prazo = new Date();
    prazo.setDate(prazo.getDate() + 2);
    const next = await criarSolicitacaoFinanceira(state, {
      tipo,
      descricao: descricao.trim(),
      fatura_id: faturaId || null,
      prazo_sla: prazo.toISOString().slice(0, 10),
      responsavel_nome: 'Financeiro',
      aberto_por_nome: sessao?.nome || sessao?.email || 'Usuario local',
    });
    onState(next);
    setDescricao('');
  };

  const atualizarBoleto = async (boleto, status) => {
    const next = await salvarBoletoFinanceiro(state, { ...boleto, status });
    onState(next);
  };

  const atenderSolicitacao = async (status) => {
    if (!solicitacaoAberta || !respostaFinanceiro.trim()) return;
    try {
      const next = await atenderSolicitacaoFinanceira(state, solicitacaoAberta, {
        status,
        comentario: respostaFinanceiro.trim(),
        anexo_nome: referenciaAnexo.trim(),
        responsavel_id: sessao?.id || '',
        responsavel_nome: sessao?.nome || sessao?.email || 'Financeiro',
        usuario_id: sessao?.id || '',
        usuario_nome: sessao?.nome || sessao?.email || 'Financeiro',
      });
      onState(next);
      setSolicitacaoAberta(next.solicitacoes.find((item) => item.id === solicitacaoAberta.id) || null);
      setRespostaFinanceiro('');
      setReferenciaAnexo('');
      setErroFinanceiro('');
    } catch (error) {
      setErroFinanceiro(error.message || String(error));
    }
  };

  const copiarProtocolo = async (protocolo) => {
    try {
      await navigator.clipboard.writeText(protocolo);
    } catch {
      // O protocolo continua visivel para copia manual.
    }
  };

  const solicitacoesFiltradas = state.solicitacoes.filter((item) => {
    const texto = `${item.protocolo} ${item.tipo} ${item.descricao} ${item.status}`.toLowerCase();
    return !buscaFinanceiro || texto.includes(buscaFinanceiro.toLowerCase());
  });

  const importarPagamentos = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
      const normalizados = rows.map((row) => ({
        numero_fatura: String(row['Numero Fatura'] || row['Fatura'] || row['numero_fatura'] || ''),
        transportadora: String(row['Transportadora'] || row['transportadora'] || ''),
        valor_pago: Number(row['Valor Pago'] || row['Valor'] || row['valor_pago'] || 0),
        data_pagamento: row['Data Pagamento'] || row['data_pagamento'] || new Date().toISOString().slice(0, 10),
        documento_compensacao: String(row['Documento Compensacao'] || row['Documento'] || ''),
        arquivo_origem: file.name,
      }));
      const conciliados = conciliarPagamentos(state.faturas, normalizados);
      // transportadora orienta a conciliacao, mas nao é coluna de financeiro_pagamentos.
      const registros = conciliados.map(({ transportadora, ...pagamento }) => pagamento);
      let next = await salvarPagamentosFinanceiros(state, registros);
      for (const pagamento of registros.filter((item) => item.fatura_id)) {
        const fat = next.faturas.find((item) => item.id === pagamento.fatura_id);
        next = await atualizarFaturaAuditoria(next, {
          ...fat,
          status: pagamento.resultado === 'PAGO' ? 'PAGA' : 'PAGA_COM_DIVERGENCIA',
          valor_pago: pagamento.valor_pago,
          data_pagamento: pagamento.data_pagamento,
        }, {
          acao: 'PAGAMENTO_CONCILIADO', status_anterior: fat.status,
          status_novo: pagamento.resultado === 'PAGO' ? 'PAGA' : 'PAGA_COM_DIVERGENCIA',
          descricao: `Pagamento importado: ${pagamento.resultado}.`, usuario_nome: sessao?.nome || 'Usuario local',
        });
      }
      const ambiguos = registros.filter((item) => item.resultado === 'AMBIGUO').length;
      setErroFinanceiro(ambiguos
        ? `${ambiguos} pagamento(s) com numero de fatura repetido em mais de uma transportadora. Inclua a coluna Transportadora no relatorio para conciliar.`
        : '');
      onState(next);
    } catch (error) {
      setErroFinanceiro(error.message || String(error));
    }
  };

  return (
    <>
      <div className="tabs-row">
        {[
          ['protocolos', 'Protocolos'], ['solicitacoes', 'Solicitacoes e SLA'], ['boletos', 'Boletos'], ['pagamentos', 'Pagamentos'],
        ].map(([id, label]) => <button key={id} className={`toggle-btn ${subtab === id ? 'active' : ''}`} onClick={() => setSubtab(id)}>{label}</button>)}
      </div>
      {erroFinanceiro && <div className="hint-box compact error-text">{erroFinanceiro}</div>}

      {subtab === 'protocolos' && (
        <>
          <div className="panel-card">
            <div className="panel-title">Enviar para Financeiro</div>
            <div className="form-grid three">
              <label className="field">Fatura<select value={faturaId} onChange={(e) => setFaturaId(e.target.value)}><option value="">Selecione</option>{state.faturas.filter((item) => item.status === 'PRONTA_PARA_PAGAMENTO').map((item) => <option key={item.id} value={item.id}>{item.numero_fatura} - {item.transportadora} - {dinheiro(item.valor_fatura)}</option>)}</select></label>
              <label className="field">Canal<select value={canal} onChange={(e) => setCanal(e.target.value)}><option value="VERUM_SAP">Verum / SAP</option><option value="PROTOCOLO_FINANCEIRO">Protocolo Financeiro</option></select></label>
              <div className="audit-form-actions"><button className="btn-primary" disabled={!faturaId} onClick={enviar}>Gerar protocolo e enviar</button></div>
            </div>
          </div>
          <SimpleTable headers={['Protocolo', 'Canal', 'Valor', 'Lote', 'Responsavel', 'Status']} rows={state.protocolos.map((item) => [item.protocolo, nomeStatus(item.canal), dinheiro(item.valor), item.lote || '-', item.responsavel_nome || '-', <Status key="s" value={item.status} />])} />
        </>
      )}
      {subtab === 'solicitacoes' && (
        <>
          <div className="panel-card">
            <div className="panel-title">Nova solicitacao financeira</div>
            <div className="form-grid three">
              <label className="field">Tipo<select value={tipo} onChange={(e) => setTipo(e.target.value)}>{SOLICITACAO_FINANCEIRA_TIPOS.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="field">Fatura (opcional)<select value={faturaId} onChange={(e) => setFaturaId(e.target.value)}><option value="">Sem vinculo</option>{state.faturas.map((item) => <option key={item.id} value={item.id}>{item.numero_fatura} - {item.transportadora}</option>)}</select></label>
              <label className="field">Descricao<input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descreva a solicitacao" /></label>
            </div>
            <div className="actions-right"><button className="btn-primary" disabled={!descricao.trim()} onClick={abrirSolicitacao}>Abrir solicitacao</button></div>
          </div>
          <div className="panel-card">
            <div className="section-row compact-top">
              <div>
                <div className="panel-title">Fila de atendimento do Financeiro</div>
                <p>Localize pelo protocolo, assuma, responda e conclua a solicitacao.</p>
              </div>
              <label className="field audit-finance-search">Buscar protocolo
                <input value={buscaFinanceiro} onChange={(e) => setBuscaFinanceiro(e.target.value)} placeholder="FIN-SLA-..." />
              </label>
            </div>
          </div>
          <div className="table-card">
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead><tr><th>Protocolo</th><th>Tipo</th><th>Descricao</th><th>Responsavel</th><th>Prazo</th><th>SLA</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {solicitacoesFiltradas.map((item) => (
                    <tr key={item.id}>
                      <td><button className="btn-link" onClick={() => copiarProtocolo(item.protocolo)} title="Copiar protocolo"><strong>{item.protocolo}</strong></button></td>
                      <td>{nomeStatus(item.tipo)}</td><td>{item.descricao}</td><td>{item.responsavel_nome || '-'}</td>
                      <td>{dataBr(item.prazo_sla)}</td><td><Status value={statusSla(item)} /></td><td><Status value={item.status} /></td>
                      <td><button className="btn-primary audit-small-button" onClick={() => setSolicitacaoAberta(item)}>Atender</button></td>
                    </tr>
                  ))}
                  {!solicitacoesFiltradas.length && <tr><td colSpan="8">Nenhuma solicitacao encontrada.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {solicitacaoAberta && (
            <div className="panel-card audit-finance-attendance">
              <div className="section-row compact-top">
                <div>
                  <div className="panel-title">Atendimento {solicitacaoAberta.protocolo}</div>
                  <p>{nomeStatus(solicitacaoAberta.tipo)} | Aberta por {solicitacaoAberta.aberto_por_nome || '-'}</p>
                </div>
                <button className="btn-secondary audit-small-button" onClick={() => setSolicitacaoAberta(null)}>Fechar</button>
              </div>
              <div className="audit-finance-request">{solicitacaoAberta.descricao}</div>
              <div className="form-grid two">
                <label className="field">Resposta / providencia
                  <textarea value={respostaFinanceiro} onChange={(e) => setRespostaFinanceiro(e.target.value)} placeholder="Registre a resposta, comprovante, reversao ou ajuste realizado." />
                </label>
                <label className="field">Referencia do anexo
                  <input value={referenciaAnexo} onChange={(e) => setReferenciaAnexo(e.target.value)} placeholder="Nome do comprovante ou documento" />
                </label>
              </div>
              <div className="actions-right">
                <button className="btn-secondary" disabled={!respostaFinanceiro.trim()} onClick={() => atenderSolicitacao('EM_ATENDIMENTO')}>Salvar atendimento</button>
                <button className="btn-primary" disabled={!respostaFinanceiro.trim()} onClick={() => atenderSolicitacao('CONCLUIDA')}>Concluir solicitacao</button>
              </div>
              <div className="audit-timeline">
                {(state.solicitacaoHistorico || []).filter((item) => item.solicitacao_id === solicitacaoAberta.id).map((item) => (
                  <div key={item.id}><strong>{nomeStatus(item.acao)}</strong><span>{item.comentario || '-'}</span><small>{item.usuario_nome || 'Sistema'} | {new Date(item.created_at).toLocaleString('pt-BR')}</small></div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {subtab === 'boletos' && (
        <div className="table-card">
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead><tr><th>Fatura</th><th>Transportadora</th><th>Vencimento</th><th>Alerta</th><th>Status boleto</th><th>Atualizar</th></tr></thead>
              <tbody>
                {state.boletos.map((boleto) => {
                  const fat = state.faturas.find((item) => item.id === boleto.fatura_id);
                  return <tr key={boleto.id}><td>{fat?.numero_fatura || '-'}</td><td>{fat?.transportadora || '-'}</td><td>{dataBr(boleto.vencimento)}</td><td><Status value={faixaVencimento({ ...fat, data_vencimento: boleto.vencimento })} /></td><td><Status value={boleto.status} /></td><td><select value={boleto.status} onChange={(e) => atualizarBoleto(boleto, e.target.value)}>{BOLETO_STATUS.map((item) => <option key={item}>{item}</option>)}</select></td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {subtab === 'pagamentos' && (
        <>
          <div className="panel-card">
            <div className="section-row compact-top"><div><div className="panel-title">Importacao diaria de pagamentos</div><p>Layout: Numero Fatura, Valor Pago, Data Pagamento e Documento Compensacao.</p></div><button className="btn-primary" onClick={() => pagamentoRef.current?.click()}>Importar XLSX/CSV</button></div>
            <input ref={pagamentoRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={importarPagamentos} />
          </div>
          <SimpleTable headers={['Fatura', 'Valor pago', 'Data', 'Documento', 'Resultado', 'Diferenca']} rows={state.pagamentos.map((item) => [item.numero_fatura || '-', dinheiro(item.valor_pago), dataBr(item.data_pagamento), item.documento_compensacao || '-', <Status key="r" value={item.resultado} />, dinheiro(item.diferenca)])} empty="Nenhum relatorio financeiro importado." />
        </>
      )}
    </>
  );
}

function SimpleTable({ headers, rows, empty = 'Nenhum registro encontrado.' }) {
  return (
    <div className="table-card">
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead><tr>{headers.map((item) => <th key={item}>{item}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={index}>{row.map((item, cell) => <td key={cell}>{item}</td>)}</tr>)}
            {!rows.length && <tr><td colSpan={headers.length}>{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CentralAuditoriaFretesPage({ initialTab = 'dashboard' }) {
  const [tab, setTab] = useState(initialTab);
  const [state, setState] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    carregarPlataformaAuditoria().then(setState).catch((error) => setErro(error.message));
  }, []);

  useEffect(() => setTab(initialTab), [initialTab]);

  const restaurar = () => setState({ ...restaurarDemonstracaoAuditoria(), modo: 'DEMONSTRACAO_LOCAL' });

  if (!state) return <div className="panel-card">{erro ? `Erro: ${erro}` : 'Carregando Plataforma de Auditoria de Fretes...'}</div>;

  return (
    <div className="page-shell audit-platform-page">
      <div className="page-header">
        <span className="amd-mini-brand">Demanda 4.40 | Unidade de trabalho: FATURA</span>
        <h1>Plataforma de Auditoria de Fretes</h1>
        <p>Auditoria, vencimentos, tratativas, DOCCOB, protocolos, SLA, boletos, pagamentos e gestao de carteiras em um unico fluxo.</p>
      </div>
      <div className="audit-mode-banner">
        <span>Modo: <strong>{nomeStatus(state.modo)}</strong></span>
        {state.modo === 'DEMONSTRACAO_LOCAL' && <button className="btn-secondary audit-small-button" onClick={restaurar}>Restaurar dados de demonstracao</button>}
      </div>
      <div className="tabs-row audit-main-tabs">
        {TABS.map(([id, label]) => <button key={id} className={`toggle-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'dashboard' && <Dashboard state={state} />}
      {tab === 'faturas' && <Faturas state={state} onState={setState} />}
      {tab === 'gestao' && <Gestao state={state} onState={setState} />}
      {tab === 'financeiro' && <Financeiro state={state} onState={setState} />}
    </div>
  );
}
