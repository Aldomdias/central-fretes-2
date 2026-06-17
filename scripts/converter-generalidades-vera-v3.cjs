#!/usr/bin/env node
/**
 * v3: inverte a lógica das versões anteriores.
 *
 * Antes: percorria a planilha da Vera (filial por filial) e tentava ADIVINHAR
 * a cidade/origem correspondente no Central Fretes — gerava muita linha
 * "revisar manualmente".
 *
 * Agora: percorre a BASE DO SISTEMA (export de Avaliação de Prazos e
 * Cobertura, que tem Transportadora+Origem corretos e já cadastrados) e, pra
 * cada combinação única (transportadora, origem), PROCURA na Vera os dados
 * de generalidade correspondentes. O que não achar fica marcado como
 * pendente — mas a lista de transportadora+origem em si nunca está errada,
 * porque vem direto do sistema, não de adivinhação de texto.
 *
 * Uso:
 *   node scripts/converter-generalidades-vera-v3.cjs <generalidades.xlsx> <mapa_apelido_legal.json> <sistema_acumulado.json> <saida.xlsx>
 */
const XLSX = require('xlsx');
const fs = require('fs');

function normalizeAccents(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function chaveComparavel(value) {
  return normalizeAccents(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normTipo(value) {
  return normalizeAccents(value).toUpperCase().trim().replace(/\s+/g, ' ');
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return Number(String(value).replace(',', '.')) || 0;
}

function toBool(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function escolherLinha(linhas) {
  const ativas = linhas.filter((l) => toBool(l['Ativo']));
  const pool = ativas.length ? ativas : linhas;
  return pool.slice().sort((a, b) => {
    const da = new Date(a['Duração Inicial'] || 0).getTime();
    const db = new Date(b['Duração Inicial'] || 0).getTime();
    return db - da;
  })[0];
}

// Tipos que mapeiam para CTRC Emitido R$ (taxa fixa por CTE, somados quando há mais de um)
const TIPOS_CTRC = [
  'TAXA DE EMISSAO DE CONHECIMENTO',
  'TAXA DE COLETA',
  'TAXA DE ENTREGA',
  'DESPACHO',
  'TAXA DE DESPACHO',
  'TAXA ENTREGA',
  'TAXA COLETA',
];

const TIPOS_CONHECIDOS = new Set([
  'TAS', 'AD VALOREM', 'ADVALOREM', 'GRIS', 'PEDAGIO', 'CUBAGEM', 'ICMS',
  'FRETE PERCENTUAL',
  ...TIPOS_CTRC,
]);

function main() {
  const [, , entradaVera, entradaMapa, entradaSistema, saidaPath] = process.argv;
  if (!entradaVera || !entradaMapa || !entradaSistema || !saidaPath) {
    console.error('Uso: node scripts/converter-generalidades-vera-v3.cjs <generalidades.xlsx> <mapa.json> <sistema.json> <saida.xlsx>');
    process.exit(1);
  }

  const mapaApelidoLegal = JSON.parse(fs.readFileSync(entradaMapa, 'utf8'));
  const sistema = JSON.parse(fs.readFileSync(entradaSistema, 'utf8'));

  // BASE: combinações únicas (apelido, origem, uf, canal) vindas do sistema —
  // essa é a fonte da verdade, nunca é adivinhada.
  const baseUnica = new Map();
  for (const linha of sistema) {
    const apelido = String(linha['Transportadora'] || '').trim().toUpperCase();
    const cidade = String(linha['Origem'] || '').trim();
    const uf = String(linha['UF Origem'] || '').trim();
    const canal = String(linha['Canal'] || 'ATACADO').trim().toUpperCase();
    if (!apelido || !cidade) continue;
    const chave = `${apelido}__${cidade}__${uf}__${canal}`;
    if (!baseUnica.has(chave)) baseUnica.set(chave, { apelido, cidade, uf, canal });
  }

  // Vera agrupada por nome legal + filial (mesma lógica de sempre).
  const wb = XLSX.readFile(entradaVera);
  const linhasVera = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const gruposPorLegal = new Map(); // nomeLegalNorm -> [{filial, porTipo}]
  linhasVera.forEach((row) => {
    const transportadora = String(row['Nome da transportadora'] || '').trim();
    if (!transportadora) return;
    const codigoUnidade = String(row['Código de Unidade'] || '').trim();
    const filial = String(row['Nome da Filial da Transportadora'] || '').trim();
    const legalNorm = normalizeAccents(transportadora).toUpperCase().trim();

    if (!gruposPorLegal.has(legalNorm)) gruposPorLegal.set(legalNorm, new Map());
    const porUnidade = gruposPorLegal.get(legalNorm);
    const chaveUnidade = `${transportadora}__${codigoUnidade}`;
    if (!porUnidade.has(chaveUnidade)) {
      porUnidade.set(chaveUnidade, { transportadoraVera: transportadora, codigoUnidade, filial, porTipo: new Map() });
    }
    const grupo = porUnidade.get(chaveUnidade);
    const tipo = normTipo(row['Nome da Generalidade']);
    if (!tipo) return;
    if (!grupo.porTipo.has(tipo)) grupo.porTipo.set(tipo, []);
    grupo.porTipo.get(tipo).push(row);
  });

  const saida = [];
  const pendentes = [];

  for (const item of baseUnica.values()) {
    const legal = mapaApelidoLegal[item.apelido];
    const linhaBase = {
      Transportadora: item.apelido,
      'Nome legal (Vera)': legal || '',
      Origem: item.cidade,
      'UF Origem': item.uf,
      Canal: item.canal,
    };

    if (!legal) {
      pendentes.push({ ...linhaBase, Motivo: 'Transportadora sem nome legal mapeado (não está no dicionário apelido↔legal)' });
      continue;
    }

    const legalNorm = normalizeAccents(legal).toUpperCase().trim();
    const unidadesVera = gruposPorLegal.get(legalNorm);
    if (!unidadesVera || !unidadesVera.size) {
      pendentes.push({ ...linhaBase, Motivo: 'Nome legal não encontrado na planilha da Vera (pode ter sido digitado diferente lá)' });
      continue;
    }

    const cidadeChave = chaveComparavel(item.cidade);
    const candidatas = [...unidadesVera.values()].filter((g) => chaveComparavel(g.filial).includes(cidadeChave));

    if (!candidatas.length) {
      const filiaisConhecidas = [...unidadesVera.values()].map((g) => g.filial).join(' | ');
      pendentes.push({
        ...linhaBase,
        Motivo: `Nenhuma filial da Vera para "${legal}" bate com a cidade "${item.cidade}". Filiais disponíveis: ${filiaisConhecidas}`,
      });
      continue;
    }

    // Se houver mais de uma filial batendo com a cidade, soma/usa a mais completa (mais tipos de generalidade).
    const grupo = candidatas.sort((a, b) => b.porTipo.size - a.porTipo.size)[0];
    const ambiguo = candidatas.length > 1;

    const linha = (tipo) => {
      const linhas = grupo.porTipo.get(tipo);
      return linhas ? escolherLinha(linhas) : null;
    };

    const tas = linha('TAS');
    const adValorem = linha('AD VALOREM') || linha('ADVALOREM') || linha('FRETE PERCENTUAL');
    const gris = linha('GRIS');
    const pedagio = linha('PEDAGIO');
    const cubagem = linha('CUBAGEM');
    const icms = linha('ICMS');

    // CTRC = soma de todas as taxas fixas por CTE (coleta, entrega, despacho, emissão etc.)
    let ctrcValor = 0;
    for (const tipoCTRC of TIPOS_CTRC) {
      const l = linha(tipoCTRC);
      if (l) ctrcValor += toNumber(l['Valor do Frete']) || toNumber(l['Valor Fixo']) || 0;
    }

    const fracaoPedagio = pedagio ? toNumber(pedagio['Fração de peso']) || 100 : 100;
    const pedagioValor = pedagio ? toNumber(pedagio['Valor do Frete']) * (100 / fracaoPedagio) : 0;

    // "Tipo de cálculo" aqui é só o default da GENERALIDADE (TAS não tem
    // nenhuma relação com isso). A regra real de "taxa aplicada zerada =
    // percentual, com valor = por faixa de peso" é da importação de
    // COTAÇÕES/fretes (campo "Taxa aplicada" das faixas de peso, ex.: 0-2kg,
    // 2-5kg) e já está implementada em inferTipoCalculoCotacao
    // (src/utils/importacao.js) — não existe equivalente disso nas
    // generalidades da Vera, então mantemos o default do modelo do sistema.
    const tipoCalculo = 'PERCENTUAL';

    const observacoesPartes = [];
    for (const [tipo, linhas] of grupo.porTipo.entries()) {
      if (TIPOS_CONHECIDOS.has(tipo)) continue;
      const l = escolherLinha(linhas);
      const valor = toNumber(l['Valor do Frete']) || toNumber(l['% Do Valor do Frete']) || toNumber(l['Cubagem']);
      if (valor) observacoesPartes.push(`${tipo}: ${valor}`);
    }

    const out = {
      ...linhaBase,
      'Incide ICMS': 'Sim',
      'Alíquota ICMS %': icms ? toNumber(icms['% Do Valor do Frete']) : '',
      'Ad Valorem %': adValorem ? toNumber(adValorem['% Do Valor do Frete']) : '',
      'Ad Valorem Mínimo R$': adValorem ? toNumber(adValorem['Valor Mínimo de Frete']) : '',
      'Pedágio R$ 100kg': pedagio ? pedagioValor : '',
      'GRIS %': gris ? toNumber(gris['% Do Valor do Frete']) : '',
      'GRIS Mínimo R$': gris ? toNumber(gris['Valor Mínimo de Frete']) : '',
      'TAS R$': tas ? toNumber(tas['Valor do Frete']) : '',
      'CTRC Emitido R$': ctrcValor || '',
      'Cubagem kg m3': cubagem ? toNumber(cubagem['Cubagem']) : '',
      'Tipo de cálculo': tipoCalculo,
      Observações: observacoesPartes.join('; '),
      'Filial Vera usada': grupo.filial,
      'Código de Unidade (Vera)': grupo.codigoUnidade,
    };

    if (ambiguo) {
      pendentes.push({
        ...out,
        Motivo: `Mais de uma filial da Vera bate com "${item.cidade}": ${candidatas.map((c) => c.filial).join(' | ')}. Usei a com mais dados, revisar se é a certa.`,
      });
    } else {
      saida.push(out);
    }
  }

  const wbOut = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbOut, XLSX.utils.json_to_sheet(saida), 'Dados');
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(pendentes.length ? pendentes : [{ aviso: 'Nenhuma pendência' }]),
    'Pendentes (revisar)'
  );
  XLSX.writeFile(wbOut, saidaPath);

  console.log(`Combinações únicas (transportadora, origem) na base do sistema: ${baseUnica.size}`);
  console.log(`Resolvidas com dados de generalidade da Vera: ${saida.length}`);
  console.log(`Pendentes (sem mapa, sem filial na Vera, ambíguas, ou cidade não encontrada): ${pendentes.length}`);
  console.log(`Arquivo gerado em: ${saidaPath}`);
}

main();
