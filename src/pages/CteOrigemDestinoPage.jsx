import { Fragment, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import { normalizarCanalOperacional } from '../utils/canalTransportadora';
import { formatarCnpj } from '../utils/cnpj';

const TABELA = 'realizado_local_ctes';
const BATCH_SIZE = 1000;
const CANAIS_FRACIONADO = ['ATACADO'];
const CANAIS_TRANSFERENCIA = ['INTERCOMPANY'];

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

const COLUNAS_BASE = [
  'cidade_origem', 'uf_origem', 'cidade_destino', 'uf_destino', 'canal', 'canal_original', 'valor_cte', 'valor_nf', 'data_emissao',
  'transportadora', 'cnpj_transportadora', 'peso', 'cubagem', 'qtd_volumes', 'created_at', 'documento_remetente',
];
// Criadas pela migration 20261104_001; se o banco ainda nao tiver, a tela segue sem elas.
const COLUNAS_OPCIONAIS = ['codigo_transportadora', 'cnpj_tomador', 'material', 'unidade_medida'];

async function lerPaginas(supabase, colunas, inicio, fim, onProgress) {
  const acumulado = [];
  for (let offset = 0; ; offset += BATCH_SIZE) {
    const { data, error } = await supabase
      .from(TABELA)
      .select(colunas.join(', '))
      .gte('data_emissao', inicio)
      .lte('data_emissao', fim)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) return { erro: error, dados: acumulado };

    const lote = data || [];
    acumulado.push(...lote);
    onProgress?.({ carregados: acumulado.length });
    if (lote.length < BATCH_SIZE) break;
  }
  return { erro: null, dados: acumulado };
}

async function buscarCtesDaCompetencia(competencia, onProgress) {
  if (!isSupabaseConfigured()) throw new Error('Supabase nao configurado. Verifique o .env.');
  const { inicio, fim } = competenciaParaIntervalo(competencia);
  if (!inicio || !fim) return [];

  const supabase = getSupabaseClient();
  const completo = await lerPaginas(supabase, [...COLUNAS_BASE, ...COLUNAS_OPCIONAIS], inicio, fim, onProgress);
  if (!completo.erro) return completo.dados;

  // Coluna opcional ainda nao existe no banco: le so as colunas base.
  const base = await lerPaginas(supabase, COLUNAS_BASE, inicio, fim, onProgress);
  if (base.erro) throw new Error(`Erro Supabase (${TABELA}): ${base.erro.message}`);
  return base.dados;
}

const GRUPOS = [
  { key: 'fracionado', label: 'Fracionado (Atacado)' },
  { key: 'transferencia', label: 'Transferencias entre filiais (Intercompany)' },
  { key: 'lotacao', label: 'Lotacao (demais canais)' },
];

function classificarGrupo(row) {
  const canal = getCanalNormalizado(row);
  if (CANAIS_FRACIONADO.includes(canal)) return 'fracionado';
  if (CANAIS_TRANSFERENCIA.includes(canal)) return 'transferencia';
  return 'lotacao';
}

function canaisDoGrupo(rows = [], groupFn) {
  const set = new Set();
  rows.forEach((row) => {
    if (groupFn(row)) set.add(getCanalNormalizado(row) || '(sem canal)');
  });
  return [...set].sort();
}

function dataIso(v) {
  const texto = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : '';
}

