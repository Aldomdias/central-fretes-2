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
import { simularRealizadoPorTransportadora } from '../utils/calculoFrete';
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

function buildCidadeKey(cidade, uf = '') {
  return `${normalizarBusca(cidade)}|${String(uf || '').trim().toUpperCase()}`;
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
  const canal = String(filtros.canal || '').trim().toUpperCase();
  const origem = normalizarBusca(filtros.origem);
  const ufDestino = String(filtros.ufDestino || '').trim().toUpperCase();

  return rows.filter((row) => {
    const data = row.emissao ? new Date(row.emissao) : null;
    if (inicio && (!data || data < inicio)) return false;
    if (fim && (!data || data > fim)) return false;
    if (canal && String(row.canal || '').trim().toUpperCase() !== canal) return false;
    if (origem && normalizarBusca(row.cidadeOrigem) !== origem) return false;
    if (ufDestino && String(row.ufDestino || '').trim().toUpperCase() !== ufDestino) return false;
    return true;
  });
}

function fileInputKey() {
  return `realizado-${Date.now()}`;
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
  const [supabaseDiag, setSupabaseDiag] = useState(null);
  const [mostrarPendencias, setMostrarPendencias] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [detalheAberto, setDetalheAberto] = useState(null);
  const [inputKey, setInputKey] = useState(fileInputKey());
  const ibgeCacheRef = useRef(new Map());
  const fileInputRef = useRef(null);

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
    return [...new Set([...(opcoes.canais || []), ...fromRows])].sort();
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

  async function onImportarArquivo(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportando(true);
    setErro('');
    setResultado(null);
    setImportMeta(null);
    setSaveMeta(null);
    setFeedback(`Arquivo selecionado: ${file.name} (${(file.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB). Lendo a planilha...`);

    try {
      const { registros, meta } = await parseRealizadoCtesFile(file);
      setImportMeta(meta);

      if (!registros.length) {
        setErro(
          `Nenhum CT-e válido encontrado na aba ${meta.aba || 'selecionada'}. Linhas lidas: ${Number(meta.linhasOriginais || 0).toLocaleString('pt-BR')}. Confira se existem as colunas Chave CTE, Valor CTE, Valor NF e as cidades/UFs.`
        );
        return;
      }

      const avisoRef = meta.refFoiCorrigida
        ? ` A referência interna da aba veio como ${meta.refOriginal || 'vazia'} e foi corrigida para ${meta.refCorrigida}.`
        : '';

      setFeedback(
        `Arquivo lido na aba ${meta.aba}: ${meta.registrosValidos.toLocaleString('pt-BR')} CT-e(s) válidos de ${meta.linhasOriginais.toLocaleString('pt-BR')} linha(s).${avisoRef} Salvando no Supabase...`
      );

      setRows(registros);

      const diagnostico = await diagnosticarSupabase();
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
            `Salvando realizado ${modoTexto}: ${Number(salvos || 0).toLocaleString('pt-BR')} de ${Number(total || 0).toLocaleString('pt-BR')} CT-e(s)${confirmacaoTexto}...`
          );
        },
      });
      setSaveMeta(save);

      if (!save.inseridos || !save.confirmados) {
        throw new Error('A planilha foi lida, mas o Supabase não confirmou nenhuma gravação. Confira se a tabela realizado_ctes existe, se o script atualizado foi rodado e se as variáveis do Vercel apontam para o projeto correto.');
      }

      setFeedback(
        `Importação concluída no Supabase: ${Number(save.confirmados || 0).toLocaleString('pt-BR')} CT-e(s) confirmados de ${file.name}. Projeto: ${save.projeto || diagnostico?.host || '—'} • método: ${save.metodo || '—'}. Atualizando a tela...`
      );
      setInputKey(fileInputKey());

      const dataAtualizada = await listarRealizadoCtes({ limit: 15000 });
      if (dataAtualizada.length) {
        setRows(dataAtualizada);
        setFeedback(
          `Base realizada carregada do Supabase com ${dataAtualizada.length.toLocaleString('pt-BR')} CT-e(s). Última importação confirmada: ${Number(save.confirmados || 0).toLocaleString('pt-BR')} CT-e(s). Projeto: ${save.projeto || diagnostico?.host || '—'} • método: ${save.metodo || '—'}.`
        );
      } else {
        throw new Error('O Supabase confirmou a gravação, mas a consulta da base voltou vazia. Isso indica política de leitura/RLS ou o front apontando para outra base. Rode o script atualizado e confira o projeto do Supabase usado no Vercel.');
      }
    } catch (error) {
      setErro(error.message || 'Erro ao importar realizado.');
    } finally {
      setImportando(false);
      if (event.target) event.target.value = '';
    }
  }

  async function limparBase() {
    const confirmar = window.confirm('Tem certeza que deseja limpar a base realizada carregada? Essa ação remove os CT-e(s) do realizado.');
    if (!confirmar) return;

    setCarregando(true);
    setErro('');
    try {
      await excluirRealizadoCtes({});
      setRows([]);
      setResultado(null);
      setFeedback('Base realizada limpa com sucesso.');
    } catch (error) {
      setErro(error.message || 'Erro ao limpar base realizada.');
    } finally {
      setCarregando(false);
    }
  }

  async function resolverIbgeDestino(row) {
    if (row.ibgeDestino) return row.ibgeDestino;

    const localKey = buildCidadeKey(row.cidadeDestino, row.ufDestino);
    const semUfKey = buildCidadeKey(row.cidadeDestino);
    const cachedKey = `${row.cepDestino || ''}|${localKey}`;

    if (ibgeCacheRef.current.has(cachedKey)) return ibgeCacheRef.current.get(cachedKey);

    const local = ibgePorCidade.get(localKey) || ibgePorCidade.get(semUfKey);
    if (local) {
      ibgeCacheRef.current.set(cachedKey, local);
      return local;
    }

    const busca = row.cepDestino || row.cidadeDestino;
    if (!busca) return '';

    try {
      const resolvido = await resolverDestinoIbgeDb(busca);
      const ibge = resolvido?.ibge || '';
      ibgeCacheRef.current.set(cachedKey, ibge);
      return ibge;
    } catch {
      ibgeCacheRef.current.set(cachedKey, '');
      return '';
    }
  }

  async function enriquecerComIbge(registros = []) {
    const enriquecidos = [];
    const total = registros.length;
    for (let index = 0; index < registros.length; index += 1) {
      const row = registros[index];
      const ibgeDestino = await resolverIbgeDestino(row);
      enriquecidos.push({ ...row, ibgeDestino });
      if (index > 0 && index % 250 === 0) {
        setFeedback(`Resolvendo destinos do realizado: ${index.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')} CT-e(s)...`);
        await new Promise((resolve) => setTimeout(resolve, 0));
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

    const confirmar = window.confirm(
      `Tem certeza que deseja excluir ${total.toLocaleString('pt-BR')} CT-e(s) sem canal? Essa limpeza remove apenas os registros pendentes, não mexe nos CT-e(s) com canal.`
    );
    if (!confirmar) return;

    setCarregando(true);
    setErro('');
    try {
      const resp = await excluirRealizadoCtes({ somenteSemCanal: true });
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
    setFeedback('Buscando tabelas e rotas que a transportadora participa...');

    try {
      const baseOnline = await buscarBaseSimulacaoDb({
        nomeTransportadora: filtros.transportadora,
        canal: filtros.canal,
      });
      const base = baseOnline?.length ? baseOnline : transportadoras;

      if (!base?.length) {
        setErro('Não encontrei tabela/base de simulação para essa transportadora.');
        return;
      }

      const limite = rowsFiltradas.slice(0, 6000);
      if (rowsFiltradas.length > limite.length) {
        setFeedback(`Simulando os primeiros ${limite.length.toLocaleString('pt-BR')} CT-e(s) dos filtros para manter a tela leve.`);
      }

      const registrosComIbge = await enriquecerComIbge(limite);
      setFeedback('Calculando frete simulado por CT-e e comparando com o valor realizado...');

      const analise = simularRealizadoPorTransportadora({
        transportadoras: base,
        realizados: registrosComIbge,
        nomeTransportadora: filtros.transportadora,
        filtros,
        cidadePorIbge,
      });

      setResultado(analise);
      setFeedback(`Simulação concluída para ${filtros.transportadora}.`);
    } catch (error) {
      setErro(error.message || 'Erro ao simular realizado.');
    } finally {
      setSimulando(false);
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
            Limpar realizado
          </button>
        </div>
      </div>

      {erro ? <div className="sim-alert">{erro}</div> : null}
      {feedback ? <div className="sim-alert info">{feedback}</div> : null}

      {supabaseDiag ? (
        <div className={supabaseDiag.ok ? 'sim-alert success' : 'sim-alert'}>
          <strong>Diagnóstico Supabase:</strong> {supabaseDiag.host || 'sem projeto'} • tabela: {supabaseDiag.tabelaOk ? 'OK' : 'não confirmada'} • total: {Number(supabaseDiag.total || 0).toLocaleString('pt-BR')} • com canal: {Number(supabaseDiag.comCanal || 0).toLocaleString('pt-BR')} • sem canal: {Number(supabaseDiag.semCanal || 0).toLocaleString('pt-BR')} • importar: {supabaseDiag.rpcOk ? 'OK' : 'pendente'} • puxar: {supabaseDiag.listagemRpcOk ? 'OK' : 'pendente'}
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
          <button className="btn-primary" onClick={() => fileInputRef.current?.click()} disabled={importando || simulando}>
            {importando ? 'Importando...' : 'Selecionar arquivo realizado'}
          </button>
          {importMeta ? (
            <div className="import-meta-box">
              <strong>Última leitura:</strong> aba {importMeta.aba || '—'} • {Number(importMeta.registrosValidos || 0).toLocaleString('pt-BR')} CT-e(s) válidos
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
