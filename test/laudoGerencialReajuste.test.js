import test from 'node:test';
import assert from 'node:assert/strict';
import { criarGerencialReajuste, acumularGerencialReajuste, consolidarGerenciaisReajuste, estadosGerenciais } from '../src/utils/laudoGerencialReajuste.js';
const linha = { origem:'Itupeva', ufOrigem:'SP', destino:'Curitiba', ufDestino:'PR', proprio:true, realizado:100, proposta:120, atual:110, concorrente:115, compararConcorrentes:true };
test('reajuste usa realizado próprio, mercado usa tabelas; empates separados',()=>{
 const g=criarGerencialReajuste(); acumularGerencialReajuste(g,linha);
 acumularGerencialReajuste(g,{...linha,proprio:false,realizado:900,atual:115,proposta:100});
 assert.equal(g.totais.realizado,100); assert.equal(g.totais.proposta,120);
 assert.equal(g.totais.baseMercado,2); assert.equal(g.totais.vitoriasAtual,1);assert.equal(g.totais.empatesAtual,1);assert.equal(g.totais.vitoriasNova,1);
 assert.equal(g.totais.faturamentoAtual,110);assert.equal(g.totais.faturamentoNova,100);
});
test('sem proposta exclui os dois lados e ausência de concorrentes não vira vitória',()=>{
 const g=criarGerencialReajuste();acumularGerencialReajuste(g,{...linha,proposta:null});acumularGerencialReajuste(g,{...linha,concorrente:null});
 assert.equal(g.totais.proprios,2);assert.equal(g.totais.comparaveis,1);assert.equal(g.totais.semCalculo,1);assert.equal(g.totais.realizado,100);assert.equal(g.totais.baseMercado,0);assert.equal(g.totais.vitoriasNova,0);
});
test('base inteira não depende da amostra; soma por UF e consolidação fecham',()=>{
 const g=criarGerencialReajuste();for(let i=0;i<1000;i++)acumularGerencialReajuste(g,{...linha,cte:String(i)});
 assert.equal(g.totais.comparaveis,1000);assert.equal(g.totais.realizado,100000);assert.equal(Object.values(g.rotas)[0].amostra.length,20);
 const h=consolidarGerenciaisReajuste([g,JSON.parse(JSON.stringify(g))]);assert.equal(h.totais.realizado,200000);assert.equal(estadosGerenciais(h)[0].realizado,h.totais.realizado);assert.equal(Object.values(h.rotas)[0].amostra.length,20);
 assert.equal(consolidarGerenciaisReajuste([g,null]),null);
});
test('valor pago ausente não vira zero; valores a centavos definem empate',()=>{
 const g=criarGerencialReajuste();acumularGerencialReajuste(g,{...linha,realizado:null,atual:115.001,concorrente:115});assert.equal(g.totais.comparaveis,0);assert.equal(g.totais.empatesAtual,1);
});
