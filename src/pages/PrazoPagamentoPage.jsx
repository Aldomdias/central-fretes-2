import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { carregarPrazosPagamentoSupabase } from '../services/lotacaoSupabaseService';
import { CANAIS_PARAMETRIZAVEIS, definirCanalTransportadora } from '../services/canalTransportadoraService';
import { CANAL_A_DEFINIR } from '../utils/canalTransportadora';
import AmdProcessingOverlay from '../components/AmdProcessingOverlay';
import {
  normalizarLinhasPrazo,
  calcularIndicadores,
  agruparPor,
  evolucaoMensal,
  detectarPrazosAtipicos,
} from '../utils/prazoPagamentoEngine';

const SEM_CANAL = '__SEM_CANAL__';

function fmtMoeda(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDias(v) {
  if (v == null || !Number.isFinite(v)) return '-';
  return `${v.toFixed(1)} dias`;
}

function fmtData(v) {
  if (!v) return '-';
  const [y, m, d] = String(v).slice(0, 10).split('-');
  if (!y || !m || !d) return v;
  return `${d}/${m}/${y}`;
}

function CardIndicador({ label, valor, sub, destaque }) {
  return (
    <div className="summary-card" style={{ borderLeft: `4px solid ${destaque ? '#c0392b' : '#9153F0'}` }}>
      <span>{label}</span>
      <strong>{valor}</strong>
      {sub && <small style={{ display: 'block', opacity: 0.7 }}>{sub}</small>}
    </div>
  );
}

function TabelaAgrupada({ titulo, grupos, labelChave, campoFiltro, filtroAtivo, onFiltrar }) {
  const ativo = filtroAtivo && filtroAtivo.campo === campoFiltro ? filtroAtivo.valor : null;
  return (
    <div className="panel-card" style={{ marginTop: '1rem' }}>
      <div className="section-row compact-top">
        <div className="panel-title">{titulo}</div>
        {ativo && (
          <button className="btn-secondary" onClick={() => onFiltrar(campoFiltro, null)}>
            Limpar filtro: {ativo}
          </button>
        )}
      </div>
      <p className="compact" style={{ opacity: 0.7 }}>Clique em uma linha para filtrar as outras tabelas e os cards por esse recorte.</p>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>{labelChave}</th>
              <th>Qtd Faturas</th>
              <th>Qtd CT-es</th>
              <th>Valor Frete</th>
              <th>Prazo Fatura</th>
              <th>Prazo Real</th>
              <th>Diferença (dias)</th>
              <th>CT-es c/ emissão localizada</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => {
              // Usa a média ponderada por valor de frete quando possível; se o
              // grupo não tiver valor de frete lançado (valor_frete = 0), a
              // ponderação não tem denominador e cai para a média simples.
              const faturaUsouSimples = g.prazoFaturaPonderado == null && g.prazoFaturaSimples != null;
              const realUsouSimples = g.prazoRealPonderado == null && g.prazoRealSimples != null;
              const prazoFatura = g.prazoFaturaPonderado ?? g.prazoFaturaSimples;
              const prazoReal = g.prazoRealPonderado ?? g.prazoRealSimples;
              const dif = prazoReal != null && prazoFatura != null ? prazoReal - prazoFatura : null;
              return (
                <tr
                  key={g.chave}
                  onClick={() => onFiltrar(campoFiltro, g.chave === ativo ? null : g.chave)}
                  style={{ cursor: 'pointer', background: g.chave === ativo ? 'rgba(145,83,240,0.1)' : undefined }}
                >
                  <td>{g.chave}</td>
                  <td>{g.qtdFaturas}</td>
                  <td>{g.qtd}</td>
                  <td>{fmtMoeda(g.valorTotal)}</td>
                  <td>{fmtDias(prazoFatura)}{faturaUsouSimples && ' *'}</td>
                  <td>{fmtDias(prazoReal)}{realUsouSimples && ' *'}</td>
                  <td className={dif > 0 ? 'negativo' : ''}>{dif != null ? `+${dif.toFixed(1)}` : '-'}</td>
                  <td>{g.qtdComCte}/{g.qtd}</td>
                </tr>
              );
            })}
            {!grupos.length && (
              <tr>
                <td colSpan="8">Nenhum registro no período.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="compact" style={{ marginTop: '0.4rem', opacity: 0.7 }}>
        * Sem valor de frete lançado no período — prazo exibido é a média simples (não ponderada por valor).
      </p>
    </div>
  );
}

function TabelaPioresCasos({ linhas, limite = 25 }) {
  const piores = useMemo(
    () =>
      linhas
        .filter((l) => l.prazo_real != null)
        .slice()
        .sort((a, b) => b.prazo_real - a.prazo_real)
        .slice(0, limite),
    [linhas, limite]
  );

  return (
    <div className="panel-card" style={{ marginTop: '1rem' }}>
      <div className="panel-title">Piores Casos — CT-es com maior Prazo Real</div>
      <p className="compact" style={{ opacity: 0.7 }}>
        Top {limite} CT-es com maior tempo entre a emissão real e o vencimento da fatura, dentro do recorte
        ativo (clique numa linha das tabelas de canal/transportadora pra filtrar aqui também).
      </p>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Canal</th>
              <th>Transportadora</th>
              <th>Tomador</th>
              <th>Nº Fatura</th>
              <th>Nº CT-e</th>
              <th>Emissão CT-e</th>
              <th>Vencimento</th>
              <th>Prazo Real</th>
              <th>Gap Emissão</th>
              <th>Valor Frete</th>
            </tr>
          </thead>
          <tbody>
            {piores.map((l) => (
              <tr key={l.chave_cte || `${l.fatura_id}-${l.numero_cte}`} className="row-alert">
                <td>{l.canal || '-'}</td>
                <td>{l.transportadora || '-'}</td>
                <td>{l.nome_tomador || '-'}</td>
                <td>{l.numero_fatura || '-'}</td>
                <td>{l.numero_cte || '-'}</td>
                <td>{fmtData(l.data_emissao_cte)}</td>
                <td>{fmtData(l.data_vencimento)}</td>
                <td className="negativo">{fmtDias(l.prazo_real)}</td>
                <td>{l.gap_emissao != null ? `${l.gap_emissao} dias` : '-'}</td>
                <td>{fmtMoeda(l.valor_frete)}</td>
              </tr>
            ))}
            {!piores.length && (
              <tr>
                <td colSpan="10">Nenhum CT-e com emissão real localizada nesse recorte.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabelaPrazosAtipicos({ atipicos, excluidos, onAlternar, chaveLinha }) {
  return (
    <div className="panel-card" style={{ marginTop: '1rem' }}>
      <div className="panel-title">Possíveis Erros — Prazo Fatura fora do padrão da transportadora</div>
      <p className="compact" style={{ opacity: 0.7 }}>
        Para cada transportadora com prazo dominante (ex.: Pajuçara sempre com 28 dias), lista os CT-es cujo
        Prazo Fatura destoa desse padrão — provável lançamento errado (fatura devolvida/corrigida). Marque
        "Desconsiderar" para tirar do cálculo em todas as tabelas e cards.
      </p>
      <div className="sim-analise-tabela-wrap">
        <table className="sim-analise-tabela">
          <thead>
            <tr>
              <th>Desconsiderar</th>
              <th>Transportadora</th>
              <th>Padrão da transportadora</th>
              <th>Prazo desta fatura</th>
              <th>Desvio</th>
              <th>Nº Fatura</th>
              <th>Nº CT-e</th>
              <th>Emissão Fatura</th>
              <th>Vencimento</th>
              <th>Valor Frete</th>
            </tr>
          </thead>
          <tbody>
            {atipicos.map((l) => {
              const chave = chaveLinha(l);
              const marcado = excluidos.has(chave);
              return (
                <tr key={chave} className={marcado ? '' : 'row-alert'} style={marcado ? { opacity: 0.5 } : undefined}>
                  <td>
                    <input type="checkbox" checked={marcado} onChange={() => onAlternar(l)} />
                  </td>
                  <td>{l.transportadora || '-'}</td>
                  <td>{fmtDias(l.prazoTipico)} <small style={{ opacity: 0.6 }}>({l.qtdNoPadrao}/{l.totalTransportadora} CT-es)</small></td>
                  <td>{fmtDias(l.prazo_fatura)}</td>
                  <td className={l.desvio < 0 ? 'negativo' : ''}>{l.desvio > 0 ? '+' : ''}{l.desvio} dias</td>
                  <td>{l.numero_fatura || '-'}</td>
                  <td>{l.numero_cte || '-'}</td>
                  <td>{fmtData(l.data_emissao_fatura)}</td>
                  <td>{fmtData(l.data_vencimento)}</td>
                  <td>{fmtMoeda(l.valor_frete)}</td>
                </tr>
              );
            })}
            {!atipicos.length && (
              <tr>
                <td colSpan="10">Nenhum CT-e fora do padrão detectado nesse recorte.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function dataIso(d) {
  return d.toISOString().slice(0, 10);
}

// Sem período selecionado a base tem ~330 mil linhas — carregar tudo travaria
// a tela. Por padrão abrimos com os últimos 90 dias (dentro do período o
// resultado é sempre completo, sem corte); o usuário pode ampliar à vontade.
function periodoPadrao() {
  const fim = new Date();
  const inicio = new Date();
  inicio.setDate(inicio.getDate() - 90);
  return { dataInicio: dataIso(inicio), dataFim: dataIso(fim) };
}

export default function PrazoPagamentoPage() {
  const [carregando, setCarregando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [buscou, setBuscou] = useState(false);
  const [erro, setErro] = useState('');
  const [linhas, setLinhas] = useState([]);
  const [truncado, setTruncado] = useState(false);
  // Só o período dispara nova busca no banco (limita o volume trazido).
  const [filtros, setFiltros] = useState(periodoPadrao);
  const [filtroAtivo, setFiltroAtivo] = useState(null); // { campo, valor } — drill-down clicado nas tabelas
  const [somenteComCte, setSomenteComCte] = useState(false);
  // Transportadora/Tomador filtram a base já carregada, sem ir ao banco de novo.
  const [textoTransportadora, setTextoTransportadora] = useState('');
  const [textoTomador, setTextoTomador] = useState('');
  const [canalSelecionado, setCanalSelecionado] = useState('');
  const [aba, setAba] = useState('geral'); // 'geral' | 'analitico'
  const [excluidos, setExcluidos] = useState(() => new Set()); // chaves de CT-es marcados como erro
  const [importandoCanal, setImportandoCanal] = useState(false);
  const [progressoImportCanal, setProgressoImportCanal] = useState(null); // { feito, total }
  const [mensagemCanal, setMensagemCanal] = useState('');

  const carregar = async (f) => {
    setCarregando(true);
    setProgresso(null);
    setErro('');
    setFiltroAtivo(null);
    try {
      const { rows, truncado: cortado } = await carregarPrazosPagamentoSupabase({ ...f, onProgress: setProgresso });
      setLinhas(normalizarLinhasPrazo(rows));
      setTruncado(cortado);
      setBuscou(true);
    } catch (e) {
      setErro(e.message || String(e));
      setLinhas([]);
      setBuscou(true);
    } finally {
      setCarregando(false);
      setProgresso(null);
    }
  };

  // Identidade estável por CT-e — usada pra marcar exclusões manuais.
  const chaveLinha = (l) => l.chave_cte || `${l.fatura_id}|${l.numero_cte}`;

  const linhasBase = useMemo(() => {
    let base = somenteComCte ? linhas.filter((l) => l.prazo_real != null) : linhas;
    const buscaTransp = textoTransportadora.trim().toUpperCase();
    if (buscaTransp) base = base.filter((l) => (l.transportadora || '').toUpperCase().includes(buscaTransp));
    const buscaTomador = textoTomador.trim().toUpperCase();
    if (buscaTomador) base = base.filter((l) => (l.nome_tomador || '').toUpperCase().includes(buscaTomador));
    if (canalSelecionado === SEM_CANAL) {
      base = base.filter((l) => {
        const c = (l.canal || '').trim().toUpperCase();
        return !c || c === CANAL_A_DEFINIR;
      });
    } else if (canalSelecionado) {
      base = base.filter((l) => (l.canal || '').trim().toUpperCase() === canalSelecionado);
    }
    if (!filtroAtivo || !filtroAtivo.valor) return base;
    const campoLinha = {
      transportadora: 'transportadora',
      nome_tomador: 'nome_tomador',
      grupo_tomador: 'grupo_tomador',
      mes_emissao_cte: 'mes_emissao_cte',
      canal: 'canal',
    }[filtroAtivo.campo];
    return base.filter((l) => l[campoLinha] === filtroAtivo.valor);
  }, [linhas, filtroAtivo, somenteComCte, textoTransportadora, textoTomador, canalSelecionado]);

  const canaisDisponiveis = useMemo(() => {
    const set = new Set(
      linhas
        .map((l) => (l.canal || '').trim().toUpperCase())
        .filter((c) => c && c !== CANAL_A_DEFINIR)
    );
    return [...set].sort();
  }, [linhas]);

  // O que efetivamente entra nos cálculos — linhasBase menos o que foi
  // marcado como possível erro de lançamento na aba "Possíveis Erros".
  const linhasFiltradas = useMemo(
    () => (excluidos.size ? linhasBase.filter((l) => !excluidos.has(chaveLinha(l))) : linhasBase),
    [linhasBase, excluidos]
  );

  // Agrupa pelo nome como está em realizado_local_ctes (transportadora_cte) —
  // é esse nome que a função de definir canal usa pra casar e atualizar, e
  // pode divergir do nome que aparece na fatura (abreviação, pontuação etc.).
  // Usado só na exportação/importação do bloco "sem canal", pra garantir que
  // o nome exportado seja o que realmente vai bater na hora de salvar.
  const semCanalGrupos = useMemo(() => {
    if (canalSelecionado !== SEM_CANAL) return [];
    const grupos = new Map();
    linhasFiltradas.forEach((l) => {
      const chave = l.transportadora_cte || l.transportadora || '(sem transportadora)';
      if (!grupos.has(chave)) grupos.set(chave, { transportadora: chave, qtd: 0, valorTotal: 0 });
      const g = grupos.get(chave);
      g.qtd += 1;
      g.valorTotal += Number(l.valor_frete || 0);
    });
    return [...grupos.values()].sort((a, b) => b.qtd - a.qtd);
  }, [linhasFiltradas, canalSelecionado]);

  const prazosAtipicos = useMemo(() => detectarPrazosAtipicos(linhasBase), [linhasBase]);

  const aoFiltrar = (campo, valor) => setFiltroAtivo(valor ? { campo, valor } : null);

  const alternarExclusao = (l) => {
    const chave = chaveLinha(l);
    setExcluidos((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });
  };

  const indicadores = useMemo(() => calcularIndicadores(linhasFiltradas), [linhasFiltradas]);
  const porTransportadora = useMemo(() => agruparPor(linhasFiltradas, 'transportadora'), [linhasFiltradas]);
  const porTomador = useMemo(() => agruparPor(linhasFiltradas, 'nome_tomador'), [linhasFiltradas]);
  const porGrupoTomador = useMemo(() => agruparPor(linhasFiltradas, 'grupo_tomador'), [linhasFiltradas]);
  const porMes = useMemo(() => evolucaoMensal(linhasFiltradas), [linhasFiltradas]);
  const porCanal = useMemo(() => agruparPor(linhasFiltradas, 'canal'), [linhasFiltradas]);

  const gap = indicadores.prazoRealPonderado != null && indicadores.prazoFaturaPonderado != null
    ? indicadores.prazoRealPonderado - indicadores.prazoFaturaPonderado
    : null;

  const exportarExcel = () => {
    const wb = XLSX.utils.book_new();
    const linhasExport = linhasFiltradas.map((l) => ({
      'Nº Fatura': l.numero_fatura,
      'Nº CT-e': l.numero_cte,
      'Chave CT-e': l.chave_cte,
      Transportadora: l.transportadora,
      Tomador: l.nome_tomador,
      Canal: l.canal,
      'Valor Frete': l.valor_frete,
      'Emissão Fatura': l.data_emissao_fatura,
      'Emissão CT-e (real)': l.data_emissao_cte,
      Vencimento: l.data_vencimento,
      'Prazo Fatura (dias)': l.prazo_fatura,
      'Prazo Real (dias)': l.prazo_real,
      'Gap Emissão (dias)': l.gap_emissao,
    }));
    const ws = XLSX.utils.json_to_sheet(linhasExport);
    XLSX.utils.book_append_sheet(wb, ws, 'Detalhe');
    const wsResumo = XLSX.utils.json_to_sheet(
      [
        { Indicador: 'Qtd CT-es', Valor: indicadores.qtd },
        { Indicador: 'Valor Frete Total', Valor: indicadores.valorTotal },
        { Indicador: 'Prazo Fatura Ponderado (dias)', Valor: indicadores.prazoFaturaPonderado },
        { Indicador: 'Prazo Real Ponderado (dias)', Valor: indicadores.prazoRealPonderado },
        { Indicador: 'Gap Emissão x Prazo (dias)', Valor: gap },
      ]
    );
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');
    XLSX.writeFile(wb, `prazo-pagamento-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportarSemCanal = () => {
    const linhasExport = semCanalGrupos
      .filter((g) => g.transportadora !== '(sem transportadora)')
      .map((g) => ({
        Transportadora: g.transportadora,
        'Qtd CT-es': g.qtd,
        'Valor Frete': g.valorTotal,
        Canal: '',
      }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(linhasExport);
    XLSX.utils.book_append_sheet(wb, ws, 'SemCanal');
    XLSX.writeFile(wb, `transportadoras-sem-canal-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const importarCanalPlanilha = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      setImportandoCanal(true);
      setErro('');
      setMensagemCanal('');
      try {
        const workbook = XLSX.read(ev.target.result, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const linhasImport = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        const validas = linhasImport
          .map((l) => ({
            transportadora: String(l.Transportadora || l.transportadora || '').trim(),
            canal: String(l.Canal || l.canal || '').trim().toUpperCase(),
          }))
          .filter((l) => l.transportadora && CANAIS_PARAMETRIZAVEIS.includes(l.canal));
        if (!validas.length) {
          setErro('Nenhuma linha válida na planilha — preencha a coluna Canal com ATACADO, B2C, INTERCOMPANY ou REVERSA.');
          return;
        }
        let ok = 0;
        const falhas = [];
        setProgressoImportCanal({ feito: 0, total: validas.length });
        for (let i = 0; i < validas.length; i += 1) {
          const item = validas[i];
          try {
            await definirCanalTransportadora({ transportadora: item.transportadora, canal: item.canal });
            ok += 1;
          } catch (err) {
            falhas.push(`${item.transportadora}: ${err.message || 'erro desconhecido'}`);
          }
          setProgressoImportCanal({ feito: i + 1, total: validas.length });
        }
        setMensagemCanal(
          `Canal aplicado para ${ok}/${validas.length} transportadora(s).${falhas.length ? ` Falhas: ${falhas.join(' | ')}` : ''}`
        );
        await carregar(filtros);
      } catch (err) {
        setErro(err.message || String(err));
      } finally {
        setImportandoCanal(false);
        setProgressoImportCanal(null);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div>
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Controle de Prazos de Pagamento</div>
          <p className="compact">
            Prazo Fatura = Vencimento − Emissão da Fatura. Prazo Real = Vencimento − Emissão do CT-e
            (data em que a transportadora efetivamente emitiu o documento, após a entrega da carga).
          </p>
        </div>
        <button className="btn-secondary" onClick={exportarExcel} disabled={!linhasFiltradas.length}>
          Exportar Excel
        </button>
      </div>

      <div className="panel-card" style={{ marginTop: '1rem' }}>
        <p className="compact" style={{ opacity: 0.7, marginBottom: '0.5rem' }}>
          Período sugerido: últimos 90 dias. Ajuste as datas e clique em Buscar — dentro do período
          selecionado o resultado é completo; se houver corte por volume, aparece um aviso vermelho acima dos
          cards.
        </p>
        <div className="filtros-row" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="compact">Emissão fatura — de</label>
            <input
              className="field"
              type="date"
              value={filtros.dataInicio}
              onChange={(e) => setFiltros((f) => ({ ...f, dataInicio: e.target.value }))}
            />
          </div>
          <div>
            <label className="compact">até</label>
            <input
              className="field"
              type="date"
              value={filtros.dataFim}
              onChange={(e) => setFiltros((f) => ({ ...f, dataFim: e.target.value }))}
            />
          </div>
          <div>
            <label className="compact">Transportadora (instantâneo)</label>
            <input
              className="field"
              placeholder="Filtrar transportadora..."
              value={textoTransportadora}
              onChange={(e) => setTextoTransportadora(e.target.value)}
            />
          </div>
          <div>
            <label className="compact">Tomador (instantâneo)</label>
            <input
              className="field"
              placeholder="Filtrar tomador... ex: GP"
              value={textoTomador}
              onChange={(e) => setTextoTomador(e.target.value)}
            />
          </div>
          <div>
            <label className="compact">Canal</label>
            <select className="field" value={canalSelecionado} onChange={(e) => setCanalSelecionado(e.target.value)}>
              <option value="">Todos</option>
              {canaisDisponiveis.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              <option value={SEM_CANAL}>(sem canal)</option>
            </select>
          </div>
          <button className="btn-primary" onClick={() => carregar(filtros)} disabled={carregando}>
            {carregando ? 'Buscando...' : 'Buscar'}
          </button>
          <label className="compact" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
            <input
              type="checkbox"
              checked={somenteComCte}
              onChange={(e) => setSomenteComCte(e.target.checked)}
            />
            Somente CT-es com emissão localizada
          </label>
        </div>
      </div>

      {erro && <div className="hint-box compact" style={{ color: '#c0392b' }}>{erro}</div>}

      {truncado && (
        <div className="hint-box compact" style={{ marginTop: '0.75rem', color: '#c0392b', fontWeight: 600 }}>
          ⚠ O período selecionado tem mais CT-es do que o limite de segurança da consulta — os números acima
          NÃO representam o total. Estreite o período (Emissão fatura — de/até) até este aviso sumir antes
          de usar os dados para qualquer decisão ou apresentação.
        </div>
      )}

      {canalSelecionado === SEM_CANAL && buscou && !carregando && (
        <div className="hint-box compact" style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{semCanalGrupos.length} transportadora(s) sem canal neste filtro.</strong>
          <span>Exporte, preencha a coluna Canal e importe de volta pra aplicar em massa:</span>
          <button className="btn-secondary" onClick={exportarSemCanal} disabled={!semCanalGrupos.length}>
            Exportar planilha
          </button>
          <label className="btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
            {importandoCanal
              ? `Importando... ${progressoImportCanal ? `${progressoImportCanal.feito}/${progressoImportCanal.total}` : ''}`
              : 'Importar planilha'}
            <input type="file" accept=".xlsx,.xls" onChange={importarCanalPlanilha} disabled={importandoCanal} style={{ display: 'none' }} />
          </label>
          {mensagemCanal && <span>{mensagemCanal}</span>}
          <span style={{ width: '100%', opacity: 0.7 }}>
            Se o CT-e não tiver sido localizado (coluna "CT-es c/ emissão localizada" = 0), definir o canal
            aqui não resolve sozinho — nesses casos falta localizar o CT-e na base, não classificar o canal.
          </span>
        </div>
      )}

      {filtroAtivo && (
        <div className="hint-box compact" style={{ marginTop: '0.75rem' }}>
          Recorte ativo: <strong>{filtroAtivo.valor}</strong>
          <button className="btn-secondary" style={{ marginLeft: '0.75rem' }} onClick={() => setFiltroAtivo(null)}>
            Limpar
          </button>
        </div>
      )}

      {excluidos.size > 0 && (
        <div className="hint-box compact" style={{ marginTop: '0.75rem' }}>
          {excluidos.size} CT-e(s) desconsiderado(s) por prazo fora do padrão (aba Visão Analítica).
          <button className="btn-secondary" style={{ marginLeft: '0.75rem' }} onClick={() => setExcluidos(new Set())}>
            Restaurar todos
          </button>
        </div>
      )}

      {!buscou && !carregando && (
        <div className="hint-box compact" style={{ marginTop: '1rem' }}>
          Ajuste o período e os filtros acima e clique em <strong>Buscar</strong> para carregar os dados.
        </div>
      )}

      <AmdProcessingOverlay
        ativo={carregando}
        progresso={progresso}
        mensagemRodape="Buscando faturas e cruzando com o CT-e real. Pode levar mais tempo em períodos maiores."
      />

      {buscou && !carregando && (
        <>
          <div className="tabs-row" style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button className={aba === 'geral' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAba('geral')}>
              Visão Geral
            </button>
            <button className={aba === 'analitico' ? 'btn-primary' : 'btn-secondary'} onClick={() => setAba('analitico')}>
              Visão Analítica
            </button>
          </div>

          <div className="summary-cards-row" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
            <CardIndicador label="Faturas no período" valor={indicadores.qtdFaturas} />
            <CardIndicador label="CT-es no período" valor={indicadores.qtd} sub={`${indicadores.qtdComCte} com emissão real localizada`} />
            <CardIndicador label="Valor Frete Total" valor={fmtMoeda(indicadores.valorTotal)} />
            <CardIndicador
              label="Prazo Fatura — ponderado por Valor"
              valor={fmtDias(indicadores.prazoFaturaPonderado)}
              sub="Cada R$ de frete pesa igual"
            />
            <CardIndicador
              label="Prazo Fatura — ponderado por Qtd. CT-es"
              valor={fmtDias(indicadores.prazoFaturaSimples)}
              sub="Cada CT-e pesa igual"
            />
            <CardIndicador
              label="Prazo Real — ponderado por Valor"
              valor={fmtDias(indicadores.prazoRealPonderado)}
              sub="Cada R$ de frete pesa igual"
              destaque
            />
            <CardIndicador
              label="Prazo Real — ponderado por Qtd. CT-es"
              valor={fmtDias(indicadores.prazoRealSimples)}
              sub="Cada CT-e pesa igual"
              destaque
            />
            <CardIndicador
              label="Gap (Real − Fatura)"
              valor={gap != null ? `+${gap.toFixed(1)} dias` : '-'}
              sub="Atraso entre emitir o CT-e e lançar a fatura (Emissão Fatura − Emissão CT-e)"
              destaque
            />
          </div>
        </>
      )}

      {buscou && !carregando && aba === 'geral' && (
        <>
          <TabelaAgrupada
            titulo="Por Transportadora"
            grupos={porTransportadora}
            labelChave="Transportadora"
            campoFiltro="transportadora"
            filtroAtivo={filtroAtivo}
            onFiltrar={aoFiltrar}
          />
          <TabelaAgrupada
            titulo="Por Grupo de Tomador (CPX, ITR, GP...)"
            grupos={porGrupoTomador}
            labelChave="Grupo"
            campoFiltro="grupo_tomador"
            filtroAtivo={filtroAtivo}
            onFiltrar={aoFiltrar}
          />
          <TabelaAgrupada
            titulo="Por Tomador"
            grupos={porTomador}
            labelChave="Tomador"
            campoFiltro="nome_tomador"
            filtroAtivo={filtroAtivo}
            onFiltrar={aoFiltrar}
          />
          <TabelaAgrupada
            titulo="Evolução Mensal (mês de emissão do CT-e)"
            grupos={porMes}
            labelChave="Mês"
            campoFiltro="mes_emissao_cte"
            filtroAtivo={filtroAtivo}
            onFiltrar={aoFiltrar}
          />
        </>
      )}

      {buscou && !carregando && aba === 'analitico' && (
        <>
          <TabelaAgrupada
            titulo="Por Canal"
            grupos={porCanal}
            labelChave="Canal"
            campoFiltro="canal"
            filtroAtivo={filtroAtivo}
            onFiltrar={aoFiltrar}
          />
          <TabelaPioresCasos linhas={linhasFiltradas} limite={30} />
          <TabelaPrazosAtipicos
            atipicos={prazosAtipicos}
            excluidos={excluidos}
            onAlternar={alternarExclusao}
            chaveLinha={chaveLinha}
          />
        </>
      )}
    </div>
  );
}
