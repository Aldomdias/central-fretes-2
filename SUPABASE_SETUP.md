# Setup Supabase

1. Abra o SQL Editor do Supabase.
2. Rode o conteúdo de `supabase/schema.sql`.
3. Confirme as variáveis no `.env`:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Como ficou agora

- A base oficial do sistema é o Supabase.
- As tabelas operacionais são:
  - `transportadoras`
  - `origens`
  - `generalidades`
  - `rotas`
  - `cotacoes`
  - `taxas_especiais`
- `cadastros_snapshot` continua sendo usado como backup do estado completo.
- `frete_importacoes` continua disponível para histórico de importações.

## Observação importante

A sincronização atual salva a base completa nas tabelas relacionais sempre que o cadastro muda. Para manter consistência, ela regrava as tabelas operacionais inteiras a cada sincronização.
