import { useEffect, useMemo, useRef, useState } from 'react';
import {
  REGIOES_BRASIL,
  UFS_BRASIL,
  carregarOpcoesAvaliacao,
  carregarTransportadorasAvaliacao,
  carregarAnaliseServidorAvaliacao,
  carregarLinhasAvaliacao,
  carregarDetalheTransportadorasUf,
  contarRecorteAvaliacao,
  buscarLinhasParaExport,
  retomarTrechosPendentes,
  consolidarUfDestino,
  obterRegiaoPorUf,
} from '../services/avaliacaoPrazosService';
import {
  listarRecortesSalvosAvaliacao,
  salvarRecorteAvaliacao,
  carregarRecorteSalvoAvaliacao,
  excluirRecorteSalvoAvaliacao,
  gerarRotuloRecorte,
} from '../services/avaliacaoPrazosCache';
import {
  snapshotsNuvemDisponiveis,
  listarSnapshotsNuvemAvaliacao,
  salvarSnapshotNuvemAvaliacao,
  carregarSnapshotNuvemAvaliacao,
  excluirSnapshotNuvemAvaliacao,
} from '../services/avaliacaoPrazosSnapshotService';
import {
  agruparSnapshotsRegionais,
  aplicarBaseSnapshot,
  carregarBaseRegionalSnapshots,
} from '../services/avaliacaoPrazosSnapshotFiltroService';

const FILTROS_INICIAIS = {
  busca: '',
  fonteTabela: 'OFICIAL',
  canal: '',
  tipoTabela: '',
  status: '',
  transportadora: '',
  ufOrigem: '',
  ufDestino: '',
  regiaoOrigem: '',
  regiaoDestino: '',
  modalidade: '',
  comPrazo: '',
};

const FONTES_TABELA = [
  { valor: 'OFICIAL', label: 'Oficiais / cadastradas' },
  { valor: 'NEGOCIACAO', label: 'Em negociação' },
  { valor: 'REAJUSTE', label: 'Reajustes' },
];

const LIMITE_EXIBICAO_RELATORIO = 300;
const LIMITE_RECORTE_ANALISE = 350000;

const RECORTES_ORIGEM_REGIAO = [
  { regiao: 'NORTE', label: 'Norte → Brasil' },
  { regiao: 'NORDESTE', label: 'Nordeste → Brasil' },
  { regiao: 'CENTRO-OESTE', label: 'Centro-Oeste → Brasil' },
  { regiao: 'SUDESTE', label: 'Sudeste → Brasil' },
  { regiao: 'SUL', label: 'Sul → Brasil' },
];

const CAMPOS_FILTRO_SNAPSHOT_AUTO = new Set([
  'regiaoOrigem',
  'regiaoDestino',
  'ufOrigem',
  'ufDestino',
  'transportadora',
  'fonteTabela',
]);

const LACUNAS_INICIAIS = { resumo: { semCoberturaOficial: 0, umaOficial: 0, semPrazoOficial: 0, total: 0 }, itens: [] };

function labelTipoLacuna(tipo = '') {
  if (tipo === 'SEM_COBERTURA_OFICIAL') return 'Sem cobertura oficial';
  if (tipo === 'UMA_OFICIAL') return 'Uma transportadora oficial';
  if (tipo === 'SEM_PRAZO_OFICIAL') return 'Sem prazo oficial';
  return tipo || 'Lacuna';
}

const KPIS_INICIAIS = {
  registros: 0,
  oficiais: 0,
  negociacao: 0,
  transportadoras: 0,
  transportadorasOficiais: 0,
  menorPrazo: 0,
  prazoMedio: 0,
  rotas: 0,
  rotasOficiais: 0,
  rotasBaixaCobertura: 0,
  ufsSemCoberturaOficial: 0,
};

function moeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function numero(valor, casas = 0) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function labelFonte(fonte) {
  if (!fonte) return 'Todas as fontes';
  return FONTES_TABELA.find((item) => item.valor === fonte)?.label || fonte || 'Não identificada';
}

function formatarDataSalvo(iso = '') {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch {
    return iso;
  }
}

function temAlgumFiltro(filtros = {}) {
  return Boolean(
    String(filtros.busca || '').trim() ||
    String(filtros.canal || '').trim() ||
    String(filtros.tipoTabela || '').trim() ||
    String(filtros.status || '').trim() ||
    String(filtros.transportadora || '').trim() ||
    String(filtros.ufOrigem || '').trim() ||
    String(filtros.ufDestino || '').trim() ||
    String(filtros.regiaoOrigem || '').trim() ||
    String(filtros.regiaoDestino || '').trim() ||
    String(filtros.modalidade || '').trim() ||
    String(filtros.comPrazo || '').trim()
  );
}

function resumoInicial(filtros = {}, resumoGlobal = {}) {
  const fonte = filtros.fonteTabela || 'OFICIAL';
  const oficiais = Number(resumoGlobal.OFICIAL || 0);
  const negociacao = Number(resumoGlobal.NEGOCIACAO || 0);
  const reajuste = Number(resumoGlobal.REAJUSTE || 0);
  const registros = fonte === 'OFICIAL' ? oficiais : fonte === 'NEGOCIACAO' ? negociacao : fonte === 'REAJUSTE' ? reajuste : oficiais + negociacao + reajuste;

  return {
    ...KPIS_INICIAIS,
    registros,
    oficiais: fonte === 'OFICIAL' || !fonte ? oficiais : 0,
    negociacao: fonte === 'NEGOCIACAO' ? negociacao : fonte === 'REAJUSTE' ? reajuste : !fonte ? negociacao + reajuste : 0,
  };
}

function SelectFiltro({ label, value, onChange, options, placeholder = 'Todos' }) {
  const normalizadas = options.map((opcao) => (
    typeof opcao === 'string' ? { valor: opcao, label: opcao } : opcao
  ));
  if (value && !normalizadas.some((opcao) => opcao.valor === value)) {
    normalizadas.unshift({ valor: value, label: value });
  }

  return (
    <label style={styles.campoFiltro}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={styles.input}>
        <option value="">{placeholder}</option>
        {normalizadas.map((opcao) => <option key={opcao.valor} value={opcao.valor}>{opcao.label}</option>)}
      </select>
    </label>
  );
}

function CardIndicador({ titulo, valor, detalhe }) {
  return (
    <div style={styles.cardIndicador}>
      <div style={styles.cardTitulo}>{titulo}</div>
      <div style={styles.cardValor}>{valor}</div>
      {detalhe && <div style={styles.cardDetalhe}>{detalhe}</div>}
    </div>
  );
}

function BadgeFonte({ fonte }) {
  const oficial = fonte === 'OFICIAL';
  const reajuste = fonte === 'REAJUSTE';
  return (
    <span style={{
      ...styles.badgeFonte,
      ...(oficial ? styles.badgeFonteOficial : reajuste ? styles.badgeFonteReajuste : styles.badgeFonteNegociacao),
    }}>
      {labelFonte(fonte)}
    </span>
  );
}

