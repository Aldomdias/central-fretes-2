import { useEffect, useMemo, useState } from 'react';
import { carregarPlataformaAuditoria } from '../services/auditoriaFretesService';
import { carregarResumoCtesFaturas, carregarUltimaImportacaoSap } from '../services/diagnosticoFaturasService';
import { diasAte } from '../utils/auditoriaFretesDomain';
import {
  FAIXAS_A_VENCER,
  faixaDaLinha,
  faturaLancada,
  filtrarPorCards,
  GRUPOS_DIAGNOSTICO,
  montarLinhasDiagnostico,
  parseListaFaturas,
  proximaAcao,
  situacaoCtes,
  situacaoEnvioErp,
  situacaoPagamento,
  situacaoPagamentoLinha,
  textoPagamentoLinha,
  valorDaLinha,
} from '../utils/diagnosticoFaturas';
import { exportarExcelFormatado } from '../utils/exportarExcelFormatado';

const CHAVE_SESSAO = 'cf_diagnostico_faturas_v1';
const TAM_PAGINA = 100;
const LOTE_VERIFICACAO = 120;
const FILTROS_VAZIOS = { busca: '', auditor: '', status: '', canal: '', vencimentoDe: '', vencimentoAte: '' };

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = (v) => Number(v || 0).toLocaleString('pt-BR');
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const nomeStatus = (s) => String(s || '-').replaceAll('_', ' ');
const carimbo = (f) => f.updated_at || '';
const COR_PAGAMENTO = { Paga: '#14733b', 'Paga c/ divergência': '#b78700', 'Lançada, não paga': '#315ee7', 'Lançada nos CT-es, não paga': '#b78700', 'Não lançada': '#9b1111' };
const ROTULO_ENVIO_ERP = { NAO_ENVIADA: 'Não enviada', COM_PARTIDA: 'Enviada com partida', PARTIDA_NOS_CTES: 'Enviada, partida só nos CT-es', SEM_PARTIDA: 'Enviada sem partida', VERIFICANDO: 'Não verificada' };

// Fica fora do componente para sobreviver a troca de aba; a versao da fatura (updated_at) invalida o item.
const cacheCtes = new Map();

function lerSessao() {
  try { return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || '{}'); } catch { return {}; }
}

const situacaoPrazo = (l) => {
  const dias = diasAte(l.fatura ? l.fatura.data_vencimento : l.vencimentoLista);
  if (['ENCERRADA', 'NAO_LOCALIZADA'].includes(faixaDaLinha(l)) || dias == null) return { texto: '-', cor: '#64748b' };
  if (dias < 0) return { texto: `há ${-dias}d`, cor: '#9b1111' };
  if (dias === 0) return { texto: 'hoje', cor: '#cf2f2f' };
  return { texto: `em ${dias}d`, cor: dias <= 7 ? '#c2410c' : '#14733b' };
};

const textoCtes = (l) => {
  if (!l.fatura) return '-';
  const s = situacaoCtes(l.ctes);
  if (s === 'VERIFICANDO') return '...';
  if (s === 'SO_NFSE') return `${l.ctes.nfse} NFS-e`;
  if (s === 'SEM_CTES') return 'Sem CT-e';
  return `${l.ctes.lancados}/${l.ctes.total}`;
};

const COLUNAS = [
  { id: 'numero', titulo: 'Fatura', valor: (l) => Number(String(l.numero).replace(/\D/g, '')) || 0 },
  { id: 'transportadora', titulo: 'Transportadora', valor: (l) => l.fatura?.transportadora || '' },
  { id: 'emissao', titulo: 'Emissão', valor: (l) => l.fatura?.data_emissao || '' },
  { id: 'vencimento', titulo: 'Vencimento', valor: (l) => l.fatura?.data_vencimento || l.vencimentoLista || '' },
  { id: 'valor', titulo: 'Valor', valor: valorDaLinha },
  { id: 'status', titulo: 'Status', valor: (l) => l.fatura?.status || '' },
  { id: 'auditados', titulo: 'Auditados', valor: (l) => Number(l.fatura?.ctes_auditados || 0) },
  { id: 'partida', titulo: 'Partida', valor: (l) => l.fatura?.partida || l.fatura?.lancamento_financeiro || '' },
  { id: 'erp', titulo: 'Enviado ERP', valor: (l) => l.fatura?.data_envio_erp || '' },
  { id: 'ctes', titulo: 'CT-es no SAP', valor: (l) => (l.ctes?.total ? l.ctes.lancados / l.ctes.total : -1) },
  { id: 'pagamento', titulo: 'Pagamento', valor: textoPagamentoLinha },
  { id: 'auditor', titulo: 'Auditor', valor: (l) => l.fatura?.auditor_nome || '' },
  { id: 'acao', titulo: 'Próxima ação', valor: proximaAcao },
];

