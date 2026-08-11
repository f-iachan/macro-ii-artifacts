# Laboratório de IRFs — RBC

Artefato interativo para variar $\rho$, $\sigma$, $\zeta$ e $\delta$ e observar as
funções impulso-resposta do modelo RBC.

Abra `index.html` em um navegador. O artefato é autocontido e funciona sem internet.
Ele mostra o estado do solver, o resíduo máximo e os coeficientes das funções
políticas para não esconder o método numérico.

A derivação simbólica das oito equações e o jacobiano analítico usado no código Julia
estão em `../../julia_rbc_coeficientes_indeterminados.ipynb`.
