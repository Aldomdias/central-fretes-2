#!/usr/bin/env node
/**
 * Patch 4.5 — Simulador do Realizado estável
 *
 * Objetivo:
 * - A base de CT-es do realizado NÃO pode depender da malha/tabela selecionada.
 * - A mesma transportadora/período/filtros precisa buscar a mesma base de CT-es.
 * - Tabelas/negociações devem entrar na etapa de cálculo, não como filtro invisível da base.
 * - Evita carregamento automático pesado de negociações ao abrir o simulador.
 *
 * Este patch é idempotente e roda antes do dev/build.
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
`      const origensFiltroEfetivo = origemRealizado ? [] : origensTabelaSelecionada;
      const ufsDestinoEfetivasRealizado = ufsDestinoFiltroRealizado.length
        ? ufsDestinoFiltroRealizado
        : ufsDestinoTabelaSelecionada;`,
`      // Regra 4.5:
      // A base de CT-es do realizado deve ser definida APENAS pelos filtros explícitos da tela
      // (canal, período, origem/destino/UF quando o usuário preencher).
      // A tabela/malha selecionada entra somente no cálculo, nunca como filtro oculto da base.
      const origensFiltroEfetivo = [];
      const ufsDestinoEfetivasRealizado = ufsDestinoFiltroRealizado.length
        ? ufsDestinoFiltroRealizado
        : [];
      const origensPadraoTabelaRealizado = origemRealizado ? [] : origensTabelaSelecionada;
      const ufsDestinoPadraoTabelaRealizado = ufsDestinoFiltroRealizado.length ? [] : ufsDestinoTabelaSelecionada;`,
  'base do realizado independente da malha/tabela'
);

const antigoPadraoTabela = `          ufDestinoPadraoTabela: ufsDestinoFiltroRealizado.length ? [] : ufsDestinoEfetivasRealizado,
          origensPadraoTabela: origemRealizado ? [] : origensFiltroEfetivo,`;
const novoPadraoTabela = `          ufDestinoPadraoTabela: ufsDestinoPadraoTabelaRealizado,
          origensPadraoTabela: origensPadraoTabelaRealizado,`;
while (src.includes(antigoPadraoTabela)) {
  src = src.replace(antigoPadraoTabela, novoPadraoTabela);
  alterou = true;
  console.log('OK  diagnóstico usa malha como referência, não como filtro da base');
}

substituir(
`  // Carrega as negociações automaticamente ao entrar no Simulador Realizado.
  // Assim o usuário não precisa expandir opções só para atualizar a lista.
  useEffect(() => {
    if (aba === 'realizado' && !negociacoesSimulador.length && !carregandoNegociacoesSimulador) {
      carregarNegociacoesSimulador();
    }
  }, [aba, negociacoesSimulador.length, carregandoNegociacoesSimulador]);`,
`  // Regra 4.5:
  // Não carregar negociações automaticamente ao abrir o Simulador do Realizado.
  // Essa carga pode ser pesada e deixar a tela inconsistente.
  // As negociações serão carregadas sob demanda quando o usuário marcar a opção de incluir negociações.`,
  'desativa carregamento automático pesado de negociações'
);

if (alterou) {
  fs.writeFileSync(arquivo, src, 'utf8');
  console.log('\nPatch 4.5 aplicado no SimuladorPage.jsx.');
} else {
  console.log('\nPatch 4.5 já estava aplicado ou não encontrou trechos-alvo.');
}
