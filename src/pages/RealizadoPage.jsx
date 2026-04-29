import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  buscarBaseSimulacaoDb,
  carregarMunicipiosIbgeDb,
  carregarOpcoesSimuladorDb,
  diagnosticarRealizadoSupabaseDb,
  excluirRealizadoCtes,
  listarRealizadoCtes,
  resolverDestinoIbgeDb,
  salvarRealizadoCtes,
} from '../services/freteDatabaseService';
import { simularRealizadoPorTransportadoraAsync } from '../utils/calculoFrete';
import {
  formatCurrency,
  formatDateBr,
  formatNumber,
  formatPercent,
  normalizeHeaderRealizado,
  parseRealizadoCtesFile,
} from '../utils/realizadoCtes';

const DEFAULT_FILTROS = {
  inicio: '',
  fim: '',
  canal: '',
  origem: '',
  ufDestino: '',
  transportadora: '',
};

const REALIZADO_FOLDER_HISTORY_KEY = 'amd-realizado-ctes-pasta-importados-v1';
const EXTENSOES_REALIZADO = ['.xlsx', '.xls', '.csv'];

function isArquivoRealizadoImportavel(file) {
  const nome = String(file?.name || '').toLowerCase();
  return EXTENSOES_REALIZADO.some((ext) => nome.endsWith(ext));
}

function getArquivoAssinatura(file) {
  const caminho = String(file?.webkitRelativePath || file?.name || '').trim();
  return [caminho, file?.size || 0, file?.lastModified || 0].join('|');
}

