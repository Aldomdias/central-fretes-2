import { useEffect, useMemo, useState } from 'react';
import { listarLancamentosComFatura } from '../services/robosLancamentosService';
import { lancamentoDaFatura, normalizarNumeroFatura, resumirLancamentosFatura } from '../utils/robos/historicoLancamentos';
import { ROTULO_ETAPA_LANCAMENTO } from './LancamentosRoboFatura';

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
// Liberadas pela auditoria e ainda nao pagas: prontas para o robo lancar.
const PRONTAS = new Set(['PRONTA_PARA_PAGAMENTO', 'LIBERADA_COM_DESCONTO', 'ENVIADA_AO_FINANCEIRO']);
const ETAPAS = ['miro', 'partida', 'pago'];

// Acompanhamento das faturas de nota fiscal (NFS-e) e CT-e lancadas pelos robos com o numero da
// fatura: liberada -> MIRO -> partida contabil -> paga. Tambem lista as liberadas ainda sem lancamento.
export default function FaturasLancadasRoboPainel({ faturas, onAbrirFatura }) {
  const [registros, setRegistros] = useState(null);
  const [aberto, setAberto] = useState(false);
  const [filtro, setFiltro] = useState('');

  useEffect(() => {
    listarLancamentosComFatura().then(({ registros: lista }) => setRegistros(lista)).catch(() => setRegistros([]));
  }, []);

  const { lancadas, prontas } = useMemo(() => {
    const porNumero = new Map();
    (registros || []).forEach((r) => {
      const n = normalizarNumeroFatura(r.fatura);
      if (n) porNumero.set(n, [...(porNumero.get(n) || []), r]);
    });
    const comLancamento = [];
    const semLancamento = [];
    (faturas || []).forEach((f) => {
      const candidatos = porNumero.get(normalizarNumeroFatura(f.numero_fatura)) || [];
      const meus = candidatos.filter((r) => lancamentoDaFatura(r, f));
      if (meus.length) comLancamento.push({ f, resumo: resumirLancamentosFatura(meus) });
      else if (PRONTAS.has(f.status)) semLancamento.push({ f, resumo: null });
    });
    return { lancadas: comLancamento, prontas: semLancamento };
  }, [registros, faturas]);

  if (registros && !lancadas.length && !prontas.length) return null;

  const cont = (etapa) => lancadas.filter((l) => l.resumo.etapa === etapa).length;
  const linhas = filtro === 'prontas' ? prontas : filtro ? lancadas.filter((l) => l.resumo.etapa === filtro) : [...lancadas.filter((l) => l.resumo.etapa !== 'pago'), ...prontas];

  const tile = (id, rotulo, valor, cor) => (
    <button
      key={id}
      type="button"
      onClick={() => setFiltro(filtro === id ? '' : id)}
      style={{ flex: '1 1 140px', border: `2px solid ${cor}`, borderRadius: 10, padding: '6px 10px', textAlign: 'left', cursor: 'pointer', background: filtro === id ? cor : '#fff', color: filtro === id ? '#fff' : cor }}
    >
      <div style={{ fontSize: 11, color: filtro === id ? '#fff' : '#475569' }}>{rotulo}</div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{valor}</div>
    </button>
  );

  return (
    <div className="table-card" style={{ marginBottom: 14, borderLeft: '4px solid #0f766e' }}>
      <div className="panel-title audit-table-title" style={{ cursor: 'pointer', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }} onClick={() => setAberto((v) => !v)}>
        <span>{aberto ? '▾' : '▸'} Faturas de nota fiscal lancadas pelo robo</span>
        <span style={{ fontWeight: 400, fontSize: 12, color: '#475569' }}>
          {registros === null ? '...' : `${prontas.length} liberada(s) sem lancamento · ${cont('pedido')} so pedido · ${cont('miro')} com MIRO · ${cont('partida')} com partida · ${cont('pago')} paga(s)`}
        </span>
      </div>
      {aberto && (
        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            {tile('prontas', 'Liberadas, prontas para lancar', prontas.length, '#c2410c')}
            {tile('pedido', 'So pedido (sem MIRO)', cont('pedido'), ROTULO_ETAPA_LANCAMENTO.pedido.cor)}
            {tile('miro', 'MIRO lancada', cont('miro'), ROTULO_ETAPA_LANCAMENTO.miro.cor)}
            {tile('partida', 'Com partida contabil', cont('partida'), ROTULO_ETAPA_LANCAMENTO.partida.cor)}
            {tile('pago', 'Pagas', cont('pago'), ROTULO_ETAPA_LANCAMENTO.pago.cor)}
          </div>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 6 }}>
            {filtro ? 'Clique de novo no card para tirar o filtro.' : 'Mostrando as que ainda nao foram pagas. Clique num card para filtrar.'}
          </div>
          <div className="sim-analise-tabela-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>Fatura</th><th>Transportadora</th><th>Valor fatura</th><th>Vencimento</th><th>Notas lancadas</th><th>Valor lancado</th>
                  {ETAPAS.map((e) => <th key={e}>{ROTULO_ETAPA_LANCAMENTO[e].texto}</th>)}
                  <th>Situacao</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(({ f, resumo }) => {
                  const et = resumo ? ROTULO_ETAPA_LANCAMENTO[resumo.etapa] : { texto: 'Liberada, sem lancamento', cor: '#c2410c' };
                  const feitas = (e) => (resumo ? resumo.etapas[e] + ETAPAS.slice(ETAPAS.indexOf(e) + 1).reduce((s, x) => s + resumo.etapas[x], 0) : 0);
                  return (
                    <tr key={f.id}>
                      <td>{onAbrirFatura ? <button type="button" className="link-button" onClick={() => onAbrirFatura(f)}>{f.numero_fatura}</button> : f.numero_fatura}</td>
                      <td>{f.transportadora}</td>
                      <td>{dinheiro(f.valor_fatura)}</td>
                      <td>{dataBr(f.data_vencimento)}</td>
                      <td>{resumo ? resumo.total : '-'}</td>
                      <td>{resumo ? dinheiro(resumo.valor) : '-'}</td>
                      {ETAPAS.map((e) => {
                        const n = feitas(e);
                        const ok = resumo && n === resumo.total;
                        return <td key={e} style={{ color: ok ? '#14733b' : n ? '#b45309' : '#94a3b8', fontWeight: 700 }}>{ok ? '✓' : n ? `${n}/${resumo.total}` : '·'}</td>;
                      })}
                      <td style={{ color: et.cor, fontWeight: 700 }}>{et.texto}</td>
                    </tr>
                  );
                })}
                {!linhas.length && (
                  <tr><td colSpan={7 + ETAPAS.length} style={{ color: '#14733b', fontWeight: 700 }}>✓ Nada nesta situacao.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
