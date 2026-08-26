# Saltos entre braços estáveis

Artefato HTML para a aula de Programação Dinâmica em Tempo Contínuo. O objetivo é
visualizar o modelo de Ramsey quando a TFP segue uma cadeia de Markov de dois estados:

- braços de política com e sem antecipação de futuras transições;
- trajetória contínua de capital e salto do consumo entre políticas no instante da
  transição de TFP;
- distribuições estacionárias condicionais a cada regime e distribuição
  incondicional de capital e consumo, todas sincronizadas com a realização.

## Fonte quantitativa

A calibração replica o notebook da aula:
`alpha=0.33`, `delta=0.08`, `rho=0.04`, `theta=2`, `A_low=1` e `A_high=1.3`.

`build_data.py` resolve a HJB acoplada por diferenças finitas monotônicas e iteração de
política de Howard. A distribuição estacionária é obtida do gerador da política. O
script gera `data.js`; o artefato não precisa de servidor nem de dependências externas.

```bash
/opt/anaconda3/bin/python build_data.py
```

Abra `index.html` diretamente no navegador. A trajetória inicial usa uma semente fixa,
portanto é reproduzível; o botão **Nova realização** avança a semente de forma
determinística. Os tempos de salto são exibidos na malha de simulação de 0,05 ano.

## Papel pedagógico

O HTML ensina a intuição: seguir um braço, saltar verticalmente entre políticas e
localizar a economia na distribuição de longo prazo. O método numérico da HJB não é
apresentado como substituto de notebook ou lista; fica auditável no gerador de dados.
