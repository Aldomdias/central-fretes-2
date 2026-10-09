import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  baixarModeloAntt, baixarModeloTransportadora, carregarTabelasLotacao, importarTabelaLotacao, obterTabelasPorTipo,
} from '../utils/lotacaoTables';
import {
  carregarTabelasLotacaoSupabase, lotacaoSupabaseConfigurado, resumoRotasLotacaoSupabase,
} from '../services/lotacaoSupabaseService';
import {
  alterarStatusCotacao, carregarCotacao, criarCotacao, excluirConvite, excluirCotacao,
  gerarConvite, linkConviteCotacao, listarCotacoes, renovarConvite,
} from '../services/lotacaoCotacaoService';
import {
  REGRA_ANTT_PADRAO, atualizarRotaCotacao, salvarKmRotas, carregarKmRotas, carregarMapaUfMunicipios, carregarPeriodoRealizado, carregarRegraAntt, importarPropostasConvite, importarReferencia, oficializarProposta, salvarRegraAntt,
} from '../services/lotacaoCotacaoReferenciasService';
import { carregarMatrizIcmsUfCentralizada } from '../utils/icmsUfMatrix';
import { aliquotaDaRota, calcularBruto } from '../utils/lotacaoCotacaoCalculo';
import { buscarKmInternet } from '../services/lotacaoKmService';
import { VEICULO_PADRAO, chavePar, chaveRota, mesmaCidade, norm, splitCidade, veiculoExcluido } from '../utils/lotacaoCotacaoChave';

const brl = (v) => (v == null || v === '' ? '-' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '-' : `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })}%`);
const dataBr = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '-');
const fmtCnpj = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') || '-';
const int = (v) => Math.round(Number(v) || 0).toLocaleString('pt-BR');
const numBr = (v) => {
  const t = String(v ?? '').trim();
  if (!t) return NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};
