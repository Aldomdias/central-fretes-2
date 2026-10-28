-- Flag de contingencia do Robo Auditor: ligada, o robo nao exige entrega dos CT-es (grava baixa aprovada
-- "Liberado em contingencia"). Desligada, volta a exigir a entrega.
alter table public.auditor_robo_config
  add column if not exists liberar_entrega_contingencia boolean not null default false;
