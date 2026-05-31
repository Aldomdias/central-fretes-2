import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function lerEnv(nome) {
  const raw = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
  const linha = raw.split(/\r?\n/).find((l) => l.trim().startsWith(nome + '='));
  if (!linha) return process.env[nome] || '';
  return linha.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

const url = lerEnv('VITE_SUPABASE_URL');
const key = lerEnv('VITE_SUPABASE_ANON_KEY');

if (!url || !key) {
  console.error('Não encontrei VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY no .env');
  process.exit(1);
}

const supabase = createClient(url, key);

function numero(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function ehRegistroVazioDaRodada2(item) {
  const tipo = String(item?.tipo_registro || '').toUpperCase();
  const rodada = numero(item?.rodada);
  const imp = item?.itens_importados || {};
  const salvos = item?.itens_salvos_apos_importacao || {};

  const ehAberturaOuImportacao = tipo === 'ABERTURA' || tipo === 'IMPORTACAO';
  const ehRodada2 = rodada === 2;

  const totalImportado =
    numero(imp.total) +
    numero(imp.rotas) +
    numero(imp.cotacoes) +
    numero(salvos.total) +
    numero(salvos.rotas) +
    numero(salvos.cotacoes);

  const obs = String(item?.observacao || item?.origem_importacao || '').toUpperCase();
  const pareceAberturaManual = obs.includes('NOVA RODADA') || obs.includes('ABERTA MANUALMENTE') || totalImportado === 0;

  return ehRodada2 && ehAberturaOuImportacao && totalImportado === 0 && pareceAberturaManual;
}

const { data, error } = await supabase
  .from('tabelas_negociacao')
  .select('id,transportadora,canal,origem,uf_origem,resumo_simulacao')
  .ilike('transportadora', '%BRASIL WEB%')
  .eq('canal', 'B2C');

if (error) {
  console.error(error.message);
  process.exit(1);
}

const candidatas = (data || []).filter((t) => {
  const hist = Array.isArray(t?.resumo_simulacao?.historico_rodadas)
    ? t.resumo_simulacao.historico_rodadas
    : [];
  return hist.some(ehRegistroVazioDaRodada2) && hist.some((r) => numero(r.rodada) === 2 && String(r.tipo_registro).toUpperCase() === 'SIMULACAO');
});

if (candidatas.length !== 1) {
  console.log('Encontrei', candidatas.length, 'candidata(s). Não atualizei nada.');
  candidatas.forEach((t) => {
    console.log('-', t.id, '|', t.transportadora, '| origem:', t.origem, '/', t.uf_origem);
  });
  console.log('Me mande esse resultado para eu orientar o próximo comando.');
  process.exit(0);
}

const tabela = candidatas[0];
const resumo = tabela.resumo_simulacao || {};
const historico = Array.isArray(resumo.historico_rodadas) ? resumo.historico_rodadas : [];

const removidos = historico.filter(ehRegistroVazioDaRodada2);
const historicoLimpo = historico.filter((item) => !ehRegistroVazioDaRodada2(item));

if (!removidos.length) {
  console.log('Nenhum registro vazio encontrado para remover.');
  process.exit(0);
}

const simulacoes = historicoLimpo.filter((item) => String(item.tipo_registro || '').toUpperCase() === 'SIMULACAO');
const ultimaSimulacao = simulacoes[simulacoes.length - 1] || null;
const resumoUltima = ultimaSimulacao?.resumo || {};
const ind = ultimaSimulacao?.indicadores || {};
const maiorRodada = historicoLimpo.reduce((acc, item) => Math.max(acc, numero(item.rodada)), 1);

const backupPath = `backups/416af-backup-${tabela.id}-${Date.now()}.json`;
fs.writeFileSync(backupPath, JSON.stringify(tabela, null, 2), 'utf8');

const resumoAtualizado = {
  ...resumo,
  ...resumoUltima,
  rodada_atual: maiorRodada,
  ultima_simulacao: ultimaSimulacao,
  ultima_simulacao_em: ultimaSimulacao?.criado_em || resumo.ultima_simulacao_em || null,
  historico_rodadas: historicoLimpo,
};

const payload = {
  resumo_simulacao: resumoAtualizado,
  saving_projetado: numero(ind.saving_mes || resumoUltima.savingSelecionadaVsRealMes || resumo.saving_projetado),
  aderencia_projetada: numero(ind.aderencia || resumoUltima.aderenciaSelecionada || resumo.aderencia_projetada),
  faturamento_projetado: numero(ind.faturamento_mes || resumoUltima.faturamentoSelecionadaGanhadoraMes || resumoUltima.faturamentoSelecionadaMes),
  percentual_frete_projetado: numero(ind.percentual_frete_simulado || resumoUltima.percentualFreteTabelaGanharia || resumoUltima.percentualFreteSelecionada),
  volumetria_dia: numero(ind.pedidos_dia || resumoUltima.cargasDia),
  ctes_analisados: numero(resumoUltima.ctesAnalisados),
  ctes_atendidos: numero(resumoUltima.ctesComTabelaSelecionada),
  rotas_sem_cobertura: numero(resumoUltima.ctesSemTabelaSelecionada),
};

const { error: updateError } = await supabase
  .from('tabelas_negociacao')
  .update(payload)
  .eq('id', tabela.id);

if (updateError) {
  console.error(updateError.message);
  process.exit(1);
}

console.log('OK: registro vazio removido.');
console.log('Tabela:', tabela.transportadora);
console.log('Removidos:', removidos.length);
console.log('Backup salvo em:', backupPath);