function lerHistoricoPastaRealizado() {
  try {
    const raw = localStorage.getItem(REALIZADO_FOLDER_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function salvarHistoricoPastaRealizado(historySet) {
  try {
    localStorage.setItem(REALIZADO_FOLDER_HISTORY_KEY, JSON.stringify([...historySet]));
  } catch {
    // Se o navegador bloquear localStorage, o upsert no Supabase ainda evita duplicidade de CT-e.
  }
}

function SummaryCard({ title, value, subtitle }) {
  return (
    <div className="summary-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <span>{subtitle}</span>
    </div>
  );
}

function normalizarBusca(value) {
  return normalizeHeaderRealizado(value).replace(/\s+/g, ' ');
}

function normalizarCanalTela(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

const CANAIS_B2C_TELA = [
  'B2C',
  'VIA VAREJO',
  'MERCADO LIVRE',
  'MERCADOR LIVRE',
  'B2W',
  'MAGAZINE LUIZA',
  'CARREFOUR',
  'GPA',
  'COLOMBO',
  'AMAZON',
  'INTER',
  'ANYMARKET',
  'ANY MARKET',
  'BRADESCO SHOP',
  'ITAU SHOP',
  'ITAÚ SHOP',
  'SHOPEE',
  'LIVELO',
  'MARKETPLACE',
  'MARKET PLACE',
  'ECOMMERCE',
  'E-COMMERCE',
];

const CANAIS_ATACADO_TELA = [
  'ATACADO',
  'B2B',
  'CANTU',
  'CANTU PNEUS',
];

function contemCanalTela(canal, lista = []) {
  return lista.some((item) => canal === item || canal.includes(item));
}

function categoriaCanalTela(value) {
  const canal = normalizarCanalTela(value);
  if (!canal) return '';
  if (canal.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (canal.includes('REVERSA')) return 'REVERSA';
  if (contemCanalTela(canal, CANAIS_ATACADO_TELA)) return 'ATACADO';
  if (contemCanalTela(canal, CANAIS_B2C_TELA)) return 'B2C';
  return canal;
}

function canalCompativelTela(canalLinha, canalFiltro) {
  const filtro = normalizarCanalTela(canalFiltro);
  if (!filtro) return true;
  const linha = normalizarCanalTela(canalLinha);
  if (!linha) return false;
  if (linha === filtro) return true;

  const categoriaLinha = categoriaCanalTela(linha);
  const categoriaFiltro = categoriaCanalTela(filtro);
  return Boolean(categoriaLinha && categoriaFiltro && categoriaLinha === categoriaFiltro);
}

function splitCidadeUfTela(cidadeRaw, ufRaw = '') {
  let cidade = String(cidadeRaw || '').trim();
  let uf = String(ufRaw || '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  const match = cidade.match(/^(.*?)(?:\s*\/\s*|\s*-\s*)([A-Za-z]{2})$/);
  if (match) {
    cidade = match[1].trim();
    if (!uf) uf = match[2].toUpperCase();
  }
  return { cidade, uf };
}

function cidadeFiltroTela(cidade, uf = '') {
  return normalizarBusca(splitCidadeUfTela(cidade, uf).cidade);
}

function buildCidadeKey(cidade, uf = '') {
  const parsed = splitCidadeUfTela(cidade, uf);
  return [normalizarBusca(parsed.cidade), String(parsed.uf || '').trim().toUpperCase()].join('|');
}

function buildCidadePorIbge(municipios = []) {
  return new Map((municipios || []).map((item) => [String(item.ibge || ''), item.cidade || '']));
}

function buildIbgePorCidade(municipios = []) {
  const map = new Map();
  (municipios || []).forEach((item) => {
    if (!item.cidade || !item.ibge) return;
    map.set(buildCidadeKey(item.cidade, item.uf), item.ibge);
    if (!map.has(buildCidadeKey(item.cidade))) map.set(buildCidadeKey(item.cidade), item.ibge);
  });
  return map;
}

function statsRealizado(rows = []) {
  const valorCte = rows.reduce((acc, item) => acc + (Number(item.valorCte) || 0), 0);
  const valorNF = rows.reduce((acc, item) => acc + (Number(item.valorNF) || 0), 0);
  const chaves = new Set(rows.map((item) => item.chaveCte || item.numeroCte).filter(Boolean));
  const periodo = rows
    .map((item) => item.emissao)
    .filter(Boolean)
    .sort();

  return {
    ctes: chaves.size || rows.length,
    valorCte,
    valorNF,
    percentualFrete: valorNF > 0 ? (valorCte / valorNF) * 100 : 0,
    periodoInicio: periodo[0] || '',
    periodoFim: periodo[periodo.length - 1] || '',
  };
}

function filtrarRows(rows = [], filtros = {}) {
  const inicio = filtros.inicio ? new Date(`${filtros.inicio}T00:00:00`) : null;
  const fim = filtros.fim ? new Date(`${filtros.fim}T23:59:59`) : null;
  const canal = String(filtros.canal || '').trim();
  const origem = cidadeFiltroTela(filtros.origem);
  const ufDestino = String(filtros.ufDestino || '').trim().toUpperCase();

  return rows.filter((row) => {
    const data = row.emissao ? new Date(row.emissao) : null;
    const destinoParsed = splitCidadeUfTela(row.cidadeDestino, row.ufDestino);
    if (inicio && (!data || data < inicio)) return false;
    if (fim && (!data || data > fim)) return false;
    if (!canalCompativelTela(row.canal || row.canalVendas || row.canais, canal)) return false;
    if (origem && cidadeFiltroTela(row.cidadeOrigem, row.ufOrigem) !== origem) return false;
    if (ufDestino && String(destinoParsed.uf || row.ufDestino || '').trim().toUpperCase() !== ufDestino) return false;
    return true;
  });
}

function fileInputKey() {
  return `realizado-${Date.now()}`;
}

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function calcularPercentualProgresso(atual = 0, total = 0) {
  const safeTotal = Math.max(Number(total) || 0, 1);
  const safeAtual = Math.max(Number(atual) || 0, 0);
  return Math.min(100, Math.max(0, Math.round((safeAtual / safeTotal) * 100)));
}

function hasCanalRealizado(row = {}) {
  return String(row.canal || '').trim().length > 0;
}

function exportarCsvAnalise(resultado, transportadora) {
  const linhas = [
    [
      'Emissão',
      'CT-e',
      'Transportadora realizada',
      'Transportadora simulada',
      'Origem',
      'Destino',
      'UF destino',
      'Peso',
      'Valor NF',
      'Frete realizado',
      'Frete simulado',
      'Impacto',
      'Ranking',
      'Ganharia',
      'Líder',
    ],
    ...(resultado?.detalhes || []).map((item) => [
      formatDateBr(item.emissao),
      item.numeroCte || item.chaveCte,
      item.transportadoraRealizada,
      item.transportadoraSimulada,
      item.origem,
      item.cidadeDestino,
      item.ufDestino,
      formatNumber(item.peso, 3),
      formatNumber(item.valorNF, 2),
      formatNumber(item.valorRealizado, 2),
      formatNumber(item.valorSimulado, 2),
      formatNumber(item.impacto, 2),
      item.ranking,
      item.ganharia ? 'Sim' : 'Não',
      item.liderTransportadora,
    ]),
  ];

  const csv = linhas
    .map((linha) => linha.map((valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `realizado-${String(transportadora || 'transportadora').toLowerCase().replace(/\s+/g, '-')}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDiagCount(value, sufixo = '') {
  if (value === null || value === undefined || value === '') return 'não calculado';
  const numero = Number(value);
  if (!Number.isFinite(numero)) return 'não calculado';
  return `${numero.toLocaleString('pt-BR')}${sufixo}`;
}

export default function RealizadoPage({ transportadoras = [] }) {
  const [rows, setRows] = useState([]);
  const [opcoes, setOpcoes] = useState({ transportadoras: [], canais: [], origens: [], municipiosIbge: [] });
  const [filtros, setFiltros] = useState(DEFAULT_FILTROS);
  const [carregando, setCarregando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [simulando, setSimulando] = useState(false);
  const [erro, setErro] = useState('');
  const [feedback, setFeedback] = useState('');
  const [importMeta, setImportMeta] = useState(null);
  const [saveMeta, setSaveMeta] = useState(null);
  const [folderMeta, setFolderMeta] = useState(null);
  const [supabaseDiag, setSupabaseDiag] = useState(null);
  const [mostrarPendencias, setMostrarPendencias] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [simProgress, setSimProgress] = useState(null);
  const [detalheAberto, setDetalheAberto] = useState(null);
  const [inputKey, setInputKey] = useState(fileInputKey());
  const ibgeCacheRef = useRef(new Map());
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  async function carregarBase(filtrosCarga = filtros) {
    setCarregando(true);
    setErro('');
    try {
      const data = await listarRealizadoCtes({
        inicio: filtrosCarga.inicio,
        fim: filtrosCarga.fim,
        canal: filtrosCarga.canal,
        origem: filtrosCarga.origem,
        ufDestino: filtrosCarga.ufDestino,
        limit: 15000,
        incluirSemCanal: true,
      });
      setRows(data);
      const comCanal = data.filter(hasCanalRealizado).length;
      const semCanal = data.length - comCanal;
      setFeedback(
        data.length
          ? `Base realizada carregada com ${data.length.toLocaleString('pt-BR')} CT-e(s): ${comCanal.toLocaleString('pt-BR')} com canal e ${semCanal.toLocaleString('pt-BR')} pendência(s) sem canal.`
          : 'Nenhum CT-e encontrado para os filtros atuais.'
      );
    } catch (error) {
      setErro(error.message || 'Erro ao carregar base realizada.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    let ativo = true;

    async function init() {
      try {
        const [opcoesDb, municipios] = await Promise.all([
          carregarOpcoesSimuladorDb().catch(() => null),
          carregarMunicipiosIbgeDb().catch(() => []),
        ]);
        if (!ativo) return;
        setOpcoes({
          transportadoras: opcoesDb?.transportadoras || transportadoras.map((item) => item.nome).filter(Boolean),
          canais: opcoesDb?.canais || [],
          origens: opcoesDb?.origens || [],
          municipiosIbge: municipios?.length ? municipios : opcoesDb?.municipiosIbge || [],
        });
        await carregarBase(DEFAULT_FILTROS);
      } catch (error) {
        if (ativo) setErro(error.message || 'Erro ao iniciar base realizada.');
      }
    }

    init();
    return () => {
      ativo = false;
    };
  }, []);

  const rowsValidas = useMemo(() => rows.filter(hasCanalRealizado), [rows]);
  const rowsSemCanal = useMemo(() => rows.filter((row) => !hasCanalRealizado(row)), [rows]);
  const rowsFiltradas = useMemo(() => filtrarRows(rowsValidas, filtros), [rowsValidas, filtros]);
  const pendenciasFiltradas = useMemo(() => filtrarRows(rowsSemCanal, { ...filtros, canal: '' }), [rowsSemCanal, filtros]);
  const stats = useMemo(() => statsRealizado(rowsFiltradas), [rowsFiltradas]);
  const canaisDisponiveis = useMemo(() => {
    const fromRows = rows.map((item) => item.canal).filter(Boolean);
    const canaisAgrupados = [...new Set([...(opcoes.canais || []), ...fromRows]
      .map(categoriaCanalTela)
      .filter(Boolean))];
    const ordem = ['ATACADO', 'B2C', 'INTERCOMPANY', 'REVERSA'];
    return canaisAgrupados.sort((a, b) => {
      const ia = ordem.indexOf(a);
      const ib = ordem.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.localeCompare(b, 'pt-BR');
    });
  }, [opcoes.canais, rows]);
  const origensDisponiveis = useMemo(() => {
    const fromRows = rows.map((item) => item.cidadeOrigem).filter(Boolean);
    return [...new Set([...(opcoes.origens || []), ...fromRows])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [opcoes.origens, rows]);
  const transportadorasDisponiveis = useMemo(() => {
    const fromRows = rows.map((item) => item.transportadora).filter(Boolean);
    return [...new Set([...(opcoes.transportadoras || []), ...transportadoras.map((item) => item.nome), ...fromRows])]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [opcoes.transportadoras, rows, transportadoras]);

  const cidadePorIbge = useMemo(() => buildCidadePorIbge(opcoes.municipiosIbge), [opcoes.municipiosIbge]);
  const ibgePorCidade = useMemo(() => buildIbgePorCidade(opcoes.municipiosIbge), [opcoes.municipiosIbge]);

  function alterarFiltro(campo, valor) {
    setFiltros((prev) => ({ ...prev, [campo]: valor }));
    if (resultado) setResultado(null);
  }

  async function diagnosticarSupabase() {
    setErro('');
    setFeedback('Conferindo conexão com o Supabase e tabela realizado_ctes...');
    try {
      const status = await diagnosticarRealizadoSupabaseDb();
      setSupabaseDiag(status);
      if (!status.ok) {
        setErro(status.erro || 'Não foi possível confirmar o Supabase.');
        return status;
      }
      setFeedback(
        `Supabase conectado: ${status.host || 'projeto não identificado'} • total ${Number(status.total || 0).toLocaleString('pt-BR')} • com canal ${Number(status.comCanal || 0).toLocaleString('pt-BR')} • sem canal ${Number(status.semCanal || 0).toLocaleString('pt-BR')}${status.rpcOk ? ' • RPC OK' : ' • RPC pendente'}${status.listagemRpcOk ? ' • listagem OK' : ' • listagem pendente'}.`);
      return status;
    } catch (error) {
      const status = { ok: false, erro: error.message || 'Erro ao diagnosticar Supabase.' };
      setSupabaseDiag(status);
      setErro(status.erro);
      return status;
    }
  }

  async function importarArquivoRealizado(file, options = {}) {
    const { diagnosticoPreValidado = null, atualizarTelaFinal = true, origem = 'arquivo' } = options;
    const nomeExibicao = file.webkitRelativePath || file.name;

    setErro('');
    setResultado(null);
    setFeedback(`Arquivo selecionado: ${nomeExibicao} (${(file.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB). Lendo a planilha...`);

    const { registros, meta } = await parseRealizadoCtesFile(file);
    setImportMeta({ ...meta, arquivo: nomeExibicao });

    if (!registros.length) {
      throw new Error(
        `Nenhum CT-e válido encontrado em ${nomeExibicao}, aba ${meta.aba || 'selecionada'}. Linhas lidas: ${Number(meta.linhasOriginais || 0).toLocaleString('pt-BR')}. Confira se existem as colunas Chave CTE, Valor CTE, Valor NF e as cidades/UFs.`
      );
    }

    const avisoRef = meta.refFoiCorrigida
      ? ` A referência interna da aba veio como ${meta.refOriginal || 'vazia'} e foi corrigida para ${meta.refCorrigida}.`
      : '';

    setFeedback(
      `Arquivo lido (${origem}): ${nomeExibicao} • aba ${meta.aba}: ${meta.registrosValidos.toLocaleString('pt-BR')} CT-e(s) válidos de ${meta.linhasOriginais.toLocaleString('pt-BR')} linha(s).${avisoRef} Salvando no Supabase...`
    );

    const diagnostico = diagnosticoPreValidado || await diagnosticarSupabase();
    if (!diagnostico?.ok) {
      throw new Error(diagnostico?.erro || 'Supabase não confirmado. A importação foi bloqueada para não ficar só local.');
    }

    const save = await salvarRealizadoCtes(registros, {
      chunkSize: 250,
      requireSupabase: true,
      onProgress: ({ salvos, confirmados, total, modo, metodo }) => {
        const modoTexto = modo === 'local' ? 'local' : `no Supabase${metodo ? ` via ${metodo}` : ''}`;
        const confirmacaoTexto = confirmados ? ` • confirmados: ${Number(confirmados).toLocaleString('pt-BR')}` : '';
        setFeedback(
          `Salvando ${nomeExibicao} ${modoTexto}: ${Number(salvos || 0).toLocaleString('pt-BR')} de ${Number(total || 0).toLocaleString('pt-BR')} CT-e(s)${confirmacaoTexto}...`
        );
      },
    });
    setSaveMeta(save);

    if (!save.inseridos || !save.confirmados) {
      throw new Error(`A planilha ${nomeExibicao} foi lida, mas o Supabase não confirmou nenhuma gravação. Confira se a tabela realizado_ctes existe, se o script atualizado foi rodado e se as variáveis do Vercel apontam para o projeto correto.`);
    }

    if (atualizarTelaFinal) {
      setFeedback(
        `Importação concluída no Supabase: ${Number(save.confirmados || 0).toLocaleString('pt-BR')} CT-e(s) confirmados de ${nomeExibicao}. Projeto: ${save.projeto || diagnostico?.host || '—'} • método: ${save.metodo || '—'}. Atualizando a tela...`
      );
      setInputKey(fileInputKey());

      const dataAtualizada = await listarRealizadoCtes({ limit: 15000, incluirSemCanal: true });
      if (dataAtualizada.length) {
        setRows(dataAtualizada);
        setFeedback(
          `Base realizada carregada do Supabase com ${dataAtualizada.length.toLocaleString('pt-BR')} CT-e(s). Última importação confirmada: ${Number(save.confirmados || 0).toLocaleString('pt-BR')} CT-e(s). Projeto: ${save.projeto || diagnostico?.host || '—'} • método: ${save.metodo || '—'}.`
        );
      } else {
        throw new Error('O Supabase confirmou a gravação, mas a consulta da base voltou vazia. Isso indica política de leitura/RLS ou o front apontando para outra base. Rode o script atualizado e confira o projeto do Supabase usado no Vercel.');
      }
    }

    return { registros, meta, save, arquivo: nomeExibicao };
  }

  async function onImportarArquivo(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportando(true);
    setErro('');
    setFolderMeta(null);
    setImportMeta(null);
    setSaveMeta(null);

    try {
      await importarArquivoRealizado(file, { origem: 'arquivo único' });
    } catch (error) {
      setErro(error.message || 'Erro ao importar realizado.');
    } finally {
      setImportando(false);
      if (event.target) event.target.value = '';
    }
  }

  async function onImportarPasta(event) {
    const files = Array.from(event.target.files || []).filter(isArquivoRealizadoImportavel);
    if (!files.length) {
      setErro('Nenhum arquivo .xlsx, .xls ou .csv encontrado na pasta selecionada.');
      if (event.target) event.target.value = '';
      return;
    }

    const history = lerHistoricoPastaRealizado();
    const novos = files.filter((file) => !history.has(getArquivoAssinatura(file)));
    const ignorados = files.length - novos.length;

    setImportando(true);
    setErro('');
    setResultado(null);
    setImportMeta(null);
    setSaveMeta(null);
    setFolderMeta({ total: files.length, novos: novos.length, ignorados, processados: 0, importados: 0, confirmados: 0, erros: [] });

    try {
      if (!novos.length) {
        setFeedback(`Pasta selecionada com ${files.length.toLocaleString('pt-BR')} arquivo(s), mas todos já constam no histórico deste navegador. Nada novo para subir.`);
        return;
      }

      const diagnostico = await diagnosticarSupabase();
      if (!diagnostico?.ok) {
        throw new Error(diagnostico?.erro || 'Supabase não confirmado. A importação da pasta foi bloqueada.');
      }

      let importados = 0;
      let confirmados = 0;
      const erros = [];

      for (let index = 0; index < novos.length; index += 1) {
        const file = novos[index];
        const nomeExibicao = file.webkitRelativePath || file.name;
        setFolderMeta({ total: files.length, novos: novos.length, ignorados, processados: index, importados, confirmados, erros });
        setFeedback(`Importando pasta: arquivo ${index + 1} de ${novos.length} • ${nomeExibicao}`);
        await nextFrame();

        try {
          const result = await importarArquivoRealizado(file, {
            diagnosticoPreValidado: diagnostico,
            atualizarTelaFinal: false,
            origem: 'pasta',
          });
          importados += 1;
          confirmados += Number(result?.save?.confirmados || 0);
          history.add(getArquivoAssinatura(file));
          salvarHistoricoPastaRealizado(history);
        } catch (errorArquivo) {
          erros.push({ arquivo: nomeExibicao, erro: errorArquivo.message || 'Erro ao importar arquivo.' });
        }
      }

      setFolderMeta({ total: files.length, novos: novos.length, ignorados, processados: novos.length, importados, confirmados, erros });
      setFeedback(`Importação da pasta concluída: ${importados.toLocaleString('pt-BR')} arquivo(s) novo(s) importado(s), ${ignorados.toLocaleString('pt-BR')} já conhecido(s), ${confirmados.toLocaleString('pt-BR')} CT-e(s) confirmados${erros.length ? ` e ${erros.length.toLocaleString('pt-BR')} arquivo(s) com erro` : ''}. Atualizando base...`);
      setInputKey(fileInputKey());
      await carregarBase(filtros);
    } catch (error) {
      setErro(error.message || 'Erro ao importar pasta do realizado.');
    } finally {
      setImportando(false);
      if (event.target) event.target.value = '';
    }
  }

  async function limparBase() {
    const totalAtual = rows.length;
    const texto = window.prompt(
      `ATENÇÃO: esta ação pode apagar toda a base realizada do Supabase.\n\nBase carregada na tela: ${totalAtual.toLocaleString('pt-BR')} CT-e(s).\n\nPara confirmar, digite exatamente: APAGAR BASE REALIZADA`
    );
    if (texto !== 'APAGAR BASE REALIZADA') {
      setFeedback('Limpeza cancelada. Nenhum CT-e foi excluído.');
      return;
    }

    setCarregando(true);
    setErro('');
    try {
      const resp = await excluirRealizadoCtes({ confirmacao: 'APAGAR BASE REALIZADA' });
      setRows([]);
      setResultado(null);
      setFeedback(`Base realizada limpa com segurança. Registros removidos: ${Number(resp?.removidos || 0).toLocaleString('pt-BR')}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao limpar base realizada.');
    } finally {
      setCarregando(false);
    }
  }

  async function resolverIbgeDestino(row) {
    if (row.ibgeDestino) return row.ibgeDestino;

    const destino = splitCidadeUfTela(row.cidadeDestino, row.ufDestino);
    const localKey = buildCidadeKey(destino.cidade, destino.uf);
    const semUfKey = buildCidadeKey(destino.cidade);
    const cachedKey = [row.cepDestino || '', localKey].join('|');

    if (ibgeCacheRef.current.has(cachedKey)) return ibgeCacheRef.current.get(cachedKey);

    const local = ibgePorCidade.get(localKey) || ibgePorCidade.get(semUfKey);
    if (local) {
      ibgeCacheRef.current.set(cachedKey, local);
      return local;
    }

    const tentativas = [
      destino.cidade && destino.uf ? [destino.cidade, destino.uf].join('/') : '',
      destino.cidade,
      row.cepDestino,
    ].filter(Boolean);

    for (const busca of tentativas) {
      try {
        const resolvido = await resolverDestinoIbgeDb(busca);
        const ibge = resolvido?.ibge || '';
        if (ibge) {
          ibgeCacheRef.current.set(cachedKey, ibge);
          return ibge;
        }
      } catch {
        // tenta a próxima forma de localização
      }
    }

    ibgeCacheRef.current.set(cachedKey, '');
    return '';
  }


  async function enriquecerComIbge(registros = []) {
    const enriquecidos = [];
    const total = registros.length;
    for (let index = 0; index < registros.length; index += 1) {
      const row = registros[index];
      const ibgeDestino = await resolverIbgeDestino(row);
      enriquecidos.push({ ...row, ibgeDestino });

      const atual = index + 1;
      const deveAtualizarTela = total <= 50 || atual % 100 === 0 || atual === total;
      if (deveAtualizarTela) {
        const percentualIbge = Math.min(30, 10 + Math.round((atual / Math.max(total, 1)) * 20));
        setSimProgress({
          etapa: 'Resolvendo destinos/IBGE',
          atual,
          total,
          percentual: percentualIbge,
          mensagem: `${atual.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} CT-e(s) com destino analisado`,
        });
        setFeedback(`Resolvendo destinos do realizado: ${atual.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} CT-e(s)...`);
        await nextFrame();
      }
    }
    return enriquecidos;
  }

  async function excluirPendenciasSemCanal() {
    const total = rowsSemCanal.length;
    if (!total) {
      setFeedback('Não há pendências sem canal para excluir.');
      return;
    }

    const texto = window.prompt(
      `ATENÇÃO: você está prestes a excluir ${total.toLocaleString('pt-BR')} CT-e(s) sem canal.\n\nAntes de apagar, revise em Avaliar pendências.\n\nPara confirmar, digite exatamente: EXCLUIR SEM CANAL`
    );
    if (texto !== 'EXCLUIR SEM CANAL') {
      setFeedback('Exclusão de pendências cancelada. Nenhum CT-e foi excluído.');
      return;
    }

    setCarregando(true);
    setErro('');
    try {
      const resp = await excluirRealizadoCtes({ somenteSemCanal: true, confirmacao: 'EXCLUIR SEM CANAL' });
      const removidos = Number(resp?.removidos ?? total);
      setFeedback(`${removidos.toLocaleString('pt-BR')} pendência(s) sem canal excluída(s). Atualizando base...`);
      await carregarBase(filtros);
    } catch (error) {
      setErro(error.message || 'Erro ao excluir pendências sem canal.');
    } finally {
      setCarregando(false);
    }
  }

  async function onSimular() {
    if (!filtros.transportadora) {
      setErro('Escolha uma transportadora para simular no realizado.');
      return;
    }
    if (!rowsFiltradas.length) {
      setErro('Não há CT-e realizado para simular nos filtros atuais.');
      return;
    }

    setSimulando(true);
    setErro('');
    setResultado(null);

    const limite = rowsFiltradas.slice(0, 6000);
    const totalSimular = limite.length;

    setSimProgress({
      etapa: 'Preparando simulação',
      atual: 0,
      total: totalSimular,
      percentual: 0,
      mensagem: `Preparando ${totalSimular.toLocaleString('pt-BR')} CT-e(s) filtrado(s)...`,
    });
    setFeedback(`Preparando ${totalSimular.toLocaleString('pt-BR')} CT-e(s) para simular no realizado...`);
    await nextFrame();

    try {
      if (rowsFiltradas.length > limite.length) {
        setFeedback(`Simulando os primeiros ${limite.length.toLocaleString('pt-BR')} CT-e(s) dos filtros para manter a tela leve.`);
      }

      setSimProgress({
        etapa: 'Resolvendo destinos/IBGE',
        atual: 0,
        total: totalSimular,
        percentual: 10,
        mensagem: `Cruzando cidade/UF/CEP dos ${totalSimular.toLocaleString('pt-BR')} CT-e(s) com IBGE...`,
      });
      await nextFrame();

      const registrosComIbge = await enriquecerComIbge(limite);
      const destinosIbge = Array.from(new Set(
        registrosComIbge
          .map((row) => String(row.ibgeDestino || '').replace(/\D/g, ''))
          .filter(Boolean)
      ));

      setSimProgress({
        etapa: 'Buscando malha filtrada',
        atual: destinosIbge.length,
        total: Math.max(destinosIbge.length, 1),
        percentual: 32,
        mensagem: destinosIbge.length
          ? `Buscando tabelas somente da origem/filtro e ${destinosIbge.length.toLocaleString('pt-BR')} destino(s) encontrado(s)...`
          : 'Nenhum IBGE foi encontrado nos CT-e(s); buscando pela origem/filtro para diagnosticar fora da malha...',
      });
      setFeedback(
        destinosIbge.length
          ? `Buscando malha filtrada: origem ${filtros.origem || 'todas'}, canal ${filtros.canal || 'todos'} e ${destinosIbge.length.toLocaleString('pt-BR')} destino(s).`
          : 'Nenhum destino com IBGE encontrado. A simulação vai tentar diagnosticar pela origem e canal.'
      );
      await nextFrame();

      const baseOnline = await buscarBaseSimulacaoDb({
        nomeTransportadora: filtros.transportadora,
        canal: filtros.canal,
        origem: filtros.origem,
        ufDestino: filtros.ufDestino,
        destinoCodigos: destinosIbge,
      });
      const base = baseOnline?.length ? baseOnline : transportadoras;

      setSimProgress((prev) => ({
        ...(prev || {}),
        etapa: 'Base carregada',
        percentual: 35,
        mensagem: `Malha carregada com ${Number(base?.length || 0).toLocaleString('pt-BR')} transportadora(s)/registro(s) para os filtros atuais.`,
      }));
      await nextFrame();

      if (!base?.length) {
        setErro('Não encontrei tabela/base de simulação para essa transportadora, origem, canal e destinos filtrados. Confira se a transportadora tem origem e rotas cadastradas para esse cenário.');
        return;
      }

      setSimProgress({
        etapa: 'Calculando fretes',
        atual: 0,
        total: totalSimular,
        percentual: 40,
        mensagem: 'Calculando frete simulado por CT-e e comparando com o valor realizado...',
      });
      setFeedback('Calculando frete simulado por CT-e e comparando com o valor realizado...');
      await nextFrame();

      const analise = await simularRealizadoPorTransportadoraAsync({
        transportadoras: base,
        realizados: registrosComIbge,
        nomeTransportadora: filtros.transportadora,
        filtros,
        cidadePorIbge,
        chunkSize: totalSimular <= 50 ? 1 : 25,
        onProgress: ({ atual, total, etapa }) => {
          const percentualInterno = calcularPercentualProgresso(atual, total);
          const percentual = Math.min(98, 40 + Math.round(percentualInterno * 0.58));
          const mensagem = `${Number(atual || 0).toLocaleString('pt-BR')} de ${Number(total || 0).toLocaleString('pt-BR')} CT-e(s) processados`;
          setSimProgress({
            etapa: etapa || 'Calculando fretes',
            atual,
            total,
            percentual,
            mensagem,
          });
          setFeedback(`Simulação em andamento: ${mensagem}.`);
        },
      });

      setSimProgress({
        etapa: 'Concluído',
        atual: totalSimular,
        total: totalSimular,
        percentual: 100,
        mensagem: `Simulação concluída para ${filtros.transportadora}.`,
      });
      setResultado(analise);
      setFeedback(`Simulação concluída para ${filtros.transportadora}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao simular realizado.');
    } finally {
      setSimulando(false);
      setTimeout(() => setSimProgress(null), 2500);
    }
  }

  return (
    <div className="page-shell realizado-page">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">AMD Log • Base realizada</div>
          <h1>Realizado CT-e</h1>
          <p>
            Suba os CT-e(s) emitidos mês a mês ou dia a dia e compare o frete pago com uma transportadora simulada nas rotas em que ela participa.
          </p>
        </div>
        <div className="actions-right wrap">
          <button className="btn-secondary" onClick={diagnosticarSupabase} disabled={carregando || importando || simulando}>
            Diagnosticar Supabase
          </button>
          <button className="btn-secondary" onClick={() => carregarBase(filtros)} disabled={carregando || importando || simulando}>
            {carregando ? 'Atualizando...' : 'Atualizar base'}
          </button>
          <button className="btn-danger" onClick={limparBase} disabled={carregando || importando || simulando || !rows.length}>
            Zerar base realizada
          </button>
        </div>
      </div>

      {erro ? <div className="sim-alert">{erro}</div> : null}
      {feedback ? <div className="sim-alert info">{feedback}</div> : null}

      {simulando && simProgress ? (
        <div className="sim-alert info">
          <div className="sim-parametros-header">
            <div>
              <strong>Andamento da simulação: {simProgress.etapa}</strong>
              <p>{simProgress.mensagem}</p>
            </div>
            <span>{Number(simProgress.percentual || 0).toLocaleString('pt-BR')}%</span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden', marginTop: 10 }}>
            <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, Number(simProgress.percentual || 0)))}%`, borderRadius: 999, background: '#9153F0', transition: 'width 180ms ease' }} />
          </div>
        </div>
      ) : null}

      {supabaseDiag ? (
        <div className={supabaseDiag.ok ? 'sim-alert success' : 'sim-alert'}>
          <strong>Diagnóstico Supabase:</strong> {supabaseDiag.host || 'sem projeto'} • tabela: {supabaseDiag.tabelaOk ? 'OK' : 'não confirmada'} • total: {formatDiagCount(supabaseDiag.total, supabaseDiag.contagemExata ? '' : ' estimado')} • com canal: {formatDiagCount(supabaseDiag.comCanal)} • sem canal: {formatDiagCount(supabaseDiag.semCanal)} • importar: {supabaseDiag.rpcOk ? 'OK' : 'pendente'} • puxar: {supabaseDiag.listagemRpcOk ? 'OK' : 'pendente'}
          {supabaseDiag.erro ? <span> • {supabaseDiag.erro}</span> : null}
        </div>
      ) : null}

      <div className="summary-strip">
        <SummaryCard title="CT-e(s) válidos" value={stats.ctes.toLocaleString('pt-BR')} subtitle={`${formatDateBr(stats.periodoInicio)} até ${formatDateBr(stats.periodoFim)}`} />
        <SummaryCard title="Frete realizado" value={formatCurrency(stats.valorCte)} subtitle="Soma do Valor CT-e com canal" />
        <SummaryCard title="Valor NF" value={formatCurrency(stats.valorNF)} subtitle="Base para % de frete" />
        <SummaryCard title="Pendências sem canal" value={rowsSemCanal.length.toLocaleString('pt-BR')} subtitle="fora da simulação até avaliar" />
      </div>

      {rowsSemCanal.length ? (
        <section className="sim-card top-space">
          <div className="sim-parametros-header">
            <div>
              <h2>Pendências do realizado</h2>
              <p>{rowsSemCanal.length.toLocaleString('pt-BR')} CT-e(s) vieram sem canal. Eles ficam fora da simulação até você revisar ou excluir.</p>
            </div>
            <div className="actions-right wrap">
              <button className="btn-secondary" onClick={() => setMostrarPendencias((prev) => !prev)}>
                {mostrarPendencias ? 'Ocultar pendências' : 'Avaliar pendências'}
              </button>
              <button className="btn-danger" onClick={excluirPendenciasSemCanal} disabled={carregando || importando || simulando}>
                Excluir sem canal
              </button>
            </div>
          </div>

          {mostrarPendencias ? (
            <div className="sim-table-wrap top-space">
              <table className="sim-table">
                <thead><tr><th>Emissão</th><th>CT-e</th><th>Transportadora</th><th>Origem</th><th>Destino</th><th>Valor CT-e</th><th>Valor NF</th><th>Arquivo</th></tr></thead>
                <tbody>
                  {pendenciasFiltradas.slice(0, 80).map((item) => (
                    <tr key={item.chaveCte || `${item.numeroCte}-${item.emissao}-sem-canal`}>
                      <td>{formatDateBr(item.emissao)}</td>
                      <td>{item.numeroCte || item.chaveCte?.slice(-8)}</td>
                      <td>{item.transportadora || '—'}</td>
                      <td>{item.cidadeOrigem}/{item.ufOrigem}</td>
                      <td>{item.cidadeDestino}/{item.ufDestino}</td>
                      <td>{formatCurrency(item.valorCte)}</td>
                      <td>{formatCurrency(item.valorNF)}</td>
                      <td>{item.arquivoOrigem || '—'}</td>
                    </tr>
                  ))}
                  {!pendenciasFiltradas.length ? <tr><td colSpan="8">Nenhuma pendência sem canal nos filtros atuais.</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="feature-grid three">
        <section className="panel-card">
          <div>
            <div className="panel-title">1. Importar realizado</div>
            <p>Modelo esperado: planilha com aba Registros e colunas como Transportadora, Emissão, Chave CTE, Valor CTE, Peso, Valor NF, CEP/Cidade origem e destino.</p>
          </div>
          <input key={inputKey} ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={onImportarArquivo} disabled={importando || simulando} />
          <input ref={folderInputRef} type="file" accept=".xlsx,.xls,.csv" multiple webkitdirectory="" directory="" onChange={onImportarPasta} disabled={importando || simulando} style={{ display: 'none' }} />
          <button className="btn-primary" onClick={() => fileInputRef.current?.click()} disabled={importando || simulando}>
            {importando ? 'Importando...' : 'Selecionar arquivo realizado'}
          </button>
          <button className="btn-secondary" onClick={() => folderInputRef.current?.click()} disabled={importando || simulando}>
            Mapear pasta e subir novos
          </button>
          <p className="muted-text">A pasta é selecionada pelo navegador. O sistema ignora arquivos já importados neste navegador e o Supabase evita duplicar CT-e pela chave.</p>
          {folderMeta ? (
            <div className="import-meta-box">
              <strong>Pasta:</strong> {Number(folderMeta.total || 0).toLocaleString('pt-BR')} arquivo(s) encontrados • {Number(folderMeta.novos || 0).toLocaleString('pt-BR')} novo(s) • {Number(folderMeta.ignorados || 0).toLocaleString('pt-BR')} já conhecido(s) • {Number(folderMeta.processados || 0).toLocaleString('pt-BR')} processado(s)
              {folderMeta.confirmados ? <span> • {Number(folderMeta.confirmados || 0).toLocaleString('pt-BR')} CT-e(s) confirmados</span> : null}
              {folderMeta.erros?.length ? <span> • {folderMeta.erros.length.toLocaleString('pt-BR')} erro(s)</span> : null}
            </div>
          ) : null}
          {folderMeta?.erros?.length ? (
            <div className="import-meta-box danger">
              <strong>Arquivos com erro:</strong> {folderMeta.erros.slice(0, 3).map((item) => `${item.arquivo}: ${item.erro}`).join(' | ')}
            </div>
          ) : null}
          {importMeta ? (
            <div className="import-meta-box">
              <strong>Última leitura:</strong> {importMeta.arquivo ? `${importMeta.arquivo} • ` : ''}aba {importMeta.aba || '—'} • {Number(importMeta.registrosValidos || 0).toLocaleString('pt-BR')} CT-e(s) válidos
              {importMeta.refFoiCorrigida ? <span> • intervalo corrigido de {importMeta.refOriginal || 'vazio'} para {importMeta.refCorrigida}</span> : null}
            </div>
          ) : null}
          {saveMeta ? (
            <div className="import-meta-box success">
              <strong>Supabase:</strong> {String(saveMeta.modo || '').toUpperCase()} • {Number(saveMeta.confirmados || 0).toLocaleString('pt-BR')} CT-e(s) confirmados • método: {saveMeta.metodo || '—'} • projeto: {saveMeta.projeto || '—'}
            </div>
          ) : null}
        </section>

        <section className="panel-card">
          <div>
            <div className="panel-title">2. Filtrar período/base</div>
            <p>Use os filtros para avaliar um mês, uma origem, um canal ou uma UF específica.</p>
          </div>
          <div className="form-grid">
            <div className="field"><label>Data inicial</label><input type="date" value={filtros.inicio} onChange={(e) => alterarFiltro('inicio', e.target.value)} /></div>
            <div className="field"><label>Data final</label><input type="date" value={filtros.fim} onChange={(e) => alterarFiltro('fim', e.target.value)} /></div>
            <div className="field"><label>Canal</label><select value={filtros.canal} onChange={(e) => alterarFiltro('canal', e.target.value)}><option value="">Todos</option>{canaisDisponiveis.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
            <div className="field"><label>UF destino</label><input value={filtros.ufDestino} onChange={(e) => alterarFiltro('ufDestino', e.target.value.toUpperCase().slice(0, 2))} placeholder="Ex.: SP" /></div>
          </div>
          <div className="field">
            <label>Origem</label>
            <input list="origens-realizado-list" value={filtros.origem} onChange={(e) => alterarFiltro('origem', e.target.value)} placeholder="Todas ou digite a origem" />
            <datalist id="origens-realizado-list">{origensDisponiveis.map((item) => <option key={item} value={item} />)}</datalist>
          </div>
        </section>

        <section className="panel-card">
          <div>
            <div className="panel-title">3. Simular transportadora</div>
            <p>A análise considera apenas CT-e(s) onde a transportadora possui tabela para a mesma origem, destino e canal.</p>
          </div>
          <div className="field">
            <label>Transportadora simulada</label>
            <input list="transportadoras-realizado-list" value={filtros.transportadora} onChange={(e) => alterarFiltro('transportadora', e.target.value)} placeholder="Ex.: Camilo dos Santos" />
            <datalist id="transportadoras-realizado-list">{transportadorasDisponiveis.map((item) => <option key={item} value={item} />)}</datalist>
          </div>
          <button className="btn-primary full" onClick={onSimular} disabled={simulando || importando || !rowsFiltradas.length}>
            {simulando ? 'Simulando realizado...' : 'Simular no realizado'}
          </button>
        </section>
      </div>

      {resultado ? (
        <section className="sim-card">
          <div className="sim-parametros-header">
            <div>
              <h2>Resultado no realizado</h2>
              <p>Transportadora simulada: <strong>{filtros.transportadora}</strong></p>
            </div>
            <button className="btn-secondary" onClick={() => exportarCsvAnalise(resultado, filtros.transportadora)}>
              Exportar CSV
            </button>
          </div>

          <div className="sim-analise-resumo top-space">
            <div><span>CT-e(s) avaliados</span><strong>{resultado.resumo.ctesComSimulacao.toLocaleString('pt-BR')}</strong></div>
            <div><span>CT-e(s) que ganharia</span><strong>{resultado.resumo.ctesGanharia.toLocaleString('pt-BR')}</strong></div>
            <div><span>Aderência no realizado</span><strong>{formatPercent(resultado.resumo.aderencia)}</strong></div>
            <div><span>Faturamento se vencedora</span><strong>{formatCurrency(resultado.resumo.faturamentoGanhador)}</strong></div>
            <div><span>Economia se vencedora</span><strong>{formatCurrency(resultado.resumo.economiaGanhador)}</strong></div>
            <div><span>Impacto usando em tudo que participa</span><strong>{formatCurrency(resultado.resumo.impactoLiquido)}</strong></div>
            <div><span>% frete simulado</span><strong>{formatPercent(resultado.resumo.percentualSimulado)}</strong></div>
            <div><span>Fora da malha</span><strong>{resultado.resumo.ctesForaMalha.toLocaleString('pt-BR')}</strong></div>
          </div>

          {resultado.resumo.porUf?.length ? (
            <div className="sim-parametros-box top-space">
              <div className="sim-parametros-header"><strong>Resumo por UF destino</strong><span>{resultado.resumo.porUf.length} UF(s)</span></div>
              <div className="sim-table-wrap">
                <table className="sim-table">
                  <thead><tr><th>UF</th><th>CT-e(s)</th><th>Ganharia</th><th>Aderência</th><th>Realizado</th><th>Simulado</th><th>Economia</th></tr></thead>
                  <tbody>
                    {resultado.resumo.porUf.slice(0, 12).map((item) => (
                      <tr key={item.uf}>
                        <td>{item.uf}</td>
                        <td>{item.ctes}</td>
                        <td>{item.ganharia}</td>
                        <td>{formatPercent(item.aderencia)}</td>
                        <td>{formatCurrency(item.valorRealizado)}</td>
                        <td>{formatCurrency(item.valorSimulado)}</td>
                        <td>{formatCurrency(item.economia)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {resultado.foraMalha?.length ? (
            <div className="sim-parametros-box top-space">
              <div className="sim-parametros-header"><strong>Fora da malha / não localizado</strong><span>{resultado.foraMalha.length.toLocaleString('pt-BR')} CT-e(s)</span></div>
              <p>Mostrando os primeiros casos para identificar se o problema é origem, canal, destino/IBGE ou faixa de peso.</p>
              <div className="sim-table-wrap">
                <table className="sim-table">
                  <thead><tr><th>CT-e</th><th>Canal</th><th>Origem</th><th>Destino</th><th>Peso</th><th>Motivo</th></tr></thead>
                  <tbody>
                    {resultado.foraMalha.slice(0, 20).map((item) => (
                      <tr key={item.id || item.chaveCte || [item.numeroCte, item.emissao, item.cidadeDestino].join('-')}>
                        <td>{item.numeroCte || item.chaveCte?.slice(-8) || '—'}</td>
                        <td>{item.canal || item.canalVendas || item.canais || '—'}</td>
                        <td>{item.cidadeOrigem}/{item.ufOrigem}</td>
                        <td>{item.cidadeDestino}/{item.ufDestino}</td>
                        <td>{formatNumber(Math.max(Number(item.pesoDeclarado) || 0, Number(item.pesoCubado) || 0), 3)}</td>
                        <td>{item.motivo || 'Não localizado na tabela da transportadora simulada.'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="sim-table-wrap">
            <table className="sim-table">
              <thead>
                <tr>
                  <th>CT-e</th>
                  <th>Emissão</th>
                  <th>Realizada</th>
                  <th>Origem → Destino</th>
                  <th>Valor CT-e</th>
                  <th>Simulado</th>
                  <th>Impacto</th>
                  <th>Ranking</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {resultado.detalhes.slice(0, 80).map((item) => (
                  <Fragment key={item.id}>
                    <tr key={item.id}>
                      <td>{item.numeroCte || item.chaveCte?.slice(-8)}</td>
                      <td>{formatDateBr(item.emissao)}</td>
                      <td>{item.transportadoraRealizada}</td>
                      <td>{item.origem} → {item.cidadeDestino}/{item.ufDestino}</td>
                      <td>{formatCurrency(item.valorRealizado)}</td>
                      <td>{formatCurrency(item.valorSimulado)}</td>
                      <td className={item.impacto >= 0 ? 'positivo' : 'negativo'}>{formatCurrency(item.impacto)}</td>
                      <td>{item.ranking}º {item.ganharia ? '• ganharia' : ''}</td>
                      <td><button className="link-btn" onClick={() => setDetalheAberto(detalheAberto === item.id ? null : item.id)}>Detalhe</button></td>
                    </tr>
                    {detalheAberto === item.id ? (
                      <tr className="sim-detalhe-row">
                        <td colSpan="9">
                          <div className="sim-detalhes-grid">
                            <div><span>Valor NF</span><strong>{formatCurrency(item.valorNF)}</strong></div>
                            <div><span>% realizado</span><strong>{formatPercent(item.percentualRealizado)}</strong></div>
                            <div><span>% simulado</span><strong>{formatPercent(item.percentualSimulado)}</strong></div>
                            <div><span>Peso considerado</span><strong>{formatNumber(item.peso, 3)} kg</strong></div>
                            <div><span>Líder da rota</span><strong>{item.liderTransportadora || '—'}</strong></div>
                            <div><span>Frete substituta</span><strong>{formatCurrency(item.freteSubstituta)}</strong></div>
                            <div><span>Ranking da atual na tabela</span><strong>{item.rankingTransportadoraAtual ? `${item.rankingTransportadoraAtual}º` : '—'}</strong></div>
                            <div><span>Atual pela tabela</span><strong>{item.valorTabelaTransportadoraAtual ? formatCurrency(item.valorTabelaTransportadoraAtual) : '—'}</strong></div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="table-card">
        <div className="sim-parametros-header">
          <div>
            <div className="panel-title">Amostra da base realizada com canal</div>
            <p>Mostrando até 50 CT-e(s) válidos conforme os filtros atuais. Registros sem canal ficam na área de pendências.</p>
          </div>
          <span className="status-pill">{rowsFiltradas.length.toLocaleString('pt-BR')} linha(s)</span>
        </div>
        <div className="sim-table-wrap">
          <table className="sim-table">
            <thead><tr><th>Emissão</th><th>CT-e</th><th>Transportadora</th><th>Canal</th><th>Origem</th><th>Destino</th><th>Peso</th><th>Valor CT-e</th><th>Valor NF</th></tr></thead>
            <tbody>
              {rowsFiltradas.slice(0, 50).map((item) => (
                <tr key={item.chaveCte || `${item.numeroCte}-${item.emissao}`}>
                  <td>{formatDateBr(item.emissao)}</td>
                  <td>{item.numeroCte || item.chaveCte?.slice(-8)}</td>
                  <td>{item.transportadora}</td>
                  <td>{item.canal || '—'}</td>
                  <td>{item.cidadeOrigem}/{item.ufOrigem}</td>
                  <td>{item.cidadeDestino}/{item.ufDestino}</td>
                  <td>{formatNumber(Math.max(Number(item.pesoDeclarado) || 0, Number(item.pesoCubado) || 0), 3)}</td>
                  <td>{formatCurrency(item.valorCte)}</td>
                  <td>{formatCurrency(item.valorNF)}</td>
                </tr>
              ))}
              {!rowsFiltradas.length ? <tr><td colSpan="9">Nenhum CT-e carregado ainda.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
