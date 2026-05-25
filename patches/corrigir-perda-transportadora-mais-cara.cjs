const fs = require('fs');
const path = require('path');

const arquivo = path.join(process.cwd(), 'src/pages/SimuladorPage.jsx');

if (!fs.existsSync(arquivo)) {
  throw new Error(`Arquivo não encontrado: ${arquivo}`);
}

let conteudo = fs.readFileSync(arquivo, 'utf8');
let alteracoes = 0;

function substituirObrigatorio(descricao, alvo, substituto) {
  if (typeof alvo === 'string') {
    if (!conteudo.includes(alvo)) {
      throw new Error(`Não encontrei o trecho para alterar: ${descricao}`);
    }
    conteudo = conteudo.replace(alvo, substituto);
    alteracoes += 1;
    return;
  }

  if (!alvo.test(conteudo)) {
    throw new Error(`Não encontrei o trecho para alterar: ${descricao}`);
  }
  conteudo = conteudo.replace(alvo, substituto);
  alteracoes += 1;
}

// 1) A tela de perda usa o mesmo helper do Simulador do Realizado.
// O bug principal era buscar CT-es direto na tabela antiga realizado_local_ctes,
// enquanto a importação atual grava na tabela oficial realizado_ctes.
substituirObrigatorio(
  'importar listarRealizadoCtes no SimuladorPage',
  "import { buscarBaseSimulacaoDb, buscarBaseSimulacaoPorRotasDb, carregarMunicipiosIbgeDb, carregarOpcoesSimuladorDb, resolverDestinoIbgeDb } from '../services/freteDatabaseService';",
  "import { buscarBaseSimulacaoDb, buscarBaseSimulacaoPorRotasDb, carregarMunicipiosIbgeDb, carregarOpcoesSimuladorDb, listarRealizadoCtes, resolverDestinoIbgeDb } from '../services/freteDatabaseService';"
);

// 2) Mantém o filtro antigo mais correto caso algum fluxo ainda caia na consulta direta antiga.
conteudo = conteudo.replace(
  "if (filtros.inicio) query = query.gte('data_emissao', filtros.inicio);",
  "if (filtros.inicio) query = query.gte('data_emissao', `${filtros.inicio}T00:00:00`);"
);
conteudo = conteudo.replace(
  "if (filtros.fim) query = query.lte('data_emissao', filtros.fim);",
  "if (filtros.fim) query = query.lte('data_emissao', `${filtros.fim}T23:59:59`);"
);