function fmtData(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function fmtIntervaloDatas(min, max) {
  if (!min) return '-';
  if (!max || min === max) return fmtData(min);
  return `${fmtData(min)} a ${fmtData(max)}`;
}

function textoCnpj(v) {
  const digitos = String(v || '').replace(/\D/g, '');
  return digitos ? formatarCnpj(digitos) : '';
}

function novoAgregado(extra = {}) {
  return {
    ...extra,
    ctes: 0,
    quantidade: 0,
    peso: 0,
    cubagem: 0,
    valorCte: 0,
    valorNf: 0,
    materiais: new Set(),
    unidades: new Set(),
    codigos: new Set(),
    cnpjsEmissor: new Set(),
    cnpjsTomador: new Set(),
    emissaoMin: '',
    emissaoMax: '',
    lancamentoMin: '',
    lancamentoMax: '',
  };
}

function somarNoAgregado(alvo, row) {
  alvo.ctes += 1;
  alvo.quantidade += safeNumber(campo(row, 'qtd_volumes'));
  alvo.peso += safeNumber(campo(row, 'peso'));
  alvo.cubagem += safeNumber(campo(row, 'cubagem'));
  alvo.valorCte += getValorCte(row);
  alvo.valorNf += getValorNf(row);

  const material = String(campo(row, 'material') || '').trim();
  if (material) alvo.materiais.add(material.toUpperCase());
  String(campo(row, 'unidade_medida') || '').split(/[/,;]/).map((u) => u.trim().toUpperCase()).filter(Boolean).forEach((u) => alvo.unidades.add(u));
  const codigo = String(campo(row, 'codigo_transportadora') || '').trim();
  if (codigo) alvo.codigos.add(codigo);
  const emissor = textoCnpj(campo(row, 'cnpj_transportadora'));
  if (emissor) alvo.cnpjsEmissor.add(emissor);
  const tomador = textoCnpj(campo(row, 'cnpj_tomador'));
  if (tomador) alvo.cnpjsTomador.add(tomador);

  const emissao = dataIso(campo(row, 'data_emissao'));
  if (emissao) {
    if (!alvo.emissaoMin || emissao < alvo.emissaoMin) alvo.emissaoMin = emissao;
    if (!alvo.emissaoMax || emissao > alvo.emissaoMax) alvo.emissaoMax = emissao;
  }
  const lancamento = dataIso(campo(row, 'created_at'));
  if (lancamento) {
    if (!alvo.lancamentoMin || lancamento < alvo.lancamentoMin) alvo.lancamentoMin = lancamento;
    if (!alvo.lancamentoMax || lancamento > alvo.lancamentoMax) alvo.lancamentoMax = lancamento;
  }
}

function unidadesDoAgregado(item) {
  const set = new Set(item.unidades);
  if (!set.size) {
    if (item.peso > 0) set.add('KG');
    if (item.cubagem > 0) set.add('M3');
    if (item.quantidade > 0) set.add('UN');
  }
  return [...set].sort();
}

function finalizarAgregado(item) {
  return {
    ...item,
    freteMedio: item.ctes > 0 ? item.valorCte / item.ctes : 0,
    percentualNf: item.valorNf > 0 ? (item.valorCte / item.valorNf) * 100 : 0,
    fretePorKg: item.peso > 0 ? item.valorCte / item.peso : 0,
    materiaisLista: [...item.materiais].sort(),
    unidadesLista: unidadesDoAgregado(item),
    codigosLista: [...item.codigos].sort(),
    cnpjsEmissorLista: [...item.cnpjsEmissor].sort(),
    cnpjsTomadorLista: [...item.cnpjsTomador].sort(),
  };
}

function montarAnaliseOrigemDestino(rows = []) {
  const mapa = new Map();

  rows.forEach((row) => {
    const origem = getOrigemCidade(row);
    const ufOrigem = getOrigemUf(row);
    const destino = getDestinoCidade(row);
    const ufDestino = getDestinoUf(row);
    const key = `${origem}|${ufOrigem}|${destino}|${ufDestino}`;

    let rota = mapa.get(key);
    if (!rota) {
      rota = novoAgregado({ key, origem, ufOrigem, destino, ufDestino, transportadorasMap: new Map() });
      mapa.set(key, rota);
    }
    somarNoAgregado(rota, row);

    const nomeTransp = String(campo(row, 'transportadora') || '').trim().toUpperCase() || 'NAO INFORMADA';
    const cnpjTransp = String(campo(row, 'cnpj_transportadora') || '').replace(/\D/g, '');
    const keyTransp = cnpjTransp || nomeTransp;
    let transp = rota.transportadorasMap.get(keyTransp);
    if (!transp) {
      transp = novoAgregado({ key: `${key}|${keyTransp}`, transportadora: nomeTransp, cnpjTransportadora: cnpjTransp });
      rota.transportadorasMap.set(keyTransp, transp);
    }
    somarNoAgregado(transp, row);
  });

  const linhas = [...mapa.values()].map((rota) => {
    const transportadoras = [...rota.transportadorasMap.values()]
      .map(finalizarAgregado)
      .sort((a, b) => b.valorCte - a.valorCte);
    const { transportadorasMap, ...resto } = rota;
    return {
      ...finalizarAgregado(resto),
      transportadoras,
      qtdTransportadoras: transportadoras.length,
      nomesTransportadoras: transportadoras.map((t) => t.transportadora).join(' '),
    };
  });

  const totais = linhas.reduce((acc, item) => {
    acc.ctes += item.ctes;
    acc.valorCte += item.valorCte;
    acc.valorNf += item.valorNf;
    acc.peso += item.peso;
    acc.cubagem += item.cubagem;
    acc.quantidade += item.quantidade;
    return acc;
  }, { ctes: 0, valorCte: 0, valorNf: 0, peso: 0, cubagem: 0, quantidade: 0 });

  const transportadorasUnicas = new Set();
  linhas.forEach((l) => l.transportadoras.forEach((t) => transportadorasUnicas.add(t.cnpjTransportadora || t.transportadora)));

  return {
    linhas,
    totalRotas: linhas.length,
    totalTransportadoras: transportadorasUnicas.size,
    totalCtes: totais.ctes,
    totalPeso: totais.peso,
    totalCubagem: totais.cubagem,
    totalQuantidade: totais.quantidade,
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

// Mostra o 1o valor e "+N" quando houver varios (lista completa no tooltip).
function ListaCurta({ itens = [], vazio = '-' }) {
  if (!itens.length) return <span style={{ color: '#aaa' }}>{vazio}</span>;
  if (itens.length === 1) return <span>{itens[0]}</span>;
  return (
    <span title={itens.join('\n')}>
      {itens[0]} <span style={{ color: '#1f6feb', fontSize: 11 }}>+{itens.length - 1}</span>
    </span>
  );
}

// Medidas no formato de cada item: kg para peso, m3 para cubagem, un para quantidade.
function Medidas({ item }) {
  const partes = [];
  if (item.peso > 0) partes.push(`${fmtN(item.peso, 2)} kg`);
  if (item.cubagem > 0) partes.push(`${fmtN(item.cubagem, 3)} m³`);
  if (!partes.length) return <span style={{ color: '#aaa' }}>-</span>;
  return <span style={{ whiteSpace: 'nowrap' }}>{partes.join(' | ')}</span>;
}

const COLUNAS = [
  { key: 'origem', label: 'Origem', align: 'left' },
  { key: 'destino', label: 'Destino', align: 'left' },
  { key: 'qtdTransportadoras', label: 'Transp.', align: 'right' },
  { key: 'ctes', label: 'CT-es', align: 'right' },
  { key: 'quantidade', label: 'Quantidade', align: 'right' },
  { key: 'peso', label: 'Peso (kg)', align: 'right' },
  { key: 'cubagem', label: 'Cubagem (m³)', align: 'right' },
  { key: 'valorCte', label: 'Valor total gasto', align: 'right' },
  { key: 'freteMedio', label: 'Frete medio', align: 'right' },
  { key: 'valorNf', label: 'Valor de NF total', align: 'right' },
  { key: 'percentualNf', label: '% NF', align: 'right' },
];

const COLUNAS_TRANSP = [
  'Codigo', 'Transportadora', 'CT-es', 'Quantidade', 'Material', 'Peso / m³', 'Unidade', 'Data emissao', 'Data lancamento',
  'CNPJ emissor', 'CNPJ tomador', 'Valor total', 'Frete medio', 'Valor NF', '% NF',
];

const tdSub = { padding: '6px 10px', borderBottom: '1px solid #eef1f6', verticalAlign: 'top' };

function TabelaTransportadoras({ transportadoras }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: '#fff' }}>
      <thead>
        <tr style={{ background: '#eef3fb' }}>
          {COLUNAS_TRANSP.map((c, i) => (
            <th key={c} style={{ ...tdSub, textAlign: i >= 2 && ![4, 6, 7, 8, 9, 10].includes(i) ? 'right' : 'left', whiteSpace: 'nowrap', fontWeight: 600 }}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {transportadoras.map((t) => (
          <tr key={t.key}>
            <td style={tdSub}><ListaCurta itens={t.codigosLista.length ? t.codigosLista : [textoCnpj(t.cnpjTransportadora)].filter(Boolean)} /></td>
            <td style={{ ...tdSub, fontWeight: 600 }}>{t.transportadora}</td>
            <td style={{ ...tdSub, textAlign: 'right' }}>{fmtN(t.ctes)}</td>
            <td style={{ ...tdSub, textAlign: 'right' }}>{t.quantidade > 0 ? fmtN(t.quantidade) : '-'}</td>
            <td style={tdSub}><ListaCurta itens={t.materiaisLista} /></td>
            <td style={{ ...tdSub, textAlign: 'right' }}><Medidas item={t} /></td>
            <td style={tdSub}>{t.unidadesLista.join(' / ') || '-'}</td>
            <td style={{ ...tdSub, whiteSpace: 'nowrap' }}>{fmtIntervaloDatas(t.emissaoMin, t.emissaoMax)}</td>
            <td style={{ ...tdSub, whiteSpace: 'nowrap' }}>{fmtIntervaloDatas(t.lancamentoMin, t.lancamentoMax)}</td>
            <td style={{ ...tdSub, whiteSpace: 'nowrap' }}><ListaCurta itens={t.cnpjsEmissorLista} /></td>
            <td style={{ ...tdSub, whiteSpace: 'nowrap' }}><ListaCurta itens={t.cnpjsTomadorLista} /></td>
            <td style={{ ...tdSub, textAlign: 'right' }}>{fmt(t.valorCte)}</td>
            <td style={{ ...tdSub, textAlign: 'right' }}>{fmt(t.freteMedio)}</td>
            <td style={{ ...tdSub, textAlign: 'right' }}>{fmt(t.valorNf)}</td>
            <td style={{ ...tdSub, textAlign: 'right' }}>{fmtPct(t.percentualNf)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

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
  const [filtroTransportadora, setFiltroTransportadora] = useState('');
  const [expandidas, setExpandidas] = useState(() => new Set());

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

  const canaisDisponiveisPorGrupo = useMemo(() => Object.fromEntries(
    GRUPOS.map((g) => [g.key, canaisDoGrupo(rows, (row) => classificarGrupo(row) === g.key)]),
  ), [rows]);

  const canaisDisponiveis = canaisDisponiveisPorGrupo[grupo] || [];

  useEffect(() => {
    setCanaisSelecionados(null);
  }, [grupo, competencia]);

  const canaisEfetivos = canaisSelecionados || canaisDisponiveis;

  const rowsDoGrupoFiltradas = useMemo(() => {
    const setCanais = new Set(canaisEfetivos);
    return rows.filter((row) => classificarGrupo(row) === grupo && setCanais.has(getCanalNormalizado(row) || '(sem canal)'));
  }, [rows, canaisEfetivos, grupo]);

  const analiseAtiva = useMemo(() => montarAnaliseOrigemDestino(rowsDoGrupoFiltradas), [rowsDoGrupoFiltradas]);

  const origensDisponiveis = useMemo(() => {
    const set = new Set(analiseAtiva.linhas.map((item) => `${item.origem} - ${item.ufOrigem}`));
    return [...set].sort();
  }, [analiseAtiva.linhas]);

  const destinosDisponiveis = useMemo(() => {
    const set = new Set(analiseAtiva.linhas.map((item) => `${item.destino} - ${item.ufDestino}`));
    return [...set].sort();
  }, [analiseAtiva.linhas]);

  const transportadorasDisponiveis = useMemo(() => {
    const set = new Set();
    analiseAtiva.linhas.forEach((l) => l.transportadoras.forEach((t) => set.add(t.transportadora)));
    return [...set].sort();
  }, [analiseAtiva.linhas]);

  useEffect(() => {
    setFiltroOrigem('');
    setFiltroDestino('');
    setFiltroTransportadora('');
    setExpandidas(new Set());
  }, [grupo, competencia]);

  function toggleExpandida(key) {
    setExpandidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(key)) proximo.delete(key);
      else proximo.add(key);
      return proximo;
    });
  }

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
      linhas = linhas.filter((item) => `${item.origem} ${item.ufOrigem} ${item.destino} ${item.ufDestino} ${item.nomesTransportadoras}`.toUpperCase().includes(termo));
    }
    if (filtroOrigem) {
      linhas = linhas.filter((item) => `${item.origem} - ${item.ufOrigem}` === filtroOrigem);
    }
    if (filtroDestino) {
      linhas = linhas.filter((item) => `${item.destino} - ${item.ufDestino}` === filtroDestino);
    }
    if (filtroTransportadora) {
      // Mantem so a transportadora escolhida dentro de cada rota e recalcula os totais da rota.
      linhas = linhas
        .map((item) => {
          const transportadoras = item.transportadoras.filter((t) => t.transportadora === filtroTransportadora);
          if (!transportadoras.length) return null;
          const t = transportadoras[0];
          return {
            ...item,
            ...['ctes', 'quantidade', 'peso', 'cubagem', 'valorCte', 'valorNf', 'freteMedio', 'percentualNf'].reduce((acc, k) => ({ ...acc, [k]: t[k] }), {}),
            transportadoras,
            qtdTransportadoras: 1,
          };
        })
        .filter(Boolean);
    }
    const { campo: campoOrd, direcao } = ordenacao;
    const sinal = direcao === 'asc' ? 1 : -1;
    return [...linhas].sort((a, b) => {
      const va = a[campoOrd];
      const vb = b[campoOrd];
      if (typeof va === 'string') return sinal * va.localeCompare(vb);
      return sinal * ((va || 0) - (vb || 0));
    });
  }, [analiseAtiva.linhas, busca, filtroOrigem, filtroDestino, filtroTransportadora, ordenacao]);

  function toggleOrdenacao(campoOrd) {
    setOrdenacao((atual) => ({
      campo: campoOrd,
      direcao: atual.campo === campoOrd && atual.direcao === 'desc' ? 'asc' : 'desc',
    }));
  }

  function exportarExcel() {
    const juntar = (lista) => lista.join(' / ');
    const dadosRotas = linhasFiltradas.map((item) => ({
      Origem: item.origem,
      'UF Origem': item.ufOrigem,
      Destino: item.destino,
      'UF Destino': item.ufDestino,
      Transportadoras: item.qtdTransportadoras,
      'CT-es': item.ctes,
      Quantidade: item.quantidade,
      'Peso (kg)': Number(item.peso.toFixed(3)),
      'Cubagem (m3)': Number(item.cubagem.toFixed(3)),
      'Valor total gasto': item.valorCte,
      'Frete medio': item.freteMedio,
      'Valor de NF total': item.valorNf,
      '% NF': Number(item.percentualNf.toFixed(2)),
    }));

    const dadosTransp = [];
    linhasFiltradas.forEach((item) => {
      item.transportadoras.forEach((t) => {
        dadosTransp.push({
          Origem: item.origem,
          'UF Origem': item.ufOrigem,
          Destino: item.destino,
          'UF Destino': item.ufDestino,
          'Codigo transportadora': juntar(t.codigosLista),
          Transportadora: t.transportadora,
          'CT-es': t.ctes,
          Quantidade: t.quantidade,
          Material: juntar(t.materiaisLista),
          'Peso (kg)': Number(t.peso.toFixed(3)),
          'Cubagem (m3)': Number(t.cubagem.toFixed(3)),
          'Unidade de medida': juntar(t.unidadesLista),
          'Data emissao': fmtIntervaloDatas(t.emissaoMin, t.emissaoMax),
          'Data lancamento': fmtIntervaloDatas(t.lancamentoMin, t.lancamentoMax),
          'CNPJ emissor': juntar(t.cnpjsEmissorLista),
          'CNPJ tomador': juntar(t.cnpjsTomadorLista),
          'Valor total gasto': t.valorCte,
          'Frete medio': t.freteMedio,
          'Valor de NF total': t.valorNf,
          '% NF': Number(t.percentualNf.toFixed(2)),
        });
      });
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dadosRotas), 'Rotas');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dadosTransp), 'Rota x Transportadora');
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

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {GRUPOS.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setGrupo(g.key)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #ccc',
              background: grupo === g.key ? '#1f6feb' : '#fff',
              color: grupo === g.key ? '#fff' : '#333',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {g.label}
          </button>
        ))}
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
        <SummaryCard title="Transportadoras" value={fmtN(analiseAtiva.totalTransportadoras)} />
        <SummaryCard title="CT-es" value={fmtN(analiseAtiva.totalCtes)} />
        <SummaryCard title="Quantidade" value={fmtN(analiseAtiva.totalQuantidade)} subtitle="volumes" />
        <SummaryCard title="Peso total" value={`${fmtN(analiseAtiva.totalPeso, 0)} kg`} subtitle={analiseAtiva.totalCubagem > 0 ? `${fmtN(analiseAtiva.totalCubagem, 2)} m³` : undefined} />
        <SummaryCard title="Valor total gasto" value={fmt(analiseAtiva.valorTotalCte)} />
        <SummaryCard title="Frete medio" value={fmt(analiseAtiva.freteMedio)} subtitle="valor CT-e / CT-es" />
        <SummaryCard title="Valor de NF total" value={fmt(analiseAtiva.valorTotalNf)} />
        <SummaryCard title="% NF" value={fmtPct(analiseAtiva.percentualNf)} subtitle="frete sobre NF" />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Buscar por origem, destino ou transportadora..."
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
        <select
          value={filtroTransportadora}
          onChange={(e) => setFiltroTransportadora(e.target.value)}
          style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc', minWidth: 220 }}
        >
          <option value="">Todas as transportadoras</option>
          {transportadorasDisponiveis.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {(filtroOrigem || filtroDestino || filtroTransportadora) ? (
          <button type="button" onClick={() => { setFiltroOrigem(''); setFiltroDestino(''); setFiltroTransportadora(''); }} style={{ fontSize: 12 }}>
            Limpar filtros
          </button>
        ) : null}
        <button type="button" onClick={() => setExpandidas(new Set(linhasFiltradas.map((l) => l.key)))} style={{ fontSize: 12 }} disabled={!linhasFiltradas.length}>
          Abrir todas as transportadoras
        </button>
        <button type="button" onClick={() => setExpandidas(new Set())} style={{ fontSize: 12 }} disabled={!expandidas.size}>
          Fechar todas
        </button>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid #e2e2e2', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f7f7f7' }}>
              <th style={{ width: 28, borderBottom: '1px solid #e2e2e2' }} />
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
            {linhasFiltradas.map((item) => {
              const aberta = expandidas.has(item.key);
              return (
                <Fragment key={item.key}>
                  <tr
                    onClick={() => toggleExpandida(item.key)}
                    style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer', background: aberta ? '#f5f8fe' : undefined }}
                    title="Clique para ver as transportadoras desta rota"
                  >
                    <td style={{ padding: '8px 6px', textAlign: 'center', color: '#1f6feb' }}>{aberta ? '▾' : '▸'}</td>
                    <td style={{ padding: '8px 12px' }}>{item.origem} - {item.ufOrigem}</td>
                    <td style={{ padding: '8px 12px' }}>{item.destino} - {item.ufDestino}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtN(item.qtdTransportadoras)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtN(item.ctes)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{item.quantidade > 0 ? fmtN(item.quantidade) : '-'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{item.peso > 0 ? fmtN(item.peso, 2) : '-'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{item.cubagem > 0 ? fmtN(item.cubagem, 3) : '-'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(item.valorCte)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(item.freteMedio)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(item.valorNf)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtPct(item.percentualNf)}</td>
                  </tr>
                  {aberta ? (
                    <tr>
                      <td colSpan={COLUNAS.length + 1} style={{ padding: '6px 12px 14px 34px', background: '#f5f8fe', borderBottom: '1px solid #e2e2e2' }}>
                        <div style={{ overflowX: 'auto' }}>
                          <TabelaTransportadoras transportadoras={item.transportadoras} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!linhasFiltradas.length && !carregando ? (
              <tr>
                <td colSpan={COLUNAS.length + 1} style={{ padding: 20, textAlign: 'center', color: '#888' }}>
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
