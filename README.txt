Ajuste: Simulador Realizado com base padrão somente em CT-es com Tracking vinculado.

Arquivo alterado:
- src/pages/SimuladorPage.jsx

Como aplicar:
1) Extrair este ZIP na raiz do projeto central-fretes-2.
2) Rodar npm run build.
3) Commitar e enviar.

Comandos sugeridos:
unzip -o fix-base-tracking-simulador-completo.zip
npm run build
git restore dist && git clean -fd dist/assets
git add src/pages/SimuladorPage.jsx
git commit -m "feat: simular realizado somente com tracking por padrao"
git push origin main
