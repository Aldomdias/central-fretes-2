import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chaveRota, normalizarTexto } from '../utils/lotacaoTables';
import {
  atualizarRotaLotacaoSupabase, atualizarVigenciaTabelaLotacaoSupabase, carregarTabelasLotacaoSupabase,
  inserirRotasLotacaoSupabase, lotacaoSupabaseConfigurado, removerRotaLotacaoSupabase,
  removerTabelaLotacaoSupabase, salvarTabelaLotacaoSupabase,
} from '../services/lotacaoSupabaseService';
import { carregarContextoAntt } from '../services/lotacaoCotacaoReferenciasService';
import { carregarCotacao, listarCotacoes } from '../services/lotacaoCotacaoService';
import { anttLiquidoPorRegra, eixosDaLinha, kmDaLinha } from '../utils/lotacaoAnttRegra';
import { aliquotaDaRota } from '../utils/lotacaoCotacaoCalculo';
import { baixarModeloLotacaoGestao, lerPlanilhaLotacaoGestao } from '../utils/lotacaoModeloPlanilha';
import { parseNumeroPlanilha } from '../utils/parseNumeroPlanilha';

// Aba Gestao: manutencao das tabelas que ja estao em uso e chegaram FORA do
// portal (planilha/e-mail). O portal de cotacao continua como esta; aqui usamos
// o MESMO modelo de planilha do portal (eixos 5/6, ANTT de referencia, bruto
// calculado) para incluir uma ou varias tabelas de uma vez e corrigir rotas.

const brl = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '-' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBr = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '-');
const soData = (v) => (v ? String(v).slice(0, 10) : '');
const novoId = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const num = (v) => {
  const n = parseNumeroPlanilha(v, null);
  return n === null || n === '' ? null : Number(n);
};
const sa = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

const card = { background: '#fff', border: '1px solid #dbe3ef', borderRadius: 14, padding: 20, marginBottom: 18 };
const h2 = { margin: '0 0 4px', fontSize: 18, color: '#06183d' };
const btn = { background: '#185FA5', color: '#fff', border: 0, borderRadius: 8, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' };
const btnSec = { ...btn, background: '#fff', color: '#185FA5', border: '1px solid #185FA5', padding: '6px 10px', fontSize: 12 };
const btnPerigo = { ...btnSec, color: '#b91c1c', borderColor: '#b91c1c' };
const inp = { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13 };
const inpCel = { ...inp, padding: '4px 6px', fontSize: 12, width: '100%', boxSizing: 'border-box' };
const th = { padding: '8px 6px', background: '#1E3A5F', color: '#fff', fontSize: 12, textAlign: 'center', position: 'sticky', top: 0, whiteSpace: 'nowrap' };
const td = { padding: '5px 6px', borderTop: '1px solid #e5e7eb', fontSize: 12 };
const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700, color: '#334155' };

function origemTabela(tabela) {
  return /COTA[CÇ][AÃ]O ONLINE/i.test(tabela?.modelo || '') ? 'Portal' : 'Manual';
}

function montarLinha({ transportadora, origem, ufOrigem, destino, ufDestino, km, tipo, eixos, valor, pedagio, prazo, icms, obs }, extra = {}) {
  const e = Number(eixos);
  const linha = {
    id: extra.id || novoId('rota'),
    sheetName: extra.sheetName || 'Gestão manual',
    excelRow: extra.excelRow || null,
    transportadora,
    origem: String(origem || '').trim(),
    ufOrigem: String(ufOrigem || '').trim().toUpperCase().slice(0, 2),
    destino: String(destino || '').trim(),
    ufDestino: String(ufDestino || '').trim().toUpperCase().slice(0, 2),
    tipo: String(tipo || '').trim() || 'CARRETA',
    eixos: e === 6 ? 6 : e === 5 ? 5 : null,
    km: km > 0 ? Number(km) : null,
    prazo: prazo == null ? '' : String(prazo).trim(),
    obs: obs || '',
    icms: icms ?? null,
    pedagio: pedagio ?? null,
    target: valor,
    freteAnttOficial: null,
    freteAntt: null,
    diferencaAntt: null,
    valor,
    valorFonte: extra.valorFonte || 'Gestão manual - líquido (sem ICMS)',
  };
  linha.chave = chaveRota(linha);
  return linha;
}

