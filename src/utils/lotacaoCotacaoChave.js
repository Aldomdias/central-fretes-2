// Chave de rota da cotacao de lotacao: cidade|cidade|CARRETA, sem acento e sem sufixo /UF.
// Azurra opera como Itajai: o volume soma na mesma origem.
// Veiculo padronizado: tudo e CARRETA (bau, sider, etc.); rodotrem/bitrem e container ficam de fora.
export const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

export const VEICULO_PADRAO = 'CARRETA';
export const veiculoExcluido = (t) => /RODOTREM|BITREM|CONTAINER|CNTR/.test(norm(t));

export function splitCidade(v) {
  const t = String(v || '').trim();
  const m = t.match(/^(.*?)\s*\/\s*([A-Za-z]{2})$/);
  const r = m ? { cidade: m[1].trim(), uf: m[2].toUpperCase() } : { cidade: t, uf: '' };
  if (norm(r.cidade).startsWith('AZURRA')) return { cidade: 'ITAJAÍ', uf: 'SC' };
  return r;
}

export const mesmaCidade = (o, d) => norm(splitCidade(o).cidade) === norm(splitCidade(d).cidade);
// o terceiro argumento (veiculo) e ignorado: todas as rotas sao CARRETA
export const chaveRota = (o, d) => `${norm(splitCidade(o).cidade)}|${norm(splitCidade(d).cidade)}|${VEICULO_PADRAO}`;
export const chavePar = (o, d) => `${norm(splitCidade(o).cidade)}|${norm(splitCidade(d).cidade)}`;
