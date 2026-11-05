import React, { useCallback, useEffect, useState } from 'react';
import {
  listarRespostasSemNf, validarRespostaSemNf, ROTULO_FORMA_COBRANCA, ROTULO_RESPOSTA_SEM_NF, ROTULO_STATUS_SEM_NF,
} from '../services/cteSemNfRespostasService';

const CORES = { APLICADO: '#475569', ACEITO: '#166534', PENDENTE: '#b45309', REJEITADO: '#b91c1c' };

const dinheiro = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Respostas da transportadora (portal) para os CT-es sem vinculo de NF desta fatura. Justificativas
// (CT-e complementar / outro motivo) aguardam o auditor aceitar ou rejeitar; retiradas ja foram aplicadas.
export default function RespostasCteSemNfFatura({ faturaId, usuarioNome, recarregarChave = 0, onAlterado }) {
  const [respostas, setRespostas] = useState([]);
  const [salvando, setSalvando] = useState('');
  const [erro, setErro] = useState('');

  const carregar = useCallback(() => { listarRespostasSemNf(faturaId).then(setRespostas); }, [faturaId]);
  useEffect(() => { carregar(); }, [carregar, recarregarChave]);

  if (!respostas.length) return null;

  const decidir = async (r, aceitar) => {
    let observacao = '';
    if (!aceitar) {
      observacao = window.prompt(`Motivo da rejeicao da justificativa do CT-e ${r.numero_cte || r.chave_cte} (a transportadora vai ver no portal):`, '') || '';
      if (!observacao.trim()) return;
    }
    setSalvando(r.id);
    setErro('');
    try {
      await validarRespostaSemNf(r, { aceitar, observacao: observacao.trim(), usuarioNome });
      carregar();
      onAlterado?.();
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setSalvando('');
    }
  };

  const pendentes = respostas.filter((r) => r.status_validacao === 'PENDENTE').length;

  return (
    <div className="hint-box compact" style={{ marginBottom: 10, borderColor: pendentes ? '#f59e0b' : undefined }}>
      <strong>CT-e sem vinculo de NF — respostas da transportadora ({respostas.length}){pendentes ? ` · ${pendentes} aguardando sua validacao` : ''}</strong>
      {erro ? <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 4 }}>{erro}</div> : null}
      {respostas.map((r) => (
        <div key={r.id} style={{ fontSize: 12, marginTop: 6, paddingTop: 6, borderTop: '1px solid #e2e8f0' }}>
          <div>
            <b>CT-e {r.numero_cte || r.chave_cte}</b> · {dinheiro(r.valor_cte)} · {ROTULO_RESPOSTA_SEM_NF[r.resposta] || r.resposta}
            {' · '}<span style={{ color: CORES[r.status_validacao] || '#334155', fontWeight: 700 }}>{ROTULO_STATUS_SEM_NF[r.status_validacao] || r.status_validacao}</span>
          </div>
          {r.resposta === 'COMPLEMENTAR' ? <div>CT-e original informado: <span style={{ fontFamily: 'monospace' }}>{r.chave_cte_original || '-'}</span></div> : null}
          {r.chave_nfe ? <div>Chave NF-e informada: <span style={{ fontFamily: 'monospace' }}>{r.chave_nfe}</span></div> : null}
          {r.justificativa ? <div>Justificativa: {r.justificativa}</div> : null}
          {r.resposta === 'RETIRAR' ? (
            <div>Cobranca: <b>{ROTULO_FORMA_COBRANCA[r.forma_cobranca] || '-'}</b>{r.ciente_nova_cobranca ? ' (transportadora ciente)' : ''}{r.valor_fatura_atualizado != null ? ` · fatura atualizada para ${dinheiro(r.valor_fatura_atualizado)}` : ''}</div>
          ) : null}
          <div style={{ color: '#64748b' }}>
            {r.respondido_por || '-'} · {r.respondido_em ? new Date(r.respondido_em).toLocaleString('pt-BR') : '-'}
            {r.validado_por ? ` · validado por ${r.validado_por}` : ''}{r.observacao_validacao ? ` — ${r.observacao_validacao}` : ''}
          </div>
          {r.status_validacao === 'PENDENTE' ? (
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button type="button" className="sim-tab" disabled={Boolean(salvando)} onClick={() => decidir(r, true)} style={{ background: '#dcfce7', color: '#166534', borderColor: '#86efac' }}>
                {salvando === r.id ? 'Salvando...' : 'Aceitar (CT-e pode ser pago)'}
              </button>
              <button type="button" className="sim-tab" disabled={Boolean(salvando)} onClick={() => decidir(r, false)} style={{ background: '#fee2e2', color: '#991b1b', borderColor: '#fca5a5' }}>
                Rejeitar
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
