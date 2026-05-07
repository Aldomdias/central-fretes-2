import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { exportarRealizadoLocal } from '../services/realizadoLocalDb';
import {
  aplicarVinculoAutomatico,
  calcularImpactosReajustes,
  carregarConfigReajustes,
  carregarReajustes,
  criarReajusteManual,
  detectarMelhoresVinculos,
  formatarMoedaReajuste,
  formatarPercentualReajuste,
  importarControleReajustes,
  isEfetivado,
  mesAtualPadrao,
  normalizarTextoReajuste,
  parsePercentReajuste,
  resumoReajustes,
  salvarConfigReajustes,
  salvarReajustes,
} from '../utils/reajustesLocal';

const STATUS_OPTIONS = ['EM ANÁLISE', 'ADIADO', 'APROVADO', 'EFETIVADO', 'NEGADO', 'PENDENTE', 'AGUARDANDO RETORNO'];

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function formatarPercentualInput(value) {
  const n = toNumber(value) * 100;
  if (!n) return '';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function parsePercentualInput(value) {
  return parsePercentReajuste(value);
}

function hojeIso() {
  return new Date().toISOString().slice(0, 10);
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
    if (/transportadora|vinculo/i.test(header)) return { wch: 42 };
    if (/data/i.test(header)) return { wch: 14 };
    if (/valor|impacto|frete|faturamento|nf/i.test(header)) return { wch: 18 };
    if (/%|reajuste|percentual/i.test(header)) return { wch: 16 };
    return { wch: Math.min(Math.max(String(header).length + 4, 12), 28) };
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
    Vinculos_Realizado: (item.transportadorasRealizado || []).join(' | '),
    Canal: item.canal || '',
    Status: item.status || '',
    Data_Inicio: item.dataInicio || '',
    Reajuste_Solicitado: toNumber(item.reajusteSolicitado),
    Reajuste_Aplicado: toNumber(item.reajusteAplicado),
    Efetivado_No_Periodo: isEfetivado(item, fimPeriodo) ? 'Sim' : 'Não',
    CTEs_Periodo_Base: toNumber(item.ctesPeriodo),
    Frete_Base_Periodo: toNumber(item.valorFretePeriodo),
    Valor_NF_Periodo: toNumber(item.valorNFPeriodo),
    Impacto_Previsto_Periodo: toNumber(item.impactoPrevisto || item.impactoPeriodo),
    Frete_Com_Reajuste: toNumber(item.freteComReajuste),
    CTEs_Realizados_Apos_Inicio: toNumber(item.ctesRealizadoReajuste),
    Frete_Realizado_Apos_Inicio: toNumber(item.valorFreteRealizadoReajuste),
    Impacto_Realizado_Apos_Inicio: toNumber(item.impactoRealizado),
    Percentual_Atual_Realizado: toNumber(item.percentualFreteAtual),
    Percentual_Com_Reajuste: toNumber(item.percentualFreteComReajuste),
    Impacto_Planilha: toNumber(item.impactoReajustePlanilha || item.impactoEmergencialPlanilha),
    Observacao: item.observacao || '',
  }));
}
function nomesUnicosRealizado(rows = []) {
  const mapa = new Map();
  (rows || []).forEach((row) => {
    const nome = String(row.transportadora || row.nomeTransportadora || row.transportadoraRealizada || '').trim();
    if (!nome) return;
    const key = normalizarTextoReajuste(nome);
    if (!key) return;
    const atual = mapa.get(key) || { nome, ctes: 0, frete: 0 };
    atual.ctes += 1;
    atual.frete += toNumber(row.valorCte || row.valorCTe || row.valorFrete || row.freteRealizado);
    mapa.set(key, atual);
  });
  return [...mapa.values()].sort((a, b) => b.frete - a.frete || b.ctes - a.ctes || a.nome.localeCompare(b.nome, 'pt-BR'));
}

