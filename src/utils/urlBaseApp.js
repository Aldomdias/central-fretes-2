// Endereco publico do sistema para montar links que saem dele (laudos, e-mails, portais do
// transportador). Rodando local (localhost) o link apontaria para a maquina de quem gerou e
// nao abriria para o transportador; nesses casos usa o endereco de producao.
const PRODUCAO = 'https://central-fretes-2.vercel.app';

export function urlBaseApp() {
  const configurada = String(import.meta.env?.VITE_APP_URL || '').trim().replace(/\/$/, '');
  if (typeof window === 'undefined') return configurada || PRODUCAO;
  const { origin, hostname } = window.location;
  const local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
  return local ? (configurada || PRODUCAO) : origin;
}
