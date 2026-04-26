# Patch - Importar Template

Substituir o arquivo abaixo no projeto:

src/utils/importadorTemplatePadrao.js

Correções:
- Leitura correta do template de fretes com 1 linha de cabeçalho.
- Mantém compatibilidade com template de 2 linhas de cabeçalho.
- Corrige identificação de CAPITAL / INTERIOR / METROPOLITANA.
- Corrige faixas normais: 0 a 2, 2 a 5, 5 a 10 etc.
- Corrige faixa excedente: Acima de 100 kg / maior que 100 / >100.
- Preenche taxaAplicada com o valor do frete lido.
- Não pula mais a primeira linha de frete.
