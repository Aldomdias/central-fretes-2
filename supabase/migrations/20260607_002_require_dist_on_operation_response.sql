-- 4.34C.1.1 - obriga DIST/viagem na resposta conclusiva da Operacao

update public.audit_solicitacoes_informacao
set
  status = 'AGUARDANDO_INFORMACAO',
  updated_at = now()
where status = 'RESPONDIDO_OPERACAO'
  and (
    nullif(btrim(dist), '') is null
    or nullif(btrim(dist_key), '') is null
    or nullif(btrim(carga_id), '') is null
    or nullif(btrim(resposta_operacao), '') is null
    or nullif(btrim(justificativa_operacao), '') is null
    or respondido_em is null
    or coalesce(
      nullif(btrim(respondido_por_id), ''),
      nullif(btrim(respondido_por_nome), ''),
      nullif(btrim(respondido_por_email), '')
    ) is null
  );

alter table public.audit_solicitacoes_informacao
  drop constraint if exists audit_sol_info_resposta_operacao_com_dist;

alter table public.audit_solicitacoes_informacao
  add constraint audit_sol_info_resposta_operacao_com_dist
  check (
    status <> 'RESPONDIDO_OPERACAO'
    or (
      nullif(btrim(dist), '') is not null
      and nullif(btrim(dist_key), '') is not null
      and nullif(btrim(carga_id), '') is not null
      and nullif(btrim(resposta_operacao), '') is not null
      and nullif(btrim(justificativa_operacao), '') is not null
      and respondido_em is not null
      and coalesce(
        nullif(btrim(respondido_por_id), ''),
        nullif(btrim(respondido_por_nome), ''),
        nullif(btrim(respondido_por_email), '')
      ) is not null
    )
  );
