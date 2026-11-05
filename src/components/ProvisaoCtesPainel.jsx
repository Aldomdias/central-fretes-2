import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  buscarCtesNaBase, carregarCtesCompetencia, carregarFaturasLancadasDosCtes, carregarLancamentosPorCnpj, carregarSnapshotProvisao,
  carregarTrackingCompetencia, excluirSnapshotProvisao, listarSnapshotsProvisao, salvarSnapshotProvisao,
} from '../services/lancamentosCteSapService';
import { carregarParametrosRemotos } from '../services/robosParametrosService';
import { carregarParametros, criarIndices } from '../utils/robos/lancamentoComum';
import { carregarSessao } from '../utils/authLocal';
import { avaliarCteParaBase } from '../services/cteBasePolicy';
import { classificarProvisao, cnpj14, resumirProvisao, serieDaChave, SITUACOES_PROVISAO } from '../utils/lancamentosCteSap';
import {
  agruparNfsTracking, carregarCentrosCusto, classificarNfsTracking, CORES_TRACKING, guardarCentrosCusto, resumirPorEmpresa,
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

const CORES = { NO_MES: '#15803d', FATURA: '#0f766e', APOS_MES: '#c2410c', FATURA_APOS: '#b45309', NAO_LANCADO: '#b91c1c' };
const SITUACOES_SALVAS = new Set(['APOS_MES', 'FATURA_APOS', 'NAO_LANCADO', 'PROVISAO']);

// Campos do CT-e guardados no snapshot (so os que entram na provisao).
const CAMPOS_CTE = ['chave_cte', 'numero_cte', 'transportadora', 'cnpj_transportadora', 'cnpj_tomador', 'empresa', 'data_emissao', 'valor_cte', 'canal',
  'cidade_origem', 'uf_origem', 'cidade_destino', 'uf_destino', 'situacao', 'provisao', 'estornado', 'data_lancamento', 'lancamento_contabil', 'numero_fatura'];
const CAMPOS_NF = ['chave_nfe', 'nota_fiscal', 'data', 'transportadora', 'canal', 'pedido', 'origem', 'destino', 'valor_nf', 'chaves_cte', 'cte_numero',
  'situacao', 'pct_frete', 'frete_estimado', 'empresa'];
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

function linhasCteExcel(lista, centros) {
  return lista.map((c) => ({
    Empresa: c.empresa || '', CC: centros[c.empresa] || '',
    'Chave CT-e': c.chave_cte, 'Número CT-e': numeroSerie(c), Transportadora: c.transportadora, CNPJ: c.cnpj_transportadora, 'CNPJ tomador': c.cnpj_tomador || '',
    Emissão: String(c.data_emissao || '').slice(0, 10), 'Valor CT-e': Number(c.valor_cte || 0), Canal: c.canal || '',
    Origem: `${c.cidade_origem || ''}${c.uf_origem ? `/${c.uf_origem}` : ''}`, Destino: `${c.cidade_destino || ''}${c.uf_destino ? `/${c.uf_destino}` : ''}`,
    Situação: SITUACOES_PROVISAO[c.situacao], 'Entra na provisão': c.provisao ? 'Sim' : 'Não',
    'Data lançamento': c.data_lancamento || '', 'Lançamento contábil': c.lancamento_contabil || '', Fatura: c.numero_fatura || '',
    'Teve estorno sem relançar': c.estornado ? 'Sim' : '',
  }));
}

function linhasNfExcel(lista, centros) {
  return lista.map((n) => ({
    Empresa: n.empresa || '', CC: centros[n.empresa] || '',
    'Chave NF': n.chave_nfe, 'Nota fiscal': n.nota_fiscal, 'Data NF': n.data, Transportadora: n.transportadora, Canal: n.canal, Pedido: n.pedido,
    Origem: n.origem, Destino: n.destino, 'Valor NF': r2(n.valor_nf), Situação: SITUACOES_TRACKING[n.situacao],
    'Chave CT-e no tracking': (n.chaves_cte || []).join(' / '), 'Nº CT-e no tracking': n.cte_numero || '',
    '% frete usado': Number(((n.pct_frete || 0) * 100).toFixed(2)), 'Frete estimado': r2(n.frete_estimado),
  }));
}

function abaPorEmpresa(porEmpresa, comTracking) {
  const linhas = porEmpresa.map((e) => ({
    Empresa: e.empresa, 'Valor CTE': r2(e.valor), CC: e.cc, 'Qtd CT-es': e.qtd,
    ...(comTracking ? { 'NFs sem CT-e (qtd)': e.qtd_nf, 'NFs sem CT-e (frete estimado)': r2(e.estimado_nf) } : {}),
  }));
  const tot = porEmpresa.reduce((a, e) => ({ v: a.v + e.valor, q: a.q + e.qtd, qn: a.qn + e.qtd_nf, en: a.en + e.estimado_nf }), { v: 0, q: 0, qn: 0, en: 0 });
  linhas.push({ Empresa: 'Total Geral', 'Valor CTE': r2(tot.v), CC: '', 'Qtd CT-es': tot.q, ...(comTracking ? { 'NFs sem CT-e (qtd)': tot.qn, 'NFs sem CT-e (frete estimado)': r2(tot.en) } : {}) });
  const ws = XLSX.utils.json_to_sheet(linhas);
  ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 26 }];
  return ws;
}

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
  const [incluirTracking, setIncluirTracking] = useState(true);
  const [historico, setHistorico] = useState([]);
  const [avisoHistorico, setAvisoHistorico] = useState('');
  const [centros, setCentros] = useState(carregarCentrosCusto);
  const [editarCc, setEditarCc] = useState(false);

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

  const calcular = async () => {
    if (!/^\d{4}-\d{2}$/.test(competencia)) return;
    setErro(''); setAviso('');
    setItens(null); setNfs(null); setSnapshot(null); setForaTomador(null);
    try {
      const filiais = await filiaisPorCnpj();
      const todosCtes = await carregarCtesCompetencia(competencia, setProgresso);
      // So CT-es com tomador do grupo (CPX, ITR, GP Pneus, GRIP, Cantu) — mesma regra da base de CT-es.
      const opcoesTomador = { ocultarEbazar: false, incluirCpsLog: true, incluirCpComercial: false };
      const ctes = [];
      const fora = { qtd: 0, valor: 0, porTomador: new Map() };
      todosCtes.forEach((c) => {
        if (avaliarCteParaBase(c, opcoesTomador).aceito) { ctes.push(c); return; }
        fora.qtd += 1; fora.valor += Number(c.valor_cte || 0);
        const nome = String(c.tomador_servico || '').trim() || '(tomador vazio)';
        const t = fora.porTomador.get(nome) || { nome, qtd: 0, valor: 0 };
        t.qtd += 1; t.valor += Number(c.valor_cte || 0);
        fora.porTomador.set(nome, t);
      });
      const lancamentos = await carregarLancamentosPorCnpj(ctes.map((c) => c.cnpj_transportadora), competencia, setProgresso);
      const parcial = classificarProvisao(ctes, lancamentos, new Map(), competencia);
      const semLancamento = parcial.filter((c) => c.situacao === 'NAO_LANCADO').map((c) => c.chave_cte);
      const faturas = await carregarFaturasLancadasDosCtes(semLancamento, setProgresso);
      const classificados = classificarProvisao(ctes, lancamentos, faturas, competencia).map((c) => ({
        ...c, empresa: filiais.get(cnpj14(c.cnpj_tomador))?.emp || c.empresa_sap || '',
      }));
      if (incluirTracking) {
        const linhas = await carregarTrackingCompetencia(competencia, setProgresso);
        const { nfs: agrupadas, canceladas } = agruparNfsTracking(linhas);
        const valorPorChave = new Map(ctes.map((c) => [String(c.chave_cte || '').replace(/\D/g, ''), Number(c.valor_cte || 0)]));
        const foraDoMes = agrupadas.flatMap((n) => [...n.chaves_cte]).filter((c) => !valorPorChave.has(c));
        const extra = await buscarCtesNaBase(foraDoMes, setProgresso);
        extra.forEach((v, k) => valorPorChave.set(k, v));
        setNfs(classificarNfsTracking(agrupadas, valorPorChave, filiais));
        setTrackingCanceladas(canceladas);
      }
      setItens(classificados);
      setForaTomador({ qtd: fora.qtd, valor: fora.valor, porTomador: [...fora.porTomador.values()].sort((a, b) => b.valor - a.valor) });
      setCalculadaPara(competencia);
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

  const resumoTracking = useMemo(() => {
    if (!nfs) return null;
    return snapshot?.tracking_resumo ? snapshot.tracking_resumo : resumirTracking(nfs, trackingCanceladas);
  }, [nfs, snapshot, trackingCanceladas]);

  const nfsPendentes = useMemo(() => (nfs || []).filter((n) => n.situacao !== 'COM_CTE'), [nfs]);

  const porEmpresa = useMemo(() => (itens ? resumirPorEmpresa(itens.filter((c) => c.provisao), nfsPendentes, centrosAtivos) : []), [itens, nfsPendentes, centrosAtivos]);

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
      .filter((n) => (filtroNf === 'PENDENTE' ? n.situacao !== 'COM_CTE' : filtroNf === 'TODAS' ? true : n.situacao === filtroNf))
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
        ...nfsPendentes.map((n) => ({ tipo: n.situacao === 'SEM_CTE' ? 'NF_SEM_CTE' : 'CTE_FORA_BASE', dados: pegar(n, CAMPOS_NF) })),
      ];
      const sessao = carregarSessao?.() || {};
      await salvarSnapshotProvisao({
        competencia: calculadaPara,
        descricao: descricao.trim() || null,
        resumo: { total: resumo.total, porTransportadora: resumo.porTransportadora, foraTomador },
        tracking_resumo: resumoTracking || null,
        centros_custo: centros,
        qtd_provisao: resumo.total.provisao.qtd,
        valor_provisao: r2(resumo.total.provisao.valor),
        qtd_nf_sem_cte: resumoTracking?.total.pendente.qtd || 0,
        valor_estimado_nf_sem_cte: r2(resumoTracking?.total.pendente.estimado || 0),
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

  const exportar = () => {
    if (!itens || !resumo) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, abaPorEmpresa(porEmpresa, Boolean(resumoTracking)), 'Por empresa');
    const linhasResumo = resumo.porTransportadora.map((t) => ({
      Transportadora: t.nome,
      'CT-es emitidos': t.geral.qtd, 'Valor emitido': r2(t.geral.valor),
      ...Object.fromEntries(Object.entries(SITUACOES_PROVISAO).flatMap(([k, rot]) => [[`${rot} (qtd)`, t[k].qtd], [`${rot} (valor)`, r2(t[k].valor)]])),
      'Provisão (qtd)': t.provisao.qtd, 'Provisão (valor)': r2(t.provisao.valor),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasResumo), 'Resumo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasCteExcel(itens.filter((c) => c.provisao), centrosAtivos)), 'Provisão');
    if (!snapshot) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasCteExcel(itens, centrosAtivos)), 'Todos os CT-es');
    if (nfsPendentes.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasNfExcel(nfsPendentes, centrosAtivos)), 'Tracking NF sem CT-e');
    if (foraTomador?.qtd) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(foraTomador.porTomador.map((t) => ({ 'Tomador (fora da provisão)': t.nome, 'CT-es': t.qtd, Valor: r2(t.valor) }))), 'Fora do grupo (tomador)');
    XLSX.writeFile(wb, `PROVISAO_CTES_${calculadaPara}${snapshot ? `_SALVA_${String(snapshot.criado_em).slice(0, 10)}` : ''}.xlsx`);
  };

  const exportarLaudoTracking = () => {
    if (!resumoTracking) return;
    const t = resumoTracking.total;
    const pct = (q) => (t.geral.qtd ? `${((q / t.geral.qtd) * 100).toFixed(1)}%` : '-');
    const wb = XLSX.utils.book_new();
    const capa = [
      ['LAUDO — TRACKING x CT-e (NFs sem CT-e vinculado)'],
      [`Competência: ${competenciaBr(calculadaPara)}`],
      [`Gerado em: ${new Date().toLocaleString('pt-BR')}${snapshot ? ` · a partir da provisão salva em ${dataHoraBr(snapshot.criado_em)}` : ''}`],
      [],
      ['Indicador', 'Qtd NFs', '% das NFs', 'Valor NF', 'Frete estimado'],
      ['NFs no tracking (sem canceladas/devolvidas)', t.geral.qtd, '100%', r2(t.geral.valor_nf), ''],
      ['Com CT-e na base', t.COM_CTE.qtd, pct(t.COM_CTE.qtd), r2(t.COM_CTE.valor_nf), ''],
      ['Sem CT-e vinculado no tracking', t.SEM_CTE.qtd, pct(t.SEM_CTE.qtd), r2(t.SEM_CTE.valor_nf), r2(t.SEM_CTE.estimado)],
      ['CT-e no tracking, mas fora da base (não veio da Sefaz)', t.CTE_FORA_BASE.qtd, pct(t.CTE_FORA_BASE.qtd), r2(t.CTE_FORA_BASE.valor_nf), r2(t.CTE_FORA_BASE.estimado)],
      ['Total a verificar / provisionar', t.pendente.qtd, pct(t.pendente.qtd), r2(t.pendente.valor_nf), r2(t.pendente.estimado)],
      ['NFs canceladas/devolvidas (desconsideradas)', resumoTracking.canceladas || 0, '', '', ''],
      [],
      ['Critérios'],
      ['NF = linha do tracking com data dentro da competência, agrupada pela chave da NF.'],
      ['"Com CT-e na base": a chave do CT-e informada no tracking existe na base de CT-es (XML recebido da Sefaz).'],
      ['"Fora da base": o tracking tem a chave do CT-e, mas o documento não está na base — pode não ter vindo da Sefaz.'],
      ['Frete estimado = valor da NF x % frete/valor NF das NFs da mesma transportadora com CT-e no mês (sem histórico, usa o % geral).'],
    ];
    const wsCapa = XLSX.utils.aoa_to_sheet(capa);
    wsCapa['!cols'] = [{ wch: 58 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsCapa, 'Laudo');
    const porT = resumoTracking.porTransportadora.map((x) => ({
      Transportadora: x.nome, 'NFs no tracking': x.geral.qtd, 'Com CT-e': x.COM_CTE.qtd, 'Sem CT-e': x.SEM_CTE.qtd, 'CT-e fora da base': x.CTE_FORA_BASE.qtd,
      '% sem CT-e': x.geral.qtd ? Number(((x.pendente.qtd / x.geral.qtd) * 100).toFixed(1)) : 0,
      'Valor NF pendente': r2(x.pendente.valor_nf), '% frete usado': Number(((x.pct_frete || 0) * 100).toFixed(2)), 'Frete estimado': r2(x.pendente.estimado),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porT), 'Por transportadora');
    const empresas = porEmpresa.filter((e) => e.qtd_nf).map((e) => ({ Empresa: e.empresa, CC: e.cc, 'NFs sem CT-e': e.qtd_nf, 'Frete estimado': r2(e.estimado_nf) }));
    if (empresas.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(empresas), 'Por empresa');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasNfExcel(nfsPendentes.filter((n) => n.situacao === 'SEM_CTE'), centrosAtivos)), 'NFs sem CT-e');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasNfExcel(nfsPendentes.filter((n) => n.situacao === 'CTE_FORA_BASE'), centrosAtivos)), 'CT-e fora da base');
    XLSX.writeFile(wb, `LAUDO_TRACKING_NF_SEM_CTE_${calculadaPara}.xlsx`);
  };

  const valorLista = lista.reduce((acc, c) => acc + Number(c.valor_cte || 0), 0);
  const cards = resumo ? [
    { id: 'TODOS', rotulo: 'Emitidos na competência', cor: '#1e3a8a', dado: resumo.total.geral },
    ...Object.entries(SITUACOES_PROVISAO).map(([id, rotulo]) => ({ id, rotulo, cor: CORES[id], dado: resumo.total[id] })),
    { id: 'PROVISAO', rotulo: 'Provisão (após o mês + não lançado)', cor: '#7c3aed', dado: resumo.total.provisao },
  ] : [];
  const cardsNf = resumoTracking ? [
    { id: 'TODAS', rotulo: 'NFs no tracking do mês', cor: '#1e3a8a', dado: resumoTracking.total.geral },
    ...Object.entries(SITUACOES_TRACKING).map(([id, rotulo]) => ({ id, rotulo, cor: CORES_TRACKING[id], dado: resumoTracking.total[id] })),
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
            (CNPJ do emitente + número + série). CT-e sem lançamento próprio conta como lançado pela data de lançamento da fatura em que está.
            Para ver o que foi lançado depois da virada, importe também o relatório SAP do mês seguinte. Só entram CT-es com tomador do grupo (CPX, ITR, GP Pneus, GRIP, Cantu). Empresa pelo CNPJ do tomador (Filiais dos Robôs) ou pela empresa do lançamento SAP.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
            <label className="field" style={{ width: 180 }}>Competência (emissão)
              <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
            </label>
            <button type="button" className="btn-primary" disabled={Boolean(progresso)} onClick={calcular}>{progresso ? 'Processando...' : (itens ? 'Gerar novamente' : 'Calcular provisão')}</button>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={incluirTracking} onChange={(e) => setIncluirTracking(e.target.checked)} /> Incluir tracking do mês (NFs sem CT-e)
            </label>
            {itens && !snapshot && <button type="button" className="btn-secondary" disabled={Boolean(progresso)} onClick={salvar}>Salvar provisão (histórico)</button>}
            {itens && <button type="button" className="btn-secondary" onClick={exportar}>Exportar (Excel)</button>}
            {resumoTracking && <button type="button" className="btn-secondary" onClick={exportarLaudoTracking}>Laudo tracking (Excel)</button>}
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
                {num(foraTomador.qtd)} CT-e(s) · {dinheiro(foraTomador.valor)} ficaram fora da provisão: tomador fora do grupo (só CPX, ITR, GP Pneus, GRIP e Cantu) ou vazio.
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
                    <tr><th>Transportadora</th><th>Emitidos</th><th>Lançado no mês</th><th>Via fatura</th><th>Após o mês</th><th>Não lançado</th><th>Provisão (valor)</th></tr>
                  </thead>
                  <tbody>
                    {resumo.porTransportadora.map((t) => (
                      <tr key={t.nome} style={transportadora === t.nome ? { background: '#eff6ff' } : undefined}>
                        <td><button type="button" className="btn-secondary" style={{ padding: '2px 8px' }} onClick={() => { setTransportadora(transportadora === t.nome ? '' : t.nome); setVisiveis(PAGINA); }}>{t.nome}</button></td>
                        <td>{num(t.geral.qtd)}</td>
                        <td>{num(t.NO_MES.qtd)}</td>
                        <td>{num(t.FATURA.qtd)}</td>
                        <td>{num(t.APOS_MES.qtd + t.FATURA_APOS.qtd)}</td>
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
                  <thead><tr><th>CT-e</th><th>Transportadora</th><th>Empresa</th><th>Emissão</th><th>Valor CT-e</th><th>Situação</th><th>Data lançamento</th><th>Lançamento / fatura</th></tr></thead>
                  <tbody>
                    {!lista.length && <tr><td colSpan={8}>{snapshot && !SITUACOES_SALVAS.has(filtro) ? 'A provisão salva guarda só os CT-es que entraram na provisão. Gere novamente para ver este recorte.' : 'Nenhum CT-e nesse recorte.'}</td></tr>}
                    {lista.slice(0, visiveis).map((c) => (
                      <tr key={c.id || c.chave_cte}>
                        <td style={{ fontSize: 12 }}>{numeroSerie(c)}</td>
                        <td>{c.transportadora}</td>
                        <td style={{ fontSize: 12 }}>{c.empresa || '-'}</td>
                        <td>{dataBr(c.data_emissao)}</td>
                        <td>{dinheiro(c.valor_cte)}</td>
                        <td style={{ color: CORES[c.situacao], fontWeight: 700 }}>{SITUACOES_PROVISAO[c.situacao]}{c.estornado ? ' (estornado)' : ''}</td>
                        <td>{dataBr(c.data_lancamento)}</td>
                        <td style={{ fontSize: 12 }}>{[c.lancamento_contabil, c.numero_fatura ? `Fatura ${c.numero_fatura}` : ''].filter(Boolean).join(' · ') || '-'}</td>
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
                mas o documento não está na base (pode não ter vindo da Sefaz). Frete estimado pelo % frete/valor NF da própria transportadora no mês.
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
