import React, { useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';
import BaseCtesStatus from '../components/BaseCtesStatus';
import { buscarBaseSimulacaoPorRotasDb, carregarBaseFiltradaPorCidadesOrigemDb, carregarMunicipiosIbgeDb } from '../services/freteDatabaseService';
import { normalizarTransportadoras, processarCte } from '../services/auditoriaCteProcessamentoService';
import { categoriaCanalRealizado, montarMapasIbge, resolverIbgeLocal } from '../utils/realizadoLocalEngine';
import { filtrarCpComercialCte } from '../services/cteBasePolicy';
import { resolverPesoCteRealizado } from '../utils/pesoRealizadoSimulador';
import { exportarExcelFormatado } from '../utils/exportarExcelFormatado';
import { zipSync } from 'fflate';
import {
  CDS_B2C, FAIXAS_PADRAO_TEXTO, cdDaCidade, faixaDoPeso, montarTabelaPadrao, normTexto, parseFaixas, tabelaPorTransportadora,
} from '../utils/tabelaPadraoB2c';

const LIMITE_MAX_CT = 200000;

function safeNum(v) { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; }
function fmt(v) { return safeNum(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function fmtN(v) { return safeNum(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }); }
function dig7(v) { return String(v || '').replace(/\D/g, '').slice(0, 7); }
function normBusca(texto) { return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
function cidadeBate(cidadeTabelaNorm, cidadeCteNorm) {
  if (!cidadeCteNorm) return true;
  if (!cidadeTabelaNorm) return false;
  return cidadeTabelaNorm === cidadeCteNorm
    || (cidadeTabelaNorm.length >= 5 && cidadeCteNorm.includes(cidadeTabelaNorm))
    || (cidadeCteNorm.length >= 5 && cidadeTabelaNorm.includes(cidadeCteNorm));
}
function cubagemDe(cte) {
  for (const campo of ['cubagem', 'cubagem_total', 'cubagemTotal', 'cubagem_m3']) {
    const v = safeNum(cte[campo]);
    if (v > 0) return v;
  }
  return 0;
}
function canalRealDe(cte) {
  return cte.canal_original && normTexto(cte.canal) === 'A DEFINIR'
    ? cte.canal_original
    : (cte.canal || cte.canal_original || '');
}

function montarMunicipioPorCidade(municipios = []) {
  const mapa = new Map();
  for (const item of (municipios || [])) {
    const ibge = dig7(item.ibge || item.codigo_ibge || item.codigo);
    const cidade = item.cidade || item.nome || item.municipio || '';
    const uf = item.uf || item.estado || '';
    if (!ibge || !cidade) continue;
    const kCidade = normBusca(cidade);
    const kCidadeUf = normBusca(`${cidade}/${uf}`);
    if (kCidade && !mapa.has(kCidade)) mapa.set(kCidade, ibge);
    if (kCidadeUf && !mapa.has(kCidadeUf)) mapa.set(kCidadeUf, ibge);
  }
  return mapa;
}
function ibgeDoCte(cte, tipo, municipioPorCidade, mapasIbge) {
  const direto = dig7(tipo === 'origem'
    ? (cte.ibge_corrigido_origem || cte.ibge_origem || cte.ibgeOrigem)
    : (cte.ibge_corrigido_destino || cte.ibge_destino || cte.ibgeDestino));
  if (direto) return direto;
  const cidade = tipo === 'origem' ? (cte.cidade_origem || cte.origem || '') : (cte.cidade_destino || cte.destino || '');
  const uf = tipo === 'origem' ? (cte.uf_origem || '') : (cte.uf_destino || '');
  const viaPlanilha = municipioPorCidade.get(normBusca(`${cidade}/${uf}`)) || municipioPorCidade.get(normBusca(cidade));
  if (viaPlanilha) return viaPlanilha;
  return resolverIbgeLocal(cidade, uf, mapasIbge) || '';
}

function montarRouteKeys(ctes, canalFiltro) {
  const keys = new Set();
  const canalKey = categoriaCanalRealizado(canalFiltro) || canalFiltro;
  for (const c of ctes) keys.add(`${canalKey}|${c.ibgeOrigem}-${c.ibgeDestino}`);
  return Array.from(keys);
}

function indexarBase(base) {
  const porOrigemIbge = new Map();
  const porDestinoIbge = new Map();
  const origensCidade = [];
  const vistos = new Set();
  for (const t of base) {
    for (const origem of (t.origens || [])) {
      const cidadeNorm = origem.__cidadeNorm || normTexto(origem.cidade);
      const ck = `${t.nome}|${cidadeNorm}`;
      if (cidadeNorm && !vistos.has(ck)) { vistos.add(ck); origensCidade.push({ cidadeNorm, nome: t.nome }); }
      for (const rota of (origem.rotas || [])) {
        const io = dig7(rota.ibgeOrigem);
        if (io) { if (!porOrigemIbge.has(io)) porOrigemIbge.set(io, new Set()); porOrigemIbge.get(io).add(t.nome); }
        const id = dig7(rota.ibgeDestino);
        if (id) { if (!porDestinoIbge.has(id)) porDestinoIbge.set(id, new Set()); porDestinoIbge.get(id).add(t.nome); }
      }
    }
  }
  return { porOrigemIbge, porDestinoIbge, origensCidade };
}
function nomesPorOrigem(idx, ibgeOrigem7, cidadeCteNorm, cache) {
  const key = `${ibgeOrigem7}|${cidadeCteNorm}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const set = new Set(idx.porOrigemIbge.get(ibgeOrigem7) || []);
  for (const o of idx.origensCidade) {
    if (!set.has(o.nome) && cidadeBate(o.cidadeNorm, cidadeCteNorm)) set.add(o.nome);
  }
  cache.set(key, set);
  return set;
}

const _unitariaCache = new WeakMap();
// Todas as entradas da base com o mesmo nome (principal + alternativas), num array estável por nome.
function baseUnitaria(transp, base) {
  let porNome = _unitariaCache.get(base);
  if (!porNome) {
    porNome = new Map();
    for (const t of base) { const a = porNome.get(t.nome); if (a) a.push(t); else porNome.set(t.nome, [t]); }
    _unitariaCache.set(base, porNome);
  }
  return porNome.get(transp.nome) || [transp];
}

// Preço de TODAS as tabelas que cobrem a rota do CT-e (nenhuma excluída), mais barato primeiro.
function simularTodas(cte, base, candidatas, ibgeOrigem, ibgeDestino, cidadeOrigem) {
  const canalReal = canalRealDe(cte);
  const cteBase = {
    ...cte,
    canal: canalReal, canal_original: canalReal,
    ibge_origem: ibgeOrigem, ibge_corrigido_origem: ibgeOrigem,
    ibge_destino: ibgeDestino, ibge_corrigido_destino: ibgeDestino,
  };
  const origemCmp = normTexto(cidadeOrigem);
  const resultados = [];
  for (const transp of candidatas) {
    let r;
    // Passa só a tabela da própria transportadora (array estável, p/ o cache do motor) e sem o comparativo de pesos:
    // aqui só interessa o valor calculado, e varrer a malha inteira a cada CT-e levava segundos por CT-e.
    try { r = processarCte({ ...cteBase, transportadora: transp.nome, nome_transportadora: transp.nome }, baseUnitaria(transp, base), null, '', { semComparativoPesos: true }); } catch { continue; }
    if (r.status_calculo !== 'CALCULADO') continue;
    if (!cidadeBate(normTexto(r.detalhes_calculo?.origem_cidade), origemCmp)) continue;
    const total = safeNum(r.valor_calculado);
    if (total <= 0) continue;
    resultados.push({ transportadora: transp.nome, total, prazo: safeNum(r.detalhes_calculo?.rota_prazo) });
  }
  resultados.sort((a, b) => a.total - b.total);
  return resultados;
}

async function carregarCtes({ competencia, dataInicio, dataFim, ufOrigem, limite, onProgress }) {
  if (!isSupabaseConfigured()) throw new Error('Supabase não configurado.');
  const supabase = getSupabaseClient();
  const teto = Math.max(100, Math.min(Number(limite) || 8000, LIMITE_MAX_CT));
  const acumulado = [];
  let from = 0;
  const PAGE = 1000;
  while (acumulado.length < teto) {
    let q = supabase.from('realizado_local_ctes').select('*').order('data_emissao', { ascending: false }).range(from, from + PAGE - 1);
    if (dataInicio || dataFim) {
      if (dataInicio) q = q.gte('data_emissao', dataInicio);
      if (dataFim) q = q.lte('data_emissao', dataFim);
    } else if (competencia) {
      q = q.eq('competencia', competencia);
    }
    q = q.or('canal_original.ilike.%B2C%,canal.ilike.%B2C%');
    if (ufOrigem) q = q.eq('uf_origem', ufOrigem);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao carregar CT-es: ${error.message}`);
    const lote = data || [];
    acumulado.push(...lote);
    onProgress?.(acumulado.length);
    if (lote.length < PAGE) break;
    from += PAGE;
  }
  return filtrarCpComercialCte(acumulado).slice(0, teto);
}

const th = { textAlign: 'left', padding: '6px 8px', fontSize: '0.72rem', color: '#64748b', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', fontSize: '0.8rem', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' };

export default function TabelaPadraoB2cPage() {
  const [competencia, setCompetencia] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [limiteInput, setLimiteInput] = useState('8000');
  const [cdEscolhido, setCdEscolhido] = useState('ITUPEVA');
  const [faixasTexto, setFaixasTexto] = useState(FAIXAS_PADRAO_TEXTO);
  const [granularidade, setGranularidade] = useState('cidade');
  const [baseFirst, setBaseFirst] = useState('ponderado');
  const [posicoes, setPosicoes] = useState([{ peso: '60', acr: '0' }, { peso: '20', acr: '1' }, { peso: '10', acr: '2' }, { peso: '10', acr: '3' }]);
  const [passoExtra, setPassoExtra] = useState('1');
  const [maxPos, setMaxPos] = useState('10');
  const [coberturaMin, setCoberturaMin] = useState('60');
  const [amostraMin, setAmostraMin] = useState('3');

  const [status, setStatus] = useState('idle');
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [simulados, setSimulados] = useState(null); // { ctes, semIbge, totalLidos }
  const [filtroCd, setFiltroCd] = useState('');
  const [filtroTransp, setFiltroTransp] = useState('');
  const [filtroDestino, setFiltroDestino] = useState('');
  const [visao, setVisao] = useState('ranking');
  const [gerandoArquivos, setGerandoArquivos] = useState(false);

  const faixas = useMemo(() => parseFaixas(faixasTexto), [faixasTexto]);

  async function gerar() {
    if (!faixas.length) { setErro('Faixas de peso inválidas. Use o formato "0-2, 2-5, 100+".'); return; }
    setStatus('carregando'); setErro(''); setSimulados(null);
    try {
      setProgresso('Carregando planilha de IBGE...');
      const municipios = await carregarMunicipiosIbgeDb().catch(() => []);
      const mapasIbge = montarMapasIbge(municipios);
      const municipioPorCidade = montarMunicipioPorCidade(municipios);

      setProgresso('Carregando CT-es B2C...');
      const todos = await carregarCtes({
        competencia, dataInicio: dataInicio || undefined, dataFim: dataFim || undefined,
        ufOrigem: CDS_B2C.find((c) => c.chave === cdEscolhido)?.uf,
        limite: Number(limiteInput) || 8000, onProgress: (n) => setProgresso(`Carregando CT-es B2C... ${n}`),
      });
      const cds = CDS_B2C.filter((c) => c.chave === cdEscolhido);
      const doCd = [];
      let semIbge = 0;
      for (const cte of todos) {
        const cidadeOrigem = cte.cidade_origem || cte.origem || '';
        const cd = cdDaCidade(cidadeOrigem, cds);
        if (!cd) continue;
        const ibgeOrigem = ibgeDoCte(cte, 'origem', municipioPorCidade, mapasIbge);
        const ibgeDestino = ibgeDoCte(cte, 'destino', municipioPorCidade, mapasIbge);
        if (!ibgeOrigem || !ibgeDestino) { semIbge += 1; continue; }
        const peso = safeNum(resolverPesoCteRealizado(cte));
        if (peso <= 0) continue;
        doCd.push({ cte, cd: cd.label, cidadeOrigem, ibgeOrigem, ibgeDestino, peso });
      }
      if (!doCd.length) throw new Error('Nenhum CT-e B2C do CD selecionado no recorte carregado.');

      // 1) Perfil médio por faixa de peso, tirado do realizado do CD: nota fiscal, peso e cubagem.
      setProgresso('Montando o perfil médio por faixa de peso...');
      const acum = new Map();
      let nfSoma = 0; let nfN = 0;
      for (const x of doCd) {
        const nf = safeNum(x.cte.valor_nf || x.cte.nf_venda);
        if (nf > 0) { nfSoma += nf; nfN += 1; }
        const f = faixaDoPeso(x.peso, faixas);
        if (!f) continue;
        const a = acum.get(f.min) || { n: 0, peso: 0, nf: 0, nfN: 0, cub: 0, cubN: 0 };
        a.n += 1; a.peso += x.peso;
        if (nf > 0) { a.nf += nf; a.nfN += 1; }
        const cub = cubagemDe(x.cte);
        if (cub > 0) { a.cub += cub; a.cubN += 1; }
        acum.set(f.min, a);
      }
      const nfGeral = nfN ? nfSoma / nfN : 0;
      const perfilDaFaixa = (faixa) => {
        const a = acum.get(faixa.min);
        if (a && a.n) return { peso: a.peso / a.n, nf: a.nfN ? a.nf / a.nfN : nfGeral, cub: a.cubN ? a.cub / a.cubN : 0 };
        return { peso: Number.isFinite(faixa.max) ? (faixa.min + faixa.max) / 2 : faixa.min * 1.25, nf: nfGeral, cub: 0 };
      };

      // 2) Malha completa das tabelas que saem do CD (todos os destinos atendidos).
      setProgresso('Carregando a malha completa das tabelas que saem do CD (pode demorar)...');
      const baseFrete = normalizarTransportadoras(
        await carregarBaseFiltradaPorCidadesOrigemDb(cds[0].cidades, (e) => setProgresso(`Carregando malha do CD... ${fmtN(e?.rotas || 0)} rotas · ${fmtN(e?.cotacoes || 0)} cotações`)),
      );
      if (!baseFrete.length) throw new Error('Nenhuma tabela de frete B2C encontrada para o CD.');
      const idx = indexarBase(baseFrete);
      const mapBaseByNome = new Map(baseFrete.map((t) => [t.nome, t]));
      const origemCache = new Map();

      // CT-e-molde do CD (o de NF mediana): fornece os demais campos; peso, NF e cubagem vêm do perfil da faixa.
      const porNf = [...doCd].sort((a, b) => safeNum(a.cte.valor_nf || a.cte.nf_venda) - safeNum(b.cte.valor_nf || b.cte.nf_venda));
      const molde = porNf[Math.floor(porNf.length / 2)];
      const setOrigemMolde = nomesPorOrigem(idx, dig7(molde.ibgeOrigem), normTexto(molde.cidadeOrigem), origemCache);

      // 3) Todos os destinos que as tabelas atendem a partir do CD.
      const infoIbge = new Map();
      for (const m of municipios) { const k = dig7(m.ibge || m.codigo_ibge || m.codigo); if (k) infoIbge.set(k, m); }
      const destinosTabela = new Set();
      for (const t of baseFrete) for (const o of (t.origens || [])) {
        if (!cdDaCidade(o.cidade, [cds[0]])) continue;
        for (const rota of (o.rotas || [])) { const d = dig7(rota.ibgeDestino); if (d) destinosTabela.add(d); }
      }
      const volumePorDestino = new Map();
      for (const x of doCd) volumePorDestino.set(dig7(x.ibgeDestino), (volumePorDestino.get(dig7(x.ibgeDestino)) || 0) + 1);

      const destinos = [];
      const repPorUf = new Map();
      for (const d of destinosTabela) {
        const info = infoIbge.get(d);
        if (!info) continue;
        const ufD = String(info.uf || '').toUpperCase();
        if (granularidade === 'uf') {
          const atual = repPorUf.get(ufD);
          if (!atual || (volumePorDestino.get(d) || 0) > (volumePorDestino.get(atual.d) || 0)) repPorUf.set(ufD, { d, info, ufD });
        } else {
          destinos.push({ d, info, ufD, key: d, label: `${info.cidade}/${ufD}` });
        }
      }
      if (granularidade === 'uf') for (const { d, info, ufD } of repPorUf.values()) destinos.push({ d, info, ufD, key: ufD, label: ufD });
      if (!destinos.length) throw new Error('Nenhum destino das tabelas foi encontrado na planilha de IBGE.');

      // 4) Uma simulação por destino x faixa, com o perfil médio da faixa, em todas as transportadoras que atendem o destino.
      const ctes = [];
      const t0 = Date.now();
      let semTabela = 0;
      for (let k = 0; k < destinos.length; k++) {
        const { d, info, ufD, key, label } = destinos[k];
        const setDestino = idx.porDestinoIbge.get(d);
        const candidatas = [];
        if (setDestino) for (const nome of setOrigemMolde) if (setDestino.has(nome)) { const t = mapBaseByNome.get(nome); if (t) candidatas.push(t); }
        if (!candidatas.length) { semTabela += 1; continue; }
        for (const faixa of faixas) {
          const pf = perfilDaFaixa(faixa);
          const cteRef = {
            ...molde.cte, cidade_destino: info.cidade, destino: info.cidade, uf_destino: ufD,
            ibge_destino: d, ibge_corrigido_destino: d, ibgeDestino: d,
            peso: pf.peso, peso_declarado: pf.peso, valor_nf: pf.nf, nf_venda: pf.nf,
          };
          for (const campo of Object.keys(cteRef)) if (/cubag|cubado/i.test(campo)) cteRef[campo] = 0;
          if (pf.cub > 0) { cteRef.cubagem = pf.cub; cteRef.cubagem_total = pf.cub; }
          const resultados = simularTodas(cteRef, baseFrete, candidatas, molde.ibgeOrigem, d, molde.cidadeOrigem);
          if (!resultados.length) continue;
          ctes.push({ cd: molde.cd, uf: ufD, peso: pf.peso, destinoKey: key, destinoLabel: label, valorPago: 0, resultados, sintetico: true });
        }
        if (k % 20 === 0 || k === destinos.length - 1) {
          setProgresso(`Simulando destinos... ${fmtN(k + 1)}/${fmtN(destinos.length)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      // 5) CT-es reais entram só como volume e custo realizado (sem recalcular frete).
      for (const x of doCd) {
        const ufD = String(x.cte.uf_destino || '').toUpperCase();
        const dest = dig7(x.ibgeDestino);
        const cidadeDestino = x.cte.cidade_destino || x.cte.destino || '';
        ctes.push({
          cd: x.cd, uf: ufD, peso: x.peso,
          destinoKey: granularidade === 'uf' ? ufD : dest,
          destinoLabel: granularidade === 'uf' ? ufD : `${cidadeDestino}/${ufD}`,
          valorPago: safeNum(x.cte.valor_cte || x.cte.frete_pago || x.cte.valor_frete),
          resultados: [], apenasVolume: true,
        });
      }
      const destinosSemVolume = destinos.filter((x) => !volumePorDestino.has(x.d)).length;
      const faixasSemAmostra = faixas.filter((f) => !acum.get(f.min)?.n).length;
      setSimulados({ ctes, semIbge, totalLidos: todos.length, estimadas: faixasSemAmostra, destinosSemVolume, destinos: destinos.length, semTabela });
      setStatus('concluido'); setProgresso('');
    } catch (e) {
      console.error('[TabelaPadraoB2C]', e);
      setErro(`${e.message || e}`);
      setStatus('erro'); setProgresso('');
    }
  }

  // Muda parâmetros de preço sem re-simular: a agregação é pura.
  const tabela = useMemo(() => {
    if (!simulados) return null;
    return montarTabelaPadrao(simulados.ctes, {
      faixas, base: baseFirst,
      pesos: posicoes.map((p) => safeNum(p.peso)), difs: posicoes.map((p) => safeNum(p.acr)),
      passoExtra: safeNum(passoExtra), maxPos: Math.max(1, Math.floor(safeNum(maxPos)) || 1),
      coberturaMin: Math.max(0, Math.min(100, safeNum(coberturaMin))) / 100,
      amostraMin: Math.max(1, safeNum(amostraMin)),
    });
  }, [simulados, faixas, baseFirst, posicoes, passoExtra, maxPos, coberturaMin, amostraMin]);

  // Só materializa (transportadora x rota x faixa) quando a visão por transportadora está aberta: com malha completa são milhões de linhas.
  const porTransp = useMemo(() => (tabela && visao === 'transportadora' ? tabelaPorTransportadora(tabela.linhas) : []), [tabela, visao]);

  // Cobertura por transportadora: destinos que atende x linhas (destino x faixa) com valor.
  const coberturaTransp = useMemo(() => {
    const m = new Map();
    for (const l of tabela?.linhas || []) {
      const dest = `${l.cd}|${l.destinoKey}`;
      for (const p of l.completo) {
        const c = m.get(p.transportadora) || { transportadora: p.transportadora, destinos: new Set(), linhas: 0, estimadas: 0 };
        c.destinos.add(dest); c.linhas += 1; if (l.estimado) c.estimadas += 1;
        m.set(p.transportadora, c);
      }
    }
    return Array.from(m.values()).map((c) => ({
      transportadora: c.transportadora, destinos: c.destinos.size, linhas: c.linhas, estimadas: c.estimadas,
      faltando: Math.max(0, c.destinos.size * faixas.length - c.linhas),
    })).sort((a, b) => a.transportadora.localeCompare(b.transportadora, 'pt-BR'));
  }, [tabela, faixas]);

  const linhasFiltradas = useMemo(() => {
    if (!tabela) return [];
    const d = normBusca(filtroDestino);
    return tabela.linhas.filter((l) => (!filtroCd || l.cd === filtroCd)
      && (!d || normBusca(l.destinoLabel).includes(d))
      && (!filtroTransp || l.podio.some((p) => p.transportadora === filtroTransp)));
  }, [tabela, filtroCd, filtroDestino, filtroTransp]);

  const transpsNoPodio = useMemo(() => coberturaTransp.map((c) => c.transportadora), [coberturaTransp]);

  const totais = useMemo(() => {
    const t = { realizado: 0, padrao: 0, ctes: 0 };
    for (const l of tabela?.linhas || []) { t.realizado += l.custoRealizado; t.padrao += l.custoPadrao; t.ctes += l.ctes; }
    return t;
  }, [tabela]);

  const vitorias = useMemo(() => {
    const m = new Map();
    for (const l of tabela?.linhas || []) {
      const v = l.podio[0]?.transportadora;
      if (v) m.set(v, (m.get(v) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [tabela]);

  function nomeSeguro(v) {
    return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  }

  async function arquivoDaTransportadora(nome) {
    const linhas = tabelaPorTransportadora(tabela.linhas, nome);
    const bytes = await exportarExcelFormatado({
      nomeArquivo: '', aba: 'Tabela de frete', retornarBytes: true,
      resumo: [
        ['Transportadora', nome], ['CD origem', cdEscolhido], ['Preço base', baseFirst === 'ponderado' ? 'Média ponderada (tabela)' : baseFirst === 'simulado' ? 'Simulado do vencedor' : 'Média realizada'],
        ['Pesos por posição (%)', posicoes.map((p) => p.peso).join(' / ')], ['Acréscimo por posição (R$)', posicoes.map((p) => p.acr).join(' / ')],
        ['Passo após a última posição (R$)', passoExtra], ['Gerado em', new Date().toLocaleString('pt-BR')],
      ],
      colunas: [
        { titulo: 'CD origem' }, { titulo: 'UF destino', tipo: 'centro' }, { titulo: 'Destino' }, { titulo: 'IBGE destino', tipo: 'centro' },
        { titulo: 'Peso inicial (kg)', tipo: 'numero' }, { titulo: 'Peso final (kg)', tipo: 'numero' }, { titulo: 'Faixa de peso' },
        { titulo: 'Valor do frete', tipo: 'moeda' }, { titulo: 'Posição na rota', tipo: 'inteiro' }, { titulo: 'Prazo (dias)', tipo: 'numero' },
        { titulo: 'Valor na tabela real', tipo: 'moeda' }, { titulo: 'Observação' },
      ],
      linhas: linhas.map((p) => [
        p.cd, p.uf, p.destino, granularidade === 'uf' ? '' : p.destinoKey, p.faixaMin, Number.isFinite(p.faixaMax) ? p.faixaMax : '', p.faixa,
        p.precoTabela, p.posicao, p.prazo ?? '', p.simulado,
        [p.estimado ? 'sem volume no histórico (estimado: CT-e de referência com o peso médio da faixa)' : '', p.cobertura < 1 ? `tabela cobre ${(p.cobertura * 100).toFixed(0)}% dos CT-es` : ''].filter(Boolean).join('; '),
      ]),
    });
    return { nome: `tabela-b2c-${nomeSeguro(cdEscolhido)}-${nomeSeguro(nome)}.xlsx`, bytes: new Uint8Array(bytes) };
  }

  function baixarBlob(bytes, nome, tipo) {
    const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
    const a = document.createElement('a');
    a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function baixarArquivos(nomes) {
    setGerandoArquivos(true);
    try {
      if (nomes.length === 1) {
        const f = await arquivoDaTransportadora(nomes[0]);
        baixarBlob(f.bytes, f.nome, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      } else {
        const arquivos = {};
        for (const n of nomes) {
          const f = await arquivoDaTransportadora(n);
          arquivos[f.nome] = f.bytes;
          await new Promise((res) => setTimeout(res, 0));
        }
        baixarBlob(zipSync(arquivos), `tabelas-b2c-${nomeSeguro(cdEscolhido)}-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip');
      }
    } catch (e) {
      setErro(`Falha ao gerar arquivos: ${e.message || e}`);
    } finally {
      setGerandoArquivos(false);
    }
  }

  async function exportar() {
    if (!tabela) return;
    const nPos = tabela.linhas.reduce((m, l) => Math.max(m, l.podio.length), 1);
    const resumo = [
      ['Faixas', faixasTexto], ['Granularidade', granularidade === 'uf' ? 'UF de destino' : 'Cidade de destino'],
      ['Preço base', baseFirst === 'ponderado' ? 'Média ponderada (tabela)' : baseFirst === 'simulado' ? 'Simulado do vencedor' : 'Média realizada'],
      ['Pesos por posição (%)', posicoes.map((p) => p.peso).join(' / ')], ['Acréscimo por posição (R$)', posicoes.map((p) => p.acr).join(' / ')],
      ['Passo após a última posição (R$)', passoExtra], ['Máx. posições', maxPos], ['Cobertura mínima %', coberturaMin], ['Amostra mínima (CT-es)', amostraMin],
      ['CD', cdEscolhido], ['CT-es simulados', simulados.ctes.length],
    ];
    await exportarExcelFormatado({
      nomeArquivo: `tabela-padrao-b2c-${new Date().toISOString().slice(0, 10)}`,
      aba: 'Ranking',
      resumo,
      colunas: [
        { titulo: 'CD origem' }, { titulo: 'UF destino', tipo: 'centro' }, { titulo: 'Destino' }, { titulo: 'Faixa de peso' }, { titulo: 'CT-es', tipo: 'inteiro' },
        { titulo: 'Realizado médio', tipo: 'moeda' }, { titulo: 'Preço padrão (ponderado)', tipo: 'moeda' }, { titulo: 'Custo realizado', tipo: 'moeda' }, { titulo: 'Custo com padrão', tipo: 'moeda' },
        ...Array.from({ length: nPos }, (_, i) => [{ titulo: `${i + 1}º` }, { titulo: `Preço ${i + 1}º`, tipo: 'moeda' }]).flat(),
      ],
      linhas: tabela.linhas.map((l) => [
        l.cd, l.uf, l.destinoLabel, l.faixa.label, l.ctes, l.realizado, l.precoBase, l.custoRealizado, l.custoPadrao,
        ...Array.from({ length: nPos }, (_, i) => [l.podio[i]?.transportadora || '', l.podio[i]?.precoTabela ?? '']).flat(),
      ]),
    });
    await exportarExcelFormatado({
      nomeArquivo: `tabela-padrao-b2c-por-transportadora-${new Date().toISOString().slice(0, 10)}`,
      aba: 'Por transportadora',
      resumo,
      colunas: [
        { titulo: 'Transportadora' }, { titulo: 'CD origem' }, { titulo: 'UF destino', tipo: 'centro' }, { titulo: 'Destino' },
        { titulo: 'Faixa de peso' }, { titulo: 'Peso inicial (kg)', tipo: 'numero' }, { titulo: 'Peso final (kg)', tipo: 'numero' },
        { titulo: 'Posição', tipo: 'inteiro' }, { titulo: 'Preço tabela padrão', tipo: 'moeda' }, { titulo: 'Simulado (tabela real)', tipo: 'moeda' },
        { titulo: 'Realizado médio', tipo: 'moeda' }, { titulo: 'CT-es na amostra', tipo: 'inteiro' }, { titulo: 'Prazo', tipo: 'numero' },
      ],
      linhas: tabelaPorTransportadora(tabela.linhas).map((p) => [
        p.transportadora, p.cd, p.uf, p.destino, p.faixa, p.faixaMin, Number.isFinite(p.faixaMax) ? p.faixaMax : '',
        p.posicao, p.precoTabela, p.simulado, p.realizado, p.ctes, p.prazo ?? '',
      ]),
    });
  }

  const MAX_LINHAS = 600;
  const colsPodio = tabela ? tabela.linhas.reduce((m, l) => Math.max(m, l.podio.length), 1) : 0;

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">Central Fretes • Análise</div>
        <h1>Tabela Padrão B2C</h1>
        <p>Simula todas as tabelas B2C sobre o histórico dos CDs e, para cada origem, destino e faixa de peso, define quem vence — mantendo 2º e 3º colocados — e o preço padrão ponderado pelos valores de tabela.</p>
        <BaseCtesStatus />
      </div>

      {erro && <div className="sim-alert error">{erro}</div>}

      <section className="sim-card">
        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
          <label>Competência (mês)<input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} /></label>
          <label>Período — início<input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} /></label>
          <label>Período — fim<input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} /></label>
          <label>Limite de CT-es <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.72rem' }}>(só sem mês/período)</span>
            <input type="number" value={limiteInput} onChange={(e) => setLimiteInput(e.target.value)} min={100} max={200000} step={1000} />
          </label>
        </div>

        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
          <label>CD de origem (um por vez)
            <select value={cdEscolhido} onChange={(e) => setCdEscolhido(e.target.value)} style={{ width: '100%' }}>
              {CDS_B2C.map((cd) => <option key={cd.chave} value={cd.chave}>{cd.label}/{cd.uf} ({cd.codigos.join(', ')})</option>)}
            </select>
          </label>
        </div>

        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
          <label>Faixas de peso (kg)
            <input value={faixasTexto} onChange={(e) => setFaixasTexto(e.target.value)} style={{ borderColor: faixas.length ? undefined : '#9b1111' }} />
          </label>
          <label>Destino agrupado por
            <select value={granularidade} onChange={(e) => setGranularidade(e.target.value)} style={{ width: '100%' }}>
              <option value="cidade">Cidade (mais detalhado)</option>
              <option value="uf">UF (mais amostra por linha)</option>
            </select>
          </label>
          <label>Preço do 1º lugar
            <select value={baseFirst} onChange={(e) => setBaseFirst(e.target.value)} style={{ width: '100%' }}>
              <option value="ponderado">Média ponderada pelos pesos (tabela)</option>
              <option value="simulado">Simulado do vencedor (tabela)</option>
              <option value="realizado">Média realizada (paga)</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="primary" type="button" onClick={gerar} disabled={status === 'carregando'}>
              {status === 'carregando' ? 'Simulando...' : 'Gerar tabela padrão'}
            </button>
          </div>
        </div>

        <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end' }}>
          <label>Cobertura mínima (%)<input type="number" min={0} max={100} value={coberturaMin} onChange={(e) => setCoberturaMin(e.target.value)} /></label>
          <label>Amostra mínima (CT-es/linha)<input type="number" min={1} value={amostraMin} onChange={(e) => setAmostraMin(e.target.value)} /></label>
        </div>
        <div style={{ marginTop: 14, border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 2 }}>Painel de posições</div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: 8 }}>
            Peso: quanto cada colocado pesa na média ponderada do preço padrão (0 = fora da média). Acréscimo: quanto a tabela daquela posição soma ao preço padrão.
          </div>
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={th}>Posição</th><th style={th}>Peso (%)</th><th style={th}>Acréscimo (R$)</th><th style={th}></th></tr>
            </thead>
            <tbody>
              {posicoes.map((p, i) => (
                <tr key={i}>
                  <td style={td}>{i + 1}º</td>
                  <td style={td}><input type="number" min={0} max={100} value={p.peso} style={{ width: 80 }}
                    onChange={(e) => setPosicoes((prev) => prev.map((x, j) => (j === i ? { ...x, peso: e.target.value } : x)))} /></td>
                  <td style={td}><input type="number" step="0.5" value={p.acr} style={{ width: 80 }}
                    onChange={(e) => setPosicoes((prev) => prev.map((x, j) => (j === i ? { ...x, acr: e.target.value } : x)))} /></td>
                  <td style={td}>
                    {i === posicoes.length - 1 && posicoes.length > 1 && (
                      <button type="button" className="sim-tab" style={{ padding: '1px 8px' }} onClick={() => setPosicoes((prev) => prev.slice(0, -1))}>remover</button>
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <td style={td} colSpan={4}>
                  <button type="button" className="sim-tab" style={{ padding: '2px 10px' }}
                    onClick={() => setPosicoes((prev) => [...prev, { peso: '0', acr: String(safeNum(prev[prev.length - 1]?.acr) + safeNum(passoExtra)) }])}>
                    + adicionar posição
                  </button>
                  <span style={{ marginLeft: 12, fontSize: '0.78rem', color: posicoes.reduce((acc, p) => acc + safeNum(p.peso), 0) === 100 ? '#047857' : '#b45309' }}>
                    soma dos pesos: {posicoes.reduce((acc, p) => acc + safeNum(p.peso), 0)}%{posicoes.reduce((acc, p) => acc + safeNum(p.peso), 0) === 100 ? '' : ' (a média é normalizada pela soma)'}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div className="sim-form-grid sim-grid-4" style={{ marginTop: 10, alignItems: 'flex-end' }}>
            <label>Posições além da lista: somar a cada colocação (R$)
              <input type="number" step="0.5" value={passoExtra} onChange={(e) => setPassoExtra(e.target.value)} />
            </label>
            <label>Máximo de transportadoras por linha
              <input type="number" min={1} max={30} value={maxPos} onChange={(e) => setMaxPos(e.target.value)} />
            </label>
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 6 }}>
            Ex.: lista até o 4º e passo R$ 1: o 5º recebe o acréscimo do 4º + 1, o 6º + 2, e assim por diante. Todas as transportadoras da rota ganham preço pela posição, até o máximo acima.
          </div>
        </div>
        <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 6 }}>
          Preço, acréscimos, cobertura e amostra recalculam na hora; só mudar o CD, período, faixas ou agrupamento exige gerar de novo.
        </div>

        {progresso && (
          <div style={{ marginTop: 12, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', fontSize: '0.85rem', color: '#1d4ed8' }}>{progresso}</div>
        )}
      </section>

      {tabela && (
        <>
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 16px', margin: '1rem 0', fontSize: '0.84rem', color: '#1d4ed8' }}>
            {fmtN(simulados.ctes.length)} CT-es B2C simulados contra todas as tabelas · {fmtN(tabela.linhas.length)} linhas (CD × destino × faixa).
            {simulados.semIbge > 0 && ` ${fmtN(simulados.semIbge)} sem IBGE foram ignorados.`}
            {tabela.foraDasFaixas > 0 && ` ${fmtN(tabela.foraDasFaixas)} fora das faixas.`}
            {' '}Do 2º colocado em diante o preço é o padrão + acréscimo da posição; capacidade e SLA de cada transportadora são avaliação da operação.
          </div>

          <section className="sim-card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: '0.85rem' }}>
              <div><div style={{ color: '#64748b', fontSize: '0.72rem' }}>Custo realizado (volume da amostra)</div><b style={{ fontSize: '1.2rem' }}>{fmt(totais.realizado)}</b></div>
              <div><div style={{ color: '#64748b', fontSize: '0.72rem' }}>Custo com a tabela padrão</div><b style={{ fontSize: '1.2rem' }}>{fmt(totais.padrao)}</b></div>
              <div><div style={{ color: '#64748b', fontSize: '0.72rem' }}>Diferença</div>
                <b style={{ fontSize: '1.2rem', color: totais.padrao <= totais.realizado ? '#047857' : '#9b1111' }}>
                  {fmt(totais.padrao - totais.realizado)} ({totais.realizado ? (((totais.padrao - totais.realizado) / totais.realizado) * 100).toFixed(1).replace('.', ',') : '0,0'}%)
                </b></div>
            </div>
          </section>

          <section className="sim-card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>Arquivos por transportadora (valor do frete)</div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                  Cada arquivo traz todas as rotas (destino × faixa) que a transportadora atende, com o valor da posição dela no ranking da rota.
                  {simulados.estimadas > 0 && ` ${fmtN(simulados.estimadas)} faixa(s) de peso sem CT-e no período usaram o peso médio da faixa e a NF média geral.`}
                  {simulados.destinosSemVolume > 0 && ` ${fmtN(simulados.destinosSemVolume)} destinos sem nenhum CT-e no histórico entraram pela malha das tabelas.`}
                </div>
              </div>
              <button className="primary" type="button" disabled={gerandoArquivos || !coberturaTransp.length}
                onClick={() => baixarArquivos(coberturaTransp.map((c) => c.transportadora))}>
                {gerandoArquivos ? 'Gerando...' : `Baixar todos (${coberturaTransp.length}) em ZIP`}
              </button>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 280 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Transportadora</th><th style={{ ...th, textAlign: 'right' }}>Destinos</th>
                    <th style={{ ...th, textAlign: 'right' }}>Linhas com valor</th><th style={{ ...th, textAlign: 'right' }}>Estimadas</th>
                    <th style={{ ...th, textAlign: 'right' }}>Faixas sem valor</th><th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {coberturaTransp.map((c) => (
                    <tr key={c.transportadora}>
                      <td style={td}>{c.transportadora}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtN(c.destinos)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtN(c.linhas)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtN(c.estimadas)}</td>
                      <td style={{ ...td, textAlign: 'right', color: c.faltando ? '#9b1111' : '#047857', fontWeight: 700 }}>{c.faltando ? fmtN(c.faltando) : 'nenhuma'}</td>
                      <td style={td}><button type="button" className="sim-tab" style={{ padding: '1px 10px' }} disabled={gerandoArquivos} onClick={() => baixarArquivos([c.transportadora])}>baixar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {vitorias.length > 0 && (
            <section className="sim-card" style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 6 }}>Linhas vencidas por transportadora (1º lugar)</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {vitorias.map(([nome, n]) => (
                  <span key={nome} style={{ background: '#f1f5f9', borderRadius: 999, padding: '3px 12px', fontSize: '0.8rem' }}>
                    <b>{nome}</b> · {fmtN(n)} ({((n / tabela.linhas.length) * 100).toFixed(0)}%)
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="sim-card">
            <div className="sim-form-grid sim-grid-4" style={{ alignItems: 'flex-end', marginBottom: 10 }}>
              <label>CD
                <select value={filtroCd} onChange={(e) => setFiltroCd(e.target.value)} style={{ width: '100%' }}>
                  <option value="">Todos</option>
                  {Array.from(new Set(tabela.linhas.map((l) => l.cd))).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>Destino contém<input value={filtroDestino} onChange={(e) => setFiltroDestino(e.target.value)} placeholder="ex.: São Paulo" /></label>
              <label>Transportadora no pódio
                <select value={filtroTransp} onChange={(e) => setFiltroTransp(e.target.value)} style={{ width: '100%' }}>
                  <option value="">Todas</option>
                  {transpsNoPodio.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="sim-tab" type="button" onClick={() => setVisao(visao === 'ranking' ? 'transportadora' : 'ranking')}>
                  Ver por {visao === 'ranking' ? 'transportadora' : 'ranking'}
                </button>
                <button className="primary" type="button" onClick={exportar}>Exportar Excel</button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              {visao === 'ranking' ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>CD</th><th style={th}>Destino</th><th style={th}>Faixa</th>
                      <th style={{ ...th, textAlign: 'right' }}>CT-es</th>
                      <th style={{ ...th, textAlign: 'right' }}>Realizado</th>
                      <th style={{ ...th, textAlign: 'right' }}>Preço padrão</th>
                      {Array.from({ length: colsPodio }, (_, i) => (
                        <React.Fragment key={i}><th style={th}>{i + 1}º</th><th style={{ ...th, textAlign: 'right' }}>Preço</th></React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linhasFiltradas.slice(0, MAX_LINHAS).map((l) => (
                      <tr key={l.key}>
                        <td style={td}>{l.cd}</td>
                        <td style={td}>{l.destinoLabel}</td>
                        <td style={td}>{l.faixa.label}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{fmtN(l.ctes)}</td>
                        <td style={{ ...td, textAlign: 'right' }} title={l.estimado ? 'Faixa sem CT-e no histórico: preço estimado pelo peso médio' : ''}>{l.realizado == null ? 'estimado' : fmt(l.realizado)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: l.realizado == null ? '#64748b' : l.precoBase <= l.realizado ? '#047857' : '#9b1111' }}>{fmt(l.precoBase)}</td>
                        {Array.from({ length: colsPodio }, (_, i) => i).map((i) => {
                          const p = l.podio[i];
                          return (
                            <React.Fragment key={i}>
                              <td style={{ ...td, fontWeight: i === 0 ? 700 : 400 }} title={p ? `Simulado ${fmt(p.simulado)} · cobertura ${(p.cobertura * 100).toFixed(0)}% · peso ${(p.peso * 100).toFixed(0)}%` : ''}>{p ? p.transportadora : '—'}</td>
                              <td style={{ ...td, textAlign: 'right', fontWeight: i === 0 ? 700 : 400 }}>{p ? fmt(p.precoTabela) : '—'}</td>
                            </React.Fragment>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Transportadora</th><th style={th}>CD</th><th style={th}>Destino</th><th style={th}>Faixa</th>
                      <th style={{ ...th, textAlign: 'right' }}>Posição</th><th style={{ ...th, textAlign: 'right' }}>Preço padrão</th>
                      <th style={{ ...th, textAlign: 'right' }}>Simulado (tabela)</th><th style={{ ...th, textAlign: 'right' }}>CT-es</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porTransp
                      .filter((p) => (!filtroCd || p.cd === filtroCd) && (!filtroTransp || p.transportadora === filtroTransp)
                        && (!filtroDestino || normBusca(p.destino).includes(normBusca(filtroDestino))))
                      .slice(0, MAX_LINHAS).map((p, i) => (
                        <tr key={`${p.transportadora}-${p.cd}-${p.destino}-${p.faixaMin}-${i}`}>
                          <td style={td}>{p.transportadora}</td><td style={td}>{p.cd}</td><td style={td}>{p.destino}</td><td style={td}>{p.faixa}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{p.posicao}º</td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt(p.precoTabela)}</td>
                          <td style={{ ...td, textAlign: 'right', color: '#64748b' }}>{fmt(p.simulado)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{fmtN(p.ctes)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
            {linhasFiltradas.length > MAX_LINHAS && (
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 8 }}>
                Mostrando {MAX_LINHAS} de {fmtN(linhasFiltradas.length)} linhas — filtre ou exporte para o Excel para ver tudo.
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
