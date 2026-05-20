Correção: CPS LOG ainda aparecia no Simulador Realizado porque o filtro rodava antes da aplicação dos vínculos de transportadoras.

Ajuste aplicado em src/pages/SimuladorPage.jsx:
- Mantém CPS LOG excluído por padrão.
- Filtra CPS LOG antes da aplicação dos vínculos.
- Filtra novamente depois dos vínculos, pois uma transportadora pode virar CPS LOG após o mapa de vínculos.
- Filtra novamente depois do cruzamento com Tracking, antes de montar a base simulada.
- CPS LOG só entra quando a opção "Incluir CPS LOG nesta análise" estiver marcada.

Aplicação:
unzip -o fix-simulador-cps-log-pos-vinculo.zip
npm run build
git restore dist && git clean -fd dist/assets
git add src/pages/SimuladorPage.jsx
git commit -m "fix: remover CPS LOG apos vinculo no simulador"
git push origin main