// 3) Troca a fonte dos CT-es para a função oficial do Realizado, que já sabe ler realizado_ctes,
// aplicar filtros inclusivos de data, usar RPC/Select/fallback local e normalizar canal.
substituirObrigatorio(
  'substituir buscarRealizadoLocalCtes para usar realizado_ctes',
  /async function buscarRealizadoLocalCtes\(filtros = \{}, onProgresso = null\) \{[\s\S]*?\n\}\n\n\nfunction criarChaveUnicaRealizadoSim/,
  `async function buscarRealizadoLocalCtes(filtros = {}, onProgresso = null) {
  const totalMax = Math.min(Number(filtros.limit) || 100000, 200000);

  const filtrosRealizado = {
    inicio: filtros.inicio || '',
    fim: filtros.fim || '',
    canal: filtros.canal || '',
    transportadoraRealizada: filtros.transportadoraRealizada || filtros.transportadora || '',
    ufOrigem: filtros.ufOrigem || '',
    ufDestino: filtros.ufDestino || '',
    origem: filtros.origem || '',
    destino: filtros.destino || '',
    incluirSemCanal: false,
    consultaAmpla: true,
    limit: totalMax,
  };

  const rowsBrutos = await listarRealizadoCtes(filtrosRealizado);
  const rows = (rowsBrutos || []).slice(0, totalMax);
  if (onProgresso) onProgresso(rows.length);

  if (typeof console !== 'undefined') {
    console.info('[Perda Transportadora Mais Cara] CT-es carregados do realizado_ctes', {
      filtros: filtrosRealizado,
      total: rows.length,
      amostra: rows.slice(0, 3).map((r) => ({
        cte: r.numeroCte || r.numero_cte || r.chaveCte || r.chave_cte || '',
        emissao: r.emissao || r.dataEmissao || r.data_emissao || '',
        canal: r.canal || r.canalVendas || r.canal_vendas || r.canais || '',
        transportadora: r.transportadora || '',
        origem: r.cidadeOrigem || r.cidade_origem || '',
        destino: r.cidadeDestino || r.cidade_destino || '',
      })),
    });
  }

  return rows.map((registro) => {
    const raw = registro?.raw && typeof registro.raw === 'object' ? registro.raw : {};
    const r = { ...raw, ...registro };
    const canalBase = {
      ...r,
      canal: pickRealizadoField(r, ['canal', 'canais', 'canalVendas', 'canal_vendas']),
      canal_vendas: pickRealizadoField(r, ['canalVendas', 'canal_vendas', 'canal']),
      marcadores: pickRealizadoField(r, ['marcadores']),
    };

    const cubagemTotal = Number(pickRealizadoField(r, [
      'cubagemTotal', 'cubagem_total', 'metrosCubicos', 'metros_cubicos', 'cubagem',
    ])) || 0;

    return {
      transportadora: pickRealizadoField(r, ['transportadora', 'nome_transportadora', 'transportador']) || '',
      tomador: pickRealizadoField(r, ['tomador_servico', 'tomadorServico', 'tomador', 'nome_tomador', 'razao_social_tomador']) || '',
      valorCte: Number(pickRealizadoField(r, ['valorCte', 'valor_cte', 'frete_realizado', 'freteRealizado', 'valor_frete'])) || 0,
      valorNF: Number(pickRealizadoField(r, ['valorNF', 'valor_nf', 'nf_venda', 'valor_nota', 'valor_mercadoria'])) || 0,
      cidadeDestino: pickRealizadoField(r, ['cidadeDestino', 'cidade_destino', 'destino', 'municipio_destino']) || '',
      ufDestino: String(pickRealizadoField(r, ['ufDestino', 'uf_destino', 'estado_destino']) || '').toUpperCase(),
      cidadeOrigem: pickRealizadoField(r, ['cidadeOrigem', 'cidade_origem', 'origem', 'municipio_origem']) || '',
      ufOrigem: String(pickRealizadoField(r, ['ufOrigem', 'uf_origem', 'estado_origem']) || '').toUpperCase(),
      canal: normalizarCanalSim(canalBase),
      numeroCte: pickRealizadoField(r, ['numeroCte', 'numero_cte', 'cte', 'n_cte']) || '',
      chaveCte: pickRealizadoField(r, ['chaveCte', 'chave_cte', 'chave']) || '',
      chaveNfe: pickRealizadoField(r, ['chaveNfe', 'chave_nfe', 'chave_nf', 'chaveNf', 'chave_nota', 'chaveNota']) || '',
      notaFiscal: pickRealizadoField(r, ['notaFiscal', 'nota_fiscal', 'nf', 'numero_nf', 'numeroNf', 'nfe_numero']) || '',
      pesoDeclarado: Number(pickRealizadoField(r, ['pesoDeclarado', 'peso_declarado', 'peso', 'peso_real', 'pesoReal'])) || 0,
      qtdVolumes: Number(pickRealizadoField(r, ['qtdVolumes', 'qtd_volumes', 'volume', 'volumes', 'quantidade_volumes'])) || 0,
      cubagemUnitaria: Number(pickRealizadoField(r, ['cubagemUnitaria', 'cubagem_unitaria'])) || cubagemTotal,
      cubagemTotal,
      pesoCubado: Number(pickRealizadoField(r, ['pesoCubado', 'peso_cubado'])) || 0,
      ibgeOrigem: onlyDigitsRealizado(pickRealizadoField(r, ['ibgeOrigem', 'ibge_origem', 'codigo_ibge_origem', 'codigoMunicipioOrigem', 'cod_mun_origem'])).slice(0, 7),
      ibgeDestino: onlyDigitsRealizado(pickRealizadoField(r, ['ibgeDestino', 'ibge_destino', 'codigo_ibge_destino', 'codigoMunicipioDestino', 'cod_mun_destino'])).slice(0, 7),
      competencia: pickRealizadoField(r, ['competencia', 'mes_competencia']) || '',
      dataEmissao: pickRealizadoField(r, ['dataEmissao', 'data_emissao', 'emissao', 'emissaoCte']) || '',
      tipo_veiculo: pickRealizadoField(r, ['tipo_veiculo', 'tipoVeiculo', 'veiculo', 'tipo']) || '',
    };
  });
}


function criarChaveUnicaRealizadoSim`
);

fs.writeFileSync(arquivo, conteudo, 'utf8');
console.log(`Patch aplicado em ${path.relative(process.cwd(), arquivo)}. Alterações principais: ${alteracoes}.`);
console.log('Agora rode: npm run build');
