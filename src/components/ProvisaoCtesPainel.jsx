import { useEffect, useMemo, useRef, useState } from 'react';
import { exportarExcelMultiAbas } from '../utils/exportarExcelFormatado';
import {
  buscarCtesNaBase, carregarCtesCompetencia, carregarLancamentosPorCnpj, carregarSnapshotProvisao,
  carregarTrackingCompetencia, excluirSnapshotProvisao, listarSnapshotsProvisao, salvarSnapshotProvisao,
} from '../services/lancamentosCteSapService';
import { carregarParametrosRemotos } from '../services/robosParametrosService';
import { carregarParametros, criarIndices } from '../utils/robos/lancamentoComum';
import { carregarSessao } from '../utils/authLocal';
import { montarEml } from '../utils/emailLaudoTransportador';
import { calcularMetaLancamento, gerarLaudoMetaHtml, ultimoDiaCompetencia } from '../utils/metaLancamentoCte';
import { assuntoEmailProvisao, corpoEmailProvisao, gerarLaudoProvisaoHtml, nomeLaudoProvisao } from '../utils/laudoProvisaoHtml';
import { avaliarCteParaBase } from '../services/cteBasePolicy';
import { classificarProvisao, cnpj14, resumirProvisao, serieDaChave, SITUACOES_PROVISAO } from '../utils/lancamentosCteSap';
import {
  agruparNfsTracking, carregarCentrosCusto, criarResolvedorEmpresa, SITUACOES_PENDENTES, classificarNfsTracking, CORES_TRACKING, guardarCentrosCusto, resumirPorEmpresa,
  resumirTracking, SITUACOES_TRACKING,
} from '../utils/provisaoTracking';

