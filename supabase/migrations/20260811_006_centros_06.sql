insert into public.centros_filiais (codigo_centro, filial_sap_grupo, uf, endereco, cep, cnpj, cidade, cidade_chave, nome_resumo, cnpj_raiz, empresa_codigo) values
  ('1135', '1401', 'RS', 'Rodovia BR-392, 2367', '97070185', '46378127013551', 'Santa Maria', 'SANTA MARIA', 'GP', '46378127', '1401'),
  ('1136', '1401', 'SE', 'Av. Augusto Franco, 1380', '49075199', '46378127013632', 'Aracaju', 'ARACAJU', 'GP', '46378127', '1401'),
  ('1137', '1401', 'SP', 'Rua Alfredo Andre, 193, Anexo 183', '12940130', '46378127013713', 'Atibaia', 'ATIBAIA', 'GP', '46378127', '1401'),
  ('1147', '1401', 'SC', 'Av. Getulio Dorneles Vargas, 3169', '89805184', '46378127014795', 'Chapeco', 'CHAPECO', 'GP', '46378127', '1401'),
  ('1150', '1401', 'RO', 'Av. Marechal Rondon, 3496, Lote 6 Lote 7 Lote 8 Setor 01 Quadra 13', '76980082', '46378127015090', 'Vilhena', 'VILHENA', 'GP', '46378127', '1401'),
  ('1153', '1401', 'PE', 'Rua Beta, 27', '54345175', '46378127015333', 'Jaboatão dos Guararapes', 'JABOATAO DOS GUARARAPES', 'GP', '46378127', '1401'),
  ('1013', '1401', 'MS', 'Rua Buenos Aires, 240, Casa 01, Vila Margarida', '79023210', '46378127001383', 'Campo Grande', 'CAMPO GRANDE', 'GP', '46378127', '1401'),
  ('1106', '1401', 'PR', 'Av Parana, 1382, Zona 07', '87020085', '46378127010617', 'Maringá', 'MARINGA', 'GP', '46378127', '1401'),
  ('1128', '1401', 'MT', 'Rua A (Lot PRQ N Esperança II), 1365, Quadra 06, Lote 10/11, Área 10A, Jardim Industriário', '78099461', '46378127012822', 'Cuiaba', 'CUIABA', 'GP', '46378127', '1401'),
  ('1157', '1401', 'MA', 'Avenida Governador Luiz Rocha, 610, Quadra 119, Lote 21, Galpão 01, Bairro Potosi', '65800000', '46378127015767', 'BALSAS', 'BALSAS', 'GP', '46378127', '1401'),
  ('1158', '1401', 'MA', 'Rodovia BR-010 nº 33, Setor 001, Quadra 462, Bairro Entroncamento', '65913460', '46378127015848', 'IMPERATRIZ', 'IMPERATRIZ', 'GP', '46378127', '1401'),
  ('1159', '1401', 'MT', 'Rua Radial Araguaia, S/N, Bairro Arco Iris, Quadra 01, Lote 18-A', '78652000', '46378127015929', 'CONFRESA', 'CONFRESA', 'GP', '46378127', '1401'),
  ('1160', '1401', 'MA', 'Avenida Castelo Branco, 07, Quadra 07, Lote 07, Setor 08, Bairro São Felix', '65800000', '46378127016062', 'BALSAS', 'BALSAS', 'GP', '46378127', '1401'),
  ('1161', '1401', 'MA', 'Avenida Jose Olavo Sampaio, 1150, Quadra 105, Lote 1150, Bairro Centro', '65760000', '46378127016143', 'PRESIDENTE DUTRA', 'PRESIDENTE DUTRA', 'GP', '46378127', '1401'),
  ('1162', '1401', 'MA', 'Rodovia BR-222, S/N, Bairro Centro', '65393000', '46378127016224', 'BURITICUPU', 'BURITICUPU', 'GP', '46378127', '1401')
on conflict (codigo_centro, cnpj) do update set filial_sap_grupo=excluded.filial_sap_grupo, uf=excluded.uf, endereco=excluded.endereco, cep=excluded.cep, cidade=excluded.cidade, cidade_chave=excluded.cidade_chave, nome_resumo=excluded.nome_resumo, cnpj_raiz=excluded.cnpj_raiz, empresa_codigo=excluded.empresa_codigo;