function CardFiltro({ card, grupo, linhas, ativo, onClick }) {
  const qtd = linhas.length;
  const totalCtes = card.detalheCtes ? linhas.reduce((s, l) => s + (l.ctes?.semPartida?.length || 0), 0) : 0;
  const valor = card.detalheCtes ? linhas.reduce((s, l) => s + (l.ctes?.valorSemPartida || 0), 0) : linhas.reduce((s, l) => s + valorDaLinha(l), 0);
  const zerado = !qtd && !ativo;
  return (
    <button
      type="button"
      className="summary-card audit-kpi"
      aria-pressed={ativo}
      title={`${card.dica}${ativo ? ' Clique para tirar o filtro.' : ' Clique para filtrar.'}`}
      onClick={onClick}
      style={{ textAlign: 'left', font: 'inherit', borderLeft: `4px solid ${zerado ? '#cbd5e1' : card.cor}`, cursor: 'pointer', opacity: zerado ? 0.7 : 1, ...(ativo ? { boxShadow: `0 0 0 2px ${card.cor}`, background: '#f8fafc' } : {}) }}
      data-grupo={grupo}
    >
      <span>{card.rotulo}</span>
      <strong>{inteiro(qtd)}</strong>
      <small>{card.detalheCtes ? `${inteiro(totalCtes)} CT-e(s) · ${dinheiro(valor)}` : dinheiro(valor)}</small>
    </button>
  );
}

function CardResumo({ rotulo, valor, detalhe, cor, ativo = false, dica, onClick }) {
  return (
    <button
      type="button"
      className="summary-card audit-kpi"
      aria-pressed={ativo}
      title={dica}
      onClick={onClick}
      style={{ textAlign: 'left', font: 'inherit', borderLeft: `4px solid ${cor}`, cursor: 'pointer', ...(ativo ? { boxShadow: `0 0 0 2px ${cor}`, background: '#f8fafc' } : {}) }}
    >
      <span>{rotulo}</span>
      <strong>{valor}</strong>
      {detalhe && <small>{detalhe}</small>}
    </button>
  );
}

