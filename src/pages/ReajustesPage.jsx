import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { exportarRealizadoLocal } from '../services/realizadoLocalDb';
import {
  carregarConfigReajustesSupabase,
  carregarReajustesSupabase,
  obterInfoReajustesSupabase,
  reajustesSupabaseConfigurado,
  salvarConfigReajustesSupabase,
  salvarReajustesSupabase,
} from '../services/reajustesSupabaseService';
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
  obterPeriodoConsultaImpactoReajustes,
  parsePercentReajuste,
  resumoReajustes,
  salvarConfigReajustes,
  salvarReajustes,
} from '../utils/reajustesLocal';

const STATUS_OPTIONS = ['EM ANÁLISE', 'ADIADO', 'APROVADO', 'EFETIVADO', 'NEGADO', 'PENDENTE', 'AGUARDANDO RETORNO'];
const CANAIS_OPTIONS = ['', 'ATACADO', 'B2C', 'ATACADO E B2C'];
const FORM_MANUAL_VAZIO = {
  transportadoraInformada: '',
  canal: '',
  dataInicio: '',
  reajusteSolicitado: '',
  reajusteAplicado: '',
  status: 'EM ANÁLISE',
  observacao: '',
};

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function percentualParaInput(value) {
  const n = toNumber(value);
  if (!n) return '';
  return (n * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function formatDate(value) {
  if (!value) return '-';
  const raw = String(value).slice(0, 10);
  const [y, m, d] = raw.split('-');
  if (y && m && d) return `${d}/${m}/${y}`;
  return raw;
}

function periodoLabel(inicio, fim) {
  const a = formatDate(inicio);
  const b = formatDate(fim);
  if (a === '-' && b === '-') return '-';
  return `${a} a ${b}`;
}

function safeSheetName(nome) {
  return String(nome || 'Planilha').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Planilha';
}

function aplicarFormato(ws, rows = []) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0] || {});
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
  ws['!cols'] = headers.map((header) => {
    if (/observ/i.test(header)) return { wch: 44 };
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
    const safeRows = rows || [];
    const ws = XLSX.utils.json_to_sheet(safeRows);
    aplicarFormato(ws, safeRows);
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
    Meses_Base_Auto: toNumber(item.mesesBaseImpacto || 3),
    Periodo_Base_Auto: periodoLabel(item.inicioImpactoBase, item.fimImpactoBase),
    Periodo_Realizado_Apos_Inicio: periodoLabel(item.inicioImpactoRealizado, item.fimImpactoRealizado),
    Reajuste_Solicitado: toNumber(item.reajusteSolicitado),
    Reajuste_Repassado_Aplicado: toNumber(item.reajusteAplicado),
    Reducao_Percentual_Reajuste: toNumber(item.percentualReducaoReajuste),
    Efetivado_No_Periodo: isEfetivado(item, fimPeriodo) ? 'Sim' : 'Não',
    CTEs_Base_Automatica: toNumber(item.ctesPeriodo),
    Frete_Base_Total: toNumber(item.valorFreteBaseTotal),
    Frete_Base_Medio_Mes: toNumber(item.valorFretePeriodo),
    Impacto_Previsto_Solicitado_Mes: toNumber(item.impactoPrevistoSolicitado),
    Impacto_Previsto_Repassado_Mes: toNumber(item.impactoPrevistoRepassado || item.impactoPrevisto || item.impactoPeriodo),
    Reducao_Impacto_Previsto_Mes: toNumber(item.reducaoImpactoPrevisto),
    CTEs_Realizado_Apos_Inicio: toNumber(item.ctesRealizadoReajuste),
    Dias_Realizados_Apos_Inicio: toNumber(item.diasRealizadosImpacto),
    Meses_Realizados_Equivalentes: toNumber(item.mesesRealizadosImpacto),
    Frete_Realizado_Total: toNumber(item.valorFreteRealizadoTotal),
    Frete_Realizado_Medio_Mes: toNumber(item.valorFreteRealizadoReajuste),
    Impacto_Realizado_Solicitado_Mes: toNumber(item.impactoRealizadoSolicitado),
    Impacto_Realizado_Repassado_Mes: toNumber(item.impactoRealizadoRepassado || item.impactoRealizado),
    Reducao_Impacto_Realizada_Mes: toNumber(item.reducaoImpactoRealizada),
    Impacto_Realizado_Repassado_Total: toNumber(item.impactoRealizadoTotalRepassado),
    Reducao_Impacto_Realizada_Total: toNumber(item.reducaoImpactoRealizadaTotal),
    Valor_NF_Base_Medio_Mes: toNumber(item.valorNFPeriodo),
    Valor_NF_Realizado_Medio_Mes: toNumber(item.valorNFRealizadoReajuste),
    Percentual_Frete_Base: toNumber(item.percentualFreteAtual),
    Percentual_Frete_Realizado: toNumber(item.percentualFreteRealizadoReajuste),
    Variacao_Percentual_Frete_pontos: toNumber(item.variacaoPercentualFreteRealizado),
    Observacao: item.observacao || '',
  }));
}

function linhasPreenchimentoReajustes(itens = []) {
  return (itens || []).map((item) => ({
    ID_Sistema: item.id || '',
    Transportadora: item.transportadoraInformada || '',
    Canal: item.canal || '',
    Status: item.status || '',
    Data_Inicio: String(item.dataInicio || '').slice(0, 10),
    'Reajuste_Solicitado_%': toNumber(item.reajusteSolicitado),
    'Reajuste_Aplicado_%': toNumber(item.reajusteAplicado),
    Vinculo_Realizado: (item.transportadorasRealizado || []).join(' | '),
    Observacao: item.observacao || '',
  }));
}

function normalizarChavePlanilha(value = '') {
  return normalizarTextoReajuste(value).replace(/\s+/g, '');
}

