import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  alterarStatusCotacao, buscarCnpjRaizesPorNome, carregarCotacao, criarCotacao,
  excluirCotacao, linkConviteCotacao, listarCotacoes,
} from '../services/lotacaoCotacaoService';

const norm = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const brl = (v) => (v == null ? '-' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const chaveRota = (o, d, t) => `${norm(o)}|${norm(d)}|${norm(t)}`;

const STATUS_COR = { PENDENTE: '#6B7280', EM_PREENCHIMENTO: '#D97706', ENVIADO: '#1D9E75' };
const STATUS_TXT = { PENDENTE: 'Não acessou', EM_PREENCHIMENTO: 'Preenchendo', ENVIADO: 'Enviado' };

// Rotas da cotacao = malha das tabelas + rotas do realizado (volumetria).
function montarRotas(transportadoras, resumoRealizado) {
  const mapa = new Map();
  (transportadoras || []).forEach((t) => (t?.linhas || []).forEach((l) => {
    const origem = String(l.origem || '').trim();
    const destino = String(l.destino || '').trim();
    const tipo = String(l.tipo || l.tipo_veiculo || '').trim();
    if (!origem || !destino || !tipo) return;
    const chave = chaveRota(origem, destino, tipo);
    const target = Number(l.target || 0) || 0;
    const atual = mapa.get(chave);
    if (!atual) {
      mapa.set(chave, { chave, origem, uf_origem: l.ufOrigem || '', destino, uf_destino: l.ufDestino || '', tipo_veiculo: tipo, km: Number(l.km) || null, viagens: 0, frete_medio: null, target: target || null });
    } else {
      if (!atual.uf_origem && l.ufOrigem) atual.uf_origem = l.ufOrigem;
      if (!atual.uf_destino && l.ufDestino) atual.uf_destino = l.ufDestino;
      if (target > 0 && (!atual.target || target < atual.target)) atual.target = target;
    }
  }));
  (resumoRealizado || []).forEach((r) => {
    const origem = String(r.origem || '').trim();
    const destino = String(r.destino || '').trim();
    const tipo = String(r.tipo_veiculo || r.tipo || '').trim();
    if (!origem || !destino || !tipo) return;
    const chave = chaveRota(origem, destino, tipo);
    const viagens = Number(r.total_cargas || r.qtd_viagens || 0) || 0;
    const atual = mapa.get(chave) || { chave, origem, uf_origem: r.uf_origem || '', destino, uf_destino: r.uf_destino || '', tipo_veiculo: tipo, km: Number(r.km) || null, viagens: 0, frete_medio: null, target: null };
    atual.viagens = Math.max(atual.viagens, viagens);
    atual.frete_medio = Number(r.frete_medio) || atual.frete_medio;
    mapa.set(chave, atual);
  });
  return Array.from(mapa.values());
}

function Analise({ dados, cotacao }) {
  const { convites, rotas, propostas } = dados;
  const linhas = useMemo(() => {
    const respondentes = convites.filter((c) => propostas.some((p) => p.convite_id === c.id));
    return rotas.map((r) => {
      const ofertas = respondentes
        .map((c) => ({ c, p: propostas.find((p) => p.convite_id === c.id && p.chave === r.chave) }))
        .filter((x) => x.p)
        .sort((a, b) => a.p.valor_bruto - b.p.valor_bruto);
      return { r, ofertas, melhor: ofertas[0] || null };
    }).filter((x) => x.ofertas.length).sort((a, b) => Number(b.r.viagens || 0) - Number(a.r.viagens || 0));
  }, [convites, rotas, propostas]);

  const exportar = () => import('xlsx').then((XLSX) => {
    const rows = [];
    linhas.forEach(({ r, ofertas, melhor }) => ofertas.forEach(({ c, p }) => rows.push({
      Origem: r.origem, 'UF origem': r.uf_origem, Destino: r.destino, 'UF destino': r.uf_destino, 'Tipo de veiculo': r.tipo_veiculo,
      KM: r.km, 'Viagens historicas': r.viagens, Transportadora: c.transportadora,
      'Valor liquido': p.valor_liquido, Pedagio: p.pedagio, 'ICMS %': p.aliquota_icms, 'ICMS R$': p.icms_valor, 'Valor bruto total': p.valor_bruto,
      'Prazo (dias)': p.prazo_dias, Validade: p.validade, Observacao: p.observacao,
      'Menor bruto da rota?': melhor?.c.id === c.id ? 'SIM' : '',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Propostas');
    XLSX.writeFile(wb, `cotacao-lotacao-${String(cotacao.nome).replace(/[^a-z0-9]+/gi, '-')}.xlsx`);
  });

  if (!linhas.length) return <div className="hint-box">Nenhuma proposta recebida ainda.</div>;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0' }}>
        <small>Todas as propostas na mesma base: <b>bruto = (líquido + pedágio) ÷ (1 − ICMS)</b>.</small>
        <button className="btn-primary" onClick={exportar}>Exportar propostas (Excel)</button>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: 460 }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead><tr><th>Rota</th><th>Veículo</th><th>Viagens</th><th>Menor bruto</th><th>Transportadora</th><th>Todas as ofertas (bruto)</th></tr></thead>
          <tbody>
            {linhas.slice(0, 400).map(({ r, ofertas, melhor }) => (
              <tr key={r.chave} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td>{r.origem} → {r.destino}</td><td>{r.tipo_veiculo}</td><td>{Math.round(r.viagens || 0) || '-'}</td>
                <td><b>{brl(melhor?.p.valor_bruto)}</b></td><td>{melhor?.c.transportadora}</td>
                <td>{ofertas.map((x) => `${x.c.transportadora}: ${brl(x.p.valor_bruto)}`).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LotacaoCotacaoPortal({ transportadoras, resumoRealizado, periodoLabel }) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [prazo, setPrazo] = useState('');
  const [sel, setSel] = useState({}); // nome da tabela -> { ativo, cnpj, soAtendidas }
  const [lista, setLista] = useState([]);
  const [detalhe, setDetalhe] = useState(null);
  const [msg, setMsg] = useState('');
  const [salvando, setSalvando] = useState(false);

  const rotas = useMemo(() => (aberto ? montarRotas(transportadoras, resumoRealizado) : []), [aberto, transportadoras, resumoRealizado]);

  const recarregar = useCallback(
    () => listarCotacoes().then(setLista).catch((e) => setMsg(`Cotações indisponíveis (migration aplicada?): ${e.message}`)),
    [],
  );
  useEffect(() => { if (aberto) recarregar(); }, [aberto, recarregar]);

  // Preenche o CNPJ a partir do cadastro de transportadoras (editavel).
  useEffect(() => {
    if (!aberto) return;
    (transportadoras || []).forEach((t) => {
      const n = t.nome;
      if (!n) return;
      buscarCnpjRaizesPorNome(n).then((raizes) => setSel((s) => (s[n]?.cnpjCarregado ? s : {
        ...s, [n]: { ...(s[n] || {}), cnpjCarregado: true, cnpj: s[n]?.cnpj || raizes.join(', ') },
      })));
    });
  }, [aberto, transportadoras]);

  const gerar = async () => {
    const escolhidas = (transportadoras || []).filter((t) => sel[t.nome]?.ativo);
    if (!nome.trim() || !escolhidas.length) { setMsg('Informe o nome da cotação e marque ao menos uma transportadora.'); return; }
    const semCnpj = escolhidas.filter((t) => !String(sel[t.nome]?.cnpj || '').replace(/\D/g, '').length);
    if (semCnpj.length) { setMsg(`Informe o CNPJ de: ${semCnpj.map((t) => t.nome).join(', ')} (é a identificação no portal).`); return; }
    setSalvando(true);
    setMsg('');
    try {
      const convites = escolhidas.map((t) => ({
        transportadora: t.nome,
        cnpjs: String(sel[t.nome].cnpj).split(/[,;\s]+/).filter(Boolean),
        chaves: sel[t.nome].soAtendidas === false
          ? null
          : Array.from(new Set((t.linhas || []).map((l) => chaveRota(l.origem, l.destino, l.tipo || l.tipo_veiculo)))),
      }));
      await criarCotacao({ nome: nome.trim(), periodoLabel, prazoResposta: prazo || null, rotas, convites });
      setNome('');
      setPrazo('');
      setMsg('Cotação criada. Abra "Links e propostas" para copiar o link de cada transportadora.');
      await recarregar();
    } catch (e) {
      setMsg(`Erro ao criar: ${e.message}`);
    } finally {
      setSalvando(false);
    }
  };

  const abrir = async (c) => {
    setMsg('');
    try { setDetalhe({ cotacao: c, ...(await carregarCotacao(c.id)) }); } catch (e) { setMsg(e.message); }
  };
  const copiar = (token) => navigator.clipboard?.writeText(linkConviteCotacao(token)).then(() => setMsg('Link copiado.'));
  const email = (c, cv) => {
    const assunto = encodeURIComponent(`Cotação de frete lotação — ${c.nome}`);
    const prazoTxt = c.prazo_resposta ? `\nPrazo: ${String(c.prazo_resposta).slice(0, 10).split('-').reverse().join('/')}` : '';
    const corpo = encodeURIComponent(`Olá, ${cv.transportadora}!\n\nSegue o link para preenchimento da nossa tabela de lotação:\n${linkConviteCotacao(cv.token)}\n\nInforme o valor LÍQUIDO e o pedágio de cada rota; o ICMS e o valor bruto são calculados automaticamente. Para entrar, tenha em mãos o CNPJ da transportadora.${prazoTxt}\n\nObrigado!`);
    window.location.href = `mailto:?subject=${assunto}&body=${corpo}`;
  };

  return (
    <div className="panel-card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setAberto(!aberto)}>
        <div>
          <div className="panel-title">Cotação online — portal do transportador</div>
          <small>Um link por transportadora; ela se identifica pelo CNPJ e informa valor líquido + pedágio. ICMS e bruto são calculados.</small>
        </div>
        <span>{aberto ? '▲' : '▼'}</span>
      </div>

      {aberto && (
        <div style={{ marginTop: 14 }}>
          {msg && <div className="hint-box" style={{ marginBottom: 10 }}>{msg}</div>}

          <b>Nova cotação</b> <small>({rotas.length} rotas/tipos de veículo, volumetria: {periodoLabel})</small>
          <div style={{ display: 'flex', gap: 10, margin: '8px 0', flexWrap: 'wrap' }}>
            <input placeholder="Nome (ex.: Cotação lotação out/2026)" value={nome} onChange={(e) => setNome(e.target.value)} style={{ flex: 1, minWidth: 240 }} />
            <label>Prazo de resposta <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} /></label>
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8 }}>
            <table style={{ width: '100%', fontSize: 12 }}>
              <thead><tr><th></th><th>Transportadora</th><th>CNPJ (identificação no portal)</th><th>Rotas</th></tr></thead>
              <tbody>
                {(transportadoras || []).map((t) => {
                  const s = sel[t.nome] || {};
                  return (
                    <tr key={t.id || t.nome}>
                      <td><input type="checkbox" checked={!!s.ativo} onChange={(e) => setSel({ ...sel, [t.nome]: { ...s, ativo: e.target.checked } })} /></td>
                      <td>{t.nome}</td>
                      <td><input style={{ width: '100%' }} placeholder="CNPJ (vários: separe por vírgula)" value={s.cnpj || ''} onChange={(e) => setSel({ ...sel, [t.nome]: { ...s, cnpj: e.target.value } })} /></td>
                      <td><label><input type="checkbox" checked={s.soAtendidas !== false} onChange={(e) => setSel({ ...sel, [t.nome]: { ...s, soAtendidas: e.target.checked } })} /> só as que ela já atende</label></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p><button className="btn-primary" disabled={salvando} onClick={gerar}>{salvando ? 'Gerando…' : 'Gerar links'}</button></p>

          <b>Cotações criadas</b>
          {!lista.length && <div className="hint-box">Nenhuma cotação ainda.</div>}
          {lista.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ flex: 1 }}><b>{c.nome}</b> <small>{new Date(c.created_at).toLocaleDateString('pt-BR')} · {c.status}</small></span>
              <button onClick={() => abrir(c)}>Links e propostas</button>
              <button onClick={async () => { await alterarStatusCotacao(c.id, c.status === 'ABERTA' ? 'ENCERRADA' : 'ABERTA'); recarregar(); }}>{c.status === 'ABERTA' ? 'Encerrar' : 'Reabrir'}</button>
              <button onClick={async () => { if (window.confirm('Excluir a cotação e todas as propostas?')) { await excluirCotacao(c.id); setDetalhe(null); recarregar(); } }}>Excluir</button>
            </div>
          ))}

          {detalhe && (
            <div style={{ marginTop: 14 }}>
              <b>{detalhe.cotacao.nome}</b>
              <table style={{ width: '100%', fontSize: 12, marginTop: 6 }}>
                <thead><tr><th>Transportadora</th><th>Status</th><th>Respondente</th><th>Rotas cotadas</th><th>Link</th></tr></thead>
                <tbody>
                  {detalhe.convites.map((cv) => (
                    <tr key={cv.id}>
                      <td>{cv.transportadora}</td>
                      <td style={{ color: STATUS_COR[cv.status], fontWeight: 700 }}>{STATUS_TXT[cv.status] || cv.status}</td>
                      <td>{cv.respondente_nome ? `${cv.respondente_nome} (${cv.respondente_email})` : '-'}</td>
                      <td>{detalhe.propostas.filter((p) => p.convite_id === cv.id).length}</td>
                      <td><button onClick={() => copiar(cv.token)}>Copiar link</button> <button onClick={() => email(detalhe.cotacao, cv)}>E-mail</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Analise dados={detalhe} cotacao={detalhe.cotacao} />
              <p><button onClick={() => abrir(detalhe.cotacao)}>Atualizar</button></p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
