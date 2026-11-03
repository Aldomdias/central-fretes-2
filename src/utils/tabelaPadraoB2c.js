// Tabela Padrão B2C: por CD de origem x destino x faixa de peso, descobre quem ganha
// (menor preço simulado entre todas as tabelas) e mantém 2º e 3º colocados.
// O preço padrão é a média ponderada dos valores CALCULADOS (tabela) dos 4 primeiros
// (ex.: 60% do 1º, 20% do 2º, 10% do 3º, 10% do 4º). O realizado entra só como volumetria
// (quantidade de CT-es, peso) e para comparar custo pago x custo com a tabela padrão.
// Do 2º colocado em diante, soma-se um acréscimo fixo ao preço padrão, só para o sistema
// conseguir ordenar na hora de escolher.
//
// Aqui fica só a lógica pura. A carga de dados e o motor de frete ficam na página.

// Centros com e-commerce ativo, agrupados por cidade (um CD pode ter mais de um código de centro).
export const CDS_B2C = [
  { chave: 'ANANINDEUA', label: 'Ananindeua', cidades: ['ANANINDEUA'], uf: 'PA', codigos: ['X173'] },
  { chave: 'ARACAJU', label: 'Aracaju', cidades: ['ARACAJU'], uf: 'SE', codigos: ['4257'] },
  { chave: 'BALSAS', label: 'Balsas', cidades: ['BALSAS'], uf: 'MA', codigos: ['4261'] },
  { chave: 'BARRA MANSA', label: 'Barra Mansa', cidades: ['BARRA MANSA'], uf: 'RJ', codigos: ['4267'] },
  { chave: 'BAURU', label: 'Bauru', cidades: ['BAURU'], uf: 'SP', codigos: ['4231'] },
  { chave: 'BRASILIA', label: 'Brasília', cidades: ['BRASILIA'], uf: 'DF', codigos: ['4214', 'X201'] },
  { chave: 'CAMPO GRANDE', label: 'Campo Grande', cidades: ['CAMPO GRANDE'], uf: 'MS', codigos: ['4217'] },
  { chave: 'CAMPOS DOS GOYTACAZES', label: 'Campos dos Goytacazes', cidades: ['CAMPOS DOS GOYTACAZES'], uf: 'RJ', codigos: ['4269'] },
  { chave: 'CASCAVEL', label: 'Cascavel', cidades: ['CASCAVEL'], uf: 'PR', codigos: ['4242'] },
  { chave: 'CAXIAS DO SUL', label: 'Caxias do Sul', cidades: ['CAXIAS DO SUL'], uf: 'RS', codigos: ['4270'] },
  { chave: 'CHAPECO', label: 'Chapecó', cidades: ['CHAPECO'], uf: 'SC', codigos: ['4203'] },
  { chave: 'CONTAGEM', label: 'Contagem', cidades: ['CONTAGEM'], uf: 'MG', codigos: ['4206', 'X202'] },
  { chave: 'CUIABA', label: 'Cuiabá', cidades: ['CUIABA'], uf: 'MT', codigos: ['X169'] },
  { chave: 'CURITIBA', label: 'Curitiba', cidades: ['CURITIBA'], uf: 'PR', codigos: ['4205'] },
  { chave: 'DAVINOPOLIS', label: 'Davinópolis', cidades: ['DAVINOPOLIS'], uf: 'MA', codigos: ['4235'] },
  { chave: 'DUQUE DE CAXIAS', label: 'Duque de Caxias', cidades: ['DUQUE DE CAXIAS'], uf: 'RJ', codigos: ['4211'] },
  { chave: 'FEIRA DE SANTANA', label: 'Feira de Santana', cidades: ['FEIRA DE SANTANA'], uf: 'BA', codigos: ['4241'] },
  { chave: 'GOIANIA', label: 'Goiânia', cidades: ['GOIANIA'], uf: 'GO', codigos: ['4213', 'X200'] },
  { chave: 'GRAVATAI', label: 'Gravataí', cidades: ['GRAVATAI'], uf: 'RS', codigos: ['4202'] },
  { chave: 'ITAJAI', label: 'Itajaí', cidades: ['ITAJAI'], uf: 'SC', codigos: ['4201', '4252', 'X195'] },
  { chave: 'ITUPEVA', label: 'Itupeva', cidades: ['ITUPEVA'], uf: 'SP', codigos: ['4207'] },
  { chave: 'JABOATAO', label: 'Jaboatão', cidades: ['JABOATAO DOS GUARARAPES', 'JABOATAO'], uf: 'PE', codigos: ['4204', '4219'] },
  { chave: 'JACAREI', label: 'Jacareí', cidades: ['JACAREI'], uf: 'SP', codigos: ['4246'] },
  { chave: 'JUIZ DE FORA', label: 'Juiz de Fora', cidades: ['JUIZ DE FORA'], uf: 'MG', codigos: ['4281'] },
  { chave: 'LONDRINA', label: 'Londrina', cidades: ['LONDRINA'], uf: 'PR', codigos: ['4233'] },
  { chave: 'LUIS EDUARDO MAGALHAES', label: 'Luís Eduardo Magalhães', cidades: ['LUIS EDUARDO MAGALHAES'], uf: 'BA', codigos: ['4236'] },
  { chave: 'MACEIO', label: 'Maceió', cidades: ['MACEIO'], uf: 'AL', codigos: ['4274'] },
  { chave: 'MONTES CLAROS', label: 'Montes Claros', cidades: ['MONTES CLAROS'], uf: 'MG', codigos: ['4283'] },
  { chave: 'PALMAS', label: 'Palmas', cidades: ['PALMAS'], uf: 'TO', codigos: ['4224', 'X108'] },
  { chave: 'PELOTAS', label: 'Pelotas', cidades: ['PELOTAS'], uf: 'RS', codigos: ['4271'] },
  { chave: 'PETROLINA', label: 'Petrolina', cidades: ['PETROLINA'], uf: 'PE', codigos: ['4251'] },
  { chave: 'POUSO ALEGRE', label: 'Pouso Alegre', cidades: ['POUSO ALEGRE'], uf: 'MG', codigos: ['4275'] },
  { chave: 'PRESIDENTE PRUDENTE', label: 'Presidente Prudente', cidades: ['PRESIDENTE PRUDENTE'], uf: 'SP', codigos: ['4226'] },
  { chave: 'RECIFE', label: 'Recife', cidades: ['RECIFE'], uf: 'PE', codigos: ['X102'] },
  { chave: 'RIBEIRAO PRETO', label: 'Ribeirão Preto', cidades: ['RIBEIRAO PRETO'], uf: 'SP', codigos: ['4221'] },
  { chave: 'RIO DE JANEIRO', label: 'Rio de Janeiro', cidades: ['RIO DE JANEIRO'], uf: 'RJ', codigos: ['4264'] },
  { chave: 'RIO VERDE', label: 'Rio Verde', cidades: ['RIO VERDE'], uf: 'GO', codigos: ['4244'] },
  { chave: 'RONDONOPOLIS', label: 'Rondonópolis', cidades: ['RONDONOPOLIS'], uf: 'MT', codigos: ['4247'] },
  { chave: 'SALVADOR', label: 'Salvador', cidades: ['SALVADOR'], uf: 'BA', codigos: ['4216'] },
  { chave: 'SANTA MARIA', label: 'Santa Maria', cidades: ['SANTA MARIA'], uf: 'RS', codigos: ['4250'] },
  { chave: 'SAO JOSE DO RIO PRETO', label: 'São José do Rio Preto', cidades: ['SAO JOSE DO RIO PRETO'], uf: 'SP', codigos: ['4229'] },
  { chave: 'SAO JOSE DOS PINHAIS', label: 'São José dos Pinhais', cidades: ['SAO JOSE DOS PINHAIS', 'SJ DOS PINHAIS'], uf: 'PR', codigos: ['X205'] },
  { chave: 'SAO LUIS', label: 'São Luís', cidades: ['SAO LUIS'], uf: 'MA', codigos: ['4212'] },
  { chave: 'SERRA', label: 'Serra', cidades: ['SERRA'], uf: 'ES', codigos: ['4210', '4222'] },
  { chave: 'SINOP', label: 'Sinop', cidades: ['SINOP'], uf: 'MT', codigos: ['4227'] },
  { chave: 'TERESINA', label: 'Teresina', cidades: ['TERESINA'], uf: 'PI', codigos: ['X206'] },
  { chave: 'TUBARAO', label: 'Tubarão', cidades: ['TUBARAO'], uf: 'SC', codigos: ['4259'] },
  { chave: 'UBERLANDIA', label: 'Uberlândia', cidades: ['UBERLANDIA'], uf: 'MG', codigos: ['4280'] },
  { chave: 'VARZEA GRANDE', label: 'Várzea Grande', cidades: ['VARZEA GRANDE'], uf: 'MT', codigos: ['4218'] },
  { chave: 'VITORIA DA CONQUISTA', label: 'Vitória da Conquista', cidades: ['VITORIA DA CONQUISTA'], uf: 'BA', codigos: ['4249'] },
];