function pickPlanilha(row = {}, ...nomes) {
  const mapa = new Map(Object.keys(row || {}).map((key) => [normalizarChavePlanilha(key), key]));
  for (const nome of nomes) {
    const key = mapa.get(normalizarChavePlanilha(nome));
    if (key !== undefined) return row[key];
  }
  return '';
}

function dataPlanilhaParaIso(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const raw = String(value || '').trim();
  const iso = raw.match(/^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const br = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})/);
  if (br) return `${br[3]}-${String(br[2]).padStart(2, '0')}-${String(br[1]).padStart(2, '0')}`;
  return raw.slice(0, 10);
}

function separarVinculos(value = '') {
  return String(value || '')
    .split('|')
    .map((nome) => nome.trim())
    .filter(Boolean)
    .filter((nome, index, arr) => arr.findIndex((outro) => normalizarTextoReajuste(outro) === normalizarTextoReajuste(nome)) === index);
}

function parecePreenchimentoSimplificado(rows = []) {
  if (!rows.length) return false;
  const headers = Object.keys(rows[0] || {}).map(normalizarChavePlanilha);
  return headers.includes('IDSISTEMA')
    || (headers.includes('TRANSPORTADORA') && headers.some((header) => header.includes('REAJUSTEAPLICADO')))
    || (headers.includes('TRANSPORTADORA') && headers.includes('DATAINICIO') && headers.includes('STATUS'));
}

function linhaPreenchimentoParaDados(row = {}) {
  const transportadora = String(pickPlanilha(row, 'Transportadora', 'Transportadora_Informada') || '').trim();
  const canal = String(pickPlanilha(row, 'Canal') || '').trim();
  const status = String(pickPlanilha(row, 'Status', 'Negociação', 'Negociacao') || '').trim();
  const dataInicio = dataPlanilhaParaIso(pickPlanilha(row, 'Data_Inicio', 'Data Inicio', 'Data início', 'Inicio'));
  const reajusteSolicitado = parsePercentReajuste(pickPlanilha(row, 'Reajuste_Solicitado_%', 'Solicitado_%', 'Solicitado', 'Reajuste Solicitado'));
  const reajusteAplicado = parsePercentReajuste(pickPlanilha(row, 'Reajuste_Aplicado_%', 'Aplicado_%', 'Aplicado', 'Proposta Final', 'Reajuste Aplicado'));
  const vinculos = separarVinculos(pickPlanilha(row, 'Vinculo_Realizado', 'Vínculo_Realizado', 'Vinculos_Realizado', 'Vínculos_Realizado'));
  const observacao = String(pickPlanilha(row, 'Observacao', 'Observação', 'Obs') || '').trim();

  return {
    id: String(pickPlanilha(row, 'ID_Sistema', 'ID Sistema', 'Id') || '').trim(),
    transportadora,
    canal,
    status,
    dataInicio,
    reajusteSolicitado,
    reajusteAplicado,
    vinculos,
    observacao,
  };
}

function atualizarReajustesComPreenchimento(itensAtuais = [], rows = []) {
  const itens = [...(itensAtuais || [])];
  const porId = new Map(itens.map((item, index) => [String(item.id || ''), index]).filter(([id]) => id));
  const porNomeCanal = new Map();
  itens.forEach((item, index) => {
    const chave = `${normalizarTextoReajuste(item.transportadoraInformada)}|${normalizarTextoReajuste(item.canal)}`;
    if (!porNomeCanal.has(chave)) porNomeCanal.set(chave, index);
  });

  let atualizados = 0;
  let criados = 0;
  let ignorados = 0;

  rows.forEach((row) => {
    const dados = linhaPreenchimentoParaDados(row);
    if (!dados.id && !dados.transportadora) {
      ignorados += 1;
      return;
    }

    const chaveNomeCanal = `${normalizarTextoReajuste(dados.transportadora)}|${normalizarTextoReajuste(dados.canal)}`;
    const index = porId.has(dados.id) ? porId.get(dados.id) : porNomeCanal.get(chaveNomeCanal);

    if (index !== undefined && itens[index]) {
      const atual = itens[index];
      itens[index] = {
        ...atual,
        transportadoraInformada: dados.transportadora || atual.transportadoraInformada,
        canal: dados.canal,
        status: dados.status || atual.status,
        dataInicio: dados.dataInicio,
        reajusteSolicitado: dados.reajusteSolicitado,
        reajusteSolicitadoTexto: dados.reajusteSolicitado ? `${(dados.reajusteSolicitado * 100).toLocaleString('pt-BR')}%` : '',
        reajusteAplicado: dados.reajusteAplicado,
        propostaFinal: dados.reajusteAplicado,
        transportadorasRealizado: dados.vinculos,
        transportadoraSistema: dados.vinculos.join(' | '),
        observacao: dados.observacao,
        atualizadoEm: new Date().toISOString(),
      };
      atualizados += 1;
      return;
    }

    if (!dados.transportadora) {
      ignorados += 1;
      return;
    }

    const novo = criarReajusteManual({
      transportadoraInformada: dados.transportadora,
      canal: dados.canal,
      dataInicio: dados.dataInicio,
      reajusteSolicitado: dados.reajusteSolicitado,
      reajusteAplicado: dados.reajusteAplicado,
      status: dados.status || 'EM ANÁLISE',
      observacao: dados.observacao,
    });
    novo.transportadorasRealizado = dados.vinculos;
    novo.transportadoraSistema = dados.vinculos.join(' | ');
    itens.push(novo);
    porId.set(novo.id, itens.length - 1);
    porNomeCanal.set(chaveNomeCanal, itens.length - 1);
    criados += 1;
  });

  return { itens, atualizados, criados, ignorados };
}

