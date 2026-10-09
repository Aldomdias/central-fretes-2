import { useCallback, useEffect, useMemo, useState } from 'react';
import { carregarTabelasLotacao, obterTabelasPorTipo } from '../utils/lotacaoTables';
import {
  carregarTabelasLotacaoSupabase, lotacaoSupabaseConfigurado, resumoRotasLotacaoSupabase,
} from '../services/lotacaoSupabaseService';
import {
  alterarStatusCotacao, carregarCotacao, criarCotacao, excluirConvite, excluirCotacao,
  gerarConvite, linkConviteCotacao, listarCotacoes, renovarConvite,
} from '../services/lotacaoCotacaoService';

const norm = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const brl = (v) => (v == null ? '-' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const chaveRota = (o, d, t) => `${norm(o)}|${norm(d)}|${norm(t)}`;
const dataBr = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '-');
const fmtCnpj = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') || '-';

const STATUS_COR = { PENDENTE: '#6B7280', EM_PREENCHIMENTO: '#D97706', ENVIADO: '#1D9E75' };
const STATUS_TXT = { PENDENTE: 'Não acessou', EM_PREENCHIMENTO: 'Preenchendo', ENVIADO: 'Enviado' };

const card = { background: '#fff', border: '1px solid #dbe3ef', borderRadius: 14, padding: 20, marginBottom: 18 };
const h2 = { margin: '0 0 4px', fontSize: 18, color: '#06183d' };
const btn = { background: '#185FA5', color: '#fff', border: 0, borderRadius: 8, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' };
const btnSec = { ...btn, background: '#fff', color: '#185FA5', border: '1px solid #185FA5', padding: '6px 10px', fontSize: 12 };
const inp = { padding: '9px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 };

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
      KM: r.km, 'Viagens historicas': r.viagens, Transportadora: c.transportadora, 'CNPJ informado': c.respondente_cnpj,
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 10px', gap: 10, flexWrap: 'wrap' }}>
        <small>Todas as propostas na mesma base: <b>bruto = (líquido + pedágio) ÷ (1 − ICMS)</b>.</small>
        <button style={btn} onClick={exportar}>Exportar propostas (Excel)</button>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: 480 }}>
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

