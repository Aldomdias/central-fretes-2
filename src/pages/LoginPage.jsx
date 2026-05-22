import { useState } from 'react';
import { loginCentral } from '../utils/authLocal';

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const entrar = async () => {
    if (carregando) return;
    setErro('');
    setCarregando(true);
    try {
      const sessao = await loginCentral(email, senha);
      setEmail('');
      setSenha('');
      onLogin(sessao);
    } catch (error) {
      setErro(error.message || String(error));
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        <div>
          <span className="amd-mini-brand">AMD Log</span>
          <h1>Central de Fretes</h1>
          <p>Entre para acessar as telas de operação, auditoria, lotação e gestão.</p>
        </div>

        <label className="field">
          E-mail
          <input
            type="email"
            name="central-fretes-email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') entrar();
            }}
            placeholder="seu@email.com"
            autoComplete="off"
            disabled={carregando}
          />
        </label>

        <label className="field">
          Senha
          <input
            type="password"
            name="central-fretes-senha"
            value={senha}
            onChange={(event) => setSenha(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') entrar();
            }}
            placeholder="Senha"
            autoComplete="off"
            disabled={carregando}
          />
        </label>

        {erro && <div className="hint-box compact error-text">{erro}</div>}

        <button type="button" className="btn-primary full" onClick={entrar} disabled={carregando}>
          {carregando ? 'Entrando...' : 'Entrar'}
        </button>
      </div>
    </div>
  );
}
