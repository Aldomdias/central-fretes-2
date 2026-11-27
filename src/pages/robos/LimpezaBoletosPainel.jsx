import { useMemo, useState } from 'react';
import { faturaPaga } from '../../services/auditorRoboService';
import { apagarPdfsBoletos, listarPdfsGuardados, urlBoletoGuardado } from '../../services/boletoControleService';

// Limpeza manual dos PDFs de boleto guardados no servidor: lista por fatura (situacao, boleto atual e anteriores),
// seleciona e apaga so o arquivo. Valor, vencimento, linha digitavel e nome do arquivo continuam na fatura.
const dinheiro = (v) => (v == null ? '-' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', fontSize: 12, borderBottom: '1px solid #f1f5f9' };

const SITUACOES = {
  PAGA: { rotulo: 'Paga', cor: '#14733b' },
  CANCELADA: { rotulo: 'Cancelada/substituída', cor: '#64748b' },
  SEM_FATURA: { rotulo: 'Fatura não existe', cor: '#b91c1c' },
  ABERTA: { rotulo: 'Em aberto', cor: '#0369a1' },
};
function situacaoDe(item) {
  const f = item.fatura;
  if (!f) return 'SEM_FATURA';
  if (faturaPaga(f)) return 'PAGA';
  if (['CANCELADA', 'SUBSTITUIDA'].includes(f.status)) return 'CANCELADA';
  return 'ABERTA';
}
const FILTROS = [
  { id: 'SUJEIRA', rotulo: 'Podem sair (pagas, canceladas, sem fatura)', teste: (s) => s !== 'ABERTA' },
  { id: 'ANTERIORES', rotulo: 'Com boletos anteriores (trocados)', teste: (s, i) => i.anteriores.length > 0 },
  { id: 'ABERTA', rotulo: 'Em aberto', teste: (s) => s === 'ABERTA' },
  { id: 'TODAS', rotulo: 'Todas', teste: () => true },
];

export default function LimpezaBoletosPainel() {
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [filtro, setFiltro] = useState('SUJEIRA');
  const [busca, setBusca] = useState('');
  const [marcadas, setMarcadas] = useState(() => new Set());
  const [msg, setMsg] = useState({ texto: '', erro: false });
  const [apagando, setApagando] = useState(false);

  const carregar = async () => {
    setCarregando(true);
    setMsg({ texto: '', erro: false });
    try {
      setItens((await listarPdfsGuardados()).map((i) => ({ ...i, situacao: situacaoDe(i) })));
      setMarcadas(new Set());
    } catch (e) { setMsg({ texto: e.message, erro: true }); }
    setCarregando(false);
  };
  const abrir = () => { setAberto((v) => !v); if (!itens && !carregando) carregar(); };

  const contagem = useMemo(() => {
    const c = { PAGA: 0, CANCELADA: 0, SEM_FATURA: 0, ABERTA: 0, arquivos: 0, anteriores: 0 };
    (itens || []).forEach((i) => {
      c[i.situacao] += 1;
      c.arquivos += (i.boleto_arquivo_path ? 1 : 0) + i.anteriores.length;
      c.anteriores += i.anteriores.length;
    });
    return c;
  }, [itens]);

  const visiveis = useMemo(() => {
    const f = FILTROS.find((x) => x.id === filtro) || FILTROS[0];
    const t = norm(busca);
    return (itens || [])
      .filter((i) => f.teste(i.situacao, i))
      .filter((i) => !t || [i.fatura?.numero_fatura || i.numero_fatura, i.fatura?.transportadora || i.transportadora, i.boleto_arquivo_nome].some((v) => norm(v).includes(t)))
      .sort((a, b) => String(a.fatura?.data_vencimento || '').localeCompare(String(b.fatura?.data_vencimento || '')));
  }, [itens, filtro, busca]);

  const selecionadas = visiveis.filter((i) => marcadas.has(String(i.fatura_id)));
  const todasMarcadas = visiveis.length > 0 && selecionadas.length === visiveis.length;
  const alternar = (id) => setMarcadas((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const alternarTodas = () => setMarcadas(todasMarcadas ? new Set() : new Set(visiveis.map((i) => String(i.fatura_id))));

  const apagar = async () => {
    if (!selecionadas.length || apagando) return;
    const nArq = selecionadas.reduce((s, i) => s + (i.boleto_arquivo_path ? 1 : 0) + i.anteriores.length, 0);
    const emAberto = selecionadas.filter((i) => i.situacao === 'ABERTA').length;
    const aviso = `Apagar do servidor ${nArq} PDF(s) de ${selecionadas.length} fatura(s)?\n\n`
      + 'Os dados do boleto (valor, vencimento, linha digitável, nome do arquivo) continuam na fatura; só o arquivo sai e não dá para recuperar pelo sistema.'
      + (emAberto ? `\n\nAtenção: ${emAberto} fatura(s) ainda EM ABERTO. O robô não sobe de novo o mesmo boleto que estiver na pasta; um boleto diferente é guardado normalmente.` : '');
    if (!window.confirm(aviso)) return;
    setApagando(true);
    try {
      // Motivo por item: o que ja foi paga fica registrado como PAGA, o resto como limpeza manual.
      const porMotivo = { PAGA: [], MANUAL: [] };
      selecionadas.forEach((i) => porMotivo[i.situacao === 'PAGA' ? 'PAGA' : 'MANUAL'].push(i));
      let total = 0;
      for (const [motivo, lista] of Object.entries(porMotivo)) {
        // eslint-disable-next-line no-await-in-loop
        if (lista.length) total += await apagarPdfsBoletos(lista, { motivo });
      }
      await carregar();
      setMsg({ texto: `✓ ${total} PDF(s) apagado(s) do servidor. Os dados dos boletos continuam nas faturas.`, erro: false });
    } catch (e) { setMsg({ texto: e.message, erro: true }); }
    setApagando(false);
  };

  const abrirPdf = async (path) => {
    try { window.open(await urlBoletoGuardado(path), '_blank', 'noopener'); } catch (e) { setMsg({ texto: e.message, erro: true }); }
  };

  return (
    <div className="table-card" style={{ padding: 14, borderLeft: '4px solid #b45309' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }} onClick={abrir}>
        <strong>{aberto ? '▾' : '▸'} Limpeza de boletos no servidor</strong>
        {itens && (
          <span style={{ fontSize: 12, color: '#475569' }}>
            {contagem.arquivos} PDF(s) guardado(s) · <span style={{ color: '#b45309', fontWeight: 700 }}>{contagem.PAGA + contagem.CANCELADA + contagem.SEM_FATURA} fatura(s) podem sair</span>
            {contagem.anteriores > 0 && ` · ${contagem.anteriores} boleto(s) anterior(es)`}
          </span>
        )}
      </div>
      {aberto && (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>
            Fatura paga já tem o PDF apagado sozinho (robô a cada rodada e rotina diária do servidor). Aqui você limpa o que sobrar ou o que quiser: só o arquivo sai, os dados do boleto ficam na fatura.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <select value={filtro} onChange={(e) => { setFiltro(e.target.value); setMarcadas(new Set()); }}>
              {FILTROS.map((f) => <option key={f.id} value={f.id}>{f.rotulo}</option>)}
            </select>
            <input placeholder="Buscar fatura, transportadora ou arquivo" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ width: 280 }} />
            <button type="button" className="btn-secondary audit-small-button" onClick={carregar} disabled={carregando || apagando}>{carregando ? 'Carregando…' : 'Atualizar'}</button>
            <button type="button" className="btn-primary audit-small-button" style={{ background: selecionadas.length ? '#b91c1c' : undefined }} disabled={!selecionadas.length || apagando} onClick={apagar}>
              {apagando ? 'Apagando…' : `Apagar PDF dos selecionados (${selecionadas.length})`}
            </button>
            {itens && (
              <span style={{ fontSize: 12, color: '#475569' }}>
                Pagas {contagem.PAGA} · Canceladas {contagem.CANCELADA} · Sem fatura {contagem.SEM_FATURA} · Em aberto {contagem.ABERTA}
              </span>
            )}
          </div>
          {msg.texto && <div className={msg.erro ? 'error-text' : ''} style={{ marginBottom: 8, color: msg.erro ? undefined : '#14733b', fontWeight: 600 }}>{msg.texto}</div>}
          {itens && !visiveis.length ? <p style={{ fontSize: 12, color: '#64748b' }}>Nada neste filtro.</p> : itens && (
            <div style={{ overflowX: 'auto', maxHeight: 420 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={th}><input type="checkbox" checked={todasMarcadas} onChange={alternarTodas} title="Marcar todas do filtro" /></th>
                    {['Situação', 'Fatura', 'Transportadora', 'Vencimento', 'Valor boleto', 'Arquivo', 'PDFs', ''].map((h) => <th key={h} style={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((i) => {
                    const s = SITUACOES[i.situacao];
                    const id = String(i.fatura_id);
                    return (
                      <tr key={id} style={{ background: marcadas.has(id) ? '#fef2f2' : undefined }}>
                        <td style={td}><input type="checkbox" checked={marcadas.has(id)} onChange={() => alternar(id)} /></td>
                        <td style={{ ...td, color: s.cor, fontWeight: 700, whiteSpace: 'nowrap' }}>{s.rotulo}</td>
                        <td style={td}>{i.fatura?.numero_fatura || i.numero_fatura || '-'}</td>
                        <td style={td}>{i.fatura?.transportadora || i.transportadora || '-'}</td>
                        <td style={td}>{dataBr(i.fatura?.data_vencimento || i.boleto_vencimento)}</td>
                        <td style={td}>{dinheiro(i.boleto_valor)}</td>
                        <td style={td}>{i.boleto_arquivo_nome || i.anteriores[0]?.nome_arquivo || '-'}</td>
                        <td style={td}>{(i.boleto_arquivo_path ? 1 : 0) + i.anteriores.length}{i.anteriores.length ? ` (${i.anteriores.length} anterior)` : ''}</td>
                        <td style={td}>{(i.boleto_arquivo_path || i.anteriores[0]?.arquivo_path) && <button type="button" className="link-button" onClick={() => abrirPdf(i.boleto_arquivo_path || i.anteriores[0].arquivo_path)}>abrir</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
