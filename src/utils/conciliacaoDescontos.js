function normalizarNome(valor = '') {
  return String(valor)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\b(LTDA|EIRELI|ME|EPP|SA|S A|TRANSPORTADORAS?|TRANSPORTES?|LOGISTICA|RODOVIARIOS?)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function tokens(valor) {
  return new Set(normalizarNome(valor).split(/\s+/).filter((item) => item.length > 1));
}

function similaridadeNome(a, b) {
  const na = normalizarNome(a);
  const nb = normalizarNome(b);
  if (!na || !nb) return 0;
  if (na === nb || na.includes(nb) || nb.includes(na)) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  const intersecao = [...ta].filter((item) => tb.has(item)).length;
  return intersecao / Math.max(ta.size, tb.size, 1);
}

// Alguns arquivos legados tiveram a data de envio inferida do nome do
// arquivo + Vencimento da linha, e quando o Vencimento veio vazio/quebrado
// isso gravou datas em 1900 (ano-serial do Excel mal interpretado). Uma data
// dessas não é "distante no tempo", é ausente — trata como desconhecida em
// vez de deixar ela zerar o casamento por estourar a janela de dias.
function anoPlausivel(iso) {
  const ano = Number(String(iso || '').slice(0, 4));
  return Number.isFinite(ano) && ano >= 2000 && ano <= 2100;
}

function diasEntre(inicio, fim) {
  if (!inicio || !fim) return null;
  if (!anoPlausivel(inicio) || !anoPlausivel(fim)) return null;
  const a = new Date(`${String(inicio).slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${String(fim).slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function normalizarPartida(valor = '') {
  return String(valor || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// O texto livre do SAP (texto_partida) costuma conter o número da partida que
// o Financeiro anotou ao enviar (campo "Partida" da planilha/protocolo) —
// quando os dois lados têm esse número, é o sinal mais forte de casamento que
// existe, mais confiável que nome+valor+data. Exige 3+ dígitos pra evitar que
// um número curto (ex.: "1") dê falso positivo por substring.
function partidaBateFn(partidaEnviado, textoPartidaRealizado) {
  const enviado = normalizarPartida(partidaEnviado);
  const realizado = normalizarPartida(textoPartidaRealizado);
  return enviado.length >= 3 && realizado.includes(enviado);
}

function chaveDuplicata(row) {
  const fatura = String(row.numero_fatura || '').trim().toUpperCase();
  const transportadora = normalizarNome(row.transportadora);
  if (!fatura || !transportadora) return null;
  return `${fatura}|${transportadora}|${Number(row.desconto_enviado || 0).toFixed(2)}`;
}

// Protocolos/planilhas diferentes às vezes repetem a mesma fatura, mesma
// transportadora e mesmo valor (reenvio, re-cadastro). Quando um desses
// "gêmeos" já casou com um realizado, o(s) outro(s) que sobraram pendentes
// não são uma nova pendência real — são a mesma solicitação duplicada.
function marcarDuplicatas(linhas) {
  const grupos = new Map();
  linhas.forEach((linha) => {
    const chave = chaveDuplicata(linha);
    if (!chave) return;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(linha);
  });
  return linhas.map((linha) => {
    const chave = chaveDuplicata(linha);
    const grupo = chave ? grupos.get(chave) : null;
    if (!grupo || grupo.length < 2) return linha;
    const temRealizado = grupo.some((item) => item.status_conciliacao === 'REALIZADO');
    if (!temRealizado) return linha;
    // duplicata_grupo marca os dois lados do par (o Realizado original e a
    // solicitação repetida) pra quem for revisar conseguir ver os dois juntos.
    const status = linha.status_conciliacao === 'PENDENTE' ? 'DUPLICADA' : linha.status_conciliacao;
    return { ...linha, status_conciliacao: status, duplicata_grupo: chave };
  });
}

export function montarDescontosEnviados(protocolos = [], legados = []) {
  const futuros = protocolos
    .filter((row) => row.ativo !== false && Number(row.desconto_total || 0) > 0)
    .map((row) => ({
      id: row.id,
      origem: 'PROTOCOLO_AUDITORIA',
      protocolo: row.protocolo,
      data_envio: row.enviado_em?.slice(0, 10) || row.created_at?.slice(0, 10) || null,
      numero_fatura: row.numero_fatura,
      transportadora: row.transportadora,
      cnpj: row.cnpj_transportadora,
      desconto_enviado: Number(row.desconto_total || 0),
      centro_custo_desconto: row.centro_custo_codigo,
      partida: row.partida || null,
      arquivo_origem: null,
    }));
  const chavesLegado = new Set();
  const historicos = legados
    .filter((row) => row.excluido !== true)
    .filter((row) => {
      const chave = `${row.arquivo_origem || ''}|${row.numero_fatura || ''}|${Number(row.desconto_enviado || 0).toFixed(2)}`;
      if (chavesLegado.has(chave)) return false;
      chavesLegado.add(chave);
      return true;
    })
    .map((row) => ({ ...row, origem: 'PLANILHA_LEGADA' }));
  return [...futuros, ...historicos];
}

// resolverNomeCanonico (opcional) traduz o nome bruto de um lado pro nome
// canônico do outro lado, via algum vínculo cadastrado por quem chama esta
// função — este util não sabe nem precisa saber qual fonte é. Isso casa
// "enviado" e "realizado" mesmo quando um lado usa a razão social e o outro
// um apelido diferente.
export function conciliarDescontos(enviados = [], realizados = [], { tolerancia = 0.01, janelaDias = 180, resolverNomeCanonico } = {}) {
  const usados = new Set();
  const resultado = [...enviados]
    .sort((a, b) => String(a.data_envio || '').localeCompare(String(b.data_envio || '')))
    .map((enviado) => {
      const valorEnviado = Number(enviado.desconto_enviado || 0);
      const canonicoEnviado = resolverNomeCanonico ? resolverNomeCanonico(enviado.transportadora) : enviado.transportadora;
      const candidatos = realizados
        .filter((realizado) => !usados.has(realizado.id))
        .map((realizado) => {
          const diferenca = Number((Number(realizado.valor || 0) - valorEnviado).toFixed(2));
          const canonicoRealizado = resolverNomeCanonico ? resolverNomeCanonico(realizado.transportadora_nome) : realizado.transportadora_nome;
          const similaridade = Math.max(
            similaridadeNome(enviado.transportadora, realizado.transportadora_nome),
            similaridadeNome(canonicoEnviado, canonicoRealizado)
          );
          const dias = diasEntre(enviado.data_envio, realizado.data_lancamento);
          const dentroJanela = dias === null || (dias >= -7 && dias <= janelaDias);
          const valorBate = Math.abs(diferenca) <= tolerancia;
          const centroBate = enviado.centro_custo_desconto && realizado.centro_lucro
            ? normalizarNome(realizado.centro_lucro).includes(normalizarNome(enviado.centro_custo_desconto))
            : false;
          const partidaBate = partidaBateFn(enviado.partida, realizado.texto_partida);
          const elegivel = valorBate && dentroJanela && (similaridade >= 0.5 || centroBate || partidaBate);
          // Data mais próxima pesa o suficiente pra desempatar sozinha quando valor e
          // nome já bateram (caso comum: a mesma transportadora enviou dois protocolos
          // de valor igual) — só sobra pra "Revisar" quando nem a data desempata. A
          // partida, quando bate, é o sinal mais forte de todos (mesmo documento).
          const score = (valorBate ? 100 : 0) + similaridade * 30 + (centroBate ? 10 : 0) + (partidaBate ? 50 : 0) - Math.abs(dias ?? janelaDias) * 0.3;
          return { realizado, diferenca, similaridade, dias, elegivel, score };
        })
        .filter((item) => item.elegivel)
        .sort((a, b) => b.score - a.score);
      const melhor = candidatos[0];
      if (!melhor) return { ...enviado, status_conciliacao: 'PENDENTE', desconto_realizado: 0, diferenca: -valorEnviado, realizado: null };
      usados.add(melhor.realizado.id);
      return {
        ...enviado,
        status_conciliacao: candidatos.length > 1 && Math.abs(candidatos[0].score - candidatos[1].score) < 1 ? 'REVISAR' : 'REALIZADO',
        desconto_realizado: Number(melhor.realizado.valor || 0),
        diferenca: melhor.diferenca,
        realizado: melhor.realizado,
      };
    });
  return marcarDuplicatas(resultado);
}