export default function LotacaoCotacaoPage() {
  const usarSupabase = lotacaoSupabaseConfigurado();
  const [tabelas, setTabelas] = useState([]);
  const [resumoRealizado, setResumoRealizado] = useState([]);
  const [cotacoes, setCotacoes] = useState([]);
  const [cotacaoId, setCotacaoId] = useState('');
  const [dados, setDados] = useState(null);
  const [msg, setMsg] = useState({ tipo: '', texto: '' });
  const [ocupado, setOcupado] = useState(false);

  const [nomeCotacao, setNomeCotacao] = useState('');
  const [nomeTransp, setNomeTransp] = useState('');
  const [dias, setDias] = useState(5);
  const [soAtendidas, setSoAtendidas] = useState(false);
  const [ultimoLink, setUltimoLink] = useState(null);

  const aviso = (texto, tipo = 'ok') => setMsg({ tipo, texto });

  useEffect(() => {
    (async () => {
      try {
        const resp = usarSupabase ? await carregarTabelasLotacaoSupabase() : { tabelas: carregarTabelasLotacao() };
        setTabelas(resp.tabelas || []);
      } catch { setTabelas(carregarTabelasLotacao()); }
      if (usarSupabase) resumoRotasLotacaoSupabase({}).then((d) => setResumoRealizado(d || [])).catch(() => {});
    })();
  }, [usarSupabase]);

  const transportadoras = useMemo(() => obterTabelasPorTipo(tabelas, 'TRANSPORTADORA'), [tabelas]);
  const tabelaDoNome = useMemo(() => transportadoras.find((t) => norm(t.nome) === norm(nomeTransp)), [transportadoras, nomeTransp]);

  const recarregarLista = useCallback(async () => {
    try {
      const lista = await listarCotacoes();
      setCotacoes(lista);
      setCotacaoId((atual) => atual || lista.find((c) => c.status === 'ABERTA')?.id || lista[0]?.id || '');
    } catch (e) { aviso(`Cotação indisponível (migration aplicada?): ${e.message}`, 'erro'); }
  }, []);
  useEffect(() => { recarregarLista(); }, [recarregarLista]);

  const recarregarDados = useCallback(async () => {
    if (!cotacaoId) { setDados(null); return; }
    try { setDados(await carregarCotacao(cotacaoId)); } catch (e) { aviso(e.message, 'erro'); }
  }, [cotacaoId]);
  useEffect(() => { recarregarDados(); }, [recarregarDados]);

  const cotacaoAtual = cotacoes.find((c) => c.id === cotacaoId);

  const criar = async () => {
    if (!nomeCotacao.trim()) { aviso('Dê um nome à cotação (ex.: Cotação lotação out/2026).', 'erro'); return; }
    const rotas = montarRotas(transportadoras, resumoRealizado);
    if (!rotas.length) { aviso('Não há rotas na base de lotação para montar a cotação.', 'erro'); return; }
    setOcupado(true);
    try {
      const cot = await criarCotacao({ nome: nomeCotacao.trim(), periodoLabel: 'Realizado', rotas });
      setNomeCotacao('');
      await recarregarLista();
      setCotacaoId(cot.id);
      aviso(`Cotação criada com ${rotas.length} rotas/tipos de veículo.`);
    } catch (e) { aviso(`Erro ao criar: ${e.message}`, 'erro'); } finally { setOcupado(false); }
  };

  const gerar = async () => {
    if (!nomeTransp.trim()) { aviso('Digite o nome do transportador.', 'erro'); return; }
    setOcupado(true);
    try {
      let idCot = cotacaoId;
      if (!idCot) {
        const rotas = montarRotas(transportadoras, resumoRealizado);
        if (!rotas.length) throw new Error('Não há rotas na base de lotação para montar a cotação.');
        const cot = await criarCotacao({ nome: `Cotação lotação ${new Date().toLocaleDateString('pt-BR')}`, periodoLabel: 'Realizado', rotas });
        idCot = cot.id;
        setCotacaoId(idCot);
        await recarregarLista();
      }
      const chaves = soAtendidas && tabelaDoNome
        ? Array.from(new Set((tabelaDoNome.linhas || []).map((l) => chaveRota(l.origem, l.destino, l.tipo || l.tipo_veiculo))))
        : null;
      const cv = await gerarConvite({ cotacaoId: idCot, transportadora: nomeTransp.trim(), dias, chaves });
      setUltimoLink(cv);
      setNomeTransp('');
      setDados(await carregarCotacao(idCot));
      aviso(`Link gerado para ${cv.transportadora}, válido por ${dias} dias.`);
    } catch (e) { aviso(e.message, 'erro'); } finally { setOcupado(false); }
  };

  const copiar = (token) => navigator.clipboard?.writeText(linkConviteCotacao(token)).then(() => aviso('Link copiado.'));
  const email = (cv) => {
    const assunto = encodeURIComponent(`Cotação de frete lotação — ${cotacaoAtual?.nome || ''}`);
    const ate = cv.expira_em ? `\nO link vale até ${dataBr(cv.expira_em)}.` : '';
    const corpo = encodeURIComponent(`Olá, ${cv.transportadora}!\n\nSegue o link para preenchimento da nossa tabela de lotação:\n${linkConviteCotacao(cv.token)}\n\nInforme o valor LÍQUIDO e o pedágio de cada rota; o ICMS e o valor bruto são calculados automaticamente. No primeiro acesso você informa o CNPJ da transportadora (obrigatório).${ate}\n\nObrigado!`);
    window.location.href = `mailto:?subject=${assunto}&body=${corpo}`;
  };

  const expirado = (cv) => cv.expira_em && new Date(cv.expira_em).getTime() < Date.now();

  return (
    <div style={{ padding: 4 }}>
      <div style={card}>
        <h1 style={{ margin: '0 0 6px', fontSize: 22, color: '#06183d' }}>Cotação de lotação — portal do transportador</h1>
        <small>
          Você gera um link por transportador. Ele preenche <b>valor líquido + pedágio</b> por rota e tipo de veículo; o ICMS sai da origem/destino e o
          <b> valor bruto</b> é calculado — assim todas as tabelas chegam na mesma base de comparação.
        </small>
      </div>

      {msg.texto && (
        <div className="hint-box" style={{ marginBottom: 14, background: msg.tipo === 'erro' ? '#fee2e2' : '#dcfce7', color: msg.tipo === 'erro' ? '#991b1b' : '#166534' }}>{msg.texto}</div>
      )}

      <div style={card}>
        <h2 style={h2}>1. Gerar link para o transportador</h2>
        <small>Digite o nome de quem vai responder e clique em <b>Gerar link</b>. Aqui entra o nome do <b>transportador</b>. Cada clique em <b>Gerar link</b> cria um código novo e exclusivo. O CNPJ é pedido ao transportador no primeiro acesso (obrigatório).</small>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '12px 0', alignItems: 'end' }}>
          <label style={{ flex: 1, minWidth: 260, fontSize: 13, fontWeight: 700 }}>Nome do transportador
            <input style={{ ...inp, width: '100%', fontWeight: 400 }} list="lot-cot-transp" placeholder="Digite o nome (ou escolha uma já cadastrada)" value={nomeTransp} onChange={(e) => setNomeTransp(e.target.value)} />
            <datalist id="lot-cot-transp">{transportadoras.map((t) => <option key={t.id || t.nome} value={t.nome} />)}</datalist>
          </label>
          <label style={{ fontSize: 13, fontWeight: 700 }}>Validade do link (dias)
            <input style={{ ...inp, width: 90, display: 'block', fontWeight: 400 }} type="number" min="1" max="60" value={dias} onChange={(e) => setDias(e.target.value)} />
          </label>
          <button style={btn} disabled={ocupado} onClick={gerar}>Gerar link</button>
        </div>
        {tabelaDoNome && (
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={soAtendidas} onChange={(e) => setSoAtendidas(e.target.checked)} /> Enviar só as rotas que {tabelaDoNome.nome} já atende (senão recebe todas)</label>
        )}
        {ultimoLink && (
          <div className="hint-box" style={{ marginTop: 12 }}>
            <b>Link de {ultimoLink.transportadora}</b> (vale até {dataBr(ultimoLink.expira_em)}):
            <div style={{ wordBreak: 'break-all', margin: '6px 0', fontFamily: 'monospace', fontSize: 12 }}>{linkConviteCotacao(ultimoLink.token)}</div>
            <button style={btn} onClick={() => copiar(ultimoLink.token)}>Copiar link</button>{' '}
            <button style={btnSec} onClick={() => email(ultimoLink)}>Abrir e-mail</button>
          </div>
        )}
      </div>

      <details style={card}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#06183d' }}>Avançado: cotação atual — {cotacaoAtual ? cotacaoAtual.name || cotacaoAtual.nome : 'será criada automaticamente'} (criar outra / encerrar / excluir)</summary>
        <small style={{ display: 'block', marginTop: 8 }}>A cotação guarda as rotas e a volumetria. Todos os links gerados dentro dela são comparados entre si.</small>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '12px 0', alignItems: 'center' }}>
          <select style={{ ...inp, minWidth: 260 }} value={cotacaoId} onChange={(e) => { setCotacaoId(e.target.value); setUltimoLink(null); }}>
            {!cotacoes.length && <option value="">Nenhuma cotação ainda</option>}
            {cotacoes.map((c) => <option key={c.id} value={c.id}>{c.nome} · {c.status === 'ABERTA' ? 'aberta' : 'encerrada'} · {dataBr(c.created_at)}</option>)}
          </select>
          {cotacaoAtual && (
            <>
              <button style={btnSec} onClick={async () => { await alterarStatusCotacao(cotacaoAtual.id, cotacaoAtual.status === 'ABERTA' ? 'ENCERRADA' : 'ABERTA'); recarregarLista(); }}>{cotacaoAtual.status === 'ABERTA' ? 'Encerrar cotação' : 'Reabrir'}</button>
              <button style={btnSec} onClick={async () => { if (window.confirm('Excluir a cotação, os links e todas as propostas?')) { await excluirCotacao(cotacaoAtual.id); setCotacaoId(''); setDados(null); recarregarLista(); } }}>Excluir</button>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ ...inp, flex: 1, minWidth: 240 }} placeholder="Nova cotação: nome (ex.: Cotação lotação out/2026)" value={nomeCotacao} onChange={(e) => setNomeCotacao(e.target.value)} />
          <button style={btn} disabled={ocupado} onClick={criar}>Criar cotação</button>
        </div>
        <small>Ao criar, as rotas são montadas a partir das tabelas de lotação e do realizado ({montarRotas(transportadoras, resumoRealizado).length} rotas/tipos de veículo hoje).</small>
      </details>

      <div style={card}>
        <h2 style={h2}>2. Links gerados e respostas</h2>
        {!dados?.convites?.length ? <div className="hint-box" style={{ marginTop: 8 }}>Nenhum link gerado nesta cotação.</div> : (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead><tr><th>Transportador</th><th>Expira em</th><th>Status</th><th>CNPJ informado</th><th>Respondente</th><th>Rotas cotadas</th><th>Ações</th></tr></thead>
              <tbody>
                {dados.convites.map((cv) => (
                  <tr key={cv.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                    <td><b>{cv.transportadora}</b></td>
                    <td style={{ color: expirado(cv) ? '#b91c1c' : undefined, fontWeight: expirado(cv) ? 700 : 400 }}>{cv.expira_em ? `${dataBr(cv.expira_em)}${expirado(cv) ? ' (expirado)' : ''}` : 'sem prazo'}</td>
                    <td style={{ color: STATUS_COR[cv.status], fontWeight: 700 }}>{STATUS_TXT[cv.status] || cv.status}</td>
                    <td>{fmtCnpj(cv.respondente_cnpj)}</td>
                    <td>{cv.respondente_nome ? `${cv.respondente_nome} (${cv.respondente_email})` : '-'}</td>
                    <td>{dados.propostas.filter((p) => p.convite_id === cv.id).length}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button style={btnSec} onClick={() => copiar(cv.token)}>Copiar link</button>{' '}
                      <button style={btnSec} onClick={() => email(cv)}>E-mail</button>{' '}
                      <button style={btnSec} onClick={async () => { await renovarConvite(cv.id, dias); recarregarDados(); aviso(`Prazo renovado por ${dias} dias.`); }}>Renovar prazo</button>{' '}
                      <button style={btnSec} onClick={async () => { if (window.confirm(`Excluir o link de ${cv.transportadora} e as propostas dele?`)) { await excluirConvite(cv.id); recarregarDados(); } }}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p><button style={btnSec} onClick={recarregarDados}>Atualizar respostas</button></p>
      </div>

      {dados && cotacaoAtual && (
        <div style={card}>
          <h2 style={h2}>3. Propostas recebidas</h2>
          <Analise dados={dados} cotacao={cotacaoAtual} />
        </div>
      )}
    </div>
  );
}