function filtrarOpcoesRealizado(opcoes = [], busca = '', itemNome = '') {
  const texto = normalizarTextoReajuste(busca || itemNome);
  if (!texto) return opcoes.slice(0, 18);
  const palavras = texto.split(' ').filter((p) => p.length >= 2);
  return opcoes
    .map((opcao) => {
      const norm = normalizarTextoReajuste(opcao.nome);
      let score = 0;
      if (norm === texto) score = 100;
      else if (norm.includes(texto) || texto.includes(norm)) score = 80;
      else if (palavras.length) score = palavras.filter((p) => norm.includes(p)).length * 20;
      return { ...opcao, score };
    })
    .filter((opcao) => opcao.score > 0)
    .sort((a, b) => b.score - a.score || b.frete - a.frete || a.nome.localeCompare(b.nome, 'pt-BR'))
    .slice(0, 18);
}

function resumoVinculosSelecionados(selecionadas = [], opcoesRealizado = []) {
  const selecionadasNorm = new Set(selecionadas.map(normalizarTextoReajuste));
  return (opcoesRealizado || []).reduce((acc, opcao) => {
    if (!selecionadasNorm.has(normalizarTextoReajuste(opcao.nome))) return acc;
    acc.ctes += toNumber(opcao.ctes);
    acc.frete += toNumber(opcao.frete);
    return acc;
  }, { ctes: 0, frete: 0 });
}