// Numero do CT-e com a serie (da chave de acesso), ex.: 18484198-30.
const numeroSerie = (c) => { const serie = serieDaChave(c.chave_cte); return serie ? `${c.numero_cte}-${serie}` : String(c.numero_cte || ''); };

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const dataHoraBr = (v) => (v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const num = (v) => Number(v || 0).toLocaleString('pt-BR');
const r2 = (v) => Number(Number(v || 0).toFixed(2));
const competenciaBr = (c) => (c ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : '');
const PAGINA = 200;

const CORES = { NO_MES: '#15803d', APOS_MES: '#c2410c', FATURA_APOS: '#c2410c', NAO_LANCADO: '#b91c1c' };
const SITUACOES_SALVAS = new Set(['APOS_MES', 'NAO_LANCADO', 'PROVISAO']);

// Campos do CT-e guardados no snapshot (so os que entram na provisao).
const CAMPOS_CTE = ['chave_cte', 'numero_cte', 'transportadora', 'cnpj_transportadora', 'cnpj_tomador', 'tomador_servico', 'empresa', 'data_emissao', 'valor_cte', 'canal',
  'cidade_origem', 'uf_origem', 'cidade_destino', 'uf_destino', 'situacao', 'provisao', 'estornado', 'created_at', 'data_lancamento', 'lancamento_contabil', 'numero_fatura'];
const CAMPOS_NF = ['chave_nfe', 'nota_fiscal', 'data', 'transportadora', 'canal', 'pedido', 'origem', 'destino', 'valor_nf', 'chaves_cte', 'cte_numero',
  'situacao', 'pct_frete', 'frete_estimado', 'origem_estimativa', 'frete_tracking', 'empresa'];
const pegar = (obj, campos) => Object.fromEntries(campos.map((k) => [k, obj[k] ?? null]));

function competenciaAnterior() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const cartao = (ativo, cor) => ({
  minWidth: 170, padding: '10px 14px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
  border: `1px solid ${ativo ? cor : '#e2e8f0'}`, background: ativo ? cor : '#fff', color: ativo ? '#fff' : '#0f172a',
});

const COLS_CTE = [
  { titulo: 'Empresa', largura: 10, tipo: 'centro' }, { titulo: 'CC', largura: 13, tipo: 'centro' },
  { titulo: 'Número CT-e', largura: 14 }, { titulo: 'Transportadora', largura: 38 }, { titulo: 'CNPJ transportadora', largura: 18 },
  { titulo: 'Tomador', largura: 30 }, { titulo: 'Emissão', largura: 11, tipo: 'data' }, { titulo: 'Valor CT-e', largura: 15, tipo: 'moeda' },
  { titulo: 'Canal', largura: 11, tipo: 'centro' }, { titulo: 'Origem', largura: 24 }, { titulo: 'Destino', largura: 24 },
  { titulo: 'Situação', largura: 22 }, { titulo: 'Data lançamento', largura: 13, tipo: 'data' }, { titulo: 'Lançamento contábil', largura: 16 },
  { titulo: 'Estorno sem relançar', largura: 11, tipo: 'centro' }, { titulo: 'Chave CT-e', largura: 48 },
];
function linhasCte(lista, centros) {
  return lista.map((c) => [
    c.empresa || '', centros[c.empresa] || '', numeroSerie(c), c.transportadora || '', c.cnpj_transportadora || '', c.tomador_servico || '',
    c.data_emissao || '', Number(c.valor_cte || 0), c.canal || '',
    `${c.cidade_origem || ''}${c.uf_origem ? `/${c.uf_origem}` : ''}`, `${c.cidade_destino || ''}${c.uf_destino ? `/${c.uf_destino}` : ''}`,
    SITUACOES_PROVISAO[c.situacao] || 'Lançado após o mês', c.data_lancamento || '', c.lancamento_contabil || '', c.estornado ? 'Sim' : '', c.chave_cte || '',
  ]);
}

const COLS_NF = [
  { titulo: 'Empresa', largura: 10, tipo: 'centro' }, { titulo: 'CC', largura: 13, tipo: 'centro' },
  { titulo: 'Nota fiscal', largura: 12, tipo: 'centro' }, { titulo: 'Data NF', largura: 11, tipo: 'data' }, { titulo: 'Transportadora', largura: 34 },
  { titulo: 'Canal', largura: 11, tipo: 'centro' }, { titulo: 'Pedido', largura: 14 }, { titulo: 'Origem', largura: 22 }, { titulo: 'Destino', largura: 22 },
  { titulo: 'Valor NF', largura: 15, tipo: 'moeda' }, { titulo: 'Situação', largura: 20 }, { titulo: '% frete usado', largura: 11, tipo: 'percentual' },
  { titulo: 'Frete estimado', largura: 15, tipo: 'moeda' }, { titulo: 'Base da estimativa', largura: 24 }, { titulo: 'Nº CT-e no tracking', largura: 14 }, { titulo: 'Chave CT-e no tracking', largura: 48 },
  { titulo: 'Chave NF', largura: 48 },
];
function linhasNf(lista, centros) {
  return lista.map((n) => [
    n.empresa || '', centros[n.empresa] || '', n.nota_fiscal || '', n.data || '', n.transportadora || '', n.canal || '', n.pedido || '',
    n.origem || '', n.destino || '', r2(n.valor_nf), SITUACOES_TRACKING[n.situacao] || '', Number(((n.pct_frete || 0) * 100).toFixed(2)),
    r2(n.frete_estimado), n.origem_estimativa || '', n.cte_numero || '', (n.chaves_cte || []).join(' / '), n.chave_nfe || '',
  ]);
}
const somaCol = (linhas, i) => linhas.reduce((a, l) => a + Number(l[i] || 0), 0);
const pctDe = (q, t) => (t ? (q / t) * 100 : 0);
// Linha de total alinhada as colunas: { indiceColuna: valor }, rotulo na 1a.
const linhaTotal = (colunas, valores) => colunas.map((_, i) => (i === 0 ? 'Total' : valores[i] ?? ''));

export default function ProvisaoCtesPainel() {
  const [aberto, setAberto] = useState(true);
  const [competencia, setCompetencia] = useState(competenciaAnterior());
  const [itens, setItens] = useState(null);
  const [nfs, setNfs] = useState(null);
  const [trackingCanceladas, setTrackingCanceladas] = useState(0);
  const [foraTomador, setForaTomador] = useState(null); // CT-es com tomador fora do grupo (nao entram)
  const [snapshot, setSnapshot] = useState(null); // cabecalho do snapshot aberto (null = calculo ao vivo)
  const [calculadaPara, setCalculadaPara] = useState('');
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [filtro, setFiltro] = useState('PROVISAO');
  const [filtroNf, setFiltroNf] = useState('PENDENTE');
  const [transportadora, setTransportadora] = useState('');
  const [visiveis, setVisiveis] = useState(PAGINA);
  const [visiveisNf, setVisiveisNf] = useState(PAGINA);
  const [incluirTracking, setIncluirTracking] = useState(true); // considerar tracking (liga/desliga sem recalcular)
  const baseCalculo = useRef(null); // CT-es do ultimo calculo, para buscar o tracking depois sem recalcular
  const [historico, setHistorico] = useState([]);
  const [avisoHistorico, setAvisoHistorico] = useState('');
  const [centros, setCentros] = useState(carregarCentrosCusto);
  const [editarCc, setEditarCc] = useState(false);
  const [metaPct, setMetaPct] = useState(95);
  const [corteMeta, setCorteMeta] = useState('');

  const atualizarHistorico = async () => {
    try {
      const { lista, aviso: a } = await listarSnapshotsProvisao();
      setHistorico(lista);
      setAvisoHistorico(a || '');
    } catch (e) {
      setAvisoHistorico(e.message || String(e));
    }
  };
  useEffect(() => { atualizarHistorico(); }, []);

  const filiaisPorCnpj = async () => {
    const remoto = await carregarParametrosRemotos();
    const parametros = remoto.ok && !remoto.vazio ? remoto : carregarParametros();
    return criarIndices(parametros).filiais;
  };

  // Classifica as NFs do tracking contra os CT-es do calculo.
  const processarTracking = async (linhas, ctes, filiais, competenciaCalc) => {
    const { nfs: agrupadas, canceladas } = agruparNfsTracking(linhas.filter((l) => !/EBAZAR/i.test(String(l.transportadora || ''))));
    const valorPorChave = new Map(ctes.map((c) => [String(c.chave_cte || '').replace(/\D/g, ''), Number(c.valor_cte || 0)]));
    // Tracking sem chave do CT-e: procura o CT-e do mes pela chave da NF (base de CT-es).
    const ctePorNfe = new Map();
    ctes.forEach((c) => { const nfe = String(c.chave_nfe || '').replace(/\D/g, ''); if (nfe.length === 44 && !ctePorNfe.has(nfe)) ctePorNfe.set(nfe, String(c.chave_cte || '').replace(/\D/g, '')); });
    agrupadas.forEach((n) => { if (!n.chaves_cte.size && n.chave_nfe && ctePorNfe.has(n.chave_nfe)) { n.chaves_cte.add(ctePorNfe.get(n.chave_nfe)); n.casado_pela_nf = true; } });
    const foraDoMes = agrupadas.flatMap((n) => [...n.chaves_cte]).filter((c) => !valorPorChave.has(c));
    const extra = await buscarCtesNaBase(foraDoMes, setProgresso);
    extra.forEach((v, k) => valorPorChave.set(k, v));
    setNfs(classificarNfsTracking(agrupadas, valorPorChave, filiais, competenciaCalc));
    setTrackingCanceladas(canceladas);
  };

  // Liga o tracking depois do calculo: busca so o tracking (nao refaz a provisao).
  const buscarTrackingDepois = async () => {
    const base = baseCalculo.current;
    if (!base || snapshot || nfs) return;
    setErro('');
    try {
      const linhas = await carregarTrackingCompetencia(base.competencia, setProgresso);
      await processarTracking(linhas, base.ctes, base.filiais, base.competencia);
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setProgresso('');
    }
  };

  const alternarTracking = (ligado) => {
    setIncluirTracking(ligado);
    if (ligado && itens && !nfs && !snapshot && baseCalculo.current?.competencia === calculadaPara) buscarTrackingDepois();
  };

  const calcular = async () => {
    if (!/^\d{4}-\d{2}$/.test(competencia)) return;
    setErro(''); setAviso('');
    setItens(null); setNfs(null); setSnapshot(null); setForaTomador(null); baseCalculo.current = null;
    try {
      const filiais = await filiaisPorCnpj();
      const todosCtes = await carregarCtesCompetencia(competencia, setProgresso);
      // So CT-es com tomador do grupo (CPX, ITR, GP Pneus, GRIP, Cantu) — mesma regra da base de CT-es.
      const opcoesTomador = { ocultarEbazar: true };
      const ctes = [];
      const fora = { qtd: 0, valor: 0, porTomador: new Map() };
      todosCtes.forEach((c) => {
        const avaliacao = avaliarCteParaBase(c, opcoesTomador);
        if (avaliacao.aceito) { ctes.push(c); return; }
        fora.qtd += 1; fora.valor += Number(c.valor_cte || 0);
        const nome = avaliacao.codigo === 'ebazar' ? 'EBAZAR (excluído)' : avaliacao.codigo === 'cps_log' ? 'CPS LOG (excluído)'
          : String(c.tomador_servico || '').trim() || '(tomador vazio)';
        const t = fora.porTomador.get(nome) || { nome, qtd: 0, valor: 0 };
        t.qtd += 1; t.valor += Number(c.valor_cte || 0);
        fora.porTomador.set(nome, t);
      });
      const lancamentos = await carregarLancamentosPorCnpj(ctes.map((c) => c.cnpj_transportadora), competencia, setProgresso);
      // Empresa: 1) CNPJ do tomador (exato ou raiz) nas Filiais; 2) empresa do lancamento SAP; 3) nome do
      // tomador (CPX, ITR, GP Pneus...); 4) emitente da NF do CT-e (base ou tracking).
      const resolver = criarResolvedorEmpresa(filiais);
      let nfDoCte = new Map();
      let linhas = [];
      { // busca sempre o tracking; a flag "Considerar tracking" so mostra/esconde no resultado
        linhas = await carregarTrackingCompetencia(competencia, setProgresso);
        linhas.forEach((l) => { const k = String(l.chave_cte || '').replace(/\D/g, ''); if (k.length === 44 && l.chave_nfe && !nfDoCte.has(k)) nfDoCte.set(k, l.chave_nfe); });
      }
      const classificados = classificarProvisao(ctes, lancamentos, competencia).map((c) => ({
        ...c,
        empresa: resolver.porCnpj(c.cnpj_tomador) || c.empresa_sap || resolver.porNome(c.tomador_servico)
          || resolver.porChaveNfe(c.chave_nfe) || resolver.porChaveNfe(nfDoCte.get(String(c.chave_cte || '').replace(/\D/g, ''))) || '',
      }));
      nfDoCte = null;
      baseCalculo.current = { ctes, filiais, competencia };
      await processarTracking(linhas, ctes, filiais, competencia);
      setItens(classificados);
      setForaTomador({ qtd: fora.qtd, valor: fora.valor, porTomador: [...fora.porTomador.values()].sort((a, b) => b.valor - a.valor) });
      setCalculadaPara(competencia);
      setCorteMeta('');
      setTransportadora('');
      setVisiveis(PAGINA); setVisiveisNf(PAGINA);
      atualizarHistorico();
    } catch (error) {
      setErro(error.message || String(error));
    } finally {
      setProgresso('');
    }
  };

  const abrirSnapshot = async (id) => {
    setErro(''); setAviso('');
    try {
      setProgresso('Abrindo provisão salva...');
      const { cabecalho, itens: linhas } = await carregarSnapshotProvisao(id, setProgresso);
      setSnapshot(cabecalho);
      baseCalculo.current = null;
      setForaTomador(cabecalho.resumo?.foraTomador || null);
      setItens(linhas.filter((l) => l.tipo === 'CTE').map((l, i) => ({ id: `s${i}`, ...l.dados })));
      const linhasNf = linhas.filter((l) => l.tipo !== 'CTE').map((l) => l.dados);
      setNfs(cabecalho.tracking_resumo ? linhasNf : null);
      setTrackingCanceladas(cabecalho.tracking_resumo?.canceladas || 0);
      setCompetencia(cabecalho.competencia);
      setCalculadaPara(cabecalho.competencia);
      setFiltro('PROVISAO'); setFiltroNf('PENDENTE');
      setTransportadora('');
      setVisiveis(PAGINA); setVisiveisNf(PAGINA);
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setProgresso('');
    }
  };

  const excluirSnapshot = async (s) => {
    if (!window.confirm(`Excluir a provisão salva de ${competenciaBr(s.competencia)} (${dataHoraBr(s.criado_em)})?`)) return;
    try {
      await excluirSnapshotProvisao(s.id);
      if (snapshot?.id === s.id) { setSnapshot(null); setItens(null); setNfs(null); }
      atualizarHistorico();
    } catch (e) {
      setErro(e.message || String(e));
    }
  };

  const centrosAtivos = useMemo(() => (snapshot?.centros_custo ? { ...centros, ...snapshot.centros_custo } : centros), [centros, snapshot]);

  const resumo = useMemo(() => {
    if (!itens) return null;
    return snapshot?.resumo?.total ? snapshot.resumo : resumirProvisao(itens);
  }, [itens, snapshot]);

  // Tracking carregado (vai no snapshot mesmo desligado) x tracking considerado (tela, laudo, e-mail, Excel).
  const resumoTrackingCarregado = useMemo(() => {
    if (!nfs) return null;
    return snapshot?.tracking_resumo ? snapshot.tracking_resumo : resumirTracking(nfs, trackingCanceladas);
  }, [nfs, snapshot, trackingCanceladas]);
  const nfsPendentesCarregadas = useMemo(() => (nfs || []).filter((n) => SITUACOES_PENDENTES.has(n.situacao)), [nfs]);
  const nfsNfseCarregadas = useMemo(() => (nfs || []).filter((n) => n.situacao === 'NFSE'), [nfs]);
  const resumoTracking = incluirTracking ? resumoTrackingCarregado : null;
  const nfsPendentes = incluirTracking ? nfsPendentesCarregadas : [];
  const nfsNfse = incluirTracking ? nfsNfseCarregadas : [];

  const porEmpresa = useMemo(() => (itens ? resumirPorEmpresa(itens.filter((c) => c.provisao), nfsPendentes, centrosAtivos) : []), [itens, nfsPendentes, centrosAtivos]);

  // Meta de lancamento: no calculo usa todos os CT-es; na provisao salva usa a meta guardada no salvamento.
  const corteEfetivo = corteMeta || (calculadaPara ? ultimoDiaCompetencia(calculadaPara) : '');
  const metaLancamento = useMemo(() => {
    if (!itens || !calculadaPara) return null;
    if (snapshot) return snapshot.resumo?.meta || null;
    return calcularMetaLancamento(itens, calculadaPara, corteEfetivo, Number(metaPct) || 95);
  }, [itens, calculadaPara, snapshot, corteEfetivo, metaPct]);

  // Ultimo snapshot da mesma competencia, para comparar com o recalculo.
  const ultimoSalvo = useMemo(() => (!snapshot && calculadaPara ? historico.find((h) => h.competencia === calculadaPara) : null), [historico, snapshot, calculadaPara]);

  const lista = useMemo(() => {
    if (!itens) return [];
    return itens
      .filter((c) => (filtro === 'PROVISAO' ? c.provisao : filtro === 'TODOS' ? true : c.situacao === filtro))
      .filter((c) => !transportadora || (c.transportadora || '(sem nome)') === transportadora)
      .sort((a, b) => String(a.data_emissao).localeCompare(String(b.data_emissao)));
  }, [itens, filtro, transportadora]);

  const listaNf = useMemo(() => {
    if (!nfs) return [];
    return nfs
      .filter((n) => (filtroNf === 'PENDENTE' ? SITUACOES_PENDENTES.has(n.situacao) : filtroNf === 'TODAS' ? true : n.situacao === filtroNf))
      .sort((a, b) => b.frete_estimado - a.frete_estimado);
  }, [nfs, filtroNf]);

  const salvar = async () => {
    if (!itens || !resumo || snapshot) return;
    const descricao = window.prompt(`Salvar a provisão de ${competenciaBr(calculadaPara)} no histórico. Descrição (opcional):`, 'Fechamento');
    if (descricao === null) return;
    setErro(''); setAviso('');
    try {
      const provisao = itens.filter((c) => c.provisao);
      const linhas = [
        ...provisao.map((c) => ({ tipo: 'CTE', dados: pegar(c, CAMPOS_CTE) })),
        ...nfsPendentesCarregadas.map((n) => ({ tipo: n.situacao === 'SEM_CTE' ? 'NF_SEM_CTE' : 'CTE_FORA_BASE', dados: pegar(n, CAMPOS_NF) })),
        ...nfsNfseCarregadas.map((n) => ({ tipo: 'NFSE', dados: pegar(n, CAMPOS_NF) })),
      ];
      const sessao = carregarSessao?.() || {};
      await salvarSnapshotProvisao({
        competencia: calculadaPara,
        descricao: descricao.trim() || null,
        resumo: { total: resumo.total, porTransportadora: resumo.porTransportadora, foraTomador, meta: metaLancamento },
        tracking_resumo: resumoTrackingCarregado || null,
        centros_custo: centros,
        qtd_provisao: resumo.total.provisao.qtd,
        valor_provisao: r2(resumo.total.provisao.valor),
        qtd_nf_sem_cte: resumoTrackingCarregado?.total.pendente.qtd || 0,
        valor_estimado_nf_sem_cte: r2(resumoTrackingCarregado?.total.pendente.estimado || 0),
        criado_por: sessao.usuario?.email || sessao.email || sessao.nome || null,
      }, linhas, setProgresso);
      setAviso(`Provisão de ${competenciaBr(calculadaPara)} salva no histórico (${num(linhas.length)} linhas).`);
      atualizarHistorico();
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setProgresso('');
    }
  };

  // Abas do Excel da provisao. comTodos = inclui a aba com todos os CT-es (fica de fora no anexo do e-mail).
  const montarAbasProvisao = (comTodos = true) => {
    const t = resumo.total;
    const comTracking = Boolean(resumoTracking);
    const blocos = [{
      titulo: 'Situação dos CT-es emitidos na competência',
      colunas: [{ titulo: 'Situação', largura: 46 }, { titulo: 'CT-es', largura: 14, tipo: 'inteiro' }, { titulo: '% dos CT-es', largura: 14, tipo: 'percentual' }, { titulo: 'Valor', largura: 20, tipo: 'moeda' }],
      linhas: [
        ['Emitidos na competência', t.geral.qtd, 100, t.geral.valor],
        ...Object.entries(SITUACOES_PROVISAO).map(([k, rot]) => [rot, t[k].qtd, pctDe(t[k].qtd, t.geral.qtd), t[k].valor]),
      ],
      totais: ['PROVISÃO (após o mês + não lançado)', t.provisao.qtd, pctDe(t.provisao.qtd, t.geral.qtd), t.provisao.valor],
    }];
    const empLinhas = porEmpresa.map((e) => [e.empresa, e.cc || 'sem CC', e.qtd, e.valor, ...(comTracking ? [e.qtd_nf, e.estimado_nf, e.valor + e.estimado_nf] : [])]);
    blocos.push({
      titulo: 'Provisão por empresa / centro de custo',
      colunas: [{ titulo: 'Empresa', tipo: 'centro' }, { titulo: 'CC', tipo: 'centro' }, { titulo: 'CT-es', tipo: 'inteiro' }, { titulo: 'Valor CTE', tipo: 'moeda' },
        ...(comTracking ? [{ titulo: 'NFs sem CT-e', tipo: 'inteiro' }, { titulo: 'Frete estimado NFs', largura: 20, tipo: 'moeda' }, { titulo: 'Total a provisionar', largura: 20, tipo: 'moeda' }] : [])],
      linhas: empLinhas,
      totais: ['Total Geral', '', somaCol(empLinhas, 2), somaCol(empLinhas, 3), ...(comTracking ? [somaCol(empLinhas, 4), somaCol(empLinhas, 5), somaCol(empLinhas, 6)] : [])],
    });
    if (comTracking) {
      const tt = resumoTracking.total;
      blocos.push({
        titulo: 'Tracking do mês x CT-e',
        colunas: [{ titulo: 'Indicador' }, { titulo: 'NFs', tipo: 'inteiro' }, { titulo: '% das NFs', tipo: 'percentual' }, { titulo: 'Valor NF', tipo: 'moeda' }, { titulo: 'Frete estimado', tipo: 'moeda' }],
        linhas: [
          ['NFs no tracking (sem canceladas)', tt.geral.qtd, 100, tt.geral.valor_nf, ''],
          ...Object.entries(SITUACOES_TRACKING).map(([k, rot]) => [rot, tt[k].qtd, pctDe(tt[k].qtd, tt.geral.qtd), tt[k].valor_nf, k === 'COM_CTE' ? '' : tt[k].estimado]),
        ],
        totais: ['A provisionar (sem CT-e + fora da base)', tt.pendente.qtd, pctDe(tt.pendente.qtd, tt.geral.qtd), tt.pendente.valor_nf, tt.pendente.estimado],
      });
    }
    if (foraTomador?.qtd) {
      blocos.push({
        titulo: 'CT-es fora da provisão (EBAZAR / tomador fora do grupo)',
        colunas: [{ titulo: 'Tomador' }, { titulo: 'CT-es', tipo: 'inteiro' }, { titulo: 'Valor', tipo: 'moeda' }],
        linhas: foraTomador.porTomador.map((x) => [x.nome, x.qtd, x.valor]),
        totais: ['Total', foraTomador.qtd, foraTomador.valor],
      });
    }
    const transpLinhas = resumo.porTransportadora.map((x) => [x.nome, x.geral.qtd, x.geral.valor, x.NO_MES.qtd, x.APOS_MES.qtd, x.NAO_LANCADO.qtd, x.provisao.qtd, x.provisao.valor]);
    const colsTransp = [{ titulo: 'Transportadora', largura: 44 }, { titulo: 'Emitidos', tipo: 'inteiro', largura: 11 }, { titulo: 'Valor emitido', tipo: 'moeda', largura: 18 },
      { titulo: 'Lançado no mês', tipo: 'inteiro', largura: 12 }, { titulo: 'Após o mês', tipo: 'inteiro', largura: 11 },
      { titulo: 'Não lançado', tipo: 'inteiro', largura: 11 }, { titulo: 'CT-es provisão', tipo: 'inteiro', largura: 12 }, { titulo: 'Valor provisão', tipo: 'moeda', largura: 18 }];
    const provisao = itens.filter((c) => c.provisao);
    const linhasNfPend = linhasNf(nfsPendentes, centrosAtivos);
    const abas = [
      {
        nome: 'Resumo',
        titulo: `Provisão de CT-es — competência ${competenciaBr(calculadaPara)}`,
        informacoes: [
          `Gerado em ${new Date().toLocaleString('pt-BR')}${snapshot ? ` · provisão salva em ${dataHoraBr(snapshot.criado_em)}${snapshot.descricao ? ` (${snapshot.descricao})` : ''}` : ' · cálculo com os dados de hoje'}`,
          'Competência = data de emissão do CT-e. Provisão = CT-es lançados no SAP depois do mês + não lançados.',
          'Só CT-es com tomador do grupo (CPX, ITR, GP Pneus, GRIP, Cantu); EBAZAR fora (provisão e tracking).',
        ],
        blocos,
      },
      { nome: 'Por transportadora', colunas: colsTransp, linhas: transpLinhas, totais: linhaTotal(colsTransp, Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((i) => [i, somaCol(transpLinhas, i)]))) },
      { nome: 'CT-es da provisão', colunas: COLS_CTE, linhas: linhasCte(provisao, centrosAtivos), totais: linhaTotal(COLS_CTE, { 2: `${num(provisao.length)} CT-es`, 7: t.provisao.valor }) },
    ];
    if (nfsPendentes.length) {
      abas.push({ nome: 'Tracking NF sem CT-e', colunas: COLS_NF, linhas: linhasNfPend, totais: linhaTotal(COLS_NF, { 2: `${num(nfsPendentes.length)} NFs`, 9: somaCol(linhasNfPend, 9), 12: somaCol(linhasNfPend, 12) }) });
    }
    if (comTodos && nfsNfse.length) abas.push({ nome: 'Tracking frete NFS-e', colunas: COLS_NF, linhas: linhasNf(nfsNfse, centrosAtivos) });
    if (comTodos && !snapshot) abas.push({ nome: 'Todos os CT-es', colunas: COLS_CTE, linhas: linhasCte(itens, centrosAtivos), simples: true });
    return abas;
  };

  const nomeExcelProvisao = () => `PROVISAO_CTES_${calculadaPara}${snapshot ? `_SALVA_${String(snapshot.criado_em).slice(0, 10)}` : ''}.xlsx`;

  const exportar = async () => {
    if (!itens || !resumo) return;
    setProgresso('Gerando Excel...');
    try {
      await exportarExcelMultiAbas({ nomeArquivo: nomeExcelProvisao(), abas: montarAbasProvisao(true) });
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setProgresso('');
    }
  };

  const dadosLaudo = () => ({
    competencia: calculadaPara,
    geradoEm: new Date().toLocaleString('pt-BR'),
    origem: snapshot ? `provisão salva em ${dataHoraBr(snapshot.criado_em)}${snapshot.descricao ? ` (${snapshot.descricao})` : ''}` : 'cálculo com os dados de hoje',
    total: resumo.total,
    porEmpresa,
    porTransportadora: resumo.porTransportadora,
    tracking: resumoTracking,
    foraTomador,
  });

  const baixar = (conteudo, nome, tipo) => {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const baixarLaudoHtml = () => {
    if (!resumo) return;
    baixar(gerarLaudoProvisaoHtml(dadosLaudo()), nomeLaudoProvisao(calculadaPara), 'text/html;charset=utf-8');
  };

  // Rascunho do Outlook (.eml): resumo no corpo; anexos = laudo HTML + Excel com os detalhes
  // (sem a aba "Todos os CT-es", que deixaria o e-mail pesado). So preencher os destinatarios.
  const baixarEmail = async () => {
    if (!resumo || !itens) return;
    setErro('');
    setProgresso('Montando e-mail com o laudo e o Excel...');
    try {
      const d = dadosLaudo();
      const excel = await exportarExcelMultiAbas({ abas: montarAbasProvisao(false), retornarBytes: true });
      const eml = montarEml({
        assunto: assuntoEmailProvisao(calculadaPara), corpoHtml: corpoEmailProvisao(d),
        anexoHtml: gerarLaudoProvisaoHtml(d), anexoNome: nomeLaudoProvisao(calculadaPara),
        anexosExtras: [{ nome: nomeExcelProvisao(), conteudo: excel }],
      });
      baixar(eml, `email-provisao-fretes-${calculadaPara}.eml`, 'message/rfc822');
      setAviso('E-mail baixado com o laudo (HTML) e o Excel anexos: abra o .eml no Outlook, coloque os destinatários e envie.');
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setProgresso('');
    }
  };

  const baixarLaudoMeta = () => {
    if (!metaLancamento) return;
    const origem = snapshot ? `provisão salva em ${dataHoraBr(snapshot.criado_em)}` : 'cálculo com os dados de hoje';
    baixar(gerarLaudoMetaHtml(metaLancamento, { origem }), `laudo-meta-lancamento-cte-${calculadaPara}.html`, 'text/html;charset=utf-8');
  };

  const exportarLaudoTracking = async () => {
    if (!resumoTracking) return;
    const tt = resumoTracking.total;
    const transp = resumoTracking.porTransportadora.map((x) => [x.nome, x.geral.qtd, x.COM_CTE.qtd, x.SEM_CTE.qtd, x.CTE_FORA_BASE.qtd, pctDe(x.pendente.qtd, x.geral.qtd), x.pendente.valor_nf, Number(((x.pct_frete || 0) * 100).toFixed(2)), x.pendente.estimado]);
    const emp = porEmpresa.filter((e) => e.qtd_nf).map((e) => [e.empresa, e.cc || 'sem CC', e.qtd_nf, e.estimado_nf]);
    const blocos = [{
      titulo: 'Indicadores',
      colunas: [{ titulo: 'Indicador', largura: 52 }, { titulo: 'NFs', tipo: 'inteiro', largura: 12 }, { titulo: '% das NFs', tipo: 'percentual', largura: 12 }, { titulo: 'Valor NF', tipo: 'moeda', largura: 20 }, { titulo: 'Frete estimado', tipo: 'moeda', largura: 18 }],
      linhas: [
        ['NFs no tracking (sem canceladas/devolvidas)', tt.geral.qtd, 100, tt.geral.valor_nf, ''],
        ['Com CT-e na base', tt.COM_CTE.qtd, pctDe(tt.COM_CTE.qtd, tt.geral.qtd), tt.COM_CTE.valor_nf, ''],
        ['Sem CT-e vinculado no tracking', tt.SEM_CTE.qtd, pctDe(tt.SEM_CTE.qtd, tt.geral.qtd), tt.SEM_CTE.valor_nf, tt.SEM_CTE.estimado],
        ['CT-e no tracking, mas fora da base (não veio da Sefaz)', tt.CTE_FORA_BASE.qtd, pctDe(tt.CTE_FORA_BASE.qtd, tt.geral.qtd), tt.CTE_FORA_BASE.valor_nf, tt.CTE_FORA_BASE.estimado],
        ['Frete por NFS-e (informativo, fora do total)', tt.NFSE?.qtd || 0, pctDe(tt.NFSE?.qtd || 0, tt.geral.qtd), tt.NFSE?.valor_nf || 0, tt.NFSE?.estimado || 0],
        ['Ainda não expedida (pedido criado/pago/NF emitida/em separação/separado; fora do total)', tt.NAO_EXPEDIDA?.qtd || 0, pctDe(tt.NAO_EXPEDIDA?.qtd || 0, tt.geral.qtd), tt.NAO_EXPEDIDA?.valor_nf || 0, ''],
        ['Cliente retira (Tipo NF = Retira; sem frete, fora do total)', tt.RETIRA?.qtd || 0, pctDe(tt.RETIRA?.qtd || 0, tt.geral.qtd), tt.RETIRA?.valor_nf || 0, ''],
        ['CT-e emitido após o mês (é da competência seguinte; informativo, fora do total)', tt.CTE_MES_SEGUINTE?.qtd || 0, pctDe(tt.CTE_MES_SEGUINTE?.qtd || 0, tt.geral.qtd), tt.CTE_MES_SEGUINTE?.valor_nf || 0, ''],
        ['Transportadora não cadastrada no SAP, sem documento (informativo, fora do total)', tt.SEM_TRANSPORTADORA?.qtd || 0, pctDe(tt.SEM_TRANSPORTADORA?.qtd || 0, tt.geral.qtd), tt.SEM_TRANSPORTADORA?.valor_nf || 0, ''],
      ],
      totais: ['TOTAL A VERIFICAR / PROVISIONAR', tt.pendente.qtd, pctDe(tt.pendente.qtd, tt.geral.qtd), tt.pendente.valor_nf, tt.pendente.estimado],
    }];
    if (emp.length) {
      blocos.push({ titulo: 'Por empresa / centro de custo', colunas: [{ titulo: 'Empresa', tipo: 'centro' }, { titulo: 'CC', tipo: 'centro' }, { titulo: 'NFs sem CT-e', tipo: 'inteiro' }, { titulo: 'Frete estimado', tipo: 'moeda' }], linhas: emp, totais: ['Total Geral', '', somaCol(emp, 2), somaCol(emp, 3)] });
    }
    blocos.push({
      titulo: 'Top 15 transportadoras com NFs pendentes',
      colunas: [{ titulo: 'Transportadora' }, { titulo: 'NFs', tipo: 'inteiro' }, { titulo: 'Pendentes', tipo: 'inteiro' }, { titulo: '% pendente', tipo: 'percentual' }, { titulo: 'Frete estimado', tipo: 'moeda' }],
      linhas: transp.filter((x) => x[3] + x[4] > 0).slice(0, 15).map((x) => [x[0], x[1], x[3] + x[4], x[5], x[8]]),
    });
    const sem = nfsPendentes.filter((n) => n.situacao === 'SEM_CTE');
    const fora = nfsPendentes.filter((n) => n.situacao === 'CTE_FORA_BASE');
    const colsTransp = [{ titulo: 'Transportadora (tracking)', largura: 40 }, { titulo: 'NFs', tipo: 'inteiro', largura: 10 }, { titulo: 'Com CT-e', tipo: 'inteiro', largura: 10 }, { titulo: 'Sem CT-e', tipo: 'inteiro', largura: 10 },
      { titulo: 'Fora da base', tipo: 'inteiro', largura: 10 }, { titulo: '% pendente', tipo: 'percentual', largura: 11 }, { titulo: 'Valor NF pendente', tipo: 'moeda', largura: 18 },
      { titulo: '% frete usado', tipo: 'percentual', largura: 11 }, { titulo: 'Frete estimado', tipo: 'moeda', largura: 18 }];
    const abas = [
      {
        nome: 'Laudo',
        titulo: `Laudo — Tracking x CT-e · competência ${competenciaBr(calculadaPara)}`,
        informacoes: [
          `Gerado em ${new Date().toLocaleString('pt-BR')}${snapshot ? ` · a partir da provisão salva em ${dataHoraBr(snapshot.criado_em)}` : ''}`,
          `NFs canceladas/devolvidas desconsideradas: ${num(resumoTracking.canceladas || 0)}`,
          'NF = linha do tracking com data na competência, agrupada pela chave da NF.',
          '"Fora da base" = o tracking tem a chave do CT-e, mas o documento não está na base de CT-es (pode não ter vindo da Sefaz).',
          'Frete estimado = valor da NF x % frete real da transportadora no mês (CT-es da base / valor das NFs, cada CT-e uma vez); sem histórico, frete do tracking (até 30% da NF) ou % geral.',
          'CT-e do tracking emitido depois do mês é da competência seguinte: fica fora do total.',
          'NF com "Tipo NF" = Retira (cliente retira) não tem frete: fica fora do total.',
          'NF sem CT-e ainda não expedida (Status Pedido PEC, PGC, NFE, ESP ou SEP) não teve frete no mês: fica fora do total.',
          'NFS-e = tracking marca "Nota fiscal de servico": frete cobrado por nota de serviço, fica fora do total a provisionar.',
          '"Transportadora nao cadastrada no SAP" sem documento de frete fica fora do total (informativo).',
        ],
        blocos,
      },
      { nome: 'Por transportadora', colunas: colsTransp, linhas: transp, totais: linhaTotal(colsTransp, { 1: somaCol(transp, 1), 2: somaCol(transp, 2), 3: somaCol(transp, 3), 4: somaCol(transp, 4), 5: pctDe(tt.pendente.qtd, tt.geral.qtd), 6: somaCol(transp, 6), 8: somaCol(transp, 8) }) },
      { nome: 'NFs sem CT-e', colunas: COLS_NF, linhas: linhasNf(sem, centrosAtivos), totais: linhaTotal(COLS_NF, { 2: `${num(sem.length)} NFs`, 9: tt.SEM_CTE.valor_nf, 12: tt.SEM_CTE.estimado }) },
      { nome: 'CT-e fora da base', colunas: COLS_NF, linhas: linhasNf(fora, centrosAtivos), totais: linhaTotal(COLS_NF, { 2: `${num(fora.length)} NFs`, 9: tt.CTE_FORA_BASE.valor_nf, 12: tt.CTE_FORA_BASE.estimado }) },
      { nome: 'Frete por NFS-e', colunas: COLS_NF, linhas: linhasNf(nfsNfse, centrosAtivos), totais: linhaTotal(COLS_NF, { 2: `${num(nfsNfse.length)} NFs`, 9: tt.NFSE?.valor_nf || 0, 12: tt.NFSE?.estimado || 0 }) },
    ];
    try {
      await exportarExcelMultiAbas({ nomeArquivo: `LAUDO_TRACKING_NF_SEM_CTE_${calculadaPara}.xlsx`, abas });
    } catch (e) {
      setErro(e.message || String(e));
    }
  };

  const valorLista = lista.reduce((acc, c) => acc + Number(c.valor_cte || 0), 0);
  const cards = resumo ? [
    { id: 'TODOS', rotulo: 'Emitidos na competência', cor: '#1e3a8a', dado: resumo.total.geral },
    ...Object.entries(SITUACOES_PROVISAO).map(([id, rotulo]) => ({ id, rotulo, cor: CORES[id], dado: resumo.total[id] })),
    { id: 'PROVISAO', rotulo: 'Provisão (após o mês + não lançado)', cor: '#7c3aed', dado: resumo.total.provisao },
  ] : [];
  const cardsNf = resumoTracking ? [
    { id: 'TODAS', rotulo: 'NFs no tracking do mês', cor: '#1e3a8a', dado: resumoTracking.total.geral },
    ...Object.entries(SITUACOES_TRACKING).map(([id, rotulo]) => ({ id, rotulo, cor: CORES_TRACKING[id], dado: resumoTracking.total[id] || { qtd: 0, valor_nf: 0, estimado: 0 } })),
    { id: 'PENDENTE', rotulo: 'A provisionar (sem CT-e + fora da base)', cor: '#7c3aed', dado: resumoTracking.total.pendente },
  ] : [];
  const empresasConhecidas = [...new Set([...Object.keys(centros), ...porEmpresa.map((e) => e.empresa).filter((e) => e !== '(sem empresa)')])].sort();

  return (
    <div className="table-card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="panel-title audit-table-title" style={{ margin: 0 }}>Provisão de CT-es por competência</div>
        <button type="button" className="btn-secondary" onClick={() => setAberto((v) => !v)}>{aberto ? 'Recolher' : 'Abrir'}</button>
      </div>
      {aberto && (
        <>
          <p style={{ margin: '6px 0 10px', fontSize: 13, color: '#64748b' }}>
            Cruza os CT-es emitidos no mês (base de CT-es) com os lançamentos de CT-e do relatório SAP importado acima
            (CNPJ do emitente + número + série). Lançado = CT-e com partida própria no SAP; sem partida, é não lançado.
            Para ver o que foi lançado depois da virada, importe também o relatório SAP do mês seguinte. Só entram CT-es com tomador do grupo (CPX, ITR, GP Pneus, GRIP, Cantu); EBAZAR fica fora (CT-es e tracking). Empresa pelo CNPJ do tomador (Filiais dos Robôs) ou pela empresa do lançamento SAP.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
            <label className="field" style={{ width: 180 }}>Competência (emissão)
              <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
            </label>
            <button type="button" className="btn-primary" disabled={Boolean(progresso)} onClick={calcular}>{progresso ? 'Processando...' : (itens ? 'Gerar novamente' : 'Calcular provisão')}</button>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={incluirTracking} disabled={Boolean(progresso)} onChange={(e) => alternarTracking(e.target.checked)} /> Considerar tracking no resultado (NFs sem CT-e)
            </label>
            {itens && !snapshot && <button type="button" className="btn-secondary" disabled={Boolean(progresso)} onClick={salvar}>Salvar provisão (histórico)</button>}
            {itens && <button type="button" className="btn-secondary" onClick={exportar}>Exportar (Excel)</button>}
            {resumoTracking && <button type="button" className="btn-secondary" onClick={exportarLaudoTracking}>Laudo tracking (Excel)</button>}
            {resumo && <button type="button" className="btn-secondary" onClick={baixarLaudoHtml}>Laudo (HTML)</button>}
            {resumo && <button type="button" className="btn-primary" onClick={baixarEmail}>E-mail pronto (.eml)</button>}
            <button type="button" className="btn-secondary" onClick={() => setEditarCc((v) => !v)}>Centros de custo</button>
          </div>

          {editarCc && (
            <div className="hint-box compact" style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Centro de custo por empresa (usado na provisão e nos relatórios)</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {empresasConhecidas.map((emp) => (
                  <label key={emp} className="field" style={{ width: 160 }}>{emp}
                    <input value={centros[emp] || ''} onChange={(e) => { const novo = { ...centros, [emp]: e.target.value.trim() }; setCentros(novo); guardarCentrosCusto(novo); }} />
                  </label>
                ))}
                <button type="button" className="btn-secondary" onClick={() => {
                  const emp = (window.prompt('Código da empresa (ex.: 1420):') || '').trim();
                  if (emp) { const novo = { ...centros, [emp]: centros[emp] || '' }; setCentros(novo); guardarCentrosCusto(novo); }
                }}>+ Empresa</button>
              </div>
            </div>
          )}

          {itens && (
            <details style={{ marginBottom: 10 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Meta de lançamento (laudo separado)</summary>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
                <label className="field" style={{ width: 110 }}>Meta (%)
                  <input type="number" min="0" max="100" step="0.5" value={metaPct} disabled={Boolean(snapshot)} onChange={(e) => setMetaPct(e.target.value)} />
                </label>
                <label className="field" style={{ width: 170 }}>Corte (CT-es na base até)
                  <input type="date" value={corteEfetivo} disabled={Boolean(snapshot)} onChange={(e) => setCorteMeta(e.target.value)} />
                </label>
                <button type="button" className="btn-secondary" disabled={!metaLancamento} onClick={baixarLaudoMeta}>Laudo meta (HTML)</button>
                {metaLancamento && (
                  <span style={{ fontSize: 13 }}>
                    Disponíveis até {dataBr(metaLancamento.corte)}: <strong style={{ color: metaLancamento.atingiu ? '#15803d' : '#b91c1c' }}>{metaLancamento.pctMeta.toFixed(1)}%</strong> lançados no mês
                    {' '}· bruto {metaLancamento.pctBruto.toFixed(1)}% · {num(metaLancamento.chegaramDepois.qtd)} CT-es chegaram depois do corte
                  </span>
                )}
                {snapshot && !metaLancamento && <span style={{ fontSize: 12, color: '#64748b' }}>Provisão salva antes da meta existir: use “Gerar novamente” para calcular.</span>}
              </div>
            </details>
          )}

          {(historico.length > 0 || avisoHistorico) && (
            <details style={{ marginBottom: 10 }} open={!itens}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Histórico de provisões salvas ({num(historico.length)})</summary>
              {avisoHistorico && <div className="hint-box compact error-text">{avisoHistorico}</div>}
              {historico.length > 0 && (
                <div className="sim-analise-tabela-wrap" style={{ maxHeight: 240, overflow: 'auto', marginTop: 6 }}>
                  <table className="sim-analise-tabela">
                    <thead><tr><th>Competência</th><th>Salva em</th><th>Descrição</th><th>CT-es provisão</th><th>Valor provisão</th><th>NFs sem CT-e</th><th>Frete estimado NFs</th><th>Por</th><th /></tr></thead>
                    <tbody>
                      {historico.map((h) => (
                        <tr key={h.id} style={snapshot?.id === h.id ? { background: '#eff6ff' } : undefined}>
                          <td><strong>{competenciaBr(h.competencia)}</strong></td>
                          <td>{dataHoraBr(h.criado_em)}</td>
                          <td>{h.descricao || '-'}</td>
                          <td>{num(h.qtd_provisao)}</td>
                          <td><strong>{dinheiro(h.valor_provisao)}</strong></td>
                          <td>{num(h.qtd_nf_sem_cte)}</td>
                          <td>{dinheiro(h.valor_estimado_nf_sem_cte)}</td>
                          <td style={{ fontSize: 12 }}>{h.criado_por || '-'}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} disabled={Boolean(progresso)} onClick={() => abrirSnapshot(h.id)}>Abrir salva</button>{' '}
                            <button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => excluirSnapshot(h)}>Excluir</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          )}

          {progresso && <div className="hint-box compact">{progresso}</div>}
          {erro && <div className="hint-box compact error-text">{erro}</div>}
          {aviso && <div className="hint-box compact">{aviso}</div>}
          {snapshot && (
            <div className="hint-box compact" style={{ background: '#eff6ff' }}>
              Mostrando a provisão <strong>salva</strong> de {competenciaBr(snapshot.competencia)} em {dataHoraBr(snapshot.criado_em)}{snapshot.descricao ? ` (${snapshot.descricao})` : ''}.
              Só os CT-es que entraram na provisão ficaram guardados. Use “Gerar novamente” para recalcular com os dados de hoje.
            </div>
          )}
          {ultimoSalvo && resumo && (
            <div className="hint-box compact">
              Última provisão salva de {competenciaBr(ultimoSalvo.competencia)} ({dataHoraBr(ultimoSalvo.criado_em)}): {num(ultimoSalvo.qtd_provisao)} CT-es · {dinheiro(ultimoSalvo.valor_provisao)}.
              Recalculado agora: {num(resumo.total.provisao.qtd)} · {dinheiro(resumo.total.provisao.valor)}
              {' '}(<strong style={{ color: resumo.total.provisao.valor - ultimoSalvo.valor_provisao > 0 ? '#b91c1c' : '#15803d' }}>
                {resumo.total.provisao.qtd - ultimoSalvo.qtd_provisao >= 0 ? '+' : ''}{num(resumo.total.provisao.qtd - ultimoSalvo.qtd_provisao)} CT-es · {dinheiro(resumo.total.provisao.valor - ultimoSalvo.valor_provisao)}
              </strong>).
            </div>
          )}

          {resumo && foraTomador?.qtd > 0 && (
            <details className="hint-box compact" style={{ marginBottom: 8 }}>
              <summary style={{ cursor: 'pointer' }}>
                {num(foraTomador.qtd)} CT-e(s) · {dinheiro(foraTomador.valor)} ficaram fora da provisão: EBAZAR, tomador fora do grupo (só CPX, ITR, GP Pneus, GRIP e Cantu) ou vazio.
              </summary>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                {foraTomador.porTomador.slice(0, 30).map((t) => <div key={t.nome}>{t.nome}: {num(t.qtd)} · {dinheiro(t.valor)}</div>)}
              </div>
            </details>
          )}
          {resumo && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                {cards.map((c) => (
                  <button key={c.id} type="button" style={cartao(filtro === c.id, c.cor)} onClick={() => { setFiltro(c.id); setVisiveis(PAGINA); }}>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>{c.rotulo}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: filtro === c.id ? '#fff' : c.cor }}>{num(c.dado.qtd)}</div>
                    <div style={{ fontSize: 12 }}>{dinheiro(c.dado.valor)}{resumo.total.geral.qtd ? ` · ${((c.dado.qtd / resumo.total.geral.qtd) * 100).toFixed(1)}%` : ''}</div>
                  </button>
                ))}
              </div>

              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Provisão por empresa / centro de custo</div>
              <div className="sim-analise-tabela-wrap" style={{ maxHeight: 260, overflow: 'auto', marginBottom: 12 }}>
                <table className="sim-analise-tabela">
                  <thead><tr><th>Empresa</th><th>CC</th><th>CT-es provisão</th><th>Valor CTE</th>{resumoTracking && <><th>NFs sem CT-e</th><th>Frete estimado NFs</th></>}</tr></thead>
                  <tbody>
                    {porEmpresa.map((e) => (
                      <tr key={e.empresa}>
                        <td><strong>{e.empresa}</strong></td>
                        <td style={{ color: e.cc ? undefined : '#b91c1c' }}>{e.cc || 'sem CC'}</td>
                        <td>{num(e.qtd)}</td>
                        <td><strong>{dinheiro(e.valor)}</strong></td>
                        {resumoTracking && <><td>{num(e.qtd_nf)}</td><td>{dinheiro(e.estimado_nf)}</td></>}
                      </tr>
                    ))}
                    <tr style={{ background: '#f1f5f9', fontWeight: 700 }}>
                      <td>Total Geral</td><td />
                      <td>{num(porEmpresa.reduce((a, e) => a + e.qtd, 0))}</td>
                      <td>{dinheiro(porEmpresa.reduce((a, e) => a + e.valor, 0))}</td>
                      {resumoTracking && <><td>{num(porEmpresa.reduce((a, e) => a + e.qtd_nf, 0))}</td><td>{dinheiro(porEmpresa.reduce((a, e) => a + e.estimado_nf, 0))}</td></>}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Por transportadora (clique para filtrar os CT-es)</div>
              <div className="sim-analise-tabela-wrap" style={{ maxHeight: 300, overflow: 'auto', marginBottom: 12 }}>
                <table className="sim-analise-tabela">
                  <thead>
                    <tr><th>Transportadora</th><th>Emitidos</th><th>Lançado no mês</th><th>Após o mês</th><th>Não lançado</th><th>Provisão (valor)</th></tr>
                  </thead>
                  <tbody>
                    {resumo.porTransportadora.map((t) => (
                      <tr key={t.nome} style={transportadora === t.nome ? { background: '#eff6ff' } : undefined}>
                        <td><button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => { setTransportadora(transportadora === t.nome ? '' : t.nome); setVisiveis(PAGINA); }}>{t.nome}</button></td>
                        <td>{num(t.geral.qtd)}</td>
                        <td>{num(t.NO_MES.qtd)}</td>
                        <td>{num(t.APOS_MES?.qtd)}</td>
                        <td style={{ color: t.NAO_LANCADO.qtd ? '#b91c1c' : undefined, fontWeight: t.NAO_LANCADO.qtd ? 700 : 400 }}>{num(t.NAO_LANCADO.qtd)}</td>
                        <td><strong>{dinheiro(t.provisao.valor)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                {num(lista.length)} CT-e(s) · {dinheiro(valorLista)}{transportadora ? ` · ${transportadora}` : ''}
              </div>
              <div className="sim-analise-tabela-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
                <table className="sim-analise-tabela">
                  <thead><tr><th>CT-e</th><th>Transportadora</th><th>Empresa</th><th>Emissão</th><th>Valor CT-e</th><th>Situação</th><th>Data lançamento</th><th>Lançamento contábil</th></tr></thead>
                  <tbody>
                    {!lista.length && <tr><td colSpan={8}>{snapshot && !SITUACOES_SALVAS.has(filtro) ? 'A provisão salva guarda só os CT-es que entraram na provisão. Gere novamente para ver este recorte.' : 'Nenhum CT-e nesse recorte.'}</td></tr>}
                    {lista.slice(0, visiveis).map((c) => (
                      <tr key={c.id || c.chave_cte}>
                        <td style={{ fontSize: 12 }}>{numeroSerie(c)}</td>
                        <td>{c.transportadora}</td>
                        <td style={{ fontSize: 12 }}>{c.empresa || '-'}</td>
                        <td>{dataBr(c.data_emissao)}</td>
                        <td>{dinheiro(c.valor_cte)}</td>
                        <td style={{ color: CORES[c.situacao], fontWeight: 700 }}>{SITUACOES_PROVISAO[c.situacao] || 'Lançado após o mês'}{c.estornado ? ' (estornado)' : ''}</td>
                        <td>{dataBr(c.data_lancamento)}</td>
                        <td style={{ fontSize: 12 }}>{c.lancamento_contabil || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {lista.length > visiveis && (
                <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={() => setVisiveis((v) => v + PAGINA)}>Mostrar mais</button>
              )}
            </>
          )}

          {resumoTracking && (
            <>
              <div style={{ fontWeight: 700, fontSize: 14, margin: '18px 0 6px' }}>Tracking do mês x CT-e — NFs sem CT-e vinculado</div>
              <p style={{ margin: '0 0 8px', fontSize: 12, color: '#64748b' }}>
                NFs do tracking com data em {competenciaBr(calculadaPara)} (sem canceladas/devolvidas: {num(resumoTracking.canceladas)}). “Fora da base” = o tracking tem a chave do CT-e,
                mas o documento não está na base (pode não ter vindo da Sefaz). Frete estimado pelo % frete real da transportadora (CT-es da base / valor das NFs); sem histórico, frete do tracking ou % geral. CT-e emitido no mês seguinte fica fora. NFS-e = frete por nota de serviço, fora do total.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                {cardsNf.map((c) => (
                  <button key={c.id} type="button" style={cartao(filtroNf === c.id, c.cor)} onClick={() => { setFiltroNf(c.id); setVisiveisNf(PAGINA); }}>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>{c.rotulo}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: filtroNf === c.id ? '#fff' : c.cor }}>{num(c.dado.qtd)}</div>
                    <div style={{ fontSize: 12 }}>
                      NF {dinheiro(c.dado.valor_nf)}{resumoTracking.total.geral.qtd ? ` · ${((c.dado.qtd / resumoTracking.total.geral.qtd) * 100).toFixed(1)}%` : ''}
                      {c.dado.estimado ? <div>frete est. {dinheiro(c.dado.estimado)}</div> : null}
                    </div>
                  </button>
                ))}
              </div>
              <div className="sim-analise-tabela-wrap" style={{ maxHeight: 260, overflow: 'auto', marginBottom: 12 }}>
                <table className="sim-analise-tabela">
                  <thead><tr><th>Transportadora (tracking)</th><th>NFs</th><th>Com CT-e</th><th>Sem CT-e</th><th>Fora da base</th><th>% pendente</th><th>% frete</th><th>Frete estimado</th></tr></thead>
                  <tbody>
                    {resumoTracking.porTransportadora.slice(0, 300).map((t) => (
                      <tr key={t.nome}>
                        <td>{t.nome}</td>
                        <td>{num(t.geral.qtd)}</td>
                        <td>{num(t.COM_CTE.qtd)}</td>
                        <td style={{ color: t.SEM_CTE.qtd ? '#b91c1c' : undefined, fontWeight: t.SEM_CTE.qtd ? 700 : 400 }}>{num(t.SEM_CTE.qtd)}</td>
                        <td style={{ color: t.CTE_FORA_BASE.qtd ? '#c2410c' : undefined }}>{num(t.CTE_FORA_BASE.qtd)}</td>
                        <td>{t.geral.qtd ? `${((t.pendente.qtd / t.geral.qtd) * 100).toFixed(1)}%` : '-'}</td>
                        <td>{((t.pct_frete || 0) * 100).toFixed(2)}%</td>
                        <td><strong>{dinheiro(t.pendente.estimado)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{num(listaNf.length)} NF(s)</div>
              <div className="sim-analise-tabela-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
                <table className="sim-analise-tabela">
                  <thead><tr><th>NF</th><th>Data</th><th>Transportadora</th><th>Empresa</th><th>Destino</th><th>Valor NF</th><th>Situação</th><th>CT-e no tracking</th><th>Frete estimado</th></tr></thead>
                  <tbody>
                    {!listaNf.length && <tr><td colSpan={9}>{snapshot && filtroNf !== 'PENDENTE' && filtroNf !== 'SEM_CTE' && filtroNf !== 'CTE_FORA_BASE' ? 'A provisão salva guarda só as NFs sem CT-e. Gere novamente para ver este recorte.' : 'Nenhuma NF nesse recorte.'}</td></tr>}
                    {listaNf.slice(0, visiveisNf).map((n) => (
                      <tr key={n.chave_nfe || `${n.nota_fiscal}|${n.transportadora}`}>
                        <td style={{ fontSize: 12 }} title={n.chave_nfe}>{n.nota_fiscal || n.chave_nfe}</td>
                        <td>{dataBr(n.data)}</td>
                        <td>{n.transportadora}</td>
                        <td style={{ fontSize: 12 }}>{n.empresa || '-'}</td>
                        <td style={{ fontSize: 12 }}>{n.destino}</td>
                        <td>{dinheiro(n.valor_nf)}</td>
                        <td style={{ color: CORES_TRACKING[n.situacao], fontWeight: 700 }}>{SITUACOES_TRACKING[n.situacao]}</td>
                        <td style={{ fontSize: 11 }}>{(n.chaves_cte || []).join(' / ') || n.cte_numero || '-'}</td>
                        <td>{n.frete_estimado ? dinheiro(n.frete_estimado) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {listaNf.length > visiveisNf && (
                <button type="button" className="btn-secondary" style={{ marginTop: 8 }} onClick={() => setVisiveisNf((v) => v + PAGINA)}>Mostrar mais</button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
