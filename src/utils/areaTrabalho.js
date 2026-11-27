import { usuarioTemAcesso } from './authLocal';
import { MENU_GRUPOS } from '../components/Sidebar';

// Blocos "ricos" (com descricao e tom) da Minha Area de Trabalho. Qualquer outra
// tela do menu tambem pode ser incluida: nesse caso o id do bloco e a propria
// chave da pagina e o titulo vem do menu lateral.
export const BLOCOS = {
  lancarCte: { titulo: 'Lançar CT-e', descricao: 'Abra diretamente o fluxo atual de CT-e.', pagina: 'cte', tom: 'operacao' },
  tracking: { titulo: 'Tracking', descricao: 'Consulte entregas e acompanhe ocorrências.', pagina: 'tracking', tom: 'operacao' },
  operacao: { titulo: 'Painel da operação', descricao: 'Acompanhe cargas, pendências e execução.', pagina: 'painel-operacao', tom: 'operacao' },
  faturas: { titulo: 'Faturas para auditar', descricao: 'Entre na carteira de auditoria de fretes.', pagina: 'faturas', tom: 'auditoria' },
  diagnostico: { titulo: 'Diagnóstico de CT-e', descricao: 'Investigue cálculos e divergências de frete.', pagina: 'auditoria-cte', tom: 'auditoria' },
  sap: { titulo: 'Acompanhamento SAP e OMS', descricao: 'Veja protocolos, financeiro e integrações.', pagina: 'financeiro-auditoria', tom: 'auditoria' },
  propostas: { titulo: 'Propostas e negociações', descricao: 'Compare rodadas, tabelas e aprovações.', pagina: 'tabelas-negociacao', tom: 'suprimentos' },
  realizado: { titulo: 'Simulador do Realizado', descricao: 'Meça oportunidades na operação realizada.', pagina: 'perda-realizado', tom: 'suprimentos' },
  laudos: { titulo: 'Laudos e reajustes', descricao: 'Analise impactos e evidências da negociação.', pagina: 'reajustes', tom: 'suprimentos' },
  contratos: { titulo: 'Contratos', descricao: 'Acompanhe vigências e documentos negociados.', pagina: 'gestao-contratos', tom: 'suprimentos' },
  transportadoras: { titulo: 'Transportadoras', descricao: 'Mantenha origens, rotas, cotações e taxas.', pagina: 'transportadoras', tom: 'base' },
  simulador: { titulo: 'Simulador de fretes', descricao: 'Compare tabelas e impactos por rota.', pagina: 'simulador', tom: 'base' },
};

export const MODELOS = {
  operacao: { nome: 'Operação', blocos: ['lancarCte', 'tracking', 'operacao', 'transportadoras'] },
  auditoria: { nome: 'Auditoria', blocos: ['faturas', 'diagnostico', 'sap', 'lancarCte'] },
  suprimentos: { nome: 'Suprimentos e Negociação', blocos: ['propostas', 'realizado', 'laudos', 'contratos', 'simulador'] },
};

const TOM_POR_GRUPO = { Simulacao: 'suprimentos', Operacao: 'operacao', Auditoria: 'auditoria' };
const PAGINAS_FORA = new Set(['dashboard', 'conceito-app']);

// Todas as telas do menu (sem duplicar chave), com o grupo de origem.
export const PAGINAS_MENU = (() => {
  const vistas = new Set();
  const lista = [];
  MENU_GRUPOS.forEach((grupo) => grupo.itens.forEach((item) => {
    if (vistas.has(item.chave) || PAGINAS_FORA.has(item.chave)) return;
    vistas.add(item.chave);
    lista.push({ chave: item.chave, label: item.label, grupo: grupo.titulo, soSemAcesso: item.soSemAcesso });
  }));
  return lista;
})();

export function paginasDoUsuario(usuario) {
  return PAGINAS_MENU.filter((p) => usuarioTemAcesso(usuario, p.chave)
    && (!p.soSemAcesso || !usuarioTemAcesso(usuario, p.soSemAcesso)));
}

export function resolverBloco(id) {
  if (BLOCOS[id]) return { id, ...BLOCOS[id] };
  const pagina = PAGINAS_MENU.find((p) => p.chave === id);
  if (!pagina) return null;
  return { id, titulo: pagina.label, descricao: `Tela de ${pagina.grupo.toLowerCase()}.`, pagina: pagina.chave, tom: TOM_POR_GRUPO[pagina.grupo] || 'base' };
}

export function modeloParaPerfil(perfil) {
  if (['AUDITORIA_FRETES', 'AUDITORIA_LOTACAO', 'GESTOR_AUDITORIA_FRETES', 'FINANCEIRO'].includes(perfil)) return 'auditoria';
  if (perfil === 'NEGOCIACAO_FRETES') return 'suprimentos';
  return 'operacao';
}

export function blocoPermitido(usuario, id) {
  const bloco = resolverBloco(id);
  return Boolean(bloco && usuarioTemAcesso(usuario, bloco.pagina));
}

// Lista efetiva de blocos (na ordem do usuario). Preferencias antigas tinham
// "fixados" que eram mostrados primeiro; convertemos isso para a ordem real
// uma unica vez, para nao embaralhar o que o usuario ja via.
export function blocosEfetivos(usuario, preferencias) {
  const modelo = preferencias.modeloArea || modeloParaPerfil(usuario?.perfil);
  let lista = preferencias.blocos?.length ? [...preferencias.blocos] : [...(MODELOS[modelo]?.blocos || [])];
  const fixados = Array.isArray(preferencias.fixados) ? preferencias.fixados : [];
  if (fixados.length) lista = [...lista.filter((id) => fixados.includes(id)), ...lista.filter((id) => !fixados.includes(id))];
  const vistos = new Set();
  return lista.filter((id) => {
    const bloco = resolverBloco(id);
    if (!bloco || vistos.has(bloco.pagina) || !usuarioTemAcesso(usuario, bloco.pagina)) return false;
    vistos.add(bloco.pagina);
    return true;
  });
}

export function paginaNaArea(lista, chavePagina) {
  return lista.some((id) => resolverBloco(id)?.pagina === chavePagina);
}

// Inclui sempre no FIM da fila; nunca substitui nenhum bloco existente.
export function incluirPaginaNaArea(lista, chavePagina) {
  if (paginaNaArea(lista, chavePagina)) return lista;
  const rico = Object.keys(BLOCOS).find((id) => BLOCOS[id].pagina === chavePagina);
  return [...lista, rico || chavePagina];
}

export function removerPaginaDaArea(lista, chavePagina) {
  return lista.filter((id) => resolverBloco(id)?.pagina !== chavePagina);
}
