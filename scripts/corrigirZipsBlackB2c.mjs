import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { unzipSync, zipSync } from 'fflate';
import { montarXlsxVerum } from '../src/utils/verumXlsx.js';

const raiz = process.cwd();
const env = { ...loadEnv('development', raiz, ''), ...process.env };
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Supabase não configurado no ambiente local.');
const supabase = createClient(url, key, { auth: { persistSession: false } });

const entradas = process.argv.slice(2);
if (!entradas.length) throw new Error('Informe ao menos um ZIP gerado.');

function norm(v) { return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().toUpperCase(); }
function dig(v, n = 7) { return String(v || '').replace(/\D/g, '').slice(0, n); }
function slug(v) { return norm(v).toLowerCase().replace(/\s+/g, '-'); }
function bufferU8(buf) { return buf instanceof Uint8Array ? buf : new Uint8Array(buf); }
function canalAtendeB2c(v) {
  const c = norm(v);
  if (!c) return true;
  if (c.includes('AMBOS')) return true;
  if (c.includes('ATACADO') || c === 'B2B') return false;
  return ['B2C', 'VAREJO', 'MARKETPLACE', 'MARKET PLACE', 'ECOMMERCE', 'E COMMERCE'].some((x) => c.includes(x));
}

async function buscarPaginado(tabela, filtro, select = '*') {
  const saida = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(tabela).select(select).range(from, from + 999);
    q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    saida.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return saida;
}

