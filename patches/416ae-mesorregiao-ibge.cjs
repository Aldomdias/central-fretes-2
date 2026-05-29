// Patch 4.16AE - rollback seguro.
// Não altera o motor de simulação.
// A tentativa anterior de buscar mesorregião dentro do cálculo foi removida/desativada
// porque a simulação não deve depender de municipioPorIbge dentro da função de cálculo.
// A mesorregião deve ser tratada posteriormente apenas no laudo/exportação.
console.log('4.16AE rollback seguro: sem alteração no motor de cálculo.');
