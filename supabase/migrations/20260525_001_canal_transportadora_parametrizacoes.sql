-- Parametrizacao manual e resolucao central de canal por transportadora.
-- Nao altera RLS/policies. Aplique conscientemente no ambiente desejado.

create or replace function public.normalizar_nome_transportadora(p_nome text)
returns text
language sql
immutable
as $$
  select nullif(
    btrim(regexp_replace(
      upper(translate(coalesce(p_nome, ''), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),
      '[^A-Z0-9]+',
      ' ',
      'g'
    )),
    ''
  )
$$;

create table if not exists public.canal_transportadora_parametrizacoes (
  id bigserial primary key,
  transportadora text not null,
  transportadora_normalizada text not null unique,
  canal text not null check (canal in ('ATACADO', 'B2C', 'INTERCOMPANY', 'REVERSA')),
  origem text not null default 'manual',
  usuario text,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_canal_transportadora_param_norm
  on public.canal_transportadora_parametrizacoes (transportadora_normalizada);

alter table public.realizado_local_ctes add column if not exists canal_original text;
alter table public.tracking_rows add column if not exists canal_original text;
alter table public.tracking_rows add column if not exists valor_cte numeric default 0;

create or replace function public.resolver_canal_transportadora(
  p_transportadora text,
  p_canal_original text default null
)
returns text
language plpgsql
stable
as $$
declare
  v_norm text := public.normalizar_nome_transportadora(p_transportadora);
  v_canal text;
begin
  if v_norm is null then
    return 'A DEFINIR';
  end if;

  select ctp.canal
    into v_canal
  from public.canal_transportadora_parametrizacoes ctp
  where ctp.transportadora_normalizada = v_norm
  limit 1;

  if v_canal is not null then
    return v_canal;
  end if;

  select upper(nullif(btrim(o.canal), ''))
    into v_canal
  from public.transportadora_vinculos v
  join public.transportadoras t
    on public.normalizar_nome_transportadora(t.nome) = public.normalizar_nome_transportadora(v.nome_tabela)
  join public.origens o
    on o.transportadora_id = t.id
  where public.normalizar_nome_transportadora(v.nome_cte) = v_norm
    and nullif(btrim(o.canal), '') is not null
  order by o.id desc
  limit 1;

  if v_canal is not null then
    return case
      when v_canal like '%INTERCOMPANY%' then 'INTERCOMPANY'
      when v_canal like '%REVERSA%' then 'REVERSA'
      when v_canal like '%B2C%' then 'B2C'
      when v_canal like '%ATACADO%' or v_canal like '%B2B%' then 'ATACADO'
      else v_canal
    end;
  end if;

  select upper(nullif(btrim(o.canal), ''))
    into v_canal
  from public.transportadoras t
  join public.origens o
    on o.transportadora_id = t.id
  where public.normalizar_nome_transportadora(t.nome) = v_norm
    and nullif(btrim(o.canal), '') is not null
  order by o.id desc
  limit 1;

  if v_canal is not null then
    return case
      when v_canal like '%INTERCOMPANY%' then 'INTERCOMPANY'
      when v_canal like '%REVERSA%' then 'REVERSA'
      when v_canal like '%B2C%' then 'B2C'
      when v_canal like '%ATACADO%' or v_canal like '%B2B%' then 'ATACADO'
      else v_canal
    end;
  end if;

  return 'A DEFINIR';
end;
$$;

create or replace function public.aplicar_canal_transportadora_row()
returns trigger
language plpgsql
as $$
begin
  if new.canal_original is null or btrim(new.canal_original) = '' then
    new.canal_original := new.canal;
  end if;

  new.canal := public.resolver_canal_transportadora(new.transportadora, new.canal_original);
  return new;
end;
$$;

drop trigger if exists trg_resolver_canal_realizado_local_ctes on public.realizado_local_ctes;
create trigger trg_resolver_canal_realizado_local_ctes
before insert or update of transportadora, canal, canal_original
on public.realizado_local_ctes
for each row execute function public.aplicar_canal_transportadora_row();

drop trigger if exists trg_resolver_canal_tracking_rows on public.tracking_rows;
create trigger trg_resolver_canal_tracking_rows
before insert or update of transportadora, canal, canal_original
on public.tracking_rows
for each row execute function public.aplicar_canal_transportadora_row();

create or replace function public.aplicar_parametrizacao_canal_transportadora(
  p_transportadora text,
  p_canal text,
  p_usuario text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_norm text := public.normalizar_nome_transportadora(p_transportadora);
  v_ctes integer := 0;
  v_tracking integer := 0;
begin
  if v_norm is null then
    raise exception 'Transportadora obrigatoria';
  end if;
  if upper(p_canal) not in ('ATACADO', 'B2C', 'INTERCOMPANY', 'REVERSA') then
    raise exception 'Canal invalido: %', p_canal;
  end if;

  insert into public.canal_transportadora_parametrizacoes (
    transportadora, transportadora_normalizada, canal, usuario, updated_at
  )
  values (p_transportadora, v_norm, upper(p_canal), p_usuario, now())
  on conflict (transportadora_normalizada)
  do update set
    transportadora = excluded.transportadora,
    canal = excluded.canal,
    usuario = excluded.usuario,
    updated_at = now();

  update public.realizado_local_ctes
     set canal_original = coalesce(nullif(canal_original, ''), canal),
         canal = upper(p_canal)
   where public.normalizar_nome_transportadora(transportadora) = v_norm
     and coalesce(canal, '') = 'A DEFINIR';
  get diagnostics v_ctes = row_count;

  update public.tracking_rows
     set canal_original = coalesce(nullif(canal_original, ''), canal),
         canal = upper(p_canal)
   where public.normalizar_nome_transportadora(transportadora) = v_norm
     and coalesce(canal, '') = 'A DEFINIR';
  get diagnostics v_tracking = row_count;

  return jsonb_build_object('ok', true, 'ctes_atualizados', v_ctes, 'tracking_atualizados', v_tracking);
end;
$$;

create or replace view public.pendencias_canal_transportadora
with (security_invoker = true) as
with base as (
  select
    'CT-e'::text as base,
    transportadora,
    public.normalizar_nome_transportadora(transportadora) as transportadora_normalizada,
    canal_original,
    data_emissao::date as data_ocorrencia,
    1::numeric as qtd_cte,
    0::numeric as qtd_tracking,
    coalesce(valor_cte, 0)::numeric as valor_cte,
    coalesce(valor_nf, 0)::numeric as valor_nf,
    coalesce(peso, 0)::numeric as peso
  from public.realizado_local_ctes
  where coalesce(canal, '') = 'A DEFINIR'
  union all
  select
    'Tracking'::text as base,
    transportadora,
    public.normalizar_nome_transportadora(transportadora) as transportadora_normalizada,
    canal_original,
    data::date as data_ocorrencia,
    0::numeric as qtd_cte,
    1::numeric as qtd_tracking,
    coalesce(valor_cte, 0)::numeric as valor_cte,
    coalesce(valor_nf, 0)::numeric as valor_nf,
    coalesce(peso, 0)::numeric as peso
  from public.tracking_rows
  where coalesce(canal, '') = 'A DEFINIR'
)
select
  transportadora,
  transportadora_normalizada,
  max(canal_original) filter (where nullif(btrim(canal_original), '') is not null) as canal_original,
  'Sem tabela/vinculo cadastrado'::text as motivo,
  count(*)::bigint as quantidade_total,
  sum(qtd_cte)::bigint as quantidade_ctes,
  sum(qtd_tracking)::bigint as quantidade_tracking,
  sum(valor_cte)::numeric as valor_total_cte,
  sum(valor_nf)::numeric as valor_total_nf,
  sum(peso)::numeric as peso_total,
  min(data_ocorrencia) as primeira_ocorrencia,
  max(data_ocorrencia) as ultima_ocorrencia,
  string_agg(distinct base, ', ' order by base) as bases_afetadas
from base
where transportadora_normalizada is not null
group by transportadora, transportadora_normalizada;
