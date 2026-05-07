import { useState } from 'react';
import { alterarSenhaUsuarioLogado } from '../utils/authLocal';

const formInicial = {
  senhaAtual: '',
  novaSenha: '',
  confirmarSenha: '',
};

export default function MinhaSenhaPage({ usuarioAtual, onSenhaAlterada }) {
  const [form, setForm] = useState(formInicial);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const atualizarCampo = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
    setErro('');
    setMensagem('');
  };

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true);
    setErro('');
    setMensagem('Salvando nova senha...');

    try {
      const resultado = await alterarSenhaUsuarioLogado({
        usuarioId: usuarioAtual?.id,
        senhaAtual: form.senhaAtual,
        novaSenha: form.novaSenha,
        confirmarSenha: form.confirmarSenha,
      });

      setForm(formInicial);
      setMensagem(`Senha alterada com sucesso. ${resultado.persistencia?.mensagem || ''}`.trim());
      if (resultado.sessao && typeof onSenhaAlterada === 'function') {
        onSenhaAlterada(resultado.sessao);
      }
    } catch (error) {
      setMensagem('');
      setErro(error.message || String(error));
    } finally {
      setSalvando(false);
    }
  };

  const tecla = (event) => {
    if (event.key === 'Enter') salvar();
  };

  return (
    <div className="page-shell minha-senha-page">
      <header className="page-top between">
        <div className="page-header">
          <span className="amd-mini-brand">Conta</span>
          <h1>Alterar senha</h1>
          <p>Atualize sua senha de acesso. A alteração fica salva no Supabase e passa a valer também em outras máquinas.</p>
        </div>
      </header>

      <div className="panel-card senha-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Minha senha</div>
            <p>Usuário conectado: <strong>{usuarioAtual?.nome || usuarioAtual?.email || 'Usuário'}</strong></p>
          </div>
        </div>

        <div className="form-grid three">
          <label className="field">
            Senha atual
            <input
              type="password"
              value={form.senhaAtual}
              onChange={(event) => atualizarCampo('senhaAtual', event.target.value)}
              onKeyDown={tecla}
              placeholder="Digite a senha atual"
              autoComplete="current-password"
              disabled={salvando}
            />
          </label>

          <label className="field">
            Nova senha
            <input
              type="password"
              value={form.novaSenha}
              onChange={(event) => atualizarCampo('novaSenha', event.target.value)}
              onKeyDown={tecla}
              placeholder="Digite a nova senha"
              autoComplete="new-password"
              disabled={salvando}
            />
          </label>

          <label className="field">
            Confirmar nova senha
            <input
              type="password"
              value={form.confirmarSenha}
              onChange={(event) => atualizarCampo('confirmarSenha', event.target.value)}
              onKeyDown={tecla}
              placeholder="Confirme a nova senha"
              autoComplete="new-password"
              disabled={salvando}
            />
          </label>
        </div>

        <div className="actions-right top-space-sm">
          <button type="button" className="btn-secondary" onClick={() => setForm(formInicial)} disabled={salvando}>
            Limpar
          </button>
          <button type="button" className="btn-primary" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Alterar senha'}
          </button>
        </div>

        {mensagem && <div className="hint-box compact">{mensagem}</div>}
        {erro && <div className="hint-box compact error-text">{erro}</div>}
      </div>
    </div>
  );
}
