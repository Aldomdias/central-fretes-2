-- Portal de cotacao fracionado (tabela propria): 2 anexos obrigatorios por canal.
-- categoria: TABELA (tabela de frete), DESTINOS (cidade, rota, prazo e taxas por destino) ou GENERALIDADES (opcional).
-- leitura: pre-leitura feita no portal ao anexar ({cidade, rota, prazo, taxa, frete, linhas}).
-- Sem esta migration o portal funciona marcando "[DESTINOS] " no nome do arquivo.
alter table public.fracionado_anexos add column if not exists categoria text;
alter table public.fracionado_anexos add column if not exists leitura jsonb;
update public.fracionado_anexos set categoria = case when nome like '[DESTINOS] %' then 'DESTINOS' when nome like '[GENERALIDADES] %' then 'GENERALIDADES' else 'TABELA' end where categoria is null;
