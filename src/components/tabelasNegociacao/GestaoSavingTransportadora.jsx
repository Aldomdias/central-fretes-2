import React, { useEffect, useMemo, useState } from 'react';
import { gestaoStyles } from './GestaoStyles';
import { listarRealizadoLocalCtesParaSimulacao, listarTransportadorasRealizadoReajustes } from '../../services/freteDatabaseService';
import { calcularJanelasSaving, calcularSavingPorRotaFaixa, rotuloRota, MESES_BASE_SAVING_PADRAO } from '../../utils/savingsPosAprovacaoNegociacao';

const CANAIS = [['', 'Todos os canais'], ['ATACADO', 'Atacado'], ['B2C', 'B2C']];
const OPCOES_MESES_BASE = [1, 2, 3, 6, 12];
const LIMITE_LINHAS_TELA = 200;
const CACHE_PREFIXO = 'cf_saving_transportadora_v1';

// Persistência local (sem migration): guarda o último cálculo de cada linha no
// navegador, por id + meses de histórico. Recalcular grava por cima da mesma
// chave, então sempre reflete o último resultado.
function chaveCache(id, mesesBase, dataReferencia) {
  return `${CACHE_PREFIXO}:${mesesBase}:${dataReferencia}:${id}`;
}
function salvarCache(id, mesesBase, dataReferencia, dados) {
  try { window.localStorage.setItem(chaveCache(id, mesesBase, dataReferencia), JSON.stringify({ dados, salvoEm: new Date().toISOString() })); } catch { /* ignore */ }
}
function lerCache(id, mesesBase, dataReferencia) {
  try {
    const bruto = window.localStorage.getItem(chaveCache(id, mesesBase, dataReferencia));
    return bruto ? JSON.parse(bruto) : null;
  } catch { return null; }
}

function moeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function percentual(v) {
  return `${(Number(v || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
function dataBr(v) {
  return v ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
}
function hojeIso() {
  return new Date().toISOString().slice(0, 10);
}
function fimDoMes(dataIso) {
  const [ano, mes] = String(dataIso || '').slice(0, 7).split('-').map(Number);
  if (!ano || !mes) return '';
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const iso = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  return iso > hojeIso() ? hojeIso() : iso;
}

function tituloCase(v = '') {
  return String(v || '').trim().toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}
function rotuloOrigemCidade(row = {}) {
  const cidade = tituloCase(row.cidadeOrigem || '');
  const uf = String(row.ufOrigem || '').trim().toUpperCase();
  if (!cidade && !uf) return 'Sem origem';
  return cidade ? `${cidade}${uf ? '/' + uf : ''}` : uf;
}
function rotuloOrigemEstado(row = {}) {
  const uf = String(row.ufOrigem || '').trim().toUpperCase();
  return uf || 'Sem UF';
}

// Mesma ideia do saving por rota+faixa, mas agrupando só pela origem (somando
// todos os destinos) — pra responder "Itajaí da Alfa tava tanto e agora tanto",
// sem quebrar em faixa de peso nem em rota completa. `rotular` decide o nível:
// cidade/UF (rotuloOrigemCidade) ou só UF (rotuloOrigemEstado).
function calcularSavingPorOrigem(linhasBase = [], linhasAtual = [], rotular = rotuloOrigemCidade) {
  function agrupar(rows) {
    const mapa = new Map();
    rows.forEach((row) => {
      const chave = rotular(row);
      const atual = mapa.get(chave) || { origem: chave, ctes: 0, valorCte: 0, valorNF: 0 };
      atual.ctes += 1;
      atual.valorCte += Number(row.valorCte || 0) || 0;
      atual.valorNF += Number(row.valorNF || 0) || 0;
      mapa.set(chave, atual);
    });
    return mapa;
  }
  const gruposBase = agrupar(linhasBase);
  const gruposAtual = agrupar(linhasAtual);
  const linhas = [];
  gruposAtual.forEach((atual, chave) => {
    const base = gruposBase.get(chave);
    const semHistorico = !base || base.valorNF <= 0 || atual.valorNF <= 0;
    if (semHistorico) {
      linhas.push({
        origem: chave, ctesBase: base?.ctes || 0, ctesAtual: atual.ctes,
        valorNFAtual: atual.valorNF, pctBase: null, pctAtual: atual.valorNF > 0 ? atual.valorCte / atual.valorNF : null,
        saving: null, semHistorico: true,
      });
      return;
    }
    const pctBase = base.valorCte / base.valorNF;
    const pctAtual = atual.valorCte / atual.valorNF;
    linhas.push({
      origem: chave, ctesBase: base.ctes, ctesAtual: atual.ctes, valorNFAtual: atual.valorNF,
      pctBase, pctAtual, saving: (pctBase - pctAtual) * atual.valorNF, semHistorico: false,
    });
  });
  linhas.sort((a, b) => (b.saving ?? -Infinity) - (a.saving ?? -Infinity));
  return linhas;
}

// Soma simples de todos os CT-es de cada janela (não por rota+faixa) — é o número
// "oficial" de antes x depois, igual ao usado na tabela por origem.
function calcularTotais(linhasBase = [], linhasAtual = []) {
  const somar = (rows, campo) => rows.reduce((acc, r) => acc + (Number(r[campo]) || 0), 0);
  const valorCteBaseTotal = somar(linhasBase, 'valorCte');
  const valorNFBaseTotal = somar(linhasBase, 'valorNF');
  const valorCteAtualTotal = somar(linhasAtual, 'valorCte');
  const valorNFAtualTotal = somar(linhasAtual, 'valorNF');
  const pctBaseTotal = valorNFBaseTotal > 0 ? valorCteBaseTotal / valorNFBaseTotal : 0;
  const pctAtualTotal = valorNFAtualTotal > 0 ? valorCteAtualTotal / valorNFAtualTotal : 0;
  const variacaoPct = pctBaseTotal > 0 ? (pctBaseTotal - pctAtualTotal) / pctBaseTotal : 0;
  const savingTotal = (pctBaseTotal - pctAtualTotal) * valorNFAtualTotal;
  return { pctBaseTotal, pctAtualTotal, variacaoPct, savingTotal, ctesBase: linhasBase.length, ctesAtual: linhasAtual.length };
}

function pesoLinha(row = {}) {
  return Number(row.peso ?? row.pesoDeclarado ?? row.pesoCubado ?? 0) || 0;
}

// Compara o comportamento da transportadora por rota (origem → destino) entre as
// duas janelas: quais rotas ela passou a carregar (novas), quais deixou de carregar
// (perdidas), e como mudou o ticket médio (valorNF/CT-e) e o peso médio das que
// continuam em comum — responde "o que mudou na malha dela", não só "o % mudou".
function calcularComportamentoRotas(linhasBase = [], linhasAtual = []) {
  function agrupar(rows) {
    const mapa = new Map();
    rows.forEach((row) => {
      const rota = rotuloRota(row);
      const atual = mapa.get(rota) || { rota, ctes: 0, valorNF: 0, valorCte: 0, peso: 0 };
      atual.ctes += 1;
      atual.valorNF += Number(row.valorNF || 0) || 0;
      atual.valorCte += Number(row.valorCte || 0) || 0;
      atual.peso += pesoLinha(row);
      mapa.set(rota, atual);
    });
    return mapa;
  }
  const gruposBase = agrupar(linhasBase);
  const gruposAtual = agrupar(linhasAtual);
  const rotas = new Set([...gruposBase.keys(), ...gruposAtual.keys()]);
  const linhas = [];
  rotas.forEach((rota) => {
    const base = gruposBase.get(rota);
    const atual = gruposAtual.get(rota);
    const status = !base ? 'nova' : !atual ? 'perdida' : 'comum';
    const ticketBase = base && base.ctes > 0 ? base.valorNF / base.ctes : null;
    const ticketAtual = atual && atual.ctes > 0 ? atual.valorNF / atual.ctes : null;
    const pesoMedioBase = base && base.ctes > 0 ? base.peso / base.ctes : null;
    const pesoMedioAtual = atual && atual.ctes > 0 ? atual.peso / atual.ctes : null;
    linhas.push({
      rota, status,
      ctesBase: base?.ctes || 0, ctesAtual: atual?.ctes || 0,
      valorNFBase: base?.valorNF || 0, valorNFAtual: atual?.valorNF || 0,
      ticketBase, ticketAtual,
      variacaoTicket: ticketBase && ticketAtual ? (ticketAtual - ticketBase) / ticketBase : null,
      pesoMedioBase, pesoMedioAtual,
      variacaoPeso: pesoMedioBase && pesoMedioAtual ? (pesoMedioAtual - pesoMedioBase) / pesoMedioBase : null,
    });
  });
  linhas.sort((a, b) => {
    const ordemStatus = { nova: 0, perdida: 1, comum: 2 };
    if (ordemStatus[a.status] !== ordemStatus[b.status]) return ordemStatus[a.status] - ordemStatus[b.status];
    return (b.valorNFAtual || b.valorNFBase) - (a.valorNFAtual || a.valorNFBase);
  });
  const resumo = {
    novas: linhas.filter((l) => l.status === 'nova').length,
    perdidas: linhas.filter((l) => l.status === 'perdida').length,
    comuns: linhas.filter((l) => l.status === 'comum').length,
    valorNFRotasNovas: linhas.filter((l) => l.status === 'nova').reduce((acc, l) => acc + l.valorNFAtual, 0),
    valorNFRotasPerdidas: linhas.filter((l) => l.status === 'perdida').reduce((acc, l) => acc + l.valorNFBase, 0),
  };
  return { linhas, resumo };
}

const STATUS_ELEGIVEIS_LISTA = ['APROVADA_GESTOR', 'PUBLICADA_OFICIAL'];

// Lista automática: reaproveita o mesmo cadastro do "Savings pós-aprovação"
// (transportadora + origem + canal + data de referência de cada negociação
// aprovada), mas calculando antes x depois da própria transportadora, não
// contra o mercado. Assim não depende de digitar nome/origem à mão e evita
// escolher a entidade errada (ex.: "LTDA" x "EIRELI") no seletor livre.
function GestaoSavingTransportadoraLista({ tabelas = [], onErro }) {
  const [resultados, setResultados] = useState({});
  const [carregando, setCarregando] = useState({});
  const [calculandoTodas, setCalculandoTodas] = useState(false);
  const [erros, setErros] = useState({});
  const [expandido, setExpandido] = useState({});
  const [agrupamento, setAgrupamento] = useState('origem'); // 'origem' | 'transportadora'
  const [mesesBase, setMesesBase] = useState(MESES_BASE_SAVING_PADRAO);
  const [dataCorteGlobal, setDataCorteGlobal] = useState('');
  const [dataFimGlobal, setDataFimGlobal] = useState(''); // fecha o "depois" num mês específico, em vez de ir até hoje
  const [nomesRealizado, setNomesRealizado] = useState([]);
  const [carregandoNomes, setCarregandoNomes] = useState(false);
  const [extras, setExtras] = useState([]); // transportadoras incluídas manualmente (sem negociação cadastrada)
  const [novaTransportadora, setNovaTransportadora] = useState('');
  const [novaOrigem, setNovaOrigem] = useState('');
  const [novaData, setNovaData] = useState('');
  const [novoCanal, setNovoCanal] = useState('');
  const [somenteComHistorico, setSomenteComHistorico] = useState(false);
  const [canalFiltro, setCanalFiltro] = useState('TODOS');
  const [savingSinalLaudo, setSavingSinalLaudo] = useState('TODOS'); // 'TODOS' | 'REDUZIU' | 'AUMENTOU'
  const [savingMinimoLaudo, setSavingMinimoLaudo] = useState('');

  useEffect(() => {
    setCarregandoNomes(true);
    listarTransportadorasRealizadoReajustes()
      .then(setNomesRealizado)
      .catch(() => {})
      .finally(() => setCarregandoNomes(false));
  }, []);

  const negociacoesDasTabelas = useMemo(() => {
    const mapa = new Map();
    (tabelas || [])
      .filter((t) => STATUS_ELEGIVEIS_LISTA.includes(t.status_gestao) && t.transportadora && t.aprovado_em)
      .forEach((t) => {
        const origemChave = String(t.origem_realizado_saving || t.origem || '').trim();
        const canalChave = String(t.canal || '').trim().toUpperCase();
        const chave = `${t.transportadora}||${origemChave}||${canalChave}`;
        const dataReferencia = String(t.data_referencia_saving || t.aprovado_em).slice(0, 10);
        const vinculo = Array.isArray(t.vinculo_transportadoras_saving) && t.vinculo_transportadoras_saving.length
          ? t.vinculo_transportadoras_saving
          : [t.transportadora];
        const existente = mapa.get(chave);
        if (existente && existente.dataReferencia >= dataReferencia) return;
        mapa.set(chave, {
          id: chave,
          transportadora: t.transportadora,
          transportadorasExatas: vinculo,
          origem: origemChave,
          canal: canalChave,
          dataReferencia,
          manual: false,
        });
      });
    return mapa;
  }, [tabelas]);

  // Junta as negociações cadastradas com as transportadoras incluídas manualmente
  // (ex.: Alfa sem negociação aprovada no sistema) — a manual sobrescreve se tiver
  // a mesma chave, já que foi ajustada de propósito pelo usuário.
  const negociacoesPorOrigem = useMemo(() => {
    const mapa = new Map(negociacoesDasTabelas);
    extras.forEach((item) => mapa.set(item.id, item));
    return [...mapa.values()].sort((a, b) => a.transportadora.localeCompare(b.transportadora, 'pt-BR') || a.origem.localeCompare(b.origem, 'pt-BR'));
  }, [negociacoesDasTabelas, extras]);

  function adicionarTransportadora() {
    if (!novaTransportadora) return;
    if (!novaData) { if (typeof onErro === 'function') onErro('Informe a data de corte pra incluir a transportadora.'); return; }
    const origemChave = novaOrigem.trim();
    const canalChave = novoCanal.trim().toUpperCase();
    const id = `manual::${novaTransportadora}||${origemChave}||${canalChave}`;
    setExtras((prev) => [...prev.filter((e) => e.id !== id), {
      id, transportadora: novaTransportadora, transportadorasExatas: [novaTransportadora],
      origem: origemChave, canal: canalChave, dataReferencia: novaData, manual: true,
    }]);
    setNovaTransportadora(''); setNovaOrigem(''); setNovaData(''); setNovoCanal('');
  }

  function removerExtra(id) {
    setExtras((prev) => prev.filter((e) => e.id !== id));
    setResultados((prev) => { const next = { ...prev }; delete next[id]; return next; });
  }

  // Uma linha por transportadora, juntando todas as origens/canais/vínculos dela.
  // A data de corte usada é a da negociação mais recente (a última mudança de
  // frete conhecida) — antes/depois vira "desde a última negociação", olhando
  // tudo que ela roda, não só a origem de uma negociação específica.
  const negociacoesPorTransportadora = useMemo(() => {
    const mapa = new Map();
    negociacoesPorOrigem.forEach((item) => {
      const existente = mapa.get(item.transportadora);
      if (!existente) {
        mapa.set(item.transportadora, {
          id: item.transportadora,
          transportadora: item.transportadora,
          transportadorasExatas: [...item.transportadorasExatas],
          origem: '',
          canal: '',
          dataReferencia: item.dataReferencia,
        });
        return;
      }
      item.transportadorasExatas.forEach((nome) => {
        if (!existente.transportadorasExatas.includes(nome)) existente.transportadorasExatas.push(nome);
      });
      if (item.dataReferencia > existente.dataReferencia) existente.dataReferencia = item.dataReferencia;
    });
    return [...mapa.values()].sort((a, b) => a.transportadora.localeCompare(b.transportadora, 'pt-BR'));
  }, [negociacoesPorOrigem]);

  const negociacoesAgrupadasBase = agrupamento === 'transportadora' ? negociacoesPorTransportadora : negociacoesPorOrigem;

  // Data de corte global (substitui a referência de todas as linhas) e, no modo
  // "por transportadora", o canal também vira um override: como ali o item já
  // nasce agregado (canal ''), escolher Atacado/B2C precisa entrar na consulta
  // em vez de tentar filtrar uma lista que não tem canal nenhuma linha pra bater.
  // O id ganha o sufixo do canal pra não colidir em cache com o resultado "geral".
  const negociacoesAgrupadas = useMemo(() => {
    let base = negociacoesAgrupadasBase;
    if (dataCorteGlobal) {
      base = base.map((item) => ({ ...item, dataReferencia: dataCorteGlobal, fimOverride: dataFimGlobal || '' }));
    }
    if (agrupamento === 'transportadora' && canalFiltro !== 'TODOS') {
      base = base.map((item) => ({ ...item, canal: canalFiltro, id: `${item.id}::${canalFiltro}` }));
    }
    return base;
  }, [dataCorteGlobal, dataFimGlobal, negociacoesAgrupadasBase, agrupamento, canalFiltro]);

  // No modo "por origem", cada linha já é de um canal específico — aí o filtro
  // esconde as que não batem (não precisa de override, o dado já existe assim).
  const negociacoesTodas = (agrupamento === 'transportadora' || canalFiltro === 'TODOS')
    ? negociacoesAgrupadas
    : negociacoesAgrupadas.filter((item) => item.canal === canalFiltro);

  // "Só com histórico" esconde quem ainda não foi calculado ou deu erro (sem
  // realizado antes/depois pra comparar) — sobra só quem tem uma comparação real.
  const negociacoes = somenteComHistorico
    ? negociacoesTodas.filter((item) => resultados[item.id] && !erros[item.id])
    : negociacoesTodas;

  // Muda os meses de histórico troca a janela — hidrata do cache local (por
  // item + mesesBase) em vez de simplesmente zerar, então um recálculo antigo
  // com essa mesma janela não se perde ao trocar de aba e voltar.
  useEffect(() => {
    const hidratado = {};
    negociacoesAgrupadas.forEach((item) => {
      const cache = lerCache(item.id, mesesBase, `${item.dataReferencia}::${item.fimOverride || ''}`);
      if (cache?.dados) hidratado[item.id] = cache.dados;
    });
    setResultados(hidratado);
    setExpandido({});
  }, [mesesBase, negociacoesAgrupadas]);

  async function calcular(item) {
    setCarregando((p) => ({ ...p, [item.id]: true }));
    setErros((p) => ({ ...p, [item.id]: '' }));
    try {
      const janelas = calcularJanelasSaving(item.dataReferencia, mesesBase);
      if (!janelas) throw new Error('Data de referência inválida.');
      // Fecha o "depois" num mês específico (ex.: só agosto), em vez do padrão
      // que vai até hoje — útil pra comparar mês a mês em vez de "desde a mudança".
      if (item.fimOverride && item.fimOverride >= janelas.inicioAtual) janelas.fimAtual = item.fimOverride;
      const transportadorasExatas = item.transportadorasExatas?.length ? item.transportadorasExatas : [item.transportadora];
      const [linhasBase, linhasAtual] = await Promise.all([
        listarRealizadoLocalCtesParaSimulacao({
          transportadorasExatas, origem: item.origem || undefined,
          canal: item.canal || undefined, inicio: janelas.inicioBase, fim: janelas.fimBase, limit: 50000,
        }),
        listarRealizadoLocalCtesParaSimulacao({
          transportadorasExatas, origem: item.origem || undefined,
          canal: item.canal || undefined, inicio: janelas.inicioAtual, fim: janelas.fimAtual, limit: 50000,
        }),
      ]);
      if (!linhasBase.length || !linhasAtual.length) {
        throw new Error(linhasAtual.length ? 'Sem histórico antes da referência.' : 'Sem realizado após a referência.');
      }
      const totais = calcularTotais(linhasBase, linhasAtual);
      const linhasOrigem = calcularSavingPorOrigem(linhasBase, linhasAtual, rotuloOrigemCidade);
      const resultadoItem = { ...totais, janelas, linhasOrigem };
      setResultados((p) => ({ ...p, [item.id]: resultadoItem }));
      setExpandido((p) => ({ ...p, [item.id]: true }));
      salvarCache(item.id, mesesBase, `${item.dataReferencia}::${item.fimOverride || ''}`, resultadoItem);
    } catch (e) {
      const msg = e?.message || 'Erro ao calcular.';
      setErros((p) => ({ ...p, [item.id]: msg }));
      if (typeof onErro === 'function') onErro(msg);
    } finally {
      setCarregando((p) => ({ ...p, [item.id]: false }));
    }
  }

  async function calcularTodas() {
    setCalculandoTodas(true);
    for (const item of negociacoesTodas) {
      if (!resultados[item.id]) await calcular(item);
    }
    setCalculandoTodas(false);
  }

  function renderDetalheOrigem(r) {
    return <table className="sim-table" style={{ minWidth: 600 }}>
      <thead><tr><th>Origem</th><th>CT-es antes</th><th>CT-es depois</th><th>% antes</th><th>% depois</th><th>Saving</th></tr></thead>
      <tbody>
        {r.linhasOrigem.map((l, i) => <tr key={`${l.origem}-${i}`}>
          <td>{l.origem}</td>
          <td>{l.ctesBase}</td>
          <td>{l.ctesAtual}</td>
          <td>{l.pctBase == null ? '—' : percentual(l.pctBase)}</td>
          <td>{l.pctAtual == null ? '—' : percentual(l.pctAtual)}</td>
          <td style={{ color: l.semHistorico ? '#94a3b8' : (l.saving >= 0 ? '#087f3f' : '#c1121f'), fontWeight: 700 }}>
            {l.semHistorico ? 'Sem histórico' : moeda(l.saving)}
          </td>
        </tr>)}
      </tbody>
    </table>;
  }

  function renderLinha(item) {
    const r = resultados[item.id];
    const reduziuItem = r ? r.variacaoPct > 0 : null;
    const corLinha = r ? (reduziuItem ? '#087f3f' : '#c1121f') : undefined;
    return <React.Fragment key={item.id}>
      <tr>
        <td>
          <strong>{item.transportadora}</strong>
          {item.manual ? <span style={{ marginLeft: 6, fontSize: 10, color: '#7c3aed' }}>(manual)</span> : null}
        </td>
        <td>{item.origem || 'Todas'}</td>
        <td>{item.canal || '—'}</td>
        <td>{dataBr(item.dataReferencia)}</td>
        <td>{r ? percentual(r.pctBaseTotal) : '—'}</td>
        <td>{r ? percentual(r.pctAtualTotal) : '—'}</td>
        <td style={{ color: corLinha, fontWeight: 700 }}>
          {r ? `${reduziuItem ? 'Reduziu' : 'Aumentou'} ${percentual(Math.abs(r.variacaoPct))}` : '—'}
        </td>
        <td style={{ color: corLinha, fontWeight: 700 }}>{r ? moeda(r.savingTotal) : '—'}</td>
        <td style={gestaoStyles.linhaAcao}>
          <button type="button" className="sim-tab" disabled={carregando[item.id]} onClick={() => (r ? setExpandido((p) => ({ ...p, [item.id]: !p[item.id] })) : calcular(item))}>
            {carregando[item.id] ? 'Calculando…' : r ? (expandido[item.id] ? 'Ocultar' : 'Ver por origem') : 'Calcular'}
          </button>
          {item.manual ? <button type="button" className="sim-tab" onClick={() => removerExtra(item.id)}>Remover</button> : null}
        </td>
      </tr>
      {erros[item.id] ? <tr><td colSpan={9} style={{ color: '#c1121f' }}>{erros[item.id]}</td></tr> : null}
      {r && expandido[item.id] ? <tr><td colSpan={9}>{renderDetalheOrigem(r)}</td></tr> : null}
    </React.Fragment>;
  }

  function gerarLaudo() {
    const minimoAbs = Number(String(savingMinimoLaudo).replace(',', '.')) || 0;
    const calculadas = negociacoesTodas
      .map((item) => ({ item, r: resultados[item.id] }))
      .filter((x) => x.r && !erros[x.item.id])
      .filter((x) => savingSinalLaudo === 'TODOS' || (savingSinalLaudo === 'REDUZIU' ? x.r.variacaoPct > 0 : x.r.variacaoPct <= 0))
      .filter((x) => Math.abs(x.r.savingTotal) >= minimoAbs);
    const dataRef = new Date().toLocaleString('pt-BR');
    const savingTotal = calculadas.reduce((acc, x) => acc + x.r.savingTotal, 0);
    const reduziram = calculadas.filter((x) => x.r.variacaoPct > 0).length;
    const aumentaram = calculadas.length - reduziram;
    const linhasHtml = calculadas
      .sort((a, b) => b.r.savingTotal - a.r.savingTotal)
      .map((x) => {
        const reduziuLinha = x.r.variacaoPct > 0;
        const cor = reduziuLinha ? '#087f3f' : '#c1121f';
        return `<tr>
          <td>${x.item.transportadora}${x.item.manual ? ' (manual)' : ''}</td>
          <td>${x.item.origem || 'Todas'}</td>
          <td>${x.item.canal || '—'}</td>
          <td>${dataBr(x.item.dataReferencia)}</td>
          <td>${percentual(x.r.pctBaseTotal)}</td>
          <td>${percentual(x.r.pctAtualTotal)}</td>
          <td style="color:${cor};font-weight:700">${reduziuLinha ? 'Reduziu' : 'Aumentou'} ${percentual(Math.abs(x.r.variacaoPct))}</td>
          <td style="color:${cor};font-weight:700">${moeda(x.r.savingTotal)}</td>
        </tr>`;
      }).join('');
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Laudo - Saving por transportadora</title>
    <style>
      body{margin:0;background:#f4f6fa;color:#0f172a;font-family:Arial,sans-serif}
      main{max-width:1100px;margin:0 auto;padding:28px}
      section{background:#fff;border:1px solid #dbe4f0;border-radius:10px;padding:18px;margin-bottom:16px}
      h1{margin:0 0 4px;color:#001f4f} h2{margin:0 0 12px;color:#001f4f;font-size:18px}
      .muted{color:#64748b;font-size:13px}
      .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
      .card{border:1px solid #dbe4f0;border-radius:8px;padding:12px}
      .card span{color:#475569;font-size:12px;display:block}
      .card strong{display:block;margin-top:6px;font-size:20px;color:#001f4f}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left}
      th{background:#f8fafc;color:#001f4f}
      @media print{body{background:#fff}main{padding:0;max-width:none}section{break-inside:avoid}}
    </style></head><body><main>
      <section>
        <h1>Laudo de saving por transportadora (antes x depois)</h1>
        <div class="muted">Gerado em ${dataRef}. Compara o percentual de frete/NF da própria transportadora antes e depois da data de corte — não é contra o mercado nem a malha oficial. Janela "antes": ${mesesBase} ${mesesBase === 1 ? 'mês' : 'meses'}.</div>
        <div class="muted">Filtros: ${savingSinalLaudo === 'TODOS' ? 'reduziu e aumentou' : savingSinalLaudo === 'REDUZIU' ? 'só reduziu' : 'só aumentou'}${minimoAbs > 0 ? ` · saving mínimo ${moeda(minimoAbs)}` : ''}.</div>
      </section>
      <section>
        <h2>Resumo</h2>
        <div class="cards">
          <div class="card"><span>Calculadas</span><strong>${calculadas.length}</strong></div>
          <div class="card"><span>Reduziram</span><strong style="color:#087f3f">${reduziram}</strong></div>
          <div class="card"><span>Aumentaram</span><strong style="color:#c1121f">${aumentaram}</strong></div>
          <div class="card"><span>Saving total</span><strong style="color:${savingTotal >= 0 ? '#087f3f' : '#c1121f'}">${moeda(savingTotal)}</strong></div>
        </div>
      </section>
      <section>
        <h2>Evolução por transportadora${agrupamento === 'origem' ? ' / origem' : ''}</h2>
        <table>
          <thead><tr><th>Transportadora</th><th>Origem</th><th>Canal</th><th>Referência</th><th>% antes</th><th>% depois</th><th>Variação</th><th>Saving</th></tr></thead>
          <tbody>${linhasHtml || '<tr><td colspan="8">Nenhuma linha calculada ainda.</td></tr>'}</tbody>
        </table>
      </section>
    </main></body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `laudo-saving-transportadora-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  const corpoLista = !negociacoes.length
    ? <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
        Nenhuma negociação cadastrada — use "Incluir transportadora" acima pra adicionar manualmente.
      </div>
    : <div style={gestaoStyles.tabelaWrap}>
        <table className="sim-table" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th>Transportadora</th><th>Origem</th><th>Canal</th><th>Referência</th>
              <th>% antes</th><th>% depois</th><th>Variação</th><th>Saving</th><th></th>
            </tr>
          </thead>
          <tbody>{negociacoes.map(renderLinha)}</tbody>
        </table>
      </div>;

  return <div style={{ marginBottom: 20 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
      <strong style={{ fontSize: 14 }}>Negociações aprovadas</strong>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={gestaoStyles.chips}>
          <span onClick={() => setAgrupamento('origem')} style={agrupamento === 'origem' ? gestaoStyles.chipAtivo : gestaoStyles.chip}>Por origem</span>
          <span onClick={() => setAgrupamento('transportadora')} style={agrupamento === 'transportadora' ? gestaoStyles.chipAtivo : gestaoStyles.chip}>Por transportadora</span>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
          Meses antes
          <select value={mesesBase} onChange={(e) => setMesesBase(Number(e.target.value))} style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid #cbd5e1' }}>
            {OPCOES_MESES_BASE.map((m) => <option key={m} value={m}>{m} {m === 1 ? 'mês' : 'meses'}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
          De (todos)
          <input type="date" value={dataCorteGlobal} max={hojeIso()} onChange={(e) => setDataCorteGlobal(e.target.value)} style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
          Até (opcional — senão vai até hoje)
          <input type="date" value={dataFimGlobal} min={dataCorteGlobal || undefined} max={hojeIso()} disabled={!dataCorteGlobal} onChange={(e) => setDataFimGlobal(e.target.value)} style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
          {dataCorteGlobal ? <button type="button" className="sim-tab" onClick={() => setDataFimGlobal(fimDoMes(dataCorteGlobal))}>Só esse mês</button> : null}
          {dataCorteGlobal ? <button type="button" className="sim-tab" onClick={() => { setDataCorteGlobal(''); setDataFimGlobal(''); }}>Limpar</button> : null}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
          Canal
          <select value={canalFiltro} onChange={(e) => setCanalFiltro(e.target.value)} style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid #cbd5e1' }}>
            <option value="TODOS">Todos</option>
            <option value="ATACADO">Atacado</option>
            <option value="B2C">B2C</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
          <input type="checkbox" checked={somenteComHistorico} onChange={(e) => setSomenteComHistorico(e.target.checked)} />
          Só com histórico calculado
        </label>
        <button type="button" className="sim-tab" disabled={calculandoTodas || !negociacoesTodas.length} onClick={calcularTodas}>
          {calculandoTodas ? 'Calculando todas…' : 'Calcular todas'}
        </button>
      </div>
    </div>

    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, padding: 10, background: '#fff7ed', borderRadius: 8, border: '1px solid #fed7aa' }}>
      <strong style={{ fontSize: 12, color: '#9a3412' }}>Laudo:</strong>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
        Saving
        <select value={savingSinalLaudo} onChange={(e) => setSavingSinalLaudo(e.target.value)} style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid #cbd5e1' }}>
          <option value="TODOS">Reduziu e aumentou</option>
          <option value="REDUZIU">Só reduziu</option>
          <option value="AUMENTOU">Só aumentou</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
        Saving mínimo (R$)
        <input type="number" min="0" step="0.01" value={savingMinimoLaudo} onChange={(e) => setSavingMinimoLaudo(e.target.value)} placeholder="0" style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid #cbd5e1', width: 100 }} />
      </label>
      <button type="button" className="sim-tab" onClick={gerarLaudo}>Gerar laudo</button>
    </div>

    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14, padding: 10, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: '#475569', gap: 3 }}>
        Incluir transportadora
        <select value={novaTransportadora} onChange={(e) => setNovaTransportadora(e.target.value)} disabled={carregandoNomes} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', minWidth: 200 }}>
          <option value="">{carregandoNomes ? 'Carregando…' : 'Selecione'}</option>
          {nomesRealizado.map((n) => <option key={n.nome} value={n.nome}>{n.nome}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: '#475569', gap: 3 }}>
        Origem (opcional)
        <input type="text" value={novaOrigem} onChange={(e) => setNovaOrigem(e.target.value)} placeholder="Ex.: Itajaí" style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', minWidth: 120 }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: '#475569', gap: 3 }}>
        Canal
        <select value={novoCanal} onChange={(e) => setNovoCanal(e.target.value)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1' }}>
          {CANAIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: '#475569', gap: 3 }}>
        Data de corte
        <input type="date" value={novaData} max={hojeIso()} onChange={(e) => setNovaData(e.target.value)} style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
      </label>
      <button type="button" className="sim-tab" onClick={adicionarTransportadora}>Adicionar</button>
    </div>

    {corpoLista}
  </div>;
}

