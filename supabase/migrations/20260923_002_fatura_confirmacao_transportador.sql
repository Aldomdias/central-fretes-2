-- Confirmacao da fatura pelo fornecedor/transportador direto pelo laudo
-- (consolidado ou por lote): gera um link com token, a transportadora clica
-- "OK, confirmo esta fatura" e o status muda sozinho — sem passar pelo fluxo
-- manual de resposta/validacao usado no portal de CT-es (auditoria_cte_portal_*).
-- Caminho de acompanhamento: null -> ENVIADO (link gerado) -> APROVADO (clicou OK).
alter table public.faturas
  add column if not exists confirmacao_transportador_status text,
  add column if not exists confirmacao_transportador_token text,
  add column if not exists confirmacao_transportador_em timestamptz,
  add column if not exists confirmacao_transportador_por text,
  add column if not exists confirmacao_transportador_enviado_em timestamptz;

create unique index if not exists faturas_confirmacao_transportador_token_idx
  on public.faturas (confirmacao_transportador_token)
  where confirmacao_transportador_token is not null;
