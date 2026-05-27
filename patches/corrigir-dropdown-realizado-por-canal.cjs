#!/usr/bin/env node
/**
 * Patch 4.7 — Corrigir lista de transportadoras por canal no Simulador do Realizado
 *
 * Problema observado:
 * - No canal B2C, o select de Transportadora/tabela mostra transportadoras que não são B2C.
 * - Isso permite selecionar uma tabela de outro canal e faz a simulação ficar inconsistente.
 *
 * Correção:
 * - No Simulador do Realizado, a lista deve vir somente do filtro do canal selecionado.
 * - Não deve misturar todas as transportadoras no select.
 * - Tabelas em negociação só entram na lista se o flag "Incluir tabelas em negociação" estiver ligado.
 * - Ao trocar o canal, se a transportadora selecionada não pertence ao novo canal, limpa a seleção.
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
`  const transportadorasPorCanalRealizado = useMemo(() => {
    const oficiaisDoCanal = filtrarTransportadorasPorCanal(todasTransportadorasDisponiveis, canalRealizado, opcoesOnline, transportadoras);

    // No Simulador do Realizado a transportadora selecionada pode ser:
    // 1) tabela oficial já cadastrada; ou
    // 2) tabela em negociação.
    // Por isso não podemos esconder uma tabela oficial só porque o canal/origem ainda não
    // foi reconhecido nas opções online. A simulação depois busca a tabela no Supabase e
    // aplica os filtros informados.
    return [...new Set([...(oficiaisDoCanal || []), ...(todasTransportadorasDisponiveis || []), ...nomesNegociacaoRealizado])]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [todasTransportadorasDisponiveis, canalRealizado, opcoesOnline, transportadoras, nomesNegociacaoRealizado]);`,
`  const transportadorasPorCanalRealizado = useMemo(() => {
    const oficiaisDoCanal = filtrarTransportadorasPorCanal(todasTransportadorasDisponiveis, canalRealizado, opcoesOnline, transportadoras);
    const negociacoesDoCanal = incluirNegociacoesRealizado ? nomesNegociacaoRealizado : [];

    // Regra 4.7:
    // No Simulador do Realizado, o select deve respeitar o canal escolhido.
    // Não misturar todas as transportadoras aqui, pois isso permite selecionar tabela de outro canal
    // e deixa a simulação instável, principalmente no B2C.
    return [...new Set([...(oficiaisDoCanal || []), ...(negociacoesDoCanal || [])])]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [todasTransportadorasDisponiveis, canalRealizado, opcoesOnline, transportadoras, nomesNegociacaoRealizado, incluirNegociacoesRealizado]);`,
  'filtra transportadoras do realizado pelo canal selecionado'
);

const marcador = `  const negociacaoSelecionadaRealizado = useMemo(`;
const efeito = `  useEffect(() => {
    if (!transportadoraRealizado) return;
    if (!transportadorasPorCanalRealizado.includes(transportadoraRealizado)) {
      setTransportadoraRealizado('');
      setResultadoRealizado(null);
      setErroSimulacao('Transportadora limpa porque não pertence ao canal selecionado. Selecione uma transportadora do canal atual.');
    }
  }, [canalRealizado, transportadoraRealizado, transportadorasPorCanalRealizado]);

`;

if (!src.includes(efeito) && src.includes(marcador)) {
  src = src.replace(marcador, efeito + marcador);
  alterou = true;
  console.log('OK  limpa seleção incompatível ao trocar canal');
} else if (src.includes(efeito)) {
  console.log('SKIP limpa seleção incompatível já aplicado');
} else {
  console.warn('WARN marcador para inserir limpeza de seleção não encontrado');
}

if (alterou) {
  fs.writeFileSync(arquivo, src, 'utf8');
  console.log('\nPatch 4.7 aplicado no SimuladorPage.jsx.');
} else {
  console.log('\nPatch 4.7 já estava aplicado ou não encontrou trechos-alvo.');
}
