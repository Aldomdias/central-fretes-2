import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  analisarCoberturaTabela,
  analisarTransportadoraPorGrade,
  buildLookupTables,
  exportarLinhasCsv,
  getCidadeByIbge,
  getUfByIbge,
  simularPorTransportadora,
  simularSimples,
} from '../utils/calculoFrete';

const GRADE_STORAGE_KEY = 'amd-grade-peso-v2';
const GRADE_PADRAO = {"B2C": [{"peso": 1.0, "valorNF": 51.21686274509804, "cubagem": 0.007333333333333336}, {"peso": 2.0, "valorNF": 51.21686274509804, "cubagem": 0.007333333333333336}, {"peso": 3.0, "valorNF": 259.9127430555556, "cubagem": 0.029368055555555495}, {"peso": 4.0, "valorNF": 259.9127430555556, "cubagem": 0.029368055555555495}, {"peso": 5.0, "valorNF": 259.9127430555556, "cubagem": 0.029368055555555495}, {"peso": 6.0, "valorNF": 490.403956639566, "cubagem": 0.06804065040650403}, {"peso": 7.0, "valorNF": 490.403956639566, "cubagem": 0.06804065040650403}, {"peso": 8.0, "valorNF": 490.403956639566, "cubagem": 0.06804065040650403}, {"peso": 9.0, "valorNF": 490.403956639566, "cubagem": 0.06804065040650403}, {"peso": 10.0, "valorNF": 490.403956639566, "cubagem": 0.06804065040650403}, {"peso": 11.0, "valorNF": 845.6943108504394, "cubagem": 0.11434134897360602}, {"peso": 12.0, "valorNF": 845.6943108504394, "cubagem": 0.11434134897360602}, {"peso": 13.0, "valorNF": 845.6943108504394, "cubagem": 0.11434134897360602}, {"peso": 14.0, "valorNF": 845.6943108504394, "cubagem": 0.11434134897360602}, {"peso": 15.0, "valorNF": 845.6943108504394, "cubagem": 0.11434134897360602}, {"peso": 16.0, "valorNF": 845.6943108504394, "cubagem": 0.11434134897360602}, {"peso": 17.0, "valorNF": 845.6943108504394, "cubagem": 0.11434134897360602}, {"peso": 18.0, "valorNF": 845.6943108504394, "cubagem": 0.11434134897360602}, {"peso": 19.0, "valorNF": 845.6943108504394, "cubagem": 0.11434134897360602}, {"peso": 20.0, "valorNF": 845.6943108504394, "cubagem": 0.11434134897360602}, {"peso": 21.0, "valorNF": 1342.6932385466023, "cubagem": 0.1826532385466017}, {"peso": 22.0, "valorNF": 1342.6932385466023, "cubagem": 0.1826532385466017}, {"peso": 23.0, "valorNF": 1342.6932385466023, "cubagem": 0.1826532385466017}, {"peso": 24.0, "valorNF": 1342.6932385466023, "cubagem": 0.1826532385466017}, {"peso": 25.0, "valorNF": 1342.6932385466023, "cubagem": 0.1826532385466017}, {"peso": 26.0, "valorNF": 1342.6932385466023, "cubagem": 0.1826532385466017}, {"peso": 27.0, "valorNF": 1342.6932385466023, "cubagem": 0.1826532385466017}, {"peso": 28.0, "valorNF": 1342.6932385466023, "cubagem": 0.1826532385466017}, {"peso": 29.0, "valorNF": 1342.6932385466023, "cubagem": 0.1826532385466017}, {"peso": 30.0, "valorNF": 1342.6932385466023, "cubagem": 0.1826532385466017}, {"peso": 31.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 32.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 33.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 34.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 35.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 36.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 37.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 38.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 39.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 40.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 41.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 42.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 43.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 44.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 45.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 46.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 47.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 48.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 49.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 50.0, "valorNF": 1954.3065982203975, "cubagem": 0.27272758384667856}, {"peso": 51.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 52.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 53.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 54.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 55.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 56.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 57.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 58.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 59.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 60.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 61.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 62.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 63.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 64.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 65.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 66.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 67.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 68.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 69.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 70.0, "valorNF": 3020.162869565216, "cubagem": 0.43490434782608706}, {"peso": 71.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 72.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 73.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 74.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 75.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 76.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 77.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 78.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 79.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 80.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 81.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 82.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 83.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 84.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 85.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 86.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 87.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 88.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 89.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 90.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 91.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 92.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 93.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 94.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 95.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 96.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 97.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 98.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 99.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 100.0, "valorNF": 3789.0325974026, "cubagem": 0.6591298701298703}, {"peso": 101.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 102.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 103.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 104.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 105.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 106.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 107.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 108.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 109.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 110.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 111.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 112.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 113.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 114.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 115.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 116.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 117.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 118.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 119.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 120.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 121.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 122.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 123.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 124.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 125.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 126.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 127.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 128.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 129.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 130.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 131.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 132.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 133.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 134.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 135.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 136.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 137.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 138.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 139.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 140.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 141.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 142.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 143.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 144.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 145.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 146.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 147.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 148.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 149.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}, {"peso": 150.0, "valorNF": 4350.890322580644, "cubagem": 1.1308709677419357}], "ATACADO": [{"peso": 10.0, "valorNF": 446.9, "cubagem": 0.018}, {"peso": 20.0, "valorNF": 825.6850000000001, "cubagem": 0.10092857142857145}, {"peso": 30.0, "valorNF": 1847.7061904761902, "cubagem": 0.2565714285714286}, {"peso": 40.0, "valorNF": 1847.7061904761902, "cubagem": 0.2565714285714286}, {"peso": 50.0, "valorNF": 1847.7061904761902, "cubagem": 0.2565714285714286}, {"peso": 60.0, "valorNF": 3112.103454545454, "cubagem": 0.5039454545454545}, {"peso": 70.0, "valorNF": 3112.103454545454, "cubagem": 0.5039454545454545}, {"peso": 80.0, "valorNF": 3112.103454545454, "cubagem": 0.5039454545454545}, {"peso": 90.0, "valorNF": 3112.103454545454, "cubagem": 0.5039454545454545}, {"peso": 100.0, "valorNF": 3112.103454545454, "cubagem": 0.5039454545454545}, {"peso": 110.0, "valorNF": 4955.245222222223, "cubagem": 0.6981777777777773}, {"peso": 120.0, "valorNF": 4955.245222222223, "cubagem": 0.6981777777777773}, {"peso": 130.0, "valorNF": 4955.245222222223, "cubagem": 0.6981777777777773}, {"peso": 140.0, "valorNF": 4955.245222222223, "cubagem": 0.6981777777777773}, {"peso": 150.0, "valorNF": 4955.245222222223, "cubagem": 0.6981777777777773}, {"peso": 160.0, "valorNF": 4955.245222222223, "cubagem": 0.6981777777777773}, {"peso": 170.0, "valorNF": 4955.245222222223, "cubagem": 0.6981777777777773}, {"peso": 180.0, "valorNF": 4955.245222222223, "cubagem": 0.6981777777777773}, {"peso": 190.0, "valorNF": 4955.245222222223, "cubagem": 0.6981777777777773}, {"peso": 200.0, "valorNF": 4955.245222222223, "cubagem": 0.6981777777777773}, {"peso": 210.0, "valorNF": 7982.178269230771, "cubagem": 1.6954807692307683}, {"peso": 220.0, "valorNF": 7982.178269230771, "cubagem": 1.6954807692307683}, {"peso": 230.0, "valorNF": 7982.178269230771, "cubagem": 1.6954807692307683}, {"peso": 240.0, "valorNF": 7982.178269230771, "cubagem": 1.6954807692307683}, {"peso": 250.0, "valorNF": 7982.178269230771, "cubagem": 1.6954807692307683}, {"peso": 260.0, "valorNF": 7982.178269230771, "cubagem": 1.6954807692307683}, {"peso": 270.0, "valorNF": 7982.178269230771, "cubagem": 1.6954807692307683}, {"peso": 280.0, "valorNF": 7982.178269230771, "cubagem": 1.6954807692307683}, {"peso": 290.0, "valorNF": 7982.178269230771, "cubagem": 1.6954807692307683}, {"peso": 300.0, "valorNF": 7982.178269230771, "cubagem": 1.6954807692307683}, {"peso": 310.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 320.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 330.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 340.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 350.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 360.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 370.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 380.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 390.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 400.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 410.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 420.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 430.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 440.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 450.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 460.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 470.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 480.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 490.0, "valorNF": 15367.294375, "cubagem": 2.7144375}, {"peso": 500.0, "valorNF": 15367.294375, "cubagem": 2.7144375}]};