// linha no formato do modelo (com ICMS e ANTT 5/6 de referencia)
function linhaModelo(l, contexto) {
  const km = kmDaLinha(l, contexto?.kmRotas);
  const aliq = aliquotaDaRota(contexto?.matriz || [], l.ufOrigem, l.ufDestino).aliquota;
  const ref = (eixos) => anttLiquidoPorRegra({ km, tipo: l.tipo, ufOrigem: l.ufOrigem, ufDestino: l.ufDestino, eixos }, contexto || {});
  return { ...l, km, eixos: eixosDaLinha(l), aliquota: aliq, antt5: ref(5), antt6: ref(6) };
}

function exportarTabela(tabela, contexto) {
  return baixarModeloLotacaoGestao({
    titulo: `TABELA DE LOTAÇÃO — ${tabela.nome}`,
    nomeArquivo: `tabela-lotacao-${tabela.nome}`,
    linhas: (tabela.linhas || []).map((l) => linhaModelo({ ...l, transportadora: tabela.nome, liquido: l.valor }, contexto)),
  });
}

// ---------------------------------------------------------------------------
// Incluir tabelas (uma ou varias) pelo modelo do portal
// ---------------------------------------------------------------------------
function IncluirTabela({ tabelas, contexto, rotasCotacao, ocupado, onSalvar }) {
  const [nome, setNome] = useState('');
  const [vigIni, setVigIni] = useState('');
  const [vigFim, setVigFim] = useState('');
  const [modo, setModo] = useState('ATUALIZAR');
  const [arquivos, setArquivos] = useState([]);
  const [previa, setPrevia] = useState(null);
  const [erro, setErro] = useState('');
  const refArq = useRef(null);

  useEffect(() => { setPrevia(null); }, [nome, modo, arquivos]);

  const porNome = useMemo(() => new Map(tabelas.map((t) => [normalizarTexto(t.nome), t])), [tabelas]);

  // UF e KM conhecidos por cidade/rota (cotacao + tabelas atuais), p/ completar rota nova
  const conhecidos = useMemo(() => {
    const uf = new Map();
    const km = new Map();
    const aprende = (cidade, u) => { const k = sa(cidade); if (k && u && !uf.has(k)) uf.set(k, String(u).toUpperCase()); };
    const aprendeKm = (o, d, v) => { const k = `${sa(o)}|${sa(d)}`; if (Number(v) > 0 && !km.has(k)) km.set(k, Number(v)); };
    rotasCotacao.forEach((r) => { aprende(r.origem, r.uf_origem); aprende(r.destino, r.uf_destino); aprendeKm(r.origem, r.destino, r.km); });
    tabelas.forEach((t) => (t.linhas || []).forEach((l) => { aprende(l.origem, l.ufOrigem); aprende(l.destino, l.ufDestino); aprendeKm(l.origem, l.destino, l.km); }));
    return { uf, km };
  }, [rotasCotacao, tabelas]);

  const baixarModelo = async (todas) => {
    setErro('');
    try {
      if (todas) {
        const linhas = tabelas.flatMap((t) => (t.linhas || []).map((l) => linhaModelo({ ...l, transportadora: t.nome, liquido: l.valor }, contexto)));
        await baixarModeloLotacaoGestao({ titulo: 'TABELAS DE LOTAÇÃO — TODAS', linhas, nomeArquivo: 'tabelas-lotacao-todas' });
        return;
      }
      const t = porNome.get(normalizarTexto(nome));
      const nomeT = t?.nome || nome.trim();
      const linhas = t
        ? (t.linhas || []).map((l) => linhaModelo({ ...l, transportadora: nomeT, liquido: l.valor }, contexto))
        : rotasCotacao.map((r) => linhaModelo({
          transportadora: nomeT, origem: r.origem, ufOrigem: r.uf_origem, destino: r.destino, ufDestino: r.uf_destino,
          tipo: r.tipo_veiculo, km: r.km, viagens: r.viagens, eixos: 5,
        }, contexto));
      await baixarModeloLotacaoGestao({ titulo: `TABELA DE LOTAÇÃO — ${nomeT || 'TRANSPORTADORA'}`, linhas, nomeArquivo: `tabela-lotacao-${nomeT || 'modelo'}` });
    } catch (e) { setErro(e.message || String(e)); }
  };

  const preparar = async () => {
    setErro('');
    if (!arquivos.length) { setErro('Escolha um ou mais arquivos.'); return; }
    try {
      const grupos = new Map();
      const avisos = [];
      for (const f of arquivos) {
        const lido = await lerPlanilhaLotacaoGestao(f);
        const nomeArquivo = f.name.replace(/\.[^.]+$/, '');
        lido.linhas.forEach((l) => {
          const nomeT = (l.transportadora || (arquivos.length === 1 && nome.trim()) || lido.nomeTitulo || nome.trim() || nomeArquivo).trim();
          if (!nomeT || /^TODAS$/i.test(nomeT)) { avisos.push(`${f.name} linha ${l.linhaPlanilha}: sem transportadora`); return; }
          const ufO = l.ufOrigem || conhecidos.uf.get(sa(l.origem)) || '';
          const ufD = l.ufDestino || conhecidos.uf.get(sa(l.destino)) || '';
          if (!ufO || !ufD) avisos.push(`${f.name} linha ${l.linhaPlanilha}: UF não encontrada (${l.origem} → ${l.destino})`);
          const linha = montarLinha({
            transportadora: nomeT, origem: l.origem, ufOrigem: ufO, destino: l.destino, ufDestino: ufD, tipo: l.tipo || 'CARRETA',
            eixos: l.eixos || 5, km: l.km || conhecidos.km.get(`${sa(l.origem)}|${sa(l.destino)}`) || null, valor: l.liquido, prazo: l.prazo, obs: l.obs,
          }, { sheetName: f.name, excelRow: l.linhaPlanilha, valorFonte: 'Gestão - modelo lotação (líquido)' });
          const k = normalizarTexto(nomeT);
          if (!grupos.has(k)) grupos.set(k, { nome: nomeT, linhas: new Map() });
          grupos.get(k).linhas.set(linha.chave, linha);
        });
      }
      if (!grupos.size) { setErro('Nenhuma rota com valor líquido encontrada nos arquivos.'); return; }

      const resultado = [...grupos.values()].map((g) => {
        const existente = porNome.get(normalizarTexto(g.nome));
        const novas = [...g.linhas.values()];
        const atuais = new Map((existente?.linhas || []).map((l) => [l.chave, l]));
        let atualizadas = 0;
        const mescla = (l) => {
          const atual = atuais.get(l.chave);
          if (!atual) return l;
          atualizadas += 1;
          return { ...l, id: atual.id, km: l.km ?? atual.km, pedagio: atual.pedagio };
        };
        const final = modo === 'ATUALIZAR' && existente
          ? [...(existente.linhas || []).filter((l) => !g.linhas.has(l.chave)), ...novas.map(mescla)]
          : novas.map(mescla);
        const abaixoAntt = novas.filter((l) => {
          const a = anttLiquidoPorRegra({ km: kmDaLinha(l, contexto?.kmRotas), tipo: l.tipo, ufOrigem: l.ufOrigem, ufDestino: l.ufDestino, eixos: l.eixos }, contexto || {});
          return a != null && l.valor < a * 0.9999;
        }).length;
        return {
          nome: existente?.nome || g.nome, existente, final, novas, atualizadas, incluidas: novas.length - atualizadas,
          removidas: modo === 'SUBSTITUIR' && existente ? Math.max(0, (existente.linhas || []).length - atualizadas) : 0,
          abaixoAntt, seis: novas.filter((l) => l.eixos === 6).length,
        };
      }).sort((a, b) => a.nome.localeCompare(b.nome));
      setPrevia({ grupos: resultado, avisos });
    } catch (e) { setErro(e.message || String(e)); }
  };

  const salvar = async () => {
    if (!previa) return;
    const ok = await onSalvar(previa.grupos.map((g) => ({
      existente: g.existente,
      nome: g.nome,
      linhas: g.final,
      vigenciaInicio: vigIni || g.existente?.vigenciaInicio || '',
      vigenciaFim: vigFim || g.existente?.vigenciaFim || '',
      fileName: arquivos.map((a) => a.name).join(', ').slice(0, 200),
    })));
    if (ok) { setPrevia(null); setArquivos([]); }
  };

  const totalRotas = previa ? previa.grupos.reduce((a, g) => a + g.final.length, 0) : 0;
  const nomeModelo = porNome.get(normalizarTexto(nome))?.nome || nome.trim();

  return (
    <div style={card}>
      <h2 style={h2}>Incluir tabelas que já estão em uso</h2>
      <small>
        Mesmo modelo do portal de cotação (colunas amarelas, eixos 5/6, ANTT de referência e bruto calculado), para as tabelas que chegaram fora do portal:
        uma transportadora por arquivo <b>ou</b> várias numa planilha só (coluna <b>Transportadora</b>). Pode escolher vários arquivos de uma vez. Valores em <b>líquido</b> (sem ICMS).
      </small>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginTop: 12 }}>
        <label style={lbl}>Transportadora (modelo / arquivo único)
          <input style={inp} list="gestao-lot-transp" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Opcional se a planilha já tiver" />
          <datalist id="gestao-lot-transp">{tabelas.map((t) => <option key={t.id} value={t.nome} />)}</datalist>
        </label>
        <label style={lbl}>Vigência início<input style={inp} type="date" value={vigIni} onChange={(e) => setVigIni(e.target.value)} /></label>
        <label style={lbl}>Vigência fim<input style={inp} type="date" value={vigFim} onChange={(e) => setVigFim(e.target.value)} /></label>
        <label style={lbl}>Transportadora que já tem tabela
          <select style={inp} value={modo} onChange={(e) => setModo(e.target.value)}>
            <option value="ATUALIZAR">Atualizar/acrescentar rotas (mantém as outras)</option>
            <option value="SUBSTITUIR">Substituir a tabela inteira</option>
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
        <button style={btnSec} type="button" onClick={() => baixarModelo(false)}>⬇ Baixar modelo{nomeModelo ? ` (${nomeModelo})` : ''}</button>
        <button style={btnSec} type="button" disabled={!tabelas.length} onClick={() => baixarModelo(true)}>⬇ Baixar todas as tabelas no modelo</button>
        <button style={btn} type="button" onClick={() => refArq.current?.click()}>⬆ Importar planilha(s) preenchida(s)</button>
        <span style={{ fontSize: 13 }}>{arquivos.length ? arquivos.map((a) => a.name).join(', ') : 'Nenhum arquivo escolhido'}</span>
        <input ref={refArq} type="file" multiple accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => { setArquivos(Array.from(e.target.files || [])); e.target.value = ''; }} />
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
        Transportadora nova: o modelo vem com as rotas da cotação aberta. Transportadora existente: vem com as rotas e valores atuais (é só ajustar e reimportar).
        Rota que não está na lista: acrescente no fim da planilha.
      </div>

      {erro && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button style={btn} type="button" disabled={ocupado || !arquivos.length} onClick={preparar}>Conferir antes de salvar</button>
        {previa && <button style={{ ...btn, background: '#166534' }} type="button" disabled={ocupado} onClick={salvar}>{ocupado ? 'Salvando…' : `Salvar ${previa.grupos.length} tabela(s) · ${totalRotas} rotas`}</button>}
      </div>

      {previa && (
        <div style={{ marginTop: 12 }}>
          {previa.avisos.length > 0 && <div style={{ fontSize: 12, color: '#92400e', marginBottom: 6 }}>{previa.avisos.slice(0, 6).join(' · ')}{previa.avisos.length > 6 ? ` (+${previa.avisos.length - 6})` : ''}</div>}
          <div style={{ overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Transportadora', 'Situação', 'Rotas no arquivo', 'Novas', 'Valor atualizado', 'Saem', '6 eixos', 'Abaixo ANTT', 'Tabela final'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {previa.grupos.map((g) => (
                  <tr key={g.nome}>
                    <td style={td}><b>{g.nome}</b></td>
                    <td style={{ ...td, textAlign: 'center' }}>{g.existente ? (modo === 'ATUALIZAR' ? 'Atualiza' : 'Substitui') : 'Nova tabela'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{g.novas.length}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{g.incluidas}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{g.atualizadas}</td>
                    <td style={{ ...td, textAlign: 'right', color: g.removidas ? '#b91c1c' : undefined }}>{g.removidas || '-'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{g.seis || '-'}</td>
                    <td style={{ ...td, textAlign: 'right', color: g.abaixoAntt ? '#b91c1c' : undefined, fontWeight: g.abaixoAntt ? 700 : 400 }}>{g.abaixoAntt || '-'}</td>
                    <td style={{ ...td, textAlign: 'right' }}><b>{g.final.length}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor rota a rota
// ---------------------------------------------------------------------------
const NOVA_VAZIA = { origem: '', ufOrigem: '', destino: '', ufDestino: '', tipo: 'CARRETA', eixos: '5', km: '', valor: '', pedagio: '', prazo: '' };

function EditorTabela({ tabela, contexto, ocupado, setOcupado, aviso, onFechar, onAlterada }) {
  const [linhas, setLinhas] = useState(() => (tabela.linhas || []).map((l) => ({ ...l, eixos: eixosDaLinha(l) })));
  const [sujas, setSujas] = useState(() => new Set());
  const [busca, setBusca] = useState('');
  const [vigIni, setVigIni] = useState(soData(tabela.vigenciaInicio));
  const [vigFim, setVigFim] = useState(soData(tabela.vigenciaFim));
  const [nova, setNova] = useState(NOVA_VAZIA);

  const anttDe = useCallback((l) => anttLiquidoPorRegra({ km: kmDaLinha(l, contexto?.kmRotas), tipo: l.tipo, ufOrigem: l.ufOrigem, ufDestino: l.ufDestino, eixos: l.eixos }, contexto || {}), [contexto]);

  const visiveis = useMemo(() => {
    const b = normalizarTexto(busca);
    const lista = b ? linhas.filter((l) => normalizarTexto(`${l.origem} ${l.ufOrigem} ${l.destino} ${l.ufDestino} ${l.tipo}`).includes(b)) : linhas;
    return lista.slice().sort((a, c) => `${a.origem}${a.destino}`.localeCompare(`${c.origem}${c.destino}`));
  }, [linhas, busca]);

  const editar = (id, campo, valor) => {
    setLinhas((atual) => atual.map((l) => (l.id === id ? { ...l, [campo]: valor } : l)));
    setSujas((s) => new Set(s).add(id));
  };

  const salvarAlteracoes = async () => {
    if (!sujas.size) return;
    setOcupado(true);
    try {
      for (const id of sujas) {
        const l = linhas.find((x) => x.id === id);
        if (!l) continue;
        const valor = num(l.valor);
        if (!(valor > 0)) throw new Error(`Valor inválido em ${l.origem} → ${l.destino}.`);
        const linha = montarLinha({ ...l, transportadora: tabela.nome, km: num(l.km), valor, pedagio: num(l.pedagio) }, { id: l.id, sheetName: l.sheetName, excelRow: l.excelRow, valorFonte: 'Gestão manual - editado (líquido)' });
        await atualizarRotaLotacaoSupabase(tabela.id, linha);
      }
      aviso(`${sujas.size} rota(s) atualizada(s) em ${tabela.nome}.`);
      setSujas(new Set());
      onAlterada();
    } catch (e) { aviso(`Erro ao salvar: ${e.message}`, 'erro'); } finally { setOcupado(false); }
  };

  const incluirRota = async () => {
    const valor = num(nova.valor);
    if (!nova.origem.trim() || !nova.destino.trim() || !(valor > 0)) { aviso('Informe origem, destino e valor líquido da nova rota.', 'erro'); return; }
    const linha = montarLinha({ ...nova, transportadora: tabela.nome, km: num(nova.km), valor, pedagio: num(nova.pedagio) });
    if (linhas.some((l) => l.chave === linha.chave)) { aviso('Essa rota já existe na tabela: edite o valor na lista.', 'erro'); return; }
    setOcupado(true);
    try {
      await inserirRotasLotacaoSupabase(tabela.id, [linha]);
      setLinhas((a) => [...a, linha]);
      setNova(NOVA_VAZIA);
      aviso(`Rota ${linha.origem} → ${linha.destino} incluída em ${tabela.nome}.`);
      onAlterada();
    } catch (e) { aviso(`Erro ao incluir: ${e.message}`, 'erro'); } finally { setOcupado(false); }
  };

  const excluirRota = async (l) => {
    if (!window.confirm(`Excluir a rota ${l.origem} → ${l.destino} (${l.tipo}) de ${tabela.nome}?`)) return;
    setOcupado(true);
    try {
      await removerRotaLotacaoSupabase(tabela.id, l.id);
      setLinhas((a) => a.filter((x) => x.id !== l.id));
      setSujas((s) => { const n = new Set(s); n.delete(l.id); return n; });
      aviso('Rota excluída.');
      onAlterada();
    } catch (e) { aviso(`Erro ao excluir: ${e.message}`, 'erro'); } finally { setOcupado(false); }
  };

  const salvarVigencia = async () => {
    setOcupado(true);
    try {
      await atualizarVigenciaTabelaLotacaoSupabase(tabela.id, { vigenciaInicio: vigIni, vigenciaFim: vigFim });
      aviso(`Vigência de ${tabela.nome} salva.`);
      onAlterada();
    } catch (e) { aviso(`Erro ao salvar vigência (migration de vigência aplicada?): ${e.message}`, 'erro'); } finally { setOcupado(false); }
  };

  const seletorEixos = (valor, onChange) => (
    <select style={inpCel} value={String(valor ?? 5)} onChange={(e) => onChange(Number(e.target.value))}>
      <option value="5">5</option><option value="6">6</option>
    </select>
  );

  return (
    <div style={{ ...card, border: '2px solid #185FA5' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2 style={h2}>Editando: {tabela.nome}</h2>
          <small>{linhas.length} rotas · {origemTabela(tabela)} · valores em líquido (sem ICMS) · ANTT pelos eixos de cada rota</small>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...btn, background: sujas.size ? '#166534' : '#94a3b8' }} disabled={ocupado || !sujas.size} onClick={salvarAlteracoes}>
            {sujas.size ? `Salvar ${sujas.size} alteração(ões)` : 'Sem alterações'}
          </button>
          <button style={btnSec} onClick={() => { if (!sujas.size || window.confirm('Descartar as alterações não salvas?')) onFechar(); }}>Fechar</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', margin: '12px 0' }}>
        <label style={lbl}>Vigência início<input style={inp} type="date" value={vigIni} onChange={(e) => setVigIni(e.target.value)} /></label>
        <label style={lbl}>Vigência fim<input style={inp} type="date" value={vigFim} onChange={(e) => setVigFim(e.target.value)} /></label>
        <button style={btnSec} disabled={ocupado} onClick={salvarVigencia}>Salvar vigência</button>
        <label style={{ ...lbl, marginLeft: 'auto' }}>Buscar rota<input style={{ ...inp, minWidth: 220 }} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="cidade, UF ou tipo" /></label>
      </div>

      <div style={{ maxHeight: 460, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Origem', 'UF', 'Destino', 'UF', 'Veículo', 'Eixos', 'KM', 'Valor líquido', 'Pedágio', 'Prazo', 'ANTT ref. líquido', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {visiveis.slice(0, 500).map((l) => {
              const antt = anttDe({ ...l, km: num(l.km) });
              const abaixo = antt != null && num(l.valor) < antt * 0.9999;
              return (
                <tr key={l.id} style={{ background: sujas.has(l.id) ? '#fefce8' : undefined }}>
                  <td style={td}>{l.origem}</td><td style={td}>{l.ufOrigem}</td><td style={td}>{l.destino}</td><td style={td}>{l.ufDestino}</td>
                  <td style={{ ...td, width: 110 }}><input style={inpCel} value={l.tipo ?? ''} onChange={(e) => editar(l.id, 'tipo', e.target.value)} /></td>
                  <td style={{ ...td, width: 60 }}>{seletorEixos(l.eixos, (v) => editar(l.id, 'eixos', v))}</td>
                  <td style={{ ...td, width: 75 }}><input style={inpCel} value={l.km ?? ''} onChange={(e) => editar(l.id, 'km', e.target.value)} /></td>
                  <td style={{ ...td, width: 110 }}><input style={{ ...inpCel, borderColor: abaixo ? '#b91c1c' : '#cbd5e1' }} value={l.valor ?? ''} onChange={(e) => editar(l.id, 'valor', e.target.value)} /></td>
                  <td style={{ ...td, width: 85 }}><input style={inpCel} value={l.pedagio ?? ''} onChange={(e) => editar(l.id, 'pedagio', e.target.value)} /></td>
                  <td style={{ ...td, width: 60 }}><input style={inpCel} value={l.prazo ?? ''} onChange={(e) => editar(l.id, 'prazo', e.target.value)} /></td>
                  <td style={{ ...td, textAlign: 'right', color: abaixo ? '#b91c1c' : '#475569', fontWeight: abaixo ? 700 : 400 }} title={abaixo ? 'Valor abaixo da ANTT' : ''}>{brl(antt)}</td>
                  <td style={td}><button style={{ ...btnPerigo, padding: '3px 8px' }} disabled={ocupado} onClick={() => excluirRota(l)}>Excluir</button></td>
                </tr>
              );
            })}
            {visiveis.length > 500 && <tr><td colSpan={12} style={{ ...td, textAlign: 'center', color: '#64748b' }}>Mostrando 500 de {visiveis.length}. Use a busca para achar a rota.</td></tr>}
            <tr style={{ background: '#f0f9ff' }}>
              {['origem', 'ufOrigem', 'destino', 'ufDestino', 'tipo'].map((campo) => (
                <td key={campo} style={td}><input style={inpCel} value={nova[campo]} placeholder={campo === 'origem' ? 'Nova rota: origem' : ''} onChange={(e) => setNova({ ...nova, [campo]: e.target.value })} /></td>
              ))}
              <td style={td}>{seletorEixos(nova.eixos, (v) => setNova({ ...nova, eixos: v }))}</td>
              {['km', 'valor', 'pedagio', 'prazo'].map((campo) => (
                <td key={campo} style={td}><input style={inpCel} value={nova[campo]} onChange={(e) => setNova({ ...nova, [campo]: e.target.value })} /></td>
              ))}
              <td style={td} />
              <td style={td}><button style={{ ...btnSec, padding: '3px 8px' }} disabled={ocupado} onClick={incluirRota}>Incluir</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function GestaoTabelasLotacaoManutencao() {
  const usarSupabase = lotacaoSupabaseConfigurado();
  const [tabelas, setTabelas] = useState([]);
  const [contexto, setContexto] = useState(null);
  const [rotasCotacao, setRotasCotacao] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [editandoId, setEditandoId] = useState('');
  const [filtroOrigem, setFiltroOrigem] = useState('TODAS');
  const aviso = (texto, tipo = 'ok') => setMsg({ tipo, texto });

  const recarregar = useCallback(async () => {
    if (!usarSupabase) return;
    try {
      const resp = await carregarTabelasLotacaoSupabase();
      setTabelas((resp.tabelas || []).filter((t) => !t.virtual && normalizarTexto(t.tipo) === 'TRANSPORTADORA').sort((a, b) => a.nome.localeCompare(b.nome)));
    } catch (e) { aviso(`Erro ao carregar tabelas: ${e.message}`, 'erro'); }
  }, [usarSupabase]);

  useEffect(() => {
    recarregar();
    if (!usarSupabase) return;
    carregarContextoAntt().then(setContexto).catch(() => {});
    // rotas da cotacao aberta: base do modelo para transportadora nova
    listarCotacoes()
      .then((lista) => {
        const cot = lista.find((c) => c.status === 'ABERTA') || lista[0];
        return cot ? carregarCotacao(cot.id) : null;
      })
      .then((d) => setRotasCotacao(d?.rotas || []))
      .catch(() => {});
  }, [recarregar, usarSupabase]);

  const resumo = useMemo(() => tabelas.map((t) => {
    let abaixo = 0;
    let semKm = 0;
    let seis = 0;
    (t.linhas || []).forEach((l) => {
      const km = kmDaLinha(l, contexto?.kmRotas);
      if (!km) semKm += 1;
      if (l.eixos === 6) seis += 1;
      const a = contexto ? anttLiquidoPorRegra({ km, tipo: l.tipo, ufOrigem: l.ufOrigem, ufDestino: l.ufDestino, eixos: l.eixos }, contexto) : null;
      if (a != null && l.valor < a * 0.9999) abaixo += 1;
    });
    return { t, origem: origemTabela(t), abaixo, semKm, seis };
  }), [tabelas, contexto]);

  const visiveis = resumo.filter((r) => filtroOrigem === 'TODAS' || r.origem === filtroOrigem);
  const editando = tabelas.find((t) => t.id === editandoId);

  const salvarTabelas = async (lista) => {
    setOcupado(true);
    const feitas = [];
    try {
      for (const { existente, nome, linhas, vigenciaInicio, vigenciaFim, fileName } of lista) {
        await salvarTabelaLotacaoSupabase({
          id: existente?.id || novoId('tab'),
          nome,
          tipo: 'TRANSPORTADORA',
          modelo: 'GESTÃO MANUAL',
          fileName,
          createdAt: existente?.createdAt || new Date().toISOString(),
          linhas: linhas.map((l) => ({ ...l, transportadora: nome })),
          totalLinhas: linhas.length,
          rotasUnicas: new Set(linhas.map((l) => l.chave)).size,
          origens: new Set(linhas.map((l) => `${l.origem}/${l.ufOrigem}`)).size,
          destinos: new Set(linhas.map((l) => `${l.destino}/${l.ufDestino}`)).size,
          abasImportadas: [{ nome: 'Gestão manual', rotas: linhas.length }],
          abasIgnoradas: [],
          fontesValor: { 'Gestão manual (líquido)': linhas.length },
          resumoFontesValor: `Gestão manual (líquido): ${linhas.length}`,
          vigenciaInicio,
          vigenciaFim,
        });
        feitas.push(nome);
      }
      aviso(`${feitas.length} tabela(s) salva(s): ${feitas.join(', ')}. Já valem para Tabelas vigentes, Lotação operação e Auditoria.`);
      return true;
    } catch (e) {
      aviso(`Erro ao salvar${feitas.length ? ` (já salvas: ${feitas.join(', ')})` : ''}: ${e.message}`, 'erro');
      return false;
    } finally {
      await recarregar();
      setOcupado(false);
    }
  };

  const excluirTabela = async (t) => {
    if (!window.confirm(`Excluir a tabela de ${t.nome} com ${t.linhas?.length || 0} rotas?\n\nEla deixa de valer para alocação e auditoria. Não dá para desfazer (baixe o Excel antes se quiser guardar).`)) return;
    setOcupado(true);
    try {
      await removerTabelaLotacaoSupabase(t.id);
      if (editandoId === t.id) setEditandoId('');
      await recarregar();
      aviso(`Tabela ${t.nome} excluída.`);
    } catch (e) { aviso(`Erro ao excluir: ${e.message}`, 'erro'); } finally { setOcupado(false); }
  };

  if (!usarSupabase) {
    return <div style={{ padding: 24 }}><div style={card}>Supabase não configurado: a manutenção de tabelas precisa do banco.</div></div>;
  }

  return (
    <div style={{ padding: 24 }}>
      {msg.texto && (
        <div style={{ ...card, padding: 12, background: msg.tipo === 'erro' ? '#fef2f2' : '#f0fdf4', borderColor: msg.tipo === 'erro' ? '#fecaca' : '#bbf7d0', color: msg.tipo === 'erro' ? '#b91c1c' : '#166534' }}>
          {msg.texto}
        </div>
      )}

      <IncluirTabela tabelas={tabelas} contexto={contexto} rotasCotacao={rotasCotacao} ocupado={ocupado} onSalvar={salvarTabelas} />

      {editando && (
        <EditorTabela key={editando.id} tabela={editando} contexto={contexto} ocupado={ocupado} setOcupado={setOcupado} aviso={aviso}
          onFechar={() => setEditandoId('')} onAlterada={recarregar} />
      )}

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h2 style={h2}>Tabelas cadastradas</h2>
            <small>Todas as tabelas de lotação em uso. <b>Portal</b> = veio da cotação online; <b>Manual</b> = incluída por planilha/aqui. ANTT pela regra da aba Cotação, nos eixos de cada rota.</small>
          </div>
          <select style={inp} value={filtroOrigem} onChange={(e) => setFiltroOrigem(e.target.value)}>
            <option value="TODAS">Todas</option><option value="Portal">Só portal</option><option value="Manual">Só manuais</option>
          </select>
        </div>
        <div style={{ overflow: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Transportadora', 'Entrada', 'Rotas', '6 eixos', 'Vigência', 'Atualizada em', 'Abaixo ANTT', 'Sem KM', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {visiveis.map(({ t, origem, abaixo, semKm, seis }) => (
                <tr key={t.id} style={{ background: editandoId === t.id ? '#eff6ff' : undefined }}>
                  <td style={td}><b>{t.nome}</b></td>
                  <td style={{ ...td, textAlign: 'center' }}><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, background: origem === 'Portal' ? '#dcfce7' : '#e0e7ff', color: origem === 'Portal' ? '#166534' : '#3730a3' }}>{origem}</span></td>
                  <td style={{ ...td, textAlign: 'right' }}>{t.linhas?.length || 0}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{seis || '-'}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{t.vigenciaInicio || t.vigenciaFim ? `${dataBr(t.vigenciaInicio)} a ${dataBr(t.vigenciaFim)}` : 'sem vigência'}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{dataBr(t.updatedAt || t.createdAt)}</td>
                  <td style={{ ...td, textAlign: 'right', color: abaixo ? '#b91c1c' : undefined, fontWeight: abaixo ? 700 : 400 }}>{abaixo || '-'}</td>
                  <td style={{ ...td, textAlign: 'right', color: semKm ? '#92400e' : undefined }}>{semKm || '-'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button style={btnSec} disabled={ocupado} onClick={() => setEditandoId(t.id)}>Editar rotas</button>{' '}
                    <button style={btnSec} onClick={() => exportarTabela(t, contexto)}>Baixar no modelo</button>{' '}
                    <button style={btnPerigo} disabled={ocupado} onClick={() => excluirTabela(t)}>Excluir</button>
                  </td>
                </tr>
              ))}
              {!visiveis.length && <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#64748b' }}>Nenhuma tabela.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
