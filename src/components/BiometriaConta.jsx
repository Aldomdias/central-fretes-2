import { useEffect, useState } from 'react';
import { biometriaDisponivelNesteDispositivo, cadastrarBiometria, excluirBiometria, listarBiometrias } from '../services/biometriaService';

export default function BiometriaConta() {
  const [passkeys, setPasskeys] = useState([]);
  const [processando, setProcessando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const disponivel = biometriaDisponivelNesteDispositivo();

  const carregar = async () => {
    try { setPasskeys(await listarBiometrias()); }
    catch (error) { setErro(error.message || String(error)); }
  };

  useEffect(() => { carregar(); }, []);

  const cadastrar = async () => {
    setProcessando(true); setErro(''); setMensagem('');
    try {
      await cadastrarBiometria(); await carregar();
      setMensagem('Digital/Windows Hello cadastrado com sucesso neste dispositivo.');
    } catch (error) { setErro(error.message || String(error)); }
    finally { setProcessando(false); }
  };

  const excluir = async (id) => {
    setProcessando(true); setErro(''); setMensagem('');
    try { await excluirBiometria(id); await carregar(); setMensagem('Método de acesso removido.'); }
    catch (error) { setErro(error.message || String(error)); }
    finally { setProcessando(false); }
  };

  return (
    <div className="panel-card senha-card" style={{ marginTop: 16 }}>
      <div className="section-row compact-top"><div>
        <div className="panel-title">Digital / Windows Hello</div>
        <p>A biometria fica protegida pelo dispositivo. O sistema armazena somente a chave pública da passkey.</p>
      </div></div>
      {!disponivel && <div className="hint-box compact">Este computador ou navegador não oferece biometria compatível. O acesso por senha continua disponível.</div>}
      {passkeys.map((item, index) => (
        <div className="section-row" key={item.id || index}>
          <div><strong>{item.friendly_name || item.friendlyName || `Dispositivo ${index + 1}`}</strong>
            <div className="muted-block">Cadastrado em {new Date(item.created_at || item.createdAt).toLocaleDateString('pt-BR')}</div></div>
          <button type="button" className="btn-secondary" disabled={processando} onClick={() => excluir(item.id)}>Remover</button>
        </div>
      ))}
      {disponivel && <div className="actions-right top-space-sm"><button type="button" className="btn-primary" disabled={processando} onClick={cadastrar}>
        {processando ? 'Aguarde...' : 'Cadastrar digital neste computador'}
      </button></div>}
      {mensagem && <div className="hint-box compact">{mensagem}</div>}
      {erro && <div className="hint-box compact error-text">{erro}</div>}
    </div>
  );
}