const UF_OPTIONS = ['', 'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function downloadCsv(nomeArquivo, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', nomeArquivo);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}


function normalizeGradeMap(value = {}) {
  const normalizarLista = (lista) => (Array.isArray(lista) ? lista : [])
    .map((item) => ({
      peso: Number(item?.peso || 0),
      valorNF: Number(item?.valorNF || 0),
      cubagem: Number(item?.cubagem || 0),
    }))
    .filter((item) => item.peso > 0)
    .sort((a, b) => a.peso - b.peso);

  return {
    B2C: normalizarLista(value.B2C),
    ATACADO: normalizarLista(value.ATACADO),
  };
}

function loadGradeInicial() {
  try {
    const salvo = localStorage.getItem(GRADE_STORAGE_KEY);
    if (!salvo) return normalizeGradeMap(GRADE_PADRAO);
    return normalizeGradeMap(JSON.parse(salvo));
  } catch (error) {
    return normalizeGradeMap(GRADE_PADRAO);
  }
}

function salvarGradeNoStorage(grade) {
  localStorage.setItem(GRADE_STORAGE_KEY, JSON.stringify(normalizeGradeMap(grade)));
}

function baixarArquivo(blob, nomeArquivo) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', nomeArquivo);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function exportarGradeWorkbook(grade) {
  const workbook = XLSX.utils.book_new();
  ['B2C', 'ATACADO'].forEach((aba) => {
    const rows = (grade?.[aba] || []).map((item) => ({
      Peso: Number(item.peso || 0),
      'Valor NF': Number(item.valorNF || 0),
      Cubagem: Number(item.cubagem || 0),
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, aba);
  });
  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  baixarArquivo(new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Grade Peso.xlsx');
}

function parseGradeWorkbook(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetNameMap = Object.fromEntries(
    workbook.SheetNames.map((name) => [String(name || '').trim().toUpperCase(), name]),
  );
  const b2cSheet = sheetNameMap.B2C;
  const atacadoSheet = sheetNameMap.ATACADO;
  if (!b2cSheet || !atacadoSheet) {
    throw new Error('O arquivo precisa ter as abas B2C e ATACADO.');
  }

  const parseSheet = (sheetName) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    return rows.map((row) => ({
      peso: Number(row.Peso || row.peso || row.PESO || 0),
      valorNF: Number(row['Valor NF'] || row.valorNF || row['ValorNF'] || row['VALOR NF'] || 0),
      cubagem: Number(row.Cubagem || row.cubagem || row.CUBAGEM || 0),
    })).filter((item) => item.peso > 0);
  };

  return normalizeGradeMap({
    B2C: parseSheet(b2cSheet),
    ATACADO: parseSheet(atacadoSheet),
  });
}

function formatPeso(value) {
  return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function getCanalGrade(canal) {
  return canal === 'B2C' ? 'B2C' : 'ATACADO';
}

function buildDestinoLabel(item) {
  if (item.cidadeDestino) return `${item.cidadeDestino}${item.ufDestino ? `/${item.ufDestino}` : ''}`;
  return `IBGE ${item.ibgeDestino}`;
}


function DetalheTabela({ linhas }) {
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
      {linhas.map((linha) => (
        <div key={linha.label} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, padding: '6px 0', borderBottom: '1px solid #e8edf7' }}>
          <span style={{ color: '#48608b' }}>{linha.label}</span>
          <strong style={{ textAlign: 'right' }}>{linha.value}</strong>
        </div>
      ))}
    </div>
  );
}

