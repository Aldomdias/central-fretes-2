import {
  listarUsuariosSupabase,
  registrarUltimoLoginSupabase,
  salvarUsuariosSupabase,
  usuarioSupabaseDisponivel,
} from '../services/usuariosSupabaseService';

const USERS_KEY = 'central_fretes_usuarios_v1';
const SESSION_KEY = 'central_fretes_sessao_v1';
const ADMIN_EMAIL = 'aldo.dias@cantu.inc';
const SESSION_TTL_MS = 5 * 60 * 60 * 1000;

export const MODULOS_SISTEMA = [
  { chave: 'dashboard', label: 'Dashboard', grupo: 'Geral' },
  { chave: 'conceito-app', label: 'Conceito visual', grupo: 'Geral' },
  { chave: 'simulador', label: 'Simulador', grupo: 'Fretes' },
  { chave: 'tabelas-negociacao', label: 'Tabelas em Negociação', grupo: 'Suprimentos' },
  { chave: 'cte', label: 'CT-e', grupo: 'Auditoria' },
  { chave: 'auditoria-cte', label: 'Laboratorio Auditoria CT-e', grupo: 'Auditoria' },
  { chave: 'tracking', label: 'Tracking', grupo: 'Operação' },
  { chave: 'torre-controle', label: 'Torre de Controle', grupo: 'Operação' },
  { chave: 'reajustes', label: 'Reajustes', grupo: 'Fretes' },
  { chave: 'avaliacao-prazos', label: 'Avaliação de Prazos', grupo: 'Transportadoras' },
  { chave: 'importacao', label: 'Importação', grupo: 'Suprimentos' },
  { chave: 'formatacao', label: 'Formatação de Tabelas', grupo: 'Suprimentos' },
  { chave: 'importar-template', label: 'Importar Template', grupo: 'Suprimentos' },
  { chave: 'lotacao', label: 'Lotação Tabelas', grupo: 'Lotação' },
  { chave: 'lotacao-operacao', label: 'Lotação Operação', grupo: 'Lotação' },
  { chave: 'lotacao-auditoria', label: 'Auditoria Lotação', grupo: 'Auditoria' },
  { chave: 'painel-auditoria', label: 'Painel Auditoria', grupo: 'Auditoria' },
  { chave: 'painel-operacao', label: 'Painel Operação', grupo: 'Operação' },
  { chave: 'faturas', label: 'Central Auditoria de Fretes', grupo: 'Auditoria' },
  { chave: 'gestao-auditoria-fretes', label: 'Gestao da Auditoria', grupo: 'Auditoria' },
  { chave: 'financeiro-auditoria', label: 'Central Financeira', grupo: 'Financeiro' },
  { chave: 'tratativas', label: 'Tratativas', grupo: 'Auditoria' },
  { chave: 'consulta-ibge', label: 'Consulta IBGE', grupo: 'Cadastros' },
  { chave: 'ferramentas', label: 'Ferramentas', grupo: 'Geral' },
  { chave: 'transportadoras', label: 'Transportadoras', grupo: 'Cadastros' },
  { chave: 'perda-realizado',      label: 'Perda por Transp. Mais Cara', grupo: 'Transportadoras' },
  { chave: 'oportunidade-origem', label: 'Oportunidade de Origem',       grupo: 'Transportadoras' },
  { chave: 'oportunidade-transportadora', label: 'Oportunidade Transportadora', grupo: 'Transportadoras' },
  { chave: 'simular-saida-transportadora', label: 'Simular Saída de Transportadora', grupo: 'Transportadoras' },
  { chave: 'gestao-base-cte', label: 'Gestão da Base CT-e', grupo: 'Auditoria' },
  { chave: 'usuarios', label: 'Gestão de Usuários', grupo: 'Administração', somenteAdmin: true },
];

const CHAVES_MODULOS = MODULOS_SISTEMA.map((modulo) => modulo.chave);
const CHAVES_MODULOS_USUARIO = MODULOS_SISTEMA.filter((modulo) => !modulo.somenteAdmin).map((modulo) => modulo.chave);

