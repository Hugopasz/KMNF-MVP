# Karzstak Must Not Fall · MVP

Protótipo jogável (HTML/CSS/JS puro, sem dependências). Layout vertical, funciona em PC e mobile.

**Rodar:** abra `index.html` no navegador, ou sirva a pasta com `python -m http.server 8321` e acesse http://localhost:8321.

## O que já está implementado
- **5 lanes** de campo de batalha com mortos-vivos (normais e blindados a partir do dia 3).
- **Torres nos portões**: Besta 🏹 (rápida), Catapulta 🪨 (dano em área), Caldeirão 🍲 (curto alcance, dano alto). Podem ser evoluídas ou substituídas sem custo.
- **Munição e esteiras**: fábricas ⚙️ produzem munição, distribuída pela esteira **da esquerda para a direita**: a ordem dos portões importa, como no design.
- **Cidade 5×5** seguindo o mockup: quartéis (1), favelas (0, terreno livre), fábricas (2) e Centro de Distribuição (D). Quartéis e praças aumentam a moral (cadência das torres); praças geram ouro diário.
- **Ciclo dia/noite** com **lua cheia a cada 4 dias** (ondas bem mais violentas).
- **Economia dupla**: 🪙 ouro (kills + renda diária) para construções/Tech/Moral, e 💎 **Corações de Argamato** (drop chance por kill, maior em blindados) para encantamentos na aba Mágia (flechas flamejantes, névoa gélida).
- Tutorial inicial, game over com reinício, reparo parcial da muralha entre turnos.

## Próximos passos sugeridos
- Trincheiras (3 slots especiais à direita do mockup) e o slot BLOCK.
- Novas raças de mortos-vivos com efeitos únicos.
- Aba Ajudas (favores do conselho / vantagens por anúncio).
- Persistência do progresso (localStorage) e balanceamento das curvas de custo.
