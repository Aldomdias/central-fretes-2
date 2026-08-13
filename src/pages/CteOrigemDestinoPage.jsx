import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { normalizarCanalOperacional } from '../utils/canalTransportadora';

const TABELA = 'realizado_local_ctes';
const BATCH_SIZE = 1000;
const CANAIS_FRACIONADO = ['ATACADO'];

function monthNow() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function competenciaParaIntervalo(competencia) {
  const [ano, mes] = String(competencia || '').split('-').map(Number);
  if (!ano || !mes) return { inicio: '', fim: '' };
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  return { inicio, fim };
}

function nomeCompetencia(competencia) {
  const [ano, mes] = String(competencia || '').split('-');
  if (!ano || !mes) return competencia || '';
  const nomes = ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const idx = Number(mes) - 1;
  return `${nomes[idx] || mes} de ${ano}`;
}

function fmt(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtN(v, casas = 0) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function fmtPct(v, casas = 1) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(casas).replace('.', ',')}%`;
}

function safeNumber(v) {
  let n = 0;
  if (v !== null && v !== undefined && v !== '') {
    if (typeof v === 'number') {
      n = v;
    } else {
      let text = String(v).trim().replace(/R\$|%/gi, '').replace(/\s+/g, '');
      const hasComma = text.includes(',');
      const hasDot = text.includes('.');
      if (hasComma && hasDot) text = text.replace(/\./g, '').replace(',', '.');
      else if (hasComma) text = text.replace(',', '.');
      else if (hasDot) {
        const parts = text.split('.');
        const pareceMilhar = parts.length > 1 && parts.slice(1).every((part) => part.length === 3);
        if (pareceMilhar) text = parts.join('');
      }
      n = Number(text.replace(/[^0-9.-]/g, ''));
    }
  }
  return Number.isFinite(n) ? n : 0;
}

function campo(row, ...chaves) {
  for (const k of chaves) {
    if (row?.[k] !== undefined && row?.[k] !== null && row?.[k] !== '') return row[k];
  }
  return '';
}

function getOrigemCidade(row) {
  return campo(row, 'cidade_origem', 'cidadeOrigem', 'origem') || 'Nao informado';
}

function getOrigemUf(row) {
  return campo(row, 'uf_origem', 'ufOrigem') || '-';
}

function getDestinoCidade(row) {
  return campo(row, 'cidade_destino', 'cidadeDestino', 'destino') || 'Nao informado';
}

function getDestinoUf(row) {
  return campo(row, 'uf_destino', 'ufDestino') || '-';
}

function getCanalNormalizado(row) {
  const canalBanco = campo(row, 'canal');
  if (canalBanco) return normalizarCanalOperacional(canalBanco, { permitirInferencia: false });
  const original = campo(row, 'canal_original', 'canalOriginal', 'canal_vendas', 'canalVendas', 'canais');
  return original ? normalizarCanalOperacional(original, { permitirInferencia: false }) : '';
}

function getValorCte(row) {
  return safeNumber(campo(row, 'valor_cte', 'valorCte', 'valor_frete', 'frete'));
}

function getValorNf(row) {
  return safeNumber(campo(row, 'valor_nf', 'valorNF', 'nf_venda', 'valor_nota'));
}

async function buscarCtesDaCompetencia(competencia, onProgress) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado. Verifique o .env.');
  const { inicio, fim } = competenciaParaIntervalo(competencia);
  if (!inicio || !fim) return [];

  const supabase = getSupabaseClient();
  const acumulado = [];

  for (let offset = 0; ; offset += BATCH_SIZE) {
    const rangeFim = offset + BATCH_SIZE - 1;
    const { data, error } = await supabase
      .from(TABELA)
      .select('cidade_origem, uf_origem, cidade_destino, uf_destino, canal, canal_original, valor_cte, valor_nf, data_emissao')
      .gte('data_emissao', inicio)
      .lte('data_emissao', fim)
      .range(offset, rangeFim);

    if (error) throw new Error(`Erro Supabase (${TABELA}): ${error.message}`);

    const lote = data || [];
    acumulado.push(...lote);
    onProgress?.({ carregados: acumulado.length });

    if (lote.length < BATCH_SIZE) break;
  }

  return acumulado;
}

function classificarGrupo(row) {
  const canal = getCanalNormalizado(row);
  return CANAIS_FRACIONADO.includes(canal) ? 'fracionado' : 'lotacao';
}

function canaisDoGrupo(rows = [], groupFn) {
  const set = new Set();
  rows.forEach((row) => {
    if (groupFn(row)) set.add(getCanalNormalizado(row) || '(sem canal)');
  });
  return [...set].sort();
}

function montarAnaliseOrigemDestino(rows = []) {
  const mapa = new Map();

  rows.forEach((row) => {
    const origem = getOrigemCidade(row);
    const ufOrigem = getOrigemUf(row);
    const destino = getDestinoCidade(row);
    const ufDestino = getDestinoUf(row);
    const key = `${origem}|${ufOrigem}|${destino}|${ufDestino}`;

    const atual = mapa.get(key) || {
      key,
      origem,
      ufOrigem,
      destino,
      ufDestino,
      ctes: 0,
      valorCte: 0,
      valorNf: 0,
    };

    atual.ctes += 1;
    atual.valorCte += getValorCte(row);
    atual.valorNf += getValorNf(row);
    mapa.set(key, atual);
  });

  const linhas = [...mapa.values()].map((item) => ({
    ...item,
    freteMedio: item.ctes > 0 ? item.valorCte / item.ctes : 0,
    percentualNf: item.valorNf > 0 ? (item.valorCte / item.valorNf) * 100 : 0,
  }));

  const totais = linhas.reduce((acc, item) => {
    acc.ctes += item.ctes;
    acc.valorCte += item.valorCte;
    acc.valorNf += item.valorNf;
    return acc;
  }, { ctes: 0, valorCte: 0, valorNf: 0 });

  return {
    linhas,
    totalRotas: linhas.length,
    totalCtes: totais.ctes,
    valorTotalCte: totais.valorCte,
    valorTotalNf: totais.valorNf,
    freteMedio: totais.ctes > 0 ? totais.valorCte / totais.ctes : 0,
    percentualNf: totais.valorNf > 0 ? (totais.valorCte / totais.valorNf) * 100 : 0,
  };
}

function SummaryCard({ title, value, subtitle }) {
  return (
    <div className="summary-card" style={{ padding: 14, borderRadius: 10, border: '1px solid #e2e2e2', background: '#fff', minWidth: 160 }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      {subtitle ? <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{subtitle}</div> : null}
    </div>
  );
}

const COLUNAS = [
  { key: 'origem', label: 'Origem', align: 'left' },
  { key: 'destino', label: 'Destino', align: 'left' },
  { key: 'ctes', label: 'CT-es', align: 'right' },
  { key: 'valorCte', label: 'Valor total gasto', align: 'right' },
  { key: 'freteMedio', label: 'Frete medio', align: 'right' },
  { key: 'valorNf', label: 'Valor de NF total', align: 'right' },
  { key: 'percentualNf', label: '% NF', align: 'right' },
];

export default function CteOrigemDestinoPage() {
  const [competencia, setCompetencia] = useState(monthNow());
  const [grupo, setGrupo] = useState('fracionado');
  const [rows, setRows] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [progresso, setProgresso] = useState(0);
  const [busca, setBusca] = useState('');
  const [filtroOrigem, setFiltroOrigem] = useState('');
  const [filtroDestino, setFiltroDestino] = useState('');
  const [ordenacao, setOrdenacao] = useState({ campo: 'valorCte', direcao: 'desc' });
  const [canaisSelecionados, setCanaisSelecionados] = useState(null);

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setCarregando(true);
      setErro('');
      setProgresso(0);
      try {
        const dados = await buscarCtesDaCompetencia(competencia, ({ carregados }) => {
          if (!cancelado) setProgresso(carregados);
        });
        const semB2c = dados.filter((row) => getCanalNormalizado(row) !== 'B2C');
        if (!cancelado) setRows(semB2c);
      } catch (error) {
        if (!cancelado) setErro(error.message || 'Erro ao carregar CT-es');
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => { cancelado = true; };
  }, [competencia]);

  const canaisDisponiveisPorGrupo = useMemo(() => ({
    fracionado: canaisDoGrupo(rows, (row) => classificarGrupo(row) === 'fracionado'),
    lotacao: canaisDoGrupo(rows, (row) => classificarGrupo(row) === 'lotacao'),
  }), [rows]);

  const canaisDisponiveis = canaisDisponiveisPorGrupo[grupo];

  useEffect(() => {
    setCanaisSelecionados(null);
  }, [grupo, competencia]);

  const canaisEfetivos = canaisSelecionados || canaisDisponiveis;

  const rowsDoGrupoFiltradas = useMemo(() => {
    const setCanais = new Set(canaisEfetivos);
    return rows.filter((row) => setCanais.has(getCanalNormalizado(row) || '(sem canal)'));
  }, [rows, canaisEfetivos]);

  const analiseAtiva = useMemo(() => montarAnaliseOrigemDestino(rowsDoGrupoFiltradas), [rowsDoGrupoFiltradas]);

  const origensDisponiveis = useMemo(() => {
    const set = new Set(analiseAtiva.linhas.map((item) => `${item.origem} - ${item.ufOrigem}`));
    return [...set].sort();
  }, [analiseAtiva.linhas]);

  const destinosDisponiveis = useMemo(() => {
    const set = new Set(analiseAtiva.linhas.map((item) => `${item.destino} - ${item.ufDestino}`));
    return [...set].sort();
  }, [analiseAtiva.linhas]);

  useEffect(() => {
    setFiltroOrigem('');
    setFiltroDestino('');
  }, [grupo, competencia]);

  function toggleCanal(canal) {
    setCanaisSelecionados((atual) => {
      const base = atual || canaisDisponiveis;
      const jaSelecionado = base.includes(canal);
      const proximo = jaSelecionado ? base.filter((c) => c !== canal) : [...base, canal];
      return proximo;
    });
  }

  const linhasFiltradas = useMemo(() => {
    const termo = busca.trim().toUpperCase();
    let linhas = analiseAtiva.linhas;
    if (termo) {
      linhas = linhas.filter((item) => `${item.origem} ${item.ufOrigem} ${item.destino} ${item.ufDestino}`.toUpperCase().includes(termo));
    }
    if (filtroOrigem) {
      linhas = linhas.filter((item) => `${item.origem} - ${item.ufOrigem}` === filtroOrigem);
    }
    if (filtroDestino) {
      linhas = linhas.filter((item) => `${item.destino} - ${item.ufDestino}` === filtroDestino);
    }
    const { campo: campoOrd, direcao } = ordenacao;
    const sinal = direcao === 'asc' ? 1 : -1;
    return [...linhas].sort((a, b) => {
      const va = a[campoOrd];
      const vb = b[campoOrd];
      if (typeof va === 'string') return sinal * va.localeCompare(vb);
      return sinal * ((va || 0) - (vb || 0));
    });
  }, [analiseAtiva.linhas, busca, ordenacao]);

  function toggleOrdenacao(campoOrd) {
    setOrdenacao((atual) => ({
      campo: campoOrd,
      direcao: atual.campo === campoOrd && atual.direcao === 'desc' ? 'asc' : 'desc',
    }));
  }

  function exportarExcel() {
    const dadosExport = linhasFiltradas.map((item) => ({
      Origem: item.origem,
      'UF Origem': item.ufOrigem,
      Destino: item.destino,
      'UF Destino': item.ufDestino,
      'CT-es': item.ctes,
      'Valor total gasto': item.valorCte,
      'Frete medio': item.freteMedio,
      'Valor de NF total': item.valorNf,
      '% NF': Number(item.percentualNf.toFixed(2)),
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dadosExport);
    XLSX.utils.book_append_sheet(wb, ws, grupo === 'fracionado' ? 'Fracionado' : 'Lotacao');
    XLSX.writeFile(wb, `cte-origem-destino-${grupo}-${competencia}-${canaisEfetivos.join('_') || 'sem-canal'}.xlsx`);
  }

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>CT-e - Origem x Destino</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          Competencia
          <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
        </label>
        <span style={{ fontSize: 13, color: '#666' }}>{nomeCompetencia(competencia)}</span>
        <button type="button" onClick={exportarExcel} disabled={carregando || !linhasFiltradas.length} style={{ marginLeft: 'auto' }}>
          Exportar Excel
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => setGrupo('fracionado')}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid #ccc',
            background: grupo === 'fracionado' ? '#1f6feb' : '#fff',
            color: grupo === 'fracionado' ? '#fff' : '#333',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Fracionado (Atacado)
        </button>
        <button
          type="button"
          onClick={() => setGrupo('lotacao')}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid #ccc',
            background: grupo === 'lotacao' ? '#1f6feb' : '#fff',
            color: grupo === 'lotacao' ? '#fff' : '#333',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Lotacao (demais canais)
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
        <span style={{ color: '#666' }}>Canais incluidos:</span>
        {canaisDisponiveis.map((canal) => (
          <label key={canal} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={canaisEfetivos.includes(canal)} onChange={() => toggleCanal(canal)} />
            {canal}
          </label>
        ))}
        {canaisDisponiveis.length ? (
          <>
            <button type="button" onClick={() => setCanaisSelecionados([...canaisDisponiveis])} style={{ fontSize: 12 }}>
              Selecionar todos
            </button>
            <button type="button" onClick={() => setCanaisSelecionados([])} style={{ fontSize: 12 }}>
              Limpar
            </button>
          </>
        ) : null}
      </div>

      {carregando ? <div style={{ fontSize: 13, color: '#666' }}>Carregando CT-es da competencia... {fmtN(progresso)} linhas lidas</div> : null}
      {erro ? <div style={{ color: '#c0392b', fontSize: 13 }}>{erro}</div> : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <SummaryCard title="Rotas (origem x destino)" value={fmtN(analiseAtiva.totalRotas)} />
        <SummaryCard title="CT-es" value={fmtN(analiseAtiva.totalCtes)} />
        <SummaryCard title="Valor total gasto" value={fmt(analiseAtiva.valorTotalCte)} />
        <SummaryCard title="Frete medio" value={fmt(analiseAtiva.freteMedio)} subtitle="valor CT-e / CT-es" />
        <SummaryCard title="Valor de NF total" value={fmt(analiseAtiva.valorTotalNf)} />
        <SummaryCard title="% NF" value={fmtPct(analiseAtiva.percentualNf)} subtitle="frete sobre NF" />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Buscar por origem ou destino..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc', minWidth: 260 }}
        />
        <select
          value={filtroOrigem}
          onChange={(e) => setFiltroOrigem(e.target.value)}
          style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc', minWidth: 220 }}
        >
          <option value="">Todas as origens</option>
          {origensDisponiveis.map((origem) => <option key={origem} value={origem}>{origem}</option>)}
        </select>
        <select
          value={filtroDestino}
          onChange={(e) => setFiltroDestino(e.target.value)}
          style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc', minWidth: 220 }}
        >
          <option value="">Todos os destinos</option>
          {destinosDisponiveis.map((destino) => <option key={destino} value={destino}>{destino}</option>)}
        </select>
        {(filtroOrigem || filtroDestino) ? (
          <button type="button" onClick={() => { setFiltroOrigem(''); setFiltroDestino(''); }} style={{ fontSize: 12 }}>
            Limpar filtros de origem/destino
          </button>
        ) : null}
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid #e2e2e2', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f7f7f7' }}>
              {COLUNAS.map((coluna) => (
                <th
                  key={coluna.key}
                  onClick={() => toggleOrdenacao(coluna.key)}
                  style={{
                    padding: '10px 12px',
                    textAlign: coluna.align,
                    cursor: 'pointer',
                    userSelect: 'none',
                    borderBottom: '1px solid #e2e2e2',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {coluna.label}
                  {ordenacao.campo === coluna.key ? (ordenacao.direcao === 'desc' ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhasFiltradas.map((item) => (
              <tr key={item.key} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '8px 12px' }}>{item.origem} - {item.ufOrigem}</td>
                <td style={{ padding: '8px 12px' }}>{item.destino} - {item.ufDestino}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtN(item.ctes)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(item.valorCte)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(item.freteMedio)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(item.valorNf)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtPct(item.percentualNf)}</td>
              </tr>
            ))}
            {!linhasFiltradas.length && !carregando ? (
              <tr>
                <td colSpan={COLUNAS.length} style={{ padding: 20, textAlign: 'center', color: '#888' }}>
                  Nenhum registro encontrado para essa competencia.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
