Correção da tela Formatação de Tabelas em branco.

Erro corrigido:
criarVigenciaPadrao is not defined

Arquivo a ajustar:
src/utils/formatacaoTabela.js

O patch adiciona a função export function criarVigenciaPadrao() antes de limparTexto().

Como aplicar no terminal do projeto:
git apply fix-criar-vigencia-padrao.patch

Depois rode:
npm run build
