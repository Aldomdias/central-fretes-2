import { useState } from 'react';
import { consultarCtesFaltantes, enviarArquivosCte } from '../services/omsFaturasService';

const ROTULO_IMPORT = { queued: 'na fila', processing: 'processando', imported: 'gravado', failed: 'falhou' };
const ROTULO_ENVIO = { queued: 'na fila do OMS', alreadyExists: 'OMS já tem (ok)', rejected: 'recusado', erro: 'erro na chamada' };

/** Linhas da fatura sem CT-e no OMS + envio dos XMLs originais (cteProc / procEventoCTe). Nunca altera o arquivo. */
export default function OmsCtesFaltantesPanel({ invoiceId }) {
  const [aberto, setAberto] = useState(false);
  const [faltantes, setFaltantes] = useState(null);
  const [estado, setEstado] = useState('');
  const [resultado, setResultado] = useState([]);
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function atualizar() {
    setOcupado(true); setMsg('');
    try {
      const r = await consultarCtesFaltantes(invoiceId);
      setFaltantes(r.missingCtes); setEstado(r.state || '');
    } catch (e) { setMsg(`OMS: ${e.message}`); } finally { setOcupado(false); }
  }

  async function enviar(evento) {
    const arquivos = Array.from(evento.target.files || []);
    evento.target.value = '';
    if (!arquivos.length) return;
    setOcupado(true); setMsg(`Enviando ${arquivos.length} arquivo(s)...`); setResultado([]);
    try {
      const r = await enviarArquivosCte(invoiceId, arquivos, { aoProgredir: (n, t) => setMsg(`Enviados ${n} de ${t}...`) });
      setResultado(r);
      const rec = r.filter((x) => x.status === 'rejected' || x.status === 'erro').length;
      setMsg(rec ? `${rec} arquivo(s) não foram aceitos. Veja o motivo abaixo.` : 'Arquivos aceitos. Atualize a lista para acompanhar a gravação.');
      await atualizar();
    } catch (e) { setMsg(`OMS: ${e.message}`); } finally { setOcupado(false); }
  }

  return (
    <div className="hint-box compact" style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>CT-es sem chave no OMS</strong>
        <button className="btn-secondary" disabled={ocupado} onClick={() => { const v = !aberto; setAberto(v); if (v && faltantes == null) atualizar(); }}>
          {aberto ? 'Fechar' : 'Ver / enviar XML'}
        </button>
      </div>
      {aberto && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <button className="btn-secondary" disabled={ocupado} onClick={atualizar}>Atualizar lista</button>
            <label className="btn-primary" style={{ cursor: ocupado ? 'not-allowed' : 'pointer', opacity: ocupado ? 0.6 : 1 }}>
              Enviar XMLs originais
              <input type="file" accept=".xml,text/xml,application/xml" multiple disabled={ocupado} onChange={enviar} style={{ display: 'none' }} />
            </label>
            {estado && <span>Situação da fatura no OMS: {estado}</span>}
          </div>
          <p style={{ margin: '0 0 8px', fontSize: 12 }}>
            Envie o arquivo original (cteProc autorizado ou procEventoCTe de cancelamento), sem abrir e salvar de novo: qualquer alteração invalida a assinatura.
            Depois de "gravado", reenvie o lote da fatura ao OMS.
          </p>
          {msg && <div style={{ marginBottom: 8 }}>{msg}</div>}
          {faltantes && (faltantes.length === 0
            ? <div>Nenhuma linha sem CT-e no OMS.</div>
            : (
              <table className="data-table" style={{ width: '100%', fontSize: 12 }}>
                <thead><tr><th>Número</th><th>Série</th><th>CNPJ emissor</th><th>Importação</th></tr></thead>
                <tbody>
                  {faltantes.map((l, i) => (
                    <tr key={`${l.number}-${l.serie}-${l.issuerCnpj}-${i}`}>
                      <td>{l.number}</td>
                      <td>{l.serie ?? 'qualquer'}</td>
                      <td>{l.issuerCnpj}</td>
                      <td>{l.import ? `${ROTULO_IMPORT[l.import.status] || l.import.status}${l.import.error ? `: ${l.import.error}` : ''}` : 'nada enviado'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          {resultado.length > 0 && (
            <table className="data-table" style={{ width: '100%', fontSize: 12, marginTop: 8 }}>
              <thead><tr><th>Arquivo</th><th>Resultado</th><th>Motivo</th></tr></thead>
              <tbody>
                {resultado.map((r, i) => (
                  <tr key={`${r.nome}-${i}`}>
                    <td>{r.nome}</td>
                    <td>{ROTULO_ENVIO[r.status] || r.status}</td>
                    <td>{r.code ? `${r.code}${r.message ? ` - ${r.message}` : ''}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