export const FAIXAS_PADRAO_TEXTO = '0-2, 2-5, 5-10, 10-20, 20-30, 30-50, 50-100, 100+';

export function normTexto(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

export function cdDaCidade(cidadeOrigem, cdsAtivos = CDS_B2C) {
  const n = normTexto(cidadeOrigem);
  if (!n) return null;
  return cdsAtivos.find((cd) => cd.cidades.some((c) => n === c || n.startsWith(`${c} `))) || null;
}

// "0-2, 2-5, 100+" -> [{min:0,max:2,label:'0 a 2 kg'}, ...]; faixa vale de min (exclusivo) até max (inclusivo),
// exceto a primeira, que inclui o próprio min. Retorna [] se o texto for inválido.
export function parseFaixas(texto) {
  const faixas = [];
  for (const parte of String(texto || '').split(/[;,]/)) {
    const p = parte.trim().replace(/\s+/g, '');
    if (!p) continue;
    const aberta = p.match(/^(\d+(?:[.,]\d+)?)\+$/);
    if (aberta) {
      const min = Number(aberta[1].replace(',', '.'));
      faixas.push({ min, max: Infinity, label: `Acima de ${min} kg` });
      continue;
    }
    const m = p.match(/^(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)$/);
    if (!m) return [];
    const min = Number(m[1].replace(',', '.'));
    const max = Number(m[2].replace(',', '.'));
    if (!(max > min)) return [];
    faixas.push({ min, max, label: `${min} a ${max} kg` });
  }
  faixas.sort((a, b) => a.min - b.min);
  return faixas;
}

export function faixaDoPeso(peso, faixas) {
  const p = Number(peso);
  if (!Number.isFinite(p) || p < 0) return null;
  for (let i = 0; i < faixas.length; i++) {
    const f = faixas[i];
    const dentro = (i === 0 ? p >= f.min : p > f.min) && p <= f.max;
    if (dentro) return f;
  }
  return null;
}

function arred(v) { return Math.round(v * 100) / 100; }

/**
 * ctes: [{ cd, destinoKey, destinoLabel, uf, peso, valorPago, resultados: [{transportadora,total,prazo}] }]
 * opcoes: { faixas, difSegundo, difTerceiro, baseTerceiro: 'realizado'|'simulado', coberturaMin (0-1), amostraMin }
 */
export function montarTabelaPadrao(ctes, opcoes = {}) {
  const {
    faixas = [], difs = [0, 1, 2, 3], passoExtra = 1, maxPos = 10, pesos = [60, 20, 10, 10], base = 'ponderado', coberturaMin = 0.6, amostraMin = 1,
  } = opcoes;
  const baldes = new Map();
  let foraDasFaixas = 0;

  for (const c of ctes) {
    const faixa = faixaDoPeso(c.peso, faixas);
    if (!faixa) { foraDasFaixas += 1; continue; }
    const key = `${c.cd}|${c.destinoKey}|${faixa.min}`;
    let b = baldes.get(key);
    if (!b) {
      b = {
        key, cd: c.cd, destinoKey: c.destinoKey, destinoLabel: c.destinoLabel, uf: c.uf,
        faixa, ctes: 0, n: 0, pagoSoma: 0, porTransp: new Map(),
      };
      baldes.set(key, b);
    }
    if (c.apenasVolume) { b.ctes += 1; b.pagoSoma += Number(c.valorPago) || 0; continue; }
    b.n += 1;
    if (!c.sintetico) { b.ctes += 1; b.pagoSoma += Number(c.valorPago) || 0; }
    for (const r of c.resultados || []) {
      const t = b.porTransp.get(r.transportadora) || { transportadora: r.transportadora, n: 0, soma: 0, prazoSoma: 0, prazoN: 0 };
      t.n += 1; t.soma += r.total;
      if (r.prazo != null && r.prazo > 0) { t.prazoSoma += r.prazo; t.prazoN += 1; }
      b.porTransp.set(r.transportadora, t);
    }
  }

  const linhas = [];
  for (const b of baldes.values()) {
    const todos = [...b.porTransp.values()]
      .map((t) => ({
        transportadora: t.transportadora,
        simulado: t.soma / t.n,
        cobertura: t.n / b.n,
        prazo: t.prazoN ? t.prazoSoma / t.prazoN : null,
      }))
      .sort((x, y) => x.simulado - y.simulado);
    const ranking = todos.filter((t) => t.cobertura >= coberturaMin);
    // Quem atende a rota mas cobre menos que o mínimo fica depois dos qualificados (só entra nos arquivos por transportadora).
    const fora = todos.filter((t) => t.cobertura < coberturaMin);

    const realizado = b.ctes ? b.pagoSoma / b.ctes : null;
    const vencedor = ranking[0] || null;
    // Pesos só dos colocados que existem (se há 2 transportadoras, 60/20 viram 75%/25%).
    const topo = ranking.slice(0, pesos.length);
    const somaPesos = topo.reduce((acc, _, i) => acc + (Number(pesos[i]) || 0), 0);
    const ponderado = somaPesos > 0
      ? topo.reduce((acc, t, i) => acc + t.simulado * (Number(pesos[i]) || 0), 0) / somaPesos
      : (vencedor ? vencedor.simulado : (todos[0] ? todos[0].simulado : 0));
    const precoBase = base === 'realizado' && realizado != null ? realizado : base === 'simulado' && vencedor ? vencedor.simulado : ponderado;
    // Acréscimo por posição; além das posições configuradas, continua somando o passo a cada colocação.
    const acrescimo = (i) => {
      if (i < difs.length) return Number(difs[i]) || 0;
      const ultimo = difs.length - 1;
      return (ultimo >= 0 ? Number(difs[ultimo]) || 0 : 0) + (Number(passoExtra) || 0) * (i - ultimo);
    };
    const podio = ranking.slice(0, Math.max(1, maxPos)).map((t, i) => ({
      posicao: i + 1,
      transportadora: t.transportadora,
      simulado: arred(t.simulado),
      cobertura: t.cobertura,
      prazo: t.prazo,
      peso: i < topo.length ? (Number(pesos[i]) || 0) / (somaPesos || 1) : 0,
      precoTabela: arred(precoBase + acrescimo(i)),
    }));
    const completo = [...ranking, ...fora].map((t, i) => ({
      posicao: i + 1,
      transportadora: t.transportadora,
      simulado: arred(t.simulado),
      cobertura: t.cobertura,
      prazo: t.prazo,
      precoTabela: arred(precoBase + acrescimo(i)),
    }));
    linhas.push({
      key: b.key, estimado: b.ctes === 0, amostraFraca: b.ctes > 0 && b.ctes < amostraMin, completo, cd: b.cd, destinoKey: b.destinoKey, destinoLabel: b.destinoLabel, uf: b.uf,
      faixa: b.faixa, ctes: b.ctes, realizado: realizado == null ? null : arred(realizado), precoBase: arred(precoBase),
      custoRealizado: arred(b.pagoSoma), custoPadrao: arred(precoBase * b.ctes),
      podio, semVencedor: !podio.length,
    });
  }
  linhas.sort((a, b) => a.cd.localeCompare(b.cd) || a.uf.localeCompare(b.uf) || a.destinoLabel.localeCompare(b.destinoLabel) || a.faixa.min - b.faixa.min);
  return { linhas, foraDasFaixas };
}

// Visão por transportadora: cada uma recebe TODAS as linhas (CD x destino x faixa) que atende,
// com o preço da sua posição no ranking daquela rota — não só as em que ficou no pódio.
export function tabelaPorTransportadora(linhas, apenas = null) {
  const saida = [];
  for (const l of linhas) {
    for (const p of l.completo) {
      if (apenas && p.transportadora !== apenas) continue;
      saida.push({
        transportadora: p.transportadora, cd: l.cd, uf: l.uf, destino: l.destinoLabel, destinoKey: l.destinoKey,
        faixa: l.faixa.label, faixaMin: l.faixa.min, faixaMax: l.faixa.max, posicao: p.posicao,
        precoTabela: p.precoTabela, simulado: p.simulado, realizado: l.realizado, ctes: l.ctes, prazo: p.prazo,
        estimado: l.estimado, cobertura: p.cobertura,
      });
    }
  }
  saida.sort((a, b) => a.transportadora.localeCompare(b.transportadora, 'pt-BR') || a.cd.localeCompare(b.cd) || a.uf.localeCompare(b.uf) || a.destino.localeCompare(b.destino) || a.faixaMin - b.faixaMin);
  return saida;
}
