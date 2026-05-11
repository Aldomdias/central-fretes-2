# Correção do Simulador - Origem/Destino e IBGE

Aplicar estes arquivos sobre a versão `central-fretes-2-vers-o-claude`.

## Arquivos alterados

- `src/services/freteDatabaseService.js`
- `src/utils/calculoFrete.js`
- `src/pages/SimuladorPage.jsx`

## O que foi corrigido

1. O simulador da versão cloud/claude estava usando `ibge_origem` como filtro rígido.
   Quando a rota não tinha `ibge_origem` preenchido, a base retornava vazia e a simulação não acontecia.

2. A lógica agora usa o IBGE quando ele existe, mas mantém o fallback por nome da origem igual à versão `main`, que estava funcionando.

3. A busca da base no Supabase agora une duas estratégias:
   - origem por nome/cidade;
   - origem por IBGE da rota, quando existir.

4. A simulação em tela também deixou de eliminar rotas antigas sem `ibgeOrigem`.

5. Corrigido estado interno da tela: ao trocar transportadora ou canal, o IBGE da origem anterior é limpo para não contaminar a próxima simulação.

6. Corrigido erro potencial na análise por origem, onde a versão claude podia referenciar `ibgeOrigemFiltro` sem declarar.

## Validação

Build executado com sucesso:

```bash
npm run build
```

Resultado: `✓ built`.
