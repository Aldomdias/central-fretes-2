# Configuração do banco no Supabase

1. Crie um projeto no Supabase.
2. Abra **SQL Editor** e execute o arquivo `supabase/schema.sql`.
3. Em **Project Settings > API**, copie:
   - `Project URL`
   - `anon public key`
4. Crie um arquivo `.env` na raiz do projeto com base no `.env.example`.
5. Rode o projeto novamente.

## O que já passa a gravar

- Snapshot completo dos cadastros: `cadastros_snapshot`
- Histórico de importações: `frete_importacoes`

## Como confirmar que está funcionando

- no dashboard, o card de persistência deve mostrar **Modo: Supabase**
- ao importar arquivos, a importação passa a ser registrada no banco
- ao alterar cadastros/origens/rotas/generalidades, a base sincroniza automaticamente
