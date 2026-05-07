import {
  listarUsuariosSupabase,
  registrarUltimoLoginSupabase,
  salvarUsuariosSupabase,
  usuarioSupabaseDisponivel,
} from '../services/usuariosSupabaseService';

const USERS_KEY = 'central_fretes_usuarios_v1';
const SESSION_KEY = 'central_fretes_sessao_v1';

export const PERFIS_USUARIO = {
  GESTAO: {
    nome: 'Gestão',
    descricao: 'Acesso total ao sistema e gestão de usuários.',
    paginas: ['*'],
  },
  OPERACAO_LOTACAO: {
    nome: 'Operação Lotação',
    descricao: 'Consulta lotação, histórico de cargas, custos adicionais e aprovações.',
    paginas: ['dashboard', 'lotacao', 'lotacao-operacao'],
  },
  AUDITORIA_LOTACAO: {
    nome: 'Auditoria Lotação',
    descricao: 'Consulta DIST/CT-e e registro de auditoria.',
    paginas: ['dashboard', 'lotacao-auditoria'],
  },
  CONSULTA: {
    nome: 'Consulta',
    descricao: 'Acesso de consulta sem gestão de usuários.',
    paginas: ['dashboard', 'lotacao', 'lotacao-operacao', 'consulta-ibge', 'ferramentas', 'tracking', 'torre-controle', 'reajustes'],
  },
};

const DEFAULT_USERS = [
  {
    id: 'user-gestao-aldo',
    nome: 'Aldo Dias',
    email: 'aldomdias@gmail.com',
    senha: '123456',
    perfil: 'GESTAO',
    ativo: true,
    criadoEm: new Date().toISOString(),
  },
];

function uid(prefix = 'usr') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function limparTexto(valor = '') {
  return String(valor ?? '').trim();
}

function normalizarEmail(email = '') {
  return limparTexto(email).toLowerCase();
}

function salvarUsuariosInterno(usuarios = []) {
  localStorage.setItem(USERS_KEY, JSON.stringify(usuarios));
}

