#!/usr/bin/env node
/**
 * Patch: Ferramentas — SLA recolhido + canal resolvido ao salvar vínculos + alerta Perda
 *
 * Alterações:
 *   1. FerramentasPage.jsx  — SlaAuditoriaConfig no accordion
 *   2. FerramentasPage.jsx  — após salvar vínculos, chama RPC de re-processamento de canal
 *   3. PerdaRealizadoPage.jsx — alerta + checkbox para excluir A DEFINIR da análise
 *
 * Migration SQL obrigatória antes do deploy:
 *   supabase/migrations/20260526_003_reprocessar_canal_a_definir.sql
 *
 * Executar na raiz do projeto:
 *   node patches/corrigir-ferramentas-sla-pendencias-canal.cjs
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const root = process.cwd();

function read(rel)  { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function write(rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log(`OK  ${rel}`);
}
function patchFile(rel, patcher) {
  const old = read(rel);
  const novo = patcher(old);
  if (novo === old) { console.log(`NOP ${rel}  — aplicar manualmente`); return; }
  write(rel, novo);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 + 2. FerramentasPage.jsx
// ─────────────────────────────────────────────────────────────────────────────
patchFile('src/pages/FerramentasPage.jsx', (src) => {
  let out = src;

  // ── 1. SLA no accordion ──────────────────────────────────────────────────
  out = out.replace(
    `      {sessao?.perfil === 'GESTAO' && (
        <SlaAuditoriaConfig canal="LOTACAO" />
      )}`,
    `      {sessao?.perfil === 'GESTAO' && (
        <div className="panel-card" style={{padding:0,overflow:'hidden'}}>
          <button type="button" onClick={() => toggleAba('sla')}
            style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',border:'none',background:'none',textAlign:'left',cursor:'pointer',borderBottom:abaAberta==='sla'?'1px solid var(--border-soft)':'none'}}>
            <div>
              <div className="panel-title" style={{margin:0}}>Configuração de SLA</div>
              <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>Prazos, alertas e e-mails de auditoria — Módulo LOTACAO</div>
            </div>
            <span style={{fontSize:18,color:'var(--muted)'}}>{abaAberta==='sla'?'▴':'▾'}</span>
          </button>
          {abaAberta === 'sla' && (
            <div style={{padding:'16px 20px'}}>
              <SlaAuditoriaConfig canal="LOTACAO" />
            </div>
          )}
        </div>
      )}`
  );

  // ── 2. Após salvar vínculos, disparar re-processamento de canal ──────────
  // Adiciona import do supabaseClient no topo (se ainda não existir)
  if (!out.includes('getSupabaseClient') && !out.includes('supabaseClient')) {
    out = out.replace(
      `import { carregarVinculosTransportadoras,`,
      `import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient';\nimport { carregarVinculosTransportadoras,`
    );
  }

  // Substitui o bloco salvarVinculos para disparar o RPC depois
  out = out.replace(
    `  const salvarVinculos = async (lista) => {
    const proximaLista = (lista || []).filter(v => String(v.nomeCte || '').trim() && String(v.nomeTabela || '').trim());
    setVinculos(proximaLista);
    setSalvandoVinculos(true);
    setErroSugestoes('');
    try {
      const resultado = await salvarVinculosTransportadoras(proximaLista);
      setFonteVinculos(resultado.modo || (isSupabaseConfigured() ? 'supabase' : 'local'));
      setMensagem(\`Vínculos salvos em \${resultado.modo === 'supabase' ? 'Supabase' : 'localStorage'}: \${resultado.total || proximaLista.length}.\`);
    } catch (err) {
      setErroSugestoes(err.message || 'Erro ao salvar vínculos no Supabase.');
    } finally {
      setSalvandoVinculos(false);
    }
  };`,

    `  const salvarVinculos = async (lista) => {
    const proximaLista = (lista || []).filter(v => String(v.nomeCte || '').trim() && String(v.nomeTabela || '').trim());
    setVinculos(proximaLista);
    setSalvandoVinculos(true);
    setErroSugestoes('');
    try {
      const resultado = await salvarVinculosTransportadoras(proximaLista);
      setFonteVinculos(resultado.modo || (isSupabaseConfigured() ? 'supabase' : 'local'));

      // Re-processar canal dos CT-es das transportadoras recém-vinculadas.
      // Regra: tem vínculo → tem tabela → canal da tabela → sai das pendências.
      let ctesMigrados = 0;
      if (isSupabaseConfigured()) {
        try {
          const nomesCte = proximaLista.map(v => v.nomeCte).filter(Boolean);
          const { data: batchResult } = await getSupabaseClient()
            .rpc('resolver_canal_por_vinculos_batch', { p_nomes_cte: nomesCte.length ? nomesCte : null });
          ctesMigrados = batchResult?.ctes_atualizados || 0;
        } catch (batchErr) {
          console.warn('Re-processamento de canal ignorado (migration pendente?):', batchErr.message);
        }
      }

      const sufixo = ctesMigrados > 0 ? \` · \${ctesMigrados} CT-e(s) com canal resolvido.\` : '';
      setMensagem(\`Vínculos salvos em \${resultado.modo === 'supabase' ? 'Supabase' : 'localStorage'}: \${resultado.total || proximaLista.length}.\${sufixo}\`);
    } catch (err) {
      setErroSugestoes(err.message || 'Erro ao salvar vínculos no Supabase.');
    } finally {
      setSalvandoVinculos(false);
    }
  };`
  );

  return out;
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. PerdaRealizadoPage.jsx — alerta + checkbox A DEFINIR
// ─────────────────────────────────────────────────────────────────────────────
patchFile('src/pages/PerdaRealizadoPage.jsx', (src) => {
  let out = src;

  out = out.replace(
    `  const [aviso, setAviso] = useState('');`,
    `  const [aviso, setAviso] = useState('');
  const [excluirADefinir, setExcluirADefinir] = useState(true);`
  );

  out = out.replace(
    `      const routeKeys = extrairRouteKeys(realizados, filtros.canal);`,
    `      // Registros sem canal confiável — regra: A DEFINIR não entra nas análises
      const ctesADefinir = realizados.filter((c) => {
        const canal = String(c.canal || '').trim().toUpperCase();
        return !canal || canal === 'A DEFINIR' || canal === 'SEM CANAL';
      });
      if (ctesADefinir.length > 0) {
        const pct = ((ctesADefinir.length / realizados.length) * 100).toFixed(1);
        setAviso(
          \`⚠ \${ctesADefinir.length.toLocaleString('pt-BR')} CT-e(s) (\${pct}%) sem canal definido. \` +
          (excluirADefinir
            ? 'Excluídos desta análise. Trate-os em Ferramentas → Pendências de Canal.'
            : 'Incluídos — saving pode estar distorcido. Trate em Ferramentas → Pendências de Canal.')
        );
        if (excluirADefinir) {
          realizados = realizados.filter((c) => {
            const canal = String(c.canal || '').trim().toUpperCase();
            return canal && canal !== 'A DEFINIR' && canal !== 'SEM CANAL';
          });
        }
      }

      const routeKeys = extrairRouteKeys(realizados, filtros.canal);`
  );

  out = out.replace(
    `<button className="btn-primary" onClick={processar} disabled={processando} style={{ minWidth: 160 }}>{processando ? '⟳ Processando...' : '▶ Processar'}</button>`,
    `<button className="btn-primary" onClick={processar} disabled={processando} style={{ minWidth: 160 }}>{processando ? '⟳ Processando...' : '▶ Processar'}</button>
              <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:'#555', marginLeft:8, cursor:'pointer' }}>
                <input type="checkbox" checked={excluirADefinir} onChange={(e) => setExcluirADefinir(e.target.checked)} />
                Excluir sem canal (A DEFINIR) da análise
              </label>`
  );

  return out;
});

console.log('\nPatch concluído. Próximos passos:');
console.log('  1. Rodar migration no Supabase:');
console.log('     supabase/migrations/20260526_003_reprocessar_canal_a_definir.sql');
console.log('  2. npm run build');
console.log('  3. git add src patches supabase && git commit -m "fix: canal resolvido ao salvar vínculos, SLA recolhido, alerta perda"');