function ResultadoCard({ item }) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="sim-resultado-card">
      <div className="sim-resultado-topo compact-top">
        <div>
          <strong>{item.transportadora}</strong>
          <div className="sim-resultado-linha">Origem {item.origem} • Destino {buildDestinoLabel(item)}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>#{item.ranking || 1} • {item.prazo} dia(s)</span>
          <button className="sim-tab" type="button" onClick={() => setAberto((v) => !v)}>
            {aberto ? 'Fechar detalhes' : 'Ver detalhes'}
          </button>
        </div>
      </div>

      <div className="sim-resultado-grade">
        <div>
          <span>Frete final</span>
          <strong>{formatMoney(item.total)}</strong>
        </div>
        <div>
          <span>Saving vs 2º</span>
          <strong>{formatMoney(item.savingSegundo)}</strong>
        </div>
        <div>
          <span>Diferença p/ líder</span>
          <strong>{formatMoney(item.diferencaLider)}</strong>
        </div>
        <div>
          <span>Redução p/ líder</span>
          <strong>{formatPercent(item.reducaoNecessariaPct)}</strong>
        </div>
      </div>

      {aberto && (
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
          <div className="sim-parametros-box">
            <div className="sim-parametros-header">
              <div>
                <strong>Formação do frete e prazo</strong>
                <p>Como o valor base foi encontrado.</p>
              </div>
            </div>
            <DetalheTabela
              linhas={[
                { label: 'Tipo de cálculo', value: item.detalhes.frete.tipoCalculo },
                { label: 'Prazo', value: `${item.detalhes.prazo} dia(s)` },
                { label: 'Faixa aplicada', value: item.detalhes.frete.faixaPeso },
                { label: 'Peso informado', value: `${Number(item.detalhes.frete.pesoInformado || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg` },
                { label: 'Peso da grade', value: `${Number(item.detalhes.frete.pesoGrade || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg` },
                { label: 'Cubagem da grade', value: `${Number(item.detalhes.frete.cubagemGrade || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 })} m³` },
                { label: 'Fator cubagem', value: `${Number(item.detalhes.frete.fatorCubagem || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg/m³` },
                { label: 'Peso cubado', value: `${Number(item.detalhes.frete.pesoCubado || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg` },
                { label: 'Peso considerado', value: `${Number(item.detalhes.frete.pesoConsiderado || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg` },
                { label: 'R$/kg', value: item.detalhes.frete.rsKgAplicado.toFixed(4) },
                { label: '% aplicado', value: formatPercent(item.detalhes.frete.percentualAplicado) },
                { label: 'Valor fixo/faixa', value: formatMoney(item.detalhes.frete.valorFixoAplicado) },
                { label: 'Valor NF utilizado', value: `${formatMoney(item.detalhes.frete.valorNFInformado)}${item.detalhes.frete.valorNFOrigem === 'grade' ? ' (grade padrão)' : ' (manual)'}` },
                { label: 'Limite para excedente', value: `${Number(item.detalhes.frete.pesoLimiteExcedente || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg` },
                { label: 'Peso excedente', value: `${Number(item.detalhes.frete.pesoExcedente || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg` },
                { label: 'Valor do excedente', value: formatMoney(item.detalhes.frete.valorExcedente) },
                { label: 'Mínimo da rota', value: formatMoney(item.detalhes.frete.minimoRota) },
                { label: 'Valor base', value: formatMoney(item.detalhes.frete.valorBase) },
                { label: 'Subtotal antes do ICMS', value: formatMoney(item.detalhes.frete.subtotal) },
                { label: `ICMS (${formatPercent(item.detalhes.frete.aliquotaIcms)})`, value: `${formatMoney(item.detalhes.frete.icms)}${item.detalhes.frete.origemAliquotaIcms === 'legislacao' ? ' • automático' : ' • manual'}` },
              ]}
            />
          </div>

          <div className="sim-parametros-box">
            <div className="sim-parametros-header">
              <div>
                <strong>Taxas adicionais vinculadas</strong>
                <p>Taxas gerais e específicas do destino.</p>
              </div>
            </div>
            <DetalheTabela
              linhas={[
                { label: 'Ad Valorem', value: `${formatMoney(item.detalhes.taxas.adValorem)} (${formatPercent(item.detalhes.taxas.adValPct)} • mín. ${formatMoney(item.detalhes.taxas.adValMin)})` },
                { label: 'GRIS', value: `${formatMoney(item.detalhes.taxas.gris)} (${formatPercent(item.detalhes.taxas.grisPct)} • mín. ${formatMoney(item.detalhes.taxas.grisMin)})` },
                { label: 'Pedágio', value: formatMoney(item.detalhes.taxas.pedagio) },
                { label: 'TAS', value: formatMoney(item.detalhes.taxas.tas) },
                { label: 'CTRC', value: formatMoney(item.detalhes.taxas.ctrc) },
                { label: 'TDA/STDA', value: formatMoney(item.detalhes.taxas.tda) },
                { label: 'TDE', value: formatMoney(item.detalhes.taxas.tde) },
                { label: 'TDR', value: formatMoney(item.detalhes.taxas.tdr) },
                { label: 'TRT', value: formatMoney(item.detalhes.taxas.trt) },
                { label: 'Suframa', value: formatMoney(item.detalhes.taxas.suframa) },
                { label: 'Outras', value: formatMoney(item.detalhes.taxas.outras) },
                { label: 'Total de taxas', value: formatMoney(item.detalhes.taxas.totalTaxas) },
                { label: 'Frete final', value: formatMoney(item.detalhes.frete.total) },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function GraficoUf({ itens }) {
  if (!itens?.length) return null;
  const maxFaltantes = Math.max(...itens.map((item) => item.faltantes || 0), 1);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {itens.slice(0, 8).map((item) => {
        const largura = item.aderencia !== undefined
          ? `${Math.max(Math.min(Number(item.aderencia || 0), 100), 0)}%`
          : `${((item.faltantes || 0) / maxFaltantes) * 100}%`;
        return (
          <div key={item.uf}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <strong>{item.uf}</strong>
              <span>{item.aderencia !== undefined ? `${item.total} rotas • ${formatPercent(item.aderencia)}` : `${item.faltantes} faltantes`}</span>
            </div>
            <div style={{ background: '#e7eefb', borderRadius: 999, height: 10, overflow: 'hidden' }}>
              <div style={{ width: largura, height: '100%', background: '#071b49' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function SimuladorPage({ transportadoras = [] }) {
  const [aba, setAba] = useState('simples');

  const lookup = useMemo(() => buildLookupTables(transportadoras), [transportadoras]);
  const { cidadePorIbge, destinosDisponiveis } = lookup;

  const canais = useMemo(() => [...new Set(transportadoras.flatMap((item) => (item.origens || []).map((origem) => origem.canal)).filter(Boolean))], [transportadoras]);
  const todasOrigens = useMemo(() => [...new Set(transportadoras.flatMap((item) => (item.origens || []).map((origem) => origem.cidade)).filter(Boolean))].sort(), [transportadoras]);
  const todosDestinosComCidade = useMemo(() => destinosDisponiveis.map((ibge) => ({ ibge, cidade: getCidadeByIbge(ibge, cidadePorIbge), uf: getUfByIbge(ibge) })), [destinosDisponiveis, cidadePorIbge]);

  const [origemSimples, setOrigemSimples] = useState(todasOrigens[0] || '');
  const [destinoCodigo, setDestinoCodigo] = useState(destinosDisponiveis[0] || '');
  const [canalSimples, setCanalSimples] = useState(canais[0] || 'ATACADO');
  const [pesoSimples, setPesoSimples] = useState('150');
  const [nfSimples, setNfSimples] = useState('');
  const [resultadoSimples, setResultadoSimples] = useState([]);

  const [transportadora, setTransportadora] = useState(transportadoras[0]?.nome || '');
  const [canalTransportadora, setCanalTransportadora] = useState(canais[0] || 'ATACADO');
  const [origemTransportadora, setOrigemTransportadora] = useState('');
  const [destinoTransportadora, setDestinoTransportadora] = useState('');
  const [pesoTransportadora, setPesoTransportadora] = useState('150');
  const [nfTransportadora, setNfTransportadora] = useState('');
  const [modoLista, setModoLista] = useState(false);
  const [listaCodigos, setListaCodigos] = useState('4206405\n4202156\n4205001\n4200804');
  const [resultadoTransportadora, setResultadoTransportadora] = useState([]);

  const [transportadoraAnalise, setTransportadoraAnalise] = useState(transportadoras[0]?.nome || '');
  const [canalAnalise, setCanalAnalise] = useState(canais[0] || 'ATACADO');
  const [grade, setGrade] = useState(() => loadGradeInicial());
  const [resultadoAnalise, setResultadoAnalise] = useState(null);
  const importGradeRef = useRef(null);

  const [canalCobertura, setCanalCobertura] = useState(canais[0] || 'ATACADO');
  const [origemCobertura, setOrigemCobertura] = useState('');
  const [transportadoraCobertura, setTransportadoraCobertura] = useState('');
  const [ufCobertura, setUfCobertura] = useState('');
  const [resultadoCobertura, setResultadoCobertura] = useState(null);

  const transportadorasDisponiveis = useMemo(() => transportadoras.map((item) => item.nome).sort(), [transportadoras]);

  useEffect(() => {
    salvarGradeNoStorage(grade);
  }, [grade]);

  useEffect(() => {
    if (!transportadora && transportadorasDisponiveis.length) setTransportadora(transportadorasDisponiveis[0]);
    if (!transportadoraAnalise && transportadorasDisponiveis.length) setTransportadoraAnalise(transportadorasDisponiveis[0]);
    if (!origemSimples && todasOrigens.length) setOrigemSimples(todasOrigens[0]);
    if (!destinoCodigo && destinosDisponiveis.length) setDestinoCodigo(destinosDisponiveis[0]);
  }, [transportadora, transportadoraAnalise, origemSimples, destinoCodigo, transportadorasDisponiveis, todasOrigens, destinosDisponiveis]);

  const quantidadeLinhasGrade = useMemo(() => ({
    B2C: grade.B2C?.length || 0,
    ATACADO: grade.ATACADO?.length || 0,
  }), [grade]);


  const origensTransportadora = useMemo(() => {
    const selecionada = transportadoras.find((item) => item.nome === transportadora);
    if (!selecionada) return [];
    return [...new Set((selecionada.origens || []).filter((item) => !canalTransportadora || item.canal === canalTransportadora).map((item) => item.cidade))].sort();
  }, [transportadoras, transportadora, canalTransportadora]);

  const canaisTransportadora = useMemo(() => {
    const selecionada = transportadoras.find((item) => item.nome === transportadora);
    if (!selecionada) return canais;
    return [...new Set((selecionada.origens || []).map((item) => item.canal).filter(Boolean))];
  }, [transportadoras, transportadora, canais]);


  const exportarModeloGrade = () => {
    exportarGradeWorkbook(grade);
  };

  const restaurarGradePadrao = () => {
    const base = normalizeGradeMap(GRADE_PADRAO);
    setGrade(base);
    setResultadoAnalise(null);
  };

  const abrirImportacaoGrade = () => {
    importGradeRef.current?.click();
  };

  const onImportarGrade = async (event) => {
    const arquivo = event.target.files?.[0];
    if (!arquivo) return;
    try {
      const arrayBuffer = await arquivo.arrayBuffer();
      const gradeImportada = parseGradeWorkbook(arrayBuffer);
      setGrade(gradeImportada);
      setResultadoAnalise(null);
      window.alert('Grade importada com sucesso.');
    } catch (error) {
      window.alert(error?.message || 'Não foi possível importar a grade.');
    } finally {
      event.target.value = '';
    }
  };

  const onSimularSimples = () => {
    setResultadoSimples(simularSimples({
      transportadoras,
      origem: origemSimples,
      canal: canalSimples,
      peso: Number(pesoSimples),
      valorNF: Number(nfSimples || 0),
      destinoCodigo,
      cidadePorIbge,
      gradeCanal: grade[getCanalGrade(canalSimples)] || [],
    }));
  };

  const onSimularTransportadora = () => {
    const codigos = modoLista
      ? listaCodigos.split(/\n|,|;/).map((item) => item.trim()).filter(Boolean)
      : destinoTransportadora
        ? [destinoTransportadora]
        : [];

    setResultadoTransportadora(simularPorTransportadora({
      transportadoras,
      nomeTransportadora: transportadora,
      canal: canalTransportadora,
      origem: origemTransportadora,
      destinoCodigos: codigos,
      peso: Number(pesoTransportadora),
      valorNF: Number(nfTransportadora || 0),
      cidadePorIbge,
      gradeCanal: grade[getCanalGrade(canalTransportadora)] || [],
    }));
  };

  const exportarSimulacaoTransportadora = () => {
    if (!resultadoTransportadora.length) return;
    const { nomeArquivo, csv } = exportarLinhasCsv(`simulacao-${transportadora.toLowerCase().replace(/\s+/g, '-')}.csv`, [
      ['Transportadora', 'Origem', 'Destino', 'UF', 'IBGE', 'Peso informado', 'Peso cubado', 'Peso considerado', 'Prazo', 'Frete Final', 'Saving vs 2º', 'Diferença Líder', 'Redução % Líder'],
      ...resultadoTransportadora.map((item) => [
        item.transportadora,
        item.origem,
        item.cidadeDestino || `IBGE ${item.ibgeDestino}`,
        item.ufDestino,
        item.ibgeDestino,
        item.detalhes?.frete?.pesoInformado ?? '',
        item.detalhes?.frete?.pesoCubado ?? '',
        item.detalhes?.frete?.pesoConsiderado ?? '',
        item.prazo,
        item.total.toFixed(2),
        item.savingSegundo.toFixed(2),
        item.diferencaLider.toFixed(2),
        item.reducaoNecessariaPct.toFixed(2),
      ]),
    ]);
    downloadCsv(nomeArquivo, csv);
  };

  const onSimularGrade = () => {
    setResultadoAnalise(analisarTransportadoraPorGrade({
      transportadoras,
      nomeTransportadora: transportadoraAnalise,
      canal: canalAnalise,
      grade: grade[getCanalGrade(canalAnalise)] || grade.ATACADO,
      cidadePorIbge,
    }));
  };

  const exportarAnalise = () => {
    if (!resultadoAnalise?.detalhes?.length) return;
    const { nomeArquivo, csv } = exportarLinhasCsv(`analise-${transportadoraAnalise.toLowerCase().replace(/\s+/g, '-')}.csv`, [
      ['Transportadora', 'Origem', 'Destino', 'UF', 'IBGE', 'Peso grade', 'Cubagem grade', 'Peso cubado', 'Peso considerado', 'Valor NF', 'Prazo', 'Ranking', 'Frete Final', 'Saving 2º'],
      ...resultadoAnalise.detalhes.map((item) => [
        item.transportadora,
        item.origem,
        item.cidadeDestino || `IBGE ${item.ibgeDestino}`,
        item.ufDestino,
        item.ibgeDestino,
        item.gradePeso,
        item.gradeCubagem,
        item.pesoCubado,
        item.pesoConsiderado,
        item.gradeValorNF,
        item.prazo,
        item.ranking,
        item.total.toFixed(2),
        item.savingSegundo.toFixed(2),
      ]),
    ]);
    downloadCsv(nomeArquivo, csv);
  };

  const onAnalisarCobertura = () => {
    setResultadoCobertura(analisarCoberturaTabela({
      transportadoras,
      canal: canalCobertura,
      origem: origemCobertura,
      transportadora: transportadoraCobertura,
      ufDestino: ufCobertura,
      cidadePorIbge,
    }));
  };

  const exportarCobertura = () => {
    if (!resultadoCobertura?.faltantes?.length) return;
    const { nomeArquivo, csv } = exportarLinhasCsv('cobertura-faltantes.csv', [
      ['Origem', 'UF Destino', 'Cidade Destino', 'IBGE Destino', 'Status'],
      ...resultadoCobertura.faltantes.map((item) => [item.origem, item.uf, item.cidade || '', item.ibge, 'Sem tabela']),
    ]);
    downloadCsv(nomeArquivo, csv);
  };

  return (
    <div className="simulador-shell">
      <div className="simulador-header compact-top">
        <div className="simulador-subtitulo">AMD Log • Plataforma de Fretes</div>
        <h1>Simulador de fretes</h1>
        <p>Simulação com base nas tabelas reais importadas por transportadora, origem, rota, cotação e taxas especiais.</p>
      </div>

      <div className="sim-tabs">
        {[
          ['simples', 'Simulação simples'],
          ['transportadora', 'Simulação por transportadora'],
          ['analise', 'Análise de transportadora'],
          ['cobertura', 'Cobertura de tabela'],
        ].map(([id, label]) => (
          <button key={id} className={`sim-tab ${aba === id ? 'active' : ''}`} onClick={() => setAba(id)}>
            {label}
          </button>
        ))}
      </div>

      {aba === 'simples' && (
        <section className="sim-card">
          <h2>Simulação simples</h2>
          <div className="sim-form-grid sim-grid-5">
            <label>Origem
              <select value={origemSimples} onChange={(e) => setOrigemSimples(e.target.value)}>
                {todasOrigens.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Destino (CEP ou IBGE)
              <input list="destinos-lista" value={destinoCodigo} onChange={(e) => setDestinoCodigo(e.target.value)} placeholder="Ex: 3506003" />
              <datalist id="destinos-lista">
                {todosDestinosComCidade.map((item) => <option key={item.ibge} value={item.ibge}>{item.cidade ? `${item.cidade}/${item.uf}` : item.ibge}</option>)}
              </datalist>
            </label>
            <label>Canal
              <select value={canalSimples} onChange={(e) => setCanalSimples(e.target.value)}>
                {canais.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Peso
              <input value={pesoSimples} onChange={(e) => setPesoSimples(e.target.value)} />
            </label>
            <label>Valor NF (opcional)
              <input value={nfSimples} onChange={(e) => setNfSimples(e.target.value)} placeholder="Se vazio, usa a grade" />
              <small>Se não informar, o simulador usa o Valor NF da grade para este peso.</small>
            </label>
          </div>
          <div className="sim-actions"><button className="primary" onClick={onSimularSimples}>Simular</button></div>
          <div className="sim-resultados">{resultadoSimples.map((item, idx) => <ResultadoCard key={`${item.transportadora}-${idx}`} item={item} />)}</div>
        </section>
      )}

      {aba === 'transportadora' && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <h2 style={{ margin: 0 }}>Simulação por transportadora</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="sim-tab" type="button" onClick={exportarSimulacaoTransportadora}>Exportar relatório</button>
            </div>
          </div>
          <div className="sim-form-grid sim-grid-6">
            <label>Transportadora
              <select value={transportadora} onChange={(e) => {
                setTransportadora(e.target.value);
                setOrigemTransportadora('');
                const nova = transportadoras.find((item) => item.nome === e.target.value);
                const primeiroCanal = [...new Set((nova?.origens || []).map((item) => item.canal).filter(Boolean))][0] || canais[0] || 'ATACADO';
                setCanalTransportadora(primeiroCanal);
              }}>
                {transportadorasDisponiveis.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Canal
              <select value={canalTransportadora} onChange={(e) => setCanalTransportadora(e.target.value)}>
                {canaisTransportadora.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Origem (opcional)
              <select value={origemTransportadora} onChange={(e) => setOrigemTransportadora(e.target.value)}>
                <option value="">Todas</option>
                {origensTransportadora.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Destino opcional (CEP ou IBGE)
              <input disabled={modoLista} value={destinoTransportadora} onChange={(e) => setDestinoTransportadora(e.target.value)} placeholder="Ex: 3506003" />
            </label>
            <label>Peso
              <input value={pesoTransportadora} onChange={(e) => setPesoTransportadora(e.target.value)} />
            </label>
            <label>Valor NF (opcional)
              <input value={nfTransportadora} onChange={(e) => setNfTransportadora(e.target.value)} placeholder="Se vazio, usa a grade" />
              <small>Se não informar, usa a grade do canal para todos os cenários.</small>
            </label>
          </div>
          <div className="sim-inline-tools">
            <label className="sim-flag">
              <input type="checkbox" checked={modoLista} onChange={(e) => setModoLista(e.target.checked)} />
              Simulação em massa por lista de CEP/IBGE
            </label>
            {modoLista && (
              <div className="sim-lista-box" style={{ marginTop: 12 }}>
                <label>Lista de CEPs ou IBGEs
                  <textarea value={listaCodigos} onChange={(e) => setListaCodigos(e.target.value)} />
                </label>
              </div>
            )}
          </div>
          <div className="sim-actions"><button className="primary" onClick={onSimularTransportadora}>Simular transportadora</button></div>
          <div className="sim-resultados">{resultadoTransportadora.map((item, idx) => <ResultadoCard key={`${item.transportadora}-${item.ibgeDestino}-${idx}`} item={item} />)}</div>
        </section>
      )}

      {aba === 'analise' && (
        <section className="sim-card">
          <input
            ref={importGradeRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={onImportarGrade}
          />
          <div className="sim-resultado-topo compact-top">
            <h2 style={{ margin: 0 }}>Análise de transportadora</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="sim-tab" type="button" onClick={exportarModeloGrade}>Exportar grade</button>
              <button className="sim-tab" type="button" onClick={abrirImportacaoGrade}>Importar grade</button>
              <button className="sim-tab" type="button" onClick={restaurarGradePadrao}>Restaurar padrão</button>
              <button className="sim-tab" type="button" onClick={exportarAnalise}>Exportar relatório</button>
            </div>
          </div>

          <div className="sim-parametros-box" style={{ marginBottom: 16 }}>
            <div className="sim-parametros-header">
              <div>
                <strong>Grade ativa da análise</strong>
                <p>Esta grade já usa seu modelo com Peso, Valor NF e Cubagem. A cubagem entra em todas as simulações para calcular o peso considerado por transportadora.</p>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              <div>Linhas B2C: <strong>{quantidadeLinhasGrade.B2C}</strong></div>
              <div>Linhas ATACADO: <strong>{quantidadeLinhasGrade.ATACADO}</strong></div>
              <div>Regra aplicada: <strong>peso considerado = maior entre peso informado e cubagem da grade × fator de cubagem da transportadora</strong></div>
            </div>
          </div>

          <div className="sim-form-grid sim-grid-3">
            <label>Transportadora
              <select value={transportadoraAnalise} onChange={(e) => setTransportadoraAnalise(e.target.value)}>
                {transportadorasDisponiveis.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Canal
              <select value={canalAnalise} onChange={(e) => setCanalAnalise(e.target.value)}>
                {canais.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <div className="sim-actions" style={{ alignItems: 'flex-end' }}>
              <button className="primary" onClick={onSimularGrade}>Gerar relatório</button>
            </div>
          </div>

          {resultadoAnalise && (
            <div className="sim-cobertura-box">
              <div className="sim-analise-resumo">
                <div><span>Rotas avaliadas</span><strong>{resultadoAnalise.rotasAvaliadas}</strong></div>
                <div><span>Vitórias</span><strong>{resultadoAnalise.vitorias}</strong></div>
                <div><span>Aderência</span><strong>{formatPercent(resultadoAnalise.aderencia)}</strong></div>
                <div><span>Saving potencial</span><strong>{formatMoney(resultadoAnalise.saving)}</strong></div>
                <div><span>Prazo médio</span><strong>{resultadoAnalise.prazoMedio.toFixed(1)} dia(s)</strong></div>
                <div><span>Frete médio</span><strong>{formatMoney(resultadoAnalise.freteMedio)}</strong></div>
              </div>

              <div className="sim-grid-2" style={{ display: 'grid', gap: 16 }}>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Desempenho por UF</strong><p>Onde a transportadora fica mais competitiva.</p></div></div>
                  <div style={{ marginTop: 12 }}><GraficoUf itens={resultadoAnalise.porUf} /></div>
                </div>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Leitura do relatório</strong><p>Base para devolutiva, reunião ou negociação.</p></div></div>
                  <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    <div>Total de linhas geradas: <strong>{resultadoAnalise.detalhes.length}</strong></div>
                    <div>Vitórias na grade: <strong>{resultadoAnalise.vitorias}</strong></div>
                    <div>Rotas fora do 1º lugar: <strong>{resultadoAnalise.rotasAvaliadas - resultadoAnalise.vitorias}</strong></div>
                    <div>Melhor uso: <strong>comparar aderência, prazo e necessidade de redução.</strong></div>
                  </div>
                </div>
              </div>

              <div className="sim-resultados">
                {resultadoAnalise.detalhes.slice(0, 30).map((item, idx) => <ResultadoCard key={`${item.transportadora}-${idx}`} item={item} />)}
              </div>
            </div>
          )}
        </section>
      )}

      {aba === 'cobertura' && (
        <section className="sim-card">
          <div className="sim-resultado-topo compact-top">
            <h2 style={{ margin: 0 }}>Cobertura de tabela</h2>
            <button className="sim-tab" type="button" onClick={exportarCobertura}>Exportar faltantes</button>
          </div>
          <div className="sim-form-grid sim-grid-4" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
            <label>Canal
              <select value={canalCobertura} onChange={(e) => setCanalCobertura(e.target.value)}>
                {canais.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Origem
              <select value={origemCobertura} onChange={(e) => setOrigemCobertura(e.target.value)}>
                <option value="">Todas</option>
                {todasOrigens.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>Transportadora
              <select value={transportadoraCobertura} onChange={(e) => setTransportadoraCobertura(e.target.value)}>
                <option value="">Todas</option>
                {transportadorasDisponiveis.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label>UF destino
              <select value={ufCobertura} onChange={(e) => setUfCobertura(e.target.value)}>
                {UF_OPTIONS.map((item) => <option key={item} value={item}>{item || 'Todas'}</option>)}
              </select>
            </label>
          </div>
          <div className="sim-actions"><button className="primary" onClick={onAnalisarCobertura}>Analisar cobertura</button></div>

          {resultadoCobertura && (
            <div className="sim-cobertura-box">
              <div className="sim-parametros-box">
                <div className="sim-parametros-header">
                  <div>
                    <strong>O que esta tela mostra</strong>
                    <p>{resultadoCobertura.explicacao}</p>
                  </div>
                </div>
              </div>

              <div className="sim-analise-resumo">
                <div><span>Origens analisadas</span><strong>{resultadoCobertura.origensSelecionadas.join(', ') || 'Nenhuma'}</strong></div>
                <div><span>Destinos únicos na malha</span><strong>{resultadoCobertura.destinosUniverso.length}</strong></div>
                <div><span>Combinações possíveis</span><strong>{resultadoCobertura.totalCombinacoes}</strong></div>
                <div><span>Cobertas</span><strong>{resultadoCobertura.totalCobertas}</strong></div>
                <div><span>Sem tabela</span><strong>{resultadoCobertura.totalFaltantes}</strong></div>
                <div><span>Cobertura</span><strong>{formatPercent(resultadoCobertura.percentualCobertura)}</strong></div>
              </div>

              <div className="sim-grid-2" style={{ display: 'grid', gap: 16 }}>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Faltantes por UF</strong><p>Onde estão os maiores buracos de malha.</p></div></div>
                  <div style={{ marginTop: 12 }}><GraficoUf itens={resultadoCobertura.resumoPorUf} /></div>
                </div>
                <div className="sim-parametros-box">
                  <div className="sim-parametros-header"><div><strong>Como ler</strong><p>Exemplo: Itajaí → SP mostra quantas cidades de SP ainda estão sem tabela.</p></div></div>
                  <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    <div>Use o filtro de <strong>origem</strong> para analisar um polo específico.</div>
                    <div>Use <strong>UF destino</strong> para focar em um estado.</div>
                    <div>A lista abaixo mostra exatamente quais cidades/IBGEs faltam.</div>
                  </div>
                </div>
              </div>

              <div className="sim-grid-2" style={{ display: 'grid', gap: 16 }}>
                <div>
                  <h3 style={{ marginBottom: 10, color: '#071b49' }}>Sem tabela</h3>
                  <div className="sim-missing-list">
                    {resultadoCobertura.faltantes.slice(0, 60).map((item) => (
                      <div className="sim-missing-item" key={`${item.origem}-${item.ibge}`}>
                        <strong>{item.origem}</strong> • {item.cidade || `IBGE ${item.ibge}`} {item.uf ? `- ${item.uf}` : ''} • IBGE {item.ibge}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 style={{ marginBottom: 10, color: '#071b49' }}>Exemplos com tabela</h3>
                  <div className="sim-missing-list">
                    {resultadoCobertura.cobertas.slice(0, 60).map((item) => (
                      <div className="sim-missing-item" key={`${item.origem}-${item.ibge}`}>
                        <strong>{item.origem}</strong> • {item.cidade || `IBGE ${item.ibge}`} {item.uf ? `- ${item.uf}` : ''} • {item.rota}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
