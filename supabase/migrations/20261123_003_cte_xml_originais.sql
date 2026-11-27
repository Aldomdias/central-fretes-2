-- XML ORIGINAL dos CT-es importados (para enviar depois ao OMS da Verum).
-- O OMS so aceita o arquivo original, com a assinatura do emitente: guardamos os bytes sem alterar
-- (Base64 do arquivo lido), nunca o XML remontado. Contem dados de pessoas: mesmo acesso das demais tabelas do app.
create table if not exists public.cte_xml_originais (
  chave_cte text primary key,
  numero_cte text,
  serie_cte text,
  cnpj_emissor text,
  tem_protocolo boolean not null default false,   -- tem protCTe (cteProc autorizado); sem ele o OMS recusa NOT_AUTHORIZED_CTE
  nome_arquivo text,
  tamanho_bytes integer,
  xml_base64 text not null,
  enviado_oms_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cte_xml_originais_numero_idx on public.cte_xml_originais (numero_cte, cnpj_emissor);

alter table public.cte_xml_originais enable row level security;
drop policy if exists "central_fretes_access" on public.cte_xml_originais;
create policy "central_fretes_access" on public.cte_xml_originais for all to anon, authenticated using (true) with check (true);
