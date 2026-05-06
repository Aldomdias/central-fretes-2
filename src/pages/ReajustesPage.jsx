import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { exportarRealizadoLocal } from '../services/realizadoLocalDb';
import {
  aplicarVinculoAutomatico,
  calcularImpactosReajustes,
  carregarConfigReajustes,
  carregarReajustes,
  formatarMoedaReajuste,
  formatarPercentualReajuste,
  importarControleReajustes,
  isEfetivado,
  mesAtualPadrao,
  resumoReajustes,
  salvarConfigReajustes,
  salvarReajustes,
} from '../utils/reajustesLocal';

const STATUS_OPTIONS = ['EM ANÁLISE', 'ADIADO', 'APROVADO', 'EFETIVADO', 'NEGADO', 'PENDENTE', 'AGUARDANDO RETORNO'];

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(value) {
  if (!value) return '-';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  if (y && m && d) return `${d}/${m}/${y}`;
  return String(value);
}

function safeSheetName(nome) {
  return String(nome || 'Planilha').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Planilha';
}

function aplicarFormato(ws, rows = []) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  ws['!cols'] = headers.map((header) => {
    if (/observ/i.test(header)) return { wch: 42 };
    if (/transportadora/i.test(header)) return { wch: 34 };
    if (/data/i.test(header)) return { wch: 14 };
    if (/valor|impacto|frete|faturamento|nf/i.test(header)) return { wch: 18 };
    if (/%|reajuste|percentual/i.test(header)) return { wch: 16 };
    return { wch: Math.min(Math.max(String(header).length + 4, 12), 26) };
  });
  headers.forEach((header, colIndex) => {
    for (let rowIndex = 1; rowIndex <= rows.length; rowIndex += 1) {
      const ref = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = ws[ref];
      if (!cell || typeof cell.v !== 'number') continue;
      if (/valor|impacto|frete|faturamento|nf/i.test(header)) cell.z = 'R$ #,##0.00';
      else if (/%|reajuste|percentual/i.test(header)) cell.z = '0.00%';
      else cell.z = '#,##0.00';
    }
  });
}

function baixarXlsx(nomeArquivo, abas) {
  const wb = XLSX.utils.book_new();
  Object.entries(abas).forEach(([nome, rows]) => {
    const ws = XLSX.utils.json_to_sheet(rows || []);
    aplicarFormato(ws, rows || []);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(nome));
  });
  XLSX.writeFile(wb, nomeArquivo);
}

function linhasRelatorio(itens = [], fimPeriodo = '') {
  return itens.map((item) => ({
    Transportadora_Informada: item.transportadoraInformada || '',
    Transportadora_Sistema: item.transportadoraSistema || '',
    Canal: item.canal || '',
    Status: item.status || '',
    Data_Inicio: item.dataInicio || '',
    Reajuste_Solicitado: toNumber(item.reajusteSolicitado),
    Reajuste_Aplicado: toNumber(item.reajusteAplicado),
    Efetivado_No_Periodo: isEfetivado(item, fimPeriodo) ? 'Sim' : 'Não',
    CTEs_Periodo: toNumber(item.ctesPeriodo),
    Frete_Base_Periodo: toNumber(item.valorFretePeriodo),
    Valor_NF_Periodo: toNumber(item.valorNFPeriodo),
    Impacto_Periodo: toNumber(item.impactoPeriodo),
    Frete_Com_Reajuste: toNumber(item.freteComReajuste),
    Percentual_Atual_Realizado: toNumber(item.percentualFreteAtual),
    Percentual_Com_Reajuste: toNumber(item.percentualFreteComReajuste),
    Impacto_Planilha: toNumber(item.impactoReajustePlanilha || item.impactoEmergencialPlanilha),
    Observacao: item.observacao || '',
  }));
}

