import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { buscarBaseSimulacaoDb, carregarBaseCompletaDb, carregarTransportadoraCompletaDb } from '../services/freteDatabaseService';
import { carregarMunicipiosIbgeComFallback } from '../services/ibgeService';
import {
  buscarRealizadoLocalParaSimulacao,
  buscarRealizadoLocalPorMalha,
  diagnosticarRealizadoLocal,
  exportarRealizadoLocal,
  limparRealizadoLocal,
  listarRealizadoLocal,
  resumirRealizadoLocal,
} from '../services/realizadoLocalDb';
import {
  construirEscopoTransportadoraSimulada,
  enriquecerMunicipiosComTabelas,
  simularRealizadoLocalRapido,
} from '../utils/realizadoLocalEngine';
import {
  formatCurrency,
  formatDateBr,
  formatNumber,
  formatPercent,
} from '../utils/realizadoCtes';

const DEFAULT_FILTROS = {
  competencia: '',
  inicio: '',
  fim: '',
  canal: '',
  transportadoraRealizada: '',
  ufOrigem: '',
  ufDestino: '',
  origem: '',
  destino: '',
  pesoMin: '',
  pesoMax: '',
  transportadora: '',
};

function SummaryCard({ title, value, subtitle }) {
  return (
    <div className="summary-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <span>{subtitle}</span>
    </div>
  );
}

function MiniTable({ title, rows = [], tipo, onSelect, activeKey }) {
  return (
    <div className="sim-parametros-box">
      <strong>{title}</strong>
      <div className="mini-list top-space-sm">
        {rows.length ? rows.map((item) => (
          <button
            type="button"
            key={`${tipo || title}-${item.chave}`}
            className={activeKey === `${tipo}:${item.chave}` ? 'mini-list-row clickable active' : 'mini-list-row clickable'}
            onClick={() => onSelect?.(tipo, item)}
          >
            <span>{item.chave}</span>
            <strong>{formatCurrency(item.frete)} • {formatPercent(item.percentual)} • {item.ctes.toLocaleString('pt-BR')} CT-e(s)</strong>
          </button>
        )) : <span>Sem dados para o filtro.</span>}
      </div>
    </div>
  );
}

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function pct(atual, total) {
  const safeTotal = Math.max(Number(total) || 0, 1);
  return Math.min(100, Math.max(0, Math.round((Number(atual || 0) / safeTotal) * 100)));
}

function makeFileKey() {
  return `realizado-local-${Date.now()}`;
}

function rankingLabel(item, rankingCalculado) {
  if (!rankingCalculado) return 'Rápido';
  return item.ranking ? `${item.ranking}º${item.ganharia ? ' • ganharia' : ''}` : '—';
}

function sheetSafeName(value = 'Planilha') {
  return String(value || 'Planilha').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Planilha';
}

function baixarXlsx(nomeArquivo, abas = {}) {
  const workbook = XLSX.utils.book_new();
  Object.entries(abas).forEach(([nome, rows]) => {
    const sheet = XLSX.utils.json_to_sheet(rows || []);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetSafeName(nome));
  });
  XLSX.writeFile(workbook, nomeArquivo);
}

function cteToExportRow(item = {}) {
  return {
    Competencia: item.competencia || '',
    Emissao: item.dataEmissao || '',
    CTE: item.numeroCte || '',
    Chave_CTE: item.chaveCte || '',
    Transportadora_Realizada: item.transportadora || '',
    Canal: item.canal || '',
    Origem: item.cidadeOrigem || '',
    UF_Origem: item.ufOrigem || '',
    IBGE_Origem: item.ibgeOrigem || '',
    Destino: item.cidadeDestino || '',
    UF_Destino: item.ufDestino || '',
    IBGE_Destino: item.ibgeDestino || '',
    Chave_Rota_IBGE: item.chaveRotaIbge || '',
    Peso: item.peso || 0,
    Peso_Declarado: item.pesoDeclarado || 0,
    Peso_Cubado: item.pesoCubado || 0,
    Cubagem: item.cubagem || 0,
    Volumes: item.qtdVolumes || 0,
    Valor_CTE: item.valorCte || 0,
    Valor_NF: item.valorNF || 0,
    IBGE_OK: item.ibgeOk ? 'Sim' : 'Não',
    Arquivo_Origem: item.arquivoOrigem || '',
  };
}

function simToExportRow(item = {}) {
  return {
    CTE: item.numeroCte || '',
    Chave_CTE: item.chaveCte || '',
    Emissao: item.emissao || '',
    Transportadora_Realizada: item.transportadoraRealizada || '',
    Transportadora_Simulada: item.transportadoraSimulada || '',
    Origem: item.origem || '',
    Destino: item.cidadeDestino || '',
    UF_Destino: item.ufDestino || '',
    Canal: item.canal || '',
    Peso: item.peso || 0,
    Valor_NF: item.valorNF || 0,
    Valor_Realizado: item.valorRealizado || 0,
    Valor_Simulado: item.valorSimulado || 0,
    Impacto: item.impacto || 0,
    Percentual_Realizado: item.percentualRealizado || 0,
    Percentual_Simulado: item.percentualSimulado || 0,
    Ranking: item.ranking || '',
    Ganharia: item.ganharia ? 'Sim' : 'Não',
    Lider_Transportadora: item.liderTransportadora || '',
    Frete_Substituta: item.freteSubstituta || 0,
  };
}

