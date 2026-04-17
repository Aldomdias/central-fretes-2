# Setup do banco (Supabase)

1. Crie um projeto no Supabase.
2. Abra o SQL Editor e rode o arquivo `supabase/schema.sql`.
3. Em `Project Settings > API`, copie:
   - `Project URL`
   - `anon public key`
4. No projeto frontend, crie um arquivo `.env` na raiz com base no `.env.example`.
5. Reinicie o `npm run dev` ou faça novo deploy.
6. No app, importe uma base pequena e valide se a sincronização ocorre sem erro.

## O que esse schema cria
- `cadastros_snapshot`: guarda o snapshot completo do cadastro/simulador.
- `frete_importacoes`: registra histórico das importações.

## Observação
Esse primeiro passo grava o snapshot inteiro da base no banco. Na próxima etapa, a gente pode normalizar em tabelas separadas (transportadoras, origens, rotas, cotações e taxas) sem mexer no layout.
