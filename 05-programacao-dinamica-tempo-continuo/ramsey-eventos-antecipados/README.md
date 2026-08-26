# Ramsey: notícias e eventos antecipados

Laboratório HTML para o bloco não estacionário da aula de Programação Dinâmica em
Tempo Contínuo. O artefato preserva os três experimentos de
`../../ramsey_dinamica_comparativa.ipynb`:

- mudança futura de TFP: `A1` começa em `T`;
- choque corrente transitório: `A1` termina em `T`;
- destruição aditiva anunciada: `k(T+) = k(T-) - 0,5`.

Os dois casos de TFP compartilham os controles `A0`, `A1`, `T` e EIS. Todos os
experimentos partem de `k(0)=k*(A0)`. No desastre, a TFP permanece em `A0` e `A1` não
entra no problema.

## Fonte quantitativa

`build_data.py` executa o notebook em memória, sem alterá-lo. Calibração, valores-base
e métricas de referência são lidos do namespace executado, e o contrato registra os
hashes SHA-256 do notebook e do script de construção. O próprio construtor de
variedades estáveis do notebook gera uma política normalizada para cada valor de EIS
disponível no slider. A homogeneidade Cobb-Douglas permite reescalar essas políticas
exatamente para qualquer `A0` ou `A1` admitido pela interface.

No navegador, `solver.js` implementa a mesma condição de matching do notebook:

1. integra as EDOs de Ramsey sob o regime pré-evento;
2. escolhe `c(0)` por shooting com raiz bracketed;
3. testa a política-alvo depois de aplicar o salto físico, quando houver;
4. segue a política estável pós-evento por uma EDO unidimensional.

O shooting forward é o método padrão. Em calibrações numericamente mal condicionadas,
há um fallback equivalente que ajusta o capital terminal e integra o problema de
contorno para trás. A saída registra qual método foi usado. O caso `A0=A1` é tratado
analiticamente como trajetória estacionária.

## Construção e testes

```bash
/opt/anaconda3/bin/python build_data.py
node test_solver.js
```

O teste compara a calibração-base às saídas do notebook, percorre todos os extremos dos
sliders e 128 combinações estritamente interiores reproduzíveis. Ele exige trajetórias
positivas e finitas, matching abaixo de `1e-6`, continuidade de capital e consumo nos
switches de TFP, salto exato de `-0,5` no desastre e contração pós-evento. Também
recalcula resíduos das EDOs sob os regimes ativos corretos e audita a política
linearmente interpolada que o navegador efetivamente usa (defeito normalizado abaixo
de `4e-5` no domínio completo e `8e-6` no núcleo econômico).

Abra `index.html` diretamente ou use qualquer servidor estático. Em páginas servidas, o
cálculo roda em `solver-worker.js`; se workers não estiverem disponíveis — situação
comum sob `file://` — a mesma API é executada no thread principal após debounce.

## Papel pedagógico

O HTML ensina a intuição visual: consumo reage à notícia, capital é predeterminado salvo
quando o choque físico o desloca, e a trajetória anterior a `T` é escolhida para chegar
à variedade correta exatamente na data do evento. O notebook continua sendo a fonte
para o método numérico e para a reprodução dos cálculos.