export const PERFIS_USUARIO = {
  GESTAO: {
    nome: 'Gestão',
    descricao: 'Acesso total ao sistema e gestão de usuários.',
    paginas: ['*'],
  },
  NEGOCIACAO_FRETES: {
    nome: 'Negociação de Fretes',
    descricao: 'Acesso ao simulador, reajustes, transportadoras e tabelas em negociação.',
    paginas: [
      'dashboard',
      'conceito-app',
      'simulador',
      'tabelas-negociacao',
      'cte',
      'tracking',
      'torre-controle',
      'reajustes',
      'avaliacao-prazos',
      'perda-realizado',
      'oportunidade-origem',
      'oportunidade-transportadora',
      'simular-saida-transportadora',
      'formatacao',
      'importar-template',
      'consulta-ibge',
      'ferramentas',
      'transportadoras',
    ],
  },
  OPERACAO_LOTACAO: {
    nome: 'Operação Lotação',
    descricao: 'Consulta lotação, histórico de cargas, custos adicionais e aprovações.',
    paginas: ['dashboard', 'conceito-app', 'lotacao', 'lotacao-operacao', 'painel-operacao', 'tratativas', 'avaliacao-prazos'],
  },
  AUDITORIA_LOTACAO: {
    nome: 'Auditoria Lotação',
    descricao: 'Consulta DIST/CT-e e registro de auditoria.',
    paginas: ['dashboard', 'conceito-app', 'cte', 'auditoria-cte', 'lotacao-auditoria', 'painel-auditoria', 'faturas', 'tratativas'],
  },
  AUDITORIA_FRETES: {
    nome: 'Auditoria de Fretes',
    descricao: 'Carteira de faturas, reauditoria, vencimentos, DOCCOB e tratativas.',
    paginas: ['dashboard', 'conceito-app', 'cte', 'auditoria-cte', 'painel-auditoria', 'faturas', 'tratativas'],
  },
  GESTOR_AUDITORIA_FRETES: {
    nome: 'Gestor de Auditoria de Fretes',
    descricao: 'Gestao de carteiras, produtividade, riscos, vencimentos e SLA.',
    paginas: ['dashboard', 'conceito-app', 'cte', 'auditoria-cte', 'painel-auditoria', 'faturas', 'gestao-auditoria-fretes', 'financeiro-auditoria', 'tratativas', 'gestao-base-cte'],
  },
  FINANCEIRO: {
    nome: 'Financeiro',
    descricao: 'Protocolos, solicitacoes, boletos, pagamentos e comprovantes.',
    paginas: ['dashboard', 'conceito-app', 'financeiro-auditoria', 'faturas', 'tratativas'],
  },
  CONSULTA: {
    nome: 'Consulta',
    descricao: 'Acesso de consulta sem gestão de usuários.',
    paginas: [
      'dashboard',
      'conceito-app',
      'lotacao',
      'lotacao-operacao',
      'consulta-ibge',
      'ferramentas',
      'tracking',
      'torre-controle',
      'reajustes',
      'avaliacao-prazos',
      'perda-realizado',
      'oportunidade-origem',
      'oportunidade-transportadora',
      'simular-saida-transportadora',
    ],
  },
};