export default function RealizadoLocalPage({ transportadoras = [] }) {
  const [filtros, setFiltros] = useState(DEFAULT_FILTROS);
  const [filtrosAplicados, setFiltrosAplicados] = useState(DEFAULT_FILTROS);
  const [municipios, setMunicipios] = useState([]);
  const [ibgeInfo, setIbgeInfo] = useState({ total: 0, fonte: 'não carregado' });
  const [resumo, setResumo] = useState(null);
  const [amostra, setAmostra] = useState([]);
  const [diagnostico, setDiagnostico] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [simulando, setSimulando] = useState(false);
  const [progress, setProgress] = useState(null);
  const [fileKey, setFileKey] = useState(makeFileKey());
  const [detalheAberto, setDetalheAberto] = useState(null);
  const [transportadorasTabela, setTransportadorasTabela] = useState(null);
  const [transportadoraSimuladaCache, setTransportadoraSimuladaCache] = useState({});
  const [usarMalhaAutomatica, setUsarMalhaAutomatica] = useState(true);
  const [modoSimulacao, setModoSimulacao] = useState('rapido');
  const [escopoSimulacao, setEscopoSimulacao] = useState(null);
  const [grupoDetalhe, setGrupoDetalhe] = useState(null);
  const [exportando, setExportando] = useState(false);
  const fileInputRef = useRef(null);

  const stats = useMemo(() => ({
    total: Number(resumo?.total || 0),
    comIbge: Number(resumo?.comIbge || 0),
    pendenciasIbge: Number(resumo?.pendenciasIbge || 0),
    valorCte: Number(resumo?.valorCte || 0),
    valorNF: Number(resumo?.valorNF || 0),
    percentualFrete: Number(resumo?.percentualFrete || 0),
    periodoInicio: resumo?.periodoInicio || '',
    periodoFim: resumo?.periodoFim || '',
  }), [resumo]);

  useEffect(() => {
    let ativo = true;
    async function init() {
      setCarregando(true);
      try {
        const [diag, ibgeRef] = await Promise.all([
          diagnosticarRealizadoLocal().catch(() => ({ total: 0 })),
          carregarMunicipiosIbgeComFallback({ permitirOficial: true }).catch(() => ({ municipios: [], fonte: 'pendente', totalSupabase: 0 })),
        ]);
        if (!ativo) return;
        setDiagnostico(diag);
        setMunicipios(ibgeRef.municipios || []);
        setIbgeInfo({
          total: (ibgeRef.municipios || []).length,
          fonte: `${ibgeRef.fonte || 'pendente'}${ibgeRef.totalSupabase && ibgeRef.totalSupabase < 5000 ? ` • Supabase: ${ibgeRef.totalSupabase.toLocaleString('pt-BR')}` : ''}`,
        });
        await pesquisar(DEFAULT_FILTROS, false);
      } catch (error) {
        if (ativo) setErro(error.message || 'Erro ao iniciar realizado local.');
      } finally {
        if (ativo) setCarregando(false);
      }
    }
    init();
    return () => { ativo = false; };
  }, []);

  function alterarFiltro(campo, valor) {
    setFiltros((prev) => ({ ...prev, [campo]: valor }));
    if (resultado) setResultado(null);
  }

  async function pesquisar(filtrosBusca = filtros, mostrarMensagem = true) {
    setCarregando(true);
    setErro('');
    try {
      if (mostrarMensagem) setFeedback('Pesquisando base local...');
      const [resumoLocal, lista] = await Promise.all([
        resumirRealizadoLocal(filtrosBusca, { top: 10 }),
        listarRealizadoLocal(filtrosBusca, { limit: 50 }),
      ]);
      const diag = await diagnosticarRealizadoLocal().catch(() => null);
      setResumo(resumoLocal);
      setAmostra(lista.rows || []);
      setDiagnostico(diag);
      setFiltrosAplicados({ ...DEFAULT_FILTROS, ...filtrosBusca });
      setFeedback(
        resumoLocal.total
          ? `Filtro carregado da base local: ${resumoLocal.total.toLocaleString('pt-BR')} CT-e(s), ${resumoLocal.comIbge.toLocaleString('pt-BR')} com IBGE e ${resumoLocal.pendenciasIbge.toLocaleString('pt-BR')} pendência(s).`
          : 'Nenhum CT-e encontrado na base local para os filtros atuais.'
      );
    } catch (error) {
      setErro(error.message || 'Erro ao pesquisar base local.');
    } finally {
      setCarregando(false);
    }
  }

  async function prepararMunicipiosParaImportacao() {
    let baseMunicipios = Array.isArray(municipios) ? municipios : [];
    let tabelas = transportadorasTabela;
    let fonte = baseMunicipios.length ? ibgeInfo.fonte : 'pendente';

    if (!baseMunicipios.length || baseMunicipios.length < 5000) {
      setProgress((prev) => ({
        ...(prev || {}),
        etapa: 'Carregando referência IBGE',
        percentual: 3,
        mensagem: 'Carregando base oficial IBGE com normalização por cidade/UF. Se o Supabase estiver vazio, uso fallback oficial em cache.',
      }));
      await nextFrame();
      const ibgeRef = await carregarMunicipiosIbgeComFallback({ permitirOficial: true }).catch(() => ({ municipios: baseMunicipios, fonte }));
      if ((ibgeRef.municipios || []).length > baseMunicipios.length) {
        baseMunicipios = ibgeRef.municipios || [];
        fonte = ibgeRef.fonte || fonte;
      }

      if (!tabelas?.length && baseMunicipios.length < 5000) {
        const base = await carregarBaseCompletaDb().catch(() => []);
        tabelas = base?.length ? base : transportadoras;
        if (base?.length) setTransportadorasTabela(base);
        fonte = baseMunicipios.length ? `${fonte} + tabelas` : 'Tabelas de frete';
      }
    }

    const enriquecidos = enriquecerMunicipiosComTabelas(baseMunicipios, tabelas || transportadoras || []);
    if (!enriquecidos.length) {
      throw new Error('Não foi possível carregar nenhuma referência de IBGE. Sem IBGE, a base local não consegue simular. Confira a tela Consulta IBGE ou as rotas/tabelas cadastradas.');
    }

    setMunicipios(enriquecidos);
    setIbgeInfo({ total: enriquecidos.length, fonte });
    return enriquecidos;
  }

  function importarArquivosComWorker(files = [], municipiosResolucao = municipios) {
    return new Promise((resolve, reject) => {
      if (typeof Worker === 'undefined') {
        reject(new Error('Este navegador não suporta processamento em segundo plano com Worker.'));
        return;
      }

      const worker = new Worker(new URL('../workers/realizadoLocalImportWorker.js', import.meta.url), { type: 'module' });

      worker.onmessage = (event) => {
        const msg = event.data || {};

        if (msg.type === 'progress') {
          setProgress({
            etapa: msg.etapa || 'Importando base local',
            atual: msg.atual || 0,
            total: msg.total || files.length,
            percentual: msg.percentual || 0,
            mensagem: msg.mensagem || 'Processando arquivo local...',
          });
          if (msg.feedback) setFeedback(msg.feedback);
        }

        if (msg.type === 'done') {
          worker.terminate();
          resolve(msg.result || {});
        }

        if (msg.type === 'error') {
          worker.terminate();
          reject(new Error(msg.message || 'Erro ao processar arquivo local.'));
        }
      };

      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message || 'Erro no processador local de arquivos.'));
      };

      worker.postMessage({
        type: 'importar-realizado-local',
        files,
        municipios: municipiosResolucao,
        competencia: filtros.competencia,
      });
    });
  }

  async function importarArquivos(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setImportando(true);
    setErro('');
    setResultado(null);
    setProgress({
      etapa: 'Preparando leitura local',
      atual: 0,
      total: files.length,
      percentual: 1,
      mensagem: 'Enviando arquivo para processamento em segundo plano. A tela pode continuar aberta durante a leitura.',
    });

    try {
      const municipiosResolucao = await prepararMunicipiosParaImportacao();
      setFeedback(`Referência IBGE pronta: ${municipiosResolucao.length.toLocaleString('pt-BR')} município(s). Iniciando leitura do arquivo...`);
      const result = await importarArquivosComWorker(files, municipiosResolucao);
      if (!result.totalPreparados && result.erros?.length) {
        throw new Error(`Nenhum CT-e foi importado. Primeiro erro: ${result.erros[0]?.arquivo || result.erros[0]?.nome || 'arquivo'} - ${result.erros[0]?.erro || 'erro desconhecido'}`);
      }
      setProgress({
        etapa: 'Atualizando painel',
        atual: result.totalPreparados || 0,
        total: result.totalPreparados || 0,
        percentual: 100,
        mensagem: 'Atualizando resumo local...',
      });
      setFeedback(
        `Importação local concluída: ${Number(result.totalPreparados || 0).toLocaleString('pt-BR')} CT-e(s) preparados de ${Number(result.totalLidos || 0).toLocaleString('pt-BR')} lidos. Pendências IBGE: ${Number(result.totalPendencias || 0).toLocaleString('pt-BR')}.`
      );
      setFileKey(makeFileKey());
      await pesquisar(filtros, false);
    } catch (error) {
      setErro(error.message || 'Erro ao importar arquivos locais.');
    } finally {
      setImportando(false);
      setTimeout(() => setProgress(null), 2500);
      if (event.target) event.target.value = '';
    }
  }

  async function limparBase() {
    const texto = window.prompt('Para limpar a base local deste navegador, digite LIMPAR LOCAL');
    if (texto !== 'LIMPAR LOCAL') return;
    setCarregando(true);
    setErro('');
    try {
      await limparRealizadoLocal();
      setResumo(null);
      setAmostra([]);
      setResultado(null);
      setDiagnostico(await diagnosticarRealizadoLocal());
      setFeedback('Base local limpa neste navegador. O Supabase não foi alterado.');
    } catch (error) {
      setErro(error.message || 'Erro ao limpar base local.');
    } finally {
      setCarregando(false);
    }
  }

  async function carregarTabelaTransportadoraSelecionada(nomeTransportadora) {
    const nome = String(nomeTransportadora || '').trim();
    if (!nome) return [];
    if (transportadoraSimuladaCache[nome]?.length) return transportadoraSimuladaCache[nome];

    setProgress((prev) => ({
      ...(prev || {}),
      etapa: 'Carregando tabela simulada',
      percentual: 12,
      mensagem: `Carregando somente a tabela da ${nome}. Isso deixa o modo rápido bem mais leve.`,
    }));
    await nextFrame();

    const selecionada = await carregarTransportadoraCompletaDb(null, nome).catch(() => null);
    const base = selecionada ? [selecionada] : (transportadoras || []).filter((item) => item.nome === nome);
    setTransportadoraSimuladaCache((prev) => ({ ...prev, [nome]: base }));
    return base;
  }

  function mesclarTransportadorasParciais(listas = []) {
    const mapa = new Map();
    const origemKeysPorTransportadora = new Map();

    listas.flat().filter(Boolean).forEach((transportadora) => {
      const chaveTransportadora = transportadora.id || transportadora.nome;
      if (!chaveTransportadora) return;
      const atual = mapa.get(chaveTransportadora) || { ...transportadora, origens: [] };
      const origemKeys = origemKeysPorTransportadora.get(chaveTransportadora) || new Set();

      (transportadora.origens || []).forEach((origem) => {
        const origemKey = origem.id || `${origem.cidade}|${origem.canal}|${(origem.rotas || []).map((rota) => rota.ibgeDestino || rota.nomeRota).join(',')}`;
        if (origemKeys.has(origemKey)) return;
        origemKeys.add(origemKey);
        atual.origens.push(origem);
      });

      mapa.set(chaveTransportadora, atual);
      origemKeysPorTransportadora.set(chaveTransportadora, origemKeys);
    });

    return [...mapa.values()].filter((item) => item.origens?.length);
  }

  async function carregarTabelasConcorrentesParaRealizado(rows = [], tabelaSelecionada = []) {
    if (!rows.length) return tabelaSelecionada;

    setProgress((prev) => ({
      ...(prev || {}),
      etapa: 'Carregando concorrentes enxutos',
      percentual: 26,
      mensagem: 'Modo completo: buscando somente concorrentes das origens/destinos existentes no realizado filtrado.',
    }));
    await nextFrame();

    const grupos = new Map();
    rows.forEach((row) => {
      const origem = row.cidadeOrigem || '';
      const canal = row.canal || '';
      const destino = String(row.ibgeDestino || '').replace(/\D/g, '');
      if (!origem || !destino) return;
      const key = `${origem}|${canal}`;
      const grupo = grupos.get(key) || { origem, canal, destinos: new Set() };
      grupo.destinos.add(destino);
      grupos.set(key, grupo);
    });

    const partes = [tabelaSelecionada];
    for (const grupo of grupos.values()) {
      const destinos = [...grupo.destinos];
      for (let i = 0; i < destinos.length; i += 200) {
        const destinoCodigos = destinos.slice(i, i + 200);
        const parcial = await buscarBaseSimulacaoDb({
          origem: grupo.origem,
          canal: grupo.canal,
          destinoCodigos,
        }).catch(() => []);
        if (parcial?.length) partes.push(parcial);
        await nextFrame();
      }
    }

    const mescladas = mesclarTransportadorasParciais(partes);
    if (mescladas.length) return mescladas;

    if (transportadorasTabela?.length) return transportadorasTabela;
    const base = await carregarBaseCompletaDb().catch(() => []);
    const finalBase = base?.length ? base : transportadoras;
    setTransportadorasTabela(finalBase);
    return finalBase;
  }

  async function simular() {
    if (!filtros.transportadora) {
      setErro('Escolha a transportadora que deseja simular.');
      return;
    }

    setSimulando(true);
    setErro('');
    setResultado(null);
    setEscopoSimulacao(null);
    setProgress({ etapa: 'Carregando malha', atual: 0, total: 0, percentual: 5, mensagem: 'Carregando tabelas e montando escopo da transportadora...' });

    try {
      const tabelaSelecionada = await carregarTabelaTransportadoraSelecionada(filtros.transportadora);
      if (!tabelaSelecionada?.length) {
        setErro('Não encontrei a tabela dessa transportadora no Supabase. Confira se a tabela está cadastrada e se o nome selecionado é exatamente o mesmo.');
        return;
      }

      const escopo = construirEscopoTransportadoraSimulada({
        transportadoras: tabelaSelecionada,
        nomeTransportadora: filtros.transportadora,
        municipios,
        canalFiltro: filtrosAplicados.canal || filtros.canal,
      });
      setEscopoSimulacao(escopo);

      if (!escopo.transportadora) {
        setErro('Não encontrei essa transportadora nas tabelas cadastradas. Confira se o nome está igual ao cadastro.');
        return;
      }

      if (usarMalhaAutomatica && !escopo.totalRotas) {
        setErro('A transportadora selecionada foi encontrada, mas não possui rotas com IBGE para o canal selecionado. Confira as rotas/tabelas cadastradas.');
        return;
      }

      const filtrosBase = usarMalhaAutomatica
        ? {
            ...filtrosAplicados,
            origem: '',
            destino: '',
            ufOrigem: '',
            ufDestino: '',
          }
        : filtrosAplicados;

      setProgress({
        etapa: usarMalhaAutomatica ? 'Filtrando pela malha' : 'Preparando realizado',
        atual: 0,
        total: escopo.totalRotas || 0,
        percentual: 18,
        mensagem: usarMalhaAutomatica
          ? `Aplicando malha automática da ${escopo.transportadora}: ${escopo.totalRotas.toLocaleString('pt-BR')} rota(s), ${escopo.origens.length.toLocaleString('pt-BR')} origem(ns).`
          : 'Buscando CT-e(s) filtrados na base local...',
      });
      await nextFrame();

      const buscaRealizado = usarMalhaAutomatica
        ? await buscarRealizadoLocalPorMalha(filtrosBase, escopo.routeKeys, { limit: 10000 })
        : await buscarRealizadoLocalParaSimulacao(filtrosBase, { limit: 10000 });

      const { rows, totalCompativel, limit } = buscaRealizado;
      if (!rows.length) {
        setErro(
          usarMalhaAutomatica
            ? 'Nenhum CT-e da base local caiu dentro da malha da transportadora selecionada para o período/filtros atuais. Tente ampliar o período ou remover canal/peso/transportadora realizada.'
            : 'Nenhum CT-e encontrado na base local para simular nos filtros pesquisados.'
        );
        return;
      }

      setFeedback(
        usarMalhaAutomatica
          ? `Simulação automática: ${rows.length.toLocaleString('pt-BR')} CT-e(s) dentro da malha da ${escopo.transportadora}${totalCompativel > rows.length ? ` de ${totalCompativel.toLocaleString('pt-BR')} encontrados. Limite atual: ${limit.toLocaleString('pt-BR')}.` : '.'}`
          : `Preparando simulação local: ${rows.length.toLocaleString('pt-BR')} CT-e(s) usados${totalCompativel > rows.length ? ` de ${totalCompativel.toLocaleString('pt-BR')} encontrados. Limite atual: ${limit.toLocaleString('pt-BR')}.` : '.'}`
      );

      const baseTabelas = modoSimulacao === 'rapido'
        ? tabelaSelecionada
        : await carregarTabelasConcorrentesParaRealizado(rows, tabelaSelecionada);

      setProgress({
        etapa: 'Indexando tabelas',
        atual: 0,
        total: baseTabelas.length,
        percentual: 30,
        mensagem: modoSimulacao === 'rapido'
          ? `Modo rápido: calculando somente ${filtros.transportadora}, sem puxar concorrentes.`
          : 'Modo completo: preparando cálculo de ranking contra concorrentes.',
      });
      await nextFrame();

      const analise = await simularRealizadoLocalRapido({
        realizados: rows,
        transportadoras: baseTabelas,
        municipios,
        nomeTransportadora: filtros.transportadora,
        modoSimulacao,
        onProgress: ({ atual, total, etapa }) => {
          setProgress({
            etapa,
            atual,
            total,
            percentual: 35 + Math.round(pct(atual, total) * 0.63),
            mensagem: `${atual.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} CT-e(s) simulados localmente...`,
          });
        },
      });

      setResultado(analise);
      setProgress({ etapa: 'Concluído', atual: rows.length, total: rows.length, percentual: 100, mensagem: 'Simulação local concluída.' });
      setFeedback(
        analise.resumo.rankingCalculado
          ? `Simulação completa concluída: ${analise.resumo.ctesComSimulacao.toLocaleString('pt-BR')} CT-e(s) avaliados e ${analise.resumo.ctesForaMalha.toLocaleString('pt-BR')} fora da malha.`
          : `Simulação rápida concluída: ${analise.resumo.ctesComSimulacao.toLocaleString('pt-BR')} CT-e(s) com frete simulado e ${analise.resumo.ctesForaMalha.toLocaleString('pt-BR')} fora da malha. Ranking/ganhadores não calculados no modo rápido.`
      );
    } catch (error) {
      setErro(error.message || 'Erro ao simular realizado local.');
    } finally {
      setSimulando(false);
      setTimeout(() => setProgress(null), 2500);
    }
  }

  const transportadorasDisponiveis = useMemo(() => {
    const fromTabelas = (transportadorasTabela || transportadoras || []).map((item) => item.nome).filter(Boolean);
    return [...new Set(fromTabelas)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [transportadorasTabela, transportadoras]);

  function selecionarGrupo(tipo, item) {
    if (!tipo || !item) return;
    setGrupoDetalhe({ tipo, ...item });
  }

  async function aplicarGrupoComoFiltro() {
    if (!grupoDetalhe) return;
    const novoFiltro = { ...filtros };
    if (grupoDetalhe.tipo === 'transportadora') novoFiltro.transportadoraRealizada = grupoDetalhe.chave === 'Não informado' ? '' : grupoDetalhe.chave;
    if (grupoDetalhe.tipo === 'canal') novoFiltro.canal = grupoDetalhe.chave === 'Não informado' ? '' : grupoDetalhe.chave;
    if (grupoDetalhe.tipo === 'mes') novoFiltro.competencia = grupoDetalhe.chave === 'Não informado' ? '' : grupoDetalhe.chave;
    if (grupoDetalhe.tipo === 'origem') {
      const [cidade, uf] = String(grupoDetalhe.chave || '').split('/');
      novoFiltro.origem = cidade || '';
      novoFiltro.ufOrigem = uf || '';
    }
    if (grupoDetalhe.tipo === 'destino') {
      const [cidade, uf] = String(grupoDetalhe.chave || '').split('/');
      novoFiltro.destino = cidade || '';
      novoFiltro.ufDestino = uf || '';
    }
    setFiltros(novoFiltro);
    await pesquisar(novoFiltro);
  }

  async function exportarBaseSelecionada() {
    setExportando(true);
    setErro('');
    try {
      const { rows, totalCompativel, limit } = await exportarRealizadoLocal(filtrosAplicados, { limit: 100000 });
      if (!rows.length) {
        setErro('Não existe base filtrada para exportar. Pesquise primeiro.');
        return;
      }
      baixarXlsx(`realizado-local-base-filtrada-${Date.now()}.xlsx`, {
        Base_Filtrada: rows.map(cteToExportRow),
      });
      setFeedback(`Base filtrada exportada: ${rows.length.toLocaleString('pt-BR')} linha(s)${totalCompativel > limit ? ` de ${totalCompativel.toLocaleString('pt-BR')} encontradas` : ''}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao exportar base filtrada.');
    } finally {
      setExportando(false);
    }
  }

  function exportarResultadoSimulacao() {
    if (!resultado) return;
    baixarXlsx(`realizado-local-simulacao-${Date.now()}.xlsx`, {
      Resultado: (resultado.detalhes || []).map(simToExportRow),
      Fora_da_Malha: (resultado.foraMalha || []).map(cteToExportRow),
      Resumo_UF: resultado.resumo?.porUf || [],
    });
    setFeedback('Resultado da simulação exportado em Excel.');
  }

  const grupoAtivoKey = grupoDetalhe ? `${grupoDetalhe.tipo}:${grupoDetalhe.chave}` : '';
  const rankingCalculado = resultado?.resumo?.rankingCalculado !== false;

  return (
    <div className="page-shell realizado-page">
      <div className="page-top between">
        <div className="page-header">
          <div className="amd-mini-brand">AMD Log • Realizado local</div>
          <h1>Realizado CT-e Local</h1>
          <p>
            Carregue CT-e(s) da sua máquina, gere base enxuta local com IBGE e simule sem gravar o realizado no Supabase.
          </p>
        </div>
        <div className="actions-right wrap">
          <button className="btn-secondary" onClick={() => pesquisar(filtros)} disabled={carregando || importando || simulando}>
            {carregando ? 'Pesquisando...' : 'Pesquisar base local'}
          </button>
          <button className="btn-secondary" onClick={exportarBaseSelecionada} disabled={exportando || carregando || importando || simulando || !stats.total}>
            {exportando ? 'Exportando...' : 'Exportar base filtrada'}
          </button>
          <button className="btn-danger" onClick={limparBase} disabled={carregando || importando || simulando || !diagnostico?.total}>
            Limpar base local
          </button>
        </div>
      </div>

      {erro ? <div className="sim-alert">{erro}</div> : null}
      {feedback ? <div className="sim-alert info">{feedback}</div> : null}
      <div className={ibgeInfo.total ? 'sim-alert success' : 'sim-alert'}>
        <strong>Referência IBGE local:</strong> {ibgeInfo.total.toLocaleString('pt-BR')} município(s) • fonte: {ibgeInfo.fonte}. A importação local usa cidade/UF normalizadas com e sem acento; confira a tela Consulta IBGE se o Supabase estiver vazio.
      </div>

      {progress ? (
        <div className="sim-alert info">
          <div className="sim-parametros-header">
            <div>
              <strong>{progress.etapa}</strong>
              <p>{progress.mensagem}</p>
            </div>
            <span>{Math.round(progress.percentual || 0)}%</span>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden', marginTop: 10 }}>
            <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, Number(progress.percentual || 0)))}%`, borderRadius: 999, background: '#9153F0', transition: 'width 180ms ease' }} />
          </div>
        </div>
      ) : null}

      <div className="summary-strip">
        <SummaryCard title="CT-e(s) filtrados" value={stats.total.toLocaleString('pt-BR')} subtitle={`${formatDateBr(stats.periodoInicio)} até ${formatDateBr(stats.periodoFim)}`} />
        <SummaryCard title="Frete realizado" value={formatCurrency(stats.valorCte)} subtitle="Soma do Valor CT-e local" />
        <SummaryCard title="Valor NF" value={formatCurrency(stats.valorNF)} subtitle="Base para % de frete" />
        <SummaryCard title="% frete realizado" value={formatPercent(stats.percentualFrete)} subtitle="Frete realizado / NF" />
        <SummaryCard title="Pendências IBGE" value={stats.pendenciasIbge.toLocaleString('pt-BR')} subtitle={`${stats.comIbge.toLocaleString('pt-BR')} CT-e(s) com rota IBGE`} />
      </div>

      <div className="feature-grid three">
        <section className="panel-card">
          <div className="panel-title">1. Carregar base local</div>
          <p>Selecione um ou mais arquivos mensais. O sistema grava uma base enxuta apenas neste navegador, sem ocupar Supabase.</p>
          <input
            key={fileKey}
            ref={fileInputRef}
            type="file"
            multiple
            accept=".xlsx,.xls,.csv"
            onChange={importarArquivos}
            disabled={importando || simulando}
          />
          <button className="btn-primary full" onClick={() => fileInputRef.current?.click()} disabled={importando || simulando}>
            {importando ? 'Importando local...' : 'Selecionar arquivos locais'}
          </button>
          <div className="import-meta-box">
            Base local neste navegador: <strong>{Number(diagnostico?.total || 0).toLocaleString('pt-BR')}</strong> CT-e(s)
          </div>
        </section>

        <section className="panel-card">
          <div className="panel-title">2. Pesquisar base enxuta</div>
          <div className="form-grid">
            <div className="field"><label>Competência</label><input value={filtros.competencia} onChange={(e) => alterarFiltro('competencia', e.target.value)} placeholder="2026-04" /></div>
            <div className="field"><label>Canal</label><select value={filtros.canal} onChange={(e) => alterarFiltro('canal', e.target.value)}><option value="">Todos</option><option>ATACADO</option><option>B2C</option><option>INTERCOMPANY</option><option>REVERSA</option></select></div>
            <div className="field"><label>Data inicial</label><input type="date" value={filtros.inicio} onChange={(e) => alterarFiltro('inicio', e.target.value)} /></div>
            <div className="field"><label>Data final</label><input type="date" value={filtros.fim} onChange={(e) => alterarFiltro('fim', e.target.value)} /></div>
            <div className="field"><label>UF origem</label><input value={filtros.ufOrigem} onChange={(e) => alterarFiltro('ufOrigem', e.target.value.toUpperCase().slice(0, 2))} placeholder="SC" /></div>
            <div className="field"><label>UF destino</label><input value={filtros.ufDestino} onChange={(e) => alterarFiltro('ufDestino', e.target.value.toUpperCase().slice(0, 2))} placeholder="SP" /></div>
            <div className="field"><label>Peso mínimo</label><input type="number" value={filtros.pesoMin} onChange={(e) => alterarFiltro('pesoMin', e.target.value)} placeholder="Ex.: 40" /></div>
            <div className="field"><label>Peso máximo</label><input type="number" value={filtros.pesoMax} onChange={(e) => alterarFiltro('pesoMax', e.target.value)} placeholder="Ex.: 100" /></div>
          </div>
          <div className="field"><label>Transportadora realizada</label><input value={filtros.transportadoraRealizada} onChange={(e) => alterarFiltro('transportadoraRealizada', e.target.value)} placeholder="Ex.: MOVVI" /></div>
          <div className="form-grid"><div className="field"><label>Origem</label><input value={filtros.origem} onChange={(e) => alterarFiltro('origem', e.target.value)} placeholder="Itajaí" /></div><div className="field"><label>Destino</label><input value={filtros.destino} onChange={(e) => alterarFiltro('destino', e.target.value)} placeholder="São Paulo" /></div></div>
          <button className="btn-primary full" onClick={() => pesquisar(filtros)} disabled={carregando || importando || simulando}>Pesquisar</button>
        </section>

        <section className="panel-card">
          <div className="panel-title">3. Simular local</div>
          <p>Use modo rápido para impacto financeiro. Use completo apenas quando precisar ranking/ganhadores contra concorrentes.</p>
          <div className="field">
            <label>Transportadora simulada</label>
            <select value={filtros.transportadora} onChange={(e) => alterarFiltro('transportadora', e.target.value)}>
              <option value="">Selecione a transportadora cadastrada</option>
              {transportadorasDisponiveis.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <small>Escolha a tabela exata que deseja testar. Assim o sistema não mistura nomes parecidos, como “TOTAL EXPRESS” e “TOTAL EXPRESS SIMULAR”.</small>
          </div>
          <div className="field">
            <label>Modo da simulação</label>
            <select value={modoSimulacao} onChange={(e) => setModoSimulacao(e.target.value)}>
              <option value="rapido">Rápido — impacto financeiro</option>
              <option value="completo">Completo — ranking e ganhadores</option>
            </select>
            <small>
              Rápido calcula somente a transportadora escolhida. Completo compara com concorrentes e demora mais.
            </small>
          </div>
          <label className="check-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
            <input type="checkbox" checked={usarMalhaAutomatica} onChange={(e) => setUsarMalhaAutomatica(e.target.checked)} />
            <span>
              Usar malha da transportadora automaticamente
              <small style={{ display: 'block' }}>Mantém período/canal/peso e usa somente as rotas que a transportadora atende.</small>
            </span>
          </label>
          {escopoSimulacao ? (
            <div className="import-meta-box">
              Malha simulada: <strong>{escopoSimulacao.totalRotas.toLocaleString('pt-BR')}</strong> rota(s) • {escopoSimulacao.origens.length.toLocaleString('pt-BR')} origem(ns) • canais: {escopoSimulacao.canais.join(', ') || '—'}
            </div>
          ) : null}
          <button className="btn-primary full" onClick={simular} disabled={simulando || importando || carregando || !stats.total}>
            {simulando ? 'Simulando local...' : 'Simular no realizado local'}
          </button>
        </section>
      </div>

      <section className="sim-card">
        <div className="sim-parametros-header">
          <div>
            <h2>Painel da base local</h2>
            <p>Visão rápida da última pesquisa local, sem puxar CT-e do Supabase.</p>
          </div>
          <span className="status-pill">{amostra.length.toLocaleString('pt-BR')} linha(s) na amostra</span>
        </div>
        <div className="feature-grid four top-space">
          <MiniTable title="Top transportadoras" tipo="transportadora" rows={resumo?.porTransportadora || []} onSelect={selecionarGrupo} activeKey={grupoAtivoKey} />
          <MiniTable title="Origem" tipo="origem" rows={resumo?.porOrigem || []} onSelect={selecionarGrupo} activeKey={grupoAtivoKey} />
          <MiniTable title="Destino" tipo="destino" rows={resumo?.porDestino || []} onSelect={selecionarGrupo} activeKey={grupoAtivoKey} />
          <MiniTable title="Canal / mês" tipo="canal" rows={resumo?.porCanal || []} onSelect={selecionarGrupo} activeKey={grupoAtivoKey} />
        </div>
        {grupoDetalhe ? (
          <div className="realizado-detail-panel top-space">
            <div>
              <span>Detalhe selecionado</span>
              <strong>{grupoDetalhe.chave}</strong>
              <small>{grupoDetalhe.tipo} • {grupoDetalhe.ctes.toLocaleString('pt-BR')} CT-e(s) • {formatCurrency(grupoDetalhe.frete)} • {formatPercent(grupoDetalhe.percentual)}</small>
            </div>
            <div className="actions-right wrap">
              <button className="btn-secondary" onClick={aplicarGrupoComoFiltro}>Filtrar por este item</button>
              <button className="btn-link" onClick={() => setGrupoDetalhe(null)}>Recolher</button>
            </div>
          </div>
        ) : null}
      </section>

      {resultado ? (
        <section className="sim-card">
          <div className="sim-parametros-header">
            <div>
              <h2>Resultado da simulação local</h2>
              <p>Transportadora simulada: <strong>{filtros.transportadora}</strong> • modo: <strong>{resultado.resumo.modo === 'completo' ? 'Completo' : 'Rápido'}</strong></p>
            </div>
            <button className="btn-secondary" onClick={exportarResultadoSimulacao}>Exportar simulação</button>
          </div>
          {!rankingCalculado ? (
            <div className="sim-alert info">
              Modo rápido: ranking, aderência e CT-e(s) que ganharia não são calculados. Use o modo completo quando precisar comparar contra todos os concorrentes.
            </div>
          ) : null}
          <div className="sim-analise-resumo top-space">
            <div><span>CT-e(s) avaliados</span><strong>{resultado.resumo.ctesComSimulacao.toLocaleString('pt-BR')}</strong></div>
            <div><span>CT-e(s) que ganharia</span><strong>{rankingCalculado ? resultado.resumo.ctesGanharia.toLocaleString('pt-BR') : '—'}</strong></div>
            <div><span>Aderência</span><strong>{rankingCalculado ? formatPercent(resultado.resumo.aderencia) : '—'}</strong></div>
            <div><span>Faturamento se vencedora</span><strong>{rankingCalculado ? formatCurrency(resultado.resumo.faturamentoGanhador) : '—'}</strong></div>
            <div><span>Economia se vencedora</span><strong>{rankingCalculado ? formatCurrency(resultado.resumo.economiaGanhador) : '—'}</strong></div>
            <div><span>Impacto total</span><strong>{formatCurrency(resultado.resumo.impactoLiquido)}</strong></div>
            <div><span>% frete simulado</span><strong>{formatPercent(resultado.resumo.percentualSimulado)}</strong></div>
            <div><span>Fora da malha</span><strong>{resultado.resumo.ctesForaMalha.toLocaleString('pt-BR')}</strong></div>
          </div>

          {resultado.resumo.porUf?.length ? (
            <div className="sim-parametros-box top-space">
              <div className="sim-parametros-header"><strong>Resumo por UF destino</strong><span>{resultado.resumo.porUf.length} UF(s)</span></div>
              <div className="sim-table-wrap">
                <table className="sim-table">
                  <thead><tr><th>UF</th><th>CT-e(s)</th><th>Ganharia</th><th>Aderência</th><th>Realizado</th><th>Simulado</th><th>Economia</th></tr></thead>
                  <tbody>{resultado.resumo.porUf.map((item) => <tr key={item.uf}><td>{item.uf}</td><td>{item.ctes}</td><td>{rankingCalculado ? item.ganharia : '—'}</td><td>{rankingCalculado ? formatPercent(item.aderencia) : '—'}</td><td>{formatCurrency(item.valorRealizado)}</td><td>{formatCurrency(item.valorSimulado)}</td><td>{formatCurrency(item.economia)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          ) : null}

          {resultado.foraMalha?.length ? (
            <div className="sim-parametros-box top-space">
              <div className="sim-parametros-header"><strong>Fora da malha / pendências</strong><span>{resultado.foraMalha.length.toLocaleString('pt-BR')} CT-e(s)</span></div>
              <div className="sim-table-wrap">
                <table className="sim-table">
                  <thead><tr><th>CT-e</th><th>Canal</th><th>Origem</th><th>Destino</th><th>Peso</th><th>Chave IBGE</th><th>Motivo</th></tr></thead>
                  <tbody>{resultado.foraMalha.slice(0, 30).map((item) => <tr key={item.chaveCte}><td>{item.numeroCte || item.chaveCte?.slice(-8)}</td><td>{item.canal}</td><td>{item.cidadeOrigem}/{item.ufOrigem}</td><td>{item.cidadeDestino}/{item.ufDestino}</td><td>{formatNumber(item.peso, 3)}</td><td>{item.chaveRotaIbge || '—'}</td><td>{item.motivo}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="sim-table-wrap top-space">
            <table className="sim-table">
              <thead><tr><th>CT-e</th><th>Emissão</th><th>Realizada</th><th>Origem → Destino</th><th>Valor CT-e</th><th>Simulado</th><th>Impacto</th><th>Ranking</th><th></th></tr></thead>
              <tbody>
                {resultado.detalhes.slice(0, 100).map((item) => (
                  <Fragment key={item.id}>
                    <tr>
                      <td>{item.numeroCte || item.chaveCte?.slice(-8)}</td>
                      <td>{formatDateBr(item.emissao)}</td>
                      <td>{item.transportadoraRealizada}</td>
                      <td>{item.origem} → {item.cidadeDestino}/{item.ufDestino}</td>
                      <td>{formatCurrency(item.valorRealizado)}</td>
                      <td>{formatCurrency(item.valorSimulado)}</td>
                      <td className={item.impacto >= 0 ? 'positivo' : 'negativo'}>{formatCurrency(item.impacto)}</td>
                      <td>{rankingLabel(item, rankingCalculado)}</td>
                      <td><button className="link-btn" onClick={() => setDetalheAberto(detalheAberto === item.id ? null : item.id)}>Detalhe</button></td>
                    </tr>
                    {detalheAberto === item.id ? (
                      <tr className="sim-detalhe-row"><td colSpan="9"><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(item.detalhes, null, 2)}</pre></td></tr>
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
            <div className="panel-title">Amostra da base local enxuta</div>
            <p>Mostrando até 50 CT-e(s) da última pesquisa.</p>
          </div>
          <span className="status-pill">{amostra.length.toLocaleString('pt-BR')} linha(s)</span>
        </div>
        <div className="sim-table-wrap">
          <table className="sim-table">
            <thead><tr><th>Emissão</th><th>CT-e</th><th>Transportadora</th><th>Canal</th><th>Origem</th><th>Destino</th><th>IBGE Origem</th><th>IBGE Destino</th><th>Peso</th><th>Valor CT-e</th><th>Valor NF</th></tr></thead>
            <tbody>
              {amostra.length ? amostra.map((item) => (
                <tr key={item.chaveCte}>
                  <td>{formatDateBr(item.dataEmissao)}</td>
                  <td>{item.numeroCte || item.chaveCte?.slice(-8)}</td>
                  <td>{item.transportadora}</td>
                  <td>{item.canal}</td>
                  <td>{item.cidadeOrigem}/{item.ufOrigem}</td>
                  <td>{item.cidadeDestino}/{item.ufDestino}</td>
                  <td>{item.ibgeOrigem || '—'}</td>
                  <td>{item.ibgeDestino || '—'}</td>
                  <td>{formatNumber(item.peso, 3)}</td>
                  <td>{formatCurrency(item.valorCte)}</td>
                  <td>{formatCurrency(item.valorNF)}</td>
                </tr>
              )) : <tr><td colSpan="11">Nenhum CT-e carregado ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
