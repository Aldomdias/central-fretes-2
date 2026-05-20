Ajuste: Simulador Realizado - UF destino com múltipla seleção

Arquivo alterado:
- src/pages/SimuladorPage.jsx

O que muda:
- UF destino deixa de ser seleção única e vira seletor com checkboxes.
- Permite selecionar 1, 2, 3 ou mais UFs, ou deixar Todas.
- A busca de CT-es no realizado filtra por todas as UFs selecionadas.
- A busca da base/tabelas no Supabase também respeita as UFs selecionadas.
- Mantém as melhorias anteriores: opções avançadas recolhidas, base por Tracking, CPS LOG excluído por padrão, visão de negociação e tratamento de cubagem outlier.

Build validado com npm run build.
