const VERSAO = 1;

export const IDENTIDADES = ['amd', 'cantu'];
export const MODOS_COR = ['claro', 'escuro', 'automatico'];

function chave(usuario) {
  const id = usuario?.id || usuario?.email || 'anonimo';
  return `central_fretes_interface_v${VERSAO}:${String(id).toLowerCase()}`;
}

export function preferenciasPadrao() {
  return { identidade: 'amd', modoCor: 'automatico', modeloArea: null, blocos: [] };
}

export function carregarPreferenciasInterface(usuario) {
  const padrao = preferenciasPadrao();
  try {
    const salvo = JSON.parse(window.localStorage.getItem(chave(usuario)) || 'null');
    if (!salvo || typeof salvo !== 'object') return padrao;
    return {
      ...padrao,
      ...salvo,
      identidade: IDENTIDADES.includes(salvo.identidade) ? salvo.identidade : padrao.identidade,
      modoCor: MODOS_COR.includes(salvo.modoCor) ? salvo.modoCor : padrao.modoCor,
      blocos: Array.isArray(salvo.blocos) ? salvo.blocos : [],
    };
  } catch {
    return padrao;
  }
}

export function salvarPreferenciasInterface(usuario, preferencias) {
  try {
    window.localStorage.setItem(chave(usuario), JSON.stringify(preferencias));
  } catch {
    // A interface continua funcional durante a sessao quando o armazenamento nao esta disponivel.
  }
}

export function aplicarPreferenciasInterface(preferencias) {
  const raiz = document.documentElement;
  raiz.dataset.brand = preferencias.identidade;
  raiz.dataset.theme = preferencias.modoCor;
  raiz.style.colorScheme = preferencias.modoCor === 'automatico' ? 'light dark' : preferencias.modoCor === 'escuro' ? 'dark' : 'light';
}
