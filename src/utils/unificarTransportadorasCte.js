// Unifica os nomes de transportadora vindos do CT-e (razão social, nome fantasia,
// filiais: "LTSL BAHIA ENCOMENDAS URGENTES LTDA" x "LTSL ENCOMENDAS", "LC" x
// "LC ENCOMENDAS") numa única identidade, para a análise não mostrar duas visões
// da mesma empresa.
//
// Regras, em ordem:
//  1. Raiz do CNPJ do emitente (campo próprio ou posições 7-20 da chave do CT-e)
//     batendo com uma raiz cadastrada na tabela (transportadora, origens ou CNPJs
//     adicionais) => nome oficial da tabela. É o mesmo critério do motor de auditoria.
//  2. Nomes do CT-e que compartilham a mesma raiz de CNPJ viram um grupo só.
//  3. Nomes que o vínculo de transportadora resolve para o mesmo nome também.
// O rótulo do grupo é o nome do cadastro (o com mais CT-es, se houver mais de um);
// sem cadastro, o nome (já vinculado) mais frequente.

function normChave(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function digitos(v) { return String(v || '').replace(/\D/g, ''); }

export function raizCnpjDoCte(cte = {}) {
  const direto = digitos(cte.cnpj_transportadora || cte.cnpjTransportadora || cte.cnpj_transportador || cte.cnpj_emitente);
  if (direto.length >= 8) return direto.slice(0, 8);
  const chave = digitos(cte.chave_cte || cte.chaveCte || cte.chave);
  return chave.length === 44 ? chave.slice(6, 14) : '';
}

export function nomeBrutoCte(cte = {}) {
  return String(cte.transportadora || cte.nome_transportadora || '').trim();
}

/**
 * @param ctes      CT-es do realizado
 * @param opcoes.aplicarVinculo  (nome) => nome vinculado
 * @param opcoes.cadastro        [{ nome, raizes: ['12345678', ...] }]
 * @returns { nomeDoCte(cte) => nome unificado, grupos: [{ nome, variantes, nomesTabela, raizes, ctes }] }
 */
export function unificarTransportadorasCtes(ctes = [], { aplicarVinculo = (n) => n, cadastro = [] } = {}) {
  const cadastroPorRaiz = new Map();
  const cadastroPorNome = new Map();
  for (const t of cadastro || []) {
    if (!t?.nome) continue;
    cadastroPorNome.set(normChave(t.nome), t.nome);
    for (const r of t.raizes || []) {
      const raiz = digitos(r).slice(0, 8);
      if (raiz.length !== 8) continue;
      if (!cadastroPorRaiz.has(raiz)) cadastroPorRaiz.set(raiz, new Set());
      cadastroPorRaiz.get(raiz).add(t.nome);
    }
  }

  // union-find sobre chaves "N:<nome>" e "R:<raiz>"
  const pai = new Map();
  const achar = (k) => {
    if (!pai.has(k)) pai.set(k, k);
    let r = k;
    while (pai.get(r) !== r) r = pai.get(r);
    let x = k;
    while (pai.get(x) !== r) { const p = pai.get(x); pai.set(x, r); x = p; }
    return r;
  };
  const unir = (a, b) => { const ra = achar(a); const rb = achar(b); if (ra !== rb) pai.set(rb, ra); };

  const vinculoCache = new Map();
  const infoCte = [];
  for (const cte of ctes || []) {
    const bruto = nomeBrutoCte(cte);
    if (!bruto) { infoCte.push(null); continue; }
    let vinculado = vinculoCache.get(bruto);
    if (vinculado === undefined) { vinculado = String(aplicarVinculo(bruto) || bruto).trim(); vinculoCache.set(bruto, vinculado); }
    const raiz = raizCnpjDoCte(cte);
    const kNome = `N:${normChave(vinculado)}`;
    achar(kNome);
    // nome bruto e nome vinculado são a mesma empresa
    unir(kNome, `N:${normChave(bruto)}`);
    if (raiz) unir(kNome, `R:${raiz}`);
    // raízes que apontam para o mesmo nome do cadastro também se juntam
    for (const nomeTab of cadastroPorRaiz.get(raiz) || []) unir(kNome, `N:${normChave(nomeTab)}`);
    // Linhas agregadas (ex.: resumo por transportadora/CNPJ vindo do banco)
    // informam quantos CT-es representam em `__qtdCtes`; CT-e avulso vale 1.
    const peso = Number(cte.__qtdCtes) > 0 ? Number(cte.__qtdCtes) : 1;
    infoCte.push({ bruto, vinculado, raiz, kNome, peso });
  }

  const grupos = new Map(); // raiz union-find -> grupo
  infoCte.forEach((info) => {
    if (!info) return;
    const k = achar(info.kNome);
    if (!grupos.has(k)) grupos.set(k, { variantes: new Map(), vinculados: new Map(), tabela: new Map(), raizes: new Set(), ctes: 0 });
    const g = grupos.get(k);
    const w = info.peso;
    g.ctes += w;
    g.variantes.set(info.bruto, (g.variantes.get(info.bruto) || 0) + w);
    g.vinculados.set(info.vinculado, (g.vinculados.get(info.vinculado) || 0) + w);
    if (info.raiz) g.raizes.add(info.raiz);
    const nomesTab = new Set(cadastroPorRaiz.get(info.raiz) || []);
    const oficialPorNome = cadastroPorNome.get(normChave(info.vinculado));
    if (oficialPorNome) nomesTab.add(oficialPorNome);
    for (const n of nomesTab) g.tabela.set(n, (g.tabela.get(n) || 0) + w);
  });

  const maisFrequente = (mapa) => [...mapa.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'pt-BR'))[0]?.[0] || '';
  const nomePorGrupo = new Map();
  const lista = [];
  for (const [k, g] of grupos) {
    const nome = g.tabela.size ? maisFrequente(g.tabela) : maisFrequente(g.vinculados);
    nomePorGrupo.set(k, nome);
    lista.push({
      nome,
      variantes: [...g.variantes.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      nomesTabela: [...g.tabela.keys()],
      raizes: [...g.raizes],
      ctes: g.ctes,
    });
  }
  // Dois grupos diferentes podem acabar com o mesmo rótulo (ex.: sem raiz): funde.
  const porNome = new Map();
  for (const g of lista) {
    const key = normChave(g.nome);
    const atual = porNome.get(key);
    if (!atual) { porNome.set(key, { ...g }); continue; }
    atual.variantes = [...new Set([...atual.variantes, ...g.variantes])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    atual.nomesTabela = [...new Set([...atual.nomesTabela, ...g.nomesTabela])];
    atual.raizes = [...new Set([...atual.raizes, ...g.raizes])];
    atual.ctes += g.ctes;
  }

  const nomePorCte = new WeakMap();
  (ctes || []).forEach((cte, i) => {
    const info = infoCte[i];
    if (info && cte && typeof cte === 'object') nomePorCte.set(cte, nomePorGrupo.get(achar(info.kNome)));
  });

  return {
    nomeDoCte: (cte) => nomePorCte.get(cte) || nomeBrutoCte(cte),
    grupos: [...porNome.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  };
}
