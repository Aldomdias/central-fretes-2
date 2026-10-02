import { useMemo, useState } from 'react';
import { desfazerPagamentoFatura, listarPagamentosDaFatura } from '../services/auditoriaFretesService';

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const LIMITE = 40;

// Suspeita = pagamento compensado de valor bem diferente do da fatura (sinal de partida de outra transportadora).
const suspeita = (f) => Number(f.valor_pago || 0) > 0 && Number(f.valor_fatura || 0) > 0
  && Math.abs(Number(f.valor_pago) - Number(f.valor_fatura)) / Number(f.valor_fatura) > 0.05;

// Corrige vinculos de pagamento do SAP feitos na fatura errada (automatico ou a mao).
export default function DesfazerVinculosSap({ state, onState, sessao }) {
  const usuarioNome = sessao?.nome || sessao?.email || '';
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [soSuspeitas, setSoSuspeitas] = useState(false);
  const [pagamentos, setPagamentos] = useState({});
  const [carregando, setCarregando] = useState('');
  const [processando, setProcessando] = useState('');
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');

  const candidatas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (state.faturas || []).filter((f) => {
      if (!(f.partida || f.lancamento_financeiro || String(f.status).startsWith('PAGA'))) return false;
      if (soSuspeitas && !suspeita(f)) return false;
      if (!termo) return true;
      const texto = `${f.numero_fatura} ${f.transportadora} ${f.partida || ''} ${f.lancamento_financeiro || ''}`.toLowerCase();
      return termo.split(/\s+/).every((p) => texto.includes(p));
    });
  }, [state.faturas, busca, soSuspeitas]);
  const totalSuspeitas = useMemo(() => (state.faturas || []).filter(suspeita).length, [state.faturas]);

  const ver = async (fatura) => {
    setErro('');
    setCarregando(fatura.id);
    try {
      const lista = await listarPagamentosDaFatura(fatura.id);
      setPagamentos((p) => ({ ...p, [fatura.id]: lista }));
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setCarregando('');
    }
  };

  const desfazer = async (fatura, pagamento) => {
    const doc = pagamento.partida || pagamento.lancamento_contabil || pagamento.documento_compensacao || '-';
    if (!window.confirm(`Desfazer o vinculo do pagamento (doc. ${doc}, ${dinheiro(pagamento.valor_pago)}) com a fatura ${fatura.numero_fatura} de ${fatura.transportadora}?\n\nA linha volta para "Vincular pagamentos do SAP a mao" para ser ligada na fatura certa.`)) return;
    setProcessando(pagamento.id);
    setErro('');
    setMensagem('');
    try {
      const next = await desfazerPagamentoFatura(state, pagamento, fatura, usuarioNome);
      onState(next);
      setMensagem(`Vinculo desfeito na fatura ${fatura.numero_fatura}. Agora ela pode ser apagada ou receber o pagamento certo.`);
      await ver(fatura);
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setProcessando('');
    }
  };

  return (
    <div className="panel-card" style={{ marginTop: 14 }}>
      <div className="section-row compact-top">
        <div>
          <div className="panel-title">Desfazer vinculo de pagamento errado</div>
          <p className="compact">Pagamento/partida do SAP ligado na fatura errada (de outra transportadora). {totalSuspeitas} fatura(s) com valor pago bem diferente do valor da fatura.</p>
        </div>
        <button className="btn-secondary" onClick={() => setAberto((v) => !v)}>{aberto ? 'Recolher' : 'Expandir'}</button>
      </div>
      {erro && <div className="hint-box compact error-text">{erro}</div>}
      {mensagem && <div className="hint-box compact">{mensagem}</div>}
      {aberto && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <input style={{ flex: '1 1 260px' }} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fatura, transportadora ou partida/lancamento" />
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={soSuspeitas} onChange={(e) => setSoSuspeitas(e.target.checked)} /> So suspeitas (valor pago diferente)
            </label>
            <span style={{ fontSize: 12 }}>{candidatas.length} fatura(s)</span>
          </div>
          <div className="sim-analise-tabela-wrap">
            <table className="sim-analise-tabela">
              <thead><tr><th>Fatura</th><th>Transportadora</th><th>Valor fatura</th><th>Valor pago</th><th>Partida</th><th>Lancamento</th><th>Status</th><th /></tr></thead>
              <tbody>
                {candidatas.slice(0, LIMITE).map((f) => [
                  <tr key={f.id} style={suspeita(f) ? { background: '#fef2f2' } : undefined}>
                    <td><strong>{f.numero_fatura}</strong></td>
                    <td>{f.transportadora}</td>
                    <td>{dinheiro(f.valor_fatura)}</td>
                    <td>{f.valor_pago ? dinheiro(f.valor_pago) : '-'}</td>
                    <td>{f.partida || '-'}</td>
                    <td>{f.lancamento_financeiro || '-'}</td>
                    <td>{f.status}</td>
                    <td><button className="btn-secondary" disabled={carregando === f.id} onClick={() => ver(f)}>{carregando === f.id ? 'Carregando...' : 'Ver pagamentos'}</button></td>
                  </tr>,
                  pagamentos[f.id] && (
                    <tr key={`${f.id}-pag`}>
                      <td colSpan={8} style={{ background: '#f8fafc' }}>
                        {!pagamentos[f.id].length && <span style={{ fontSize: 12 }}>Nenhum pagamento gravado nesta fatura.</span>}
                        {pagamentos[f.id].map((p) => (
                          <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '3px 0' }}>
                            <span style={{ fontSize: 12 }}>
                              <strong>{p.resultado}</strong> · {dinheiro(p.valor_pago)} · partida {p.partida || '-'} · lancamento {p.lancamento_contabil || '-'} · doc. {p.documento_compensacao || '-'} · pgto {dataBr(p.data_pagamento)} · fatura no SAP: {p.numero_fatura || '-'} · origem {p.origem || '-'}
                            </span>
                            <button className="btn-secondary" style={{ color: '#b91c1c', borderColor: '#b91c1c' }} disabled={processando === p.id} onClick={() => desfazer(f, p)}>{processando === p.id ? 'Desfazendo...' : 'Desfazer vinculo'}</button>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ),
                ])}
                {!candidatas.length && <tr><td colSpan={8}>Nenhuma fatura com esses filtros.</td></tr>}
              </tbody>
            </table>
          </div>
          {candidatas.length > LIMITE && <p className="compact">Mostrando {LIMITE} de {candidatas.length} — use a busca para refinar.</p>}
        </>
      )}
    </div>
  );
}