async function mapaMesorregiao() {
  const res = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome');
  if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`);
  const lista = await res.json();
  return new Map(lista.map((m) => [dig(m.id), m?.microrregiao?.mesorregiao?.nome || `${m?.microrregiao?.mesorregiao?.UF?.sigla || ''} SEM MESORREGIAO`]));
}

function lerLinhasXlsx(bytes) {
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { range: 3, defval: '' });
}

function chaveCobertura(linha) {
  const cep8 = (v) => { const d = String(v || '').replace(/\D/g, ''); return d ? d.padStart(8, '0').slice(-8) : ''; };
  return [
    String(linha['Código da unidade'] || ''), dig(linha['Código IBGE Origem']), dig(linha['Código IBGE Destino']),
    cep8(linha['CEP inicial']), cep8(linha['CEP final']), Number(linha['Prazo de entrega'] || 0),
    String(linha['Método de envio'] || ''),
  ].join('|');
}

function arquivosFrete(zip) {
  return Object.entries(zip).filter(([nome]) => /-fretes-verum\.xlsx$/i.test(nome));
}

async function corrigir(zipPath, mesoPorIbge) {
  const nomeZip = path.basename(zipPath);
  const cdSlug = nomeZip.match(/verum-(.+?)-\d{4}-\d{2}-\d{2}\.zip$/i)?.[1];
  if (!cdSlug) throw new Error(`Não identifiquei o CD no nome ${nomeZip}`);
  const cdCidade = norm(cdSlug.replace(/-/g, ' '));
  const zip = unzipSync(bufferU8(await fs.readFile(zipPath)));
  const precosPorTransportadora = new Map();

  for (const [, bytes] of arquivosFrete(zip)) {
    const linhas = lerLinhasXlsx(bytes);
    const transportadora = String(linhas[0]?.['Nome da transportadora'] || '').trim();
    if (!transportadora) continue;
    const porDestino = new Map();
    for (const linha of linhas) {
      const ibge = dig(String(linha['Rota do frete'] || '').match(/(\d{7})\s*$/)?.[1]);
      if (!ibge) continue;
      const lista = porDestino.get(ibge) || [];
      lista.push({
        faixaMin: Number(linha['Peso mínimo'] || 0), faixaMax: Number(linha['Peso limite'] || 0),
        preco: Number(linha['Taxa aplicada'] || 0),
      });
      porDestino.set(ibge, lista);
    }
    for (const lista of porDestino.values()) lista.sort((a, b) => a.faixaMin - b.faixaMin);
    precosPorTransportadora.set(transportadora, porDestino);
  }

  const nomes = [...precosPorTransportadora.keys()];
  const transportadoras = await buscarPaginado('transportadoras', (q) => q.in('nome', nomes));
  const idPorNome = new Map(transportadoras.map((t) => [t.nome, t.id]));
  const idsTransp = [...idPorNome.values()];
  const origens = await buscarPaginado('origens', (q) => q.in('transportadora_id', idsTransp));
  const origensCd = origens.filter((o) => norm(o.cidade).includes(cdCidade) && !['INATIVA', 'INATIVO'].includes(norm(o.status)));
  const origemPorId = new Map(origensCd.map((o) => [String(o.id), o]));
  const idsOrigens = [...origemPorId.keys()];
  const rotas = [];
  for (let i = 0; i < idsOrigens.length; i += 100) {
    const lote = idsOrigens.slice(i, i + 100);
    rotas.push(...await buscarPaginado('rotas', (q) => q.in('origem_id', lote), 'origem_id,ibge_origem,ibge_destino,canal,prazo_entrega_dias,codigo_unidade,cep_inicial,cep_final,metodo_envio'));
  }

  const saida = {};
  for (const [transportadora, porDestino] of precosPorTransportadora) {
    const transpId = String(idPorNome.get(transportadora) || '');
    const idsDaTransp = new Set(origensCd.filter((o) => String(o.transportadora_id) === transpId).map((o) => String(o.id)));
    const rotasDaTransp = rotas.filter((r) => idsDaTransp.has(String(r.origem_id)));
    const rotasB2c = rotasDaTransp.filter((r) => canalAtendeB2c(r.canal || origemPorId.get(String(r.origem_id))?.canal));
    const espelho = rotasB2c.length ? rotasB2c : rotasDaTransp;
    const grupos = new Map();
    const rotasNovas = [];
    const vistas = new Set();
    for (const rota of espelho) {
      const destino = dig(rota.ibge_destino);
      const precos = porDestino.get(destino);
      if (!precos?.length) continue;
      const unidade = rota.codigo_unidade || '0001 - B2C';
      const meso = mesoPorIbge.get(destino) || 'SEM MESORREGIAO';
      const assinatura = JSON.stringify([unidade, meso, precos.map((p) => [p.faixaMin, p.faixaMax, p.preco.toFixed(2)])]);
      let grupo = grupos.get(assinatura);
      if (!grupo) {
        const n = String(grupos.size + 1).padStart(4, '0');
        const mesoNome = norm(meso).slice(0, 28);
        grupo = { nome: `BLACK ${cdCidade} ${mesoNome} ${n}`, unidade, precos };
        grupos.set(assinatura, grupo);
      }
      const item = {
        'Código da unidade': unidade, Cotação: grupo.nome,
        'Código IBGE Origem': dig(rota.ibge_origem), 'Código IBGE Destino': destino,
        'CEP inicial': dig(rota.cep_inicial, 8), 'CEP final': dig(rota.cep_final, 8),
        'Método de envio': rota.metodo_envio || 'Normal', 'Prazo de entrega': Number(rota.prazo_entrega_dias || 0) || '',
        'Início da vigência': '', 'Término da vigência': '',
      };
      const chave = Object.values(item).join('|');
      if (!vistas.has(chave)) { vistas.add(chave); rotasNovas.push(item); }
    }
    if (!rotasNovas.length) {
      console.log(`${transportadora}: diagnóstico — ${idsDaTransp.size} origens no CD, ${rotasDaTransp.length} rotas carregadas, ${espelho.length} rotas B2C/compartilhadas, ${porDestino.size} destinos com preço.`);
      console.log(`${transportadora}: canais encontrados: ${[...new Set(rotasDaTransp.map((r) => String(r.canal || origemPorId.get(String(r.origem_id))?.canal || '(vazio)')))].join(', ')}`);
      throw new Error(`${transportadora}: nenhuma rota atual associada.`);
    }
    const fretes = [];
    for (const grupo of grupos.values()) for (const p of grupo.precos) fretes.push({
      'Nome da transportadora': transportadora, 'Código da unidade': grupo.unidade, 'Regra de cálculo': 'Sem regra',
      'Rota do frete': grupo.nome, 'Peso mínimo': p.faixaMin, 'Peso limite': p.faixaMax,
      'Excesso de peso': p.faixaMax >= 999998 ? Number((p.preco / 100).toFixed(4)) : 0,
      'Taxa aplicada': p.preco, 'Frete percentual': 0, 'Frete mínimo': 0,
      'Início da vigência': '', 'Fim da vigência': '',
    });
    const base = `tabela-black-b2c-${slug(cdCidade)}-${slug(transportadora)}`;
    const fretesBytes = montarXlsxVerum('cotacoes', fretes);
    const rotasBytes = montarXlsxVerum('rotas', rotasNovas);
    const rotasReabertas = lerLinhasXlsx(rotasBytes);
    const esperadas = new Set(rotasNovas.map(chaveCobertura));
    const gravadas = new Set(rotasReabertas.map(chaveCobertura));
    if (esperadas.size !== gravadas.size || [...esperadas].some((k) => !gravadas.has(k))) {
      console.log('Exemplo esperado não gravado:', [...esperadas].find((k) => !gravadas.has(k)));
      console.log('Exemplo gravado não esperado:', [...gravadas].find((k) => !esperadas.has(k)));
      throw new Error(`${transportadora}: a validação do espelho de CEP/prazo falhou (${esperadas.size} esperadas, ${gravadas.size} gravadas).`);
    }
    const nomesFrete = new Set(fretes.map((f) => f['Rota do frete']));
    if (rotasReabertas.some((r) => !nomesFrete.has(r.Cotação))) throw new Error(`${transportadora}: existe rota sem tarifa correspondente.`);
    saida[`${base}-fretes-verum.xlsx`] = fretesBytes;
    saida[`${base}-rotas-verum.xlsx`] = rotasBytes;
    const comCep = rotasNovas.filter((r) => r['CEP inicial'] || r['CEP final']).length;
    console.log(`${cdCidade} | ${transportadora}: ${fretes.length} fretes, ${rotasNovas.length} rotas (${comCep} com CEP), ${grupos.size} regiões tarifárias — espelho validado`);
  }
  const destino = path.join(path.dirname(zipPath), nomeZip.replace(/\.zip$/i, '-corrigido.zip'));
  await fs.writeFile(destino, zipSync(saida, { level: 6 }));
  return destino;
}

const meso = await mapaMesorregiao();
for (const entrada of entradas) console.log(`GERADO: ${await corrigir(path.resolve(entrada), meso)}`);
