#!/usr/bin/env node
/**
 * v2 do conversor de Generalidades da Vera, agora usando o dicionário
 * apelido (nome no Central Fretes) <-> nome legal (nome na Vera) construído
 * a partir das exportações de "Avaliação de Prazos e Cobertura" do próprio
 * sistema. Isso resolve a "Origem" (cidade) com bem mais confiança do que
 * tentar extrair a cidade do nome da filial da Vera.
 *
 * Uso:
 *   node scripts/converter-generalidades-vera-v2.cjs <generalidades.xlsx> <mapa_apelido_legal.json> <sistema_acumulado.json> <saida.xlsx>
 */
const XLSX = require('xlsx');
const fs = require('fs');

function normalizeAccents(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Compara só as letras A-Z/0-9, descartando acento e qualquer símbolo (inclui
// o lixo de encoding corrompido tipo "Ã£"/"Ã‡" que aparece nos nomes de
// filial da Vera). Como o acento/símbolo corrompido desaparece dos dois
// lados, "SÃƒO PAULO" (corrompido) e "São Paulo" (correto) convergem para o
// mesmo "SOPAULO".
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

function main() {
  const [, , entradaVera, entradaMapa, entradaSistema, saidaPath] = process.argv;
  if (!entradaVera || !entradaMapa || !entradaSistema || !saidaPath) {
    console.error('Uso: node scripts/converter-generalidades-vera-v2.cjs <generalidades.xlsx> <mapa.json> <sistema.json> <saida.xlsx>');
    process.exit(1);
  }

  const mapaApelidoLegal = JSON.parse(fs.readFileSync(entradaMapa, 'utf8'));
  const sistema = JSON.parse(fs.readFileSync(entradaSistema, 'utf8'));

  // nome legal (Vera, normalizado) -> Set de {cidade, uf, apelido}
  const legalParaOrigens = new Map();
  for (const [apelido, legal] of Object.entries(mapaApelidoLegal)) {
    const legalNorm = normalizeAccents(legal).toUpperCase().trim();
    if (!legalParaOrigens.has(legalNorm)) legalParaOrigens.set(legalNorm, []);
  }
  for (const linha of sistema) {
    const apelido = String(linha['Transportadora'] || '').trim().toUpperCase();
    const legal = mapaApelidoLegal[apelido];
    if (!legal) continue;
    const legalNorm = normalizeAccents(legal).toUpperCase().trim();
    const cidade = String(linha['Origem'] || '').trim();
    const uf = String(linha['UF Origem'] || '').trim();
    if (!cidade) continue;
    const lista = legalParaOrigens.get(legalNorm) || [];
    if (!lista.some((o) => o.cidade === cidade && o.uf === uf)) {
      lista.push({ cidade, uf, apelido });
    }
    legalParaOrigens.set(legalNorm, lista);
  }

  const wb = XLSX.readFile(entradaVera);
  const linhasVera = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });

  const grupos = new Map();
  linhasVera.forEach((row) => {
    const transportadora = String(row['Nome da transportadora'] || '').trim();
    const codigoUnidade = String(row['Código de Unidade'] || '').trim();
    const filial = String(row['Nome da Filial da Transportadora'] || '').trim();
    if (!transportadora) return;

    const chave = `${transportadora}__${codigoUnidade}`;
    if (!grupos.has(chave)) {
      grupos.set(chave, { transportadora, codigoUnidade, filial, porTipo: new Map() });
    }
    const grupo = grupos.get(chave);
    const tipo = normTipo(row['Nome da Generalidade']);
    if (!tipo) return;
    if (!grupo.porTipo.has(tipo)) grupo.porTipo.set(tipo, []);
    grupo.porTipo.get(tipo).push(row);
  });

  const saida = [];
  const revisar = [];
  const tiposConhecidos = new Set([
    'TAS', 'AD VALOREM', 'ADVALOREM', 'GRIS', 'PEDAGIO', 'CUBAGEM', 'ICMS',
    'TAXA DE EMISSAO DE CONHECIMENTO',
  ]);

  for (const grupo of grupos.values()) {
    const legalNorm = normalizeAccents(grupo.transportadora).toUpperCase().trim();
    const origensConhecidas = legalParaOrigens.get(legalNorm) || [];

    // Tenta achar qual das cidades conhecidas do sistema aparece no nome da filial da Vera.
    const filialChave = chaveComparavel(grupo.filial);
    const candidatas = origensConhecidas.filter((o) => filialChave.includes(chaveComparavel(o.cidade)));

    let cidade = '';
    let motivo = '';
    if (candidatas.length === 1) {
      cidade = candidatas[0].cidade;
    } else if (candidatas.length > 1) {
      // mais de uma cidade conhecida bate no texto da filial — ambíguo, mas
      // ainda assim sugerimos a primeira e marcamos para revisão.
      cidade = candidatas[0].cidade;
      motivo = `Ambíguo: filial também bate com ${candidatas.slice(1).map((c) => c.cidade).join(', ')}`;
    } else if (origensConhecidas.length === 1) {
      // só uma origem conhecida pra essa transportadora no sistema — usa direto.
      cidade = origensConhecidas[0].cidade;
    } else if (origensConhecidas.length > 1) {
      motivo = `Transportadora tem ${origensConhecidas.length} origens no sistema (${origensConhecidas.map((o) => o.cidade).join(', ')}) e nenhuma bate com o nome da filial "${grupo.filial}"`;
    } else {
      motivo = 'Transportadora não encontrada no dicionário apelido↔nome legal (sem cobertura ainda nas exportações do sistema)';
    }

    const linha = (tipo) => {
      const linhas = grupo.porTipo.get(tipo);
      return linhas ? escolherLinha(linhas) : null;
    };

    const tas = linha('TAS');
    const adValorem = linha('AD VALOREM') || linha('ADVALOREM');
    const gris = linha('GRIS');
    const pedagio = linha('PEDAGIO');
    const cubagem = linha('CUBAGEM');
    const icms = linha('ICMS');
    const ctrc = linha('TAXA DE EMISSAO DE CONHECIMENTO');

    const fracaoPedagio = pedagio ? toNumber(pedagio['Fração de peso']) || 100 : 100;
    const pedagioValor = pedagio ? toNumber(pedagio['Valor do Frete']) * (100 / fracaoPedagio) : 0;

    const observacoesPartes = [];
    for (const [tipo, linhas] of grupo.porTipo.entries()) {
      if (tiposConhecidos.has(tipo)) continue;
      const l = escolherLinha(linhas);
      const valor = toNumber(l['Valor do Frete']) || toNumber(l['% Do Valor do Frete']) || toNumber(l['Cubagem']);
      if (valor) observacoesPartes.push(`${tipo}: ${valor}`);
    }

    const out = {
      Transportadora: grupo.transportadora,
      Origem: cidade,
      Canal: 'ATACADO',
      'Incide ICMS': icms ? 'Sim' : 'Não',
      'Alíquota ICMS %': icms ? toNumber(icms['% Do Valor do Frete']) : '',
      'Ad Valorem %': adValorem ? toNumber(adValorem['% Do Valor do Frete']) : '',
      'Ad Valorem Mínimo R$': adValorem ? toNumber(adValorem['Valor Mínimo de Frete']) : '',
      'Pedágio R$ 100kg': pedagio ? pedagioValor : '',
      'GRIS %': gris ? toNumber(gris['% Do Valor do Frete']) : '',
      'GRIS Mínimo R$': gris ? toNumber(gris['Valor Mínimo de Frete']) : '',
      'TAS R$': tas ? toNumber(tas['Valor do Frete']) : '',
      'CTRC Emitido R$': ctrc ? toNumber(ctrc['Valor do Frete']) : '',
      'Cubagem kg m3': cubagem ? toNumber(cubagem['Cubagem']) : '',
      'Tipo de cálculo': 'PERCENTUAL',
      Observações: observacoesPartes.join('; '),
      'Código de Unidade (Vera)': grupo.codigoUnidade,
      'Filial (Vera)': grupo.filial,
    };

    if (!cidade) {
      revisar.push({ ...out, 'Motivo da revisão': motivo });
    } else {
      saida.push(out);
      if (motivo) revisar.push({ ...out, 'Motivo da revisão': motivo });
    }
  }

  const wbOut = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbOut, XLSX.utils.json_to_sheet(saida), 'Dados');
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(revisar.length ? revisar : [{ aviso: 'Nenhuma linha para revisar' }]),
    'Revisar manualmente'
  );
  XLSX.writeFile(wbOut, saidaPath);

  console.log(`Transportadoras com dicionário no sistema: ${legalParaOrigens.size}`);
  console.log(`Transportadoras+unidades convertidas com Origem resolvida: ${saida.length}`);
  console.log(`Linhas para revisar manualmente: ${revisar.length}`);
  console.log(`Arquivo gerado em: ${saidaPath}`);
}

main();
