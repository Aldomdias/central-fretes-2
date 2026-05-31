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

const tabelaId = '5ce9dae6-c92a-40e2-b005-da7bf2a2001e';
const rodadaParaApagar = 2;

function n(v) {
  const num = Number(v || 0);
  return Number.isFinite(num) ? num : 0;
}

function tipo(item) {
  return String(item?.tipo_registro || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function resumoSeguro(tabela) {
  return tabela?.resumo_simulacao && typeof tabela.resumo_simulacao === 'object' && !Array.isArray(tabela.resumo_simulacao)
    ? tabela.resumo_simulacao
    : {};
}

function historicoSeguro(resumo) {
  if (Array.isArray(resumo.historico_rodadas)) return resumo.historico_rodadas;
  if (Array.isArray(resumo.rodadas)) return resumo.rodadas;
  return [];
}

fs.mkdirSync('backups', { recursive: true });

const { data: tabela, error } = await supabase
  .from('tabelas_negociacao')
  .select('id,transportadora,canal,origem,uf_origem,resumo_simulacao')
  .eq('id', tabelaId)
  .single();

if (error) {
  console.error('Erro ao buscar tabela:', error.message);
  process.exit(1);
}

const resumo = resumoSeguro(tabela);
const historico = historicoSeguro(resumo);

const removidos = historico.filter((item) => n(item.rodada) === rodadaParaApagar);
const historicoLimpo = historico.filter((item) => n(item.rodada) !== rodadaParaApagar);

console.log('Tabela:', tabela.transportadora, '|', tabela.canal, '|', tabela.origem + '/' + tabela.uf_origem);
console.log('Registros da rodada 2 encontrados:', removidos.length);

if (!removidos.length) {
  console.log('Nada para remover.');
  process.exit(0);
}

const backupPath = `backups/416af-antes-apagar-rodada-${rodadaParaApagar}-${tabela.id}-${Date.now()}.json`;
fs.writeFileSync(backupPath, JSON.stringify(tabela, null, 2), 'utf8');

const simulacoesRestantes = historicoLimpo.filter((item) => tipo(item) === 'SIMULACAO');
const ultimaSimulacao = simulacoesRestantes.length ? simulacoesRestantes[simulacoesRestantes.length - 1] : null;
const resumoUltima = ultimaSimulacao?.resumo || {};
const ind = ultimaSimulacao?.indicadores || {};
const maiorRodada = historicoLimpo.reduce((acc, item) => Math.max(acc, n(item.rodada)), 1);

const resumoAtualizado = ultimaSimulacao
  ? {
      ...resumo,
      ...resumoUltima,
      rodada_atual: maiorRodada,
      ultima_simulacao: ultimaSimulacao,
      ultima_simulacao_em: ultimaSimulacao.criado_em || null,
      historico_rodadas: historicoLimpo,
    }
  : {
      ...resumo,
      rodada_atual: maiorRodada,
      ultima_simulacao: null,
      ultima_simulacao_em: null,
      historico_rodadas: historicoLimpo,
      ctesAnalisados: 0,
      ctesSimulados: 0,
      ctesComTabelaSelecionada: 0,
      ctesGanhariaSelecionada: 0,
      ctesPerdidosSelecionada: 0,
      ctesSemTabelaSelecionada: 0,
      freteRealizado: 0,
      freteSelecionada: 0,
      faturamentoSelecionadaMes: 0,
      faturamentoSelecionadaAno: 0,
      faturamentoSelecionadaGanhadoraMes: 0,
      faturamentoSelecionadaGanhadoraAno: 0,
      savingSelecionadaVsReal: 0,
      savingSelecionadaVsRealMes: 0,
      savingSelecionadaVsRealAno: 0,
      aderenciaSelecionada: 0,
      cargasDia: 0,
      volumesDia: 0,
      volumes: 0,
      peso: 0,
      valorNF: 0,
      rotasGanhasDestaque: [],
      estadosGanhadoresDestaque: [],
      transportadorasPerdaDestaque: [],
    };

const payload = {
  resumo_simulacao: resumoAtualizado,
  saving_projetado: n(ind.saving_mes || resumoUltima.savingSelecionadaVsRealMes || resumoUltima.savingSelecionadaVsReal),
  aderencia_projetada: n(ind.aderencia || resumoUltima.aderenciaSelecionada),
  faturamento_projetado: n(ind.faturamento_mes || resumoUltima.faturamentoSelecionadaGanhadoraMes || resumoUltima.faturamentoSelecionadaMes),
  impacto_projetado: n(resumoUltima.diferencaSelecionadaVsVencedor),
  percentual_frete_projetado: n(ind.percentual_frete_simulado || resumoUltima.percentualFreteTabelaGanharia || resumoUltima.percentualFreteSelecionada),
  volumetria_dia: n(ind.pedidos_dia || resumoUltima.cargasDia),
  ctes_analisados: n(resumoUltima.ctesAnalisados),
  ctes_atendidos: n(resumoUltima.ctesComTabelaSelecionada),
  rotas_sem_cobertura: n(resumoUltima.ctesSemTabelaSelecionada),
};

const { error: updateError } = await supabase
  .from('tabelas_negociacao')
  .update(payload)
  .eq('id', tabela.id);

if (updateError) {
  console.error('Erro ao atualizar:', updateError.message);
  console.log('Backup salvo em:', backupPath);
  process.exit(1);
}

console.log('');
console.log('OK: rodada 2 apagada direto no Supabase.');
console.log('Registros removidos:', removidos.length);
console.log('Backup salvo em:', backupPath);
