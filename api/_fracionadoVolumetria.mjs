// Volumetria do portal de frete fracionado (notas, volumes, peso e cubagem por origem, destino e faixa de peso).
// Gerada UMA vez pelo time interno (tela Portal de tabelas — fracionado) e gravada pronta em fracionado_volumetria;
// o transportador so baixa o resultado no portal (uma chamada leve), sem varrer a base de CT-es.
// Usado no navegador (gestao) e no servidor (portal): so depende do cliente supabase recebido.

export const MESES_VOLUMETRIA = { B2C: 1, ATACADO: 3 };
const COLUNAS_CTE_VOLUMETRIA = 'data_emissao,canal,cidade_origem,uf_origem,ibge_origem,cidade_destino,uf_destino,ibge_destino,peso,peso_declarado,peso_cubado,cubagem,valor_nf,qtd_volumes';
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

export function periodoVolumetria(canal, agora = Date.now()) {
  const n = MESES_VOLUMETRIA[canal] || 1;
  const hoje = new Date(agora - 3 * 60 * 60 * 1000); // horario de Brasilia
  const ano = hoje.getUTCFullYear();
  const mes = hoje.getUTCMonth();
  const iso = (d) => d.toISOString().slice(0, 10);
  return { inicio: iso(new Date(Date.UTC(ano, mes - n, 1))), fim: iso(new Date(Date.UTC(ano, mes, 0))), meses: n };
}

const semAcento = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

// Mesma regra de canal da base de CT-es (realizadoLocalDb.normalizeCanalParaMalha)
export function canalDaBase(v) {
  const c = semAcento(v);
  if (!c) return '';
  if (c.includes('A DEFINIR') || c.includes('SEM TABELA') || c.includes('SEM VINCULO')) return 'A DEFINIR';
  if (c.includes('INTERCOMPANY')) return 'INTERCOMPANY';
  if (c.includes('REVERSA')) return 'REVERSA';
  if (['ATACADO', 'B2B'].some((i) => c === i || c.includes(i))) return 'ATACADO';
  if (['B2C', 'VIA VAREJO', 'MERCADO LIVRE', 'MERCADOR LIVRE', 'B2W', 'MAGAZINE LUIZA', 'CARREFOUR', 'CANTU PNEUS', 'GPA', 'COLOMBO', 'AMAZON', 'INTER', 'ANYMARKET', 'ANY MARKET', 'BRADESCO SHOP', 'ITAU SHOP', 'SHOPEE', '99', 'MUSTANG', 'LIVELO', 'COOPERA', 'MARKETPLACE', 'MARKET PLACE', 'ECOMMERCE', 'E COMMERCE']
    .some((i) => c === i || c.includes(i))) return 'B2C';
  return c;
}

// "Itajai/SC" -> { cidade: 'ITAJAI', uf: 'SC' }
export function parseOrigemVolumetria(texto) {
  const t = String(texto || '').trim();
  const m = t.match(/^(.*?)\s*[/\-,]\s*([A-Za-z]{2})$/);
  if (m && UFS.includes(m[2].toUpperCase())) return { cidade: semAcento(m[1]), uf: m[2].toUpperCase() };
  return { cidade: semAcento(t), uf: '' };
}

function faixaDoPeso(faixas, peso) {
  let achada = null;
  for (const f of faixas) { if (peso >= f.min && (f.max == null || peso < f.max)) achada = f; }
  return achada ? achada.label : (faixas.length ? faixas[faixas.length - 1].label : '');
}

// Base do cache: mesma origem + canal + faixas serve para qualquer convite (o periodo fica em colunas proprias).
export function baseVolumetria({ canal, origem, faixas }) {
  const fx = (faixas || []).map((f) => `${f.min}-${f.max ?? ''}`).join(',');
  return [canal, semAcento(origem) || 'TODAS', fx].join('|');
}

