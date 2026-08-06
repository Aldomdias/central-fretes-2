# Ativar digital / Windows Hello

A implementação usa passkeys do Supabase Auth. A impressão digital nunca é enviada para a aplicação; Windows Hello ou o autenticador do dispositivo protege a chave privada.

## 1. Migrar os usuários existentes

Use a `service_role` apenas em um terminal administrativo. Nunca coloque essa chave em `.env` publicado nem em variável `VITE_*`.

```powershell
$env:SUPABASE_URL='https://SEU-PROJETO.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY='SUA-CHAVE-SERVICE-ROLE'
node scripts/migrar-usuarios-passkeys.mjs
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

O script cria/atualiza no Supabase Auth as contas ativas de `usuarios_central`. Senhas com menos de 6 caracteres são ignoradas e precisam ser alteradas antes da migração.

## 2. Ativar Passkeys no Supabase

No Dashboard, abra **Authentication > Passkeys**:

- habilite Passkey authentication;
- nome: `Central de Fretes`;
- RP ID: o domínio do sistema, sem `https://`;
- Origins: as URLs HTTPS exatas usadas pelo sistema.

Não altere o RP ID depois que as digitais forem cadastradas, pois isso invalida as passkeys existentes.

## 3. Cadastrar no sistema

O usuário entra uma vez com e-mail e senha. Em **Alterar senha**, escolhe **Cadastrar digital neste computador**. Depois disso, a tela inicial apresenta **Entrar com digital / Windows Hello**.

Máquinas sem WebAuthn, sem HTTPS ou sem Windows Hello continuam usando e-mail e senha.

> O suporte a passkeys do Supabase está marcado como experimental. Antes de atualizar `@supabase/supabase-js`, valide novamente o fluxo em homologação.
