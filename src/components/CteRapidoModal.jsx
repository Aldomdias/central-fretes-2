import { useEffect, useRef, useState } from 'react';
import { buscarCtesPorIdentificadores, processarCtesPorChave } from '../services/auditoriaCteProcessamentoService';
import { salvarRecorteCarregadoAuditoria } from '../services/auditoriaService';
import { pesquisarTrackingSupabase } from '../services/trackingSupabaseService';

export const CHAVE_RECALCULAR_CTE = 'central_fretes_recalcular_chave';
export const EVENTO_RECALCULAR_CTE = 'central-fretes:recalcular-chave';

const estilo = {
  botao: { position: 'fixed', right: 140, bottom: 16, zIndex: 9998, borderRadius: 999, padding: '8px 14px', cursor: 'pointer', border: '1px solid #cbd5e1', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,.2)', fontWeight: 600 },
  fundo: { position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  painel: { width: 720, maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: '#fff', color: '#0f172a', borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,.35)', padding: 16 },
  linha: { display: 'flex', gap: 6, marginBottom: 10 },
  input: { flex: '1 1 auto', minWidth: 0, height: 36, padding: '0 10px', border: '1px solid #cbd5e1', borderRadius: 8, boxSizing: 'border-box', background: '#fff', color: '#0f172a' },
  primario: { height: 36, padding: '0 14px', border: 'none', borderRadius: 8, background: '#1d4ed8', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  corpo: { overflowY: 'auto', flex: 1 },
  grade: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginBottom: 12 },
  campo: { border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 8px', fontSize: 13 },
  rotulo: { fontSize: 11, color: '#64748b', display: 'block' },
  titulo: { fontSize: 13, fontWeight: 700, margin: '10px 0 6px' },
};

const dig = (v) => String(v ?? '').replace(/\D/g, '');
const pick = (obj, keys) => {
  for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== '') return obj[k];
  return '';
};
const moeda = (v) => (Number.isFinite(Number(v)) && v !== '' ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');
const num = (v, d = 2) => (Number.isFinite(Number(v)) && v !== '' ? Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }) : '—');
const data = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '—');

function Campo({ rotulo, valor }) {
  return (
    <div style={estilo.campo}>
      <span style={estilo.rotulo}>{rotulo}</span>
      <strong style={{ wordBreak: 'break-all' }}>{valor === '' || valor == null ? '—' : valor}</strong>
    </div>
  );
}

