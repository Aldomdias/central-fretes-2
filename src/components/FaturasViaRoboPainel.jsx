import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '../lib/supabaseClient';
import { listarControleBoletos } from '../services/boletoControleService';

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const LIBERADAS = new Set(['PRONTA_PARA_PAGAMENTO', 'LIBERADA_COM_DESCONTO', 'ENVIADA_AO_FINANCEIRO', 'PAGA', 'PAGA_COM_DESCONTO', 'PAGA_COM_DIVERGENCIA']);

// Faturas que o Robo Auditor mandou para a gestao e o andamento de cada uma:
// gestao -> liberada -> enviada ao ERP -> boleto na pasta (100%).
const ETAPAS = [
  { id: 'gestao', rotulo: 'Gestao' },
  { id: 'liberada', rotulo: 'Liberada' },
  { id: 'erp', rotulo: 'ERP' },
  { id: 'boleto', rotulo: 'Boleto' },
];

async function carregarEnviadasPeloRobo() {
  const { data, error } = await getSupabaseClient().from('auditor_robo_execucoes')
    .select('fatura_id,numero_fatura,transportadora,executado_em,auditor_nome,auditor_email')
    .eq('acao_executada', true).eq('decisao', 'ENVIAR_APROVACAO').order('executado_em', { ascending: false }).limit(2000);
  if (error) return [];
  return data || [];
}

// faturas: faturas do recorte atual (por auditor), no state da Auditoria.
export default function FaturasViaRoboPainel({ faturas, onAbrirFatura }) {
  const [enviadas, setEnviadas] = useState(null);
  const [controle, setControle] = useState([]);
  const [aberto, setAberto] = useState(false);
  const [mostrarTodas, setMostrarTodas] = useState(false);

  useEffect(() => {
    carregarEnviadasPeloRobo().then(setEnviadas).catch(() => setEnviadas([]));
    listarControleBoletos().then(({ lista }) => setControle(lista)).catch(() => {});
  }, []);

  const linhas = useMemo(() => {
    const porId = new Map((faturas || []).map((f) => [String(f.id), f]));
    const boleto = new Map(controle.map((c) => [String(c.fatura_id), c]));
    return (enviadas || []).map((e) => {
      const f = porId.get(String(e.fatura_id));
      if (!f) return null; // fora do recorte do auditor
      const feito = {
        gestao: true,
        liberada: LIBERADAS.has(f.status),
        erp: Boolean(f.data_envio_erp),
        boleto: boleto.has(String(f.id)),
      };
      const n = ETAPAS.filter((et) => feito[et.id]).length;
      return { f, e, feito, pct: Math.round((n / ETAPAS.length) * 100) };
    }).filter(Boolean);
  }, [enviadas, faturas, controle]);

  const total = linhas.length;
  const cont = (fn) => linhas.filter(fn).length;
  const aguardandoGestao = cont((l) => !l.feito.liberada);
  const aguardandoErp = cont((l) => l.feito.liberada && !l.feito.erp);
  const aguardandoBoleto = cont((l) => l.feito.erp && !l.feito.boleto);
  const concluidas = cont((l) => l.pct === 100);
  const visiveis = linhas.filter((l) => l.pct < 100 || mostrarTodas);

  if (enviadas && !enviadas.length) return null;

  const tile = (rotulo, valor, cor) => (
    <div style={{ flex: '1 1 140px', border: `2px solid ${cor}`, borderRadius: 10, padding: '6px 10px' }}>
      <div style={{ fontSize: 11, color: '#475569' }}>{rotulo}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: cor }}>{valor}</div>
    </div>
  );

  return (
    <div className="table-card" style={{ marginBottom: 14, borderLeft: '4px solid #7c3aed' }}>
      <div className="panel-title audit-table-title" style={{ cursor: 'pointer', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }} onClick={() => setAberto((v) => !v)}>
        <span>{aberto ? '▾' : '▸'} Faturas enviadas pelo robo</span>
        <span style={{ fontWeight: 400, fontSize: 12, color: '#475569' }}>
          {enviadas === null ? '...' : `${total} no total · ${aguardandoGestao} na gestao · ${aguardandoErp} aguardando ERP · ${aguardandoBoleto} aguardando boleto · ${concluidas} concluida(s)`}
        </span>
      </div>
      {aberto && (
        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            {tile('Aguardando a gestao', aguardandoGestao, '#7c3aed')}
            {tile('Liberadas, aguardando ERP', aguardandoErp, '#c2410c')}
            {tile('No ERP, aguardando boleto', aguardandoBoleto, '#0369a1')}
            {tile('100% concluidas', concluidas, '#14733b')}
          </div>
          <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8 }}>
            <input type="checkbox" checked={mostrarTodas} onChange={(ev) => setMostrarTodas(ev.target.checked)} />
            Mostrar tambem as 100% concluidas
          </label>
          <div className="sim-analise-tabela-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table className="sim-analise-tabela">
              <thead>
                <tr>
                  <th>Fatura</th><th>Transportadora</th><th>Valor</th><th>Enviada pelo robo</th>
                  {ETAPAS.map((et) => <th key={et.id}>{et.rotulo}</th>)}
                  <th>Andamento</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map(({ f, e, feito, pct }) => (
                  <tr key={f.id}>
                    <td>{onAbrirFatura ? <button type="button" className="link-button" onClick={() => onAbrirFatura(f)}>{f.numero_fatura}</button> : f.numero_fatura}</td>
                    <td>{f.transportadora}</td>
                    <td>{dinheiro(f.valor_fatura)}</td>
                    <td>{dataBr(e.executado_em)}</td>
                    {ETAPAS.map((et) => <td key={et.id} style={{ color: feito[et.id] ? '#14733b' : '#94a3b8', fontWeight: 700 }}>{feito[et.id] ? '✓' : '·'}</td>)}
                    <td style={{ minWidth: 110 }}>
                      <div style={{ background: '#e2e8f0', borderRadius: 6, height: 8 }}>
                        <div style={{ width: `${pct}%`, background: pct === 100 ? '#14733b' : '#7c3aed', height: 8, borderRadius: 6 }} />
                      </div>
                      <div style={{ fontSize: 11, color: '#475569' }}>{pct}%</div>
                    </td>
                  </tr>
                ))}
                {!visiveis.length && (
                  <tr><td colSpan={5 + ETAPAS.length} style={{ color: '#14733b', fontWeight: 700 }}>✓ Nada pendente das faturas enviadas pelo robo.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
