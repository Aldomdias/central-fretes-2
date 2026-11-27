import { useEffect, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '../../lib/supabaseClient';
import { urlBoletoGuardado } from '../../services/boletoControleService';
import LimpezaBoletosPainel from './LimpezaBoletosPainel';

// Robo de boletos por pasta: roda no PC (tarefa agendada do Windows, scripts/robo-boletos-pasta.mjs), le a
// pasta sincronizada do SharePoint "Verum protocolo - Boletos" e guarda o boleto na fatura. Aqui so se acompanha:
// ultima rodada, o que ficou para revisar e os boletos guardados por ele.
const USUARIO_ROBO = 'Robo Boletos (PC)';
const TAREFA = 'Central Fretes - Robo Boletos';
const dinheiro = (v) => (v == null ? '-' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataHora = (v) => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-');
const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: '#475569', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
const td = { padding: '5px 8px', fontSize: 12, borderBottom: '1px solid #f1f5f9' };

// Dentro do horario da tarefa (seg-sex, 7h-20h) a rodada deveria ter no maximo ~30 min.
function situacao(ultima) {
  if (!ultima) return { cor: '#b91c1c', texto: 'Nenhuma rodada registrada ainda.' };
  if (ultima.status !== 'SUCESSO') return { cor: '#b91c1c', texto: `Última rodada falhou: ${ultima.erro || 'sem detalhe'}` };
  const agora = new Date();
  const minutos = Math.round((agora - new Date(ultima.created_at)) / 60000);
  const emHorario = agora.getDay() >= 1 && agora.getDay() <= 5 && agora.getHours() >= 7 && agora.getHours() < 20;
  if (emHorario && minutos > 75) return { cor: '#c2410c', texto: `Sem rodada há ${minutos} min. O PC está ligado e o OneDrive da empresa sincronizando?` };
  return { cor: '#14733b', texto: `Funcionando: última rodada há ${minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h`}.` };
}

function Lista({ titulo, itens, cor }) {
  if (!itens?.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <strong style={{ fontSize: 13, color: cor }}>{titulo} ({itens.length})</strong>
      <ul style={{ margin: '4px 0 0 18px', fontSize: 12 }}>
        {itens.map((l) => <li key={l} style={{ marginBottom: 2 }}>{l}</li>)}
      </ul>
    </div>
  );
}

export default function BoletosPastaRobo() {
  const [rodadas, setRodadas] = useState([]);
  const [guardados, setGuardados] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = async () => {
    if (!isSupabaseConfigured()) { setCarregando(false); return; }
    setCarregando(true);
    const client = getSupabaseClient();
    const [r, g] = await Promise.all([
      client.from('boleto_pasta_leituras').select('*').eq('origem', 'ROBO_PC').order('created_at', { ascending: false }).limit(30),
      client.from('fatura_boleto_controle').select('fatura_id,numero_fatura,transportadora,boleto_valor,boleto_vencimento,boleto_arquivo_nome,boleto_arquivo_path,confirmado_em')
        .eq('confirmado_por', USUARIO_ROBO).order('confirmado_em', { ascending: false }).limit(100),
    ]);
    setErro(r.error?.message || g.error?.message || '');
    setRodadas(r.data || []);
    setGuardados(g.data || []);
    setCarregando(false);
  };
  useEffect(() => { carregar(); }, []);

  const abrir = async (path) => {
    try { window.open(await urlBoletoGuardado(path), '_blank', 'noopener'); } catch (e) { setErro(e.message); }
  };

  const ultima = rodadas[0] || null;
  const st = situacao(ultima);
  const det = ultima?.detalhe || null;
  const hoje = new Date().toDateString();
  const guardadosHoje = guardados.filter((g) => g.confirmado_em && new Date(g.confirmado_em).toDateString() === hoje).length;

  return (
    <div className="page-stack">
      <div className="table-card" style={{ borderLeft: `4px solid ${st.cor}`, padding: 14 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ color: st.cor }}>{carregando ? 'Carregando…' : st.texto}</strong>
          <button type="button" className="btn-secondary audit-small-button" onClick={carregar} disabled={carregando}>Atualizar</button>
        </div>
        {erro && <div className="error-text" style={{ marginTop: 6 }}>{erro}</div>}
        {ultima && (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, fontSize: 13 }}>
            <span>Última rodada: <strong>{dataHora(ultima.created_at)}</strong></span>
            <span>Arquivos na pasta: <strong>{ultima.total_arquivos}</strong></span>
            <span>Guardados na rodada: <strong>{ultima.novos}</strong></span>
            <span>Já guardados antes: <strong>{ultima.repetidos}</strong></span>
            <span>Guardados hoje: <strong>{guardadosHoje}</strong></span>
            {ultima.erro && <span style={{ color: '#b45309' }}>{ultima.erro}</span>}
          </div>
        )}
        {det ? (
          <>
            <Lista titulo="Guardados nesta rodada" itens={det.guardados} cor="#14733b" />
            <Lista titulo="Para revisar no painel de boletos" itens={det.revisar} cor="#b45309" />
            <Lista titulo="Boleto antecipado x fatura liberada com desconto" itens={det.avisosDesconto} cor="#b91c1c" />
            <Lista titulo="Sem fatura em aberto com esse número" itens={det.foraDoSistema} cor="#475569" />
          </>
        ) : ultima && (
          <p style={{ fontSize: 12, color: '#64748b', margin: '8px 0 0' }}>
            O detalhe da rodada (o que ficou para revisar) aparece aqui depois de aplicada a migration 20261125_012_boleto_pasta_leituras_detalhe.sql. Até lá ele fica no log do PC.
          </p>
        )}
      </div>

      <div className="table-card" style={{ padding: 14 }}>
        <strong>Boletos guardados pelo robô ({guardados.length})</strong>
        <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 8px' }}>
          Boleto de fatura ainda em auditoria também é guardado; ele passa a contar no painel de boletos quando a fatura for liberada.
        </p>
        {guardados.length === 0 ? <p style={{ fontSize: 12, color: '#64748b' }}>Nenhum ainda.</p> : (
          <div style={{ overflowX: 'auto', maxHeight: 380 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>{['Guardado em', 'Fatura', 'Transportadora', 'Valor', 'Vencimento', 'Arquivo', ''].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {guardados.map((g) => (
                  <tr key={g.fatura_id}>
                    <td style={td}>{dataHora(g.confirmado_em)}</td>
                    <td style={td}>{g.numero_fatura}</td>
                    <td style={td}>{g.transportadora}</td>
                    <td style={td}>{dinheiro(g.boleto_valor)}</td>
                    <td style={td}>{dataBr(g.boleto_vencimento)}</td>
                    <td style={td}>{g.boleto_arquivo_nome}</td>
                    <td style={td}>{g.boleto_arquivo_path ? <button type="button" className="link-button" onClick={() => abrir(g.boleto_arquivo_path)}>abrir PDF</button> : <span style={{ color: '#94a3b8' }}>PDF apagado (paga)</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LimpezaBoletosPainel />

      <div className="table-card" style={{ padding: 14 }}>
        <strong>Histórico de rodadas</strong>
        {rodadas.length === 0 ? <p style={{ fontSize: 12, color: '#64748b' }}>Nenhuma rodada registrada.</p> : (
          <div style={{ overflowX: 'auto', maxHeight: 300, marginTop: 6 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>{['Quando', 'Status', 'Arquivos', 'Guardados', 'Já guardados', 'Observação'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {rodadas.map((r) => (
                  <tr key={r.id}>
                    <td style={td}>{dataHora(r.created_at)}</td>
                    <td style={{ ...td, color: r.status === 'SUCESSO' ? '#14733b' : '#b91c1c', fontWeight: 700 }}>{r.status === 'SUCESSO' ? 'OK' : 'Falha'}</td>
                    <td style={td}>{r.total_arquivos}</td>
                    <td style={td}>{r.novos}</td>
                    <td style={td}>{r.repetidos}</td>
                    <td style={td}>{r.erro || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="table-card" style={{ padding: 14, fontSize: 13 }}>
        <strong>Como funciona</strong>
        <ul style={{ margin: '6px 0 0 18px' }}>
          <li>Roda no PC com a pasta do SharePoint <em>Verum protocolo - Boletos</em> sincronizada pelo OneDrive da empresa, pela tarefa agendada <strong>{TAREFA}</strong> (seg a sex, a cada 30 min, das 7h às 20h).</li>
          <li>Acha a fatura pelo número do nome do arquivo (<em>número - transportadora.pdf</em>), lê valor e vencimento do boleto (texto do PDF ou OCR no próprio PC) e só guarda quando os dois batem com a fatura.</li>
          <li>Considera faturas liberadas e ainda em auditoria; pagas, canceladas, substituídas e em antecipação ficam de fora. O que não bate fica em “Para revisar”.</li>
          <li>Log de cada dia no PC: <code>logs\robo-boletos\</code> na pasta do projeto.</li>
        </ul>
        <div style={{ marginTop: 8 }}>
          Rodar agora (no PC do robô, no Prompt de Comando): <code style={{ userSelect: 'all' }}>{`schtasks /run /tn "${TAREFA}"`}</code>
        </div>
      </div>
    </div>
  );
}
