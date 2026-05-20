Correção completa — SimuladorPage.jsx

Arquivo incluído:
- src/pages/SimuladorPage.jsx

Ajustes:
- Mantém a base padrão do Simulador Realizado como "Somente CT-es com Tracking vinculado".
- Corrige status/vencedores para não marcar como ganho quando a tabela está acima do realizado.
- Renomeia a leitura do ranking para "Melhor tabela simulada" quando aplicável.

Aplicar na raiz do projeto:
unzip -o fix-vencedores-realizado-completo.zip
npm run build
git restore dist && git clean -fd dist/assets
git add src/pages/SimuladorPage.jsx
git commit -m "fix: corrigir status vencedor vs realizado"
git push origin main
