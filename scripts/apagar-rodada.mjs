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
const supabase = createClient(url, key);

const tabelaId = process.argv[2];
const rodadaApagar = Number(process.argv[3]);

if (!tabelaId || !rodadaApagar) {
  console.error('Uso: node scripts/apagar-rodada.mjs <tabelaId> <numeroRodada>');
  process.exit(1);
}

const { data: tabela, error } = await supabase
  .from('tabelas_negociacao')
  .select('id,transportadora,canal,origem,uf_origem,resumo_simulacao')
  .eq('id', tabelaId)
  .single();

if (error) { console.error('Erro:', error.message); process.exit(1); }

const resumo = tabela.resumo_simulacao || {};
const historico = Array.isArray(resumo.historico_rodadas) ? resumo.historico_rodadas : [];
const historicoLimpo = historico.filter(item => Number(item.rodada || 0) !== rodadaApagar);

if (historicoLimpo.length === historico.length) {
  console.log('Nenhum registro da rodada', rodadaApagar, 'encontrado.');
  process.exit(0);
}

console.log('Tabela:', tabela.transportadora, tabela.origem, tabela.uf_origem);
console.log('Removendo', historico.length - historicoLimpo.length, 'registro(s) da rodada', rodadaApagar);

fs.mkdirSync('backups', { recursive: true });
const backup = 'backups/backup-' + tabelaId + '-rodada' + rodadaApagar + '-' + Date.now() + '.json';
fs.writeFileSync(backup, JSON.stringify(tabela, null, 2));

const simulacoes = historicoLimpo.filter(i => String(i.tipo_registro||'').toUpperCase() === 'SIMULACAO');
const ultima = simulacoes.length ? simulacoes[simulacoes.length - 1] : null;
const maiorRodada = historicoLimpo.reduce((acc, i) => Math.max(acc, Number(i.rodada||0)), 1);
const resumoUltima = ultima?.resumo || {};
const ind = ultima?.indicadores || {};

const resumoAtualizado = {
  ...resumo,
  ...(ultima ? resumoUltima : {}),
  rodada_atual: maiorRodada,
  ultima_simulacao: ultima || null,
  ultima_simulacao_em: ultima?.criado_em || null,
  historico_rodadas: historicoLimpo,
};

const payload = {
  resumo_simulacao: resumoAtualizado,
  saving_projetado: Number(ind.saving_mes || resumoUltima.savingSelecionadaVsRealMes || 0),
  aderencia_projetada: Number(ind.aderencia || resumoUltima.aderenciaSelecionada || 0),
  faturamento_projetado: Number(ind.faturamento_mes || resumoUltima.faturamentoSelecionadaGanhadoraMes || 0),
  volumetria_dia: Number(ind.pedidos_dia || resumoUltima.cargasDia || 0),
  ctes_analisados: Number(resumoUltima.ctesAnalisados || 0),
  ctes_atendidos: Number(resumoUltima.ctesComTabelaSelecionada || 0),
};

const { error: updateError } = await supabase
  .from('tabelas_negociacao')
  .update(payload)
  .eq('id', tabelaId);

if (updateError) { console.error('Erro ao salvar:', updateError.message); process.exit(1); }

console.log('OK! Rodada', rodadaApagar, 'apagada. Backup em:', backup);
