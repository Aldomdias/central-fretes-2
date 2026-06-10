import React from 'react';
import { STATUS_GESTAO, FILTROS_RAPIDOS, REGIOES_BRASIL } from '../../utils/tabelasNegociacaoGestao';
import { TIPOS_NEGOCIACAO } from '../../services/tabelasNegociacaoService';
import { gestaoStyles } from './GestaoStyles';

const CANAIS = ['ATACADO', 'B2C', 'INTERCOMPANY', 'REVERSA', 'LOTACAO'];
const UFS = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

export default function GestaoFiltros({ filtros, onChange, onLimpar, negociadores = [] }) {
  function set(campo, valor) {
    onChange({ ...filtros, [campo]: valor, filtroRapido: campo === 'filtroRapido' ? valor : '' });
  }

  return (
    <section className="sim-card" style={{ marginBottom: 18 }}>
      <h2 style={{ marginTop: 0 }}>Filtros</h2>
      <div className="sim-form-grid sim-grid-5">
        <label>Busca
          <input value={filtros.busca || ''} onChange={(e) => set('busca', e.target.value)} placeholder="Transportadora, negociador, origem..." />
        </label>
        <label>Transportadora
          <input value={filtros.transportadora || ''} onChange={(e) => set('transportadora', e.target.value)} />
        </label>
        <label>Negociador
          <select value={filtros.negociador || ''} onChange={(e) => set('negociador', e.target.value)}>
            <option value="">Todos</option>
            {negociadores.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>Criado por
          <input value={filtros.criadoPor || ''} onChange={(e) => set('criadoPor', e.target.value)} />
        </label>
        <label>Status
          <select value={filtros.statusGestao || ''} onChange={(e) => set('statusGestao', e.target.value)}>
            <option value="">Todos</option>
            {STATUS_GESTAO.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label>Tipo negociação
          <select value={filtros.tipoNegociacao || ''} onChange={(e) => set('tipoNegociacao', e.target.value)}>
            <option value="">Todos</option>
            {TIPOS_NEGOCIACAO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label>Canal
          <select value={filtros.canal || ''} onChange={(e) => set('canal', e.target.value)}>
            <option value="">Todos</option>
            {CANAIS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>Origem
          <input value={filtros.origem || ''} onChange={(e) => set('origem', e.target.value)} />
        </label>
        <label>Região origem
          <select value={filtros.regiaoOrigem || ''} onChange={(e) => set('regiaoOrigem', e.target.value)}>
            <option value="">Todas</option>
            {Object.keys(REGIOES_BRASIL).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label>UF origem
          <select value={filtros.ufOrigem || ''} onChange={(e) => set('ufOrigem', e.target.value)}>
            {UFS.map((uf) => <option key={uf || 't'} value={uf}>{uf || 'Todas'}</option>)}
          </select>
        </label>
        <label>UF destino
          <select value={filtros.ufDestino || ''} onChange={(e) => set('ufDestino', e.target.value)}>
            {UFS.map((uf) => <option key={uf || 't'} value={uf}>{uf || 'Todas'}</option>)}
          </select>
        </label>
        <label className="sim-flag"><input type="checkbox" checked={Boolean(filtros.comSavingPositivo)} onChange={(e) => set('comSavingPositivo', e.target.checked)} /> Saving positivo</label>
        <label className="sim-flag"><input type="checkbox" checked={Boolean(filtros.comReajuste)} onChange={(e) => set('comReajuste', e.target.checked)} /> Com reajuste</label>
        <label className="sim-flag"><input type="checkbox" checked={Boolean(filtros.aguardandoAprovacao)} onChange={(e) => set('aguardandoAprovacao', e.target.checked)} /> Aguardando aprovação</label>
        <label className="sim-flag"><input type="checkbox" checked={Boolean(filtros.minhasNegociacoes)} onChange={(e) => set('minhasNegociacoes', e.target.checked)} /> Minhas negociações</label>
        <label className="sim-flag"><input type="checkbox" checked={Boolean(filtros.semAtualizacao)} onChange={(e) => set('semAtualizacao', e.target.checked)} /> Sem atualização</label>
      </div>

      <div style={gestaoStyles.chips}>
        {FILTROS_RAPIDOS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            style={filtros.filtroRapido === chip.key ? gestaoStyles.chipAtivo : gestaoStyles.chip}
            onClick={() => set('filtroRapido', filtros.filtroRapido === chip.key ? '' : chip.key)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="sim-actions" style={{ marginTop: 12 }}>
        <button className="sim-tab" type="button" onClick={onLimpar}>Limpar filtros</button>
      </div>
    </section>
  );
}
