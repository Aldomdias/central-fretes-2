#!/usr/bin/env node
/**
 * Patch 4.6 — Corrigir busca B2C no Simulador do Realizado
 *
 * Problema observado:
 * - ATACADO simula.
 * - B2C às vezes não busca CT-es / às vezes não simula.
 *
 * Causa provável:
 * - O filtro SQL atual usa `eq('canal', 'B2C')` para B2C.
 * - Só que, no realizado, o canal B2C pode vir por `canal_vendas`, `marcadores`, marketplace
 *   ou outras colunas que só são normalizadas depois no JavaScript pela função normalizarCanalSim.
 * - Resultado: o banco corta os CT-es antes da normalização e a base fica vazia/incompleta.
 *
 * Correção:
 * - Para B2C, não aplicar filtro SQL restritivo por canal.
 * - Buscar os CT-es pelos demais filtros explícitos da tela.
 * - Depois mapear e filtrar em JavaScript usando a mesma normalização do simulador.
 * - Para ATACADO, mantém o filtro atual que já funcionou no teste.
 */

const fs = require('fs');
const path = require('path');

const arquivo = path.join(process.cwd(), 'src/pages/SimuladorPage.jsx');
let src = fs.readFileSync(arquivo, 'utf8');
let alterou = false;

function substituir(trecho, novo, descricao) {
  if (src.includes(trecho)) {
    src = src.replace(trecho, novo);
    alterou = true;
    console.log(`OK  ${descricao}`);
    return;
  }
  if (src.includes(novo)) {
    console.log(`SKIP ${descricao} já aplicado`);
    return;
  }
  console.warn(`WARN ${descricao} não encontrado`);
}

substituir(
`  if (filtros.canal) {
    const canalNorm = String(filtros.canal || '').toUpperCase();
    if (canalNorm === 'ATACADO' || canalNorm === 'B2B') query = query.in('canal', ['ATACADO', 'B2B', 'Atacado', 'b2b']);
    else query = query.eq('canal', filtros.canal);
  }`,
`  if (filtros.canal) {
    const canalNorm = String(filtros.canal || '').toUpperCase();
    if (canalNorm === 'ATACADO' || canalNorm === 'B2B') {
      query = query.in('canal', ['ATACADO', 'B2B', 'Atacado', 'b2b']);
    } else if (canalNorm === 'B2C') {
      // B2C pode vir de canal_vendas/marcadores/marketplace e só é normalizado depois.
      // Não filtrar no SQL para não perder CT-es antes da normalização.
    } else {
      query = query.eq('canal', filtros.canal);
    }
  }`,
  'remove filtro SQL restritivo para B2C'
);

substituir(
`  const rows = allRows.slice(0, totalMax);
  return rows.map(r => ({`,
`  const rows = allRows.slice(0, totalMax);
  const mapeados = rows.map(r => ({`,
  'prepara mapeamento para filtro pós-normalização'
);

substituir(
`    tipo_veiculo: pickRealizadoField(r, ['tipo_veiculo', 'tipoVeiculo', 'veiculo', 'tipo']) || '',
  }));
}`, 
`    tipo_veiculo: pickRealizadoField(r, ['tipo_veiculo', 'tipoVeiculo', 'veiculo', 'tipo']) || '',
  }));

  const canalFiltro = String(filtros.canal || '').trim().toUpperCase();
  if (canalFiltro === 'B2C') {
    return mapeados.filter((row) => String(row.canal || '').trim().toUpperCase() === 'B2C');
  }
  return mapeados;
}`, 
  'filtra B2C depois da normalização JavaScript'
);

if (alterou) {
  fs.writeFileSync(arquivo, src, 'utf8');
  console.log('\nPatch 4.6 aplicado no SimuladorPage.jsx.');
} else {
  console.log('\nPatch 4.6 já estava aplicado ou não encontrou trechos-alvo.');
}
