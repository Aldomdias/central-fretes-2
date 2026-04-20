# Setup Supabase - passo a passo

## 1) Rodar o schema
No Supabase, abra **SQL Editor** e rode o arquivo:

- `supabase/schema.sql`

## 2) Criar o arquivo `.env`
Na raiz do projeto, no mesmo nível do `package.json`, crie um arquivo chamado:

- `.env`

Cole exatamente isto dentro dele:

```env
VITE_SUPABASE_URL=https://kvzclgsifzklxexysktw.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_H2ppjz1T0oVDBm14cOA5aw_HZrQcoqM
```

## 3) Se estiver usando Vercel
No projeto da Vercel, adicione em **Settings > Environment Variables**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Com os mesmos valores acima.

## 4) Arquivos deste pacote
Substitua/adicione estes arquivos no projeto:

- `src/lib/supabaseClient.js`
- `src/services/freteDatabaseService.js`
- `src/data/store.js`
- `src/pages/DashboardPage.jsx`
- `src/pages/ImportacaoPage.jsx`
- `supabase/schema.sql`
- `.env.example`

## 5) Depois disso
Rode/deploye novamente o projeto.

Com isso, o sistema já fica pronto para:
- salvar snapshot dos cadastros
- registrar importações
- sincronizar com o Supabase