// Mesma transportadora, antes x depois de uma data de corte escolhida — diferente
// do "Savings pós-aprovação" (que compara contra o mercado inteiro) e do "Saving
// simulado" (que compara contra a malha oficial). Aqui a base de comparação é a
// própria transportadora no período anterior, então serve pra qualquer variação
// de frete (subiu ou desceu), mesmo sem negociação formal registrada no sistema.
export default function GestaoSavingTransportadora({ tabelas = [] }) {
  const [transportadoras, setTransportadoras] = useState([]);
  const [carregandoNomes, setCarregandoNomes] = useState(false);
  const [transportadora, setTransportadora] = useState('');
  const [origem, setOrigem] = useState('');
  const [dataCorte, setDataCorte] = useState('');
  const [mesesBase, setMesesBase] = useState(MESES_BASE_SAVING_PADRAO);
  const [canal, setCanal] = useState('');
  const [resultado, setResultado] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [verDetalhe, setVerDetalhe] = useState('origem');

  useEffect(() => {
    setCarregandoNomes(true);
    listarTransportadorasRealizadoReajustes()
      .then(setTransportadoras)
      .catch(() => {})
      .finally(() => setCarregandoNomes(false));
  }, []);

  const janelas = useMemo(() => (dataCorte ? calcularJanelasSaving(dataCorte, mesesBase) : null), [dataCorte, mesesBase]);

  async function calcular() {
    if (!transportadora) { setErro('Escolha a transportadora.'); return; }
    if (!janelas) { setErro('Informe a data de corte.'); return; }
    setCarregando(true);
    setErro('');
    setResultado(null);
    try {
      const origemFiltro = origem.trim();
      const [linhasBase, linhasAtual] = await Promise.all([
        listarRealizadoLocalCtesParaSimulacao({
          transportadorasExatas: [transportadora],
          origem: origemFiltro || undefined,
          canal: canal || undefined,
          inicio: janelas.inicioBase,
          fim: janelas.fimBase,
          limit: 50000,
        }),
        listarRealizadoLocalCtesParaSimulacao({
          transportadorasExatas: [transportadora],
          origem: origemFiltro || undefined,
          canal: canal || undefined,
          inicio: janelas.inicioAtual,
          fim: janelas.fimAtual,
          limit: 50000,
        }),
      ]);
      if (!linhasAtual.length) {
        throw new Error(`Sem realizado de ${transportadora}${origemFiltro ? ` (origem ${origemFiltro})` : ''} entre ${dataBr(janelas.inicioAtual)} e ${dataBr(janelas.fimAtual)}.`);
      }
      if (!linhasBase.length) {
        throw new Error(`Sem realizado de ${transportadora}${origemFiltro ? ` (origem ${origemFiltro})` : ''} entre ${dataBr(janelas.inicioBase)} e ${dataBr(janelas.fimBase)} para comparar.`);
      }
      const comparado = calcularSavingPorRotaFaixa(linhasBase, linhasAtual, { canalPadrao: canal });
      const linhasOrigem = calcularSavingPorOrigem(linhasBase, linhasAtual, rotuloOrigemCidade);
      const linhasOrigemEstado = calcularSavingPorOrigem(linhasBase, linhasAtual, rotuloOrigemEstado);
      const comportamento = calcularComportamentoRotas(linhasBase, linhasAtual);

      // Headline usa o TOTAL de todos os CT-es de cada janela (mesma conta da tabela
      // "por origem"), não a média das rotas+faixa comparáveis do detalhe: aquela
      // só cobre o subconjunto de rota+faixa que existe nos dois períodos (aqui,
      // ~10% dos CT-es) e pode andar na direção oposta do total real — não é
      // "antes x depois da transportadora", é "antes x depois só do que bateu rota+faixa".
      const totais = calcularTotais(linhasBase, linhasAtual);

      setResultado({
        ...comparado,
        ...totais,
        linhasOrigem,
        linhasOrigemEstado,
        comportamento,
        janelas,
        origemFiltro,
        pctBaseTotal: totais.pctBaseTotal,
        pctAtualTotal: totais.pctAtualTotal,
        savingTotal: totais.savingTotal,
      });
      setVerDetalhe('origem');
    } catch (e) {
      setErro(e?.message || 'Erro ao calcular a comparação.');
    } finally {
      setCarregando(false);
    }
  }

  const reduziu = resultado ? resultado.variacaoPct > 0 : null;
  const headline = resultado
    ? `${transportadora}${resultado.origemFiltro ? ` (${resultado.origemFiltro})` : ''} ${reduziu ? 'reduziu' : 'aumentou'} ${percentual(Math.abs(resultado.variacaoPct))} no frete`
    : '';

  return <section className="sim-card">
    <h2 style={{ marginTop: 0 }}>Saving por transportadora (antes x depois)</h2>
    <p style={{ color: '#64748b', fontSize: 13 }}>
      Para transportadoras que já operavam e tiveram o frete reduzido ou aumentado. Compara o percentual de frete/NF
      da própria transportadora antes e depois de uma data de corte — não depende de negociação cadastrada nem
      compara contra o mercado ou a malha oficial.
    </p>

    <GestaoSavingTransportadoraLista tabelas={tabelas} onErro={setErro} />

    <h3 style={{ fontSize: 14, marginBottom: 4 }}>Consulta livre</h3>
    <p style={{ color: '#64748b', fontSize: 12, marginTop: 0 }}>Pra testar qualquer transportadora/origem/data, mesmo sem negociação cadastrada.</p>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#475569', gap: 4 }}>
        Transportadora
        <select value={transportadora} onChange={(e) => setTransportadora(e.target.value)} disabled={carregandoNomes} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', minWidth: 220 }}>
          <option value="">{carregandoNomes ? 'Carregando…' : 'Selecione'}</option>
          {transportadoras.map((t) => <option key={t.nome} value={t.nome}>{t.nome}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#475569', gap: 4 }}>
        Origem (cidade, opcional)
        <input type="text" value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder="Ex.: Itajaí" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', minWidth: 160 }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#475569', gap: 4 }}>
        Data de corte
        <input type="date" value={dataCorte} max={hojeIso()} onChange={(e) => setDataCorte(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1' }} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#475569', gap: 4 }}>
        Meses de histórico (antes)
        <select value={mesesBase} onChange={(e) => setMesesBase(Number(e.target.value))} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          {OPCOES_MESES_BASE.map((m) => <option key={m} value={m}>{m} {m === 1 ? 'mês' : 'meses'}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#475569', gap: 4 }}>
        Canal
        <select value={canal} onChange={(e) => setCanal(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1' }}>
          {CANAIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <button type="button" className="sim-tab" disabled={carregando} onClick={calcular}>{carregando ? 'Calculando…' : 'Calcular'}</button>
    </div>

    {janelas ? <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
      Antes: {dataBr(janelas.inicioBase)} a {dataBr(janelas.fimBase)} · Depois: {dataBr(janelas.inicioAtual)} a {dataBr(janelas.fimAtual)}
    </div> : null}

    {erro ? <div className="sim-alert" style={{ color: '#c1121f', marginBottom: 10 }}>{erro}</div> : null}

    {resultado ? <>
      <div style={{
        padding: '16px 18px', borderRadius: 12, marginBottom: 14,
        background: reduziu ? '#ecfdf5' : '#fef2f2', border: `1px solid ${reduziu ? '#a7f3d0' : '#fecaca'}`,
      }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: reduziu ? '#087f3f' : '#c1121f' }}>{headline}</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
          % antes: {percentual(resultado.pctBaseTotal)} → % depois: {percentual(resultado.pctAtualTotal)} · considera todos os CT-es do período, não só as rotas comparáveis abaixo
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
        <span><strong>CT-es antes:</strong> {resultado.ctesBase.toLocaleString('pt-BR')}</span>
        <span><strong>CT-es depois:</strong> {resultado.ctesAtual.toLocaleString('pt-BR')}</span>
        <span style={{ color: reduziu ? '#087f3f' : '#c1121f', fontWeight: 700 }}>
          Saving no período: {moeda(resultado.savingTotal)}
        </span>
      </div>

      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
        Detalhe por rota+faixa abaixo cobre só {resultado.linhas.filter((l) => !l.semHistorico).length} de {resultado.linhas.length} combinações
        (as demais não têm a mesma rota+faixa nos dois períodos) — use-o pra investigar onde mudou, não como o número oficial de saving.
      </div>

      <div style={gestaoStyles.linhaAcao}>
        <button type="button" className="sim-tab" onClick={() => setVerDetalhe((v) => (v === 'origem' ? '' : 'origem'))}>
          {verDetalhe === 'origem' ? 'Ocultar detalhe por origem (cidade)' : 'Ver detalhe por origem (cidade)'}
        </button>
        <button type="button" className="sim-tab" onClick={() => setVerDetalhe((v) => (v === 'uf' ? '' : 'uf'))}>
          {verDetalhe === 'uf' ? 'Ocultar detalhe por origem (estado)' : 'Ver detalhe por origem (estado)'}
        </button>
        <button type="button" className="sim-tab" onClick={() => setVerDetalhe((v) => (v === 'rota' ? '' : 'rota'))}>
          {verDetalhe === 'rota' ? 'Ocultar detalhe por origem → destino' : 'Ver detalhe por origem → destino'}
        </button>
        <button type="button" className="sim-tab" onClick={() => setVerDetalhe((v) => (v === 'comportamento' ? '' : 'comportamento'))}>
          {verDetalhe === 'comportamento' ? 'Ocultar comportamento (rotas, ticket, peso)' : 'Ver comportamento (rotas, ticket, peso)'}
        </button>
      </div>

      {verDetalhe === 'origem' || verDetalhe === 'uf' ? <div style={gestaoStyles.tabelaWrap}>
        <table className="sim-table" style={{ minWidth: 700 }}>
          <thead><tr><th>{verDetalhe === 'uf' ? 'UF de origem' : 'Origem'}</th><th>CT-es antes</th><th>CT-es depois</th><th>% antes</th><th>% depois</th><th>Saving</th></tr></thead>
          <tbody>
            {(verDetalhe === 'uf' ? resultado.linhasOrigemEstado : resultado.linhasOrigem).slice(0, LIMITE_LINHAS_TELA).map((l, i) => <tr key={`${l.origem}-${i}`}>
              <td>{l.origem}</td>
              <td>{l.ctesBase}</td>
              <td>{l.ctesAtual}</td>
              <td>{l.pctBase == null ? '—' : percentual(l.pctBase)}</td>
              <td>{l.pctAtual == null ? '—' : percentual(l.pctAtual)}</td>
              <td style={{ color: l.semHistorico ? '#94a3b8' : (l.saving >= 0 ? '#087f3f' : '#c1121f'), fontWeight: 700 }}>
                {l.semHistorico ? 'Sem histórico' : moeda(l.saving)}
              </td>
            </tr>)}
          </tbody>
        </table>
        {(verDetalhe === 'uf' ? resultado.linhasOrigemEstado : resultado.linhasOrigem).length > LIMITE_LINHAS_TELA ? <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
          Mostrando {LIMITE_LINHAS_TELA} de {(verDetalhe === 'uf' ? resultado.linhasOrigemEstado : resultado.linhasOrigem).length} {verDetalhe === 'uf' ? 'UFs' : 'origens'}.
        </div> : null}
      </div> : null}

      {verDetalhe === 'rota' ? <div style={gestaoStyles.tabelaWrap}>
        <table className="sim-table" style={{ minWidth: 900 }}>
          <thead><tr><th>Origem → destino</th><th>Faixa</th><th>CT-es antes</th><th>CT-es depois</th><th>% antes</th><th>% depois</th><th>Saving</th></tr></thead>
          <tbody>
            {resultado.linhas.slice(0, LIMITE_LINHAS_TELA).map((l, i) => <tr key={`${l.rota}-${l.faixa}-${i}`}>
              <td>{l.rota}</td>
              <td>{l.faixa}</td>
              <td>{l.ctesBase}</td>
              <td>{l.ctesAtual}</td>
              <td>{l.pctBase == null ? '—' : percentual(l.pctBase)}</td>
              <td>{l.pctAtual == null ? '—' : percentual(l.pctAtual)}</td>
              <td style={{ color: l.semHistorico ? '#94a3b8' : (l.saving >= 0 ? '#087f3f' : '#c1121f'), fontWeight: 700 }}>
                {l.semHistorico ? 'Sem histórico' : moeda(l.saving)}
              </td>
            </tr>)}
          </tbody>
        </table>
        {resultado.linhas.length > LIMITE_LINHAS_TELA ? <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
          Mostrando {LIMITE_LINHAS_TELA} de {resultado.linhas.length} rotas.
        </div> : null}
      </div> : null}

      {verDetalhe === 'comportamento' ? <>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12, fontSize: 12 }}>
          <span style={{ color: '#087f3f', fontWeight: 700 }}>
            Rotas novas: {resultado.comportamento.resumo.novas} ({moeda(resultado.comportamento.resumo.valorNFRotasNovas)} em NF)
          </span>
          <span style={{ color: '#c1121f', fontWeight: 700 }}>
            Rotas que sumiram: {resultado.comportamento.resumo.perdidas} ({moeda(resultado.comportamento.resumo.valorNFRotasPerdidas)} em NF)
          </span>
          <span style={{ color: '#475569' }}>Rotas em comum: {resultado.comportamento.resumo.comuns}</span>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
          Ticket médio = valor de NF ÷ CT-es da rota (tamanho médio do pedido). Peso médio = peso total ÷ CT-es. "Nova"
          é rota sem CT-e no período antes; "Perdida" é rota que tinha CT-e antes e não tem mais no período depois.
        </div>
        <div style={gestaoStyles.tabelaWrap}>
          <table className="sim-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Rota</th><th>Status</th><th>CT-es antes</th><th>CT-es depois</th>
                <th>Ticket médio antes</th><th>Ticket médio depois</th><th>Var. ticket</th>
                <th>Peso médio antes</th><th>Peso médio depois</th><th>Var. peso</th>
              </tr>
            </thead>
            <tbody>
              {resultado.comportamento.linhas.slice(0, LIMITE_LINHAS_TELA).map((l, i) => <tr key={`${l.rota}-${i}`}>
                <td>{l.rota}</td>
                <td style={{
                  color: l.status === 'nova' ? '#087f3f' : l.status === 'perdida' ? '#c1121f' : '#475569',
                  fontWeight: 700,
                }}>
                  {l.status === 'nova' ? 'Nova' : l.status === 'perdida' ? 'Perdida' : 'Comum'}
                </td>
                <td>{l.ctesBase}</td>
                <td>{l.ctesAtual}</td>
                <td>{l.ticketBase == null ? '—' : moeda(l.ticketBase)}</td>
                <td>{l.ticketAtual == null ? '—' : moeda(l.ticketAtual)}</td>
                <td style={{ fontWeight: 700 }}>
                  {l.variacaoTicket == null ? '—' : `${l.variacaoTicket > 0 ? '+' : ''}${percentual(l.variacaoTicket)}`}
                </td>
                <td>{l.pesoMedioBase == null ? '—' : l.pesoMedioBase.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                <td>{l.pesoMedioAtual == null ? '—' : l.pesoMedioAtual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td>
                <td style={{ fontWeight: 700 }}>
                  {l.variacaoPeso == null ? '—' : `${l.variacaoPeso > 0 ? '+' : ''}${percentual(l.variacaoPeso)}`}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {resultado.comportamento.linhas.length > LIMITE_LINHAS_TELA ? <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
          Mostrando {LIMITE_LINHAS_TELA} de {resultado.comportamento.linhas.length} rotas.
        </div> : null}
      </> : null}
    </> : null}
  </section>;
}
