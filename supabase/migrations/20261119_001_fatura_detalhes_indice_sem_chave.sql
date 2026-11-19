-- Robo identificador de faturas: acha CT-e que ja esta em fatura importada so com o numero (linha sem chave).
-- Indice parcial pequeno (so as linhas sem chave) para a busca por numero nao estourar o tempo.
create index if not exists fatura_detalhes_numero_sem_chave_idx
  on public.fatura_detalhes (numero_cte)
  where chave_cte = '';

create index if not exists fatura_detalhes_chave_cte_idx
  on public.fatura_detalhes (chave_cte);