const DEFAULT_USERS = [
  {
    id: 'user-gestao-aldo',
    nome: 'Aldo Dias',
    email: ADMIN_EMAIL,
    senha: '123456',
    perfil: 'GESTAO',
    permissoesPaginas: ['*'],
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

function filtrarPermissoes(permissoes = [], permiteAdmin = false) {
  if (!Array.isArray(permissoes)) return [];
  if (permissoes.includes('*')) return permiteAdmin ? ['*'] : CHAVES_MODULOS_USUARIO;

  const permitidas = permiteAdmin ? CHAVES_MODULOS : CHAVES_MODULOS_USUARIO;
  return [...new Set(permissoes.filter((pagina) => permitidas.includes(pagina)))];
}

function paginasPerfil(perfilChave) {
  const perfil = PERFIS_USUARIO[perfilChave] || PERFIS_USUARIO.CONSULTA;
  if (perfil.paginas.includes('*')) return ['*'];
  return filtrarPermissoes(perfil.paginas, false);
}

export function usuarioPodeAdministrarUsuarios(usuario) {
  return normalizarEmail(usuario?.email) === ADMIN_EMAIL && usuario?.perfil === 'GESTAO';
}

function normalizarUsuario(usuario = {}) {
  const email = normalizarEmail(usuario.email);
  const candidato = { ...usuario, email };
  const admin = usuarioPodeAdministrarUsuarios(candidato);
  const permissoesBase = usuario.permissoesPaginas ?? usuario.permissoes_paginas ?? paginasPerfil(usuario.perfil);

  return {
    ...usuario,
    email,
    perfil: usuario.perfil || 'CONSULTA',
    permissoesPaginas: admin ? ['*'] : filtrarPermissoes(permissoesBase, false),
  };
}

function salvarUsuariosInterno(usuarios = []) {
  localStorage.setItem(USERS_KEY, JSON.stringify(usuarios.map(normalizarUsuario)));
}

function montarSessao(usuario) {
  const usuarioNormalizado = normalizarUsuario(usuario);
  const loginEm = new Date().toISOString();
  const sessao = {
    id: usuarioNormalizado.id,
    nome: usuarioNormalizado.nome,
    email: usuarioNormalizado.email,
    perfil: usuarioNormalizado.perfil,
    permissoesPaginas: usuarioNormalizado.permissoesPaginas,
    loginEm,
    expiraEm: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(sessao));
  return sessao;
}

export function permissoesPadraoPerfil(perfilChave, usuario = null) {
  if ((perfilChave === 'GESTAO' || usuario?.perfil === 'GESTAO') && usuarioPodeAdministrarUsuarios({ ...usuario, perfil: 'GESTAO' })) {
    return ['*'];
  }

  return paginasPerfil(perfilChave).filter((pagina) => pagina !== 'usuarios');
}

export function permissoesUsuario(usuario) {
  const normalizado = normalizarUsuario(usuario);
  if (usuarioPodeAdministrarUsuarios(normalizado)) return ['*'];

  if (Array.isArray(normalizado.permissoesPaginas) && normalizado.permissoesPaginas.length) {
    return filtrarPermissoes(normalizado.permissoesPaginas, false);
  }

  return permissoesPadraoPerfil(normalizado.perfil, normalizado);
}

export function carregarUsuarios() {
  try {
    const parsed = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
    if (Array.isArray(parsed) && parsed.length) return parsed.map(normalizarUsuario);
  } catch {
    // segue para seed
  }

  salvarUsuariosInterno(DEFAULT_USERS);
  return DEFAULT_USERS.map(normalizarUsuario);
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
    const remotos = (await listarUsuariosSupabase()).map(normalizarUsuario);

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
  const normalizados = usuarios.map(normalizarUsuario);
  salvarUsuariosInterno(normalizados);

  if (!usuarioSupabaseDisponivel()) {
    return {
      origem: 'local',
      sincronizado: false,
      mensagem: 'Supabase não configurado. Alteração salva apenas neste navegador.',
    };
  }

  try {
    await salvarUsuariosSupabase(normalizados);

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
  if (pagina === 'usuarios') return usuarioPodeAdministrarUsuarios(usuario);

  const permissoes = permissoesUsuario(usuario);
  if (permissoes.includes('*')) return true;

  return permissoes.includes(pagina);
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
    if (!parsed.expiraEm || new Date(parsed.expiraEm).getTime() <= Date.now()) {
      sairLocal();
      return null;
    }

    const usuarioAtual = carregarUsuarios().find((item) => item.id === parsed.id && item.ativo !== false);

    if (!usuarioAtual) {
      sairLocal();
      return null;
    }

    return {
      id: usuarioAtual.id,
      nome: usuarioAtual.nome,
      email: usuarioAtual.email,
      perfil: usuarioAtual.perfil,
      permissoesPaginas: permissoesUsuario(usuarioAtual),
      loginEm: parsed.loginEm || new Date().toISOString(),
      expiraEm: parsed.expiraEm,
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

  const novo = normalizarUsuario({
    id: uid('user'),
    nome: limparTexto(dados.nome),
    email,
    senha: limparTexto(dados.senha),
    perfil: dados.perfil || 'CONSULTA',
    permissoesPaginas: dados.permissoesPaginas || permissoesPadraoPerfil(dados.perfil || 'CONSULTA', { email, perfil: dados.perfil || 'CONSULTA' }),
    ativo: dados.ativo !== false,
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  });

  return [novo, ...usuariosAtuais.map(normalizarUsuario)];
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
    if (item.id !== id) return normalizarUsuario(item);

    if (usuarioPodeAdministrarUsuarios(item) && alteracoes.ativo === false) {
      throw new Error('O administrador principal não pode ser inativado.');
    }

    return normalizarUsuario({
      ...item,
      ...alteracoes,
      nome: alteracoes.nome !== undefined ? limparTexto(alteracoes.nome) : item.nome,
      email: alteracoes.email !== undefined ? emailNovo : item.email,
      senha: alteracoes.senha !== undefined ? limparTexto(alteracoes.senha) : item.senha,
      atualizadoEm: new Date().toISOString(),
    });
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
