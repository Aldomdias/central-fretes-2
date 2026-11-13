// ANTT de lotacao calculada pela REGRA cadastrada em Gestao de tabelas lotacao
// (aba Cotacao): valor = KM x CCD + CC (Tabela B, so o veiculo automotor).
// Nao existe mais tabela ANTT importada: este modulo monta uma tabela "virtual"
// tipo ANTT a partir das rotas que existem nas tabelas de transportadoras, para
// que todas as ferramentas que ja liam a ANTT (comparativos, reajuste, alocacao)
// continuem funcionando sem mudar nada.
//
// Base: as tabelas de lotacao sao LIQUIDAS (sem ICMS) — a auditoria remove o
// ICMS do CT-e antes de comparar. Entao a ANTT aqui sai em liquido:
// - regra base LIQUIDO: usa a formula direto;
// - regra base BRUTO: tira o ICMS da rota (matriz ICMS / legislacao).
import { aliquotaDaRota, liquidoDoBruto } from './lotacaoCotacaoCalculo';
import { chavePar, veiculoExcluido } from './lotacaoCotacaoChave';
import { chaveRota } from './lotacaoTables';

export const ID_TABELA_ANTT_REGRA = 'antt-regra';

const numBr = (v) => {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').trim();
  if (!t) return NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};

const normTipo = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

// 6 eixos: LS / vanderleia / "6 eixos". O resto que e carreta usa 5 eixos.
export function eixosDoTipo(tipo) {
  const t = normTipo(tipo);
  if (/6\s*EIXO|VANDERL|\bLS\b/.test(t)) return 6;
  return 5;
}

// Eixos gravados na rota (portal/gestao) tem prioridade; senao, pelo tipo.
export function eixosDaLinha(linha = {}) {
  const e = Number(linha.eixos);
  if (e === 5 || e === 6) return e;
  return eixosDoTipo(linha.tipo);
}

// A regra so vale para carreta (Tabela B de 5/6 eixos). Truck, toco, 3/4,
// rodotrem/bitrem e container ficam sem ANTT (nao ha regra cadastrada pra eles).
export function tipoTemRegraAntt(tipo) {
  const t = normTipo(tipo);
  if (!t || t === 'GERAL') return true;
  if (veiculoExcluido(t)) return false;
  if (/TRUCK|TOCO|3\/4|TRES QUARTOS|VUC|VAN\b|FIORINO|UTILITARIO/.test(t)) return false;
  return true;
}

export function kmDaLinha(linha, kmRotas = {}) {
  const km = Number(linha?.km);
  if (km > 0) return km;
  const doMapa = Number(kmRotas?.[chavePar(linha?.origem, linha?.destino)]);
  return doMapa > 0 ? doMapa : null;
}

// Valor liquido da ANTT para uma rota. Devolve null quando falta KM ou regra.
export function anttLiquidoPorRegra({ km, tipo, ufOrigem, ufDestino, eixos }, { regra, matriz } = {}) {
  if (!regra || !(Number(km) > 0) || !tipoTemRegraAntt(tipo)) return null;
  const reg = regra[eixosDaLinha({ tipo, eixos })];
  const ccd = numBr(reg?.ccd);
  const cc = numBr(reg?.cc) || 0;
  if (!(ccd > 0)) return null;
  const valor = Number(km) * ccd + cc;
  if (regra.base === 'BRUTO') {
    const { aliquota } = aliquotaDaRota(matriz || [], ufOrigem, ufDestino);
    return liquidoDoBruto(valor, aliquota);
  }
  return Math.round(valor * 100) / 100;
}

// Monta a tabela ANTT virtual a partir de todas as linhas das tabelas passadas
// (uma linha por chave de rota). Tabelas ANTT antigas importadas sao ignoradas.
export function montarTabelaAnttPorRegra(tabelas = [], { regra, kmRotas = {}, matriz = [] } = {}) {
  if (!regra) return null;
  const porChave = new Map();
  (tabelas || []).forEach((tabela) => {
    if (!tabela || normTipo(tabela.tipo) === 'ANTT') return;
    (tabela.linhas || []).forEach((linha) => {
      if (!linha || !linha.origem || !linha.destino) return;
      const chave = linha.chave || chaveRota(linha);
      if (porChave.has(chave)) return;
      const km = kmDaLinha(linha, kmRotas);
      const valor = anttLiquidoPorRegra({ km, tipo: linha.tipo, ufOrigem: linha.ufOrigem, ufDestino: linha.ufDestino, eixos: linha.eixos }, { regra, matriz });
      if (valor === null) return;
      const eixos = eixosDaLinha(linha);
      porChave.set(chave, {
        id: `antt-${chave}`,
        transportadora: 'ANTT',
        origem: linha.origem,
        ufOrigem: linha.ufOrigem,
        destino: linha.destino,
        ufDestino: linha.ufDestino,
        tipo: linha.tipo,
        km,
        eixos,
        valor,
        freteAnttOficial: valor,
        valorFonte: `Regra ANTT ${eixos} eixos (KM × CCD + CC)`,
        chave,
      });
    });
  });
  const linhas = [...porChave.values()];
  return {
    id: ID_TABELA_ANTT_REGRA,
    nome: 'ANTT (regra de cálculo)',
    tipo: 'ANTT',
    modelo: 'REGRA ANTT',
    virtual: true,
    linhas,
    totalLinhas: linhas.length,
    rotasUnicas: linhas.length,
  };
}

// Troca a(s) ANTT importada(s) pela ANTT da regra.
export function substituirAnttPorRegra(tabelas = [], contexto = {}) {
  const semAntt = (tabelas || []).filter((t) => t && normTipo(t.tipo) !== 'ANTT');
  const antt = montarTabelaAnttPorRegra(semAntt, contexto);
  return antt ? [...semAntt, antt] : semAntt;
}