// Linhas: [origem, uf_origem, ibge_origem, destino, uf_destino, ibge_destino, faixa, notas, volumes,
//          peso_real, peso_declarado, peso_cubado, peso_considerado, cubagem_total, valor_nf]
async function volumetriaDoDia(supabase, { canal, dia, origem, faixas }) {
  const proximo = new Date(Date.parse(`${dia}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const mk = () => {
    let q = supabase.from('realizado_local_ctes').select(COLUNAS_CTE_VOLUMETRIA).gte('data_emissao', dia).lt('data_emissao', proximo);
    if (origem?.uf) q = q.eq('uf_origem', origem.uf);
    return q.order('data_emissao', { ascending: true }).order('id', { ascending: true });
  };
  const mapa = new Map();
  let lidas = 0;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  for (let pag = 0; pag < 200; pag += 4) {
    const respostas = await Promise.all([0, 1, 2, 3].map((i) => mk().range((pag + i) * 1000, (pag + i) * 1000 + 999)));
    let acabou = false;
    for (const r of respostas) {
      if (r.error) throw r.error;
      const dados = r.data || [];
      lidas += dados.length;
      if (dados.length < 1000) acabou = true;
      for (const row of dados) {
        if (canalDaBase(row.canal) !== canal) continue;
        const cidO = semAcento(row.cidade_origem);
        const ufO = String(row.uf_origem || '').toUpperCase();
        if (origem && origem.cidade && !(cidO === origem.cidade || cidO.includes(origem.cidade))) continue;
        const peso = Math.max(num(row.peso), num(row.peso_declarado), num(row.peso_cubado));
        const faixa = faixaDoPeso(faixas, peso);
        const ibgeO = String(row.ibge_origem || '').replace(/\D/g, '').slice(0, 7);
        const ibgeD = String(row.ibge_destino || '').replace(/\D/g, '').slice(0, 7);
        const chave = [row.cidade_origem, ufO, ibgeO, row.cidade_destino, row.uf_destino, ibgeD, faixa].join('|');
        let it = mapa.get(chave);
        if (!it) {
          it = [String(row.cidade_origem || ''), ufO, ibgeO, String(row.cidade_destino || ''), String(row.uf_destino || '').toUpperCase(), ibgeD, faixa, 0, 0, 0, 0, 0, 0, 0, 0];
          mapa.set(chave, it);
        }
        const vol = num(row.qtd_volumes);
        it[7] += 1;
        it[8] += vol;
        it[9] += num(row.peso);
        it[10] += num(row.peso_declarado);
        it[11] += num(row.peso_cubado);
        it[12] += peso;
        it[13] += num(row.cubagem) * (vol > 0 ? vol : 1);
        it[14] += num(row.valor_nf);
      }
    }
    if (acabou) break;
  }
  return { linhas: [...mapa.values()], lidas };
}

// Gera a volumetria de UMA origem/canal no periodo (dia a dia, 4 dias em paralelo, 3 tentativas por dia).
export async function gerarVolumetria(supabase, { canal, origem, faixas, periodo = periodoVolumetria(canal), onProgresso }) {
  const dias = [];
  for (let d = new Date(`${periodo.inicio}T00:00:00Z`); d.toISOString().slice(0, 10) <= periodo.fim; d = new Date(d.getTime() + 86400000)) dias.push(d.toISOString().slice(0, 10));
  const alvo = origem ? parseOrigemVolumetria(origem) : null;
  const agg = new Map();
  let feitos = 0;
  let lidas = 0;
  const fila = dias.slice();
  const worker = async () => {
    while (fila.length) {
      const dia = fila.shift();
      let res = null;
      for (let t = 0; t < 3 && !res; t += 1) {
        try { res = await volumetriaDoDia(supabase, { canal, dia, origem: alvo, faixas }); } catch (e) { if (t === 2) throw new Error(`Dia ${dia}: ${e.message || e}`); }
      }
      lidas += res.lidas;
      res.linhas.forEach((r) => {
        const k = r.slice(0, 7).join('|');
        const a = agg.get(k);
        if (!a) agg.set(k, r.slice()); else for (let q = 7; q < 15; q += 1) a[q] += r[q];
      });
      feitos += 1;
      if (onProgresso) onProgresso({ feitos, total: dias.length, lidas });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const linhas = [...agg.values()].map((it) => it.map((v, i) => (i >= 9 ? r3(v) : v)))
    .sort((a, b) => (a[4] + a[3]).localeCompare(b[4] + b[3]) || String(a[6]).localeCompare(String(b[6])));
  return { linhas, notas: linhas.reduce((s, r) => s + r[7], 0), lidas, periodo };
}
