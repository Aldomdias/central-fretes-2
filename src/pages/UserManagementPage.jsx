import { useEffect, useMemo, useState } from 'react';
import {
  MODULOS_SISTEMA,
  PERFIS_USUARIO,
  atualizarUsuario,
  carregarUsuarios,
  carregarUsuariosAsync,
  criarUsuario,
  nomePerfil,
  permissoesPadraoPerfil,
  permissoesUsuario,
  salvarUsuariosAsync,
  usuarioPodeAdministrarUsuarios,
} from '../utils/authLocal';

const formInicial = {
  nome: '',
  email: '',
  senha: '123456',
  perfil: 'CONSULTA',
  permissoesPaginas: permissoesPadraoPerfil('CONSULTA'),
  ativo: true,
};

function agruparModulos() {
  return MODULOS_SISTEMA.reduce((acc, modulo) => {
    if (modulo.somenteAdmin) return acc;
    if (!acc[modulo.grupo]) acc[modulo.grupo] = [];
    acc[modulo.grupo].push(modulo);
    return acc;
  }, {});
}

function ModulosCheckboxes({ permissoes, onChange, disabled }) {
  const grupos = useMemo(() => agruparModulos(), []);
  const selecionadas = Array.isArray(permissoes) && permissoes.includes('*')
    ? MODULOS_SISTEMA.filter((modulo) => !modulo.somenteAdmin).map((modulo) => modulo.chave)
    : (permissoes || []);

  const alternar = (chave) => {
    const atual = new Set(selecionadas);
    if (atual.has(chave)) atual.delete(chave);
    else atual.add(chave);
    onChange([...atual]);
  };

  return (
    <div className="hint-box compact" style={{ marginTop: 12 }}>
      <strong>Módulos permitidos</strong>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12, marginTop: 12 }}>
        {Object.entries(grupos).map(([grupo, modulos]) => (
          <div key={grupo}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 8 }}>{grupo}</div>
            {modulos.map((modulo) => (
              <label key={modulo.chave} className="checkbox-line" style={{ marginBottom: 6 }}>
                <input
                  type="checkbox"
                  checked={selecionadas.includes(modulo.chave)}
                  onChange={() => alternar(modulo.chave)}
                  disabled={disabled}
                />
                {modulo.label}
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function UserManagementPage({ usuarioAtual }) {
  const [usuarios, setUsuarios] = useState(() => carregarUsuarios());
  const [form, setForm] = useState(formInicial);
  const [mensagem, setMensagem] = useState('Carregando usuários...');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [origemDados, setOrigemDados] = useState('local');
  const perfis = useMemo(() => Object.entries(PERFIS_USUARIO), []);
  const podeAdministrar = usuarioPodeAdministrarUsuarios(usuarioAtual);

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      const resultado = await carregarUsuariosAsync({ migrarLocal: true });
      if (!ativo) return;
      setUsuarios(resultado.usuarios || []);
      setOrigemDados(resultado.origem || 'local');
      setMensagem(resultado.mensagem || 'Usuários carregados.');
      setErro(resultado.erro || '');
    }

    carregar();

    return () => {
      ativo = false;
    };
  }, []);

  const atualizarForm = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  const alterarPerfilForm = (perfil) => {
    setForm((prev) => ({
      ...prev,
      perfil,
      permissoesPaginas: permissoesPadraoPerfil(perfil, { email: prev.email, perfil }),
    }));
  };

  const persistir = async (lista, msg) => {
    setSalvando(true);
    setUsuarios(lista);
    setErro('');
    setMensagem(`${msg} Salvando...`);

    const resultado = await salvarUsuariosAsync(lista);

    setOrigemDados(resultado.origem || 'local');
    setMensagem(`${msg} ${resultado.mensagem || ''}`.trim());
    setErro(resultado.erro || '');
    setSalvando(false);
  };

  const adicionar = async () => {
    if (salvando || !podeAdministrar) return;
    try {
      const lista = criarUsuario(form, usuarios);
      await persistir(lista, 'Usuário criado com sucesso.');
      setForm(formInicial);
    } catch (error) {
      setErro(error.message || String(error));
      setMensagem('');
      setSalvando(false);
    }
  };

  const alterar = async (id, alteracoes, msg) => {
    if (salvando || !podeAdministrar) return;
    try {
      const lista = atualizarUsuario(usuarios, id, alteracoes);
      await persistir(lista, msg);
    } catch (error) {
      setErro(error.message || String(error));
      setMensagem('');
      setSalvando(false);
    }
  };

  const alterarPerfilUsuario = (usuario, perfil) => {
    const permissoesPaginas = permissoesPadraoPerfil(perfil, { ...usuario, perfil });
    alterar(usuario.id, { perfil, permissoesPaginas }, 'Perfil e módulos atualizados.');
  };

  const sincronizarAgora = async () => {
    if (salvando || !podeAdministrar) return;
    await persistir(usuarios, 'Sincronização manual concluída.');
  };

  const origemLabel = origemDados === 'supabase' ? 'Supabase ativo' : 'Local deste navegador';

  if (!podeAdministrar) {
    return (
      <div className="page-shell usuarios-page">
        <div className="panel-card">
          <div className="panel-title">Acesso restrito</div>
          <p>Somente o administrador principal pode alterar usuários e permissões.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell usuarios-page">
      <header className="page-top between">
        <div className="page-header">
          <span className="amd-mini-brand">Sistema</span>
          <h1>Gestão de usuários</h1>
          <p>Crie usuários e defina exatamente quais módulos cada pessoa pode acessar.</p>
        </div>
        <div className="actions-right">
          <span className="status-pill dark">{origemLabel}</span>
          <button type="button" className="btn-secondary" onClick={sincronizarAgora} disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar no Supabase agora'}
          </button>
        </div>
      </header>

      <div className="panel-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Novo usuário</div>
            <p>Escolha um perfil como ponto de partida e ajuste os módulos liberados.</p>
          </div>
        </div>

        <div className="form-grid three">
          <label className="field">
            Nome
            <input value={form.nome} onChange={(event) => atualizarForm('nome', event.target.value)} placeholder="Nome do usuário" disabled={salvando} />
          </label>
          <label className="field">
            E-mail
            <input value={form.email} onChange={(event) => atualizarForm('email', event.target.value)} placeholder="email@empresa.com" disabled={salvando} />
          </label>
          <label className="field">
            Senha inicial
            <input value={form.senha} onChange={(event) => atualizarForm('senha', event.target.value)} placeholder="Senha" disabled={salvando} />
          </label>
        </div>

        <div className="form-grid three">
          <label className="field">
            Perfil
            <select value={form.perfil} onChange={(event) => alterarPerfilForm(event.target.value)} disabled={salvando}>
              {perfis.map(([chave, perfil]) => (
                <option key={chave} value={chave}>{perfil.nome}</option>
              ))}
            </select>
          </label>
          <label className="checkbox-line top-space-sm">
            <input type="checkbox" checked={form.ativo} onChange={(event) => atualizarForm('ativo', event.target.checked)} disabled={salvando} />
            Usuário ativo
          </label>
          <div className="actions-right">
            <button type="button" className="btn-primary" onClick={adicionar} disabled={salvando}>Criar usuário</button>
          </div>
        </div>

        <ModulosCheckboxes
          permissoes={form.permissoesPaginas}
          onChange={(permissoesPaginas) => atualizarForm('permissoesPaginas', permissoesPaginas)}
          disabled={salvando}
        />

        {mensagem && <div className="hint-box compact">{mensagem}</div>}
        {erro && <div className="hint-box compact error-text">{erro}</div>}
      </div>

      <div className="table-card">
        <div className="section-row compact-top">
          <div>
            <div className="panel-title">Usuários cadastrados</div>
            <p className="compact">Altere perfil, senha, status e módulos de acesso.</p>
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
              {usuarios.map((usuario) => {
                const adminPrincipal = usuarioPodeAdministrarUsuarios(usuario);
                return (
                  <tr key={usuario.id}>
                    <td><strong>{usuario.nome}</strong></td>
                    <td>{usuario.email}</td>
                    <td>
                      <select value={usuario.perfil} onChange={(event) => alterarPerfilUsuario(usuario, event.target.value)} disabled={salvando || adminPrincipal}>
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
                        disabled={salvando}
                      />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={salvando || adminPrincipal}
                          onClick={() => alterar(usuario.id, { ativo: usuario.ativo === false }, usuario.ativo === false ? 'Usuário ativado.' : 'Usuário inativado.')}
                        >
                          {usuario.ativo === false ? 'Ativar' : 'Inativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {usuarios.map((usuario) => (
          <div key={`${usuario.id}-modulos`} className="panel-card" style={{ marginTop: 12 }}>
            <div className="section-row compact-top">
              <div>
                <div className="panel-title">{usuario.nome}</div>
                <p className="compact">Módulos liberados para {usuario.email}</p>
              </div>
              {usuarioPodeAdministrarUsuarios(usuario) && <span className="status-pill dark">Admin principal</span>}
            </div>
            <ModulosCheckboxes
              permissoes={permissoesUsuario(usuario)}
              onChange={(permissoesPaginas) => alterar(usuario.id, { permissoesPaginas }, 'Módulos atualizados.')}
              disabled={salvando || usuarioPodeAdministrarUsuarios(usuario)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
