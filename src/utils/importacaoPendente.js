// Repasse de arquivos escolhidos no painel de importacoes do Dashboard para a tela
// que ja sabe importar aquele tipo. O Dashboard guarda os arquivos aqui e troca de
// pagina; a tela de destino, ao montar (e com os dados dela prontos), consome o
// pendente e roda a MESMA rotina do botao dela. Assim a regra de importacao continua
// num lugar so. Fica so em memoria: recarregou a pagina, o pendente some.

const VALIDADE_MS = 10 * 60 * 1000;
let pendente = null;

export function agendarImportacao(tipo, arquivos = []) {
  const lista = Array.from(arquivos || []);
  pendente = lista.length ? { tipo, arquivos: lista, em: Date.now() } : null;
}

export function temImportacaoPendente(tipo) {
  return Boolean(pendente && pendente.tipo === tipo && Date.now() - pendente.em < VALIDADE_MS);
}

// Devolve os arquivos (uma vez so) se o pendente for deste tipo.
export function consumirImportacao(tipo) {
  if (!temImportacaoPendente(tipo)) return null;
  const { arquivos } = pendente;
  pendente = null;
  return arquivos;
}
