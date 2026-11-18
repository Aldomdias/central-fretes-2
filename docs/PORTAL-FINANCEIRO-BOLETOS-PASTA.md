# Portal Financeiro — leitura da pasta de boletos

## Como o acesso funciona
- A pasta é escolhida pelo usuário no painel **Boletos pendentes → Ler pasta**, pelo seletor de pasta do navegador
  (`input webkitdirectory`). O navegador só enxerga o que o usuário seleciona; **não há credencial de rede nem
  acesso do servidor à pasta**. Pasta de rede só funciona se estiver montada/acessível na máquina do usuário.
- A cópia dos boletos para a pasta de rede (`utils/pastaRede.js`) usa `showDirectoryPicker` (Chrome/Edge) e exige
  permissão de escrita concedida pelo usuário a cada sessão.
- Leitura automática sem o usuário (agendada) **não existe**: exigiria um robô na máquina com acesso à pasta.

## Leitura incremental
1. Casa os arquivos por nome (`<número> - <transportadora>.pdf`) com as faturas que aguardam boleto.
2. Calcula o SHA-256 de cada arquivo casado.
3. Hash já gravado em `boleto_arquivo_versoes` → **reaproveita** valor, vencimento e linha digitável (não reabre o PDF/OCR).
4. Hash novo (arquivo novo ou alterado) → lê o PDF; sem texto reconhecível, OCR local (Tesseract, sem enviar a terceiros).
5. Boleto ilegível nunca vira cache: é relido na próxima passada e fica visível como divergente.
6. A execução é registrada em `boleto_pasta_leituras` (total, novos, repetidos, falha). Falha preserva os vínculos anteriores.
7. A versão é única por (fatura, conteúdo). Se o controle da fatura já aponta para o mesmo arquivo, nada é regravado
   (idempotente); se o controle foi desfeito, ele é refeito reaproveitando o PDF já guardado.

## Regras de vínculo
Vínculo automático só com referência inequívoca + CNPJ + valor + vencimento coincidentes e candidato único
(`vincularBoletosLidos`). Ambíguo, divergente ou ilegível vai para confirmação manual. PDFs antigos só são apagados
após pagamento confirmado.

## Pendente
- Migration `supabase/migrations/20261118_002_portal_financeiro_diagnostico.sql` (colunas em `faturas` e tabelas
  `financeiro_*`, `sap_estornos_fatura`, `boleto_arquivo_versoes`, `boleto_pasta_leituras`): **não aplicada** no
  Supabase hospedado. O código tolera a ausência (baixa SAP, protocolo, previsão e estorno seguem sem a evidência nova).
- Casamento por nome ainda é a porta de entrada; o conteúdo do PDF (CNPJ do beneficiário) não é usado para achar fatura sem nome padronizado.
