# Especificação: Controle de Usuários, Perfis e Permissões

> Baseado no modelo implementado no Central Fretes. Descreve o COMPORTAMENTO desejado
> (regras de negócio de acesso), não a implementação original — o modelo original tem
> falhas de segurança (marcadas abaixo como ⚠️) que devem ser corrigidas na nova
> implementação, não replicadas.

## 1. Objetivo

Sistema de login e controle de acesso por telas/módulos, com:
- Autenticação por e-mail + senha.
- Perfis (roles) pré-definidos, cada um com um conjunto default de módulos liberados.
- Permissões granulares por usuário, que podem sobrepor o default do perfil (liberar
  menos ou mais módulos do que o perfil padrão).
- Um perfil de administração que gerencia os demais usuários.
- Vínculo opcional entre um usuário e uma entidade de negócio (ex.: "auditor
  responsável por uma carteira/cliente/transportadora").

## 2. Modelo de dados

### Tabela `usuarios`
| Campo | Tipo | Observação |
|---|---|---|
| id | uuid/pk | |
| nome | text | |
| email | text, unique | normalizar para lowercase no login/gravação |
| senha_hash | text | **hash (bcrypt/argon2), nunca texto puro** ⚠️ o sistema original grava senha em texto puro — não repetir |
| perfil | text/enum | chave do perfil (ver seção 3) |
| permissoes_paginas | jsonb | lista de chaves de módulos liberados para ESSE usuário; `["*"]` = acesso total |
| ativo | boolean | usuário inativo não consegue logar |
| criado_em / atualizado_em | timestamptz | |
| ultimo_login_em | timestamptz | |

### Catálogo de módulos (`MODULOS_SISTEMA`)
Lista fixa, mantida em código (não pelo usuário), de todas as telas do sistema:
```
{ chave: 'dashboard', label: 'Dashboard', grupo: 'Geral' }
{ chave: 'usuarios', label: 'Usuários', grupo: 'Administração', somenteAdmin: true }
...
```
Toda permissão (de perfil ou individual) é sempre filtrada contra esse catálogo, para
que nunca sobre uma chave de módulo "fantasma"/obsoleta em uma permissão salva.

### Perfis (`PERFIS_USUARIO`)
Dicionário fixo `{ chave: { nome, descricao, paginas: [...] } }`, onde `paginas` é a
lista default de chaves de módulo liberadas para esse perfil (ou `['*']` para acesso
total). Exemplos de perfis a adaptar por sistema: Gestão (`*`), Operação, Auditoria,
Financeiro, Consulta (somente leitura).

### Permissão efetiva de um usuário
```
permissoesEfetivas(usuario) =
  usuario.permissoes_paginas.length > 0
    ? filtrarContraCatalogoValido(usuario.permissoes_paginas)
    : permissoesPadraoDoPerfil(usuario.perfil)
```
Ou seja: o perfil define o default; o cadastro do usuário pode granularmente
customizar (adicionar/remover módulos individualmente) por cima desse default.

## 3. Autenticação

- Login por e-mail (normalizado para lowercase) + senha.
- Senha validada contra hash (`bcrypt.compare` ou equivalente) — **nunca comparação de
  string em texto puro**.
- Sessão com expiração (ex.: 4-8h), renovada a cada login.
- **Recomendado**: usar mecanismo de auth real do provedor de banco (ex. Supabase Auth,
  JWT assinado no servidor) em vez de sessão só no `localStorage` do cliente — o
  sistema original guarda a sessão inteira no localStorage e nunca revalida no
  servidor, o que permite forjar sessão/permissões editando o localStorage. ⚠️
- Ao carregar uma sessão existente, sempre buscar as permissões ATUAIS do usuário no
  banco (não confiar apenas no que foi salvo na sessão no momento do login) — evita
  sessão com permissões desatualizadas caso um admin revogue acesso enquanto o usuário
  está logado.

## 4. Autorização / Guard de rotas

- Função central única `usuarioTemAcesso(usuario, moduloChave)` usada em todos os
  pontos de decisão (menu, roteamento, renderização de página) — nunca duplicar essa
  lógica em cada tela.
- Tela de "gestão de usuários" liberada apenas para quem tem uma permissão/role
  explícita de administrador (ex. `perfil === 'ADMIN'` ou módulo `usuarios` presente
  nas permissões) — **não hardcodar por e-mail específico** como o sistema original faz
  (`usuario.email === 'admin@empresa.com'`). ⚠️ Isso trava a administração a uma única
  pessoa e não escala.
- Roteamento: ao trocar de página, sempre checar `usuarioTemAcesso` antes de navegar;
  se a sessão perder acesso a uma página (permissão revogada), redirecionar
  automaticamente para a primeira página ainda permitida.
- **Crítico**: a checagem de acesso não pode ser só no front-end. Toda operação de
  leitura/escrita sensível deve ser validada também no backend/banco (ver seção 5),
  porque qualquer usuário pode inspecionar a rede e chamar a API/banco diretamente,
  ignorando a UI. ⚠️ No sistema original, a autorização é 100% client-side e o banco
  aceita qualquer leitura/escrita de qualquer cliente autenticado com a chave pública —
  isso é uma falha grave a NÃO reproduzir.

## 5. Segurança no banco (RLS / regras server-side)

- Habilitar Row Level Security nas tabelas sensíveis.
- Políticas devem checar a identidade real do usuário autenticado (ex.
  `auth.uid()` ou claim de JWT), não `using (true)` liberado para todo mundo.
- Regra mínima recomendada: um usuário só pode ler/escrever registros que:
  1. pertencem à sua organização/tenant (se multi-tenant), e
  2. estão dentro do escopo do seu perfil/módulo (ex.: auditor só vê carteiras
     atribuídas a ele; financeiro só vê módulo financeiro).
- Nunca usar `create policy ... using (true) with check (true)` para tabelas com dados
  de negócio — isso equivale a desligar a RLS.

## 6. Gestão de usuários (CRUD)

- Tela restrita ao(s) perfil(is) de administração.
- Criar usuário: nome, e-mail (único), senha (gerar hash), perfil, e opcionalmente
  customização granular de módulos (checklist agrupado por `grupo` do catálogo).
- Editar usuário: mesmos campos + toggle ativo/inativo.
- Regra de negócio: impedir que o último/único usuário administrador seja
  desativado (evitar lockout total do sistema).
- Autoatendimento: tela separada "Minha senha" onde o próprio usuário logado troca a
  senha (exige senha atual + nova + confirmação, tamanho mínimo).
- Não existe fluxo de convite por e-mail no modelo original — criação é direta pelo
  admin com senha inicial provisória. Se o novo sistema quiser mais robustez, considerar
  convite por e-mail com link de definição de senha (melhoria, não obrigatório).

## 7. Vínculo usuário ↔ entidade de negócio (ex.: auditor ↔ carteira/cliente)

Modelar como tabela própria de atribuição, não como campo dentro de `usuarios`:
```sql
create table atribuicoes_carteira (
  id uuid primary key default gen_random_uuid(),
  entidade text not null,          -- ex: nome da transportadora/cliente/carteira
  entidade_identificador text,     -- ex: CNPJ, código externo
  responsavel_id uuid references usuarios(id),
  responsavel_nome text,
  responsavel_email text,
  ativo boolean default true,
  atribuido_por uuid references usuarios(id),
  atribuido_em timestamptz default now(),
  unique (entidade)
);
```
- Histórico de mudanças de atribuição em tabela separada (`_historico`), para
  auditoria de "quem era responsável por isso e quando mudou".
- Ao reatribuir o responsável de uma entidade, propagar (mirror) o novo responsável
  para os registros de trabalho ainda ABERTOS/pendentes daquela entidade (ex.: faturas
  sem auditor definido ainda) — mas não retroagir em registros já concluídos/fechados.
- Preferir FK para `usuarios.id` em vez de guardar só nome/e-mail em texto livre
  (o sistema original faz isso e permite inconsistência se o usuário for renomeado).

## 8. Resumo do que pedir para a outra equipe implementar

1. Tabela `usuarios` com senha com hash, perfil, permissões granulares em jsonb.
2. Catálogo de módulos fixo em código + dicionário de perfis com permissões default.
3. Função única de checagem de acesso, usada em menu + roteamento + guard de API.
4. Autenticação com sessão validada no servidor (JWT/Supabase Auth), expiração, e
   revalidação de permissões a cada carregamento de sessão.
5. RLS real no banco, escopada por usuário/tenant — nunca `using(true)`.
6. Tela de administração de usuários (CRUD) restrita por permissão, não por e-mail
   fixo; tela de autoatendimento de troca de senha.
7. Tabela separada de atribuição responsável↔entidade, com histórico e propagação
   para pendências abertas.
