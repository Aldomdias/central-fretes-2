create index if not exists idx_centros_filiais_cidade_chave on public.centros_filiais (cidade_chave);
create index if not exists idx_transportadora_centros_raiz on public.transportadora_centros_verum (cnpj_raiz_transportadora);
create index if not exists idx_origens_codigo_centro on public.origens (codigo_centro) where codigo_centro is not null;
alter table public.centros_filiais enable row level security;
alter table public.transportadora_centros_verum enable row level security;
drop policy if exists centros_filiais_leitura on public.centros_filiais;
create policy centros_filiais_leitura on public.centros_filiais for select to anon, authenticated using (true);
drop policy if exists transportadora_centros_verum_leitura on public.transportadora_centros_verum;
create policy transportadora_centros_verum_leitura on public.transportadora_centros_verum for select to anon, authenticated using (true);
grant select on public.centros_filiais, public.transportadora_centros_verum to anon, authenticated;
with candidatos as (
  select o.id, min(c.cnpj) as cnpj, min(c.cnpj_raiz) as cnpj_raiz, min(c.codigo_centro) as codigo_centro
  from public.origens o
  join public.transportadoras t on t.id = o.transportadora_id
  join public.transportadora_centros_verum v on v.cnpj_raiz_transportadora = t.cnpj_raiz
  join public.centros_filiais c on c.codigo_centro = v.codigo_centro
  where nullif(o.cnpj, '') is null
    and c.cidade_chave = trim(regexp_replace(upper(translate(o.cidade, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '[^A-Z0-9]+', ' ', 'g'))
  group by o.id
  having count(distinct c.cnpj) = 1
)
update public.origens o set cnpj=c.cnpj, cnpj_raiz=c.cnpj_raiz, codigo_centro=c.codigo_centro from candidatos c where o.id=c.id;
