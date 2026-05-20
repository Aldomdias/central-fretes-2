Ajuste: CPS LOG excluído por padrão em qualquer modo do Simulador Realizado.

Arquivo alterado:
- src/pages/SimuladorPage.jsx

Regras:
- Base padrão continua: Somente CT-es com Tracking vinculado.
- CPS LOG fica fora por padrão, mesmo se tiver Tracking.
- CPS LOG só entra quando marcar: "Incluir CPS LOG nesta análise".
- Mantém correção do status vencedor vs realizado.

Build validado com sucesso via npm run build.
