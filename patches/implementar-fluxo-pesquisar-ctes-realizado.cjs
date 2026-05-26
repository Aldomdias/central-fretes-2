#!/usr/bin/env node
/**
 * Prompt 4.10 — Implementa fluxo em duas etapas no Simulador do Realizado:
 * 1) Pesquisar CT-es
 * 2) Simular / Calcular usando a base pesquisada
 *
 * Patch idempotente para aplicação automática no build/dev da branch codex.
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

// 1) Estados da etapa de pesquisa.
substituir(
`  const [resultadoRealizado, setResultadoRealizado] = useState(null);`,
`  const [resultadoRealizado, setResultadoRealizado] = useState(null);
  const [baseRealizadoPesquisada, setBaseRealizadoPesquisada] = useState(null);
  const [resumoPesquisaRealizado, setResumoPesquisaRealizado] = useState(null);
  const [pesquisandoRealizado, setPesquisandoRealizado] = useState(false);
  const [filtrosPesquisaRealizado, setFiltrosPesquisaRealizado] = useState('');`,
  'adiciona estados da pesquisa de CT-es'
);

// 2) Limpa a base pesquisada quando filtros mudam.
const efeitoLimparPesquisa = `  useEffect(() => {
    setBaseRealizadoPesquisada(null);
    setResumoPesquisaRealizado(null);
    setFiltrosPesquisaRealizado('');
  }, [
    transportadoraRealizado,
    canalRealizado,
    modoRealizado,
    origemRealizado,
    destinoRealizado,
    ufOrigemRealizado,
    ufDestinoRealizado,
    ufsDestinoRealizado,
    inicioRealizado,
    fimRealizado,
    limiteRealizado,
    baseRealizadoTracking,
    incluirCpsLogRealizado,
    incluirNegociacoesRealizado,
  ]);

`;
if (!src.includes('setBaseRealizadoPesquisada(null);') && src.includes(`  const laudoEmailAtual = laudosEmailRealizado?.[abaLaudoRealizado] || null;`)) {
  src = src.replace(
    `  const laudoEmailAtual = laudosEmailRealizado?.[abaLaudoRealizado] || null;\n`,
    `  const laudoEmailAtual = laudosEmailRealizado?.[abaLaudoRealizado] || null;\n\n${efeitoLimparPesquisa}`
  );
  alterou = true;
  console.log('OK  limpa pesquisa quando filtros mudam');
} else if (src.includes('setBaseRealizadoPesquisada(null);')) {
  console.log('SKIP limpeza de pesquisa já aplicada');
} else {
  console.warn('WARN ponto para limpeza de pesquisa não encontrado');
}

// 3) Insere função Pesquisar CT-es antes da função de simulação.
const funcPesquisar = `  const montarResumoPesquisaRealizado = (payload = {}) => {
    const rowsBase = payload.rows || [];
    const rowsBrutos = payload.rowsBrutos || [];
    const tracking = payload.trackingEnriquecido || {};
    const valorCte = rowsBase.reduce((acc, row) => acc + (Number(row.valorCte) || 0), 0);
    const valorNF = rowsBase.reduce((acc, row) => acc + (Number(row.valorNF) || 0), 0);
    const peso = rowsBase.reduce((acc, row) => acc + (Number(row.pesoDeclarado || row.peso) || 0), 0);
    const cubagem = rowsBase.reduce((acc, row) => acc + (Number(row.cubagemTotal || row.cubagem || row.cubagemUnitaria) || 0), 0);
    const volumes = rowsBase.reduce((acc, row) => acc + (Number(row.qtdVolumes || row.volumes) || 0), 0);
    const transportadorasRealizadas = new Set(rowsBase.map((row) => String(row.transportadora || '').trim()).filter(Boolean));
    const origens = new Set(rowsBase.map((row) => String(row.cidadeOrigem || '').trim()).filter(Boolean));
    const ufsDestino = new Set(rowsBase.map((row) => String(row.ufDestino || '').trim()).filter(Boolean));

    return {
      tabela: payload.nomeTabelaSelecionada || '',
      canal: canalRealizado,
      modoBase: baseRealizadoTracking,
      ctesBrutos: rowsBrutos.length,
      ctesBase: rowsBase.length,
      ctesComTracking: Number(tracking.vinculados || 0),
      ctesSemTracking: Number(tracking.semTracking || 0),
      percentualTracking: rowsBrutos.length ? ((Number(tracking.vinculados || 0) / rowsBrutos.length) * 100) : 0,
      valorCte,
      valorNF,
      peso,
      cubagem,
      volumes,
      transportadorasRealizadas: transportadorasRealizadas.size,
      origens: origens.size,
      ufsDestino: ufsDestino.size,
      tabelasBaseSelecionada: (payload.baseSelecionada || []).length,
      preview: rowsBase.slice(0, 20).map((row) => ({
        cte: row.numeroCte || row.cte || '',
        nf: row.notaFiscal || row.nf || '',
        transportadora: row.transportadora || '',
        origem: row.cidadeOrigem || '',
        destino: row.cidadeDestino || '',
        ufDestino: row.ufDestino || '',
        valorCte: Number(row.valorCte || 0),
        valorNF: Number(row.valorNF || 0),
        peso: Number(row.pesoDeclarado || row.peso || 0),
        cubagem: Number(row.cubagemTotal || row.cubagem || row.cubagemUnitaria || 0),
        tracking: row.trackingMatch ? 'Com Tracking' : 'Sem Tracking',
      })),
    };
  };

  const onPesquisarRealizado = async () => {
    if (!transportadoraRealizado) {
      setErroSimulacao('Selecione a transportadora/tabela antes de pesquisar os CT-es.');
      return;
    }

    setPesquisandoRealizado(true);
    setCarregandoSimulacao(true);
    setResultadoRealizado(null);
    setBaseRealizadoPesquisada(null);
    setResumoPesquisaRealizado(null);
    setFiltroDetalhe('');
    setPaginaDetalhe(0);
    setLinhasExpandidas(new Set());
    iniciarProcessamentoUi('Pesquisar CT-es', 'Localizando tabela/malha selecionada...', 8);

    try {
      atualizarProcessamentoUi('Carregando vínculos de transportadoras...', 12);
      const mapaVinculos = await carregarMapaVinculosSimulador();
      const ehNegociacaoSelecionada = nomesNegociacaoRealizado.includes(transportadoraRealizado);
      const nomeTabelaSelecionada = ehNegociacaoSelecionada
        ? transportadoraRealizado
        : mapaVinculos.get(normalizarChaveSimulador(transportadoraRealizado))
          || mapaVinculos.get(String(transportadoraRealizado || '').toUpperCase())
          || transportadoraRealizado;

      atualizarProcessamentoUi('Buscando malha/tabela selecionada...', 18);
      let baseSelecionada = [];

      if (ehNegociacaoSelecionada) {
        baseSelecionada = transportadorasNegociacaoRealizado.filter((item) =>
          normalizarTransportadoraSimulador(item.nome) === normalizarTransportadoraSimulador(nomeTabelaSelecionada)
          || transportadoraCompativelSimulador(item.nome, nomeTabelaSelecionada)
        );
      } else {
        const baseJaCarregada = basesMalhaRealizadoSelecionada.length
          ? filtrarBasePorTransportadoraSimulador(basesMalhaRealizadoSelecionada, transportadoraRealizado)
          : [];

        const precisaBuscarMalha = !baseJaCarregada.length || origemRealizado || ufsDestinoFiltroRealizado.length;
        if (precisaBuscarMalha) {
          const baseOficial = await carregarBaseOnlinePorUfDestino({
            nomeTransportadora: nomeTabelaSelecionada,
            canal: canalRealizado,
            origem: origemRealizado || '',
            ufDestino: ufsDestinoFiltroRealizado,
          });
          baseSelecionada = filtrarBasePorTransportadoraSimulador(baseOficial, nomeTabelaSelecionada);
        }

        if (!baseSelecionada.length && baseJaCarregada.length) baseSelecionada = baseJaCarregada;
      }

      if (!baseSelecionada.length) {
        setErroSimulacao('Tabela/malha não localizada para a transportadora selecionada. Revise canal, transportadora e cadastro da tabela antes de simular.');
        finalizarProcessamentoUi('Tabela não localizada', 'Não foi possível carregar a malha para esta seleção.', 100);
        return;
      }

      const origensTabelaSelecionada = extrairOrigensBaseSimulador(baseSelecionada, canalRealizado);
      const ufsDestinoTabelaSelecionada = extrairUfsDestinoBaseSimulador(baseSelecionada, canalRealizado, origemRealizado);
      const origensFiltroEfetivo = origemRealizado ? [] : origensTabelaSelecionada;
      const ufsDestinoEfetivasRealizado = ufsDestinoFiltroRealizado.length
        ? ufsDestinoFiltroRealizado
        : ufsDestinoTabelaSelecionada;

      atualizarProcessamentoUi('Tabela localizada. Buscando CT-es realizados — página 1...', 26);
      const rowsBrutos = await buscarRealizadoLocalCtesExpandido({
        canal: canalRealizado,
        origem: origemRealizado,
        origens: origensFiltroEfetivo,
        destino: destinoRealizado,
        ufOrigem: ufOrigemRealizado,
        ufDestino: ufsDestinoEfetivasRealizado,
        inicio: inicioRealizado,
        fim: fimRealizado,
        limit: limiteRealizado,
      }, (qtd) => {
        atualizarProcessamentoUi(\`Buscando CT-es realizados... \${qtd.toLocaleString('pt-BR')} carregados\`, Math.min(42, 26 + Math.floor(qtd / 500)));
      });

      if (!rowsBrutos.length) {
        setErroSimulacao('Nenhum CT-e encontrado para os filtros informados. Revise canal, período, origem, destino e UF.');
        finalizarProcessamentoUi('Nenhum CT-e encontrado', 'A tabela foi localizada, mas a busca de CT-es retornou zero.', 100);
        return;
      }

      const rowsBrutosFiltrados = aplicarFiltrosPadraoRealizadoSim(rowsBrutos, {
        incluirCpsLog: incluirCpsLogRealizado,
      });

      atualizarProcessamentoUi('Resolvendo IBGE e aplicando vínculos...', 48);
      const rowsComIbgeBaseAntesCps = rowsBrutosFiltrados.map((row) => {
        const ibgeDestino = resolverIbgeRealizadoPorCidade(row, 'destino', municipioPorCidade);
        const ibgeOrigem = resolverIbgeRealizadoPorCidade(row, 'origem', municipioPorCidade);
        const nomeOriginal = String(row.transportadora || '').trim();
        const nomeVinculado = mapaVinculos.get(normalizarChaveSimulador(nomeOriginal)) || mapaVinculos.get(nomeOriginal.toUpperCase()) || nomeOriginal;
        return { ...row, ibgeOrigem, ibgeDestino, transportadora: nomeVinculado };
      });

      const rowsComIbgeBase = filtrarCpsLogRealizadoSim(rowsComIbgeBaseAntesCps, incluirCpsLogRealizado);

      atualizarProcessamentoUi('Cruzando CT-es com Tracking...', 62);
      const mapasTracking = await buscarTrackingParaRealizado(rowsComIbgeBase);
      const trackingEnriquecido = enriquecerRealizadoComTracking(rowsComIbgeBase, mapasTracking);
      const linhasEnriquecidasFiltradas = filtrarCpsLogRealizadoSim(trackingEnriquecido.linhas || [], incluirCpsLogRealizado);
      const rowsComTracking = linhasEnriquecidasFiltradas.filter((row) => row.trackingMatch);
      const rowsComIbge = baseRealizadoTracking === 'com_tracking'
        ? rowsComTracking
        : linhasEnriquecidasFiltradas;

      if (baseRealizadoTracking === 'com_tracking' && !rowsComIbge.length) {
        setErroSimulacao('Nenhum CT-e encontrou vínculo com Tracking. A tabela foi localizada e os CT-es foram buscados, mas a base final ficou zerada no Tracking.');
        finalizarProcessamentoUi('Sem CT-es com Tracking', 'Revise carga de Tracking ou altere temporariamente para Todos os CT-es.', 100);
        return;
      }

      const payloadPesquisa = {
        mapaVinculos,
        ehNegociacaoSelecionada,
        nomeTabelaSelecionada,
        baseSelecionada,
        origensTabelaSelecionada,
        ufsDestinoTabelaSelecionada,
        origensFiltroEfetivo,
        ufsDestinoEfetivasRealizado,
        rowsBrutos,
        rowsComIbgeBaseAntesCps,
        rowsComIbgeBase,
        mapasTracking,
        trackingEnriquecido,
        linhasEnriquecidasFiltradas,
        rowsComTracking,
        rows: rowsComIbge,
        filtros: {
          canal: canalRealizado,
          origem: origemRealizado,
          destino: destinoRealizado,
          ufOrigem: ufOrigemRealizado,
          ufDestino: ufsDestinoEfetivasRealizado,
          inicio: inicioRealizado,
          fim: fimRealizado,
          limite: limiteRealizado,
          baseRealizadoTracking,
          incluirCpsLogRealizado,
        },
      };

      setBaseRealizadoPesquisada(payloadPesquisa);
      setResumoPesquisaRealizado(montarResumoPesquisaRealizado(payloadPesquisa));
      setFiltrosPesquisaRealizado(JSON.stringify(payloadPesquisa.filtros));
      setErroSimulacao('');
      finalizarProcessamentoUi('Pesquisa concluída', 'Base de CT-es localizada e pronta para simular/calcular.', 100);
    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao pesquisar CT-es do realizado.');
      finalizarProcessamentoUi('Erro na pesquisa de CT-es', 'Não foi possível montar a base para simulação.', 100);
    } finally {
      setPesquisandoRealizado(false);
      setCarregandoSimulacao(false);
    }
  };

`;
if (!src.includes('const onPesquisarRealizado = async () => {') && src.includes('  const onSimularRealizado = async () => {')) {
  src = src.replace('  const onSimularRealizado = async () => {', `${funcPesquisar}  const onSimularRealizado = async () => {`);
  alterou = true;
  console.log('OK  adiciona função Pesquisar CT-es');
} else if (src.includes('const onPesquisarRealizado = async () => {')) {
  console.log('SKIP função Pesquisar CT-es já aplicada');
} else {
  console.warn('WARN ponto para inserir função Pesquisar CT-es não encontrado');
}

// 4) Faz a simulação usar a base pesquisada em vez de buscar CT-es novamente.
const blocoBuscaOriginal = `      atualizarProcessamentoUi('Carregando vínculos de transportadoras...', 14);
      const mapaVinculos = await carregarMapaVinculosSimulador();
      const ehNegociacaoSelecionada = nomesNegociacaoRealizado.includes(transportadoraRealizado);
      const nomeTabelaSelecionada = ehNegociacaoSelecionada
        ? transportadoraRealizado
        : mapaVinculos.get(normalizarChaveSimulador(transportadoraRealizado))
          || mapaVinculos.get(String(transportadoraRealizado || '').toUpperCase())
          || transportadoraRealizado;

      atualizarProcessamentoUi('Buscando malha da transportadora/tabela selecionada...', 18);
      let baseSelecionada = [];

      if (ehNegociacaoSelecionada) {
        baseSelecionada = transportadorasNegociacaoRealizado.filter((item) =>
          normalizarTransportadoraSimulador(item.nome) === normalizarTransportadoraSimulador(nomeTabelaSelecionada)
          || transportadoraCompativelSimulador(item.nome, nomeTabelaSelecionada)
        );
      } else {
        const baseJaCarregada = basesMalhaRealizadoSelecionada.length
          ? filtrarBasePorTransportadoraSimulador(basesMalhaRealizadoSelecionada, transportadoraRealizado)
          : [];

        const precisaBuscarMalha = !baseJaCarregada.length || origemRealizado || ufsDestinoFiltroRealizado.length;
        if (precisaBuscarMalha) {
          const baseOficial = await carregarBaseOnlinePorUfDestino({
            nomeTransportadora: nomeTabelaSelecionada,
            canal: canalRealizado,
            origem: origemRealizado || '',
            ufDestino: ufsDestinoFiltroRealizado,
          });
          baseSelecionada = filtrarBasePorTransportadoraSimulador(baseOficial, nomeTabelaSelecionada);
        }

        if (!baseSelecionada.length && baseJaCarregada.length) baseSelecionada = baseJaCarregada;
      }

      const origensTabelaSelecionada = extrairOrigensBaseSimulador(baseSelecionada, canalRealizado);
      const ufsDestinoTabelaSelecionada = extrairUfsDestinoBaseSimulador(baseSelecionada, canalRealizado, origemRealizado);
      const origensFiltroEfetivo = origemRealizado ? [] : origensTabelaSelecionada;
      const ufsDestinoEfetivasRealizado = ufsDestinoFiltroRealizado.length
        ? ufsDestinoFiltroRealizado
        : ufsDestinoTabelaSelecionada;

      atualizarProcessamentoUi('Buscando CT-es realizados — página 1...', 24);
      const rowsBrutos = await buscarRealizadoLocalCtesExpandido({
        canal: canalRealizado,
        origem: origemRealizado,
        origens: origensFiltroEfetivo,
        destino: destinoRealizado,
        ufOrigem: ufOrigemRealizado,
        ufDestino: ufsDestinoEfetivasRealizado,
        inicio: inicioRealizado,
        fim: fimRealizado,
        limit: limiteRealizado,
      }, (qtd) => {
        atualizarProcessamentoUi(\`Buscando CT-es realizados... \${qtd.toLocaleString('pt-BR')} carregados\`, Math.min(38, 24 + Math.floor(qtd / 500)));
      });

      const rowsBrutosFiltrados = aplicarFiltrosPadraoRealizadoSim(rowsBrutos, {
        // CPS LOG fica excluído por padrão em qualquer base.
        // Marque a opção na tela somente quando quiser analisar CPS LOG.
        incluirCpsLog: incluirCpsLogRealizado,
      });

      atualizarProcessamentoUi('Resolvendo IBGE dos CT-es e aplicando vínculos...', 36);
      const rowsComIbgeBaseAntesCps = rowsBrutosFiltrados.map((row) => {
        const ibgeDestino = resolverIbgeRealizadoPorCidade(row, 'destino', municipioPorCidade);
        const ibgeOrigem = resolverIbgeRealizadoPorCidade(row, 'origem', municipioPorCidade);
        const nomeOriginal = String(row.transportadora || '').trim();
        const nomeVinculado = mapaVinculos.get(normalizarChaveSimulador(nomeOriginal)) || mapaVinculos.get(nomeOriginal.toUpperCase()) || nomeOriginal;
        return { ...row, ibgeOrigem, ibgeDestino, transportadora: nomeVinculado };
      });

      // Segunda barreira: depois dos vínculos, a transportadora pode virar CPS LOG.
      // Por isso filtramos novamente antes do cruzamento com Tracking e antes da simulação.
      const rowsComIbgeBase = filtrarCpsLogRealizadoSim(rowsComIbgeBaseAntesCps, incluirCpsLogRealizado);

      atualizarProcessamentoUi('Cruzando CT-es com Tracking no Supabase para volumes e cubagem...', 42);
      const mapasTracking = await buscarTrackingParaRealizado(rowsComIbgeBase);
      const trackingEnriquecido = enriquecerRealizadoComTracking(rowsComIbgeBase, mapasTracking);

      // Terceira barreira: garante que CPS LOG não entre mesmo se vier enriquecido/vinculado no Tracking.
      const linhasEnriquecidasFiltradas = filtrarCpsLogRealizadoSim(trackingEnriquecido.linhas || [], incluirCpsLogRealizado);
      const rowsComTracking = linhasEnriquecidasFiltradas.filter((row) => row.trackingMatch);
      const rowsComIbge = baseRealizadoTracking === 'com_tracking'
        ? rowsComTracking
        : linhasEnriquecidasFiltradas;

      if (baseRealizadoTracking === 'com_tracking' && !rowsComIbge.length) {
        setErroSimulacao('Nenhum CT-e encontrou vínculo com o Tracking nos filtros informados. Revise período, origem, UF ou a carga do Tracking.');
        setResultadoRealizado(null);
        finalizarProcessamentoUi('Sem CT-es com Tracking', 'A base foi carregada, mas nenhum CT-e teve vínculo com Tracking.', 100);
        return;
      }`;

const blocoBuscaNovo = `      if (!baseRealizadoPesquisada?.rows?.length) {
        setErroSimulacao('Pesquise os CT-es antes de simular. Primeiro valide a base encontrada e depois clique em Simular / Calcular.');
        finalizarProcessamentoUi('Pesquisa obrigatória', 'A simulação foi bloqueada porque não existe base de CT-es pesquisada.', 100);
        return;
      }

      atualizarProcessamentoUi('Usando base de CT-es já pesquisada...', 18);
      const pesquisa = baseRealizadoPesquisada;
      const mapaVinculos = pesquisa.mapaVinculos || new Map();
      const ehNegociacaoSelecionada = pesquisa.ehNegociacaoSelecionada;
      const nomeTabelaSelecionada = pesquisa.nomeTabelaSelecionada || transportadoraRealizado;
      const baseSelecionada = pesquisa.baseSelecionada || [];
      const origensTabelaSelecionada = pesquisa.origensTabelaSelecionada || [];
      const ufsDestinoTabelaSelecionada = pesquisa.ufsDestinoTabelaSelecionada || [];
      const origensFiltroEfetivo = pesquisa.origensFiltroEfetivo || [];
      const ufsDestinoEfetivasRealizado = pesquisa.ufsDestinoEfetivasRealizado || [];
      const rowsBrutos = pesquisa.rowsBrutos || [];
      const rowsComIbgeBaseAntesCps = pesquisa.rowsComIbgeBaseAntesCps || [];
      const rowsComIbgeBase = pesquisa.rowsComIbgeBase || [];
      const mapasTracking = pesquisa.mapasTracking || { total: 0 };
      const trackingEnriquecido = pesquisa.trackingEnriquecido || { linhas: [], vinculados: 0, semTracking: 0 };
      const linhasEnriquecidasFiltradas = pesquisa.linhasEnriquecidasFiltradas || [];
      const rowsComTracking = pesquisa.rowsComTracking || linhasEnriquecidasFiltradas.filter((row) => row.trackingMatch);
      const rowsComIbge = pesquisa.rows || [];

      if (!rowsComIbge.length) {
        setErroSimulacao('A base pesquisada está vazia. Pesquise os CT-es novamente antes de simular.');
        finalizarProcessamentoUi('Base pesquisada vazia', 'Não há CT-es disponíveis para cálculo.', 100);
        return;
      }`;
substituir(blocoBuscaOriginal, blocoBuscaNovo, 'simulação passa a usar base pesquisada');

// 5) Troca botões de ação.
substituir(
`          <div className="sim-actions" style={{ marginTop: 14 }}>
            <button className="primary" type="button" onClick={onSimularRealizado} disabled={carregandoSimulacao || !transportadoraRealizado}>
              {carregandoSimulacao ? 'Simulando...' : 'Simular realizado'}
            </button>
            <button className="sim-tab" type="button" onClick={() => setResultadoRealizado(null)}>
              Limpar resultado
            </button>
          </div>`,
`          <div className="sim-actions" style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="primary" type="button" onClick={onPesquisarRealizado} disabled={carregandoSimulacao || pesquisandoRealizado || !transportadoraRealizado}>
              {pesquisandoRealizado ? 'Pesquisando CT-es...' : 'Pesquisar CT-es'}
            </button>
            <button className="primary" type="button" onClick={onSimularRealizado} disabled={carregandoSimulacao || !baseRealizadoPesquisada?.rows?.length}>
              {carregandoSimulacao && !pesquisandoRealizado ? 'Calculando...' : 'Simular / Calcular'}
            </button>
            <button className="sim-tab" type="button" onClick={() => { setResultadoRealizado(null); setBaseRealizadoPesquisada(null); setResumoPesquisaRealizado(null); }}>
              Limpar resultado/base
            </button>
          </div>`,
  'substitui ações por Pesquisar CT-es e Simular / Calcular'
);

// 6) Painel visual da pesquisa antes da regra/resultado.
const painelPesquisa = `
          {resumoPesquisaRealizado && (
            <div className="sim-alert info" style={{ marginTop: 14, display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <strong>Base pesquisada pronta para simular</strong>
                  <div style={{ color: '#64748b', fontSize: '0.82rem', marginTop: 3 }}>
                    Tabela localizada: <strong>{resumoPesquisaRealizado.tabela}</strong> • Canal {resumoPesquisaRealizado.canal} • {resumoPesquisaRealizado.modoBase === 'com_tracking' ? 'Somente CT-es com Tracking' : 'Todos os CT-es'}
                  </div>
                </div>
                <div style={{ fontWeight: 800, color: '#15803d' }}>✅ Pesquisa concluída</div>
              </div>

              <div className="sim-analise-resumo">
                <div><span>CT-es buscados</span><strong>{resumoPesquisaRealizado.ctesBrutos}</strong></div>
                <div><span>Base para simular</span><strong>{resumoPesquisaRealizado.ctesBase}</strong></div>
                <div><span>Com Tracking</span><strong>{resumoPesquisaRealizado.ctesComTracking}</strong></div>
                <div><span>Sem Tracking</span><strong>{resumoPesquisaRealizado.ctesSemTracking}</strong></div>
                <div><span>% vínculo Tracking</span><strong>{formatPercent(resumoPesquisaRealizado.percentualTracking)}</strong></div>
                <div><span>Valor CT-e</span><strong>{Number(resumoPesquisaRealizado.valorCte || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div>
                <div><span>Valor NF</span><strong>{Number(resumoPesquisaRealizado.valorNF || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div>
                <div><span>Peso</span><strong>{Number(resumoPesquisaRealizado.peso || 0).toLocaleString('pt-BR')}</strong></div>
                <div><span>Cubagem</span><strong>{Number(resumoPesquisaRealizado.cubagem || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</strong></div>
                <div><span>Volumes</span><strong>{Number(resumoPesquisaRealizado.volumes || 0).toLocaleString('pt-BR')}</strong></div>
                <div><span>Origens</span><strong>{resumoPesquisaRealizado.origens}</strong></div>
                <div><span>UFs destino</span><strong>{resumoPesquisaRealizado.ufsDestino}</strong></div>
              </div>

              {(resumoPesquisaRealizado.preview || []).length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table className="sim-table" style={{ minWidth: 980 }}>
                    <thead>
                      <tr>
                        <th>CT-e</th>
                        <th>NF</th>
                        <th>Transportadora realizada</th>
                        <th>Origem</th>
                        <th>Destino</th>
                        <th>UF</th>
                        <th>Valor CT-e</th>
                        <th>Valor NF</th>
                        <th>Tracking</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumoPesquisaRealizado.preview.map((row, idx) => (
                        <tr key={idx}>
                          <td>{row.cte}</td>
                          <td>{row.nf}</td>
                          <td>{row.transportadora}</td>
                          <td>{row.origem}</td>
                          <td>{row.destino}</td>
                          <td>{row.ufDestino}</td>
                          <td>{Number(row.valorCte || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                          <td>{Number(row.valorNF || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                          <td style={{ fontWeight: 700, color: row.tracking === 'Com Tracking' ? '#15803d' : '#b45309' }}>{row.tracking}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
`;
if (!src.includes('Base pesquisada pronta para simular')) {
  substituir(
`          <div className="sim-alert info" style={{ marginTop: 14 }}>
            <strong>Regra:</strong>`,
`${painelPesquisa}
          <div className="sim-alert info" style={{ marginTop: 14 }}>
            <strong>Regra:</strong>`,
    'insere painel visual da base pesquisada'
  );
} else {
  console.log('SKIP painel de pesquisa já aplicado');
}

if (alterou) {
  fs.writeFileSync(arquivo, src, 'utf8');
  console.log('\nPrompt 4.10 aplicado no SimuladorPage.jsx.');
} else {
  console.log('\nPrompt 4.10 já estava aplicado ou não encontrou trechos-alvo.');
}
