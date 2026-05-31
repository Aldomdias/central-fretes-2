import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const tabelaId = '5ce9dae6-c92a-40e2-b005-da7bf2a2001e';

function lerEnv(nome) {
  const raw = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
  const linha = raw.split(/\r?\n/).find((l) => l.trim().startsWith(nome + '='));
  if (!linha) return process.env[nome] || '';
  return linha.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
}

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

function totalItens(item) {
  const imp = item?.itens_importados || {};
  const salvos = item?.itens_salvos_apos_importacao || {};
  return (
    n(imp.total) + n(imp.rotas) + n(imp.cotacoes) +
    n(salvos.total) + n(salvos.rotas) + n(salvos.cotacoes)
  );
}

function ehImportacaoReal(item) {
  return tipo(item) === 'IMPORTACAO' && totalItens(item) > 0;
}

function ehMarcadorVazio(item) {
  const origem = String(item?.origem_importacao || '').toUpperCase();
  const obs = String(item?.observacao || '').toUpperCase();
  return totalItens(item) === 0 && (
    tipo(item) === 'NOVA_RODADA' ||
    tipo(item) === 'ABERTURA' ||
    origem === 'NOVA_RODADA' ||
    obs.includes('NOVA RODADA')
  );
}

function historicoSeguro(resumo) {
  if (Array.isArray(resumo?.historico_rodadas)) return resumo.historico_rodadas;
  if (Array.isArray(resumo?.rodadas)) return resumo.rodadas;
  return [];
}

function procurarBackup() {
  const dir = 'backups';
  if (!fs.existsSync(dir)) return null;
  const arquivos = fs.readdirSync(dir)
    .filter((nome) => nome.includes(tabelaId) && nome.endsWith('.json'))
    .map((nome) => path.join(dir, nome))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return arquivos[0] || null;
}

const url = lerEnv('VITE_SUPABASE_URL');
const key = lerEnv('VITE_SUPABASE_ANON_KEY');

if (!url || !key) {
  console.error('Não encontrei VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY no .env');
  process.exit(1);
}

const backupPath = procurarBackup();
if (!backupPath) {
  console.error('Não encontrei backup local em backups/ para a tabela ' + tabelaId);
  process.exit(1);
}

const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const resumoBackup = backup.resumo_simulacao || {};
const historicoBackup = historicoSeguro(resumoBackup);

// Restaura a base a partir do backup, mas já remove a análise errada da rodada 2.
// Preserva IMPORTAÇÃO real da tabela.
const rodadaErrada = 2;
const historicoCorrigido = historicoBackup.filter((item) => {
  if (n(item.rodada) !== rodadaErrada) return true;
  if (ehImportacaoReal(item)) return true;
  return !(tipo(item) === 'SIMULACAO' || ehMarcadorVazio(item));
});

const simulacoes = historicoCorrigido.filter((item) => tipo(item) === 'SIMULACAO');
const ultimaSimulacao = simulacoes[simulacoes.length - 1] || null;
const resumoUltima = ultimaSimulacao?.resumo || {};
const ind = ultimaSimulacao?.indicadores || {};
const maiorRodada = historicoCorrigido.reduce((acc, item) => Math.max(acc, n(item.rodada)), 1);

const resumoAtualizado = ultimaSimulacao
  ? {
      ...resumoBackup,
      ...resumoUltima,
      rodada_atual: maiorRodada,
      ultima_simulacao: ultimaSimulacao,
      ultima_simulacao_em: ultimaSimulacao.criado_em || null,
      historico_rodadas: historicoCorrigido,
    }
  : {
      ...resumoBackup,
      rodada_atual: maiorRodada,
      ultima_simulacao: null,
      ultima_simulacao_em: null,
      historico_rodadas: historicoCorrigido,
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

const supabase = createClient(url, key);
const { error } = await supabase
  .from('tabelas_negociacao')
  .update(payload)
  .eq('id', tabelaId);

if (error) {
  console.error('Erro ao restaurar:', error.message);
  process.exit(1);
}

console.log('OK: histórico restaurado a partir do backup.');
console.log('Backup usado:', backupPath);
console.log('Registros mantidos:', historicoCorrigido.length);
console.log('Rodada atual:', maiorRodada);
