-- Impede que o mesmo desconto seja reimportado quando versões diferentes do
-- importador calcularem hashes técnicos distintos para a mesma linha.
create unique index if not exists uq_fin_desc_legado_origem_natural
  on public.financeiro_descontos_enviados_legado (arquivo_origem, numero_fatura, desconto_enviado);