function VinculoRealizadoCell({
  item,
  opcoesRealizado,
  busca,
  onBusca,
  onToggle,
  onMarcar,
  onLimpar,
  aberto,
  onEditar,
  onConcluir,
}) {
  const selecionadas = Array.isArray(item.transportadorasRealizado) ? item.transportadorasRealizado : [];
  const sugestoes = useMemo(
    () => detectarMelhoresVinculos(item.transportadoraInformada, opcoesRealizado.map((opcao) => opcao.nome), 8),
    [item.transportadoraInformada, opcoesRealizado]
  );
  const opcoes = useMemo(
    () => filtrarOpcoesRealizado(opcoesRealizado, busca, item.transportadoraInformada),
    [opcoesRealizado, busca, item.transportadoraInformada]
  );
  const selecionadasNorm = new Set(selecionadas.map(normalizarTextoReajuste));
  const resumo = resumoVinculosSelecionados(selecionadas, opcoesRealizado);

  if (!aberto) {
    return (
      <div style={{ minWidth: 340, display: 'grid', gap: 8 }}>
        {selecionadas.length ? (
          <>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {selecionadas.map((nome) => <span key={nome} className="pill-soft">{nome}</span>)}
            </div>
            <small style={{ color: '#64748b' }}>
              {selecionadas.length.toLocaleString('pt-BR')} vínculo(s) • {resumo.ctes.toLocaleString('pt-BR')} CT-e(s) • {formatarMoedaReajuste(resumo.frete)} no Realizado Local
            </small>
          </>
        ) : (
          <span className="pill-soft">Sem vínculo realizado</span>
        )}
        <div>
          <button type="button" className="btn-secondary" style={{ padding: '6px 10px', fontSize: 12 }} onClick={onEditar}>
            Editar vínculo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minWidth: 380, display: 'grid', gap: 8 }}>
      <input
        value={busca || ''}
        onChange={(event) => onBusca(event.target.value)}
        placeholder="Buscar nome no Realizado Local..."
        autoFocus
      />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {selecionadas.length ? selecionadas.map((nome) => (
          <span key={nome} className="pill-soft">{nome}</span>
        )) : <span className="pill-soft">Sem vínculo realizado</span>}
      </div>

      {sugestoes.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ color: '#64748b', fontSize: 12 }}>Sugestões:</span>
          {sugestoes.map((nome) => (
            <button key={nome} type="button" className="btn-secondary" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => onToggle(nome, true)}>
              + {nome}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn-secondary" style={{ padding: '5px 8px', fontSize: 12 }} onClick={() => onMarcar(opcoes.map((opcao) => opcao.nome))} disabled={!opcoes.length}>
          Marcar filtrados
        </button>
        <button type="button" className="btn-secondary" style={{ padding: '5px 8px', fontSize: 12 }} onClick={onLimpar} disabled={!selecionadas.length}>
          Limpar
        </button>
      </div>

      <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #d8e2f2', borderRadius: 12, padding: 8, background: '#fff' }}>
        {opcoes.map((opcao) => {
          const checked = selecionadasNorm.has(normalizarTextoReajuste(opcao.nome));
          return (
            <label key={opcao.nome} style={{ display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr)', gap: 8, alignItems: 'start', padding: '4px 0' }}>
              <input type="checkbox" checked={checked} onChange={(event) => onToggle(opcao.nome, event.target.checked)} />
              <span>
                <strong>{opcao.nome}</strong>
                <small style={{ display: 'block', color: '#64748b' }}>
                  {opcao.ctes.toLocaleString('pt-BR')} CT-e(s) • {Number(opcao.frete || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </small>
              </span>
            </label>
          );
        })}
        {!opcoes.length && <div style={{ color: '#64748b' }}>Nenhum nome encontrado na base realizada local.</div>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <small style={{ color: '#64748b' }}>
          {selecionadas.length.toLocaleString('pt-BR')} vínculo(s) selecionado(s)
        </small>
        <button type="button" className="btn-primary" style={{ padding: '7px 12px', fontSize: 12 }} onClick={onConcluir}>
          Concluir vínculo
        </button>
      </div>
    </div>
  );
}

export default function ReajustesPage() {
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
  const [opcoesRealizado, setOpcoesRealizado] = useState([]);
  const [buscasVinculo, setBuscasVinculo] = useState({});
  const [vinculoAbertoId, setVinculoAbertoId] = useState(null);
  const [novoReajuste, setNovoReajuste] = useState({
    transportadoraInformada: '',
    canal: '',
    status: 'EM ANÁLISE',
    dataInicio: hojeIso(),
    reajusteSolicitado: '',
    reajusteAplicado: '',
    observacao: '',
  });

  useEffect(() => {
    salvarConfigReajustes(config);
  }, [config]);

  useEffect(() => {
    carregarNomesRealizado(false).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumo = useMemo(() => resumoReajustes(itens, config.fim), [itens, config.fim]);

  const itensFiltrados = useMemo(() => {
    const texto = filtroTexto.trim().toUpperCase();
    return (itens || [])
      .filter((item) => !texto || `${item.transportadoraInformada} ${(item.transportadorasRealizado || []).join(' ')} ${item.observacao}`.toUpperCase().includes(texto))
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


  function alterarPercentualItem(id, campo, valor) {
    alterarItem(id, campo, parsePercentualInput(valor));
  }

  function alterarNovo(campo, valor) {
    setNovoReajuste((prev) => ({ ...prev, [campo]: valor }));
  }

  function adicionarReajusteManual() {
    setErro('');
    try {
      const novo = criarReajusteManual(novoReajuste);
      persistir([novo, ...itens]);
      setNovoReajuste({
        transportadoraInformada: '',
        canal: '',
        status: 'EM ANÁLISE',
        dataInicio: hojeIso(),
        reajusteSolicitado: '',
        reajusteAplicado: '',
        observacao: '',
      });
      setMensagem('Reajuste incluído manualmente. Agora vincule os nomes do Realizado Local e calcule o impacto.');
    } catch (error) {
      setErro(error.message || 'Erro ao incluir reajuste.');
    }
  }

  function alterarBuscaVinculo(id, valor) {
    setBuscasVinculo((prev) => ({ ...prev, [id]: valor }));
  }

  function setVinculosItem(id, nomes) {
    const limpos = (nomes || [])
      .map((nome) => String(nome || '').trim())
      .filter(Boolean)
      .filter((nome, index, arr) => arr.findIndex((n) => normalizarTextoReajuste(n) === normalizarTextoReajuste(nome)) === index)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const novos = itens.map((item) => item.id === id
      ? {
          ...item,
          transportadorasRealizado: limpos,
          transportadoraSistema: limpos.join(' | '),
          atualizadoEm: new Date().toISOString(),
        }
      : item);
    persistir(novos);
  }

  function toggleVinculo(id, nome, checked) {
    const item = itens.find((row) => row.id === id);
    if (!item) return;
    const atuais = Array.isArray(item.transportadorasRealizado) ? item.transportadorasRealizado : [];
    if (checked) setVinculosItem(id, [...atuais, nome]);
    else setVinculosItem(id, atuais.filter((atual) => normalizarTextoReajuste(atual) !== normalizarTextoReajuste(nome)));
  }

  async function carregarNomesRealizado(exibirMensagem = true) {
    if (exibirMensagem) {
      setCarregando(true);
      setErro('');
      setMensagem('Carregando nomes de transportadoras do Realizado Local...');
    }
    try {
      const { rows } = await exportarRealizadoLocal({}, { limit: 500000 });
      const nomes = nomesUnicosRealizado(rows || []);
      setOpcoesRealizado(nomes);
      if (exibirMensagem) setMensagem(`Transportadoras carregadas do Realizado Local: ${nomes.length.toLocaleString('pt-BR')} nome(s).`);
      return nomes;
    } catch (error) {
      if (exibirMensagem) setErro(error.message || 'Erro ao carregar transportadoras do Realizado Local.');
      return [];
    } finally {
      if (exibirMensagem) setCarregando(false);
    }
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
      let nomes = opcoesRealizado;
      if (!nomes.length) nomes = await carregarNomesRealizado(false);
      const comVinculo = aplicarVinculoAutomatico(resultado.itens, nomes.map((item) => item.nome));
      persistir(comVinculo);
      setVinculoAbertoId(null);
      setMensagem(`Importado da aba ${resultado.sheetName}: ${resultado.total.toLocaleString('pt-BR')} reajuste(s). Vínculo agora usa os nomes do Realizado Local. Revise e marque mais de uma transportadora quando necessário.`);
    } catch (error) {
      setErro(error.message || 'Erro ao importar controle de reajustes.');
    } finally {
      setCarregando(false);
    }
  }

  async function tentarVincular() {
    let nomes = opcoesRealizado;
    if (!nomes.length) nomes = await carregarNomesRealizado(false);
    const novos = aplicarVinculoAutomatico(itens, nomes.map((item) => item.nome));
    persistir(novos);
    setVinculoAbertoId(null);
    setMensagem('Vínculo automático atualizado com base nos nomes do Realizado Local. Revise os casos que ficaram sem vínculo ou com mais de uma opção possível.');
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
      const calculados = calcularImpactosReajustes(itens, rows || [], config);
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
    const semVinculo = linhasRelatorio(itens.filter((item) => !(item.transportadorasRealizado || []).length), config.fim);
    const resumoRows = [{
      Periodo_Inicial: config.inicio || 'Todos',
      Periodo_Final: config.fim || 'Todos',
      Reajustes: itens.length,
      Efetivados: efetivados.length,
      Sem_Vinculo: semVinculo.length,
      Frete_Base_Periodo: resumo.freteBase,
      Impacto_Previsto_Periodo: resumo.impactoTotal,
      Impacto_Previsto_Efetivado: resumo.impactoEfetivado,
      Frete_Realizado_Apos_Inicio: resumo.freteRealizadoReajuste,
      Impacto_Realizado_Apos_Inicio: resumo.impactoRealizado,
      Impacto_Realizado_Efetivado: resumo.impactoRealizadoEfetivado,
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
    setVinculoAbertoId(null);
    setMensagem('Controle de reajustes limpo.');
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="amd-mini-brand">AMD Log • Reajustes</div>
        <h1>Controle de reajustes</h1>
        <p>Importe a aba Final da planilha, vincule com as transportadoras do Realizado Local e calcule o impacto pelo período realizado.</p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {mensagem ? <div className="sim-alert info">{mensagem}</div> : null}

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Importar controle e carregar nomes realizados</div>
            <p>Use a planilha de controle de reajustes. O vínculo é feito contra os nomes encontrados no Realizado Local, não contra o cadastro de tabelas.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={() => carregarNomesRealizado(true)} disabled={carregando}>Carregar nomes do Realizado</button>
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
        <div className="hint-box compact">
          Nomes disponíveis no Realizado Local: <strong>{opcoesRealizado.length.toLocaleString('pt-BR')}</strong>. Se uma transportadora aparece com variações, como ALFA, ALFA 2 e ALFA 3, marque todas no vínculo da linha.
        </div>
      </section>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Incluir reajuste manual</div>
            <p>Use quando surgir uma nova solicitação que ainda não está na planilha. Informe percentuais como 8%, 8 ou 8,5 — o sistema grava como percentual corretamente.</p>
          </div>
          <div className="actions-right">
            <button className="btn-primary" type="button" onClick={adicionarReajusteManual}>Adicionar reajuste</button>
          </div>
        </div>
        <div className="form-grid three">
          <label className="field">Transportadora
            <input value={novoReajuste.transportadoraInformada} onChange={(event) => alterarNovo('transportadoraInformada', event.target.value)} placeholder="Ex.: ALFA" />
          </label>
          <label className="field">Canal
            <select value={novoReajuste.canal} onChange={(event) => alterarNovo('canal', event.target.value)}>
              <option value="">-</option>
              <option value="ATACADO">ATACADO</option>
              <option value="B2C">B2C</option>
              <option value="ATACADO E B2C">ATACADO E B2C</option>
            </select>
          </label>
          <label className="field">Status
            <select value={novoReajuste.status} onChange={(event) => alterarNovo('status', event.target.value)}>
              {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
        </div>
        <div className="form-grid three">
          <label className="field">Data início
            <input type="date" value={novoReajuste.dataInicio} onChange={(event) => alterarNovo('dataInicio', event.target.value)} />
          </label>
          <label className="field">Solicitado %
            <input value={novoReajuste.reajusteSolicitado} onChange={(event) => alterarNovo('reajusteSolicitado', event.target.value)} placeholder="Ex.: 10%" />
          </label>
          <label className="field">Aplicado %
            <input value={novoReajuste.reajusteAplicado} onChange={(event) => alterarNovo('reajusteAplicado', event.target.value)} placeholder="Ex.: 8%" />
          </label>
        </div>
        <label className="field">Observação
          <textarea value={novoReajuste.observacao} onChange={(event) => alterarNovo('observacao', event.target.value)} rows={2} placeholder="Histórico, condição, aprovação, motivo..." />
        </label>
      </section>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Impacto por período</div>
            <p>Escolha o período base para a previsão. O impacto previsto usa todo o período filtrado; o impacto realizado usa apenas CT-es a partir da data de início do reajuste até o fim do filtro.</p>
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
            <input value={filtroTexto} onChange={(event) => setFiltroTexto(event.target.value)} placeholder="Transportadora, vínculo, observação..." />
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
        <div className="summary-card"><span>Sem vínculo</span><strong>{resumo.semVinculo.toLocaleString('pt-BR')}</strong><small>Revisar nomes do realizado</small></div>
        <div className="summary-card"><span>Frete base período</span><strong>{formatarMoedaReajuste(resumo.freteBase)}</strong><small>Realizado Local vinculado</small></div>
        <div className="summary-card"><span>Impacto previsto</span><strong>{formatarMoedaReajuste(resumo.impactoTotal)}</strong><small>Base do período × reajuste</small></div>
        <div className="summary-card"><span>Impacto realizado</span><strong>{formatarMoedaReajuste(resumo.impactoRealizado)}</strong><small>Da data início até fim do filtro</small></div>
        <div className="summary-card"><span>Impacto efetivado</span><strong>{formatarMoedaReajuste(resumo.impactoEfetivado)}</strong><small>Somente aprovados/vigentes</small></div>
      </div>

      <section className="table-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Controle de vínculos e impacto</div>
            <p className="compact">Primeiro marque os nomes do Realizado Local para cada transportadora da planilha. Depois calcule o impacto.</p>
          </div>
          <span className="pill-soft">{itensFiltrados.length.toLocaleString('pt-BR')} linha(s)</span>
        </div>
        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Transportadora planilha</th>
                <th>Vínculo no Realizado Local</th>
                <th>Canal</th>
                <th>Status</th>
                <th>Data início</th>
                <th>Solicitado %</th>
                <th>Aplicado %</th>
                <th>CT-es base</th>
                <th>Frete base</th>
                <th>Impacto previsto</th>
                <th>Impacto realizado</th>
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
                    <VinculoRealizadoCell
                      item={item}
                      opcoesRealizado={opcoesRealizado}
                      busca={buscasVinculo[item.id] || ''}
                      aberto={vinculoAbertoId === item.id}
                      onEditar={() => setVinculoAbertoId(item.id)}
                      onConcluir={() => setVinculoAbertoId(null)}
                      onBusca={(valor) => alterarBuscaVinculo(item.id, valor)}
                      onToggle={(nome, checked) => toggleVinculo(item.id, nome, checked)}
                      onMarcar={(nomes) => setVinculosItem(item.id, [...(item.transportadorasRealizado || []), ...nomes])}
                      onLimpar={() => setVinculosItem(item.id, [])}
                    />
                  </td>
                  <td>{item.canal || '-'}</td>
                  <td>
                    <select value={item.status || ''} onChange={(event) => alterarItem(item.id, 'status', event.target.value)}>
                      <option value="">-</option>
                      {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </td>
                  <td><input type="date" value={String(item.dataInicio || '').slice(0, 10)} onChange={(event) => alterarItem(item.id, 'dataInicio', event.target.value)} /></td>
                  <td>
                    <input
                      style={{ minWidth: 92 }}
                      value={formatarPercentualInput(item.reajusteSolicitado)}
                      onChange={(event) => alterarPercentualItem(item.id, 'reajusteSolicitado', event.target.value)}
                      placeholder="Ex.: 10%"
                    />
                  </td>
                  <td>
                    <input
                      style={{ minWidth: 92 }}
                      value={formatarPercentualInput(item.reajusteAplicado)}
                      onChange={(event) => alterarPercentualItem(item.id, 'reajusteAplicado', event.target.value)}
                      placeholder="Ex.: 8%"
                    />
                  </td>
                  <td>{toNumber(item.ctesPeriodo).toLocaleString('pt-BR')}</td>
                  <td>{formatarMoedaReajuste(item.valorFretePeriodo)}</td>
                  <td><strong>{formatarMoedaReajuste(item.impactoPrevisto || item.impactoPeriodo)}</strong></td>
                  <td>
                    <strong>{formatarMoedaReajuste(item.impactoRealizado)}</strong>
                    {item.ctesRealizadoReajuste ? <small style={{ display: 'block', color: '#64748b' }}>{toNumber(item.ctesRealizadoReajuste).toLocaleString('pt-BR')} CT-e(s) após início</small> : null}
                  </td>
                  <td>{item.percentualFreteAtual ? formatarPercentualReajuste(item.percentualFreteAtual) : '-'}</td>
                  <td>{item.percentualFreteComReajuste ? formatarPercentualReajuste(item.percentualFreteComReajuste) : '-'}</td>
                  <td style={{ minWidth: 280 }}>
                    <textarea value={item.observacao || ''} onChange={(event) => alterarItem(item.id, 'observacao', event.target.value)} rows={2} />
                  </td>
                </tr>
              ))}
              {!itensFiltrados.length && <tr><td colSpan="14">Nenhum reajuste carregado ou compatível com o filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
