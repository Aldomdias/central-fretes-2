import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY somente neste terminal antes de executar.');
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: usuarios, error: usuariosError } = await supabase
  .from('usuarios_central')
  .select('id,nome,email,senha,ativo')
  .eq('ativo', true);

if (usuariosError) throw usuariosError;

const existentes = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  existentes.push(...data.users);
  if (data.users.length < 1000) break;
}

let criados = 0;
let atualizados = 0;

for (const usuario of usuarios || []) {
  const email = String(usuario.email || '').trim().toLowerCase();
  const password = String(usuario.senha || '');
  if (!email || password.length < 6) {
    console.warn(`Ignorado: ${email || usuario.id} (e-mail ausente ou senha com menos de 6 caracteres).`);
    continue;
  }

  const existente = existentes.find((item) => String(item.email || '').toLowerCase() === email);
  if (existente) {
    const { error } = await supabase.auth.admin.updateUserById(existente.id, {
      password,
      email_confirm: true,
      user_metadata: { ...existente.user_metadata, nome: usuario.nome, central_usuario_id: usuario.id },
    });
    if (error) throw error;
    atualizados += 1;
  } else {
    const { error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome: usuario.nome, central_usuario_id: usuario.id },
    });
    if (error) throw error;
    criados += 1;
  }
}

console.log(`Migração concluída: ${criados} criado(s), ${atualizados} atualizado(s).`);
