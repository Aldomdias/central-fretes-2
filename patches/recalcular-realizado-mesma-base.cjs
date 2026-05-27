const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src/pages/SimuladorPage.jsx');
let src = fs.readFileSync(file, 'utf8');
let changed = false;
function rep(a,b,msg){
  if(src.includes(a)){src=src.replace(a,b);changed=true;console.log('OK '+msg);return;}
  if(src.includes(b)){console.log('SKIP '+msg);return;}
  console.warn('WARN '+msg);
}
function addBefore(marker, block, msg){
  if(src.includes(block.trim().split('\n')[0])){console.log('SKIP '+msg);return;}
  const i=src.indexOf(marker); if(i<0){console.warn('WARN '+msg);return;}
  src=src.slice(0,i)+block+'\n'+src.slice(i); changed=true; console.log('OK '+msg);
}

rep(`  const [resultadoRealizado, setResultadoRealizado] = useState(null);`, `  const [resultadoRealizado, setResultadoRealizado] = useState(null);
  const [baseRealizadoPesquisada, setBaseRealizadoPesquisada] = useState(null);`, 'estado base realizada pesquisada');

rep(`  const carregarNegociacoesSimulador = async () => {
    setCarregandoNegociacoesSimulador(true);`, `  const carregarNegociacoesSimulador = async (opcoes = {}) => {
    if (!opcoes.forcar && negociacoesSimulador.length) return negociacoesSimulador;
    setCarregandoNegociacoesSimulador(true);`, 'cache para negociações do simulador');

rep(`      const dados = await buscarTabelasNegociacaoParaSimulacao({ tipoTabela: 'FRACIONADO' });`, `      const dados = await buscarTabelasNegociacaoParaSimulacao({ tipoTabela: 'FRACIONADO' });`, 'mantem busca negociações');

rep(`  const salvarLaudosVisuaisNegociacao = async () => {`, `  const recalcularRealizadoComMesmaBase = async () => {
    if (!baseRealizadoPesquisada?.rowsFiltrados?.length) {
      setErroSimulacao('Faça uma simulação primeiro para guardar a base de CT-es pesquisada.');
      return;
    }
    if (!transportadoraRealizado) {
      setErroSimulacao('Selecione a transportadora/tabela para recalcular.');
      return;
    }

    setFiltroDetalhe('');
    setPaginaDetalhe(0);
    setLinhasExpandidas(new Set());
    iniciarProcessamentoUi('Recalculando com mesma base', 'Recarregando somente a tabela/negociação selecionada...', 18);

    try {
      const dadosNegociacoes = await carregarNegociacoesSimulador({ forcar: true });
      const negociacoesConvertidas = converterTabelasNegociacaoParaSimulador(dadosNegociacoes || [], { canal: canalRealizado });
      const ehNegociacao = negociacoesConvertidas.some((item) => normalizarTransportadoraSimulador(item.nome) === normalizarTransportadoraSimulador(transportadoraRealizado));
      let baseSelecionada = [];

      if (ehNegociacao) {
        baseSelecionada = negociacoesConvertidas.filter((item) =>
          normalizarTransportadoraSimulador(item.nome) === normalizarTransportadoraSimulador(transportadoraRealizado) ||
          transportadoraCompativelSimulador(item.nome, transportadoraRealizado)
        );
      } else {
        const mapaVinculos = await carregarMapaVinculosSimulador();
        const nomeTabela = mapaVinculos.get(normalizarChaveSimulador(transportadoraRealizado)) || mapaVinculos.get(String(transportadoraRealizado || '').toUpperCase()) || transportadoraRealizado;
        const baseOficial = await carregarBaseOnlinePorUfDestino({
          nomeTransportadora: nomeTabela,
          canal: canalRealizado,
          origem: origemRealizado || '',
          ufDestino: ufsDestinoFiltroRealizado,
        });
        baseSelecionada = filtrarBasePorTransportadoraSimulador(baseOficial, nomeTabela);
      }

      if (!baseSelecionada.length) {
        setErroSimulacao('Não encontrei tabela atualizada para recalcular. Clique em Simular realizado para refazer o fluxo completo.');
        finalizarProcessamentoUi('Tabela não encontrada', 'Não foi possível recalcular com a tabela atualizada.', 100);
        return;
      }

      const basesParaMesclar = [baseSelecionada].filter((base) => Array.isArray(base) ? base.length : Boolean(base));
      if (compararConcorrentesRealizado && incluirNegociacoesRealizado && negociacoesConvertidas.length) basesParaMesclar.push(negociacoesConvertidas);
      const baseParaSimulacao = mesclarBasesTransportadorasSimulador(basesParaMesclar);
      const lookupOnline = buildLookupTables(baseParaSimulacao);
      const mapaCidades = new Map(cidadePorIbgeCompleto);
      (lookupOnline.cidadePorIbge || new Map()).forEach((cidade, ibge) => mapaCidades.set(ibge, cidade));

      atualizarProcessamentoUi('Simulando novamente CT-e a CT-e com a mesma base pesquisada...', 72);
      const resultado = simularRealizadoComTabela({
        rows: baseRealizadoPesquisada.rowsFiltrados,
        baseOnline: baseParaSimulacao,
        transportadoraSelecionada: transportadoraRealizado,
        filtros: {
          ...(baseRealizadoPesquisada.filtros || {}),
          transportadora: transportadoraRealizado,
          transportadoraTabelaUsada: transportadoraRealizado,
          recalculoMesmaBase: true,
          recalculadoEm: new Date().toISOString(),
        },
        cidadePorIbge: mapaCidades,
        gradePorCanal: grade,
        municipioPorCidade,
      });

      setResultadoRealizado({
        ...resultado,
        filtros: {
          ...(baseRealizadoPesquisada.filtros || {}),
          transportadora: transportadoraRealizado,
          transportadoraTabelaUsada: transportadoraRealizado,
          canal: canalRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufsDestinoFiltroRealizado.length ? ufsDestinoFiltroRealizado : (baseRealizadoPesquisada.filtros?.ufDestino || []),
          inicio: inicioRealizado,
          fim: fimRealizado,
          limite: limiteRealizado,
          recalculoMesmaBase: true,
          recalculadoEm: new Date().toISOString(),
          ctesNaMalha: baseRealizadoPesquisada.rowsFiltrados.length,
          ctesBaseSimulada: baseRealizadoPesquisada.rowsFiltrados.length,
          tabelasBaseSelecionada: baseSelecionada.length,
          fonteTabela: 'recalculo_mesma_base',
        },
      });
      finalizarProcessamentoUi('Recalculo concluído', 'A mesma base de CT-es foi recalculada com a tabela atualizada.', 100);
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao recalcular com a mesma base.');
      finalizarProcessamentoUi('Erro no recalculo', 'Não foi possível recalcular com a base pesquisada.', 100);
    }
  };

  const salvarLaudosVisuaisNegociacao = async () => {`, 'função recalcular com mesma base');

