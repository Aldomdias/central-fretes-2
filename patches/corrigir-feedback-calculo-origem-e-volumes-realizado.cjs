#!/usr/bin/env node
/**
 * Prompt 4.11 — Ajustes após teste do fluxo 4.10
 *
 * 1) Durante Simular / Calcular, mostrar estado de processamento de verdade.
 * 2) Corrigir origem/destino com ou sem acento no realizado, filtrando localmente por chave normalizada.
 * 3) Adicionar diagnóstico de volumes para o usuário validar se o número está coerente.
 *
 * Motivo:
 * - A tela parecia travada no cálculo porque o estado carregandoSimulacao não era ligado no onSimularRealizado.
 * - Origem cadastrada como Itajaí/Itajai pode falhar se o filtro SQL usar comparação textual sensível a acento.
 * - Volumes podem parecer altos; antes de alterar regra de negócio, mostramos média por CT-e e frete por volume.
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

// 1) Origem/destino: não filtrar no SQL com texto sensível a acento.
substituir(
`  if (filtros.origem) query = query.ilike('cidade_origem', filtros.origem + '%');
  if (filtros.destino) query = query.ilike('cidade_destino', filtros.destino + '%');`,
`  // Origem/destino são filtrados depois em JavaScript com normalização sem acento.
  // Isso evita falha entre Itajaí/Itajai e outros casos de acentuação.
  // if (filtros.origem) query = query.ilike('cidade_origem', filtros.origem + '%');
  // if (filtros.destino) query = query.ilike('cidade_destino', filtros.destino + '%');`,
  'remove filtro SQL sensível a acento para origem/destino'
);

// 2) Preparar retorno mapeado para filtro local.
substituir(
`  const rows = allRows.slice(0, totalMax);
  return rows.map(r => ({`,
`  const rows = allRows.slice(0, totalMax);
  let mapeados = rows.map(r => ({`,
  'prepara mapeados para filtro local normalizado'
);

substituir(
`    tipo_veiculo: pickRealizadoField(r, ['tipo_veiculo', 'tipoVeiculo', 'veiculo', 'tipo']) || '',
  }));
}`,
`    tipo_veiculo: pickRealizadoField(r, ['tipo_veiculo', 'tipoVeiculo', 'veiculo', 'tipo']) || '',
  }));

  const origemFiltro = String(filtros.origem || '').trim();
  if (origemFiltro) {
    const origemNorm = normalizarChaveSimulador(origemFiltro);
    mapeados = mapeados.filter((row) => normalizarChaveSimulador(row.cidadeOrigem || '').startsWith(origemNorm));
  }

  const destinoFiltro = String(filtros.destino || '').trim();
  if (destinoFiltro) {
    const destinoNorm = normalizarChaveSimulador(destinoFiltro);
    mapeados = mapeados.filter((row) => normalizarChaveSimulador(row.cidadeDestino || '').startsWith(destinoNorm));
  }

  return mapeados;
}`,
  'aplica filtro local sem acento em origem/destino'
);

// 3) Liga estado de cálculo no Simular / Calcular.
substituir(
`  const onSimularRealizado = async () => {
    if (!transportadoraRealizado) {
      setErroSimulacao('Selecione a transportadora/tabela que será simulada no realizado.');
      return;
    }

    setFiltroDetalhe('');`,
`  const onSimularRealizado = async () => {
    if (!transportadoraRealizado) {
      setErroSimulacao('Selecione a transportadora/tabela que será simulada no realizado.');
      return;
    }

    setCarregandoSimulacao(true);
    setFiltroDetalhe('');`,
  'liga carregandoSimulacao no cálculo'
);

substituir(
`    iniciarProcessamentoUi('Simulador do realizado', 'Carregando vínculos, CT-es e tabelas...', 8);`,
`    iniciarProcessamentoUi('Simular / Calcular', 'Calculando sobre a base de CT-es já pesquisada...', 8);`,
  'mensagem visual específica para cálculo'
);

substituir(
`    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao simular realizado.');
      finalizarProcessamentoUi('Erro na simulação do realizado', 'Não foi possível gerar o dossiê.', 100);
    }
  };`,
`    } catch (error) {
      setErroSimulacao(error.message || 'Erro ao simular realizado.');
      finalizarProcessamentoUi('Erro na simulação do realizado', 'Não foi possível gerar o dossiê.', 100);
    } finally {
      setCarregandoSimulacao(false);
    }
  };`,
  'desliga carregandoSimulacao ao finalizar cálculo'
);

// 4) Diagnóstico de volumes no resumo da pesquisa.
substituir(
`      volumes,
      transportadorasRealizadas: transportadorasRealizadas.size,`,
`      volumes,
      volumeMedioPorCte: rowsBase.length ? volumes / rowsBase.length : 0,
      fretePorVolume: volumes ? valorCte / volumes : 0,
      alertaVolumes: volumes && rowsBase.length && (volumes / rowsBase.length > 8 || (valorCte / volumes) < 5)
        ? 'Atenção: volumes parecem fora do padrão. Verifique se o Tracking não está duplicando volumes por NF/CT-e.'
        : '',
      transportadorasRealizadas: transportadorasRealizadas.size,`,
  'adiciona diagnóstico de volumes no resumo da pesquisa'
);

substituir(
`                <div><span>Volumes</span><strong>{Number(resumoPesquisaRealizado.volumes || 0).toLocaleString('pt-BR')}</strong></div>
                <div><span>Origens</span><strong>{resumoPesquisaRealizado.origens}</strong></div>`,
`                <div><span>Volumes</span><strong>{Number(resumoPesquisaRealizado.volumes || 0).toLocaleString('pt-BR')}</strong></div>
                <div><span>Vol./CT-e</span><strong>{Number(resumoPesquisaRealizado.volumeMedioPorCte || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</strong></div>
                <div><span>Frete/volume</span><strong>{Number(resumoPesquisaRealizado.fretePorVolume || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div>
                <div><span>Origens</span><strong>{resumoPesquisaRealizado.origens}</strong></div>`,
  'mostra volume médio e frete por volume no painel'
);

const alertaVolumesUi = `
              {resumoPesquisaRealizado.alertaVolumes && (
                <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: 10, padding: '10px 12px', fontWeight: 700 }}>
                  ⚠️ {resumoPesquisaRealizado.alertaVolumes}
                </div>
              )}
`;
if (!src.includes('resumoPesquisaRealizado.alertaVolumes') && src.includes(`              {(resumoPesquisaRealizado.preview || []).length > 0 && (`)) {
  src = src.replace(`              {(resumoPesquisaRealizado.preview || []).length > 0 && (`, `${alertaVolumesUi}
              {(resumoPesquisaRealizado.preview || []).length > 0 && (`);
  alterou = true;
  console.log('OK  insere alerta visual de volumes');
} else if (src.includes('resumoPesquisaRealizado.alertaVolumes')) {
  console.log('SKIP alerta visual de volumes já aplicado');
} else {
  console.warn('WARN ponto para alerta de volumes não encontrado');
}

// 5) Diagnóstico de volumes no resultado final.
substituir(
`           volumesTracking: trackingEnriquecido.volumesTracking,
           cubagemTracking: trackingEnriquecido.cubagemTracking,`,
`           volumesTracking: trackingEnriquecido.volumesTracking,
           volumeMedioPorCte: rowsComIbge.length ? (rowsComIbge.reduce((acc, row) => acc + (Number(row.qtdVolumes || 0)), 0) / rowsComIbge.length) : 0,
           fretePorVolume: rowsComIbge.reduce((acc, row) => acc + (Number(row.qtdVolumes || 0)), 0) ? rowsComIbge.reduce((acc, row) => acc + (Number(row.valorCte || 0)), 0) / rowsComIbge.reduce((acc, row) => acc + (Number(row.qtdVolumes || 0)), 0) : 0,
           cubagemTracking: trackingEnriquecido.cubagemTracking,`,
  'adiciona diagnóstico de volumes no resultado final'
);

if (alterou) {
  fs.writeFileSync(arquivo, src, 'utf8');
  console.log('\nPrompt 4.11 aplicado no SimuladorPage.jsx.');
} else {
  console.log('\nPrompt 4.11 já estava aplicado ou não encontrou trechos-alvo.');
}
