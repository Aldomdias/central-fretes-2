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
    paginas: ['dashboard', 'lotacao', 'lotacao-operacao', 'consulta-ibge', 'ferramentas'],
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

export function salvarUsuarios(usuarios = []) {
  salvarUsuariosInterno(usuarios);
}

export function usuarioTemAcesso(usuario, pagina) {
  if (!usuario) return false;
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
  };
  return [novo, ...usuariosAtuais];
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

export function nomePerfil(perfil) {
  return PERFIS_USUARIO[perfil]?.nome || perfil || '-';
}
