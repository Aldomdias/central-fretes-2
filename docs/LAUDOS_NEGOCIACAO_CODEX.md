# Laudos de Negociação — Executivo e Devolutiva Transportador

Esta entrega adiciona a base reutilizável para gerar devolutivas bonitas e padronizadas no sistema, sem alterar as regras de cálculo de frete.

## Arquivos adicionados

- `src/utils/laudosNegociacaoHtml.js`
- `src/components/laudos/LaudoNegociacaoTemplate.jsx`
- `src/components/laudos/LaudoNegociacaoTemplate.css`
- `src/components/laudos/index.js`
- `src/services/laudosNegociacaoService.js`

## O que cada arquivo faz

### `src/utils/laudosNegociacaoHtml.js`

Transforma o resultado da simulação em um objeto padronizado para laudo.

Entrada principal:

```js
montarDadosLaudoNegociacao(resultadoRealizado, {
  transportadora,
  canal,
  origem,
  periodo,
})
```

Saída principal:

```js
{
  geradoEm,
  transportadora,
  canal,
  origem,
  periodo,
  ctesAnalisados,
  ctesComTabela,
  ctesGanharia,
  ctesPerderia,
  freteRealizado,
  freteTabela,
  freteVencedor,
  faturamentoMensal,
  faturamentoAnual,
  savingMensal,
  savingAnual,
  diferencaTotal,
  diferencaPercentual,
  impactoMensal,
  impactoAnual,
  aderencia,
  reducaoMediaNecessaria,
  rotasCriticas,
  rotasCompetitivas,
  resumoRotas,
  textoTransportador,
  textoExecutivo
}
```

### `src/components/laudos/LaudoNegociacaoTemplate.jsx`

Componente visual para renderizar o laudo.

Uso para transportador:

```jsx
import { LaudoNegociacaoTemplate } from '../components/laudos';

<LaudoNegociacaoTemplate
  tipo="transportador"
  resultado={resultadoRealizado}
/>
```

Uso executivo:

```jsx
<LaudoNegociacaoTemplate
  tipo="executivo"
  resultado={resultadoRealizado}
/>
```

### `src/services/laudosNegociacaoService.js`

Salva os dois laudos no Supabase dentro de `resumo_simulacao.laudos` da tabela em negociação.

Uso:

```js
import { salvarLaudosNegociacao } from '../services/laudosNegociacaoService';

await salvarLaudosNegociacao(negociacaoSelecionadaRealizado.id, resultadoRealizado, {
  transportadora: resultadoRealizado.filtros?.transportadora,
  canal: resultadoRealizado.filtros?.canal,
  origem: resultadoRealizado.filtros?.origem,
});
```

Estrutura salva:

```js
resumo_simulacao: {
  ...resumoAnterior,
  laudos: {
    executivo: {
      tipo: 'executivo',
      versao: 1,
      gerado_em,
      dados,
      texto_email,
      origem_template: 'LaudoNegociacaoTemplate'
    },
    transportador: {
      tipo: 'transportador',
      versao: 1,
      gerado_em,
      dados,
      texto_email,
      origem_template: 'LaudoNegociacaoTemplate'
    }
  },
  historico_rodadas: [
    ...historicoAnterior,
    {
      tipo_registro: 'LAUDOS_GERADOS',
      resumo: {
        transportadora,
        canal,
        periodo,
        ctes_analisados,
        aderencia,
        rotas_criticas,
        rotas_competitivas
      }
    }
  ]
}
```

## Integração recomendada no `SimuladorPage.jsx`

O arquivo `SimuladorPage.jsx` da branch `Codex` já possui:

- `resultadoRealizado`
- `laudosEmailRealizado`
- `negociacaoSelecionadaRealizado`
- `salvarResultadoNegociacaoRealizado`
- abas de laudo (`abaLaudoRealizado`)
- exportações para diretoria e transportadora

Para ativar o novo template visual dentro da tela, adicionar os imports:

```js
import { LaudoNegociacaoTemplate } from '../components/laudos';
import { salvarLaudosNegociacao } from '../services/laudosNegociacaoService';
```