export default function CteRapidoModal({ onRecalcular }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [msg, setMsg] = useState('');
  const [cte, setCte] = useState(null);
  const [tracking, setTracking] = useState([]);
  const [calculando, setCalculando] = useState(false);
  const [calculo, setCalculo] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && String(e.key).toLowerCase() === 'c') {
        e.preventDefault();
        setAberto((v) => !v);
      } else if (e.key === 'Escape') {
        setAberto(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (aberto) setTimeout(() => inputRef.current?.focus(), 0);
  }, [aberto]);

  async function pesquisar(e) {
    e?.preventDefault?.();
    const id = dig(busca);
    if (!id) { setMsg('Informe a chave (44 dígitos) ou o número do CT-e.'); return; }
    setCarregando(true);
    setMsg('');
    setCte(null);
    setTracking([]);
    setCalculo(null);
    try {
      const { ctes } = await buscarCtesPorIdentificadores([id]);
      const achado = ctes[0] || null;
      setCte(achado);
      if (!achado) setMsg('CT-e não encontrado na base.');
      const chaveCte = dig(pick(achado, ['chave_cte', 'chaveCte'])) || (id.length >= 44 ? id : '');
      const chaveNfe = dig(pick(achado, ['chave_nfe', 'chaveNfe']));
      let rows = [];
      if (chaveCte) rows = (await pesquisarTrackingSupabase({ chaveCte }, { limit: 10 })).rows || [];
      if (!rows.length && chaveNfe) rows = (await pesquisarTrackingSupabase({ chaveNfe }, { limit: 10 })).rows || [];
      if (!rows.length && !achado && id.length === 44) rows = (await pesquisarTrackingSupabase({ chaveNfe: id }, { limit: 10 })).rows || [];
      setTracking(rows);
      if (!achado && rows.length) setMsg('CT-e não está na base, mas há registro no tracking.');
    } catch (err) {
      setMsg(err.message || 'Erro na consulta.');
    } finally {
      setCarregando(false);
    }
  }

  // Calcula e grava aqui mesmo, com os mesmos padroes da Auditoria rapida
  // (peso do CT-e, apenas dados completos). Nao reaudita a fatura: pra isso
  // use "Abrir na Auditoria".
  async function recalcularAqui() {
    const chave = dig(pick(cte, ['chave_cte', 'chaveCte'])) || dig(busca);
    if (!chave) return;
    setCalculando(true);
    setMsg('');
    setCalculo(null);
    try {
      const { registros } = await processarCtesPorChave([chave], null, {
        ignorarCubagem: true,
        percentualContingenciaPeso: 0,
        apenasDadosCompletos: true,
      });
      const r = registros[0];
      if (!r) { setMsg('Não foi possível calcular: CT-e não encontrado.'); return; }
      const competencia = r.competencia || new Date().toISOString().slice(0, 7);
      await salvarRecorteCarregadoAuditoria({ competencia, registros: [r], atualizarResumoMensal: false });
      setCalculo(r);
      setMsg('Calculado e salvo na auditoria.');
    } catch (err) {
      setMsg(err.message || 'Erro ao recalcular.');
    } finally {
      setCalculando(false);
    }
  }

  function abrirNaAuditoria() {
    const chave = dig(pick(cte, ['chave_cte', 'chaveCte'])) || dig(busca);
    try { window.localStorage.setItem(CHAVE_RECALCULAR_CTE, chave); } catch { /* segue via evento */ }
    onRecalcular?.();
    // Espera a tela montar antes de avisar (se ela ja estava aberta, o evento preenche na hora).
    [50, 400, 1200].forEach((ms) => setTimeout(() => window.dispatchEvent(new CustomEvent(EVENTO_RECALCULAR_CTE, { detail: chave })), ms));
    setAberto(false);
  }

  const valorCte = pick(cte, ['valor_cte', 'valorCte', 'valor_frete', 'frete']);
  const t = tracking[0];

  return (
    <>
      <button type="button" style={estilo.botao} onClick={() => setAberto((v) => !v)} title="Consulta rápida de CT-e (Alt+C)">
        CT-e (Alt+C)
      </button>
      {aberto ? (
        <div style={estilo.fundo} onMouseDown={(e) => { if (e.target === e.currentTarget) setAberto(false); }}>
          <div style={estilo.painel} role="dialog" aria-label="Consulta rápida de CT-e">
            <div style={{ ...estilo.linha, justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Consulta CT-e</strong>
              <button type="button" onClick={() => setAberto(false)} style={{ cursor: 'pointer' }} aria-label="Fechar">✕</button>
            </div>
            <form style={estilo.linha} onSubmit={pesquisar}>
              <input ref={inputRef} style={estilo.input} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Chave do CT-e (ou da NF-e / número do CT-e)" />
              <button type="submit" style={estilo.primario} disabled={carregando}>{carregando ? '...' : 'Buscar'}</button>
            </form>
            {msg ? <div style={{ fontSize: 12, marginBottom: 8 }}>{msg}</div> : null}
            <div style={estilo.corpo}>
              {cte ? (
                <>
                  <div style={estilo.titulo}>CT-e</div>
                  <div style={estilo.grade}>
                    <Campo rotulo="Número" valor={pick(cte, ['numero_cte', 'numeroCte'])} />
                    <Campo rotulo="Emissão" valor={data(pick(cte, ['data_emissao', 'emissao']))} />
                    <Campo rotulo="Transportadora" valor={pick(cte, ['transportadora', 'nome_transportadora', 'transportador'])} />
                    <Campo rotulo="Canal" valor={pick(cte, ['canal', 'canal_original'])} />
                    <Campo rotulo="Origem" valor={`${pick(cte, ['cidade_origem']) || '—'}/${pick(cte, ['uf_origem']) || '—'}`} />
                    <Campo rotulo="Destino" valor={`${pick(cte, ['cidade_destino']) || '—'}/${pick(cte, ['uf_destino']) || '—'}`} />
                    <Campo rotulo="IBGE destino" valor={pick(cte, ['ibge_destino'])} />
                    <Campo rotulo="Valor CT-e" valor={moeda(valorCte)} />
                    <Campo rotulo="Valor NF" valor={moeda(pick(cte, ['valor_nf', 'valorNF']))} />
                    <Campo rotulo="Peso" valor={num(pick(cte, ['peso', 'peso_declarado']))} />
                    <Campo rotulo="Cubagem" valor={num(pick(cte, ['cubagem', 'cubagem_total']), 4)} />
                    <Campo rotulo="Volumes" valor={num(pick(cte, ['qtd_volumes']), 0)} />
                    <Campo rotulo="Chave NF-e" valor={pick(cte, ['chave_nfe'])} />
                  </div>
                </>
              ) : null}
              {calculo ? (
                <>
                  <div style={estilo.titulo}>Cálculo AMD</div>
                  <div style={estilo.grade}>
                    <Campo rotulo="Valor CT-e" valor={moeda(calculo.valor_cte)} />
                    <Campo rotulo="Valor calculado" valor={Number(calculo.valor_calculado) > 0 ? moeda(calculo.valor_calculado) : '—'} />
                    <Campo rotulo="Diferença" valor={Number(calculo.valor_calculado) > 0 ? moeda(calculo.diferenca) : '—'} />
                    <Campo rotulo="Status" valor={calculo.status_auditoria || calculo.status_calculo} />
                    <Campo rotulo="Tabela" valor={pick(calculo, ['tabela_nome_aplicada'])} />
                    <Campo rotulo="Motivo" valor={calculo.motivo_sem_calculo} />
                  </div>
                </>
              ) : null}
              {t ? (
                <>
                  <div style={estilo.titulo}>Tracking / Nota fiscal{tracking.length > 1 ? ` (${tracking.length} registros)` : ''}</div>
                  <div style={estilo.grade}>
                    <Campo rotulo="Nota fiscal" valor={t.notaFiscal} />
                    <Campo rotulo="Chave NF-e" valor={t.chaveNfe} />
                    <Campo rotulo="Pedido" valor={t.pedido || t.pedidoErp} />
                    <Campo rotulo="Transportadora" valor={t.transportadora} />
                    <Campo rotulo="Canal" valor={t.canal} />
                    <Campo rotulo="Origem" valor={`${t.cidadeOrigem || '—'}/${t.ufOrigem || '—'}`} />
                    <Campo rotulo="Destino" valor={`${t.cidadeDestino || '—'}/${t.ufDestino || '—'}`} />
                    <Campo rotulo="Valor NF" valor={moeda(t.valorNF)} />
                    <Campo rotulo="Peso" valor={num(t.peso)} />
                    <Campo rotulo="Cubagem final" valor={num(t.cubagemFinal, 4)} />
                    <Campo rotulo="Volumes" valor={num(t.qtdVolumes, 0)} />
                    <Campo rotulo="Prev. cliente" valor={data(t.previsaoCliente)} />
                    <Campo rotulo="Data transporte" valor={data(t.dataTransporte)} />
                    <Campo rotulo="Entrega" valor={data(t.entrega)} />
                  </div>
                </>
              ) : (cte && !carregando ? <div style={{ fontSize: 12, color: '#64748b' }}>Sem registro no tracking para esse CT-e.</div> : null)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 11, color: '#64748b' }}>Esc fecha.</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" style={{ ...estilo.primario, background: '#475569' }} onClick={abrirNaAuditoria} disabled={!cte && !dig(busca)}>Abrir na Auditoria</button>
                <button type="button" style={estilo.primario} onClick={recalcularAqui} disabled={calculando || (!cte && !dig(busca))}>{calculando ? 'Calculando...' : 'Recalcular e salvar'}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
