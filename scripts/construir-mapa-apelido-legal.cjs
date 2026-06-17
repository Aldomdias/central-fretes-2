#!/usr/bin/env node
/**
 * Constrói o dicionário "apelido no Central Fretes" -> "nome legal na Vera"
 * cruzando os CSVs exportados da tela Avaliação de Prazos e Cobertura (nomes
 * curtos/apelido, usados no Central Fretes) com a planilha de Generalidades
 * da Vera (nomes legais completos).
 *
 * Comparação por CONJUNTO DE PALAVRAS relevantes (não substring de texto
 * colado — isso já causou falso-positivo: "LOGISTICA" entrava na lista de
 * ruído e sobrava só a letra solta "L", que é substring de qualquer nome).
 * Nomes que não sobram nenhuma palavra relevante (ex.: "KM", "RN", "TW")
 * caem num fallback por substring direta do nome inteiro.
 *
 * Uso:
 *   node scripts/construir-mapa-apelido-legal.cjs <generalidades.xlsx> <sistema_acumulado.json> <saida_mapa.json> [saida_relatorio.json]
 */
const fs = require('fs');
const XLSX = require('xlsx');

function normalizeAccents(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function chaveComparavel(value) {
  return normalizeAccents(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const RUIDO = new Set([
  'TRANSPORTES', 'TRANSPORTE', 'TRANSPORTADORA', 'TRANSPORTADOR', 'LTDA', 'EIRELI', 'SA', 'ME',
  'EPP', 'CARGAS', 'LOGISTICA', 'RODOVIARIO', 'RODOVIARIA', 'GP', 'HUB', 'DE', 'DO', 'DA', 'E',
  'DOS', 'DAS', 'EXPRESS', 'ENCOMENDAS', 'AGENCIAMENTO', 'RAPIDAS', 'RAPIDO', 'LOCACOES', 'SERVICOS',
]);

function tokens(nome) {
  return normalizeAccents(nome)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t.length >= 3 && !RUIDO.has(t));
}

function candidatosPorTokens(nome, listaVera) {
  const ts = tokens(nome);
  if (!ts.length) return null; // sinaliza "usar fallback por substring"
  return listaVera.filter((vn) => {
    const tv = tokens(vn);
    if (!tv.length) return false;
    return ts.every((t) => tv.includes(t)) || tv.every((t) => ts.includes(t));
  });
}

function candidatosPorSubstring(nome, listaVera) {
  const chave = chaveComparavel(nome);
  if (chave.length < 2) return [];
  return listaVera.filter((vn) => chaveComparavel(vn).includes(chave));
}

function main() {
  const [, , entradaVera, entradaSistema, saidaMapa, saidaRelatorio] = process.argv;
  if (!entradaVera || !entradaSistema || !saidaMapa) {
    console.error('Uso: node scripts/construir-mapa-apelido-legal.cjs <generalidades.xlsx> <sistema.json> <saida_mapa.json> [saida_relatorio.json]');
    process.exit(1);
  }

  const sistema = JSON.parse(fs.readFileSync(entradaSistema, 'utf8'));
  const wb = XLSX.readFile(entradaVera);
  const vera = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });

  const sistemaNomes = [...new Set(sistema.map((r) => String(r['Transportadora'] || '').trim().toUpperCase()))];
  const veraNomes = [...new Set(vera.map((r) => String(r['Nome da transportadora'] || '').trim().toUpperCase()))];

  const mapa = {};
  const semCandidato = [];
  const ambiguos = [];

  for (const sn of sistemaNomes) {
    let candidatos = candidatosPorTokens(sn, veraNomes);
    let viaFallback = false;
    if (candidatos === null) {
      candidatos = candidatosPorSubstring(sn, veraNomes);
      viaFallback = true;
    }
    if (candidatos.length === 1) {
      mapa[sn] = candidatos[0];
    } else if (candidatos.length > 1) {
      ambiguos.push({ apelido: sn, candidatos, viaFallback });
    } else {
      semCandidato.push(sn);
    }
  }

  fs.writeFileSync(saidaMapa, JSON.stringify(mapa, null, 2));
  console.log(`Apelidos do sistema: ${sistemaNomes.length}`);
  console.log(`Match único: ${Object.keys(mapa).length}`);
  console.log(`Ambíguos (mais de 1 candidato): ${ambiguos.length}`);
  console.log(`Sem candidato: ${semCandidato.length}`);
  console.log(`Mapa salvo em: ${saidaMapa}`);

  if (saidaRelatorio) {
    fs.writeFileSync(saidaRelatorio, JSON.stringify({ ambiguos, semCandidato }, null, 2));
    console.log(`Relatório de pendências salvo em: ${saidaRelatorio}`);
  }
}

main();