// Tela gerencial: cola uma lista de faturas (ou escolhe a transportadora) e ve o raio-x na hora.
// A fatura abre por cima desta tela (onAbrirFatura), entao fechar volta exatamente aqui.
export default function DiagnosticoFaturasPainel({ state, onState, onAbrirFatura }) {
  const salvo = useMemo(lerSessao, []);
  const [texto, setTexto] = useState(salvo.texto || '');
  const [transportadora, setTransportadora] = useState(salvo.transportadora || '');
  const [escolhidos, setEscolhidos] = useState(salvo.escolhidos || {});
  const [filtros, setFiltros] = useState({ ...FILTROS_VAZIOS, ...(salvo.filtros || {}) });
  const [ordem, setOrdem] = useState(salvo.ordem || { coluna: 'vencimento', direcao: 1 });
  const [pagina, setPagina] = useState(1);
  const [versaoCtes, setVersaoCtes] = useState(0);
  const [recarga, setRecarga] = useState(0);
  const [progresso, setProgresso] = useState(null);
  const [erroCtes, setErroCtes] = useState('');
  const [ultimaSap, setUltimaSap] = useState(null);
  const [ultimaAberta, setUltimaAberta] = useState(null);
  const [aviso, setAviso] = useState('');
  const [exportando, setExportando] = useState(false);
  const [atualizando, setAtualizando] = useState(false);

  useEffect(() => {
    try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ texto, transportadora, escolhidos, filtros, ordem })); } catch { /* sem sessionStorage: so nao lembra */ }
  }, [texto, transportadora, escolhidos, filtros, ordem]);
  useEffect(() => { carregarUltimaImportacaoSap().then(setUltimaSap).catch(() => {}); }, [recarga]);
  useEffect(() => { setPagina(1); }, [texto, transportadora, escolhidos, filtros, ordem]);

  const transportadoras = useMemo(() => {
    const nomes = new Map();
    (state.faturas || []).forEach((f) => {
      const nome = String(f.transportadora || '').trim();
      if (nome) nomes.set(nome.toUpperCase(), nome);
    });
    return [...nomes.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [state.faturas]);

  const lista = useMemo(() => parseListaFaturas(texto), [texto]);
  const temLista = lista.itens.length > 0;
  const linhasBase = useMemo(
    () => montarLinhasDiagnostico({ itens: lista.itens, faturas: state.faturas || [], transportadora }),
    [lista, state.faturas, transportadora],
  );

  const faturasBase = useMemo(() => linhasBase.filter((l) => l.fatura).map((l) => l.fatura), [linhasBase]);
  useEffect(() => {
    const pendentes = faturasBase.filter((f) => cacheCtes.get(String(f.id))?.carimbo !== carimbo(f));
    if (!pendentes.length) { setProgresso(null); return undefined; }
    let ativo = true;
    const timer = setTimeout(async () => {
      try {
        setErroCtes('');
        for (let i = 0; i < pendentes.length && ativo; i += LOTE_VERIFICACAO) {
          setProgresso({ feitas: i, total: pendentes.length });
          const lote = pendentes.slice(i, i + LOTE_VERIFICACAO);
          // eslint-disable-next-line no-await-in-loop
          const mapa = await carregarResumoCtesFaturas(lote.map((f) => f.id));
          lote.forEach((f) => cacheCtes.set(String(f.id), { carimbo: carimbo(f), resumo: mapa.get(String(f.id)) }));
          if (ativo) setVersaoCtes((v) => v + 1);
        }
        if (ativo) setProgresso(null);
      } catch (e) {
        if (ativo) { setErroCtes(e.message || String(e)); setProgresso(null); }
      }
    }, 500);
    return () => { ativo = false; clearTimeout(timer); };
  }, [faturasBase, recarga]);

  const linhas = useMemo(
    () => linhasBase.map((l) => (l.fatura ? { ...l, ctes: cacheCtes.get(String(l.fatura.id))?.resumo } : l)),
    [linhasBase, versaoCtes],
  );

  const opcoes = useMemo(() => {
    const unicos = (fn) => [...new Set(linhas.map(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return {
      auditores: unicos((l) => l.fatura && (l.fatura.auditor_nome || 'Sem auditor')),
      status: unicos((l) => l.fatura?.status),
      canais: unicos((l) => l.fatura?.canal),
    };
  }, [linhas]);

  const filtradas = useMemo(() => {
    const termos = filtros.busca.toLowerCase().split(/\s+/).filter(Boolean);
    return linhas.filter((l) => {
      const f = l.fatura;
      if (termos.length) {
        const alvo = `${l.numero} ${f?.transportadora || ''} ${f?.auditor_nome || ''}`.toLowerCase();
        if (!termos.every((t) => alvo.includes(t))) return false;
      }
      if (filtros.auditor && (!f || (f.auditor_nome || 'Sem auditor') !== filtros.auditor)) return false;
      if (filtros.status && f?.status !== filtros.status) return false;
      if (filtros.canal && f?.canal !== filtros.canal) return false;
      const venc = String(f?.data_vencimento || l.vencimentoLista || '').slice(0, 10);
      if (filtros.vencimentoDe && (!venc || venc < filtros.vencimentoDe)) return false;
      if (filtros.vencimentoAte && (!venc || venc > filtros.vencimentoAte)) return false;
      return true;
    });
  }, [linhas, filtros]);

  // Um recorte so para a tela inteira: cards, totais e lista sempre mostram os mesmos numeros.
  const recorte = useMemo(() => filtrarPorCards(filtradas, escolhidos), [filtradas, escolhidos]);

  const grupos = useMemo(() => GRUPOS_DIAGNOSTICO
    .filter((g) => temLista || !g.soComLista)
    .map((g) => ({ ...g, cards: g.cards.filter((c) => !c.oculto).map((c) => ({ ...c, linhas: recorte.filter(c.teste) })) })), [recorte, temLista]);

  const resultado = useMemo(() => {
    const coluna = COLUNAS.find((c) => c.id === ordem.coluna) || COLUNAS[3];
    const vazio = (v) => v === '' || v == null;
    return [...recorte].sort((a, b) => {
      const va = coluna.valor(a);
      const vb = coluna.valor(b);
      if (vazio(va) || vazio(vb)) return vazio(va) - vazio(vb);
      const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR');
      return r * ordem.direcao;
    });
  }, [recorte, ordem]);

  const totais = useMemo(() => {
    // Os valores do topo sao sempre do recorte atual: com "Em aberto" selecionado, "Pago" fica zerado.
    const parte = (fn) => {
      const selecionadas = resultado.filter(fn);
      const semValor = selecionadas.filter((l) => !valorDaLinha(l)).length;
      return {
        valor: selecionadas.reduce((s, l) => s + valorDaLinha(l), 0),
        detalhe: `${inteiro(selecionadas.length)} fatura(s)${semValor ? ` · ${inteiro(semValor)} sem valor` : ''}`,
      };
    };
    return {
      total: parte(() => true),
      aberto: parte((l) => situacaoPagamentoLinha(l) === 'ABERTA'),
      vencido: parte((l) => faixaDaLinha(l) === 'VENCIDA'),
      aVencer: parte((l) => FAIXAS_A_VENCER.includes(faixaDaLinha(l))),
      pago: parte((l) => situacaoPagamentoLinha(l).startsWith('PAGA')),
    };
  }, [resultado]);

  const totalPaginas = Math.max(1, Math.ceil(resultado.length / TAM_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = resultado.slice((paginaAtual - 1) * TAM_PAGINA, paginaAtual * TAM_PAGINA);
  const temFiltro = Object.values(escolhidos).some(Boolean) || Object.values(filtros).some(Boolean);

  const alternarCard = (grupo, card) => setEscolhidos((atual) => ({ ...atual, [grupo]: atual[grupo] === card ? '' : card }));
  const limparFiltros = () => { setEscolhidos({}); setFiltros(FILTROS_VAZIOS); };
  const limparTudo = () => { limparFiltros(); setTexto(''); setTransportadora(''); };
  const mudarFiltro = (campo) => (e) => setFiltros((atual) => ({ ...atual, [campo]: e.target.value }));
  const ordenarPor = (coluna) => setOrdem((atual) => (atual.coluna === coluna ? { coluna, direcao: -atual.direcao } : { coluna, direcao: 1 }));
  const abrir = (l) => { if (!l.fatura) return; setUltimaAberta(l.id); onAbrirFatura(l.fatura); };
  // Busca faturas e partidas de novo no banco: importacoes feitas depois de abrir a tela entram aqui.
  const atualizarDados = async () => {
    setAtualizando(true);
    setAviso('');
    try {
      const { faturas } = await carregarPlataformaAuditoria();
      cacheCtes.clear();
      onState((atual) => ({ ...atual, faturas }));
      setVersaoCtes((v) => v + 1);
      setRecarga((v) => v + 1);
    } catch (e) { setAviso(`Erro ao atualizar: ${e.message || e}`); } finally { setAtualizando(false); }
  };

  const descricaoFiltros = () => {
    const cards = GRUPOS_DIAGNOSTICO.filter((g) => escolhidos[g.id]).map((g) => [g.titulo, g.cards.find((c) => c.id === escolhidos[g.id])?.rotulo || '']);
    const campos = [['Busca', filtros.busca], ['Auditor', filtros.auditor], ['Status', nomeStatus(filtros.status)], ['Canal', filtros.canal], ['Vencimento de', dataBr(filtros.vencimentoDe)], ['Vencimento até', dataBr(filtros.vencimentoAte)]]
      .filter(([, v]) => v && v !== '-');
    return [['Transportadora', transportadora || 'Todas'], ['Números colados', temLista ? String(lista.itens.length) : 'Nenhum'], ...cards, ...campos];
  };
  const hojeArquivo = new Date().toLocaleDateString('sv-SE');

  const exportarFaturas = async () => {
    setExportando(true);
    try {
      await exportarExcelFormatado({
        nomeArquivo: `diagnostico-faturas-${hojeArquivo}.xlsx`,
        aba: 'Faturas',
        colunas: [
          { titulo: 'Fatura', largura: 14 }, { titulo: 'Na plataforma', largura: 14, tipo: 'centro' }, { titulo: 'Transportadora', largura: 34 }, { titulo: 'CNPJ', largura: 18 },
          { titulo: 'Emissão', largura: 12, tipo: 'data' }, { titulo: 'Vencimento', largura: 12, tipo: 'data' }, { titulo: 'Dias p/ vencer', largura: 10, tipo: 'inteiro' },
          { titulo: 'Valor plataforma', largura: 16, tipo: 'moeda' }, { titulo: 'Valor da lista', largura: 16, tipo: 'moeda' }, { titulo: 'Vencimento da lista', largura: 12, tipo: 'data' },
          { titulo: 'Status', largura: 24 }, { titulo: 'CT-es auditados', largura: 10, tipo: 'inteiro' }, { titulo: 'CT-es totais', largura: 10, tipo: 'inteiro' },
          { titulo: 'Fatura lançada', largura: 10, tipo: 'centro' }, { titulo: 'Partida', largura: 14 }, { titulo: 'Lançamento financeiro', largura: 14 }, { titulo: 'Enviado ERP', largura: 12, tipo: 'data' }, { titulo: 'Situação envio ERP', largura: 22 },
          { titulo: 'CT-es com partida', largura: 10, tipo: 'inteiro' }, { titulo: 'CT-es sem partida', largura: 10, tipo: 'inteiro' }, { titulo: 'Valor sem partida', largura: 16, tipo: 'moeda' },
          { titulo: 'Pagamento', largura: 18 }, { titulo: 'Data pagamento', largura: 12, tipo: 'data' }, { titulo: 'Valor pago', largura: 16, tipo: 'moeda' }, { titulo: 'Auditor', largura: 26 }, { titulo: 'Próxima ação', largura: 28 }, { titulo: 'Observação', largura: 34 },
        ],
        linhas: resultado.map((l) => {
          const f = l.fatura;
          const observacao = !f && l.outrasTransportadoras?.length ? `Existe em: ${l.outrasTransportadoras.join(', ')}` : l.repetida > 1 ? `Número em ${l.repetida} faturas ativas` : '';
          return [
            String(l.numero), f ? 'Sim' : 'Não', f?.transportadora || '', f?.cnpj_transportadora || '', f?.data_emissao || '', f?.data_vencimento || '', (f?.data_vencimento || l.vencimentoLista) ? diasAte(f?.data_vencimento || l.vencimentoLista) ?? '' : '',
            f ? Number(f.valor_fatura || 0) : '', l.valorLista ?? '', l.vencimentoLista || '', f ? nomeStatus(f.status) : '', f ? Number(f.ctes_auditados || 0) : '', f ? Number(f.ctes_totais || 0) : '',
            f ? (faturaLancada(f) ? 'Sim' : 'Não') : '', f?.partida || '', f?.lancamento_financeiro || '', f?.data_envio_erp || '', f ? ROTULO_ENVIO_ERP[situacaoEnvioErp(l)] : '', l.ctes ? l.ctes.lancados : '', l.ctes ? l.ctes.semPartida.length : '', l.ctes ? l.ctes.valorSemPartida : '',
            textoPagamentoLinha(l), f?.data_pagamento || '', f?.valor_pago != null ? Number(f.valor_pago) : '', f?.auditor_nome || '', proximaAcao(l), observacao,
          ];
        }),
        resumo: descricaoFiltros(),
      });
    } catch (e) { setAviso(`Erro ao exportar: ${e.message || e}`); } finally { setExportando(false); }
  };

  const ctesSemPartida = useMemo(() => resultado.flatMap((l) => (l.ctes?.semPartida || []).map((c) => ({ l, c }))), [resultado]);
  const exportarCtes = async () => {
    setExportando(true);
    try {
      await exportarExcelFormatado({
        nomeArquivo: `ctes-sem-partida-${hojeArquivo}.xlsx`,
        aba: 'CT-es sem partida',
        colunas: [
          { titulo: 'Fatura', largura: 14 }, { titulo: 'Transportadora', largura: 34 }, { titulo: 'Vencimento fatura', largura: 12, tipo: 'data' }, { titulo: 'Número CT-e', largura: 14 }, { titulo: 'Série', largura: 8, tipo: 'centro' },
          { titulo: 'Chave CT-e', largura: 48 }, { titulo: 'Valor frete', largura: 16, tipo: 'moeda' }, { titulo: 'Situação', largura: 18 },
        ],
        linhas: ctesSemPartida.map(({ l, c }) => [String(l.numero), l.fatura.transportadora || '', l.fatura.data_vencimento || '', String(c.numero_cte || ''), String(c.serie_cte || ''), String(c.chave_cte || ''), c.valor_frete, c.estornado ? 'Estornado no SAP' : 'Sem partida']),
        resumo: descricaoFiltros(),
      });
    } catch (e) { setAviso(`Erro ao exportar: ${e.message || e}`); } finally { setExportando(false); }
  };
  const copiarNumeros = async () => {
    try {
      await navigator.clipboard.writeText(resultado.map((l) => l.numero).join('\n'));
      setAviso(`${inteiro(resultado.length)} número(s) copiado(s).`);
    } catch { setAviso('O navegador não permitiu copiar.'); }
  };

  const cabecalhoCel = (c) => (
    <th key={c.id} onClick={() => ordenarPor(c.id)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} aria-sort={ordem.coluna === c.id ? (ordem.direcao === 1 ? 'ascending' : 'descending') : undefined}>
      {c.titulo}{ordem.coluna === c.id ? (ordem.direcao === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <>
      <div className="panel-card" style={{ marginBottom: 14 }}>
        <div className="panel-title audit-table-title">Diagnóstico de faturas</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 8, flex: '1 1 220px', maxWidth: 320 }}>
            <label className="field">Transportadora
              <select value={transportadora} onChange={(e) => setTransportadora(e.target.value)}>
                <option value="">Todas</option>
                {transportadoras.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <button type="button" className="btn-secondary" onClick={limparTudo} disabled={!texto && !transportadora && !temFiltro}>Limpar tudo</button>
          </div>
          <label className="field" style={{ flex: '999 1 260px', minWidth: 0 }}>Lista de faturas (cole do Excel ou e-mail; vencimento e valor são opcionais)
            <textarea
              rows={4}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={'Um número por linha, ou a tabela com as colunas Fatura, Vencimento e Valor.\nSem lista, mostra todas as faturas da transportadora escolhida.'}
              spellCheck={false}
            />
          </label>
        </div>
        {(temLista || transportadora) && (
          <div className="compact" style={{ marginTop: 8, color: '#475569', fontSize: 13 }}>
            {temLista ? `${inteiro(lista.itens.length)} número(s) lido(s)${lista.repetidosNaLista ? ` · ${inteiro(lista.repetidosNaLista)} repetido(s) na lista ignorado(s)` : ''}` : `Todas as faturas de ${transportadora}`}
            {progresso ? ` · Verificando CT-es no SAP: ${inteiro(progresso.feitas)} de ${inteiro(progresso.total)} faturas...` : ''}
            {ultimaSap ? ` · Partidas de CT-e conforme o relatório SAP importado (último lançamento em ${dataBr(ultimaSap)}).` : ''}
          </div>
        )}
        {erroCtes && <p className="error-text" style={{ marginTop: 8 }}>Não foi possível verificar os CT-es no SAP: {erroCtes}</p>}
      </div>

      {!linhas.length ? (
        <div className="hint-box">Cole uma lista de faturas ou escolha uma transportadora para ver o diagnóstico.</div>
      ) : (
        <>
          <div className="summary-strip audit-summary-grid" style={{ marginBottom: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <CardResumo rotulo="Faturas no recorte" valor={inteiro(resultado.length)} detalhe={`de ${inteiro(linhas.length)}`} cor="#071d49" dica="Clique para mostrar todas (tira os filtros de card e de pesquisa)." onClick={limparFiltros} />
            <CardResumo rotulo="Valor total" valor={dinheiro(totais.total.valor)} detalhe={totais.total.detalhe} cor="#071d49" dica="Clique para mostrar todas (tira os filtros de card e de pesquisa)." onClick={limparFiltros} />
            <CardResumo rotulo="Em aberto" valor={dinheiro(totais.aberto.valor)} detalhe={totais.aberto.detalhe} cor="#315ee7" ativo={escolhidos.pagamento === 'abertas'} dica="Clique para ver as faturas não pagas." onClick={() => alternarCard('pagamento', 'abertas')} />
            <CardResumo rotulo="Vencido" valor={dinheiro(totais.vencido.valor)} detalhe={totais.vencido.detalhe} cor="#9b1111" ativo={escolhidos.vencimento === 'vencidas'} dica="Clique para ver as faturas vencidas e não pagas." onClick={() => alternarCard('vencimento', 'vencidas')} />
            <CardResumo rotulo="A vencer" valor={dinheiro(totais.aVencer.valor)} detalhe={totais.aVencer.detalhe} cor="#e67e22" ativo={escolhidos.vencimento === 'a_vencer'} dica="Clique para ver as faturas não pagas que ainda vão vencer." onClick={() => alternarCard('vencimento', 'a_vencer')} />
            <CardResumo rotulo="Pago" valor={dinheiro(totais.pago.valor)} detalhe={totais.pago.detalhe} cor="#14733b" ativo={escolhidos.pagamento === 'pagas_todas'} dica="Clique para ver as faturas pagas, com ou sem divergência." onClick={() => alternarCard('pagamento', 'pagas_todas')} />

          </div>

          {grupos.map((g) => (
            <section key={g.id} style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, margin: '0 0 6px', color: '#475569' }}>{g.titulo}</h3>
              <div className="summary-strip audit-summary-grid">
                {g.cards.map((c) => <CardFiltro key={c.id} card={c} grupo={g.id} linhas={c.linhas} ativo={escolhidos[g.id] === c.id} onClick={() => alternarCard(g.id, c.id)} />)}
              </div>
            </section>
          ))}

          <div className="panel-card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <label className="field">Buscar<input value={filtros.busca} onChange={mudarFiltro('busca')} placeholder="Número, transportadora, auditor" /></label>
              <label className="field">Auditor<select value={filtros.auditor} onChange={mudarFiltro('auditor')}><option value="">Todos</option>{opcoes.auditores.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
              <label className="field">Status<select value={filtros.status} onChange={mudarFiltro('status')}><option value="">Todos</option>{opcoes.status.map((s) => <option key={s} value={s}>{nomeStatus(s)}</option>)}</select></label>
              <label className="field">Canal<select value={filtros.canal} onChange={mudarFiltro('canal')}><option value="">Todos</option>{opcoes.canais.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              <label className="field">Vencimento de<input type="date" value={filtros.vencimentoDe} onChange={mudarFiltro('vencimentoDe')} /></label>
              <label className="field">Vencimento até<input type="date" value={filtros.vencimentoAte} onChange={mudarFiltro('vencimentoAte')} /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
              <button type="button" className="btn-primary" disabled={!resultado.length || exportando} onClick={exportarFaturas}>Exportar faturas ({inteiro(resultado.length)})</button>
              <button type="button" className="btn-secondary" disabled={!ctesSemPartida.length || exportando} onClick={exportarCtes}>Exportar CT-es sem partida ({inteiro(ctesSemPartida.length)})</button>
              <button type="button" className="btn-secondary" disabled={!resultado.length} onClick={copiarNumeros}>Copiar números</button>
              <button type="button" className="btn-secondary" disabled={Boolean(progresso) || atualizando} onClick={atualizarDados} title="Busca de novo as faturas, os CT-es e as partidas no banco">{atualizando ? 'Atualizando...' : '↻ Atualizar dados'}</button>
              {temFiltro && <button type="button" className="btn-secondary" onClick={limparFiltros}>Limpar filtros</button>}
              {aviso && <span className="compact" role="status">{aviso}</span>}
            </div>
          </div>

          <div className="table-card">
            <div className="sim-analise-tabela-wrap">
              <table className="sim-analise-tabela">
                <thead><tr>{COLUNAS.map(cabecalhoCel)}</tr></thead>
                <tbody>
                  {visiveis.map((l) => {
                    const f = l.fatura;
                    const prazo = situacaoPrazo(l);
                    const situacao = situacaoCtes(l.ctes);
                    const corCtes = situacao === 'TODOS' ? '#14733b' : situacao === 'PARCIAL' ? '#c2410c' : situacao === 'NENHUM' ? '#9b1111' : '#64748b';
                    return (
                      <tr key={l.id} onClick={() => abrir(l)} style={{ cursor: f ? 'pointer' : 'default', ...(ultimaAberta === l.id ? { background: '#eaf1ff' } : {}) }} title={f ? 'Abrir a fatura' : undefined}>
                        <td>
                          {f ? <button type="button" className="link-button" onClick={(e) => { e.stopPropagation(); abrir(l); }}>{l.numero}</button> : <strong>{l.numero}</strong>}
                          {l.repetida > 1 && <div style={{ fontSize: 11, color: '#b78700' }}>{l.repetida} faturas</div>}
                        </td>
                        <td>{f?.transportadora || (l.outrasTransportadoras?.length ? <span style={{ color: '#b45309' }}>Existe em: {l.outrasTransportadoras.join(', ')}</span> : <span style={{ color: '#9b1111' }}>Não localizada</span>)}</td>
                        <td>{dataBr(f?.data_emissao)}</td>
                        <td>{dataBr(f?.data_vencimento || l.vencimentoLista)}<div style={{ fontSize: 11, fontWeight: 700, color: prazo.cor }}>{prazo.texto}</div></td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {dinheiro(valorDaLinha(l))}
                          {l.diferencaLista != null && Math.abs(l.diferencaLista) > 0.05 && <div style={{ fontSize: 11, color: '#c2410c' }}>Lista: {dinheiro(l.valorLista)}</div>}
                        </td>
                        <td>{f ? nomeStatus(f.status) : '-'}</td>
                        <td>{f ? `${Number(f.ctes_auditados || 0)}/${Number(f.ctes_totais || 0)}` : '-'}</td>
                        <td>{f ? (f.partida || f.lancamento_financeiro || (situacao === 'TODOS' ? <span style={{ color: '#b78700' }} title="Todos os CT-es têm partida no SAP, mas não há partida pelo número da fatura.">Nos CT-es</span> : '-')) : '-'}</td>
                        <td style={situacaoEnvioErp(l) === 'SEM_PARTIDA' ? { color: '#9b1111', fontWeight: 700 } : undefined}>{dataBr(f?.data_envio_erp)}</td>
                        <td style={{ color: corCtes, fontWeight: 700 }}>{textoCtes(l)}</td>
                        <td style={{ color: COR_PAGAMENTO[textoPagamentoLinha(l)], fontWeight: 600 }}>{textoPagamentoLinha(l)}</td>
                        <td>{f ? (f.auditor_nome || 'Sem auditor') : '-'}</td>
                        <td>{proximaAcao(l)}</td>
                      </tr>
                    );
                  })}
                  {!visiveis.length && <tr><td colSpan={COLUNAS.length}>Nenhuma fatura neste filtro.</td></tr>}
                </tbody>
              </table>
            </div>
            {totalPaginas > 1 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', padding: 10 }}>
                <button type="button" className="btn-secondary" disabled={paginaAtual <= 1} onClick={() => setPagina(paginaAtual - 1)}>Anterior</button>
                <span className="compact">Página {paginaAtual} de {totalPaginas}</span>
                <button type="button" className="btn-secondary" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina(paginaAtual + 1)}>Próxima</button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
