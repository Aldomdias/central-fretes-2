const MAX_LINHAS = 12000;

const PROMPT = `Você normaliza tabelas de frete para o padrão Verum da Central Fretes.
Nunca invente dados. Origem padrão: Itajaí/SC, IBGE 4208203, salvo origem explícita.
Regra de cálculo: Maior valor.
Faixa de peso: taxa_aplicada é o valor fixo; excesso_de_peso só na última faixa; frete_minimo 0.
Percentual puro: pesos 0 e 999999999; taxa 0; excesso 0; percentual e mínimo conforme a rota.
Gris, pedágio, TAS, CTRC, despacho e taxas gerais nunca entram em fretes ou rotas: coloque em generalidades.
Preserve códigos próprios de praça; caso não existam, use UF-CAPITAL, UF-INT1 etc.
Prazo ausente deve ser 999 e gerar gap. Não bloqueie rotas válidas por destinos faltantes.
Não suponha vigência: use somente a informada no contexto ou documento.
Retorne exclusivamente JSON válido, sem markdown, seguindo exatamente o formato pedido.`;

function schemaPedido() {
  return `{
    "transportadora":"string", "origem":{"cidade":"string","uf":"string","ibge":"string"},
    "vigencia":{"inicio":"YYYY-MM-DD","fim":"YYYY-MM-DD","fonte":"documento|informada_usuario"},
    "modelo":"percentual|faixa_peso|misto",
    "fretes":[{"rota_do_frete":"string","cidade_origem":"string","uf_origem":"string","uf_destino":"string","peso_minimo":0,"peso_limite":0,"excesso_de_peso":0,"taxa_aplicada":0,"frete_percentual":0,"frete_minimo":0,"inicio_vigencia":"YYYY-MM-DD","fim_vigencia":"YYYY-MM-DD"}],
    "rotas":[{"cotacao":"string","cidade_origem":"string","uf_origem":"string","ibge_origem":"string","cidade_destino":"string","uf_destino":"string","ibge_destino":"string","cep_inicial":"string","cep_final":"string","prazo":0,"inicio_vigencia":"YYYY-MM-DD","fim_vigencia":"YYYY-MM-DD"}],
    "generalidades":{}, "gaps":[{"tipo":"string","descricao":"string","linhas_afetadas":0}],
    "resumo":{"cobertura_percentual":0,"prazos_pendentes":0,"observacoes":["string"]}
  }`;
}

function extrairJson(texto = '') {
  const limpo = String(texto).replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(limpo);
}

function mensagemOpenAiAmigavel(mensagem = '') {
  const texto = String(mensagem || '');
  if (/insufficient_quota|exceeded your current quota|billing/i.test(texto)) {
    return 'A conta OpenAI está sem saldo/quota. Acesse Billing na plataforma OpenAI, adicione créditos e tente novamente.';
  }
  if (/rate limit|too many requests/i.test(texto)) {
    return 'O limite temporário de chamadas da OpenAI foi atingido. Aguarde alguns instantes e tente novamente.';
  }
  if (/model.*not found|does not exist|model_not_found/i.test(texto)) {
    return 'O modelo OpenAI configurado não está disponível para esta conta. Revise OPENAI_MODEL.';
  }
  return texto;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ erro: 'Configure OPENAI_API_KEY no ambiente do servidor.' });

  const { linhas = [], contexto = {}, arquivo = '' } = req.body || {};
  if (!Array.isArray(linhas) || !linhas.length) return res.status(400).json({ erro: 'Nenhuma linha foi enviada para análise.' });
  if (linhas.length > MAX_LINHAS) return res.status(413).json({ erro: `O limite por análise é ${MAX_LINHAS} linhas.` });

  const baseUrl = String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
  const conteudo = [
    `Contexto do usuário: ${JSON.stringify(contexto)}`,
    `Arquivo: ${arquivo || 'não informado'}`,
    `Formato obrigatório: ${schemaPedido()}`,
    `Linhas extraídas da planilha: ${JSON.stringify(linhas)}`,
  ].join('\n\n');

  try {
    const resposta = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: conteudo }],
        response_format: { type: 'json_object' },
      }),
    });
    const payload = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(mensagemOpenAiAmigavel(payload?.error?.message || payload?.message || `OpenAI respondeu HTTP ${resposta.status}.`));
    const texto = payload?.choices?.[0]?.message?.content;
    if (!texto) throw new Error('A OpenAI não devolveu conteúdo estruturado.');
    return res.status(200).json({ resultado: extrairJson(texto), modelo: model });
  } catch (error) {
    return res.status(502).json({ erro: error?.message || 'Falha ao processar a tabela com a OpenAI.' });
  }
}
