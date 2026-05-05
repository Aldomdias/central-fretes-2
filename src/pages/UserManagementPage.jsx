import { useMemo, useState } from 'react';
import {
  PERFIS_USUARIO,
  atualizarUsuario,
  carregarUsuarios,
  criarUsuario,
  nomePerfil,
  salvarUsuarios,
} from '../utils/authLocal';

const formInicial = {
  nome: '',
  email: '',
  senha: '123456',
  perfil: 'CONSULTA',
  ativo: true,
};

export default function UserManagementPage({ usuarioAtual }) {
  const [usuarios, setUsuarios] = useState(() => carregarUsuarios());
  const [form, setForm] = useState(formInicial);
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const perfis = useMemo(() => Object.entries(PERFIS_USUARIO), []);

  const atualizarForm = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  const persistir = (lista, msg) => {
    salvarUsuarios(lista);
    setUsuarios(lista);
    setMensagem(msg);
    setErro('');
  };

  const adicionar = () => {
    try {
      const lista = criarUsuario(form, usuarios);
      persistir(lista, 'Usuário criado com sucesso.');
      setForm(formInicial);
    } catch (error) {
      setErro(error.message || String(error));
      setMensagem('');
    }
  };

  const alterar = (id, alteracoes, msg) => {
    try {
      const lista = atualizarUsuario(usuarios, id, alteracoes);
      persistir(lista, msg);
    } catch (error) {
      setErro(error.message || String(error));
      setMensagem('');
    }
  };

  return (
    <div className="page-shell usuarios-page">
      <header className="page-top between">
        <div className="page-header">
          <span className="amd-mini-brand">Sistema</span>
          <h1>Gestão de usuários</h1>
          <p>Crie usuários e defina o perfil de acesso de cada pessoa. O usuário de gestão tem acesso total.</p>
        </div>
      </header>

      <div className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Novo usuário</div>
            <p>Crie o login para operação, auditoria, consulta ou gestão.</p>
          </div>
        </div>

        <div className="form-grid three">
          <label className="field">
            Nome
            <input value={form.nome} onChange={(event) => atualizarForm('nome', event.target.value)} placeholder="Nome do usuário" />
          </label>
          <label className="field">
            E-mail
            <input value={form.email} onChange={(event) => atualizarForm('email', event.target.value)} placeholder="email@empresa.com" />
          </label>
          <label className="field">
            Senha inicial
            <input value={form.senha} onChange={(event) => atualizarForm('senha', event.target.value)} placeholder="Senha" />
          </label>
        </div>

        <div className="form-grid three">
          <label className="field">
            Perfil
            <select value={form.perfil} onChange={(event) => atualizarForm('perfil', event.target.value)}>
              {perfis.map(([chave, perfil]) => (
                <option key={chave} value={chave}>{perfil.nome}</option>
              ))}
            </select>
          </label>
          <label className="checkbox-line top-space-sm">
            <input type="checkbox" checked={form.ativo} onChange={(event) => atualizarForm('ativo', event.target.checked)} />
            Usuário ativo
          </label>
          <div className="actions-right">
            <button type="button" className="btn-primary" onClick={adicionar}>Criar usuário</button>
          </div>
        </div>

        {mensagem && <div className="hint-box compact">{mensagem}</div>}
        {erro && <div className="hint-box compact error-text">{erro}</div>}
      </div>

      <div className="table-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Usuários cadastrados</div>
            <p className="compact">Altere perfil, senha e status de acesso.</p>
          </div>
          <span className="status-pill dark">{usuarios.length} usuário(s)</span>
        </div>

        <div className="sim-analise-tabela-wrap">
          <table className="sim-analise-tabela">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Status</th>
                <th>Senha</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((usuario) => (
                <tr key={usuario.id}>
                  <td><strong>{usuario.nome}</strong></td>
                  <td>{usuario.email}</td>
                  <td>
                    <select value={usuario.perfil} onChange={(event) => alterar(usuario.id, { perfil: event.target.value }, 'Perfil atualizado.')}>
                      {perfis.map(([chave, perfil]) => (
                        <option key={chave} value={chave}>{perfil.nome}</option>
                      ))}
                    </select>
                    <small className="muted-block">{nomePerfil(usuario.perfil)}</small>
                  </td>
                  <td><span className="status-pill">{usuario.ativo === false ? 'Inativo' : 'Ativo'}</span></td>
                  <td>
                    <input
                      defaultValue={usuario.senha || ''}
                      onBlur={(event) => alterar(usuario.id, { senha: event.target.value }, 'Senha atualizada.')}
                      disabled={usuario.id === usuarioAtual?.id && usuarios.length === 1}
                    />
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={usuario.id === usuarioAtual?.id && usuarios.filter((item) => item.ativo !== false).length === 1}
                        onClick={() => alterar(usuario.id, { ativo: usuario.ativo === false }, usuario.ativo === false ? 'Usuário ativado.' : 'Usuário inativado.')}
                      >
                        {usuario.ativo === false ? 'Ativar' : 'Inativar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
