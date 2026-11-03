import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../../lib/supabaseClient';
import { listarLancamentosComFatura } from '../../services/robosLancamentosService';
import { STATUS_ROBO_AUDITA, buscarTodasPaginas, reavaliarFaturaRobo } from '../../services/auditorRoboService';
import { normalizarNumeroFatura } from '../../utils/robos/historicoLancamentos';
import { conferirNfseLancada, ehLinhaNfse } from '../../utils/nfseFatura';
import { carregarSessao } from '../../utils/authLocal';

const moeda = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const th = { textAlign: 'left', padding: '6px 6px', fontSize: 11, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#f8fafc' };
const td = { padding: '4px 6px', fontSize: 12, borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' };

const SITUACOES = {
  lancar: { rotulo: 'Aguardando lançamento', cor: '#c2410c' },
  parcial: { rotulo: 'Lançamento parcial', cor: '#b45309' },
  valor: { rotulo: 'Valor não bate', cor: '#b91c1c' },
  fechou: { rotulo: 'Fechou: liberar', cor: '#14733b' },
  misto: { rotulo: 'Tem CT-e também', cor: '#475569' },
};

// Fila das faturas em auditoria que tem NFS-e (nota de servico, nao CT-e): o robo auditor nunca resolve sozinho,
// entao entram aqui para alguem pegar os PDFs e lancar. Quando as notas com MIRO batem com o valor da fatura,
// o Robo Auditor libera para pagamento (na proxima execucao, ou no botao "Liberar").
export default function FilaNfseFaturas({ onLerPdfs, recarregarEm = 0 }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState('');
  const [liberando, setLiberando] = useState('');
  const [aviso, setAviso] = useState('');
  const [aberto, setAberto] = useState(true);

  async function carregar() {
    if (!isSupabaseConfigured()) { setDados({ faturas: [], lancamentos: [], porFatura: new Map(), execucoes: new Map() }); return; }
    try {
      setErro('');
      const db = getSupabaseClient();
      // Linhas de NFS-e (serie SPN, CWN, RJN... ou OS) de faturas ainda em auditoria.
      const { data: linhasNfse, error } = await buscarTodasPaginas((de, ate) => db.from('fatura_detalhes')
        .select('fatura_id,numero_cte,serie_cte,chave_cte,valor_frete,faturas!inner(status)')
        .eq('excluido_da_versao', false).in('faturas.status', STATUS_ROBO_AUDITA)
        .or('serie_cte.ilike.__n,serie_cte.ilike.os').order('fatura_id').range(de, ate));
      if (error) throw new Error(error.message);
      const ids = [...new Set((linhasNfse || []).filter(ehLinhaNfse).map((l) => String(l.fatura_id)))];
      const faturas = [];
      const porFatura = new Map();
      const execucoes = new Map();
      for (let i = 0; i < ids.length; i += 100) {
        const lote = ids.slice(i, i + 100);
        const [{ data: fs, error: e1 }, { data: dets, error: e2 }, { data: exs }] = await Promise.all([
          db.from('faturas').select('*').in('id', lote),
          db.from('fatura_detalhes').select('fatura_id,numero_cte,serie_cte,chave_cte,valor_frete').eq('excluido_da_versao', false).in('fatura_id', lote).limit(20000),
          db.from('auditor_robo_execucoes').select('*').in('fatura_id', lote),
        ]);
        if (e1 || e2) throw new Error((e1 || e2).message);
        faturas.push(...(fs || []));
        (dets || []).forEach((d) => porFatura.set(String(d.fatura_id), [...(porFatura.get(String(d.fatura_id)) || []), d]));
        (exs || []).forEach((x) => execucoes.set(String(x.fatura_id), x));
      }
      const numeros = [...new Set(faturas.flatMap((f) => [String(f.numero_fatura || '').trim(), normalizarNumeroFatura(f.numero_fatura)]).filter(Boolean))];
      const lancamentos = [];
      for (let i = 0; i < numeros.length; i += 200) {
        const { registros } = await listarLancamentosComFatura({ numeros: numeros.slice(i, i + 200) });
        lancamentos.push(...registros.filter((r) => r.tipo === 'NFSE'));
      }
      setDados({ faturas, lancamentos, porFatura, execucoes });
    } catch (e) { setErro(e.message || 'Nao consegui carregar a fila de NFS-e.'); setDados({ faturas: [], lancamentos: [], porFatura: new Map(), execucoes: new Map() }); }
  }

  useEffect(() => { carregar(); }, [recarregarEm]);

  const linhas = useMemo(() => (dados?.faturas || []).map((f) => {
    const docs = dados.porFatura.get(String(f.id)) || [];
    const nfse = docs.filter(ehLinhaNfse);
    const conf = conferirNfseLancada(f, nfse.length, dados.lancamentos);
    const misto = nfse.length < docs.length;
    let situacao = 'lancar';
    if (misto) situacao = 'misto';
    else if (conf.fechou) situacao = 'fechou';
    else if (conf.lancadas && conf.lancadas >= conf.esperadas) situacao = 'valor';
    else if (conf.lancadas || conf.comPedido) situacao = 'parcial';
    return { f, nfse, docs, conf, situacao };
  }).sort((a, b) => String(a.f.data_vencimento || '').localeCompare(String(b.f.data_vencimento || ''))), [dados]);

  const cont = (id) => linhas.filter((l) => l.situacao === id).length;
  const visiveis = filtro ? linhas.filter((l) => l.situacao === filtro) : linhas;
  const fechadas = linhas.filter((l) => l.situacao === 'fechou');

  // Reavalia pelo Robo Auditor (sem recalcular): ele confere de novo e libera, gravando historico e execucao.
  async function liberar(lista) {
    const usuario = carregarSessao()?.nome || 'auditor';
    let ok = 0;
    const falhas = [];
    for (const l of lista) {
      setLiberando(String(l.f.id));
      try {
        const reg = await reavaliarFaturaRobo(l.f, dados.execucoes.get(String(l.f.id)) || null, { usuario, soEntrega: true });
        if (reg.modo === 'NFSE_LANCADA') ok += 1; else falhas.push(`${l.f.numero_fatura}: ${reg.motivo}`);
      } catch (e) { falhas.push(`${l.f.numero_fatura}: ${e.message}`); }
    }
    setLiberando('');
    setAviso(`${ok} fatura(s) liberada(s) para pagamento.${falhas.length ? ` Nao liberadas: ${falhas.slice(0, 3).join(' | ')}${falhas.length > 3 ? ` (+${falhas.length - 3})` : ''}` : ''}`);
    carregar();
  }

  const tile = (id) => (
    <button key={id} type="button" onClick={() => setFiltro(filtro === id ? '' : id)}
      style={{ flex: '1 1 130px', border: `2px solid ${SITUACOES[id].cor}`, borderRadius: 10, padding: '6px 10px', textAlign: 'left', cursor: 'pointer', background: filtro === id ? SITUACOES[id].cor : '#fff', color: filtro === id ? '#fff' : SITUACOES[id].cor }}>
      <div style={{ fontSize: 11, color: filtro === id ? '#fff' : '#475569' }}>{SITUACOES[id].rotulo}</div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{cont(id)}</div>
    </button>
  );

  return (
    <div className="panel-card" style={{ borderLeft: '4px solid #0f766e' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="panel-title" style={{ margin: 0, cursor: 'pointer' }} onClick={() => setAberto((v) => !v)}>{aberto ? '▾' : '▸'} Fila: faturas com NFS-e</div>
        <span style={{ fontSize: 12, color: '#475569' }}>{dados === null ? 'carregando...' : `${linhas.length} fatura(s) em auditoria com nota de serviço`}</span>
        <button type="button" className="btn-secondary" style={{ marginLeft: 'auto' }} onClick={carregar}>Atualizar</button>
        {fechadas.length ? <button type="button" className="btn-primary" disabled={Boolean(liberando)} onClick={() => liberar(fechadas)}>{liberando ? 'Liberando...' : `Liberar as que fecharam (${fechadas.length})`}</button> : null}
      </div>
      {aberto && (
        <>
          <p style={{ margin: '6px 0 10px', fontSize: 13 }}>
            Faturas que o Robô Auditor marcou com NFS-e. Pegue os PDFs da fatura e clique em <b>Ler PDFs</b>: as notas entram na grade abaixo já com o número da fatura.
            Quando todas tiverem MIRO e a soma bater com o valor da fatura, ela é <b>liberada para pagamento sozinha</b> na próxima execução do robô (ou agora, no botão verde).
          </p>
          {erro ? <div style={{ padding: 10, borderRadius: 8, background: '#fee2e2', color: '#991b1b', marginBottom: 8 }}>{erro}</div> : null}
          {aviso ? <div style={{ padding: 10, borderRadius: 8, background: '#dcfce7', color: '#166534', marginBottom: 8 }}>{aviso}</div> : null}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>{Object.keys(SITUACOES).map(tile)}</div>
          <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid #e2e8f0', borderRadius: 6 }}>
            <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>Fatura</th><th style={th}>Transportadora</th><th style={th}>Emissão</th><th style={th}>Vencimento</th><th style={th}>Valor fatura</th>
                  <th style={th}>NFS-e na fatura</th><th style={th}>Com MIRO</th><th style={th}>Valor lançado</th><th style={th}>Situação</th><th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map(({ f, nfse, docs, conf, situacao }) => (
                  <tr key={f.id}>
                    <td style={td}>{f.numero_fatura}</td>
                    <td style={td}>{f.transportadora}</td>
                    <td style={td}>{dataBr(f.data_emissao)}</td>
                    <td style={td}>{dataBr(f.data_vencimento)}</td>
                    <td style={td}>{moeda(f.valor_fatura)}</td>
                    <td style={td} title={nfse.map((n) => `${n.numero_cte}/${n.serie_cte}`).join(', ')}>
                      {nfse.length}{situacao === 'misto' ? ` de ${docs.length}` : ''} <span style={{ color: '#64748b' }}>({nfse.slice(0, 3).map((n) => n.numero_cte).join(', ')}{nfse.length > 3 ? '…' : ''})</span>
                    </td>
                    <td style={td}>{conf.lancadas}/{conf.esperadas}</td>
                    <td style={td}>{conf.lancadas ? moeda(conf.valor) : '-'}</td>
                    <td style={{ ...td, color: SITUACOES[situacao].cor, fontWeight: 700 }} title={situacao === 'misto' ? 'Tem CT-e na mesma fatura: o CT-e segue a auditoria normal; a NFS-e precisa ser lançada aqui.' : conf.texto}>
                      {SITUACOES[situacao].rotulo}{situacao === 'valor' ? ` (${moeda(conf.diferenca)})` : ''}
                    </td>
                    <td style={td}>
                      {situacao === 'fechou'
                        ? <button type="button" className="btn-link" disabled={Boolean(liberando)} onClick={() => liberar([{ f }])}>{liberando === String(f.id) ? 'liberando...' : 'Liberar'}</button>
                        : <button type="button" className="btn-link" onClick={() => onLerPdfs?.(f)} title="Escolha os PDFs das NFS-e desta fatura: entram na grade com o número e o vencimento da fatura">Ler PDFs</button>}
                    </td>
                  </tr>
                ))}
                {dados && !visiveis.length ? <tr><td style={{ ...td, padding: 12, color: '#14733b', fontWeight: 700 }} colSpan={10}>✓ Nenhuma fatura nesta situação.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