function lerWorkbookParaJson(wb, preferencia = []) {
  const nomesNormalizados = new Map(wb.SheetNames.map((name) => [normalizarChavePlanilha(name), name]));
  const sheetName = preferencia
    .map((name) => nomesNormalizados.get(normalizarChavePlanilha(name)))
    .find(Boolean) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  return {
    sheetName,
    rows: XLSX.utils.sheet_to_json(ws, { defval: '', raw: true }),
  };
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
  if (!texto) return opcoes.slice(0, 25);

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
    .slice(0, 25);
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

function atualizarPercentualTemporario(setPercentuais, id, campo, valor) {
  setPercentuais((prev) => ({
    ...prev,
    [id]: {
      ...(prev[id] || {}),
      [campo]: valor,
    },
  }));
}

function PainelVinculo({
  item,
  opcoesRealizado,
  busca,
  onBusca,
  onToggle,
  onMarcar,
  onLimpar,
  onFechar,
}) {
  if (!item) return null;

  const selecionadas = Array.isArray(item.transportadorasRealizado) ? item.transportadorasRealizado : [];
  const selecionadasNorm = new Set(selecionadas.map(normalizarTextoReajuste));
  const sugestoes = detectarMelhoresVinculos(item.transportadoraInformada, opcoesRealizado.map((opcao) => opcao.nome), 10);
  const opcoes = filtrarOpcoesRealizado(opcoesRealizado, busca, item.transportadoraInformada);
  const resumo = resumoVinculosSelecionados(selecionadas, opcoesRealizado);

  return (
    <section className="panel-card" style={{ border: '2px solid #0b1f52' }}>
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Editar vínculo no Realizado Local</div>
          <p className="compact">
            Transportadora da planilha: <strong>{item.transportadoraInformada}</strong>. Marque uma ou mais variações do nome usado na base realizada.
          </p>
        </div>
        <div className="actions-right gap-row">
          <button type="button" className="btn-secondary" onClick={onLimpar} disabled={!selecionadas.length}>Limpar vínculo</button>
          <button type="button" className="btn-primary" onClick={onFechar}>Concluir vínculo</button>
        </div>
      </div>

      <div className="summary-strip lotacao-summary-mini">
        <div className="summary-card"><span>Selecionados</span><strong>{selecionadas.length.toLocaleString('pt-BR')}</strong><small>nomes do realizado</small></div>
        <div className="summary-card"><span>CT-es vinculados</span><strong>{resumo.ctes.toLocaleString('pt-BR')}</strong><small>base realizada total</small></div>
        <div className="summary-card"><span>Frete vinculado</span><strong>{formatarMoedaReajuste(resumo.frete)}</strong><small>base realizada total</small></div>
      </div>

      <div className="form-grid two">
        <label className="field">Buscar no Realizado Local
          <input
            value={busca || ''}
            onChange={(event) => onBusca(event.target.value)}
            placeholder="Ex.: ALFA, TRANSLOVATO, JAD..."
            autoFocus
          />
        </label>
        <div className="field">
          <span>Selecionados</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minHeight: 42, alignItems: 'center' }}>
            {selecionadas.length
              ? selecionadas.map((nome) => <span key={nome} className="pill-soft">{nome}</span>)
              : <span className="pill-soft">Sem vínculo realizado</span>}
          </div>
        </div>
      </div>

      {sugestoes.length > 0 && (
        <div className="hint-box compact">
          <strong>Sugestões rápidas: </strong>
          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            {sugestoes.map((nome) => (
              <button key={nome} type="button" className="btn-secondary" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => onToggle(nome, true)}>
                + {nome}
              </button>
            ))}
          </span>
        </div>
      )}

      <div className="actions-right top-space-sm">
        <button type="button" className="btn-secondary" onClick={() => onMarcar(opcoes.map((opcao) => opcao.nome))} disabled={!opcoes.length}>
          Marcar todos filtrados
        </button>
      </div>

      <div className="sim-analise-tabela-wrap top-space-sm" style={{ maxHeight: 360 }}>
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Usar</th>
              <th>Nome no Realizado Local</th>
              <th>CT-es</th>
              <th>Frete realizado</th>
            </tr>
          </thead>
          <tbody>
            {opcoes.map((opcao) => {
              const checked = selecionadasNorm.has(normalizarTextoReajuste(opcao.nome));
              return (
                <tr key={opcao.nome}>
                  <td>
                    <input type="checkbox" checked={checked} onChange={(event) => onToggle(opcao.nome, event.target.checked)} />
                  </td>
                  <td><strong>{opcao.nome}</strong></td>
                  <td>{opcao.ctes.toLocaleString('pt-BR')}</td>
                  <td>{formatarMoedaReajuste(opcao.frete)}</td>
                </tr>
              );
            })}
            {!opcoes.length && <tr><td colSpan="4">Nenhum nome encontrado na base realizada local.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResumoVinculoLinha({ item, opcoesRealizado, onEditar }) {
  const selecionadas = Array.isArray(item.transportadorasRealizado) ? item.transportadorasRealizado : [];
  const resumo = resumoVinculosSelecionados(selecionadas, opcoesRealizado);

  return (
    <div style={{ minWidth: 280, display: 'grid', gap: 6 }}>
      {selecionadas.length ? (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {selecionadas.slice(0, 3).map((nome) => <span key={nome} className="pill-soft">{nome}</span>)}
            {selecionadas.length > 3 && <span className="pill-soft">+{selecionadas.length - 3}</span>}
          </div>
          <small style={{ color: '#64748b' }}>
            {selecionadas.length.toLocaleString('pt-BR')} vínculo(s) • {resumo.ctes.toLocaleString('pt-BR')} CT-e(s) • {formatarMoedaReajuste(resumo.frete)}
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
  const [vinculoAtivoId, setVinculoAtivoId] = useState(null);
  const [percentuaisEditando, setPercentuaisEditando] = useState({});
  const [mostrarManual, setMostrarManual] = useState(false);
  const [manual, setManual] = useState(FORM_MANUAL_VAZIO);
  const [fontePersistencia, setFontePersistencia] = useState(() => reajustesSupabaseConfigurado() ? 'supabase' : 'local');
  const [persistenciaPronta, setPersistenciaPronta] = useState(false);
  const [sincronizandoSupabase, setSincronizandoSupabase] = useState(false);
  const [ultimoSyncSupabase, setUltimoSyncSupabase] = useState('');

  useEffect(() => {
    let cancelado = false;

    async function carregarPersistencia() {
      if (!reajustesSupabaseConfigurado()) {
        setFontePersistencia('local');
        setPersistenciaPronta(true);
        return;
      }

      setSincronizandoSupabase(true);
      setMensagem('Carregando controle de reajustes do Supabase...');
      setErro('');

      try {
        const [remotos, configRemota] = await Promise.all([
          carregarReajustesSupabase(),
          carregarConfigReajustesSupabase(),
        ]);
        if (cancelado) return;

        const locais = carregarReajustes();
        if (remotos.length) {
          setItens(remotos);
          if (configRemota?.inicio || configRemota?.fim) setConfig((prev) => ({ ...prev, ...configRemota }));
          setFontePersistencia('supabase');
          setUltimoSyncSupabase(new Date().toLocaleTimeString('pt-BR'));
          setMensagem(`Controle de reajustes carregado do Supabase: ${remotos.length.toLocaleString('pt-BR')} registro(s).`);
        } else if (locais.length) {
          await salvarReajustesSupabase(locais);
          await salvarConfigReajustesSupabase(configRemota || config);
          if (cancelado) return;
          setFontePersistencia('supabase');
          setUltimoSyncSupabase(new Date().toLocaleTimeString('pt-BR'));
          setMensagem(`Dados locais migrados para o Supabase: ${locais.length.toLocaleString('pt-BR')} registro(s).`);
        } else {
          if (configRemota?.inicio || configRemota?.fim) setConfig((prev) => ({ ...prev, ...configRemota }));
          setFontePersistencia('supabase');
          setUltimoSyncSupabase(new Date().toLocaleTimeString('pt-BR'));
          setMensagem('Controle de reajustes conectado ao Supabase. Nenhum registro salvo ainda.');
        }
      } catch (error) {
        if (!cancelado) {
          setFontePersistencia('local');
          setErro(error.message || 'Não foi possível carregar o controle de reajustes do Supabase. Mantive os dados locais deste navegador.');
        }
      } finally {
        if (!cancelado) {
          setSincronizandoSupabase(false);
          setPersistenciaPronta(true);
        }
      }
    }

    carregarPersistencia();
    carregarNomesRealizado(false).catch(() => {});

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    salvarConfigReajustes(config);
    if (!persistenciaPronta || fontePersistencia !== 'supabase') return undefined;

    const handle = window.setTimeout(() => {
      salvarConfigReajustesSupabase(config)
        .then(() => setUltimoSyncSupabase(new Date().toLocaleTimeString('pt-BR')))
        .catch((error) => setErro(error.message || 'Erro ao salvar configuração de reajustes no Supabase.'));
    }, 500);

    return () => window.clearTimeout(handle);
  }, [config, fontePersistencia, persistenciaPronta]);

  useEffect(() => {
    if (!persistenciaPronta || fontePersistencia !== 'supabase') return undefined;

    const handle = window.setTimeout(() => {
      setSincronizandoSupabase(true);
      salvarReajustesSupabase(itens)
        .then(() => {
          setUltimoSyncSupabase(new Date().toLocaleTimeString('pt-BR'));
        })
        .catch((error) => {
          setErro(error.message || 'Erro ao salvar reajustes no Supabase.');
        })
        .finally(() => setSincronizandoSupabase(false));
    }, 700);

    return () => window.clearTimeout(handle);
  }, [itens, fontePersistencia, persistenciaPronta]);

  const resumo = useMemo(() => resumoReajustes(itens), [itens]);
  const itemVinculoAtivo = useMemo(() => itens.find((item) => item.id === vinculoAtivoId) || null, [itens, vinculoAtivoId]);

  const itensFiltrados = useMemo(() => {
    const texto = normalizarTextoReajuste(filtroTexto);
    return (itens || [])
      .filter((item) => !texto || normalizarTextoReajuste(`${item.transportadoraInformada} ${(item.transportadorasRealizado || []).join(' ')} ${item.observacao}`).includes(texto))
      .filter((item) => !filtroStatus || item.status === filtroStatus)
      .filter((item) => !somenteEfetivados || isEfetivado(item))
      .sort((a, b) => toNumber(b.impactoRealizado || b.impactoPrevisto || b.impactoPeriodo) - toNumber(a.impactoRealizado || a.impactoPrevisto || a.impactoPeriodo) || String(a.transportadoraInformada).localeCompare(String(b.transportadoraInformada), 'pt-BR'));
  }, [itens, filtroTexto, filtroStatus, somenteEfetivados]);

  function persistir(novos) {
    setItens(novos);
    salvarReajustes(novos);
  }

  function alterarItem(id, campo, valor) {
    const novos = itens.map((item) => item.id === id ? { ...item, [campo]: valor, atualizadoEm: new Date().toISOString() } : item);
    persistir(novos);
  }

  function salvarPercentualItem(id, campo, valorVisual) {
    const decimal = parsePercentReajuste(valorVisual);
    alterarItem(id, campo, decimal);
    setPercentuaisEditando((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [campo]: undefined,
      },
    }));
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
    setMensagem('Lendo planilha de reajustes...');
    try {
      const buffer = await arquivo.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
      const leitura = lerWorkbookParaJson(wb, ['Preenchimento', 'Atualizacao_Reajustes', 'Atualização_Reajustes']);

      if (parecePreenchimentoSimplificado(leitura.rows)) {
        const resultado = atualizarReajustesComPreenchimento(itens, leitura.rows);
        persistir(resultado.itens);
        setVinculoAtivoId(null);
        setMensagem(
          `Preenchimento simples importado da aba ${leitura.sheetName}: ${resultado.atualizados.toLocaleString('pt-BR')} atualizado(s), ${resultado.criados.toLocaleString('pt-BR')} novo(s)`
          + (resultado.ignorados ? ` e ${resultado.ignorados.toLocaleString('pt-BR')} linha(s) ignorada(s).` : '.')
        );
        return;
      }

      const resultado = await importarControleReajustes(arquivo);
      let nomes = opcoesRealizado;
      if (!nomes.length) nomes = await carregarNomesRealizado(false);
      const comVinculo = aplicarVinculoAutomatico(resultado.itens, nomes.map((item) => item.nome));
      persistir(comVinculo);
      setVinculoAtivoId(null);
      setMensagem(`Importado da aba ${resultado.sheetName}: ${resultado.total.toLocaleString('pt-BR')} reajuste(s). Agora revise os vínculos e calcule o impacto.`);
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
    setVinculoAtivoId(null);
    setMensagem('Vínculo automático atualizado com base nos nomes do Realizado Local.');
    setErro('');
  }

  async function calcularImpacto() {
    setCarregando(true);
    setErro('');
    const consulta = obterPeriodoConsultaImpactoReajustes(itens, config);
    if (!consulta.inicio) {
      setCarregando(false);
      setErro('Informe a Data_Inicio dos reajustes antes de calcular. O impacto agora é sempre automático pela data de início, sem período manual.');
      return;
    }

    setMensagem(`Buscando Realizado Local a partir de ${formatDate(consulta.inicio)}. O realizado será medido até a data mais recente encontrada na base.`);
    try {
      const { rows, totalCompativel, limit } = await exportarRealizadoLocal({
        inicio: consulta.inicio,
      }, { limit: 500000 });

      const calculados = calcularImpactosReajustes(itens, rows || [], config);
      persistir(calculados);
      const resumoCalculado = resumoReajustes(calculados);

      setMensagem(
        `Impacto calculado com ${Number(rows?.length || 0).toLocaleString('pt-BR')} CT-e(s). `
        + `Base prevista: média dos ${Number(config.mesesBaseImpacto || 3).toLocaleString('pt-BR')} mês(es) anteriores à Data_Inicio. `
        + `Realizado: da Data_Inicio até ${formatDate(resumoCalculado.ultimaDataRealizado) || 'a última data da base'}${totalCompativel > limit ? ' dentro do limite exportado' : ''}.`
      );
    } catch (error) {
      setErro(error.message || 'Erro ao calcular impacto pelo Realizado Local.');
    } finally {
      setCarregando(false);
    }
  }

  function exportarRelatorio() {
    const relatorio = linhasRelatorio(itens);
    const efetivados = linhasRelatorio(itens.filter((item) => isEfetivado(item)));
    const semVinculo = linhasRelatorio(itens.filter((item) => !(item.transportadorasRealizado || []).length));
    const resumoRows = [{
      Meses_Base_Automatica: toNumber(config.mesesBaseImpacto || 3),
      Realizado_Ate_Data_Mais_Recente_Base: resumo.ultimaDataRealizado || '',
      Reajustes: itens.length,
      Efetivados: efetivados.length,
      Sem_Vinculo: semVinculo.length,
      Frete_Base_Automatica: resumo.freteBase,
      Impacto_Previsto_Solicitado: resumo.impactoPrevistoSolicitado,
      Impacto_Previsto_Repassado: resumo.impactoTotal,
      Reducao_Impacto_Previsto: resumo.reducaoImpactoPrevisto,
      Frete_Realizado_Apos_Data_Inicio: resumo.freteRealizadoReajuste,
      Impacto_Realizado_Solicitado: resumo.impactoRealizadoSolicitado,
      Impacto_Realizado_Repassado: resumo.impactoRealizado,
      Reducao_Impacto_Realizada: resumo.reducaoImpactoRealizada,
      Impacto_Realizado_Efetivado: resumo.impactoRealizadoEfetivado,
      Reducao_Realizada_Efetivada: resumo.reducaoImpactoRealizadaEfetivada,
    }];

    baixarXlsx(`controle-reajustes-impacto-${new Date().toISOString().slice(0, 10)}.xlsx`, {
      Resumo: resumoRows,
      Controle_Reajustes: relatorio,
      Efetivados: efetivados,
      Sem_Vinculo: semVinculo,
    });
  }

  function exportarPreenchimento() {
    if (!itens.length) {
      setErro('Não há reajustes carregados para gerar o modelo de preenchimento.');
      return;
    }

    const preenchimento = linhasPreenchimentoReajustes(itens);
    const orientacao = [
      { Campo: 'ID_Sistema', Como_preencher: 'Não alterar. Essa coluna fica oculta e serve para atualizar o mesmo registro.', Obrigatorio: 'Sim' },
      { Campo: 'Transportadora', Como_preencher: 'Nome da transportadora. Pode ajustar o nome se necessário.', Obrigatorio: 'Sim' },
      { Campo: 'Canal', Como_preencher: 'ATACADO, B2C ou ATACADO E B2C.', Obrigatorio: 'Não' },
      { Campo: 'Status', Como_preencher: 'EM ANÁLISE, ADIADO, APROVADO, EFETIVADO, NEGADO, PENDENTE ou AGUARDANDO RETORNO.', Obrigatorio: 'Não' },
      { Campo: 'Data_Inicio', Como_preencher: 'Data de início no formato AAAA-MM-DD ou DD/MM/AAAA.', Obrigatorio: 'Não' },
      { Campo: 'Reajuste_Solicitado_%', Como_preencher: 'Digite 10%, 10 ou 0,10 para representar 10%.', Obrigatorio: 'Não' },
      { Campo: 'Reajuste_Aplicado_%', Como_preencher: 'Percentual aprovado/aplicado. Esse é o principal campo para atualizar.', Obrigatorio: 'Não' },
      { Campo: 'Vinculo_Realizado', Como_preencher: 'Use | para separar mais de um nome. Ex.: ALFA | ALFA TRANSPORTES.', Obrigatorio: 'Não' },
      { Campo: 'Observacao', Como_preencher: 'Observação da negociação.', Obrigatorio: 'Não' },
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(preenchimento);
    aplicarFormato(ws, preenchimento);
    ws['!cols'] = ws['!cols'] || [];
    ws['!cols'][0] = { ...(ws['!cols'][0] || {}), hidden: true, wch: 12 };
    XLSX.utils.book_append_sheet(wb, ws, 'Preenchimento');

    const wsOrientacao = XLSX.utils.json_to_sheet(orientacao);
    aplicarFormato(wsOrientacao, orientacao);
    XLSX.utils.book_append_sheet(wb, wsOrientacao, 'Orientacao');

    XLSX.writeFile(wb, `preenchimento-reajustes-${new Date().toISOString().slice(0, 10)}.xlsx`);
    setMensagem('Modelo simples exportado. Atualize os campos necessários e importe o mesmo arquivo para gravar as alterações.');
    setErro('');
  }

  function limparTudo() {
    if (!window.confirm('Deseja limpar o controle de reajustes local deste navegador?')) return;
    persistir([]);
    setVinculoAtivoId(null);
    setMensagem('Controle de reajustes limpo.');
  }

  function adicionarManual() {
    try {
      const novo = criarReajusteManual(manual);
      persistir([novo, ...itens]);
      setManual(FORM_MANUAL_VAZIO);
      setMostrarManual(false);
      setMensagem('Reajuste manual incluído. Agora faça o vínculo com o Realizado Local.');
      setErro('');
    } catch (error) {
      setErro(error.message || 'Erro ao incluir reajuste manual.');
    }
  }

  async function sincronizarSupabaseAgora() {
    if (!reajustesSupabaseConfigurado()) {
      setErro('Supabase não configurado. Confira as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
      return;
    }

    setSincronizandoSupabase(true);
    setErro('');
    setMensagem('Salvando controle de reajustes no Supabase...');

    try {
      await salvarReajustesSupabase(itens);
      await salvarConfigReajustesSupabase(config);
      const info = obterInfoReajustesSupabase();
      setFontePersistencia('supabase');
      setPersistenciaPronta(true);
      setUltimoSyncSupabase(new Date().toLocaleTimeString('pt-BR'));
      setMensagem(`Controle de reajustes salvo no Supabase${info.host ? ` (${info.host})` : ''}: ${itens.length.toLocaleString('pt-BR')} registro(s).`);
    } catch (error) {
      setErro(error.message || 'Erro ao salvar controle de reajustes no Supabase.');
    } finally {
      setSincronizandoSupabase(false);
    }
  }

  const vinculados = itens.filter((item) => (item.transportadorasRealizado || []).length).length;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="amd-mini-brand">AMD Log • Reajustes</div>
        <h1>Controle de reajustes</h1>
        <p>Gestão de solicitações, vínculos com o Realizado Local e cálculo de impacto previsto e realizado.</p>
      </div>

      {erro ? <div className="sim-alert error">{erro}</div> : null}
      {mensagem ? <div className="sim-alert info">{mensagem}</div> : null}

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Fluxo de trabalho</div>
            <p className="compact">A ferramenta fica mais fácil seguindo estes passos: carregar/importar, vincular nomes, calcular impacto e exportar relatório.</p>
          </div>
        </div>

        <div className="summary-strip lotacao-summary-mini">
          <div className="summary-card"><span>1. Registros</span><strong>{itens.length.toLocaleString('pt-BR')}</strong><small>importados ou manuais</small></div>
          <div className="summary-card"><span>2. Vínculos</span><strong>{vinculados.toLocaleString('pt-BR')}</strong><small>{resumo.semVinculo.toLocaleString('pt-BR')} sem vínculo</small></div>
          <div className="summary-card"><span>3. Frete base médio/mês</span><strong>{formatarMoedaReajuste(resumo.freteBase)}</strong><small>{toNumber(config.mesesBaseImpacto || 3)} mês(es) antes</small></div>
          <div className="summary-card"><span>4. Previsto repassado/mês</span><strong>{formatarMoedaReajuste(resumo.impactoTotal)}</strong><small>média base × aplicado</small></div>
          <div className="summary-card"><span>5. Saving previsto/mês</span><strong>{formatarMoedaReajuste(resumo.reducaoImpactoPrevisto)}</strong><small>solicitado - aplicado</small></div>
          <div className="summary-card"><span>6. Realizado repassado/mês</span><strong>{formatarMoedaReajuste(resumo.impactoRealizado)}</strong><small>mensalizado após início</small></div>
          <div className="summary-card"><span>7. Saving realizado/mês</span><strong>{formatarMoedaReajuste(resumo.reducaoImpactoRealizada)}</strong><small>solicitado - aplicado</small></div>
        </div>

        <div className="hint-box compact">
          <strong>Regra de cálculo:</strong> informe somente a Data_Inicio do reajuste. O previsto usa a média mensal dos meses anteriores à vigência. Ex.: início em 23/03 e base de 3 meses = frete de 23/12 a 22/03 dividido por 3. O realizado usa o volume da Data_Inicio até a data mais recente existente na base, mensaliza esse volume e calcula solicitado, repassado/aplicado e saving da negociação.
        </div>

        <div className="hint-box compact" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <strong>Persistência:</strong> {fontePersistencia === 'supabase' ? 'Supabase ativo' : 'Local deste navegador'}
            {ultimoSyncSupabase ? <span> • último sync {ultimoSyncSupabase}</span> : null}
            {sincronizandoSupabase ? <span> • salvando...</span> : null}
          </div>
          <button type="button" className="btn-secondary" onClick={sincronizarSupabaseAgora} disabled={sincronizandoSupabase}>
            {sincronizandoSupabase ? 'Salvando...' : 'Salvar no Supabase agora'}
          </button>
        </div>
      </section>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">1. Importar, atualizar ou incluir reajuste</div>
            <p>Importe a aba Final antiga ou use o modelo simples para atualizar apenas o que já está na tela.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={exportarPreenchimento} disabled={!itens.length || carregando}>
              Exportar preenchimento
            </button>
            <button className="btn-secondary" type="button" onClick={() => setMostrarManual((prev) => !prev)}>
              {mostrarManual ? 'Fechar inclusão manual' : 'Incluir reajuste manual'}
            </button>
            <button className="btn-secondary" type="button" onClick={() => carregarNomesRealizado(true)} disabled={carregando}>
              Atualizar nomes do Realizado
            </button>
            <button className="btn-danger" type="button" onClick={limparTudo} disabled={!itens.length || carregando}>
              Limpar controle
            </button>
          </div>
        </div>

        <div className="form-grid two">
          <label className="field">Planilha de reajustes
            <input type="file" accept=".xlsx,.xls,.xlsm" onChange={(event) => setArquivo(event.target.files?.[0] || null)} />
          </label>
          <div className="actions-right" style={{ alignItems: 'end' }}>
            <button className="btn-primary" type="button" onClick={importarArquivo} disabled={carregando || !arquivo}>
              {carregando ? 'Processando...' : 'Importar arquivo'}
            </button>
          </div>
        </div>

        <div className="hint-box compact" style={{ marginTop: 12 }}>
          <strong>Modelo simples:</strong> clique em <strong>Exportar preenchimento</strong>, altere status, data, percentual aplicado, vínculo ou observação e importe o mesmo arquivo. O sistema atualiza os registros pelo ID oculto, sem depender da planilha pesada anterior.
        </div>

        {mostrarManual && (
          <div className="hint-box" style={{ marginTop: 14 }}>
            <div className="form-grid three">
              <label className="field">Transportadora
                <input value={manual.transportadoraInformada} onChange={(event) => setManual((prev) => ({ ...prev, transportadoraInformada: event.target.value }))} placeholder="Ex.: ALFA" />
              </label>
              <label className="field">Canal
                <select value={manual.canal} onChange={(event) => setManual((prev) => ({ ...prev, canal: event.target.value }))}>
                  {CANAIS_OPTIONS.map((canal) => <option key={canal || 'todos'} value={canal}>{canal || 'Sem canal'}</option>)}
                </select>
              </label>
              <label className="field">Data início
                <input type="date" value={manual.dataInicio} onChange={(event) => setManual((prev) => ({ ...prev, dataInicio: event.target.value }))} />
              </label>
            </div>
            <div className="form-grid three">
              <label className="field">Solicitado %
                <input value={manual.reajusteSolicitado} onChange={(event) => setManual((prev) => ({ ...prev, reajusteSolicitado: event.target.value }))} placeholder="Ex.: 10%" />
              </label>
              <label className="field">Aplicado %
                <input value={manual.reajusteAplicado} onChange={(event) => setManual((prev) => ({ ...prev, reajusteAplicado: event.target.value }))} placeholder="Ex.: 5%" />
              </label>
              <label className="field">Status
                <select value={manual.status} onChange={(event) => setManual((prev) => ({ ...prev, status: event.target.value }))}>
                  {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
            </div>
            <label className="field">Observação
              <textarea value={manual.observacao} onChange={(event) => setManual((prev) => ({ ...prev, observacao: event.target.value }))} rows={2} placeholder="Ex.: negociação aprovada pela diretoria..." />
            </label>
            <div className="actions-right">
              <button type="button" className="btn-primary" onClick={adicionarManual}>Adicionar reajuste</button>
            </div>
          </div>
        )}
      </section>

      <section className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">2. Base automática, filtros e cálculo</div>
            <p>Informe a data de início em cada reajuste. O sistema busca automaticamente a base anterior e mede o realizado depois da vigência.</p>
          </div>
          <div className="actions-right gap-row">
            <button className="btn-secondary" type="button" onClick={tentarVincular} disabled={!itens.length || carregando}>Sugerir vínculos</button>
            <button className="btn-secondary" type="button" onClick={exportarRelatorio} disabled={!itens.length}>Exportar relatório</button>
            <button className="btn-primary" type="button" onClick={calcularImpacto} disabled={!itens.length || carregando}>
              {carregando ? 'Calculando...' : 'Calcular impacto'}
            </button>
          </div>
        </div>

        <div className="form-grid three">
          <label className="field">Base anterior para previsão
            <select value={String(config.mesesBaseImpacto || 3)} onChange={(event) => setConfig((prev) => ({ ...prev, mesesBaseImpacto: Number(event.target.value) }))}>
              <option value="1">1 mês anterior à vigência</option>
              <option value="2">2 meses anteriores à vigência</option>
              <option value="3">3 meses anteriores à vigência</option>
            </select>
          </label>
          <label className="field">Realizado até
            <input value={resumo.ultimaDataRealizado ? formatDate(resumo.ultimaDataRealizado) : 'Data mais recente da base'} readOnly />
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
          <div className="hint-box compact" style={{ margin: 0 }}>
            Sem período manual: cada linha usa sua própria Data_Inicio para formar a base anterior e medir o realizado.
          </div>
        </div>
      </section>

      <PainelVinculo
        item={itemVinculoAtivo}
        opcoesRealizado={opcoesRealizado}
        busca={buscasVinculo[vinculoAtivoId] || ''}
        onBusca={(valor) => alterarBuscaVinculo(vinculoAtivoId, valor)}
        onToggle={(nome, checked) => toggleVinculo(vinculoAtivoId, nome, checked)}
        onMarcar={(nomes) => setVinculosItem(vinculoAtivoId, [...(itemVinculoAtivo?.transportadorasRealizado || []), ...nomes])}
        onLimpar={() => setVinculosItem(vinculoAtivoId, [])}
        onFechar={() => setVinculoAtivoId(null)}
      />

      <section className="table-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">3. Gestão dos reajustes</div>
            <p className="compact">Edite percentuais em formato visual. Exemplo: digite 8, 8% ou 8,5. O sistema grava como percentual correto.</p>
          </div>
          <span className="pill-soft">{itensFiltrados.length.toLocaleString('pt-BR')} linha(s)</span>
        </div>

        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Transportadora</th>
                <th>Vínculo Realizado</th>
                <th>Status</th>
                <th>Início</th>
                <th>Solicitado %</th>
                <th>Aplicado %</th>
                <th>Período base</th>
                <th>CT-es base</th>
                <th>Frete base médio/mês</th>
                <th>Previsto solicitado/mês</th>
                <th>Previsto repassado/mês</th>
                <th>Saving previsto/mês</th>
                <th>Período realizado</th>
                <th>CT-es realizado</th>
                <th>Realizado solicitado/mês</th>
                <th>Realizado repassado/mês</th>
                <th>Saving realizado/mês</th>
                <th>% base</th>
                <th>% realizado</th>
                <th>Dif. p.p.</th>
                <th>Obs.</th>
              </tr>
            </thead>
            <tbody>
              {itensFiltrados.map((item) => {
                const edit = percentuaisEditando[item.id] || {};
                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.transportadoraInformada}</strong>
                      <small style={{ display: 'block', color: '#64748b' }}>{item.canal || 'Sem canal'}</small>
                    </td>
                    <td>
                      <ResumoVinculoLinha
                        item={item}
                        opcoesRealizado={opcoesRealizado}
                        onEditar={() => setVinculoAtivoId(item.id)}
                      />
                    </td>
                    <td>
                      <select value={item.status || ''} onChange={(event) => alterarItem(item.id, 'status', event.target.value)}>
                        <option value="">-</option>
                        {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </td>
                    <td>
                      <input type="date" value={String(item.dataInicio || '').slice(0, 10)} onChange={(event) => alterarItem(item.id, 'dataInicio', event.target.value)} />
                    </td>
                    <td>
                      <input
                        type="text"
                        style={{ minWidth: 90 }}
                        value={edit.reajusteSolicitado ?? percentualParaInput(item.reajusteSolicitado)}
                        onChange={(event) => atualizarPercentualTemporario(setPercentuaisEditando, item.id, 'reajusteSolicitado', event.target.value)}
                        onBlur={(event) => salvarPercentualItem(item.id, 'reajusteSolicitado', event.target.value)}
                        placeholder="Ex.: 10%"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        style={{ minWidth: 90, fontWeight: 700 }}
                        value={edit.reajusteAplicado ?? percentualParaInput(item.reajusteAplicado)}
                        onChange={(event) => atualizarPercentualTemporario(setPercentuaisEditando, item.id, 'reajusteAplicado', event.target.value)}
                        onBlur={(event) => salvarPercentualItem(item.id, 'reajusteAplicado', event.target.value)}
                        placeholder="Ex.: 5%"
                      />
                    </td>
                    <td>
                      {periodoLabel(item.inicioImpactoBase, item.fimImpactoBase)}
                      <small style={{ display: 'block', color: '#64748b' }}>{toNumber(item.mesesBaseImpacto || config.mesesBaseImpacto || 3)} mês(es)</small>
                    </td>
                    <td>{toNumber(item.ctesPeriodo).toLocaleString('pt-BR')}</td>
                    <td>{formatarMoedaReajuste(item.valorFretePeriodo)}</td>
                    <td>{formatarMoedaReajuste(item.impactoPrevistoSolicitado)}</td>
                    <td><strong>{formatarMoedaReajuste(item.impactoPrevistoRepassado || item.impactoPrevisto || item.impactoPeriodo)}</strong></td>
                    <td><strong>{formatarMoedaReajuste(item.reducaoImpactoPrevisto)}</strong></td>
                    <td>{periodoLabel(item.inicioImpactoRealizado || item.dataInicio, item.fimImpactoRealizado)}<small style={{ display: 'block', color: '#64748b' }}>{item.diasRealizadosImpacto ? `${toNumber(item.diasRealizadosImpacto).toLocaleString('pt-BR')} dia(s)` : ''}</small></td>
                    <td>{toNumber(item.ctesRealizadoReajuste).toLocaleString('pt-BR')}</td>
                    <td>{formatarMoedaReajuste(item.impactoRealizadoSolicitado)}</td>
                    <td><strong>{formatarMoedaReajuste(item.impactoRealizadoRepassado || item.impactoRealizado)}</strong></td>
                    <td><strong>{formatarMoedaReajuste(item.reducaoImpactoRealizada)}</strong></td>
                    <td>{item.percentualFreteAtual ? formatarPercentualReajuste(item.percentualFreteAtual) : '-'}</td>
                    <td>{item.percentualFreteRealizadoReajuste ? formatarPercentualReajuste(item.percentualFreteRealizadoReajuste) : '-'}</td>
                    <td>{item.variacaoPercentualFreteRealizado ? formatarPercentualReajuste(item.variacaoPercentualFreteRealizado) : '-'}</td>
                    <td style={{ minWidth: 280 }}>
                      <textarea value={item.observacao || ''} onChange={(event) => alterarItem(item.id, 'observacao', event.target.value)} rows={2} />
                    </td>
                  </tr>
                );
              })}
              {!itensFiltrados.length && <tr><td colSpan="21">Nenhum reajuste carregado ou compatível com o filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
