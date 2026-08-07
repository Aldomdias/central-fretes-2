drop index if exists public.idx_realizado_local_saving_transportadora_data;

alter function public.saving_pos_aprovacao_fluxos(text[], text, text[], date, date, integer, numeric[])
  set search_path = public, pg_temp;
