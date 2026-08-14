-- Contingência parcial: permite liberar só alguns perfis durante a
-- manutenção (ex.: Gestão, Auditoria de Fretes, Negociação de Fretes),
-- deixando o resto bloqueado, em vez de bloquear todo mundo.
alter table sistema_manutencao
  add column if not exists perfis_liberados text[];