Adicionar estado para abrir modal/visualização:

```js
const [laudoVisualAberto, setLaudoVisualAberto] = useState(null); // 'executivo' | 'transportador' | null
const [salvandoLaudosVisuais, setSalvandoLaudosVisuais] = useState(false);
```

Adicionar função para salvar os laudos:

```js
const salvarLaudosVisuaisNegociacao = async () => {
  if (!negociacaoSelecionadaRealizado?.id || !resultadoRealizado) return;

  setSalvandoLaudosVisuais(true);
  setErroSimulacao('');

  try {
    await salvarLaudosNegociacao(negociacaoSelecionadaRealizado.id, resultadoRealizado, {
      transportadora: resultadoRealizado.filtros?.transportadora,
      canal: resultadoRealizado.filtros?.canal,
      origem: resultadoRealizado.filtros?.origem,
    });
    alert('Laudos executivo e transportador salvos na negociação.');
  } catch (error) {
    setErroSimulacao(error.message || 'Erro ao salvar laudos na negociação.');
  } finally {
    setSalvandoLaudosVisuais(false);
  }
};
```

No bloco onde `resultadoRealizado` é exibido, adicionar botões próximos aos botões já existentes de exportação/laudo:

```jsx
<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
  <button className="sim-tab" type="button" onClick={() => setLaudoVisualAberto('executivo')}>
    Ver Laudo Executivo
  </button>
  <button className="sim-tab" type="button" onClick={() => setLaudoVisualAberto('transportador')}>
    Ver Devolutiva Transportador
  </button>
  <button
    className="sim-tab"
    type="button"
    onClick={salvarLaudosVisuaisNegociacao}
    disabled={!negociacaoSelecionadaRealizado?.id || salvandoLaudosVisuais}
  >
    {salvandoLaudosVisuais ? 'Salvando laudos...' : 'Salvar laudos na negociação'}
  </button>
</div>
```

Adicionar o modal/render abaixo do bloco principal do resultado:

```jsx
{laudoVisualAberto && resultadoRealizado && (
  <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.72)', zIndex: 9999, overflow: 'auto', padding: 24 }}>
    <div style={{ maxWidth: 1060, margin: '0 auto', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="sim-tab" type="button" onClick={() => window.print()}>
          Imprimir / PDF
        </button>
        <button className="sim-tab" type="button" onClick={() => setLaudoVisualAberto(null)}>
          Fechar
        </button>
      </div>
      <LaudoNegociacaoTemplate
        tipo={laudoVisualAberto}
        resultado={resultadoRealizado}
      />
    </div>
  </div>
)}
```

## Integração recomendada no `TabelasNegociacaoPage.jsx`

A página pode exibir laudos salvos lendo:

```js
const laudos = tabela?.resumo_simulacao?.laudos || {};
```

Para abrir laudo salvo:

```jsx
{laudos.executivo && (
  <button className="sim-tab" type="button" onClick={() => setLaudoSalvo({ tipo: 'executivo', dados: laudos.executivo.dados })}>
    Abrir Laudo Executivo
  </button>
)}

{laudos.transportador && (
  <button className="sim-tab" type="button" onClick={() => setLaudoSalvo({ tipo: 'transportador', dados: laudos.transportador.dados })}>
    Abrir Devolutiva Transportador
  </button>
)}
```

Render:

```jsx
{laudoSalvo && (
  <LaudoNegociacaoTemplate
    tipo={laudoSalvo.tipo}
    dados={laudoSalvo.dados}
  />
)}
```

## Observações importantes

- O template de transportador não usa a palavra `saving` no texto principal.
- O template executivo pode usar saving, impacto mensal/anual e recomendação estratégica.
- O salvamento não cria tabela nova; usa `resumo_simulacao.laudos`.
- O histórico recebe `tipo_registro: 'LAUDOS_GERADOS'`.
- Não foram alteradas regras de cálculo de frete.
- Recomenda-se rodar `npm run build` após integrar os botões no `SimuladorPage.jsx` e `TabelasNegociacaoPage.jsx`.
