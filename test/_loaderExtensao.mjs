// O código-fonte usa imports relativos sem extensão (resolvidos pelo Vite).
// Este hook acrescenta ".js" quando o caminho não resolve, para os testes do Node.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (erro) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return next(`${specifier}.js`, context);
    }
    throw erro;
  }
}
