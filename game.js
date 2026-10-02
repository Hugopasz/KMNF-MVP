// ===== Karzstak Must Not Fall · MVP =====
"use strict";

const LANES = 5;

// ---------- Estado ----------
const S = {
  day: 1,
  isNight: false,
  hits: 5,
  gold: 90,
  hearts: 0,
  won: false,             // sobreviveu à lua vermelha do dia 30, modo infinito
  kills: 0,               // inimigos abatidos (pontuação)
  goldEarned: 0,          // ouro TOTAL ganho na partida (não desconta gastos) — resumo final
  redMoons: 0,            // luas vermelhas sobrevividas (pontuação)
  blackSuns: 0,           // sóis negros sobrevividos (pontuação)
  morale: 0,              // Esperança(+) × Medo(-), -150..+150
  moraleLocked: 0,        // faixa da moral travada no amanhecer (snapshot)
  dayMods: {},            // modificadores temporários do dia (eventos)
  lastEvent: null,        // id do último evento (não repetir 2x seguidas)
  eventLog: [],           // histórico de eventos do dia (Seu Distrito)
  fav: { rel: { rei: 50, rainha: 50, conde: 50, povo: 50 }, used: false, last: {} }, // Os Favores (relação reseta por run)
  sector: "",             // nome cosmético do setor desta run
  sectorId: 0,            // número do setor (aleatório por run, 7.000–15.000)
  factions: [],           // 2 facções escolhidas nesta run
  purpleThisRun: false,   // pacto sombrio selado nesta run
  darkChain: 0,           // progresso da cadeia de eventos secreta (0..3)
  autoTurn: false,        // 🔒 turnos continuam automaticamente
  waveActive: false,
  paused: false,          // overlay de Configurações/Saída aberto: congela o update
  enemies: [],
  projectiles: [],
  eshots: [],           // projéteis dos inimigos à distância
  warnings: [],
  effects: [],
  floats: [],
  nextWave: [],
  powerLines: [],         // linhas de poder desenhadas pelo jogador
  groundFires: [],        // poças de fogo/vapor no campo
  turnHitsLost: 0,
  seals: [1, 1, 1, 1, 1], // selos de proteção por lane (limpam a lane 1 vez e somem)
  sweeps: [],             // varreduras de selo em andamento (visual)
  allies: [],             // tropas invocadas pelo Portão (persistem entre dias)
  gateAuto: false,        // preenchimento automático do Portão
  gateMode: "protect",    // comportamento das tropas: "protect" (segura a muralha) | "attack" (avança)
  gatePref: "campones",   // última unidade invocada
  gateFac: "red",         // ideologia jurada pela próxima tropa
  towers: [null, null, null, null, null],
  city: [],
  feud: [],               // O Feudo: 2º grid (retaguarda de extração)
  field: "city",          // view ativa do grid de baixo: "city" | "feud"
  res: { minerio: 0, combustivel: 0, bens: 0, comida: 0 }, // recursos do Feudo (só acumulam por ora)
  feudOut: {},            // gid -> quanto o extrator já arrancou NESTE turno (teto: maintCap)
  weather: "normal",      // clima do turno: só camadas de desenho, zero efeito de jogo
  maos: 10,               // ✋ Mãos: moeda de trabalho (como 🪙/💎); custo p/ erguer fábricas
  nextGid: 1,
  placing: null,
  laws: [],
  debug: { god: false, speed: 1 },
};

// ---------- Moral: Esperança × Medo ----------
// S.morale: -100 (Medo total) .. +100 (Esperança total). Efeitos travam no amanhecer (snapshot).
// Barra ampliada para ±150: os ganhos por evento continuam pequenos, então chegar aos
// extremos (Heroísmo/Pânico) exige acúmulo ao longo de vários turnos — mais cadenciado.
function clampMorale() { S.morale = Math.max(-150, Math.min(150, S.morale)); }
function moraleTier(v) { return v >= 120 ? 2 : v >= 60 ? 1 : v <= -120 ? -2 : v <= -60 ? -1 : 0; }
function moraleName(tier) {
  return tier === 2 ? "Heroísmo" : tier === 1 ? "Inspirados" : tier === -1 ? "Medo" : tier === -2 ? "Pânico" : "Firmes";
}
// Eficiência (Esperança em cima, Medo embaixo) — aplicado a produção, torres e renda.
// Agora o Medo PENALIZA a economia (antes só buffava os inimigos): a cidade acuada rende menos.
function moraleEffMult() {
  const t = S.moraleLocked || 0;
  return t === 2 ? 1.25 : t === 1 ? 1.12 : t === -1 ? 0.85 : t === -2 ? 0.65 : 1;
}
// Buffs dos inimigos (Medo) — mais pesados: o Pânico vira uma espiral perigosa.
function moraleEnemyHpMult()  { const t = S.moraleLocked || 0; return t === -2 ? 1.5 : t === -1 ? 1.15 : 1; }
function moraleEnemySpdMult() { const t = S.moraleLocked || 0; return t === -2 ? 1.35 : t === -1 ? 1.2 : 1; }
function moraleEnemyDmgMult() { const t = S.moraleLocked || 0; return t === -2 ? 1.5 : t === -1 ? 1.2 : 1; }
// Modificadores temporários do dia (definidos por eventos)
function dm(key, def) { return (S.dayMods && S.dayMods[key] != null) ? S.dayMods[key] : (def == null ? 1 : def); }

// ---------- Eventos Diários (rogue-like) ----------
// e: efeitos { gold, hearts, hits, morale, mods:{...} }. mods viram S.dayMods do dia.
// w: peso no sorteio (1 = normal, omitido = 1).
// Devolver 🧱 é a recompensa mais forte do jogo: hit perdido não volta de nenhuma outra
// forma que o jogador controle, então cair um desses no sorteio apaga uma noite ruim
// inteira. Por isso os eventos que curam a muralha saem com peso baixo, e o que cura 2
// sai com peso menor ainda. É o único lugar onde mexer no peso muda a dificuldade.
const EV_W_HEAL = 0.2, EV_W_HEAL_BIG = 0.12;
const EVENTS = [
  // ===== POSITIVOS (20) =====
  { id: "p1",  ic: "🌾", ty: "pos", t: "Colheita Abençoada", s: "Os campos internos renderam além do esperado, e os celeiros receberam o excedente antes do anoitecer. Os cofres da guarda agradecem; o tesoureiro, pela primeira vez no mês, sorriu.", e: { gold: 35, morale: 8 } },
  { id: "p2",  ic: "🔨", ty: "pos", t: "Mutirão das Muralhas", s: "Pedreiros voluntários trabalharam a noite toda tapando as brechas com o que acharam: pedra, viga, portão arrancado. Ninguém mandou, ninguém pagou, e ao amanhecer as muralhas estavam de pé.", e: { hits: 2, morale: 6 }, w: EV_W_HEAL_BIG },
  { id: "p3",  ic: "💎", ty: "pos", t: "Veio de Argamato", s: "Mineiros encontraram um bolsão de cristais intactos sob o distrito, protegido por uma camada de rocha que a peste nunca atravessou. Vieram carregando o que couberam nos braços.", e: { hearts: 6, morale: 6 } },
  { id: "p4",  ic: "🎺", ty: "pos", t: "Notícia da Frente Norte", s: "Um setor vizinho resistiu a uma noite inteira de assalto e mandou um corredor contar. O moral dispara em todas as muralhas: se eles aguentaram, nós também aguentamos.", e: { morale: 18 } },
  { id: "p5",  ic: "🏹", ty: "pos", t: "Carregamento de Virotes", s: "Uma carroça de munição chegou dos arsenais reais, escoltada por três guardas que não dormiram no caminho. As fábricas vão poder trabalhar com folga hoje.", e: { gold: 20, mods: { prod: 1.25 } } },
  { id: "p6",  ic: "⚙️", ty: "pos", t: "Engrenagens Novas", s: "Um engenheiro passou a madrugada ajustando as correias e trocando os dentes gastos das fábricas. Hoje elas cantam em vez de gemer.", e: { mods: { prod: 1.35 }, morale: 5 } },
  { id: "p7",  ic: "🔥", ty: "pos", t: "Fervor no Muro", s: "Os soldados amanheceram inspirados, ninguém sabe bem por quê. Afiaram as próprias armas antes de o sino bater, e a mira está diferente.", e: { mods: { towerDmg: 1.3 }, morale: 5 } },
  { id: "p8",  ic: "🪙", ty: "pos", t: "Mercadores Gratos", s: "Comerciantes salvos por suas muralhas voltaram com ouro e sem conversa. Deixaram as bolsas no posto da guarda e foram embora antes de alguém agradecer.", e: { gold: 45 } },
  { id: "p9",  ic: "🕊️", ty: "pos", t: "Manhã Silenciosa", s: "Por algum motivo, os mortos hesitam no horizonte. O vigia enxerga mais longe do que em qualquer manhã deste ano, e isso assusta mais do que acalma.", e: { mods: { warn: 2 }, morale: 6 } },
  { id: "p10", ic: "🍞", ty: "pos", t: "Rações Extras", s: "O conselho liberou os estoques sem explicar o motivo. Pão fresco, carne salgada e uma dose para cada posto: ninguém luta de barriga vazia.", e: { gold: 15, morale: 10 } },
  { id: "p11", ic: "🛡️", ty: "pos", t: "Reforços do Interior", s: "Um pelotão da guarda real reforça a linha por hoje, com armadura de verdade e ordens claras. Amanhã seguem para outro setor, mas hoje são seus.", e: { mods: { enemyDmg: 0.8 }, morale: 6 } },
  { id: "p12", ic: "💰", ty: "pos", t: "Dízimo de Guerra", s: "As paróquias arrecadaram para a defesa do setor e mandaram o cofre fechado. Vieram cristais no meio das moedas, o que ninguém pediu e todo mundo aceitou.", e: { gold: 30, hearts: 2 } },
  { id: "p13", ic: "🌟", ty: "pos", t: "Bênção do Cristal", s: "O Turbilhão Narxis pulsa forte hoje, e a cidade inteira sente no peito. Até as pedras das muralhas parecem assentar melhor.", e: { morale: 14, hits: 1 }, w: EV_W_HEAL },
  { id: "p14", ic: "🧰", ty: "pos", t: "Peças Sobressalentes", s: "Recuperaram material de um posto abandonado três lanes ao norte. Chegou tudo enferrujado e tudo aproveitável.", e: { gold: 25, mods: { prod: 1.2 } } },
  { id: "p15", ic: "🎯", ty: "pos", t: "Treino da Aurora", s: "Os artilheiros treinaram antes do sol nascer, no frio, com os alvos de palha que sobraram. A mira está afiada e o humor, péssimo.", e: { mods: { towerDmg: 1.2 }, morale: 4 } },
  { id: "p16", ic: "🐴", ty: "pos", t: "Cavalaria de Passagem", s: "Cavaleiros a caminho de outro setor pararam para beber água e deixaram suprimentos sem cobrar. Não disseram para onde iam.", e: { gold: 22, hearts: 3 } },
  { id: "p17", ic: "🌙", ty: "pos", t: "Presságio Favorável", s: "Os astros sorriem, segundo quem entende dessas coisas. Dizem que hoje a sorte está do seu lado, e a tropa decidiu acreditar.", e: { morale: 12 } },
  { id: "p18", ic: "🔮", ty: "pos", t: "Visão do Vidente", s: "Um oráculo do distrito acordou gritando as direções dos ataques e voltou a dormir. O vigia anotou tudo e ganhou tempo precioso.", e: { mods: { warn: 3 } } },
  { id: "p19", ic: "🏰", ty: "pos", t: "Ordem do Rei", s: "O soberano citou seu setor como exemplo numa carta lida em voz alta na praça. A tropa se enche de orgulho e finge que não ligou.", e: { morale: 16, gold: 10 } },
  { id: "p20", ic: "❤️", ty: "pos", t: "Filhos das Muralhas", s: "As crianças do distrito subiram até as ameias trazendo água e canções inventadas na hora. Os soldados fingiram que não choraram.", e: { morale: 11, hits: 1 }, w: EV_W_HEAL },
  // ===== NEGATIVOS (10) =====
  { id: "n1",  ic: "🩸", ty: "neg", t: "Baixas na Noite", s: "Alguns guardas não voltaram da última investida, e os nomes foram lidos no pátio ao amanhecer. O luto pesa mais que a armadura.", e: { morale: -12 } },
  { id: "n2",  ic: "🕳️", ty: "neg", t: "Brecha no Alicerce", s: "Uma fenda se abriu na base das muralhas durante a madrugada, larga o bastante para passar um braço. Taparam com entulho, que é o que havia.", e: { hits: -1, morale: -6 } },
  { id: "n3",  ic: "💸", ty: "neg", t: "Cofre Saqueado", s: "Desertores levaram parte do ouro do setor ao fugir pela calada. Deixaram a porta do cofre aberta, como quem quer que você veja.", e: { gold: -30, morale: -6 } },
  { id: "n4",  ic: "🌧️", ty: "neg", t: "Tempestade de Cinzas", s: "A poeira dos mortos entope as engrenagens e cobre tudo de cinza. As fábricas engasgam e os operários tossem sangue no fim do turno.", e: { mods: { prod: 0.7 } } },
  { id: "n5",  ic: "😨", ty: "neg", t: "Boatos de Queda", s: "Espalharam que as muralhas vizinhas caíram e que ninguém sobrou para contar. Ninguém sabe quem começou, e o medo se alastra mais rápido que a verdade.", e: { morale: -16 } },
  { id: "n6",  ic: "🦠", ty: "neg", t: "Febre no Distrito", s: "Uma doença varre os alojamentos e derruba quem já estava exausto. Menos mãos para trabalhar e mais bocas na enfermaria.", e: { mods: { prod: 0.8 }, morale: -6 } },
  { id: "n7",  ic: "🌫️", ty: "neg", t: "Neblina Cega", s: "Uma névoa densa encobre o horizonte desde antes do amanhecer. O vigia mal enxerga a própria mão esticada, e a horda vem de dentro dela.", e: { mods: { warn: -1.5 } } },
  { id: "n8",  ic: "⚰️", ty: "neg", t: "Deserção", s: "Parte da guarnição fugiu na calada, levando armas e as melhores botas. A linha está mais fraca hoje e todo mundo sabe exatamente quem faltou.", e: { mods: { enemyDmg: 1.2 }, morale: -8 } },
  { id: "n9",  ic: "🥀", ty: "neg", t: "Racionamento", s: "Os estoques minguam e o conselho corta as verbas do setor com uma frase só, por escrito. Metade da ração, o dobro do turno.", e: { gold: -20, morale: -8 } },
  { id: "n10", ic: "🌑", ty: "neg", t: "Presságio Sombrio", s: "Corvos rodeiam as muralhas desde a véspera e não pousam. Ninguém dorme direito, e os que dormem acordam falando.", e: { morale: -14 } },
  // ===== CAÓTICOS (5) =====
  { id: "c1",  ic: "⚔️", ty: "cha", t: "Fúria dos Mortos", s: "Algo os enlouquece hoje: a horda avança mais rápido do que qualquer registro da guarda. Você jurou vingança em voz alta, e a tropa jurou com você.", e: { mods: { enemySpd: 1.3 }, morale: 12 } },
  { id: "c2",  ic: "🛢️", ty: "cha", t: "Munição Instável", s: "Um lote defeituoso chegou dos arsenais, mais pólvora que projétil. As torres batem MUITO mais forte e gastam o dobro para isso.", e: { mods: { towerDmg: 1.6, ammoCost: 2 } } },
  { id: "c3",  ic: "🐗", ty: "cha", t: "Marcha Blindada", s: "Só os mais couraçados vieram hoje, como se alguém os tivesse escolhido. Todos os mortos chegam com armadura, e o saque compensa o trabalho.", e: { mods: { allArmored: true }, gold: 20 } },
  { id: "c4",  ic: "🎲", ty: "cha", t: "Feira do Conde", s: "O Conde dos Ratos abre seu mercado no subsolo e chama os operários pelo nome. Ouro farto hoje, e as fábricas vazias de quem foi gastar.", e: { gold: 60, mods: { prod: 0.6 } } },
  { id: "c5",  ic: "💥", ty: "cha", t: "Sobrecarga do Nexus", s: "O cristal transborda e a energia corre pelos trilhos como água em cheia. A produção turbina, e as muralhas racham no mesmo instante.", e: { mods: { prod: 1.8 }, hits: -1 } },
];
// Evento FIXO ao amanhecer do dia 11: chegam os mortos antigos, o saque despenca.
// Evento OBRIGATÓRIO do dia 1: começa a run com um empurrão nas torres.
const DAY1_EVENT = { id: "cafecomleite", ic: "☕", ty: "pos", t: "Café com Leite",
  s: "A primeira manhã nas muralhas começa com café quente e leite fresco das últimas cabras do reino. Os artilheiros acordam animados e a mira nunca esteve tão firme.",
  e: { mods: { towerDmg: 1.5 } } };
const ELDERS_EVENT = { id: "elders", ic: "🦴", ty: "neg", t: "Os Mortos Antigos",
  s: "Os recém-tombados, ainda cheios de bolsas e relíquias, já foram todos derrubados. Agora sobem das criptas os mortos ANTIGOS: ossos secos, sem nada de valor. O saque por criatura despenca daqui em diante.",
  e: { eldersLoot: true } };
function effectText(ev) {
  const e = ev.e, out = [];
  if (e.eldersLoot) out.push(`saque por morto −${Math.round((1 - ELDERS_LOOT_MULT) * 100)}% de agora em diante`);
  if (e.gold) out.push(`${e.gold > 0 ? "+" : ""}${e.gold} 🪙`);
  if (e.hearts) out.push(`${e.hearts > 0 ? "+" : ""}${e.hearts} 💎`);
  if (e.hits) out.push(`${e.hits > 0 ? "+" : ""}${e.hits} 🧱`);
  if (e.morale) out.push(`${e.morale > 0 ? "+" : ""}${e.morale} moral`);
  const m = e.mods || {};
  if (m.prod) out.push(`produção ×${m.prod}`);
  if (m.towerDmg) out.push(`dano das torres ×${m.towerDmg}`);
  if (m.income) out.push(`renda ×${m.income}`);
  if (m.ammoCost) out.push(`munição ×${m.ammoCost}`);
  if (m.enemySpd) out.push(`velocidade inimiga ×${m.enemySpd}`);
  if (m.enemyDmg) out.push(`ataque inimigo ×${m.enemyDmg}`);
  if (m.warn) out.push(`${m.warn > 0 ? "+" : ""}${m.warn}s de aviso`);
  if (m.allArmored) out.push("todos blindados");
  return out.length ? "Efeito: " + out.join(" · ") : "Sem efeito imediato.";
}
// Mesma leitura do effectText, mas em FICHAS com sinal e cor, para o resumo do dia.
// Um multiplicador é bom ou ruim conforme o que ele multiplica: produção ×0.7 é perda,
// mas ataque inimigo ×0.8 é ganho. Por isso cada linha diz explicitamente o seu sinal
// em vez de deduzir pelo ">1".
function effectChips(ev) {
  const e = ev.e, m = e.mods || {}, out = [];
  const chip = (txt, bom) => out.push(`<span class="ev-chip ${bom ? "up" : "down"}">${txt}</span>`);
  if (e.gold) chip(`${e.gold > 0 ? "+" : ""}${e.gold} 🪙`, e.gold > 0);
  if (e.hearts) chip(`${e.hearts > 0 ? "+" : ""}${e.hearts} 💎`, e.hearts > 0);
  if (e.hits) chip(`${e.hits > 0 ? "+" : ""}${e.hits} 🧱 muralhas`, e.hits > 0);
  if (e.morale) chip(`${e.morale > 0 ? "+" : ""}${e.morale} moral`, e.morale > 0);
  if (m.prod) chip(`produção ×${m.prod}`, m.prod > 1);
  if (m.towerDmg) chip(`dano das torres ×${m.towerDmg}`, m.towerDmg > 1);
  if (m.income) chip(`renda ×${m.income}`, m.income > 1);
  if (m.ammoCost) chip(`munição gasta ×${m.ammoCost}`, m.ammoCost < 1);
  if (m.enemySpd) chip(`horda ×${m.enemySpd} de velocidade`, m.enemySpd < 1);
  if (m.enemyDmg) chip(`ataque inimigo ×${m.enemyDmg}`, m.enemyDmg < 1);
  if (m.warn) chip(`${m.warn > 0 ? "+" : ""}${m.warn}s de aviso`, m.warn > 0);
  if (m.allArmored) chip("todos os mortos blindados", false);
  if (e.eldersLoot) chip(`saque por morto −${Math.round((1 - ELDERS_LOOT_MULT) * 100)}%`, false);
  return out.length ? out.join("") : `<span class="ev-chip">Sem efeito imediato</span>`;
}
function pickDailyEvent() {
  const pool = EVENTS.filter(e => e.id !== S.lastEvent);
  const total = pool.reduce((s, e) => s + (e.w ?? 1), 0);
  let r = Math.random() * total;
  for (const e of pool) { r -= (e.w ?? 1); if (r <= 0) return e; }
  return pool[pool.length - 1];
}
function applyDailyEvent(ev) {
  let e = ev.e;
  // Voz do Povo (L5): eventos negativos têm o efeito numérico reduzido pela metade
  if (ev.ty === "neg" && law("L5")) {
    e = { ...e };
    for (const k of ["gold", "hearts", "hits", "morale"]) if (typeof e[k] === "number") e[k] = Math.round(e[k] / 2);
  }
  // Sem trava em zero: um evento de -30 🪙 com 10 no cofre cobra os 30 e deixa -20.
  // Truncar a cobrança era um perdão invisível, e quem soubesse disso gastava tudo
  // antes do amanhecer para receber o prejuízo de graça.
  if (e.gold) S.gold += e.gold;
  if (e.hearts) S.hearts += e.hearts;
  if (e.hits) S.hits = Math.max(1, Math.min(maxHits(), S.hits + e.hits));
  if (e.morale) gainMorale(e.morale);
  if (e.mods) Object.assign(S.dayMods, e.mods);
  S.lastEvent = ev.id;
  S.eventLog.push({ day: S.day, ic: ev.ic, t: ev.t, ty: ev.ty, fx: effectText(ev).replace(/^Efeito: /, "") });
  if (S.eventLog.length > 40) S.eventLog.shift();
}

// ---------- Facções ----------
const FACTIONS = {
  red:    { ic: "🔴", name: "Os Vermelhos", tag: "Sacrifício pelo Reino",  flavor: "Guiados pelo Rei.",              color: "#c0392b", desc: "+12% de dano das torres." },
  blue:   { ic: "🔵", name: "Os Azuis",     tag: "Esforço de Guerra",      flavor: "Ciência é Progresso.",          color: "#2f6fd6", desc: "+15% de produção fabril." },
  yellow: { ic: "🟡", name: "Os Amarelos",  tag: "A Igreja do Amanhecer",  flavor: "Culto ao Deus do Sol.",         color: "#e8b93a", desc: "+30% de ganho de moral." },
  pink:   { ic: "🌸", name: "As Rosas",      tag: "Lealdade pela Rainha",   flavor: "Admiradores da Matrona.",       color: "#d6608f", desc: "+2 de vida base das muralhas." },
  purple: { ic: "🟣", name: "Os Roxos",      tag: "Culto da Lua",           flavor: "Filhos da Magia Negra.",        color: "#a86ae0", desc: "Mortos viram Sombras (10%).", secret: true },
  green:  { ic: "🟢", name: "Os Verdes",      tag: "Povos Mágicos",          flavor: "Refugiados das florestas antigas.", color: "#4cae6a", desc: "Tropas curam por turno.", secret: true, dlc: true },
};
// Ideologias párias: odiadas por todos, sofrem TODAS as penalidades — e, por não
// terem rival, não impõem penalidade a ninguém.
// Ícone da ideologia em HTML. Não existe emoji de círculo rosa: as Rosas usam um
// disco desenhado em CSS, para ficarem iguais aos círculos coloridos das outras.
function facIc(k) { return k === "pink" ? `<span class="fac-disc" style="--d:${FACTIONS.pink.color}"></span>` : FACTIONS[k].ic; }
const OUTCAST = ["purple", "green"];
function isOutcast(f) { return OUTCAST.includes(f); }
// Meta persistente: combos, roxo, Medalhas de Comando, desbloqueios, loadout e ranking
const META_KEY = "mknf-meta";
const META_DEFAULTS = { purple: false, green: false, medals: 0, unlocked: [], loadout: null, ranking: [], miolo: {}, counselor: null, council: null, councilLv: {}, brasao: 0, fieldVar: 0 };
function loadMeta() {
  let m; try { m = JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { m = {}; }
  return Object.assign({}, META_DEFAULTS, m);
}
function saveMeta(m) { localStorage.setItem(META_KEY, JSON.stringify(m)); }
let META = loadMeta();

// ---------- Configurações do jogador (persistentes) ----------
const SETTINGS_KEY = "mknf-settings";
const SETTINGS_DEFAULTS = {
  hpBars: true,      // barras de vida sobre inimigos/tropas (funcional)
  dmgNumbers: true,  // números de dano flutuantes (funcional)
  music: false,      // (em desenvolvimento) — placeholder
  fullscreen: false, // (em desenvolvimento) — placeholder
  animations: true,  // (em desenvolvimento) — placeholder
  vfx: true,         // (em desenvolvimento) — placeholder
};
function loadSettings() {
  let s; try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { s = {}; }
  return Object.assign({}, SETTINGS_DEFAULTS, s);
}
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); }
let SETTINGS = loadSettings();
function addMedals(n) { META.medals += n; saveMeta(META); }

// ---------- O Miolo: tech tree persistente da economia (Fase 15) ----------
// Níveis salvos em META.miolo; custo do próximo nível = base × (nível+1). Permanente.
const MIOLO = {
  veios:      { name: "Veios Profundos",         icon: "⛏️", color: "#3fc4e0", max: 5, cost: 3, per: 0.10, desc: "+10% de rendimento dos extratores por nível",
    flavor: "A guilda dos mineradores tem ideias como otimizar a produção." },
  guilda:     { name: "Guilda dos Trabalhadores", icon: "✋", color: "#e8e8e8", max: 5, cost: 2, per: 4,   desc: "+4 Mãos no início da run por nível",
    flavor: "A guilda dos trabalhadores traz mais mãos para o distrito." },
  feitoria:   { name: "Feitoria Eficiente",      icon: "👷", color: "#e07b2f", max: 5, cost: 5, per: 0.08, desc: "-8% no custo de construir/reconstruir no Feudo por nível",
    flavor: "Engenheiros baratearam as obras da retaguarda." },
  manufatura: { name: "Manufatura Base",         icon: "🏭", color: "#e8c020", max: 5, cost: 4, per: 0.08, desc: "+8% de produção base das fábricas por nível",
    flavor: "Mestres artesãos elevam o rendimento base de toda fábrica." },
  duraveis:   { name: "Ferramentas Duráveis",    icon: "🧰", color: "#4caf50", max: 5, cost: 3, per: 1,    desc: "+1 turno de vida base dos extratores por nível",
    flavor: "Ferreiros forjam ferramentas que duram muito mais nas minas." },
  logistica:  { name: "Logística Enxuta",        icon: "🚚", color: "#4a90e0", max: 5, cost: 4, per: 0.06, desc: "fábricas consomem -6% de recurso por nível",
    flavor: "Rotas enxutas fazem cada recurso render mais na linha." },
  celeiros:   { name: "Celeiros Reais",          icon: "🌾", color: "#e8708f", max: 5, cost: 2, per: 5,    desc: "+5 de cada recurso no início da run por nível",
    flavor: "Os celeiros reais guardam reservas para o começo de cada guerra." },
  cofres:     { name: "Cofres Reais",            icon: "💰", color: "#e0a92f", max: 5, cost: 4, per: 0.05, desc: "+5% de renda de ouro por turno por nível",
    flavor: "Os cofres reais rendem juros a cada turno sobrevivido." },
  relicario:  { name: "Relicário",               icon: "💎", color: "#a86ae0", max: 5, cost: 4, per: 0.03, desc: "+3% de chance de 💎 por abate por nível",
    flavor: "O relicário atrai mais Corações de Argamato dos mortos." },
};
function mioloLvl(id) { return (META.miolo && META.miolo[id]) || 0; }
function mioloCost(id) { return MIOLO[id].cost * (mioloLvl(id) + 1); }
function mioloBuy(id) {
  const n = MIOLO[id]; if (!n) return false;
  const lvl = mioloLvl(id); if (lvl >= n.max) return false;
  const cost = mioloCost(id); if (META.medals < cost) return false;
  META.medals -= cost;
  (META.miolo ||= {})[id] = lvl + 1;
  saveMeta(META); return true;
}
// multiplicadores derivados (valem em toda run)
function mioloYieldMult()   { return 1 + MIOLO.veios.per * mioloLvl("veios"); }
function mioloProdMult()    { return 1 + MIOLO.manufatura.per * mioloLvl("manufatura"); }
function mioloFeudCostMult() { return Math.max(0.4, 1 - MIOLO.feitoria.per * mioloLvl("feitoria")); }
function feedPer() { return FEED_PER * Math.max(0.4, 1 - MIOLO.logistica.per * mioloLvl("logistica")); }
function mioloIncomeMult() { return 1 + MIOLO.cofres.per * mioloLvl("cofres"); }
function mioloHeartBonus() { return MIOLO.relicario.per * mioloLvl("relicario"); }

// ---------- O Conselho: habilidade ativa (Fase 16) ----------
// Vínculo persistente (META.counselor). Dispara segurando 2s no ponto (ou clique-direito no PC). Custa 💎.
// `run(t)` aplica o efeito e retorna false para ABORTAR sem custo (nada a fazer).
// A TÁVOLA: 8 Lordes. Vínculo persistente (META.counselor). Dispara segurando 2s no ponto (ou clique-direito no PC). Custa 💎.
const COUNCILORS = {
  arqueira:   { name: "Mestre Arqueira",     icon: "🏹", fac: "red",    cost: 3, target: "lane",   desc: "Rajada: 30 de dano a todos os inimigos da lane mirada.",
    flavor: "A guilda dos arqueiros mantém seu distrito seguro com uma chuva de flechas.",
    run: (t) => { const es = S.enemies.filter(e => e.lane === t.lane && e.hp > 0); if (!es.length) return false; for (const e of es) { e.hp -= 30; addFloat(e.lane, e.y - 0.04, "-30", "#eecd5c"); } S.effects.push({ x: t.lane, y: 0.5, life: 0.55, max: 0.55, type: "arrows" }); return true; } },
  pirotecnico:{ name: "Pirotécnico",         icon: "🔥", fac: "red",    cost: 3, target: "point",  desc: "Incendeia o ponto mirado: fogo no chão por 5s.",
    flavor: "Um alquimista incendiário que transforma o chão em brasas.",
    run: (t) => { S.groundFires.push({ lane: t.lane, y: t.y, dps: 9, t: 5, r: 0.12 }); addFloat(t.lane, t.y, "🔥", "#ff8a6a"); return true; } },
  glacial:    { name: "Feiticeira Glacial",  icon: "❄️", fac: "blue",   cost: 4, target: "lane",   desc: "Congela a lane: inimigos ficam lentos por 4s.",
    flavor: "Sua magia congela a lane inteira, travando a horda no lugar.",
    run: (t) => { const es = S.enemies.filter(e => e.lane === t.lane && e.hp > 0); if (!es.length) return false; for (const e of es) { e.chill = { t: 4, pct: 0.7 }; addFloat(e.lane, e.y - 0.04, "❄️", "#8ac6f0"); } S.effects.push({ x: t.lane, y: 0.5, life: 0.7, max: 0.7, type: "frost" }); return true; } },
  tesla:      { name: "Arconte Tesla",       icon: "⚡", fac: "blue",   cost: 4, target: "point",  desc: "Relâmpago: 50 de dano ao inimigo mais próximo do ponto.",
    flavor: "Canaliza o Nexus num relâmpago certeiro sobre o alvo.",
    run: (t) => { let best = null, bd = 9; for (const e of S.enemies) { if (e.hp <= 0) continue; const dx = (e.lane - t.lane), dy = (e.y - t.y) * 5, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = e; } } if (!best) return false; best.hp -= 50; addFloat(best.lane, best.y - 0.04, "-50 ⚡", "#8ae0ff"); S.effects.push({ x: best.lane, y: best.y, life: 0.32, max: 0.32, type: "lightning" }); return true; } },
  general:    { name: "General",             icon: "📣", fac: "yellow", cost: 3, target: "global", desc: "Brado de guerra: +20 de moral instantâneo.",
    flavor: "Seu brado reacende a coragem do distrito num instante.",
    run: () => { gainMorale(20); addFloat(2, 0.5, "📣 +20 moral", "#eecd5c"); return true; } },
  cleriga:    { name: "Clériga",             icon: "✨", fac: "pink",   cost: 3, target: "global", desc: "Bênção: cura totalmente as tropas aliadas.",
    flavor: "A bênção da Matrona restaura por completo as suas tropas.",
    run: () => { if (!S.allies.length) return false; for (const a of S.allies) { a.hp = a.maxHp; S.effects.push({ x: a.lane, y: a.y, life: 0.7, max: 0.7, type: "heal" }); } addFloat(2, 0.85, "✨ tropas curadas", "#8ac6f0"); return true; } },
  sombras:    { name: "Mestre das Sombras",  icon: "🌫️", fac: "purple", cost: 4, target: "global", desc: "Névoa: todos os inimigos ficam lentos por 4s.",
    flavor: "Invoca uma névoa que arrasta todos os mortos para um passo lento.",
    run: () => { const es = S.enemies.filter(e => e.hp > 0); if (!es.length) return false; for (const e of es) e.chill = { t: 4, pct: 0.5 }; S.effects.push({ x: 2, y: 0.5, life: 0.9, max: 0.9, type: "fog" }); addFloat(2, 0.4, "🌫️ névoa", "#c89aff"); return true; } },
  arconte:    { name: "Arconte do Fim",      icon: "☄️", fac: "purple", cost: 5, target: "point",  desc: "Meteoro: 60 de dano em área ao redor do ponto.",
    flavor: "Chama um meteoro do fim dos tempos sobre o ponto mirado.",
    run: (t) => { const es = S.enemies.filter(e => e.hp > 0 && Math.abs(e.lane - t.lane) <= 1 && Math.abs(e.y - t.y) < 0.15); if (!es.length) return false; for (const e of es) { e.hp -= 60; addFloat(e.lane, e.y - 0.04, "-60 ☄️", "#ff8a6a"); } S.effects.push({ x: t.lane, y: t.y, life: 0.6, max: 0.6, type: "meteor" }); return true; } },
};
const FAC_COLOR = { red: "#e0503f", blue: "#3fc4e0", yellow: "#e8b93a", pink: "#e85aa0", purple: "#a86ae0" };
// Cada Lorde tem sua COR ÚNICA (facções se repetem; cores não)
const LORD_COLOR = {
  arqueira: "#e0503f", pirotecnico: "#f0802f", glacial: "#3fc4e0", tesla: "#4a7dff",
  general: "#e8b93a", cleriga: "#e85aa0", sombras: "#c94ad0", arconte: "#7d5cf0",
};
const COUNCIL_LV_MAX = 10; // jogar com um Lorde até o nível 10 (10 usos) apresenta o próximo
function councilCost(id) {
  const c = COUNCILORS[id]; if (!c) return 0;
  const syn = c.fac && S.factions && S.factions.includes(c.fac) ? 1 : 0; // sinergia de facção: -1 💎
  return Math.max(1, c.cost - syn);
}
// ---------- Networking do Conselho ----------
// Começa com UM conselheiro. USAR a habilidade de um em campo "apresenta" (desbloqueia) o próximo da cadeia.
const COUNCIL_ORDER = Object.keys(COUNCILORS); // ordem do dict = cadeia da rede
// Ao abrir o jogo pela 1ª vez (nenhum Lorde jurado), equipa automaticamente o primeiro
// disponível — a Mestre Arqueira — para a Távola nunca começar vazia, mesmo sem abri-la.
if (!META.counselor || !COUNCILORS[META.counselor]) { META.counselor = COUNCIL_ORDER[0]; saveMeta(META); }
function councilUnlocked() {
  const base = (Array.isArray(META.council) && META.council.length) ? META.council.slice() : [COUNCIL_ORDER[0]];
  if (META.counselor && !base.includes(META.counselor)) base.push(META.counselor); // grandfather do jurado atual
  return base;
}
function isCouncilUnlocked(id) { return councilUnlocked().includes(id); }
function nextCouncil(id) { const i = COUNCIL_ORDER.indexOf(id); return i >= 0 && i + 1 < COUNCIL_ORDER.length ? COUNCIL_ORDER[i + 1] : null; }
function councilLv(id) { return (META.councilLv && META.councilLv[id]) || 0; }
function advanceCouncilNetwork(id) {
  const nxt = nextCouncil(id);
  if (nxt && !isCouncilUnlocked(nxt)) { META.council = [...councilUnlocked(), nxt]; saveMeta(META); return nxt; }
  return null;
}
function useCouncil(t) {
  const id = META.counselor;
  if (!id || !COUNCILORS[id]) { toast("Nenhum Lorde jurado. Abra A Távola no menu."); return false; }
  const c = COUNCILORS[id], cost = councilCost(id);
  if (S.hearts < cost) { toast(`Sem 💎 para ${c.name} (custa ${cost}).`); return false; }
  if (c.run(t) === false) { toast(`${c.icon} ${c.name}: nada a mirar agora.`); return false; }
  S.hearts -= cost;
  renderHUD();
  // Rede: cada uso sobe 1 nível o Lorde ativo; ao chegar ao nível 10 apresenta o próximo.
  (META.councilLv ||= {});
  const lv = Math.min(COUNCIL_LV_MAX, councilLv(id) + 1);
  META.councilLv[id] = lv;
  const nxt = lv >= COUNCIL_LV_MAX ? advanceCouncilNetwork(id) : null;
  saveMeta(META);
  if (nxt) toast(`🤝 ${c.name} (nível ${COUNCIL_LV_MAX}) te apresentou a ${COUNCILORS[nxt].icon} ${COUNCILORS[nxt].name}!`);
  return true;
}
// Desbloqueio / loadout (Arsenal). Itens novos têm `locked:true` + `medalCost`.
function itemDef(k) { return TOWER_TYPES[k] || BUILDINGS[k]; }
function isUnlocked(k) { const d = itemDef(k); return !!d && (!d.locked || META.unlocked.includes(k)); }
function unlockItem(k) {
  const d = itemDef(k);
  if (!d || !d.locked || META.unlocked.includes(k) || META.medals < (d.medalCost || 0)) return false;
  META.medals -= (d.medalCost || 0); META.unlocked.push(k); saveMeta(META); return true;
}
function isPraca(key)   { return key.startsWith("praca"); }
function isFactoryKey(key) { return !!(BUILDINGS[key] && BUILDINGS[key].prod); }
function baseTowerKeys()    { return Object.keys(TOWER_TYPES).filter(k => !TOWER_TYPES[k].locked); }
function basePracaKeys()    { return Object.keys(BUILDINGS).filter(k => isPraca(k) && !BUILDINGS[k].locked); }
function baseBuildingKeys() { return Object.keys(BUILDINGS).filter(k => !BUILDINGS[k].locked && !isPraca(k) && !isFactoryKey(k)); }
function getLoadout() {
  if (!META.loadout) {
    META.loadout = { towers: baseTowerKeys().slice(0, 5), buildings: baseBuildingKeys().slice(0, 5), pracas: basePracaKeys().slice(0, 5) };
    saveMeta(META);
  }
  const lo = META.loadout;
  // migração: praças/fábricas saem dos edifícios (fábricas agora acompanham as torres);
  // torres removidas do jogo (ex.: Cortador Aquático) saem do loadout e dos desbloqueios
  let dirty = false;
  if (!lo.pracas) { lo.pracas = basePracaKeys().slice(0, 5); dirty = true; }
  const cleanB = lo.buildings.filter(k => BUILDINGS[k] && !isPraca(k) && !isFactoryKey(k));
  if (cleanB.length !== lo.buildings.length) { lo.buildings = cleanB; dirty = true; }
  const cleanT = lo.towers.filter(k => TOWER_TYPES[k]);
  if (cleanT.length !== lo.towers.length) { lo.towers = cleanT; dirty = true; }
  const cleanU = META.unlocked.filter(k => itemDef(k));
  if (cleanU.length !== META.unlocked.length) { META.unlocked = cleanU; dirty = true; }
  if (dirty) saveMeta(META);
  return lo;
}
// TODAS as fábricas ficam liberadas: amarrá-las às torres do loadout travava
// demais o planejamento (trocar de torre no meio da run deixava a munição órfã).
function autoFactoryKeys() {
  return Object.keys(BUILDINGS).filter(k => isFactoryKey(k) && isUnlocked(k));
}
function inLoadout(kind, key) {
  if (kind === "buildings") {
    if (isFactoryKey(key)) return autoFactoryKeys().includes(key);
    if (isPraca(key)) return getLoadout().pracas.includes(key);
  }
  return (getLoadout()[kind] || []).includes(key);
}
function unlockPurple() { if (!META.purple) { META.purple = true; saveMeta(META); } }
function unlockGreen() { if (!META.green) { META.green = true; saveMeta(META); } }
// desbloqueio de cada ideologia secreta
function facUnlocked(k) { return k === "purple" ? !!META.purple : k === "green" ? !!META.green : true; }

// Ideologia única da run. Escolher uma impõe a versão NEGATIVA do efeito da rival.
// Os párias (Roxos e Verdes) são odiados por todos: sofrem TODAS as penalidades —
// e, como ninguém os tem por rival, não impõem penalidade a ideologia nenhuma.
function curFaction() { return S.factions[0] || null; }
const RIVAL = { red: "yellow", yellow: "blue", blue: "pink", pink: "red" };
const DEBUFF_BY_CHOICE = { red: "ganho de moral -30%", yellow: "produção -15%", blue: "-1 hit máximo das muralhas", pink: "dano das torres -12%" };
function facTowerMult() {
  const f = curFaction(); let m = 1;
  if (f === "red") m += 0.12;
  if (f === "pink" || isOutcast(f)) m -= 0.12; // penalidade (Rosas rival dos Vermelhos; párias tudo)
  return m;
}
// Bastião de Guerra: +6% de dano em TODAS as torres por nível somado.
function buildingTowerMult() { return 1 + 0.06 * groupLvlSum("bastiao"); }
function facProdMult() {
  const f = curFaction(); let m = 1;
  if (f === "blue") m += 0.15;
  if (f === "yellow" || isOutcast(f)) m -= 0.15;
  return m;
}
function facMoraleGainMult() {
  const f = curFaction(); let m = 1;
  if (f === "yellow") m += 0.30;
  if (f === "red" || isOutcast(f)) m -= 0.30;
  return Math.max(0.1, m);
}
function facMaxHitsBonus() {
  const f = curFaction(); let b = 0;
  if (f === "pink") b += 2;
  if (f === "blue" || isOutcast(f)) b -= 1;
  return b;
}
function facIncomeMult() { return 1; }
function facSpectralChance() { return curFaction() === "purple" ? 0.20 : 0; }
// Verdes: as tropas se regeneram a cada turno (% do HP máximo)
const GREEN_REGEN = 0.25;
function facAllyRegen() { return curFaction() === "green" ? GREEN_REGEN : 0; }
function facSpectralTtl() { return 12; }
// Tintura dos edifícios conforme as facções escolhidas (classes no body)
function applyFactionTint() {
  const b = document.body;
  b.classList.remove("fac-red", "fac-blue", "fac-yellow", "fac-pink", "fac-purple", "fac-green");
  for (const k of S.factions) b.classList.add("fac-" + k);
  // --fac: cor da ideologia jurada, usada pela linha da muralha. Sai da tabela FACTIONS
  // de propósito — uma segunda lista de cores no CSS sairia de sincronia na primeira
  // vez que alguém mexesse numa delas. Sem ideologia, a variável some e a linha volta
  // ao marrom padrão (--wall).
  const f = curFaction();
  if (f) b.style.setProperty("--fac", FACTIONS[f].color);
  else b.style.removeProperty("--fac");
  refreshArcane();
}

// ---------- Paleta arcana: cajado + selos de proteção ----------
// A magia do Cetro (linhas de poder, selos desenhados) e os selos de proteção assumem a
// cor da ideologia jurada. Sem ideologia, fica o roxo arcano de sempre.
// Recalculada só na troca de facção: o draw() lê isto a cada frame, dentro de laços.
const ARCANE_FALLBACK = "#a86ae0";
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(c) { return "#" + c.map(v => v.toString(16).padStart(2, "0")).join(""); }
function towardWhite(c, t) { return c.map(v => Math.round(v + (255 - v) * t)); }
let ARCANE;
function refreshArcane() {
  const f = curFaction();
  const base = hexToRgb(f ? FACTIONS[f].color : ARCANE_FALLBACK);
  const light = towardWhite(base, 0.38); // realce, como o #c89aff era para o roxo
  ARCANE = { base: base.join(","), light: light.join(","), hex: rgbToHex(base), lightHex: rgbToHex(light) };
}
refreshArcane();
// aplica um ganho de moral já com o bônus dos Amarelos (só para deltas positivos)
// A Esperança era barata demais: bastavam alguns turnos limpos para travar a moral no
// topo e lá ficar. Agora todo GANHO passa por um redutor global e toda PERDA por um
// agravante, então manter o povo firme vira trabalho contínuo, não um estado alcançado.
// Tudo que mexe na moral entra por aqui — nada de `S.morale +=` solto por aí.
const MORALE_GAIN_MULT = 0.55, MORALE_LOSS_MULT = 1.4;
function gainMorale(v) {
  S.morale += v > 0 ? v * MORALE_GAIN_MULT * facMoraleGainMult() : v * MORALE_LOSS_MULT;
  clampMorale();
}

// Cadeia secreta que revela os Roxos (a partir do dia 6)
const DARK_EVENTS = [
  { id: "d1", ic: "🕯️", ty: "neg", t: "Sussurros na Cripta", s: "Vozes emanam das catacumbas sob o distrito. Elas conhecem o seu nome.", e: { morale: -6 } },
  { id: "d2", ic: "📜", ty: "neg", t: "O Grimório Proibido", s: "Um velho necromante deixou um tomo esquecido. Suas páginas prometem poder sobre os mortos.", e: { morale: -6, hearts: 3 } },
  { id: "d3", ic: "🟣", ty: "cha", t: "O Pacto Sombrio", s: "Você sela o pacto. A magia negra dos mortos passa a servir à muralha. Os ROXOS revelam-se, e agora respondem ao seu chamado.", e: {} },
];
function maybeDarkEvent() {
  // A cadeia existe só para REVELAR os Roxos. Quem já os desbloqueou não precisa
  // reviver o pacto toda run — daí o corte por META, não por estado da partida.
  if (facUnlocked("purple")) return null;
  if (S.purpleThisRun || S.darkChain >= 3 || S.day < 6) return null;
  if (Math.random() >= 0.4) return null;
  const ev = DARK_EVENTS[S.darkChain];
  S.darkChain++;
  if (S.darkChain >= 3) { S.purpleThisRun = true; unlockPurple(); applyFactionTint(); }
  return ev;
}

// ---------- Setor da run (nome cosmético) ----------
const SECTOR_A = ["Portão", "Bastião", "Muralha", "Trincheira", "Redoubt", "Baluarte", "Posto", "Torre"];
const SECTOR_B = ["do Corvo", "das Cinzas", "do Norte", "do Ocaso", "da Foice", "dos Lamentos", "do Cristal", "da Alvorada", "do Silêncio", "dos Mártires"];
function randomSector() {
  return SECTOR_A[Math.floor(Math.random() * SECTOR_A.length)] + " " + SECTOR_B[Math.floor(Math.random() * SECTOR_B.length)];
}

// ---------- OS FAVORES: Rei, Rainha, Conde dos Ratos e Povo Comum ----------
// Relação 0..100 por personagem (RESETA por run). Resultados descobertos e o
// contador de eventos persistem entre TODAS as runs (localStorage próprio).
// 1 interação por TURNO (conversar OU pedir OU presentear), só ENTRE turnos.
const FAV_KEY = "mknf-favores";
function loadFavMeta() {
  let m; try { m = JSON.parse(localStorage.getItem(FAV_KEY)) || {}; } catch { m = {}; }
  return Object.assign({ found: {}, evCount: 0 }, m);
}
const FAVMETA = loadFavMeta();
function saveFavMeta() { localStorage.setItem(FAV_KEY, JSON.stringify(FAVMETA)); }
// ---------- Contador de eventos das Alianças ----------
// O rodapé mostrava FAVMETA.evCount, que é a SOMA de conversas tidas, contra uma meta de
// 50. Dois problemas: não existem 50 eventos (são 4 personagens × 10 = 40), e repetir o
// mesmo evento inflava o número, então ele podia passar do total possível. Além disso o
// rótulo dizia "EVENTO REI" com "0/50" embaixo, ou seja, prometia o número DAQUELE evento
// e entregava uma contagem global — e um "Evento 0" que não existe.
function favEvTotal() { return FAV_ORDER.reduce((s, k) => s + FAV_EVENTS[k].length, 0); }
// Número do evento dentro da lista do personagem, começando em 1. É o que o rótulo pede.
function favEvNum(k, id) { return FAV_EVENTS[k].findIndex(e => e.id === id) + 1; }
// Eventos DISTINTOS já vistos: as chaves de `found` são "personagem:evento:escolha",
// então basta descartar a escolha e contar os pares únicos.
function favEvSeen() {
  return new Set(Object.keys(FAVMETA.found).map(key => key.split(":").slice(0, 2).join(":"))).size;
}
// VISITAR (você vai até eles, escolhendo quem): liberado desde o dia 1.
// RECEBER VISITA (um visitante fixo aparece sozinho e cobra atenção): só a partir
// deste dia. De qualquer forma, é 1 interação por turno.
const FAV_VISIT_MIN_DAY = 7;
function favDefault() { return { rel: { rei: 50, rainha: 50, conde: 50, povo: 50 }, used: false, last: {}, bag: {}, visitor: null, open: {}, visitDay: null }; }
// Gasta a interação DO TURNO. Se havia visitante, a visita dele fica resolvida pelo DIA:
// a interação é por turno, mas quem veio à muralha veio uma vez só. Sem isso, tratar com
// o visitante de manhã e passar a noite contaria como "ignorou a visita" e cobraria a
// punição de novo — o comandante seria punido por uma visita que ele atendeu.
function favSpend(k) {
  if (favFreeVisits) return;
  S.fav.used = true;
  if (S.fav.visitor && (k == null || k === S.fav.visitor)) S.fav.visitDay = S.day;
}
// Nome do personagem DENTRO de uma frase, com o artigo certo. Antes era a primeira
// palavra do nome de tela, o que dava "POVOS veio visitar" — nome de cartaz não serve
// como sujeito de oração. O fallback mantém a frase de pé se alguém esquecer o `short`.
function favShort(k) {
  const c = FAV_CHARS[k];
  return c ? (c.short || c.name.split(" ")[0]) : "";
}

function favTier(v, k) {
  if (v === 50) return k === "rainha" ? "NEUTRA" : k === "povo" ? "NEUTROS" : "NEUTRO"; // ponto de partida da run
  return v >= 75 ? "TE ADORA" : v > 50 ? "TE RESPEITA" : v >= 25 ? "TE TOLERA" : "TE ODEIA";
}
function favRel(k) { return S.fav.rel[k]; }
function favGainRel(k, d) { S.fav.rel[k] = Math.max(0, Math.min(100, S.fav.rel[k] + d)); }
function favPun(k) { return S.fav && S.fav.rel[k] <= 0; }
function favBless(k) { return S.fav && S.fav.rel[k] >= 100; } // relação máxima = bênção ativa
// Povo: produtividade −20% no chão / +10% no máximo
function favProdMult() { return favPun("povo") ? 0.8 : favBless("povo") ? 1.1 : 1; }
// Rainha: tropas −25% no chão / +15% no máximo
function favAllyMult() { return favPun("rainha") ? 0.75 : favBless("rainha") ? 1.15 : 1; }

// Efeitos de escolha: chaves de recurso + morale/hits/hearts/gold. rel = Δrelação.
const FAV_FX_META = {
  gold:        { n: "Ouro",       cor: "#eecd5c" },
  comida:      { n: "Comida",     cor: "#6fbf5f" },
  bens:        { n: "Bens",       cor: "#4aa3e0" },
  minerio:     { n: "Minérios",   cor: "#e0913a" },
  combustivel: { n: "Combustíveis", cor: "#c9c9c9" },
  maos:        { n: "Mão(s)",     cor: "#b06ae0" },
  hearts:      { n: "💎",         cor: "#c89aff" },
  morale:      { n: "Motivação",  cor: "#8ac6f0" },
  hits:        { n: "Muralha",    cor: "#d8d8d8" },
};
function favFxText(e) {
  const parts = [];
  for (const [k, v] of Object.entries(e)) {
    const m = FAV_FX_META[k]; if (!m || !v) continue;
    const neg = v < 0;
    parts.push(`<span style="color:${neg ? "#e05f5f" : m.cor}">${neg ? "" : "+"}${v} ${m.n}</span>`);
  }
  return parts.length ? `(${parts.join(", ")})` : "(sem efeito)";
}
function favApplyFx(e) {
  for (const [k, v] of Object.entries(e)) {
    if (!v) continue;
    // Custos de diálogo também podem deixar no vermelho (ver applyDailyEvent).
    // O caminho POSITIVO continua passando pelo addResource, que respeita os tetos.
    if (k === "gold") S.gold += v;
    else if (k === "hearts") S.hearts += v;
    else if (k === "morale") gainMorale(v);
    else if (k === "hits") S.hits = Math.max(1, Math.min(maxHits(), S.hits + v));
    else if (k === "maos") { if (v > 0) addResource("maos", v); else S.maos += v; }
    else { if (v > 0) addResource(k, v); else S.res[k] = (S.res[k] || 0) + v; }
  }
}

// Personagens: pedidos fixos (3 tamanhos, custo de relação crescente) e
// presentes fixos (o personagem escolhe o que quer). Punição em relação 0.
const FAV_CHARS = {
  rei: {
    art: "O", name: "REI QUE NÃO DORME", short: "o Rei", sub: "REGENTE DE KARZSTAK", img: "REI-ICONE.png",
    punIc: "👑", punDesc: "O Rei retira seu apoio: −6 de moral por turno.",
    blessDesc: "O Rei exalta seu nome: +3 de moral por turno.",
    askIntro: "Você pede uma reunião emergencial com o Rei.", askQuote: "Comandante, o que precisa?",
    asks: [
      { t: "Preciso de Bens.", e: { bens: 5 }, rel: 8 },
      { t: "Preciso de Pessoas.", e: { maos: 5 }, rel: 15 },
      { t: "Preciso de Ouro.", e: { gold: 100 }, rel: 25 },
    ],
    giftIntro: "Você é anunciado no salão do trono trazendo tributos.", giftQuote: "Espero que seja digno da coroa.",
    gifts: [
      { t: "Barris do melhor vinho", cost: { comida: 10 } },
      { t: "Minérios para a coroa nova", cost: { minerio: 10 } },
      { t: "Tributo em ouro", cost: { gold: 60 } },
    ],
  },
  rainha: {
    art: "A", name: "RAINHA DAS ROSAS", short: "a Rainha", sub: "MATRONA DA CIDADE", img: "RAINHA-ICONE.png",
    punIc: "🌹", punDesc: "A Rainha sussurra contra você: tropas batem −25% enquanto durar.",
    blessDesc: "A Rainha inspira suas tropas: +15% de dano enquanto durar.",
    askIntro: "Você solicita audiência no jardim real.", askQuote: "Seja breve, o chá esfria.",
    asks: [
      { t: "Preciso de Comida.", e: { comida: 5 }, rel: 8 },
      { t: "Preciso de Minérios.", e: { minerio: 5 }, rel: 15 },
      { t: "Preciso de Cristais.", e: { hearts: 4 }, rel: 25 },
    ],
    giftIntro: "Você envia um presente aos aposentos da Rainha.", giftQuote: "Hm. Veremos se tem bom gosto.",
    gifts: [
      { t: "Rosas raras do distrito", cost: { comida: 8 } },
      { t: "Joias de Argamato", cost: { hearts: 3 } },
      { t: "Sedas importadas", cost: { bens: 8 } },
    ],
  },
  conde: {
    art: "O", name: "CONDE DOS RATOS", short: "o Conde", sub: "LORDE DO SUBSOLO", img: "CONDE-ICONE.png",
    punIc: "🐀", punDesc: "Os ratos roem os alicerces: −1 hit das muralhas por turno.",
    blessDesc: "Os ratos remendam os alicerces: +1 hit das muralhas a cada amanhecer.",
    askIntro: "Você desce aos túneis do mercado ilegal.", askQuote: "Tudo tem um preço, comandante...",
    asks: [
      { t: "Preciso de Combustíveis.", e: { combustivel: 5 }, rel: 8 },
      { t: "Preciso de Bens.", e: { bens: 8 }, rel: 15 },
      { t: "Preciso de Ouro sujo.", e: { gold: 80 }, rel: 25 },
    ],
    giftIntro: "Você deixa um embrulho na entrada dos túneis.", giftQuote: "Ora, ora... que gentileza.",
    gifts: [
      { t: "Queijos maturados", cost: { comida: 8 } },
      { t: "Bugigangas de contrabando", cost: { bens: 6 } },
      { t: "Ouro sem perguntas", cost: { gold: 40 } },
    ],
  },
  povo: {
    art: "OS", name: "POVOS COMUNS", short: "o povo", sub: "ALDEÕES HUMANOS", img: "OS-POVOS-ICONE.png",
    punIc: "🔥", punDesc: "O povo cruza os braços: produção −20% enquanto durar.",
    blessDesc: "O povo trabalha cantando: produção +10% enquanto durar.",
    askIntro: "Você sobe num caixote na praça e pede ajuda ao povo.", askQuote: "O que as muralhas precisam de nós?",
    asks: [
      { t: "Preciso de Comida.", e: { comida: 5 }, rel: 8 },
      { t: "Preciso de voluntários.", e: { maos: 3 }, rel: 15 },
      { t: "Preciso de tudo que puderem dar.", e: { comida: 5, bens: 5, minerio: 5 }, rel: 25 },
    ],
    giftIntro: "Você organiza uma doação da guarda para o distrito.", giftQuote: "Olha! O comandante lembrou da gente!",
    gifts: [
      { t: "Pães da intendência", cost: { comida: 6 } },
      { t: "Ferramentas novas", cost: { bens: 6 } },
      { t: "Um dia de festa", cost: { gold: 30 } },
    ],
  },
};
const FAV_ORDER = ["conde", "rei", "rainha", "povo"];

// Eventos de conversa: 10 por personagem, 3 respostas cada.
// Resultados ficam "NÃO DESCOBERTO" até a primeira escolha (persistente entre runs).
const FAV_EVENTS = {
  rei: [
    { id: "r1", s: "Você encontra o Rei pelos corredores do palácio fazendo sua caminhada matinal.", q: "Você parece pálido, o que aconteceu?",
      c: [{ t: "Eh... Estou de ressaca, minha alteza.", e: { comida: 5 }, rel: -5, r: "Ressaca. Ao menos é honesto. Eu não durmo há um século." },
          { t: "Estou bem! A cidade é mais importante.", e: { bens: 5 }, rel: 6, r: "A cidade agradece. Eu também, comandante." },
          { t: "Cuida da sua vida, Corôa!", e: { morale: 8 }, rel: -8, r: "Minha vida É a cidade. Cuide do tom." }] },
    { id: "r2", s: "O Rei inspeciona as muralhas do alto de seu corcel.", q: "Estas rachaduras... são recentes?",
      c: [{ t: "Já mandei reparar, alteza.", e: { hits: 1 }, rel: 6, r: "Bom. Pedra remendada ainda é pedra de pé." },
          { t: "As muralhas aguentam mais que o senhor.", e: { morale: 6 }, rel: -6, r: "Talvez. Mas é a mim que elas respondem." },
          { t: "Preciso de verba para isso.", e: { gold: 30 }, rel: -4, r: "Sempre precisam. O cofre do reino também tem rachaduras." }] },
    { id: "r3", s: "Durante o banquete real, o Rei ergue a taça na sua direção.", q: "Um brinde ao comandante da Muralha Oeste!",
      c: [{ t: "Ao Rei e a Karzstak!", e: { morale: 10 }, rel: 7, r: "A Karzstak, então. Que ela nos enterre velhos." },
          { t: "Brindo quando a horda recuar.", e: { bens: 4 }, rel: -3, r: "Então beberá sozinho, comandante. Ela não recua." },
          { t: "Prefiro brindar com os soldados.", e: { morale: 5, comida: 3 }, rel: -5, r: "Justo. O vinho desce melhor entre quem sangra." }] },
    { id: "r4", s: "O Rei recebeu cartas de outros setores pedindo seu remanejamento.", q: "Querem tirá-lo de mim. O que responde?",
      c: [{ t: "Meu posto é aqui, alteza.", e: { morale: 8 }, rel: 8, r: "Era o que eu queria ouvir. A carta vai para o fogo." },
          { t: "Talvez seja hora de subir na vida...", e: { gold: 20 }, rel: -8, r: "Suba, então. A porta do palácio é larga." },
          { t: "Deixe que decidam as muralhas.", e: { bens: 5 }, rel: 2, r: "As muralhas não escrevem cartas. Mas entendi." }] },
    { id: "r5", s: "O Rei mostra o mapa do reino, coberto de marcadores negros.", q: "Diga-me a verdade: vamos resistir?",
      c: [{ t: "Enquanto eu respirar, sim.", e: { morale: 12 }, rel: 7, r: "Então respire fundo, comandante. E por muito tempo." },
          { t: "Com mais ouro, sim.", e: { gold: 50 }, rel: -6, r: "Verdade com preço não é verdade. É orçamento." },
          { t: "Não sei, alteza.", e: { comida: 4 }, rel: -3, r: "Ninguém sabe. Eu só queria ouvir outra coisa." }] },
    { id: "r6", s: "Um mensageiro tropeça e derruba sopa no manto real. O Rei olha para você.", q: "E então? Rimos ou executamos?",
      c: [{ t: "Rimos, majestade. Rimos.", e: { morale: 8 }, rel: 5, r: "Rimos. Faz duas décadas que eu não fazia isso." },
          { t: "A sopa estava boa, é o que importa.", e: { comida: 5 }, rel: 3, r: "Estava. E o manto era velho mesmo." },
          { t: "Executar é desperdício de Mãos.", e: { maos: 1 }, rel: -4, r: "Contabilidade. Sempre a contabilidade com você." }] },
    { id: "r7", s: "O Rei o convoca à sala do trono vazia, sem guardas.", q: "Se eu cair, quem protege Karzstak?",
      c: [{ t: "O senhor não vai cair.", e: { morale: 6 }, rel: 6, r: "Todos caem. A pergunta era outra, comandante." },
          { t: "As muralhas protegem. Sempre protegeram.", e: { hits: 1 }, rel: 2, r: "As muralhas, sim. Elas não precisam de coroa." },
          { t: "Eu protejo. Com ou sem coroa.", e: { morale: 10 }, rel: -7, r: "Cuidado. Foi assim que começou a última guerra civil." }] },
    { id: "r8", s: "O Rei testa uma besta nova no pátio e erra todos os alvos.", q: "O vento, comandante. Foi o vento.",
      c: [{ t: "Claramente o vento, alteza.", e: { gold: 25 }, rel: 5, r: "Claramente. Você tem futuro na corte." },
          { t: "Deixe as bestas com os artilheiros.", e: { bens: 4 }, rel: -5, r: "Um rei que não atira é um rei que só assina." },
          { t: "Quer aulas? Cobro barato.", e: { gold: 15, morale: 4 }, rel: -3, r: "Cobra do seu rei. Anotado, comandante." }] },
    { id: "r9", s: "O Rei encontrou seu relatório de baixas rasurado.", q: "Está escondendo números de mim?",
      c: [{ t: "Jamais, alteza. Foi a chuva.", e: { gold: 20 }, rel: -6, r: "Choveu dentro do meu gabinete, então. Entendo." },
          { t: "Sim. Para proteger o moral.", e: { morale: 6 }, rel: 4, r: "Mentira por dever ainda é mentira. Mas eu aceito." },
          { t: "Números não seguram muralhas.", e: { hits: 1 }, rel: -2, r: "Não. Mas dizem quando elas vão cair." }] },
    { id: "r10", s: "No aniversário da coroação, o Rei distribui presentes à corte.", q: "Para você, comandante... escolha.",
      c: [{ t: "O que sua alteza julgar justo.", e: { gold: 40 }, rel: 6, r: "Então será generoso. Você nunca pede nada." },
          { t: "Suprimentos para meus homens.", e: { comida: 8, bens: 4 }, rel: 4, r: "Suprimentos. Eu ofereci um presente, não um requerimento." },
          { t: "Sua besta de caça. A dourada.", e: { hearts: 3 }, rel: -6, r: "Essa não. Nem para você, comandante." }] },
  ],
  rainha: [
    { id: "q1", s: "Chá da tarde no castelo, a rainha parece furiosa e caminha até você.", q: "Você pisou nas minhas rosas...",
      c: [{ t: "Me desculpe, vossa alteza!", e: { minerio: 5 }, rel: -3, r: "Desculpa não faz pétala crescer de volta." },
          { t: "Oh não! Eu pago pelas flores.", e: { gold: -50 }, rel: 5, r: "Pagará. E plantará as novas com essas mãos." },
          { t: "Mas são apenas flores...", e: { morale: 4 }, rel: -8, r: "Apenas flores. Diga isso outra vez e veremos." }] },
    { id: "q2", s: "A Rainha observa a horda do balcão mais alto, impassível.", q: "Eles não me assustam. E a você?",
      c: [{ t: "Todos os dias, majestade.", e: { morale: 4 }, rel: 5, r: "Bom. Quem não teme não presta atenção." },
          { t: "Medo é para os mortos.", e: { morale: 8 }, rel: 3, r: "Frase bonita. Guarde-a para o seu epitáfio." },
          { t: "Só me assusta a fatura da guerra.", e: { gold: 25 }, rel: -5, r: "Que romântico. Vá contar moedas, comandante." }] },
    { id: "q3", s: "A Rainha organiza um sarau em plena guerra. Você é convidado.", q: "A arte morre quando paramos de dançar. Vem?",
      c: [{ t: "Uma dança, apenas.", e: { morale: 10 }, rel: 6, r: "Uma. Foi mais do que eu esperava de um soldado." },
          { t: "Tenho muralhas para segurar.", e: { hits: 1 }, rel: -6, r: "Segure. E que elas dancem melhor do que você." },
          { t: "Mando meus soldados descansarem lá.", e: { morale: 6, comida: -3 }, rel: 3, r: "Aceito a tropa. Mas eu queria o comandante." }] },
    { id: "q4", s: "Você flagra a Rainha alimentando corvos na torre norte.", q: "Eles contam segredos. Quer ouvir um?",
      c: [{ t: "Sempre, majestade.", e: { hearts: 2 }, rel: 5, r: "Então ouça: dois lordes já apostaram na sua queda." },
          { t: "Corvos comem carniça, cuidado.", e: { comida: 4 }, rel: -5, r: "Eu sei o que eles comem. É por isso que eles falam." },
          { t: "Segredos custam caro por aqui.", e: { gold: 30 }, rel: -3, r: "Custam. E o senhor acabou de recusar o troco." }] },
    { id: "q5", s: "A Rainha manda bordar estandartes novos para a guarda.", q: "Vermelho sangue ou dourado sol?",
      c: [{ t: "Dourado. O sol ainda nasce.", e: { morale: 8 }, rel: 5, r: "Dourado, então. Que ele nasça sobre nós." },
          { t: "Vermelho. Que saibam o preço.", e: { morale: 5 }, rel: 3, r: "Vermelho. Sem elegância, mas honesto." },
          { t: "Pano é melhor gasto em bandagens.", e: { bens: 5 }, rel: -6, r: "Bandagens. O senhor não tem alma, tem inventário." }] },
    { id: "q6", s: "Uma dama da corte espalhou boatos sobre você. A Rainha ouve tudo.", q: "Devo cortar a língua... do boato, claro.",
      c: [{ t: "Deixe falarem, majestade.", e: { morale: 5 }, rel: 4, r: "Deixarei. Boato sem plateia morre sozinho." },
          { t: "Corte. Com cerimônia.", e: { gold: 15 }, rel: -4, r: "Com cerimônia. O senhor aprende rápido a corte." },
          { t: "Boato bom eu mesmo espalho.", e: { morale: 6 }, rel: -6, r: "Então somos dois. Que perigo, comandante." }] },
    { id: "q7", s: "A Rainha visita os feridos no hospital de campanha sem anunciar.", q: "Eles lutam por você. Por que lutam?",
      c: [{ t: "Pelas famílias atrás das muralhas.", e: { morale: 8 }, rel: 6, r: "Pelas famílias. É a única resposta que serve." },
          { t: "Porque eu mando.", e: { maos: 1 }, rel: -7, r: "Ordem move fila, não move homem. Pense melhor." },
          { t: "Pergunte a eles, majestade.", e: { morale: 4, comida: 3 }, rel: 4, r: "Perguntarei. E contarei o que disserem do senhor." }] },
    { id: "q8", s: "O jardim real amanheceu coberto de cinzas da horda.", q: "Nem minhas rosas escapam. Providências?",
      c: [{ t: "Mando limpar pessoalmente.", e: { maos: -1, morale: 4 }, rel: 7, r: "Pessoalmente. Então ainda há cavalheiros na guarda." },
          { t: "Cinza é adubo, majestade.", e: { comida: 6 }, rel: -4, r: "Adubo de morto. Que jardim o senhor imagina?" },
          { t: "Rosas de novo...", e: { minerio: 4 }, rel: -8, r: "De novo, sim. Elas são o que sobrou de bonito." }] },
    { id: "q9", s: "A Rainha lhe entrega um lenço bordado com o brasão real.", q: "Para a sorte. Ou para o sangue. Veremos.",
      c: [{ t: "Guardarei com honra.", e: { morale: 6 }, rel: 6, r: "Guarde. E volte para devolvê-lo em pessoa." },
          { t: "Sorte se compra com aço.", e: { minerio: 5 }, rel: -3, r: "Aço enferruja. Leve o lenço de todo modo." },
          { t: "Vendo por um bom preço...", e: { gold: 45 }, rel: -9, r: "Venda. E não apareça mais no meu salão." }] },
    { id: "q10", s: "Você a encontra sozinha na capela, de vela acesa.", q: "Reze comigo. Ou apenas fique.",
      c: [{ t: "Fico, majestade.", e: { morale: 8 }, rel: 6, r: "Fique. O silêncio de dois pesa menos." },
          { t: "Rezo pelos que não voltaram.", e: { morale: 5, hearts: 1 }, rel: 4, r: "Então reze alto. São muitos nomes." },
          { t: "Deuses não seguram muralhas.", e: { hits: 1 }, rel: -7, r: "Não seguram. Mas seguram gente como eu." }] },
  ],
  conde: [
    { id: "c1", s: "Depois de uma longa noite...comemorando, ele te faz uma proposta indecente:", q: "Quero que case com a minha filha!",
      c: [{ t: "Vai ser uma honra!", e: { comida: 20 }, rel: 6, r: "HA! Ouviram? Temos noivo! Alguém traz o rato assado!" },
          { t: "Não vai dar... Sou comprometido", e: { maos: 1 }, rel: 2, r: "Comprometido. Com a muralha, né? Casamento triste." },
          { t: "Devemos pedir ao Rei primeiro...", e: {}, rel: -5, r: "Pedir ao Rei? Aí já é covardia com etiqueta." }] },
    { id: "c2", s: "O Conde surge do esgoto com um mapa rabiscado.", q: "Túnel novo. Passa POR BAIXO da horda. Interessa?",
      c: [{ t: "Quanto custa a passagem?", e: { gold: -30, bens: 10 }, rel: 4, r: "Agora sim a gente fala a mesma língua, comandante." },
          { t: "Isso é traição em potencial.", e: { morale: 4 }, rel: -6, r: "Traição é palavra de quem nunca precisou fugir." },
          { t: "Interessa. E o mapa também.", e: { combustivel: 6 }, rel: 3, r: "O mapa é o dobro. Mas para o senhor, o dobro e meio." }] },
    { id: "c3", s: "Ele aparece vendendo 'amuletos abençoados' aos seus soldados.", q: "Fé barata, comandante! Quer comissão?",
      c: [{ t: "Metade da banca, e finjo que não vi.", e: { gold: 35 }, rel: 4, r: "Metade! O senhor devia morar aqui embaixo." },
          { t: "Devolva o ouro deles. AGORA.", e: { morale: 6 }, rel: -7, r: "Devolvo. Menos a taxa de manuseio, claro." },
          { t: "Me vê dois. Pra garantir.", e: { gold: -10, morale: 5 }, rel: 3, r: "Dois! Fé em dobro protege em dobro. Dizem." }] },
    { id: "c4", s: "O Conde oferece um banquete no subsolo. A carne tem procedência duvidosa.", q: "Rato não. Provavelmente. Come?",
      c: [{ t: "Já comi pior na guerra.", e: { comida: 10 }, rel: 6, r: "Eu sabia. Soldado de verdade come de olho fechado." },
          { t: "Passo. Mas levo pros porcos.", e: { comida: 5 }, rel: -2, r: "Porcos. Meus melhores clientes, por sinal." },
          { t: "Chamo a inspeção real.", e: { gold: 15 }, rel: -8, r: "Inspeção. Que bela forma de perder um amigo." }] },
    { id: "c5", s: "Ele sussurra que um capitão seu anda vendendo virotes no mercado negro.", q: "Nomes custam, comandante. Mas hoje tô bonzinho.",
      c: [{ t: "Fale, e fico devendo uma.", e: { bens: 8 }, rel: 4, r: "Devendo. Adoro quando o senhor fala assim." },
          { t: "Meus capitães são leais. Fora daqui.", e: { morale: 4 }, rel: -6, r: "Leais. Foi o que o último comandante disse." },
          { t: "Vendendo? Sem me dar comissão?", e: { gold: 25 }, rel: 5, r: "HA! O senhor está aprendendo o ofício." }] },
    { id: "c6", s: "O Conde chega mancando, roupas rasgadas, sorrindo.", q: "Você devia ver o OUTRO. Me esconde por uma noite?",
      c: [{ t: "Uma noite. E some ao amanhecer.", e: { combustivel: 5 }, rel: 6, r: "Uma noite! O senhor é um príncipe entre soldados." },
          { t: "O que você aprontou dessa vez?", e: { gold: 20 }, rel: 2, r: "Detalhes. Detalhes atrapalham a hospitalidade." },
          { t: "Guardas! Temos um fugitivo!", e: { morale: 3 }, rel: -9, r: "GUARDAS?! Eu trouxe QUEIJO, seu ingrato!" }] },
    { id: "c7", s: "Ele abre a capa: relíquias de setores caídos, ainda com poeira.", q: "Recém-chegadas. Preço de amigo.",
      c: [{ t: "Isso é saque de mortos...", e: { morale: -3, hearts: 3 }, rel: 2, r: "Morto não usa aliança, comandante. Eu uso." },
          { t: "Levo tudo. Sem perguntas.", e: { gold: -40, hearts: 5 }, rel: 5, r: "Sem perguntas! Minha frase favorita do reino." },
          { t: "Devolva às famílias. Já.", e: { morale: 8 }, rel: -6, r: "Às famílias. E eu como o quê? Moral?" }] },
    { id: "c8", s: "O Conde aposta que você não acerta uma moeda a cem passos.", q: "Cinquenta moedas. Topa, olho de águia?",
      c: [{ t: "Topo. Mira é meu ofício.", e: { gold: 50 }, rel: 3, r: "Ofício. Vamos ver se a mão tremeu com a aposta." },
          { t: "Não aposto com trapaceiro.", e: { bens: 4 }, rel: -4, r: "Trapaceiro?! Eu só melhoro as chances, comandante." },
          { t: "Dobro ou nada.", e: { gold: -50, morale: 6 }, rel: 4, r: "DOBRO! Agora a noite ficou interessante." }] },
    { id: "c9", s: "Ratos invadiram seus armazéns. O Conde surge... casualmente.", q: "Que coincidência TERRÍVEL. Posso resolver.",
      c: [{ t: "Resolva. E rápido.", e: { gold: -20, comida: 12 }, rel: 3, r: "Rápido. Meus meninos já estão a caminho, por sinal." },
          { t: "Foi você, não foi?", e: { comida: 6 }, rel: -5, r: "Eu?! Comandante, o senhor me ofende e me elogia junto." },
          { t: "Fico com os ratos. Viram sopa.", e: { comida: 8 }, rel: 4, r: "Sopa dos meus ratos. Isso é quase um imposto." }] },
    { id: "c10", s: "No fundo do túnel, o Conde mostra um retrato antigo: ele, jovem, de armadura real.", q: "Todo rato já foi soldado, comandante.",
      c: [{ t: "O que aconteceu?", e: { morale: 5 }, rel: 6, r: "Aconteceu o de sempre: mandaram, e ninguém voltou." },
          { t: "A armadura ainda serve?", e: { maos: 1 }, rel: 4, r: "Serve. Aperta na barriga, mas serve." },
          { t: "Deserção tem cheiro de esgoto mesmo.", e: { gold: 10 }, rel: -8, r: "Cheiro de esgoto. Pois é o cheiro de quem sobrou." }] },
  ],
  povo: [
    { id: "p1", s: "Ao passar pelo seu distrito você vê várias pessoas desmaiadas na rua.", q: "Temos... Fooome. Por favor!",
      c: [{ t: "A horda também. Voltem ao trabalho!", e: { morale: 5 }, rel: -8, r: "Então é assim. Trabalhar de barriga vazia, de novo." },
          { t: "Teremos um banquete no fim do expediente", e: { maos: 1 }, rel: 6, r: "Banquete! Ouviram? O comandante prometeu!" },
          { t: "Devemos pedir ao Rei primeiro...", e: {}, rel: -4, r: "O Rei. Sempre o Rei. E a gente espera sentado." }] },
    { id: "p2", s: "Uma multidão se reúne no portão pedindo notícias dos setores vizinhos.", q: "É verdade que o Portão Sul caiu?!",
      c: [{ t: "Mentira. E o Oeste não cai.", e: { morale: 8 }, rel: 4, r: "Não cai. O senhor falou, a gente acredita." },
          { t: "Caiu. Por isso treinamos dobrado.", e: { morale: -4, maos: 2 }, rel: 5, r: "Caiu mesmo. Pelo menos o senhor não mentiu." },
          { t: "Sem perguntas. Circulando!", e: { bens: 3 }, rel: -7, r: "Circulando. É o que a gente faz melhor: calar." }] },
    { id: "p3", s: "As crianças do distrito fizeram uma maquete das suas muralhas com sucata.", q: "Ficou igualzinha, né, comandante?",
      c: [{ t: "Melhor que a original.", e: { morale: 10 }, rel: 7, r: "Ouviu, mãe?! Melhor que a de verdade!" },
          { t: "Faltou a torre três. Refaçam.", e: { bens: 4 }, rel: -3, r: "Refazer... A gente fez com o que achou no lixo." },
          { t: "Contrato os engenheiros mirins.", e: { maos: 1, morale: 5 }, rel: 5, r: "Engenheiros! A gente vai construir a cidade toda!" }] },
    { id: "p4", s: "Um ferreiro veterano oferece trabalhar de graça nas torres.", q: "Perdi meu filho pra horda. Deixa eu ajudar.",
      c: [{ t: "Bem-vindo às muralhas, mestre.", e: { maos: 2 }, rel: 6, r: "Mestre. Ninguém me chamava assim há muito tempo." },
          { t: "De graça não. Salário justo.", e: { gold: -20, maos: 2, morale: 5 }, rel: 8, r: "Salário. O senhor é o primeiro a oferecer." },
          { t: "Velho demais. Vá pra casa.", e: { comida: 3 }, rel: -8, r: "Casa. Não tem mais casa, comandante. Nem filho." }] },
    { id: "p5", s: "O poço central amanheceu turvo. O povo desconfia de sabotagem.", q: "Tem gosto de ferrugem! Foi a horda?",
      c: [{ t: "Vou investigar pessoalmente.", e: { minerio: 4 }, rel: 5, r: "Pessoalmente. Então alguém vai olhar de verdade." },
          { t: "É só ferro. Faz bem pro sangue.", e: { morale: 4 }, rel: -5, r: "Faz bem. Beba o senhor primeiro, então." },
          { t: "Racionem até eu descobrir.", e: { comida: -3, bens: 4 }, rel: -2, r: "Racionar água também. A gente entende. Sempre entende." }] },
    { id: "p6", s: "Uma senhora te para na rua e enfia um embrulho nas suas mãos.", q: "Pão de fermento natural. Come, tá magro.",
      c: [{ t: "Obrigado, dona. Melhor pão do reino.", e: { comida: 5, morale: 5 }, rel: 6, r: "Melhor pão do reino! Escreve isso na parede!" },
          { t: "Divido com a guarda noturna.", e: { morale: 8 }, rel: 5, r: "Divide, sim. É assim que a gente aguenta." },
          { t: "Estou em serviço, senhora.", e: { bens: 2 }, rel: -5, r: "Em serviço. E esfria na mão de quem ofereceu." }] },
    { id: "p7", s: "Os taberneiros querem abrir durante a noite, apesar do toque de recolher.", q: "Soldado sedento luta mal, comandante!",
      c: [{ t: "Abram. Primeira rodada é minha.", e: { gold: -15, morale: 10 }, rel: 7, r: "A PRIMEIRA É DELE! Abram tudo!" },
          { t: "Fechado. Horda não bebe, nós também não.", e: { bens: 5 }, rel: -6, r: "Fechado. A horda também não ri, comandante." },
          { t: "Só até a lua alta. E sem cantoria.", e: { gold: 10, morale: 4 }, rel: 3, r: "Sem cantoria. A gente canta baixinho, então." }] },
    { id: "p8", s: "Um grupo de jovens quer se alistar. Nenhum sabe segurar uma lança.", q: "A gente aprende rápido! Juro!",
      c: [{ t: "Todos pro treino. Amanhã, cedo.", e: { maos: 2 }, rel: 5, r: "Amanhã cedo! A gente chega antes do sol!" },
          { t: "Muralhas precisam de braços, não heróis.", e: { maos: 1, bens: 3 }, rel: 3, r: "Braços a gente tem. Herói era só o apelido." },
          { t: "Voltem quando crescerem.", e: { morale: 3 }, rel: -6, r: "Crescer. A horda não esperou a gente crescer." }] },
    { id: "p9", s: "O mercado improvisou uma feira sob as muralhas. Está lotada e barulhenta.", q: "Vida que segue, né, comandante?",
      c: [{ t: "Feira aberta. A vida vence.", e: { gold: 20, morale: 6 }, rel: 6, r: "A vida vence! Ouviram o homem? Feira aberta!" },
          { t: "Muito exposta. Mudem pra praça.", e: { bens: 5 }, rel: -3, r: "Mudar de novo. É a terceira vez este mês." },
          { t: "Cobro taxa de proteção.", e: { gold: 35 }, rel: -8, r: "Taxa. Nem o Conde dos Ratos cobrava da feira." }] },
    { id: "p10", s: "No fim do turno, o distrito inteiro se reúne para ver o sol se pôr das muralhas.", q: "Enquanto o senhor tiver de pé, a gente fica.",
      c: [{ t: "Então ficamos todos.", e: { morale: 12 }, rel: 7, r: "Todos. Isso é uma promessa, comandante." },
          { t: "Subam. A vista é de vocês também.", e: { morale: 8, maos: 1 }, rel: 6, r: "A vista é nossa. Nunca ninguém disse isso." },
          { t: "Dispersar. Isso aqui não é teatro.", e: { bens: 3 }, rel: -7, r: "Não é teatro. A gente só queria ver o sol com o senhor." }] },
  ],
};

// ---- estado de navegação da tela ----
let favSel = 1;            // índice em FAV_ORDER (começa no Rei)
let favView = null;        // null = fechada; "hub" | encounter {mode, chr, ev, done}
function openFavores() {
  if (S.waveActive) { toast("🤝 As Alianças só podem ser tratadas entre os turnos."); return; }
  favView = "hub";
  // abre já focado em quem está visitando hoje
  if (S.fav && S.fav.visitor) favSel = FAV_ORDER.indexOf(S.fav.visitor);
  renderFavScr();
  fadeInScreen("fav-scr");
}
function closeFavores() { favView = null; fadeOutScreen("fav-scr", renderAll); }

// Sorteio em SACO EMBARALHADO: os eventos do personagem saem em ordem aleatória
// e só voltam a repetir quando todos tiverem saído. O saco é reembaralhado ao
// esvaziar, evitando que o último de um ciclo emende com o primeiro do seguinte.
function favDrawEvent(k) {
  S.fav.bag = S.fav.bag || {};
  let bag = S.fav.bag[k];
  if (!Array.isArray(bag) || !bag.length) {
    bag = FAV_EVENTS[k].map(e => e.id);
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    if (bag.length > 1 && bag[0] === S.fav.last[k]) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
  }
  const id = bag.shift();
  S.fav.bag[k] = bag;
  return FAV_EVENTS[k].find(e => e.id === id) || FAV_EVENTS[k][0];
}

let favFreeVisits = false; // debug: visitas infinitas (botão discreto no "?")
// ---------- Economia da relação ----------
// A relação deixa de ser só um número com punição nos extremos e passa a inclinar TODO o
// trato: quem te odeia te recebe menos, cobra mais e quase não aparece; quem te adora
// cobra menos e às vezes nem cobra. 50 é o ponto de partida da run, então é o eixo.
// ASSIMETRIA DE PROPÓSITO (pedido do design): relação alta NÃO aumenta a chance de visita.
// Ela só deixa de reduzir. Caso contrário, maximizar os quatro encheria a agenda do
// comandante de visitas e a visita deixaria de ser um evento.
const BUSY_AT_ZERO = 0.8, BUSY_AT_NEUTRAL = 0.18;   // chance de NÃO te receber
const ASK_MULT_AT_MAX = 0.6, ASK_MULT_AT_ZERO = 2.5; // multiplicador do custo do pedido
const ASK_BOON_CHANCE = 0.35, ASK_BOON_BONUS = 0.5;  // relação 100: dádiva (grátis +50%)
const VISIT_W_FLOOR = 0.12;                          // peso mínimo da visita na relação 0
// Interpola entre o valor em 0, o valor em 50 e o valor em 100.
function relCurve(rel, atZero, atNeutral, atMax) {
  return rel >= 50
    ? atNeutral + (atMax - atNeutral) * (rel - 50) / 50
    : atZero + (atNeutral - atZero) * rel / 50;
}
function favBusyChance(k) { return relCurve(favRel(k), BUSY_AT_ZERO, BUSY_AT_NEUTRAL, 0); }
function askCostMult(k) { return relCurve(favRel(k), ASK_MULT_AT_ZERO, 1, ASK_MULT_AT_MAX); }
// Custo em RELAÇÃO do pedido. Em 100 o menor pedido sai de graça (perk de sempre).
function askCost(k, i) {
  if (favRel(k) >= 100 && i === 0) return 0;
  return Math.max(1, Math.round(FAV_CHARS[k].asks[i].rel * askCostMult(k)));
}
// Peso da visita: cai com a relação baixa, não sobe com a alta.
function favVisitWeight(k) { return favRel(k) >= 50 ? 1 : Math.max(VISIT_W_FLOOR, favRel(k) / 50); }
// Multiplica os números de um efeito (a dádiva rende mais recurso).
function scaleFx(e, mult) {
  const out = {};
  for (const [k, v] of Object.entries(e)) out[k] = typeof v === "number" ? Math.round(v * mult) : v;
  return out;
}

// ---------- Disponibilidade por turno ----------
// Cada figura tem sua própria rotina: o Rei nunca dorme, a Rainha só recebe de dia, o
// Conde dos Ratos só sai à noite, e o Povo depende da jornada de trabalho. A sorte do
// Povo é sorteada UMA vez por turno e guardada em S.fav.open — se fosse rolada no clique,
// bastaria insistir até dar certo.
const FAV_AVAIL = {
  rei:    { day: 1,   night: 1,   note: "Atende de dia e de noite." },
  rainha: { day: 1,   night: 0,   note: "Só recebe durante o DIA." },
  conde:  { day: 0,   night: 1,   note: "Só sai da toca à NOITE." },
  povo:   { day: 0.7, night: 0.3, note: "70% de chance de dia, 30% à noite." },
};
function favRollOpen() {
  const out = {};
  for (const k of FAV_ORDER) out[k] = Math.random() < FAV_AVAIL[k][S.isNight ? "night" : "day"];
  return out;
}
// Quem VEIO até você está, por definição, presente — mesmo fora do horário dele.
function favOpen(k) {
  if (favFreeVisits || (S.fav && S.fav.visitor === k)) return true;
  return !!(S.fav && S.fav.open && S.fav.open[k]);
}
function favClosedNote(k) {
  const a = FAV_AVAIL[k];
  if (a[S.isNight ? "night" : "day"] === 0) return a.note;
  return `Ninguém atendeu. ${a.note}`; // Povo: tinha chance, mas não deu hoje
}
function favNewTurn() {
  S.fav.open = favRollOpen();
  S.fav.used = false;  // 1 interação por TURNO (antes era por dia: dia e noite dividiam a mesma)
}

function favTryAction(k, mode) {
  // 1 interação por turno — visitar qualquer aliança já é permitido desde o dia 1.
  if (S.fav.used && !favFreeVisits) { toast("Você já tratou com uma aliança neste turno. Volte no próximo."); return; }
  // Se alguém veio até você (dia 7+), essa visita tem prioridade: trava as demais.
  if (!favFreeVisits && S.fav.visitor && S.fav.visitor !== k) {
    toast(`Hoje ${favShort(S.fav.visitor)} veio até você, e só com ${favShort(S.fav.visitor)} dá pra tratar hoje.`);
    return;
  }
  // Fora do horário: não é interação nenhuma, então não gasta a visita do dia.
  if (!favOpen(k)) { toast(`${FAV_CHARS[k].punIc} ${favClosedNote(k)}`); return; }
  // CONVERSAR e PEDIR arriscam não ser recebido, e a chance disso sobe conforme a
  // relação cai. PRESENTEAR nunca é recusado, e isso é regra, não esquecimento: o
  // presente é a ÚNICA via de recuperação, e recusá-lo deixaria quem chegou a zero preso
  // lá para sempre. Quem veio até você também nunca está ocupado: está na sua porta.
  if (mode !== "gift" && S.fav.visitor !== k && Math.random() < favBusyChance(k)) {
    favSpend(k); saveGame();
    favView = { mode: "busy", chr: k };
    renderFavScr();
    return;
  }
  if (mode === "talk") {
    favView = { mode: "talk", chr: k, ev: favDrawEvent(k), done: null };
  } else {
    favView = { mode, chr: k, done: null };
  }
  renderFavScr();
}

// ---- render ----
// MEDIDOR DE RELAÇÃO (arco atrás do retrato). Era uma polilinha facetada única: não
// tinha parte cheia nem vazia, então o arco não dizia nada além de onde o coração
// estava. Agora são duas camadas sobre o MESMO arco liso — trilha apagada com a escala
// inteira e traço aceso com o quanto a relação subiu — mais marcas nos limiares dos
// patamares (25/50/75), que são justamente onde o texto embaixo muda de nome.
const FAV_ARC = { cx: 50, cy: 88, rx: 46, ry: 78 };
// f: 0 = ponta "−" (direita) · 1 = ponta "+" (esquerda). Mantém a orientação de antes.
function favArcPt(f) {
  const t = (1 - f) * Math.PI;
  return [FAV_ARC.cx - FAV_ARC.rx * Math.cos(t), FAV_ARC.cy - FAV_ARC.ry * Math.sin(t)];
}
// Meia-elipse por CIMA: sweep-flag 0, porque com 1 o arco passaria por baixo da base.
const FAV_ARC_D = `M 96 88 A ${FAV_ARC.rx} ${FAV_ARC.ry} 0 0 0 4 88`;
// Cor por patamar: o arco passa a dizer o humor do personagem, não só a posição dele.
// 50 é o ponto de partida da run (NEUTRO), por isso tem um tom próprio, sem lado.
function favArcColor(rel) {
  if (rel >= 75) return "#f4d76a";
  if (rel > 50) return "#e8b93a";
  if (rel === 50) return "#cbbb92";
  if (rel >= 25) return "#c98a52";
  return "#e0705f";
}
// Marcas radiais nos limiares dos patamares. A direção sai do centro para o ponto:
// numa elipse não é a normal exata, mas em 2px de tela a diferença não aparece.
// O ápice (o neutro) ganha marca maior: é a referência de onde a relação partiu.
function favArcTicks() {
  return [[0.25, 2.6, "fa-tick"], [0.5, 4.2, "fa-tick fa-tick-mid"], [0.75, 2.6, "fa-tick"]].map(([tf, a, cls]) => {
    const [x, y] = favArcPt(tf);
    const dx = x - FAV_ARC.cx, dy = y - FAV_ARC.cy;
    const L = Math.hypot(dx, dy) || 1;
    const nx = dx / L, ny = dy / L;
    return `<line class="${cls}" x1="${(x - nx * a).toFixed(1)}" y1="${(y - ny * a).toFixed(1)}" x2="${(x + nx * a).toFixed(1)}" y2="${(y + ny * a).toFixed(1)}"/>`;
  }).join("");
}
function favPortrait(k, extra) {
  const rel = favRel(k);
  const [hx, hy] = favArcPt(rel / 100);
  // O traço aceso cresce do NEUTRO (ápice, 50) para o lado que a relação tomou. Enchendo
  // desde a ponta "−", como era, o trecho aceso ficava justamente sobre o sinal de menos
  // e dava a impressão de que a direita era o lado bom.
  // pathLength="100" faz o dasharray falar em porcentagem direto, sem eu medir o arco;
  // o dashoffset negativo empurra o início do traço para o ponto certo do caminho.
  const ini = Math.min(rel, 50), len = Math.abs(rel - 50);
  return `<div class="fav-arc${extra || ""}" style="--relcol:${favArcColor(rel)}">
    <svg viewBox="0 0 100 92" preserveAspectRatio="none" aria-hidden="true">
      <path class="fa-track" d="${FAV_ARC_D}" pathLength="100"/>
      <g class="fa-ticks">${favArcTicks()}</g>
      <path class="fa-fill" d="${FAV_ARC_D}" pathLength="100"
            stroke-dasharray="${len} 100" stroke-dashoffset="-${ini}"/>
      <path class="fa-feet" d="M 4 84.5 L 4 91.5 M 96 84.5 L 96 91.5"/>
    </svg>
    <span class="fav-arc-plus">+</span><span class="fav-arc-minus">−</span>
    <img class="fav-face" src="${FAV_CHARS[k].img}?v=1" alt="">
    <span class="fav-heart" style="left:${hx}%;top:${hy}%">🖤<i>❤</i></span>
  </div>`;
}
function favNameBlock(k) {
  const c = FAV_CHARS[k];
  return `<div class="fav-art">-${c.art}-</div><div class="fav-name">${c.name}</div><div class="fav-tier">${favTier(favRel(k), k)}</div>`;
}
function renderFavScr() {
  const scr = $("fav-scr");
  // fundo temático do personagem em foco (rei=vermelho, conde=cinza, povo=azul, rainha=rosa)
  const chr = (favView === "hub" || !favView) ? FAV_ORDER[favSel] : favView.chr;
  scr.classList.remove("fav-bg-rei", "fav-bg-rainha", "fav-bg-conde", "fav-bg-povo");
  scr.classList.add("fav-bg-" + chr);
  if (favView === "hub" || !favView) renderFavHub(scr);
  else renderFavEncounter(scr);
}
// Ícones do rodapé da relação. SVG inline em `currentColor` porque emoji colorido não
// obedece cor: a porta e o saco de moedas vinham com a paleta deles, brigando com o
// retrato e com o vermelho dos avisos de punição, que é o único vermelho legítimo ali.
const FAV_ECON_IC = {
  porta: `<path d="M2.7 1.5h6.6v9H2.7z"/><circle cx="7.9" cy="6.3" r=".6" fill="currentColor" stroke="none"/>`,
  preco: `<circle cx="6" cy="6" r="4.3"/><circle cx="6" cy="6" r="1.5"/>`,
  visita: `<path d="M3.1 8.7c.95-.75.95-1.6.95-3.05a1.95 1.95 0 0 1 3.9 0c0 1.45 0 2.3.95 3.05z"/><path d="M5 9.9a1.05 1.05 0 0 0 2 0"/>`,
  dadiva: `<path d="M6 1.4 7 4.9l3.6 1.1L7 7.1l-1 3.5-1-3.5L1.4 6 5 4.9z" fill="currentColor" stroke="none"/>`,
};
// O número sozinho é econômico, não telepático: o título devolve o significado no hover.
const FAV_ECON_T = {
  porta: "Chance de ser recebido",
  preco: "Preço dos pedidos",
  visita: "Chance de vir te visitar",
  dadiva: "Chance de o pedido sair de graça e render mais",
};
// Estado da relação, resumido ao osso no rodapé: ícone branco e o número. Sem ele os
// três efeitos (ser recebido, preço do pedido, chance de visita) ficariam invisíveis e
// o jogador sentiria o aperto sem entender de onde vem.
function favEconLine(k) {
  const rel = favRel(k);
  const atende = Math.round((1 - favBusyChance(k)) * 100);
  const mult = askCostMult(k);
  const visita = favVisitWeight(k);
  const n1 = v => String(Math.round(v * 10) / 10);   // 1, 2.5, 0.6: sem zero à direita
  const st = (ic, val, cls) =>
    `<span class="fe-s" title="${FAV_ECON_T[ic]}">`
    + `<svg class="fe-i" viewBox="0 0 12 12" aria-hidden="true">${FAV_ECON_IC[ic]}</svg>`
    + `<b${cls ? ` class="${cls}"` : ""}>${val}</b></span>`;
  const partes = [
    st("porta", `${atende}%`, atende >= 80 ? "" : atende >= 50 ? "warn" : "bad"),
    st("preco", `×${n1(mult)}`, mult > 1 ? "bad" : mult < 1 ? "good" : ""),
  ];
  if (visita < 1) partes.push(st("visita", `×${n1(visita)}`, "bad"));
  if (rel >= 100) partes.push(st("dadiva", `${Math.round(ASK_BOON_CHANCE * 100)}%`, "good"));
  return `<div class="fav-econ">${partes.join("")}</div>`;
}
function renderFavHub(scr) {
  const k = FAV_ORDER[favSel], c = FAV_CHARS[k];
  const prev = FAV_ORDER[(favSel + FAV_ORDER.length - 1) % FAV_ORDER.length];
  const next = FAV_ORDER[(favSel + 1) % FAV_ORDER.length];
  const punWarn = FAV_ORDER.filter(favPun).map(p => `${FAV_CHARS[p].punIc} ${FAV_CHARS[p].punDesc}`).join("<br>");
  // Você pode VISITAR qualquer aliança (desde o dia 1); é 1 interação por turno.
  // Mas se alguém VEIO até você (dia 7+), essa visita tem prioridade e trava as demais.
  const visitor = S.fav.visitor;
  const isVisitor = visitor === k;
  const open = favOpen(k);
  const interactable = favFreeVisits || (open && !S.fav.used && (!visitor || isVisitor));
  const actDisabled = interactable ? "" : "disabled";
  const actNote = favFreeVisits ? ""
    : S.fav.used ? `<div class="fav-used-note">Você já tratou com uma aliança neste turno. Volte no próximo.</div>`
    : visitor && !isVisitor ? `<div class="fav-used-note">Hoje ${FAV_CHARS[visitor].punIc} ${favShort(visitor)} veio até você, e só com ${favShort(visitor)} dá pra tratar hoje.</div>`
    : !open ? `<div class="fav-used-note">${favClosedNote(k)}</div>`
    : "";
  scr.innerHTML = `
    <div class="laws-top"><button class="tavola-round tavola-back" id="fav-back">‹</button><button class="tavola-round" id="fav-help-btn">?</button></div>
    <h2 class="tavola-title fav-title"><span class="tt-a">— AS —</span><span class="tt-main">ALIANÇAS</span></h2>
    <div id="fav-help" class="hidden"><b>As Alianças</b><p>Quatro figuras de Karzstak podem ajudar (ou atrapalhar) suas muralhas. Você pode <b>visitar</b> qualquer uma delas <b>desde o dia 1</b>: converse, peça algo ou presenteie, <b>1 vez por dia</b>, entre os turnos. A partir do <b>dia ${FAV_VISIT_MIN_DAY}</b>, uma delas também pode <b>vir até você</b>: ignorar quem veio custa relação com todos, e quem veio está sempre disponível, fora de horário ou não.</p><p><b>Expediente:</b> o Rei atende dia e noite · a Rainha só de <b>dia</b> · o Conde só à <b>noite</b> · o Povo tem <b>70%</b> de dia e <b>30%</b> à noite. Tentar fora de horário não gasta sua visita.</p><p>Cada escolha muda a <b>relação</b> (0–100%). Relação no chão = <b>punição ativa</b>; relação no máximo = <b>bênção ativa</b>. O que você descobre nas conversas fica lembrado para sempre, entre todas as partidas.</p><p><b>A relação inclina todo o trato:</b> quanto mais baixa, menor a chance de ser <b>recebido</b> (conversar e pedir podem dar com a porta na cara), mais <b>caro</b> fica cada pedido e menos esse personagem <b>aparece</b> na sua porta. Quanto mais alta, mais barato e mais fácil de ser recebido. No <b>máximo</b>, o pedido tem ${Math.round(ASK_BOON_CHANCE * 100)}% de sair de graça e render ${Math.round(ASK_BOON_BONUS * 100)}% a mais. <b>Presentear nunca é recusado</b>, em relação nenhuma: é sempre o caminho de volta.</p><button id="fav-dbg">debug: visitas infinitas ${favFreeVisits ? "✅" : "❌"}</button></div>
    <div class="fav-carousel">
      <button class="fav-card fav-side left" data-k="${prev}"><img src="${FAV_CHARS[prev].img}?v=1" alt=""><div class="fav-card-t">-${FAV_CHARS[prev].art}-<br>${FAV_CHARS[prev].name}</div></button>
      <div class="fav-card fav-main"><img src="${c.img}?v=1" alt=""><div class="fav-card-t">-${c.art}-<br><b>${c.name}</b><span>${c.sub}</span></div></div>
      <button class="fav-card fav-side right" data-k="${next}"><img src="${FAV_CHARS[next].img}?v=1" alt=""><div class="fav-card-t">-${FAV_CHARS[next].art}-<br>${FAV_CHARS[next].name}</div></button>
    </div>
    <div class="fav-tier-row"><button id="fav-prev" class="fav-tarrow">‹</button><span class="fav-tier">${favTier(favRel(k), k)} (${favRel(k)}%)</span><button id="fav-next" class="fav-tarrow">›</button></div>
    ${favPun(k) ? `<div class="fav-punish">${c.punIc} PUNIÇÃO ATIVA: ${c.punDesc}</div>` : favBless(k) ? `<div class="fav-bless">${c.punIc} BÊNÇÃO ATIVA: ${c.blessDesc}</div>` : ""}
    <div class="fav-actions${(!interactable) && !favFreeVisits ? " fav-used" : ""}">
      <button class="fav-abtn wide" data-act="talk" ${actDisabled}>🗣 CONVERSAR</button>
      <div class="fav-arow">
        <button class="fav-abtn" data-act="ask" ${actDisabled}>↙ PEDIR ALGO</button>
        <button class="fav-abtn" data-act="gift" ${actDisabled}>↗ PRESENTEAR</button>
      </div>
      ${actNote}
    </div>
    <div class="fav-foot">
      ${favEconLine(k)}
      <div class="fav-count">EVENTOS DESCOBERTOS: ${favEvSeen()}/${favEvTotal()}</div>
    </div>
    ${isVisitor && !S.fav.used && !favFreeVisits ? `<div class="fav-visit-banner">🔔 Está te visitando hoje</div>` : ""}
    ${punWarn && !favPun(k) ? `<div class="fav-pun-mini">${punWarn}</div>` : ""}`;
  $("fav-back").onclick = closeFavores;
  $("fav-help-btn").onclick = () => $("fav-help").classList.toggle("hidden");
  $("fav-dbg").onclick = () => { favFreeVisits = !favFreeVisits; toast(`🐞 Visitas infinitas ${favFreeVisits ? "ativadas" : "desativadas"}.`); renderFavScr(); $("fav-help").classList.remove("hidden"); };
  const go = (d) => { favSel = (favSel + d + FAV_ORDER.length) % FAV_ORDER.length; renderFavScr(); };
  $("fav-prev").onclick = () => go(-1);
  $("fav-next").onclick = () => go(1);
  scr.querySelectorAll(".fav-side").forEach(b => b.onclick = () => { favSel = FAV_ORDER.indexOf(b.dataset.k); renderFavScr(); });
  scr.querySelectorAll(".fav-abtn").forEach(b => b.onclick = () => favTryAction(k, b.dataset.act));
  // swipe no carrossel: arrastar pro lado troca o personagem
  const car = scr.querySelector(".fav-carousel");
  let swX = null;
  car.onpointerdown = (e) => { swX = e.clientX; car.setPointerCapture(e.pointerId); };
  car.onpointerup = (e) => {
    if (swX == null) return;
    const dx = e.clientX - swX; swX = null;
    if (dx > 40) go(-1); else if (dx < -40) go(1);
  };
  car.onpointercancel = () => { swX = null; };
}
function renderFavEncounter(scr) {
  const v = favView, k = v.chr, c = FAV_CHARS[k];
  let intro, quote, footer, choices = "";
  const evCountLbl = `EVENTO ${c.name.split(" ")[0]}`;
  if (v.mode === "busy") {
    intro = `Você procura ${c.art.toLowerCase()} ${c.name.toLowerCase()} por toda parte...`;
    quote = "Agora não. Volte outra hora.";
    footer = "OCUPADO · SUA VISITA DE HOJE FOI GASTA";
    choices = `<button class="fav-choice fav-ok" id="fav-done">Entendido...</button>`;
  } else if (v.mode === "talk") {
    intro = v.ev.s;
    // Depois de responder, a MESMA linha passa a mostrar a réplica do personagem à
    // escolha feita (`r` na escolha). Antes a pergunta ficava congelada na tela junto
    // com o resultado numérico, então a conversa não tinha fechamento: o personagem
    // perguntava, o jogador escolhia e ninguém respondia.
    const rep = v.pick != null && v.ev.c[v.pick] ? v.ev.c[v.pick].r : null;
    quote = v.done && rep ? rep : v.ev.q;
    // Agora o número é o DESTE evento, na lista deste personagem, a partir de 1.
    footer = `${evCountLbl}<br>${favEvNum(k, v.ev.id)}/${FAV_EVENTS[k].length}`;
    choices = v.ev.c.map((ch, i) => {
      const key = `${k}:${v.ev.id}:${i}`;
      const known = !!FAVMETA.found[key];
      const fx = known ? favFxText(ch.e) : `<span class="fav-undisc">(+?) NÃO DESCOBERTO.</span>`;
      const badge = known ? (ch.rel >= 0 ? "➕" : "➖") : "❓";
      return `<button class="fav-choice" data-i="${i}">${ch.t} ${fx}<span class="fav-badge">${badge}</span></button>`;
    }).join("");
  } else if (v.mode === "ask") {
    intro = c.askIntro; quote = c.askQuote;
    // O multiplicador aparece no rodapé: sem isso o jogador vê o preço subir e não tem
    // como saber que foi a relação que encareceu, e a punição fica parecendo bug.
    const mult = askCostMult(k);
    const tom = mult > 1.02 ? ` · <span style="color:#e05f5f">PREÇO ×${mult.toFixed(2)} PELA RELAÇÃO</span>`
      : mult < 0.98 ? ` · <span style="color:#8fdc7a">DESCONTO ×${mult.toFixed(2)} PELA RELAÇÃO</span>` : "";
    footer = `PEDIR UM FAVOR · O PEDIDO CUSTA RELAÇÃO${tom}`;
    choices = c.asks.map((a, i) => {
      const cost = askCost(k, i);
      const base = a.rel;
      const risco = cost > base ? ` <s>−${base}%</s>` : "";
      return `<button class="fav-choice fav-dark" data-i="${i}">➖ ${a.t} ${favFxText(a.e)}<span class="fav-relcost">${cost ? `−${cost}% relação${risco}` : "de graça!"}</span></button>`;
    }).join("");
  } else { // gift
    intro = c.giftIntro; quote = c.giftQuote;
    footer = "PRESENTEAR · +6% DE RELAÇÃO";
    choices = c.gifts.map((g, i) => {
      const [rk, rv] = Object.entries(g.cost)[0];
      const meta = giftCostMeta(rk);
      const have = giftCostHave(rk);
      const ok = have >= rv;
      return `<button class="fav-choice fav-dark" data-i="${i}" ${ok ? "" : "disabled"}>➕ ${g.t} <span style="color:#e05f5f">(−${rv} ${meta.n})</span><span class="fav-relcost">${ok ? "+6% relação" : "recursos insuficientes"}</span></button>`;
    }).join("");
  }
  // Conversa não tem volta: precisa responder. Pedir/presentear oferecem "Deixa Pra Lá".
  const canCancel = !v.done && (v.mode === "ask" || v.mode === "gift");
  scr.innerHTML = `
    <div class="fav-enc">
      <div class="fav-stars">***</div>
      <div class="fav-intro">${intro}</div>
      ${favPortrait(k)}
      ${favNameBlock(k)}
      <div class="fav-quote">“ ${quote} ”</div>
      <div class="fav-choices">${choices}</div>
      ${canCancel ? `<button class="fav-choice fav-ok" id="fav-cancel">Deixa Pra Lá</button>` : ""}
      ${v.done ? `<div class="fav-result">${v.done}</div><button class="fav-choice fav-ok" id="fav-done">Continuar</button>` : ""}
      <div class="fav-count">${footer}</div>
    </div>`;
  const cancel = $("fav-cancel");
  if (cancel) cancel.onclick = () => { favView = "hub"; renderFavScr(); };
  const done = $("fav-done");
  if (done) done.onclick = () => { favView = "hub"; renderFavScr(); };
  if (v.done) { scr.querySelectorAll(".fav-choice[data-i]").forEach(b => b.disabled = true); return; }
  scr.querySelectorAll(".fav-choice[data-i]").forEach(b => b.onclick = () => favChoose(k, +b.dataset.i));
}
function favChoose(k, i) {
  const v = favView;
  favSpend(k);
  let msg;
  if (v.mode === "talk") {
    const ch = v.ev.c[i];
    v.pick = i;               // o render usa isto para achar a réplica desta escolha
    favApplyFx(ch.e);
    favGainRel(k, ch.rel);
    S.fav.last[k] = v.ev.id;
    const key = `${k}:${v.ev.id}:${i}`;
    if (!FAVMETA.found[key]) { FAVMETA.found[key] = true; }
    // evCount não aparece mais no rodapé (virou "eventos distintos"), mas segue somando:
    // é o total de conversas da vida do jogador e já está gravado no localStorage de quem
    // joga há tempo. Apagar o incremento jogaria esse histórico fora.
    FAVMETA.evCount++; saveFavMeta();
    msg = `${favFxText(ch.e)} · relação ${ch.rel >= 0 ? "+" : ""}${ch.rel}%`;
  } else if (v.mode === "ask") {
    const a = FAV_CHARS[k].asks[i];
    // Dádiva: só com a relação no máximo. Sorteada no CLIQUE, não mostrada no botão,
    // porque a graça é a surpresa; o botão já avisa o preço normal.
    const boon = favRel(k) >= 100 && Math.random() < ASK_BOON_CHANCE;
    const cost = boon ? 0 : askCost(k, i);
    const fx = boon ? scaleFx(a.e, 1 + ASK_BOON_BONUS) : a.e;
    favApplyFx(fx);
    favGainRel(k, -cost);
    msg = boon
      ? `<span style="color:#f4d76a">✨ DÁDIVA: ${favShort(k)} não cobrou nada e mandou mais.</span><br>${favFxText(fx)} · relação −0%`
      : `${favFxText(fx)} · relação −${cost}%`;
    if (favPun(k)) msg += `<br><span style="color:#e05f5f">${FAV_CHARS[k].punIc} A relação chegou ao fundo: ${FAV_CHARS[k].punDesc}</span>`;
  } else { // gift
    const g = FAV_CHARS[k].gifts[i];
    const [rk, rv] = Object.entries(g.cost)[0];
    // Mesmo furo do lado do desenho: sem o caso de 💎 isto fazia `S.res.hearts -= 3`
    // com S.res.hearts inexistente, ou seja, gravava NaN no save em vez de cobrar.
    if (rk === "gold") S.gold -= rv;
    else if (rk === "hearts") S.hearts -= rv;
    else if (rk === "maos") S.maos -= rv;
    else S.res[rk] = (S.res[rk] || 0) - rv;
    favGainRel(k, 6);
    msg = `Presente entregue · relação +6%`;
  }
  saveGame();
  v.done = msg;
  renderFavScr();
}
// Ao amanhecer: libera a visita do dia, avisa punições/bênçãos e o Conde repara
// Uma visita por dia. Com os turnos travados no automático o comandante nunca
// desce da muralha: não há visita (e, portanto, nada a ignorar).
const FAV_IGNORE_REL = 5;   // relação perdida com TODOS ao ignorar a visita do dia
// `visitDay !== S.day`: a visita ainda não foi resolvida hoje, nem atendida nem ignorada.
// A cobrança é UMA por dia mesmo com dois turnos, senão virar as costas custaria o dobro.
function favVisitPending() { return !!S.fav && !!S.fav.visitor && S.fav.visitDay !== S.day && !S.fav.used && !S.autoTurn; }
// o comandante virou as costas para a corte: todos sentem
function favIgnoreVisit() {
  if (!favVisitPending()) return;
  S.fav.used = true;
  S.fav.visitDay = S.day;   // resolvida (mal) por hoje: não cobra de novo no outro turno
  for (const k of FAV_ORDER) favGainRel(k, -FAV_IGNORE_REL);
  toast(`🚪 Visita ignorada: −${FAV_IGNORE_REL}% de relação com todos.`);
  saveGame();
  renderHUD();
}
// sorteia quem vem até você hoje (a partir do dia 7), sem repetir o visitante anterior
function favPickVisitor() {
  if (S.day < FAV_VISIT_MIN_DAY) return null;
  const pool = FAV_ORDER.filter(k => k !== S.fav.visitor);
  if (!pool.length) return null;
  const w = pool.map(favVisitWeight);
  const total = w.reduce((a, b) => a + b, 0);
  // Com a corte inteira te odiando, simplesmente ninguém bate na sua porta: a chance de
  // HAVER visita é a média dos pesos. Sem este passo o sorteio só decidiria QUEM vem, e
  // relação no chão continuaria rendendo uma visita por dia como se nada tivesse mudado.
  if (Math.random() > total / pool.length) return null;
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}
function favNewDay() {
  // O `used` já foi zerado pelo favNewTurn deste amanhecer: a visita é por turno.
  // O VISITANTE continua sendo do dia: quem veio à muralha fica lá o dia inteiro.
  S.fav.visitor = favPickVisitor(); // UM visitante que vem até você (null antes do dia 7)
  for (const k of FAV_ORDER) {
    if (favPun(k)) toast(`${FAV_CHARS[k].punIc} ${FAV_CHARS[k].punDesc}`);
    else if (favBless(k)) toast(`${FAV_CHARS[k].punIc} ${FAV_CHARS[k].blessDesc}`);
  }
  if (S.fav.visitor) toast(`${FAV_CHARS[S.fav.visitor].punIc} ${favShort(S.fav.visitor)} veio visitar as muralhas.`);
  if (favBless("conde") && S.hits < maxHits()) { S.hits++; addFloat(2, 0.52, "🐀 Os ratos remendaram as muralhas: +1 🧱", "#eecd5c"); }
}
// Efeitos por turno das punições/bênçãos (Rei / Conde). Rainha e Povo são multiplicadores.
function favPunishTick() {
  if (favPun("rei")) { gainMorale(-6); addFloat(2, 0.45, "👑 O Rei retirou o apoio: −6 moral", "#e0705f"); }
  else if (favBless("rei")) { gainMorale(3); addFloat(2, 0.45, "👑 O Rei exalta seu nome: +3 moral", "#eecd5c"); }
  if (favPun("conde")) { S.hits = Math.max(1, S.hits - 1); addFloat(2, 0.52, "🐀 Os ratos roem as muralhas: −1 🧱", "#e0705f"); }
}

// ---------- SEU DISTRITO (resumo da run) ----------
// Brasão do distrito: clicar circula por combinações de emoji + cor (persiste em META).
// 12 emojis × 7 cores (coprimos) → 84 combos únicos ao girar o índice.
const BRASAO_EMOJIS = ["🛡️", "⚔️", "🏰", "🐺", "🦅", "🔥", "🌙", "☀️", "💀", "👑", "🗡️", "⭐"];
const BRASAO_COLORS = ["#c0392b", "#2f6fd6", "#e8b93a", "#d6608f", "#a86ae0", "#4cae6a", "#3a3f4a"];
function getBrasao() {
  const i = META.brasao || 0;
  return { emoji: BRASAO_EMOJIS[i % BRASAO_EMOJIS.length], color: BRASAO_COLORS[i % BRASAO_COLORS.length] };
}
function cycleBrasao() {
  META.brasao = ((META.brasao || 0) + 1) % (BRASAO_EMOJIS.length * BRASAO_COLORS.length);
  saveMeta(META);
  renderHudBrasao(); // o brasão do HUD acompanha a troca feita em "Seu Setor"
}
// Brasão no HUD: atalho para "Seu Setor", ao lado do HP
function renderHudBrasao() {
  const el = $("hud-brasao");
  if (!el) return;
  const br = getBrasao();
  el.textContent = br.emoji;
  el.style.background = br.color;
}
// Nº de setor: aleatório por run (7.000–15.000), formatado com ponto de milhar
function randomSectorId() { return 7000 + Math.floor(Math.random() * 8001); }
function formatSectorId(n) { return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
// Ponto cardeal do setor: sorteado por run junto do número
const SECTOR_DIRS = ["Norte", "Nordeste", "Leste", "Sudeste", "Sul", "Sudoeste", "Oeste"];
function randomSectorDir() { return SECTOR_DIRS[Math.floor(Math.random() * SECTOR_DIRS.length)]; }

// Resumo de recursos dos dois campos, em uma linha: Cidade (🪙💎✋) + Feudo (recursos brutos).
// Fica fora do openDistrict porque o loop reusa isso para manter a linha ao vivo.
function distResHTML() {
  // "Seu Setor" marca a dívida igual à barra: as duas leem o mesmo estado, e um
  // saldo negativo em vermelho só na barra faria o jogador duvidar de qual vale.
  const n = (v, txt) => `<span class="dr-v${v < 0 ? " neg" : ""}">${txt}</span>`;
  const cidade = `🪙 ${n(S.gold, Math.trunc(S.gold))}&nbsp;💎 ${n(S.hearts, Math.trunc(S.hearts))}`
    + `&nbsp;✋ ${n(S.maos, `${Math.trunc(S.maos)}/${maosCap()}`)}`;
  const feudo = Object.entries(RESOURCES)
    .map(([k, r]) => `${r.icon}&nbsp;${n(S.res[k] || 0, Math.trunc(S.res[k] || 0))}`).join("&nbsp;");
  return `${cidade}&nbsp;&nbsp;${feudo}`;
}

function openDistrict() {
  openModal("", (m) => {
    $("modal").classList.add("dist-modal");
    const tier = moraleTier(S.morale);
    const moralName = S.morale === 0 ? "Indiferentes" : moraleName(tier); // 50% exato = Indiferentes
    const f = curFaction();
    // párias (Roxos/Verdes) não têm uma oposição: são odiados por todas
    const opp = f && RIVAL[f] ? FACTIONS[RIVAL[f]] : null;
    const cid = META.counselor, cc = cid && COUNCILORS[cid];
    const turns = Math.max(0, (S.day - 1) * 2 + (S.isNight ? 1 : 0));
    const br = getBrasao();
    const pos = Math.max(0, Math.min(100, Math.round((S.morale + 150) / 3)));
    const wrap = document.createElement("div");
    wrap.className = "dist";
    wrap.innerHTML = `
      <div class="dist-moral">MORAL: ${moralName.toUpperCase()}</div>
      <div class="dist-bar">
        <img class="db-cap" src="MEDIDOR-MEDO.png?v=1" alt="">
        <div class="dist-track"><span class="dist-mark" style="left:${pos}%"></span></div>
        <img class="db-cap" src="MEDIDOR-ESPERANÇA.png?v=1" alt="">
      </div>
      <div class="dist-id">
        <button class="dist-brasao" id="dist-brasao" style="background:${br.color}" title="Trocar brasão">
          <span class="dist-brasao-e">${br.emoji}</span><span class="dist-pencil">✎</span>
        </button>
        <div class="dist-stats">
          <div class="dist-resist">VOCÊ RESISTIU: <b>${Math.max(0, S.day - 1)} DIAS</b></div>
          <div class="dist-stat"><span class="ds-dot gold"></span>TURNOS: ${turns}</div>
          <div class="dist-stat"><span class="ds-dot"></span>LUAS VERMELHAS: ${S.redMoons}</div>
          <div class="dist-stat"><span class="ds-dot"></span>SÓIS NEGROS: ${S.blackSuns || 0}</div>
        </div>
      </div>
      <div class="dist-sector">SETOR <b>${formatSectorId(S.sectorId)}</b> DE KARZSTAK · <b>${(S.sectorDir || "").toUpperCase()}</b></div>
      <div class="dist-div"></div>
      <div class="dist-line"><span class="dl-k">IDEOLOGIA:</span> <span class="dl-v" style="color:${f ? FACTIONS[f].color : "#9b8f77"}">${f ? FACTIONS[f].name.toUpperCase() : "NENHUMA"}</span></div>
      ${f ? `<div class="dist-sub">${FACTIONS[f].desc}</div>` : ""}
      <div class="dist-line"><span class="dl-k">OPOSIÇÃO:</span> <span class="dl-v" style="color:${opp ? opp.color : "#9b8f77"}">${opp ? opp.name.toUpperCase() : f ? "TODAS" : "—"}</span></div>
      ${f ? `<div class="dist-sub">${opp ? DEBUFF_BY_CHOICE[f] : "sofre todas as penalidades"}</div>` : ""}
      <div class="dist-line"><span class="dl-k">TÁVOLA:</span> <span class="dl-v gold">${cc ? cc.name.toUpperCase() : "NENHUM"}</span></div>
      ${cc ? `<div class="dl-cost">💎 ${councilCost(cid)} Cristais por uso</div>` : ""}
      ${cc ? `<div class="dist-sub">${cc.desc}</div>` : `<div class="dist-sub">Jure um Lorde na Távola (menu inicial).</div>`}
      <div class="dist-div"></div>
      <div class="dist-chron-h">Crônicas do Setor</div>
      <div class="dist-chron"></div>
      <div class="dist-div"></div>
      <div class="dist-line dist-res"><span class="dl-v dr-line">${distResHTML()}</span></div>`;
    m.appendChild(wrap);
    // "clique fora para sair" fica FORA do modal, sobre o fundo escurecido
    const modal = $("modal");
    modal.querySelector(".modal-foot")?.remove();
    const foot = document.createElement("div");
    foot.className = "modal-foot";
    foot.textContent = "CLIQUE FORA PARA SAIR";
    modal.appendChild(foot);
    wrap.querySelector("#dist-brasao").onclick = () => { cycleBrasao(); openDistrict(); };
    const chron = wrap.querySelector(".dist-chron");
    if (!S.eventLog.length) {
      chron.innerHTML = `<div class="dist-none">Nenhum evento registrado ainda.</div>`;
    } else {
      for (const e of S.eventLog.slice().reverse()) {
        const today = e.day === S.day;
        const color = e.ty === "pos" ? "#6fbf5f" : e.ty === "neg" ? "#e05f5f" : "#e8b93a";
        const row = document.createElement("div");
        row.className = "dist-ev" + (today ? " today" : "");
        row.innerHTML = `<span class="de-ic" style="background:${color}"></span>
          <div class="de-body"><div class="de-t">${today ? "HOJE - " : ""}Dia ${e.day}: ${e.t}</div>${e.fx ? `<div class="de-fx">${e.fx}</div>` : ""}</div>`;
        chron.appendChild(row);
      }
    }
  });
}

// ---------- Munições ----------
const AMMO = {
  virotes:    { icon: "🏹", name: "virotes" },
  pedras:     { icon: "🪨", name: "projéteis" },
  oleo:       { icon: "🛢️", name: "óleo" },
  essencia:   { icon: "✨", name: "essência" },
  condutores: { icon: "⚡", name: "condutores" },
  quimicos:   { icon: "🧪", name: "químicos" },
};

// ---------- Assets do campo (astro dia/noite) ----------
const ASTRO_IMG = { day: new Image(), night: new Image() };
ASTRO_IMG.day.src = "ICONE-DIA.png?v=1";
ASTRO_IMG.night.src = "ICONE-NOITE.png?v=2";

// ---------- Holofote e Moedor de Plebe ----------
// HOLOFOTE: não fere ninguém. Acende UMA lane e tudo que atira ali bate mais forte, crita
// mais e acerta mais rápido. Demora SPOT_MOVE_SEC para mudar de foco, então escolher a
// lane certa é uma decisão, não um reflexo — é o preço de um suporte tão forte.
const SPOT_MOVE_SEC = 8;     // tempo parado antes de poder varrer para outra lane
const SPOT_DMG = 0.3;        // +30% de dano na lane acesa
const SPOT_CRIT = 0.15;      // +15 pontos percentuais de crítico
const SPOT_SPEED = 0.75;     // projéteis viajam mais rápido: menos tiro desperdiçado
let litLanes = new Set();    // recalculado a cada update, a partir dos holofotes vivos
// MOEDOR DE PLEBE: mói uma tropa a cada GRIND_EVERY segundos e o sangue anima o resto.
// Não consome munição — consome VIDAS, que custaram ouro no Portão. Expira no fim do turno.
const GRIND_EVERY = 30, GRIND_DUR = 25, GRIND_MULT = 0.5;

// ---------- Estoque de Munições ----------
// Não atira. Fica na muralha entre duas torres e resolve o problema da esteira: o
// abastecimento chega de DEPOT_FEED_SEC em DEPOT_FEED_SEC contra os ~4,2s do ciclo de
// caixas, então a vizinha de um Estoque quase nunca fica seca no meio de uma horda.
// A capacidade é um BOLO ÚNICO dividido por até DEPOT_TYPES tipos: guardar três
// munições diferentes não dá mais espaço, só reparte o mesmo espaço em três.
const DEPOT_CAP_BASE = 30;      // munição guardada, somando todos os tipos
const DEPOT_CAP_MAX = 50;       // teto absoluto, mesmo com o caminho de armazém no fim
const DEPOT_TYPES = 3;          // tipos diferentes que cabem ao mesmo tempo
const DEPOT_FEED_SEC = 1.2;     // intervalo entre empurrões para as vizinhas
const DEPOT_FEED = 4;           // munição entregue por empurrão, por vizinha e por tipo
// Suportes leves das vizinhas: recarregam mais rápido e desperdiçam menos munição.
// São pequenos de propósito — o valor do Estoque é a logística, não o buff.
const DEPOT_RATE = 0.12;        // +12% de cadência
const DEPOT_SAVE = 0.10;        // 10% de chance de o tiro não gastar munição
let depotTimer = 0;             // relógio do empurrão (vive fora de S: é ritmo, não estado)

// ---------- Torres — 3 categorias (Básicas 1 munição / Avançadas 2 / Icônicas 3) ----------
// Cada torre exige TODAS as munições de `ammos` (estoque por tipo). Força ∝ categoria; custo em ouro 1×/2×/3×.
const TOWER_TYPES = {
  // ===== BÁSICAS (custo 1×, 1 munição) — sempre disponíveis =====
  // `loaded`: nasce com a munição cheia. Só a Besta tem isso. É a primeira torre que
  // todo mundo ergue, e descobrir a logística de munição com a horda já em campo é o
  // tropeço número um de quem começa. A partir do segundo turno ela se alimenta como
  // qualquer outra, então o empurrão não acompanha a run.
  besta:       { name: "Besta",              tier: "basic", icon: "🏹", cost: 20, dmg: 6,  rate: 1.6, range: 999,  aoe: 0,   ptime: 0.7,  ammos: ["virotes"], loaded: true },
  catapulta:   { name: "Catapulta",          tier: "basic", icon: "🪨", cost: 35, dmg: 14, rate: 3.4, range: 999,  aoe: 1,   ptime: 1.2,  ammos: ["pedras"] },
  caldeirao:   { name: "Caldeirão",          tier: "basic", icon: "🍲", cost: 30, dmg: 22, rate: 2.6, range: 0.35, aoe: 0.6, ptime: 0.45, ammos: ["oleo"] },
  tesla:       { name: "Torre Tesla",        tier: "basic", icon: "⚡", cost: 45, dmg: 7,  rate: 2.8, range: 999,  aoe: 0,   ptime: 0.25, ammos: ["condutores"], chain: 3 },
  canalizador: { name: "Filtro Mágico",      tier: "basic", icon: "🔮", cost: 40, dmg: 12, rate: 2.2, range: 999,  aoe: 0,   ptime: 0.6,  ammos: ["essencia"], magic: true },
  acido:       { name: "Chuveiro Ácido",     tier: "basic", icon: "🚿", cost: 35, dmg: 10, rate: 2.0, range: 999,  aoe: 0.5, ptime: 0.5,  ammos: ["quimicos"] },
  holofote:    { name: "Holofote",           tier: "basic", icon: "🔦", cost: 40, dmg: 0,  rate: 1.0, range: 999,  aoe: 0,   ptime: 0.3,  ammos: ["condutores"], support: "spot" },
  // ===== AVANÇADAS (custo 2×, 2 munições) — desbloqueáveis =====
  balista:     { name: "Balista Pesada",     tier: "adv", icon: "🏰", cost: 45, dmg: 22, rate: 2.6, range: 999,  aoe: 0,   ptime: 0.7,  ammos: ["virotes", "oleo"],     locked: true, medalCost: 15 },
  canhao:      { name: "Canhão de Ferro",    tier: "adv", icon: "💣", cost: 60, dmg: 30, rate: 3.6, range: 999,  aoe: 1.2, ptime: 1.1,  ammos: ["pedras", "oleo"],      locked: true, medalCost: 20 },
  cospefogo:   { name: "Cospe-Fogo",         tier: "adv", icon: "🔥", cost: 55, dmg: 34, rate: 2.2, range: 0.4,  aoe: 0.7, ptime: 0.4,  ammos: ["oleo", "virotes"],     locked: true, medalCost: 20 },
  soprador:    { name: "Soprador Invernal",  tier: "adv", icon: "🌬️", cost: 55, dmg: 12, rate: 2.4, range: 999,  aoe: 0.6, ptime: 0.4,  ammos: ["quimicos", "condutores"], slow: 0.5, locked: true, medalCost: 25 },
  prisma:      { name: "Prisma Arcano",      tier: "adv", icon: "💠", cost: 55, dmg: 16, rate: 2.0, range: 999,  aoe: 0,   ptime: 0.6,  ammos: ["essencia", "pedras"],  magic: true, chain: 2, locked: true, medalCost: 30 },
  lancaacido:  { name: "Lança-Ácido",        tier: "adv", icon: "☣️", cost: 55, dmg: 20, rate: 2.2, range: 999,  aoe: 0.5, ptime: 0.5,  ammos: ["oleo", "quimicos"],    locked: true, medalCost: 25 },
  aquatico:    { name: "Cortador Aquático",  tier: "adv", icon: "💧", cost: 55, dmg: 30, rate: 2.0, range: 0.4,  aoe: 0.5, ptime: 0.3,  ammos: ["essencia", "condutores"], locked: true, medalCost: 25 },
  // Caçadores: pierce 9 + bumerangue varre a lane na ida e na volta, então ela valia
  // muito mais que as outras avançadas pelo mesmo preço. Custo 55 -> 70 (a mais caras
  // das avançadas) e cadência 2,4 -> 2,8s, que é ~14% menos tiro por segundo.
  cacadores:   { name: "Torre dos Caçadores",tier: "adv", icon: "🪃", cost: 70, dmg: 16, rate: 2.8, range: 999,  aoe: 0,   ptime: 0.5,  ammos: ["virotes", "quimicos"], pierce: 9, boomerang: true, locked: true, medalCost: 25 },
  serras:      { name: "Lançador de Serras", tier: "adv", icon: "🪚", cost: 60, dmg: 45, rate: 4.6, range: 999,  aoe: 0,   ptime: 0.6,  ammos: ["pedras", "virotes"], pierce: 99, locked: true, medalCost: 30 },
  escolamagos: { name: "Escola de Magos",    tier: "adv", icon: "🎓", cost: 55, dmg: 0,  rate: 2.8, range: 999,  aoe: 0,   ptime: 0.4,  ammos: ["essencia", "quimicos"], support: "mage", locked: true, medalCost: 30 },
  propaganda:  { name: "Máquina de Propaganda", tier: "adv", icon: "📢", cost: 55, dmg: 0, rate: 3.2, range: 999, aoe: 0,   ptime: 0.4,  ammos: ["condutores", "essencia"], support: "charm", locked: true, medalCost: 30 },
  moedor:      { name: "Moedor de Plebe",    tier: "adv", icon: "⚙️", cost: 60, dmg: 0,  rate: GRIND_EVERY, range: 999, aoe: 0, ptime: 0.4, ammos: [], support: "grind", locked: true, medalCost: 30 },
  estoque:     { name: "Estoque de Munições", tier: "adv", icon: "🗃️", cost: 50, dmg: 0, rate: 2.0, range: 999, aoe: 0, ptime: 0.4, ammos: [], support: "depot", locked: true, medalCost: 25 },
  // ===== ICÔNICAS (custo 3×, 3 munições) — desbloqueáveis =====
  mortenegra:  { name: "Morte Negra",        tier: "legend", icon: "💀", cost: 100, dmg: 45, rate: 2.4, range: 999, aoe: 0.8, ptime: 0.6, ammos: ["virotes", "quimicos", "essencia"], magic: true, locked: true, medalCost: 40 },
  apagador:    { name: "Apagador",           tier: "legend", icon: "🕳️", cost: 110, dmg: 60, rate: 3.4, range: 999, aoe: 1.5, ptime: 1.0, ammos: ["pedras", "oleo", "quimicos"], locked: true, medalCost: 45 },
  raiosolar:   { name: "Canalizador Solar",  tier: "legend", icon: "🌞", cost: 100, dmg: 40, rate: 1.8, range: 999, aoe: 0,   ptime: 0.4, ammos: ["condutores", "essencia", "oleo"], magic: true, chain: 3, locked: true, medalCost: 45 },
  midas:       { name: "Loucura de Midas",   tier: "legend", icon: "🤑", cost: 110, dmg: 55, rate: 2.6, range: 999, aoe: 0.6, ptime: 0.6, ammos: [], fuel: { k: "gold", cost: 1 }, locked: true, medalCost: 45 },
  baladeira:   { name: "Baladeira Mágica",   tier: "legend", icon: "💫", cost: 100, dmg: 50, rate: 2.2, range: 999, aoe: 0,   ptime: 0.5, ammos: [], fuel: { k: "hearts", cost: 1 }, magic: true, chain: 2, locked: true, medalCost: 45 },
  trabuco:     { name: "Trabuco de Lixo",    tier: "legend", icon: "🗑️", cost: 100, dmg: 40, rate: 3.4, range: 999, aoe: 1.2, ptime: 1.1, ammos: [], fuel: { k: "res", cost: 5 }, locked: true, medalCost: 45 },
  prisioneiros:{ name: "Catapulta de Prisioneiros", tier: "legend", icon: "⛓️", cost: 110, dmg: 65, rate: 3.6, range: 999, aoe: 1.4, ptime: 1.2, ammos: [], fuel: { k: "maos", cost: 1 }, locked: true, medalCost: 50 },
  ritualcura:  { name: "Ritual de Cura",     tier: "legend", icon: "💚", cost: 90,  dmg: 0,  rate: 2.5, range: 999, aoe: 0,   ptime: 0.4, ammos: ["essencia", "quimicos", "condutores"], support: "heal", locked: true, medalCost: 40 },
  infusor:     { name: "Infusor Arcano",     tier: "legend", icon: "🧿", cost: 90,  dmg: 0,  rate: 2.5, range: 999, aoe: 0,   ptime: 0.4, ammos: ["essencia", "pedras", "condutores"], support: "buff", locked: true, medalCost: 40 },
};
const TIER_META = { basic: "Básicas", adv: "Avançadas", legend: "Icônicas" };
const TIER_LABEL = { basic: "Básica", adv: "Avançada", legend: "Icônica" }; // singular (painel da torre)
// Lore mais longa (≈2 linhas) para o painel da torre. A ARS_LORE curta segue nos cards do Arsenal.
const TOWER_LORE = {
  holofote:    "Uma lente de Argamato montada sobre engrenagens pesadas. Onde o facho cai, o vigia enxerga a emenda da armadura, e o tiro seguinte encontra ela.",
  moedor:      "A engrenagem come um soldado e devolve coragem para os outros. Ninguem pergunta de onde vem o cheiro, e a fila continua se formando.",
  estoque:     "Um galpão de madeira encostado no parapeito, cheio até o teto de caixotes. Não mata ninguém, mas as torres ao lado nunca param para esperar a esteira.",
  besta:       "A primeira arma erguida nas ameias de Karzstak. Cada virote leva gravado o nome de um vigia que tombou nas muralhas.",
  catapulta:   "Madeira velha, contrapeso e ódio acumulado. Arremessa pedregulhos sobre a horda desde o primeiro cerco desta cidade.",
  caldeirao:   "Óleo fervente despejado do alto dos portões. A sopa que ninguém quer provar borbulha dia e noite à espera da carne fria.",
  tesla:       "Presente das oficinas a vapor da cidade baixa. Relâmpago engarrafado em bobinas de cobre que salta de morto em morto.",
  canalizador: "Um pilar de runas alimentado por um fio do Turbilhão Narxis. Destila a magia bruta em raios que ignoram carne e selo.",
  acido:       "Os alquimistas juram que a chuva verde não corrói as muralhas. Mentem. Contra os mortos, porém, ela dissolve tudo que se move.",
  balista:     "Virotes do tamanho de lanças, untados em óleo do reino. Atravessam três cadáveres e ainda acendem o quarto no caminho.",
  canhao:      "Pólvora e ferro fundido nas velhas forjas reais. O rugido que responde ao rugido da horda, calando lanes inteiras.",
  cospefogo:   "Construído sobre a boca de uma antiga forja. O fogo aqui nunca dorme, apenas espera a próxima leva de carne seca.",
  soprador:    "Sopro do inverno preso em tubos de bronze. Congela a marcha dos que não sentem frio, prendendo-os como estátuas de gelo.",
  prisma:      "Lapidado de um único Coração de Argamato. Parte a luz em feixes que também partem os mortos em cacos brilhantes.",
  lancaacido:  "A resposta dos engenheiros à carne que não teme lâminas. Um jato pressurizado que corrói osso, tendão e feitiço.",
  aquatico:    "Água canalizada a uma pressão impossível, afiada como aço. Corta fileiras inteiras antes que a lane sequer perceba.",
  cacadores:   "Os últimos batedores das florestas mortas montam guarda. Suas lâminas curvas sempre voltam, às vezes com mais de uma cabeça.",
  serras:      "Discos dentados arrancados de serrarias abandonadas. Giram pela lane inteira sem nunca perder o fio nem a fome por carne.",
  escolamagos: "Os últimos eruditos de Karzstak dão aula sob cerco. Rompem os selos dos mortos e sussurram força aos vivos nas muralhas.",
  propaganda:  "Alto-falantes de latão que cospem promessas antigas. Às vezes um morto escuta, hesita, e vira a lâmina contra os seus.",
  mortenegra:  "Dizem que o próprio rei negativo recua quando este sino dobra. A peste que ele espalha não distingue morto de morto.",
  apagador:    "Onde ele dispara, o cronista escreve só uma linha: 'não sobrou nada'. Nem pó, nem nome, nem lembrança de quem marchava ali.",
  raiosolar:   "Relíquia da Igreja do Amanhecer, guardada por gerações. Um pedaço aprisionado do sol que odeia a noite e o que rasteja nela.",
  midas:       "O tesouro do reino refundido em arma. Cada disparo custa uma fortuna, e cada morto tombado devolve um pouco do brilho.",
  baladeira:   "Um estilingue abençoado que arremessa cristais vivos. Ricocheteiam entre os mortos como uma prece que nunca erra o alvo.",
  trabuco:     "Karzstak arremessa os próprios escombros de volta ao inimigo. Entulho, ferro-velho e desespero caindo do céu sobre a horda.",
  prisioneiros:"Quando faltam pedras, sobram condenados. As muralhas os devolvem à horda como aríetes de carne que ainda gritam ao voar.",
  ritualcura:  "Cânticos antigos costuram os vivos enquanto a batalha ruge. Aqui a fé vira bandagem, e a esperança, sutura de última hora.",
  infusor:     "Verte magia pura nas armas dos aliados, gota a gota, como vinho raro servido à tropa na véspera de uma execução.",
};
function towerAmmos(key) { return TOWER_TYPES[key].ammos; }
function ammoOf(t, type) { return (t.ammoBy && t.ammoBy[type]) || 0; }
// Torres "a combustível" (Icônicas): consomem direto do estoque global do reino
// (🪙 ouro / 💎 cristais / ✋ Mãos / recursos brutos), sem esteira nem munição.
const FUEL_ICON = { gold: "🪙", hearts: "💎", maos: "✋", res: "📦" };
const FUEL_LABEL = { gold: "Ouro", hearts: "Cristais", maos: "Mãos", res: "Recurso bruto" };
function fuelPool(k) {
  if (k === "gold") return S.gold;
  if (k === "hearts") return S.hearts;
  if (k === "maos") return S.maos;
  if (k === "res") return Math.max(0, ...Object.values(S.res || {})); // maior pilha de recurso bruto
  return 0;
}
function spendFuel(f) {
  // Torre a combustível paga o preço cheio mesmo virando o cofre. O towerFed já exige
  // saldo antes do tiro, então isto só morde quando o saldo caiu entre o teste e o
  // disparo — e aí o certo é dever, não ganhar o tiro de graça.
  if (f.k === "gold") { S.gold -= f.cost; }
  else if (f.k === "hearts") { S.hearts -= f.cost; }
  else if (f.k === "maos") { S.maos -= f.cost; }
  else if (f.k === "res") {
    // atira 5 de UM recurso bruto aleatório que tenha estoque suficiente
    const opts = Object.keys(RESOURCES).filter(k => (S.res[k] || 0) >= f.cost);
    if (opts.length) { const k = opts[Math.floor(Math.random() * opts.length)]; S.res[k] -= f.cost; }
  }
}

// ---------- Estoque de Munições: capacidade, tipos e vizinhança ----------
function isDepot(t) { return !!t && TOWER_TYPES[t.type] && TOWER_TYPES[t.type].support === "depot"; }
function depotCap(t) { return Math.min(DEPOT_CAP_MAX, DEPOT_CAP_BASE + (towerFx(t).stock || 0)); }
function depotTotal(t) { return Object.values(t.stock || {}).reduce((s, n) => s + n, 0); }
// Tipos que ESTE Estoque aceita. O que já está guardado vem primeiro: se o jogador
// trocar a torre vizinha, a munição antiga continua servindo até acabar, em vez de
// virar espaço morto. Depois entram os tipos das vizinhas, até o limite de DEPOT_TYPES.
function depotTypes(slot) {
  const t = S.towers[slot];
  if (!t) return [];
  const out = Object.keys(t.stock || {}).filter(a => (t.stock[a] || 0) > 0);
  // Reparte as vagas em RODADAS entre as duas vizinhas. Varrer a lista de uma antes
  // da outra deixava uma torre de 3 munições ocupar as 3 vagas e a do outro lado
  // seca — justamente o contrário do que um depósito entre duas torres serve para.
  const filas = [slot - 1, slot + 1]
    .map(j => S.towers[j])
    .filter(n => n && !isDepot(n) && !TOWER_TYPES[n.type].fuel)
    .map(n => towerAmmos(n.type).slice());
  let mexeu = true;
  while (mexeu && out.length < DEPOT_TYPES) {
    mexeu = false;
    for (const f of filas) {
      while (f.length && out.includes(f[0])) f.shift();
      if (!f.length || out.length >= DEPOT_TYPES) continue;
      out.push(f.shift());
      mexeu = true;
    }
  }
  return out.slice(0, DEPOT_TYPES);
}
function depotRoom(t) { return Math.max(0, depotCap(t) - depotTotal(t)); }
// Crédito na CHEGADA da caixa, igual às torres. Guardar no despacho adiantaria a
// munição em ~1s de esteira e faria o número do painel discordar da caixa na tela.
function depotReceive(t, type, amount) {
  const put = Math.min(depotRoom(t), amount);
  if (put <= 0) return;   // sem isto, uma caixa que não cabe cria a chave em zero
  t.stock = t.stock || {};
  t.stock[type] = (t.stock[type] || 0) + put;
}
// Suporte leve que os Estoques ao lado dão a esta torre. Procura o slot pelo indexOf
// porque towerRate e consumeTowerAmmo recebem a torre, não a posição dela na muralha.
function depotAdjFx(t) {
  const slot = S.towers.indexOf(t);
  if (slot < 0) return null;
  let rate = 0, save = 0;
  for (const j of [slot - 1, slot + 1]) {
    const d = S.towers[j];
    if (!isDepot(d)) continue;
    const fx = towerFx(d);
    rate += DEPOT_RATE + (fx.adjRate || 0);
    save += DEPOT_SAVE + (fx.adjSave || 0);
  }
  return rate || save ? { rate, save } : null;
}
// Empurra munição guardada para as vizinhas secas. Roda no planejamento E no combate,
// que é o ponto: entre dois ciclos de esteira a vizinha já recebeu três vezes.
function tickDepots(dt) {
  depotTimer -= dt;
  if (depotTimer > 0) return;
  depotTimer = DEPOT_FEED_SEC;
  for (let i = 0; i < LANES; i++) {
    const d = S.towers[i];
    if (!isDepot(d) || !depotTotal(d)) continue;
    const fx = towerFx(d);
    const perPush = DEPOT_FEED + (fx.feed || 0);
    for (const j of [i - 1, i + 1]) {
      const n = S.towers[j];
      if (!n || isDepot(n) || TOWER_TYPES[n.type].fuel) continue;
      for (const a of towerAmmos(n.type)) {
        const falta = ammoCap() - ammoOf(n, a);
        const tem = (d.stock && d.stock[a]) || 0;
        if (falta <= 0 || tem <= 0) continue;
        const move = Math.min(perPush, falta, tem);
        d.stock[a] -= move;
        n.ammoBy = n.ammoBy || {};
        n.ammoBy[a] = ammoOf(n, a) + move;
      }
    }
  }
}
function towerFed(t, cost) {
  const tt = TOWER_TYPES[t.type];
  if (tt.fuel) return fuelPool(tt.fuel.k) >= tt.fuel.cost;
  return towerAmmos(t.type).every(a => ammoOf(t, a) >= cost);
}
function towerMinAmmo(t) { return Math.min(...towerAmmos(t.type).map(a => ammoOf(t, a))); }
// bônus de facção/fábrica somados sobre TODAS as munições da torre
function towerTypeFx(key, fxKey) { return towerAmmos(key).reduce((s, a) => s + ammoTypeFx(a, fxKey), 0); }
function fillTowerAmmo(t) { t.ammoBy = t.ammoBy || {}; for (const a of towerAmmos(t.type)) t.ammoBy[a] = ammoCap(); }
function consumeTowerAmmo(t, cost, fx) {
  const tt = TOWER_TYPES[t.type];
  if (tt.fuel) { spendFuel(tt.fuel); return; } // combustível global, não usa esteira
  const adj = depotAdjFx(t);
  const saveCh = (fx.save || 0) + towerTypeFx(t.type, "typeSave") + (adj ? adj.save : 0);
  if (Math.random() < saveCh) return; // munição poupada: não gasta nada
  if (!t.ammoBy) t.ammoBy = {};
  for (const a of towerAmmos(t.type)) t.ammoBy[a] = Math.max(0, ammoOf(t, a) - cost);
}

// ---------- Inimigos ----------
// Ritmo global de marcha (estilo PvZ): <1 deixa a horda mais lenta, turnos mais longos.
const ENEMY_MARCH = 0.82;
// A muralha às vezes simplesmente aguenta: 1 em 5 batidas não tira hit nem gasta o selo.
// Suaviza o azar sem baratear o erro — perder 5 hits seguidos deixa de ser sentença.
const WALL_FORGIVE = 0.2;
// Crítico global das torres: 1 em 5 tiros dobra o dano. Vale para TODA torre, e os
// bônus de crítico dos caminhos somam por cima disto, então torre de crítico segue
// sendo torre de crítico. Eleva o dano médio em ~20%, que é justamente o que o +20%
// de vida dos inimigos deste mesmo ajuste devolve.
const CRIT_BASE = 0.2, CRIT_MULT = 2;
// Resistência global: +50% de vida em TODOS os tipos. É um multiplicador de spawn, não
// uma edição dos `hp` abaixo — assim os números de ENEMY_TYPES seguem sendo o design base
// (e os cortes de peso do pickWave, como `hp >= 40`, continuam valendo o que valiam).
const ENEMY_TOUGHNESS = 3.6;
// ---------- Escalada de vida por DIA ----------
// O problema medido: numa partida boa o inimigo morre no terço de cima do campo, longe
// da muralha, e a horda perde o impacto — o jogador não VÊ o que ele está matando. A
// causa é que a horda escalava só em QUANTIDADE, então o dano do jogador crescia mais
// rápido que a vida individual do morto e a fila ia morrendo cada vez mais longe.
// A correção é por dia, não na base: quem não passa do dia HP_RAMP_FROM nunca sente,
// e esse é justamente o jogador iniciante. Sobreviver ao dia 10 já é a peneira.
const HP_RAMP_FROM = 10;    // antes disso, nada muda
const HP_RAMP_EVERY = 5;    // um degrau a cada 5 dias
const HP_RAMP_STEP = 0.1;   // +10% por degrau, composto
function enemyHpDayMult() {
  const steps = Math.max(0, Math.ceil((S.day - HP_RAMP_FROM) / HP_RAMP_EVERY));
  return Math.pow(1 + HP_RAMP_STEP, steps);
}
const ENEMY_TYPES = {
  rastejante: { name: "Rastejante",  icon: "🧟", hp: 14, spd: 0.040, armor: 1,  gold: 2, heart: .25, period: "day",   minDay: 1 },
  corredor:   { name: "Corredor",    icon: "🏃", hp: 8,  spd: 0.105, armor: 1,  gold: 2, heart: .20, period: "day",   minDay: 2 },
  blindado:   { name: "Blindado",    icon: "🛡️", hp: 30, spd: 0.026, armor: .6, gold: 4, heart: .50, period: "day",   minDay: 3 },
  revivido:   { name: "Revivido",    icon: "🧟‍♂️", hp: 16, spd: 0.042, armor: 1,  gold: 2, heart: .30, period: "night", minDay: 1 },
  sombra:     { name: "Sombra",      icon: "👻", hp: 9,  spd: 0.092, armor: 1,  gold: 3, heart: .45, period: "night", minDay: 2, rng: { dmg: 4,  cd: 2.2, reach: 0.22, ic: "🌀" } },
  carnical:   { name: "Carniçal",    icon: "🧌", hp: 40, spd: 0.022, armor: .6, gold: 5, heart: .50, period: "night", minDay: 3 },
  abominacao: { name: "Abominação",  icon: "👹", hp: 70, spd: 0.018, armor: .8, gold: 8, heart: .90, period: "moon",  minDay: 1 },
  // --- Tipos de escalada tardia: entram por minDay para dar VARIEDADE (não engordam os de cima) ---
  brutamontes:{ name: "Brutamontes",  icon: "🪓", hp: 60, spd: 0.024, armor: .6, gold: 6, heart: .60, period: "day",   minDay: 8,  rng: { dmg: 7,  cd: 3.0, reach: 0.20, ic: "🪓" } },
  matilha:    { name: "Matilha",      icon: "🐺", hp: 12, spd: 0.118, armor: 1,  gold: 3, heart: .30, period: "day",   minDay: 14 },
  carniceiro: { name: "Carniceiro",   icon: "🔪", hp: 75, spd: 0.020, armor: .6, gold: 7, heart: .70, period: "night", minDay: 8,  rng: { dmg: 9,  cd: 2.6, reach: 0.22, ic: "🔪" } },
  espectro:   { name: "Espectro",     icon: "💀", hp: 22, spd: 0.102, armor: 1,  gold: 4, heart: .55, period: "night", minDay: 14, rng: { dmg: 6,  cd: 1.8, reach: 0.26, ic: "🦴" } },
  colosso:    { name: "Colosso",      icon: "🗿", hp: 140,spd: 0.016, armor: .8, gold: 12,heart: 1.2, period: "moon",  minDay: 12 },
};

// ---------- Limites de estoque ----------
// Mãos têm um TETO que começa baixo e cresce com o Cortiço (edifício residencial essencial).
const MAOS_CAP_BASE = 10;     // limite inicial de Mãos
const MAOS_CAP_MAX = 50;      // teto real do limite de Mãos
const CORTICO_PER = 8;        // +Mãos de teto por nível de Cortiço
// Recursos do Feudo têm um teto generoso, só p/ evitar acúmulo/overflow no end-game.
const RES_CAP = 500;
// ---------- Dívida: saldo negativo ----------
// Todo recurso pode ficar negativo. Travar em zero parecia proteger o jogador, mas na
// prática perdoava a cobrança — e quem descobrisse isso zerava o cofre de propósito
// antes de cada desconto. O preço de dever é a moral, cobrada no fim do turno, e é por
// resource: fechar no vermelho em quatro frentes não pode custar o mesmo que em uma.
const NEG_MORALE_EACH = 12;   // por recurso no vermelho
const NEG_MORALE_CAP = 40;    // teto: sem isto, dever tudo de uma vez seria sentença
function negativeRes() {
  const out = [];
  if (S.gold < 0) out.push("🪙");
  if (S.hearts < 0) out.push("💎");
  if (S.maos < 0) out.push("✋");
  for (const [k, r] of Object.entries(RESOURCES)) if ((S.res[k] || 0) < 0) out.push(r.icon);
  return out;
}
// (maosCap() usa groupLvlSum/mioloLvl — funções hoisted — e MIOLO, já declarado acima.)
function maosCap() {
  return Math.min(MAOS_CAP_MAX, MAOS_CAP_BASE + CORTICO_PER * groupLvlSum("cortico") + MIOLO.guilda.per * mioloLvl("guilda") + (law("L9") ? 8 : 0));
}

// ---------- Construções (formatos tetris; fábricas produzem munições) ----------
const BUILDINGS = {
  fab_virotes:    { name: "Fábrica de Virotes",       icon: "🪶", cost: 30, shape: [[0,0],[1,0]],             zones: ["2","0"], prod: "virotes",   feed: "bens",
                    desc: "produz 🏹 virotes (consome 📦 Bens)" },
  fab_pedras:     { name: "Fábrica de Projéteis",     icon: "🗿", cost: 35, shape: [[0,0],[0,1],[0,2]],       zones: ["2","0"], prod: "pedras",    feed: "minerio",
                    desc: "produz 🪨 projéteis (consome ⛏️ Minério)" },
  fab_oleo:       { name: "Fábrica de Óleo",          icon: "🛢️", cost: 40, shape: [[0,0],[0,1],[1,0],[1,1]], zones: ["2","0"], prod: "oleo",      feed: "combustivel",
                    desc: "produz 🛢️ óleo (consome ⛽ Combustível)" },
  fab_essencia:   { name: "Fábrica de Essência",      icon: "✨", cost: 45, shape: [[0,0]],                   zones: ["2","0"], prod: "essencia",  feed: "comida",
                    desc: "produz ✨ essência (consome 🌾 Comida)" },
  fab_condutores: { name: "Fábrica de Condutores",    icon: "🔋", cost: 45, shape: [[0,0],[0,1],[0,2]],       zones: ["2","0"], prod: "condutores", feed: "minerio",
                    desc: "produz ⚡ condutores (consome ⛏️ Minério)" },
  fab_quimicos:   { name: "Fábrica de Químicos",      icon: "⚗️", cost: 45, shape: [[0,0]],                   zones: ["2","0"], prod: "quimicos",   feed: "bens",
                    desc: "produz 🧪 químicos (consome 📦 Bens)" },
  quartel:        { name: "Quartel",                  icon: "🏠", cost: 25, shape: [[0,0],[0,1]],             zones: ["1","0"],
                    desc: "tropas aliadas ganham +10% de vida" },
  cortico:        { name: "Cortiço",                   icon: "🏘️", cost: 30, shape: [[0,0],[0,1]],             zones: ["1","0"],
                    desc: `+${CORTICO_PER} de teto de ✋ Mãos por nível (máx. ${MAOS_CAP_MAX})` },
  praca_publica:  { name: "Praça Pública",            icon: "⛲", cost: 30, shape: [[0,0]],                   zones: ["1","0"],
                    desc: "+1 🪙/dia por construção vizinha (por nível)" },
  praca_trabalho: { name: "Praça do Trabalho",        icon: "🛠️", cost: 35, shape: [[0,0]],                   zones: ["2","0"],
                    desc: "+1% de eficiência por nível às construções que a tocam" },
  // ===== Novas praças (sempre disponíveis, fora do Arsenal) =====
  praca_vigia:      { name: "Praça do Vigia",         icon: "🗼", cost: 20, shape: [[0,0]],                   zones: ["2","0"],
                    desc: "avisos de chegada +0,8s por nível (7s no máximo)" },
  praca_festival:   { name: "Praça do Festival",      icon: "🎉", cost: 30, shape: [[0,0]],                   zones: ["1","0"],
                    desc: "+2 de moral por turno por nível" },
  praca_jardim:     { name: "Praça Jardim",           icon: "🌷", cost: 25, shape: [[0,0]],                   zones: ["1","0"],
                    desc: "cura as tropas aliadas em +2 de vida por turno por nível" },
  praca_militar:    { name: "Praça Militar",          icon: "⚔️", cost: 35, shape: [[0,0]],                   zones: ["2","0"],
                    desc: "tropas aliadas atacam +8% mais forte por nível", locked: true, medalCost: 10 },
  praca_chique:     { name: "Praça Chique",           icon: "💰", cost: 40, shape: [[0,0]],                   zones: ["1","0"],
                    desc: "+5 🪙 por turno por nível", locked: true, medalCost: 10 },
  praca_abandonada: { name: "Praça Abandonada",       icon: "🏚️", cost: 15, shape: [[0,0]],                   zones: ["2","0"],
                    desc: "+4 🪙 por turno por nível, mas -1 de moral por turno por nível", locked: true, medalCost: 10 },
  praca_cerimonial: { name: "Praça Cerimonial",       icon: "🕯️", cost: 40, shape: [[0,0]],                   zones: ["1","0"],
                    desc: "+1 💎 por turno por nível", locked: true, medalCost: 10 },
  praca_estranha:   { name: "Praça Estranha",         icon: "🌀", cost: 30, shape: [[0,0]],                   zones: ["2","0"],
                    desc: "bônus aleatório a cada turno por nível (🪙/moral/💎)", locked: true, medalCost: 10 },
  capela:         { name: "Capela",                   icon: "⛪", cost: 25, shape: [[0,0],[1,0]],             zones: ["1","0"],
                    desc: "cura as tropas aliadas em +3 de vida por nível a cada turno" },
  estabulo:       { name: "Estábulo",                 icon: "🐴", cost: 30, shape: [[0,0],[0,1]],             zones: ["1","0"],
                    desc: "tropas aliadas marcham +10% mais rápido por nível" },
  // ===== Edifícios do Arsenal (desbloqueáveis) =====
  tesouraria:     { name: "Tesouraria",               icon: "🏦", cost: 40, shape: [[0,0],[1,0]],             zones: ["1","0"],
                    desc: "+8 🪙 por turno por nível", locked: true, medalCost: 20 },
  laboratorio:    { name: "Laboratório",              icon: "🔬", cost: 45, shape: [[0,0],[0,1]],             zones: ["2","0"],
                    desc: "+8% de produção global por nível", locked: true, medalCost: 25 },
  templo:         { name: "Templo da Fé",             icon: "🛐", cost: 40, shape: [[0,0],[1,0]],             zones: ["1","0"],
                    desc: "+3 de moral por turno por nível" },
  oficina:        { name: "Oficina de Muros",         icon: "🧱", cost: 45, shape: [[0,0],[1,0],[1,1]],       zones: ["1","0"],
                    desc: "repara +1 de vida das muralhas a cada 30s (acelera por nível)", locked: true, medalCost: 30 },
  refinaria:      { name: "Refinaria de Argamato",    icon: "💎", cost: 50, shape: [[0,0],[0,1]],             zones: ["2","0"],
                    desc: "+1 💎 por turno por nível", locked: true, medalCost: 30 },
  bastiao:        { name: "Bastião de Guerra",        icon: "🏯", cost: 70, shape: [[0,0],[1,0],[0,1],[1,1]], zones: ["1","0"],
                    desc: "+6% de dano de TODAS as torres por nível", locked: true, medalCost: 50 },
};

// ---------- O Feudo: recursos & extratores (Fase 11) ----------
// Recursos brutos (Comidas/Mãos entram na Fase 12). Só acumulam por ora.
// Recursos do Feudo (aparecem na faixa). Mãos NÃO entra aqui: é moeda de topo (HUD).
const RESOURCES = {
  minerio:     { name: "Minérios",     icon: "⛏️" },
  combustivel: { name: "Combustíveis", icon: "⛽" },
  bens:        { name: "Bens",         icon: "📦" },
  comida:      { name: "Comida",       icon: "🌾" },
};
const MAOS = { name: "Mãos", icon: "✋" };
function resMeta(k) { return k === "maos" ? MAOS : RESOURCES[k]; }
// Custo de presente nas Alianças: pode ser recurso do Feudo, Mãos, 🪙 ou 💎. Tinha dois
// furos aqui, e o primeiro escondia o segundo:
//   · 💎 não está em RESOURCES, então resMeta devolvia undefined e ler `.n` derrubava a
//     tela INTEIRA ao abrir "Presentear" na Rainha, cujo presente custa 💎;
//   · RESOURCES guarda o rótulo em `name`, não em `n`, então TODO presente de recurso
//     do Feudo vinha escrito "(−8 undefined)" — só não dava para ver por causa do crash.
// FAV_FX_META já é a tabela com o campo `n` para todos eles, inclusive 💎 e Mãos; só o
// ouro não mora lá. E o `have` lia S.res.hearts (inexistente), então a opção de 💎
// ficava travada em "recursos insuficientes" mesmo com cristais no bolso.
const GIFT_COST_META = { gold: { n: "Ouro" } };
function giftCostMeta(k) { return GIFT_COST_META[k] || FAV_FX_META[k] || { n: (resMeta(k) || {}).name || k }; }
function giftCostHave(k) { return k === "hearts" ? S.hearts : resAmount(k); }
// Quanto o setor tem de um recurso ("maos" vive na moeda de topo, o resto no Feudo).
function resAmount(k) { return k === "maos" ? S.maos : (k === "gold" ? S.gold : S.res[k] || 0); }
// roteia produção: "maos" vai pra moeda de topo; o resto pro estoque do Feudo
// Clampa ao teto SÓ ao ganhar, nunca reduz estoque já acima do limite (compat. com saves antigos).
function addResource(k, amt) {
  if (k === "maos") { const cap = maosCap(); S.maos = S.maos >= cap ? S.maos : Math.min(cap, S.maos + amt); }
  else { const cur = S.res[k] || 0; S.res[k] = cur >= RES_CAP ? cur : Math.min(RES_CAP, cur + amt); }
}

// Extratores: prédios do Feudo (pintados como os da Cidade, mas SEM zonas).
// Geram `yield` por bloco a cada turno e ESGOTAM: somem após `life` turnos.
const EXTRACTORS = {
  mina:       { name: "Mina",        icon: "⛏️", res: "minerio",     cost: 30, minBlocks: 1, life: 8,  yield: 2 },
  poco:       { name: "Poço",        icon: "⛽", res: "combustivel", cost: 35, minBlocks: 1, life: 8,  yield: 2 },
  entreposto: { name: "Entreposto",  icon: "📦", res: "bens",        cost: 40, minBlocks: 2, life: 10, yield: 1.5 },
  alojamento: { name: "Alojamento",  icon: "🛖", res: "maos",        cost: 35, minBlocks: 1, life: 8,  yield: 3 },
  roca:       { name: "Roça",        icon: "🌾", res: "comida",      cost: 30, minBlocks: 1, life: 8,  yield: 2 },
  // Estruturas (Fase 14): não produzem recursos. `life` = turnos até expirar
  // (sem `life`, é permanente).
  feitor:     { name: "Feitoria Real", icon: "👷", struct: true, role: "feitor",  cost: 40, minBlocks: 1, life: 20,
                desc: "reconstrói extratores adjacentes que esgotarem (paga o ouro de construção)" },
  deposito:   { name: "Depósito de Ferramentas", icon: "🧰", struct: true, role: "durability", dur: 4, cost: 35, minBlocks: 1,
                desc: "extratores adjacentes duram +4 turnos (ao construir/reconstruir)" },
};
function defOf(key) { return BUILDINGS[key] || EXTRACTORS[key]; }
function isExtractor(key) { return !!EXTRACTORS[key]; }
function isProducerExtractor(key) { return !!(EXTRACTORS[key] && !EXTRACTORS[key].struct); }

// estrutura do Feudo com dado papel adjacente (8-dir) a algum bloco do grupo?
function hasAdjacentStruct(idxs, role) {
  const own = new Set(idxs);
  for (const i of idxs)
    for (const n of neighbors(i)) {
      const c = S.feud[n];
      if (!own.has(n) && c.built && EXTRACTORS[c.built] && EXTRACTORS[c.built].role === role) return true;
    }
  return false;
}
// soma de durabilidade dos Depósitos adjacentes ao grupo (1× por grupo)
function durabilityBonus(idxs) {
  const own = new Set(idxs), seen = new Set();
  let bonus = 0;
  for (const i of idxs)
    for (const n of neighbors(i)) {
      const c = S.feud[n];
      if (!own.has(n) && c.built && EXTRACTORS[c.built] && EXTRACTORS[c.built].role === "durability" && !seen.has(c.gid)) {
        seen.add(c.gid); bonus += EXTRACTORS[c.built].dur;
      }
    }
  return bonus;
}
function extractorLife(key, idxs) { return EXTRACTORS[key].life + durabilityBonus(idxs) + mioloLvl("duraveis"); }

// ---------- Cadeia de suprimentos (Fase 13) ----------
// Fábricas consomem recurso em TODOS os níveis (nível 1 consome pouco).
// Toda a produção escala com a cobertura de recurso do turno.
const FEED_PER = 1.0;      // recurso por unidade de produção (calibrável)
const FEED_FREE = 1.0;     // potencial de produção do nível 1, por bloco
const FEED_TURN_SECONDS = 20; // janela de um "turno médio" em segundos: o consumo das fábricas E a
                              // produção contínua dos extratores (por segundo) são dosados por ela.
S.feedEff = {};            // cobertura de recurso por tipo, no turno atual (0..1); recomputado no startWave

// potencial de produção (= unidades de consumo) de uma célula de fábrica, por bloco
function cellGated(c) { return c.lvl === 1 ? FEED_FREE : c.lvl; }
// estrutura desligada (⏻): o grupo inteiro pausa produção, consumo e efeitos
function cellOff(c) { return !!c.off; }

// ---------- EM MANUTENÇÃO: teto de extração por turno ----------
// Cada extrator arranca no máximo MAINT_CAP_BASE de recurso por turno. Batido o teto,
// o poço entra "Em Manutenção" e para até o próximo turno — é o que impede farmar recurso
// infinito só ficando parado entre as hordas. O teto sobe com as leis de indústria e
// logística do Foral, e com a linha Tech + Inovação + Motor Perpétuo completas chega a
// MAINT_CAP_MAX, que é o próprio RES_CAP: aí a manutenção deixa de ser gargalo.
const MAINT_CAP_BASE = 50, MAINT_CAP_MAX = RES_CAP;
const MAINT_CAP_LAWS = { L31: 30, L32: 40, L33: 50, L34: 60, L35: 80, L39: 90, L47: 100 };
function maintCap() {
  let cap = MAINT_CAP_BASE;
  for (const id in MAINT_CAP_LAWS) if (law(id)) cap += MAINT_CAP_LAWS[id];
  return Math.min(MAINT_CAP_MAX, cap);
}
function maintOut(gid) { return (S.feudOut && S.feudOut[gid]) || 0; }
function maintLeft(gid) { return Math.max(0, maintCap() - maintOut(gid)); }
function maintDone(gid) { return maintLeft(gid) <= 0; }

// ---------- Estoque de recurso por fábrica (Fase: cadeia contínua) ----------
// Cada GRUPO de fábrica tem um estoque do seu recurso de entrada, guardado na
// célula-líder (cells[0].stock). A fábrica puxa recurso do Feudo para o estoque
// (planejamento E combate) até encher; produz munição consumindo do estoque.
const FACT_TANK_PER = 8;       // capacidade do estoque por bloco
const FACT_FILL_PER_SEC = 4;   // recurso puxado do Feudo por bloco por segundo
function groupLead(gid) { return S.city.find(c => c.gid === gid); }
function tankCap(gid) { return groupCells(gid).length * FACT_TANK_PER; }
function groupStock(gid) { const l = groupLead(gid); return l ? (l.stock || 0) : 0; }
// fábrica está desabastecida (estoque vazio) — usado só para o aviso visual
function factoryStarved(c) {
  const b = BUILDINGS[c.built];
  return !!(b && b.feed && !cellOff(c) && groupStock(c.gid) <= 0);
}
// Espaço que as torres ainda comportam desta munição. 0 = ninguém aceita.
function ammoDemand(type) {
  let d = 0;
  for (const t of S.towers) {
    if (!t || !TOWER_TYPES[t.type].ammos.includes(type)) continue;
    d += Math.max(0, ammoCap() - ammoOf(t, type));
  }
  return d;
}
// Produção travada: torres sem espaço (ou nenhuma torre usa o tipo) e o excedente
// não tem para onde ir. Com "Ajudar o Reino" ligado nunca trava — vira Medalha.
function ammoBlocked(type) { return !S.helpKingdom && ammoDemand(type) <= 0; }

// ---------- Ajudar o Reino: piso de segurança ----------
// Com a chave ligada as fábricas produzem ALÉM da demanda das torres, e isso consome
// recurso bruto do Feudo sem parar. Esquecer a chave ligada zerava o estoque. Agora há um
// piso: se QUALQUER recurso do Feudo cair abaixo de HELP_MIN_RES, a chave cai sozinha e
// não pode ser religada até o setor se recompor.
const HELP_MIN_RES = 50;
function helpResFloor() { return Math.min(...Object.keys(RESOURCES).map(k => S.res[k] || 0)); }
function helpKingdomBlocked() { return helpResFloor() < HELP_MIN_RES; }
function helpKingdomGuard() {
  if (!S.helpKingdom || !helpKingdomBlocked()) return;
  S.helpKingdom = false;
  toast(`🎖️ Ajudar o Reino desligado: recurso do Feudo abaixo de ${HELP_MIN_RES}. O setor vem primeiro.`);
  saveGame(); renderResBar(); renderHUD();
}
// cobertura instantânea: 1 se o estoque tem recurso (ou a fábrica não consome), senão 0
function feedCoverage(key, gid) {
  const feed = BUILDINGS[key] && BUILDINGS[key].feed;
  if (!feed) return 1;
  return gid != null && groupStock(gid) > 0 ? 1 : 0;
}
// só as fábricas da Cidade custam Mãos (o Feudo é a fonte da mão de obra)
function costsMaos(key) { return !!(BUILDINGS[key] && BUILDINGS[key].prod); }
function paintMaos(key, n) { return costsMaos(key) ? n : 0; }

// soma de níveis por tipo de edifício (1× por grupo)
function groupLvlSum(key) {
  const seen = new Set();
  let s = 0;
  for (const c of S.city) {
    if (c.built === key && !cellOff(c) && !seen.has(c.gid)) { seen.add(c.gid); s += c.lvl; }
  }
  return s;
}
function allySpdMult() { return 1 + 0.1 * groupLvlSum("estabulo"); }

const GRID_PLAN = [
  "P","1","1","1","1",
  "1","1","1","1","1",
  "0","0","0","0","0",
  "2","2","2","2","2",
  "2","2","2","2","D",
];

// ---------- Aliados (Portão P) ----------
const ALLY_LIMIT = 5;
const ALLY_TYPES = {
  campones:  { name: "Camponês",  icon: "🧑‍🌾", cost: 10, cur: "gold",   hp: 15, dps: 3,  spd: 0.05, melee: true },
  cacador:   { name: "Caçador",   icon: "🎯",  cost: 20, cur: "gold",   hp: 22, dps: 5,  spd: 0.05, range: 0.12 },
  cavaleiro: { name: "Cavaleiro", icon: "🏇",  cost: 30, cur: "gold",   hp: 50, dps: 8,  spd: 0.07, melee: true },
  escudeiro: { name: "Escudeiro", icon: "🪖",  cost: 35, cur: "gold",   hp: 95, dps: 3,  spd: 0.035, melee: true, tank: 0.30 },
  mago:      { name: "Mago",      icon: "🧙",  cost: 8,  cur: "hearts", hp: 20, dps: 10, spd: 0.05, range: 0.25 },
  sombra:    { name: "Sombra",    icon: "👻",  cost: 0,  cur: "gold",   hp: 20, dps: 6,  spd: 0.06, melee: true, spectral: true }, // aliado do pacto roxo (temporário)
};

// ---------- Ideologia da tropa (Arco dos Heróis) ----------
// Cada tropa jura uma ideologia; a cor SOMA um bônus sobre os stats base do tipo.
const ALLY_FAC_FX = {
  red:    { desc: "+10% de vida" },
  blue:   { desc: "+10% de ataque" },
  yellow: { desc: "+10% de marcha e de reposição" },
  pink:   { desc: "imune a ataques à distância" },
  purple: { desc: "auras 10% mais fortes" },
  green:  { desc: "+10% de cura recebida" },
};
const ALLY_FAC_BONUS = 0.10;
// cores disponíveis no Arco: as 4 abertas + as secretas já desbloqueadas
function allyFacList() { return Object.keys(ALLY_FAC_FX).filter(k => facUnlocked(k)); }
function allyFacHpMult(a)   { return a && a.fac === "red"    ? 1 + ALLY_FAC_BONUS : 1; }
function allyFacAtkMult(a)  { return a && a.fac === "blue"   ? 1 + ALLY_FAC_BONUS : 1; }
function allyFacSpdMult(a)  { return a && a.fac === "yellow" ? 1 + ALLY_FAC_BONUS : 1; }
function allyFacAuraMult(a) { return a && a.fac === "purple" ? 1 + ALLY_FAC_BONUS : 1; }
function allyFacHealMult(a) { return a && a.fac === "green"  ? 1 + ALLY_FAC_BONUS : 1; }
function allyImmuneRanged(a) { return !!a && a.fac === "pink"; }
// cura recebida por uma tropa, já com o bônus da ideologia Verde
function healAlly(a, v) { if (v > 0) a.hp = Math.min(a.maxHp, a.hp + v * allyFacHealMult(a)); }

// Quartéis agora buffam as tropas: +10% de vida por quartel (base) + variantes
function allyHpMult() {
  const groups = new Set(S.city.filter(c => c.built === "quartel").map(c => c.gid)).size;
  return 1 + groups * 0.10 + cityFxScan(c => c.built === "quartel", "tHp");
}
function allyDmgMult() {
  const infusor = (S.towerBuff && S.towerBuff.t > 0) ? S.towerBuff.atk : 0; // Infusor Arcano
  const moedor = (S.allyGrind && S.allyGrind.t > 0) ? S.allyGrind.mult : 0; // Moedor de Plebe
  const laws = (law("L24") ? 0.10 : 0) + (S.hits === 1 && law("L30") ? 0.25 : 0); // Lei do Machado + Última Trincheira
  return (1 + cityFxScan(c => c.built === "quartel", "tD") + 0.08 * groupLvlSum("praca_militar") + infusor + moedor + laws) * favAllyMult();
}

// Convocar com a horda em campo custa mais: ninguém corre para a muralha pelo preço de
// tempo de paz. Vale para o Arco E para a reposição automática — se valesse só para o
// automático, bastava desligar a chave e convocar na mão para furar a sobretaxa.
const GATE_WAR_MULT = 1.5;
function allyCost(a) { return S.waveActive ? Math.ceil(a.cost * GATE_WAR_MULT) : a.cost; }
function summonAlly(type, fac) {
  const a = ALLY_TYPES[type];
  if (S.allies.length >= ALLY_LIMIT) return false;
  const cost = allyCost(a);
  const wallet = a.cur === "gold" ? S.gold : S.hearts;
  if (wallet < cost) return false;
  if (a.cur === "gold") S.gold -= cost; else S.hearts -= cost;
  fac = allyFacList().includes(fac) ? fac : allyFacList()[0];
  const hp = Math.round(a.hp * allyHpMult() * allyFacHpMult({ fac }));
  // sem acumular: sorteia entre as lanes com MENOS aliados (5 tropas = 1 por lane)
  const counts = Array.from({ length: LANES }, (_, l) => S.allies.filter(x => x.lane === l).length);
  const min = Math.min(...counts);
  const freeLanes = counts.map((n, l) => n === min ? l : -1).filter(l => l >= 0);
  const lane = freeLanes[Math.floor(Math.random() * freeLanes.length)];
  S.allies.push({ type, fac, lane, y: 0.93, hp, maxHp: hp, state: "up" });
  S.gatePref = type;
  S.gateFac = fac;
  renderAll();
  return true;
}

// ---------- AS MELHORIAS: 48 leis do setor (roda radial; ver melhorias-design.md) ----------
// 8 linhas × 5 nós (sequenciais, do centro p/ fora) + 8 lendárias (exigem as 2 linhas vizinhas).
// Limite de LAW_LIMIT leis por partida. Moral da lei é aplicada POR TURNO (leis são permanentes).
const LAW_LIMIT = 30;
const LAW_LINES = {
  moral:       { name: "Moral",       angle: -90 },
  profano:     { name: "Profano",     angle: -45 },
  arcano:      { name: "Arcano",      angle: 0,   ldy: -40 }, // spoke horizontal: sobe o rótulo p/ não cair sobre o nó
  cajado:      { name: "Cajado",      angle: 45 },
  muralha:     { name: "Muralhas",    angle: 90 },
  resistencia: { name: "Resistência", angle: 135 },
  tech:        { name: "Tech",        angle: 180, ldy: -40 },
  inovacao:    { name: "Inovação",    angle: -135 },
};
const LAWS = {
  // MORAL — leis do povo
  L1:  { line: "moral", pos: 1, name: "Ração Justa",            desc: "O pão é dividido igual: +1 🌾 por turno.",                    cost: 30,  moral: 1 },
  L2:  { line: "moral", pos: 2, name: "Festivais do Crepúsculo", desc: "Turno perfeito dá +2 de moral extra.",                       cost: 60,  moral: 1 },
  L3:  { line: "moral", pos: 3, name: "Casas de Banho",          desc: "Tropas curam +2 por turno.",                                 cost: 100, moral: 2 },
  L4:  { line: "moral", pos: 4, name: "Anistia dos Devedores",   desc: "Renda -5%, o povo respira.",                                 cost: 150, moral: 2 },
  L5:  { line: "moral", pos: 5, name: "Voz do Povo",             desc: "Eventos negativos têm o efeito reduzido em 50%.",            cost: 220, moral: 3 },
  // PROFANO — poder pelo medo
  L6:  { line: "profano", pos: 1, name: "Velas Negras",    desc: "+10% de ouro por abate.",                    cost: 40,  moral: -1 },
  L7:  { line: "profano", pos: 2, name: "Culto Tolerado",  desc: "Fábricas de ✨ essência +15%.",              cost: 80,  moral: -2 },
  L8:  { line: "profano", pos: 3, name: "Dízimo de Sangue", desc: "+1 💎 a cada amanhecer.",                   cost: 125, moral: -2 },
  L9:  { line: "profano", pos: 4, name: "Necro-serviçais", desc: "+8 de teto de ✋ Mãos.",                      cost: 180, moral: -3 },
  L10: { line: "profano", pos: 5, name: "Missa Invertida", desc: "Torres +15% de dano à noite.",               cost: 260, moral: -3 },
  // ARCANO — magia regulamentada
  // (magia exige Cristais 💎 além de ouro — custo alto e escalonado pela posição)
  L11: { line: "arcano", pos: 1, name: "Licença Arcana",        desc: "Torres mágicas +10% de dano.",              cost: 60,  gem: 2,  moral: 0 },
  L12: { line: "arcano", pos: 2, name: "Círculo de Aprendizes", desc: "✨ essência alimenta +1 munição por caixa.", cost: 120, gem: 4,  moral: 0 },
  L13: { line: "arcano", pos: 3, name: "Sangria de Argamato",   desc: "+1 💎 por turno; o ritual assusta.",        cost: 200, gem: 6,  moral: -2 },
  L14: { line: "arcano", pos: 4, name: "Runas de Contenção",    desc: "+1 hit máximo das muralhas.",                 cost: 300, gem: 9,  moral: 1 },
  L15: { line: "arcano", pos: 5, name: "Pacto do Véu",          desc: "Torres mágicas +25% de dano.",              cost: 440, gem: 13, moral: -3 },
  // CAJADO — linhas de poder do cetro (também exige Cristais 💎)
  L16: { line: "cajado", pos: 1, name: "Foco do Cetro",      desc: "Auras duram +3s.",                                cost: 80,  gem: 2,  moral: 0 },
  L17: { line: "cajado", pos: 2, name: "Tinta de Argamato",  desc: "A cada 2 conjurações, a 3ª não gasta 💎.",        cost: 160, gem: 4,  moral: 0 },
  L18: { line: "cajado", pos: 3, name: "Geometria Sagrada",  desc: "Auras 15% mais fortes.",                          cost: 250, gem: 7,  moral: 1 },
  L19: { line: "cajado", pos: 4, name: "Pulso Contido",      desc: "Dispel causa dano leve ao alvo.",                 cost: 360, gem: 10, moral: 0 },
  L20: { line: "cajado", pos: 5, name: "Mão do Rei",         desc: "Auras duram o dobro; o povo teme o cetro.",       cost: 520, gem: 14, moral: -2 },
  // MURALHA — defesa e pedra
  L21: { line: "muralha", pos: 1, name: "Argamassa Reforçada", desc: "+1 hit máximo.",                                cost: 30,  moral: 0 },
  L22: { line: "muralha", pos: 2, name: "Vigias Dobrados",     desc: "Avisos de horda +1s.",                          cost: 60,  moral: 1 },
  L23: { line: "muralha", pos: 3, name: "Requisição de Pedra", desc: "Casas viram muralhas: reparo +1 por turno.",     cost: 100, moral: -2 },
  L24: { line: "muralha", pos: 4, name: "Lei do Machado",      desc: "Tropas +10% de dano.",                          cost: 150, moral: 1 },
  L25: { line: "muralha", pos: 5, name: "Bastião Eterno",      desc: "+2 hits máximos.",                              cost: 220, moral: 2 },
  // RESISTÊNCIA — sobreviver a qualquer custo
  L26: { line: "resistencia", pos: 1, name: "Abrigos Subterrâneos",   desc: "Perda de moral por hits -25%.",                       cost: 40,  moral: 1 },
  L27: { line: "resistencia", pos: 2, name: "Muros Modulares",        desc: "Reparos rendem +1 hit.",                              cost: 80,  moral: 0 },
  L28: { line: "resistencia", pos: 3, name: "Chapas de Ferro",        desc: "Metal requisitado das casas: +1 hit máximo.",         cost: 125, moral: -2 },
  L29: { line: "resistencia", pos: 4, name: "Racionamento de Guerra", desc: "Produção +10%, mesas vazias.",                        cost: 180, moral: -3 },
  L30: { line: "resistencia", pos: 5, name: "Última Trincheira",      desc: "Com 1 hit restante, tropas e torres +25% de dano.",   cost: 260, moral: 2 },
  // TECH — indústria a vapor
  L31: { line: "tech", pos: 1, name: "Linhas de Montagem",  desc: "Produção +8%; 🔧 manutenção +30.",             cost: 30,  moral: 0 },
  L32: { line: "tech", pos: 2, name: "Turno da Madrugada",  desc: "Produção +12%; 🔧 manutenção +40.",            cost: 60,  moral: -2 },
  L33: { line: "tech", pos: 3, name: "Prensas a Vapor",     desc: "Fábricas de 🏹 e 🪨 +20%; 🔧 manutenção +50.",   cost: 100, moral: 0 },
  L34: { line: "tech", pos: 4, name: "Guilda dos Fumos",    desc: "Produção +18%; 🔧 manutenção +60.",            cost: 150, moral: -3 },
  L35: { line: "tech", pos: 5, name: "Cidade-Máquina",      desc: "Produção +25%; 🔧 manutenção +80.",            cost: 220, moral: -2 },
  // INOVAÇÃO — progresso para todos
  L36: { line: "inovacao", pos: 1, name: "Escolas Politécnicas", desc: "Produção +5% (eficiência para todos).",   cost: 40,  moral: 1 },
  L37: { line: "inovacao", pos: 2, name: "Lampiões de Argamato", desc: "Perdas de moral à noite -25%.",           cost: 80,  moral: 1 },
  L38: { line: "inovacao", pos: 3, name: "Medicina Moderna",     desc: "Tropas curam +3 por turno.",              cost: 125, moral: 2 },
  L39: { line: "inovacao", pos: 4, name: "Elevadores de Carga",  desc: "Caixas entregam +1 munição; 🔧 manutenção +90.", cost: 180, moral: 0 },
  L40: { line: "inovacao", pos: 5, name: "Renda do Progresso",   desc: "+8 🪙 por turno.",                        cost: 260, moral: 1 },
  // LENDÁRIAS — exigem as duas linhas vizinhas completas
  L41: { legend: ["moral", "profano"],       color: "#8b2fc9", name: "Vox Umbra",         desc: "O povo canta no escuro: 💎 por abate +50%.",              cost: 750, moral: -3 },
  L42: { legend: ["profano", "arcano"],      color: "#c0392b", name: "Coroa Carmesim",    desc: "Torres mágicas encadeiam +1 inimigo.",                    cost: 750, gem: 20, moral: -3 },
  L43: { legend: ["arcano", "cajado"],       color: "#e0a92f", name: "Olho do Turbilhão", desc: "Após turno perfeito, conjurar não gasta 💎.",             cost: 750, gem: 25, moral: 0 },
  L44: { legend: ["cajado", "muralha"],      color: "#8b2fc9", name: "Lex Arcanum",       desc: "Auras sobre tropas dão +1 escudo (absorve 1 golpe).",     cost: 750, gem: 20, moral: 1 },
  L45: { legend: ["muralha", "resistencia"], color: "#2f6fd6", name: "Muralha Viva",      desc: "A pedra respira: regenera +1 hit todo amanhecer.",        cost: 750, moral: 2 },
  L46: { legend: ["resistencia", "tech"],    color: "#e0a92f", name: "Cidadela de Ferro", desc: "+2 hits máximos e reparos +1.",                           cost: 750, moral: -2 },
  L47: { legend: ["tech", "inovacao"],       color: "#c0392b", name: "Motor Perpétuo",    desc: "Produção +20%, 🔧 manutenção +100 e o Capataz não reduz mais a moral.", cost: 750, moral: -1 },
  L48: { legend: ["inovacao", "moral"],      color: "#2f6fd6", name: "Carta do Povo",     desc: "Toda lei negativa pesa 1 a menos na moral.",              cost: 750, moral: 3 },
};
function law(id) { return S.laws && S.laws.includes(id); }
function lawLineKeys(line) { return Object.keys(LAWS).filter(k => LAWS[k].line === line).sort((a, b) => LAWS[a].pos - LAWS[b].pos); }
function lawLineComplete(line) { return lawLineKeys(line).every(k => law(k)); }
// lei disponível para assinar? (sequencial na linha; lendária = 2 linhas vizinhas completas)
function lawAvailable(id) {
  const d = LAWS[id];
  if (!d || law(id) || S.laws.length >= LAW_LIMIT) return false;
  if (d.legend) return d.legend.every(l => lawLineComplete(l));
  if (d.pos === 1) return true;
  const prev = lawLineKeys(d.line)[d.pos - 2];
  return law(prev);
}
// moral efetiva da lei (Carta do Povo alivia as negativas em 1)
function lawMoral(id) {
  const m = LAWS[id].moral;
  return m < 0 && law("L48") ? m + 1 : m;
}
function lawsMoralPerTurn() { return S.laws.reduce((s, id) => s + lawMoral(id), 0); }
// multiplicadores agregados das leis
function lawProdMult() {
  let b = 0;
  if (law("L29")) b += .10;
  if (law("L31")) b += .08;
  if (law("L32")) b += .12;
  if (law("L34")) b += .18;
  if (law("L35")) b += .25;
  if (law("L36")) b += .05;
  return (1 + b) * (law("L47") ? 1.2 : 1);
}
function lawTypeProdMult(type) {
  let m = 1;
  if (type === "essencia" && law("L7")) m *= 1.15;
  if ((type === "virotes" || type === "pedras") && law("L33")) m *= 1.2;
  return m;
}
function lawTowerMult(t) {
  let m = 1;
  const tt = TOWER_TYPES[t.type];
  if (tt.magic) { if (law("L11")) m *= 1.10; if (law("L15")) m *= 1.25; }
  if (S.isNight && law("L10")) m *= 1.15;
  if (S.hits === 1 && law("L30")) m *= 1.25; // Última Trincheira: fervor
  return m;
}
function lawCrateBonus(type) { return (type === "essencia" && law("L12")) ? 1 : 0; }

function maxHits() {
  return 5 + (law("L14") ? 1 : 0) + (law("L21") ? 1 : 0) + (law("L25") ? 2 : 0)
    + (law("L28") ? 1 : 0) + (law("L46") ? 2 : 0) + globalHitMaxFx() + facMaxHitsBonus();
}
function ammoCap() { return 10; }
// Ciclo de esteira mais lento: o throughput vira gargalo real (o "incêndio" logístico do início).
// Os bônus de esteira (Logística/Golem/Manutenção) passam a valer muito mais.
function supplyInterval() { return 4.2 * (1 - globalBeltBonus()); }
function crateSize() { return 2 + (law("L39") ? 1 : 0); }
// base 3s; Posto de Vigia +0,8s/nível (Lv5 = 7s); leis/praças somam por cima
function warnTime() { return Math.max(0.6, Math.min(7, 3 + (law("L22") ? 1 : 0) + globalWarnFx() + 0.8 * groupLvlSum("praca_vigia") + dm("warn", 0))); }
function rateBonus() { return 0; }
function armorFactor(e) { return e.armor; }
function factoryMult() { return 1; }
function slowFactor() { return 1; }
function burnDmg() { return 3; }
function hasBurn() { return false; }
function heartChanceMult() { return law("L41") ? 1.5 : 1; }
function incomeBonus() { return law("L40") ? 8 : 0; }
function lawIncomeMult() { return law("L4") ? 0.95 : 1; }
// Saque por morto cai depois do dia 10: os primeiros são recém-mortos cheios de itens;
// passado o dia 10, chegam os mortos ANTIGOS, já saqueados (metade do ouro por criatura).
const ELDERS_DAY = 10, ELDERS_LOOT_MULT = 0.5;
function killGoldMult() { return (S.day > ELDERS_DAY ? ELDERS_LOOT_MULT : 1) * (law("L6") ? 1.1 : 1); }
// Saque incerto: nem todo morto larga ouro, e a chance MINGUA a cada dia. É o freio
// da economia agora que a horda triplicou — mais abates, menos moedas por abate.
const GOLD_DROP_BASE = 0.50, GOLD_DROP_MIN = 0.15, GOLD_DROP_DECAY = 0.012;
function goldDropChance() {
  return Math.max(GOLD_DROP_MIN, GOLD_DROP_BASE - Math.max(0, S.day - 1) * GOLD_DROP_DECAY);
}
function heartsPerTurn() { return (law("L13") ? 1 : 0) + groupLvlSum("refinaria") + groupLvlSum("praca_cerimonial"); }

// ---------- Variantes de CONSTRUÇÕES (Lv1→5) ----------
// (As torres agora usam TOWER_PATHS — 3 caminhos. Isto cobre só fábricas/quartel/praças.)
// Lv2: escolha entre 3 caminhos. Lv3/4/5: escolha entre 2, dentro do caminho.
// fx: efeitos somados ao longo do path.
const VTREES = {
  fabrica: { l2: [
    { id: "massa", n: "Produção em Massa", d: "Produção +50%",                    fx: { pM: .5 } },
    { id: "artes", n: "Artesanal",         d: "Caixas levam +1 munição",          fx: { crate: 1 } },
    { id: "auto",  n: "Automatizada",      d: "Imune ao Sol Negro",               fx: { bsun: 1 } },
  ], br: {
    massa: {
      l3: [{ id: "turnos", n: "Turnos Dobrados",     d: "Produção +25%",           fx: { pM: .25 } },
           { id: "expans", n: "Expansão",            d: "Produção +15%",           fx: { pM: .15 } }],
      l4: [{ id: "linha",  n: "Linha Contínua",      d: "Produção +20%",           fx: { pM: .2 } },
           { id: "oper",   n: "Exército de Operários", d: "Evoluir custa metade",  fx: { disc: .5 } }],
      l5: [{ id: "mega",   n: "Megafábrica",         d: "Produção +100%",          fx: { pM: 1 } },
           { id: "sind",   n: "Sindicato",           d: "TODAS as fábricas deste tipo +20%", fx: { typeP: .2 } }],
    },
    artes: {
      l3: [{ id: "qual",  n: "Controle de Qualidade", d: "Caixas +1 de novo",      fx: { crate: 1 } },
           { id: "elite", n: "Munição de Elite",      d: "Torres deste tipo: +10% dano", fx: { typeDmg: .1 } }],
      l4: [{ id: "obra",  n: "Obra-prima",            d: "Caixas +1 de novo",      fx: { crate: 1 } },
           { id: "selo",  n: "Selo Real",             d: "Torres deste tipo: +15% dano", fx: { typeDmg: .15 } }],
      l5: [{ id: "forja", n: "Forja Lendária",        d: "Torres deste tipo: 10% de não gastar munição", fx: { typeSave: .1 } },
           { id: "perf2", n: "Perfeição",             d: "Caixas enchem a torre",  fx: { crate: 9 } }],
    },
    auto: {
      l3: [{ id: "golem",   n: "Golem de Carga", d: "Esteira 15% mais rápida",     fx: { belt: .15 } },
           { id: "noturna", n: "Noturna",        d: "+30% de produção à noite",    fx: { night: .3 } }],
      l4: [{ id: "repar",   n: "Autômato Reparador", d: "Repara 1 hit por dia",    fx: { repair: 1 } },
           { id: "redeE",   n: "Rede de Esteiras",   d: "Produção +10%",           fx: { pM: .1 } }],
      l5: [{ id: "senc",    n: "Fábrica Senciente",  d: "Produção +30%",           fx: { pM: .3 } },
           { id: "motor",   n: "Motor de Argamato",  d: "Produção +50%, custa 1 💎/dia", fx: { pM: .5, hUp: 1 } }],
    },
  }},
  quartel: { l2: [
    { id: "elite2", n: "Companhia de Elite", d: "Tropas aliadas: +15% de dano",     fx: { tD: .15 } },
    { id: "guarn",  n: "Guarnição",    d: "Bloqueia 1 inimigo no portão por turno", fx: { block: 1 } },
    { id: "arq",    n: "De Arqueiros", d: "Atira flechas fracas sozinho",           fx: { aD: 4, aR: 2.5 } },
  ], br: {
    elite2: {
      l3: [{ id: "veter",   n: "Veteranos",          d: "Tropas: +10% de dano",      fx: { tD: .1 } },
           { id: "instrut", n: "Mestres de Armas",   d: "Tropas: +15% de vida",      fx: { tHp: .15 } }],
      l4: [{ id: "real",    n: "Guarda Real",        d: "Tropas: +15% dano, custa 2 🪙/dia", fx: { tD: .15, gUp: 2 } },
           { id: "discip",  n: "Disciplina de Ferro",d: "Tropas: +15% de vida",      fx: { tHp: .15 } }],
      l5: [{ id: "lend",    n: "Lendários",          d: "Tropas: +30% de dano",      fx: { tD: .3 } },
           { id: "camp",    n: "Campeões",           d: "Tropas: +30% vida e +10% dano", fx: { tHp: .3, tD: .1 } }],
    },
    guarn: {
      l3: [{ id: "muralhaV", n: "Muralha Viva",  d: "Bloqueia +1 por turno",       fx: { block: 1 } },
           { id: "lanc",     n: "Lanceiros",     d: "Bloqueia +1 e tropas +10% vida", fx: { block: 1, tHp: .1 } }],
      l4: [{ id: "escudos",  n: "Escudos Altos", d: "Bloqueia +1 por turno",       fx: { block: 1 } },
           { id: "contra",   n: "Contra-ataque", d: "Bloqueios rendem 🪙 normal",  fx: { block: 1, bGold: 1 } }],
      l5: [{ id: "falange",  n: "Falange Eterna",d: "+1 hit máximo das muralhas",    fx: { hitMax: 1 } },
           { id: "ving",     n: "Vingança",      d: "Bloqueia +2 por turno",       fx: { block: 2 } }],
    },
    arq: {
      l3: [{ id: "longbow", n: "Longbows",           d: "Flechas +2 de dano",      fx: { aD: 2 } },
           { id: "supress", n: "Fogo de Supressão",  d: "Flechas deixam 20% lento", fx: { aSlow: .2 } }],
      l4: [{ id: "sarai",   n: "Saraivada",          d: "+1 alvo por rajada",      fx: { aT: 1 } },
           { id: "caca",    n: "Flechas de Caça",    d: "Flechas +3 de dano",      fx: { aD: 3 } }],
      l5: [{ id: "chuva",   n: "Chuva de Flechas",   d: "+3 alvos por rajada",     fx: { aT: 3 } },
           { id: "atirad",  n: "Atiradores de Elite",d: "Flechas ×2 de dano",      fx: { aD: 6 } }],
    },
  }},
  praca: { l2: [
    { id: "mercado",  n: "Mercado",         d: "+1 🪙 extra por vizinho",         fx: { gN: 1 } },
    { id: "oficina",  n: "Oficina Central", d: "+1% eficiência extra por vizinho", fx: { eN: .01 } },
    { id: "festival", n: "Festival",        d: "Vizinhos dão 🪙 E eficiência",     fx: { gN: .5, eN: .005 } },
  ], br: {
    mercado: {
      l3: [{ id: "feira", n: "Feira Livre",  d: "+1 🪙 por FÁBRICA vizinha",      fx: { gFab: 1 } },
           { id: "banco", n: "Banco",        d: "Renda do conselho +10%",         fx: { incM: .1 } }],
      l4: [{ id: "rota",  n: "Rota Comercial", d: "+1 🪙 por vizinho",            fx: { gN: 1 } },
           { id: "leilao",n: "Leilão",         d: "+1 🪙 por vizinho",            fx: { gN: 1 } }],
      l5: [{ id: "tesouro",n: "Tesouro Real",  d: "+3 🪙 por vizinho",            fx: { gN: 3 } },
           { id: "monop", n: "Monopólio",      d: "Renda do conselho +25%",       fx: { incM: .25 } }],
    },
    oficina: {
      l3: [{ id: "eng",    n: "Engenheiros",   d: "+1% por vizinho",              fx: { eN: .01 } },
           { id: "ferram", n: "Ferramentaria", d: "+2% por vizinho",              fx: { eN: .02 } }],
      l4: [{ id: "manut",  n: "Manutenção",    d: "Esteira 15% mais rápida",      fx: { belt: .15 } },
           { id: "inov",   n: "Inovação",      d: "+1% por vizinho",              fx: { eN: .01 } }],
      l5: [{ id: "distrito",n: "Distrito Industrial", d: "TODAS as fábricas +5%", fx: { gProd: .05 } },
           { id: "motorP", n: "Motor Perpétuo",       d: "+3% por vizinho",       fx: { eN: .03 } }],
    },
    festival: {
      l3: [{ id: "process", n: "Procissão", d: "+1 💎 se o turno fechar sem perder hit", fx: { hNoHit: 1 } },
           { id: "taverna", n: "Taverna",   d: "Moral global +5%",                fx: { moralG: .05 } }],
      l4: [{ id: "carna",   n: "Carnaval",  d: "+2% eficiência por vizinho",      fx: { eN: .02 } },
           { id: "vigilia", n: "Vigília",   d: "Avisos de chegada +1s",           fx: { warn: 1 } }],
      l5: [{ id: "sagrado", n: "Dia Sagrado",       d: "+2 💎 por turno sem perder hit", fx: { hNoHit: 2 } },
           { id: "coracao", n: "Coração da Cidade", d: "Bônus de vizinhança +50%",      fx: { adjM: .5 } }],
    },
  }},
};

// ============================================================================
// NOVO SISTEMA DE TORRES — 3 caminhos × 3 tiers (estilo Bloons TD)
// Regra crosspath 3+2: um caminho vai ao tier 3, um segundo até tier 2, o
// terceiro trava. As torres presentes aqui usam este sistema; as demais seguem
// nas VTREES antigas até serem convertidas (rollout incremental).
// Os `fx` reaproveitam as mesmas chaves das VTREES (d, r, pierce, poison, ...).
// ============================================================================
const TIER_COST_MULT = [0.8, 1.6, 3.2]; // custo do tier 1/2/3 = múltiplo do custo de construção
const TOWER_PATHS = {
  besta: {
    paths: [
      { key: "poder", name: "Poder", tiers: [
        { n: "Besta Pesada",    d: "Dano +60%, cadência −20%",                fx: { d: .6, r: -.2 } },
        { n: "Perfurante",      d: "Atravessa e acerta 1 atrás; dano +30%",   fx: { pierce: 1, d: .3 } },
        { n: "Balista Divina",  d: "O virote varre a lane inteira; dano +50%",fx: { pierce: 9, d: .5 } },
      ] },
      { key: "cadencia", name: "Cadência", tiers: [
        { n: "Besta de Repetição", d: "Cadência +50%, dano −20%",            fx: { r: .5, d: -.2 } },
        { n: "Metralha",           d: "Cadência +40%",                        fx: { r: .4 } },
        { n: "Tempestade de Virotes", d: "Cadência +60% e 25% de crítico ×2", fx: { r: .6, critC: .25, critM: 2 } },
      ] },
      { key: "veneno", name: "Veneno", tiers: [
        { n: "Besta Envenenada", d: "Os tiros envenenam (3/s por 3s)",        fx: { poison: 3 } },
        { n: "Necrosante",       d: "Veneno +3/s e espalha ao matar",         fx: { poison: 3, pSpread: 1 } },
        { n: "Praga Verde",      d: "Veneno +6/s; alvos abaixo de 15% morrem", fx: { poison: 6, exec: .15 } },
      ] },
    ],
  },
  catapulta: { paths: [
    { key: "poder", name: "Poder", tiers: [
      { n: "Contrapeso de Ferro", d: "Dano +50%",                        fx: { d: .5 } },
      { n: "Projétil Duplo",      d: "Dano ×2, consome 2 projéteis",     fx: { d: 1, cost: 1 } },
      { n: "Punho de Karzstak",   d: "Dano ×3, cadência −30%",           fx: { d: 2, r: -.3 } },
    ] },
    { key: "estilhaco", name: "Estilhaços", tiers: [
      { n: "De Estilhaços", d: "Área +50%, dano −25%",                   fx: { aoeM: .5, d: -.25 } },
      { n: "Bombardeio",    d: "+2 alvos, área +20%",                    fx: { extra: 2, aoeM: .2 } },
      { n: "Chuva de Meteoros", d: "+2 alvos, atordoa 1s",              fx: { extra: 2, stun: 1 } },
    ] },
    { key: "incend", name: "Incendiária", tiers: [
      { n: "Incendiária",   d: "Deixa fogo no chão do impacto",          fx: { ground: 4 } },
      { n: "Napalm Medieval", d: "Fogo +4/s e dura mais",                fx: { ground: 4, groundDur: 2 } },
      { n: "Inferno",       d: "Fogo +8/s, área maior",                  fx: { ground: 8, groundR: .05 } },
    ] },
  ] },
  caldeirao: { paths: [
    { key: "fervura", name: "Fervura", tiers: [
      { n: "Fervente",          d: "Dano +50%",                          fx: { d: .5 } },
      { n: "Ponto de Ebulição", d: "Dano +50% e queima 3/s",             fx: { d: .5, poison: 3 } },
      { n: "Óleo do Dragão",    d: "+2 alvos e queima +4/s",             fx: { extra: 2, poison: 4 } },
    ] },
    { key: "alcance", name: "Alcance", tiers: [
      { n: "Transbordante", d: "Alcança metade do campo",                fx: { range: .4 } },
      { n: "Cascata",       d: "+1 alvo e escorre 2 atrás",              fx: { extra: 1, pierce: 2 } },
      { n: "Dilúvio Negro", d: "Campo inteiro, cadência −30%",           fx: { rangeAll: 1, r: -.3 } },
    ] },
    { key: "alquimico", name: "Alquímico", tiers: [
      { n: "Alquímico",   d: "Ácido corrói resistências",               fx: { shredHit: 1 } },
      { n: "Catalisador", d: "Atingidos tomam +25% de tudo",            fx: { mark: .25 } },
      { n: "Dissolução",  d: "Ácido causa 5/s e dano +30%",             fx: { poison: 5, d: .3 } },
    ] },
  ] },
  tesla: { paths: [
    { key: "encad", name: "Encadeadora", tiers: [
      { n: "Encadeadora",   d: "+2 elos na cadeia",                      fx: { chain: 2 } },
      { n: "Rede Elétrica", d: "+2 elos e dano +30%",                    fx: { chain: 2, d: .3 } },
      { n: "Tempestade",    d: "+2 alvos extras e +2 elos",              fx: { extra: 2, chain: 2 } },
    ] },
    { key: "voltaica", name: "Voltaica", tiers: [
      { n: "Voltaica",    d: "Dano +70%",                               fx: { d: .7 } },
      { n: "Alta Tensão", d: "Dano +50% e área elétrica",               fx: { d: .5, aoeM: .3, aoeOn: 1 } },
      { n: "Zeus",        d: "Dano ×3.5, cadência −40%",                fx: { d: 2.5, r: -.4 } },
    ] },
    { key: "capac", name: "Capacitora", tiers: [
      { n: "Capacitora",    d: "33% de descarga crítica ×3",            fx: { critC: .33, critM: 3 } },
      { n: "Supercondutor", d: "Cadência +40%",                         fx: { r: .4 } },
      { n: "Singularidade", d: "Dano +150%",                            fx: { d: 1.5 } },
    ] },
  ] },
  canalizador: { paths: [
    { key: "focal", name: "Focalizador", tiers: [
      { n: "Focalizador",     d: "Dano +60%",                           fx: { d: .6 } },
      { n: "Prisma",          d: "25% de crítico ×3",                   fx: { critC: .25, critM: 3 } },
      { n: "Raio de Argamato", d: "Cadência +80% e dano +30%",          fx: { r: .8, d: .3 } },
    ] },
    { key: "difusor", name: "Difusor", tiers: [
      { n: "Difusor",     d: "O orbe ricocheteia p/ +1 alvo",           fx: { extra: 1 } },
      { n: "Teia de Mana", d: "+2 alvos conectados",                    fx: { extra: 2 } },
      { n: "Constelação", d: "+4 ricochetes",                           fx: { extra: 4 } },
    ] },
    { key: "umbral", name: "Umbral", tiers: [
      // O texto precisa dizer "tira" e "furando armadura": o bônus é somado DEPOIS da
      // redução por armadura (ver projectileHit), e é justamente isso que faz alguém
      // escolher este caminho em vez do Focalizador, que é dano puro e apanha da armadura.
      { n: "Umbral",    d: "Tira 5% da vida máx. do alvo, furando armadura", fx: { maxhp: .05 } },
      { n: "Maldição",  d: "Marcados tomam +30% de tudo",              fx: { mark: .3 } },
      { n: "Devorador de Almas", d: "Mais 5% da vida máx. (10% no total) e +15% de 💎", fx: { maxhp: .05, kh: .15 } },
    ] },
  ] },
  acido: { paths: [
    { key: "corrosao", name: "Corrosão", tiers: [
      { n: "Concentrado", d: "Dano +50%",                               fx: { d: .5 } },
      { n: "Água-Forte",  d: "Corrói resistências, dano +20%",          fx: { shredHit: 1, d: .2 } },
      { n: "Aqua Regia",  d: "+80% vs resistentes e dano +40%",         fx: { vsArm: .8, d: .4 } },
    ] },
    { key: "diluvio", name: "Dilúvio", tiers: [
      { n: "Aspersor",    d: "Área +50%",                               fx: { aoeM: .5 } },
      { n: "Chuva Ácida", d: "+1 alvo e área +30%",                     fx: { extra: 1, aoeM: .3 } },
      { n: "Tempestade Corrosiva", d: "+2 alvos e cadência +30%",       fx: { extra: 2, r: .3 } },
    ] },
    { key: "toxina", name: "Toxina", tiers: [
      { n: "Peçonhento",  d: "Veneno 3/s",                              fx: { poison: 3 } },
      { n: "Neurotóxico", d: "Envenenados 20% mais lentos",             fx: { pSlow: .2, poison: 2 } },
      { n: "Necrose",     d: "Veneno +5/s; abaixo de 15% morrem",       fx: { poison: 5, exec: .15 } },
    ] },
  ] },
  balista: { paths: [
    { key: "perfuracao", name: "Perfuração", tiers: [
      { n: "Vira-Aço",     d: "Atravessa e acerta 2 atrás",             fx: { pierce: 2 } },
      { n: "Perfurante",   d: "Dano +40% e +80% vs resistentes",        fx: { d: .4, vsArm: .8 } },
      { n: "Lança de Guerra", d: "Varre a lane e dano +60%",            fx: { pierce: 9, d: .6 } },
    ] },
    { key: "cadencia", name: "Cadência", tiers: [
      { n: "Manivela Dupla", d: "Cadência +50%",                        fx: { r: .5 } },
      { n: "Repetidora",     d: "Cadência +40% e 20% de crítico ×2",    fx: { r: .4, critC: .2, critM: 2 } },
      { n: "Metralha de Aço", d: "Cadência +60% e dano +20%",           fx: { r: .6, d: .2 } },
    ] },
    { key: "chamas", name: "Chamas", tiers: [
      { n: "Virote Flamejante", d: "Deixa fogo no impacto",             fx: { ground: 4 } },
      { n: "Óleo Fervente",  d: "Fogo +4/s e dura mais",                fx: { ground: 4, groundDur: 2 } },
      { n: "Ferrão Infernal", d: "Fogo +6/s; abaixo de 15% morrem",     fx: { ground: 6, exec: .15 } },
    ] },
  ] },
  canhao: { paths: [
    { key: "calibre", name: "Calibre", tiers: [
      { n: "Bala de Aço",  d: "Dano +60%",                              fx: { d: .6 } },
      { n: "Perfurante",   d: "+80% vs resistentes",                    fx: { vsArm: .8 } },
      { n: "Bomba de Cerco", d: "Dano ×2, cadência −20%",               fx: { d: 1, r: -.2 } },
    ] },
    { key: "bombardeio", name: "Bombardeio", tiers: [
      { n: "Metralha",  d: "+1 alvo e área +30%",                       fx: { extra: 1, aoeM: .3 } },
      { n: "Barragem",  d: "+2 alvos",                                  fx: { extra: 2 } },
      { n: "Tapete de Bombas", d: "+2 alvos e atordoa 1s",              fx: { extra: 2, stun: 1 } },
    ] },
    { key: "cadencia", name: "Cadência", tiers: [
      { n: "Recarga Rápida", d: "Cadência +40%",                        fx: { r: .4 } },
      { n: "Pólvora Seca",   d: "Cadência +40% e dano +20%",            fx: { r: .4, d: .2 } },
      { n: "Fogo de Barragem", d: "Cadência +60% e projétil rápido",    fx: { r: .6, fast: 1 } },
    ] },
  ] },
  cospefogo: { paths: [
    { key: "brasa", name: "Brasa", tiers: [
      { n: "Chama Viva",  d: "Dano +50%",                               fx: { d: .5 } },
      { n: "Piromancia",  d: "Queima 4/s",                              fx: { poison: 4 } },
      { n: "Dragão de Karzstak", d: "Dano +60% e queima +4/s",          fx: { d: .6, poison: 4 } },
    ] },
    { key: "napalm", name: "Napalm", tiers: [
      { n: "Piche Ardente", d: "Fogo no chão",                          fx: { ground: 4 } },
      { n: "Napalm",     d: "Fogo +4/s e dura mais",                    fx: { ground: 4, groundDur: 2 } },
      { n: "Mar de Chamas", d: "Fogo +8/s, área maior",                 fx: { ground: 8, groundR: .06 } },
    ] },
    { key: "sopro", name: "Sopro", tiers: [
      { n: "Foles Reforçados", d: "Alcance maior",                      fx: { range: .3 } },
      { n: "Labareda Larga", d: "+1 alvo e área +30%",                  fx: { extra: 1, aoeM: .3 } },
      { n: "Vendaval Ígneo", d: "Alcança ¾ do campo e +2 alvos",        fx: { range: .3, extra: 2 } },
    ] },
  ] },
  soprador: { paths: [
    { key: "geada", name: "Geada", tiers: [
      { n: "Congelante",     d: "Inimigos 30% mais lentos",             fx: { slow: .3 } },
      { n: "Nevoeiro Gélido", d: "Atordoa 1s",                          fx: { stun: 1 } },
      { n: "Zero Absoluto",  d: "50% lentos e atordoa 1s",              fx: { slow: .5, stun: 1 } },
    ] },
    { key: "nevasca", name: "Nevasca", tiers: [
      { n: "Rajada",   d: "Área +50%",                                  fx: { aoeM: .5 } },
      { n: "Ventania", d: "+1 alvo e área +30%",                        fx: { extra: 1, aoeM: .3 } },
      { n: "Nevasca",  d: "+2 alvos",                                   fx: { extra: 2 } },
    ] },
    { key: "corte", name: "Frio Cortante", tiers: [
      { n: "Estilhaço de Gelo", d: "Dano +60%",                         fx: { d: .6 } },
      { n: "Lâmina Glacial", d: "+80% vs resistentes",                  fx: { vsArm: .8 } },
      { n: "Inverno Eterno", d: "Dano +80%; abaixo de 15% morrem",      fx: { d: .8, exec: .15 } },
    ] },
  ] },
  prisma: { paths: [
    { key: "refracao", name: "Refração", tiers: [
      { n: "Lente Focal",  d: "Dano +60%",                              fx: { d: .6 } },
      { n: "Prisma Duplo", d: "25% de crítico ×3",                      fx: { critC: .25, critM: 3 } },
      { n: "Feixe Concentrado", d: "Dano ×2, cadência −20%",            fx: { d: 1, r: -.2 } },
    ] },
    { key: "espectro", name: "Espectro", tiers: [
      { n: "Dispersão", d: "+1 elo",                                    fx: { chain: 1 } },
      { n: "Arco-Íris", d: "+2 alvos",                                  fx: { extra: 2 } },
      { n: "Prisma Total", d: "+2 elos e +2 alvos",                     fx: { chain: 2, extra: 2 } },
    ] },
    { key: "luz", name: "Luz", tiers: [
      { n: "Marca de Luz", d: "Marcados tomam +25%",                    fx: { mark: .25 } },
      { n: "Radiância",   d: "+30% vs resistentes",                     fx: { vsArm: .3 } },
      { n: "Julgamento",  d: "Abaixo de 20% morrem",                    fx: { exec: .2 } },
    ] },
  ] },
  lancaacido: { paths: [
    { key: "corrosao", name: "Corrosão", tiers: [
      { n: "Concentrada", d: "Dano +50%",                              fx: { d: .5 } },
      { n: "Ácido Real",  d: "Corrói resistências",                    fx: { shredHit: 1, vsArm: .5 } },
      { n: "Solvente Universal", d: "Dano +60% e +80% vs resistentes", fx: { d: .6, vsArm: .8 } },
    ] },
    { key: "jato", name: "Jato", tiers: [
      { n: "Jato Pressurizado", d: "Perfura 2 atrás",                  fx: { pierce: 2 } },
      { n: "Lança Longa", d: "Mira o mais distante e perfura +2",      fx: { far: 1, pierce: 2 } },
      { n: "Lança de Guerra", d: "Varre a lane inteira",               fx: { pierce: 9 } },
    ] },
    { key: "pecanha", name: "Peçonha", tiers: [
      { n: "Venenosa",   d: "Veneno 3/s",                              fx: { poison: 3 } },
      { n: "Pestilenta", d: "Espalha ao matar e veneno +3/s",         fx: { pSpread: 1, poison: 3 } },
      { n: "Praga Ácida", d: "Veneno +5/s; abaixo de 15% morrem",      fx: { poison: 5, exec: .15 } },
    ] },
  ] },
  aquatico: { paths: [
    { key: "lamina", name: "Lâmina", tiers: [
      { n: "Corte Fino", d: "Dano +60%",                               fx: { d: .6 } },
      { n: "Jato de Pressão", d: "Perfura 2 atrás",                    fx: { pierce: 2 } },
      { n: "Lâmina Abissal", d: "Dano ×2 e perfura a lane",            fx: { d: 1, pierce: 9 } },
    ] },
    { key: "mare", name: "Maré", tiers: [
      { n: "Correnteza", d: "Alcança metade do campo",                 fx: { range: .4 } },
      { n: "Ressaca",    d: "+1 alvo e empurra",                       fx: { extra: 1, knock: .05 } },
      { n: "Maremoto",   d: "Campo inteiro e +1 alvo",                 fx: { rangeAll: 1, extra: 1 } },
    ] },
    { key: "turbilhao", name: "Turbilhão", tiers: [
      { n: "Redemoinho", d: "30% mais lentos",                         fx: { slow: .3 } },
      { n: "Vórtice",    d: "Atordoa 1s",                              fx: { stun: 1 } },
      { n: "Maelström",  d: "50% lentos e atordoa 1s",                 fx: { slow: .5, stun: 1 } },
    ] },
  ] },
  cacadores: { paths: [
    { key: "precisao", name: "Precisão", tiers: [
      { n: "Mira de Águia", d: "Dano +50%",                            fx: { d: .5 } },
      { n: "Tiro Certeiro", d: "25% de crítico ×2",                    fx: { critC: .25, critM: 2 } },
      { n: "Olho do Falcão", d: "45% de crítico ×3",                   fx: { critC: .45, critM: 3 } },
    ] },
    { key: "bumerangue", name: "Bumerangue", tiers: [
      { n: "Lâmina Curva", d: "+1 alvo",                               fx: { extra: 1 } },
      { n: "Voo Duplo",    d: "+2 alvos",                              fx: { extra: 2 } },
      { n: "Enxame de Lâminas", d: "+2 alvos e cadência +40%",         fx: { extra: 2, r: .4 } },
    ] },
    { key: "armadilha", name: "Armadilha", tiers: [
      { n: "Ponta Envenenada", d: "Veneno 3/s",                        fx: { poison: 3 } },
      { n: "Rede de Caça", d: "20% mais lentos",                       fx: { pSlow: .2, poison: 2 } },
      { n: "Cilada Mortal", d: "Marca +30%; abaixo de 15% morrem",     fx: { mark: .3, exec: .15 } },
    ] },
  ] },
  serras: { paths: [
    { key: "serra", name: "Serra", tiers: [
      { n: "Dente de Aço",  d: "Dano +50%",                            fx: { d: .5 } },
      { n: "Serra de Guerra", d: "+80% vs resistentes",               fx: { vsArm: .8 } },
      { n: "Roda Dentada",  d: "Dano ×2, cadência −20%",              fx: { d: 1, r: -.2 } },
    ] },
    { key: "velocidade", name: "Velocidade", tiers: [
      { n: "Eixo Lubrificado", d: "Cadência +50%",                     fx: { r: .5 } },
      { n: "Turbina",     d: "Cadência +40% e projétil rápido",        fx: { r: .4, fast: 1 } },
      { n: "Moedor",      d: "Cadência +60% e dano +20%",              fx: { r: .6, d: .2 } },
    ] },
    { key: "ricochete", name: "Ricochete", tiers: [
      { n: "Serra Saltitante", d: "+1 alvo",                           fx: { extra: 1 } },
      { n: "Estilhaços",  d: "+2 alvos e empurra",                     fx: { extra: 2, knock: .04 } },
      { n: "Triturador",  d: "+2 alvos; abaixo de 15% morrem",         fx: { extra: 2, exec: .15 } },
    ] },
  ] },
  mortenegra: { paths: [
    { key: "peste", name: "Peste", tiers: [
      { n: "Miasma",   d: "Veneno 4/s",                                fx: { poison: 4 } },
      { n: "Pandemia", d: "Espalha ao matar e veneno +3/s",            fx: { pSpread: 1, poison: 3 } },
      { n: "Peste Negra", d: "Veneno +6/s; abaixo de 20% morrem",      fx: { poison: 6, exec: .2 } },
    ] },
    { key: "ceifa", name: "Ceifa", tiers: [
      { n: "Foice Afiada", d: "Dano +60%",                             fx: { d: .6 } },
      { n: "Ceifadora",  d: "+80% vs resistentes",                     fx: { vsArm: .8 } },
      { n: "Colheita Sombria", d: "Dano ×2, cadência −20%",            fx: { d: 1, r: -.2 } },
    ] },
    { key: "terror", name: "Terror", tiers: [
      { n: "Aura de Medo", d: "30% mais lentos",                       fx: { slow: .3 } },
      { n: "Maldição",   d: "Marcados tomam +30%",                     fx: { mark: .3 } },
      { n: "Toque da Morte", d: "+2 alvos e área maior",               fx: { extra: 2, aoeM: .4 } },
    ] },
  ] },
  apagador: { paths: [
    { key: "aniquilacao", name: "Aniquilação", tiers: [
      { n: "Sobrecarga", d: "Dano +60%",                               fx: { d: .6 } },
      { n: "Desintegração", d: "Abaixo de 20% morrem",                 fx: { exec: .2 } },
      { n: "Vazio",      d: "Dano ×2; limiar de execução +5%",         fx: { d: 1, exec: .05 } },
    ] },
    { key: "cratera", name: "Cratera", tiers: [
      { n: "Onda de Choque", d: "+1 alvo e área +30%",                 fx: { extra: 1, aoeM: .3 } },
      { n: "Cratera",    d: "+2 alvos e atordoa 1s",                   fx: { extra: 2, stun: 1 } },
      { n: "Apocalipse", d: "+2 alvos e área +50%",                    fx: { extra: 2, aoeM: .5 } },
    ] },
    { key: "cadencia", name: "Cadência", tiers: [
      { n: "Ciclo Rápido", d: "Cadência +40%",                         fx: { r: .4 } },
      { n: "Detonação em Cadeia", d: "Cadência +40% e projétil rápido", fx: { r: .4, fast: 1 } },
      { n: "Fim de Tudo", d: "Cadência +60% e dano +30%",              fx: { r: .6, d: .3 } },
    ] },
  ] },
  raiosolar: { paths: [
    { key: "feixe", name: "Feixe", tiers: [
      { n: "Lente Solar", d: "Dano +70%",                              fx: { d: .7 } },
      { n: "Chama Solar", d: "25% de crítico ×3",                      fx: { critC: .25, critM: 3 } },
      { n: "Supernova",   d: "Dano ×2, cadência −20%",                 fx: { d: 1, r: -.2 } },
    ] },
    { key: "aurora", name: "Aurora", tiers: [
      { n: "Reflexo",     d: "+1 elo",                                 fx: { chain: 1 } },
      { n: "Prisma Solar", d: "+2 alvos",                              fx: { extra: 2 } },
      { n: "Aurora Boreal", d: "+2 elos e +2 alvos",                   fx: { chain: 2, extra: 2 } },
    ] },
    { key: "purificacao", name: "Purificação", tiers: [
      { n: "Luz Sagrada", d: "Marcados tomam +25%",                    fx: { mark: .25 } },
      { n: "Brasa Solar", d: "Deixa fogo no chão",                     fx: { ground: 5 } },
      { n: "Juízo Final", d: "Fogo +6/s; abaixo de 20% morrem",        fx: { ground: 6, exec: .2 } },
    ] },
  ] },
  midas: { paths: [
    { key: "ganancia", name: "Ganância", tiers: [
      { n: "Cunhagem Pesada", d: "Dano +60%",                          fx: { d: .6 } },
      { n: "Ouro Maciço", d: "+80% vs resistentes",                    fx: { vsArm: .8 } },
      { n: "Peso do Tesouro", d: "Dano ×2, cadência −20%",             fx: { d: 1, r: -.2 } },
    ] },
    { key: "chuvaouro", name: "Chuva de Ouro", tiers: [
      { n: "Moedas Espalhadas", d: "+1 alvo e área +30%",              fx: { extra: 1, aoeM: .3 } },
      { n: "Cofre Estourado", d: "+2 alvos",                           fx: { extra: 2 } },
      { n: "Fortuna",     d: "+2 alvos e área +40%",                   fx: { extra: 2, aoeM: .4 } },
    ] },
    { key: "toque", name: "Toque de Midas", tiers: [
      { n: "Toque Dourado", d: "+1 🪙 por abate",                      fx: { kg: 1 } },
      { n: "Alquimia Real", d: "+2 🪙 por abate e marca +25%",         fx: { kg: 2, mark: .25 } },
      { n: "Rei Midas",   d: "Abaixo de 20% viram ouro (+3 🪙)",       fx: { exec: .2, kg: 3 } },
    ] },
  ] },
  baladeira: { paths: [
    { key: "estilingue", name: "Estilingue", tiers: [
      { n: "Correia Reforçada", d: "Dano +60%",                        fx: { d: .6 } },
      { n: "Pedra Encantada", d: "25% de crítico ×3",                  fx: { critC: .25, critM: 3 } },
      { n: "Disparo Divino", d: "Dano ×2, cadência −20%",              fx: { d: 1, r: -.2 } },
    ] },
    { key: "ricochete", name: "Ricochete", tiers: [
      { n: "Salto Duplo", d: "+1 elo",                                 fx: { chain: 1 } },
      { n: "Estilhaço Astral", d: "+2 alvos",                          fx: { extra: 2 } },
      { n: "Chuva de Estrelas", d: "+2 elos e +2 alvos",               fx: { chain: 2, extra: 2 } },
    ] },
    { key: "encanto", name: "Encanto", tiers: [
      { n: "Selo de Sangue", d: "+10% de 💎 por abate",                fx: { kh: .1 } },
      { n: "Maldição",   d: "Marcados tomam +30%",                     fx: { mark: .3 } },
      { n: "Coração Partido", d: "+20% de 💎; abaixo de 20% morrem",   fx: { kh: .2, exec: .2 } },
    ] },
  ] },
  trabuco: { paths: [
    { key: "entulho", name: "Entulho", tiers: [
      { n: "Carga Pesada", d: "Dano +60%",                             fx: { d: .6 } },
      { n: "Ferro-Velho", d: "+80% vs resistentes",                    fx: { vsArm: .8 } },
      { n: "Demolidor",   d: "Dano ×2, cadência −20%",                 fx: { d: 1, r: -.2 } },
    ] },
    { key: "chuvalixo", name: "Chuva de Lixo", tiers: [
      { n: "Estilhaços",  d: "+1 alvo e área +30%",                    fx: { extra: 1, aoeM: .3 } },
      { n: "Sucata Voadora", d: "+2 alvos",                            fx: { extra: 2 } },
      { n: "Aterro",      d: "+2 alvos e atordoa 1s",                  fx: { extra: 2, stun: 1 } },
    ] },
    { key: "praga", name: "Praga", tiers: [
      { n: "Lixo Tóxico", d: "Veneno 4/s",                             fx: { poison: 4 } },
      { n: "Chorume",     d: "20% mais lentos",                        fx: { pSlow: .2, poison: 2 } },
      { n: "Peste Urbana", d: "Veneno +6/s e espalha",                 fx: { poison: 6, pSpread: 1 } },
    ] },
  ] },
  prisioneiros: { paths: [
    { key: "carne", name: "Carne", tiers: [
      { n: "Fardo Humano", d: "Dano +50%",                             fx: { d: .5 } },
      { n: "Impacto Brutal", d: "Empurra os atingidos e dano +30%",    fx: { knock: .05, d: .3 } },
      { n: "Aríete de Corpos", d: "Dano ×2, cadência −20%",            fx: { d: 1, r: -.2 } },
    ] },
    { key: "massa", name: "Massa", tiers: [
      { n: "Amontoado", d: "+1 alvo e área +30%",                      fx: { extra: 1, aoeM: .3 } },
      { n: "Legião",    d: "+2 alvos",                                 fx: { extra: 2 } },
      { n: "Vala Comum", d: "+2 alvos e área +40%",                    fx: { extra: 2, aoeM: .4 } },
    ] },
    { key: "terror", name: "Terror", tiers: [
      { n: "Gritaria", d: "30% mais lentos",                           fx: { slow: .3 } },
      { n: "Pânico",   d: "Atordoa 1s",                                fx: { stun: 1 } },
      { n: "Horror",   d: "Atordoa 1s; abaixo de 20% morrem",          fx: { stun: 1, exec: .2 } },
    ] },
  ] },
  // ===== Torres de SUPORTE (fx próprios: heal, buffAtk, buffT, dispelVuln, charmC, charmDur, charmN) =====
  ritualcura: { paths: [
    { key: "bencao", name: "Bênção", tiers: [
      { n: "Prece",          d: "+4 de cura por pulso",                fx: { heal: 4 } },
      { n: "Bálsamo Sagrado", d: "+8 de cura por pulso",               fx: { heal: 8 } },
      { n: "Milagre",        d: "+16 de cura por pulso",               fx: { heal: 16 } },
    ] },
    { key: "litania", name: "Litania", tiers: [
      { n: "Canto Rápido", d: "Cadência +40%",                         fx: { r: .4 } },
      { n: "Coro",       d: "Cadência +40% e +4 de cura",              fx: { r: .4, heal: 4 } },
      { n: "Êxtase",     d: "Cadência +70%",                           fx: { r: .7 } },
    ] },
    { key: "fe", name: "Fé", tiers: [
      { n: "Inspiração", d: "Tropas atacam +10% enquanto cura",        fx: { buffAtk: .1 } },
      { n: "Fervor",     d: "+15% de ataque e +4 de cura",             fx: { buffAtk: .15, heal: 4 } },
      { n: "Santidade",  d: "Tropas atacam +25%",                      fx: { buffAtk: .25 } },
    ] },
  ] },
  infusor: { paths: [
    { key: "vigor", name: "Vigor", tiers: [
      { n: "Fúria",   d: "Buff de ataque +10%",                        fx: { buffAtk: .1 } },
      { n: "Frenesi", d: "Buff de ataque +15%",                        fx: { buffAtk: .15 } },
      { n: "Berserk", d: "Buff de ataque +25%",                        fx: { buffAtk: .25 } },
    ] },
    { key: "duracao", name: "Duração", tiers: [
      { n: "Eco",        d: "Buff dura +1s",                           fx: { buffT: 1 } },
      { n: "Ressonância", d: "Buff dura +2s",                          fx: { buffT: 2 } },
      { n: "Perpétua",   d: "Buff dura +3s e ataque +10%",             fx: { buffT: 3, buffAtk: .1 } },
    ] },
    { key: "cadencia", name: "Cadência", tiers: [
      { n: "Ritmo",    d: "Cadência +40%",                             fx: { r: .4 } },
      { n: "Compasso", d: "Cadência +40% e cura leve (+4)",            fx: { r: .4, heal: 4 } },
      { n: "Sinfonia", d: "Cadência +70%",                             fx: { r: .7 } },
    ] },
  ] },
  holofote: { paths: [
    { key: "lente", name: "Lente", tiers: [
      { n: "Vidro Polido",   d: "+8% de crítico na lane acesa",        fx: { critC: .08 } },
      { n: "Cristal Focal",  d: "+15% de crítico na lane acesa",       fx: { critC: .15 } },
      { n: "Olho de Argamato", d: "+25% de crítico e crítico ×2,5",    fx: { critC: .25, critM: 2.5 } },
    ] },
    { key: "torre", name: "Torre", tiers: [
      { n: "Mancal Leve",    d: "Varre de lane 40% mais rápido",        fx: { r: .4 } },
      { n: "Rolamento Duplo", d: "Varre 70% mais rápido",               fx: { r: .7 } },
      { n: "Giro Livre",     d: "Varre 120% mais rápido",               fx: { r: 1.2 } },
    ] },
    { key: "facho", name: "Facho", tiers: [
      { n: "Espelho Côncavo", d: "Consome menos condutores",            fx: { save: .3 } },
      { n: "Refletor Duplo", d: "Reforça as tropas em +10%",            fx: { buffAtk: .1 } },
      { n: "Aurora",        d: "Reforça as tropas em +25%",             fx: { buffAtk: .25 } },
    ] },
  ] },
  moedor: { paths: [
    { key: "engrenagem", name: "Engrenagem", tiers: [
      { n: "Dentes Novos",  d: "Bônus das tropas +10%",                 fx: { buffAtk: .1 } },
      { n: "Eixo Reforçado", d: "Bônus das tropas +20%",                fx: { buffAtk: .2 } },
      { n: "Rolo de Ferro", d: "Bônus das tropas +40%",                 fx: { buffAtk: .4 } },
    ] },
    { key: "turno", name: "Turno", tiers: [
      { n: "Hora Extra",    d: "Bônus dura +8s",                        fx: { buffT: 8 } },
      { n: "Jornada Dobrada", d: "Bônus dura +15s",                     fx: { buffT: 15 } },
      { n: "Sem Descanso",  d: "Bônus dura +25s",                       fx: { buffT: 25 } },
    ] },
    { key: "esteira", name: "Esteira", tiers: [
      { n: "Alimentação Rápida", d: "Mói 40% mais rápido",              fx: { r: .4 } },
      { n: "Funil Largo",   d: "Mói 70% mais rápido",                   fx: { r: .7 } },
      { n: "Linha Contínua", d: "Mói 120% mais rápido e cura as tropas", fx: { r: 1.2, heal: 6 } },
    ] },
  ] },
  estoque: { paths: [
    // Armazém: o único caminho que sobe a capacidade, e o tier 3 bate exatamente nos
    // 50 do DEPOT_CAP_MAX — passar disso não faz nada, o teto trava por cima.
    { key: "armazem", name: "Armazém", tiers: [
      { n: "Prateleiras Altas", d: "Guarda 38 de munição",              fx: { stock: 8 } },
      { n: "Porão Escavado",  d: "Guarda 44 de munição",                fx: { stock: 14 } },
      { n: "Arsenal do Setor", d: "Guarda 50, o máximo do depósito",    fx: { stock: 20 } },
    ] },
    { key: "carregadores", name: "Carregadores", tiers: [
      { n: "Mais Braços",   d: "Entrega +2 de munição por vez",         fx: { feed: 2 } },
      { n: "Turno Dobrado", d: "Entrega +4 de munição por vez",         fx: { feed: 4 } },
      { n: "Corrente Humana", d: "Entrega +7 de munição por vez",       fx: { feed: 7 } },
    ] },
    { key: "disciplina", name: "Disciplina", tiers: [
      { n: "Munição Contada", d: "Vizinhas poupam +8% de munição",      fx: { adjSave: .08 } },
      { n: "Carga Ensaiada", d: "Vizinhas recarregam +10% mais rápido", fx: { adjRate: .1 } },
      { n: "Manual de Guerra", d: "Vizinhas: +18% de cadência e +15% de munição poupada", fx: { adjRate: .18, adjSave: .15 } },
    ] },
  ] },
  escolamagos: { paths: [
    { key: "dissonancia", name: "Dissonância", tiers: [
      { n: "Contra-Selo", d: "Selos rompidos ficam +10% vulneráveis", fx: { dispelVuln: .1 } },
      { n: "Anulação",  d: "+15% de vulnerabilidade ao romper",       fx: { dispelVuln: .15 } },
      { n: "Silêncio Arcano", d: "+25% de vulnerabilidade ao romper", fx: { dispelVuln: .25 } },
    ] },
    { key: "preceptor", name: "Preceptor", tiers: [
      { n: "Tutela",    d: "Reforço de +10% de ataque",               fx: { buffAtk: .1 } },
      { n: "Erudição",  d: "+5 de cura no reforço",                    fx: { heal: 5 } },
      { n: "Sabedoria", d: "+20% de ataque e +5 de cura",             fx: { buffAtk: .2, heal: 5 } },
    ] },
    { key: "cadencia", name: "Cadência", tiers: [
      { n: "Estudo Rápido", d: "Cadência +40%",                        fx: { r: .4 } },
      { n: "Trivium",   d: "Cadência +40% e +10% de vulnerabilidade",  fx: { r: .4, dispelVuln: .1 } },
      { n: "Quadrivium", d: "Cadência +70%",                           fx: { r: .7 } },
    ] },
  ] },
  propaganda: { paths: [
    { key: "retorica", name: "Retórica", tiers: [
      { n: "Discurso",     d: "+15% de chance de converter",          fx: { charmC: .15 } },
      { n: "Manifesto",    d: "+20% de chance de converter",          fx: { charmC: .2 } },
      { n: "Doutrinação",  d: "+40% de chance de converter",          fx: { charmC: .4 } },
    ] },
    { key: "legiao", name: "Legião", tiers: [
      { n: "Panfletos", d: "Conversão dura +2s",                       fx: { charmDur: 2 } },
      { n: "Comício",   d: "Converte +1 inimigo por vez",             fx: { charmN: 1 } },
      { n: "Revolução", d: "Converte +1 e dura +3s",                  fx: { charmN: 1, charmDur: 3 } },
    ] },
    { key: "cadencia", name: "Cadência", tiers: [
      { n: "Alto-Falante", d: "Cadência +40%",                         fx: { r: .4 } },
      { n: "Rede de Rádio", d: "Cadência +40% e +15% de chance",       fx: { r: .4, charmC: .15 } },
      { n: "Propaganda Total", d: "Cadência +70%",                     fx: { r: .7 } },
    ] },
  ] },
};
function towerPathsOf(t) { return TOWER_PATHS[t && t.type] || null; }
function isNewTower(t) { return !!towerPathsOf(t); }
function towerTiers(t) { // garante array [a,b,c]
  if (!Array.isArray(t.tiers)) t.tiers = [0, 0, 0];
  return t.tiers;
}
function towerTotalTiers(t) { return towerTiers(t).reduce((a, b) => a + b, 0); }
// custo (ouro) para comprar o PRÓXIMO tier do caminho pi
function towerTierCost(t, pi) {
  const cur = towerTiers(t)[pi];
  return Math.round(TOWER_TYPES[t.type].cost * TIER_COST_MULT[cur]);
}
// pode comprar o próximo tier do caminho pi? (regra crosspath 3+2)
function towerCanBuy(t, pi) {
  const tiers = towerTiers(t), cur = tiers[pi];
  if (cur >= 3) return false;
  const invested = tiers.filter(v => v > 0).length;
  if (cur === 0 && invested >= 2) return false;                 // terceiro caminho travado
  if (cur === 2 && tiers.some((v, i) => i !== pi && v >= 3)) return false; // só um caminho chega ao 3
  return true;
}
// caminho travado permanentemente (terceiro, quando dois já têm pontos)
function towerPathLocked(t, pi) {
  const tiers = towerTiers(t);
  return tiers[pi] === 0 && tiers.filter(v => v > 0).length >= 2;
}
function isTowerMaxed(t) {
  return isNewTower(t) ? Math.max(...towerTiers(t)) >= 3 : (t.lvl >= MAX_LVL);
}
// fx acumulado dos tiers comprados em todos os caminhos
function towerPathFx(t) {
  const out = {};
  const P = towerPathsOf(t), tiers = towerTiers(t);
  if (!P) return out; // torre sem caminhos definidos: sem bônus, mas sem derrubar o painel
  P.paths.forEach((p, pi) => {
    for (let i = 0; i < tiers[pi]; i++)
      for (const [k, v] of Object.entries(p.tiers[i].fx || {})) out[k] = (out[k] || 0) + v;
  });
  return out;
}
// nome exibido: último tier comprado no caminho de maior investimento
function towerPathName(t) {
  const P = towerPathsOf(t), tiers = towerTiers(t);
  let best = -1, name = null;
  if (!P) return name;
  P.paths.forEach((p, pi) => { if (tiers[pi] > best && tiers[pi] > 0) { best = tiers[pi]; name = p.tiers[tiers[pi] - 1].n; } });
  return name;
}

// Rebalanceamento extremo: renda cresce ~linear, custo cresce ~exponencial (×~1.9 no topo).
// O último nível é um "projeto" de end-game — o jogador nunca satura tudo cedo.
const EV_COST_TOWER = [0, 30, 65, 140, 300];  // climb cheio 535🪙 (era 215)
const EV_COST_BUILD = [0, 25, 55, 120, 260];  // climb cheio 460🪙 (era 190)
const MAX_LVL = 5;

// ---------- Prestígio de torres (objetivo opcional de end-game) ----------
// No nível máximo a torre pode PRESTIGIAR (mantém o build): +60% dano e +10% cadência
// PERMANENTES e empilháveis, até 3 vezes. Custo exponencial sobre o climb cheio (535🪙): ×3/×9/×27.
const PRESTIGE_MAX = 3;
const FULL_CLIMB_COST = EV_COST_TOWER.reduce((a, b) => a + b, 0); // 535
function prestigeOf(t) { return t.prestige || 0; }
function prestigeCost(p) { return FULL_CLIMB_COST * Math.pow(3, p + 1); } // p atual → 645/1935/5805
function prestigeDmgMult(t) { return Math.pow(1.6, prestigeOf(t)); }
function prestigeRateMult(t) { return Math.pow(1.1, prestigeOf(t)); }
const PRESTIGE_STAR = ["#f2d64a", "#ff5a4a", "#c89aff", "#ffd24a"]; // 0 amarela · 1 vermelha · 2 roxa · 3 dourada

function vTreeKeyOf(builtKey) {
  if (BUILDINGS[builtKey] && BUILDINGS[builtKey].prod) return "fabrica";
  if (builtKey === "quartel") return "quartel";
  if (builtKey === "praca_publica" || builtKey === "praca_trabalho") return "praca";
  return builtKey; // torres usam o próprio tipo
}

// opções para evoluir de lvl → lvl+1
function vOptions(treeKey, lvl, path) {
  const tr = VTREES[treeKey];
  if (!tr || lvl >= MAX_LVL) return null;
  if (lvl === 1) return tr.l2;
  const br = tr.br[path[0]];
  return br ? br["l" + (lvl + 1)] : null;
}

function vNodeDefs(treeKey, path) {
  const tr = VTREES[treeKey];
  if (!tr || !path || !path.length) return [];
  const out = [];
  const l2 = tr.l2.find(v => v.id === path[0]);
  if (l2) out.push(l2);
  const br = tr.br[path[0]];
  if (br) for (let i = 1; i < path.length; i++) {
    const opts = br["l" + (i + 2)];
    const node = opts && opts.find(v => v.id === path[i]);
    if (node) out.push(node);
  }
  return out;
}

// soma os fx do path (numéricos somam)
function vFx(treeKey, path) {
  const out = {};
  for (const node of vNodeDefs(treeKey, path)) {
    for (const [k, v] of Object.entries(node.fx || {})) out[k] = (out[k] || 0) + v;
  }
  return out;
}

function towerFx(t) { return isNewTower(t) ? towerPathFx(t) : vFx(t.type, t.path || []); }
function groupFx(gid) {
  const c = S.city.find(c => c.gid === gid);
  return c ? vFx(vTreeKeyOf(c.built), c.path || []) : {};
}
function vName(treeKey, path) {
  const defs = vNodeDefs(treeKey, path);
  return defs.length ? defs[defs.length - 1].n : null;
}

// agregados globais das variantes da cidade
function cityFxScan(pred, key) {
  let s = 0;
  const seen = new Set();
  for (const c of S.city) {
    if (!c.built || cellOff(c) || seen.has(c.gid)) continue;
    if (pred && !pred(c)) continue;
    seen.add(c.gid);
    s += vFx(vTreeKeyOf(c.built), c.path || [])[key] || 0;
  }
  return s;
}
function ammoTypeFx(type, key) { return cityFxScan(c => BUILDINGS[c.built] && BUILDINGS[c.built].prod === type, key); }
function globalBeltBonus() { return Math.min(.4, cityFxScan(null, "belt")); }
function globalProdBonus() { return cityFxScan(null, "gProd"); }
function globalMoralFx() { return cityFxScan(null, "moralG"); }
function globalAdjM() { return 1 + cityFxScan(null, "adjM"); }
function globalWarnFx() { return cityFxScan(null, "warn"); }
function globalIncM() { return 1 + cityFxScan(null, "incM"); }
function globalHitMaxFx() { return cityFxScan(null, "hitMax"); }

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $("canvas"), ctx = canvas.getContext("2d");

// ---------- Auras Mágicas (desenho de formas no campo) ----------
const SHAPES = {
  circle:   { ic: "⭕", name: "Círculo",   color: "#5aa9ff" },
  triangle: { ic: "🔺", name: "Triângulo", color: "#e0705f" },
  square:   { ic: "🟥", name: "Quadrado",  color: "#7ac36a" },
};
const SHAPE_KEYS = ["circle", "triangle", "square"];
const AURA_T = 30;
// Leis do Cajado: duração (L16 +3s, L20 ×2), força (L18 ×1.5 no bônus)
function auraDuration() { return (AURA_T + (law("L16") ? 3 : 0)) * (law("L20") ? 2 : 1); }
// ex.: 0.2 → 0.3 (lei) e +10% se a tropa jurou a ideologia Roxa
function auraPower(base, a) { return base * (law("L18") ? 1.5 : 1) * allyFacAuraMult(a); }
function clearAura(a) {
  if (a.aura && a.aura.type === "circle" && a.aura.shield) { a.maxHp -= a.aura.shield; a.hp = Math.min(a.hp, a.maxHp); }
  a.aura = null;
}
function applyAura(a, type) {
  clearAura(a); // auras não acumulam: a nova substitui
  const aura = { type, t: auraDuration() };
  if (type === "circle") { const sh = Math.round(a.maxHp * auraPower(0.5, a)); a.maxHp += sh; a.hp += sh; aura.shield = sh; } // escudo de HP
  if (law("L44")) a.lawShield = 1; // Lex Arcanum: absorve 1 golpe
  a.aura = aura;
}
// Conjurações (aura/dispel) custam 1 💎; L17 (a cada 2, a 3ª grátis) e L43 (grátis após turno perfeito)
function conjureCost() {
  if (law("L43") && S.freeConjure) return 0;
  S.conjCount = (S.conjCount || 0) + 1;
  if (law("L17") && S.conjCount % 3 === 0) return 0;
  return 1;
}
function drawAuraShape(type, x, y, r) {
  ctx.beginPath();
  if (type === "circle") ctx.arc(x, y, r, 0, 7);
  else if (type === "triangle") {
    for (let i = 0; i < 3; i++) { const ang = -Math.PI / 2 + i * 2 * Math.PI / 3, px = x + Math.cos(ang) * r, py = y + Math.sin(ang) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath();
  } else ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
  ctx.stroke();
}
function resample(pts, n) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const step = len / (n - 1);
  const out = [pts[0]]; let d = 0, prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    let cur = pts[i], segLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    while (d + segLen >= step && out.length < n) {
      const t = (step - d) / segLen;
      const np = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push(np); prev = np; segLen = Math.hypot(cur.x - prev.x, cur.y - prev.y); d = 0;
    }
    d += segLen; prev = cur;
  }
  while (out.length < n) out.push(pts[pts.length - 1]);
  return out;
}
// Reconhecimento TOLERANTE: conta "cantos" (clusters de curvatura) no traço fechado
function recognizeShape(pts) {
  if (pts.length < 8) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  if (Math.max(maxX - minX, maxY - minY) < 22) return null; // rabisco pequeno demais
  const N = 32, rs = resample(pts, N);
  const mark = new Array(N).fill(false);
  for (let i = 0; i < N; i++) {
    const p0 = rs[(i - 2 + N) % N], p1 = rs[i], p2 = rs[(i + 2) % N];
    const a1 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
    mark[i] = d > 0.9; // ~51°: vira canto
  }
  let corners = 0;
  for (let i = 0; i < N; i++) if (mark[i] && !mark[(i - 1 + N) % N]) corners++; // clusters circulares
  return corners <= 1 ? "circle" : corners <= 3 ? "triangle" : "square";
}
// Alvo: tropa/inimigo envolvido pela bbox do traço ou tocado por ele, mais perto do centro
function drawingTarget(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, cx = 0, cy = 0;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio, laneW = w / LANES;
  const hit = (x, y) => {
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) return true;
    for (const p of pts) if (Math.hypot(p.x - x, p.y - y) < 26) return true;
    return false;
  };
  let best = null, bestD = Infinity;
  const consider = (obj, kind) => {
    const x = obj.lane * laneW + laneW / 2, y = obj.y * h;
    if (!hit(x, y)) return;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestD) { bestD = d; best = { obj, kind }; }
  };
  for (const e of S.enemies) if (e.hp > 0) consider(e, "enemy");
  for (const a of S.allies) if (a.hp > 0) consider(a, "ally");
  return best;
}
// Tenta interpretar o traço como AURA. Retorna true se consumiu o gesto
// (aura em tropa aplicada, ou inimigo dispelado); senão false (vira linha de poder).
function tryAura(pts) {
  const tgt = drawingTarget(pts);
  if (!tgt) return false;
  const shape = recognizeShape(pts);
  if (!shape) return false;
  const o = tgt.obj;
  if (tgt.kind === "ally") {
    if (S.hearts < 1) { addFloat(o.lane, o.y, "Sem 💎", "#ff8a6a"); return true; }
    S.hearts -= conjureCost();
    applyAura(o, shape);
    addFloat(o.lane, o.y - 0.05, `${SHAPES[shape].ic} aura!`, SHAPES[shape].color);
    renderHUD();
    return true;
  }
  // inimigo: só consome se tiver aura e a forma bater
  if (o.aura && o.aura === shape && S.hearts >= 1) {
    S.hearts -= conjureCost();
    o.aura = null;
    if (law("L19")) { o.hp -= 10; addFloat(o.lane, o.y - 0.05, "⚡ pulso!", "#8ac6f0"); } // Pulso Contido
    addFloat(o.lane, o.y, "✦ dispelada!", "#eecd5c");
    renderHUD();
    return true;
  }
  return false; // forma errada / sem aura / sem 💎: deixa virar linha de poder (dano)
}

// ---------- Linhas de poder (botão direito / toque no campo) ----------
// Laser base (linha de poder) — habilidade inicial FRACA (melhorável no futuro).
// +30% em todo o cajado (laser, selos fechados e Zeta): no começo da run o jogador
// quase não tem torre, e o cetro é a única arma que não depende de economia.
const POWER_DPS = 3.9;        // dano por segundo, de leve, só uma ajuda (era 3)
const POWER_RADIUS = 13;      // alcance da linha em px (nerfado de 20)
const POWER_LIFE = 0.45;      // segundos até a linha se dissipar (some bem rápido)
const POWER_MAX_PTS = 20;     // limite de comprimento do traço = menos distância (nerfado de 36)
const SEAL_DMG = 20;          // dano extra do selo (traço fechado ao redor do inimigo) (era 15)
const SEAL_CLOSE_PX = 34;     // distância máxima entre início e fim para fechar o selo

// Tipos de SELO (nome ritual por forma). Fechados = fortes; traços abertos (letras) = mais fracos.
const SEALS = {
  alpha: { name: "Selo Alpha", ic: "🔺", closed: true,  dmg: SEAL_DMG, color: "#e0705f" }, // triângulo
  omega: { name: "Selo Omega", ic: "⭕", closed: true,  dmg: SEAL_DMG, color: "#5aa9ff" }, // círculo
  beta:  { name: "Selo Beta",  ic: "🟥", closed: true,  dmg: SEAL_DMG, color: "#7ac36a" }, // quadrado
  zeta:  { name: "Selo Zeta",  ic: "🇿",  closed: false, dmg: 9, cost: 1, color: "#c9b45a" }, // Z curto, custa 💎 (era 7)
};
// forma fechada reconhecida → chave do selo
function closedSealKey(shape) { return shape === "triangle" ? "alpha" : shape === "square" ? "beta" : "omega"; }

const ZETA_MAX_DIM = 130;     // Z precisa ser CURTO/compacto p/ ativar; traço longo = laser
// Conta "cantos" (viradas bruscas) num traço ABERTO
function openCorners(rs) {
  const N = rs.length, mark = new Array(N).fill(false);
  for (let i = 2; i < N - 2; i++) {
    const a1 = Math.atan2(rs[i].y - rs[i - 2].y, rs[i].x - rs[i - 2].x);
    const a2 = Math.atan2(rs[i + 2].y - rs[i].y, rs[i + 2].x - rs[i].x);
    let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
    mark[i] = d > 0.9;
  }
  let corners = 0;
  for (let i = 1; i < N; i++) if (mark[i] && !mark[i - 1]) corners++;
  return corners;
}
// Reconhece um traço ABERTO como Zeta (um Z CURTO com exatamente 2 cantos). Senão null (vira laser).
function recognizeStroke(pxPts) {
  if (pxPts.length < 6) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pxPts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const dim = Math.max(maxX - minX, maxY - minY);
  if (dim < 30 || dim > ZETA_MAX_DIM) return null;               // pequeno demais OU longo demais (=laser)
  const a = pxPts[0], b = pxPts[pxPts.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) <= SEAL_CLOSE_PX) return null; // fechado → selo forte, não aqui
  return openCorners(resample(pxPts, 32)) === 2 ? "zeta" : null; // Z = exatamente 2 cantos (rígido)
}
// Dano do selo aberto: atinge inimigos PERTO do traço (não há área fechada)
function strokeSealDamage(pxPts, seal) {
  if (!S.waveActive) return;
  const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio, laneW = w / LANES;
  const R = POWER_RADIUS * 1.6;
  for (const e of S.enemies) {
    if (e.hp <= 0) continue;
    const ex = e.lane * laneW + laneW / 2, ey = e.y * h;
    if (pxPts.some(p => Math.hypot(p.x - ex, p.y - ey) < R)) {
      e.hp -= seal.dmg;
      addFloat(e.lane, e.y - 0.04, `-${seal.dmg} ${seal.name}!`, seal.color);
      S.effects.push({ x: e.lane, y: e.y, life: 0.35, max: 0.35, type: "canalizador" });
    }
  }
}

// ponto dentro do polígono (ray casting), em frações do canvas
function pointInPoly(pt, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let drawingLine = null;

function canvasFrac(ev) {
  const r = canvas.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
}

// alvo (lane/ponto) a partir de coordenadas de tela — para a habilidade do Conselho
function fieldTargetFromClient(cx, cy) {
  const r = canvas.getBoundingClientRect();
  const x = (cx - r.left) / r.width, y = (cy - r.top) / r.height;
  return { lane: Math.max(0, Math.min(LANES - 1, Math.floor(x * LANES))), y: Math.max(0, Math.min(1, y)) };
}
// clique-direito (PC): habilidade ativa do Conselho no ponto mirado
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  useCouncil(fieldTargetFromClient(e.clientX, e.clientY));
});
// SEGURAR 2s (toque ou mouse): dispara a habilidade da Távola no ponto pressionado.
// (substitui os antigos 3-toques.) Mover o dedo cancela (é desenho de selo).
const COUNCIL_HOLD_MS = 1000;
const COUNCIL_RING_DELAY = 200; // só mostra o anel após este atraso (evita o "pisca" ao desenhar)
let councilHoldTimer = null, councilHoldStart = null, councilFired = false;
function startCouncilHold(e) {
  cancelCouncilHold();
  councilFired = false;
  councilHoldStart = { x: e.clientX, y: e.clientY };
  const r = canvas.getBoundingClientRect();
  const fracX = (e.clientX - r.left) / r.width, fracY = (e.clientY - r.top) / r.height;
  const tgt = fieldTargetFromClient(e.clientX, e.clientY);
  S.councilCharge = { fx: fracX, fy: fracY, t0: performance.now(), dur: COUNCIL_HOLD_MS };
  councilHoldTimer = setTimeout(() => {
    councilHoldTimer = null;
    councilFired = true;
    drawingLine = null;                 // não vira traço/selo
    S.councilCharge = null;
    // anima ao redor do ponto pressionado só quando a habilidade REALMENTE dispara
    if (useCouncil(tgt)) S.effects.push({ x: fracX * LANES - 0.5, y: fracY, life: 0.6, max: 0.6, type: "council" });
  }, COUNCIL_HOLD_MS);
}
function cancelCouncilHold() {
  if (councilHoldTimer) { clearTimeout(councilHoldTimer); councilHoldTimer = null; }
  councilHoldStart = null;
  S.councilCharge = null;
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.pointerType !== "touch") return; // botão esquerdo ou dedo
  e.preventDefault();
  drawingLine = { pts: [canvasFrac(e)], life: POWER_LIFE, max: POWER_LIFE };
  startCouncilHold(e); // segurar 2s = habilidade da Távola
  try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer já solto/sintético */ }
});

canvas.addEventListener("pointermove", (e) => {
  // mover o dedo/mouse além de um limiar cancela o "segurar" (está desenhando)
  if (councilHoldStart) {
    const dx = e.clientX - councilHoldStart.x, dy = e.clientY - councilHoldStart.y;
    if (dx * dx + dy * dy > 256) cancelCouncilHold(); // ~16px
  }
  if (!drawingLine) return;
  const p = canvasFrac(e);
  const last = drawingLine.pts[drawingLine.pts.length - 1];
  const r = canvas.getBoundingClientRect();
  const dx = (p.x - last.x) * r.width, dy = (p.y - last.y) * r.height;
  if (dx * dx + dy * dy > 36 && drawingLine.pts.length < POWER_MAX_PTS) drawingLine.pts.push(p);
});

function finishLine() {
  if (drawingLine && drawingLine.pts.length > 1) {
    const l = drawingLine;
    // AURA MÁGICA: converte o traço para pixels e tenta interpretar como forma sobre tropa/inimigo
    const cw = canvas.width / devicePixelRatio, ch = canvas.height / devicePixelRatio;
    const pxPts = l.pts.map(p => ({ x: p.x * cw, y: p.y * ch }));
    if (tryAura(pxPts)) { drawingLine = null; return; }
    const sealCentroid = () => {
      let cx = 0, cy = 0;
      for (const p of l.pts) { cx += p.x; cy += p.y; }
      S.effects.push({ x: (cx / l.pts.length) * LANES - 0.5, y: cy / l.pts.length, life: 0.5, max: 0.5, type: "seal" });
    };
    // SELO DE TRAÇO ABERTO (fraco): Zeta (um Z curto). Custa 💎 como os demais rituais.
    if (l.pts.length >= 6) {
      const strokeKey = recognizeStroke(pxPts);
      if (strokeKey) {
        const seal = SEALS[strokeKey];
        let cx = 0, cy = 0;
        for (const p of l.pts) { cx += p.x; cy += p.y; }
        const lane = (cx / l.pts.length) * LANES - 0.5, yc = cy / l.pts.length;
        if (S.hearts < (seal.cost || 0)) {
          addFloat(lane, yc, "Sem 💎", "#ff8a6a"); // sem cristal: vira só laser
        } else {
          S.hearts -= seal.cost || 0;
          l.sealKey = strokeKey;
          strokeSealDamage(pxPts, seal);
          sealCentroid();
          renderHUD();
        }
        S.powerLines.push(l);
        drawingLine = null; return;
      }
    }
    // SELO FECHADO (forte): forma reconhecida → Alpha (△) / Omega (○) / Beta (□), explode quem está dentro
    if (l.pts.length >= 6) {
      const r = canvas.getBoundingClientRect();
      const a = l.pts[0], b = l.pts[l.pts.length - 1];
      const dx = (a.x - b.x) * r.width, dy = (a.y - b.y) * r.height;
      if (dx * dx + dy * dy < SEAL_CLOSE_PX * SEAL_CLOSE_PX) {
        const sealKey = closedSealKey(recognizeShape(pxPts));
        const seal = SEALS[sealKey];
        l.seal = true; l.sealKey = sealKey;
        if (S.waveActive) {
          for (const e of S.enemies) {
            const pt = { x: (e.lane + 0.5) / LANES, y: e.y };
            if (pointInPoly(pt, l.pts)) {
              e.hp -= seal.dmg;
              addFloat(e.lane, e.y - 0.04, `-${seal.dmg} ${seal.name}!`, seal.color);
              S.effects.push({ x: e.lane, y: e.y, life: 0.35, max: 0.35, type: "canalizador" });
            }
          }
        }
        sealCentroid();
      }
    }
    S.powerLines.push(l);
  }
  drawingLine = null;
}
canvas.addEventListener("pointerup", () => {
  cancelCouncilHold();
  if (councilFired) { councilFired = false; drawingLine = null; return; } // já disparou a Távola
  finishLine();
});
canvas.addEventListener("pointercancel", () => { cancelCouncilHold(); drawingLine = null; });

function resizeCanvas() {
  // sincroniza o backing store ao tamanho REAL exibido do canvas (senão estica: astro oval)
  const w0 = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h0 = canvas.clientHeight || canvas.parentElement.clientHeight;
  const bw = Math.round(w0 * devicePixelRatio), bh = Math.round(h0 * devicePixelRatio);
  if (!bw || !bh) return;                                 // campo oculto: preserva o backing store
  if (canvas.width === bw && canvas.height === bh) return; // já sincronizado
  canvas.width = bw;
  canvas.height = bh;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
addEventListener("resize", resizeCanvas);      // cobre também mudança de zoom (devicePixelRatio)
new ResizeObserver(resizeCanvas).observe(canvas); // no lugar de medir o canvas a cada frame

// ---------- Cidade ----------
function initCity() {
  S.city = GRID_PLAN.map((z) => ({ zone: z, built: null, lvl: 0, gid: 0, path: [] }));
  S.feud = Array.from({ length: 25 }, () => ({ zone: "F", built: null, lvl: 0, gid: 0, path: [] }));
  S.field = "city";
  S.nextGid = 1;
}

function groupCells(gid) { return S.city.filter(c => c.gid === gid); }
function isFactory(c) { return !!(c.built && BUILDINGS[c.built].prod); }

// vizinhos (8 direções): "construções que se tocam"
function neighbors(i) {
  const r = Math.floor(i / 5), c = i % 5, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < 5 && cc >= 0 && cc < 5) out.push(rr * 5 + cc);
  }
  return out;
}

// Praças vizinhas: +eficiência por nível (base 1% da Praça do Trabalho + variantes)
function efficiencyAt(i) {
  let bonus = 0;
  for (const n of neighbors(i)) {
    const c = S.city[n];
    if ((c.built === "praca_trabalho" || c.built === "praca_publica") && !cellOff(c)) {
      const fx = vFx("praca", c.path || []);
      const base = c.built === "praca_trabalho" ? 0.01 : 0;
      bonus += (base + (fx.eN || 0)) * c.lvl;
    }
  }
  return 1 + bonus * globalAdjM();
}

// Produção por célula (munição por ciclo de esteira), com todos os mults.
// `gated` (padrão true) aplica a cobertura do tanque (0 se vazio); passe false
// para o POTENCIAL a pleno abastecimento.
function cellProdFull(i) {
  const c = S.city[i];
  if (cellOff(c)) return 0;
  const fx = vFx("fabrica", c.path || []);
  const type = BUILDINGS[c.built] && BUILDINGS[c.built].prod;
  let m = 1 + (fx.pM || 0) + globalProdBonus() + (type ? ammoTypeFx(type, "typeP") : 0);
  if (S.isNight && fx.night) m += fx.night;
  const eff = fx.bsun ? 1 : cityEff(); // Automatizada ignora o Sol Negro
  return cellGated(c) * efficiencyAt(i) * factoryMult() * eff * m * mioloProdMult() * lawTypeProdMult(type);
}
function cellProd(i) {
  const c = S.city[i];
  return cellProdFull(i) * feedCoverage(c.built, c.gid);
}

const CAPATAZ_MULT = 1.5;       // Capataz: produção da cidade acelerada...
const CAPATAZ_MORALE = 4;       // ...ao custo de moral por turno (≈8 por dia)
// Ajudar o Reino: munição excedente → medalhas. Era 100 ▸ 1 e rendia Medalha demais —
// um setor com fábricas sobrando comprava o Arsenal inteiro sem jogar bem. Os textos da
// interface leem esta constante, senão voltam a divergir dela no próximo ajuste.
const HELP_RATE = 1000;
// Toggles do Feudo (campo 2): custam MUITA moral por turno ativo
const FEUD_AID_RES = 5;         // Pedir Ajuda: +5 de cada recurso bruto por turno
const OVERDRIVE_MULT = 1.5;     // Sobrecarga: extratores rendem +50%
const FEUD_TOGGLE_MORALE = 6;   // moral perdida por turno, por toggle ativo
function feudOverdriveMult() { return S.feudOverdrive ? OVERDRIVE_MULT : 1; }
function prodEffMult() { return moraleEffMult() * dm("prod") * facProdMult() * (1 + 0.08 * groupLvlSum("laboratorio")) * (S.capataz ? CAPATAZ_MULT : 1) * lawProdMult() * favProdMult(); } // moral + evento + facção + Laboratório + Capataz + leis
function prodOfType(type) {
  let s = 0;
  S.city.forEach((c, i) => { if (isFactory(c) && BUILDINGS[c.built].prod === type) s += cellProd(i); });
  return s * prodEffMult();
}
function totalProdAll() {
  let s = 0;
  S.city.forEach((c, i) => { if (isFactory(c)) s += cellProd(i); });
  return s * prodEffMult();
}
function prodPerSec() { return totalProdAll() / supplyInterval(); }

// Quartéis não dão mais moral às torres (viraram buffs de tropa);
// só a Taverna (praça) mantém moral global.
function moralBoost() {
  return globalMoralFx();
}

// ---------- Posicionamento FLEXÍVEL (pintura) ----------
// Forma escolhida pelo jogador: pinta blocos contíguos (4 direções).
// Mínimo de blocos = tamanho da forma "clássica"; custo escala por bloco.
function bMinBlocks(key) { const d = defOf(key); return d.shape ? d.shape.length : (d.minBlocks || 1); }
function bCostPerBlock(key) { return defOf(key).cost / bMinBlocks(key); }
function paintCost(key, n) {
  const disc = isExtractor(key) ? mioloFeudCostMult() : 1; // Feitoria: desconto só no Feudo
  return Math.round(bCostPerBlock(key) * n * disc);
}

// grid ativo p/ posicionamento (segue a view: Cidade ou Feudo)
function placeGrid() { return S.field === "feud" ? S.feud : S.city; }

// bloco pintável: célula vazia e (na Cidade) da zona permitida do edifício.
// No Feudo não há zonas: qualquer terreno vazio serve.
function cellPlaceable(key, i) {
  const c = placeGrid()[i];
  if (!c || c.built) return false;
  if (S.field === "feud") return i !== FEUD_D; // não constrói no Centro de Distribuição
  return defOf(key).zones.includes(c.zone);
}

// vizinhos ortogonais (4 direções) — contiguidade dos blocos
function orthoNeighbors(i) {
  const r = Math.floor(i / 5), c = i % 5, out = [];
  if (r > 0) out.push(i - 5);
  if (r < 4) out.push(i + 5);
  if (c > 0) out.push(i - 1);
  if (c < 4) out.push(i + 1);
  return out;
}
function isContiguous(set) {
  if (set.size === 0) return false;
  const arr = [...set], seen = new Set([arr[0]]), stack = [arr[0]];
  while (stack.length) {
    for (const n of orthoNeighbors(stack.pop()))
      if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
  }
  return seen.size === set.size;
}

// forma clássica ancorada (preset inicial da pintura)
function shapeCellsAt(key, anchor) {
  const ar = Math.floor(anchor / 5), ac = anchor % 5;
  return BUILDINGS[key].shape.map(([r, c]) => {
    const rr = ar + r, cc = ac + c;
    return (rr < 0 || rr > 4 || cc < 0 || cc > 4) ? -1 : rr * 5 + cc;
  });
}
function seedPaint(key, anchor) {
  if (defOf(key).shape) {
    const cells = shapeCellsAt(key, anchor);
    if (cells.every(i => i >= 0 && cellPlaceable(key, i))) return new Set(cells);
  }
  return new Set([anchor]); // sem forma clássica (ou não coube): começa só na âncora
}

function startPaint(key, anchor) {
  closeModal();
  S.placing = { key, cells: seedPaint(key, anchor) };
  $("placebar").classList.remove("hidden");
  renderPlaceInfo();
  renderCity();
}

function paintToggle(i) {
  const { key, cells } = S.placing;
  if (cells.has(i)) {
    if (cells.size <= 1) return;                     // não esvazia
    const test = new Set(cells); test.delete(i);
    if (!isContiguous(test)) { toast("Remover aqui separaria o edifício."); return; }
    cells.delete(i);
  } else {
    if (!cellPlaceable(key, i)) { toast("Bloco inválido: terreno ocupado ou fora da zona."); return; }
    if (!orthoNeighbors(i).some(n => cells.has(n))) { toast("Os blocos precisam se encostar."); return; }
    cells.add(i);
  }
  renderPlaceInfo(); renderCity();
}

function paintValid() {
  if (!S.placing) return false;
  const { key, cells } = S.placing;
  return cells.size >= bMinBlocks(key) && isContiguous(cells)
    && S.gold >= paintCost(key, cells.size) && S.maos >= paintMaos(key, cells.size);
}

function renderPlaceInfo() {
  if (!S.placing) return;
  const { key, cells } = S.placing, b = defOf(key);
  const n = cells.size, min = bMinBlocks(key), cost = paintCost(key, n), maos = paintMaos(key, n);
  const maosTxt = maos > 0 ? ` ✋${maos}` : "";
  $("place-info").textContent = `${b.icon} ${b.name}: ${n} bloco${n > 1 ? "s" : ""} · 🪙${cost}${maosTxt} (mín ${min})`;
  updatePlaceOk();
}

function stopPlacing() {
  S.placing = null;
  $("placebar").classList.add("hidden");
  renderCity();
}

function updatePlaceOk() {
  $("place-ok").disabled = !paintValid();
}

$("place-cancel").onclick = stopPlacing;
$("place-ok").onclick = () => {
  if (!paintValid()) return;
  const { key, cells } = S.placing;
  S.gold -= paintCost(key, cells.size);
  S.maos -= paintMaos(key, cells.size);
  const gid = S.nextGid++;
  const idxs = [...cells];
  // extrator produtor nasce com vida base + durabilidade adjacente; estruturas são permanentes (life 0)
  // extratores ganham bônus de durabilidade; estruturas com prazo usam a vida crua
  const life = isProducerExtractor(key) ? extractorLife(key, idxs) : (defOf(key).life || 0);
  for (const i of cells) { const c = placeGrid()[i]; c.built = key; c.lvl = 1; c.gid = gid; c.path = []; c.life = life; }
  stopPlacing();
  renderAll();
};

// ---------- Navegação Cidade ↔ Feudo ----------
// A esteira vertical (#belt-v) é COMPARTILHADA pelos dois campos: as caixas de recurso
// do Feudo e as de munição da Cidade sobem pela mesma calha. Ao trocar de vista, as que
// já estavam em voo continuavam deslizando na tela errada. Esvaziar é só visual — os
// temporizadores de entrega já agendados seguem correndo e creditam tudo normalmente.
function clearBelts() {
  document.querySelectorAll("#belt-v .crate-v, #belt .crate").forEach(el => el.remove());
}
function toggleField() {
  S.field = S.field === "city" ? "feud" : "city";
  if (S.field === "feud" && S.placing) stopPlacing(); // não posiciona no Feudo
  clearBelts();
  renderCity();
}
function renderFieldToggle() {
  const btn = $("field-toggle");
  if (!btn) return;
  btn.classList.toggle("to-feud", S.field === "city");
  btn.title = S.field === "city" ? "Ir para O Feudo" : "Voltar à Cidade";
}

// ---------- Render: cidade / feudo ----------
function renderCity() {
  renderFieldToggle();
  renderResBar();
  const el = $("city");
  el.classList.toggle("is-feud", S.field === "feud");
  el.innerHTML = "";
  if (S.field === "feud") { renderFeud(el); return; }
  if (!S.waveActive) $("conveyor-v").classList.remove("running"); // esteira volta ao normal na Cidade
  const paintSet = S.placing ? S.placing.cells : null;
  const pvalid = S.placing ? paintValid() : false;
  S.city.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "cell z" + c.zone;
    if (c.zone === "D") {
      d.textContent = "D";
      const t = document.createElement("span");
      t.className = "tag"; t.id = "d-rate";
      t.textContent = `⚙${prodPerSec().toFixed(1)}/s`;
      d.appendChild(t);
    } else if (c.zone === "P") {
      d.textContent = "A"; // A de Arco dos Heróis (a zona segue sendo "P" no grid)
      const t = document.createElement("span");
      t.className = "tag";
      t.textContent = `${S.gateAuto ? "🔄" : ""}⚔${S.allies.length}/${ALLY_LIMIT}`;
      d.appendChild(t);
    } else if (c.built) {
      const b = BUILDINGS[c.built];
      d.classList.add("built", b.prod ? "b-fab" : c.built === "quartel" ? "b-quartel" : "b-praca");
      d.textContent = b.icon;
      if (cellOff(c)) {
        d.classList.add("off");
        const t = document.createElement("span");
        t.className = "tag"; t.textContent = "⏸";
        d.appendChild(t);
      } else {
        // fábrica desabastecida: estoque vazio (sem recurso do Feudo)
        if (factoryStarved(c)) d.classList.add("starved");
        if (c.lvl > 1) {
          const t = document.createElement("span");
          t.className = "tag"; t.textContent = "Lv" + c.lvl;
          d.appendChild(t);
        }
      }
    } else {
      d.classList.add("empty");
      d.textContent = c.zone === "1" ? "⌂" : c.zone === "2" ? "⚒" : "◇";
    }
    if (paintSet && paintSet.has(i)) d.classList.add(pvalid ? "place-ok" : "place-bad");
    d.onclick = () => onCellClick(i);
    el.appendChild(d);
  });
}

const FEUD_D = 4; // canto superior direito do grid 5×5 = Centro de Distribuição do Feudo

// soma de recursos gerados por turno no Feudo (todos os extratores produtores)
function feudResRates() {
  const rates = {}, groups = {};
  S.feud.forEach(c => { if (c.built && isProducerExtractor(c.built) && !cellOff(c)) (groups[c.gid] ||= []).push(c); });
  for (const gid in groups) { const cells = groups[gid], b = EXTRACTORS[cells[0].built]; rates[b.res] = (rates[b.res] || 0) + b.yield * cells.length * mioloYieldMult() * feudOverdriveMult(); }
  return rates;
}
function feudResPerTurn() { return Object.values(feudResRates()).reduce((a, b) => a + b, 0); }

function renderFeud(el) {
  const paintSet = S.placing ? S.placing.cells : null;
  const pvalid = S.placing ? paintValid() : false;
  $("conveyor-v").classList.add("running"); // a esteira leva os recursos ao Centro de Distribuição
  S.feud.forEach((c, i) => {
    const d = document.createElement("div");
    d.className = "cell zF";
    if (i === FEUD_D) {
      // Centro de Distribuição do Feudo (topo-direito): recebe os recursos da esteira
      d.className = "cell zD";
      d.textContent = "D";
      const t = document.createElement("span");
      t.className = "tag"; t.id = "feud-d-rate";
      t.textContent = `⚙${(feudResPerTurn() / FEED_TURN_SECONDS).toFixed(2)}/s`;
      d.appendChild(t);
      d.onclick = () => onFeudClick(i);
      el.appendChild(d);
      return;
    }
    if (c.built && EXTRACTORS[c.built]) {
      const b = EXTRACTORS[c.built];
      if (b.struct) {
        d.classList.add("built", "b-struct");
        d.textContent = b.icon;
        // estrutura com prazo mostra a contagem, igual aos extratores
        if (b.life) {
          const t = document.createElement("span");
          t.className = "tag";
          if (cellOff(c)) { t.textContent = "⏸"; d.classList.add("off"); }
          else {
            if ((c.life || 0) <= 2) d.classList.add("depleting");
            t.textContent = `⏳${c.life}`;
          }
          d.appendChild(t);
        }
      } else {
        d.classList.add("built", "b-extractor");
        d.textContent = b.icon;
        if (cellOff(c)) {
          d.classList.add("off");
          const t = document.createElement("span");
          t.className = "tag"; t.textContent = "⏸";
          d.appendChild(t);
        } else if (maintDone(c.gid)) {
          d.classList.add("maint"); // bateu o teto do turno: parado até o próximo
          const t = document.createElement("span");
          t.className = "tag"; t.textContent = "🔧";
          d.appendChild(t);
        } else {
          if ((c.life || 0) <= 2) d.classList.add("depleting"); // avisa que vai esgotar
          const t = document.createElement("span");
          t.className = "tag";
          t.textContent = `⏳${c.life}`;
          d.appendChild(t);
        }
      }
    } else {
      d.classList.add("empty");
      d.textContent = "·";
    }
    if (paintSet && paintSet.has(i)) d.classList.add(pvalid ? "place-ok" : "place-bad");
    d.onclick = () => onFeudClick(i);
    el.appendChild(d);
  });
}

// faixa de recursos: aparece SÓ na view do Feudo
// Barra de recursos: sempre presente (alinha as muralhas dos dois campos).
// Campo 1 (Cidade) = moedas globais 🪙💎✋; Campo 2 (Feudo) = recursos extraídos.
// Reconstrói a ESTRUTURA só aqui (troca de campo); os números vivos vêm do renderHUD.
function renderResBar() {
  const el = $("res-bar");
  if (!el) return;
  el.innerHTML = "";
  el.classList.remove("city-bar");
  let mid = el; // container central (na Cidade, agrupa as moedas entre os toggles)
  const item = (ic, val, id) => {
    const d = document.createElement("div");
    d.className = "fres";
    d.innerHTML = `<span class="fres-ic">${ic}</span><span class="fres-n"${id ? ` id="${id}"` : ""}>${val}</span>`;
    mid.appendChild(d);
  };
  // toggles de política (Cidade e Feudo): pill com bolinha, tudo ancorado no centro
  const TOG_MSG = {
    capataz:       ["👊 Capataz ativo: produção acelerada, o povo sofre (-moral por turno).", "O Capataz foi dispensado."],
    helpKingdom:   [`🎖️ Ajudando o Reino: munição excedente vira Medalhas (${HELP_RATE} ▸ 1).`, "O setor voltou a guardar seu excedente."],
    feudAid:       [`🆘 Pedindo ajuda ao Reino: +${FEUD_AID_RES} de cada material bruto por turno, mas o povo perde muita moral.`, "O setor dispensou a ajuda do Reino."],
    feudOverdrive: ["⚙️ Sobrecarga: os extratores rendem +50%, mas o povo perde muita moral por turno.", "Os extratores voltaram ao ritmo normal."],
  };
  const tog = (label, key, title) => {
    const blocked = key === "helpKingdom" && !S.helpKingdom && helpKingdomBlocked();
    const b = document.createElement("button");
    b.className = "fres-toggle" + (S[key] ? " on" : "") + (blocked ? " tg-blocked" : "");
    b.title = blocked ? `Travado: precisa de ${HELP_MIN_RES} de cada recurso do Feudo (menor agora: ${Math.floor(helpResFloor())})` : title;
    b.innerHTML = `<span class="tg-l">${label}</span><span class="tg-dot"></span>`;
    b.onclick = () => {
      if (blocked) {
        toast(`🎖️ Para ajudar o Reino, cada recurso do Feudo precisa de pelo menos ${HELP_MIN_RES} (o menor está em ${Math.floor(helpResFloor())}).`);
        return;
      }
      S[key] = !S[key];
      toast(TOG_MSG[key][S[key] ? 0 : 1]);
      saveGame(); renderResBar(); renderHUD();
    };
    el.appendChild(b);
  };
  el.classList.add("city-bar"); // toggles + moedas ancorados no centro
  if (S.field === "feud") {
    tog("Pedir Ajuda", "feudAid", `Recebe +${FEUD_AID_RES} de cada material bruto do Reino por turno, mas perde muita moral enquanto ativo`);
    mid = document.createElement("div");
    mid.className = "fres-mid";
    el.appendChild(mid);
    for (const [key, r] of Object.entries(RESOURCES)) item(r.icon, Math.trunc(S.res[key] || 0));
    tog("Sobrecarga", "feudOverdrive", "Extratores produzem +50%, mas o povo perde muita moral enquanto ativo");
  } else {
    tog("Ajudar Reino", "helpKingdom", `Envia a munição excedente para outros setores: ${HELP_RATE} munições ▸ 1 🎖️ Medalha`);
    mid = document.createElement("div");
    mid.className = "fres-mid";
    el.appendChild(mid);
    item("🪙", Math.trunc(S.gold), "res-gold");
    item("💎", Math.trunc(S.hearts), "res-hearts");
    item("✋", `${Math.trunc(S.maos)}/${maosCap()}`, "res-maos");
    tog("Ativar Capataz", "capataz", "Acelera toda a produção da cidade, mas o povo perde moral a cada turno");
  }
}

// Números de recurso ao vivo. A barra e o resumo de "Seu Setor" leem o MESMO estado a
// cada frame — a produção corre continuamente, então esperar por um renderHUD deixava
// os dois defasados. Só encosta no DOM quando o texto muda de fato.
function setText(el, txt) {
  if (!el || el.textContent === txt) return;
  const hadValue = el.textContent !== "";
  el.textContent = txt;
  // Pulso curto no número que mudou: o ganho vira um evento visível sem poluir o campo
  // com mais um float. Web Animations em vez de trocar classe, que forçaria reflow a
  // cada moeda ganha — e o campo já desenha a 60fps ao lado.
  if (hadValue && el.animate) {
    el.animate([{ transform: "scale(1)" }, { transform: "scale(1.22)" }, { transform: "scale(1)" }],
      { duration: 240, easing: "ease-out" });
  }
}
// Número de recurso com marca de dívida. O saldo negativo precisa ser LIDO, não
// deduzido: sem o vermelho o jogador só descobre que devia quando a moral despenca.
// Math.trunc e não floor: floor(-3.2) = -4 mostraria uma dívida maior que a real.
function setResText(el, val, txt) {
  setText(el, txt);
  if (el) el.classList.toggle("neg", val < 0);
}
function syncLiveRes() {
  syncCloudShade(); // a camada de nuvens acompanha clima, ciclo e tamanho do layout
  const bar = $("res-bar");
  if (bar) {
    if (S.field === "feud") {
      const ns = bar.querySelectorAll(".fres-mid .fres-n");
      Object.keys(RESOURCES).forEach((k, i) => {
        const v = S.res[k] || 0;
        setResText(ns[i], v, String(Math.trunc(v)));
      });
    } else {
      setResText($("res-gold"), S.gold, String(Math.trunc(S.gold)));
      setResText($("res-hearts"), S.hearts, String(Math.trunc(S.hearts)));
      setResText($("res-maos"), S.maos, `${Math.trunc(S.maos)}/${maosCap()}`);
    }
  }
  if ($("modal").classList.contains("hidden")) return;
  const line = $("modal").querySelector(".dist-res .dr-line");
  if (!line) return;
  const html = distResHTML();
  if (line.innerHTML !== html) line.innerHTML = html;
}

function openFeudDist() {
  openModal("⚙️ Centro de Distribuição", (m) => {
    const hint = document.createElement("div"); hint.className = "panel-hint";
    hint.textContent = "Os extratores enviam seus recursos pela esteira até aqui. É deste ponto que a retaguarda abastece as fábricas da cidade.";
    m.appendChild(hint);
    const rates = feudResRates();
    if (!Object.keys(rates).length) {
      const d = document.createElement("div"); d.className = "panel-hint"; d.textContent = "Nenhum extrator ativo no Feudo.";
      m.appendChild(d); return;
    }
    for (const [res, r] of Object.entries(rates)) {
      const meta = resMeta(res), d = document.createElement("div"); d.className = "wave-row";
      d.innerHTML = `<span class="wicon">${meta.icon}</span><span class="wname">${meta.name}</span><span class="wcount">+${(r / FEED_TURN_SECONDS).toFixed(2)}/s</span>`;
      m.appendChild(d);
    }
  });
}

// Painel repaginado dos extratores/estruturas do Feudo (layout simples, sem barras)
function openExtractorPanel(i) {
  const c = S.feud[i], b = EXTRACTORS[c.built], gid = c.gid;
  const cells = S.feud.filter(x => x.gid === gid);
  const off = cellOff(c);
  openModal("", (m) => {
    const wrap = document.createElement("div");
    wrap.className = "bd";
    let desc, fx, maint = ""; // estruturas não extraem: não têm cota de manutenção
    if (b.struct) {
      desc = b.role === "feitor"
        ? "Reconstrói automaticamente os extratores adjacentes que esgotarem, pagando o ouro de construção. Sem ouro, o extrator some."
        : `Extratores adjacentes ganham +${b.dur} turnos de vida (ao construir/reconstruir).`;
      fx = b.life
        ? `◆ Estrutura com prazo · ⏳ expira em ${c.life} turno(s)`
        : "◆ Estrutura permanente.";
    } else {
      const r = resMeta(b.res);
      desc = `Arranca ${r.name.toLowerCase()} da terra para sustentar as fábricas da Cidade.`;
      fx = `◆ Extrai ${r.icon} ${r.name}: +${(b.yield * cells.length / FEED_TURN_SECONDS).toFixed(2)}/s · ${cells.length} bloco(s) · ⏳ esgota em ${c.life} turno(s)`;
      maint = `🔧 Manutenção: <b>${Math.floor(maintOut(c.gid))}/${maintCap()}</b> extraídos neste turno`;
    }
    wrap.innerHTML = `<div class="bd-art"><span class="bd-art-ic">${b.icon}</span></div>
      <div class="bd-title">${b.name.toUpperCase()}</div>
      ${BUILD_FLAVOR[c.built] ? `<div class="bd-flavor">${BUILD_FLAVOR[c.built]}</div>` : ""}
      <div class="bd-desc">${desc}</div>
      <div class="bd-fx">${fx}</div>
      ${maint ? `<div class="bd-maint">${maint}${maintDone(c.gid) ? ": <b>EM MANUTENÇÃO</b>, volta no próximo turno." : ""}</div>` : ""}
      ${bdSectionHTML(off, !!b.struct, "")}`;
    m.appendChild(wrap);
    bdWireCommon(wrap, off, cells, null, () => openExtractorPanel(i));
  });
}

function onFeudClick(i) {
  const c = S.feud[i];
  if (S.placing) { paintToggle(i); return; }
  if (i === FEUD_D) { openFeudDist(); return; } // Centro de Distribuição
  if (c.built && EXTRACTORS[c.built]) { openExtractorPanel(i); return; }
  // terreno vazio: escolher extrator ou estrutura (mesmo layout do campo 1)
  openModal("⚒ O Feudo · Construir", (m) => {
    const hint = document.createElement("div");
    hint.className = "bp-hint";
    hint.textContent = "A retaguarda que sustenta a guerra: extratores rendem recursos e esgotam; estruturas automatizam. Escolha e pinte os blocos.";
    m.appendChild(hint);
    const grid = document.createElement("div");
    grid.className = "bp-grid";
    for (const [key, b] of Object.entries(EXTRACTORS)) {
      const min = b.minBlocks || 1;
      const canAfford = S.gold >= b.cost;
      const r = b.struct ? null : resMeta(b.res);
      const desc = b.struct ? b.desc : `Extrai ${r.icon} ${r.name} para as fábricas da Cidade.`;
      const timeChip = b.struct
        ? (b.life ? `<span class="bp-chip">⏳ ${b.life}t</span>` : `<span class="bp-chip">♾ permanente</span>`)
        : `<span class="bp-chip">⏳ esgota ${b.life}t</span>`;
      const yieldChip = b.struct ? "" : `<span class="bp-chip res">${r.icon} +${b.yield}/bloco</span>`;
      const card = document.createElement("button");
      card.className = "bp-card";
      card.disabled = !canAfford;
      card.innerHTML = `<span class="bp-ic">${b.icon}</span>
        <span class="bp-body">
          <span class="bp-name">${b.name}</span>
          <span class="bp-desc">${desc}</span>
          <span class="bp-chips">
            <span class="bp-chip gold">🪙 ${Math.round(bCostPerBlock(key))}/bloco</span>
            ${yieldChip}
            <span class="bp-chip">◼ mín ${min}</span>
            ${timeChip}
          </span>
        </span>`;
      card.onclick = () => startPaint(key, i);
      grid.appendChild(card);
    }
    m.appendChild(grid);
  });
}

// toast leve e transitório (reutilizável)
let _toastTimer = null;
function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function renderSupplyRate() {
  const t = $("d-rate");
  if (t) t.textContent = `⚙${prodPerSec().toFixed(1)}/s`;
}

// ---------- Painel de construção (Cidade e Feudo): layout repaginado ----------
// Texto de ambientação de cada construção (exibido no painel)
const BUILD_FLAVOR = {
  fab_virotes:    "Penas, madeira e ponta de ferro: o pão de cada dia das bestas.",
  fab_pedras:     "Artesãos moldam projéteis para as catapultas sem descanso.",
  fab_oleo:       "Barris borbulham dia e noite. Ninguém acende vela por perto.",
  fab_essencia:   "Alquimistas destilam colheita em pura energia arcana.",
  fab_condutores: "Bobinas e fios trançados canalizam o trovão da Tesla.",
  fab_quimicos:   "Vapores verdes escapam das frestas. O cheiro avisa antes da placa.",
  quartel:        "Beliches apertados e aço afiado: aqui dorme a linha de frente.",
  cortico:        "Apertado, barulhento e cheio de vida: braços novos para as muralhas.",
  praca_publica:  "O coração do distrito: feiras, fofocas e impostos.",
  praca_trabalho: "Sinos marcam os turnos; as construções vizinhas rendem mais.",
  praca_vigia:    "Do alto da torre, o vigia enxerga a horda antes de todos.",
  praca_festival: "Música contra o medo: enquanto houver dança, há esperança.",
  praca_jardim:   "Um respiro verde entre muros: os feridos saram mais rápido.",
  praca_militar:  "Campo de treino: cada golpe ensaiado aqui vale um lá fora.",
  praca_chique:   "Mármore importado e ouro fácil. A nobreza agradece.",
  praca_abandonada: "Saqueadores reviram os escombros: lucro com gosto de poeira.",
  praca_cerimonial: "Velas acesas pelos que se foram alimentam o cristal.",
  praca_estranha: "Ninguém sabe quem a construiu. Às vezes ela retribui.",
  capela:         "Orações baixas costuram os feridos de volta à linha.",
  estabulo:       "Cascos ferrados e crina ao vento: as tropas marcham mais rápido.",
  tesouraria:     "Cofres trancados a sete chaves rendem juros de guerra.",
  laboratorio:    "Engrenagens, retortas e ideias perigosas: a produção agradece.",
  templo:         "A fé sobe em cânticos e volta em coragem, turno após turno.",
  oficina:        "Andaimes permanentes: as muralhas se remendam sem parar.",
  refinaria:      "Prensa o pó de Argamato em cristais que pulsam como corações.",
  // Feudo
  mina:           "Picaretas ecoam no escuro atrás do minério que vira munição.",
  poco:           "O óleo negro da terra sobe em baldes para mover a guerra.",
  entreposto:     "Caixas, cordas e lonas: tudo que a cidade consome passa por aqui.",
  alojamento:     "Camas quentes atraem trabalhadores para as Mãos do reino.",
  roca:           "Fileiras de trigo teimam em crescer à sombra da horda.",
  feitor:         "O capataz não dorme: extrator que esgota, ele reergue cobrando o preço.",
  deposito:       "Ferramentas de reserva esticam a vida dos extratores vizinhos.",
};
// Cabeçalho (emoji + barras nas fábricas; arte nas demais), título, descrição,
// faixa [🗑 | -MELHORIAS- | ⏻] e as opções de evolução em cartas.
// Barras cíclicas: enchem e esvaziam no ritmo real do ciclo (1 unidade por ciclo).
// duração do ciclo = 1/taxa (limitada p/ legibilidade); taxa 0 = barra parada e vazia.
// rate>0: barra cicla (enche/esvazia) no ritmo real. rate<=0: parada, estática
// no nível `staticFrac` (0 = vazia; 1 = cheia).
function bdBarHTML(cls, rate, staticFrac) {
  if (rate <= 0) return `<div class="bd-bar ${cls}"><span class="bd-fill" style="width:${Math.round(Math.max(0, Math.min(1, staticFrac || 0)) * 100)}%"></span></div>`;
  const dur = Math.max(0.5, Math.min(8, 1 / rate)).toFixed(2);
  return `<div class="bd-bar ${cls}"><span class="bd-fill cyc" style="animation-duration:${dur}s"></span></div>`;
}
function bdBarsHTML(recLabel, recRate, sendLabel, sendRate, recStatic, sendStatic) {
  return `<div class="bd-bars">
    <div class="bd-bar-label">${recLabel}</div>
    ${bdBarHTML("red", recRate, recStatic)}
    <div class="bd-bar-label">${sendLabel}</div>
    ${bdBarHTML("gold", sendRate, sendStatic)}
  </div>`;
}
// `label` = título da faixa; passe "" no Feudo, onde não há melhorias a oferecer.
function bdSectionHTML(off, noPow, label = "-MELHORIAS-") {
  return `<div class="bd-sec">
    <button class="bd-round" id="bd-del" title="Demolir (sem reembolso)">🗑</button>
    <span class="bd-sec-t">${label}</span>
    ${noPow ? `<span class="bd-round bd-ghost"></span>` : `<button class="bd-round${off ? " bd-off" : ""}" id="bd-pow" title="${off ? "Religar estrutura" : "Desativar estrutura"}">⏻</button>`}
  </div>${off ? `<div class="bd-off-note">⏸ ESTRUTURA DESATIVADA: efeitos e consumo pausados.</div>` : ""}`;
}
function bdUpCard(icon, costTxt, name, desc, enabled, fn) {
  const b = document.createElement("button");
  b.className = "bd-up";
  b.disabled = !enabled;
  b.innerHTML = `<span class="bd-up-ic"><span>${icon || "⬆"}</span><i>${costTxt}</i></span>
    <span class="bd-up-body"><span class="bd-up-name">${name}</span><span class="bd-up-desc">${desc}</span></span>`;
  b.onclick = fn;
  return b;
}
function bdWireCommon(m, off, cells, onToggle, refresh) {
  const del = m.querySelector("#bd-del");
  let armed = false, timer = null;
  del.onclick = () => {
    if (!armed) {
      armed = true; del.classList.add("bd-arm"); del.textContent = "✔?";
      timer = setTimeout(() => { armed = false; del.classList.remove("bd-arm"); del.textContent = "🗑"; }, 2600);
      return;
    }
    clearTimeout(timer);
    for (const cc of cells) { cc.built = null; cc.lvl = 0; cc.gid = 0; cc.path = []; cc.life = 0; cc.off = false; }
    closeModal(); renderAll();
  };
  const pow = m.querySelector("#bd-pow");
  if (pow) pow.onclick = () => {
    for (const cc of cells) cc.off = !off;
    onToggle && onToggle();
    renderAll(); refresh();
  };
}
function openBuildingPanel(i) {
  const c = S.city[i], b = BUILDINGS[c.built], gid = c.gid;
  const cells = groupCells(gid);
  const idxs = S.city.map((cc, ii) => cc.gid === gid ? ii : -1).filter(x => x >= 0);
  const off = cellOff(c);
  const bvn = vName(vTreeKeyOf(c.built), c.path || []);
  openModal("", (m) => {
    const wrap = document.createElement("div");
    wrap.className = "bd";
    let head;
    if (b.prod) {
      const r = b.feed ? resMeta(b.feed) : null;
      const cap = tankCap(gid), stock = groupStock(gid);
      // recebendo: enchendo o tanque (para ao encher OU se o Feudo estiver sem recurso)
      const filling = !off && r && stock < cap - 0.01 && (S.res[b.feed] || 0) > 0;
      const recRate = filling ? FACT_FILL_PER_SEC * cells.length : 0;
      // torres que usam esta munição estão cheias? então a fábrica para de enviar
      const relTowers = S.towers.filter(t => t && TOWER_TYPES[t.type].ammos.includes(b.prod));
      const noTower = relTowers.length === 0;
      const towersFull = !noTower && relTowers.every(t => ammoOf(t, b.prod) >= ammoCap());
      const starved = !!b.feed && stock <= 0;
      // Parada de verdade = barra parada (e nada de estoque sendo consumido).
      const halted = off || starved || ammoBlocked(b.prod);
      const prodPot = idxs.reduce((a, ii) => a + cellProd(ii), 0) / supplyInterval();
      const prodSec = halted ? 0 : prodPot;
      const recLabel = r
        ? `Recebendo ${r.icon} ${r.name} · estoque ${stock.toFixed(0)}/${cap}${filling ? "" : stock >= cap - 0.01 ? " (cheio)" : ""}`
        : "Não consome recursos.";
      const sendLabel = starved
        ? `Estoque vazio · produção parada`
        : (towersFull || noTower) && S.helpKingdom
          ? `Excedente ${AMMO[b.prod].icon} ${AMMO[b.prod].name} ▸ 🎖️ Ajudando o Reino`
          : towersFull
            ? `Enviando ${AMMO[b.prod].icon} ${AMMO[b.prod].name} · torres cheias`
            : noTower
              ? `Sem torre que use ${AMMO[b.prod].icon} ${AMMO[b.prod].name}`
              : `Enviando: ${prodSec.toFixed(1)} ${AMMO[b.prod].icon} ${AMMO[b.prod].name}/s`;
      const recStatic = cap > 0 ? stock / cap : 0; // parada = mostra o nível do estoque
      const sendStatic = towersFull ? 1 : 0;        // torres cheias = barra cheia e parada
      head = `<div class="bd-head"><div class="bd-ic">${b.icon}</div>
        ${bdBarsHTML(recLabel, recRate, sendLabel, prodSec, recStatic, sendStatic)}
      </div>`;
    } else {
      head = `<div class="bd-art"><span class="bd-art-ic">${b.icon}</span></div>`;
    }
    // linhas de contexto (praças com efeito por vizinhança)
    let extra = "";
    if (c.built === "praca_publica") {
      const touching = new Set(neighbors(i).filter(n => S.city[n].built && S.city[n].gid !== gid).map(n => S.city[n].gid)).size;
      extra = `Tocando ${touching} construção(ões): +${touching * c.lvl} 🪙 por dia.`;
    } else if (c.built === "praca_trabalho") {
      extra = `Construções vizinhas ganham +${c.lvl}% de eficiência.`;
    }
    const fx = b.prod
      ? `◆ Produz ${AMMO[b.prod].icon} ${AMMO[b.prod].name}${b.feed ? ` · consome ${resMeta(b.feed).icon} ${resMeta(b.feed).name}` : ""} · ${cells.length} bloco(s)`
      : `◆ ${b.desc}`;
    const flavor = BUILD_FLAVOR[c.built] || "";
    wrap.innerHTML = `${head}
      <div class="bd-title">${(bvn || b.name).toUpperCase()} LV${c.lvl}</div>
      ${flavor ? `<div class="bd-flavor">${flavor}</div>` : ""}
      <div class="bd-desc">${b.prod ? b.desc : ""}${extra ? `${b.prod ? "<br>" : ""}${extra}` : ""}</div>
      <div class="bd-fx">${fx}</div>
      ${bdSectionHTML(off)}
      ${S.waveActive ? `<div class="bd-locknote">⚔ Em combate: melhorias só na fase de planejamento.</div>` : ""}
      <div class="bd-ups"></div>`;
    const ups = wrap.querySelector(".bd-ups");
    if (c.lvl < MAX_LVL) {
      const treeKey = vTreeKeyOf(c.built);
      const disc = 1 - Math.min(.6, (groupFx(gid).disc || 0));
      const evCost = Math.round(EV_COST_BUILD[c.lvl] * disc);
      const canBuy = !S.waveActive && S.gold >= evCost; // travadas durante o combate
      const apply = (id) => {
        S.gold -= evCost;
        const beforeMax = maxHits();
        for (const cc of cells) { if (id) cc.path = [...(cc.path || []), id]; cc.lvl++; }
        S.hits += Math.max(0, maxHits() - beforeMax); // Falange Eterna etc. já concede o hit
        closeModal(); renderAll();
      };
      const opts = VTREES[treeKey] ? vOptions(treeKey, c.lvl, c.path || []) : null;
      if (opts) {
        for (const o of opts) ups.append(bdUpCard(o.icon || "⬆", `🪙${evCost}`, o.n, o.d, canBuy, () => apply(o.id)));
      } else {
        ups.append(bdUpCard("⬆", `🪙${evCost}`, `Evoluir para Lv${c.lvl + 1}`, "Efeito mais forte por nível.", canBuy, () => apply(null)));
      }
    } else {
      ups.innerHTML = `<div class="bd-max">Nível máximo alcançado.</div>`;
    }
    m.appendChild(wrap);
    bdWireCommon(wrap, off, cells, null, () => openBuildingPanel(i));
  });
}

function onCellClick(i) {
  const c = S.city[i];
  if (S.placing) { paintToggle(i); return; }
  if (c.zone === "P") { openGate(); return; }
  if (c.zone === "D") {
    openModal("Centro de Distribuição", (m) => {
      const hint = document.createElement("div");
      hint.className = "panel-hint";
      hint.textContent = "As caixas sobem a esteira da direita e abastecem POR PROXIMIDADE: a torre 5 primeiro, depois 4, 3... A munição só passa adiante se a torre da vez estiver cheia. Cada torre exige a munição da sua fábrica.";
      m.appendChild(hint);
      for (const [type, a] of Object.entries(AMMO)) {
        const rate = prodOfType(type) / supplyInterval();
        const d = document.createElement("div");
        d.className = "wave-row";
        d.innerHTML = `<span class="wicon">${a.icon}</span><span class="wname">${a.name}</span><span class="wcount">${rate.toFixed(1)}/s</span>`;
        m.appendChild(d);
      }
    });
    return;
  }
  if (c.built) { openBuildingPanel(i); return; }
  const allowed = Object.entries(BUILDINGS).filter(([key, b]) => b.zones.includes(c.zone) && inLoadout("buildings", key));
  const zoneName = c.zone === "1" ? "Distrito do Povo" : c.zone === "2" ? "Distrito das Fábricas" : "Favela";
  const zoneIc = c.zone === "1" ? "⌂" : c.zone === "2" ? "⚒" : "◇";
  openModal(`${zoneIc} ${zoneName}`, (m) => {
    const hint = document.createElement("div");
    hint.className = "bp-hint";
    hint.textContent = c.zone === "0"
      ? "Terreno livre: aceita qualquer construção. Escolha e pinte os blocos."
      : "Escolha e pinte os blocos. Quanto maior, mais produz.";
    m.appendChild(hint);
    const grid = document.createElement("div");
    grid.className = "bp-grid";
    for (const [key, b] of allowed) {
      const min = bMinBlocks(key);
      const canAfford = S.gold >= b.cost && (!costsMaos(key) || S.maos >= min);
      const card = document.createElement("button");
      card.className = "bp-card";
      card.disabled = !canAfford;
      card.innerHTML = `<span class="bp-ic">${b.icon}</span>
        <span class="bp-body">
          <span class="bp-name">${b.name}</span>
          <span class="bp-desc">${b.desc}</span>
          <span class="bp-chips">
            <span class="bp-chip gold">🪙 ${Math.round(bCostPerBlock(key))}/bloco</span>
            ${costsMaos(key) ? `<span class="bp-chip maos">✋ 1/bloco</span>` : ""}
            <span class="bp-chip">◼ mín ${min}</span>
          </span>
        </span>`;
      card.onclick = () => startPaint(key, i);
      grid.appendChild(card);
    }
    m.appendChild(grid);
  });
}

// ---------- Render: torres ----------
function renderTowers() {
  const el = $("towers");
  el.innerHTML = "";
  for (let i = 0; i < LANES; i++) {
    const t = S.towers[i];
    const d = document.createElement("div");
    d.className = "tower-slot";
    if (t) {
      const tt = TOWER_TYPES[t.type];
      // estrelas = nível; COR = prestígio (0 amarela · 1 vermelha · 2 roxa · 3 dourada)
      const pc = PRESTIGE_STAR[prestigeOf(t)];
      const stars = t.lvl > 1 ? `<span class="stars" style="color:${pc};text-shadow:0 0 6px ${pc}">${"★".repeat(Math.min(5, t.lvl - 1))}</span>` : "";
      // Estoque: mostra o que está GUARDADO por tipo, não o que consome (não consome
      // nada). O total aparece junto do teto, senão o jogador não sabe quanto ainda cabe.
      const parts = tt.support === "depot"
        ? (() => {
            const st = Object.entries(t.stock || {}).filter(([, n]) => n > 0);
            const tot = `<span class="ammo dep-tot">🗃️${depotTotal(t)}/${depotCap(t)}</span>`;
            return tot + st.map(([a, n]) => `<span class="ammo">${AMMO[a].icon}${n}</span>`).join("");
          })()
        : tt.fuel
        ? `<span class="ammo${fuelPool(tt.fuel.k) < tt.fuel.cost ? " empty" : ""}">${FUEL_ICON[tt.fuel.k]}${Math.floor(fuelPool(tt.fuel.k))}</span>`
        : tt.ammos.map(a => {
            const am = AMMO[a];
            const n = ammoOf(t, a);
            // ⚠️ quer dizer "sem munição E sem fábrica que a faça": o aviso tem que ser
            // acionável. Com estoque na torre o número manda, porque ela AINDA dispara.
            // A Besta nasce carregada e cairia aqui, anunciada como vazia.
            if (n === 0 && prodOfType(a) === 0) return `<span class="ammo empty">${am.icon}⚠️</span>`;
            return `<span class="ammo${n === 0 ? " empty" : ""}">${am.icon}${n}</span>`;
          }).join("");
      if (t.lvl > 1) d.classList.add("upgraded");
      d.innerHTML = `${stars}<span class="icon">${tt.icon}</span><span class="ammo-row">${parts}</span>`;
    } else {
      d.innerHTML = `<span style="opacity:.35">➕</span><span class="ammo">vazio</span>`;
    }
    d.onclick = () => onTowerClick(i);
    el.appendChild(d);
  }
}

function onTowerClick(i) {
  if (S.placing) return;
  const t = S.towers[i];
  if (!t) {
    openModal(`⛨ Portão ${i + 1} · erguer torre`, (m) => {
      const hint = document.createElement("div");
      hint.className = "bp-hint";
      hint.textContent = "Cada torre dispara a munição da sua fábrica. Quanto mais avançada, mais munições exige.";
      m.appendChild(hint);
      for (const tier of ["basic", "adv", "legend"]) {
        const keys = Object.keys(TOWER_TYPES).filter(k => TOWER_TYPES[k].tier === tier && isUnlocked(k) && inLoadout("towers", k));
        if (!keys.length) continue;
        const sec = document.createElement("div");
        sec.className = "bp-sec";
        sec.innerHTML = `<span class="bp-sec-t">${TIER_META[tier]}</span><span class="bp-sec-n">${tier === "basic" ? "1 munição" : tier === "adv" ? "2 munições" : "3 munições"}</span>`;
        m.appendChild(sec);
        const grid = document.createElement("div");
        grid.className = "bp-grid";
        for (const key of keys) {
          const tt = TOWER_TYPES[key];
          const ammoChips = tt.fuel
            ? `<span class="bp-chip res">${FUEL_ICON[tt.fuel.k]} ${FUEL_LABEL[tt.fuel.k]} ×${tt.fuel.cost}</span>`
            : tt.ammos.map(a => `<span class="bp-chip res">${AMMO[a].icon} ${AMMO[a].name}</span>`).join("");
          const canAfford = S.gold >= tt.cost;
          const card = document.createElement("button");
          card.className = "bp-card";
          card.disabled = !canAfford;
          card.innerHTML = `<span class="bp-ic">${tt.icon}</span>
            <span class="bp-body">
              <span class="bp-name">${tt.name}</span>
              <span class="bp-desc">${towerTrait(tt)}</span>
              <span class="bp-chips">
                <span class="bp-chip gold">🪙 ${tt.cost}</span>
                <span class="bp-chip">${tt.dmg > 0 ? `⚔️ dano ${tt.dmg}` : "✚ suporte"}</span>
                ${ammoChips}
              </span>
            </span>`;
          card.onclick = () => {
            if (S.gold < tt.cost) return;
            S.gold -= tt.cost;
            S.towers[i] = { type: key, ammoBy: {}, lvl: 1, path: [], tiers: [0, 0, 0] };
            if (tt.loaded) fillTowerAmmo(S.towers[i]);   // Besta: já sobe carregada
            closeModal(); renderAll();
          };
          grid.appendChild(card);
        }
        m.appendChild(grid);
      }
    });
  } else {
    renderTowerPanel(t, i);
  }
}

// ---------- Painel da torre (repaginado): cabeçalho + suprimento + 3 caminhos + mira ----------
// Barra de "velocidade recebendo" (a MESMA das fábricas): cicla no ritmo do disparo
// quando a munição chega, e para (mostra o estoque estático) quando não recebe.
function supplyInfo(t) {
  const tt = TOWER_TYPES[t.type];
  const fireRate = 1 / towerRate(t); // disparos por segundo
  if (tt.fuel) {
    const pool = fuelPool(tt.fuel.k), need = tt.fuel.cost;
    return { label: `Recebendo ${FUEL_ICON[tt.fuel.k]} ${FUEL_LABEL[tt.fuel.k]} · ${Math.floor(pool)} em caixa`,
             rate: pool >= need ? fireRate : 0, staticFrac: Math.min(1, pool / Math.max(1, need)) };
  }
  // Estoque: a barra mostra o que está GUARDADO, não o que consome. Ele não dispara,
  // então o ritmo do ciclo é o do empurrão para as vizinhas.
  if (tt.support === "depot") {
    const cap = depotCap(t), tot = depotTotal(t);
    const st = Object.entries(t.stock || {}).filter(([, n]) => n > 0);
    return {
      label: `Guardado · ${tot}/${cap}${st.length ? " · " + st.map(([a, n]) => `${AMMO[a].icon}${n}`).join("  ") : " · vazio"}`,
      rate: tot > 0 ? 1 / DEPOT_FEED_SEC : 0,
      staticFrac: Math.min(1, tot / cap),
    };
  }
  const cap = ammoCap();
  const parts = tt.ammos.map(a => ({ a, n: ammoOf(t, a), noFab: prodOfType(a) === 0 }));
  const halted = parts.some(p => p.noFab); // sem a fábrica daquela munição = não recebe
  const label = `Recebendo · ${parts.map(p => `${AMMO[p.a].icon}${p.noFab ? " ⚠️" : ""}`).join("  ")}`;
  // `parts.length ?` protege as torres sem munição (Moedor): Math.min() sem argumento
  // devolve Infinity, e a barra vinha desenhando uma fração impossível.
  return { label, rate: halted ? 0 : fireRate, staticFrac: parts.length ? Math.min(...parts.map(p => p.n / cap)) : 1 };
}
// Prestígio via botão-estrela: valida e aplica (mesmos bônus de antes).
function onPrestigeClick(t, i) {
  if (!isTowerMaxed(t)) { toast("Maximize um caminho (tier 3) para prestigiar."); return; }
  const p = prestigeOf(t);
  if (p >= PRESTIGE_MAX) { toast(`⭐ Prestígio máximo (${PRESTIGE_MAX}/${PRESTIGE_MAX}).`); return; }
  if (S.waveActive) { toast("Só é possível prestigiar entre turnos."); return; }
  const cost = prestigeCost(p);
  if (S.gold < cost) { toast(`Sem ouro para prestigiar (custa 🪙${cost}).`); return; }
  S.gold -= cost; t.prestige = p + 1;
  toast(`⭐ Prestígio ${p + 1}! +60% dano e +10% cadência.`);
  renderAll(); onTowerClick(i);
}
function renderTowerPanel(t, i) {
  const tt = TOWER_TYPES[t.type];
  openModal("", (m) => {
    $("modal").classList.add("tower-modal");
    const P = towerPathsOf(t), tiers = towerTiers(t);
    const lvl = 1 + towerTotalTiers(t);
    const name = towerPathName(t) || tt.name;
    const lore = TOWER_LORE[t.type] || ARS_LORE[t.type] || towerTrait(tt);
    const p = prestigeOf(t), maxed = isTowerMaxed(t), canPrest = maxed && p < PRESTIGE_MAX;

    // 1) Cabeçalho: emoji · nome/Lv/posição · fechar
    const head = document.createElement("div");
    head.className = "tw-head";
    head.innerHTML = `
      <div class="tw-emoji">${tt.icon}</div>
      <div class="tw-titles">
        <div class="tw-name">${name} <span class="tw-lv">LV.${lvl}</span><span class="tw-pos">Posição ${i + 1} | ${TIER_LABEL[tt.tier]}</span></div>
        <div class="tw-desc">${lore}</div>
      </div>`;
    m.appendChild(head);

    // 2) Linha: remover · suprimento · prestígio(estrela)
    const sup = supplyInfo(t);
    const prestCost = canPrest ? prestigeCost(p) : 0;
    const row2 = document.createElement("div");
    row2.className = "tw-row2";
    row2.innerHTML = `
      <button class="tw-round tw-remove" title="Remover torre">🗑</button>
      <div class="tw-supply">
        <div class="tw-supply-lbl">${sup.label}</div>
        ${bdBarHTML("red", sup.rate, sup.staticFrac)}
      </div>
      <div class="tw-prest">
        ${canPrest ? `<div class="tw-prest-cost">🪙 ${prestCost}</div>` : ""}
        <button class="tw-round tw-sq tw-star${canPrest ? " ready" : ""}" title="Prestígio" style="${p ? `color:${PRESTIGE_STAR[p]};border-color:${PRESTIGE_STAR[p]}` : ""}">
          <span class="tw-star-ic">★</span>${p ? `<span class="tw-star-n">${p}</span>` : ""}</button>
      </div>`;
    m.appendChild(row2);
    row2.querySelector(".tw-remove").onclick = () => { S.towers[i] = null; closeModal(); renderAll(); };
    row2.querySelector(".tw-star").onclick = () => onPrestigeClick(t, i);

    // 3) Caminhos (3 linhas)
    const paths = document.createElement("div");
    paths.className = "tw-paths";
    P.paths.forEach((pa, pi) => {
      const cur = tiers[pi];
      const locked = towerPathLocked(t, pi);
      const buyable = towerCanBuy(t, pi);
      const atCap = cur < 3 && !locked && !buyable;
      const next = pa.tiers[cur];
      const cost = towerTierCost(t, pi);
      const can = buyable && !S.waveActive && S.gold >= cost;
      const rowEl = document.createElement("div");
      rowEl.className = "tw-path" + (locked ? " locked" : "") + (cur >= 3 ? " maxed" : "") + (atCap ? " cap" : "");
      const act = cur >= 3 ? `<div class="tw-act state done"><span class="tw-act-ic">★</span><span class="tw-act-s">MÁX</span></div>`
        : locked ? `<div class="tw-act state lock"><span class="tw-act-ic">🔒</span></div>`
        : atCap ? `<div class="tw-act state cap">2/2</div>`
        : `<button class="tw-act tw-melhorar${can ? "" : " off"}"><span class="tw-mel-t">MELHORAR</span><span class="tw-mel-c">🪙 ${cost}</span></button>`;
      const title = cur >= 3 ? "Caminho máximo"
        : locked ? "Caminho trancado"
        : atCap ? "Secundário no máximo"
        : `${next.n} <span class="tw-tier">Lv.${cur + 1}</span>`;
      const desc = cur >= 3 ? "Todos os 3 tiers deste caminho."
        : locked ? "Só dois caminhos por torre."
        : atCap ? "O principal já está no tier 3."
        : next.d;
      const pips = pa.tiers.map((_, ti) => `<span class="tw-pip${ti < cur ? " on" : ""}"></span>`).join("");
      rowEl.innerHTML = `
        <div class="tw-path-mid">
          <div class="tw-path-tag">${pa.name}</div>
          <div class="tw-path-name">${title}</div>
          <div class="tw-path-desc">${desc}</div>
        </div>
        ${act}
        <div class="tw-pips">${pips}</div>`;
      const buyBtn = rowEl.querySelector("button.tw-melhorar");
      if (buyBtn) buyBtn.onclick = () => {
        if (!(towerCanBuy(t, pi) && !S.waveActive && S.gold >= cost)) return;
        S.gold -= cost; tiers[pi]++; t.lvl = 1 + towerTotalTiers(t);
        renderAll(); onTowerClick(i);
      };
      paths.appendChild(rowEl);
    });
    m.appendChild(paths);

    // 4) Prioridade de ataque (seletor com setas) — só torres que atiram
    if (!tt.support) {
      const aim = t.aim || "near", idx = AIM_ORDER.indexOf(aim), md = AIM_MODES[aim];
      const aimEl = document.createElement("div");
      aimEl.className = "tw-aim";
      aimEl.innerHTML = `
        <div class="tw-aim-lbl">PRIORIDADE DE ATAQUE</div>
        <div class="tw-aim-sel">
          <button class="tw-aim-arrow" data-d="-1">‹</button>
          <span class="tw-aim-name">${md.icon} ${md.name}</span>
          <button class="tw-aim-arrow" data-d="1">›</button>
        </div>`;
      m.appendChild(aimEl);
      aimEl.querySelectorAll(".tw-aim-arrow").forEach(b => b.onclick = () => {
        t.aim = AIM_ORDER[(idx + (+b.dataset.d) + AIM_ORDER.length) % AIM_ORDER.length];
        renderAll(); onTowerClick(i);
      });
    }
    if (S.waveActive) {
      const w = document.createElement("div"); w.className = "tw-note";
      w.textContent = "⚔ Em combate: melhorias e prestígio só entre os turnos.";
      m.appendChild(w);
    }
    // "clique fora para sair" FORA do modal, sobre o fundo escurecido
    const modal = $("modal");
    modal.querySelector(".modal-foot")?.remove();
    const foot = document.createElement("div");
    foot.className = "modal-foot";
    foot.textContent = "CLIQUE FORA PARA SAIR";
    modal.appendChild(foot);
  });
}

// ---------- Portão (P): invocar tropas aliadas ----------
function openGate() {
  openModal(`🏹 O Arco dos Heróis · tropas: ${S.allies.length}/${ALLY_LIMIT}`, (m) => {
    const facs = allyFacList();
    if (!facs.includes(S.gateFac)) S.gateFac = facs[0];
    const wrap = document.createElement("div");
    wrap.className = "gate";

    // 1) Buffs do quartel: explícitos, em chips (mesma linguagem das outras telas)
    const hpB = Math.round((allyHpMult() - 1) * 100), dmgB = Math.round((allyDmgMult() - 1) * 100);
    const spdB = Math.round((allySpdMult() - 1) * 100);
    const buffs = [["❤️", "vida", hpB], ["⚔️", "dano", dmgB], ["👢", "marcha", spdB]]
      .map(([ic, n, v]) => `<span class="gate-buff${v > 0 ? " on" : ""}">${ic} ${v > 0 ? "+" : ""}${v}% ${n}</span>`).join("");
    wrap.insertAdjacentHTML("beforeend",
      `<div class="gate-sec-t">BÔNUS DO QUARTEL</div>
       <div class="gate-buffs">${buffs}</div>
       ${hpB || dmgB || spdB ? "" : `<div class="gate-note">Nenhum quartel ativo: as tropas lutam com os stats base.</div>`}`);

    // 2) Postura: segmentado, sempre visível (não é mais um botão que alterna cego)
    wrap.insertAdjacentHTML("beforeend", `<div class="gate-sec-t">POSTURA DAS TROPAS</div>`);
    const seg = document.createElement("div");
    seg.className = "gate-seg";
    for (const [mode, ic, name, d] of [
      ["protect", "🛡️", "Proteger", "Seguram a linha à frente das muralhas, sem avançar."],
      ["attack", "⚔️", "Atacar", "Avançam até o inimigo da lane e voltam quando ela esvazia."],
    ]) {
      const b = document.createElement("button");
      b.className = "gate-seg-b" + (S.gateMode === mode ? " on" : "");
      b.innerHTML = `<span class="gs-ic">${ic}</span><span class="gs-n">${name}</span>`;
      b.title = d;
      b.onclick = () => { S.gateMode = mode; saveGame(); openGate(); };
      seg.appendChild(b);
    }
    wrap.appendChild(seg);
    wrap.insertAdjacentHTML("beforeend",
      `<div class="gate-note">${S.gateMode === "attack"
        ? "⚔️ Avançam até o inimigo da lane e voltam quando ela esvazia."
        : "🛡️ Seguram a linha à frente das muralhas, sem avançar."}</div>`);

    // 3) Ideologia da tropa: a cor soma um bônus sobre os stats base
    wrap.insertAdjacentHTML("beforeend", `<div class="gate-sec-t">IDEOLOGIA DA TROPA</div>`);
    const facRow = document.createElement("div");
    facRow.className = "gate-facs";
    for (const k of facs) {
      const f = FACTIONS[k];
      const b = document.createElement("button");
      b.className = "gate-fac" + (S.gateFac === k ? " on" : "");
      b.style.setProperty("--fc", f.color);
      b.innerHTML = `<span class="gf-dot"></span>`; // disco na cor da ideologia (sem emoji)
      b.title = `${f.name}: ${ALLY_FAC_FX[k].desc}`;
      b.onclick = () => { S.gateFac = k; saveGame(); openGate(); };
      facRow.appendChild(b);
    }
    wrap.appendChild(facRow);
    wrap.insertAdjacentHTML("beforeend",
      `<div class="gate-note"><b style="color:${FACTIONS[S.gateFac].color}">${FACTIONS[S.gateFac].name}</b> · ${ALLY_FAC_FX[S.gateFac].desc}</div>`);

    // 4) Tropas: cartas com os stats já somados com quartel + ideologia
    wrap.insertAdjacentHTML("beforeend", `<div class="gate-sec-t">CONVOCAR</div>`);
    if (S.waveActive) wrap.insertAdjacentHTML("beforeend",
      `<div class="gate-war">⚔️ <b>PREÇO DE GUERRA:</b> com a horda em campo, convocar custa +${Math.round((GATE_WAR_MULT - 1) * 100)}%. Vale também para a reposição automática.</div>`);
    const grid = document.createElement("div");
    grid.className = "gate-grid";
    const fake = { fac: S.gateFac };
    for (const [key, a] of Object.entries(ALLY_TYPES)) {
      if (a.spectral) continue; // Sombra vem do pacto roxo, não do Arco
      const curIcon = a.cur === "gold" ? "🪙" : "💎";
      const wallet = a.cur === "gold" ? S.gold : S.hearts;
      const cost = allyCost(a);
      const can = S.allies.length < ALLY_LIMIT && wallet >= cost;
      const hp = Math.round(a.hp * allyHpMult() * allyFacHpMult(fake));
      const dps = (a.dps * allyDmgMult() * allyFacAtkMult(fake)).toFixed(1);
      const kind = a.tank ? `absorve ${Math.round(a.tank * 100)}% do dano` : a.melee ? "corpo a corpo" : "à distância";
      const b = document.createElement("button");
      b.className = "gate-card";
      b.style.setProperty("--fc", FACTIONS[S.gateFac].color);
      b.disabled = !can;
      b.innerHTML = `<span class="gc-ic">${a.icon}</span><span class="gc-n">${a.name}</span>
        <span class="gc-s">❤️ ${hp} · ⚔️ ${dps}</span><span class="gc-k">${kind}</span>
        <span class="gc-c${S.waveActive ? " war" : ""}">${curIcon} ${cost}${S.waveActive ? ` <s>${a.cost}</s>` : ""}</span>`;
      b.onclick = () => { summonAlly(key, S.gateFac); openGate(); };
      grid.appendChild(b);
    }
    wrap.appendChild(grid);

    // 5) Reposição automática: carta larga que MOSTRA o que será reposto
    wrap.insertAdjacentHTML("beforeend", `<div class="gate-sec-t">REPOSIÇÃO AUTOMÁTICA</div>`);
    const pref = ALLY_TYPES[S.gatePref] || ALLY_TYPES.campones;
    const auto = document.createElement("button");
    auto.className = "gate-auto" + (S.gateAuto ? " on" : "");
    auto.style.setProperty("--fc", FACTIONS[S.gateFac].color);
    auto.innerHTML = `
      <span class="ga-unit"><span class="ga-ic">${pref.icon}</span><span class="ga-dot"></span></span>
      <span class="ga-txt">
        <span class="ga-t">${S.gateAuto ? "LIGADA" : "DESLIGADA"}</span>
        <span class="ga-d">${S.gateAuto
          ? `Repõe cada baixa com <b>${pref.name}</b> (${pref.cur === "gold" ? "🪙" : "💎"} ${allyCost(pref)}${S.waveActive ? ", preço de guerra" : ""}), na ideologia selecionada. Funciona no planejamento e durante a batalha.`
          : "As baixas só são repostas por você, aqui no Arco."}</span>
      </span>
      <span class="ga-sw"><span class="ga-knob"></span></span>`;
    auto.onclick = () => { S.gateAuto = !S.gateAuto; saveGame(); renderAll(); openGate(); };
    wrap.appendChild(auto);

    m.appendChild(wrap);
  });
}

// ---------- Modal genérico ----------
function openModal(title, buildFn) {
  $("modal").classList.remove("dist-modal", "tower-modal"); // limpa modificadores de painéis específicos
  $("modal").querySelector(".modal-foot")?.remove(); // rodapé externo é exclusivo do "Seu Setor"
  $("modal-title").textContent = title;
  const m = $("modal-content");
  m.innerHTML = "";
  buildFn(m);
  fadeInScreen("modal");
}
function closeModal() {
  fadeOutScreen("modal", () => $("modal").querySelector(".modal-foot")?.remove());
}
$("modal-close").onclick = closeModal;
$("modal").onclick = (e) => { if (e.target === $("modal")) closeModal(); };
$("field-toggle").onclick = toggleField;

function row(html, btnLabel, cost, canAfford, fn) {
  const d = document.createElement("div");
  d.className = "panel-row";
  const b = document.createElement("button");
  b.textContent = btnLabel + (cost ? ` (${cost})` : "");
  b.disabled = !canAfford;
  b.onclick = fn;
  const s = document.createElement("span");
  s.className = "desc"; s.innerHTML = html;
  d.append(b, s);
  return d;
}

// ---------- AS MELHORIAS: roda radial de leis (tela cheia, arrastar p/ navegar) ----------
const WHEEL_SIZE = 1400, WHEEL_C = WHEEL_SIZE / 2;
function lawXY(id) {
  const d = LAWS[id];
  let ang, r;
  if (d.legend) {
    const a1 = LAW_LINES[d.legend[0]].angle, a2 = LAW_LINES[d.legend[1]].angle;
    ang = a1 + (((a2 - a1 + 540) % 360) - 180) / 2; // ponto médio angular
    r = 300;
  } else {
    ang = LAW_LINES[d.line].angle;
    r = 108 + d.pos * 88;
  }
  const rad = ang * Math.PI / 180;
  return { x: WHEEL_C + Math.cos(rad) * r, y: WHEEL_C + Math.sin(rad) * r, ang };
}
let lawsSelected = null;
function openMelhorias() {
  lawsSelected = null;
  fadeInScreen("laws-scr");
  buildLawsWheel();
  renderLawsDetail();
  centerLawsWheel();
}
function closeMelhorias() { fadeOutScreen("laws-scr"); }
function buildLawsWheel() {
  const wheel = $("laws-wheel");
  // fundo SVG: anéis + raios das 8 linhas
  let svg = `<svg width="${WHEEL_SIZE}" height="${WHEEL_SIZE}" viewBox="0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}">`;
  for (let i = 1; i <= 5; i++) svg += `<circle cx="${WHEEL_C}" cy="${WHEEL_C}" r="${108 + i * 88}" fill="none" stroke="rgba(243,234,210,.14)" stroke-width="1"/>`;
  for (const l of Object.values(LAW_LINES)) {
    const rad = l.angle * Math.PI / 180;
    svg += `<line x1="${WHEEL_C + Math.cos(rad) * 60}" y1="${WHEEL_C + Math.sin(rad) * 60}" x2="${WHEEL_C + Math.cos(rad) * 548}" y2="${WHEEL_C + Math.sin(rad) * 548}" stroke="rgba(243,234,210,.30)" stroke-width="2"/>`;
  }
  svg += "</svg>";
  wheel.innerHTML = svg;
  // centro: símbolo do reino
  const c = document.createElement("div");
  c.className = "law-center";
  c.innerHTML = `<img src="ASSET_SIMBOLO-KMNF.png?v=1" alt="">`;
  c.style.left = WHEEL_C + "px"; c.style.top = WHEEL_C + "px";
  wheel.appendChild(c);
  // rótulos das 8 linhas (fora do último anel)
  for (const [key, l] of Object.entries(LAW_LINES)) {
    const rad = l.angle * Math.PI / 180;
    const lb = document.createElement("div");
    lb.className = "law-label";
    lb.textContent = l.name.toUpperCase();
    lb.style.left = (WHEEL_C + Math.cos(rad) * 610 + (l.ldx || 0)) + "px";
    lb.style.top = (WHEEL_C + Math.sin(rad) * 610 + (l.ldy || 0)) + "px";
    wheel.appendChild(lb);
  }
  // nós das 48 leis
  for (const id of Object.keys(LAWS)) {
    const d = LAWS[id], p = lawXY(id);
    const owned = law(id), avail = lawAvailable(id);
    const b = document.createElement("button");
    b.className = "law-node" + (d.legend ? " legend" : "") + (owned ? " owned" : avail ? " avail" : " locked")
      + (lawsSelected === id ? " sel" : "");
    if (d.legend) b.style.setProperty("--leg", d.color);
    b.style.left = p.x + "px"; b.style.top = p.y + "px";
    b.textContent = id.slice(1);
    b.onclick = () => { lawsSelected = id; buildLawsWheel(); renderLawsDetail(); };
    wheel.appendChild(b);
  }
  const n = $("laws-limit-n");
  if (n) n.textContent = `${S.laws.length}/${LAW_LIMIT}`;
}
function renderLawsDetail() {
  const p = $("laws-detail");
  if (!lawsSelected) { p.classList.add("hidden"); return; }
  const id = lawsSelected, d = LAWS[id];
  const owned = law(id), avail = lawAvailable(id);
  const m = lawMoral(id);
  const mIcons = m === 0 ? `<span class="law-m-neutral">moral neutra</span>`
    : `<img class="law-m-ic" src="${m > 0 ? "MEDIDOR-ESPERANÇA.png" : "MEDIDOR-MEDO.png"}?v=1" alt=""><span class="law-m-n">${m > 0 ? "+" + m : m}</span>`;
  let btn;
  if (owned) btn = `<div class="law-signed">✔ Lei assinada</div>`;
  else if (!avail) {
    const why = S.laws.length >= LAW_LIMIT ? `limite de ${LAW_LIMIT} leis atingido`
      : d.legend ? `complete as linhas ${d.legend.map(l => LAW_LINES[l].name).join(" e ")}`
      : "assine a lei anterior da linha";
    btn = `<div class="law-req">🔒 ${why}</div>`;
  } else {
    const gem = d.gem || 0;
    const canPay = freeLaws() || (S.gold >= d.cost && S.hearts >= gem);
    const costLabel = freeLaws() ? "🐞 GRÁTIS"
      : gem ? `🪙 ${d.cost} · 💎 ${gem}` : `🪙 ${d.cost} OURO`;
    btn = `<button id="law-buy" ${canPay ? "" : "disabled"}>ASSINAR<span>${costLabel}</span></button>`;
  }
  p.innerHTML = `
    <div class="law-d-head"><b>${d.name}</b><span class="law-m">${mIcons}</span></div>
    <p class="law-d-desc">${d.desc}${d.legend ? `<br><span class="law-d-leg">Lei lendária · ${d.legend.map(l => LAW_LINES[l].name).join(" + ")}</span>` : ""}</p>
    ${btn}`;
  p.classList.remove("hidden");
  const buy = $("law-buy");
  if (buy) buy.onclick = () => {
    const gem = d.gem || 0;
    if (!lawAvailable(id) || (!freeLaws() && (S.gold < d.cost || S.hearts < gem))) return;
    if (!freeLaws()) { S.gold -= d.cost; S.hearts -= gem; }
    const beforeMax = maxHits();
    S.laws.push(id);
    S.hits += Math.max(0, maxHits() - beforeMax); // lei de muralha já concede o hit
    toast(`📜 Lei assinada: ${d.name}`);
    saveGame();
    renderAll();
    buildLawsWheel();
    renderLawsDetail();
  };
}
// arrastar para navegar pela roda
let lawsPan = { x: 0, y: 0 }, lawsDrag = null;
function applyLawsPan() { $("laws-wheel").style.transform = `translate(${lawsPan.x}px, ${lawsPan.y}px)`; }
function centerLawsWheel() {
  const vp = $("laws-viewport");
  lawsPan = { x: (vp.clientWidth - WHEEL_SIZE) / 2, y: (vp.clientHeight - WHEEL_SIZE) / 2 };
  applyLawsPan();
}
{
  const vp = $("laws-viewport");
  vp.addEventListener("pointerdown", (e) => { lawsDrag = { x: e.clientX - lawsPan.x, y: e.clientY - lawsPan.y }; });
  vp.addEventListener("pointermove", (e) => {
    if (!lawsDrag) return;
    lawsPan.x = Math.max(vp.clientWidth - WHEEL_SIZE - 80, Math.min(80, e.clientX - lawsDrag.x));
    lawsPan.y = Math.max(vp.clientHeight - WHEEL_SIZE - 80, Math.min(80, e.clientY - lawsDrag.y));
    applyLawsPan();
  });
  const stop = () => { lawsDrag = null; };
  vp.addEventListener("pointerup", stop);
  vp.addEventListener("pointercancel", stop);
  vp.addEventListener("pointerleave", stop);
}
$("laws-back").onclick = closeMelhorias;
$("laws-help-btn").onclick = () => $("laws-help").classList.toggle("hidden");
function freeLaws() { return !!(S.debug && S.debug.freeLaws); }
function renderLawsDbg() { $("laws-dbg").textContent = `debug: melhorias de graça ${freeLaws() ? "ON" : "off"}`; }
$("laws-dbg").onclick = () => { // debug: leis não custam ouro
  S.debug.freeLaws = !freeLaws();
  renderLawsDbg(); renderLawsDetail();
};
renderLawsDbg();

// Debug agora vive DENTRO da tela de Pausa (painel expansível), sem modal separado.
function renderDebugPanel() {
  const p = $("pause-debug-panel"); p.innerHTML = "";
  p.append(
    row("Adicionar ouro", "🪙 +200", 0, true, () => { S.gold += 200; renderAll(); renderDebugPanel(); }),
    row("Adicionar Corações de Argamato", "💎 +20", 0, true, () => { S.hearts += 20; renderAll(); renderDebugPanel(); }),
    row("Maximizar todos os recursos (🪙💎✋ + Feudo)", "⬆️ Max", 0, true, () => { S.gold = 9999; S.hearts = 999; S.maos = maosCap(); for (const k of Object.keys(RESOURCES)) S.res[k] = RES_CAP; renderAll(); renderDebugPanel(); }),
    row("Zerar todos os recursos (🪙💎✋ + Feudo)", "⬇️ Zerar", 0, true, () => { S.gold = 0; S.hearts = 0; S.maos = 0; for (const k of Object.keys(RESOURCES)) S.res[k] = 0; renderAll(); renderDebugPanel(); }),
    row("Restaurar os hits das muralhas", "🧱 Curar", 0, true, () => { S.hits = maxHits(); renderAll(); renderDebugPanel(); }),
    row("Encher a munição de todas as torres", "🎯 Munição", 0, true, () => { S.towers.forEach(t => { if (t) fillTowerAmmo(t); }); renderAll(); renderDebugPanel(); }),
    row("Eliminar todos os inimigos em campo", "☠️ Limpar", 0, true, () => { S.enemies.forEach(e => e.hp = 0); closePause(); }),
    row("Invocar 5 mortos-vivos extras", "🧟 Invocar", 0, true, () => { if (S.waveActive) spawnQueue.push(...pickWave(5)); closePause(); }),
    row("Passar para o próximo turno (fora de turno)", "⏭ Passar turno", 0, !S.waveActive, () => { if (S.isNight) { S.isNight = false; S.day++; } else { S.isNight = true; } S.gold += 15 + S.day * 3; buildNextWave(); renderAll(); renderDebugPanel(); }),
    row(`Muralhas invencíveis ${S.debug.god ? "✅" : "❌"}`, "🛡 God", 0, true, () => { S.debug.god = !S.debug.god; renderDebugPanel(); }),
    row(`Velocidade do jogo: ${S.debug.speed}x`, "⏩ Alternar", 0, true, () => { const i = SPEEDS.indexOf(S.debug.speed); S.debug.speed = SPEEDS[(i + 1) % SPEEDS.length]; renderHUD(); renderDebugPanel(); }),
    // Circula Céu Aberto ▸ Turvo ▸ Tempestade ▸ Perfeito. O clima é só desenho, então
    // trocar aqui vale na hora: o próximo frame já pinta o céu novo.
    row(`Clima do turno: ${weather().ic} ${weather().name}`, "🌦 Alternar", 0, true, () => {
      const i = WEATHER_KEYS.indexOf(S.weather);
      S.weather = WEATHER_KEYS[(i + 1) % WEATHER_KEYS.length];
      toast(`${weather().ic} ${weather().name}: ${weather().desc}`);
      renderDebugPanel();
    }),
    row(`Conselho: desbloquear todos (${councilUnlocked().length}/${COUNCIL_ORDER.length})`, "🤝 Rede", 0, councilUnlocked().length < COUNCIL_ORDER.length, () => { META.council = [...COUNCIL_ORDER]; saveMeta(META); toast("🤝 Conselho: todos apresentados."); renderDebugPanel(); }),
  );
}
function toggleDebugPanel() {
  const p = $("pause-debug-panel"), show = p.classList.contains("hidden");
  if (show) renderDebugPanel();
  p.classList.toggle("hidden", !show);
  $("pause-debug").classList.toggle("on", show);
}

$("tab-melhorias").onclick = openMelhorias;
$("tab-favores").onclick = openFavores;
$("tab-distrito").onclick = openDistrict;
$("hud-brasao").onclick = openDistrict;

// ---------- Overlay de Configurações / Saída (pausa o jogo) ----------
// ---------- Configurações: lista de toggles ----------
const SETTINGS_UI = [
  { k: "hpBars",     label: "Barras de vida" },
  { k: "dmgNumbers", label: "Números de dano/cura" },
  { k: "music",      label: "Música", soon: true },
  { k: "fullscreen", label: "Tela cheia", soon: true },
  { k: "animations", label: "Animações", soon: true },
  { k: "vfx",        label: "Efeitos visuais", soon: true },
];
function renderSettings() {
  const box = $("settings-list");
  if (!box) return;
  box.innerHTML = "";
  for (const s of SETTINGS_UI) {
    const row = document.createElement("label");
    row.className = "set-row" + (s.soon ? " soon" : "");
    const lab = document.createElement("span");
    lab.className = "set-label";
    lab.textContent = s.label;
    if (s.soon) { const tag = document.createElement("span"); tag.className = "set-soon"; tag.textContent = "em desenvolvimento"; lab.appendChild(tag); }
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.className = "set-toggle"; cb.checked = !!SETTINGS[s.k];
    cb.onchange = () => { SETTINGS[s.k] = cb.checked; saveSettings(); };
    row.append(lab, cb);
    box.appendChild(row);
  }
}
function openPause() {
  S.paused = true;
  renderSettings();
  $("settings-list").classList.add("hidden"); // configurações começam recolhidas
  $("settings-toggle").classList.remove("on");
  $("pause-debug-panel").classList.add("hidden"); // sempre começa recolhido
  $("pause-debug").classList.remove("on");
  $("pause").classList.remove("hidden");
}
$("settings-toggle").onclick = () => {
  const open = $("settings-list").classList.toggle("hidden") === false;
  $("settings-toggle").classList.toggle("on", open);
};
function closePause() {
  S.paused = false;
  $("pause").classList.add("hidden");
  $("pause-debug-panel").classList.add("hidden"); // recolhe o debug ao fechar
  $("pause-debug").classList.remove("on");
}
function exitToMenu() {
  // encerra o turno em curso e volta ao menu, preservando a run para "Continuar"
  S.waveActive = false;
  S.enemies = []; S.projectiles = []; S.eshots = []; S.warnings = []; S.effects = []; S.floats = [];
  spawnQueue = [];
  $("conveyor").classList.remove("running");
  $("conveyor-v").classList.remove("running");
  saveGame();
  S.paused = false;
  $("pause").classList.add("hidden");
  setupMenu();
  $("menu").classList.remove("hidden");
}
$("btn-settings").onclick = openPause;
$("pause-resume").onclick = closePause;
$("pause-resume2").onclick = closePause;
$("pause-debug").onclick = toggleDebugPanel;
$("pause-exit").onclick = exitToMenu;
// Modal: nomear e gravar um save
function promptSaveName() {
  openModal("Salvar jogo", (m) => {
    const hint = document.createElement("div"); hint.className = "panel-hint";
    hint.textContent = "Dê um nome a este save (ou deixe em branco para um nome automático).";
    m.appendChild(hint);
    const warn = document.createElement("div"); warn.className = "panel-hint";
    warn.textContent = "⚠ Os turnos só são salvos no começo deles. Salvar no meio de um turno faz ele recomeçar ao carregar. Um autosave é feito a cada 5 dias.";
    m.appendChild(warn);
    const inp = document.createElement("input");
    inp.className = "save-name-input"; inp.type = "text"; inp.maxLength = 40;
    inp.placeholder = `Dia ${S.day} · ${S.hits} hits`;
    m.appendChild(inp);
    const btn = document.createElement("button");
    btn.className = "menu-btn primary save-confirm"; btn.textContent = "💾 Salvar";
    const doSave = () => {
      const name = (inp.value.trim() || `Dia ${S.day} · ${S.hits} hits`).slice(0, 40);
      const id = writeSlot(name, false);
      closeModal();
      if (id) toast("💾 Jogo salvo: " + name);
    };
    btn.onclick = doSave;
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") doSave(); });
    m.appendChild(btn);
    setTimeout(() => inp.focus(), 30);
  });
}
// Modal: lista de saves (nomeados + autosaves), mais recente primeiro
function openSavesList(onLoaded) {
  const slots = loadSlots().sort(slotOrder);
  openModal("Carregar jogo", (m) => {
    if (!slots.length) {
      const d = document.createElement("div"); d.className = "panel-hint";
      d.textContent = "Nenhum jogo salvo ainda. Salve pelo menu de Configurações (⚙) durante a partida, e a cada 5 dias um autosave é feito automaticamente.";
      m.appendChild(d); return;
    }
    for (const s of slots) {
      const row = document.createElement("div"); row.className = "save-row";
      const info = document.createElement("div"); info.className = "save-info";
      const nameEl = document.createElement("span"); nameEl.className = "save-name";
      nameEl.textContent = (s.auto ? "🔄 " : "💾 ") + s.name;
      const when = new Date(s.ts);
      const stamp = `${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      const metaEl = document.createElement("span"); metaEl.className = "save-meta";
      metaEl.textContent = `Dia ${s.day} · ${s.hits} hits · ${stamp}`;
      info.append(nameEl, metaEl);
      const load = document.createElement("button"); load.className = "save-btn load"; load.textContent = "Carregar";
      load.onclick = () => {
        if (loadSlot(s.id)) { closeModal(); onLoaded && onLoaded(); toast("📂 Carregado: " + s.name); }
        else toast("Save corrompido.");
      };
      const del = document.createElement("button"); del.className = "save-btn del"; del.textContent = "🗑"; del.title = "Apagar";
      del.onclick = () => { deleteSlot(s.id); openSavesList(onLoaded); };
      row.append(info, load, del);
      m.appendChild(row);
    }
  });
}
$("pause-save").onclick = promptSaveName;
$("pause-load").onclick = () => openSavesList(() => { renderAll(); closePause(); });
$("pause").onclick = (e) => { if (e.target === $("pause")) closePause(); };

// ---------- Mensagens de combate (estilo PvZ, surgem/somem junto com o astro) ----------
// "|" marca a quebra de linha (mensagem sempre em duas linhas)
const COMBAT_MSGS = {
  start: [
    "Eles estão vindo.|Resista.",
    "A horda avança.|Segurem as muralhas.",
    "Que venham.|Karzstak não deve cair.",
    "Posições.|Ninguém recua hoje.",
    "O chão está tremendo.|Já dá para contar os passos.",
    "Carreguem tudo.|Depois a gente conta os mortos.",
    "É só mais uma noite.|Como todas as outras.",
    "Eles não sabem pensar.|Nós sabemos. Usem isso.",
    "Respira fundo, comandante.|E solta devagar.",
    "Olhos no horizonte.|Mãos na alavanca.",
    "Cem anos de muralha|não caem hoje.",
    "Se der errado,|dá errado em pé.",
  ],
  half: [
    "A horda|está diminuindo.",
    "Estão caindo.|Não recuem!",
    "A maré vira.|Aguentem firme.",
    "Metade deles|já está no chão.",
    "Continua assim.|Está funcionando.",
    "O cheiro mudou.|É o cheiro de vitória.",
    "Eles estão rareando.|Não baixem a guarda.",
    "Mais um empurrão.|Só mais um.",
    "A linha aguentou.|Ela sempre aguenta.",
    "Contem a munição.|Vamos precisar até o fim.",
  ],
  // Sol Negro = loucura
  blacksun: [
    "Há. Há. Há.|Estamos perdidos.",
    "O sol morreu|e ninguém percebeu. Ha!",
    "Ria comigo...|é tudo o que resta.",
    "Que dia bonito|para o fim de tudo.",
    "Alguém apagou o céu|e deixou a conta pra nós.",
    "Eu já vi isso antes.|No sonho. No MEU sonho.",
    "Não é noite.|É o sol fingindo.",
    "Cantem.|Cantem até doer a garganta.",
  ],
  // Lua Sangrenta = depressão
  bloodmoon: [
    "Não vamos|conseguir.",
    "Para que resistir?|Eles nunca param.",
    "As muralhas vão cair.|Como sempre foi.",
    "A lua está vermelha.|Ela sabe de algo.",
    "Tantos nomes.|E nenhum deles volta.",
    "A gente só adia.|É só isso que a gente faz.",
    "Dorme, Karzstak.|Ninguém vai te culpar.",
    "Hoje eles vêm com fome.|E nós, com o que sobrou.",
  ],
  // Fecho do turno, no overlay de anoitecer. Fica na mesma tabela das outras porque é a
  // mesma voz do setor, só sem a quebra de linha: aqui o texto é parágrafo, não letreiro.
  dusk: [
    "O vigia observa o horizonte. Toque no astro da noite para ver o que vem.",
    "A guarda troca de turno em silêncio. Toque no astro para ver o que a noite trouxe.",
    "Alguém está contando os mortos no campo. Toque no astro para ver os que faltam.",
    "O sino bateu e ninguém comemorou. Toque no astro da noite.",
    "Os braseiros foram acesos nas ameias. Toque no astro para ver o horizonte.",
    "Mais um turno fechado. O vigia já está no posto: toque no astro da noite.",
    "A poeira assenta devagar sobre o campo. Toque no astro para ver o que se move nela.",
    "Nenhum nome novo na lista hoje. Toque no astro da noite e confira o que vem.",
  ],
  // Lua cheia: a horda engrossa, mas o campo fica visível
  fullmoon: [
    "Lua cheia.|Hoje eles vêm todos.",
    "Dá para ver cada um deles.|Isso não é um alívio.",
    "A luz é nossa amiga.|O resto, não.",
    "Contem quantos quiserem.|Não vai mudar nada.",
    "Noite clara,|horda cheia.",
    "A lua entrega eles.|Não desperdicem o favor.",
  ],
  // Tempestade: chuva, trovão, céu fechado
  storm: [
    "A chuva lava o sangue|e trás mais sangue.",
    "Trovão.|Nem eles gostam disso.",
    "Pólvora molhada,|coragem seca.",
    "O céu caiu primeiro.|A muralha é a próxima da fila.",
    "Segurem as tochas.|Vai ficar escuro.",
  ],
  // Turno Turvo: névoa densa, o jogador perde a horda de vista
  fog: [
    "Névoa.|Atirem no som.",
    "Não enxergo nada.|As torres enxergam. Confiem nelas.",
    "Eles estão ali.|Em algum lugar ali.",
    "A névoa esconde eles|e esconde nós também.",
    "Ouçam.|Hoje a gente luta de ouvido.",
  ],
  // Turno Perfeito: ar limpo, visibilidade total
  clear: [
    "Ar limpo.|Aproveitem, é raro.",
    "Dá para ver até o fim do campo.|Que privilégio terrível.",
    "Nenhuma desculpa hoje.|Só mira.",
    "Céu aberto, mão firme.|Vamos trabalhar.",
  ],
  // Muralhas em estado crítico
  critical: [
    "A muralha está cedendo!|Tapem as brechas!",
    "Último hit.|Depois dele não tem depois.",
    "Está rachando tudo.|Aguenta, aguenta...",
    "Se ela cair,|cai com a gente em cima.",
  ],
  // Onda limpa
  cleared: [
    "Está feito.|O campo é nosso.",
    "Silêncio.|Pela primeira vez hoje.",
    "Acabou.|Recolham o que sobrou.",
    "Mais uma noite|que Karzstak não caiu.",
    "Contem os vivos.|Depois contem o resto.",
  ],
};
function pickMsg(pool) { const a = COMBAT_MSGS[pool]; return a[Math.floor(Math.random() * a.length)]; }
// exibe a mensagem com fade-in/hold/fade-out (o CSS cuida da transição)
let combatMsgT = null;
function showCombatMsg(text, theme) {
  const el = $("combat-msg");
  if (!el) return;
  el.innerHTML = text.replace("|", "<br>"); // "|" vira quebra de linha
  el.className = "cm-show" + (theme ? " cm-" + theme : "");
  clearTimeout(combatMsgT);
  combatMsgT = setTimeout(() => { el.className = el.className.replace("cm-show", "").trim(); }, 3800);
}
// Qual voz o turno tem. Ordem de prioridade: o que é mais raro e mais dramático fala
// primeiro, senão a Lua Sangrenta (a cada 10 dias) perderia a vez para uma tempestade
// (10% dos turnos) e o turno especial passaria sem ser anunciado.
// Devolve [pool, tema] ou null para usar o pool padrão do momento.
function combatTheme() {
  if (bloodMoon()) return ["bloodmoon", "blood"];
  if (blackSun()) return ["blacksun", "dark"];
  if (S.isNight && moonPhase()) return ["fullmoon", null];
  const w = S.weather;
  if (w === "tempestade") return ["storm", null];
  if (w === "turvo") return ["fog", null];
  if (w === "perfeito") return ["clear", null];
  return null;
}
// mensagem do INÍCIO do combate, conforme o evento celeste e o clima
function combatStartMsg() {
  const t = combatTheme();
  if (t) showCombatMsg(pickMsg(t[0]), t[1]);
  else showCombatMsg(pickMsg("start"));
}
// mensagem da METADE da horda
function combatHalfMsg() {
  const t = combatTheme();
  // No especial a voz do turno repete; no normal, a fala é a do meio da horda.
  if (t && Math.random() < 0.5) showCombatMsg(pickMsg(t[0]), t[1]);
  else showCombatMsg(pickMsg("half"));
}
// muralhas no limite: uma vez por turno, para não virar alarme repetido
function combatCritMsg() { showCombatMsg(pickMsg("critical"), "blood"); }
// onda limpa
function combatClearedMsg() { showCombatMsg(pickMsg("cleared")); }

// ---------- Horda / eventos celestes ----------
function moonPhase() { return S.day % 4 === 0; }
// Lua Sangrenta: a cada 10 dias, na madrugada, horda mais forte e populosa
function bloodMoon() { return S.isNight && S.day % 10 === 0; }
// Sol Negro: dias terminados em 5, durante o dia, eficiência da cidade cai pela metade
function blackSun() { return !S.isNight && S.day % 10 === 5; }
function cityEff() { return blackSun() ? 0.5 : 1; }

// Volume da horda: rampa de 2× (dia 1) a 3× (dia 8) sobre a curva antiga. A abertura
// continua jogável com uma torre só, e do meio pro fim a pressão é de QUANTIDADE.
const HORDE_MULT_MIN = 2, HORDE_MULT_MAX = 3, HORDE_MULT_DAY = 8;
function hordeMult() {
  const t = Math.min(1, Math.max(0, S.day - 1) / (HORDE_MULT_DAY - 1));
  return HORDE_MULT_MIN + (HORDE_MULT_MAX - HORDE_MULT_MIN) * t;
}
const WAVE_CAP = 600; // teto de segurança (performance / evitar slog)
function waveSize() {
  const fullMoon = S.isNight && moonPhase();
  // Base cresce ~linear com o dia; o pico de tensão vem da escalada por QUANTIDADE no mid-end.
  let n = 8 + S.day * 3.0 + (S.isNight ? 4 : 0) + (fullMoon ? 6 : 0);
  if (bloodMoon()) n = Math.round(n * 1.6);
  // Acelerador de mid-end (Ato 2): escalada por QUANTIDADE a partir do dia 10, mais forte.
  n += Math.round(Math.pow(Math.max(0, S.day - 10), 1.55) * 1.1);
  return Math.round(Math.min(WAVE_CAP, n * hordeMult()));
}

function eligibleTypes() {
  const period = S.isNight ? "night" : "day";
  return Object.keys(ENEMY_TYPES).filter(k => {
    const t = ENEMY_TYPES[k];
    return t.period === period && t.minDay <= S.day;
  });
}

function pickWave(n) {
  const pool = eligibleTypes();
  // Peso por tipo: no mid-end os pesados/blindados ficam mais comuns (não muda HP, muda a MISTURA)
  const heavy = Math.min(0.5, Math.max(0, S.day - 9) * 0.035);
  const weighted = pool.map(k => {
    const t = ENEMY_TYPES[k];
    let w = 1;
    if (t.armor < 1) w += heavy * 3; // blindados (Blindado/Carniçal/Brutamontes/Carniceiro/Abominação/Colosso)
    if (t.hp >= 40) w += heavy * 2;  // tanques
    return { k, w };
  });
  const total = weighted.reduce((s, e) => s + e.w, 0);
  const arr = [];
  for (let i = 0; i < n; i++) {
    let r = Math.random() * total;
    let pick = weighted[0].k;
    for (const e of weighted) { r -= e.w; if (r <= 0) { pick = e.k; break; } }
    arr.push(pick);
  }
  return arr;
}

function buildNextWave() {
  S.nextWave = pickWave(waveSize());
  if (S.isNight && moonPhase()) {
    for (let i = 0; i < 1 + Math.floor(S.day / 4); i++) S.nextWave.push("abominacao");
    // Colossos entram na lua cheia a partir do dia 12
    if (S.day >= ENEMY_TYPES.colosso.minDay) for (let i = 0; i < Math.floor(S.day / 12); i++) S.nextWave.push("colosso");
  }
  if (bloodMoon()) {
    for (let i = 0; i < 2 + Math.floor(S.day / 10) * 2; i++) S.nextWave.push("abominacao");
    if (S.day >= ENEMY_TYPES.colosso.minDay) for (let i = 0; i < 1 + Math.floor(S.day / 16); i++) S.nextWave.push("colosso");
  }
}

$("astro-btn").onclick = () => {
  openModal("🔭 Vigia da torre", (m) => {
    const hint = document.createElement("div");
    hint.className = "panel-hint";
    if (S.waveActive) {
      hint.textContent = "A horda já está sobre nós, comandante!";
      m.appendChild(hint);
      return;
    }
    const fullMoon = S.isNight && moonPhase();
    hint.textContent = bloodMoon()
      ? "🩸 LUA SANGRENTA! A horda vem mais forte (+50% de vida) e muito mais numerosa. O vigia avista:"
      : blackSun()
        ? "🌑 SOL NEGRO: as fábricas rendem metade neste turno. O vigia avista:"
        : `O vigia observa o horizonte ${S.isNight ? (fullMoon ? "sob a LUA CHEIA 🌕" : "da madrugada 🌙") : "do dia ☀️"}. Ele avista a próxima horda:`;
    m.appendChild(hint);
    const counts = {};
    for (const k of S.nextWave) counts[k] = (counts[k] || 0) + 1;
    for (const [k, n] of Object.entries(counts)) {
      const t = ENEMY_TYPES[k];
      const d = document.createElement("div");
      d.className = "wave-row";
      d.innerHTML = `<span class="wicon">${t.icon}</span><span class="wname">${t.name}${t.armor < 1 ? " (resistente)" : ""}${t.spd > 0.08 ? " (veloz)" : ""}</span><span class="wcount">×${n}</span>`;
      m.appendChild(d);
    }
    // Clima do turno: puramente visual, mas o jogador merece saber o que vai enxergar.
    const sky = document.createElement("div");
    sky.className = "panel-hint";
    sky.innerHTML = `${weather().ic} <b>${weather().name}:</b> ${weather().desc}`
      + (S.weather === "turvo" ? " <i>As torres continuam mirando normalmente.</i>" : "");
    m.appendChild(sky);
    // O saque mingua a cada dia: o jogador precisa ver isso para planejar os gastos.
    const loot = document.createElement("div");
    loot.className = "panel-hint";
    loot.innerHTML = `🪙 <b>Saque:</b> ${Math.round(goldDropChance() * 100)}% dos corpos ainda carregam moedas`
      + (S.day > ELDERS_DAY ? ` · <b>Os Mortos Antigos</b> levam metade do que sobra` : "");
    m.appendChild(loot);
  });
};

// ---------- HUD ----------
function renderHUD() {
  const fullMoon = S.isNight && moonPhase();
  const mk = $("morale-mark");
  if (mk) mk.style.left = (50 + S.morale / 3) + "%";
  renderHudBrasao();
  $("hud-hp").innerHTML = `<span class="hp-d">◆</span> ${Math.max(0, S.hits)}/${maxHits()} HP`;
  syncLiveRes(); // moedas globais vivem na barra de recursos (e no resumo de "Seu Setor")
  $("btn-wave").disabled = S.waveActive;
  const phaseFull = `${S.isNight ? "Noite" : "Dia"} ${S.day}`;
  const phaseShort = `${S.isNight ? "N" : "D"}${S.day}`;
  $("btn-wave").textContent = S.waveActive ? `⚔ Em curso · ${phaseShort}` : `▶ Turno · ${phaseFull}`;
  $("btn-speed").textContent = S.debug.speed + "x";
  $("btn-speed").classList.toggle("fast", S.debug.speed > 1);
  $("btn-lock").textContent = S.autoTurn ? "🔒" : "🔓";
  $("btn-lock").classList.toggle("on", S.autoTurn);
  $("light").className = bloodMoon() ? "blood" : blackSun() ? "dark" : S.isNight ? (fullMoon ? "moon" : "night") : "day";
  $("astro-btn").style.display = S.waveActive ? "none" : ""; // vigia some junto com o astro
  // visita do dia pendente: quadrado dourado piscando na aba das Alianças
  $("tab-favores").classList.toggle("has-visit", favVisitPending() && !S.waveActive);
}

function renderAll() { renderHUD(); renderTowers(); renderCity(); renderSupplyRate(); }

// ---------- Onda / combate ----------
let spawnQueue = [], spawnTimer = 0, supplyTimer = 0, lastT = 0;
let waveTotal = 0, waveHalfShown = false; // total da horda e flag da mensagem "metade"
let waveCritShown = false; // aviso de muralha no limite: uma vez por turno, nao um alarme
// Fade in/out do astro (lua/sol): some no combate, reaparece no planejamento.
let astroFade = 1, astroFadeT = 0;
let qCd = {};        // cooldown dos quartéis de arqueiros
let blockPool = 0;   // bloqueios de guarnição disponíveis no turno
let gateCd = 0;      // cooldown do preenchimento automático do Portão

function startWave() {
  if (S.waveActive) return;
  S.waveActive = true;
  stopPlacing();
  stopTutorial();  // as dicas são do planejamento; em combate a linha é da mensagem de combate
  closeModal();
  $("conveyor").classList.add("running");
  $("conveyor-v").classList.add("running");
  spawnQueue = [...S.nextWave];
  // 1,5s antes do primeiro aviso: o astro leva ~1,4s para sumir, e a caveira nasce no
  // mesmo topo da tela. Sem essa folga as duas coisas se sobrepõem na virada do turno.
  spawnTimer = 1.5; supplyTimer = 0;
  S.allyGrind = null;                                   // o Moedor recomeça a cada turno
  for (const t of S.towers) if (t) { t.spot = null; t.spotT = 0; } // holofotes reapontam
  S.groundFires = [];
  S.turnHitsLost = 0;
  openTurnSum();   // abre o livro-caixa do turno (ver turnChips)
  qCd = {};
  blockPool = cityFxScan(c => c.built === "quartel", "block");
  waveTotal = S.nextWave.length; waveHalfShown = false; waveCritShown = false; // rastreio da metade da horda
  combatStartMsg();
  renderAll();
}

function spawnEnemy(lane, type) {
  const t = ENEMY_TYPES[type];
  // O HP base segue fixo por tipo; a partir do dia HP_RAMP_FROM entra a escalada por
  // DIA (enemyHpDayMult), somada à escalada por QUANTIDADE (waveSize) e por NOVOS
  // TIPOS (minDay). Modificadores externos continuam por cima: lua sangrenta, Medo
  // (moral) e dayMods (eventos diários).
  const hp = Math.round(t.hp * ENEMY_TOUGHNESS * enemyHpDayMult() * (bloodMoon() ? 1.5 : 1) * moraleEnemyHpMult() * dm("enemyHp"));
  S.enemies.push({
    lane, y: -0.05, type,
    hp, maxHp: hp,
    speed: t.spd * ENEMY_MARCH * slowFactor() * moraleEnemySpdMult() * dm("enemySpd"),
    armor: dm("allArmored", 0) ? Math.min(t.armor, 0.6) : t.armor, // evento "Marcha Blindada"
    burn: 0,
    aura: Math.random() < 0.2 ? SHAPE_KEYS[Math.floor(Math.random() * 3)] : null, // 1/5 nasce com aura (ameaça)
    ph: Math.random() * 6.283, // fase da passada (só visual: desencontra o balanço da horda)
  });
}

function addFloat(x, y, txt, color) {
  // Números de dano (texto que começa com "-dígito", ex.: "-30", "-50 ⚡"): respeitam a config.
  if (!SETTINGS.dmgNumbers && /^-\d/.test(txt)) return;
  S.floats.push({ x, y, txt, color, life: 1.1, max: 1.1 });
}

// Modos de mira configuráveis por torre (clique na torre). "near" = neutro/padrão.
const AIM_MODES = {
  near:   { icon: "🎯", name: "Mais próximo", desc: "mira o inimigo mais perto das muralhas (padrão)" },
  weak:   { icon: "🩸", name: "Mais fraco",   desc: "mira quem tem menos vida (finaliza)" },
  strong: { icon: "💪", name: "Mais forte",   desc: "mira quem tem mais vida (foca os tanques)" },
  far:    { icon: "🌫️", name: "Mais novo",    desc: "mira o inimigo mais longe que alcança (recém-chegado)" },
};
const AIM_ORDER = ["near", "weak", "strong", "far"];

// Modo efetivo: no neutro ("near") a upgrade fx.far (mirar o mais distante) ainda vale.
function towerAim(t, fx) {
  const a = t.aim || "near";
  return (a === "near" && fx && fx.far) ? "far" : a;
}
// Ordena os alvos conforme o modo; targets[0] é o alvo escolhido.
function sortByAim(targets, aim) {
  const arr = targets.slice();
  if (aim === "weak")        arr.sort((a, b) => a.hp - b.hp || b.y - a.y);
  else if (aim === "strong") arr.sort((a, b) => b.hp - a.hp || b.y - a.y);
  else if (aim === "far")    arr.sort((a, b) => a.y - b.y); // menor y = mais longe/novo
  else                       arr.sort((a, b) => b.y - a.y); // maior y = mais perto (padrão)
  return arr;
}

function towerRate(t) {
  const fx = towerFx(t);
  const adj = depotAdjFx(t);   // Estoque ao lado: recarrega mais rápido
  return TOWER_TYPES[t.type].rate
    / ((1 + rateBonus() + moralBoost()) * (1 + (fx.r || 0)) * prestigeRateMult(t) * (1 + (adj ? adj.rate : 0)));
}
// Dano global das torres contra as tropas — subido para acompanhar hordas maiores/mais densas.
const TROOP_DMG_MULT = 1.3;
function towerDmg(t) {
  const fx = towerFx(t);
  const typeDmg = towerTypeFx(t.type, "typeDmg");
  // Torres novas (3 caminhos): crescimento base LEVE (×1.10/tier); poder vem dos tiers.
  // Torres antigas: crescimento por nível (×1.22/nível).
  const base = isNewTower(t) ? Math.pow(1.10, towerTotalTiers(t)) : Math.pow(1.22, t.lvl - 1);
  return TOWER_TYPES[t.type].dmg * TROOP_DMG_MULT * lawTowerMult(t)
    * (1 + (fx.d || 0)) * (1 + typeDmg) * base * prestigeDmgMult(t)
    * moraleEffMult() * dm("towerDmg") * facTowerMult() * buildingTowerMult(); // leis + moral + evento + facção + prestígio + Bastião

}

// Esteira: abastece POR PROXIMIDADE do D, torre 5 primeiro, depois 4, 3...
// A munição só passa adiante se a torre da vez estiver cheia.
const CRATE_V_MS = 500, CRATE_H_MS = 900, CRATE_GAP_MS = 280;
const CRATE_SPEED_MS_PER_PCT = 9.7; // esteira horizontal: velocidade CONSTANTE (ms por % de largura)
const prodCarry = {};
let cratesInFlight = 0;

// Cadeia contínua: roda no planejamento E no combate (a esteira abastece as
// torres entre turnos também). 1) enche os tanques das fábricas com recurso do
// Feudo; 2) produz munição consumindo dos tanques; 3) despacha caixas em fileira.
function tickTanks(dt) {
  const seen = new Set();
  for (const c of S.city) {
    if (!isFactory(c) || cellOff(c) || seen.has(c.gid)) continue;
    seen.add(c.gid);
    const feed = BUILDINGS[c.built].feed;
    if (!feed) continue;
    const lead = groupLead(c.gid);
    lead.stock = lead.stock || 0;
    const cap = tankCap(c.gid), n = groupCells(c.gid).length;
    const want = cap - lead.stock;
    if (want > 0 && (S.res[feed] || 0) > 0) {
      const pull = Math.min(FACT_FILL_PER_SEC * n * dt, want, S.res[feed]);
      lead.stock += pull;
      S.res[feed] = Math.max(0, S.res[feed] - pull);
    }
  }
}
function tickProduction(dt) {
  const perSec = 1 / supplyInterval();       // fração de um ciclo de esteira por segundo
  const carryCap = ammoCap() * LANES;         // não acumula além do que as torres comportam
  for (let i = 0; i < S.city.length; i++) {
    const c = S.city[i];
    if (!isFactory(c) || cellOff(c)) continue;
    const type = BUILDINGS[c.built].prod, feed = BUILDINGS[c.built].feed;
    // Torres saturadas: não produz nem consome (evita drenar o estoque à toa).
    // O teto real é o espaço que as torres ainda comportam; só com "Ajudar o
    // Reino" ligado é que vale produzir além disso (o excedente vira Medalha).
    const cap = S.helpKingdom ? carryCap : Math.min(carryCap, ammoDemand(type));
    if ((prodCarry[type] || 0) >= cap) continue;
    let supplied = 1;
    if (feed) {
      const lead = groupLead(c.gid);
      lead.stock = lead.stock || 0;
      // consumo dosado ~por TURNO (não por ciclo), p/ casar com a produção dos extratores
      const need = cellGated(c) * feedPer() * dt / FEED_TURN_SECONDS;
      if (need > 0) {
        if (lead.stock >= need) lead.stock -= need;
        else { supplied = lead.stock / need; lead.stock = 0; }
      }
    }
    prodCarry[type] = (prodCarry[type] || 0) + cellProdFull(i) * perSec * dt * supplied * prodEffMult();
  }
}
// Produção dos extratores do Feudo POR SEGUNDO (tempo real). O total ao longo de um turno
// "médio" (FEED_TURN_SECONDS) equivale ao antigo rendimento por turno; quem demora entre
// rodadas acumula mais (limitado pelo RES_CAP). Só a produção é contínua — o desgaste (life)
// segue por turno, em tickExtractors.
function tickExtractProd(dt) {
  const groups = {};
  S.feud.forEach((c, i) => {
    if (!c.built || !isProducerExtractor(c.built) || cellOff(c)) return;
    (groups[c.gid] ||= { key: c.built, idxs: [] }).idxs.push(i);
  });
  for (const gid in groups) {
    const { key, idxs } = groups[gid], b = EXTRACTORS[key];
    const left = maintLeft(gid);
    if (left <= 0) continue; // Em Manutenção: já bateu o teto deste turno
    const want = b.yield * idxs.length * mioloYieldMult() * feudOverdriveMult() * dt / FEED_TURN_SECONDS;
    // Conta na cota só o que REALMENTE entrou: com o estoque no RES_CAP o extrator não
    // queima a manutenção do turno à toa.
    const before = resAmount(b.res);
    addResource(b.res, Math.min(want, left));
    S.feudOut[gid] = maintOut(gid) + (resAmount(b.res) - before);
    // Sem toast: a chave inglesa na célula e a linha no painel já contam a história.
    if (maintDone(gid)) renderCity();
  }
}
function tickSupplyChain(dt) {
  helpKingdomGuard(); // derruba o "Ajudar o Reino" antes que ele zere o Feudo
  tickExtractProd(dt);
  tickTanks(dt);
  tickProduction(dt);
  tickDepots(dt);     // Estoque de Munições reabastece as vizinhas entre as caixas
  supplyTimer -= dt;
  if (supplyTimer <= 0) { dispatchCrates(); supplyTimer = supplyInterval(); }
}

// Oficina de Muros: repara +1 de vida da muralha a cada 30s (real, acelera com o
// nível somado das Oficinas — sempre +1 por vez, nunca cura em lote).
const OFICINA_REPAIR_SEC = 30;
function tickOficinaRepair(dt) {
  const lv = groupLvlSum("oficina");
  if (lv <= 0 || S.hits >= maxHits()) { S.oficinaAcc = 0; return; }
  S.oficinaAcc = (S.oficinaAcc || 0) + dt;
  const interval = OFICINA_REPAIR_SEC / lv;
  if (S.oficinaAcc >= interval) {
    S.oficinaAcc -= interval;
    S.hits = Math.min(maxHits(), S.hits + 1);
    addFloat(2, 0.52, "🧱 Oficina: +1", "#eecd5c");
    renderHUD();
  }
}

// Feudo: a esteira vertical leva os recursos dos extratores até o Centro de Distribuição (topo).
function sendResourceCrate(icon) {
  const cv = document.createElement("span");
  cv.className = "crate-v";
  cv.textContent = icon;
  cv.style.top = "100%";
  $("belt-v").appendChild(cv);
  requestAnimationFrame(() => requestAnimationFrame(() => { cv.style.top = "-4px"; }));
  setTimeout(() => cv.remove(), CRATE_V_MS + 120);
}
function feudBeltTick() {
  if (S.field !== "feud") return;
  const icons = Object.keys(feudResRates()).map(r => resMeta(r).icon);
  if (icons.length) sendResourceCrate(icons[Math.floor(Math.random() * icons.length)]);
}

function dispatchCrates() {
  const jobs = [], overflow = [], reserva = {};
  let excess = 0;
  for (const type of Object.keys(AMMO)) {
    let pool = Math.floor(prodCarry[type] || 0);
    prodCarry[type] = (prodCarry[type] || 0) - pool;
    for (let i = LANES - 1; i >= 0 && pool > 0; i--) {
      const t = S.towers[i];
      if (!t || !TOWER_TYPES[t.type].ammos.includes(type) || ammoOf(t, type) >= ammoCap()) continue;
      const amount = Math.min(crateSize() + ammoTypeFx(type, "crate") + lawCrateBonus(type), pool, ammoCap() - ammoOf(t, type));
      pool -= amount;
      jobs.push({ slot: i, amount, type });
    }
    // Estoques de Munições enchem DEPOIS das torres: o depósito é para a sobra, não
    // para competir com quem está atirando. Vem antes do "Ajudar o Reino" porque
    // guardar munição para a horda vale mais que trocá-la por Medalha.
    for (let i = LANES - 1; i >= 0 && pool > 0; i--) {
      const d = S.towers[i];
      if (!isDepot(d) || !depotTypes(i).includes(type)) continue;
      // `reserva` existe porque a capacidade é UM bolo dividido entre os tipos: sem
      // ela, dois tipos no mesmo ciclo prometeriam o mesmo espaço vazio.
      const room = depotRoom(d) - (reserva[i] || 0);
      if (room <= 0) continue;
      const amount = Math.min(pool, room);
      pool -= amount;
      reserva[i] = (reserva[i] || 0) + amount;
      jobs.push({ slot: i, amount, type });
    }
    // Sobra que as torres não comportam: com "Ajudar o Reino" desce a esteira e
    // vira Medalha; sem o toggle, volta para o carry (nada é produzido a mais,
    // então isso só devolve o arredondamento — não some recurso).
    if (pool > 0) {
      if (S.helpKingdom) { excess += pool; overflow.push({ amount: pool, type }); }
      else prodCarry[type] = (prodCarry[type] || 0) + pool;
    }
  }
  // Libera as caixas em FILEIRA (uma atrás da outra na esteira), não empilhadas
  jobs.forEach((j, k) => setTimeout(() => sendCrate(j.slot, j.amount, j.type), k * CRATE_GAP_MS));
  // Ajudar o Reino: o excedente atravessa a esteira inteira e some no fim.
  // A Medalha (HELP_RATE ▸ 1) só é creditada quando a caixa chega ao fim.
  overflow.forEach((o, k) => setTimeout(() => sendOverflowCrate(o.amount, o.type), (jobs.length + k) * CRATE_GAP_MS));
}
// crédito do excedente ao fim da esteira
function creditHelpKingdom(amount) {
  S.helpPool = (S.helpPool || 0) + amount;
  while (S.helpPool >= HELP_RATE) {
    S.helpPool -= HELP_RATE;
    addMedals(1);
    addFloat(2, 0.35, "🎖️ +1 Medalha (Ajudar o Reino)", "#eecd5c");
  }
}

// Caixa do excedente (Ajudar o Reino): percorre a esteira INTEIRA, passa das
// torres e desaparece no fim — só então a munição vira Medalha.
function sendOverflowCrate(amount, type) {
  const icon = AMMO[type].icon;
  cratesInFlight++;
  const cv = document.createElement("span");
  cv.className = "crate-v";
  cv.textContent = icon;
  cv.style.top = "100%";
  $("belt-v").appendChild(cv);
  requestAnimationFrame(() => requestAnimationFrame(() => { cv.style.top = "-22px"; }));
  setTimeout(() => {
    cv.remove();
    const ch = document.createElement("span");
    ch.className = "crate crate-help";
    ch.textContent = icon;
    ch.style.left = "100%";
    const travelMs = Math.max(120, 108 * CRATE_SPEED_MS_PER_PCT); // até sumir da esteira
    // some só no último terço do trajeto
    ch.style.transition = `left ${travelMs}ms linear, opacity ${Math.round(travelMs * 0.35)}ms ease-in ${Math.round(travelMs * 0.6)}ms, transform ${Math.round(travelMs * 0.35)}ms ease-in ${Math.round(travelMs * 0.6)}ms`;
    $("belt").appendChild(ch);
    requestAnimationFrame(() => requestAnimationFrame(() => { ch.style.left = "-8%"; ch.classList.add("fading"); }));
    setTimeout(() => {
      ch.remove();
      cratesInFlight--;
      creditHelpKingdom(amount);
    }, travelMs);
  }, CRATE_V_MS);
}

function sendCrate(slot, amount, type) {
  const icon = AMMO[type].icon;
  cratesInFlight++;
  const cv = document.createElement("span");
  cv.className = "crate-v";
  cv.textContent = icon;
  cv.style.top = "100%";
  $("belt-v").appendChild(cv);
  requestAnimationFrame(() => requestAnimationFrame(() => { cv.style.top = "-22px"; }));
  setTimeout(() => {
    cv.remove();
    const ch = document.createElement("span");
    ch.className = "crate";
    ch.textContent = icon;
    ch.style.left = "100%";
    // Velocidade CONSTANTE: a duração acompanha a distância até o slot, para que
    // caixas para torres distantes NÃO ultrapassem as de torres próximas (fileira real).
    const targetPct = slot * 20 + 7;
    const travelMs = Math.max(120, (100 - targetPct) * CRATE_SPEED_MS_PER_PCT);
    ch.style.transition = `left ${travelMs}ms linear`;
    $("belt").appendChild(ch);
    requestAnimationFrame(() => requestAnimationFrame(() => { ch.style.left = targetPct + "%"; }));
    setTimeout(() => {
      ch.remove();
      cratesInFlight--;
      const t = S.towers[slot];
      if (t) {
        if (isDepot(t)) depotReceive(t, type, amount);
        else {
          if (!t.ammoBy) t.ammoBy = {};
          t.ammoBy[type] = Math.min(ammoCap(), ammoOf(t, type) + amount);
        }
        renderTowers();
        const el = $("towers").children[slot];
        if (el) { el.classList.add("resupply"); setTimeout(() => el.classList.remove("resupply"), 400); }
      }
    }, travelMs);
  }, CRATE_V_MS);
}

// ---------- Inimigos à distância ----------
// Alguns tipos atiram em vez de só avançar. Miram a tropa da frente na lane; sem
// tropa, só podem fustigar a MURALHA depois de cruzar a metade do campo.
// Golpes de longe não custam um hit inteiro: acumulam até romper a muralha.
const RANGED_MIDFIELD = 0.5;   // metade do campo: daqui pra frente a muralha entra no alcance
const WALL_CHIP_PER_HIT = 30;  // dano de longe acumulado para custar 1 hit
const ESHOT_SPEED = 0.85;      // fração do campo por segundo
function tickEnemyRanged(e, dt) {
  const rng = ENEMY_TYPES[e.type].rng;
  if (!rng || e.hp <= 0 || e.stun > 0) return;
  e.rcd = (e.rcd || 0) - dt;
  if (e.rcd > 0) return;
  // alvo: a tropa mais próxima à frente, na mesma lane, dentro do alcance
  let target = null;
  for (const a of S.allies) {
    if (a.lane !== e.lane || a.hp <= 0) continue;
    const d = a.y - e.y;
    if (d <= 0.05 || d > rng.reach) continue; // encostado = briga no corpo a corpo
    if (!target || a.y < target.y) target = a;
  }
  if (!target && e.y < RANGED_MIDFIELD) return; // muralha só a partir do meio do campo
  e.rcd = rng.cd;
  S.eshots.push({ lane: e.lane, y: e.y, ty: target ? target.y : 1, target, dmg: rng.dmg, ic: rng.ic });
}
function tickEnemyShots(dt) {
  if (!S.eshots || !S.eshots.length) return;
  for (const s of S.eshots) {
    s.y += ESHOT_SPEED * dt;
    if (s.target) s.ty = s.target.y; // persegue a tropa que anda
    if (s.y < s.ty) continue;
    s.done = true;
    const a = s.target;
    if (a && S.allies.includes(a) && a.hp > 0) {
      if (allyImmuneRanged(a)) { addFloat(a.lane, a.y - 0.04, "● imune", "#d6608f"); continue; }
      const dmg = Math.round(s.dmg * (1 - (ALLY_TYPES[a.type].tank || 0)));
      a.hp -= dmg;
      addFloat(a.lane, a.y - 0.04, `-${dmg}`, "#e05f5f");
      continue;
    }
    if (a) continue;              // a tropa alvo já morreu: o tiro se perde
    chipWall(s.dmg, s.lane);      // sem tropa: a muralha é fustigada de longe
  }
  S.eshots = S.eshots.filter(s => !s.done);
}
function chipWall(dmg, lane) {
  // O primeiro dano na lane — mesmo vindo de longe — rompe o selo de proteção
  // e limpa a lane inteira (igual ao golpe corpo a corpo na muralha).
  if (S.seals[lane]) {
    S.seals[lane] = 0;
    S.sweeps.push({ lane, y: 1 });
    addFloat(lane, 0.9, "◈ SELO ROMPIDO", ARCANE.lightHex);
    for (const o of S.enemies) if (o.lane === lane) o.hp = -999; // sem recompensa
    return;
  }
  S.wallChip = (S.wallChip || 0) + dmg;
  // Tiro de longe que não completou um hit: a muralha aguentou. "Lascou" soava como
  // dano levado, quando na prática nada foi perdido ainda.
  if (S.wallChip < WALL_CHIP_PER_HIT) { addFloat(lane, 0.95, "🧱 RESISTIU", "#c8b088"); return; }
  S.wallChip -= WALL_CHIP_PER_HIT;
  S.hits--;
  S.turnHitsLost++;
  addFloat(lane, 0.95, "🧱 MURALHAS ATINGIDAS", "#e05f5f");
  renderHUD();
  if (S.hits <= 0) gameOver();
}

function projectileHit(p) {
  const fx = p.fx || {};
  const alive = S.enemies.includes(p.target) && p.target.hp > 0;
  let hit;
  if (p.aoe) {
    hit = S.enemies.filter(e => e.lane === Math.round(p.ex) && Math.abs(e.y - p.ey) < p.aoe * 0.25);
  } else if (p.chain) {
    hit = [...S.enemies].sort((a, b) => b.y - a.y).slice(0, p.chain);
  } else {
    hit = alive ? [p.target] : [];
  }
  // perfuração: acerta também os próximos atrás do alvo na mesma lane
  // (soma perfuração de leis/upgrades + perfuração-base da torre, ex.: Serras/Caçadores)
  const pierce = (fx.pierce || 0) + (p.pierce || 0);
  if (pierce && alive) {
    const behind = S.enemies
      .filter(e => e !== p.target && e.lane === p.target.lane && e.y < p.target.y)
      .sort((a, b) => b.y - a.y)
      .slice(0, pierce);
    hit = [...new Set([...hit, ...behind])];
  }
  // bumerangue (Torre dos Caçadores): a volta acerta de novo quem estiver na lane
  if (p.boomerang && alive) {
    const back = S.enemies.filter(e => e.lane === p.target.lane && e.y >= p.target.y);
    hit = [...new Set([...hit, ...back])];
  }
  for (const e of hit) {
    let dmg = p.dmg;
    // Crítico: base global + o que os caminhos da torre somarem + o holofote da lane.
    const critC = Math.min(0.95, CRIT_BASE + (fx.critC || 0) + (litLanes.has(e.lane) ? SPOT_CRIT : 0));
    const crit = Math.random() < critC;
    if (crit) dmg *= Math.max(CRIT_MULT, fx.critM || 0);
    if (fx.vsArm && e.armor < 1) dmg *= 1 + fx.vsArm;
    if (fx.ramp) { e._ramp = (e._ramp || 0) + 1; dmg *= 1 + Math.min(1, e._ramp * fx.ramp); }
    dmg *= p.magic ? 1 : armorFactor(e);
    dmg *= 1 + (e.vuln || 0);
    dmg += e.maxHp * (fx.maxhp || 0);
    const dealt = Math.round(dmg);
    e.hp -= dealt;
    // efeitos de status
    if (hasBurn()) e.burn = 3;
    if (fx.poison) e.pz = { dps: fx.poison, t: 3, slow: fx.pSlow || 0, spread: !!fx.pSpread, shred: !!fx.shred };
    if (fx.shredHit) e.armor = Math.min(1, e.armor + 0.2);
    if (fx.mark) e.vuln = Math.max(e.vuln || 0, fx.mark);
    if (fx.slow) e.chill = { pct: fx.slow, t: 3 };
    if (p.slow) e.chill = { pct: p.slow, t: 3 }; // Soprador Invernal (congela)
    if (fx.stun) e.stun = Math.max(e.stun || 0, fx.stun);
    if (fx.knock) e.y = Math.max(0, e.y - fx.knock);
    if (fx.kg) e.bountyG = fx.kg;
    if (fx.kh) e.bountyH = fx.kh;
    // execução
    if (fx.exec && e.hp > 0 && e.hp < e.maxHp * fx.exec) {
      e.hp = 0;
      addFloat(e.lane, e.y - 0.08, "EXECUTADO!", "#ff8a6a");
    }
    addFloat(e.lane, e.y - 0.04, crit ? `-${dealt} ✦` : `-${dealt}`,
      crit ? "#ffd86a" : p.magic ? "#c89aff" : p.chain ? "#8ae0ff" : "#eecd5c");
  }
  // fogo no chão
  if (fx.ground) {
    S.groundFires.push({ lane: Math.round(p.ex), y: p.ey, dps: fx.ground, t: 4 + (fx.groundDur || 0), r: 0.09 + (fx.groundR || 0) });
  }
  if (hit.length) S.effects.push({ x: p.ex, y: p.ey, life: 0.3, max: 0.3, type: p.type });
}

function update(dt) {
  if (S.paused) return; // congelado enquanto o overlay de Configurações/Saída está aberto
  // Cadeia de suprimentos roda no planejamento E no combate (a esteira abastece entre turnos)
  if ($("menu").classList.contains("hidden")) {
    tickSupplyChain(dt);
    tickOficinaRepair(dt);
  }
  if (S.towerBuff && S.towerBuff.t > 0) S.towerBuff.t -= dt; // Infusor Arcano (buff de tropas)
  if (S.allyGrind && S.allyGrind.t > 0) S.allyGrind.t -= dt; // Moedor de Plebe
  // Lanes acesas pelos holofotes: recalculado aqui para o tiro e o crítico consultarem.
  litLanes = new Set();
  for (const t of S.towers) {
    if (t && TOWER_TYPES[t.type] && TOWER_TYPES[t.type].support === "spot" && t.spot != null) litLanes.add(t.spot);
  }
  for (const fx of S.effects) fx.life -= dt;
  S.effects = S.effects.filter(fx => fx.life > 0);
  for (const f of S.floats) { f.life -= dt; f.y -= dt * 0.045; }
  S.floats = S.floats.filter(f => f.life > 0);
  for (const l of S.powerLines) l.life -= dt;
  S.powerLines = S.powerLines.filter(l => l.life > 0);
  for (const sw of S.sweeps) sw.y -= dt * 2.2; // varredura sobe a lane
  S.sweeps = S.sweeps.filter(sw => sw.y > -0.1);

  // Portão automático: invoca quando há vaga
  if (S.gateAuto && S.allies.length < ALLY_LIMIT) {
    gateCd -= dt;
    // ideologia Amarela também acelera a REPOSIÇÃO das baixas
    if (gateCd <= 0) { gateCd = 3 / allyFacSpdMult({ fac: S.gateFac }); summonAlly(S.gatePref, S.gateFac); }
  }

  // Aliados: movimento e combate por MODO (Proteger = segura a muralha / Atacar = avança até o inimigo)
  const eDps = (3 + S.day * 0.25) * moraleEnemyDmgMult() * dm("enemyDmg");
  const WALL_Y = 0.9;
  for (const a of S.allies) {
    const at = ALLY_TYPES[a.type];
    // engaja o inimigo mais à frente (maior y) da lane, dentro do alcance
    let engaged = null;
    for (const e of S.enemies) {
      if (e.lane !== a.lane || e.hp <= 0) continue;
      const dy = Math.abs(e.y - a.y);
      if (at.melee ? dy < 0.05 : dy < at.range) {
        if (!engaged || e.y > engaged.y) engaged = e;
      }
    }
    if (engaged) {
      const atkMult = (a.aura && a.aura.type === "triangle") ? 1 + auraPower(0.2, a) : 1; // Triângulo: +20% ataque (+leis)
      engaged.hp -= at.dps * allyDmgMult() * allyFacAtkMult(a) * atkMult * dt;
      if (Math.abs(engaged.y - a.y) < 0.05) {
        // Lex Arcanum: o escudo da aura absorve o primeiro segundo de golpes
        if (a.lawShield > 0) { a.lawShield -= dt; }
        else {
          const defMult = (a.aura && a.aura.type === "square") ? 1 - auraPower(0.2, a) : 1; // Quadrado: -20% dano recebido (+leis)
          a.hp -= eDps * defMult * (1 - (at.tank || 0)) * dt; // Escudeiro absorve parte do golpe
        }
      }
    } else {
      const spd = at.spd * allySpdMult() * allyFacSpdMult(a); // estábulos + ideologia Amarela
      const enemyAhead = S.enemies.some(e => e.lane === a.lane && e.hp > 0 && e.y < a.y - 0.01);
      if (S.gateMode === "attack" && enemyAhead) {
        a.y = Math.max(0.05, a.y - spd * dt);              // ATACAR: avança para interceptar
      } else {
        a.y = a.y < WALL_Y ? Math.min(WALL_Y, a.y + spd * dt) : WALL_Y; // volta / segura na muralha
      }
    }
    if (a.aura) { a.aura.t -= dt; if (a.aura.t <= 0) clearAura(a); } // aura some sozinha
    if (a.ttl != null) { a.ttl -= dt; if (a.ttl <= 0) { a.hp = 0; addFloat(a.lane, a.y, "👻 dissipou", "#c89aff"); } }
    if (a.hp <= 0 && a.type !== "sombra") {
      addFloat(a.lane, a.y, "☠ tombou", "#c8b088");
      if (turnSum) turnSum.allyLost++;   // o filtro abaixo tira o corpo: conta aqui, uma vez
    }
  }
  S.allies = S.allies.filter(a => a.hp > 0);

  if (!S.waveActive) return;

  // linhas de poder: dano leve nos inimigos que as tocam
  if (S.powerLines.length) {
    const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
    for (const e of S.enemies) {
      const ex = (e.lane + 0.5) / LANES * w, ey = e.y * h;
      for (const l of S.powerLines) {
        if (l.pts.some(p => {
          const dx = p.x * w - ex, dy = p.y * h - ey;
          return dx * dx + dy * dy < POWER_RADIUS * POWER_RADIUS;
        })) { e.hp -= POWER_DPS * dt; break; }
      }
    }
  }

  // spawn em RAJADAS: grupos chegam juntos, em lanes distintas
  // pressão simultânea ("overwhelmed"), mas sempre telegrafada.
  spawnTimer -= dt;
  if (spawnQueue.length > 0 && spawnTimer <= 0) {
    // Ritmo PvZ: a horda "pinga" em levas espaçadas. As levas cresceram junto com o
    // volume — o turno fica ~1,8× mais longo, não 3×, então é mais DENSO e não mais lento.
    let burst = 3 + Math.floor(S.day / 3.0) + (bloodMoon() ? 3 : 0);
    // Aglomeração: de vez em quando uma parede de mortos desaba de uma vez (pico de tensão).
    const surge = Math.random() < 0.24 + Math.min(0.20, Math.max(0, S.day - 6) * 0.014);
    if (surge) burst = Math.round(burst * 2.2);
    burst = Math.min(spawnQueue.length, burst);
    const lanes = [0, 1, 2, 3, 4].sort(() => Math.random() - 0.5);
    for (let b = 0; b < burst; b++) {
      const _wt = warnTime();
      S.warnings.push({ lane: lanes[b % LANES], t: _wt, tMax: _wt, type: spawnQueue.shift() });
    }
    // Depois de uma aglomeração, um respiro maior: é o vazio que faz a parede assustar.
    spawnTimer = Math.max(2.0, 3.4 - Math.max(0, S.day - 10) * 0.05) + (surge ? 2.6 : 0);
  }
  for (const wn of S.warnings) {
    wn.t -= dt;
    if (wn.t <= 0) spawnEnemy(wn.lane, wn.type);
  }
  S.warnings = S.warnings.filter(wn => wn.t > 0);

  // (a esteira/produção agora rodam em tickSupplyChain, no planejamento e no combate)

  // Indicador de alvo: a cada frame marca quem cada torre está mirando
  // (independe do cooldown de tiro, o destaque fica estável, não pisca).
  for (const e of S.enemies) e._targeted = false;
  for (let i = 0; i < LANES; i++) {
    const t = S.towers[i];
    if (!t) continue;
    const tt = TOWER_TYPES[t.type];
    const fx = towerFx(t);
    const range = fx.rangeAll ? 999 : tt.range + (fx.range || 0);
    let targets = S.enemies.filter(e => range >= 1 || e.y > 1 - range);
    if (!targets.length) continue;
    targets = sortByAim(targets, towerAim(t, fx));
    const n = 1 + (fx.extra || 0); // torres com tiros extras miram vários
    for (let k = 0; k < n && k < targets.length; k++) targets[k]._targeted = true;
  }

  for (let i = 0; i < LANES; i++) {
    const t = S.towers[i];
    if (!t) continue;
    // O Estoque não tem ciclo de tiro: ele trabalha no tickDepots, que roda também no
    // planejamento. Sair aqui evita o pulso de "disparo" a cada 2s num galpão parado.
    if (TOWER_TYPES[t.type].support === "depot") continue;
    t.cd = (t.cd ?? 0) - dt;
    if (t.cd > 0) continue;
    const tt = TOWER_TYPES[t.type];
    const fx = towerFx(t);
    const cost = Math.ceil((1 + (fx.cost || 0)) * dm("ammoCost"));
    if (!towerFed(t, cost)) continue; // exige TODAS as munições em estoque
    // torres de suporte: não atiram; consomem munição e aplicam o efeito
    if (tt.support) {
      consumeTowerAmmo(t, cost, fx);
      t.cd = towerRate(t);
      // Bônus dos caminhos (3-caminhos): heal, buffAtk, buffT, dispelVuln, charmC/N/Dur
      const buffT = towerRate(t) + 0.5 + (fx.buffT || 0);
      if (tt.support === "heal") { const h = 4 + (fx.heal || 0); for (const a of S.allies) healAlly(a, h);
        if (fx.buffAtk) S.towerBuff = { atk: fx.buffAtk, t: buffT }; }
      else if (tt.support === "buff") { S.towerBuff = { atk: 0.25 + (fx.buffAtk || 0), t: buffT };
        if (fx.heal) for (const a of S.allies) healAlly(a, fx.heal); }
      else if (tt.support === "mage") {
        // Escola de Magos: rompe os selos (armadura) dos inimigos perto da muralha
        // e reforça os aliados com uma aura aleatória (ataque OU cura).
        for (const e of S.enemies) {
          if (e.y > 0.6 && e.armor < 1) {
            e.armor = 1; e.vuln = Math.max(e.vuln || 0, 0.15 + (fx.dispelVuln || 0));
            addFloat(e.lane, e.y - 0.04, "◈ selo rompido", ARCANE.lightHex);
          }
        }
        if (Math.random() < 0.5) { const h = 5 + (fx.heal || 0); for (const a of S.allies) healAlly(a, h); }
        else { S.towerBuff = { atk: 0.2 + (fx.buffAtk || 0), t: buffT }; }
      }
      else if (tt.support === "spot") {
        // Varre para a lane com mais inimigos, mas só depois de SPOT_MOVE_SEC parado.
        t.spotT = (t.spotT ?? 0) - towerRate(t);
        if (t.spot == null) t.spot = i;
        if (t.spotT <= 0) {
          const carga = [0, 0, 0, 0, 0];
          for (const e of S.enemies) if (e.hp > 0) carga[e.lane] += e.maxHp;
          let alvo = t.spot;
          for (let L = 0; L < LANES; L++) if (carga[L] > carga[alvo]) alvo = L;
          if (alvo !== t.spot) { t.spot = alvo; addFloat(alvo, 0.86, "🔦 iluminado", "#ffe9a8"); }
          t.spotT = SPOT_MOVE_SEC;
        }
      }
      else if (tt.support === "grind") {
        // Mói a tropa mais fraca: quem já ia cair de qualquer jeito rende o buff.
        const vivos = S.allies.filter(a => a.hp > 0);
        if (vivos.length) {
          const vitima = vivos.reduce((a, b) => (b.hp < a.hp ? b : a));
          vitima.hp = 0;
          S.allyGrind = { t: GRIND_DUR + (fx.buffT || 0), mult: GRIND_MULT + (fx.buffAtk || 0) };
          addFloat(vitima.lane, vitima.y, "⚙️ MOÍDO", "#e0705f");
          addFloat(2, 0.8, `⚙️ Tropas +${Math.round(S.allyGrind.mult * 100)}%`, "#eecd5c");
          S.effects.push({ x: vitima.lane, y: vitima.y, life: 0.4, max: 0.4, type: "grind" });
        }
      }
      else if (tt.support === "charm") {
        // Máquina de Propaganda: às vezes vira tropas inimigas contra os seus.
        const cands = S.enemies.filter(e => e.hp > 0 && !(e.charm > 0));
        const chance = Math.min(0.95, 0.6 + (fx.charmC || 0));
        let n = 1 + (fx.charmN || 0);
        for (let ci = 0; ci < cands.length && n > 0 && Math.random() < chance; ci++, n--) {
          const e = cands.splice(Math.floor(Math.random() * cands.length), 1)[0];
          e.charm = 4 + (fx.charmDur || 0);
          addFloat(e.lane, e.y - 0.04, "📢 convertido!", "#8ac6f0");
        }
      }
      S.effects.push({ x: i, y: 0.9, life: 0.3, max: 0.3, type: "canalizador" });
      renderTowers();
      continue;
    }
    const range = fx.rangeAll ? 999 : tt.range + (fx.range || 0);
    let targets = S.enemies.filter(e => range >= 1 || e.y > 1 - range);
    if (!targets.length) continue;
    targets = sortByAim(targets, towerAim(t, fx));
    const target = targets[0];
    consumeTowerAmmo(t, cost, fx);
    t.cd = towerRate(t);
    S.projectiles.push({
      type: t.type, fromLane: i, target,
      ex: target.lane, ey: target.y,
      t: 0, dur: tt.ptime * (fx.fast ? 0.4 : 1) * (litLanes.has(target.lane) ? SPOT_SPEED : 1),
      dmg: towerDmg(t) * (litLanes.has(target.lane) ? 1 + SPOT_DMG : 1), aoe: (tt.aoe || (fx.aoeOn ? 0.5 : 0)) * (1 + (fx.aoeM || 0)),
      magic: tt.magic, chain: (tt.chain ? tt.chain + (fx.chain || 0) : (fx.chain ? 1 + fx.chain : 0)) + (tt.magic && law("L42") ? 1 : 0),
      slow: tt.slow, pierce: tt.pierce || 0, boomerang: tt.boomerang, fx,
    });
    // alvos extras (tiros gêmeos, ricochetes, marés...)
    for (let x = 0; x < (fx.extra || 0) && targets.length > x + 1; x++) {
      const t2 = targets[x + 1];
      S.projectiles.push({
        type: t.type, fromLane: i, target: t2, ex: t2.lane, ey: t2.y,
        t: 0, dur: tt.ptime * (fx.fast ? 0.4 : 1) * (litLanes.has(t2.lane) ? SPOT_SPEED : 1),
        dmg: towerDmg(t) * 0.8 * (litLanes.has(t2.lane) ? 1 + SPOT_DMG : 1), aoe: 0, magic: tt.magic, chain: 0, fx,
      });
    }
    renderTowers();
  }

  for (const p of S.projectiles) {
    p.t += dt / p.dur;
    if (S.enemies.includes(p.target)) { p.ex = p.target.lane; p.ey = p.target.y; }
    if (p.t >= 1 && !p.done) { p.done = true; projectileHit(p); }
  }
  S.projectiles = S.projectiles.filter(p => !p.done);
  tickEnemyShots(dt);

  // fogo no chão
  for (const gf of S.groundFires) {
    gf.t -= dt;
    for (const e of S.enemies) {
      if (e.lane === gf.lane && Math.abs(e.y - gf.y) < gf.r) e.hp -= gf.dps * dt;
    }
  }
  S.groundFires = S.groundFires.filter(gf => gf.t > 0);

  // quartéis de arqueiros atiram sozinhos
  for (const gid of new Set(S.city.filter(c => c.built === "quartel").map(c => c.gid))) {
    const fx = groupFx(gid);
    if (!fx.aD) continue;
    qCd[gid] = (qCd[gid] || 0) - dt;
    if (qCd[gid] > 0 || !S.enemies.length) continue;
    qCd[gid] = fx.aR || 2.5;
    const sorted = [...S.enemies].sort((a, b) => b.y - a.y);
    const n = 1 + (fx.aT || 0);
    for (let k = 0; k < n && k < sorted.length; k++) {
      const e = sorted[k];
      e.hp -= fx.aD;
      if (fx.aSlow) e.chill = { pct: fx.aSlow, t: 2 };
      addFloat(e.lane, e.y - 0.04, `-${fx.aD}`, "#c8b088");
      S.effects.push({ x: e.lane, y: e.y, life: 0.2, max: 0.2, type: "besta" });
    }
  }

  for (const e of S.enemies) {
    // status: veneno, gelo, atordoamento
    if (e.pz) {
      e.pz.t -= dt;
      e.hp -= e.pz.dps * dt;
      if (e.pz.shred) e.armor = Math.min(1, e.armor + 0.25 * dt);
      if (e.pz.t <= 0) e.pz = null;
    }
    if (e.chill) { e.chill.t -= dt; if (e.chill.t <= 0) e.chill = null; }
    if (e.stun > 0) e.stun -= dt;
    const spd = e.speed
      * (e.chill ? 1 - e.chill.pct : 1)
      * (e.pz && e.pz.slow ? 1 - e.pz.slow : 1)
      * (e.stun > 0 ? 0 : 1);
    // Enfeitiçado pela Propaganda: recua e ataca os próprios aliados por perto,
    // sem avançar nem bater na muralha (as torres ainda o alvejam normalmente).
    if (e.charm > 0) {
      e.charm -= dt;
      for (const o of S.enemies) {
        if (o !== e && o.lane === e.lane && o.hp > 0 && Math.abs(o.y - e.y) < 0.08) o.hp -= 14 * dt;
      }
      e.y = Math.max(0.02, e.y - spd * 0.3 * dt);
      if (e.burn > 0) { e.burn -= dt; e.hp -= burnDmg() * dt; }
      continue;
    }
    e.y += spd * dt;
    // bloqueio: inimigo não ultrapassa uma tropa aliada viva na mesma lane
    const BLOCK_GAP = 0.045;
    for (const a of S.allies) {
      if (a.lane === e.lane && a.hp > 0 && e.y > a.y - BLOCK_GAP) e.y = a.y - BLOCK_GAP;
    }
    if (e.burn > 0) { e.burn -= dt; e.hp -= burnDmg() * dt; }
    tickEnemyRanged(e, dt);
    if (e.y >= 1) {
      // guarnição: soldados bloqueiam antes de perder hit
      if (blockPool > 0) {
        blockPool--;
        addFloat(e.lane, 0.92, "🛡 BLOQUEADO", "#c8b088");
        if (cityFxScan(c => c.built === "quartel", "bGold")) earnGold(Math.round(ENEMY_TYPES[e.type].gold * killGoldMult()));
        e.hp = -999;
        continue;
      }
      // Perdão da muralha: a pedra aguenta. Vem ANTES do selo de propósito — se viesse
      // depois, o selo seria consumido numa batida que a muralha ia aparar de graça.
      if (!S.debug.god && Math.random() < WALL_FORGIVE) {
        addFloat(e.lane, 0.92, "🧱 AS MURALHAS AGUENTARAM", "#c8b088");
        S.effects.push({ x: e.lane, y: 0.95, life: 0.35, max: 0.35, type: "forgive" });
        e.hp = -999;
        continue;
      }
      // selo de proteção: limpa a lane inteira e desaparece
      if (S.seals[e.lane]) {
        S.seals[e.lane] = 0;
        S.sweeps.push({ lane: e.lane, y: 1 });
        addFloat(e.lane, 0.9, "◈ SELO ROMPIDO", ARCANE.lightHex);
        for (const o of S.enemies) {
          if (o.lane === e.lane) o.hp = -999; // sem recompensa, como cortador de grama
        }
        continue;
      }
      if (!S.debug.god) {
        const dmg = e.aura ? 2 : 1; // aura não dispelada: dano dobrado na muralha
        S.hits -= dmg;
        S.turnHitsLost += dmg;
        addFloat(e.lane, 0.92, `💥 -${dmg} HIT`, "#ff8a6a");
      }
      e.hp = -999;
    }
  }
  const dead = S.enemies.filter(e => e.hp <= 0 && e.hp > -900);
  S.kills += dead.length;
  // mensagem da "metade da horda": ao abater ≥ 50% do total do turno
  if (waveTotal >= 4 && !waveHalfShown) {
    const alive = spawnQueue.length + S.warnings.length + (S.enemies.length - dead.length);
    if (waveTotal - alive >= waveTotal / 2) { waveHalfShown = true; combatHalfMsg(); }
  }
  // Muralhas no limite: fala uma vez por turno. Sem a flag o aviso dispararia em todo
  // frame enquanto o HP estiver baixo e viraria um letreiro preso na tela.
  if (!waveCritShown && S.hits > 0 && S.hits <= 2) { waveCritShown = true; combatCritMsg(); }
  for (const e of dead) {
    // Roxo (Magia negra): chance do morto ressurgir como Sombra aliada temporária
    const spChance = facSpectralChance();
    if (spChance && Math.random() < spChance && S.allies.length < ALLY_LIMIT) {
      const hp = Math.round(20 * allyHpMult());
      // Sombras nascem do pacto roxo: já juram a ideologia Roxa
      S.allies.push({ type: "sombra", fac: "purple", lane: e.lane, y: e.y, hp, maxHp: hp, state: "idle", ttl: facSpectralTtl() });
      addFloat(e.lane, e.y - 0.05, "👻 Sombra!", "#c89aff");
    }
    addBloodPool(e.lane, e.y);
    const t = ENEMY_TYPES[e.type];
    // O saque do corpo é sorteado; a recompensa de torre (bountyG) sempre paga —
    // o jogador comprou aquele upgrade, não faria sentido o dado engoli-lo.
    const loot = Math.random() < goldDropChance() ? Math.round(t.gold * killGoldMult()) : 0;
    const g = loot + (e.bountyG || 0);
    if (g > 0) {
      earnGold(g);
      if (turnSum) turnSum.loot += g;
      addFloat(e.lane, e.y, `+${g} 🪙`, "#eecd5c");
    }
    if (Math.random() < (t.heart + mioloHeartBonus() + (e.bountyH || 0)) * heartChanceMult()) {
      S.hearts++;
      if (turnSum) turnSum.hGain++;
      addFloat(e.lane, e.y - 0.06, "+1 💎", "#8ac6f0");
    }
    // peste: veneno espalha para os próximos
    if (e.pz && e.pz.spread) {
      for (const o of S.enemies) {
        if (o !== e && o.hp > 0 && Math.abs(o.lane - e.lane) <= 1 && Math.abs(o.y - e.y) < 0.15) {
          o.pz = { ...e.pz, t: 3 };
        }
      }
    }
  }
  S.enemies = S.enemies.filter(e => e.hp > 0 && e.y < 1);

  renderHUD();

  if (S.hits <= 0) return gameOver();
  if (spawnQueue.length === 0 && S.enemies.length === 0 && S.warnings.length === 0) endWave();
}

// Praças: 🪙/dia por construção vizinha (base 1 da Pública + variantes de ambas)
function pracaPublicaGold() {
  let g = 0;
  S.city.forEach((c, i) => {
    if ((c.built !== "praca_publica" && c.built !== "praca_trabalho") || cellOff(c)) return;
    const fx = vFx("praca", c.path || []);
    const perN = (c.built === "praca_publica" ? 1 : 0) + (fx.gN || 0);
    if (!perN && !fx.gFab) return;
    const ns = neighbors(i).filter(n => S.city[n].built && S.city[n].gid !== c.gid);
    const touching = new Set(ns.map(n => S.city[n].gid)).size;
    const fabs = new Set(ns.filter(n => isFactory(S.city[n])).map(n => S.city[n].gid)).size;
    g += Math.round((touching * perN + fabs * (fx.gFab || 0)) * c.lvl * globalAdjM());
  });
  return g;
}

// O Feudo: extratores ESGOTAM por turno (somem ao fim da vida). A PRODUÇÃO de recursos
// agora é POR SEGUNDO, em tempo real (ver tickExtractProd) — este passo só cuida do desgaste.
function tickExtractors() {
  S.feudOut = {}; // novo turno: a manutenção termina e todo poço volta a produzir
  const groups = {}; // gid -> { key, idxs } — só extratores produtores (estruturas são puladas)
  S.feud.forEach((c, i) => {
    if (!c.built || !isProducerExtractor(c.built) || cellOff(c)) return; // desligado: não produz nem desgasta
    (groups[c.gid] ||= { key: c.built, idxs: [] }).idxs.push(i);
  });
  for (const gid in groups) {
    const { key, idxs } = groups[gid];
    for (const i of idxs) S.feud[i].life--;
    if (S.feud[idxs[0]].life <= 0) {
      // esgotou: Feitoria Real adjacente reconstrói (ouro cheio); senão, some
      if (hasAdjacentStruct(idxs, "feitor") && S.gold >= paintCost(key, idxs.length)) {
        S.gold -= paintCost(key, idxs.length);
        const life = extractorLife(key, idxs);
        for (const i of idxs) S.feud[i].life = life;
      } else {
        for (const i of idxs) { const c = S.feud[i]; c.built = null; c.lvl = 0; c.gid = 0; c.path = []; c.life = 0; }
      }
    }
  }
  tickStructs();
}

// Estruturas com prazo (Feitoria Real): expiram após `life` turnos. Roda DEPOIS
// dos extratores, para que a Feitoria ainda reconstrua no turno em que expira.
function tickStructs() {
  const groups = {};
  S.feud.forEach((c, i) => {
    const b = c.built && EXTRACTORS[c.built];
    if (!b || !b.struct || !b.life || cellOff(c)) return; // desligada: não desgasta
    (groups[c.gid] ||= { key: c.built, idxs: [] }).idxs.push(i);
  });
  for (const gid in groups) {
    const { key, idxs } = groups[gid];
    for (const i of idxs) S.feud[i].life--;
    if (S.feud[idxs[0]].life <= 0) {
      for (const i of idxs) { const c = S.feud[i]; c.built = null; c.lvl = 0; c.gid = 0; c.path = []; c.life = 0; }
      addFloat(2, 0.5, `${EXTRACTORS[key].icon} ${EXTRACTORS[key].name} expirou`, "#e07b2f");
    }
  }
}

// ---------- Balanço do turno ----------
// Livro-caixa aberto em startWave e fechado em endWave. O que o turno DEU é anotado na
// hora em que acontece, não medido por diferença de saldo: ouro e 💎 também são gastos
// durante o combate (cajado, habilidades), e uma subtração de saldo misturaria o que o
// turno rendeu com o que o jogador escolheu queimar. Só a moral vem por diferença, que
// ali é exatamente a leitura certa: importa onde o distrito amanhece, não cada parcela.
let turnSum = null;
function openTurnSum() {
  turnSum = { m0: S.morale, kills0: S.kills, loot: 0, hGain: 0, hCost: 0, rep: 0, allyLost: 0 };
}
function turnChips(income) {
  const t = turnSum, out = [];
  const chip = (txt, bom) => out.push(`<span class="ev-chip ${bom ? "up" : "down"}">${txt}</span>`);
  const lost = S.turnHitsLost;
  // A muralha vem primeiro: é o número que decide a run. Estado e desgaste na mesma
  // ficha, porque "intactas" sozinho esconderia que o setor já está em 3 de 5.
  chip(`🧱 ${S.hits}/${maxHits()} · ${lost ? `${lost} ${lost === 1 ? "hit perdido" : "hits perdidos"}` : "nenhum hit perdido"}`, !lost);
  if (t && t.rep) chip(`+${t.rep} 🧱 remendado`, true);
  const mortos = t ? S.kills - t.kills0 : 0;
  if (mortos) chip(`🗡 ${mortos} ${mortos === 1 ? "criatura abatida" : "criaturas abatidas"}`, true);
  if (t && t.allyLost) chip(`☠ ${t.allyLost} ${t.allyLost === 1 ? "tropa tombou" : "tropas tombaram"}`, false);
  if (typeof income === "number") chip(`+${income} 🪙 do conselho`, true);
  if (t && t.loot) chip(`+${t.loot} 🪙 de saque`, true);
  if (t && t.hGain) chip(`+${t.hGain} 💎`, true);
  if (t && t.hCost) chip(`-${t.hCost} 💎 de manutenção`, false);
  const dmoral = t ? Math.round(S.morale - t.m0) : 0;   // `dm` é função global (dayMods): não sombrear
  if (dmoral) chip(`${dmoral > 0 ? "+" : ""}${dmoral} de moral`, dmoral > 0);
  return out.join("");
}
// Card do fim do turno de dia (ao anoitecer). Mesmo desenho do evento diário: prosa,
// régua, e o balanço em fichas.
function showTurnEnd(income) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const aviso = bloodMoon() ? ["blood", "🩸 LUA SANGRENTA se aproxima: a horda virá mais forte e mais numerosa."]
    : blackSun() ? ["", "🌑 SOL NEGRO: a eficiência da cidade caiu pela metade neste turno."]
    : null;
  const neg = negativeRes();
  showOverlay("A noite se aproxima 🌙",
    `<span class="ev-story">${esc(pickMsg("dusk"))}</span>`
    + (aviso ? `<span class="ev-warn ${aviso[0]}">${esc(aviso[1])}</span>` : "")
    + `<span class="ev-rule"></span>`
    + `<span class="ev-sum-t">O BALANÇO DO TURNO</span>`
    + `<span class="ev-chips">${turnChips(income)}</span>`
    + `<span class="ev-tier">O distrito está em ${esc(moraleName(moraleTier(S.morale)))}.</span>`
    + (neg.length ? `<span class="ev-tier bad">Fechou no vermelho em ${neg.join(" ")}.</span>` : ""),
    null, "html");
}

function endWave() {
  S.waveActive = false;
  // Fala de onda limpa. Antes do overlay de fim de turno, senão ela apareceria atrás da
  // caixa de texto e o jogador nunca a leria.
  if (S.hits > 0) combatClearedMsg();
  tickExtractors(); // O Feudo produz e desgasta a cada turno
  favPunishTick();  // punições ativas dos Favores (Rei/Conde)
  $("conveyor").classList.remove("running");
  $("conveyor-v").classList.remove("running");
  S.projectiles = []; S.eshots = []; S.effects = []; S.floats = []; S.groundFires = [];
  let income = Math.round((60 + S.day * 2 + pracaPublicaGold() + incomeBonus()) * globalIncM() * moraleEffMult() * dm("income") * facIncomeMult() * mioloIncomeMult() * lawIncomeMult());
  income += 8 * groupLvlSum("tesouraria"); // Tesouraria
  income += 5 * groupLvlSum("praca_chique") + 4 * groupLvlSum("praca_abandonada"); // Praça Chique / Abandonada
  income -= cityFxScan(c => c.built === "quartel", "gUp"); // soldo da Guarda Real
  earnGold(Math.max(0, income));
  const hTurn = heartsPerTurn();
  S.hearts += hTurn;
  if (turnSum) turnSum.hGain += hTurn;
  // Procissão/Dia Sagrado: 💎 por turno perfeito
  if (S.turnHitsLost === 0) {
    const hNo = cityFxScan(null, "hNoHit");
    S.hearts += hNo;
    if (turnSum) turnSum.hGain += hNo;
  }
  // Motor de Argamato consome 💎; Autômato Reparador conserta as muralhas.
  // Sem trava: a manutenção cobra mesmo sem saldo e o setor fecha o turno devendo.
  const hUp = cityFxScan(null, "hUp");
  S.hearts -= hUp;
  if (turnSum) turnSum.hCost += hUp;
  let rep = cityFxScan(null, "repair") + (law("L23") ? 1 : 0); // Autômato Reparador + Requisição de Pedra (Oficina repara em tempo real)
  if (rep) {
    rep += (law("L27") ? 1 : 0) + (law("L46") ? 1 : 0); // Muros Modulares / Cidadela de Ferro rendem mais
    const antes = S.hits;
    S.hits = Math.min(maxHits(), S.hits + rep);
    if (turnSum) turnSum.rep = S.hits - antes;   // o que a muralha de fato absorveu, não o que foi oferecido
  }
  if (groupLvlSum("templo")) gainMorale(3 * groupLvlSum("templo")); // Templo da Fé
  if (groupLvlSum("praca_festival")) gainMorale(2 * groupLvlSum("praca_festival")); // Praça do Festival
  const aband = groupLvlSum("praca_abandonada"); // Praça Abandonada: saque rende ouro mas assusta
  if (aband) gainMorale(-aband);
  if (S.capataz && !law("L47")) { gainMorale(-CAPATAZ_MORALE); addFloat(2, 0.55, `👊 Capataz: -${CAPATAZ_MORALE} moral`, "#e0705f"); } // Motor Perpétuo isenta
  if (S.feudAid) { // Pedir Ajuda: o Reino manda materiais brutos, mas admitir fraqueza assusta o povo
    for (const k of Object.keys(RESOURCES)) addResource(k, FEUD_AID_RES);
    gainMorale(-FEUD_TOGGLE_MORALE);
    addFloat(2, 0.62, `🆘 Pedir Ajuda: -${FEUD_TOGGLE_MORALE} moral`, "#e0705f");
  }
  if (S.feudOverdrive) { // Sobrecarga: extratores no limite, trabalhadores exaustos
    gainMorale(-FEUD_TOGGLE_MORALE);
    addFloat(2, 0.69, `⚙️ Sobrecarga: -${FEUD_TOGGLE_MORALE} moral`, "#e0705f");
  }
  // Fechou o turno devendo: a tropa descobre que não há com que pagar nem com que
  // trabalhar. Cobrado DEPOIS da renda do turno, senão puniria quem já se acertou.
  const devendo = negativeRes();
  if (devendo.length) {
    const perda = Math.min(NEG_MORALE_CAP, NEG_MORALE_EACH * devendo.length);
    gainMorale(-perda);
    addFloat(2, 0.45, `📉 No vermelho (${devendo.join(" ")}): -${perda} moral`, "#e0705f");
    toast(`📉 O setor fechou o turno no vermelho em ${devendo.join(" ")} · -${perda} de moral.`);
  }
  // Praça Estranha: bônus caótico por nível (ouro / moral / 💎)
  for (let k = 0; k < groupLvlSum("praca_estranha"); k++) {
    const r = Math.random();
    if (r < 0.34) { earnGold(10); addFloat(2, 0.5, "🌀 +10 🪙", "#eecd5c"); }
    else if (r < 0.67) { gainMorale(3); addFloat(2, 0.5, "🌀 +3 moral", "#8ac6f0"); }
    else { S.hearts += 1; if (turnSum) turnSum.hGain++; addFloat(2, 0.5, "🌀 +1 💎", "#c89aff"); }
  }
  // Capelas + Praça Jardim + leis (Casas de Banho / Medicina Moderna) curam as tropas
  const heal = 3 * groupLvlSum("capela") + 2 * groupLvlSum("praca_jardim") + (law("L3") ? 2 : 0) + (law("L38") ? 3 : 0);
  if (heal) for (const a of S.allies) healAlly(a, heal);
  // Os Verdes: as tropas se regeneram sozinhas a cada turno
  const regen = facAllyRegen();
  if (regen > 0 && S.allies.length) {
    let healed = false;
    for (const a of S.allies) {
      if (a.hp >= a.maxHp) continue;
      a.hp = Math.min(a.maxHp, a.hp + a.maxHp * regen);
      healed = true;
    }
    if (healed) addFloat(2, 0.85, "🟢 tropas regeneradas", "#7ac36a");
  }
  // Leis do setor: peso permanente na moral, a cada turno
  const lawM = lawsMoralPerTurn();
  if (lawM > 0) gainMorale(lawM);
  else if (lawM < 0) gainMorale(lawM);
  if (law("L1")) addResource("comida", 1); // Ração Justa
  // Moral: resultado do turno. Turno perfeito sobe a Esperança; hits perdidos sobem o Medo
  if (S.turnHitsLost === 0) gainMorale(5 + (law("L2") ? 2 : 0)); // turno perfeito (+Festivais)
  else {
    let loss = -9 * S.turnHitsLost;
    if (law("L26")) loss *= 0.75;              // Abrigos Subterrâneos
    if (S.isNight && law("L37")) loss *= 0.75; // Lampiões de Argamato
    gainMorale(loss);
  }
  S.freeConjure = law("L43") && S.turnHitsLost === 0; // Olho do Turbilhão
  const wasNight = S.isNight;
  if (wasNight && bloodMoon()) S.redMoons++; // sobreviveu a uma lua vermelha
  if (wasNight && S.day % 10 === 5) S.blackSuns++; // sobreviveu ao dia de Sol Negro
  if (S.isNight) { S.isNight = false; S.day++; } else { S.isNight = true; }
  favNewTurn();      // cada turno tem seu próprio expediente nas Alianças
  newTurnWeather();  // e seu próprio céu
  buildNextWave();

  // Teto do modo infinito: o MVP acaba no dia 100.
  if (S.day >= MVP_END_DAY) { endMvpRun(); return; }

  // Vitória: só após sobreviver à NOITE DE LUA VERMELHA do dia 30
  if (S.day >= 31 && !S.won) {
    S.won = true;
    addMedals(10); // bônus de vitória
    saveGame();
    showVictory();
    renderAll();
    return;
  }

  const scheduleAuto = () => setTimeout(() => { if (S.autoTurn && !S.waveActive && S.hits > 0) startWave(); }, 1800);

  if (wasNight) {
    // AMANHECEU: novo dia. Limpa mods do dia anterior, sorteia o evento, aplica e trava a moral.
    addMedals(1); // 🎖️ Medalha de Comando: 1 por DIA sobrevivido (não por turno)
    if (law("L8")) S.hearts += 1;                                    // Dízimo de Sangue
    if (law("L45")) S.hits = Math.min(maxHits(), S.hits + 1);        // Muralha Viva
    S.dayMods = {};
    favNewDay(); // libera a visita do dia e avisa punições ativas
    // Evento fixo: no amanhecer do dia ELDERS_DAY+1, anuncia a queda do saque (uma vez).
    const ev = (S.day === ELDERS_DAY + 1 ? ELDERS_EVENT : null) || maybeDarkEvent() || pickDailyEvent();
    applyDailyEvent(ev);
    S.moraleLocked = moraleTier(S.morale); // snapshot: efeitos deste dia
    // Aviso do último dia jogável: entra no lugar do card do evento diário.
    const mvpNotice = S.day >= MVP_LAST_DAY && !S.mvpNotice;
    if (mvpNotice) S.mvpNotice = true;
    saveGame();
    autosaveEvery5Days(); // autosave automático a cada 5 dias (rotação de 3)
    if (mvpNotice) { S.autoTurn = false; showOverlay("🏁 Fim do MVP", MVP_END_MSG); }
    else if (S.autoTurn) { addFloat(2, 0.15, `${ev.ic} ${ev.t}`, "#eecd5c"); scheduleAuto(); }
    else showDailyEvent(ev, income);
  } else {
    // ANOITECEU: a noite se aproxima.
    saveGame();
    if (S.autoTurn) { addFloat(2, 0.15, `+${income} 🪙 · 🌙`, "#eecd5c"); scheduleAuto(); }
    else showTurnEnd(income);
  }
  renderAll();
}

// Card do Evento Diário (ao amanhecer)
function showDailyEvent(ev, income, cb) {
  // Descrição e balanço do dia separados por uma régua: antes os números vinham no mesmo
  // bloco de prosa e o jogador tinha que caçar o que mudou no meio do texto.
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Tudo em <span> com display:block, não <hr>/<div>: o container é um <p>, que só aceita
  // conteúdo de frase. O Chrome tolera o inválido aqui, mas se esse HTML for lido e
  // reescrito em outro lugar o parser parte o parágrafo no primeiro bloco.
  // `!= null` e não truthy: o nível NEUTRO é o número 0, e um teste de verdade engolia
  // justamente a faixa onde a maioria das runs vive.
  const tier = S.moraleLocked != null ? `<span class="ev-tier">O distrito está em ${esc(moraleName(S.moraleLocked))}.</span>` : "";
  // Duas contas, duas réguas: o turno da NOITE que acabou de fechar e o DIA que começa.
  // A renda do conselho mora na primeira, porque é o pagamento do turno vencido, não um
  // efeito do evento de hoje. No dia 1 não há turno anterior e a primeira seção não sai.
  const doTurno = typeof income === "number"
    ? `<span class="ev-rule"></span>`
      + `<span class="ev-sum-t">O BALANÇO DO TURNO</span>`
      + `<span class="ev-chips">${turnChips(income)}</span>`
    : "";
  showOverlay(`${ev.ic} Dia ${S.day}: ${ev.t}`,
    `<span class="ev-story">${esc(ev.s)}</span>`
    + doTurno
    + `<span class="ev-rule"></span>`
    + `<span class="ev-sum-t">O DIA QUE COMEÇA</span>`
    + `<span class="ev-chips">${effectChips(ev)}</span>`
    + tier,
    cb || null, "html");
}

// ---------- Teto do modo infinito (MVP) ----------
const MVP_LAST_DAY = 99;   // último dia jogável: aqui aparece o aviso
const MVP_END_DAY = 100;   // ao amanhecer deste dia a run termina
const MVP_END_MSG = "Parabéns, você chegou ao fim do mvp do jogo. Espero que tenha se divertido.\n\nO dia 99 é o último da vigília: ao amanhecer do dia 100 o seu comando se encerra.";
function endMvpRun() {
  S.waveActive = false;
  S.autoTurn = false;
  $("conveyor").classList.remove("running");
  $("conveyor-v").classList.remove("running");
  S.enemies = []; S.projectiles = []; S.eshots = []; S.warnings = []; S.effects = []; S.floats = [];
  localStorage.removeItem(SAVE_KEY); // a vigília terminou: não há o que continuar
  recordScore();
  renderAll();
  showOverlay("🏁 Dia 100 · Fim da vigília", `${MVP_END_MSG}\n\nVocê segurou a Muralha Oeste por 99 dias.\n\n${scoreLines()}\nPontuação final: ${runScore()}`, () => {
    resetGame();
    setupMenu();
    $("menu").classList.remove("hidden");
  });
}

function gameOver() {
  S.waveActive = false;
  $("conveyor").classList.remove("running");
  $("conveyor-v").classList.remove("running");
  S.enemies = []; S.projectiles = []; S.eshots = []; S.warnings = []; S.effects = []; S.floats = [];
  localStorage.removeItem(SAVE_KEY); // derrota é permanente: sem Continuar
  recordScore();
  showDefeat();
}
function showDefeat() {
  $("def-text").textContent =
    `As brechas se abriram e os mortos alcançaram o cristal no dia ${Math.max(1, S.day)}. ` +
    `Os registros da guarda arderam com as muralhas, e o silêncio tomou o Distrito.\n\n` +
    `Seu nome se apaga dos arquivos, mas a resistência que você ergueu não foi em vão. O conselho nomeará um novo comandante.`;
  $("def-score").textContent = `Pontuação ${runScore()}`;
  $("def-breakdown").innerHTML = scoreLines();
  $("defeat").classList.remove("hidden");
}
$("def-menu").onclick = () => {
  $("defeat").classList.add("hidden");
  resetGame();
  setupMenu();
  $("menu").classList.remove("hidden");
};

// ---------- Save / Load ----------
const SAVE_KEY = "mds-save6"; // slot de RETOMADA (Continuar): sempre sobrescrito pela run atual

// Empacota o estado da run atual (mesmos campos de sempre).
function runPayload() {
  const { day, isNight, hits, gold, hearts, won, kills, goldEarned, redMoons, blackSuns, mvpNotice, morale, moraleLocked, dayMods, lastEvent, eventLog, fav, sector, sectorId, sectorDir, factions, purpleThisRun, darkChain, towers, city, feud, field, res, maos, nextGid, laws, conjCount, freeConjure, allies, gateAuto, gateMode, gatePref, gateFac, seals, helpKingdom, capataz, helpPool, feudAid, feudOverdrive, autoTurn, feudOut, weather: wx } = S;
  // `speed` viaja solto: o resto de S.debug (god) nunca é persistido.
  return { day, isNight, hits, gold, hearts, won, kills, goldEarned, redMoons, blackSuns, mvpNotice, morale, moraleLocked, dayMods, lastEvent, eventLog, fav, sector, sectorId, sectorDir, factions, purpleThisRun, darkChain, towers, city, feud, field, res, maos, nextGid, laws, conjCount, freeConjure, allies, gateAuto, gateMode, gatePref, gateFac, seals, helpKingdom, capataz, helpPool, feudAid, feudOverdrive, autoTurn, feudOut, weather: wx, speed: S.debug.speed };
}
// Aplica um payload de run ao estado (com todas as migrações de saves antigos).
function applyRun(d) {
  Object.assign(S, d);
  if (!Array.isArray(S.feud) || S.feud.length !== 25)
    S.feud = Array.from({ length: 25 }, () => ({ zone: "F", built: null, lvl: 0, gid: 0, path: [] }));
  if (S.field !== "feud") S.field = "city";
  if (!S.res || typeof S.res !== "object") S.res = { minerio: 0, combustivel: 0, bens: 0, comida: 0 };
  if (typeof S.res.comida !== "number") S.res.comida = 0;
  if (typeof S.maos !== "number") S.maos = 15;
  if (!S.fav || !S.fav.rel) S.fav = favDefault(); // saves antigos (Favores do Conselho)
  if (!S.fav.open || !Object.keys(S.fav.open).length) favNewTurn(); // saves sem expediente sorteado
  if (typeof S.blackSuns !== "number") S.blackSuns = 0; // saves antigos
  if (typeof S.goldEarned !== "number") S.goldEarned = 0; // saves antigos
  if (typeof S.sectorId !== "number" || !S.sectorId) S.sectorId = randomSectorId(); // saves antigos
  if (!S.sectorDir) S.sectorDir = randomSectorDir(); // saves antigos
  if (!S.feedEff || typeof S.feedEff !== "object") S.feedEff = {};
  // Olha o PAYLOAD, não o S: sem o campo no save, o Object.assign acima deixaria a cota
  // da run anterior de pé e o extrator carregaria já "em manutenção".
  if (!d.feudOut || typeof d.feudOut !== "object") S.feudOut = {}; // saves antigos (Em Manutenção)
  // Checa o PAYLOAD: sem o campo, sorteia um céu novo em vez de herdar o da run anterior.
  if (!WEATHER[d.weather]) S.weather = rollWeather(); // saves antigos (clima do turno)
  if (typeof S.helpPool !== "number") { S.helpPool = 0; S.helpKingdom = false; S.capataz = false; }
  if (!Array.isArray(S.laws)) { S.laws = []; S.conjCount = 0; S.freeConjure = false; } // saves antigos (árvores de leis)
  // migração de torres: descarta tipos removidos (bombarda/fornalha/bobina); ammo → ammoBy
  let towersReset = false;
  S.towers = (S.towers || [null, null, null, null, null]).map(t => {
    if (!t || !TOWER_TYPES[t.type]) return null;
    t.cd = 0;
    if (!t.ammoBy) t.ammoBy = typeof t.ammo === "number" ? { [towerAmmos(t.type)[0]]: t.ammo } : {};
    delete t.ammo;
    // Torres do novo sistema (3 caminhos): saves antigos sem `tiers` resetam os upgrades.
    if (TOWER_PATHS[t.type] && !Array.isArray(t.tiers)) {
      if ((t.lvl || 1) > 1) towersReset = true; // só avisa se realmente havia upgrades
      t.tiers = [0, 0, 0]; t.lvl = 1; t.path = [];
    }
    return t;
  });
  if (towersReset) setTimeout(() => toast("🔧 Sistema de torres renovado: upgrades reiniciados."), 400);
  if (typeof S.autoTurn !== "boolean") S.autoTurn = false;          // saves antigos
  S.debug = { god: false, speed: SPEEDS.includes(S.speed) ? S.speed : 1 }; // god nunca volta de um save
  delete S.speed;
  S.paused = false; S.waveActive = false;
  applyFactionTint();
  buildNextWave();
}
function saveGame() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(runPayload())); } catch { /* storage cheio */ } }
function loadGame() {
  try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); if (!d) return false; applyRun(d); return true; }
  catch { return false; }
}

// ---------- Saves nomeados & autosaves (múltiplos jogos) ----------
const SAVES_KEY = "mknf-saves";   // índice: [{ id, name, day, hits, ts, auto }]
const MAX_AUTOSAVES = 3;          // só os 3 autosaves mais recentes ficam guardados
function slotDataKey(id) { return "mknf-slot-" + id; }
function loadSlots() { try { return JSON.parse(localStorage.getItem(SAVES_KEY)) || []; } catch { return []; } }
function writeSlots(arr) { localStorage.setItem(SAVES_KEY, JSON.stringify(arr)); }
function newSlotId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
// Sequência monotônica: garante ordem correta mesmo com ts idêntico (saves no mesmo ms).
let _slotSeq = loadSlots().reduce((mx, s) => Math.max(mx, s.seq || 0), 0);
// Grava a run atual num novo slot. auto=true → conta na rotação de autosaves (poda p/ 3).
function writeSlot(name, auto) {
  const id = newSlotId();
  try { localStorage.setItem(slotDataKey(id), JSON.stringify(runPayload())); }
  catch { toast("⚠ Armazenamento cheio: apague alguns saves."); return null; }
  const slots = loadSlots();
  slots.push({ id, name, day: S.day, hits: S.hits, ts: Date.now(), seq: ++_slotSeq, auto: !!auto });
  writeSlots(slots);
  if (auto) pruneAutosaves();
  return id;
}
function slotOrder(a, b) { return (b.seq || 0) - (a.seq || 0) || b.ts - a.ts; } // mais recente primeiro
function pruneAutosaves() {
  const slots = loadSlots();
  const autos = slots.filter(s => s.auto).sort(slotOrder);
  const removeIds = new Set(autos.slice(MAX_AUTOSAVES).map(s => s.id));
  if (!removeIds.size) return;
  for (const id of removeIds) localStorage.removeItem(slotDataKey(id));
  writeSlots(slots.filter(s => !removeIds.has(s.id)));
}
function deleteSlot(id) {
  localStorage.removeItem(slotDataKey(id));
  writeSlots(loadSlots().filter(s => s.id !== id));
}
// Carrega um slot para a run atual (e o espelha no slot de retomada).
function loadSlot(id) {
  try {
    const d = JSON.parse(localStorage.getItem(slotDataKey(id)));
    if (!d) return false;
    applyRun(d); saveGame(); return true;
  } catch { return false; }
}
function autosaveEvery5Days() {
  if (S.day > 0 && S.day % 5 === 0) writeSlot(`Autosave · Dia ${S.day}`, true);
}

function resetGame() {
  Object.assign(S, {
    day: 1, isNight: false, hits: 5, gold: 90, hearts: 0, won: false, kills: 0, goldEarned: 0, redMoons: 0, blackSuns: 0, mvpNotice: false,
    morale: 0, moraleLocked: 0, dayMods: {}, lastEvent: null,
    eventLog: [], fav: favDefault(), sector: randomSector(), sectorId: randomSectorId(), sectorDir: randomSectorDir(),
    factions: [], purpleThisRun: false, darkChain: 0,
    enemies: [], projectiles: [], eshots: [], warnings: [], effects: [], floats: [], powerLines: [], groundFires: [], turnHitsLost: 0,
    allies: [], gateAuto: false, gateMode: "protect", gatePref: "campones", gateFac: "red",
    seals: [1, 1, 1, 1, 1], sweeps: [],
    helpKingdom: false, capataz: false, helpPool: 0, feudAid: false, feudOverdrive: false,
    placing: null, laws: [], conjCount: 0, freeConjure: false, paused: false,
    autoTurn: false, towerBuff: null, allyGrind: null,   // não vazam da run anterior
    towers: [null, null, null, null, null],
    res: (function () { const b = MIOLO.celeiros.per * mioloLvl("celeiros"); return { minerio: 30 + b, combustivel: 30 + b, bens: 30 + b, comida: 30 + b }; })(),
    maos: Math.min(MAOS_CAP_MAX, MAOS_CAP_BASE + MIOLO.guilda.per * mioloLvl("guilda")), feedEff: {}, feudOut: {},
    debug: { god: false, speed: 1 },
  });
  bloodPools = [];            // o chão da run nova começa limpo
  favNewTurn();               // expediente do primeiro turno (dia 1)
  S.weather = rollWeather();  // sem toast: a abertura já tem telas demais
  initCity();
  buildNextWave();
  renderAll();
}

// ---------- Overlay ----------
let overlayCb = null;
let overlaySkipCb = null;
// Fade genérico de telas cheias. Esconder é assíncrono: a classe `fading` leva a
// opacidade a 0 e só então o elemento sai do fluxo, senão o `display:none` cortaria a
// transição no primeiro frame.
const SCREEN_FADE_MS = 220;
function fadeInScreen(id) {
  const el = $(id);
  el.classList.remove("fading");
  el.classList.remove("hidden");
}
function fadeOutScreen(id, then) {
  const el = $(id);
  if (el.classList.contains("hidden")) { then && then(); return; }
  el.classList.add("fading");
  setTimeout(() => {
    el.classList.add("hidden");
    el.classList.remove("fading");
    then && then();
  }, SCREEN_FADE_MS);
}

// Realce da abertura: *entre asteriscos* vira <b class="lore-hi">. Escapo o HTML ANTES
// de injetar a tag — se um texto futuro trouxer "<", ele tem que aparecer como "<" e não
// virar marcação. Só a sequência de lore pede isso; o resto do jogo segue em textContent.
function loreHTML(txt) {
  return txt
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Consome os \n que cercam o realce: ele é um BLOCO e já quebra a linha sozinho.
    // Com o pre-line ainda somando as duas quebras do texto, cada destaque ganhava três
    // e o miolo da tela ficava esparramado. A separação passa a vir da margem do bloco.
    .replace(/\n*\*([^*]+)\*\n*/g, '<b class="lore-hi">$1</b>');
}
// mode: undefined = texto puro · "lore" = *asteriscos* viram destaque · "html" = HTML
// já montado por quem chamou (só para telas internas, nunca para texto de fora).
function showOverlay(title, text, cb, mode) {
  $("overlay-title").textContent = title;
  if (mode === "html") $("overlay-text").innerHTML = text;
  else if (mode === "lore") $("overlay-text").innerHTML = loreHTML(text);
  else $("overlay-text").textContent = text;
  overlayCb = cb || null;
  overlaySkipCb = null;                          // só sequências (re)armam o "Pular"
  $("overlay-skip").classList.add("hidden");
  $("overlay-box").scrollTop = 0;                // texto longo sempre começa do topo
  fadeInScreen("overlay");
}
// Sem botão "Continuar": sair é clicar fora, como no painel do Setor. O rodapé sobre o
// fundo escurecido diz isso, e o clique só conta se cair FORA da caixa.
function closeOverlay() {
  if ($("overlay").classList.contains("fading")) return; // ignora cliques durante o fade
  fadeOutScreen("overlay", () => {
    if (overlayCb) { const f = overlayCb; overlayCb = null; f(); }
  });
}
$("overlay").onclick = (e) => { if (e.target === $("overlay") || e.target === $("overlay-foot")) closeOverlay(); };
$("overlay-skip").onclick = () => {
  overlayCb = null;
  fadeOutScreen("overlay", () => {
    if (overlaySkipCb) { const f = overlaySkipCb; overlaySkipCb = null; f(); }
  });
};

// Sequência de telas [titulo, texto]: "Continuar" avança uma a uma, "Pular" salta direto para done().
function showOverlaySeq(screens, done) {
  let i = 0;
  const step = () => {
    if (i >= screens.length) { done && done(); return; }
    const [title, text] = screens[i++];
    showOverlay(title, text, step, "lore");   // a abertura tem trechos em destaque
    overlaySkipCb = () => { i = screens.length; done && done(); };
    $("overlay-skip").classList.remove("hidden");
  };
  step();
}

// ---------- Pontuação ----------
// Ganho de ouro que também soma no total da partida (para o resumo final). Gastos NÃO descontam.
function earnGold(n) { S.gold += n; if (n > 0) S.goldEarned = (S.goldEarned || 0) + n; }
function runScore() {
  return S.kills + Math.max(0, S.day - 1) * 25 + S.redMoons * 200;
}
function runStats() {
  return [
    { ic: "⚔️", v: S.kills,                     k: "Abates" },
    { ic: "☀️", v: Math.max(0, S.day - 1),      k: "Dias" },
    { ic: "🩸", v: S.redMoons,                  k: "Luas vermelhas" },
    { ic: "🌑", v: S.blackSuns,                 k: "Sóis negros" },
    { ic: "🪙", v: Math.round(S.goldEarned || 0), k: "Ouro" },
  ];
}
function scoreLines() {
  return runStats().map(s =>
    `<div class="vic-stat${s.hi ? " hi" : ""}"><span class="vs-ic">${s.ic}</span><span class="vs-v">${s.v}</span><span class="vs-k">${s.k}</span></div>`
  ).join("");
}
function recordScore() {
  const entry = { n: `Você · dia ${S.day}`, s: runScore(), me: true };
  sessionRanking.push(entry);
  META.ranking.push({ n: entry.n, s: entry.s });
  META.ranking.sort((a, b) => b.s - a.s);
  META.ranking = META.ranking.slice(0, 10); // top 10 persistente
  saveMeta(META);
}

// ---------- Tela de Vitória (dramática, com segurar-para-confirmar) ----------
const HOLD_MS = 1200;
let holdStart = 0, holdRAF = 0, holdDone = false;
function resetHold() {
  holdDone = false;
  cancelAnimationFrame(holdRAF);
  $("vic-hold-fill").style.width = "0%";
  $("vic-hold").classList.remove("hidden");
}
function holdTick(now) {
  const p = Math.min(1, (now - holdStart) / HOLD_MS);
  $("vic-hold-fill").style.width = (p * 100) + "%";
  if (p >= 1) {
    holdDone = true;
    $("vic-hold").classList.add("hidden");
    $("vic-choices").classList.remove("hidden");
    return;
  }
  holdRAF = requestAnimationFrame(holdTick);
}
function showVictory() {
  $("vic-score").textContent = `Pontuação ${runScore()}`;
  $("vic-breakdown").innerHTML = scoreLines();
  $("vic-choices").classList.add("hidden");
  resetHold();
  $("victory").classList.remove("hidden");
}
$("vic-hold").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (holdDone) return;
  holdStart = performance.now();
  cancelAnimationFrame(holdRAF);
  holdRAF = requestAnimationFrame(holdTick);
});
for (const ev of ["pointerup", "pointerleave", "pointercancel"]) {
  $("vic-hold").addEventListener(ev, () => {
    if (holdDone) return;
    cancelAnimationFrame(holdRAF);
    $("vic-hold-fill").style.width = "0%";
  });
}
$("vic-infinite").onclick = () => {
  $("victory").classList.add("hidden");
  renderAll(); // segue jogando; pontuação será registrada no game over
};
$("vic-menu").onclick = () => {
  recordScore();
  $("victory").classList.add("hidden");
  resetGame();
  setupMenu();
  $("menu").classList.remove("hidden");
};

// ---------- Render do campo ----------
// VARIAÇÕES DO TERRENO: os detalhes do chão (pedras, manchas, fendas, grama, raízes,
// flores, sangue seco) circulam entre FIELD_VARIANTS desenhos e trocam a cada partida
// nova. Antes eram sorteados no carregamento da página: variavam entre recarregamentos,
// mas duas partidas seguidas na mesma aba pisavam exatamente no mesmo chão.
// O sorteio é SEMEADO, não aleatório: a variação 2 é sempre a mesma variação 2. Sem isso
// não seriam três desenhos que circulam, seriam infinitos desenhos aleatórios.
const FIELD_VARIANTS = 3;
// mulberry32: gerador pequeno e determinístico. Math.random() não aceita semente.
function seededRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fieldVariant() { return ((META.fieldVar || 0) % FIELD_VARIANTS + FIELD_VARIANTS) % FIELD_VARIANTS; }
// Avança para o próximo desenho. Chamado só onde a partida REALMENTE começa, não no
// resetGame: ele também roda ao voltar da derrota para o menu, e aí uma variação seria
// queimada sem ninguém ver o campo.
function nextFieldVariant() {
  META.fieldVar = (fieldVariant() + 1) % FIELD_VARIANTS;
  saveMeta(META);
  buildFieldDetails();
}

let PEBBLES = [], PATCHES = [], CRACKS = [], GRIT = [], TUFTS = [], ROOTS = [], FLOWERS = [], OLD_BLOOD = [];
function buildFieldDetails() {
  // Semente derivada da variação. O offset por lista evita que duas listas do mesmo
  // tamanho saiam com as MESMAS coordenadas (as pedras caindo sobre o cascalho).
  const v = fieldVariant();
  const rng = (off) => seededRng(0x4b4d4e46 + v * 7919 + off * 104729);

  let r = rng(1);
  PEBBLES = Array.from({ length: 70 }, () => ({
    x: r(), y: r(),
    r: r() * 2.2 + 0.6,
    dark: r() < 0.5,
  }));
  r = rng(2);
  PATCHES = Array.from({ length: 12 }, () => ({
    x: r(), y: r(),
    rx: r() * 40 + 22, ry: r() * 14 + 8,
  }));
  // Fendas de terra seca: traço quebrado que caminha a partir de um ponto.
  r = rng(3);
  CRACKS = Array.from({ length: 10 }, () => {
    const pts = [{ x: r(), y: r() }];
    let a = r() * 6.283, x = pts[0].x, y = pts[0].y;
    for (let i = 0, segs = 3 + Math.floor(r() * 4); i < segs; i++) {
      a += (r() - 0.5) * 1.1;
      const len = 0.03 + r() * 0.06;
      x += Math.cos(a) * len; y += Math.sin(a) * len * 0.55;
      pts.push({ x, y });
    }
    return pts;
  });
  r = rng(4);
  GRIT = Array.from({ length: 240 }, () => ({
    x: r(), y: r(), r: r() * 0.9 + 0.3, light: r() < 0.42,
  }));
  // Vida teimando em nascer num chão de guerra.
  r = rng(5);
  TUFTS = Array.from({ length: 26 }, () => ({              // grama rala e raízes
    x: r(), y: r(),
    blades: 2 + Math.floor(r() * 3),
    h: 0.018 + r() * 0.026,
    lean: (r() - 0.5) * 0.9,
    dry: r() < 0.45,                                       // metade puxa para o palha
  }));
  r = rng(6);
  ROOTS = Array.from({ length: 7 }, () => ({               // raízes rastejando no chão
    x: r(), y: 0.1 + r() * 0.8,
    len: 0.06 + r() * 0.1,
    ang: (r() - 0.5) * 1.2,
  }));
  r = rng(7);
  FLOWERS = Array.from({ length: 22 }, () => ({            // microflores azuis e amarelas
    x: r(), y: r(),
    blue: r() < 0.5,
    r: 0.9 + r() * 0.8,
  }));
  // Sangue SECO: só perto da muralha (y alto), que é onde a horda chega e morre.
  r = rng(8);
  OLD_BLOOD = Array.from({ length: 14 }, () => ({
    x: r(), y: 0.72 + r() * 0.26,
    rx: 5 + r() * 13, ry: 3 + r() * 7,
    rot: r() * 3.14,
    spots: 1 + Math.floor(r() * 3),
  }));
}
buildFieldDetails();
// Partículas de ambiente: poeira à deriva de dia, brasas subindo à noite. Posição é
// calculada a partir do relógio (sem estado a atualizar), então isto não entra no update.
const MOTES = Array.from({ length: 24 }, () => ({
  x: Math.random(), y: Math.random(),
  r: Math.random() * 1.1 + 0.4,
  // ~4 a 11 px/s num campo de 250px: um floco atravessa em 23–60s. A 4 px/s de antes
  // eles tecnicamente andavam, mas na prática pareciam pregados no fundo.
  sp: 0.015 + Math.random() * 0.028,
  sway: Math.random() * 18 + 6,
  ph: Math.random() * 100,
}));

// Relógio VISUAL, em segundos. Anda junto com a velocidade do jogo, ao contrário do
// performance.now(): no 5x a poeira, a chuva, as nuvens e a passada da horda aceleram
// com o resto do mundo, em vez de ficarem num ritmo de relógio de parede.
let vClock = 0;
// Relógio do SANGUE, em segundos de mundo: não leva o multiplicador de velocidade e para
// quando o campo não está à vista (pausa/menu). Ver frame() e drawBloodPools().
let bClock = 0;

// Paleta do ar: a névoa do horizonte e as partículas seguem o ciclo e os eventos celestes.
function airTone() {
  if (bloodMoon()) return { haze: "168,54,44", mote: "255,150,120", up: true };
  if (blackSun()) return { haze: "40,34,46", mote: "160,150,190", up: true };
  if (S.isNight) return { haze: "92,108,150", mote: "255,206,140", up: true };
  return { haze: "226,186,116", mote: "255,238,200", up: false };
}

// (As listas de detalhe do chão vivem em buildFieldDetails, acima: são semeadas pela
// variação da partida em vez de sorteadas no carregamento.)

// ---------- Clima do turno (100% cosmético) ----------
// Sorteado a cada turno. NADA aqui toca alcance, mira, dano ou spawn: são só camadas de
// desenho. No Turno Turvo o jogador perde a horda de vista, mas as torres continuam
// enxergando tudo, porque a névoa é pintada depois da lógica, sobre o quadro pronto.
const WEATHER = {
  normal:     { w: 65, ic: "⛅",  name: "Céu Aberto",     desc: "Nuvens passando, névoa fraca.",                     clouds: 1,   haze: 1,    fog: 0,    rain: 0, bolts: false },
  turvo:      { w: 20, ic: "🌫️", name: "Turno Turvo",     desc: "Névoa densa: a horda só aparece de perto.",         clouds: 0,   haze: 1.1,  fog: 1,    rain: 0, bolts: false },
  tempestade: { w: 10, ic: "⛈️", name: "Tempestade",      desc: "Céu fechado, chuva e relâmpagos.",                  clouds: 1.9, haze: 0.8,  fog: 0.22, rain: 1, bolts: true },
  perfeito:   { w: 5,  ic: "✨",  name: "Turno Perfeito",  desc: "Ar limpo, visibilidade total.",                     clouds: 0,   haze: 0,    fog: 0,    rain: 0, bolts: false },
};
const WEATHER_KEYS = Object.keys(WEATHER);
// Os primeiros dias saem sempre de céu aberto. Não é uma regra anunciada: é só para o
// jogador aprender o campo com a horda à vista, sem uma tempestade ou uma névoa densa
// logo no dia 1 fazendo ele achar que o jogo está quebrado.
const WEATHER_GRACE_DAYS = 3;
function rollWeather() {
  if ((S.day || 1) <= WEATHER_GRACE_DAYS) return "normal";
  const total = WEATHER_KEYS.reduce((s, k) => s + WEATHER[k].w, 0);
  let r = Math.random() * total;
  for (const k of WEATHER_KEYS) { r -= WEATHER[k].w; if (r <= 0) return k; }
  return "normal";
}
function weather() { return WEATHER[S.weather] || WEATHER.normal; }
// Sem toast: o clima é linguagem visual, o jogador lê no céu. Anunciar em texto
// transformaria um detalhe de ambientação em aviso de sistema.
function newTurnWeather() { S.weather = rollWeather(); }

// ---------- Sombras de nuvem ----------
// Só as SOMBRAS passam pelo campo — a nuvem em si está fora de quadro, acima. Cada nuvem
// é um aglomerado de bolhas com borda esfumada: as bolhas maiores no meio e menores nas
// pontas dão a silhueta de cúmulo, e a sobreposição cria a variação de densidade que uma
// elipse só não teria. Medidas em unidades da ALTURA do campo, para a proporção não
// esticar em tela larga.
// A faixa tem CLOUD_BAND× a largura da tela e uma nuvem por "casa", cada uma sorteada
// só no miolo da sua casa. Isso garante céu limpo entre elas: nuvem nenhuma encosta na
// vizinha, mesmo no pior sorteio. Medidas em frações da LARGURA da camada, para a
// proporção da nuvem não esticar agora que a camada é alta (campo + cidade).
const CLOUD_BAND = 3, CLOUD_COUNT = 6;
const CLOUDS = Array.from({ length: CLOUD_COUNT }, (_, i) => {
  const n = 9 + Math.floor(Math.random() * 5);
  const span = 0.24 + Math.random() * 0.12;
  const puffs = [];
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0.5 : k / (n - 1);
    const bulge = Math.sin(Math.PI * t);     // volume no meio, afinando nas beiradas
    puffs.push({
      dx: (t - 0.5) * span + (Math.random() - 0.5) * 0.014,
      // Duas fileiras de bolhas: a de cima empilha sobre a de baixo e é isso que dá
      // altura ao cúmulo. Com uma fileira só a nuvem saía chapada.
      dy: -(0.008 + Math.random() * 0.03) * bulge - (k % 2 ? 0.012 * bulge : 0),
      r: (0.022 + Math.random() * 0.02) * (0.55 + 0.7 * bulge),
    });
  }
  return {
    x: (i + 0.22 + Math.random() * 0.56) / CLOUD_COUNT, // miolo da casa: sobra folga
    y: 0.08 + Math.random() * 0.8,
    span, baseR: 0.016 + Math.random() * 0.01, puffs,
  };
});
// A faixa é assada uma vez e vira o background de #cloud-shade; o CSS a repete em X e
// rola a background-position, então o desfile é contínuo e não custa nada por frame.
function buildCloudTex(w, h) {
  const bandW = w * CLOUD_BAND;
  const dpr = devicePixelRatio || 1;
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(bandW * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Silhueta 2D de contorno esfumaçado: cada nuvem é UM path só — a base achatada mais
  // as bolhas, todas no mesmo preenchimento. Com winding nonzero as subpaths se UNEM, o
  // interior sai com densidade uniforme e o blur trata apenas a BORDA. Somar gradientes
  // (como antes) empilhava alfa nas sobreposições e criava miolos escuros: era isso que
  // dava o aspecto de fumaça suja em vez de nuvem.
  if ("filter" in g) g.filter = `blur(${Math.max(3, w * 0.013).toFixed(1)}px)`;
  // O bitmap é assado ESCURO e a opacidade da camada é que dosa. Assim o multiplicador
  // da Tempestade tem para onde subir: com o bitmap claro, `opacity: 1.9` era clampado
  // em 1 pelo CSS e a nuvem de tempestade ficava idêntica à de céu aberto.
  g.fillStyle = "rgba(0,0,0,.46)";
  for (const c of CLOUDS) {
    const cx = c.x * bandW, cy = c.y * h;
    g.beginPath();
    g.ellipse(cx, cy, c.span * w * 0.5, c.baseR * w, 0, 0, Math.PI * 2); // base achatada
    for (const p of c.puffs) {
      g.moveTo(cx + p.dx * w + p.r * w, cy + p.dy * w);
      g.arc(cx + p.dx * w, cy + p.dy * w, p.r * w, 0, Math.PI * 2);
    }
    g.fill();
  }
  if ("filter" in g) g.filter = "none";
  return cv;
}
// Uma nuvem leva CLOUD_CROSS_SEC para varrer a largura da tela; a sombra é forte no sol
// a pino e quase nada ao luar, porque é a luz que a projeta.
const CLOUD_CROSS_SEC = 74;
function cloudAlpha() {
  const base = bloodMoon() ? 0.30 : blackSun() ? 0.26 : S.isNight ? 0.22 : 0.62;
  return Math.min(1, base * weather().clouds); // opacity CSS não passa de 1
}
// Mantém a camada colada na faixa do mundo e com a opacidade do clima atual. Chamada a
// cada frame pelo syncLiveRes, mas só encosta no DOM quando algo muda de verdade.
// A faixa de nuvens é UMA só, do topo do campo ao fim da cidade, mas é exibida em duas
// partes que compartilham o mesmo deslocamento horizontal, então a sombra atravessa a
// muralha sem emenda:
//   · a fatia de cima é desenhada DENTRO do canvas, logo após o chão — assim o astro, os
//     números e a horda ficam por CIMA dela;
//   · o resto vai na camada #cloud-shade, sobre a muralha, a esteira e a cidade.
// O deslocamento vem do relógio visual, então as nuvens também aceleram no 2x/5x.
let shadeKey = "", shadeAlpha = -1, shadeGeo = null, cloudTex = null;
function cloudOffset(w) {
  const bandW = w * CLOUD_BAND;
  return ((vClock * (w / CLOUD_CROSS_SEC)) % bandW + bandW) % bandW;
}
function syncCloudShade() {
  const el = $("cloud-shade");
  if (!el) return;
  const a = +cloudAlpha().toFixed(3);
  if (a !== shadeAlpha) { el.style.opacity = a; shadeAlpha = a; }
  const bf = $("battlefield"), cw = $("city-wrap");
  if (!bf || !cw) return;
  const top = bf.offsetTop;
  const H = Math.round(cw.offsetTop + cw.offsetHeight - top);
  const W = Math.round($("game").clientWidth);
  const fieldH = Math.round(bf.offsetHeight);
  if (!W || !H) return;
  const key = `${W}x${H}x${fieldH}@${devicePixelRatio || 1}`;
  if (key !== shadeKey) {
    cloudTex = buildCloudTex(W, H);
    shadeGeo = { W, H, fieldH, bandW: Math.round(W * CLOUD_BAND) };
    el.style.top = (top + fieldH) + "px";       // começa onde o canvas acaba
    el.style.height = (H - fieldH) + "px";
    el.style.backgroundImage = `url(${cloudTex.toDataURL("image/png")})`;
    el.style.backgroundSize = `${shadeGeo.bandW}px ${H}px`;
    shadeKey = key;
  }
  if (a <= 0) return;
  // Mesma origem horizontal do canvas; o -fieldH em Y continua a faixa de onde ela parou.
  el.style.backgroundPosition = `${-cloudOffset(shadeGeo.W)}px ${-fieldH}px`;
}
// Fatia de cima da mesma faixa, desenhada no canvas do campo.
function drawFieldClouds(w, h) {
  const a = cloudAlpha();
  if (a <= 0 || !cloudTex || !shadeGeo) return;
  const off = cloudOffset(shadeGeo.W);
  const dpr = devicePixelRatio || 1;
  const sh = Math.min(cloudTex.height, Math.round(shadeGeo.fieldH * dpr));
  ctx.save();
  ctx.globalAlpha = a;
  // duas cópias lado a lado: quando uma sai pela esquerda, a outra já entrou
  ctx.drawImage(cloudTex, off * dpr, 0, shadeGeo.W * dpr, sh, 0, 0, w, h);
  ctx.drawImage(cloudTex, (off - shadeGeo.bandW) * dpr, 0, shadeGeo.W * dpr, sh, 0, 0, w, h);
  ctx.restore();
}

// ---------- Chuva, relâmpago e névoa densa ----------
// Camada de clima que vai DEPOIS das unidades, para poder ocultá-las. Nada disso existe
// no update: a chuva é calculada a partir do relógio e o relâmpago tem seu próprio
// temporizador visual, sem estado de jogo.
const RAIN = Array.from({ length: 110 }, () => ({
  x: Math.random(), y: Math.random(),
  len: 0.05 + Math.random() * 0.07,
  sp: 0.75 + Math.random() * 0.7,
}));
let boltFlash = 0, boltNext = 0, boltLast = 0;
function drawWeatherOverlay(w, h) {
  const wt = weather();
  const now = performance.now();

  // Névoa densa: forte no alto (de onde a horda desce) e rala perto da muralha.
  if (wt.fog > 0) {
    const tone = bloodMoon() ? "120,70,70" : S.isNight ? "120,132,162" : "206,200,186";
    const f = ctx.createLinearGradient(0, 0, 0, h);
    f.addColorStop(0, `rgba(${tone},${(0.92 * wt.fog).toFixed(3)})`);
    f.addColorStop(0.38, `rgba(${tone},${(0.74 * wt.fog).toFixed(3)})`);
    f.addColorStop(0.68, `rgba(${tone},${(0.3 * wt.fog).toFixed(3)})`);
    f.addColorStop(1, `rgba(${tone},${(0.08 * wt.fog).toFixed(3)})`);
    ctx.fillStyle = f;
    ctx.fillRect(0, 0, w, h);
  }

  if (wt.rain > 0) {
    const tSec = vClock; // a chuva também acelera no 2x/5x
    ctx.save();
    ctx.strokeStyle = "rgba(186,206,230,.34)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of RAIN) {
      const my = (d.y + tSec * d.sp) % 1;
      const y0 = my * h, x0 = d.x * w + my * w * 0.06; // leve inclinação no vento
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 - d.len * h * 0.22, y0 + d.len * h);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (wt.bolts) {
    const dt = boltLast ? Math.min(200, now - boltLast) : 0;
    boltLast = now;
    if (!boltNext) boltNext = now + 2000 + Math.random() * 5000;
    if (now >= boltNext) { boltFlash = 1; boltNext = now + 3500 + Math.random() * 9000; }
    if (boltFlash > 0) {
      // decai rápido e com um repique no meio: dá o "pisca-pisca" do relâmpago
      const k = boltFlash;
      const puls = k > 0.72 ? 1 : k > 0.5 ? 0.25 : k;
      ctx.fillStyle = `rgba(206,224,255,${(0.34 * puls).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
      boltFlash = Math.max(0, boltFlash - dt / 420);
    }
  } else {
    boltFlash = 0; boltNext = 0; boltLast = 0;
  }
}

// ---------- Textura do chão ----------
// Tudo que é ESTÁTICO no terreno (gradiente, manchas, trilhas, fendas, cascalho, grão)
// é assado uma vez num canvas fora de tela. O draw() faz um drawImage no lugar de ~90
// paths por frame — fica mais rico e mais barato ao mesmo tempo.
let groundTex = null, groundKey = "";
function buildGroundTex(w, h, dpr) {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const laneW = w / LANES;

  // Base: horizonte batido de luz no topo, sombra da muralha embaixo.
  const base = g.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, "#5c4733");
  base.addColorStop(0.34, "#4a3826");
  base.addColorStop(0.72, "#3c2d1c");
  base.addColorStop(1, "#2d2113");
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  // Manchas de terra úmida, agora com borda esfumada (antes eram elipses de corte duro).
  for (const p of PATCHES) {
    g.save();
    g.translate(p.x * w, p.y * h);
    g.scale(1, p.ry / p.rx);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, p.rx);
    rg.addColorStop(0, "rgba(34,23,12,.46)");
    rg.addColorStop(1, "rgba(34,23,12,0)");
    g.fillStyle = rg;
    g.beginPath(); g.arc(0, 0, p.rx, 0, 7); g.fill();
    g.restore();
  }

  // Lanes: faixa alternada + TRILHA, o miolo pisado por onde a horda passa há cem anos.
  for (let i = 0; i < LANES; i++) {
    g.fillStyle = i % 2 ? "rgba(30,20,10,.20)" : "rgba(30,20,10,.12)";
    g.fillRect(i * laneW + 4, 0, laneW - 8, h);
    const rut = g.createLinearGradient(i * laneW, 0, (i + 1) * laneW, 0);
    rut.addColorStop(0, "rgba(154,128,88,0)");
    rut.addColorStop(0.5, "rgba(154,128,88,.11)");
    rut.addColorStop(1, "rgba(154,128,88,0)");
    g.fillStyle = rut;
    g.fillRect(i * laneW, 0, laneW, h);
  }
  g.strokeStyle = "rgba(110,82,50,.32)";
  g.lineWidth = 1;
  for (let i = 1; i < LANES; i++) {
    g.beginPath(); g.moveTo(i * laneW, 0); g.lineTo(i * laneW, h); g.stroke();
  }

  // Fendas: sulco escuro + um fio de luz deslocado na borda, que dá o relevo de terra rachada.
  g.lineCap = "round"; g.lineJoin = "round";
  for (const c of CRACKS) {
    const trace = (dx, dy) => {
      g.beginPath();
      g.moveTo(c[0].x * w + dx, c[0].y * h + dy);
      for (const p of c) g.lineTo(p.x * w + dx, p.y * h + dy);
      g.stroke();
    };
    g.strokeStyle = "rgba(24,16,7,.32)"; g.lineWidth = 1.7; trace(0, 0);
    g.strokeStyle = "rgba(146,120,82,.17)"; g.lineWidth = 0.8; trace(0.9, -0.9);
  }

  // Cascalho: sombra embaixo, corpo, ponto de luz em cima. Alphas baixos de propósito —
  // com mais contraste eles saltam do chão como bolinhas em vez de virarem terreno.
  for (const p of PEBBLES) {
    const px = p.x * w, py = p.y * h;
    g.fillStyle = "rgba(20,13,6,.26)";
    g.beginPath(); g.arc(px, py + 0.8, p.r, 0, 7); g.fill();
    g.fillStyle = p.dark ? "rgba(94,76,50,.34)" : "rgba(152,128,90,.36)";
    g.beginPath(); g.arc(px, py, p.r, 0, 7); g.fill();
    g.fillStyle = "rgba(214,190,144,.16)";
    g.beginPath(); g.arc(px - p.r * 0.3, py - p.r * 0.35, p.r * 0.42, 0, 7); g.fill();
  }

  // Sangue seco junto à muralha: manchas irregulares, marrom-avermelhadas e opacas.
  // Ficam ANTES da vegetação para a grama poder nascer por cima delas.
  for (const b of OLD_BLOOD) {
    g.save();
    g.translate(b.x * w, b.y * h);
    g.rotate(b.rot);
    for (let k = 0; k < b.spots; k++) {
      const s = 1 - k * 0.3;
      g.fillStyle = `rgba(78,22,16,${(0.3 - k * 0.07).toFixed(3)})`;
      g.beginPath();
      g.ellipse(k * b.rx * 0.5, k * b.ry * 0.4, b.rx * s, b.ry * s, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  // Raízes rastejando: um traço escuro com um realce por cima, como as fendas.
  g.lineCap = "round";
  for (const r of ROOTS) {
    const x0 = r.x * w, y0 = r.y * h, len = r.len * w;
    const draw = (dx, dy) => {
      g.beginPath();
      g.moveTo(x0 + dx, y0 + dy);
      g.quadraticCurveTo(x0 + Math.cos(r.ang) * len * 0.5 + dx, y0 + Math.sin(r.ang) * len * 0.9 + dy,
                         x0 + Math.cos(r.ang) * len + dx, y0 + Math.sin(r.ang) * len * 0.3 + dy);
      g.stroke();
    };
    g.strokeStyle = "rgba(38,26,12,.34)"; g.lineWidth = 1.8; draw(0, 0);
    g.strokeStyle = "rgba(122,104,64,.16)"; g.lineWidth = 0.8; draw(0.7, -0.7);
  }

  // Tufos de grama: 2 a 4 lâminas saindo do mesmo ponto, algumas verdes, outras secas.
  g.lineWidth = 1;
  for (const t of TUFTS) {
    const x0 = t.x * w, y0 = t.y * h, hh = t.h * h;
    g.strokeStyle = t.dry ? "rgba(138,126,66,.4)" : "rgba(86,124,58,.46)";
    for (let b = 0; b < t.blades; b++) {
      const off = (b - (t.blades - 1) / 2) * 2.2;
      g.beginPath();
      g.moveTo(x0 + off, y0);
      g.quadraticCurveTo(x0 + off + t.lean * hh * 0.4, y0 - hh * 0.6, x0 + off + t.lean * hh, y0 - hh);
      g.stroke();
    }
  }

  // Microflores: um ponto de cor e um miolo claro. É o que traz cor viva sem poluir.
  for (const f of FLOWERS) {
    const fx = f.x * w, fy = f.y * h;
    g.fillStyle = f.blue ? "rgba(96,132,210,.55)" : "rgba(226,196,74,.55)";
    g.beginPath(); g.arc(fx, fy, f.r, 0, 7); g.fill();
    g.fillStyle = "rgba(255,248,214,.45)";
    g.beginPath(); g.arc(fx, fy, f.r * 0.4, 0, 7); g.fill();
  }

  // Grão fino: tira o aspecto de chapa lisa sem virar ruído.
  for (const s of GRIT) {
    g.fillStyle = s.light ? "rgba(184,158,112,.13)" : "rgba(18,12,5,.17)";
    g.beginPath(); g.arc(s.x * w, s.y * h, s.r, 0, 7); g.fill();
  }
  return cv;
}
function ensureGroundTex(w, h) {
  const dpr = devicePixelRatio || 1;
  // A variação entra na CHAVE em vez de alguém ter que invalidar a textura na mão:
  // trocar de desenho e esquecer o invalidate deixaria o chão antigo assado em cache.
  const key = `${Math.round(w)}x${Math.round(h)}@${dpr}#${fieldVariant()}`;
  if (!groundTex || groundKey !== key) { groundTex = buildGroundTex(w, h, dpr); groundKey = key; }
  return groundTex;
}

// Sombras de contato: sem elas os sprites parecem colados sobre o fundo, não em pé nele.
// Numa passada só, com um fillStyle para todas — save/restore por unidade custava ~1ms
// por frame com a horda cheia, e são 600 corpos no dia 30.
// ---------- Sangue fresco ----------
// Cada morto deixa uma poça que seca e some. Vive fora de S: é puramente decorativo,
// não entra no save nem no update (some pelo relógio visual, então acelera no 5x).
// A vida corre no bClock (segundos de MUNDO), não no vClock: ver frame().
const BLOOD_LIFE = 70;     // segundos de vida da poça (era 24 de relógio visual)
// O teto tem que acompanhar a vida, senão ele vira o verdadeiro limite e as poças somem
// por DESPEJO em vez de secarem. Despejo é um pop instantâneo no meio do campo; secar é
// um fade. A 4 mortes/s no dia 30, 70s de vida pedem ~280 poças vivas ao mesmo tempo.
const BLOOD_MAX = 260;     // teto: no dia 30 morrem centenas por turno
// Fração da vida em que a poça COMEÇA a secar. Antes o fade nascia no instante zero,
// então esticar a duração só deixaria a mancha pálida por mais tempo, em vez de
// realmente presente no chão. Mas segurar opacidade cheia a vida toda também não
// serve: numa noite de dezenas de mortes o campo virava um tapete vermelho liso.
// Em 0.35 o sangue fresco é vivo e o antigo vira resíduo seco — dá leitura de camadas.
const BLOOD_DRY_AT = 0.35;
let bloodPools = [];
const BLOOD_BURST = 0.2;   // 1 em 5 mortos estoura em vez de só sangrar
function addBloodPool(lane, y) {
  if (bloodPools.length >= BLOOD_MAX) bloodPools.shift();
  const burst = Math.random() < BLOOD_BURST;
  const spots = [];
  // Estouro: mais respingos, maiores e espalhados mais longe do corpo.
  const n = burst ? 6 + Math.floor(Math.random() * 4) : 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const far = burst ? 40 : 22;
    spots.push({
      dx: (Math.random() - 0.5) * far, dy: (Math.random() - 0.5) * far * 0.5,
      rx: (burst ? 5 : 3.5) + Math.random() * (burst ? 12 : 8),
      ry: (burst ? 3 : 2.5) + Math.random() * (burst ? 7 : 5),
    });
  }
  bloodPools.push({ lane, y, born: bClock, spots, burst });
  if (burst) {
    // Animação própria: anel de respingo abrindo, separado da poça que fica no chão.
    S.effects.push({ x: lane, y, life: 0.42, max: 0.42, type: "burst" });
    addFloat(lane, y - 0.05, "💥", "#b8322a");
  }
}
function drawBloodPools(laneW, h) {
  if (!bloodPools.length) return;
  // O clamp em 0 não é zelo excessivo: se o relógio visual recuar (debug, seek de
  // animação), a idade fica negativa e o raio da elipse vai a negativo — o canvas lança
  // IndexSizeError e derruba o draw inteiro, levando o jogo junto.
  bloodPools = bloodPools.filter(p => bClock - p.born < BLOOD_LIFE && bClock >= p.born);
  for (const p of bloodPools) {
    const age = Math.max(0, Math.min(1, (bClock - p.born) / BLOOD_LIFE));
    // cresce depressa no primeiro instante e depois seca devagar
    const spread = Math.max(0, Math.min(1, age * 24));
    const dry = Math.max(0, (age - BLOOD_DRY_AT) / (1 - BLOOD_DRY_AT));
    const a = (1 - dry) * (1 - dry) * (p.burst ? 0.72 : 0.58);
    const cx = p.lane * laneW + laneW / 2, cy = p.y * h + 4;
    ctx.fillStyle = `rgba(${p.burst ? "124,18,16" : "104,16,14"},${a.toFixed(3)})`;
    for (const s of p.spots) {
      ctx.beginPath();
      ctx.ellipse(cx + s.dx * spread, cy + s.dy * spread, s.rx * spread, s.ry * spread, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Fogo no chão. Desenhado DEPOIS do sangue: o fogo emite luz e a poça de sangue,
// sendo opaca, estava pintada em cima dele e apagava a chama.
function drawGroundFires(laneW, h) {
  for (const gf of S.groundFires) {
    const gx = gf.lane * laneW + laneW / 2, gy = gf.y * h;
    const flick = 0.6 + 0.4 * Math.sin(performance.now() / 70 + gf.y * 40);
    const gg = ctx.createRadialGradient(gx, gy, 2, gx, gy, gf.r * h * 1.4);
    gg.addColorStop(0, `rgba(240,140,40,${0.5 * flick * Math.min(1, gf.t)})`);
    gg.addColorStop(1, "transparent");
    ctx.fillStyle = gg;
    ctx.fillRect(gx - gf.r * h * 1.5, gy - gf.r * h * 1.5, gf.r * h * 3, gf.r * h * 3);
  }
}
function drawGroundShadows(laneW, h) {
  ctx.fillStyle = "rgba(0,0,0,.32)";
  const blob = (lane, y, rx) => {
    ctx.beginPath();
    ctx.ellipse(lane * laneW + laneW / 2, y * h + 5, rx, rx * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const e of S.enemies) blob(e.lane, e.y, ENEMY_TYPES[e.type].armor < 1 ? 11 : 9);
  for (const a of S.allies) blob(a.lane, a.y, 9);
}

function draw() {
  // o backing store é sincronizado pelo ResizeObserver, não a cada frame
  const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  const laneW = w / LANES;
  const fullMoon = S.isNight && moonPhase();

  // fade do astro: alvo 0 durante o combate, 1 no planejamento (lento, ≈1.4s — sincroniza com a mensagem)
  const nowT = performance.now();
  const dtF = Math.min(0.05, (nowT - (astroFadeT || nowT)) / 1000); astroFadeT = nowT;
  const astroTarget = S.waveActive ? 0 : 1;
  astroFade += Math.sign(astroTarget - astroFade) * Math.min(Math.abs(astroTarget - astroFade), 0.72 * dtF);

  ctx.drawImage(ensureGroundTex(w, h), 0, 0, w, h);
  drawFieldClouds(w, h); // fatia de cima da faixa de nuvens (ver syncCloudShade)

  // Névoa do horizonte: o topo do campo é de onde a horda vem, e ficava um corte seco.
  const air = airTone();
  const hazeM = weather().haze;
  if (hazeM > 0) {
  const haze = ctx.createLinearGradient(0, 0, 0, h * 0.42);
  // Bem discreta: a textura do chão já entrega o horizonte batido de luz. A névoa aqui
  // só ambienta e separa o dia da noite — não é para ser notada por si só.
  haze.addColorStop(0, `rgba(${air.haze},${(0.11 * hazeM).toFixed(3)})`);
  haze.addColorStop(0.55, `rgba(${air.haze},${(0.04 * hazeM).toFixed(3)})`);
  haze.addColorStop(1, `rgba(${air.haze},0)`);
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, w, h * 0.42);

  // Partículas: sobem à noite (brasas), descem de dia (poeira). Leve bamboleio lateral.
  const tSec = vClock;
  for (const m of MOTES) {
    const travel = tSec * m.sp;
    const my = (air.up ? (m.y - travel) : (m.y + travel)) % 1;
    const py = (my < 0 ? my + 1 : my) * h;
    const px = m.x * w + Math.sin(tSec * 0.8 + m.ph) * m.sway;
    ctx.fillStyle = `rgba(${air.mote},${0.05 + 0.07 * (0.5 + 0.5 * Math.sin(tSec * 1.6 + m.ph))})`;
    ctx.beginPath(); ctx.arc(px, py, m.r, 0, 7); ctx.fill();
  }
  } // fim do bloco de névoa/partículas (Turno Perfeito não desenha nenhum dos dois)

  // Astro no topo da lane central; faz fade-out no ataque e fade-in no planejamento.
  const drawAstro = () => {
  if (astroFade <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = astroFade;
  const ax = w / 2, ay = 34;
  // número do dia sobre o astro (badge escuro no centro)
  const drawDayBadge = () => {
    // só o número (sem disco escuro nem anel dourado); sombra p/ legibilidade
    ctx.fillStyle = "#f5f2ec";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "700 14px Georgia, serif";
    ctx.shadowColor = "rgba(0,0,0,.9)"; ctx.shadowBlur = 4;
    ctx.fillText(S.day, ax, ay);
    ctx.shadowBlur = 0;
    ctx.textBaseline = "alphabetic";
  };
  if (bloodMoon()) {
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 300);
    ctx.shadowColor = "#c22f2f"; ctx.shadowBlur = 24 * pulse;
    ctx.fillStyle = "#a81e1e";
    ctx.beginPath(); ctx.arc(ax, ay, 21, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(60,0,0,.35)";
    ctx.beginPath(); ctx.arc(ax - 6, ay - 4, 6, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(ax + 7, ay + 6, 4, 0, 7); ctx.fill();
  } else if (blackSun()) {
    ctx.shadowColor = "#eecd5c"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#0c0a08";
    ctx.beginPath(); ctx.arc(ax, ay, 18, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#eecd5c"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ax, ay, 18, 0, 7); ctx.stroke();
  } else if (S.isNight) {
    const img = ASTRO_IMG.night;
    if (img.complete && img.naturalWidth) {
      if (fullMoon) { ctx.shadowColor = "#e0a080"; ctx.shadowBlur = 18; }
      ctx.globalAlpha = 0.34 * astroFade;             // lua mais transparente (0.45 −25%)
      ctx.drawImage(img, ax - 20, ay - 20, 40, 40);   // arte da lua menor (60→40px)
      ctx.globalAlpha = astroFade;
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = "#e6dcc8";
      ctx.beginPath(); ctx.arc(ax, ay, 20, 0, 7); ctx.fill();
    }
  } else {
    const img = ASTRO_IMG.day;
    if (img.complete && img.naturalWidth) {
      ctx.drawImage(img, ax - 30, ay - 30, 60, 60);
    } else {
      ctx.fillStyle = "#eecd5c";
      ctx.beginPath(); ctx.arc(ax, ay, 18, 0, 7); ctx.fill();
    }
  }
  drawDayBadge();
  ctx.restore();
  };

  ctx.fillStyle = "#52422e";
  const mw = w / 15;
  for (let i = 0; i < 15; i += 2) ctx.fillRect(i * mw, h - 8, mw, 8);
  ctx.fillStyle = "#3e3122";
  ctx.fillRect(0, h - 3, w, 3);

  // linhas de poder (traço em desenho + linhas ativas)
  const allLines = drawingLine ? [...S.powerLines, drawingLine] : S.powerLines;
  const nowMs = performance.now();
  for (const l of allLines) {
    if (l.pts.length < 2) continue;
    const a = Math.max(0, l.life / l.max);
    const flick = 0.75 + 0.25 * Math.sin(nowMs / 55);
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    // Selo FECHADO (Alpha/Omega/Beta): mantém o desenho arcano pulsante, sem erosão.
    if (l.seal) {
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(l.pts[0].x * w, l.pts[0].y * h);
        for (const p of l.pts) ctx.lineTo(p.x * w, p.y * h);
        ctx.closePath();
      };
      path(); ctx.fillStyle = `rgba(${ARCANE.base},${0.22 * a * flick})`; ctx.fill();
      path(); ctx.shadowColor = ARCANE.hex; ctx.shadowBlur = 22; ctx.strokeStyle = `rgba(${ARCANE.base},${0.5 * a})`; ctx.lineWidth = 9; ctx.stroke();
      path(); ctx.shadowBlur = 14; ctx.strokeStyle = `rgba(${ARCANE.light},${0.9 * a * flick})`; ctx.lineWidth = 5; ctx.stroke();
      path(); ctx.shadowColor = "#fff"; ctx.shadowBlur = 6; ctx.strokeStyle = `rgba(255,244,255,${0.95 * a * flick})`; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.shadowBlur = 0;
      continue;
    }

    // Laser (linha de poder): tremor + dissolução sequencial (o mais ANTIGO some primeiro).
    const N = l.pts.length;
    const jit = 0.45 * (0.5 + 0.5 * a); // vibração bem sutil; mais forte enquanto tem energia
    // buzz de alta frequência (energético, não ondulante) + fase caótica por ponto
    const P = l.pts.map((p, i) => ({
      x: p.x * w + Math.sin(nowMs / 16 + i * 4.7) * jit,
      y: p.y * h + Math.cos(nowMs / 13 + i * 6.1) * jit,
    }));
    // frente de apagamento (em pos 0..1): avança do início (mais ANTIGO) ao fim conforme envelhece
    const front = 1 - a; // a=1 → 0 (nada apagado); a=0 → 1 (tudo apagado)
    const fk = Math.max(0, front) * (N - 1);
    const i0 = Math.floor(fk), ff = fk - i0;
    // ponto de partida interpolado exatamente na frente → a linha ENCURTA suave, sem contas
    const start = {
      x: P[i0].x + (P[Math.min(i0 + 1, N - 1)].x - P[i0].x) * ff,
      y: P[i0].y + (P[Math.min(i0 + 1, N - 1)].y - P[i0].y) * ff,
    };
    // traço CONTÍNUO por camada (uma só stroke → sem nódulos nos vértices)
    const buildPath = () => {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = i0 + 1; i < N; i++) ctx.lineTo(P[i].x, P[i].y);
    };
    const layers = [
      { col: ARCANE.base,  sh: ARCANE.hex, blur: 20, wdt: 8,   al: 0.45 },
      { col: ARCANE.light, sh: ARCANE.hex, blur: 13, wdt: 4.5, al: 0.9 * flick },
      { col: "255,244,255", sh: "#fff",    blur: 6,  wdt: 1.6, al: 0.95 * flick },
    ];
    if (i0 < N - 1) {
      for (const L of layers) {
        ctx.shadowColor = L.sh; ctx.shadowBlur = L.blur; ctx.lineWidth = L.wdt;
        ctx.strokeStyle = `rgba(${L.col},${(L.al * a).toFixed(3)})`;
        buildPath(); ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  }

  // Feixe do Holofote: a lâmpada está NA MURALHA, então o cone nasce estreito embaixo e
  // se abre subindo até o horizonte — e clareia mais perto da fonte, porque lá a luz
  // ainda está concentrada. Fica sob as unidades: ilumina o chão sem lavar os sprites.
  for (const L of litLanes) {
    const cx = L * laneW + laneW / 2;
    const beam = ctx.createLinearGradient(0, h, 0, 0);
    beam.addColorStop(0, "rgba(255,238,190,.22)");
    beam.addColorStop(0.55, "rgba(255,232,170,.11)");
    beam.addColorStop(1, "rgba(255,226,150,.03)");
    ctx.save();
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(cx - laneW * 0.16, h);   // ponta estreita, junto à muralha
    ctx.lineTo(cx + laneW * 0.16, h);
    ctx.lineTo(cx + laneW * 0.46, 0);   // boca larga, no horizonte
    ctx.lineTo(cx - laneW * 0.46, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // selos de proteção: runa discreta na base de cada lane protegida
  for (let i = 0; i < LANES; i++) {
    if (!S.seals[i]) continue;
    const sx = i * laneW + laneW / 2;
    // Depois que o chão ganhou grama, raízes e flores, a runa de 10px a 35% de opacidade
    // simplesmente desaparecia no meio do detalhe. Maior, mais opaca e com halo próprio.
    const pulse = 0.72 + 0.2 * Math.sin(vClock * 1.7 + i);
    ctx.save();
    ctx.textAlign = "center";
    ctx.shadowColor = ARCANE.hex; ctx.shadowBlur = 9;
    ctx.font = "700 14px sans-serif";
    ctx.fillStyle = `rgba(${ARCANE.light},${pulse.toFixed(3)})`;
    ctx.fillText("◈", sx, h - 11);
    ctx.restore();
  }

  // varredura de selo rompido: onda arcana subindo a lane
  for (const sw of S.sweeps) {
    const sx = sw.lane * laneW, sy = sw.y * h;
    const grad = ctx.createLinearGradient(0, sy - 18, 0, sy + 18);
    grad.addColorStop(0, "transparent");
    grad.addColorStop(0.5, `rgba(${ARCANE.light},.55)`);
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fillRect(sx + 2, sy - 18, laneW - 4, 36);
    ctx.fillStyle = "rgba(255,244,255,.85)";
    ctx.fillRect(sx + 2, sy - 1, laneW - 4, 2);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const wn of S.warnings) {
    const tMax = wn.tMax || wn.t;
    const elapsed = tMax - wn.t;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
    const wx = wn.lane * laneW + laneW / 2, wy = 18;

    // bounce sutil e rápido ao aparecer (easeOutBack, ~160ms)
    const ap = Math.min(1, elapsed / 0.16);
    const c1 = 1.70158, c3 = c1 + 1;
    const scale = 1 + c3 * Math.pow(ap - 1, 3) + c1 * Math.pow(ap - 1, 2);
    // fade out rápido ao sumir (~200ms finais)
    const alpha = Math.min(1, wn.t / 0.2);

    ctx.save();
    ctx.globalAlpha = alpha * 0.6;
    ctx.translate(wx, wy);
    ctx.scale(scale, scale);

    // halo vermelho pulsante
    ctx.fillStyle = `rgba(200,30,30,${0.28 + 0.4 * pulse})`;
    ctx.beginPath(); ctx.arc(0, 0, 13 + pulse * 4, 0, 7); ctx.fill();

    // caveira preta com contorno vermelho
    ctx.font = "bold 22px sans-serif";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#c81e1e";
    ctx.strokeText("☠", 0, 1);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillText("☠", 0, 1);

    ctx.restore();
  }
  ctx.textBaseline = "alphabetic";

  for (const p of S.projectiles) {
    const k = Math.min(1, p.t);
    const sx = p.fromLane * laneW + laneW / 2, sy = h - 6;
    const ex = p.ex * laneW + laneW / 2, ey = p.ey * h;
    const px = sx + (ex - sx) * k;
    let py = sy + (ey - sy) * k;
    if (p.type === "catapulta") py -= Math.sin(Math.PI * k) * h * 0.25;
    if (p.type === "besta") {
      ctx.shadowColor = "#f0d060"; ctx.shadowBlur = 6;
      const ang = Math.atan2(ey - sy, ex - sx);
      ctx.strokeStyle = "#f0d060"; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px - Math.cos(ang) * 9, py - Math.sin(ang) * 9);
      ctx.lineTo(px + Math.cos(ang) * 5, py + Math.sin(ang) * 5);
      ctx.stroke();
    } else if (p.type === "catapulta") {
      ctx.shadowColor = "#f0d060"; ctx.shadowBlur = 6;
      ctx.fillStyle = "#b0a090";
      ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.fill();
    } else if (p.type === "canalizador") {
      ctx.shadowColor = "#c89aff"; ctx.shadowBlur = 10;
      ctx.fillStyle = "#a86ae0";
      ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.fill();
    } else if (p.type === "tesla") {
      // raio serrilhado da torre até o ponto atual
      ctx.shadowColor = "#8ae0ff"; ctx.shadowBlur = 8;
      ctx.strokeStyle = "#aef0ff"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      const segs = 5;
      for (let s = 1; s <= segs; s++) {
        const kk = (s / segs) * k;
        const jx = sx + (ex - sx) * kk + (s < segs ? (Math.random() - 0.5) * 14 : 0);
        const jy = sy + (ey - sy) * kk + (s < segs ? (Math.random() - 0.5) * 10 : 0);
        ctx.lineTo(jx, jy);
      }
      ctx.stroke();
    } else {
      ctx.shadowColor = "#f0d060"; ctx.shadowBlur = 6;
      ctx.fillStyle = "#7ac36a";
      ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  for (const fx of S.effects) {
    const k = 1 - fx.life / fx.max;
    const fxx = fx.x * laneW + laneW / 2, fxy = fx.y * h;
    if (fx.type === "burst") {
      // Estouro: respingos saindo em raios, com um clarão curto no centro.
      ctx.save();
      const r = 6 + k * 30;
      ctx.strokeStyle = `rgba(150,26,22,${(1 - k) * 0.8})`;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      for (let s = 0; s < 8; s++) {
        const ang = (s / 8) * Math.PI * 2 + fx.x;
        ctx.beginPath();
        ctx.moveTo(fxx + Math.cos(ang) * r * 0.45, fxy + Math.sin(ang) * r * 0.28);
        ctx.lineTo(fxx + Math.cos(ang) * r, fxy + Math.sin(ang) * r * 0.62);
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(210,70,56,${(1 - k) * 0.5})`;
      ctx.beginPath(); ctx.arc(fxx, fxy, 7 * (1 - k), 0, 7); ctx.fill();
      ctx.restore();
      continue;
    }
    if (fx.type === "forgive") {
      // A muralha aparou: lasca de pedra e poeira, sem o vermelho de dano.
      ctx.save();
      ctx.strokeStyle = `rgba(200,176,136,${(1 - k) * 0.85})`;
      ctx.lineWidth = 2 + (1 - k) * 3;
      ctx.beginPath(); ctx.arc(fxx, fxy, 10 + k * 34, 0, 7); ctx.stroke();
      ctx.restore();
      continue;
    }
    if (fx.type === "grind") {
      // Moedor: anel vermelho colapsando PARA DENTRO, sugando em vez de explodir.
      ctx.save();
      ctx.strokeStyle = `rgba(190,60,50,${(1 - k) * 0.9})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(fxx, fxy, 34 * (1 - k) + 4, 0, 7); ctx.stroke();
      ctx.restore();
      continue;
    }
    if (fx.type === "seal") {
      // flash do selo roxo: onda de choque com brilho + disco esmaecendo
      ctx.save();
      const r = 8 + k * 66;
      ctx.shadowColor = ARCANE.hex; ctx.shadowBlur = 20;
      ctx.strokeStyle = `rgba(${ARCANE.light},${(1 - k) * 0.9})`;
      ctx.lineWidth = 3 + (1 - k) * 4;
      ctx.beginPath(); ctx.arc(fxx, fxy, r, 0, 7); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(${ARCANE.base},${(1 - k) * 0.22})`;
      ctx.beginPath(); ctx.arc(fxx, fxy, r * 0.68, 0, 7); ctx.fill();
      ctx.restore();
      continue;
    }
    // ===== VFX das habilidades do Conselho =====
    if (fx.type === "council") { // ativação da Távola: anel dourado expandindo no ponto pressionado
      ctx.save();
      const r = 10 + k * 46;
      ctx.shadowColor = "#eecd5c"; ctx.shadowBlur = 18;
      ctx.strokeStyle = `rgba(238,205,92,${(1 - k) * 0.95})`;
      ctx.lineWidth = 3 + (1 - k) * 4;
      ctx.beginPath(); ctx.arc(fxx, fxy, r, 0, 7); ctx.stroke();
      ctx.strokeStyle = `rgba(255,240,190,${(1 - k) * 0.7})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(fxx, fxy, r * 0.55, 0, 7); ctx.stroke();
      ctx.restore();
      continue;
    }
    if (fx.type === "arrows") { // Mestra Arqueira: rajada de flechas descendo a lane
      ctx.save();
      ctx.strokeStyle = `rgba(238,205,92,${1 - k})`; ctx.lineWidth = 2.5; ctx.lineCap = "round";
      ctx.shadowColor = "#eecd5c"; ctx.shadowBlur = 8;
      for (let a = 0; a < 7; a++) {
        const ax = fx.x * laneW + ((a * 53) % laneW), ay = (((a / 7) + k) % 1) * h;
        ctx.beginPath(); ctx.moveTo(ax - 3, ay - 12); ctx.lineTo(ax + 3, ay + 6);
        ctx.moveTo(ax + 3, ay + 6); ctx.lineTo(ax, ay + 1); ctx.moveTo(ax + 3, ay + 6); ctx.lineTo(ax + 6, ay + 3);
        ctx.stroke();
      }
      ctx.restore(); continue;
    }
    if (fx.type === "frost") { // Feiticeira Glacial: banho gélido + flocos na lane
      ctx.save();
      const al = (1 - k) * 0.55;
      ctx.fillStyle = `rgba(138,198,240,${al * 0.28})`; ctx.fillRect(fx.x * laneW, 0, laneW, h);
      ctx.fillStyle = `rgba(255,255,255,${al})`; ctx.shadowColor = "#8ac6f0"; ctx.shadowBlur = 6;
      for (let s = 0; s < 12; s++) { const sx = fx.x * laneW + ((s * 41) % laneW), sy = (((s / 12) + k) % 1) * h; ctx.beginPath(); ctx.arc(sx, sy, 1.8, 0, 7); ctx.fill(); }
      ctx.restore(); continue;
    }
    if (fx.type === "lightning") { // Arconte Tesla: raio do topo até o alvo
      ctx.save();
      ctx.strokeStyle = `rgba(200,244,255,${1 - k})`; ctx.lineWidth = 2.6; ctx.lineCap = "round";
      ctx.shadowColor = "#8ae0ff"; ctx.shadowBlur = 16;
      const segs = 9; ctx.beginPath(); ctx.moveTo(fxx, 0);
      for (let s = 1; s <= segs; s++) { const p = s / segs; const lx = fxx + Math.sin(s * 7.3) * (14 * (1 - p)) + Math.cos(s * 3.1) * 3; ctx.lineTo(lx, fxy * p); }
      ctx.stroke();
      ctx.fillStyle = `rgba(220,248,255,${1 - k})`; ctx.beginPath(); ctx.arc(fxx, fxy, 5 + (1 - k) * 4, 0, 7); ctx.fill();
      ctx.restore(); continue;
    }
    if (fx.type === "repair") { // Engenheira-Mor: muralha reforçada, faíscas subindo
      ctx.save();
      const al = 1 - k, wy = 0.9 * h;
      ctx.strokeStyle = `rgba(200,176,136,${al})`; ctx.lineWidth = 3; ctx.shadowColor = "#f0d060"; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(0, wy); ctx.lineTo(w, wy); ctx.stroke();
      ctx.fillStyle = `rgba(255,230,150,${al})`;
      for (let s = 0; s < 16; s++) { const sx = ((s + 0.5) / 16) * w, sy = wy - ((s * 11 + k * 42) % 42); ctx.fillRect(sx - 1.2, sy - 1.2, 2.6, 2.6); }
      ctx.restore(); continue;
    }
    if (fx.type === "heal") { // Clériga: cruz de luz subindo sobre a tropa
      ctx.save();
      const al = 1 - k, cy = fxy - k * 18;
      ctx.globalAlpha = al; ctx.fillStyle = "#c6f0c8"; ctx.shadowColor = "#8ff0a0"; ctx.shadowBlur = 12;
      ctx.fillRect(fxx - 1.6, cy - 8, 3.2, 16); ctx.fillRect(fxx - 8, cy - 1.6, 16, 3.2);
      ctx.restore(); continue;
    }
    if (fx.type === "fog") { // Mestre das Sombras: névoa roxa cobrindo o campo
      ctx.save();
      const al = (1 - k) * 0.6;
      ctx.fillStyle = `rgba(120,70,160,${al * 0.3})`; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `rgba(200,154,255,${al * 0.45})`; ctx.shadowColor = "#a86ae0"; ctx.shadowBlur = 24;
      for (let s = 0; s < 12; s++) { const fp = (s * 97 + k * 130) % (w + 80) - 40, gp = (s * 53) % h; ctx.beginPath(); ctx.arc(fp, gp, 20 + (s % 4) * 7, 0, 7); ctx.fill(); }
      ctx.restore(); continue;
    }
    if (fx.type === "meteor") { // Arconte do Fim: meteoro entra e explode
      ctx.save();
      if (k < 0.45) { // entrada em risco flamejante
        const p = k / 0.45, sy = fxy * p, sx = fxx - (1 - p) * 46;
        ctx.strokeStyle = "rgba(255,150,60,0.9)"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.shadowColor = "#ff7a3a"; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.moveTo(sx - 34, sy - 44); ctx.lineTo(sx, sy); ctx.stroke();
        ctx.fillStyle = "#ffd080"; ctx.beginPath(); ctx.arc(sx, sy, 6, 0, 7); ctx.fill();
      } else { // explosão
        const p = (k - 0.45) / 0.55, r = 12 + p * 62;
        ctx.strokeStyle = `rgba(255,120,50,${1 - p})`; ctx.lineWidth = 4 + (1 - p) * 5; ctx.shadowColor = "#ff7a3a"; ctx.shadowBlur = 22;
        ctx.beginPath(); ctx.arc(fxx, fxy, r, 0, 7); ctx.stroke();
        ctx.fillStyle = `rgba(255,90,40,${(1 - p) * 0.3})`; ctx.beginPath(); ctx.arc(fxx, fxy, r * 0.6, 0, 7); ctx.fill();
        ctx.fillStyle = `rgba(255,200,120,${1 - p})`;
        for (let s = 0; s < 9; s++) { const ang = s / 9 * Math.PI * 2; ctx.beginPath(); ctx.arc(fxx + Math.cos(ang) * r * 0.9, fxy + Math.sin(ang) * r * 0.9, 2.6, 0, 7); ctx.fill(); }
      }
      ctx.restore(); continue;
    }
    ctx.strokeStyle =
      fx.type === "catapulta" ? `rgba(200,180,140,${1 - k})` :
      fx.type === "canalizador" ? `rgba(200,154,255,${1 - k})` :
      fx.type === "tesla" ? `rgba(138,224,255,${1 - k})` :
      `rgba(240,208,96,${1 - k})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(fxx, fxy, 4 + k * (fx.type === "catapulta" ? 22 : 12), 0, 7); ctx.stroke();
  }

  // Anel de progresso da Távola enquanto o jogador segura o ponto (0→100% em 2s).
  // Só aparece após um pequeno atraso: ao DESENHAR (mover o dedo) o hold é cancelado
  // antes disso, então o anel não chega a piscar na tela.
  if (S.councilCharge && (performance.now() - S.councilCharge.t0) > COUNCIL_RING_DELAY) {
    const c = S.councilCharge;
    const p = Math.min(1, (performance.now() - c.t0) / c.dur);
    const cx = c.fx * w, cy = c.fy * h;
    ctx.save();
    ctx.shadowColor = "#eecd5c"; ctx.shadowBlur = 10;
    ctx.strokeStyle = "rgba(238,205,92,0.25)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, 24, 0, 7); ctx.stroke();
    ctx.strokeStyle = "#eecd5c"; ctx.lineWidth = 4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(cx, cy, 24, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
    ctx.fillStyle = `rgba(255,240,190,${0.4 + 0.4 * p})`;
    ctx.beginPath(); ctx.arc(cx, cy, 3 + p * 3, 0, 7); ctx.fill();
    ctx.restore();
  }

  drawBloodPools(laneW, h); // no chão, sob as sombras e a horda
  drawGroundFires(laneW, h); // DEPOIS do sangue: fogo é luz, não mancha, e a poça o cobria
  drawGroundShadows(laneW, h);
  for (const e of S.enemies) {
    const t = ENEMY_TYPES[e.type];
    const x = e.lane * laneW + laneW / 2;
    // Passada: um balanço vertical minúsculo, fora de fase por inimigo. A horda deixa de
    // deslizar em bloco e passa a marchar. Só o sprite sobe — `e.y` (colisão) não muda,
    // e a sombra fica no chão, então o pé "descola" de leve a cada passo.
    const y = e.y * h + Math.sin(vClock * 5.13 + (e.ph || 0)) * 1.6;
    ctx.font = (t.armor < 1 ? 24 : 20) + "px sans-serif";
    ctx.fillText(e.burn > 0 ? "🔥" : t.icon, x, y);
    if (e._targeted) {
      // Alvo de torre: anel tracejado e fino. O círculo cheio e opaco competia com o
      // sprite do inimigo e com os selos; tracejado ainda lê como "mira" de longe.
      // save/restore obrigatório: sem ele o tracejado vazaria para a aura e o HP.
      ctx.save();
      ctx.strokeStyle = "rgba(255,210,122,.42)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(x, y - 6, 14, 0, 7); ctx.stroke();
      ctx.restore();
    }
    if (e.pz) { ctx.fillStyle = "rgba(120,200,80,.8)"; ctx.beginPath(); ctx.arc(x + 10, y - 8, 3, 0, 7); ctx.fill(); }
    if (e.aura) {
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 200);
      ctx.strokeStyle = `rgba(200,40,160,${0.45 + 0.35 * pulse})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y - 4, 15 + pulse * 2, 0, 7); ctx.stroke();
      ctx.textAlign = "center"; ctx.font = "13px sans-serif";
      ctx.fillText(SHAPES[e.aura].ic, x, y - 22);
    }
    if (SETTINGS.hpBars) {
      ctx.fillStyle = "rgba(20,12,6,.8)"; ctx.fillRect(x - 12, y + 4, 24, 3);
      ctx.fillStyle = "#a8402c"; ctx.fillRect(x - 12, y + 4, 24 * Math.max(0, Math.min(1, e.hp / e.maxHp)), 3);
    }
  }

  // projéteis dos inimigos à distância
  if (S.eshots && S.eshots.length) {
    ctx.font = "15px sans-serif";
    for (const s of S.eshots) ctx.fillText(s.ic, s.lane * laneW + laneW / 2, s.y * h);
  }

  // aliados (barra de vida verde + faixa da ideologia)
  for (const a of S.allies) {
    const at = ALLY_TYPES[a.type];
    const x = a.lane * laneW + laneW / 2, y = a.y * h;
    ctx.font = "20px sans-serif";
    ctx.fillText(at.icon, x, y);
    // ideologia jurada: anel colorido sob a tropa
    if (a.fac && FACTIONS[a.fac]) {
      ctx.save();
      ctx.strokeStyle = FACTIONS[a.fac].color; ctx.lineWidth = 2; ctx.globalAlpha = .85;
      ctx.beginPath(); ctx.ellipse(x, y + 2, 11, 4, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (a.aura) {
      const s = SHAPES[a.aura.type], pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      ctx.save();
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.globalAlpha = 0.45 + 0.4 * pulse;
      drawAuraShape(a.aura.type, x, y - 2, 15);
      ctx.restore();
    }
    if (SETTINGS.hpBars) {
      ctx.fillStyle = "rgba(20,12,6,.8)"; ctx.fillRect(x - 12, y + 4, 24, 3);
      ctx.fillStyle = "#7ac36a"; ctx.fillRect(x - 12, y + 4, 24 * Math.max(0, Math.min(1, a.hp / a.maxHp)), 3);
    }
  }

  ctx.font = "700 13px Georgia, serif";
  for (const f of S.floats) {
    ctx.globalAlpha = Math.max(0, f.life / f.max);
    ctx.fillStyle = f.color;
    ctx.fillText(f.txt, f.x * laneW + laneW / 2, f.y * h);
  }
  ctx.globalAlpha = 1;

  // Clima por cima das unidades: é o que permite a névoa engolir a horda de longe.
  drawWeatherOverlay(w, h);

  // Vinheta: escurece os cantos e empurra o olho para o centro da lane. Vem antes do
  // astro de propósito, para o sol/lua e o número do dia não perderem contraste.
  const vig = ctx.createRadialGradient(w / 2, h * 0.52, Math.min(w, h) * 0.34, w / 2, h * 0.52, Math.max(w, h) * 0.78);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,.42)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  // astro por último: inimigos passam por baixo dele
  drawAstro();
}

// ---------- Loop ----------
// Simulação e desenho no MESMO requestAnimationFrame: antes o update rodava a 20 Hz
// (setInterval 50ms) contra um draw a 60 Hz, e o movimento saía em degraus.
// Toda a lógica já é escalada por dt em segundos, então o balanceamento não muda.
// Menu inicial e escolha de facção cobrem a tela toda: não há campo visível embaixo deles.
function menusOpen() {
  return !$("menu").classList.contains("hidden") || !$("factions").classList.contains("hidden");
}
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.min(0.1, (now - lastT) / 1000);
  const dt = raw * S.debug.speed;
  lastT = now;
  vClock += dt;   // relógio VISUAL: já vem multiplicado pela velocidade do jogo
  // Relógio do SANGUE: segundos de mundo, sem o multiplicador de velocidade e parado
  // quando o jogador não está olhando o campo. A mancha é um vestígio, não uma animação:
  // no 3x ela secava em 8s reais e o campo amanhecia limpo depois de qualquer virada de
  // turno; e um minuto no menu de pausa não deveria apagar a noite anterior.
  if (!S.paused && !menusOpen()) bClock += raw;
  update(dt);
  if (menusOpen()) return;
  syncLiveRes();
  draw();
}

// Passar o turno com a visita do dia pendente: confirma antes, avisando do custo.
$("btn-wave").onclick = () => {
  if (!favVisitPending()) { startWave(); return; }
  const vc = FAV_CHARS[S.fav.visitor];
  openModal("🚪 Uma aliança espera por você", (m) => {
    const p = document.createElement("div");
    p.className = "panel-hint";
    p.innerHTML = `Hoje quem veio foi <b>${vc.punIc} ${vc.name}</b>, e você ainda não o recebeu. Se passar o turno agora, a corte inteira toma o desprezo como resposta: <b>−${FAV_IGNORE_REL}% de relação com os quatro</b>.`;
    m.appendChild(p);
    const acts = document.createElement("div");
    acts.className = "fav-confirm";
    const go = document.createElement("button");
    go.className = "fav-cbtn";
    go.textContent = "🤝 Ir às Alianças";
    go.onclick = () => { closeModal(); openFavores(); };
    const skip = document.createElement("button");
    skip.className = "fav-cbtn danger";
    skip.textContent = `🚪 Passar assim mesmo (−${FAV_IGNORE_REL}%)`;
    skip.onclick = () => { closeModal(); favIgnoreVisit(); startWave(); };
    acts.append(go, skip);
    m.appendChild(acts);
  });
};

// 🔒 turnos automáticos
$("btn-lock").onclick = () => {
  S.autoTurn = !S.autoTurn;
  // o automático apenas ESCONDE a visita (favVisitPending checa !autoTurn); não a
  // consome — destravar no mesmo dia devolve a visita pendente.
  if (S.autoTurn && !S.fav.used) toast("🔒 Turnos automáticos: sem visitas às alianças.");
  saveGame();
  renderHUD();
};

// Acelerador: 1x → 2x → 3x → 5x
const SPEEDS = [1, 2, 3, 5];
$("btn-speed").onclick = () => {
  const idx = SPEEDS.indexOf(S.debug.speed);
  S.debug.speed = SPEEDS[(idx + 1) % SPEEDS.length];
  renderHUD();
};

// ---------- Menu inicial ----------
// Abertura em três telas: o decreto → o mundo que sobrou → você. Depois vêm as regras.
// Abertura. Os trechos entre *asteriscos* viram destaque dourado com respiro lento
// (ver loreHTML e .lore-hi): são as batidas que o texto quer que o jogador leia devagar.
const LORE_DECREE =
  "Dois mil anos atrás, o rei negativo cansou-se deste planeta. De cada prece sem sentido, de cada pedido egoísta, de cada guerra vazia travada em seu nome. Então resolveu fechar os olhos e dormir, esperando que o planeta definhasse sem a sua ajuda.\n\n"
  + "*Mas isso não aconteceu.*\n\n"
  + "Estta prosperou e evoluiu. Até que, cento e vinte anos atrás, uma equipe de aventureiros irresponsáveis abriu a tumba errada em busca de tesouros.\n\n"
  + "*Eles foram pulverizados instantaneamente.*\n\n"
  + "O rei negativo acordou num mundo vibrante, repleto de criaturas, reinos, lendas e canções. E, acima de tudo, insuportavelmente barulhento. Então ele disse:\n\n"
  + "*Se eu não vou dormir, então ninguém vai.*";

const LORE_WORLD =
  "Os mortos se levantaram, cova atrás de cova. Em poucos anos, o mundo de Estta mudou por completo. A humanidade, desesperada para sobreviver, se encolheu em um punhado de metrópoles muradas, cada vez mais lotadas. Lá fora marcham os restos: homens, animais e criaturas mágicas corrompidos pela vontade de um inimigo que só vai descansar quando a última cidade cair.\n\n"
  + "*Eles nunca param de chegar. Dia e noite.*\n\n"
  + "Você é de Karzstak. A cidade imensa resiste há mais de um século, e hoje você finalmente foi escolhido para proteger um dos setores das muralhas.\n\n"
  + "*Ha! Comandante-arquimago. Nada mal.*";

const LORE_COMMAND =
  "Vinte anos treinando para este momento. Você sacrificou muito para chegar aqui, e vai ter que sacrificar ainda mais para se manter.\n\n"
  + "Seu setor acaba de ser reerguido, reconquistado pedra por pedra depois que o comandante anterior tombou. Muitas vidas pagaram por este chão, e seus superiores esperam que a aposta tenha valido a pena.\n\n"
  + "Direto da mão do rei você recebeu um Cetro Real, forjado nas chamas do Turbilhão Narxis, a única fonte mágica do reino. Não desperdice esta dádiva.\n\n"
  + "Proteja seu setor. Atravesse os turnos. Sobreviva 30 dias para talhar seu nome nos tijolos das muralhas internas. Nosso juramento é um só:\n\n"
  + "*Karzstak NÃO deve cair. Não importa o custo.*";


// ---------- Tutorial rápido no campo ----------
// Substitui a antiga tela "Suas Ordens": em vez de mais um modal antes de o jogador ver
// o jogo, as instruções passam SOBRE o campo, já com tudo à vista. Enquanto rodam, um
// anel dourado pulsa no botão de troca de campo, que é o controle menos óbvio da tela.
const TUTORIAL_TIPS = [
  "Construa Torres no topo das muralhas.",
  "Construa Fábricas para alimentar as Torres.",
  "Alimente as Fábricas com Extratores no Feudo.",
  "Praças e Edifícios melhoram a produtividade e fornecem recursos.",
  "Clique com o botão DIREITO do mouse para usar habilidade.",
  "Clique e arraste com o botão ESQUERDO para usar o cajado arcano.",
  "Este trabalho é difícil. Boa Sorte.",
];
// A única dica que manda o jogador SAIR do campo de cima. É nela que o anel do botão
// de troca de campo acelera, senão o aviso mais forte apareceria enquanto o texto
// ainda está falando da muralha.
const TIP_FEUD = 2;
// O tempo de leitura acompanha o tamanho da dica: com um valor fixo, "Boa Sorte."
// ficava tanto tempo na tela quanto uma frase de duas linhas.
const TIP_MS_PER_CHAR = 62, TIP_MIN_MS = 2300, TIP_MAX_MS = 3600, TIP_GAP_MS = 550;
const tipHold = (txt) => Math.max(TIP_MIN_MS, Math.min(TIP_MAX_MS, txt.length * TIP_MS_PER_CHAR));
let tutTimer = null;
function stopTutorial() {
  clearTimeout(tutTimer); tutTimer = null;
  $("tutorial-tip").classList.remove("tt-show");
  $("field-toggle").classList.remove("tut-ring", "tut-hot");
}
function runTutorial() {
  stopTutorial();
  const tip = $("tutorial-tip");
  $("field-toggle").classList.add("tut-ring");
  let i = 0;
  const step = () => {
    if (i >= TUTORIAL_TIPS.length) { stopTutorial(); return; }
    $("field-toggle").classList.toggle("tut-hot", i === TIP_FEUD);
    const txt = TUTORIAL_TIPS[i++];
    tip.textContent = txt;
    tip.classList.add("tt-show");
    tutTimer = setTimeout(() => {
      tip.classList.remove("tt-show");
      tutTimer = setTimeout(step, TIP_GAP_MS);
    }, tipHold(txt));
  };
  step();
}
$("pause-tutorial").onclick = () => { closePause(); runTutorial(); };

function setupMenu() {
  const hasSave = !!localStorage.getItem(SAVE_KEY);
  $("btn-continue").disabled = !hasSave;         // Continuar = slot de retomada da última run
  $("btn-load").disabled = loadSlots().length === 0; // Carregar = lista de saves nomeados/autosaves
  if (hasSave) {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      $("menu-note").textContent = `Registro da guarda: dia ${d.day}, muralhas ${d.hits} hit(s).`;
    } catch { /* registro ilegível, segue sem nota */ }
  } else {
    $("menu-note").textContent = "Nenhum registro da guarda encontrado.";
  }
  showScreen("home");
}

// ---------- Roteador da Home ----------
function showScreen(name) {
  document.querySelectorAll("#menu-box .menu-screen").forEach(s => s.classList.add("hidden"));
  const el = $("scr-" + name);
  if (el) el.classList.remove("hidden");
  if (name === "ranking") renderRanking(rankTab);
  if (name === "arsenal") renderArsenal();
  if (name === "miolo") renderMiolo();
  if (name === "conselho") renderConselho();
}

// ---------- A Távola: layout radial com compasso apontando o Lorde ativo ----------
const TARGET_LABEL = { global: "Global", lane: "Lane", point: "Ponto" };
function personSvg(color) {
  return `<svg class="lord-ic" viewBox="0 0 24 24" fill="${color}"><circle cx="12" cy="8" r="4.3"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/></svg>`;
}
let tavolaSel = null; // Lorde mostrado no painel de detalhe
function renderConselho() {
  // Sempre há um Lorde ATIVO (compasso aponta para ele); começa no primeiro
  if (!META.counselor || !COUNCILORS[META.counselor]) { META.counselor = COUNCIL_ORDER[0]; saveMeta(META); }
  if (!tavolaSel || !COUNCILORS[tavolaSel]) tavolaSel = META.counselor;
  $("tavola-help").onclick = openTavolaHelp;
  renderTavolaRing();
  renderTavolaDetail();
}
function openTavolaHelp() {
  openModal("A Távola", (m) => {
    const d = document.createElement("div"); d.className = "panel-hint";
    d.innerHTML = "Jure a UM <b>Lorde</b>: sua habilidade ativa vale em <b>todas as runs</b>. Dispare no campo <b>segurando 2s</b> no ponto (celular ou mouse), gastando 💎. Ideologia igual à da run: <b>−1 💎</b>."
      + "<br><br>🧭 O <b>compasso</b> aponta para o Lorde ativo (o que você jurou)."
      + "<br><br>🤝 <b>Rede:</b> você começa com um Lorde. <b>Jogue com ele até o nível 10</b> (10 usos da habilidade) para o próximo se juntar à Távola.";
    m.appendChild(d);
    const allUnlocked = COUNCIL_ORDER.every(isCouncilUnlocked);
    const dbg = document.createElement("button"); dbg.className = "ars-btn"; dbg.style.marginTop = "12px";
    dbg.textContent = `🐞 debug: desbloquear todos (${councilUnlocked().length}/${COUNCIL_ORDER.length})`;
    dbg.disabled = allUnlocked;
    dbg.onclick = () => { META.council = [...COUNCIL_ORDER]; saveMeta(META); toast("🤝 Todos os Lordes desbloqueados."); closeModal(); renderConselho(); };
    m.appendChild(dbg);
  });
}
function renderTavolaRing() {
  const ring = $("tavola-ring"); ring.innerHTML = "";
  const activeIdx = COUNCIL_ORDER.indexOf(META.counselor);
  const comp = document.createElement("div"); comp.className = "tavola-compass";
  comp.innerHTML = `<svg class="tavola-needle" viewBox="0 0 100 100" style="transform:rotate(${-90 + activeIdx * 45 + 90}deg)">
    <polygon points="50,13 43,53 57,53" fill="#f3ead2"/>
    <polygon points="50,84 45,53 55,53" fill="#c9a227"/>
    <circle cx="50" cy="52" r="4.5" fill="#0a0a0c" stroke="#c9a227" stroke-width="1.6"/></svg>`;
  ring.appendChild(comp);
  COUNCIL_ORDER.forEach((id, i) => {
    const c = COUNCILORS[id], unlocked = isCouncilUnlocked(id);
    const ang = (-90 + i * 45) * Math.PI / 180, R = 39;
    const node = document.createElement("button");
    node.className = "lord-node" + (unlocked ? " unlocked" : " locked") + (META.counselor === id ? " active" : "") + (tavolaSel === id ? " sel" : "");
    node.style.left = (50 + R * Math.cos(ang)) + "%";
    node.style.top = (50 + R * Math.sin(ang)) + "%";
    node.innerHTML = personSvg(unlocked ? LORD_COLOR[id] : "#5a5560");
    node.onclick = () => selectLord(id);
    ring.appendChild(node);
  });
}
function selectLord(id) {
  tavolaSel = id;
  if (isCouncilUnlocked(id)) { META.counselor = id; saveMeta(META); } // jura ao tocar num Lorde liberado
  renderConselho();
}
function renderTavolaDetail() {
  const d = $("tavola-detail");
  const id = tavolaSel, c = COUNCILORS[id], unlocked = isCouncilUnlocked(id);
  const photo = (unlocked && LORD_PHOTO[id]) ? `<img src="${LORD_PHOTO[id]}" alt="">` : personSvg(unlocked ? LORD_COLOR[id] : "#5a5560");
  let body;
  if (unlocked) {
    const lv = councilLv(id);
    body = `<div class="ld-meta">💎 ${c.cost} · ${TARGET_LABEL[c.target]}</div>
      <p class="ld-flavor">${c.flavor}</p>
      <p class="ld-effect">${c.desc}</p>
      <div class="ld-lv">Nível ${Math.min(lv, COUNCIL_LV_MAX)}/${COUNCIL_LV_MAX}${lv >= COUNCIL_LV_MAX ? " · próximo liberado" : ""}
        <div class="ld-bar"><span style="width:${Math.min(100, lv / COUNCIL_LV_MAX * 100)}%"></span></div></div>`;
  } else {
    const prev = COUNCILORS[COUNCIL_ORDER[COUNCIL_ORDER.indexOf(id) - 1]];
    body = `<div class="ld-meta">💎 ${c.cost} · ${TARGET_LABEL[c.target]}</div>
      <p class="ld-flavor ld-locked">🔒 Jogue com ${prev.name} até o nível ${COUNCIL_LV_MAX} para ${c.name} se juntar à Távola.</p>`;
  }
  d.innerHTML = `<div class="ld-photo${unlocked ? "" : " locked"}">${photo}</div>
    <div class="ld-info"><h3 class="ld-name">${unlocked ? c.name : "???"}</h3>${body}</div>`;
}
const LORD_PHOTO = { arqueira: "ICONE-MESTRE-ARQUEIRA.png?v=1" };

// ---------- O Miolo: tech tree persistente ----------
let mioloSel = null;        // nó mostrado no painel de detalhe
let mioloHoldRAF = null;    // "segure para melhorar"
function renderMiolo() {
  if (!mioloSel || !MIOLO[mioloSel]) mioloSel = Object.keys(MIOLO)[0];
  $("miolo-medals").innerHTML = `<span class="med-n">${META.medals}</span><span class="med-badge">M</span>`;
  $("miolo-help").onclick = openMioloHelp;
  renderMioloGrid();
  renderMioloDetail();
}
function openMioloHelp() {
  openModal("O Miolo", (m) => {
    const d = document.createElement("div"); d.className = "panel-hint";
    d.innerHTML = "O coração persistente de Karzstak: melhorias BASE da economia que valem em <b>todas as runs</b>. Toque num selo para ver seus detalhes e <b>segure</b> o botão para gastar 🎖️ <b>Medalhas de Comando</b> e subir de nível.";
    m.appendChild(d);
    const dbg = document.createElement("button"); dbg.className = "ars-btn"; dbg.style.marginTop = "12px";
    dbg.textContent = "🐞 debug: +50 🎖️";
    dbg.onclick = () => { addMedals(50); renderMiolo(); toast("🎖️ +50"); };
    m.appendChild(dbg);
  });
}
function renderMioloGrid() {
  const grid = $("miolo-grid"); grid.innerHTML = "";
  for (const [id, n] of Object.entries(MIOLO)) {
    const lvl = mioloLvl(id);
    const node = document.createElement("button");
    node.className = "miolo-node" + (mioloSel === id ? " sel" : "") + (lvl === 0 ? " lv0" : "");
    node.style.background = n.color;
    node.innerHTML = `<span class="mn-ic">${n.icon}</span>${lvl > 0 ? `<span class="mn-lv">${lvl}</span>` : ""}`;
    node.onclick = () => { mioloSel = id; renderMiolo(); };
    grid.appendChild(node);
  }
}
function renderMioloDetail() {
  const d = $("miolo-detail");
  const id = mioloSel, n = MIOLO[id], lvl = mioloLvl(id), maxed = lvl >= n.max, cost = mioloCost(id);
  const can = !maxed && META.medals >= cost;
  const btn = maxed
    ? `<div class="miolo-buy maxed">Nível máximo</div>`
    : `<button class="miolo-buy${can ? "" : " off"}" id="miolo-buy"><span class="hold-fill"></span><span class="hold-label">${cost} Medalha${cost > 1 ? "s" : ""}</span></button>
       <div class="miolo-buy-sub">${can ? "Segure para melhorar" : "Medalhas insuficientes"}</div>`;
  d.innerHTML = `<div class="ld-head"><h3 class="ld-name">${n.name}</h3><span class="miolo-lvtag">LV. ${lvl}</span></div>
    <p class="ld-flavor">${n.flavor}</p>
    <p class="ld-effect">${n.desc}</p>
    ${btn}`;
  const buy = $("miolo-buy");
  if (buy && can) {
    const start = () => startMioloHold(id, buy);
    const cancel = () => cancelMioloHold(buy);
    buy.addEventListener("pointerdown", (e) => { e.preventDefault(); start(); });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) buy.addEventListener(ev, cancel);
  } else if (buy) {
    buy.addEventListener("pointerdown", () => toast("Sem 🎖️ suficiente."));
  }
}
function startMioloHold(id, buy) {
  cancelMioloHold(buy);
  const fill = buy.querySelector(".hold-fill"), t0 = performance.now(), DUR = 600;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / DUR);
    if (fill) fill.style.width = (p * 100) + "%";
    if (p >= 1) { mioloHoldRAF = null; if (mioloBuy(id)) { toast(`${MIOLO[id].name} melhorado!`); renderMiolo(); } return; }
    mioloHoldRAF = requestAnimationFrame(step);
  };
  mioloHoldRAF = requestAnimationFrame(step);
}
function cancelMioloHold(buy) {
  if (mioloHoldRAF) { cancelAnimationFrame(mioloHoldRAF); mioloHoldRAF = null; }
  if (buy) { const f = buy.querySelector(".hold-fill"); if (f) f.style.width = "0%"; }
}
// ---------- Arsenal (desbloqueios + loadout, paginado: Torres / Edifícios / Praças) ----------
function toggleLoadout(kind, key) {
  if (kind === "buildings" && isFactoryKey(key)) return; // fábricas acompanham as torres automaticamente
  const arr = getLoadout()[kind];
  const i = arr.indexOf(key);
  if (i >= 0) arr.splice(i, 1); else if (arr.length < 5) arr.push(key);
  saveMeta(META);
}
// Lore curta exibida sob o nome de cada item do Arsenal
const ARS_LORE = {
  // Torres — Básicas
  holofote:    "Não fere: aponta. E o que ela aponta, morre.",
  moedor:      "Uma vida moída por vez, e a tropa inteira avança.",
  estoque:     "Caixotes até o teto. As vizinhas nunca ficam secas.",
  besta:       "A primeira arma das ameias, fiel desde o início.",
  catapulta:   "Madeira velha e ódio, desde o primeiro cerco.",
  caldeirao:   "Sopa fervente que ninguém quer provar.",
  tesla:       "Relâmpago engarrafado em bobinas de cobre.",
  canalizador: "Um fio do Turbilhão Narxis corre por este pilar.",
  acido:       "Chuva verde que, juram, não mancha as muralhas.",
  // Torres — Avançadas
  balista:     "Virotes que atravessam três mortos de uma vez.",
  canhao:      "Pólvora e ferro: o rugido que responde à horda.",
  cospefogo:   "Erguido sobre uma forja: o fogo nunca dorme.",
  soprador:    "Inverno em tubos: congela a marcha dos mortos.",
  prisma:      "Talhado de um Coração de Argamato, parte a luz.",
  lancaacido:  "Para a carne que não teme lâminas.",
  // Torres — Icônicas
  mortenegra:  "Dizem que até o rei negativo recua ao seu dobre.",
  apagador:    "Onde dispara, não sobra nada para contar.",
  raiosolar:   "Um pedaço do sol que odeia a noite.",
  ritualcura:  "Cânticos antigos costuram os vivos na batalha.",
  infusor:     "Verte magia pura nas armas vizinhas, gota a gota.",
  // Edifícios
  quartel:     "Aqui o povo vira guarnição das muralhas.",
  cortico:     "O lar possível atrás das muralhas.",
  capela:      "Uma vela por cada tropa que voltou viva.",
  estabulo:    "Cavalos criados no cerco não temem nada.",
  tesouraria:  "Cofres do reino: até o ouro vai à guerra.",
  laboratorio: "Vapores e teorias proibidas: o amanhã às pressas.",
  templo:      "Erguido em lua vermelha; a fé é argamassa.",
  oficina:     "As muralhas se recusam a morrer, tijolo a tijolo.",
  refinaria:   "Tritura Corações de Argamato até restar o brilho.",
  bastiao:     "Do alto do bastião, a artilharia inteira aprende a mirar.",
  // Praças — Distrito do Povo
  praca_publica:    "Feira, fofoca e o censo do que ainda vive.",
  praca_festival:   "Uma noite de música que segura as outras.",
  praca_jardim:     "Flores na guerra: teimosia, e cura.",
  praca_chique:     "Os nobres pagam caro para esquecer o cerco.",
  praca_cerimonial: "Os caídos viram nomes; os nomes, cristal.",
  // Praças — Distrito das Fábricas
  praca_trabalho:   "O sino bate, os turnos trocam, Karzstak não para.",
  praca_vigia:      "Da torre se vê a horda antes de todos.",
  praca_militar:    "Recrutas marcham até o passo virar instinto.",
  praca_abandonada: "Ninguém repara quem entra. Por isso paga bem.",
  praca_estranha:   "As bússolas giram; algo dorme embaixo.",
};
const ARS_PAGES = [
  { kind: "towers",    title: "Escolha suas Torres:" },
  { kind: "buildings", title: "Escolha seus Edifícios:" },
  { kind: "pracas",    title: "Escolha suas Praças:" },
];
let arsPage = 0, arsLastPage = -1;
// Nomes curtos por página, para o aviso de slots incompletos.
const ARS_KIND_LABEL = { towers: "Torres", buildings: "Edifícios", pracas: "Praças" };
// Todos os slots (5 por página) precisam estar preenchidos para jogar.
// Quantos itens estão DISPONÍVEIS (desbloqueados) para escolher em cada página.
// Um jogador novo pode ter menos de 5 (ex.: só 4 edifícios base), então o mínimo
// exigido é min(5, disponíveis) — nunca dá pra travar sem itens suficientes.
function arsAvailable(kind) {
  if (kind === "towers")
    return Object.keys(TOWER_TYPES).filter(k => isUnlocked(k)).length;
  if (kind === "buildings")
    return Object.keys(BUILDINGS).filter(k => !isPraca(k) && !isFactoryKey(k) && isUnlocked(k)).length;
  return Object.keys(BUILDINGS).filter(k => isPraca(k) && (BUILDINGS[k].zones.includes("1") || BUILDINGS[k].zones.includes("2")) && isUnlocked(k)).length;
}
function arsSlotsNeeded(kind) { return Math.min(5, arsAvailable(kind)); }
function loadoutMissing() {
  const lo = getLoadout();
  return ARS_PAGES.filter(p => (lo[p.kind] || []).length < arsSlotsNeeded(p.kind)).map(p => ARS_KIND_LABEL[p.kind]);
}
// texto de traço da torre (mesmo do menu de construção)
function towerTrait(tt) {
  return tt.support === "spot" ? "acende uma lane: +30% de dano, +15% de crítico e tiro mais rápido ali" :
    tt.support === "grind" ? `sacrifica 1 tropa a cada ${GRIND_EVERY}s: +${Math.round(GRIND_MULT*100)}% para as tropas por ${GRIND_DUR}s` :
    tt.support === "heal" ? "cura passiva das tropas" :
    tt.support === "buff" ? "fortalece as tropas" :
    tt.support === "mage" ? "rompe selos e reforça tropas" :
    tt.support === "charm" ? "vira inimigos contra os seus" :
    tt.support === "depot" ? `guarda ${DEPOT_CAP_BASE} de munição (até ${DEPOT_TYPES} tipos) e reabastece as torres vizinhas a cada ${DEPOT_FEED_SEC}s: +${Math.round(DEPOT_RATE*100)}% de cadência e +${Math.round(DEPOT_SAVE*100)}% de munição poupada nelas` :
    tt.boomerang ? "bumerangue atravessa a lane" :
    tt.pierce >= 99 ? "atravessa toda a lane" :
    tt.pierce ? `perfura ${tt.pierce} atrás` :
    tt.chain ? `cadeia em ${tt.chain} inimigos` :
    tt.magic ? "ignora resistências" :
    tt.slow ? "congela os inimigos" :
    tt.aoe ? "dano em área" :
    tt.range < 1 ? "curto alcance, forte" : "tiro único";
}
function arsCard(key, d, kind) {
  const unlocked = isUnlocked(key);
  const chosen = inLoadout(kind === "pracas" ? "buildings" : kind, key) && (kind !== "buildings" || !isFactoryKey(key));
  const isTower = kind === "towers";
  let side, desc, extra = "";
  if (isTower) {
    const ammoTxt = d.fuel
      ? `${FUEL_ICON[d.fuel.k]} ${FUEL_LABEL[d.fuel.k]} ×${d.fuel.cost} (do estoque do reino)`
      : d.ammos.map(a => `${AMMO[a].icon} ${AMMO[a].name}`).join(" + ");
    side = `<div class="ars-side-box"><span class="ars-side-lbl">Custo:</span><span class="ars-side-big">${d.cost}g</span></div>`
      + `<div class="ars-side-box"><span class="ars-side-lbl">${d.dmg > 0 ? "Dano Base:" : "Suporte"}</span>${d.dmg > 0 ? `<span class="ars-side-big">${d.dmg}</span>` : ""}</div>`;
    desc = towerTrait(d);
    extra = `<p class="ars-card-desc">◆ usa ${ammoTxt}</p>`;
  } else {
    const min = d.shape.length;
    side = `<div class="ars-side-box"><span class="ars-side-lbl">Custo/bloco:</span><span class="ars-side-big">${d.cost}g</span></div>`
      + `<div class="ars-side-box"><span class="ars-side-big">${min}</span><span class="ars-side-lbl">bloco${min > 1 ? "s" : ""} mín.</span></div>`;
    desc = d.desc || "";
  }
  const lockOverlay = !unlocked
    ? `<button class="ars-unlock" data-unlock="${key}" ${META.medals < (d.medalCost || 0) ? "disabled" : ""}>DESBLOQUEAR<span>🎖️ ${d.medalCost} MEDALHAS</span></button>`
    : "";
  const el = document.createElement("div");
  el.className = "ars-card" + (chosen ? " on" : "") + (!unlocked ? " locked" : "");
  el.innerHTML = `
    <div class="ars-card-main">
      <div class="ars-card-title"><span class="ars-card-ic">${d.icon}</span><b>${d.name}</b></div>
      ${ARS_LORE[key] ? `<p class="ars-card-lore">${ARS_LORE[key]}</p>` : ""}
      <p class="ars-card-desc">◆ ${desc}</p>${extra}
    </div>
    <div class="ars-card-side">${side}</div>${lockOverlay}`;
  if (unlocked) el.onclick = () => { toggleLoadout(kind === "pracas" ? "pracas" : kind, key); renderArsenal(); };
  return el;
}
function updateArsMore() {
  const b = $("arsenal-body");
  $("ars-more").classList.toggle("hidden", b.scrollHeight - b.scrollTop - b.clientHeight < 24);
}
function renderArsenal() {
  $("arsenal-medals").innerHTML = `<span class="med-n">${META.medals}</span><span class="med-badge">M</span>`;
  const lo = getLoadout();
  const page = ARS_PAGES[arsPage];
  // preserva a rolagem ao selecionar (só volta ao topo quando troca de página)
  const keepScroll = arsLastPage === arsPage;
  const prevScroll = $("arsenal-body").scrollTop;
  $("ars-page-title").textContent = page.title;
  // losangos: slots preenchidos do loadout da página
  const filled = lo[page.kind].length;
  const slots = Math.max(filled, arsSlotsNeeded(page.kind)); // nunca menos do que já foi escolhido
  $("ars-slots").innerHTML = Array.from({ length: slots }, (_, i) => `<span class="ars-diamond${i < filled ? " on" : ""}"></span>`).join("");
  const body = $("arsenal-body"); body.innerHTML = "";
  const header = (txt) => {
    const h = document.createElement("div"); h.className = "ars-section";
    h.innerHTML = `<span class="ars-section-ic">🏰</span><span class="ars-section-t">${txt}</span>`;
    body.appendChild(h);
  };
  if (page.kind === "towers") {
    for (const tier of ["basic", "adv", "legend"]) {
      header(TIER_META[tier]);
      for (const key of Object.keys(TOWER_TYPES).filter(k => TOWER_TYPES[k].tier === tier))
        body.appendChild(arsCard(key, TOWER_TYPES[key], "towers"));
    }
    const note = document.createElement("p"); note.className = "ars-note";
    note.textContent = "Todas as fábricas ficam liberadas na Cidade: erga a que a sua munição pedir.";
    body.appendChild(note);
  } else if (page.kind === "buildings") {
    for (const key of Object.keys(BUILDINGS).filter(k => !isPraca(k) && !isFactoryKey(k)))
      body.appendChild(arsCard(key, BUILDINGS[key], "buildings"));
  } else {
    header("Distrito do Povo");
    for (const key of Object.keys(BUILDINGS).filter(k => isPraca(k) && BUILDINGS[k].zones.includes("1")))
      body.appendChild(arsCard(key, BUILDINGS[key], "pracas"));
    header("Distrito das Fábricas");
    for (const key of Object.keys(BUILDINGS).filter(k => isPraca(k) && BUILDINGS[k].zones.includes("2")))
      body.appendChild(arsCard(key, BUILDINGS[key], "pracas"));
  }
  body.querySelectorAll("[data-unlock]").forEach(b => b.onclick = (ev) => {
    ev.stopPropagation();
    if (unlockItem(b.dataset.unlock)) renderArsenal();
  });
  // debug (no rodapé da lista)
  const dbg = document.createElement("button"); dbg.className = "ars-dbg";
  dbg.textContent = "DEBUG: ADICIONAR MEDALHAS";
  dbg.onclick = () => { addMedals(50); renderArsenal(); };
  body.appendChild(dbg);
  body.scrollTop = keepScroll ? prevScroll : 0;
  arsLastPage = arsPage;
  updateArsMore();
}
$("arsenal-body").onscroll = updateArsMore;
$("ars-prev").onclick = () => { arsPage = (arsPage + ARS_PAGES.length - 1) % ARS_PAGES.length; renderArsenal(); };
$("ars-next").onclick = () => { arsPage = (arsPage + 1) % ARS_PAGES.length; renderArsenal(); };
document.querySelectorAll("#menu [data-scr]").forEach(b => {
  b.addEventListener("click", () => showScreen(b.dataset.scr));
});

// ---------- Ranking (sessão + global ilustrativo; persistência real: Fase 8) ----------
const sessionRanking = [];
const FAKE_GLOBAL = [
  { n: "Comandante Vhalor", s: 6120 },
  { n: "Sor Andria de Ferro", s: 5340 },
  { n: "O Corvo de Karzstak", s: 4990 },
  { n: "Mestre Bittor", s: 4270 },
  { n: "Dama Selvha", s: 3810 },
  { n: "Grão-Vigia Orl", s: 3200 },
  { n: "Irmã Câneo", s: 2680 },
  { n: "Recruta Tam", s: 1450 },
];
let rankTab = "global";
function renderRanking(tab) {
  rankTab = tab;
  document.querySelectorAll("#scr-ranking .rank-tab").forEach(t => t.classList.toggle("active", t.dataset.rank === tab));
  const list = $("rank-list");
  list.innerHTML = "";
  const data = tab === "global" ? FAKE_GLOBAL : META.ranking.slice().sort((a, b) => b.s - a.s);
  if (!data.length) {
    const li = document.createElement("li");
    li.className = "rank-empty";
    li.textContent = "Nenhuma run registrada ainda.";
    list.appendChild(li);
    return;
  }
  data.forEach((e, i) => {
    const li = document.createElement("li");
    if (e.me) li.classList.add("me");
    li.innerHTML = `<span class="rk">${i + 1}</span><span class="rn">${e.n}</span><span class="rs">${e.s}</span>`;
    list.appendChild(li);
  });
}
document.querySelectorAll("#scr-ranking .rank-tab").forEach(t => {
  t.addEventListener("click", () => renderRanking(t.dataset.rank));
});

// ---------- Facções & Rivalidades (info) ----------
function rivalPreview(k) {
  if (isOutcast(k)) {
    const f = FACTIONS[k];
    return `<b>${facIc(k)} ${f.name}</b> são odiados por TODOS: sofrem todas as penalidades, e não impõem penalidade a ninguém.`;
  }
  const r = FACTIONS[RIVAL[k]];
  return `Oposição: <b>${facIc(RIVAL[k])} ${r.name}</b> · penalidade: ${DEBUFF_BY_CHOICE[k]}`;
}
function openFactionInfo() {
  openModal("🎌 Ideologias & Oposições", (m) => {
    const hint = document.createElement("div"); hint.className = "panel-hint";
    hint.textContent = "Escolha 1 ideologia: ganha o bônus dela e sofre a versão negativa do efeito da ideologia de oposição.";
    m.appendChild(hint);
    for (const k of ["red", "yellow", "blue", "pink"]) {
      const f = FACTIONS[k], r = FACTIONS[RIVAL[k]];
      const d = document.createElement("div"); d.className = "wave-row";
      d.innerHTML = `<span class="wicon">${facIc(k)}</span><span class="wname"><b>${f.name}</b>: ${f.desc}<br><span class="cmb-desc">Odeia ${facIc(RIVAL[k])} ${r.name} → ${DEBUFF_BY_CHOICE[k]}</span></span>`;
      m.appendChild(d);
    }
    for (const k of OUTCAST) {
      const p = FACTIONS[k], dp = document.createElement("div"); dp.className = "wave-row";
      const how = facUnlocked(k) ? "Desbloqueada." : p.dlc ? "DLC: bloqueada." : "Jogue para desbloquear.";
      dp.innerHTML = `<span class="wicon">${facIc(k)}</span><span class="wname"><b>${p.name}</b>: ${p.desc}<br><span class="cmb-desc">Odiada por todas: sofre todas as penalidades e não pune ninguém. ${how}</span></span>`;
      m.appendChild(dp);
    }
  });
}

// ---------- Tela de escolha de Facção (início da run) ----------
function showFactionChoose(onConfirm) {
  const box = $("factions-box");
  let chosen = null;
  const avail = Object.keys(FACTIONS);
  // Easter egg do MVP: martelar 30× seguidas no card travado dos Verdes libera a
  // ideologia. Qualquer toque em outro card zera a contagem.
  const GREEN_TAPS = 30;
  let greenTaps = 0;
  function tapGreen(card) {
    greenTaps++;
    card.classList.remove("tapped"); void card.offsetWidth; card.classList.add("tapped");
    if (greenTaps < GREEN_TAPS) return;
    greenTaps = 0;
    unlockGreen();
    facToast("Calma! Vai quebrar?");
    chosen = "green";
    render();
  }
  function facToast(txt) {
    const t = document.createElement("div");
    t.className = "fac-toast";
    t.textContent = txt;
    $("factions").appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function render() {
    box.innerHTML = "";
    box.insertAdjacentHTML("beforeend", `<div class="laws-top fac-top"><button class="tavola-round tavola-back" id="fac-back">‹</button><button class="tavola-round" id="fac-help" title="Ideologias e oposições">?</button></div><h2 class="tavola-title fac-title"><span class="tt-a">— ESCOLHA SEU —</span><span class="tt-main">JURAMENTO</span></h2><p class="fac-sub">Jure sua lealdade para uma ideologia, sua oposição irá aplicar uma penalidade.</p>`);
    box.querySelector("#fac-help").onclick = openFactionInfo;
    box.querySelector("#fac-back").onclick = () => { $("factions").classList.add("hidden"); setupMenu(); $("menu").classList.remove("hidden"); };
    const grid = document.createElement("div"); grid.className = "fac-grid";
    for (const k of avail) {
      const f = FACTIONS[k];
      const locked = f.secret && !facUnlocked(k);
      const card = document.createElement("button");
      card.className = "fac-card" + (chosen === k ? " sel" : "") + (locked ? " locked" : "") + (f.dlc ? " dlc" : "");
      card.style.setProperty("--fc", f.color);
      // Roxos/Verdes: tema e habilidade REVELADOS mesmo travados (mas não desbloqueia).
      const lockNote = locked ? `<span class="fac-lock">🔒 ${f.dlc ? "DLC" : "Secreta"}</span>` : "";
      card.innerHTML = `<span class="fac-ic">${facIc(k)}</span><span class="fac-name">${f.name}</span><span class="fac-tag">${f.tag}</span><span class="fac-flavor">${f.flavor}</span><span class="fac-desc">${f.desc}</span>${lockNote}`;
      if (!locked) card.onclick = () => { greenTaps = 0; chosen = (chosen === k ? null : k); render(); };
      // Os Verdes travados: 30 toques SEGUIDOS liberam a ideologia no MVP.
      else if (k === "green") card.onclick = () => tapGreen(card);
      grid.appendChild(card);
    }
    box.appendChild(grid);
    const prev = document.createElement("div"); prev.className = "fac-combo";
    prev.innerHTML = chosen ? rivalPreview(chosen) : "";
    box.appendChild(prev);
    const actions = document.createElement("div"); actions.className = "fac-actions";
    const go = document.createElement("button"); go.className = "menu-btn oath-hold"; go.disabled = !chosen;
    go.innerHTML = `<span class="oath-fill"></span><span class="oath-label">Karzstak não deve cair</span>`;
    // Segure por 1s para jurar.
    let holdT = null;
    const stopHold = () => { go.classList.remove("holding"); clearTimeout(holdT); holdT = null; };
    const startHold = (e) => {
      if (go.disabled || holdT) return;
      e.preventDefault();
      go.classList.add("holding");
      holdT = setTimeout(() => {
        stopHold();
        go.classList.add("sworn");
        setTimeout(() => { $("factions").classList.add("hidden"); onConfirm(chosen); }, 260);
      }, 1000);
    };
    go.addEventListener("pointerdown", startHold);
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => go.addEventListener(ev, stopHold));
    actions.append(go);
    box.appendChild(actions);
  }
  render();
  $("factions").classList.remove("hidden");
}

$("btn-infinito").onclick = () => {
  const missing = loadoutMissing();
  if (missing.length) {
    toast(`⚠ Preencha os 5 slots do Arsenal antes de jogar (faltam: ${missing.join(", ")}).`);
    showScreen("arsenal");
    // abre direto na primeira página que ainda tem slot vazio
    const idx = ARS_PAGES.findIndex(p => (getLoadout()[p.kind] || []).length < arsSlotsNeeded(p.kind));
    if (idx >= 0) { arsPage = idx; renderArsenal(); }
    return;
  }
  resetGame();
  nextFieldVariant();   // partida nova pisa no próximo desenho do terreno
  $("menu").classList.add("hidden");
  showFactionChoose((pick) => {
    S.factions = [pick];
    S.hits = maxHits();       // aplica o bônus/penalidade da muralha já no início
    applyFactionTint();
    // Evento obrigatório do dia 1: aplica o buff e anuncia depois do tutorial.
    applyDailyEvent(DAY1_EVENT);
    S.moraleLocked = moraleTier(S.morale);
    renderAll();
    showOverlaySeq([
      ["O Decreto", LORE_DECREE],
      ["O que Sobrou do Mundo", LORE_WORLD],
      [`Setor ${formatSectorId(S.sectorId)} · Muralha ${S.sectorDir}`, LORE_COMMAND],
    ], () => {
      // O evento do dia 1 nunca é pulado: ele explica o modificador já aplicado.
      // Fechado ele, o tutorial roda SOBRE o campo, com o jogo já à vista.
      // Pelo showDailyEvent para o evento do dia 1 ter a MESMA régua e as mesmas fichas
      // dos outros dias. Sem income: no dia 1 o conselho ainda não pagou nada.
      showDailyEvent(DAY1_EVENT, null, runTutorial);
    });
  });
};
$("btn-continue").onclick = () => {
  if (!loadGame()) return;
  renderAll();
  $("menu").classList.add("hidden");
};
$("btn-load").onclick = () => {
  openSavesList(() => { renderAll(); $("menu").classList.add("hidden"); });
};
// ---------- Reset total (rodapé da home) ----------
// Apaga SÓ as chaves deste jogo, uma por uma. localStorage.clear() seria mais curto e
// erraria feio: no GitHub Pages todos os projetos da conta dividem o mesmo domínio, e o
// clear levaria junto o que qualquer outro deles tivesse guardado.
function wipeAllProgress() {
  const keys = [META_KEY, SETTINGS_KEY, FAV_KEY, SAVE_KEY, SAVES_KEY];
  for (const s of loadSlots()) keys.push(slotDataKey(s.id));
  for (const k of keys) { try { localStorage.removeItem(k); } catch { /* storage bloqueado */ } }
  // Varredura dos slots órfãos: se o índice se perdeu antes, os dados dele continuariam
  // ocupando espaço e reapareceriam num "Carregar Jogo" futuro.
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("mknf-slot-")) localStorage.removeItem(k);
    }
  } catch { /* storage bloqueado */ }
  location.reload();
}
$("home-reset").onclick = () => {
  openModal("⚠ Apagar tudo", (m) => {
    const d = document.createElement("div");
    d.className = "reset-warn";
    d.innerHTML = "Isto zera o jogo por completo e <b>não tem volta</b>. Você vai perder:"
      + `<ul class="reset-list">`
      + `<li>🎖️ Medalhas (${META.medals || 0}) e tudo que foi desbloqueado no Arsenal</li>`
      + `<li>Níveis do Miolo e o progresso da Távola</li>`
      + `<li>O Ranking e as partidas salvas</li>`
      + `<li>Os resultados já descobertos nas Alianças</li>`
      + `<li>Configurações</li>`
      + `</ul>`;
    const acts = document.createElement("div");
    acts.className = "reset-actions";
    const no = document.createElement("button");
    no.className = "reset-btn"; no.textContent = "Cancelar";
    no.onclick = closeModal;
    const yes = document.createElement("button");
    yes.className = "reset-btn danger"; yes.textContent = "Apagar tudo";
    yes.onclick = wipeAllProgress;
    acts.append(no, yes);
    m.append(d, acts);
  });
};

// ---------- Atalhos de teclado (desktop) ----------
// Espaço = passar turno · 1–5 = portão · Esc = fecha o que estiver aberto (ou abre Configurações).
function isTyping(el) {
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}
addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  const modal   = !$("modal").classList.contains("hidden");
  const overlay = !$("overlay").classList.contains("hidden");
  const paused  = !$("pause").classList.contains("hidden");

  if (e.key === "Escape") {
    e.preventDefault();
    if (overlay) return;                     // a abertura e os eventos do dia se leem até o fim
    if (modal) { closeModal(); return; }
    if (paused) { closePause(); return; }
    if (!menusOpen()) openPause();
    return;
  }
  if (modal || overlay || paused || menusOpen()) return; // resto só vale com o campo à mostra

  if (e.code === "Space") {
    e.preventDefault();                      // senão a barra rola a página
    if (!$("btn-wave").disabled) $("btn-wave").click();
    return;
  }
  if (e.key >= "1" && e.key <= String(LANES)) onTowerClick(+e.key - 1);
});

// ---------- Início ----------
initCity();
buildNextWave();
resizeCanvas();
renderAll();
setupMenu();
lastT = performance.now();
setInterval(feudBeltTick, 750); // fluxo cosmético de recursos até o Centro de Distribuição do Feudo
requestAnimationFrame(frame);
// Voltando de uma aba oculta o rAF fica parado: rebase o relógio p/ não engolir um dt gigante.
addEventListener("visibilitychange", () => { if (!document.hidden) lastT = performance.now(); });