rep(`      const routeKeysRealizado = criarRouteKeysRealizado(rowsFiltrados, canalRealizado);`, `      setBaseRealizadoPesquisada({
        criadoEm: new Date().toISOString(),
        rowsFiltrados,
        filtros: {
          canal: canalRealizado,
          modo: modoRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufsDestinoEfetivasRealizado,
          ufDestinoSelecionado: ufsDestinoFiltroRealizado,
          inicio: inicioRealizado,
          fim: fimRealizado,
          limite: limiteRealizado,
          ctesNaMalha: rowsFiltrados.length,
          ctesBaseSimulada: rowsComIbge.length,
          baseRealizadoTracking,
          incluirCpsLog: incluirCpsLogRealizado,
        },
      });

      const routeKeysRealizado = criarRouteKeysRealizado(rowsFiltrados, canalRealizado);`, 'guarda base pesquisada após filtro malha');

rep(`            <button className="sim-tab" type="button" onClick={() => setResultadoRealizado(null)}>
              Limpar resultado
            </button>`, `            <button className="sim-tab" type="button" onClick={recalcularRealizadoComMesmaBase} disabled={carregandoSimulacao || !baseRealizadoPesquisada?.rowsFiltrados?.length || !transportadoraRealizado}>
              Recalcular com mesma base
            </button>
            <button className="sim-tab" type="button" onClick={() => setResultadoRealizado(null)}>
              Limpar resultado
            </button>`, 'botão recalcular mesma base');

rep(`                  CPS LOG excluído por padrão • Concorrentes {compararConcorrentesRealizado ? 'ativos' : 'desativados'} • Negociações {incluirNegociacoesRealizado ? 'ativas' : 'desativadas'} • {carregandoNegociacoesSimulador ? 'atualizando negociações...' : negociacoesAtualizadasEm ? \`negociações atualizadas às ${negociacoesAtualizadasEm}\` : 'negociações aguardando atualização'}`, `                  CPS LOG excluído por padrão • Concorrentes {compararConcorrentesRealizado ? 'ativos' : 'desativados'} • Negociações {incluirNegociacoesRealizado ? 'ativas' : 'desativadas'} • {carregandoNegociacoesSimulador ? 'atualizando negociações...' : negociacoesAtualizadasEm ? \`negociações atualizadas às ${negociacoesAtualizadasEm}\` : 'negociações aguardando atualização'}{baseRealizadoPesquisada?.rowsFiltrados?.length ? \` • base guardada: ${baseRealizadoPesquisada.rowsFiltrados.length.toLocaleString('pt-BR')} CT-es\` : ''}`, 'mostra base guardada');

if(changed) fs.writeFileSync(file, src, 'utf8');
console.log(changed ? '4.17 recalculo mesma base aplicado.' : '4.17 sem alterações.');