export default function ReajustesPage({ transportadoras = [] }) {
  const [itens, setItens] = useState(() => carregarReajustes());
  const [config, setConfig] = useState(() => {
    const salvo = carregarConfigReajustes();
    if (salvo?.inicio || salvo?.fim) return salvo;
    return mesAtualPadrao();
  });
  const [arquivo, setArquivo] = useState(null);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [somenteEfetivados, setSomenteEfetivados] = useState(false);

  useEffect(() => {
    salvarConfigReajustes(config);
  }, [config]);

  const opcoesTransportadoras = useMemo(() => (transportadoras || [])
    .map((item) => item.nome)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'pt-BR')),
  [transportadoras]);

  const resumo = useMemo(() => resumoReajustes(itens, config.fim), [itens, config.fim]);

  const itensFiltrados = useMemo(() => {
    const texto = filtroTexto.trim().toUpperCase();
    return (itens || [])
      .filter((item) => !texto || `${item.transportadoraInformada} ${item.transportadoraSistema} ${item.observacao}`.toUpperCase().includes(texto))
      .filter((item) => !filtroStatus || item.status === filtroStatus)
      .filter((item) => !somenteEfetivados || isEfetivado(item, config.fim))
      .sort((a, b) => toNumber(b.impactoPeriodo) - toNumber(a.impactoPeriodo) || String(a.transportadoraInformada).localeCompare(String(b.transportadoraInformada), 'pt-BR'));
  }, [itens, filtroTexto, filtroStatus, somenteEfetivados, config.fim]);

  function persistir(novos) {
    setItens(novos);
    salvarReajustes(novos);
  }

  function alterarItem(id, campo, valor) {
    const novos = itens.map((item) => item.id === id ? { ...item, [campo]: valor, atualizadoEm: new Date().toISOString() } : item);
    persistir(novos);
  }

  async function importarArquivo() {
    if (!arquivo) {
      setErro('Selecione a planilha de controle de reajustes.');
      return;
    }
    setCarregando(true);
    setErro('');
    setMensagem('Lendo aba Final da planilha...');
    try {
      const resultado = await importarControleReajustes(arquivo);
      const comVinculo = aplicarVinculoAutomatico(resultado.itens, transportadoras);
      persistir(comVinculo);
      setMensagem(`Importado da aba ${resultado.sheetName}: ${resultado.total.toLocaleString('pt-BR')} reajuste(s). Revise os vínculos e calcule o impacto do período.`);
    } catch (error) {
      setErro(error.message || 'Erro ao importar controle de reajustes.');
    } finally {
      setCarregando(false);
    }
  }

  function tentarVincular() {
    const novos = aplicarVinculoAutomatico(itens, transportadoras);
    persistir(novos);
    setMensagem('Vínculo automático atualizado. Revise os casos que ficaram sem transportadora do sistema.');
    setErro('');
  }

  async function calcularImpacto() {
    setCarregando(true);
    setErro('');
    setMensagem('Buscando Realizado Local para calcular impacto...');
    try {
      const { rows, totalCompativel, limit } = await exportarRealizadoLocal({
        inicio: config.inicio,
        fim: config.fim,
      }, { limit: 500000 });
      const calculados = calcularImpactosReajustes(itens, rows || []);
      persistir(calculados);
      setMensagem(`Impacto calculado com ${Number(rows?.length || 0).toLocaleString('pt-BR')} CT-e(s) do Realizado Local${totalCompativel > limit ? ' dentro do limite exportado' : ''}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao calcular impacto pelo Realizado Local.');
    } finally {
      setCarregando(false);
    }
  }

  function exportarRelatorio() {
    const relatorio = linhasRelatorio(itens, config.fim);
    const efetivados = linhasRelatorio(itens.filter((item) => isEfetivado(item, config.fim)), config.fim);
    const semVinculo = linhasRelatorio(itens.filter((item) => !item.transportadoraSistema), config.fim);
    const resumoRows = [{
      Periodo_Inicial: config.inicio || 'Todos',
      Periodo_Final: config.fim || 'Todos',
      Reajustes: itens.length,
      Efetivados: efetivados.length,
      Sem_Vinculo: semVinculo.length,
      Frete_Base_Periodo: resumo.freteBase,
      Impacto_Total_Periodo: resumo.impactoTotal,
      Impacto_Efetivado_Periodo: resumo.impactoEfetivado,
    }];
    baixarXlsx(`controle-reajustes-${config.inicio || 'inicio'}-${config.fim || 'fim'}.xlsx`, {
      Resumo: resumoRows,
      Controle_Reajustes: relatorio,
      Efetivados: efetivados,
      Sem_Vinculo: semVinculo,
    });
  }

  function limparTudo() {
    if (!window.confirm('Deseja limpar o controle de reajustes local deste navegador?')) return;
    persistir([]);
    setMensagem('Controle de reajustes limpo.');
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="amd-mini-brand">AMD Log • Reajustes</div>
        <h1>Controle de reajustes</h1>
        <p>Importe a aba Final da planilha, vincule com as transportadoras do sistema e calcule o impacto pelo Realizado Local do período.</p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {mensagem ? <div className="sim-alert info">{mensagem}</div> : null}

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Importar controle</div>
            <p>Use a planilha de controle de reajustes. O sistema lê a aba <strong>Final</strong> e preserva solicitado, proposta, data de início e observação.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={tentarVincular} disabled={!itens.length || carregando}>Tentar vincular nomes</button>
            <button className="btn-danger" type="button" onClick={limparTudo} disabled={!itens.length || carregando}>Limpar controle</button>
          </div>
        </div>
        <div className="form-grid two">
          <label className="field">Planilha de reajustes
            <input type="file" accept=".xlsx,.xls,.xlsm" onChange={(event) => setArquivo(event.target.files?.[0] || null)} />
          </label>
          <div className="actions-right" style={{ alignItems: 'end' }}>
            <button className="btn-primary" type="button" onClick={importarArquivo} disabled={carregando || !arquivo}>{carregando ? 'Processando...' : 'Importar aba Final'}</button>
          </div>
        </div>
      </section>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Impacto por período</div>
            <p>Escolha o período, por exemplo abril, para calcular quanto o reajuste representaria sobre o faturamento realizado da transportadora.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={exportarRelatorio} disabled={!itens.length}>Exportar relatório</button>
            <button className="btn-primary" type="button" onClick={calcularImpacto} disabled={!itens.length || carregando}>{carregando ? 'Calculando...' : 'Calcular impacto'}</button>
          </div>
        </div>
        <div className="form-grid three">
          <label className="field">Período inicial
            <input type="date" value={config.inicio || ''} onChange={(event) => setConfig((prev) => ({ ...prev, inicio: event.target.value }))} />
          </label>
          <label className="field">Período final
            <input type="date" value={config.fim || ''} onChange={(event) => setConfig((prev) => ({ ...prev, fim: event.target.value }))} />
          </label>
          <label className="field">Busca
            <input value={filtroTexto} onChange={(event) => setFiltroTexto(event.target.value)} placeholder="Transportadora, observação..." />
          </label>
        </div>
        <div className="form-grid three">
          <label className="field">Status
            <select value={filtroStatus} onChange={(event) => setFiltroStatus(event.target.value)}>
              <option value="">Todos</option>
              {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={somenteEfetivados} onChange={(event) => setSomenteEfetivados(event.target.checked)} />
            Mostrar apenas reajustes efetivados/vigentes
          </label>
        </div>
      </section>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card"><span>Solicitações</span><strong>{resumo.totalSolicitados.toLocaleString('pt-BR')}</strong><small>Registros importados</small></div>
        <div className="summary-card"><span>Efetivados/vigentes</span><strong>{resumo.totalEfetivados.toLocaleString('pt-BR')}</strong><small>Com status ou início no período</small></div>
        <div className="summary-card"><span>Sem vínculo</span><strong>{resumo.semVinculo.toLocaleString('pt-BR')}</strong><small>Revisar nome da transportadora</small></div>
        <div className="summary-card"><span>Frete base período</span><strong>{formatarMoedaReajuste(resumo.freteBase)}</strong><small>Realizado Local vinculado</small></div>
        <div className="summary-card"><span>Impacto total</span><strong>{formatarMoedaReajuste(resumo.impactoTotal)}</strong><small>Reajuste aplicado × frete</small></div>
        <div className="summary-card"><span>Impacto efetivado</span><strong>{formatarMoedaReajuste(resumo.impactoEfetivado)}</strong><small>Somente aprovados/vigentes</small></div>
      </div>

      <section className="table-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Controle de reajustes</div>
            <p className="compact">Edite o vínculo, o reajuste aplicado, status e data de início. As alterações ficam salvas localmente.</p>
          </div>
          <span className="pill-soft">{itensFiltrados.length.toLocaleString('pt-BR')} linha(s)</span>
        </div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Transportadora planilha</th>
                <th>Transportadora sistema</th>
                <th>Canal</th>
                <th>Status</th>
                <th>Data início</th>
                <th>Solicitado</th>
                <th>Aplicado</th>
                <th>CT-es período</th>
                <th>Frete base</th>
                <th>Impacto período</th>
                <th>% atual</th>
                <th>% c/ reajuste</th>
                <th>Obs.</th>
              </tr>
            </thead>
            <tbody>
              {itensFiltrados.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.transportadoraInformada}</strong></td>
                  <td>
                    <select value={item.transportadoraSistema || ''} onChange={(event) => alterarItem(item.id, 'transportadoraSistema', event.target.value)}>
                      <option value="">Sem vínculo</option>
                      {opcoesTransportadoras.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
                    </select>
                  </td>
                  <td>{item.canal || '-'}</td>
                  <td>
                    <select value={item.status || ''} onChange={(event) => alterarItem(item.id, 'status', event.target.value)}>
                      <option value="">-</option>
                      {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </td>
                  <td><input type="date" value={String(item.dataInicio || '').slice(0, 10)} onChange={(event) => alterarItem(item.id, 'dataInicio', event.target.value)} /></td>
                  <td>{item.reajusteSolicitado ? formatarPercentualReajuste(item.reajusteSolicitado) : (item.reajusteSolicitadoTexto || '-')}</td>
                  <td><input type="number" step="0.0001" value={toNumber(item.reajusteAplicado)} onChange={(event) => alterarItem(item.id, 'reajusteAplicado', Number(event.target.value || 0))} /></td>
                  <td>{toNumber(item.ctesPeriodo).toLocaleString('pt-BR')}</td>
                  <td>{formatarMoedaReajuste(item.valorFretePeriodo)}</td>
                  <td><strong>{formatarMoedaReajuste(item.impactoPeriodo)}</strong></td>
                  <td>{item.percentualFreteAtual ? formatarPercentualReajuste(item.percentualFreteAtual) : '-'}</td>
                  <td>{item.percentualFreteComReajuste ? formatarPercentualReajuste(item.percentualFreteComReajuste) : '-'}</td>
                  <td style={{ minWidth: 280 }}>
                    <textarea value={item.observacao || ''} onChange={(event) => alterarItem(item.id, 'observacao', event.target.value)} rows={2} />
                  </td>
                </tr>
              ))}
              {!itensFiltrados.length && <tr><td colSpan="13">Nenhum reajuste carregado ou compatível com o filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