const pctSinal = (v) => (v == null || !Number.isFinite(v) ? '-' : `${v >= 0 ? '+' : ''}${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const dec1 = (v) => (Number(v) > 0 ? Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '-');

const STATUS_COR = { PENDENTE: '#6B7280', EM_PREENCHIMENTO: '#D97706', ENVIADO: '#1D9E75' };
const STATUS_TXT = { PENDENTE: 'Não acessou', EM_PREENCHIMENTO: 'Preenchendo', ENVIADO: 'Enviado' };
const eRef = (cv) => ['REF_CASA', 'REF_ANTT', 'REF_ANTT_6'].includes(cv.tipo);

const card = { background: '#fff', border: '1px solid #dbe3ef', borderRadius: 14, padding: 20, marginBottom: 18 };
const h2 = { margin: '0 0 4px', fontSize: 18, color: '#06183d' };
const btn = { background: '#185FA5', color: '#fff', border: 0, borderRadius: 8, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' };
const btnSec = { ...btn, background: '#fff', color: '#185FA5', border: '1px solid #185FA5', padding: '6px 10px', fontSize: 12 };
const inp = { padding: '9px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 };
const th = { padding: '8px 6px', background: '#1E3A5F', color: '#fff', fontSize: 12, textAlign: 'center', position: 'sticky', top: 0, whiteSpace: 'nowrap' };
const td = { padding: '6px', borderTop: '1px solid #e5e7eb', fontSize: 12 };
const h3 = { margin: '14px 0 4px', fontSize: 15, color: '#06183d' };
const gridKpi = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, margin: '8px 0 14px' };

// ---------------------------------------------------------------------------
// Rotas da cotacao: partem do REALIZADO (volumetria). As tabelas de lotacao
// existentes nao entram como rota; so ajudam a descobrir a UF da cidade.
// ---------------------------------------------------------------------------
function montarRotas(resumoRealizado, tabelas, mapaUfIbge, kmRotas, meses = 1) {
  const ufAprendida = new Map();
  const aprende = (bruta, ufExplicita) => {
    const { cidade, uf } = splitCidade(bruta);
    const u = String(ufExplicita || uf || '').toUpperCase().slice(0, 2);
    if (cidade && u && !ufAprendida.has(norm(cidade))) ufAprendida.set(norm(cidade), u);
  };
  (tabelas || []).forEach((t) => (t?.linhas || []).forEach((l) => { aprende(l.origem, l.ufOrigem); aprende(l.destino, l.ufDestino); }));
  (resumoRealizado || []).forEach((r) => { aprende(r.origem, r.uf_origem); aprende(r.destino, r.uf_destino); });
  const ufDe = (bruta, explicita) => {
    const { cidade, uf } = splitCidade(bruta);
    return String(explicita || uf || ufAprendida.get(norm(cidade)) || mapaUfIbge?.get(norm(cidade)) || '').toUpperCase().slice(0, 2);
  };

  // nome padrao da cidade: oficial do IBGE em maiusculas (ITAJAI, Itajai e Itajaí viram ITAJAÍ)
  const nomePadrao = (bruta, uf) => {
    const c = splitCidade(bruta).cidade;
    return mapaUfIbge?.nomes?.get(`${norm(c)}|${uf}`) || c.toUpperCase();
  };

  const mapa = new Map();
  (resumoRealizado || []).forEach((r) => {
    const tipo = String(r.tipo_veiculo || r.tipo || '').trim();
    if (!String(r.origem || '').trim() || !String(r.destino || '').trim() || mesmaCidade(r.origem, r.destino) || veiculoExcluido(tipo)) return;
    const chave = chaveRota(r.origem, r.destino);
    const ufo = ufDe(r.origem, r.uf_origem);
    const ufd = ufDe(r.destino, r.uf_destino);
    const atual = mapa.get(chave) || {
      chave, origem: nomePadrao(r.origem, ufo), uf_origem: ufo, destino: nomePadrao(r.destino, ufd),
      uf_destino: ufd, tipo_veiculo: VEICULO_PADRAO, km: null, viagens: 0, _soma: 0, frete_medio: null, target: null,
    };
    const cargas = Number(r.total_cargas || r.qtd_viagens || 0) || 0;
    atual.viagens += cargas;
    atual._soma += (Number(r.frete_medio) || 0) * cargas;
    mapa.set(chave, atual);
  });
  return Array.from(mapa.values()).map(({ _soma, ...r }) => {
    const km = kmRotas?.[chavePar(r.origem, r.destino)] || kmRotas?.[chavePar(r.destino, r.origem)] || null;
    // viagens = MEDIA MENSAL (total do periodo / meses); o frete medio e ponderado pelo total de cargas
    return { ...r, km, viagens: Math.round((r.viagens / Math.max(meses, 1)) * 10) / 10, frete_medio: r.viagens > 0 && _soma > 0 ? _soma / r.viagens : null };
  });
}

// ---------------------------------------------------------------------------
// Excel formatado
// ---------------------------------------------------------------------------
const COR = {
  fixo: { cab: '1E3A5F', cel: 'F1F5F9' }, in: { cab: 'B45309', cel: 'FFF7CC' },
  calc: { cab: '475569', cel: 'E0F0FF' }, cmp: { cab: '166534', cel: 'ECFDF3' },
};

async function gerarExcel({ arquivo, titulo, subtitulo, colunas, linhas, resumo }) {
  const { default: XS } = await import('xlsx-js-style');
  const HR = 4;
  const nc = colunas.length;
  const aoa = [[titulo], [subtitulo || ''], ['Legenda:   CINZA = dados da rota   ·   AMARELO = informado pelo transportador   ·   AZUL = calculado   ·   VERDE = comparativos'], [], colunas.map((c) => c.h)];
  linhas.forEach((l) => aoa.push(colunas.map((c) => {
    const v = c.get(l);
    return v == null || (typeof v === 'number' && !Number.isFinite(v)) ? '' : v;
  })));
  const ws = XS.utils.aoa_to_sheet(aoa);
  const L = 'CBD5E1';
  const borda = { top: { style: 'thin', color: { rgb: L } }, bottom: { style: 'thin', color: { rgb: L } }, left: { style: 'thin', color: { rgb: L } }, right: { style: 'thin', color: { rgb: L } } };
  const est = (r, c, s, z) => {
    const a = XS.utils.encode_cell({ r, c });
    if (!ws[a]) ws[a] = { t: 's', v: '' };
    ws[a].s = s;
    if (z) ws[a].z = z;
  };
  est(0, 0, { font: { bold: true, sz: 16, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '06183D' } }, alignment: { vertical: 'center' } });
  for (let c = 1; c < nc; c += 1) est(0, c, { fill: { patternType: 'solid', fgColor: { rgb: '06183D' } } });
  est(1, 0, { font: { sz: 11, color: { rgb: '334155' } }, alignment: { vertical: 'center' } });
  est(2, 0, { font: { bold: true, sz: 10, color: { rgb: '92400E' } }, fill: { patternType: 'solid', fgColor: { rgb: 'FEF3C7' } }, alignment: { vertical: 'center' } });
  colunas.forEach((c, i) => est(HR, i, { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: COR[c.cor || 'fixo'].cab } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: borda }));
  const FMT = { money: '#,##0.00', pct: '0.0%', pctn: '0.00"%"', int: '#,##0', dec1: '#,##0.0', txt: null };
  linhas.forEach((l, k) => {
    colunas.forEach((c, i) => {
      const v = aoa[HR + 1 + k][i];
      const cor = c.cor || 'fixo';
      const fonte = { sz: 11, bold: !!c.bold, color: { rgb: '0F172A' } };
      if (c.resultado) fonte.color = { rgb: v === 'GANHA' ? '166534' : v === 'PERDE' ? 'B91C1C' : '475569' };
      if (c.resultado) fonte.bold = true;
      const numerica = ['money', 'pct', 'pctn', 'int', 'dec1'].includes(c.t);
      est(HR + 1 + k, i, { font: fonte, fill: { patternType: 'solid', fgColor: { rgb: COR[cor].cel } }, alignment: { horizontal: numerica ? 'right' : (c.resultado ? 'center' : 'left'), vertical: 'center' }, border: borda }, FMT[c.t || 'txt']);
    });
  });
  const ultimaCol = Math.max(nc - 1, 1);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: ultimaCol } }, { s: { r: 1, c: 0 }, e: { r: 1, c: ultimaCol } }, { s: { r: 2, c: 0 }, e: { r: 2, c: ultimaCol } }];
  ws['!rows'] = [{ hpt: 32 }, { hpt: 22 }, { hpt: 20 }, { hpt: 8 }, { hpt: 36 }];
  ws['!cols'] = colunas.map((c) => ({ wch: c.w || 14 }));
  ws['!autofilter'] = { ref: `A${HR + 1}:${XS.utils.encode_col(nc - 1)}${aoa.length}` };
  ws['!views'] = [{ state: 'frozen', ySplit: HR + 1, xSplit: 0 }];
  const wb = XS.utils.book_new();
  XS.utils.book_append_sheet(wb, ws, 'Análise');
  if (resumo?.length) {
    const ws2 = XS.utils.aoa_to_sheet([['RESUMO'], ...resumo]);
    ws2['!cols'] = [{ wch: 46 }, { wch: 40 }];
    ws2.A1.s = { font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '06183D' } } };
    resumo.forEach((r, i) => {
      const a = XS.utils.encode_cell({ r: i + 1, c: 0 });
      const b = XS.utils.encode_cell({ r: i + 1, c: 1 });
      if (ws2[a]) ws2[a].s = { font: { bold: true, sz: 11 }, fill: { patternType: 'solid', fgColor: { rgb: 'F1F5F9' } }, border: borda };
      if (ws2[b]) ws2[b].s = { font: { sz: 11 }, alignment: { horizontal: 'right' }, border: borda };
    });
    XS.utils.book_append_sheet(wb, ws2, 'Resumo');
  }
  XS.writeFile(wb, arquivo);
}

// ---------------------------------------------------------------------------
// Cartao de tabela de referencia (TransGP / ANTT)
// ---------------------------------------------------------------------------
function CartaoReferencia({ tipo, titulo, descricao, convite, qtd, ocupado, onImportar, onRemover, onModelo, baseInicial }) {
  const [base, setBase] = useState(baseInicial);
  const ref = useRef(null);
  return (
    <div style={{ flex: 1, minWidth: 320, border: '1px solid #cbd5e1', borderRadius: 12, padding: 14, background: convite ? '#f0fdf4' : '#fff' }}>
      <b style={{ fontSize: 15 }}>{titulo}</b>
      <div style={{ fontSize: 12, color: '#475569', margin: '2px 0 8px' }}>{descricao}</div>
      {convite ? (
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          ✅ <b>{qtd} rotas</b> importadas{convite.respondente_nome ? ` (${convite.respondente_nome})` : ''} em {dataBr(convite.enviado_em)}
        </div>
      ) : <div style={{ fontSize: 13, marginBottom: 8, color: '#92400e' }}>Ainda não importada.</div>}
      <label style={{ fontSize: 12, fontWeight: 700 }}>Os valores do arquivo são:{' '}
        <select value={base} onChange={(e) => setBase(e.target.value)} style={{ ...inp, padding: '4px 6px', fontSize: 12 }}>
          <option value="LIQUIDO">Líquidos (sem ICMS)</option>
          <option value="BRUTO">Brutos (com ICMS)</option>
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button style={btn} disabled={ocupado} onClick={() => ref.current?.click()}>{convite ? 'Reimportar' : 'Importar'} {tipo === 'REF_ANTT' ? 'ANTT' : 'TransGP'}</button>
        <button style={btnSec} onClick={onModelo}>Baixar modelo</button>
        {convite && <button style={btnSec} onClick={onRemover}>Remover</button>}
        <input ref={ref} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onImportar(f, base); }} />
      </div>
    </div>
  );
}

function Kpi({ titulo, valor, sub, cor }) {
  return (
    <div style={{ border: '1px solid #dbe3ef', borderRadius: 12, padding: '10px 14px', background: '#f8fafc' }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: cor || '#06183d' }}>{valor}</div>
      {sub ? <div style={{ fontSize: 11, color: '#64748b' }}>{sub}</div> : null}
    </div>
  );
}

function Medidor({ titulo, valor, sub, cor = '#185FA5' }) {
  const v = Math.max(0, Math.min(1, Number(valor) || 0));
  return (
    <div style={{ border: '1px solid #dbe3ef', borderRadius: 12, padding: '10px 14px', background: '#fff' }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{titulo}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: cor }}>{(v * 100).toFixed(0)}%</div>
      <div style={{ background: '#e2e8f0', borderRadius: 6, height: 8, margin: '4px 0' }}><div style={{ width: `${v * 100}%`, background: cor, height: 8, borderRadius: 6 }} /></div>
      {sub ? <div style={{ fontSize: 11, color: '#64748b' }}>{sub}</div> : null}
    </div>
  );
}

// Rotas sem KM ou sem UF: completa pela internet ou informa na mao
function CartaoKm({ rotas, ocupado, progresso, onCompletar, onSalvarRota }) {
  const [edit, setEdit] = useState({});
  const lista = rotas.filter((r) => !(Number(r.km) > 0) || !r.uf_origem || !r.uf_destino);
  if (!lista.length) return null;
  const semKm = lista.filter((r) => !(Number(r.km) > 0)).length;
  const set = (chave, campo, v) => setEdit({ ...edit, [chave]: { ...(edit[chave] || {}), [campo]: v } });
  return (
    <div style={{ ...card, border: '2px solid #fcd34d', background: '#fffbeb' }}>
      <h2 style={h2}>Rotas sem KM ou sem UF ({lista.length})</h2>
      <small>O KM alimenta a ANTT (KM × CCD + CC) e a UF define o ICMS. Complete pela internet ou informe na mão.</small>
      <div style={{ margin: '10px 0', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={btn} disabled={ocupado || !semKm} onClick={onCompletar}>Completar KM pela internet ({semKm})</button>
        {progresso ? <span style={{ fontSize: 12, color: '#475569' }}>{progresso}</span> : null}
      </div>
      <div style={{ overflow: 'auto', maxHeight: 260 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Origem', 'UF', 'Destino', 'UF', 'KM', 'Viagens/mês', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {lista.slice(0, 40).map((r) => {
              const e = edit[r.chave] || {};
              return (
                <tr key={r.chave}>
                  <td style={td}>{r.origem}</td>
                  <td style={td}>{r.uf_origem || <input style={{ ...inp, width: 48, padding: '3px 5px' }} maxLength={2} value={e.uf_origem || ''} onChange={(ev) => set(r.chave, 'uf_origem', ev.target.value.toUpperCase())} />}</td>
                  <td style={td}>{r.destino}</td>
                  <td style={td}>{r.uf_destino || <input style={{ ...inp, width: 48, padding: '3px 5px' }} maxLength={2} value={e.uf_destino || ''} onChange={(ev) => set(r.chave, 'uf_destino', ev.target.value.toUpperCase())} />}</td>
                  <td style={td}>{Number(r.km) > 0 ? int(r.km) : <input style={{ ...inp, width: 80, padding: '3px 5px' }} inputMode="numeric" placeholder="km" value={e.km || ''} onChange={(ev) => set(r.chave, 'km', ev.target.value)} />}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{dec1(r.viagens)}</td>
                  <td style={td}><button style={btnSec} disabled={ocupado} onClick={() => onSalvarRota(r, e)}>Salvar</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {lista.length > 40 ? <small>Mostrando 40 de {lista.length}.</small> : null}
    </div>
  );
}

function CartaoRegraAntt({ regra, onSalvar, ocupado }) {
  const [r, setR] = useState(regra);
  useEffect(() => { setR(regra); }, [regra]);
  const set = (eixos, campo, v) => setR({ ...r, [eixos]: { ...r[eixos], [campo]: v } });
  return (
    <div style={{ flex: 1, minWidth: 340, border: '1px solid #cbd5e1', borderRadius: 12, padding: 14, background: '#f0fdf4' }}>
      <b style={{ fontSize: 15 }}>ANTT — regra de cálculo (Tabela B)</b>
      <div style={{ fontSize: 12, color: '#475569', margin: '2px 0 8px' }}>
        Valor = KM × CCD + CC (só o veículo automotor, retorno vazio fora). Calculado na hora com o KM de cada rota: não existe tabela para importar nem manter.
      </div>
      {[5, 6].map((e) => (
        <div key={e} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' }}>
          <b style={{ width: 62 }}>{e} eixos</b>
          <label style={{ fontSize: 12 }}>CCD <input style={{ ...inp, width: 90, padding: '4px 6px' }} value={r[e]?.ccd ?? ''} onChange={(ev) => set(e, 'ccd', ev.target.value)} /></label>
          <label style={{ fontSize: 12 }}>CC <input style={{ ...inp, width: 90, padding: '4px 6px' }} value={r[e]?.cc ?? ''} onChange={(ev) => set(e, 'cc', ev.target.value)} /></label>
          <span style={{ fontSize: 12, color: '#475569' }}>ex.: 1.500 km = {brl(1500 * numBr(r[e]?.ccd) + (numBr(r[e]?.cc) || 0))}</span>
        </div>
      ))}
      <label style={{ fontSize: 12, fontWeight: 700 }}>O valor da fórmula é:{' '}
        <select value={r.base} onChange={(e) => setR({ ...r, base: e.target.value })} style={{ ...inp, padding: '4px 6px', fontSize: 12 }}>
          <option value="LIQUIDO">Líquido (sem ICMS) — o ICMS da rota é somado na comparação</option>
          <option value="BRUTO">Bruto (já com ICMS)</option>
        </select>
      </label>
      <div style={{ marginTop: 10 }}><button style={btn} disabled={ocupado} onClick={() => onSalvar(r)}>Salvar regra</button></div>
    </div>
  );
}

export default function LotacaoCotacaoPage() {
  const usarSupabase = lotacaoSupabaseConfigurado();
  const [tabelas, setTabelas] = useState([]);
  const [resumoRealizado, setResumoRealizado] = useState([]);
  const [kmRotas, setKmRotas] = useState({});
  const [mapaUf, setMapaUf] = useState(null);
  const [periodo, setPeriodo] = useState(null);
  const [regraAntt, setRegraAntt] = useState(REGRA_ANTT_PADRAO);
  const [matriz, setMatriz] = useState([]);
  const [cotacoes, setCotacoes] = useState([]);
  const [cotacaoId, setCotacaoId] = useState('');
  const [dados, setDados] = useState({ convites: [], rotas: [], propostas: [] });
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [ocupado, setOcupado] = useState(false);
  const [nomeCotacao, setNomeCotacao] = useState('');
  const [nomeTransp, setNomeTransp] = useState('');
  const [dias, setDias] = useState(5);
  const [ultimoLink, setUltimoLink] = useState(null);
  const [selId, setSelId] = useState('');
  const [filtro, setFiltro] = useState('todas');
  const [oficial, setOficial] = useState(null);
  const [alvoImport, setAlvoImport] = useState(null);
  const arqProposta = useRef(null);

  const aviso = (texto, tipo = 'ok') => setMsg({ tipo, texto });

  useEffect(() => {
    (async () => {
      try {
        const resp = usarSupabase ? await carregarTabelasLotacaoSupabase() : { tabelas: carregarTabelasLotacao() };
        setTabelas(resp.tabelas || []);
      } catch { setTabelas(carregarTabelasLotacao()); }
      if (usarSupabase) resumoRotasLotacaoSupabase({}).then((d) => setResumoRealizado(d || [])).catch(() => {});
      carregarKmRotas().then(setKmRotas);
      carregarMapaUfMunicipios().then(setMapaUf);
      carregarPeriodoRealizado().then(setPeriodo);
      carregarRegraAntt().then(setRegraAntt);
      carregarMatrizIcmsUfCentralizada().then((r) => setMatriz(r?.linhas || [])).catch(() => {});
    })();
  }, [usarSupabase]);

  const nomesTransportadoras = useMemo(() => obterTabelasPorTipo(tabelas, 'TRANSPORTADORA').map((t) => t.nome), [tabelas]);
  const rotasRealizado = useMemo(() => montarRotas(resumoRealizado, tabelas, mapaUf, kmRotas, periodo?.meses || 1), [resumoRealizado, tabelas, mapaUf, kmRotas, periodo]);

  const recarregarLista = useCallback(async () => {
    try {
      const lista = await listarCotacoes();
      setCotacoes(lista);
      setCotacaoId((atual) => atual || lista.find((c) => c.status === 'ABERTA')?.id || lista[0]?.id || '');
    } catch (e) { aviso(`Cotação indisponível (migration aplicada?): ${e.message}`, 'erro'); }
  }, []);
  useEffect(() => { recarregarLista(); }, [recarregarLista]);

  const recarregarDados = useCallback(async (id = cotacaoId) => {
    if (!id) { setDados({ convites: [], rotas: [], propostas: [] }); return null; }
    try { const d = await carregarCotacao(id); setDados(d); return d; } catch (e) { aviso(e.message, 'erro'); return null; }
  }, [cotacaoId]);
  useEffect(() => { recarregarDados(); }, [recarregarDados]);

  const cotacaoAtual = cotacoes.find((c) => c.id === cotacaoId);

  // garante uma cotacao (cria sozinha, com as rotas do realizado) e devolve id + rotas
  const garantirCotacao = async () => {
    if (cotacaoId) return { id: cotacaoId, rotas: dados.rotas };
    if (!rotasRealizado.length) throw new Error('Ainda não há rotas do realizado carregadas para montar a cotação.');
    const cot = await criarCotacao({ nome: `Cotação lotação ${new Date().toLocaleDateString('pt-BR')}`, periodoLabel: 'Realizado', rotas: rotasRealizado });
    await recarregarLista();
    setCotacaoId(cot.id);
    const d = await carregarCotacao(cot.id);
    setDados(d);
    return { id: cot.id, rotas: d.rotas };
  };

  const criarNova = async () => {
    if (!nomeCotacao.trim()) { aviso('Dê um nome à cotação.', 'erro'); return; }
    if (!rotasRealizado.length) { aviso('Ainda não há rotas do realizado carregadas.', 'erro'); return; }
    setOcupado(true);
    try {
      const cot = await criarCotacao({ nome: nomeCotacao.trim(), periodoLabel: 'Realizado', rotas: rotasRealizado });
      setNomeCotacao('');
      await recarregarLista();
      setCotacaoId(cot.id);
      aviso(`Cotação criada com ${rotasRealizado.length} rotas/tipos de veículo do realizado.`);
    } catch (e) { aviso(`Erro ao criar: ${e.message}`, 'erro'); } finally { setOcupado(false); }
  };

  // ---------- indices ----------
  const rotasPorChave = useMemo(() => new Map(dados.rotas.map((r) => [r.chave, r])), [dados.rotas]);
  const propMap = useMemo(() => {
    const m = new Map();
    dados.propostas.forEach((p) => { if (!m.has(p.convite_id)) m.set(p.convite_id, new Map()); m.get(p.convite_id).set(p.chave, p); });
    return m;
  }, [dados.propostas]);
  const conviteCasa = dados.convites.find((c) => c.tipo === 'REF_CASA');
  // ANTT calculada pela regra cadastrada (KM x CCD + CC), em valor bruto para comparar com as propostas
  const anttBrutoRota = useCallback((r, eixos) => {
    const reg = regraAntt[Number(eixos) === 6 ? 6 : 5];
    const ccd = numBr(reg?.ccd);
    const cc = numBr(reg?.cc) || 0;
    const km = Number(r.km);
    if (!(km > 0) || !(ccd > 0)) return null;
    const valor = km * ccd + cc;
    if (regraAntt.base === 'BRUTO') return Math.round(valor * 100) / 100;
    return calcularBruto(valor, aliquotaDaRota(matriz, r.uf_origem, r.uf_destino).aliquota).bruto;
  }, [regraAntt, matriz]);
  const salvarRegra = async (nova) => {
    setOcupado(true);
    try { await salvarRegraAntt(nova); setRegraAntt(nova); aviso('Regra da ANTT salva. A análise já foi recalculada.'); } catch (e) { aviso(`Erro ao salvar a regra: ${e.message}`, 'erro'); } finally { setOcupado(false); }
  };
  const transportadores = useMemo(() => dados.convites.filter((c) => !eRef(c)), [dados.convites]);

  // ---------- referencias ----------
  const importarRef = async (tipo, file, base) => {
    setOcupado(true);
    try {
      const { id, rotas } = await garantirCotacao();
      const nomeRef = tipo === 'REF_ANTT_6' ? 'ANTT 6 eixos' : tipo === 'REF_ANTT' ? 'ANTT 5 eixos' : 'TransGP';
      const tabela = await importarTabelaLotacao(file, { tipo: tipo.startsWith('REF_ANTT') ? 'ANTT' : 'TRANSPORTADORA', nomePadrao: nomeRef });
      const res = await importarReferencia({ cotacaoId: id, tipo, nome: nomeRef, arquivo: file.name, linhas: tabela.linhas, base, matriz, rotasPorChave: new Map(rotas.map((r) => [r.chave, r])) });
      await recarregarDados(id);
      aviso(`${nomeRef}: ${res.rotas} rotas importadas${res.novasRotas ? ` (${res.novasRotas} rotas novas entraram na cotação)` : ''}.`);
    } catch (e) { aviso(`Erro ao importar: ${e.message}`, 'erro'); } finally { setOcupado(false); }
  };

  // ---------- links ----------
  const gerar = async () => {
    if (!nomeTransp.trim()) { aviso('Digite o nome do transportador.', 'erro'); return; }
    setOcupado(true);
    try {
      const { id } = await garantirCotacao();
      const cv = await gerarConvite({ cotacaoId: id, transportadora: nomeTransp.trim(), dias });
      setUltimoLink(cv);
      setNomeTransp('');
      await recarregarDados(id);
      aviso(`Link gerado para ${cv.transportadora}, válido por ${dias} dias.`);
    } catch (e) { aviso(e.message, 'erro'); } finally { setOcupado(false); }
  };
  const copiar = (token) => navigator.clipboard?.writeText(linkConviteCotacao(token)).then(() => aviso('Link copiado.'));
  const email = (cv) => {
    const assunto = encodeURIComponent(`Cotação de frete lotação — ${cotacaoAtual?.nome || ''}`);
    const ate = cv.expira_em ? `\nO link vale até ${dataBr(cv.expira_em)}.` : '';
    const corpo = encodeURIComponent(`Olá, ${cv.transportadora}!\n\nSegue o link para preenchimento da nossa tabela de lotação:\n${linkConviteCotacao(cv.token)}\n\nInforme o valor LÍQUIDO (sem ICMS) de cada rota; o ICMS e o valor bruto são calculados automaticamente. No primeiro acesso você informa o CNPJ da transportadora (obrigatório).${ate}\n\nObrigado!`);
    window.location.href = `mailto:?subject=${assunto}&body=${corpo}`;
  };
  const expirado = (cv) => cv.expira_em && new Date(cv.expira_em).getTime() < Date.now();

  // ---------- importar proposta preenchida (admin) ----------
  const importarProposta = async (file) => {
    const cv = alvoImport;
    if (!cv) return;
    setOcupado(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      let hi = -1;
      for (let r = 0; r < Math.min(rows.length, 15); r += 1) {
        const j = rows[r].map(norm).join('|');
        if (j.includes('CHAVE') || (j.includes('ORIGEM') && j.includes('DESTINO'))) { hi = r; break; }
      }
      if (hi < 0) throw new Error('Não encontrei o cabeçalho. Use o modelo baixado no portal.');
      const cab = rows[hi].map(norm);
      const col = (re) => cab.findIndex((c) => re.test(c));
      const cCh = col(/^CHAVE/); const cO = col(/^ORIGEM/); const cD = col(/^DESTINO/); const cV = col(/^VEICULO|^TIPO/);
      const cL = col(/LIQUIDO/); const cZ = col(/^PRAZO/); const cOb = col(/^OBS/);
      if (cL < 0) throw new Error('Coluna "Valor líquido" não encontrada.');
      const num = (v) => {
        if (v === '' || v == null) return null;
        if (typeof v === 'number') return v;
        let t = String(v).replace(/R\$/gi, '').replace(/\s/g, '');
        if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      };
      let eixos = null;
      for (let q = 0; q < hi; q += 1) {
        rows[q].forEach((c, z) => {
          if (norm(c).startsWith('EIXOS')) { const ev = Number(rows[q].slice(z + 1).find((x) => Number(x) === 5 || Number(x) === 6)); if (ev === 5 || ev === 6) eixos = ev; }
        });
      }
      const itens = [];
      rows.slice(hi + 1).forEach((row) => {
        let chave = cCh >= 0 && rotasPorChave.has(row[cCh]) ? row[cCh] : null;
        if (!chave && cO >= 0 && cD >= 0) { const k = chaveRota(row[cO], row[cD]); if (rotasPorChave.has(k)) chave = k; }
        const liquido = num(row[cL]);
        if (chave && liquido > 0) itens.push({ chave, liquido, prazo: cZ >= 0 ? parseInt(row[cZ], 10) || null : null, obs: cOb >= 0 ? String(row[cOb] || '') : '' });
      });
      const n = await importarPropostasConvite({ convite: cv, cotacaoId, itens, rotasPorChave, matriz, eixos });
      await recarregarDados();
      setSelId(cv.id);
      aviso(`${n} rotas importadas para ${cv.transportadora}. A análise já está atualizada abaixo.`);
    } catch (e) { aviso(`Erro ao importar proposta: ${e.message}`, 'erro'); } finally { setOcupado(false); setAlvoImport(null); }
  };

  // ---------- analise ----------
  const analisar = useCallback((cv) => {
    const escopoSet = Array.isArray(cv.chaves) ? new Set(cv.chaves) : null;
    const escopo = dados.rotas.filter((r) => !escopoSet || escopoSet.has(r.chave));
    const meus = propMap.get(cv.id) || new Map();
    const casa = conviteCasa ? propMap.get(conviteCasa.id) : null;
    const outros = transportadores.filter((o) => o.id !== cv.id && propMap.get(o.id)?.size);
    const cmp = (b, ref) => (!(ref > 0) ? null : (b < ref * 0.9995 ? 'GANHA' : b > ref * 1.0005 ? 'PERDE' : 'EMPATA'));
    const chaveRes = (r) => (r === 'GANHA' ? 'g' : r === 'PERDE' ? 'p' : 'e');
    const S = {
      escopo: escopo.length, volTot: 0, volCot: 0, cotadas: 0, casa: { g: 0, p: 0, e: 0 }, antt: { g: 0, p: 0, e: 0 },
      menor: { g: 0, comp: 0 }, real: { g: 0, p: 0, e: 0, comp: 0 }, econGanhas: 0, impacto: 0, custoReal: 0, custoProp: 0,
    };
    const linhas = [];
    escopo.forEach((r) => {
      S.volTot += Number(r.viagens) || 0;
      const p = meus.get(r.chave);
      if (!p) return;
      const b = Number(p.valor_bruto);
      const vi = Number(r.viagens) || 0;
      S.cotadas += 1;
      S.volCot += vi;
      const vc = casa?.get(r.chave)?.valor_bruto != null ? Number(casa.get(r.chave).valor_bruto) : null;
      const va = anttBrutoRota(r, p.eixos ?? cv.eixos);
      let menorOutro = null;
      outros.forEach((o) => {
        const q = propMap.get(o.id).get(r.chave);
        if (q && (!menorOutro || Number(q.valor_bruto) < menorOutro.v)) menorOutro = { nome: o.transportadora, v: Number(q.valor_bruto) };
      });
      const real = Number(r.frete_medio) > 0 ? Number(r.frete_medio) : null;
      const rc = cmp(b, vc); const ra = cmp(b, va); const rr = cmp(b, real);
      if (rc) S.casa[chaveRes(rc)] += 1;
      if (ra) S.antt[chaveRes(ra)] += 1;
      if (menorOutro) { S.menor.comp += 1; if (b < menorOutro.v) S.menor.g += 1; }
      if (rr) {
        S.real.comp += 1;
        S.real[chaveRes(rr)] += 1;
        if (vi > 0) {
          S.impacto += (real - b) * vi; S.custoReal += real * vi; S.custoProp += b * vi;
          if (rr === 'GANHA') S.econGanhas += (real - b) * vi;
        }
      }
      linhas.push({
        r, p, b, vc, va, eixo: Number(p.eixos ?? cv.eixos) === 6 ? 6 : 5, menorOutro, real, rc, ra, rr, dCasa: vc > 0 ? b / vc - 1 : null, dAntt: va > 0 ? b / va - 1 : null, dReal: real > 0 ? b / real - 1 : null,
      });
    });
    linhas.sort((x, y) => (Number(y.r.viagens) || 0) - (Number(x.r.viagens) || 0));
    return { S, linhas };
  }, [dados.rotas, propMap, conviteCasa, anttBrutoRota, transportadores]);

  const comparativo = useMemo(
    () => transportadores.filter((c) => propMap.get(c.id)?.size).map((c) => ({ cv: c, ...analisar(c) })),
    [transportadores, propMap, analisar],
  );
  const selecionado = comparativo.find((x) => x.cv.id === selId) || comparativo[0] || null;

  const linhasFiltradas = useMemo(() => {
    if (!selecionado) return [];
    return selecionado.linhas.filter((l) => {
      if (filtro === 'ganha-real') return l.rr === 'GANHA';
      if (filtro === 'perde-real') return l.rr === 'PERDE';
      if (filtro === 'ganha-casa') return l.rc === 'GANHA';
      if (filtro === 'perde-casa') return l.rc === 'PERDE';
      return true;
    });
  }, [selecionado, filtro]);

  // ---------- realizado (visao geral, independe das propostas) ----------
  const R = useMemo(() => {
    const rs = dados.rotas.length ? dados.rotas : rotasRealizado;
    const casa = conviteCasa ? propMap.get(conviteCasa.id) : null;
    const t = { rotas: rs.length, comKm: 0, viagens: 0, gasto: 0, vReal: 0, kmv: 0, vkm: 0, gA: 0, rA: 0, nA: 0, gT: 0, rT: 0, nT: 0 };
    rs.forEach((r) => {
      const v = Number(r.viagens) || 0;
      const real = Number(r.frete_medio) || 0;
      t.viagens += v;
      if (real > 0) { t.gasto += real * v; t.vReal += v; }
      if (Number(r.km) > 0) { t.comKm += 1; if (real > 0) { t.kmv += Number(r.km) * v; t.vkm += real * v; } }
      const a = anttBrutoRota(r, 5);
      if (a > 0 && real > 0 && v > 0) { t.rA += real * v; t.gA += a * v; t.nA += 1; }
      const tg = Number(casa?.get(r.chave)?.valor_bruto);
      if (tg > 0 && real > 0 && v > 0) { t.rT += real * v; t.gT += tg * v; t.nT += 1; }
    });
    const top = [...rs].sort((x, y) => (Number(y.viagens) || 0) - (Number(x.viagens) || 0)).slice(0, 15).map((r) => {
      const a = anttBrutoRota(r, 5);
      const tg = casa?.get(r.chave)?.valor_bruto != null ? Number(casa.get(r.chave).valor_bruto) : null;
      const real = Number(r.frete_medio) > 0 ? Number(r.frete_medio) : null;
      return { r, a, tg, real, dA: a > 0 && real ? real / a - 1 : null, dT: tg > 0 && real ? real / tg - 1 : null, rkm: real && Number(r.km) > 0 ? real / Number(r.km) : null };
    });
    return {
      ...t, medio: t.vReal ? t.gasto / t.vReal : 0, rkm: t.kmv ? t.vkm / t.kmv : null,
      vsAntt: t.gA > 0 ? t.rA / t.gA - 1 : null, vsTrans: t.gT > 0 ? t.rT / t.gT - 1 : null, top,
    };
  }, [dados.rotas, rotasRealizado, propMap, conviteCasa, anttBrutoRota]);

  // ---------- KM: completar pela internet / informar na mao ----------
  const [progressoKm, setProgressoKm] = useState('');
  const completarKm = async () => {
    const alvo = dados.rotas.filter((r) => !(Number(r.km) > 0) && r.uf_origem && r.uf_destino);
    if (!alvo.length || !cotacaoId) { aviso('Nenhuma rota com UF conhecida e sem KM para buscar.', 'erro'); return; }
    setOcupado(true);
    try {
      const { achados, falhas } = await buscarKmInternet(alvo, setProgressoKm);
      const novoMapa = { ...kmRotas };
      for (const [chave, km] of Object.entries(achados)) {
        const r = rotasPorChave.get(chave);
        if (!r) continue;
        novoMapa[chavePar(r.origem, r.destino)] = km;
        await atualizarRotaCotacao(cotacaoId, chave, { km });
      }
      await salvarKmRotas(novoMapa);
      setKmRotas(novoMapa);
      await recarregarDados();
      aviso(`KM preenchido em ${Object.keys(achados).length} rota(s) pela internet${falhas.length ? `; ${falhas.length} não encontrada(s) (informe na mão abaixo)` : ''}.`);
    } catch (e) { aviso(`Erro ao buscar o KM: ${e.message}`, 'erro'); } finally { setOcupado(false); setProgressoKm(''); }
  };
  const salvarRotaManual = async (r, e) => {
    const campos = {};
    const km = numBr(e.km);
    if (km > 0) campos.km = Math.round(km);
    if (e.uf_origem && e.uf_origem.length === 2) campos.uf_origem = e.uf_origem;
    if (e.uf_destino && e.uf_destino.length === 2) campos.uf_destino = e.uf_destino;
    if (!Object.keys(campos).length) { aviso('Preencha o KM e/ou a UF antes de salvar.', 'erro'); return; }
    setOcupado(true);
    try {
      await atualizarRotaCotacao(cotacaoId, r.chave, campos);
      if (campos.km) {
        const novoMapa = { ...kmRotas, [chavePar(r.origem, r.destino)]: campos.km };
        await salvarKmRotas(novoMapa);
        setKmRotas(novoMapa);
      }
      await recarregarDados();
      aviso(`Rota ${r.origem} → ${r.destino} atualizada.`);
    } catch (err) { aviso(`Erro ao salvar a rota: ${err.message}`, 'erro'); } finally { setOcupado(false); }
  };

  // ---------- exportar ----------
  const exportarProposta = async () => {
    if (!selecionado) return;
    const { cv, S, linhas } = selecionado;
    const colunas = [
      { h: 'Origem', w: 26, bold: true, get: (l) => l.r.origem }, { h: 'UF origem', w: 9, get: (l) => l.r.uf_origem },
      { h: 'Destino', w: 28, bold: true, get: (l) => l.r.destino }, { h: 'UF destino', w: 9, get: (l) => l.r.uf_destino },
      { h: 'Veículo', w: 18, get: (l) => l.r.tipo_veiculo }, { h: 'KM', w: 8, t: 'int', get: (l) => l.r.km },
      { h: 'Média mensal (viagens)', w: 13, t: 'dec1', get: (l) => l.r.viagens },
      { h: 'ICMS %', w: 9, t: 'pctn', cor: 'calc', get: (l) => l.p.aliquota_icms },
      { h: 'Valor líquido (R$)', w: 18, t: 'money', cor: 'in', get: (l) => Number(l.p.valor_liquido) },
      { h: 'ICMS (R$)', w: 13, t: 'money', cor: 'calc', get: (l) => Number(l.p.icms_valor) },
      { h: 'Valor bruto total (R$)', w: 20, t: 'money', cor: 'calc', bold: true, get: (l) => l.b },
      { h: 'Prazo (dias)', w: 11, t: 'int', cor: 'in', get: (l) => l.p.prazo_dias }, { h: 'Observação', w: 28, cor: 'in', get: (l) => l.p.observacao },
      { h: 'TransGP bruto (R$)', w: 17, t: 'money', cor: 'cmp', get: (l) => l.vc }, { h: 'Δ % vs TransGP', w: 13, t: 'pct', cor: 'cmp', get: (l) => l.dCasa }, { h: 'vs TransGP', w: 11, cor: 'cmp', resultado: true, get: (l) => l.rc },
      { h: `ANTT ${Number(cv.eixos) === 6 ? 6 : 5} eixos bruto (R$)`, w: 20, t: 'money', cor: 'cmp', get: (l) => l.va }, { h: 'Δ % vs ANTT', w: 12, t: 'pct', cor: 'cmp', get: (l) => l.dAntt }, { h: 'vs ANTT', w: 10, cor: 'cmp', resultado: true, get: (l) => l.ra },
      { h: 'Menor outro transportador (R$)', w: 22, t: 'money', cor: 'cmp', get: (l) => l.menorOutro?.v }, { h: 'Quem', w: 22, cor: 'cmp', get: (l) => l.menorOutro?.nome },
      { h: 'Realizado médio (R$)', w: 18, t: 'money', cor: 'cmp', get: (l) => l.real }, { h: 'Δ % vs realizado', w: 14, t: 'pct', cor: 'cmp', get: (l) => l.dReal }, { h: 'vs realizado', w: 12, cor: 'cmp', resultado: true, get: (l) => l.rr },
    ];
    const resumo = [
      ['Transportador', cv.transportadora], ['Eixos do veículo', Number(cv.eixos) === 6 ? 6 : 5], ['CNPJ informado', fmtCnpj(cv.respondente_cnpj)], ['Respondente', cv.respondente_nome ? `${cv.respondente_nome} (${cv.respondente_email})` : '-'],
      ['Rotas cotadas / rotas da cotação', `${S.cotadas} / ${S.escopo}`], ['Aderência (rotas)', pct(S.escopo ? S.cotadas / S.escopo : null)], ['Aderência (volume)', pct(S.volTot ? S.volCot / S.volTot : null)],
      ['Ganha da TransGP', `${S.casa.g} de ${S.casa.g + S.casa.p + S.casa.e}`], ['Ganha da ANTT', `${S.antt.g} de ${S.antt.g + S.antt.p + S.antt.e}`],
      ['Menor preço entre os transportadores', `${S.menor.g} de ${S.menor.comp}`], ['Ganha do realizado', `${S.real.g} de ${S.real.comp}`],
      ['Economia nas rotas que ganha (R$)', Math.round(S.econGanhas)], ['Impacto líquido vs realizado (R$)', Math.round(S.impacto)],
    ];
    await gerarExcel({
      arquivo: `proposta-${String(cv.transportadora).replace(/[^a-z0-9]+/gi, '-')}.xlsx`,
      titulo: `PROPOSTA DE LOTAÇÃO — ${cv.transportadora}`,
      subtitulo: `${cotacaoAtual?.nome || ''} · bruto = líquido ÷ (1 − ICMS) · comparativos em valor bruto`,
      colunas, linhas, resumo,
    });
  };

  const exportarComparativo = async () => {
    if (!comparativo.length) return;
    const todas = new Map();
    comparativo.forEach(({ linhas }) => linhas.forEach((l) => { if (!todas.has(l.r.chave)) todas.set(l.r.chave, l.r); }));
    const rotas = Array.from(todas.values()).sort((a, b) => (Number(b.viagens) || 0) - (Number(a.viagens) || 0));
    const colunas = [
      { h: 'Origem', w: 26, bold: true, get: (r) => r.origem }, { h: 'UF origem', w: 9, get: (r) => r.uf_origem }, { h: 'Destino', w: 28, bold: true, get: (r) => r.destino },
      { h: 'UF destino', w: 9, get: (r) => r.uf_destino }, { h: 'Veículo', w: 18, get: (r) => r.tipo_veiculo }, { h: 'KM', w: 8, t: 'int', get: (r) => r.km }, { h: 'Média mensal (viagens)', w: 13, t: 'dec1', get: (r) => r.viagens },
      { h: 'Realizado médio (R$)', w: 18, t: 'money', cor: 'cmp', get: (r) => (Number(r.frete_medio) > 0 ? Number(r.frete_medio) : null) },
      { h: 'TransGP bruto (R$)', w: 17, t: 'money', cor: 'cmp', get: (r) => propMap.get(conviteCasa?.id)?.get(r.chave)?.valor_bruto },
      { h: 'ANTT 5 eixos bruto (R$)', w: 20, t: 'money', cor: 'cmp', get: (r) => anttBrutoRota(r, 5) },
      { h: 'ANTT 6 eixos bruto (R$)', w: 20, t: 'money', cor: 'cmp', get: (r) => anttBrutoRota(r, 6) },
      ...comparativo.map(({ cv }) => ({ h: `${cv.transportadora} (${Number(cv.eixos) === 6 ? 6 : 5} eixos) bruto (R$)`, w: 20, t: 'money', cor: 'calc', get: (r) => propMap.get(cv.id)?.get(r.chave)?.valor_bruto })),
      {
        h: 'Menor transportador', w: 22, cor: 'in', bold: true,
        get: (r) => {
          let m = null;
          comparativo.forEach(({ cv }) => { const q = propMap.get(cv.id)?.get(r.chave); if (q && (!m || Number(q.valor_bruto) < m.v)) m = { n: cv.transportadora, v: Number(q.valor_bruto) }; });
          return m?.n;
        },
      },
    ];
    await gerarExcel({
      arquivo: 'comparativo-cotacao-lotacao.xlsx', titulo: 'COMPARATIVO DA COTAÇÃO DE LOTAÇÃO',
      subtitulo: `${cotacaoAtual?.nome || ''} · valores brutos (com ICMS) · ${comparativo.length} transportador(es)`,
      colunas, linhas: rotas,
      resumo: comparativo.map(({ cv, S }) => [cv.transportadora, `${S.cotadas}/${S.escopo} rotas · ganha do realizado ${S.real.g}/${S.real.comp}`]),
    });
  };

  // ---------- enviar para a Tabela de Lotacao ----------
  const confirmarOficial = async () => {
    const { cv, base } = oficial;
    setOcupado(true);
    try {
      const props = Array.from((propMap.get(cv.id) || new Map()).values());
      const r = await oficializarProposta({ nome: cv.transportadora, propostas: props, rotasPorChave, basePublicada: base });
      aviso(`Tabela de ${cv.transportadora} enviada para a Tabela de Lotação (${r.linhas} rotas, valores ${base === 'BRUTO' ? 'brutos' : 'líquidos'}). Ela agora é a tabela oficial desse transportador.`);
      setOficial(null);
    } catch (e) { aviso(`Erro ao enviar para a Tabela de Lotação: ${e.message}`, 'erro'); } finally { setOcupado(false); }
  };

  const corRes = (r) => (r === 'GANHA' ? '#166534' : r === 'PERDE' ? '#b91c1c' : '#64748b');
  const totalViagens = dados.rotas.length ? dados.rotas.reduce((s, r) => s + (Number(r.viagens) || 0), 0) : rotasRealizado.reduce((s, r) => s + r.viagens, 0);

  return (
    <div style={{ padding: 4 }}>
      <div style={card}>
        <h1 style={{ margin: '0 0 6px', fontSize: 22, color: '#06183d' }}>Cotação de lotação — portal do transportador</h1>
        <small>
          Começamos do zero por aqui: importe a <b>TransGP</b> (casa) e a <b>ANTT</b> como referências, gere o link de cada transportador e a análise aparece sozinha.
          O transportador informa só o <b>valor líquido</b>; o ICMS sai da origem/destino e o <b>bruto</b> é calculado, então tudo é comparado na mesma base.
        </small>
        <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>
          Cotação: <b>{cotacaoAtual?.nome || 'será criada automaticamente'}</b> · {dados.rotas.length || rotasRealizado.length} rotas (veículo padronizado: <b>CARRETA</b>; rodotrem/bitrem e container fora)
          {' '}· média de <b>{int(totalViagens)}</b> viagens/mês{periodo ? ` (realizado de ${dataBr(periodo.inicio)} a ${dataBr(periodo.fim)} = ${periodo.meses.toLocaleString('pt-BR')} meses)` : ''}
        </div>
      </div>

      {msg.texto && (
        <div
          role="status"
          style={{
            position: 'fixed', right: 20, bottom: 20, zIndex: 1200, maxWidth: 480, padding: '12px 16px', borderRadius: 10, fontSize: 14, lineHeight: 1.4,
            boxShadow: '0 8px 24px rgba(0,0,0,.25)', background: msg.tipo === 'erro' ? '#fee2e2' : '#dcfce7', color: msg.tipo === 'erro' ? '#991b1b' : '#166534',
            border: `1px solid ${msg.tipo === 'erro' ? '#fca5a5' : '#86efac'}`,
          }}
        >
          {msg.texto}
          <button type="button" onClick={() => setMsg({ tipo: '', texto: '' })} style={{ marginLeft: 12, border: 0, background: 'transparent', cursor: 'pointer', fontWeight: 800, color: 'inherit' }}>✕</button>
        </div>
      )}

      <div style={card}>
        <h2 style={h2}>1. Referências de comparação</h2>
        <small>Servem de comparação para toda proposta que chegar: a TransGP é o nosso target (importada no modelo da Tabela de Lotação) e a ANTT é o piso, calculada pela regra cadastrada.</small>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
          <CartaoReferencia
            tipo="REF_CASA" titulo="TransGP (transportadora da casa)" descricao="Modelo Transportadora: Origem, UF, Destino, UF, KM, TIPO e TARGET." convite={conviteCasa}
            qtd={propMap.get(conviteCasa?.id)?.size || 0} ocupado={ocupado} baseInicial="LIQUIDO" onModelo={baixarModeloTransportadora}
            onImportar={(f, b) => importarRef('REF_CASA', f, b)} onRemover={async () => { await excluirConvite(conviteCasa.id); recarregarDados(); }}
          />
          <CartaoRegraAntt regra={regraAntt} onSalvar={salvarRegra} ocupado={ocupado} />
        </div>
      </div>

      {dados.rotas.length > 0 && <CartaoKm rotas={dados.rotas} ocupado={ocupado} progresso={progressoKm} onCompletar={completarKm} onSalvarRota={salvarRotaManual} />}

      <div style={card}>
        <h2 style={h2}>2. Gerar link para o transportador</h2>
        <small>Digite o nome de quem vai responder (pode ser um transportador novo). Cada clique cria um código novo e exclusivo; o CNPJ é pedido a ele no primeiro acesso.</small>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '12px 0', alignItems: 'end' }}>
          <label style={{ flex: 1, minWidth: 260, fontSize: 13, fontWeight: 700 }}>Nome do transportador
            <input style={{ ...inp, width: '100%', fontWeight: 400 }} list="lot-cot-transp" placeholder="Qualquer nome — transportador novo ou já cadastrado" value={nomeTransp} onChange={(e) => setNomeTransp(e.target.value)} />
            <datalist id="lot-cot-transp">{nomesTransportadoras.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <label style={{ fontSize: 13, fontWeight: 700 }}>Validade do link (dias)
            <input style={{ ...inp, width: 90, display: 'block', fontWeight: 400 }} type="number" min="1" max="60" value={dias} onChange={(e) => setDias(e.target.value)} />
          </label>
          <button style={btn} disabled={ocupado} onClick={gerar}>Gerar link</button>
        </div>
        {ultimoLink && (
          <div className="hint-box" style={{ marginTop: 4 }}>
            <b>Link de {ultimoLink.transportadora}</b> (vale até {dataBr(ultimoLink.expira_em)}):
            <div style={{ wordBreak: 'break-all', margin: '6px 0', fontFamily: 'monospace', fontSize: 12 }}>{linkConviteCotacao(ultimoLink.token)}</div>
            <button style={btn} onClick={() => copiar(ultimoLink.token)}>Copiar link</button>{' '}
            <button style={btnSec} onClick={() => email(ultimoLink)}>Abrir e-mail</button>
          </div>
        )}
      </div>

      <div style={card}>
        <h2 style={h2}>3. Links gerados e propostas</h2>
        {!transportadores.length ? <div className="hint-box" style={{ marginTop: 8 }}>Nenhum link gerado nesta cotação.</div> : (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Transportador', 'Expira em', 'Status', 'CNPJ informado', 'Respondente', 'Rotas cotadas', 'Ações'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {transportadores.map((cv) => (
                  <tr key={cv.id}>
                    <td style={td}><b>{cv.transportadora}</b></td>
                    <td style={{ ...td, color: expirado(cv) ? '#b91c1c' : undefined, fontWeight: expirado(cv) ? 700 : 400 }}>{cv.expira_em ? `${dataBr(cv.expira_em)}${expirado(cv) ? ' (expirado)' : ''}` : 'sem prazo'}</td>
                    <td style={{ ...td, color: STATUS_COR[cv.status], fontWeight: 700 }}>{STATUS_TXT[cv.status] || cv.status}</td>
                    <td style={td}>{fmtCnpj(cv.respondente_cnpj)}</td>
                    <td style={td}>{cv.respondente_nome ? `${cv.respondente_nome} (${cv.respondente_email || ''})` : '-'}</td>
                    <td style={td}>{propMap.get(cv.id)?.size || 0}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button style={btnSec} onClick={() => copiar(cv.token)}>Copiar link</button>{' '}
                      <button style={btnSec} onClick={() => email(cv)}>E-mail</button>{' '}
                      <button style={btnSec} onClick={() => { setAlvoImport(cv); setTimeout(() => arqProposta.current?.click(), 0); }}>Importar proposta (Excel)</button>{' '}
                      <button style={btnSec} onClick={async () => { await renovarConvite(cv.id, dias); recarregarDados(); aviso(`Prazo renovado por ${dias} dias.`); }}>Renovar prazo</button>{' '}
                      {(propMap.get(cv.id)?.size || 0) > 0 && <button style={{ ...btnSec, background: '#ecfdf3' }} onClick={() => setOficial({ cv, base: 'BRUTO' })}>Enviar p/ Tabela de Lotação</button>}{' '}
                      <button style={btnSec} onClick={async () => { if (window.confirm(`Excluir o link de ${cv.transportadora} e as propostas dele?`)) { await excluirConvite(cv.id); recarregarDados(); } }}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <input ref={arqProposta} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importarProposta(f); }} />
        <p style={{ marginBottom: 0 }}><button style={btnSec} onClick={() => recarregarDados()}>Atualizar respostas</button></p>

      </div>

      <div style={card}>
        <h2 style={h2}>4. Painel de aderência e realizado</h2>
        <div className="hint-box" style={{ margin: '8px 0 6px' }}>
          <b>Como ler:</b> tudo em valor <b>bruto</b> (com ICMS), por viagem. <b>ANTT</b> = KM × CCD + CC da regra cadastrada acima (5 ou 6 eixos, conforme cada linha da proposta) + ICMS da rota.
          {' '}<b>TransGP</b> = tabela importada (nosso target). <b>Realizado</b> = frete médio histórico da rota{periodo ? ` (${dataBr(periodo.inicio)} a ${dataBr(periodo.fim)})` : ''}.
          {' '}“Ganha” = proposta mais barata que a referência.
        </div>

        <h3 style={h3}>Realizado — visão geral</h3>
        <div style={gridKpi}>
          <Kpi titulo="Rotas (carreta)" valor={int(R.rotas)} sub={`${R.comKm} com KM`} />
          <Kpi titulo="Viagens por mês" valor={dec1(R.viagens)} sub="média do período" />
          <Kpi titulo="Gasto mensal realizado" valor={brl(R.gasto)} sub="frete médio × viagens/mês" />
          <Kpi titulo="Frete médio por viagem" valor={brl(R.medio)} sub={R.rkm ? `${brl(R.rkm)} por km` : ''} />
          <Kpi titulo="Realizado vs ANTT (5 eixos)" valor={pctSinal(R.vsAntt)} cor={R.vsAntt > 0 ? '#b91c1c' : '#166534'} sub={R.nA ? `em ${R.nA} rotas com KM` : 'sem KM suficiente'} />
          <Kpi titulo="Realizado vs TransGP" valor={conviteCasa ? pctSinal(R.vsTrans) : 'importe a TransGP'} cor={R.vsTrans > 0 ? '#b91c1c' : '#166534'} sub={conviteCasa && R.nT ? `em ${R.nT} rotas` : ''} />
        </div>
        <div style={{ overflow: 'auto', maxHeight: 420, border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead><tr>{['Maiores rotas', 'Viagens/mês', 'KM', 'Realizado médio', 'R$/km', 'ANTT 5 eixos', 'Realizado vs ANTT', 'TransGP', 'Realizado vs TransGP'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {R.top.map((x) => (
                <tr key={x.r.chave}>
                  <td style={td}>{x.r.origem} → {x.r.destino}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{dec1(x.r.viagens)}</td><td style={{ ...td, textAlign: 'right' }}>{x.r.km ? int(x.r.km) : '-'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{brl(x.real)}</td><td style={{ ...td, textAlign: 'right' }}>{x.rkm ? brl(x.rkm) : '-'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{brl(x.a)}</td><td style={{ ...td, textAlign: 'right', color: x.dA > 0 ? '#b91c1c' : '#166534', fontWeight: 700 }}>{pctSinal(x.dA)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{brl(x.tg)}</td><td style={{ ...td, textAlign: 'right', color: x.dT > 0 ? '#b91c1c' : '#166534', fontWeight: 700 }}>{pctSinal(x.dT)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ ...h3, marginTop: 22 }}>Propostas — aderência por transportador</h3>
        {!comparativo.length ? <div className="hint-box" style={{ marginTop: 8 }}>Assim que um transportador enviar a cotação (ou você importar a planilha dele), a aderência e a comparação com o realizado aparecem aqui.</div> : (
          <>
            {!conviteCasa && <small style={{ color: '#b45309', fontWeight: 700 }}>Importe a TransGP para comparar com o target. </small>}
            <div style={{ overflowX: 'auto', margin: '10px 0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Transportador', 'Eixos', 'Rotas cotadas', 'Aderência rotas', 'Aderência volume', 'Ganha da TransGP', 'Ganha da ANTT', 'Menor entre transp.', 'Ganha do realizado', 'Economia/mês (rotas que ganha)', 'Impacto líquido/mês', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {comparativo.map(({ cv, S }) => (
                    <tr key={cv.id} style={{ background: selecionado?.cv.id === cv.id ? '#eff6ff' : undefined }}>
                      <td style={td}><b>{cv.transportadora}</b></td>
                      <td style={{ ...td, textAlign: 'center' }}>{Number(cv.eixos) === 6 ? 6 : 5}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{S.cotadas}/{S.escopo}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{pct(S.escopo ? S.cotadas / S.escopo : null, 0)}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{pct(S.volTot ? S.volCot / S.volTot : null, 0)}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{conviteCasa ? `${S.casa.g}/${S.casa.g + S.casa.p + S.casa.e}` : '-'}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{(S.antt.g + S.antt.p + S.antt.e) > 0 ? `${S.antt.g}/${S.antt.g + S.antt.p + S.antt.e}` : '-'}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{S.menor.comp ? `${S.menor.g}/${S.menor.comp}` : '-'}</td>
                      <td style={{ ...td, textAlign: 'center' }}>{S.real.comp ? `${S.real.g}/${S.real.comp} (${pct(S.real.g / S.real.comp, 0)})` : '-'}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#166534', fontWeight: 700 }}>{brl(S.econGanhas)}</td>
                      <td style={{ ...td, textAlign: 'right', color: S.impacto >= 0 ? '#166534' : '#b91c1c', fontWeight: 700 }}>{brl(S.impacto)}</td>
                      <td style={td}><button style={btnSec} onClick={() => setSelId(cv.id)}>Detalhar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button style={btn} onClick={exportarComparativo}>Exportar comparativo geral (Excel)</button>
              <small style={{ alignSelf: 'center' }}>Economia/impacto = (realizado médio − proposta) × média mensal de viagens, só nas rotas com realizado.</small>
            </div>

            {selecionado && (
              <div style={{ borderTop: '2px solid #e2e8f0', paddingTop: 12 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                  <b style={{ fontSize: 18 }}>{selecionado.cv.transportadora}</b>
                  <span style={{ fontSize: 12, color: '#475569' }}>CNPJ {fmtCnpj(selecionado.cv.respondente_cnpj)}</span>
                </div>
                <div style={gridKpi}>
                  <Medidor titulo="Aderência (rotas)" valor={selecionado.S.escopo ? selecionado.S.cotadas / selecionado.S.escopo : 0} sub={`${selecionado.S.cotadas} de ${selecionado.S.escopo} rotas`} />
                  <Medidor titulo="Aderência (volume)" valor={selecionado.S.volTot ? selecionado.S.volCot / selecionado.S.volTot : 0} sub={`${dec1(selecionado.S.volCot)} de ${dec1(selecionado.S.volTot)} viagens/mês`} />
                  <Medidor titulo="Ganha do realizado" valor={selecionado.S.real.comp ? selecionado.S.real.g / selecionado.S.real.comp : 0} cor="#166534" sub={`${selecionado.S.real.g} de ${selecionado.S.real.comp} rotas`} />
                  <Medidor titulo="Ganha da TransGP" valor={(selecionado.S.casa.g + selecionado.S.casa.p + selecionado.S.casa.e) ? selecionado.S.casa.g / (selecionado.S.casa.g + selecionado.S.casa.p + selecionado.S.casa.e) : 0} cor="#0e7490" sub={conviteCasa ? `${selecionado.S.casa.g} de ${selecionado.S.casa.g + selecionado.S.casa.p + selecionado.S.casa.e} rotas` : 'importe a TransGP'} />
                  <Medidor titulo="Ganha da ANTT" valor={(selecionado.S.antt.g + selecionado.S.antt.p + selecionado.S.antt.e) ? selecionado.S.antt.g / (selecionado.S.antt.g + selecionado.S.antt.p + selecionado.S.antt.e) : 0} cor="#7c3aed" sub={`${selecionado.S.antt.g} de ${selecionado.S.antt.g + selecionado.S.antt.p + selecionado.S.antt.e} rotas`} />
                  <Medidor titulo="Menor entre transportadores" valor={selecionado.S.menor.comp ? selecionado.S.menor.g / selecionado.S.menor.comp : 0} cor="#b45309" sub={selecionado.S.menor.comp ? `${selecionado.S.menor.g} de ${selecionado.S.menor.comp} rotas` : 'só há uma proposta'} />
                  <Kpi titulo="Economia/mês (rotas que ganha)" valor={brl(selecionado.S.econGanhas)} cor="#166534" />
                  <Kpi titulo="Impacto líquido/mês" valor={brl(selecionado.S.impacto)} cor={selecionado.S.impacto >= 0 ? '#166534' : '#b91c1c'} sub="realizado − proposta, nas rotas cotadas" />
                  <Kpi titulo="Gasto mensal: proposta × realizado" valor={brl(selecionado.S.custoProp)} sub={`realizado: ${brl(selecionado.S.custoReal)}`} />
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                  <select style={{ ...inp, padding: '5px 8px' }} value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                    <option value="todas">Todas as rotas cotadas</option>
                    <option value="ganha-real">Ganha do realizado</option>
                    <option value="perde-real">Perde do realizado</option>
                    <option value="ganha-casa">Ganha da TransGP</option>
                    <option value="perde-casa">Perde da TransGP</option>
                  </select>
                  <button style={btn} onClick={exportarProposta}>Exportar proposta (Excel formatado)</button>
                  <button style={{ ...btnSec, background: '#ecfdf3' }} onClick={() => setOficial({ cv: selecionado.cv, base: 'BRUTO' })}>Enviar p/ Tabela de Lotação</button>
                </div>
                <div style={{ overflow: 'auto', maxHeight: 520, border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1300 }}>
                    <thead><tr>{['Rota', 'Veículo', 'Eixos', 'KM', 'Viagens/mês', 'ICMS', 'Líquido', 'Bruto', 'TransGP', 'Δ TransGP', 'ANTT', 'Δ ANTT', 'Menor outro', 'Realizado', 'Δ realizado', 'Resultado'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {linhasFiltradas.slice(0, 500).map((l) => (
                        <tr key={l.r.chave}>
                          <td style={td}>{l.r.origem} → {l.r.destino}</td><td style={td}>{l.r.tipo_veiculo}</td><td style={{ ...td, textAlign: 'center' }}>{l.eixo}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{l.r.km ? int(l.r.km) : '-'}</td><td style={{ ...td, textAlign: 'right' }}>{dec1(l.r.viagens)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{l.p.aliquota_icms != null ? `${Number(l.p.aliquota_icms).toLocaleString('pt-BR')}%` : '-'}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{brl(l.p.valor_liquido)}</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{brl(l.b)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{brl(l.vc)}</td><td style={{ ...td, textAlign: 'right', color: corRes(l.rc) }}>{pct(l.dCasa)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{brl(l.va)}</td><td style={{ ...td, textAlign: 'right', color: corRes(l.ra) }}>{pct(l.dAntt)}</td>
                          <td style={{ ...td, textAlign: 'right' }} title={l.menorOutro?.nome}>{l.menorOutro ? brl(l.menorOutro.v) : '-'}</td>
                          <td style={{ ...td, textAlign: 'right' }}>{brl(l.real)}</td><td style={{ ...td, textAlign: 'right', color: corRes(l.rr) }}>{pct(l.dReal)}</td>
                          <td style={{ ...td, textAlign: 'center', fontWeight: 700, color: corRes(l.rr) }}>{l.rr ? (l.rr === 'GANHA' ? 'Ganha' : l.rr === 'PERDE' ? 'Perde' : 'Empata') : 'sem realizado'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {linhasFiltradas.length > 500 && <small>Mostrando 500 de {linhasFiltradas.length} rotas — o Excel tem todas.</small>}
              </div>
            )}
          </>
        )}
      </div>

      <details style={card}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#06183d' }}>Avançado: cotações (criar outra / trocar / encerrar / excluir)</summary>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '12px 0', alignItems: 'center' }}>
          <select style={{ ...inp, minWidth: 260 }} value={cotacaoId} onChange={(e) => { setCotacaoId(e.target.value); setUltimoLink(null); setSelId(''); }}>
            {!cotacoes.length && <option value="">Nenhuma cotação ainda</option>}
            {cotacoes.map((c) => <option key={c.id} value={c.id}>{c.nome} · {c.status === 'ABERTA' ? 'aberta' : 'encerrada'} · {dataBr(c.created_at)}</option>)}
          </select>
          {cotacaoAtual && (
            <>
              <button style={btnSec} onClick={async () => { await alterarStatusCotacao(cotacaoAtual.id, cotacaoAtual.status === 'ABERTA' ? 'ENCERRADA' : 'ABERTA'); recarregarLista(); }}>{cotacaoAtual.status === 'ABERTA' ? 'Encerrar cotação' : 'Reabrir'}</button>
              <button style={btnSec} onClick={async () => { if (window.confirm('Excluir a cotação, os links e todas as propostas?')) { await excluirCotacao(cotacaoAtual.id); setCotacaoId(''); recarregarLista(); } }}>Excluir</button>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ ...inp, flex: 1, minWidth: 240 }} placeholder="Nova cotação: nome (ex.: Cotação lotação nov/2026)" value={nomeCotacao} onChange={(e) => setNomeCotacao(e.target.value)} />
          <button style={btn} disabled={ocupado} onClick={criarNova}>Criar cotação</button>
        </div>
        <small>As rotas vêm do realizado ({rotasRealizado.length} rotas/tipos de veículo hoje); as tabelas de lotação existentes não entram na comparação.</small>
      </details>

      {oficial && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, maxWidth: 560, width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,.35)' }}>
            <h2 style={{ ...h2, fontSize: 20 }}>Enviar para a Tabela de Lotação</h2>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>
              A tabela de <b>{oficial.cv.transportadora}</b> ({propMap.get(oficial.cv.id)?.size || 0} rotas) passa a ser a tabela <b>oficial</b> desse transportador na Tabela de Lotação
              e <b>substitui a atual</b>, se houver.
            </p>
            <label style={{ fontSize: 13, fontWeight: 700, display: 'block' }}>Gravar os valores como:
              <select style={{ ...inp, display: 'block', marginTop: 4, width: '100%' }} value={oficial.base} onChange={(e) => setOficial({ ...oficial, base: e.target.value })}>
                <option value="BRUTO">Bruto (com ICMS) — padrão para comparar todos na mesma base</option>
                <option value="LIQUIDO">Líquido (sem ICMS)</option>
              </select>
            </label>
            <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
              <button style={btn} disabled={ocupado} onClick={confirmarOficial}>{ocupado ? 'Enviando…' : 'Confirmar envio'}</button>
              <button style={{ ...btnSec, padding: '9px 16px', fontSize: 14 }} disabled={ocupado} onClick={() => setOficial(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