function PainelDetalheUf({
  uf,
  detalhe,
  carregando,
  somenteOficial,
  onToggleSomenteOficial,
  onExportar,
  onVerRelatorio,
  onFechar,
}) {
  if (!uf) return null;

  const transportadoras = (detalhe?.transportadoras || []).filter((item) => !somenteOficial || item.oficial);
  const melhorMedia = transportadoras.find((item) => item.prazoMedio > 0)?.prazoMedio || 0;

  return (
    <div style={styles.modalOverlay} onClick={onFechar} role="presentation">
      <div
        style={styles.modalPainel}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-detalhe-uf"
      >
        <div style={styles.modalHeader}>
          <div>
            <div style={styles.kicker}>Detalhe por UF destino</div>
            <h2 id="titulo-detalhe-uf" style={styles.modalTitulo}>
              {uf.uf} · {uf.regiao}
            </h2>
            <div style={styles.textoSuave}>
              {uf.qtdTransportadorasOficiais} transportadoras oficiais · {uf.qtdRotas} rotas
              {uf.menorPrazoOficial ? ` · menor prazo oficial ${uf.menorPrazoOficial}d` : ''}
            </div>
          </div>
          <div style={styles.modalAcoes}>
            <label style={styles.checkboxLinha}>
              <input type="checkbox" checked={somenteOficial} onChange={(event) => onToggleSomenteOficial(event.target.checked)} />
              Somente oficiais
            </label>
            <button type="button" style={styles.botaoSecundario} onClick={onExportar} disabled={!transportadoras.length}>
              Exportar CSV
            </button>
            <button type="button" style={styles.botaoSecundario} onClick={() => onVerRelatorio('')}>
              Ver no relatório
            </button>
            <button type="button" style={styles.botaoSecundario} onClick={onFechar}>Fechar</button>
          </div>
        </div>

        <div style={styles.indicadoresGrid}>
          <CardIndicador titulo="Transportadoras" valor={numero(transportadoras.length)} detalhe={`${numero(transportadoras.filter((item) => item.oficial).length)} oficiais`} />
          <CardIndicador titulo="Menor prazo médio" valor={melhorMedia ? `${numero(melhorMedia, 1)}d` : '-'} detalhe="entre as transportadoras listadas" />
          <CardIndicador titulo="Linhas analisadas" valor={numero(detalhe?.totalLinhas || 0)} detalhe={detalhe?.parcial ? 'amostra parcial do recorte' : detalhe?.origem === 'servidor' ? 'buscado no servidor' : 'dados em memória'} />
        </div>

        {carregando && (
          <div style={styles.empty}>Carregando transportadoras e prazos...</div>
        )}

        {!carregando && transportadoras.length === 0 && (
          <div style={styles.empty}>Nenhuma transportadora encontrada para {uf.uf} neste recorte.</div>
        )}

        {!carregando && transportadoras.length > 0 && (
          <div style={styles.tabelaWrapper}>
            <table style={styles.tabela}>
              <thead>
                <tr>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>Transportadora</th>
                  <th style={styles.th}>Rotas</th>
                  <th style={styles.th}>Menor prazo</th>
                  <th style={styles.th}>Prazo médio</th>
                  <th style={styles.th}>Oficial</th>
                  <th style={styles.th}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {transportadoras.map((item, indice) => (
                  <tr key={item.transportadora}>
                    <td style={styles.td}>{indice + 1}</td>
                    <td style={styles.td}><strong>{item.transportadora}</strong></td>
                    <td style={styles.td}>{numero(item.qtdRotas)}</td>
                    <td style={styles.td}>{item.menorPrazo ? `${item.menorPrazo}d` : 'Sem prazo'}</td>
                    <td style={styles.td}>
                      {item.prazoMedio ? (
                        <span style={styles.badgePrazo}>{numero(item.prazoMedio, 1)}d</span>
                      ) : 'Sem prazo'}
                    </td>
                    <td style={styles.td}>{item.oficial ? 'Sim' : 'Não'}</td>
                    <td style={styles.td}>
                      <button type="button" style={styles.linkBotao} onClick={() => onVerRelatorio(item.transportadora)}>
                        Detalhar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function exportarCsvTransportadorasUf(uf = {}, transportadoras = []) {
  const colunas = [
    ['uf', 'UF destino'],
    ['regiao', 'Região'],
    ['transportadora', 'Transportadora'],
    ['qtdRotas', 'Rotas'],
    ['menorPrazo', 'Menor prazo (d)'],
    ['prazoMedio', 'Prazo médio (d)'],
    ['oficial', 'Oficial'],
  ];
  const escapar = (valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`;
  const conteudo = [
    colunas.map(([, label]) => escapar(label)).join(';'),
    ...transportadoras.map((item) => colunas.map(([campo]) => {
      if (campo === 'uf') return escapar(uf.uf);
      if (campo === 'regiao') return escapar(uf.regiao);
      if (campo === 'oficial') return escapar(item.oficial ? 'Sim' : 'Não');
      if (campo === 'prazoMedio') return escapar(numero(item.prazoMedio, 2));
      return escapar(item[campo]);
    }).join(';')),
  ].join('\n');

  const blob = new Blob([`\ufeff${conteudo}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transportadoras-${uf.uf || 'uf'}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportarCsv(linhas) {
  const colunas = [
    ['fonteLabel', 'Fonte'],
    ['canal', 'Canal'],
    ['transportadora', 'Transportadora'],
    ['cidadeOrigem', 'Origem'],
    ['ufOrigem', 'UF Origem'],
    ['regiaoOrigem', 'Região Origem'],
    ['cidadeDestino', 'Destino'],
    ['ufDestino', 'UF Destino'],
    ['regiaoDestino', 'Região Destino'],
    ['prazoLabel', 'Prazo'],
    ['modalidade', 'Modalidade'],
    ['tipoTabela', 'Tipo Tabela'],
    ['tipoNegociacao', 'Tipo Negociação'],
    ['status', 'Status'],
    ['tabelaNome', 'Tabela/Negociação'],
    ['valorReferencia', 'Valor Referência'],
    ['observacao', 'Observação'],
  ];

  const escapar = (valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`;
  const conteudo = [
    colunas.map(([, label]) => escapar(label)).join(';'),
    ...linhas.map((linha) => colunas.map(([campo]) => escapar(campo === 'valorReferencia' ? moeda(linha[campo]) : linha[campo])).join(';')),
  ].join('\n');

  const blob = new Blob([`\ufeff${conteudo}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `avaliacao-prazos-cobertura-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function estiloCardMapa(qtdTransportadorasOficiais, qtdTransportadorasTotal) {
  const qtd = qtdTransportadorasOficiais ?? qtdTransportadorasTotal ?? 0;
  if (qtd >= 4) return { background: '#e8f7ee', borderColor: '#86d19d', color: '#166534' };
  if (qtd >= 2) return { background: '#fff7e6', borderColor: '#f2c15f', color: '#92400e' };
  if (qtd === 1) return { background: '#fff1f2', borderColor: '#f4a5ad', color: '#9f1239' };
  return { background: '#f1f5f9', borderColor: '#cbd5e1', color: '#475569' };
}

export default function AvaliacaoPrazosPage() {
  const [opcoes, setOpcoes] = useState({
    canais: ['ATACADO', 'B2C'],
    tiposTabela: [],
    status: [],
    transportadoras: [],
    modalidades: [],
    ufsOrigem: UFS_BRASIL,
    resumoGlobal: {},
  });
  const [filtros, setFiltros] = useState(FILTROS_INICIAIS);
  const [aba, setAba] = useState('dashboard');
  const [analise, setAnalise] = useState({
    linhas: [],
    totalLinhas: 0,
    mapa: consolidarUfDestino([]),
    melhoresPrazos: [],
    rotasCriticas: [],
    lacunas: LACUNAS_INICIAIS,
  });
  const [kpis, setKpis] = useState(KPIS_INICIAIS);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [carregandoRelatorio, setCarregandoRelatorio] = useState(false);
  const [opcoesCarregando, setOpcoesCarregando] = useState(false);
  const [relatorioLimite, setRelatorioLimite] = useState(LIMITE_EXIBICAO_RELATORIO);
  const [progresso, setProgresso] = useState({ baixado: 0, total: 0, percentual: 0 });
  const [recortesSalvos, setRecortesSalvos] = useState([]);
  const [salvandoRecorte, setSalvandoRecorte] = useState(false);
  const [ufDetalhe, setUfDetalhe] = useState(null);
  const [detalheUf, setDetalheUf] = useState({ transportadoras: [], totalLinhas: 0, origem: '', parcial: false });
  const [carregandoDetalheUf, setCarregandoDetalheUf] = useState(false);
  const [detalheUfSomenteOficial, setDetalheUfSomenteOficial] = useState(false);
  const [filtroRelatorio, setFiltroRelatorio] = useState({ ufDestino: '', transportadora: '' });
  const [snapshotsNuvem, setSnapshotsNuvem] = useState([]);
  const [salvandoNuvem, setSalvandoNuvem] = useState(false);
  const [baseSnapshots, setBaseSnapshots] = useState(null);
  const [modoSnapshot, setModoSnapshot] = useState(false);
  const [mostrarGerenciarSnapshots, setMostrarGerenciarSnapshots] = useState(false);
  const [filtroLacuna, setFiltroLacuna] = useState('');
  // Guarda trechos que ficaram pendentes (timeout repetido) na última
  // exportação, junto com o que já foi baixado, para o botão "Continuar
  // exportação" tentar só essa parte e juntar com o resto — sem refazer tudo.
  const [exportacaoPendente, setExportacaoPendente] = useState(null);
  const cancelRef = useRef(false);
  const filtrosRef = useRef(filtros);
  const baseSnapshotsRef = useRef(baseSnapshots);
  const modoSnapshotRef = useRef(modoSnapshot);

  useEffect(() => { filtrosRef.current = filtros; }, [filtros]);
  useEffect(() => { baseSnapshotsRef.current = baseSnapshots; }, [baseSnapshots]);
  useEffect(() => { modoSnapshotRef.current = modoSnapshot; }, [modoSnapshot]);

  const nuvemDisponivel = snapshotsNuvemDisponiveis();
  const agrupamentoSnapshots = useMemo(
    () => agruparSnapshotsRegionais(snapshotsNuvem, filtros.canal || 'ATACADO'),
    [snapshotsNuvem, filtros.canal],
  );
  const analiseAgregadaPronta = analise.totalLinhas > 0 && (analise.mapa || []).some((uf) => uf.qtdRotas > 0 || uf.qtdTransportadorasOficiais > 0);

  const analiseCompleta = analise.totalLinhas > 0 && analise.linhas.length >= analise.totalLinhas;

  const filtroTemRecorte = useMemo(() => temAlgumFiltro(filtros), [filtros]);

  useEffect(() => {
    listarRecortesSalvosAvaliacao()
      .then(setRecortesSalvos)
      .catch(() => setRecortesSalvos([]));
  }, []);

  useEffect(() => {
    if (!nuvemDisponivel) {
      setSnapshotsNuvem([]);
      return undefined;
    }

    let ativo = true;
    listarSnapshotsNuvemAvaliacao()
      .then((lista) => { if (ativo) setSnapshotsNuvem(lista); })
      .catch(() => { if (ativo) setSnapshotsNuvem([]); });

    return () => { ativo = false; };
  }, [nuvemDisponivel]);

  useEffect(() => {
    let ativo = true;
    carregarOpcoesAvaliacao()
      .then((dados) => {
        if (!ativo) return;
        setOpcoes((atual) => ({ ...atual, ...dados }));
        setKpis(resumoInicial(FILTROS_INICIAIS, dados.resumoGlobal));
      })
      .catch((error) => {
        if (!ativo) return;
        setAviso(error.message || 'Não foi possível carregar o resumo inicial.');
      });
    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    if (!filtros.canal) return undefined;

    let ativo = true;
    setOpcoesCarregando(true);
    carregarTransportadorasAvaliacao({
      fonteTabela: filtros.fonteTabela,
      canal: filtros.canal,
    })
      .then((lista) => {
        if (!ativo) return;
        setOpcoes((atual) => ({ ...atual, transportadoras: lista }));
      })
      .catch(() => {
        // Mantém a lista anterior se a recarga falhar.
      })
      .finally(() => {
        if (ativo) setOpcoesCarregando(false);
      });

    return () => { ativo = false; };
  }, [filtros.canal, filtros.fonteTabela]);

  const aplicarRecorteOrigemRegiao = (regiao) => {
    setFiltros((atual) => ({
      ...atual,
      canal: atual.canal || 'ATACADO',
      regiaoOrigem: regiao,
      ufOrigem: '',
      regiaoDestino: '',
      ufDestino: '',
      transportadora: '',
    }));
    setErro('');
    setAviso(`Recorte "${regiao} → todo o Brasil": rotas com origem na região ${regiao}. UF origem é opcional para focar em um estado.`);
  };

  const atualizarFiltro = (campo, valor) => {
    setFiltros((atual) => {
      const proximo = { ...atual, [campo]: valor };
      if (campo === 'regiaoOrigem' && valor && proximo.ufOrigem) {
        const ufsRegiao = REGIOES_BRASIL[valor] || [];
        if (!ufsRegiao.includes(proximo.ufOrigem)) proximo.ufOrigem = '';
      }
      if (campo === 'ufOrigem' && valor && proximo.regiaoOrigem) {
        const ufsRegiao = REGIOES_BRASIL[proximo.regiaoOrigem] || [];
        if (!ufsRegiao.includes(valor)) proximo.regiaoOrigem = obterRegiaoPorUf(valor);
      }
      if (modoSnapshotRef.current && baseSnapshotsRef.current && CAMPOS_FILTRO_SNAPSHOT_AUTO.has(campo)) {
        queueMicrotask(() => aplicarFiltrosSnapshot(proximo));
      }
      return proximo;
    });
    if (campo !== 'busca') setAviso('');
    setErro('');
  };

  const placeholderTransportadora = useMemo(() => {
    if (opcoesCarregando) return 'Carregando transportadoras...';
    if (opcoes.transportadoras.length) return 'Todas';
    if (filtros.canal) return 'Carregando ou use busca geral';
    return 'Selecione o canal';
  }, [opcoesCarregando, opcoes.transportadoras.length, filtros.canal]);

  const resumirFiltrosAtivos = (filtrosAtivos = filtros) => {
    const partes = [];
    if (filtrosAtivos.regiaoOrigem) partes.push(`origem ${filtrosAtivos.regiaoOrigem}`);
    if (filtrosAtivos.ufOrigem) partes.push(`UF origem ${filtrosAtivos.ufOrigem}`);
    if (filtrosAtivos.regiaoDestino) partes.push(`destino ${filtrosAtivos.regiaoDestino}`);
    if (filtrosAtivos.ufDestino) partes.push(`UF destino ${filtrosAtivos.ufDestino}`);
    if (filtrosAtivos.transportadora) partes.push(filtrosAtivos.transportadora);
    if (String(filtrosAtivos.busca || '').trim()) partes.push(`busca "${String(filtrosAtivos.busca).trim()}"`);
    return partes.length ? partes.join(' · ') : 'Brasil inteiro';
  };

  const aplicarResultadoSnapshot = (resultado, mensagemExtra = '', filtrosAtivos = filtrosRef.current) => {
    if (resultado.vazio) {
      setAviso(resultado.mensagem || 'Nenhum dado no snapshot para os filtros atuais.');
      return false;
    }
    setKpis(resultado.kpis);
    setAnalise(resultado.analise);
    setRelatorioLimite(LIMITE_EXIBICAO_RELATORIO);
    setProgresso({
      baixado: resultado.analise.totalLinhas,
      total: resultado.analise.totalLinhas,
      percentual: 100,
    });
    setFiltroRelatorio({ ufDestino: '', transportadora: '' });
    setAba('dashboard');
    setAviso(
      `${mensagemExtra}Visão da nuvem: ${numero(resultado.analise.totalLinhas)} linhas · `
      + `${resultado.meta?.snapshotsUsados || 0} snapshot(s) · ${resumirFiltrosAtivos(filtrosAtivos)}. `
      + 'Filtros locais — sem nova consulta ao banco.',
    );
    return true;
  };

  const aplicarFiltrosSnapshot = (filtrosAlvo) => {
    const alvo = (filtrosAlvo && typeof filtrosAlvo === 'object' && 'fonteTabela' in filtrosAlvo)
      ? filtrosAlvo
      : filtrosRef.current;
    const base = baseSnapshotsRef.current;

    if (!base?.snapshots?.length) {
      setAviso('Carregue a base na nuvem antes de aplicar filtros locais.');
      return;
    }
    setErro('');
    const resultado = aplicarBaseSnapshot(base, alvo);
    aplicarResultadoSnapshot(resultado, '', alvo);
  };

  const carregarBaseNuvem = async () => {
    if (!agrupamentoSnapshots.regioesPresentes.length) {
      setAviso('Nenhum snapshot regional na nuvem. Salve as 5 regiões de origem (Norte, Nordeste, Centro-Oeste, Sudeste, Sul) antes.');
      return;
    }

    setCarregando(true);
    setErro('');
    try {
      const base = await carregarBaseRegionalSnapshots(snapshotsNuvem, {
        canal: filtros.canal || 'ATACADO',
      });
      setBaseSnapshots(base);
      setModoSnapshot(true);
      const filtrosBase = {
        ...FILTROS_INICIAIS,
        fonteTabela: 'OFICIAL',
        canal: base.canal || 'ATACADO',
      };
      setFiltros(filtrosBase);
      const resultado = aplicarBaseSnapshot(base, filtrosBase);
      aplicarResultadoSnapshot(
        resultado,
        base.regioesFaltando.length
          ? `Base parcial (${base.regioesFaltando.join(', ')} faltando). `
          : 'Base Brasil completa carregada. ',
      );
    } catch (error) {
      setErro(error.message || 'Erro ao carregar base regional da nuvem.');
    } finally {
      setCarregando(false);
    }
  };

  const sairModoSnapshot = () => {
    setModoSnapshot(false);
    setBaseSnapshots(null);
    limparFiltros({ sairSnapshot: true });
  };

  const limparFiltros = ({ sairSnapshot = false } = {}) => {
    cancelRef.current = true;
    const filtrosLimpos = {
      ...FILTROS_INICIAIS,
      canal: (!sairSnapshot && baseSnapshots?.canal) || filtros.canal || 'ATACADO',
    };
    setFiltros(filtrosLimpos);
    setFiltroRelatorio({ ufDestino: '', transportadora: '' });
    setErro('');

    if (modoSnapshot && baseSnapshots && !sairSnapshot) {
      const resultado = aplicarBaseSnapshot(baseSnapshots, filtrosLimpos);
      aplicarResultadoSnapshot(resultado, 'Filtros resetados. ');
      return;
    }

    if (sairSnapshot) {
      setModoSnapshot(false);
      setBaseSnapshots(null);
    }

    setAnalise({
      linhas: [],
      totalLinhas: 0,
      mapa: consolidarUfDestino([]),
      melhoresPrazos: [],
      rotasCriticas: [],
      lacunas: LACUNAS_INICIAIS,
    });
    setKpis(resumoInicial(filtrosLimpos, opcoes.resumoGlobal));
    setAviso('Filtros limpos. Escolha um recorte e clique em Buscar análise.');
  };

  const buscarAnalise = async () => {
    if (modoSnapshot && baseSnapshots?.snapshots?.length) {
      aplicarFiltrosSnapshot();
      return;
    }
    if (!filtroTemRecorte && filtros.fonteTabela === 'OFICIAL') {
      setAviso('Selecione pelo menos canal, região, UF, transportadora ou busca antes de carregar a análise. Para recortes amplos, combine canal com região ou UF.');
      return;
    }

    cancelRef.current = false;
    setCarregando(true);
    setErro('');
    setProgresso({ baixado: 0, total: 0, percentual: 0 });
    setAnalise({
      linhas: [],
      totalLinhas: 0,
      mapa: consolidarUfDestino([]),
      melhoresPrazos: [],
      rotasCriticas: [],
      lacunas: LACUNAS_INICIAIS,
    });
    setKpis(KPIS_INICIAIS);
    setFiltroRelatorio({ ufDestino: '', transportadora: '' });
    setRelatorioLimite(LIMITE_EXIBICAO_RELATORIO);

    try {
      const totalRecorte = await contarRecorteAvaliacao(filtros);
      if (cancelRef.current) return;

      if (totalRecorte > LIMITE_RECORTE_ANALISE) {
        setErro(`Recorte muito amplo (${numero(totalRecorte)} linhas). Refine com região, UF ou transportadora antes de analisar.`);
        return;
      }

      if (totalRecorte === 0) {
        setAviso('Nenhum registro encontrado para o recorte selecionado.');
        return;
      }

      const recorteRegional = Boolean(filtros.regiaoOrigem || filtros.regiaoDestino);
      setAviso(
        recorteRegional || totalRecorte > 25000
          ? `Calculando ${numero(totalRecorte)} linhas no servidor (KPIs, mapa, lacunas)...`
          : 'Calculando indicadores no servidor...',
      );

      const resultado = await carregarAnaliseServidorAvaliacao(filtros, {
        limiteRelatorio: LIMITE_EXIBICAO_RELATORIO,
        totalRecorte,
        shouldCancel: () => cancelRef.current,
        onProgress: ({ baixado, total }) => {
          setProgresso({
            baixado,
            total: total ?? totalRecorte,
            percentual: total ? Math.min(100, Math.round((baixado / total) * 100)) : 0,
          });
          setKpis((atual) => ({ ...atual, registros: baixado }));
        },
      });
      if (cancelRef.current) return;

      setKpis(resultado.kpis);
      setAnalise({
        linhas: resultado.linhas,
        totalLinhas: resultado.totalLinhas,
        mapa: resultado.mapa,
        melhoresPrazos: resultado.melhoresPrazos,
        rotasCriticas: resultado.rotasCriticas,
        lacunas: resultado.lacunas || LACUNAS_INICIAIS,
      });
      setFiltroRelatorio({ ufDestino: '', transportadora: '' });
      setAba('dashboard');
      if (resultado.modo === 'cliente') {
        setAviso(
          resultado.limitado
            ? `Análise parcial: ${numero(resultado.linhas.length)} de ${numero(resultado.totalLinhas)} linhas carregadas.`
            : `Análise completa: ${numero(resultado.totalLinhas)} linhas consolidadas (KPIs, mapa e rotas sobre o recorte inteiro).`,
        );
      } else {
        setAviso(
          `Análise concluída no servidor: ${numero(totalRecorte)} linhas no recorte · `
          + `${numero(resultado.linhas.length)} linhas no relatório (use Exportar CSV para a base completa).`,
        );
      }
    } catch (error) {
      setErro(error.message || 'Erro ao carregar análise.');
    } finally {
      setCarregando(false);
    }
  };

  const cancelarAnalise = () => {
    cancelRef.current = true;
    setAviso('Cancelamento solicitado.');
  };

  const abrirDetalheUf = async (itemMapa) => {
    if (!itemMapa?.uf || !analise.totalLinhas) return;

    setUfDetalhe(itemMapa);
    setDetalheUfSomenteOficial(false);
    setCarregandoDetalheUf(true);
    setDetalheUf({ transportadoras: [], totalLinhas: 0, origem: '', parcial: false });

    try {
      const resultado = await carregarDetalheTransportadorasUf(filtros, itemMapa.uf, analise.linhas);
      setDetalheUf(resultado);
    } catch (error) {
      setErro(error.message || 'Erro ao carregar transportadoras da UF.');
      setUfDetalhe(null);
    } finally {
      setCarregandoDetalheUf(false);
    }
  };

  const fecharDetalheUf = () => {
    setUfDetalhe(null);
    setDetalheUfSomenteOficial(false);
    setDetalheUf({ transportadoras: [], totalLinhas: 0, origem: '', parcial: false });
  };

  const exportarDetalheUf = () => {
    if (!ufDetalhe) return;
    const lista = (detalheUf.transportadoras || []).filter((item) => !detalheUfSomenteOficial || item.oficial);
    exportarCsvTransportadorasUf(ufDetalhe, lista);
    setAviso(`CSV exportado com ${numero(lista.length)} transportadoras de ${ufDetalhe.uf}.`);
  };

  const verRelatorioDetalheUf = (transportadora = '') => {
    if (!ufDetalhe) return;
    setFiltroRelatorio({ ufDestino: ufDetalhe.uf, transportadora: transportadora || '' });
    fecharDetalheUf();
    setAba('relatorio');
    setRelatorioLimite(LIMITE_EXIBICAO_RELATORIO);
    setAviso(
      transportadora
        ? `Relatório filtrado: ${ufDetalhe.uf} · ${transportadora}`
        : `Relatório filtrado por UF destino ${ufDetalhe.uf}`,
    );
  };

  const carregarMaisRelatorio = async () => {
    if (carregandoRelatorio) return;

    if (relatorioLimite < analise.linhas.length) {
      setRelatorioLimite((limite) => Math.min(limite + LIMITE_EXIBICAO_RELATORIO, analise.linhas.length));
      return;
    }

    if (analise.linhas.length >= analise.totalLinhas) return;

    setCarregandoRelatorio(true);
    try {
      const pagina = await carregarLinhasAvaliacao(filtros, {
        limite: LIMITE_EXIBICAO_RELATORIO,
        offset: analise.linhas.length,
        contar: false,
      });
      setAnalise((atual) => ({
        ...atual,
        linhas: [...atual.linhas, ...pagina.linhas],
      }));
      setRelatorioLimite((limite) => limite + pagina.linhas.length);
    } catch (error) {
      setAviso(error.message || 'Não foi possível carregar mais linhas do relatório.');
    } finally {
      setCarregandoRelatorio(false);
    }
  };

  const salvarRecorte = async () => {
    if (!analiseCompleta) {
      setAviso('Aguarde a análise terminar de carregar todas as linhas antes de salvar.');
      return;
    }

    const sugestao = gerarRotuloRecorte(filtros);
    const nome = window.prompt('Nome do recorte salvo:', sugestao);
    if (nome === null) return;

    setSalvandoRecorte(true);
    setErro('');
    try {
      await salvarRecorteAvaliacao({ nome, filtros, kpis, analise });
      const lista = await listarRecortesSalvosAvaliacao();
      setRecortesSalvos(lista);
      setAviso(`Recorte salvo no navegador (${numero(analise.totalLinhas)} linhas). Use "Retomar" depois sem baixar tudo de novo.`);
    } catch (error) {
      setErro(error.message || 'Erro ao salvar recorte local.');
    } finally {
      setSalvandoRecorte(false);
    }
  };

  const retomarRecorte = async (id) => {
    setCarregando(true);
    setErro('');
    try {
      const dados = await carregarRecorteSalvoAvaliacao(id);
      setFiltros({ ...FILTROS_INICIAIS, ...dados.filtros });
      setKpis(dados.kpis);
      setAnalise(dados.analise);
      setRelatorioLimite(LIMITE_EXIBICAO_RELATORIO);
      setProgresso({ baixado: dados.analise.totalLinhas, total: dados.analise.totalLinhas, percentual: 100 });
      setFiltroRelatorio({ ufDestino: '', transportadora: '' });
      setAba('dashboard');
      setAviso(`Recorte retomado: ${dados.meta.nome} · ${numero(dados.meta.totalLinhas)} linhas · salvo em ${formatarDataSalvo(dados.meta.salvoEm)}`);
    } catch (error) {
      setErro(error.message || 'Erro ao retomar recorte salvo.');
    } finally {
      setCarregando(false);
    }
  };

  const removerRecorteSalvo = async (id) => {
    if (!window.confirm('Excluir este recorte salvo do navegador?')) return;
    try {
      await excluirRecorteSalvoAvaliacao(id);
      const lista = await listarRecortesSalvosAvaliacao();
      setRecortesSalvos(lista);
      setAviso('Recorte salvo excluído.');
    } catch (error) {
      setErro(error.message || 'Erro ao excluir recorte salvo.');
    }
  };

  const salvarSnapshotNuvem = async () => {
    if (!analiseAgregadaPronta) {
      setAviso('Conclua a análise antes de salvar o snapshot na nuvem.');
      return;
    }

    const sugestao = gerarRotuloRecorte(filtros);
    const nome = window.prompt('Nome do snapshot na nuvem (visível para a equipe):', sugestao);
    if (nome === null) return;

    setSalvandoNuvem(true);
    setErro('');
    try {
      await salvarSnapshotNuvemAvaliacao({ nome, filtros, kpis, analise });
      const lista = await listarSnapshotsNuvemAvaliacao();
      setSnapshotsNuvem(lista);
      setAviso(`Snapshot salvo na nuvem (${numero(analise.totalLinhas)} linhas no recorte · agregados apenas).`);
    } catch (error) {
      setErro(error.message || 'Erro ao salvar snapshot na nuvem.');
    } finally {
      setSalvandoNuvem(false);
    }
  };

  const retomarSnapshotNuvem = async (id) => {
    setCarregando(true);
    setErro('');
    try {
      const dados = await carregarSnapshotNuvemAvaliacao(id);
      const base = {
        canal: dados.filtros?.canal || 'ATACADO',
        carregadaEm: new Date().toISOString(),
        regioesPresentes: [dados.filtros?.regiaoOrigem].filter(Boolean),
        regioesFaltando: [],
        snapshots: [dados],
        totalLinhas: dados.analise?.totalLinhas || 0,
      };
      setBaseSnapshots(base);
      setModoSnapshot(true);
      const filtrosSnapshot = { ...FILTROS_INICIAIS, ...dados.filtros };
      setFiltros(filtrosSnapshot);
      const resultado = aplicarBaseSnapshot(base, filtrosSnapshot);
      aplicarResultadoSnapshot(resultado, `Snapshot ${dados.meta?.nome} carregado. `);
    } catch (error) {
      setErro(error.message || 'Erro ao retomar snapshot da nuvem.');
    } finally {
      setCarregando(false);
    }
  };

  const removerSnapshotNuvem = async (id) => {
    if (!window.confirm('Excluir este snapshot da nuvem?')) return;
    try {
      await excluirSnapshotNuvemAvaliacao(id);
      const lista = await listarSnapshotsNuvemAvaliacao();
      setSnapshotsNuvem(lista);
      setAviso('Snapshot da nuvem excluído.');
    } catch (error) {
      setErro(error.message || 'Erro ao excluir snapshot da nuvem.');
    }
  };

  const exportar = async () => {
    if (!filtroTemRecorte && filtros.fonteTabela === 'OFICIAL') {
      setAviso('Selecione um recorte antes de exportar.');
      return;
    }

    if (analise.linhas.length >= analise.totalLinhas && analise.linhas.length > 0) {
      exportarCsv(analise.linhas);
      setAviso(`CSV exportado com ${numero(analise.linhas.length)} linhas (recorte completo já carregado).`);
      return;
    }

    setCarregando(true);
    setAviso('Preparando exportação completa do recorte...');
    setExportacaoPendente(null);
    try {
      const { linhas, total, limitado, trechosPulados } = await buscarLinhasParaExport(filtros, { teto: LIMITE_RECORTE_ANALISE });
      if (!linhas.length) {
        setAviso('Nenhuma linha encontrada para exportar.');
        return;
      }
      exportarCsv(linhas);
      if (trechosPulados.length) {
        setExportacaoPendente({ filtros, linhas, trechosPulados });
      }
      const avisoPulada = trechosPulados.length
        ? ` ${trechosPulados.length} trecho(s) ficaram de fora por timeout repetido — clique em "Continuar exportação" para tentar só essa parte.`
        : '';
      if (limitado) {
        setAviso(`CSV exportado com ${numero(linhas.length)} de ${numero(total)} linhas (teto de segurança).${avisoPulada} Refine os filtros para exportar tudo.`);
      } else {
        setAviso(`CSV exportado com ${numero(linhas.length)} linhas.${avisoPulada}`);
      }
    } catch (error) {
      setErro(error.message || 'Erro ao exportar CSV.');
    } finally {
      setCarregando(false);
    }
  };

  // Tenta de novo só os trechos pendentes da última exportação (timeout
  // repetido) e junta com o que já tinha sido baixado — mesma lógica do
  // "Continuar processamento" do CT-e, aplicada à exportação.
  const continuarExportacaoPendente = async () => {
    if (!exportacaoPendente?.trechosPulados?.length) return;

    setCarregando(true);
    setAviso(`Tentando de novo ${exportacaoPendente.trechosPulados.length} trecho(s) pendente(s)...`);
    try {
      const { linhas: linhasNovas, trechosPulados: aindaPendentes } = await retomarTrechosPendentes(
        exportacaoPendente.filtros,
        exportacaoPendente.trechosPulados
      );
      const linhasCompletas = [...exportacaoPendente.linhas, ...linhasNovas];
      exportarCsv(linhasCompletas);

      if (aindaPendentes.length) {
        setExportacaoPendente({ ...exportacaoPendente, linhas: linhasCompletas, trechosPulados: aindaPendentes });
        setAviso(
          `CSV exportado com ${numero(linhasCompletas.length)} linhas. Ainda restam ${aindaPendentes.length} trecho(s) pendente(s) — pode clicar em "Continuar exportação" de novo.`
        );
      } else {
        setExportacaoPendente(null);
        setAviso(`CSV exportado com ${numero(linhasCompletas.length)} linhas — todos os trechos pendentes foram recuperados.`);
      }
    } catch (error) {
      setErro(error.message || 'Erro ao continuar exportação.');
    } finally {
      setCarregando(false);
    }
  };

  const resumoFontes = useMemo(() => ({
    oficial: kpis.oficiais || opcoes.resumoGlobal?.OFICIAL || 0,
    negociacao: kpis.negociacao || 0,
  }), [kpis, opcoes.resumoGlobal]);

  const linhasRelatorioBase = useMemo(() => {
    let linhas = analise.linhas;
    if (filtroRelatorio.ufDestino) {
      linhas = linhas.filter((linha) => linha.ufDestino === filtroRelatorio.ufDestino);
    }
    if (filtroRelatorio.transportadora) {
      const alvo = filtroRelatorio.transportadora.trim().toLowerCase();
      linhas = linhas.filter((linha) => String(linha.transportadora || '').trim().toLowerCase() === alvo);
    }
    return linhas;
  }, [analise.linhas, filtroRelatorio]);

  const lacunasVisiveis = useMemo(() => {
    const itens = analise.lacunas?.itens || [];
    if (!filtroLacuna) return itens;
    return itens.filter((item) => item.tipo === filtroLacuna);
  }, [analise.lacunas, filtroLacuna]);

  const relatorioVisivel = linhasRelatorioBase.slice(0, relatorioLimite);
  const rotasVisiveis = analise.rotasCriticas;
  const relatorioTemMais = relatorioLimite < linhasRelatorioBase.length || analise.linhas.length < analise.totalLinhas;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>4.36.2 · Análise por recorte (servidor)</div>
          <h1 style={styles.titulo}>Avaliação de Prazos e Cobertura</h1>
          <p style={styles.subtitulo}>
            {modoSnapshot
              ? 'Base regional já carregada da nuvem. Use os filtros abaixo e clique em Aplicar filtros — navegação local, sem nova consulta ao banco.'
              : 'Para mapear cobertura por região de saída, use Região origem (ex.: Sul = PR+RS+SC indo para todo o Brasil). UF origem é opcional para focar um estado.'}
          </p>
        </div>
        <div style={styles.acoesTopo}>
          {modoSnapshot ? (
            <>
              <button type="button" onClick={() => aplicarFiltrosSnapshot()} disabled={carregando} style={styles.botaoPrimario}>
                Aplicar filtros
              </button>
              <button type="button" onClick={sairModoSnapshot} style={styles.botaoSecundario}>
                Sair da base nuvem
              </button>
            </>
          ) : (
            <button type="button" onClick={buscarAnalise} disabled={carregando} style={styles.botaoPrimario}>
              {carregando ? 'Carregando...' : 'Buscar análise'}
            </button>
          )}
          {carregando && !modoSnapshot && (
            <button type="button" onClick={cancelarAnalise} style={styles.botaoSecundario}>Cancelar</button>
          )}
          <button type="button" onClick={salvarRecorte} disabled={carregando || salvandoRecorte || !analiseCompleta} style={styles.botaoSecundario}>
            {salvandoRecorte ? 'Salvando...' : 'Salvar no navegador'}
          </button>
          {nuvemDisponivel && (
            <button type="button" onClick={salvarSnapshotNuvem} disabled={carregando || salvandoNuvem || !analiseAgregadaPronta} style={styles.botaoSecundario}>
              {salvandoNuvem ? 'Salvando...' : 'Salvar na nuvem'}
            </button>
          )}
          <button type="button" onClick={exportar} disabled={carregando} style={styles.botaoSecundario}>
            Exportar CSV
          </button>
          {exportacaoPendente?.trechosPulados?.length > 0 && (
            <button type="button" onClick={continuarExportacaoPendente} disabled={carregando} style={styles.botaoPrimario}>
              Continuar exportação ({exportacaoPendente.trechosPulados.length} pendente{exportacaoPendente.trechosPulados.length > 1 ? 's' : ''})
            </button>
          )}
        </div>
      </div>

      {erro && <div style={styles.alertaErro}>{erro}</div>}
      {aviso && <div style={styles.alertaAviso}>{aviso}</div>}

      <section style={styles.avisoFonte}>
        <strong>Fonte principal:</strong> Oficiais / cadastradas. <span>Negociações e reajustes são complementares e aparecem identificados como fonte da tabela.</span>
      </section>

      <section style={styles.recortesSalvosBox}>
        <div style={styles.headerSecao}>
          <strong style={{ fontSize: 13, color: '#0F2347' }}>Recortes salvos no navegador</strong>
          <span style={styles.textoSuave}>Salve após concluir a análise · retome sem baixar de novo</span>
        </div>
        {recortesSalvos.length === 0 && (
          <div style={styles.empty}>Nenhum recorte salvo ainda. Ex.: conclua &quot;Sul → Brasil&quot; e clique em Salvar recorte.</div>
        )}
        <div style={styles.listaRecortesSalvos}>
          {recortesSalvos.map((item) => (
            <div key={item.id} style={styles.cardRecorteSalvo}>
              <div>
                <strong>{item.nome}</strong>
                <div style={styles.textoSuave}>
                  {numero(item.totalLinhas)} linhas · {formatarDataSalvo(item.salvoEm)}
                </div>
                <div style={styles.textoSuave}>{item.rotulo || gerarRotuloRecorte(item.filtros)}</div>
              </div>
              <div style={styles.acoesRecorteSalvo}>
                <button type="button" onClick={() => retomarRecorte(item.id)} disabled={carregando} style={styles.botaoPrimario}>Retomar</button>
                <button type="button" onClick={() => removerRecorteSalvo(item.id)} style={styles.botaoSecundario}>Excluir</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {nuvemDisponivel && (
        <section style={styles.recortesNuvemBox}>
          <div style={styles.headerSecao}>
            <strong style={{ fontSize: 13, color: '#0F2347' }}>Base na nuvem — Brasil por origem</strong>
            <span style={styles.textoSuave}>
              {modoSnapshot
                ? 'Modo snapshot ativo · filtros locais'
                : 'Carregue os snapshots regionais uma vez · filtre depois sem bater no banco'}
            </span>
          </div>

          <div style={styles.baseNuvemResumo}>
            <div>
              <strong>
                {agrupamentoSnapshots.regioesPresentes.length}/5 regiões · {filtros.canal || 'ATACADO'}
              </strong>
              <div style={styles.textoSuave}>
                {numero(agrupamentoSnapshots.totalLinhas)} linhas nos snapshots
                {agrupamentoSnapshots.regioesFaltando.length > 0
                  ? ` · faltam: ${agrupamentoSnapshots.regioesFaltando.join(', ')}`
                  : ' · base Brasil completa'}
              </div>
            </div>
            <div style={styles.acoesRecorteSalvo}>
              {!modoSnapshot ? (
                <button
                  type="button"
                  onClick={carregarBaseNuvem}
                  disabled={carregando || !agrupamentoSnapshots.regioesPresentes.length}
                  style={styles.botaoPrimario}
                >
                  {carregando ? 'Carregando...' : 'Carregar base na nuvem'}
                </button>
              ) : (
                <button type="button" onClick={() => aplicarFiltrosSnapshot()} disabled={carregando} style={styles.botaoPrimario}>
                  Aplicar filtros
                </button>
              )}
              <button
                type="button"
                onClick={() => setMostrarGerenciarSnapshots((atual) => !atual)}
                style={styles.botaoSecundario}
              >
                {mostrarGerenciarSnapshots ? 'Ocultar snapshots' : 'Gerenciar snapshots'}
              </button>
            </div>
          </div>

          <div style={styles.chipsRegioes}>
            {RECORTES_ORIGEM_REGIAO.map(({ regiao, label }) => {
              const presente = Boolean(agrupamentoSnapshots.porRegiao[regiao]);
              const ativo = filtros.regiaoOrigem === regiao;
              return (
                <button
                  key={regiao}
                  type="button"
                  disabled={!presente || !modoSnapshot}
                  onClick={() => {
                    const proximo = { ...filtros, regiaoOrigem: ativo ? '' : regiao, ufOrigem: '' };
                    setFiltros(proximo);
                    if (modoSnapshot) aplicarFiltrosSnapshot(proximo);
                  }}
                  style={{
                    ...(ativo ? styles.recorteAtivo : styles.recorteBotao),
                    opacity: presente ? 1 : 0.45,
                  }}
                  title={presente ? label : `${label} — snapshot não salvo`}
                >
                  {label.split(' → ')[0]}{presente ? '' : ' · —'}
                </button>
              );
            })}
          </div>

          {mostrarGerenciarSnapshots && (
            <div style={styles.listaRecortesSalvos}>
              {snapshotsNuvem.length === 0 && (
                <div style={styles.empty}>Nenhum snapshot na nuvem. Salve após concluir uma análise regional.</div>
              )}
              {snapshotsNuvem.map((item) => (
                <div key={item.id} style={styles.cardRecorteSalvo}>
                  <div>
                    <strong>{item.nome}</strong>
                    <div style={styles.textoSuave}>
                      {numero(item.totalLinhas)} linhas · {formatarDataSalvo(item.salvoEm)} · nuvem
                    </div>
                    <div style={styles.textoSuave}>{item.rotulo || gerarRotuloRecorte(item.filtros)}</div>
                  </div>
                  <div style={styles.acoesRecorteSalvo}>
                    <button type="button" onClick={() => retomarSnapshotNuvem(item.id)} disabled={carregando} style={styles.botaoSecundario}>Abrir</button>
                    <button type="button" onClick={() => removerSnapshotNuvem(item.id)} style={styles.botaoSecundario}>Excluir</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!modoSnapshot && (
      <section style={styles.recortesRapidos}>
        <strong style={{ fontSize: 13, color: '#0F2347' }}>Recortes rápidos — origem → todo o Brasil</strong>
        <div style={styles.recortesBotoes}>
          {RECORTES_ORIGEM_REGIAO.map(({ regiao, label }) => (
            <button
              key={regiao}
              type="button"
              onClick={() => aplicarRecorteOrigemRegiao(regiao)}
              style={filtros.regiaoOrigem === regiao && !filtros.ufOrigem ? styles.recorteAtivo : styles.recorteBotao}
            >
              {label}
            </button>
          ))}
        </div>
        <span style={styles.textoSuave}>
          Canal padrão ATACADO. Deixe destino em &quot;Todos&quot; para ver saídas da região para o resto do país. Transportadoras carregam ao escolher o canal.
        </span>
      </section>
      )}

      <section style={styles.filtrosBox}>
        {modoSnapshot && (
          <div style={{ ...styles.alertaAviso, gridColumn: '1 / -1', marginBottom: 0 }}>
            Filtros abaixo estão ligados à base da nuvem: Região origem escolhe o snapshot; destino, UF, transportadora e busca refinam mapa, lacunas e rotas. Dropdowns aplicam ao mudar; busca geral usa o botão Aplicar filtros. Relatório/CSV ainda consultam o banco se necessário.
          </div>
        )}
        <label style={{ ...styles.campoFiltro, gridColumn: 'span 2' }}>
          <span>Busca geral</span>
          <input
            value={filtros.busca}
            onChange={(event) => atualizarFiltro('busca', event.target.value)}
            placeholder="Transportadora, cidade, UF, tabela, fonte, observação..."
            style={styles.input}
          />
        </label>
        <SelectFiltro label="Fonte da tabela" value={filtros.fonteTabela} onChange={(v) => atualizarFiltro('fonteTabela', v)} options={FONTES_TABELA} />
        <SelectFiltro label="Canal" value={filtros.canal} onChange={(v) => atualizarFiltro('canal', v)} options={opcoes.canais} />
        <SelectFiltro label="Transportadora" value={filtros.transportadora} onChange={(v) => atualizarFiltro('transportadora', v)} options={opcoes.transportadoras} placeholder={placeholderTransportadora} />
        <SelectFiltro label="Região origem" value={filtros.regiaoOrigem} onChange={(v) => atualizarFiltro('regiaoOrigem', v)} options={Object.keys(REGIOES_BRASIL)} />
        <SelectFiltro label="Região destino" value={filtros.regiaoDestino} onChange={(v) => atualizarFiltro('regiaoDestino', v)} options={Object.keys(REGIOES_BRASIL)} />
        <SelectFiltro label="UF origem" value={filtros.ufOrigem} onChange={(v) => atualizarFiltro('ufOrigem', v)} options={UFS_BRASIL} />
        <SelectFiltro label="UF destino" value={filtros.ufDestino} onChange={(v) => atualizarFiltro('ufDestino', v)} options={UFS_BRASIL} />
        <SelectFiltro label="Modalidade" value={filtros.modalidade} onChange={(v) => atualizarFiltro('modalidade', v)} options={opcoes.modalidades} />
        <SelectFiltro label="Tipo tabela" value={filtros.tipoTabela} onChange={(v) => atualizarFiltro('tipoTabela', v)} options={opcoes.tiposTabela} />
        <SelectFiltro label="Status" value={filtros.status} onChange={(v) => atualizarFiltro('status', v)} options={opcoes.status} />
        <SelectFiltro label="Prazo" value={filtros.comPrazo} onChange={(v) => atualizarFiltro('comPrazo', v)} options={['COM_PRAZO', 'SEM_PRAZO']} />
        <div style={styles.filtroAcoes}>
          <button type="button" onClick={() => limparFiltros()} style={styles.botaoSecundario}>Limpar filtros</button>
          <button type="button" onClick={() => atualizarFiltro('fonteTabela', '')} style={styles.botaoSecundario}>Ver todas as fontes</button>
          {modoSnapshot ? (
            <button type="button" onClick={() => aplicarFiltrosSnapshot()} disabled={carregando} style={styles.botaoPrimario}>Aplicar filtros</button>
          ) : (
            <button type="button" onClick={buscarAnalise} disabled={carregando} style={styles.botaoPrimario}>Buscar análise</button>
          )}
        </div>
      </section>

      {carregando && progresso.total > 0 && (
        <section style={styles.progressoBox}>
          <div style={styles.progressoTopo}>
            <strong>Consolidando recorte regional</strong>
            <span>{numero(progresso.baixado)} / {numero(progresso.total)} linhas</span>
          </div>
          <div style={styles.barraProgresso}>
            <div style={{ ...styles.barraProgressoInterna, width: `${progresso.percentual}%` }} />
          </div>
          <div style={styles.textoSuave}>{progresso.percentual}% — pode levar alguns minutos em recortes grandes</div>
        </section>
      )}

      <section style={styles.indicadoresGrid}>
        <CardIndicador titulo="Cobertura oficial" valor={numero(kpis.oficiais)} detalhe="linhas oficiais no recorte" />
        <CardIndicador titulo="Linhas filtradas" valor={numero(kpis.registros)} detalhe={labelFonte(filtros.fonteTabela)} />
        <CardIndicador titulo="Transportadoras" valor={numero(kpis.transportadoras)} detalhe={`${numero(kpis.transportadorasOficiais)} oficiais no recorte`} />
        <CardIndicador titulo="Menor prazo" valor={kpis.menorPrazo ? `${kpis.menorPrazo} dia${kpis.menorPrazo === 1 ? '' : 's'}` : 'N/I'} detalhe={`média ${numero(kpis.prazoMedio, 1)} dias`} />
        <CardIndicador titulo="Baixa cobertura" valor={numero(kpis.rotasBaixaCobertura)} detalhe="rotas com até 1 transportadora oficial" />
        <CardIndicador titulo="Sem cobertura oficial" valor={numero(kpis.ufsSemCoberturaOficial)} detalhe="UFs sem transportadora oficial no recorte" />
      </section>

      <section style={styles.resumoFontes}>
        <span><strong>Oficiais base:</strong> {numero(opcoes.resumoGlobal?.OFICIAL || 0)}</span>
        <span><strong>Negociação base:</strong> {numero(opcoes.resumoGlobal?.NEGOCIACAO || 0)}</span>
        <span><strong>Reajuste base:</strong> {numero(opcoes.resumoGlobal?.REAJUSTE || 0)}</span>
        <span><strong>Oficiais recorte:</strong> {numero(resumoFontes.oficial)}</span>
        <span><strong>Complementares recorte:</strong> {numero(resumoFontes.negociacao)}</span>
      </section>

      <div style={styles.abas}>
        {[
          ['dashboard', 'Dashboard'],
          ['mapa', 'Mapa por UF'],
          ['lacunas', 'Lacunas'],
          ['rotas', 'Rotas críticas'],
          ['relatorio', 'Relatório detalhado'],
        ].map(([chave, label]) => (
          <button key={chave} type="button" onClick={() => setAba(chave)} style={aba === chave ? styles.abaAtiva : styles.aba}>
            {label}
          </button>
        ))}
      </div>

      {aba === 'dashboard' && (
        <div style={styles.duasColunas}>
          <section style={styles.cardPainel}>
            <h2 style={styles.tituloSecao}>Melhores prazos por rota</h2>
            <div style={styles.listaCompacta}>
              {analise.melhoresPrazos.length === 0 && <div style={styles.empty}>Execute uma análise para listar melhores prazos.</div>}
              {analise.melhoresPrazos.map((rota) => (
                <div key={rota.rotaKey} style={styles.itemLista}>
                  <div>
                    <strong>{rota.rotaLabel}</strong>
                    <div style={styles.textoSuave}>{rota.melhoresTransportadoras.join(', ') || 'Transportadora N/I'}</div>
                  </div>
                  <div style={styles.badgePrazo}>{rota.menorPrazo}d</div>
                </div>
              ))}
            </div>
          </section>

          <section style={styles.cardPainel}>
            <h2 style={styles.tituloSecao}>Rotas com pouca cobertura oficial</h2>
            <div style={styles.listaCompacta}>
              {analise.rotasCriticas.length === 0 && <div style={styles.empty}>Execute uma análise para listar rotas críticas.</div>}
              {analise.rotasCriticas.slice(0, 20).map((rota) => (
                <div key={rota.rotaKey} style={styles.itemLista}>
                  <div>
                    <strong>{rota.rotaLabel}</strong>
                    <div style={styles.textoSuave}>{rota.canal} · {rota.regiaoOrigem || 'Origem N/I'} → {rota.regiaoDestino || 'Destino N/I'}</div>
                  </div>
                  <div style={styles.badgeCritico}>{rota.qtdTransportadorasOficiais || 0} oficial</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {aba === 'mapa' && (
        <section style={styles.cardPainel}>
          <div style={styles.headerSecao}>
            <h2 style={styles.tituloSecao}>Mapa visual de cobertura por UF destino</h2>
            <span style={styles.textoSuave}>
              {analise.totalLinhas ? 'Clique em um estado para ver transportadoras e prazo médio' : 'execute uma análise primeiro'}
            </span>
          </div>
          <div style={styles.mapaGrid}>
            {analise.mapa.map((uf) => (
              <div
                key={uf.uf}
                role={analise.totalLinhas ? 'button' : undefined}
                tabIndex={analise.totalLinhas ? 0 : undefined}
                onClick={() => abrirDetalheUf(uf)}
                onKeyDown={(event) => {
                  if (!analise.totalLinhas) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    abrirDetalheUf(uf);
                  }
                }}
                style={{
                  ...styles.cardUf,
                  ...estiloCardMapa(uf.qtdTransportadorasOficiais, uf.qtdTransportadoras),
                  ...(analise.totalLinhas ? styles.cardUfClicavel : {}),
                }}
              >
                <div style={styles.ufTopo}><strong>{uf.uf}</strong><span>{uf.regiao}</span></div>
                <div style={styles.ufNumero}>{uf.qtdTransportadorasOficiais}</div>
                <div style={styles.ufDetalhe}>{uf.qtdRotas} rotas · {uf.menorPrazoOficial ? `${uf.menorPrazoOficial}d menor prazo oficial` : 'sem prazo oficial'}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {aba === 'lacunas' && (
        <section style={styles.cardPainel}>
          <div style={styles.headerSecao}>
            <h2 style={styles.tituloSecao}>Lacunas de cobertura e prazo</h2>
            <span style={styles.textoSuave}>
              {numero(analise.lacunas?.resumo?.total || 0)} ocorrências no recorte
            </span>
          </div>

          <div style={styles.indicadoresGrid}>
            <CardIndicador titulo="Sem cobertura oficial" valor={numero(analise.lacunas?.resumo?.semCoberturaOficial || 0)} detalhe="rotas sem transportadora oficial" />
            <CardIndicador titulo="Uma oficial" valor={numero(analise.lacunas?.resumo?.umaOficial || 0)} detalhe="baixa diversidade de opções" />
            <CardIndicador titulo="Sem prazo oficial" valor={numero(analise.lacunas?.resumo?.semPrazoOficial || 0)} detalhe="cadastro sem prazo preenchido" />
          </div>

          <div style={styles.filtroLacunas}>
            {[
              ['', 'Todas'],
              ['SEM_COBERTURA_OFICIAL', 'Sem cobertura'],
              ['UMA_OFICIAL', 'Uma oficial'],
              ['SEM_PRAZO_OFICIAL', 'Sem prazo'],
            ].map(([valor, label]) => (
              <button
                key={valor || 'todas'}
                type="button"
                onClick={() => setFiltroLacuna(valor)}
                style={filtroLacuna === valor ? styles.abaAtiva : styles.aba}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={styles.tabelaWrapper}>
            <table style={styles.tabela}>
              <thead>
                <tr>
                  <th style={styles.th}>Tipo</th>
                  <th style={styles.th}>Rota</th>
                  <th style={styles.th}>Canal</th>
                  <th style={styles.th}>Origem</th>
                  <th style={styles.th}>Destino</th>
                  <th style={styles.th}>IBGE destino</th>
                  <th style={styles.th}>Oficiais</th>
                  <th style={styles.th}>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {lacunasVisiveis.map((item) => (
                  <tr key={`${item.tipo}-${item.rotaKey}`}>
                    <td style={styles.td}>
                      <span style={item.severidade === 'critico' ? styles.badgeCritico : styles.badgePrazo}>
                        {labelTipoLacuna(item.tipo)}
                      </span>
                    </td>
                    <td style={styles.td}><strong>{item.rotaLabel}</strong></td>
                    <td style={styles.td}>{item.canal}</td>
                    <td style={styles.td}>{item.cidadeOrigem || '-'}<div style={styles.textoSuave}>{item.ufOrigem || '-'} · {item.regiaoOrigem || '-'}</div></td>
                    <td style={styles.td}>{item.cidadeDestino || '-'}<div style={styles.textoSuave}>{item.ufDestino || '-'} · {item.regiaoDestino || '-'}</div></td>
                    <td style={styles.td}>{item.ibgeDestino || '-'}</td>
                    <td style={styles.td}>{item.qtdTransportadorasOficiais || 0}</td>
                    <td style={styles.td}>{item.detalhe || '-'}</td>
                  </tr>
                ))}
                {lacunasVisiveis.length === 0 && (
                  <tr><td style={styles.td} colSpan={8}>Nenhuma lacuna carregada. Execute uma análise regional completa para detalhar rotas sem cobertura.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {aba === 'rotas' && (
        <section style={styles.cardPainel}>
          <div style={styles.headerSecao}>
            <h2 style={styles.tituloSecao}>Rotas críticas do recorte</h2>
            <span style={styles.textoSuave}>{numero(rotasVisiveis.length)} rotas com baixa cobertura</span>
          </div>
          <div style={styles.tabelaWrapper}>
            <table style={styles.tabela}>
              <thead>
                <tr>
                  <th style={styles.th}>Rota</th>
                  <th style={styles.th}>Canal</th>
                  <th style={styles.th}>Oficiais</th>
                  <th style={styles.th}>Complementares</th>
                  <th style={styles.th}>Menor prazo</th>
                  <th style={styles.th}>Prazo médio</th>
                  <th style={styles.th}>Melhor prazo</th>
                </tr>
              </thead>
              <tbody>
                {rotasVisiveis.map((rota) => (
                  <tr key={rota.rotaKey}>
                    <td style={styles.td}><strong>{rota.rotaLabel}</strong><div style={styles.textoSuave}>{rota.regiaoOrigem || '-'} → {rota.regiaoDestino || '-'}</div></td>
                    <td style={styles.td}>{rota.canal}</td>
                    <td style={styles.td}>{rota.qtdTransportadorasOficiais || 0}</td>
                    <td style={styles.td}>{rota.qtdTransportadorasNegociacao || 0}</td>
                    <td style={styles.td}>{rota.menorPrazo ? `${rota.menorPrazo}d` : 'Sem prazo'}</td>
                    <td style={styles.td}>{rota.prazoMedio ? `${numero(rota.prazoMedio, 1)}d` : 'Sem prazo'}</td>
                    <td style={styles.td}>{rota.melhoresTransportadoras.join(', ') || '-'}</td>
                  </tr>
                ))}
                {rotasVisiveis.length === 0 && (
                  <tr><td style={styles.td} colSpan={7}>Nenhuma rota crítica carregada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {aba === 'relatorio' && (
        <section style={styles.cardPainel}>
          <div style={styles.headerSecao}>
            <h2 style={styles.tituloSecao}>Relatório detalhado do recorte</h2>
            <span style={styles.textoSuave}>
              Mostrando {numero(relatorioVisivel.length)} de {numero(linhasRelatorioBase.length)} filtradas
              {analise.totalLinhas > analise.linhas.length ? ` (${numero(analise.totalLinhas)} no recorte)` : ''}
            </span>
          </div>
          {(filtroRelatorio.ufDestino || filtroRelatorio.transportadora) && (
            <div style={styles.filtroRelatorioAtivo}>
              <span>
                Filtro ativo:
                {filtroRelatorio.ufDestino ? ` UF ${filtroRelatorio.ufDestino}` : ''}
                {filtroRelatorio.transportadora ? ` · ${filtroRelatorio.transportadora}` : ''}
              </span>
              <button type="button" style={styles.botaoSecundario} onClick={() => setFiltroRelatorio({ ufDestino: '', transportadora: '' })}>
                Limpar filtro
              </button>
            </div>
          )}
          {analise.linhas.length === 0 && analise.totalLinhas > 0 && (
            <div style={styles.alertaAviso}>
              Snapshot ou visão agregada carregada sem linhas em memória. Use <strong>Exportar CSV</strong> para a base completa ou clique em <strong>Buscar análise</strong> para recarregar.
            </div>
          )}
          <div style={styles.tabelaWrapper}>
            <table style={styles.tabela}>
              <thead>
                <tr>
                  <th style={styles.th}>Fonte</th>
                  <th style={styles.th}>Origem</th>
                  <th style={styles.th}>Destino</th>
                  <th style={styles.th}>Canal</th>
                  <th style={styles.th}>Transportadora</th>
                  <th style={styles.th}>Prazo</th>
                  <th style={styles.th}>Modalidade</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Tabela</th>
                  <th style={styles.th}>Valor ref.</th>
                </tr>
              </thead>
              <tbody>
                {relatorioVisivel.map((linha) => (
                  <tr key={`${linha.id}-${linha.fonteTabela}`}>
                    <td style={styles.td}><BadgeFonte fonte={linha.fonteTabela} /></td>
                    <td style={styles.td}>{linha.cidadeOrigem || '-'}<div style={styles.textoSuave}>{linha.ufOrigem || '-'} · {linha.regiaoOrigem || '-'}</div></td>
                    <td style={styles.td}>{linha.cidadeDestino || '-'}<div style={styles.textoSuave}>{linha.ufDestino || '-'} · {linha.regiaoDestino || '-'}</div></td>
                    <td style={styles.td}>{linha.canal}</td>
                    <td style={styles.td}><strong>{linha.transportadora}</strong></td>
                    <td style={styles.td}>{linha.prazoLabel}</td>
                    <td style={styles.td}>{linha.modalidade || '-'}</td>
                    <td style={styles.td}>{linha.status}</td>
                    <td style={styles.td}>{linha.tabelaNome}</td>
                    <td style={styles.td}>{linha.valorReferencia ? moeda(linha.valorReferencia) : '-'}</td>
                  </tr>
                ))}
                {relatorioVisivel.length === 0 && (
                  <tr><td style={styles.td} colSpan={10}>Nenhuma linha carregada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {relatorioTemMais && (
            <div style={styles.paginacao}>
              <button type="button" onClick={carregarMaisRelatorio} disabled={carregandoRelatorio} style={styles.botaoSecundario}>
                {carregandoRelatorio ? 'Carregando...' : `Mostrar mais ${LIMITE_EXIBICAO_RELATORIO}`}
              </button>
            </div>
          )}
        </section>
      )}

      <PainelDetalheUf
        uf={ufDetalhe}
        detalhe={detalheUf}
        carregando={carregandoDetalheUf}
        somenteOficial={detalheUfSomenteOficial}
        onToggleSomenteOficial={setDetalheUfSomenteOficial}
        onExportar={exportarDetalheUf}
        onVerRelatorio={verRelatorioDetalheUf}
        onFechar={fecharDetalheUf}
      />
    </div>
  );
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 32 },
  header: { display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' },
  kicker: { fontSize: 12, fontWeight: 800, color: '#CC2020', textTransform: 'uppercase', letterSpacing: 0.8 },
  titulo: { margin: '4px 0 8px', fontSize: 30, color: '#0F2347' },
  subtitulo: { margin: 0, maxWidth: 920, color: '#526070', lineHeight: 1.5 },
  acoesTopo: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  botaoPrimario: { border: 'none', background: '#CC2020', color: '#fff', borderRadius: 10, padding: '10px 14px', fontWeight: 800, cursor: 'pointer' },
  botaoSecundario: { border: '1px solid #d6dee8', background: '#fff', color: '#0F2347', borderRadius: 10, padding: '10px 14px', fontWeight: 800, cursor: 'pointer' },
  alertaErro: { border: '1px solid #fecaca', background: '#fff1f2', color: '#991b1b', borderRadius: 12, padding: 14, fontWeight: 700 },
  alertaAviso: { border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', borderRadius: 12, padding: 14, fontWeight: 700 },
  avisoFonte: { border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e3a8a', borderRadius: 12, padding: 14, lineHeight: 1.45 },
  recortesRapidos: { display: 'flex', flexDirection: 'column', gap: 10, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 14 },
  recortesSalvosBox: { display: 'flex', flexDirection: 'column', gap: 10, background: '#fff', border: '1px solid #dbeafe', borderRadius: 14, padding: 14 },
  recortesNuvemBox: { display: 'flex', flexDirection: 'column', gap: 10, background: '#fff', border: '1px solid #bbf7d0', borderRadius: 14, padding: 14 },
  baseNuvemResumo: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', border: '1px solid #dcfce7', borderRadius: 12, padding: 12, background: '#f0fdf4' },
  chipsRegioes: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  listaRecortesSalvos: { display: 'flex', flexDirection: 'column', gap: 8 },
  cardRecorteSalvo: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: '#f8fafc' },
  acoesRecorteSalvo: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  recortesBotoes: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  recorteBotao: { border: '1px solid #d6dee8', background: '#f8fafc', color: '#0F2347', borderRadius: 999, padding: '8px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' },
  recorteAtivo: { border: '1px solid #CC2020', background: '#fff1f2', color: '#991b1b', borderRadius: 999, padding: '8px 12px', fontWeight: 800, fontSize: 12, cursor: 'pointer' },
  filtrosBox: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, boxShadow: '0 8px 24px rgba(15,35,71,0.05)' },
  campoFiltro: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#475569', fontWeight: 800 },
  input: { border: '1px solid #d6dee8', borderRadius: 10, padding: '10px 11px', fontSize: 14, outline: 'none', background: '#fff', color: '#0F2347' },
  filtroAcoes: { display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' },
  indicadoresGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 },
  cardIndicador: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, boxShadow: '0 8px 24px rgba(15,35,71,0.05)' },
  cardTitulo: { color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase' },
  cardValor: { color: '#0F2347', fontSize: 28, fontWeight: 900, marginTop: 6 },
  cardDetalhe: { color: '#64748b', fontSize: 12, marginTop: 4 },
  resumoFontes: { display: 'flex', gap: 10, flexWrap: 'wrap', color: '#475569', fontSize: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, alignItems: 'center' },
  abas: { display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0', paddingBottom: 8 },
  aba: { border: '1px solid #d6dee8', background: '#fff', color: '#0F2347', borderRadius: 999, padding: '9px 13px', fontWeight: 800, cursor: 'pointer' },
  abaAtiva: { border: '1px solid #0F2347', background: '#0F2347', color: '#fff', borderRadius: 999, padding: '9px 13px', fontWeight: 800, cursor: 'pointer' },
  duasColunas: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 },
  cardPainel: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 16, boxShadow: '0 8px 24px rgba(15,35,71,0.05)' },
  headerSecao: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  tituloSecao: { margin: '0 0 12px', color: '#0F2347', fontSize: 18 },
  listaCompacta: { display: 'flex', flexDirection: 'column', gap: 10 },
  itemLista: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 12, border: '1px solid #e2e8f0', borderRadius: 12, background: '#f8fafc' },
  textoSuave: { color: '#64748b', fontSize: 12, marginTop: 3 },
  badgePrazo: { background: '#e8f7ee', color: '#166534', borderRadius: 999, padding: '6px 10px', fontWeight: 900, whiteSpace: 'nowrap' },
  badgeCritico: { background: '#fff1f2', color: '#9f1239', borderRadius: 999, padding: '6px 10px', fontWeight: 900, whiteSpace: 'nowrap' },
  badgeFonte: { display: 'inline-block', borderRadius: 999, padding: '5px 8px', fontWeight: 900, fontSize: 11, whiteSpace: 'nowrap' },
  badgeFonteOficial: { background: '#e8f7ee', color: '#166534' },
  badgeFonteNegociacao: { background: '#eff6ff', color: '#1d4ed8' },
  badgeFonteReajuste: { background: '#fff7e6', color: '#92400e' },
  empty: { color: '#64748b', padding: 16, textAlign: 'center', background: '#f8fafc', borderRadius: 12 },
  mapaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 },
  cardUf: { border: '1px solid', borderRadius: 14, padding: 12, minHeight: 110 },
  cardUfClicavel: { cursor: 'pointer', transition: 'transform 0.15s ease, box-shadow 0.15s ease' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(15, 35, 71, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 16 },
  modalPainel: { background: '#fff', borderRadius: 18, width: 'min(960px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 20, boxShadow: '0 24px 60px rgba(15,35,71,0.25)', display: 'flex', flexDirection: 'column', gap: 16 },
  modalHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' },
  modalAcoes: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  checkboxLinha: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', fontWeight: 700 },
  modalTitulo: { margin: '4px 0 6px', color: '#0F2347', fontSize: 24 },
  filtroLacunas: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  filtroRelatorioAtivo: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 12, marginBottom: 12, color: '#1e3a8a', fontSize: 13 },
  linkBotao: { border: 'none', background: 'transparent', color: '#CC2020', fontWeight: 800, cursor: 'pointer', padding: 0, textDecoration: 'underline' },
  ufTopo: { display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 12 },
  ufNumero: { fontSize: 28, fontWeight: 900, marginTop: 8 },
  ufDetalhe: { fontSize: 11, marginTop: 4 },
  tabelaWrapper: { overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 12 },
  tabela: { width: '100%', borderCollapse: 'collapse', minWidth: 1120, background: '#fff' },
  th: { textAlign: 'left', padding: '11px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontSize: 12, textTransform: 'uppercase' },
  td: { padding: '11px 12px', borderBottom: '1px solid #eef2f7', color: '#0F2347', verticalAlign: 'top', fontSize: 13 },
  paginacao: { display: 'flex', justifyContent: 'center', marginTop: 12 },
  progressoBox: { background: '#fff', border: '1px solid #bfdbfe', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 },
  progressoTopo: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', color: '#0F2347' },
  barraProgresso: { height: 10, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' },
  barraProgressoInterna: { height: '100%', background: '#CC2020', transition: 'width 0.2s ease' },
};
