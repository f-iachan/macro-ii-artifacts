# Derivação RBC — handout digital e roteiro de quadro

Esta pasta contém dois objetos deliberadamente diferentes:

- `index.html`: versão digital completa do handout, com 9 capítulos, todas as
  derivações intermediárias, índice lateral, referências cruzadas e estilo de
  impressão;
- `slides.html`: roteiro Reveal.js curto para acompanhar a derivação no quadro.

## Uso

Abra `index.html` para estudar ou conferir as contas. Abra `slides.html` para a
apresentação: as setas navegam, `Espaço` revela etapas e `S` abre as notas do
professor. As duas páginas carregam MathJax por CDN; `slides.html` também carrega
Reveal.js, portanto precisam de conexão à internet.

O handout digital liga diretamente para:

- o PDF `handouts/rbc-cpos-loglinearizacao.pdf`;
- o notebook `julia_rbc_coeficientes_indeterminados.ipynb`;
- o laboratório `artifacts/rbc-irf-explorer/index.html`.

## Decisão pedagógica

O primeiro protótipo fazia `index.html` apontar diretamente para as 12 telas Reveal.
Ele funcionava como roteiro do professor, mas era incompleto para estudo autônomo.
A revisão separou as funções: a página principal agora transpõe integralmente o
handout; a apresentação curta permanece disponível, mas não se apresenta como a
versão HTML das notas.
