import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { chaveEntregaRegistro } from '../services/auditoriaEntregaCteService';
import {
  agruparPorLote,
  casarPlanilhaComFatura,
  decidirLoteBaixa,
  lerPlanilhaBaixaEntrega,
  listarBaixasDecididas,
  listarBaixasPendentes,
  montarModeloBaixaEntrega,
  solicitarBaixasEntrega,
} from '../services/baixaEntregaService';

const dataBr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');
const dataHoraBr = (v) => (v ? new Date(v).toLocaleString('pt-BR') : '-');

/**
 * Baixa de entrega em massa dentro da fatura: baixa o modelo, sobe a planilha com chave +
 * data de entrega e envia para aprovacao da gestao. Depois de aprovada, o auditor pode
 * separar a fatura (entregues seguem; sem entrega saem e ficam aguardando nova fatura).
 */
export default function BaixaEntregaFatura({ fatura, detalhes, entregaCtes, sessao, ehEntregue, aoSeparar, aoMudarBaixas }) {
  const usuarioNome = sessao?.nome || sessao?.email || '';
  const inputRef = useRef(null);
  const [previa, setPrevia] = useState(null);
  const [pendentes, setPendentes] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [decididas, setDecididas] = useState([]);
  const [separando, setSeparando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');

  const recarregarPendentes = async () => {
    const linhas = await listarBaixasPendentes({ faturaId: fatura.id });
    setPendentes(linhas);
    aoMudarBaixas?.(linhas.length);
  };
  const recarregarDecididas = () => listarBaixasDecididas({ faturaId: fatura.id }).then(setDecididas);
  useEffect(() => { recarregarPendentes(); recarregarDecididas(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [fatura.id]);

  const semEntrega = entregaCtes ? detalhes.filter((item) => !ehEntregue(item)) : [];
  const entregues = entregaCtes ? detalhes.filter((item) => ehEntregue(item)) : [];

  const baixarModelo = () => {
    // Modelo ja vem com as chaves dos CT-es ainda sem entrega (ou todos, se o tracking nao carregou).
    // Só os sem entrega e que ainda não têm baixa aguardando aprovação.
    const emAprovacao = new Set(pendentes.map((l) => l.chave));
    const alvo = semEntrega.filter((item) => !emAprovacao.has(chaveEntregaRegistro(item)));
    if (!alvo.length) { setErro('Nenhum CT-e pendente de entrega nesta fatura (ou todos ja estao em aprovacao).'); return; }
    setErro('');
    const wb = montarModeloBaixaEntrega(XLSX, alvo);
    XLSX.writeFile(wb, `BAIXA_ENTREGA_${String(fatura.numero_fatura || 'fatura').replace(/[^\w-]+/g, '_')}.xlsx`);
  };

  const aoEscolherArquivo = async (event) => {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;
    setErro(''); setMensagem(''); setPrevia(null);
    try {
      const { validas, invalidas } = lerPlanilhaBaixaEntrega(XLSX, await arquivo.arrayBuffer());
      const { casadas, foraDaFatura } = casarPlanilhaComFatura(validas, detalhes);
      setPrevia({ arquivo: arquivo.name, casadas, foraDaFatura, invalidas });
    } catch (e) {
      setErro(`Nao foi possivel ler a planilha: ${e.message || e}`);
    }
  };

  const enviarParaAprovacao = async () => {
    if (!previa?.casadas.length) return;
    if (justificativa.trim().length < 5) { setErro('Informe a justificativa da baixa (minimo 5 caracteres) antes de enviar.'); return; }
    setEnviando(true); setErro('');
    try {
      const { total } = await solicitarBaixasEntrega({ fatura, itens: previa.casadas, usuarioNome, justificativa });
      setMensagem(`✓ ${total} baixa(s) enviada(s) para aprovacao da gestao. As entregas so contam depois da aprovacao.`);
      setPrevia(null);
      setJustificativa('');
      await recarregarPendentes();
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setEnviando(false);
    }
  };

  const separar = async () => {
    if (!entregues.length || !semEntrega.length) return;
    const ok = window.confirm(
      `Separar a fatura ${fatura.numero_fatura}?\n\n`
      + `• ${entregues.length} CT-e(s) entregue(s) ficam na fatura e o DOCCOB (EDI) e gerado agora.\n`
      + `• ${semEntrega.length} CT-e(s) sem entrega saem da fatura, nao geram DOCCOB e ficam como "aguardando nova fatura".`,
    );
    if (!ok) return;
    setSeparando(true); setErro(''); setMensagem('');
    try {
      const resumo = await aoSeparar({ entregues, semEntrega });
      setMensagem(resumo);
    } catch (e) {
      setErro(`Erro ao separar a fatura: ${e.message || e}`);
    } finally {
      setSeparando(false);
    }
  };

  const lotes = agruparPorLote(pendentes);
  const temPrevia = Boolean(previa);

  return (
    <div className="hint-box compact" style={{ marginBottom: 10, borderLeft: '4px solid #9153F0' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong>Baixa de entrega em massa</strong>
        <button type="button" className="btn-secondary" disabled={!detalhes.length || !entregaCtes} onClick={baixarModelo} title="Baixa a planilha ja com as chaves dos CT-es sem entrega; e so preencher a Data de entrega e subir de volta">{entregaCtes ? `Baixar modelo (${semEntrega.length} sem entrega)` : 'Consultando entregas...'}</button>
        <button type="button" className="btn-secondary" disabled={!detalhes.length} onClick={() => inputRef.current?.click()}>Importar planilha</button>
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={aoEscolherArquivo} />
        {entregaCtes && entregues.length > 0 && semEntrega.length > 0 && (
          <button type="button" className="btn-primary" disabled={separando} onClick={separar}
            title="Mantem os entregues na fatura e gera o DOCCOB deles; tira os sem entrega da fatura (aguardando nova fatura)">
            {separando ? 'Separando...' : `Separar fatura (${entregues.length} entregues · ${semEntrega.length} sem entrega)`}
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
        Preencha chave do CT-e e data de entrega (dd/mm/aaaa). A baixa vai para a gestao aprovar; o laudo da transportadora continua funcionando normalmente.
      </div>

      {erro && <div className="error-text" style={{ marginTop: 6 }}>{erro}</div>}
      {mensagem && <div style={{ marginTop: 6, color: '#166534', fontWeight: 700 }}>{mensagem}</div>}

      {temPrevia && (
        <div style={{ marginTop: 8, padding: 8, background: '#faf5ff', borderRadius: 8 }}>
          <div><strong>{previa.arquivo}</strong>: {previa.casadas.length} CT-e(s) desta fatura · {previa.foraDaFatura.length} fora desta fatura (ignorados) · {previa.invalidas.length} linha(s) com problema</div>
          {previa.foraDaFatura.length > 0 && <div style={{ fontSize: 12, color: '#b45309' }}>Fora da fatura: {previa.foraDaFatura.slice(0, 5).map((l) => `linha ${l.linha}`).join(', ')}{previa.foraDaFatura.length > 5 ? '...' : ''}</div>}
          {previa.invalidas.slice(0, 8).map((i) => <div key={i.linha} style={{ fontSize: 12, color: '#b91c1c' }}>Linha {i.linha}: {i.motivo}</div>)}
          {previa.invalidas.length > 8 && <div style={{ fontSize: 12, color: '#b91c1c' }}>+{previa.invalidas.length - 8} linha(s) com problema</div>}
          <label className="field" style={{ marginTop: 6 }}>Justificativa da baixa (obrigatoria — a gestao ve ao aprovar)
            <textarea rows={2} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Ex.: transportadora enviou devolutiva com as datas de entrega por e-mail em 02/10" />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="btn-primary" disabled={enviando || !previa.casadas.length || justificativa.trim().length < 5} onClick={enviarParaAprovacao}>
              {enviando ? 'Enviando...' : `Enviar ${previa.casadas.length} baixa(s) para aprovacao da gestao`}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setPrevia(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {lotes.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 13, color: '#92400e' }}>
          ⏳ Aguardando aprovacao da gestao: {lotes.map((l) => `${l.itens.length} baixa(s) (enviada por ${l.solicitadoPor || '—'} em ${dataHoraBr(l.solicitadoEm)}${l.justificativa ? ` — ${l.justificativa}` : ''})`).join(' · ')}
        </div>
      )}
      <RegistroBaixasDecididas lotes={agruparPorLote(decididas)} />
    </div>
  );
}

/** Fila da gestao: aprova ou rejeita lotes de baixa de entrega enviados pelos auditores. */
export function BaixaEntregaAprovacaoGestao({ ehGestor, usuarioNome, aoDecidir }) {
  const [lotes, setLotes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState({});
  const [processando, setProcessando] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');

  const [historico, setHistorico] = useState([]);
  const recarregarHistorico = () => listarBaixasDecididas({ limite: 800 }).then(setHistorico);
  const carregar = async () => {
    setCarregando(true);
    setLotes(agruparPorLote(await listarBaixasPendentes()));
    setCarregando(false);
  };
  useEffect(() => { carregar(); recarregarHistorico(); }, []);

  const decidir = async (lote, aprovar) => {
    if (!ehGestor) return;
    let observacao = window.prompt(aprovar ? 'Observacao da aprovacao (opcional):' : 'Motivo da rejeicao (obrigatorio):');
    if (observacao === null) return;
    observacao = observacao.trim();
    if (!aprovar && observacao.length < 3) { setErro('Informe o motivo da rejeicao.'); return; }
    setProcessando(lote.loteId); setErro(''); setMensagem('');
    try {
      await decidirLoteBaixa({ loteId: lote.loteId, aprovar, usuarioNome, observacao });
      recarregarHistorico();
      setMensagem(`${aprovar ? '✓ Aprovadas' : 'Rejeitadas'} ${lote.itens.length} baixa(s) da fatura ${lote.numeroFatura || ''}.`);
      await carregar();
      aoDecidir?.();
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setProcessando('');
    }
  };

  if (carregando) return <div className="hint-box compact">Carregando baixas de entrega...</div>;
  if (!lotes.length && !mensagem && !historico.length) return null;

  return (
    <div className="hint-box compact" style={{ margin: '10px 0', borderLeft: '4px solid #9153F0' }}>
      <strong>Baixas de entrega em massa aguardando aprovacao ({lotes.length})</strong>
      <div style={{ fontSize: 12, color: '#64748b', margin: '2px 0 6px' }}>
        Enviadas por planilha pelos auditores. Aprovadas, os CT-es passam a contar como entregues (data da planilha).
        {ehGestor ? '' : ' Apenas gestao pode decidir.'}
      </div>
      {erro && <div className="error-text">{erro}</div>}
      {mensagem && <div style={{ color: '#166534', fontWeight: 700 }}>{mensagem}</div>}
      {!lotes.length && <div style={{ fontSize: 13, color: '#64748b' }}>Nenhuma baixa aguardando aprovacao.</div>}
      {lotes.map((lote) => (
        <div key={lote.loteId} style={{ borderTop: '1px solid #e2e8f0', padding: '6px 0' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span><strong>Fatura {lote.numeroFatura || '—'}</strong> · {lote.transportadora || '—'} · {lote.itens.length} CT-e(s) · {lote.solicitadoPor || '—'} · {dataHoraBr(lote.solicitadoEm)}</span>
            <button type="button" className="btn-secondary" onClick={() => setAberto((a) => ({ ...a, [lote.loteId]: !a[lote.loteId] }))}>{aberto[lote.loteId] ? 'Ocultar CT-es' : 'Ver CT-es'}</button>
            {ehGestor && <>
              <button type="button" className="btn-primary" disabled={Boolean(processando)} onClick={() => decidir(lote, true)}>{processando === lote.loteId ? '...' : 'Aprovar baixa'}</button>
              <button type="button" className="btn-secondary" disabled={Boolean(processando)} onClick={() => decidir(lote, false)}>Rejeitar</button>
            </>}
          </div>
          <div style={{ fontSize: 13, marginTop: 4, color: '#334155' }}><strong>Justificativa do auditor:</strong> {lote.justificativa || <em>nao informada (envio anterior a esta regra)</em>}</div>
          {aberto[lote.loteId] && (
            <table className="data-table" style={{ marginTop: 6 }}>
              <thead><tr><th>CT-e</th><th>Chave</th><th>Data de entrega</th></tr></thead>
              <tbody>
                {lote.itens.slice(0, 300).map((i) => <tr key={i.id}><td>{i.numero_cte || '—'}</td><td style={{ fontFamily: 'monospace', fontSize: 11 }}>{i.chave_cte || i.chave}</td><td>{dataBr(i.data_entrega)}</td></tr>)}
              </tbody>
            </table>
          )}
        </div>
      ))}
      <RegistroBaixasDecididas lotes={agruparPorLote(historico)} titulo="Registro de baixas ja decididas" />
    </div>
  );
}

/** Registro (auditavel) das baixas ja aprovadas/rejeitadas: quem pediu, justificativa, quem decidiu e quando. */
function RegistroBaixasDecididas({ lotes = [], titulo = 'Baixas ja decididas desta fatura' }) {
  const [aberto, setAberto] = useState(false);
  if (!lotes.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="btn-secondary" onClick={() => setAberto((v) => !v)}>{aberto ? 'Ocultar' : 'Ver'} {titulo.toLowerCase()} ({lotes.length})</button>
      {aberto && (
        <div style={{ overflow: 'auto', maxHeight: 360, marginTop: 6 }}>
          <table className="data-table">
            <thead><tr><th>Fatura</th><th>Transportadora</th><th>CT-es</th><th>Enviada por</th><th>Justificativa</th><th>Decisao</th><th>Decidido por</th><th>Em</th><th>Observacao da gestao</th></tr></thead>
            <tbody>
              {lotes.map((l) => (
                <tr key={l.loteId}>
                  <td>{l.numeroFatura || '—'}</td><td>{l.transportadora || '—'}</td><td>{l.itens.length}</td>
                  <td>{l.solicitadoPor || '—'}<div style={{ fontSize: 11, color: '#64748b' }}>{dataHoraBr(l.solicitadoEm)}</div></td>
                  <td>{l.justificativa || '—'}</td>
                  <td><strong style={{ color: l.status === 'APROVADO' ? '#166534' : '#b91c1c' }}>{l.status === 'APROVADO' ? 'Aprovada' : 'Rejeitada'}</strong></td>
                  <td>{l.decididoPor || '—'}</td><td>{dataHoraBr(l.decididoEm)}</td><td>{l.observacao || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