function montarSessao(usuario) {
  const sessao = {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    perfil: usuario.perfil,
    loginEm: new Date().toISOString(),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
  return sessao;
}

export function carregarUsuarios() {
  try {
    const parsed = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // segue para seed
  }
  salvarUsuariosInterno(DEFAULT_USERS);
  return DEFAULT_USERS;
}

export async function carregarUsuariosAsync({ migrarLocal = true } = {}) {
  const locais = carregarUsuarios();

  if (!usuarioSupabaseDisponivel()) {
    return {
      usuarios: locais,
      origem: 'local',
      sincronizado: false,
      mensagem: 'Supabase não configurado. Usando usuários locais deste navegador.',
    };
  }

  try {
    const remotos = await listarUsuariosSupabase();
    if (remotos.length) {
      salvarUsuariosInterno(remotos);
      return {
        usuarios: remotos,
        origem: 'supabase',
        sincronizado: true,
        mensagem: 'Usuários carregados do Supabase.',
      };
    }

    if (migrarLocal && locais.length) {
      await salvarUsuariosSupabase(locais);
      salvarUsuariosInterno(locais);
      return {
        usuarios: locais,
        origem: 'supabase',
        sincronizado: true,
        migrado: true,
        mensagem: 'Usuários locais migrados para o Supabase.',
      };
    }

    return {
      usuarios: locais,
      origem: 'local',
      sincronizado: false,
      mensagem: 'Nenhum usuário encontrado no Supabase. Usando base local.',
    };
  } catch (error) {
    return {
      usuarios: locais,
      origem: 'local',
      sincronizado: false,
      erro: error.message || String(error),
      mensagem: 'Não foi possível carregar usuários do Supabase. Usando base local deste navegador.',
    };
  }
}

export function salvarUsuarios(usuarios = []) {
  salvarUsuariosInterno(usuarios);
}

export async function salvarUsuariosAsync(usuarios = []) {
  salvarUsuariosInterno(usuarios);

  if (!usuarioSupabaseDisponivel()) {
    return {
      origem: 'local',
      sincronizado: false,
      mensagem: 'Supabase não configurado. Alteração salva apenas neste navegador.',
    };
  }

  try {
    await salvarUsuariosSupabase(usuarios);
    return {
      origem: 'supabase',
      sincronizado: true,
      mensagem: 'Alteração salva no Supabase.',
    };
  } catch (error) {
    return {
      origem: 'local',
      sincronizado: false,
      erro: error.message || String(error),
      mensagem: 'Alteração salva localmente, mas não sincronizou com o Supabase.',
    };
  }
}

export function usuarioTemAcesso(usuario, pagina) {
  if (!usuario) return false;
  if (pagina === 'minha-senha') return true;
  const perfil = PERFIS_USUARIO[usuario.perfil] || PERFIS_USUARIO.CONSULTA;
  if (perfil.paginas.includes('*')) return true;
  return perfil.paginas.includes(pagina);
}

export function loginLocal(email, senha) {
  const usuarios = carregarUsuarios();
  const emailNorm = normalizarEmail(email);
  const usuario = usuarios.find((item) => normalizarEmail(item.email) === emailNorm && item.ativo !== false);
  if (!usuario || String(usuario.senha || '') !== String(senha || '')) {
    throw new Error('E-mail ou senha inválidos.');
  }
  return montarSessao(usuario);
}

export async function loginCentral(email, senha) {
  const resultado = await carregarUsuariosAsync({ migrarLocal: true });
  const usuarios = resultado.usuarios || [];
  const emailNorm = normalizarEmail(email);
  const usuario = usuarios.find((item) => normalizarEmail(item.email) === emailNorm && item.ativo !== false);

  if (!usuario || String(usuario.senha || '') !== String(senha || '')) {
    throw new Error('E-mail ou senha inválidos.');
  }

  const sessao = montarSessao(usuario);

  if (resultado.sincronizado) {
    try {
      await registrarUltimoLoginSupabase(usuario.id);
    } catch {
      // login já foi validado; não bloqueia entrada por falha de auditoria
    }
  }

  return {
    ...sessao,
    origemUsuarios: resultado.origem,
    usuariosSincronizados: resultado.sincronizado,
  };
}

export function carregarSessao() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!parsed?.id) return null;
    const usuarioAtual = carregarUsuarios().find((item) => item.id === parsed.id && item.ativo !== false);
    if (!usuarioAtual) return null;
    return {
      id: usuarioAtual.id,
      nome: usuarioAtual.nome,
      email: usuarioAtual.email,
      perfil: usuarioAtual.perfil,
      loginEm: parsed.loginEm || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function sairLocal() {
  localStorage.removeItem(SESSION_KEY);
}

export function criarUsuario(dados, usuariosAtuais = carregarUsuarios()) {
  const email = normalizarEmail(dados.email);
  if (!dados.nome?.trim()) throw new Error('Informe o nome do usuário.');
  if (!email) throw new Error('Informe o e-mail do usuário.');
  if (!dados.senha?.trim()) throw new Error('Informe uma senha inicial.');
  if (usuariosAtuais.some((item) => normalizarEmail(item.email) === email)) {
    throw new Error('Já existe um usuário com este e-mail.');
  }
  const novo = {
    id: uid('user'),
    nome: limparTexto(dados.nome),
    email,
    senha: limparTexto(dados.senha),
    perfil: dados.perfil || 'CONSULTA',
    ativo: dados.ativo !== false,
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };
  return [novo, ...usuariosAtuais];
}

export async function criarUsuarioAsync(dados, usuariosAtuais = carregarUsuarios()) {
  const lista = criarUsuario(dados, usuariosAtuais);
  await salvarUsuariosAsync(lista);
  return lista;
}

export function atualizarUsuario(usuarios = [], id, alteracoes = {}) {
  const emailNovo = alteracoes.email !== undefined ? normalizarEmail(alteracoes.email) : null;
  if (emailNovo && usuarios.some((item) => item.id !== id && normalizarEmail(item.email) === emailNovo)) {
    throw new Error('Já existe outro usuário com este e-mail.');
  }
  return usuarios.map((item) => {
    if (item.id !== id) return item;
    return {
      ...item,
      ...alteracoes,
      nome: alteracoes.nome !== undefined ? limparTexto(alteracoes.nome) : item.nome,
      email: alteracoes.email !== undefined ? emailNovo : item.email,
      senha: alteracoes.senha !== undefined ? limparTexto(alteracoes.senha) : item.senha,
      atualizadoEm: new Date().toISOString(),
    };
  });
}

export async function atualizarUsuarioAsync(usuarios = [], id, alteracoes = {}) {
  const lista = atualizarUsuario(usuarios, id, alteracoes);
  await salvarUsuariosAsync(lista);
  return lista;
}


export async function alterarSenhaUsuarioLogado({ usuarioId, senhaAtual, novaSenha, confirmarSenha }) {
  const senhaAtualLimpa = limparTexto(senhaAtual);
  const novaSenhaLimpa = limparTexto(novaSenha);
  const confirmarSenhaLimpa = limparTexto(confirmarSenha);

  if (!usuarioId) throw new Error('Sessão inválida. Saia e entre novamente.');
  if (!senhaAtualLimpa) throw new Error('Informe a senha atual.');
  if (!novaSenhaLimpa) throw new Error('Informe a nova senha.');
  if (novaSenhaLimpa.length < 4) throw new Error('A nova senha precisa ter pelo menos 4 caracteres.');
  if (novaSenhaLimpa !== confirmarSenhaLimpa) throw new Error('A confirmação da nova senha não confere.');

  const resultado = await carregarUsuariosAsync({ migrarLocal: false });
  const usuarios = resultado.usuarios || [];
  const usuario = usuarios.find((item) => item.id === usuarioId && item.ativo !== false);

  if (!usuario) throw new Error('Usuário não encontrado ou inativo.');
  if (String(usuario.senha || '') !== String(senhaAtualLimpa)) {
    throw new Error('Senha atual inválida.');
  }

  const lista = atualizarUsuario(usuarios, usuarioId, { senha: novaSenhaLimpa });
  const persistencia = await salvarUsuariosAsync(lista);
  const usuarioAtualizado = lista.find((item) => item.id === usuarioId) || usuario;
  const sessao = montarSessao(usuarioAtualizado);

  return {
    sessao: {
      ...sessao,
      origemUsuarios: persistencia.origem || resultado.origem,
      usuariosSincronizados: Boolean(persistencia.sincronizado),
    },
    persistencia,
  };
}

export function nomePerfil(perfil) {
  return PERFIS_USUARIO[perfil]?.nome || perfil || '-';
}
