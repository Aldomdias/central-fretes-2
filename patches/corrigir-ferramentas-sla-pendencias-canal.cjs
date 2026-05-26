#!/usr/bin/env node
/**
 * Patch: Ferramentas — SLA recolhido + Pendências Canal + Alerta Perda Realizado
 *
 * Alterações:
 *   1. FerramentasPage.jsx  — SlaAuditoriaConfig envolto no accordion toggleAba('sla')
 *   2. PerdaRealizadoPage.jsx — alerta quando análise inclui registros 'A DEFINIR'
 *      e exclusão opcional deles do cálculo de saving
 *
 * A correção principal da view SQL está em:
 *   supabase/migrations/20260526_002_corrigir_view_pendencias_canal.sql
 *
 * Executar na raiz do projeto:
 *   node patches/corrigir-ferramentas-sla-pendencias-canal.cjs
 *
 * Depois:
 *   1. Aplicar migration SQL no Supabase
 *   2. npm run build
 *   3. git add src patches supabase && git commit -m "fix: ferramentas SLA recolhido, pendências canal e alerta perda realizado"
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
  if (novo === old) { console.log(`NOP ${rel}  (trecho não encontrado — aplicar manualmente)`); return; }
  write(rel, novo);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. FerramentasPage.jsx — SlaAuditoriaConfig dentro do accordion
// ─────────────────────────────────────────────────────────────────────────────
patchFile('src/pages/FerramentasPage.jsx', (src) => {

  // Substituir o bloco que renderiza SlaAuditoriaConfig diretamente
  // pelo mesmo padrão accordion já usado nos outros blocos da página.
  return src.replace(
    `      {sessao?.perfil === 'GESTAO' && (
        <SlaAuditoriaConfig canal="LOTACAO" />
      )}`,

    `      {sessao?.perfil === 'GESTAO' && (
        <div className="panel-card" style={{padding:0,overflow:'hidden'}}>
          <button
            type="button"
            onClick={() => toggleAba('sla')}
            style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 20px',border:'none',background:'none',textAlign:'left',cursor:'pointer',borderBottom:abaAberta==='sla'?'1px solid var(--border-soft)':'none'}}
          >
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
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PerdaRealizadoPage.jsx — aviso quando base inclui 'A DEFINIR'
//    e exclusão desses registros do cálculo por padrão
// ─────────────────────────────────────────────────────────────────────────────
patchFile('src/pages/PerdaRealizadoPage.jsx', (src) => {

  // ── a) Adicionar estado para controlar inclusão de A DEFINIR ──────────────
  let out = src.replace(
    `  const [aviso, setAviso] = useState('');`,
    `  const [aviso, setAviso] = useState('');
  const [excluirADefinir, setExcluirADefinir] = useState(true);`
  );

  // ── b) Após carregar realizados, filtrar e/ou avisar sobre A DEFINIR ──────
  // Inserir imediatamente antes de "const routeKeys = extrairRouteKeys"
  out = out.replace(
    `      const routeKeys = extrairRouteKeys(realizados, filtros.canal);`,
    `      // Registros sem canal confiável — detectar antes de calcular
      const ctesADefinir = realizados.filter((c) => {
        const canal = String(c.canal || '').trim().toUpperCase();
        return !canal || canal === 'A DEFINIR' || canal === 'SEM CANAL';
      });
      if (ctesADefinir.length > 0) {
        const pct = ((ctesADefinir.length / realizados.length) * 100).toFixed(1);
        setAviso(
          \`⚠ \${ctesADefinir.length.toLocaleString('pt-BR')} CT-e(s) (\${pct}%) estão com canal A DEFINIR ou sem canal. \` +
          (excluirADefinir
            ? 'Esses registros foram excluídos da análise para evitar distorção de saving. Trate-os em Ferramentas → Pendências de Canal.'
            : 'Esses registros estão incluídos na análise — o saving pode estar distorcido. Recomendamos tratá-los em Ferramentas → Pendências de Canal.')
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

  // ── c) Adicionar checkbox na UI de filtros ────────────────────────────────
  // Inserir após o botão Processar
  out = out.replace(
    `<button className="btn-primary" onClick={processar} disabled={processando} style={{ minWidth: 160 }}>{processando ? '⟳ Processando...' : '▶ Processar'}</button>`,
    `<button className="btn-primary" onClick={processar} disabled={processando} style={{ minWidth: 160 }}>{processando ? '⟳ Processando...' : '▶ Processar'}</button>
              <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:'#555', marginLeft:8, cursor:'pointer' }}>
                <input type="checkbox" checked={excluirADefinir} onChange={(e) => setExcluirADefinir(e.target.checked)} />
                Excluir registros sem canal (A DEFINIR) da análise
              </label>`
  );

  return out;
});

console.log('\nPatch aplicado. Próximos passos:');
console.log('  1. Executar migration SQL no Supabase:');
console.log('     supabase/migrations/20260526_002_corrigir_view_pendencias_canal.sql');
console.log('  2. npm run build');
console.log('  3. git add src patches supabase && git commit -m "fix: ferramentas SLA recolhido, pendências canal e alerta perda realizado"');
