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
const EVENTS = [
  // ===== POSITIVOS (20) =====
  { id: "p1",  ic: "🌾", ty: "pos", t: "Colheita Abençoada", s: "Os campos internos renderam além do esperado. Os cofres da guarda agradecem.", e: { gold: 35, morale: 8 } },
  { id: "p2",  ic: "🔨", ty: "pos", t: "Mutirão da Muralha", s: "Pedreiros voluntários trabalharam a noite toda reforçando as brechas.", e: { hits: 2, morale: 6 } },
  { id: "p3",  ic: "💎", ty: "pos", t: "Veio de Argamato", s: "Mineiros encontraram um bolsão de cristais intactos sob o distrito.", e: { hearts: 6, morale: 6 } },
  { id: "p4",  ic: "🎺", ty: "pos", t: "Notícia da Frente Norte", s: "Um setor vizinho resistiu. O moral dispara em toda a muralha.", e: { morale: 18 } },
  { id: "p5",  ic: "🏹", ty: "pos", t: "Carregamento de Virotes", s: "Uma carroça de munição chegou dos arsenais reais.", e: { gold: 20, mods: { prod: 1.25 } } },
  { id: "p6",  ic: "⚙️", ty: "pos", t: "Engrenagens Novas", s: "Um engenheiro ajustou as fábricas. Hoje elas cantam.", e: { mods: { prod: 1.35 }, morale: 5 } },
  { id: "p7",  ic: "🔥", ty: "pos", t: "Fervor no Muro", s: "Os soldados amanheceram inspirados. Suas armas parecem mais certeiras.", e: { mods: { towerDmg: 1.3 }, morale: 5 } },
  { id: "p8",  ic: "🪙", ty: "pos", t: "Mercadores Gratos", s: "Comerciantes salvos por sua muralha retribuem com ouro.", e: { gold: 45 } },
  { id: "p9",  ic: "🕊️", ty: "pos", t: "Manhã Silenciosa", s: "Por algum motivo, os mortos hesitam. O vigia enxerga mais longe.", e: { mods: { warn: 2 }, morale: 6 } },
  { id: "p10", ic: "🍞", ty: "pos", t: "Rações Extras", s: "O conselho liberou os estoques. Ninguém luta de barriga vazia.", e: { gold: 15, morale: 10 } },
  { id: "p11", ic: "🛡️", ty: "pos", t: "Reforços do Interior", s: "Um pelotão da guarda real reforça a linha por hoje.", e: { mods: { enemyDmg: 0.8 }, morale: 6 } },
  { id: "p12", ic: "💰", ty: "pos", t: "Dízimo de Guerra", s: "As paróquias arrecadaram para a defesa do setor.", e: { gold: 30, hearts: 2 } },
  { id: "p13", ic: "🌟", ty: "pos", t: "Bênção do Cristal", s: "O Turbilhão Nexus pulsa forte hoje. A cidade inteira sente.", e: { morale: 14, hits: 1 } },
  { id: "p14", ic: "🧰", ty: "pos", t: "Peças Sobressalentes", s: "Recuperaram material de um posto abandonado.", e: { gold: 25, mods: { prod: 1.2 } } },
  { id: "p15", ic: "🎯", ty: "pos", t: "Treino da Aurora", s: "Os artilheiros treinaram ao amanhecer. A mira está afiada.", e: { mods: { towerDmg: 1.2 }, morale: 4 } },
  { id: "p16", ic: "🐴", ty: "pos", t: "Cavalaria de Passagem", s: "Cavaleiros a caminho de outro setor deixam suprimentos.", e: { gold: 22, hearts: 3 } },
  { id: "p17", ic: "🌙", ty: "pos", t: "Presságio Favorável", s: "Os astros sorriem. Dizem que hoje a sorte está do seu lado.", e: { morale: 12 } },
  { id: "p18", ic: "🔮", ty: "pos", t: "Visão do Vidente", s: "Um oráculo previu as investidas. O vigia ganha tempo precioso.", e: { mods: { warn: 3 } } },
  { id: "p19", ic: "🏰", ty: "pos", t: "Ordem do Rei", s: "O soberano cita seu setor como exemplo. A tropa se enche de orgulho.", e: { morale: 16, gold: 10 } },
  { id: "p20", ic: "❤️", ty: "pos", t: "Filhos da Muralha", s: "As crianças do distrito trouxeram água e canções aos soldados.", e: { morale: 11, hits: 1 } },
  // ===== NEGATIVOS (10) =====
  { id: "n1",  ic: "🩸", ty: "neg", t: "Baixas na Noite", s: "Alguns guardas não voltaram da última investida. O luto pesa.", e: { morale: -12 } },
  { id: "n2",  ic: "🕳️", ty: "neg", t: "Brecha no Alicerce", s: "Uma fenda se abriu na base da muralha durante a madrugada.", e: { hits: -1, morale: -6 } },
  { id: "n3",  ic: "💸", ty: "neg", t: "Cofre Saqueado", s: "Desertores levaram parte do ouro do setor ao fugir.", e: { gold: -30, morale: -6 } },
  { id: "n4",  ic: "🌧️", ty: "neg", t: "Tempestade de Cinzas", s: "A poeira dos mortos entope as engrenagens. As fábricas engasgam.", e: { mods: { prod: 0.7 } } },
  { id: "n5",  ic: "😨", ty: "neg", t: "Boatos de Queda", s: "Espalharam que a muralha vizinha caiu. O medo se alastra.", e: { morale: -16 } },
  { id: "n6",  ic: "🦠", ty: "neg", t: "Febre no Distrito", s: "Uma doença varre os alojamentos. Menos mãos para trabalhar.", e: { mods: { prod: 0.8 }, morale: -6 } },
  { id: "n7",  ic: "🌫️", ty: "neg", t: "Neblina Cega", s: "Uma névoa densa encobre o horizonte. O vigia mal enxerga.", e: { mods: { warn: -1.5 } } },
  { id: "n8",  ic: "⚰️", ty: "neg", t: "Deserção", s: "Parte da guarnição fugiu na calada. A linha está mais fraca hoje.", e: { mods: { enemyDmg: 1.2 }, morale: -8 } },
  { id: "n9",  ic: "🥀", ty: "neg", t: "Racionamento", s: "Os estoques minguam. O conselho corta as verbas do setor.", e: { gold: -20, morale: -8 } },
  { id: "n10", ic: "🌑", ty: "neg", t: "Presságio Sombrio", s: "Corvos rodeiam a muralha. Ninguém dorme direito.", e: { morale: -14 } },
  // ===== CAÓTICOS (5) =====
  { id: "c1",  ic: "⚔️", ty: "cha", t: "Fúria dos Mortos", s: "Algo os enlouquece: hoje a horda avança mais rápido, mas você jurou vingança (moral em alta).", e: { mods: { enemySpd: 1.3 }, morale: 12 } },
  { id: "c2",  ic: "🛢️", ty: "cha", t: "Munição Instável", s: "Um lote defeituoso chegou: as torres batem MUITO mais forte, mas gastam o dobro de munição.", e: { mods: { towerDmg: 1.6, ammoCost: 2 } } },
  { id: "c3",  ic: "🐗", ty: "cha", t: "Marcha Blindada", s: "Só os mais couraçados vieram hoje: todos os mortos chegam com armadura.", e: { mods: { allArmored: true }, gold: 20 } },
  { id: "c4",  ic: "🎲", ty: "cha", t: "Feira do Conde", s: "O Conde dos Ratos abre seu mercado: ouro farto hoje, mas as fábricas rendem menos.", e: { gold: 60, mods: { prod: 0.6 } } },
  { id: "c5",  ic: "💥", ty: "cha", t: "Sobrecarga do Nexus", s: "O cristal transborda: produção turbinada, mas a muralha racha com a energia.", e: { mods: { prod: 1.8 }, hits: -1 } },
];
// Evento FIXO ao amanhecer do dia 11: chegam os mortos antigos, o saque despenca.
// Evento OBRIGATÓRIO do dia 1: começa a run com um empurrão nas torres.
const DAY1_EVENT = { id: "cafecomleite", ic: "☕", ty: "pos", t: "Café com Leite",
  s: "A primeira manhã na muralha começa com café quente e leite fresco das últimas cabras do reino. Os artilheiros acordam animados: a mira nunca esteve tão firme.",
  e: { mods: { towerDmg: 1.5 } } };
const ELDERS_EVENT = { id: "elders", ic: "🦴", ty: "neg", t: "Os Mortos Antigos",
  s: "Os recém-tombados, ainda cheios de bolsas e relíquias, já foram todos derrubados. Agora sobem das criptas os mortos ANTIGOS — ossos secos, sem nada de valor. O saque por criatura despenca daqui em diante.",
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
function pickDailyEvent() {
  const pool = EVENTS.filter(e => e.id !== S.lastEvent);
  return pool[Math.floor(Math.random() * pool.length)];
}
function applyDailyEvent(ev) {
  let e = ev.e;
  // Voz do Povo (L5): eventos negativos têm o efeito numérico reduzido pela metade
  if (ev.ty === "neg" && law("L5")) {
    e = { ...e };
    for (const k of ["gold", "hearts", "hits", "morale"]) if (typeof e[k] === "number") e[k] = Math.round(e[k] / 2);
  }
  if (e.gold) S.gold = Math.max(0, S.gold + e.gold);
  if (e.hearts) S.hearts = Math.max(0, S.hearts + e.hearts);
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
  blue:   { ic: "🔵", name: "Os Azuis",     tag: "Esforço de Guerra",      flavor: "Ciência é Progresso.",          color: "#2f6fd6", desc: "+15% de produção das fábricas." },
  yellow: { ic: "🟡", name: "Os Amarelos",  tag: "A Igreja do Amanhecer",  flavor: "Culto ao Deus do Sol.",         color: "#e8b93a", desc: "Ganho de moral (Esperança) +30%." },
  pink:   { ic: "🌸", name: "As Rosas",      tag: "Lealdade pela Rainha",   flavor: "Admiradores da Matrona.",       color: "#d6608f", desc: "+1 hit máximo da muralha." },
  purple: { ic: "🟣", name: "Os Roxos",      tag: "Culto da Lua",           flavor: "Filhos da Magia Negra.",        color: "#a86ae0", desc: "10% dos mortos viram Sombra aliada.", secret: true },
  green:  { ic: "🟢", name: "Os Verdes",      tag: "Povos Mágicos",          flavor: "Refugiados das florestas antigas.", color: "#4cae6a", desc: "Tropas se regeneram a cada turno.", secret: true, dlc: true },
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
const META_DEFAULTS = { purple: false, green: false, medals: 0, unlocked: [], loadout: null, ranking: [], miolo: {}, counselor: null, council: null, councilLv: {}, brasao: 0 };
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
  feitoria:   { name: "Feitoria Eficiente",      icon: "👷", color: "#e07b2f", max: 3, cost: 5, per: 0.10, desc: "-10% no custo de construir/reconstruir no Feudo por nível",
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
// Vínculo persistente (META.counselor). Dispara por clique-direito / 3-toques. Custa 💎.
// `run(t)` aplica o efeito e retorna false para ABORTAR sem custo (nada a fazer).
// A TÁVOLA: 8 Lordes. Vínculo persistente (META.counselor). Dispara por clique-direito / 3-toques. Custa 💎.
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
  if (!id || !COUNCILORS[id]) { toast("Nenhum Lorde jurado. Abra A Távola no menu."); return; }
  const c = COUNCILORS[id], cost = councilCost(id);
  if (S.hearts < cost) { toast(`Sem 💎 para ${c.name} (custa ${cost}).`); return; }
  if (c.run(t) === false) { toast(`${c.icon} ${c.name}: nada a mirar agora.`); return; }
  S.hearts -= cost;
  renderHUD();
  // Rede: cada uso sobe 1 nível o Lorde ativo; ao chegar ao nível 10 apresenta o próximo.
  (META.councilLv ||= {});
  const lv = Math.min(COUNCIL_LV_MAX, councilLv(id) + 1);
  META.councilLv[id] = lv;
  const nxt = lv >= COUNCIL_LV_MAX ? advanceCouncilNetwork(id) : null;
  saveMeta(META);
  if (nxt) toast(`🤝 ${c.name} (nível ${COUNCIL_LV_MAX}) te apresentou a ${COUNCILORS[nxt].icon} ${COUNCILORS[nxt].name}!`);
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
const DEBUFF_BY_CHOICE = { red: "ganho de moral -30%", yellow: "produção -15%", blue: "-1 hit máximo da muralha", pink: "dano das torres -12%" };
function facTowerMult() {
  const f = curFaction(); let m = 1;
  if (f === "red") m += 0.12;
  if (f === "pink" || isOutcast(f)) m -= 0.12; // penalidade (Rosas rival dos Vermelhos; párias tudo)
  return m;
}
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
  if (f === "pink") b += 1;
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
}
// aplica um ganho de moral já com o bônus dos Amarelos (só para deltas positivos)
function gainMorale(v) { S.morale += v > 0 ? v * facMoraleGainMult() : v; clampMorale(); }

// Cadeia secreta que revela os Roxos (a partir do dia 6)
const DARK_EVENTS = [
  { id: "d1", ic: "🕯️", ty: "neg", t: "Sussurros na Cripta", s: "Vozes emanam das catacumbas sob o distrito. Elas conhecem o seu nome.", e: { morale: -6 } },
  { id: "d2", ic: "📜", ty: "neg", t: "O Grimório Proibido", s: "Um velho necromante deixou um tomo esquecido. Suas páginas prometem poder sobre os mortos.", e: { morale: -6, hearts: 3 } },
  { id: "d3", ic: "🟣", ty: "cha", t: "O Pacto Sombrio", s: "Você sela o pacto. A magia negra dos mortos passa a servir à muralha. Os ROXOS revelam-se, e agora respondem ao seu chamado.", e: {} },
];
function maybeDarkEvent() {
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
// 1 interação por dia (conversar OU pedir OU presentear), só ENTRE turnos.
const FAV_KEY = "mknf-favores";
const FAV_EV_GOAL = 50; // meta exibida no contador de eventos
function loadFavMeta() {
  let m; try { m = JSON.parse(localStorage.getItem(FAV_KEY)) || {}; } catch { m = {}; }
  return Object.assign({ found: {}, evCount: 0 }, m);
}
const FAVMETA = loadFavMeta();
function saveFavMeta() { localStorage.setItem(FAV_KEY, JSON.stringify(FAVMETA)); }
// As alianças só começam a visitar a partir deste dia; a cada dia UM visitante
// fixo aparece (o jogador não escolhe) e só com ele é possível interagir.
const FAV_VISIT_MIN_DAY = 5;
function favDefault() { return { rel: { rei: 50, rainha: 50, conde: 50, povo: 50 }, used: false, last: {}, bag: {}, visitor: null }; }

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
    if (k === "gold") S.gold = Math.max(0, S.gold + v);
    else if (k === "hearts") S.hearts = Math.max(0, S.hearts + v);
    else if (k === "morale") gainMorale(v);
    else if (k === "hits") S.hits = Math.max(1, Math.min(maxHits(), S.hits + v));
    else if (k === "maos") { if (v > 0) addResource("maos", v); else S.maos = Math.max(0, S.maos + v); }
    else { if (v > 0) addResource(k, v); else S.res[k] = Math.max(0, (S.res[k] || 0) + v); }
  }
}

// Personagens: pedidos fixos (3 tamanhos, custo de relação crescente) e
// presentes fixos (o personagem escolhe o que quer). Punição em relação 0.
const FAV_CHARS = {
  rei: {
    art: "O", name: "REI QUE NÃO DORME", sub: "REGENTE DE KARZSTAK", img: "REI-ICONE.png",
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
    art: "A", name: "RAINHA DAS ROSAS", sub: "MATRONA DA CIDADE", img: "RAINHA-ICONE.png",
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
    art: "O", name: "CONDE DOS RATOS", sub: "LORDE DO SUBSOLO", img: "CONDE-ICONE.png",
    punIc: "🐀", punDesc: "Os ratos roem os alicerces: −1 hit da muralha por turno.",
    blessDesc: "Os ratos remendam os alicerces: +1 hit da muralha a cada amanhecer.",
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
    art: "OS", name: "POVOS COMUNS", sub: "ALDEÕES HUMANOS", img: "OS-POVOS-ICONE.png",
    punIc: "🔥", punDesc: "O povo cruza os braços: produção −20% enquanto durar.",
    blessDesc: "O povo trabalha cantando: produção +10% enquanto durar.",
    askIntro: "Você sobe num caixote na praça e pede ajuda ao povo.", askQuote: "O que a muralha precisa de nós?",
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
      c: [{ t: "Eh... Estou de ressaca, minha alteza.", e: { comida: 5 }, rel: -5 },
          { t: "Estou bem! A cidade é mais importante.", e: { bens: 5 }, rel: 6 },
          { t: "Cuida da sua vida, Corôa!", e: { morale: 8 }, rel: -8 }] },
    { id: "r2", s: "O Rei inspeciona a muralha do alto de seu corcel.", q: "Estas rachaduras... são recentes?",
      c: [{ t: "Já mandei reparar, alteza.", e: { hits: 1 }, rel: 6 },
          { t: "A muralha aguenta mais que o senhor.", e: { morale: 6 }, rel: -6 },
          { t: "Preciso de verba para isso.", e: { gold: 30 }, rel: -4 }] },
    { id: "r3", s: "Durante o banquete real, o Rei ergue a taça na sua direção.", q: "Um brinde ao comandante da Muralha Oeste!",
      c: [{ t: "Ao Rei e a Karzstak!", e: { morale: 10 }, rel: 7 },
          { t: "Brindo quando a horda recuar.", e: { bens: 4 }, rel: -3 },
          { t: "Prefiro brindar com os soldados.", e: { morale: 5, comida: 3 }, rel: -5 }] },
    { id: "r4", s: "O Rei recebeu cartas de outros setores pedindo seu remanejamento.", q: "Querem tirá-lo de mim. O que responde?",
      c: [{ t: "Meu posto é aqui, alteza.", e: { morale: 8 }, rel: 8 },
          { t: "Talvez seja hora de subir na vida...", e: { gold: 20 }, rel: -8 },
          { t: "Deixe que decidam as muralhas.", e: { bens: 5 }, rel: 2 }] },
    { id: "r5", s: "O Rei mostra o mapa do reino, coberto de marcadores negros.", q: "Diga-me a verdade: vamos resistir?",
      c: [{ t: "Enquanto eu respirar, sim.", e: { morale: 12 }, rel: 7 },
          { t: "Com mais ouro, sim.", e: { gold: 50 }, rel: -6 },
          { t: "Não sei, alteza.", e: { comida: 4 }, rel: -3 }] },
    { id: "r6", s: "Um mensageiro tropeça e derruba sopa no manto real. O Rei olha para você.", q: "E então? Rimos ou executamos?",
      c: [{ t: "Rimos, majestade. Rimos.", e: { morale: 8 }, rel: 5 },
          { t: "A sopa estava boa, é o que importa.", e: { comida: 5 }, rel: 3 },
          { t: "Executar é desperdício de Mãos.", e: { maos: 1 }, rel: -4 }] },
    { id: "r7", s: "O Rei o convoca à sala do trono vazia, sem guardas.", q: "Se eu cair, quem protege Karzstak?",
      c: [{ t: "O senhor não vai cair.", e: { morale: 6 }, rel: 6 },
          { t: "A muralha protege. Sempre protegeu.", e: { hits: 1 }, rel: 2 },
          { t: "Eu protejo. Com ou sem coroa.", e: { morale: 10 }, rel: -7 }] },
    { id: "r8", s: "O Rei testa uma besta nova no pátio e erra todos os alvos.", q: "O vento, comandante. Foi o vento.",
      c: [{ t: "Claramente o vento, alteza.", e: { gold: 25 }, rel: 5 },
          { t: "Deixe as bestas com os artilheiros.", e: { bens: 4 }, rel: -5 },
          { t: "Quer aulas? Cobro barato.", e: { gold: 15, morale: 4 }, rel: -3 }] },
    { id: "r9", s: "O Rei encontrou seu relatório de baixas rasurado.", q: "Está escondendo números de mim?",
      c: [{ t: "Jamais, alteza. Foi a chuva.", e: { gold: 20 }, rel: -6 },
          { t: "Sim. Para proteger o moral.", e: { morale: 6 }, rel: 4 },
          { t: "Números não seguram muralha.", e: { hits: 1 }, rel: -2 }] },
    { id: "r10", s: "No aniversário da coroação, o Rei distribui presentes à corte.", q: "Para você, comandante... escolha.",
      c: [{ t: "O que sua alteza julgar justo.", e: { gold: 40 }, rel: 6 },
          { t: "Suprimentos para meus homens.", e: { comida: 8, bens: 4 }, rel: 4 },
          { t: "Sua besta de caça. A dourada.", e: { hearts: 3 }, rel: -6 }] },
  ],
  rainha: [
    { id: "q1", s: "Chá da tarde no castelo, a rainha parece furiosa e caminha até você.", q: "Você pisou nas minhas rosas...",
      c: [{ t: "Me desculpe, vossa alteza!", e: { minerio: 5 }, rel: -3 },
          { t: "Oh não! Eu pago pelas flores.", e: { gold: -50 }, rel: 5 },
          { t: "Mas são apenas flores...", e: { morale: 4 }, rel: -8 }] },
    { id: "q2", s: "A Rainha observa a horda do balcão mais alto, impassível.", q: "Eles não me assustam. E a você?",
      c: [{ t: "Todos os dias, majestade.", e: { morale: 4 }, rel: 5 },
          { t: "Medo é para os mortos.", e: { morale: 8 }, rel: 3 },
          { t: "Só me assusta a fatura da guerra.", e: { gold: 25 }, rel: -5 }] },
    { id: "q3", s: "A Rainha organiza um sarau em plena guerra. Você é convidado.", q: "A arte morre quando paramos de dançar. Vem?",
      c: [{ t: "Uma dança, apenas.", e: { morale: 10 }, rel: 6 },
          { t: "Tenho uma muralha para segurar.", e: { hits: 1 }, rel: -6 },
          { t: "Mando meus soldados descansarem lá.", e: { morale: 6, comida: -3 }, rel: 3 }] },
    { id: "q4", s: "Você flagra a Rainha alimentando corvos na torre norte.", q: "Eles contam segredos. Quer ouvir um?",
      c: [{ t: "Sempre, majestade.", e: { hearts: 2 }, rel: 5 },
          { t: "Corvos comem carniça, cuidado.", e: { comida: 4 }, rel: -5 },
          { t: "Segredos custam caro por aqui.", e: { gold: 30 }, rel: -3 }] },
    { id: "q5", s: "A Rainha manda bordar estandartes novos para a guarda.", q: "Vermelho sangue ou dourado sol?",
      c: [{ t: "Dourado. O sol ainda nasce.", e: { morale: 8 }, rel: 5 },
          { t: "Vermelho. Que saibam o preço.", e: { morale: 5 }, rel: 3 },
          { t: "Pano é melhor gasto em bandagens.", e: { bens: 5 }, rel: -6 }] },
    { id: "q6", s: "Uma dama da corte espalhou boatos sobre você. A Rainha ouve tudo.", q: "Devo cortar a língua... do boato, claro.",
      c: [{ t: "Deixe falarem, majestade.", e: { morale: 5 }, rel: 4 },
          { t: "Corte. Com cerimônia.", e: { gold: 15 }, rel: -4 },
          { t: "Boato bom eu mesmo espalho.", e: { morale: 6 }, rel: -6 }] },
    { id: "q7", s: "A Rainha visita os feridos no hospital de campanha sem anunciar.", q: "Eles lutam por você. Por que lutam?",
      c: [{ t: "Pelas famílias atrás da muralha.", e: { morale: 8 }, rel: 6 },
          { t: "Porque eu mando.", e: { maos: 1 }, rel: -7 },
          { t: "Pergunte a eles, majestade.", e: { morale: 4, comida: 3 }, rel: 4 }] },
    { id: "q8", s: "O jardim real amanheceu coberto de cinzas da horda.", q: "Nem minhas rosas escapam. Providências?",
      c: [{ t: "Mando limpar pessoalmente.", e: { maos: -1, morale: 4 }, rel: 7 },
          { t: "Cinza é adubo, majestade.", e: { comida: 6 }, rel: -4 },
          { t: "Rosas de novo...", e: { minerio: 4 }, rel: -8 }] },
    { id: "q9", s: "A Rainha lhe entrega um lenço bordado com o brasão real.", q: "Para a sorte. Ou para o sangue. Veremos.",
      c: [{ t: "Guardarei com honra.", e: { morale: 6 }, rel: 6 },
          { t: "Sorte se compra com aço.", e: { minerio: 5 }, rel: -3 },
          { t: "Vendo por um bom preço...", e: { gold: 45 }, rel: -9 }] },
    { id: "q10", s: "Você a encontra sozinha na capela, de vela acesa.", q: "Reze comigo. Ou apenas fique.",
      c: [{ t: "Fico, majestade.", e: { morale: 8 }, rel: 6 },
          { t: "Rezo pelos que não voltaram.", e: { morale: 5, hearts: 1 }, rel: 4 },
          { t: "Deuses não seguram muralha.", e: { hits: 1 }, rel: -7 }] },
  ],
  conde: [
    { id: "c1", s: "Depois de uma longa noite...comemorando, ele te faz uma proposta indecente:", q: "Quero que case com a minha filha!",
      c: [{ t: "Vai ser uma honra!", e: { comida: 20 }, rel: 6 },
          { t: "Não vai dar... Sou comprometido", e: { maos: 1 }, rel: 2 },
          { t: "Devemos pedir ao Rei primeiro...", e: {}, rel: -5 }] },
    { id: "c2", s: "O Conde surge do esgoto com um mapa rabiscado.", q: "Túnel novo. Passa POR BAIXO da horda. Interessa?",
      c: [{ t: "Quanto custa a passagem?", e: { gold: -30, bens: 10 }, rel: 4 },
          { t: "Isso é traição em potencial.", e: { morale: 4 }, rel: -6 },
          { t: "Interessa. E o mapa também.", e: { combustivel: 6 }, rel: 3 }] },
    { id: "c3", s: "Ele aparece vendendo 'amuletos abençoados' aos seus soldados.", q: "Fé barata, comandante! Quer comissão?",
      c: [{ t: "Metade da banca, e finjo que não vi.", e: { gold: 35 }, rel: 4 },
          { t: "Devolva o ouro deles. AGORA.", e: { morale: 6 }, rel: -7 },
          { t: "Me vê dois. Pra garantir.", e: { gold: -10, morale: 5 }, rel: 3 }] },
    { id: "c4", s: "O Conde oferece um banquete no subsolo. A carne tem procedência duvidosa.", q: "Rato não. Provavelmente. Come?",
      c: [{ t: "Já comi pior na guerra.", e: { comida: 10 }, rel: 6 },
          { t: "Passo. Mas levo pros porcos.", e: { comida: 5 }, rel: -2 },
          { t: "Chamo a inspeção real.", e: { gold: 15 }, rel: -8 }] },
    { id: "c5", s: "Ele sussurra que um capitão seu anda vendendo virotes no mercado negro.", q: "Nomes custam, comandante. Mas hoje tô bonzinho.",
      c: [{ t: "Fale, e fico devendo uma.", e: { bens: 8 }, rel: 4 },
          { t: "Meus capitães são leais. Fora daqui.", e: { morale: 4 }, rel: -6 },
          { t: "Vendendo? Sem me dar comissão?", e: { gold: 25 }, rel: 5 }] },
    { id: "c6", s: "O Conde chega mancando, roupas rasgadas, sorrindo.", q: "Você devia ver o OUTRO. Me esconde por uma noite?",
      c: [{ t: "Uma noite. E some ao amanhecer.", e: { combustivel: 5 }, rel: 6 },
          { t: "O que você aprontou dessa vez?", e: { gold: 20 }, rel: 2 },
          { t: "Guardas! Temos um fugitivo!", e: { morale: 3 }, rel: -9 }] },
    { id: "c7", s: "Ele abre a capa: relíquias de setores caídos, ainda com poeira.", q: "Recém-chegadas. Preço de amigo.",
      c: [{ t: "Isso é saque de mortos...", e: { morale: -3, hearts: 3 }, rel: 2 },
          { t: "Levo tudo. Sem perguntas.", e: { gold: -40, hearts: 5 }, rel: 5 },
          { t: "Devolva às famílias. Já.", e: { morale: 8 }, rel: -6 }] },
    { id: "c8", s: "O Conde aposta que você não acerta uma moeda a cem passos.", q: "Cinquenta moedas. Topa, olho de águia?",
      c: [{ t: "Topo. Mira é meu ofício.", e: { gold: 50 }, rel: 3 },
          { t: "Não aposto com trapaceiro.", e: { bens: 4 }, rel: -4 },
          { t: "Dobro ou nada.", e: { gold: -50, morale: 6 }, rel: 4 }] },
    { id: "c9", s: "Ratos invadiram seus armazéns. O Conde surge... casualmente.", q: "Que coincidência TERRÍVEL. Posso resolver.",
      c: [{ t: "Resolva. E rápido.", e: { gold: -20, comida: 12 }, rel: 3 },
          { t: "Foi você, não foi?", e: { comida: 6 }, rel: -5 },
          { t: "Fico com os ratos. Viram sopa.", e: { comida: 8 }, rel: 4 }] },
    { id: "c10", s: "No fundo do túnel, o Conde mostra um retrato antigo: ele, jovem, de armadura real.", q: "Todo rato já foi soldado, comandante.",
      c: [{ t: "O que aconteceu?", e: { morale: 5 }, rel: 6 },
          { t: "A armadura ainda serve?", e: { maos: 1 }, rel: 4 },
          { t: "Deserção tem cheiro de esgoto mesmo.", e: { gold: 10 }, rel: -8 }] },
  ],
  povo: [
    { id: "p1", s: "Ao passar pelo seu distrito você vê várias pessoas desmaiadas na rua.", q: "Temos... Fooome. Por favor!",
      c: [{ t: "A horda também. Voltem ao trabalho!", e: { morale: 5 }, rel: -8 },
          { t: "Teremos um banquete no fim do expediente", e: { maos: 1 }, rel: 6 },
          { t: "Devemos pedir ao Rei primeiro...", e: {}, rel: -4 }] },
    { id: "p2", s: "Uma multidão se reúne no portão pedindo notícias dos setores vizinhos.", q: "É verdade que o Portão Sul caiu?!",
      c: [{ t: "Mentira. E o Oeste não cai.", e: { morale: 8 }, rel: 4 },
          { t: "Caiu. Por isso treinamos dobrado.", e: { morale: -4, maos: 2 }, rel: 5 },
          { t: "Sem perguntas. Circulando!", e: { bens: 3 }, rel: -7 }] },
    { id: "p3", s: "As crianças do distrito fizeram uma maquete da sua muralha com sucata.", q: "Ficou igualzinha, né, comandante?",
      c: [{ t: "Melhor que a original.", e: { morale: 10 }, rel: 7 },
          { t: "Faltou a torre três. Refaçam.", e: { bens: 4 }, rel: -3 },
          { t: "Contrato os engenheiros mirins.", e: { maos: 1, morale: 5 }, rel: 5 }] },
    { id: "p4", s: "Um ferreiro veterano oferece trabalhar de graça nas torres.", q: "Perdi meu filho pra horda. Deixa eu ajudar.",
      c: [{ t: "Bem-vindo à muralha, mestre.", e: { maos: 2 }, rel: 6 },
          { t: "De graça não. Salário justo.", e: { gold: -20, maos: 2, morale: 5 }, rel: 8 },
          { t: "Velho demais. Vá pra casa.", e: { comida: 3 }, rel: -8 }] },
    { id: "p5", s: "O poço central amanheceu turvo. O povo desconfia de sabotagem.", q: "Tem gosto de ferrugem! Foi a horda?",
      c: [{ t: "Vou investigar pessoalmente.", e: { minerio: 4 }, rel: 5 },
          { t: "É só ferro. Faz bem pro sangue.", e: { morale: 4 }, rel: -5 },
          { t: "Racionem até eu descobrir.", e: { comida: -3, bens: 4 }, rel: -2 }] },
    { id: "p6", s: "Uma senhora te para na rua e enfia um embrulho nas suas mãos.", q: "Pão de fermento natural. Come, tá magro.",
      c: [{ t: "Obrigado, dona. Melhor pão do reino.", e: { comida: 5, morale: 5 }, rel: 6 },
          { t: "Divido com a guarda noturna.", e: { morale: 8 }, rel: 5 },
          { t: "Estou em serviço, senhora.", e: { bens: 2 }, rel: -5 }] },
    { id: "p7", s: "Os taberneiros querem abrir durante a noite, apesar do toque de recolher.", q: "Soldado sedento luta mal, comandante!",
      c: [{ t: "Abram. Primeira rodada é minha.", e: { gold: -15, morale: 10 }, rel: 7 },
          { t: "Fechado. Horda não bebe, nós também não.", e: { bens: 5 }, rel: -6 },
          { t: "Só até a lua alta. E sem cantoria.", e: { gold: 10, morale: 4 }, rel: 3 }] },
    { id: "p8", s: "Um grupo de jovens quer se alistar. Nenhum sabe segurar uma lança.", q: "A gente aprende rápido! Juro!",
      c: [{ t: "Todos pro treino. Amanhã, cedo.", e: { maos: 2 }, rel: 5 },
          { t: "Muralha precisa de braços, não heróis.", e: { maos: 1, bens: 3 }, rel: 3 },
          { t: "Voltem quando crescerem.", e: { morale: 3 }, rel: -6 }] },
    { id: "p9", s: "O mercado improvisou uma feira sob a muralha. Está lotada e barulhenta.", q: "Vida que segue, né, comandante?",
      c: [{ t: "Feira aberta. A vida vence.", e: { gold: 20, morale: 6 }, rel: 6 },
          { t: "Muito exposta. Mudem pra praça.", e: { bens: 5 }, rel: -3 },
          { t: "Cobro taxa de proteção.", e: { gold: 35 }, rel: -8 }] },
    { id: "p10", s: "No fim do turno, o distrito inteiro se reúne para ver o sol se pôr da muralha.", q: "Enquanto o senhor tiver de pé, a gente fica.",
      c: [{ t: "Então ficamos todos.", e: { morale: 12 }, rel: 7 },
          { t: "Subam. A vista é de vocês também.", e: { morale: 8, maos: 1 }, rel: 6 },
          { t: "Dispersar. Isso aqui não é teatro.", e: { bens: 3 }, rel: -7 }] },
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
  $("fav-scr").classList.remove("hidden");
}
function closeFavores() { favView = null; $("fav-scr").classList.add("hidden"); renderAll(); }

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
function favBusyChance(k) { return 0.3 * (1 - favRel(k) / 100); }
function favTryAction(k, mode) {
  if (S.fav.used && !favFreeVisits) { toast("Você já fez sua visita hoje. Volte amanhã."); return; }
  // só é possível tratar com quem está visitando hoje
  if (!favFreeVisits && S.fav.visitor !== k) {
    toast(S.fav.visitor ? `Hoje quem veio foi ${FAV_CHARS[S.fav.visitor].name.split(" ")[0]}.` : `As alianças só recebem você a partir do dia ${FAV_VISIT_MIN_DAY}.`);
    return;
  }
  if (mode === "talk") {
    // só a CONVERSA arrisca encontrar o personagem ocupado (e perder a visita)
    if (Math.random() < favBusyChance(k)) {
      if (!favFreeVisits) { S.fav.used = true; saveGame(); }
      favView = { mode: "busy", chr: k };
      renderFavScr();
      return;
    }
    favView = { mode: "talk", chr: k, ev: favDrawEvent(k), done: null };
  } else {
    favView = { mode, chr: k, done: null };
  }
  renderFavScr();
}

// ---- render ----
// Arco FACETADO (segmentos retos, com losango no ápice) em vez de curva lisa
function favArcPath() {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = Math.PI - (i * Math.PI / 8);
    pts.push([50 - 46 * Math.cos(t), 88 - 78 * Math.sin(t)]);
  }
  let d = "";
  pts.forEach(([x, y], i) => { d += (i ? " L " : "M ") + x.toFixed(1) + " " + y.toFixed(1); });
  // pequenos "pés" retos nas pontas do medidor
  d += " M 4 88 L 4 92 M 96 88 L 96 92";
  return d;
}
function favPortrait(k, extra) {
  const rel = favRel(k);
  const t = (1 - rel / 100) * Math.PI; // rel 100 → esquerda (+), rel 0 → direita (−)
  const hx = 50 - 46 * Math.cos(t), hy = 88 - 78 * Math.sin(t); // % dentro da caixa do arco
  return `<div class="fav-arc${extra || ""}">
    <svg viewBox="0 0 100 92" preserveAspectRatio="none"><path d="${favArcPath()}" fill="none" stroke="rgba(232,201,92,.7)" stroke-width="1.3" stroke-linejoin="miter"/></svg>
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
function renderFavHub(scr) {
  const k = FAV_ORDER[favSel], c = FAV_CHARS[k];
  const prev = FAV_ORDER[(favSel + FAV_ORDER.length - 1) % FAV_ORDER.length];
  const next = FAV_ORDER[(favSel + 1) % FAV_ORDER.length];
  const punWarn = FAV_ORDER.filter(favPun).map(p => `${FAV_CHARS[p].punIc} ${FAV_CHARS[p].punDesc}`).join("<br>");
  // Só é possível interagir com QUEM está visitando hoje (fixo, não escolhido).
  const visitor = S.fav.visitor;
  const isVisitor = visitor === k;
  const interactable = favFreeVisits || (isVisitor && !S.fav.used);
  const actDisabled = interactable ? "" : "disabled";
  const actNote = favFreeVisits ? ""
    : !visitor ? `<div class="fav-used-note">As alianças só recebem você a partir do dia ${FAV_VISIT_MIN_DAY}.</div>`
    : S.fav.used ? `<div class="fav-used-note">Visita de hoje já feita. Volte amanhã.</div>`
    : !isVisitor ? `<div class="fav-used-note">Hoje quem veio foi ${FAV_CHARS[visitor].punIc} ${FAV_CHARS[visitor].name.split(" ")[0]} — só com ${FAV_CHARS[visitor].name.split(" ")[0]} dá pra tratar hoje.</div>`
    : "";
  scr.innerHTML = `
    <div class="laws-top"><button class="tavola-round tavola-back" id="fav-back">‹</button><button class="tavola-round" id="fav-help-btn">?</button></div>
    <h2 class="tavola-title fav-title"><span class="tt-a">— AS —</span><span class="tt-main">ALIANÇAS</span></h2>
    <div id="fav-help" class="hidden"><b>As Alianças</b><p>Quatro figuras de Karzstak podem ajudar (ou atrapalhar) sua muralha. A partir do <b>dia ${FAV_VISIT_MIN_DAY}</b>, <b>um deles visita a muralha por dia</b> (você não escolhe quem) — só com o visitante do dia dá pra tratar, entre os turnos: converse, peça algo ou presenteie.</p><p>Cada escolha muda a <b>relação</b> (0–100%). Relação no chão = <b>punição ativa</b>; relação no máximo = <b>bênção ativa</b>. O que você descobre nas conversas fica lembrado para sempre, entre todas as partidas.</p><button id="fav-dbg">debug: visitas infinitas ${favFreeVisits ? "✅" : "❌"}</button></div>
    <div class="fav-carousel">
      <button class="fav-card fav-side left" data-k="${prev}"><img src="${FAV_CHARS[prev].img}?v=1" alt=""><div class="fav-card-t">-${FAV_CHARS[prev].art}-<br>${FAV_CHARS[prev].name}</div></button>
      <div class="fav-card fav-main"><img src="${c.img}?v=1" alt=""><div class="fav-card-t">-${c.art}-<br><b>${c.name}</b><span>${c.sub}</span></div></div>
      <button class="fav-card fav-side right" data-k="${next}"><img src="${FAV_CHARS[next].img}?v=1" alt=""><div class="fav-card-t">-${FAV_CHARS[next].art}-<br>${FAV_CHARS[next].name}</div></button>
    </div>
    <div class="fav-tier-row"><button id="fav-prev" class="fav-tarrow">‹</button><span class="fav-tier">${favTier(favRel(k), k)} (${favRel(k)}%)</span><button id="fav-next" class="fav-tarrow">›</button></div>
    ${isVisitor && !S.fav.used && !favFreeVisits ? `<div class="fav-visit-banner">🔔 Está te visitando hoje</div>` : ""}
    ${favPun(k) ? `<div class="fav-punish">${c.punIc} PUNIÇÃO ATIVA — ${c.punDesc}</div>` : favBless(k) ? `<div class="fav-bless">${c.punIc} BÊNÇÃO ATIVA — ${c.blessDesc}</div>` : ""}
    <div class="fav-actions${(!interactable) && !favFreeVisits ? " fav-used" : ""}">
      <button class="fav-abtn wide" data-act="talk" ${actDisabled}>🗣 CONVERSAR</button>
      <div class="fav-arow">
        <button class="fav-abtn" data-act="ask" ${actDisabled}>↙ PEDIR ALGO</button>
        <button class="fav-abtn" data-act="gift" ${actDisabled}>↗ PRESENTEAR</button>
      </div>
      ${actNote}
    </div>
    <div class="fav-count">EVENTOS REALIZADOS: ${Math.min(FAVMETA.evCount, FAV_EV_GOAL)}/${FAV_EV_GOAL}</div>
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
    intro = v.ev.s; quote = v.ev.q;
    footer = `${evCountLbl}<br>${Math.min(FAVMETA.evCount, FAV_EV_GOAL)}/${FAV_EV_GOAL}`;
    choices = v.ev.c.map((ch, i) => {
      const key = `${k}:${v.ev.id}:${i}`;
      const known = !!FAVMETA.found[key];
      const fx = known ? favFxText(ch.e) : `<span class="fav-undisc">(+?) NÃO DESCOBERTO.</span>`;
      const badge = known ? (ch.rel >= 0 ? "➕" : "➖") : "❓";
      return `<button class="fav-choice" data-i="${i}">${ch.t} ${fx}<span class="fav-badge">${badge}</span></button>`;
    }).join("");
  } else if (v.mode === "ask") {
    intro = c.askIntro; quote = c.askQuote;
    footer = "PEDIR UM FAVOR · O PEDIDO CUSTA RELAÇÃO";
    choices = c.asks.map((a, i) => {
      const cost = (favRel(k) >= 100 && i === 0) ? 0 : a.rel;
      return `<button class="fav-choice fav-dark" data-i="${i}">➖ ${a.t} ${favFxText(a.e)}<span class="fav-relcost">${cost ? `−${cost}% relação` : "de graça!"}</span></button>`;
    }).join("");
  } else { // gift
    intro = c.giftIntro; quote = c.giftQuote;
    footer = "PRESENTEAR · +6% DE RELAÇÃO";
    choices = c.gifts.map((g, i) => {
      const [rk, rv] = Object.entries(g.cost)[0];
      const meta = rk === "gold" ? { n: "Ouro" } : resMeta(rk);
      const have = rk === "gold" ? S.gold : (rk === "maos" ? S.maos : S.res[rk] || 0);
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
  S.fav.used = !favFreeVisits;
  let msg;
  if (v.mode === "talk") {
    const ch = v.ev.c[i];
    favApplyFx(ch.e);
    favGainRel(k, ch.rel);
    S.fav.last[k] = v.ev.id;
    const key = `${k}:${v.ev.id}:${i}`;
    if (!FAVMETA.found[key]) { FAVMETA.found[key] = true; }
    FAVMETA.evCount++; saveFavMeta();
    msg = `${favFxText(ch.e)} · relação ${ch.rel >= 0 ? "+" : ""}${ch.rel}%`;
  } else if (v.mode === "ask") {
    const a = FAV_CHARS[k].asks[i];
    const cost = (favRel(k) >= 100 && i === 0) ? 0 : a.rel;
    favApplyFx(a.e);
    favGainRel(k, -cost);
    msg = `${favFxText(a.e)} · relação −${cost}%`;
    if (favPun(k)) msg += `<br><span style="color:#e05f5f">${FAV_CHARS[k].punIc} A relação chegou ao fundo: ${FAV_CHARS[k].punDesc}</span>`;
  } else { // gift
    const g = FAV_CHARS[k].gifts[i];
    const [rk, rv] = Object.entries(g.cost)[0];
    if (rk === "gold") S.gold -= rv; else if (rk === "maos") S.maos -= rv; else S.res[rk] -= rv;
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
function favVisitPending() { return !!S.fav && !!S.fav.visitor && !S.fav.used && !S.autoTurn; }
// o comandante virou as costas para a corte: todos sentem
function favIgnoreVisit() {
  if (!favVisitPending()) return;
  S.fav.used = true;
  for (const k of FAV_ORDER) favGainRel(k, -FAV_IGNORE_REL);
  toast(`🚪 Visita ignorada: −${FAV_IGNORE_REL}% de relação com todos.`);
  saveGame();
  renderHUD();
}
// sorteia quem visita hoje (a partir do dia 5), sem repetir o visitante anterior
function favPickVisitor() {
  if (S.day < FAV_VISIT_MIN_DAY) return null;
  const pool = FAV_ORDER.filter(k => k !== S.fav.visitor);
  return pool[Math.floor(Math.random() * pool.length)] || FAV_ORDER[0];
}
function favNewDay() {
  S.fav.used = false; // a visita nasce disponível; o automático apenas a esconde (favVisitPending)
  S.fav.visitor = favPickVisitor(); // UM visitante fixo por dia (null antes do dia 5)
  for (const k of FAV_ORDER) {
    if (favPun(k)) toast(`${FAV_CHARS[k].punIc} ${FAV_CHARS[k].punDesc}`);
    else if (favBless(k)) toast(`${FAV_CHARS[k].punIc} ${FAV_CHARS[k].blessDesc}`);
  }
  if (S.fav.visitor) toast(`${FAV_CHARS[S.fav.visitor].punIc} ${FAV_CHARS[S.fav.visitor].name.split(" ")[0]} veio visitar a muralha.`);
  if (favBless("conde") && S.hits < maxHits()) { S.hits++; addFloat(2, 0.52, "🐀 Os ratos remendaram a muralha: +1 🧱", "#eecd5c"); }
}
// Efeitos por turno das punições/bênçãos (Rei / Conde). Rainha e Povo são multiplicadores.
function favPunishTick() {
  if (favPun("rei")) { S.morale -= 6; clampMorale(); addFloat(2, 0.45, "👑 O Rei retirou o apoio: −6 moral", "#e0705f"); }
  else if (favBless("rei")) { gainMorale(3); addFloat(2, 0.45, "👑 O Rei exalta seu nome: +3 moral", "#eecd5c"); }
  if (favPun("conde")) { S.hits = Math.max(1, S.hits - 1); addFloat(2, 0.52, "🐀 Os ratos roem a muralha: −1 🧱", "#e0705f"); }
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
    // Resumo de recursos dos dois campos, em uma linha: Cidade (🪙💎✋) + Feudo (recursos brutos)
    const cidadeRes = `🪙 ${Math.floor(S.gold)}&nbsp;&nbsp;💎 ${Math.floor(S.hearts)}&nbsp;&nbsp;✋ ${Math.floor(S.maos)}/${maosCap()}`;
    const feudoRes = Object.entries(RESOURCES).map(([k, r]) => `${r.icon}&nbsp;${Math.floor(S.res[k] || 0)}`).join("&nbsp;&nbsp;");
    const resSummary = `${cidadeRes}&nbsp;&nbsp;&nbsp;${feudoRes}`;
    const wrap = document.createElement("div");
    wrap.className = "dist";
    wrap.innerHTML = `
      <div class="dist-line dist-res"><span class="dl-v dr-line">${resSummary}</span></div>
      <div class="dist-div"></div>
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
      <div class="dist-line"><span class="dl-k">IDEOLOGIA:</span> <span class="dl-v" style="color:${f ? FACTIONS[f].color : "#9b8f77"}">${f ? FACTIONS[f].name.toUpperCase() : "NENHUMA"}</span>${S.purpleThisRun ? ` <span style="color:#c89aff">· pacto sombrio</span>` : ""}</div>
      ${f ? `<div class="dist-sub">${FACTIONS[f].desc}</div>` : ""}
      <div class="dist-line"><span class="dl-k">OPOSIÇÃO:</span> <span class="dl-v" style="color:${opp ? opp.color : "#9b8f77"}">${opp ? opp.name.toUpperCase() : f ? "TODAS" : "—"}</span></div>
      ${f ? `<div class="dist-sub">${opp ? DEBUFF_BY_CHOICE[f] : "sofre todas as penalidades"}</div>` : ""}
      <div class="dist-line"><span class="dl-k">TÁVOLA:</span> <span class="dl-v gold">${cc ? cc.name.toUpperCase() : "NENHUM"}</span>${cc ? ` <span class="dl-cost">💎${councilCost(cid)} Cristais</span>` : ""}</div>
      ${cc ? `<div class="dist-sub">${cc.desc}</div>` : `<div class="dist-sub">Jure um Lorde na Távola (menu inicial).</div>`}
      <div class="dist-div"></div>
      <div class="dist-chron-h">Crônicas do Setor</div>
      <div class="dist-chron"></div>
      <div class="dist-foot">CLIQUE FORA PARA SAIR</div>`;
    m.appendChild(wrap);
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
ASTRO_IMG.day.src = "ICONE-SOL-LUA-DIA.png?v=1";
ASTRO_IMG.night.src = "ICONE-SOL-LUA-NOITE.png?v=1";

// ---------- Torres — 3 categorias (Básicas 1 munição / Avançadas 2 / Icônicas 3) ----------
// Cada torre exige TODAS as munições de `ammos` (estoque por tipo). Força ∝ categoria; custo em ouro 1×/2×/3×.
const TOWER_TYPES = {
  // ===== BÁSICAS (custo 1×, 1 munição) — sempre disponíveis =====
  besta:       { name: "Besta",              tier: "basic", icon: "🏹", cost: 20, dmg: 6,  rate: 1.6, range: 999,  aoe: 0,   ptime: 0.7,  ammos: ["virotes"] },
  catapulta:   { name: "Catapulta",          tier: "basic", icon: "🪨", cost: 35, dmg: 14, rate: 3.4, range: 999,  aoe: 1,   ptime: 1.2,  ammos: ["pedras"] },
  caldeirao:   { name: "Caldeirão",          tier: "basic", icon: "🍲", cost: 30, dmg: 22, rate: 2.6, range: 0.35, aoe: 0.6, ptime: 0.45, ammos: ["oleo"] },
  tesla:       { name: "Torre Tesla",        tier: "basic", icon: "⚡", cost: 45, dmg: 7,  rate: 2.8, range: 999,  aoe: 0,   ptime: 0.25, ammos: ["condutores"], chain: 3 },
  canalizador: { name: "Filtro Mágico",      tier: "basic", icon: "🔮", cost: 40, dmg: 12, rate: 2.2, range: 999,  aoe: 0,   ptime: 0.6,  ammos: ["essencia"], magic: true },
  acido:       { name: "Chuveiro Ácido",     tier: "basic", icon: "🚿", cost: 35, dmg: 10, rate: 2.0, range: 999,  aoe: 0.5, ptime: 0.5,  ammos: ["quimicos"] },
  // ===== AVANÇADAS (custo 2×, 2 munições) — desbloqueáveis =====
  balista:     { name: "Balista Pesada",     tier: "adv", icon: "🏰", cost: 45, dmg: 22, rate: 2.6, range: 999,  aoe: 0,   ptime: 0.7,  ammos: ["virotes", "oleo"],     locked: true, medalCost: 15 },
  canhao:      { name: "Canhão de Ferro",    tier: "adv", icon: "💣", cost: 60, dmg: 30, rate: 3.6, range: 999,  aoe: 1.2, ptime: 1.1,  ammos: ["pedras", "oleo"],      locked: true, medalCost: 20 },
  cospefogo:   { name: "Cospe-Fogo",         tier: "adv", icon: "🔥", cost: 55, dmg: 34, rate: 2.2, range: 0.4,  aoe: 0.7, ptime: 0.4,  ammos: ["oleo", "virotes"],     locked: true, medalCost: 20 },
  soprador:    { name: "Soprador Invernal",  tier: "adv", icon: "🌬️", cost: 55, dmg: 12, rate: 2.4, range: 999,  aoe: 0.6, ptime: 0.4,  ammos: ["quimicos", "condutores"], slow: 0.5, locked: true, medalCost: 25 },
  prisma:      { name: "Prisma Arcano",      tier: "adv", icon: "💠", cost: 55, dmg: 16, rate: 2.0, range: 999,  aoe: 0,   ptime: 0.6,  ammos: ["essencia", "pedras"],  magic: true, chain: 2, locked: true, medalCost: 30 },
  lancaacido:  { name: "Lança-Ácido",        tier: "adv", icon: "☣️", cost: 55, dmg: 20, rate: 2.2, range: 999,  aoe: 0.5, ptime: 0.5,  ammos: ["oleo", "quimicos"],    locked: true, medalCost: 25 },
  aquatico:    { name: "Cortador Aquático",  tier: "adv", icon: "💧", cost: 55, dmg: 30, rate: 2.0, range: 0.4,  aoe: 0.5, ptime: 0.3,  ammos: ["essencia", "condutores"], locked: true, medalCost: 25 },
  cacadores:   { name: "Torre dos Caçadores",tier: "adv", icon: "🪃", cost: 55, dmg: 16, rate: 2.4, range: 999,  aoe: 0,   ptime: 0.5,  ammos: ["virotes", "quimicos"], pierce: 9, boomerang: true, locked: true, medalCost: 25 },
  serras:      { name: "Lançador de Serras", tier: "adv", icon: "🪚", cost: 60, dmg: 45, rate: 4.6, range: 999,  aoe: 0,   ptime: 0.6,  ammos: ["pedras", "virotes"], pierce: 99, locked: true, medalCost: 30 },
  escolamagos: { name: "Escola de Magos",    tier: "adv", icon: "🎓", cost: 55, dmg: 0,  rate: 2.8, range: 999,  aoe: 0,   ptime: 0.4,  ammos: ["essencia", "quimicos"], support: "mage", locked: true, medalCost: 30 },
  propaganda:  { name: "Máquina de Propaganda", tier: "adv", icon: "📢", cost: 55, dmg: 0, rate: 3.2, range: 999, aoe: 0,   ptime: 0.4,  ammos: ["condutores", "essencia"], support: "charm", locked: true, medalCost: 30 },
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
  if (f.k === "gold") { S.gold = Math.max(0, S.gold - f.cost); }
  else if (f.k === "hearts") { S.hearts = Math.max(0, S.hearts - f.cost); }
  else if (f.k === "maos") { S.maos = Math.max(0, S.maos - f.cost); }
  else if (f.k === "res") {
    // atira 5 de UM recurso bruto aleatório que tenha estoque suficiente
    const opts = Object.keys(RESOURCES).filter(k => (S.res[k] || 0) >= f.cost);
    if (opts.length) { const k = opts[Math.floor(Math.random() * opts.length)]; S.res[k] -= f.cost; }
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
  const saveCh = (fx.save || 0) + towerTypeFx(t.type, "typeSave");
  if (Math.random() < saveCh) return; // munição poupada: não gasta nada
  if (!t.ammoBy) t.ammoBy = {};
  for (const a of towerAmmos(t.type)) t.ammoBy[a] = Math.max(0, ammoOf(t, a) - cost);
}

// ---------- Inimigos ----------
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
                    desc: `abriga trabalhadores: +${CORTICO_PER} de LIMITE de ✋ Mãos por nível (teto ${MAOS_CAP_MAX})` },
  praca_publica:  { name: "Praça Pública",            icon: "⛲", cost: 30, shape: [[0,0]],                   zones: ["1","0"],
                    desc: "+1 🪙 por dia POR CONSTRUÇÃO que a toca (por nível)" },
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
                    desc: "a cada turno, um bônus aleatório por nível (🪙 / moral / 💎)", locked: true, medalCost: 10 },
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
                    desc: "+3 de moral por turno por nível", locked: true, medalCost: 20 },
  oficina:        { name: "Oficina de Muros",         icon: "🧱", cost: 45, shape: [[0,0],[1,0],[1,1]],       zones: ["1","0"],
                    desc: "repara +1 hit da muralha por turno por nível", locked: true, medalCost: 30 },
  refinaria:      { name: "Refinaria de Argamato",    icon: "💎", cost: 50, shape: [[0,0],[0,1]],             zones: ["2","0"],
                    desc: "+1 💎 por turno por nível", locked: true, medalCost: 30 },
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
  const laws = (law("L24") ? 0.10 : 0) + (S.hits === 1 && law("L30") ? 0.25 : 0); // Lei do Machado + Última Trincheira
  return (1 + cityFxScan(c => c.built === "quartel", "tD") + 0.08 * groupLvlSum("praca_militar") + infusor + laws) * favAllyMult();
}

function summonAlly(type, fac) {
  const a = ALLY_TYPES[type];
  if (S.allies.length >= ALLY_LIMIT) return false;
  const wallet = a.cur === "gold" ? S.gold : S.hearts;
  if (wallet < a.cost) return false;
  if (a.cur === "gold") S.gold -= a.cost; else S.hearts -= a.cost;
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
  muralha:     { name: "Muralha",     angle: 90 },
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
  L14: { line: "arcano", pos: 4, name: "Runas de Contenção",    desc: "+1 hit máximo da muralha.",                 cost: 300, gem: 9,  moral: 1 },
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
  L23: { line: "muralha", pos: 3, name: "Requisição de Pedra", desc: "Casas viram muralha: reparo +1 por turno.",     cost: 100, moral: -2 },
  L24: { line: "muralha", pos: 4, name: "Lei do Machado",      desc: "Tropas +10% de dano.",                          cost: 150, moral: 1 },
  L25: { line: "muralha", pos: 5, name: "Bastião Eterno",      desc: "+2 hits máximos.",                              cost: 220, moral: 2 },
  // RESISTÊNCIA — sobreviver a qualquer custo
  L26: { line: "resistencia", pos: 1, name: "Abrigos Subterrâneos",   desc: "Perda de moral por hits -25%.",                       cost: 40,  moral: 1 },
  L27: { line: "resistencia", pos: 2, name: "Muros Modulares",        desc: "Reparos rendem +1 hit.",                              cost: 80,  moral: 0 },
  L28: { line: "resistencia", pos: 3, name: "Chapas de Ferro",        desc: "Metal requisitado das casas: +1 hit máximo.",         cost: 125, moral: -2 },
  L29: { line: "resistencia", pos: 4, name: "Racionamento de Guerra", desc: "Produção +10%, mesas vazias.",                        cost: 180, moral: -3 },
  L30: { line: "resistencia", pos: 5, name: "Última Trincheira",      desc: "Com 1 hit restante, tropas e torres +25% de dano.",   cost: 260, moral: 2 },
  // TECH — indústria a vapor
  L31: { line: "tech", pos: 1, name: "Linhas de Montagem",  desc: "Produção +8%.",                                cost: 30,  moral: 0 },
  L32: { line: "tech", pos: 2, name: "Turno da Madrugada",  desc: "Produção +12%; as chaminés nunca dormem.",     cost: 60,  moral: -2 },
  L33: { line: "tech", pos: 3, name: "Prensas a Vapor",     desc: "Fábricas de 🏹 e 🪨 +20%.",                     cost: 100, moral: 0 },
  L34: { line: "tech", pos: 4, name: "Guilda dos Fumos",    desc: "Produção +18%; fuligem cobre o céu.",          cost: 150, moral: -3 },
  L35: { line: "tech", pos: 5, name: "Cidade-Máquina",      desc: "Produção +25%.",                               cost: 220, moral: -2 },
  // INOVAÇÃO — progresso para todos
  L36: { line: "inovacao", pos: 1, name: "Escolas Politécnicas", desc: "Produção +5% (eficiência para todos).",   cost: 40,  moral: 1 },
  L37: { line: "inovacao", pos: 2, name: "Lampiões de Argamato", desc: "Perdas de moral à noite -25%.",           cost: 80,  moral: 1 },
  L38: { line: "inovacao", pos: 3, name: "Medicina Moderna",     desc: "Tropas curam +3 por turno.",              cost: 125, moral: 2 },
  L39: { line: "inovacao", pos: 4, name: "Elevadores de Carga",  desc: "Caixas entregam +1 munição.",             cost: 180, moral: 0 },
  L40: { line: "inovacao", pos: 5, name: "Renda do Progresso",   desc: "+8 🪙 por turno.",                        cost: 260, moral: 1 },
  // LENDÁRIAS — exigem as duas linhas vizinhas completas
  L41: { legend: ["moral", "profano"],       color: "#8b2fc9", name: "Vox Umbra",         desc: "O povo canta no escuro: 💎 por abate +50%.",              cost: 750, moral: -3 },
  L42: { legend: ["profano", "arcano"],      color: "#c0392b", name: "Coroa Carmesim",    desc: "Torres mágicas encadeiam +1 inimigo.",                    cost: 750, gem: 20, moral: -3 },
  L43: { legend: ["arcano", "cajado"],       color: "#e0a92f", name: "Olho do Turbilhão", desc: "Após turno perfeito, conjurar não gasta 💎.",             cost: 750, gem: 25, moral: 0 },
  L44: { legend: ["cajado", "muralha"],      color: "#8b2fc9", name: "Lex Arcanum",       desc: "Auras sobre tropas dão +1 escudo (absorve 1 golpe).",     cost: 750, gem: 20, moral: 1 },
  L45: { legend: ["muralha", "resistencia"], color: "#2f6fd6", name: "Muralha Viva",      desc: "A pedra respira: regenera +1 hit todo amanhecer.",        cost: 750, moral: 2 },
  L46: { legend: ["resistencia", "tech"],    color: "#e0a92f", name: "Cidadela de Ferro", desc: "+2 hits máximos e reparos +1.",                           cost: 750, moral: -2 },
  L47: { legend: ["tech", "inovacao"],       color: "#c0392b", name: "Motor Perpétuo",    desc: "Produção +20% e o Capataz não reduz mais a moral.",       cost: 750, moral: -1 },
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
function heartsPerTurn() { return (law("L13") ? 1 : 0) + groupLvlSum("refinaria") + groupLvlSum("praca_cerimonial"); }

// ---------- Variantes de construções e torres (Lv1→5) ----------
// Lv2: escolha entre 3 caminhos. Lv3/4/5: escolha entre 2, dentro do caminho.
// fx: efeitos somados ao longo do path.
const VTREES = {
  besta: { l2: [
    { id: "pesada", n: "Besta Pesada",        d: "Dano +60%, cadência −20%",        fx: { d: .6, r: -.2 } },
    { id: "repet",  n: "Besta de Repetição",  d: "Cadência +50%, dano −20%",        fx: { r: .5, d: -.2 } },
    { id: "veneno", n: "Besta Envenenada",    d: "Tiros envenenam (3/s por 3s)",    fx: { poison: 3 } },
  ], br: {
    pesada: {
      l3: [{ id: "perf",   n: "Perfurante",           d: "Atravessa e acerta um 2º atrás",      fx: { pierce: 1 } },
           { id: "demol",  n: "Demolidora",           d: "+80% de dano vs resistentes",         fx: { vsArm: .8 } }],
      l4: [{ id: "cerco",  n: "De Cerco",             d: "Dano ×2, consome 2 virotes",          fx: { d: 1, cost: 1 } },
           { id: "gemea",  n: "Gêmea",                d: "Um segundo virote noutro alvo",       fx: { extra: 1 } }],
      l5: [{ id: "balista",n: "Balista Divina",       d: "O tiro atravessa a lane inteira",     fx: { pierce: 9 } },
           { id: "coloss", n: "Matadora de Colossos", d: "+3% da vida máx. do alvo por tiro",   fx: { maxhp: .03 } }],
    },
    repet: {
      l3: [{ id: "rajada", n: "Rajada",               d: "Cadência +40%",                        fx: { r: .4 } },
           { id: "gatilho",n: "Gatilho Leve",         d: "33% de não gastar virote",             fx: { save: .33 } }],
      l4: [{ id: "metralha",n: "Metralha",            d: "Cadência +40%, dano −20%",             fx: { r: .4, d: -.2 } },
           { id: "mira",   n: "Mira Fina",            d: "20% de crítico ×2",                    fx: { critC: .2, critM: 2 } }],
      l5: [{ id: "tempest",n: "Tempestade de Virotes",d: "Cadência +60%",                        fx: { r: .6 } },
           { id: "falcao", n: "Olho do Falcão",       d: "45% de crítico ×2",                    fx: { critC: .45, critM: 2 } }],
    },
    veneno: {
      l3: [{ id: "corros", n: "Corrosiva",            d: "Veneno dissolve resistências",         fx: { shred: 1 } },
           { id: "peste",  n: "Pestilenta",           d: "Veneno espalha quando o alvo morre",   fx: { pSpread: 1 } }],
      l4: [{ id: "necro",  n: "Necrosante",           d: "Veneno +3/s",                          fx: { poison: 3 } },
           { id: "paralis",n: "Paralisante",          d: "Envenenados 20% mais lentos",          fx: { pSlow: .2 } }],
      l5: [{ id: "praga",  n: "Praga Verde",          d: "Veneno +6/s e espalha",                fx: { poison: 6, pSpread: 1 } },
           { id: "agulha", n: "Agulha da Morte",      d: "Alvos abaixo de 15% morrem",           fx: { exec: .15 } }],
    },
  }},
  catapulta: { l2: [
    { id: "estilha", n: "De Estilhaços", d: "Área +50%, dano −25%",              fx: { aoeM: .5, d: -.25 } },
    { id: "trebuchet",n: "Trebuchet",    d: "Dano ×2, área −30%",                fx: { d: 1, aoeM: -.3 } },
    { id: "incend",  n: "Incendiária",   d: "Deixa fogo no chão do impacto",     fx: { ground: 4 } },
  ], br: {
    estilha: {
      l3: [{ id: "metralhap", n: "Metralha de Projéteis", d: "2 alvos extras",             fx: { extra: 2 } },
           { id: "frag",      n: "Fragmentação",      d: "1 alvo extra, área +20%",       fx: { extra: 1, aoeM: .2 } }],
      l4: [{ id: "choque",    n: "Onda de Choque",    d: "Atingidos 30% lentos por 3s",   fx: { slow: .3 } },
           { id: "bombard",   n: "Bombardeio",        d: "+1 alvo, área +20%",            fx: { extra: 1, aoeM: .2 } }],
      l5: [{ id: "meteoros",  n: "Chuva de Meteoros", d: "+2 alvos, área +30%",           fx: { extra: 2, aoeM: .3 } },
           { id: "terremoto", n: "Terremoto",         d: "Atingidos atordoados 1s",       fx: { stun: 1 } }],
    },
    trebuchet: {
      l3: [{ id: "contrapeso",n: "Contrapeso de Ferro",d: "Dano +50%",                    fx: { d: .5 } },
           { id: "alcance",   n: "Alcance Real",       d: "Mira o inimigo mais DISTANTE", fx: { far: 1 } }],
      l4: [{ id: "dupla",     n: "Projétil Duplo",     d: "Dano ×2, consome 2 projéteis", fx: { d: 1, cost: 1 } },
           { id: "precisao",  n: "Precisão de Mestre", d: "Voo 60% mais rápido",          fx: { fast: 1 } }],
      l5: [{ id: "punho",     n: "Punho de Karzstak",  d: "Dano ×3, cadência −30%",       fx: { d: 2, r: -.3 } },
           { id: "orbita",    n: "Órbita Baixa",       d: "Voo rápido e cadência +30%",   fx: { fast: 1, r: .3 } }],
    },
    incend: {
      l3: [{ id: "piche",   n: "Piche Ardente",   d: "Fogo no chão dura mais",         fx: { groundDur: 2 } },
           { id: "explos",  n: "Explosiva",       d: "Dano do impacto +50%",           fx: { d: .5 } }],
      l4: [{ id: "napalm",  n: "Napalm Medieval", d: "Fogo no chão +4/s",              fx: { ground: 4 } },
           { id: "mar",     n: "Mar de Chamas",   d: "Fogo cobre área maior",          fx: { groundR: .05 } }],
      l5: [{ id: "inferno", n: "Inferno",         d: "Fogo no chão +8/s",              fx: { ground: 8 } },
           { id: "cometa",  n: "Cometa",          d: "Impacto ×2 e fogo extra",        fx: { d: 1, ground: 2 } }],
    },
  }},
  caldeirao: { l2: [
    { id: "ferv",   n: "Fervente",      d: "Dano +50%",                          fx: { d: .5 } },
    { id: "transb", n: "Transbordante", d: "Alcança metade do campo",            fx: { range: .55 } },
    { id: "alquim", n: "Alquímico",     d: "Ácido corrói resistências",          fx: { shredHit: 1 } },
  ], br: {
    ferv: {
      l3: [{ id: "banha", n: "Banha Ardente",  d: "Queima 3/s por 3s",             fx: { poison: 3 } },
           { id: "vapor", n: "Vapor Escaldante",d: "Deixa vapor no chão (3/s)",    fx: { ground: 3 } }],
      l4: [{ id: "ebul",  n: "Ponto de Ebulição",d: "Dano +50%",                   fx: { d: .5 } },
           { id: "jato",  n: "Jato Direcionado", d: "Dano ×2, área menor",         fx: { d: 1, aoeM: -.3 } }],
      l5: [{ id: "geiser",n: "Gêiser",           d: "+2 alvos por despejo",        fx: { extra: 2 } },
           { id: "dragao",n: "Óleo do Dragão",   d: "Queimadura forte (+4/s)",     fx: { poison: 4 } }],
    },
    transb: {
      l3: [{ id: "calha",   n: "Calha Longa",  d: "Alcança ¾ do campo",           fx: { range: .2 } },
           { id: "espalha", n: "Espalhamento", d: "+1 alvo",                      fx: { extra: 1 } }],
      l4: [{ id: "cascata", n: "Cascata",      d: "Escorre e acerta 2 atrás",     fx: { pierce: 2 } },
           { id: "mares",   n: "Marés",        d: "+2 alvos",                     fx: { extra: 2 } }],
      l5: [{ id: "diluvio", n: "Dilúvio Negro",d: "Campo inteiro, cadência −30%", fx: { rangeAll: 1, r: -.3, aoeM: .5 } },
           { id: "corrente",n: "Correnteza",   d: "Empurra os atingidos p/ trás", fx: { knock: .06 } }],
    },
    alquim: {
      l3: [{ id: "acidoreal", n: "Ácido Real", d: "Corrosão 2× mais rápida",      fx: { shredHit: 1 } },
           { id: "solvente",  n: "Solvente",   d: "Dano +30%",                    fx: { d: .3 } }],
      l4: [{ id: "catalis",   n: "Catalisador",d: "Atingidos tomam +25% de tudo", fx: { mark: .25 } },
           { id: "mutag",     n: "Mutagênico", d: "+5% de 💎 nos abates",         fx: { kh: .05 } }],
      l5: [{ id: "pedra",     n: "Pedra Filosofal", d: "+1 🪙 por abate",         fx: { kg: 1 } },
           { id: "dissol",    n: "Dissolução",     d: "Ácido causa 5/s",          fx: { poison: 5 } }],
    },
  }},
  canalizador: { l2: [
    { id: "focal",  n: "Focalizador", d: "Dano +60%",                             fx: { d: .6 } },
    { id: "difusor",n: "Difusor",     d: "O orbe ricocheteia p/ +1 alvo",         fx: { extra: 1 } },
    { id: "umbral", n: "Umbral",      d: "+5% da vida máx. do alvo por tiro",     fx: { maxhp: .05 } },
  ], br: {
    focal: {
      l3: [{ id: "lanca",  n: "Lança Arcana",  d: "Perfura 2 atrás do alvo",      fx: { pierce: 2 } },
           { id: "desint", n: "Desintegrador", d: "+15% de dano acumulado por acerto no mesmo alvo", fx: { ramp: .15 } }],
      l4: [{ id: "prisma", n: "Prisma",        d: "25% de crítico ×3",            fx: { critC: .25, critM: 3 } },
           { id: "overload",n: "Overload",     d: "Dano ×2.5, consome 2 essências", fx: { d: 1.5, cost: 1 } }],
      l5: [{ id: "raioarg",n: "Raio de Argamato", d: "Cadência +80% e dano +30%", fx: { r: .8, d: .3 } },
           { id: "aniq",   n: "Aniquilação",      d: "Alvos abaixo de 20% morrem", fx: { exec: .2 } }],
    },
    difusor: {
      l3: [{ id: "triplice", n: "Tríplice",     d: "+2 ricochetes",               fx: { extra: 2 } },
           { id: "eco",      n: "Eco Arcano",   d: "Dano +40%",                   fx: { d: .4 } }],
      l4: [{ id: "teia",     n: "Teia de Mana", d: "+2 alvos conectados",         fx: { extra: 2 } },
           { id: "astral",   n: "Frag. Astral", d: "Explosão em área no final",   fx: { aoeM: .4, aoeOn: 1 } }],
      l5: [{ id: "constel",  n: "Constelação",  d: "+4 ricochetes",               fx: { extra: 4 } },
           { id: "bigbang",  n: "Big Bang",     d: "Área grande, dano +50%",      fx: { aoeM: .8, aoeOn: 1, d: .5 } }],
    },
    umbral: {
      l3: [{ id: "dreno",    n: "Dreno",          d: "+2% da vida máx.",          fx: { maxhp: .02 } },
           { id: "maldicao", n: "Maldição",       d: "Marcados tomam +30% de tudo", fx: { mark: .3 } }],
      l4: [{ id: "ceifador", n: "Ceifador",       d: "Cadência +30%",             fx: { r: .3 } },
           { id: "vinculo",  n: "Vínculo Sombrio",d: "33% de não gastar essência", fx: { save: .33 } }],
      l5: [{ id: "devorador",n: "Devorador de Almas", d: "+5% vida máx. e +15% de 💎", fx: { maxhp: .05, kh: .15 } },
           { id: "eclipse",  n: "Eclipse",            d: "Atingidos 50% lentos 3s",   fx: { slow: .5 } }],
    },
  }},
  tesla: { l2: [
    { id: "encad", n: "Encadeadora", d: "Cadeia atinge 5 alvos",                  fx: { chain: 2 } },
    { id: "volt",  n: "Voltaica",    d: "Dano +70%",                              fx: { d: .7 } },
    { id: "capac", n: "Capacitora",  d: "33% de descarga crítica ×3",             fx: { critC: .33, critM: 3 } },
  ], br: {
    encad: {
      l3: [{ id: "arco",     n: "Arco Longo",         d: "+1 elo na cadeia",       fx: { chain: 1 } },
           { id: "corrente2",n: "Corrente Contínua",  d: "Dano +30%",              fx: { d: .3 } }],
      l4: [{ id: "rede",     n: "Rede Elétrica",      d: "+2 elos",                fx: { chain: 2 } },
           { id: "serie",    n: "Sobrecarga em Série",d: "Dano +30%",              fx: { d: .3 } }],
      l5: [{ id: "tempestE", n: "Tempestade",         d: "+2 alvos extras",        fx: { extra: 2 } },
           { id: "malha",    n: "Malha Total",        d: "+5 elos, dano −30%",     fx: { chain: 5, d: -.3 } }],
    },
    volt: {
      l3: [{ id: "tensao",  n: "Alta Tensão", d: "Dano +50%",                      fx: { d: .5 } },
           { id: "fusivel", n: "Fusível",     d: "Área elétrica no impacto",       fx: { aoeM: .3, aoeOn: 1 } }],
      l4: [{ id: "relamp",  n: "Relâmpago",   d: "Raio instantâneo",               fx: { fast: 1 } },
           { id: "ioniz",   n: "Ionização",   d: "Atingidos tomam +20% de tudo",   fx: { mark: .2 } }],
      l5: [{ id: "zeus",    n: "Zeus",        d: "Dano ×3.5, cadência −40%",       fx: { d: 2.5, r: -.4 } },
           { id: "reator",  n: "Reator",      d: "Cadência ×2, consome 2 condutores", fx: { r: 1, cost: 1 } }],
    },
    capac: {
      l3: [{ id: "bateria",  n: "Bateria Dupla",     d: "+15% de crítico",         fx: { critC: .15 } },
           { id: "estatica", n: "Descarga Estática", d: "Dano +30%",               fx: { d: .3 } }],
      l4: [{ id: "supercond",n: "Supercondutor",     d: "Cadência +40%",           fx: { r: .4 } },
           { id: "pararraios",n: "Pararraios",       d: "25% de não gastar condutor", fx: { save: .25 } }],
      l5: [{ id: "singular", n: "Singularidade",     d: "Dano +150%",              fx: { d: 1.5 } },
           { id: "usina",    n: "Usina",             d: "50% de não gastar condutor", fx: { save: .5 } }],
    },
  }},
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
      l5: [{ id: "falange",  n: "Falange Eterna",d: "+1 hit máximo da muralha",    fx: { hitMax: 1 } },
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

function towerFx(t) { return vFx(t.type, t.path || []); }
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
const POWER_DPS = 3;          // dano por segundo, de leve, só uma ajuda (nerfado de 5)
const POWER_RADIUS = 13;      // alcance da linha em px (nerfado de 20)
const POWER_LIFE = 0.45;      // segundos até a linha se dissipar (some bem rápido)
const POWER_MAX_PTS = 20;     // limite de comprimento do traço = menos distância (nerfado de 36)
const SEAL_DMG = 15;          // dano extra do selo (traço fechado ao redor do inimigo)
const SEAL_CLOSE_PX = 34;     // distância máxima entre início e fim para fechar o selo

// Tipos de SELO (nome ritual por forma). Fechados = fortes; traços abertos (letras) = mais fracos.
const SEALS = {
  alpha: { name: "Selo Alpha", ic: "🔺", closed: true,  dmg: SEAL_DMG, color: "#e0705f" }, // triângulo
  omega: { name: "Selo Omega", ic: "⭕", closed: true,  dmg: SEAL_DMG, color: "#5aa9ff" }, // círculo
  beta:  { name: "Selo Beta",  ic: "🟥", closed: true,  dmg: SEAL_DMG, color: "#7ac36a" }, // quadrado
  zeta:  { name: "Selo Zeta",  ic: "🇿",  closed: false, dmg: 7, cost: 1, color: "#c9b45a" }, // Z curto, custa 💎
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
// 3-toques (mobile): idem, no centroide dos dedos; cancela desenho em curso
canvas.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 3) return;
  e.preventDefault();
  drawingLine = null;
  let sx = 0, sy = 0;
  for (const tch of e.touches) { sx += tch.clientX; sy += tch.clientY; }
  useCouncil(fieldTargetFromClient(sx / 3, sy / 3));
}, { passive: false });

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.pointerType !== "touch") return; // botão esquerdo ou dedo
  e.preventDefault();
  drawingLine = { pts: [canvasFrac(e)], life: POWER_LIFE, max: POWER_LIFE };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
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
canvas.addEventListener("pointerup", finishLine);
canvas.addEventListener("pointercancel", () => { drawingLine = null; });

function resizeCanvas() {
  // sincroniza o backing store ao tamanho REAL exibido do canvas (senão estica: astro oval)
  const w0 = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h0 = canvas.clientHeight || canvas.parentElement.clientHeight;
  const bw = Math.round(w0 * devicePixelRatio), bh = Math.round(h0 * devicePixelRatio);
  if (canvas.width === bw && canvas.height === bh) return; // já sincronizado
  canvas.width = bw;
  canvas.height = bh;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
addEventListener("resize", resizeCanvas);

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
const HELP_RATE = 100;          // Ajudar o Reino: munição excedente → medalhas (100 ▸ 1)
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
function toggleField() {
  S.field = S.field === "city" ? "feud" : "city";
  if (S.field === "feud" && S.placing) stopPlacing(); // não posiciona no Feudo
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
    helpKingdom:   ["🎖️ Ajudando o Reino: munição excedente vira Medalhas (100 ▸ 1).", "O setor voltou a guardar seu excedente."],
    feudAid:       [`🆘 Pedindo ajuda ao Reino: +${FEUD_AID_RES} de cada material bruto por turno, mas o povo perde muita moral.`, "O setor dispensou a ajuda do Reino."],
    feudOverdrive: ["⚙️ Sobrecarga: os extratores rendem +50%, mas o povo perde muita moral por turno.", "Os extratores voltaram ao ritmo normal."],
  };
  const tog = (label, key, title) => {
    const b = document.createElement("button");
    b.className = "fres-toggle" + (S[key] ? " on" : "");
    b.title = title;
    b.innerHTML = `<span class="tg-l">${label}</span><span class="tg-dot"></span>`;
    b.onclick = () => {
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
    for (const [key, r] of Object.entries(RESOURCES)) item(r.icon, Math.floor(S.res[key]));
    tog("Sobrecarga", "feudOverdrive", "Extratores produzem +50%, mas o povo perde muita moral enquanto ativo");
  } else {
    tog("Ajudar Reino", "helpKingdom", "Envia a munição excedente para outros setores: 100 munições ▸ 1 🎖️ Medalha");
    mid = document.createElement("div");
    mid.className = "fres-mid";
    el.appendChild(mid);
    item("🪙", S.gold, "res-gold");
    item("💎", S.hearts, "res-hearts");
    item("✋", `${Math.floor(S.maos)}/${maosCap()}`, "res-maos");
    tog("Ativar Capataz", "capataz", "Acelera toda a produção da cidade, mas o povo perde moral a cada turno");
  }
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
    let desc, fx;
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
    }
    wrap.innerHTML = `<div class="bd-art"><span class="bd-art-ic">${b.icon}</span></div>
      <div class="bd-title">${b.name.toUpperCase()}</div>
      ${BUILD_FLAVOR[c.built] ? `<div class="bd-flavor">${BUILD_FLAVOR[c.built]}</div>` : ""}
      <div class="bd-desc">${desc}</div>
      <div class="bd-fx">${fx}</div>
      ${bdSectionHTML(off, !!b.struct)}
      <div class="bd-ups"><div class="bd-max">Sem melhorias disponíveis.</div></div>`;
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
  cortico:        "Apertado, barulhento e cheio de vida — braços novos para a muralha.",
  praca_publica:  "O coração do distrito: feiras, fofocas e impostos.",
  praca_trabalho: "Sinos marcam os turnos; as construções vizinhas rendem mais.",
  praca_vigia:    "Do alto da torre, o vigia enxerga a horda antes de todos.",
  praca_festival: "Música contra o medo: enquanto houver dança, há esperança.",
  praca_jardim:   "Um respiro verde entre muros — os feridos saram mais rápido.",
  praca_militar:  "Campo de treino: cada golpe ensaiado aqui vale um lá fora.",
  praca_chique:   "Mármore importado e ouro fácil. A nobreza agradece.",
  praca_abandonada: "Saqueadores reviram os escombros — lucro com gosto de poeira.",
  praca_cerimonial: "Velas acesas pelos que se foram alimentam o cristal.",
  praca_estranha: "Ninguém sabe quem a construiu. Às vezes ela retribui.",
  capela:         "Orações baixas costuram os feridos de volta à linha.",
  estabulo:       "Cascos ferrados e crina ao vento: as tropas marcham mais rápido.",
  tesouraria:     "Cofres trancados a sete chaves rendem juros de guerra.",
  laboratorio:    "Engrenagens, retortas e ideias perigosas — a produção agradece.",
  templo:         "A fé sobe em cânticos e volta em coragem, turno após turno.",
  oficina:        "Andaimes permanentes: a muralha se remenda a cada turno.",
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
function bdSectionHTML(off, noPow) {
  return `<div class="bd-sec">
    <button class="bd-round" id="bd-del" title="Demolir (sem reembolso)">🗑</button>
    <span class="bd-sec-t">-MELHORIAS-</span>
    ${noPow ? `<span class="bd-round bd-ghost"></span>` : `<button class="bd-round${off ? " bd-off" : ""}" id="bd-pow" title="${off ? "Religar estrutura" : "Desativar estrutura"}">⏻</button>`}
  </div>${off ? `<div class="bd-off-note">⏸ ESTRUTURA DESATIVADA — efeitos e consumo pausados.</div>` : ""}`;
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
      const parts = tt.fuel
        ? `<span class="ammo${fuelPool(tt.fuel.k) < tt.fuel.cost ? " empty" : ""}">${FUEL_ICON[tt.fuel.k]}${Math.floor(fuelPool(tt.fuel.k))}</span>`
        : tt.ammos.map(a => {
            const am = AMMO[a];
            if (prodOfType(a) === 0) return `<span class="ammo empty">${am.icon}⚠️</span>`;
            const n = ammoOf(t, a);
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
            S.towers[i] = { type: key, ammoBy: {}, lvl: 1, path: [] };
            closeModal(); renderAll();
          };
          grid.appendChild(card);
        }
        m.appendChild(grid);
      }
    });
  } else {
    const tt = TOWER_TYPES[t.type];
    const vn = vName(t.type, t.path || []);
    const pTag = prestigeOf(t) ? ` ⭐${prestigeOf(t)}` : "";
    openModal(`${tt.icon} ${vn || tt.name} Lv${t.lvl}${pTag} · Portão ${i + 1}`, (m) => {
      if (t.lvl < MAX_LVL) {
        const upCost = EV_COST_TOWER[t.lvl];
        if (VTREES[t.type]) {
          appendVariantChoice(m, t.type, t.lvl, t.path || [], upCost, "gold", (id) => {
            S.gold -= upCost;
            t.path = [...(t.path || []), id];
            t.lvl++;
            closeModal(); renderAll();
          });
        } else {
          // torres sem árvore de variantes: evolução simples (dano/eficiência escalam por nível)
          m.append(row(`Evoluir para Lv${t.lvl + 1}: mais forte`, "🪙 Evoluir", upCost, S.gold >= upCost, () => {
            S.gold -= upCost; t.lvl++; closeModal(); renderAll();
          }));
        }
      } else {
        // Nível máximo: sistema de PRESTÍGIO (objetivo opcional de end-game)
        const p = prestigeOf(t);
        const d = document.createElement("div");
        d.className = "panel-hint";
        d.innerHTML = p
          ? `Nível máximo · <b style="color:${PRESTIGE_STAR[p]}">Prestígio ${p}/${PRESTIGE_MAX}</b> — dano ×${prestigeDmgMult(t).toFixed(2)}, cadência +${Math.round((prestigeRateMult(t) - 1) * 100)}%.`
          : "Nível máximo alcançado. Prestigie para superar o teto: cada prestígio dá <b>+60% dano</b> e <b>+10% cadência</b> permanentes (mantém o build).";
        m.appendChild(d);
        if (p < PRESTIGE_MAX) {
          const cost = prestigeCost(p);
          m.append(row(`Prestigiar (⭐${p}→⭐${p + 1}): bônus permanente e empilhável`, "🪙 Prestigiar", cost, S.gold >= cost && !S.waveActive, () => {
            S.gold -= cost; t.prestige = p + 1; closeModal(); renderAll();
          }));
          if (S.waveActive) {
            const w = document.createElement("div"); w.className = "panel-hint";
            w.textContent = "Só é possível prestigiar entre turnos.";
            m.appendChild(w);
          }
        } else {
          const w = document.createElement("div"); w.className = "panel-hint";
          w.innerHTML = `<b style="color:${PRESTIGE_STAR[PRESTIGE_MAX]}">Prestígio máximo (${PRESTIGE_MAX}/${PRESTIGE_MAX})</b> — uma lenda dourada da muralha.`;
          m.appendChild(w);
        }
      }
      // Prioridade de mira (config individual da torre)
      if (!tt.support) {
        const aimHint = document.createElement("div");
        aimHint.className = "panel-hint";
        aimHint.innerHTML = "<b>Prioridade de mira</b> · para quem esta torre atira primeiro:";
        m.appendChild(aimHint);
        const aimRow = document.createElement("div");
        aimRow.className = "tier-row";
        for (const mode of AIM_ORDER) {
          const md = AIM_MODES[mode];
          const cur = (t.aim || "near") === mode;
          const wrap = document.createElement("div");
          wrap.className = "tnode-wrap";
          const circle = document.createElement("button");
          circle.className = "tnode" + (cur ? " tnode-on" : "");
          circle.innerHTML = `<span class="tn-icon">${md.icon}</span>`;
          circle.onclick = () => { t.aim = mode; closeModal(); renderAll(); };
          const name = document.createElement("div");
          name.className = "tn-name";
          name.textContent = md.name;
          const desc = document.createElement("div");
          desc.className = "tn-desc";
          desc.textContent = md.desc;
          wrap.append(circle, name, desc);
          aimRow.appendChild(wrap);
        }
        m.appendChild(aimRow);
      }
      m.append(
        row("Substituir sem custo (remove a torre atual)", "🔄 Remover", 0, true, () => {
          S.towers[i] = null;
          closeModal(); renderAll();
        }),
      );
    });
  }
}

// Escolha de variante (bolinhas): 3 opções no Lv1→2, 2 nas demais
function appendVariantChoice(m, treeKey, lvl, path, cost, cur, onPick) {
  const opts = vOptions(treeKey, lvl, path);
  if (!opts) return;
  const locked = S.waveActive; // em combate: visíveis, mas não compráveis
  const curIcon = cur === "gold" ? "🪙" : "💎";
  const wallet = cur === "gold" ? S.gold : S.hearts;
  const hint = document.createElement("div");
  hint.className = "panel-hint";
  hint.textContent = locked
    ? "⚔ Em combate: melhorias só na fase de planejamento."
    : lvl === 1
      ? `Evoluir para Lv2 (${cost} ${curIcon}): escolha um CAMINHO, os outros dois ficam trancados.`
      : `Evoluir para Lv${lvl + 1} (${cost} ${curIcon}): escolha a especialização.`;
  m.appendChild(hint);
  const rowEl = document.createElement("div");
  rowEl.className = "tier-row";
  for (const o of opts) {
    const wrap = document.createElement("div");
    wrap.className = "tnode-wrap";
    const circle = document.createElement("button");
    circle.className = "tnode";
    circle.disabled = locked || wallet < cost;
    circle.innerHTML = `<span class="tn-icon">${o.icon || "⬆"}</span><span class="tn-cost">${curIcon}${cost}</span>`;
    circle.onclick = () => onPick(o.id);
    const name = document.createElement("div");
    name.className = "tn-name";
    name.textContent = o.n;
    const desc = document.createElement("div");
    desc.className = "tn-desc";
    desc.textContent = o.d;
    wrap.append(circle, name, desc);
    rowEl.appendChild(wrap);
  }
  m.appendChild(rowEl);
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
      ["protect", "🛡️", "Proteger", "Seguram a linha à frente da muralha, sem avançar."],
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
        : "🛡️ Seguram a linha à frente da muralha, sem avançar."}</div>`);

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
    const grid = document.createElement("div");
    grid.className = "gate-grid";
    const fake = { fac: S.gateFac };
    for (const [key, a] of Object.entries(ALLY_TYPES)) {
      if (a.spectral) continue; // Sombra vem do pacto roxo, não do Arco
      const curIcon = a.cur === "gold" ? "🪙" : "💎";
      const wallet = a.cur === "gold" ? S.gold : S.hearts;
      const can = S.allies.length < ALLY_LIMIT && wallet >= a.cost;
      const hp = Math.round(a.hp * allyHpMult() * allyFacHpMult(fake));
      const dps = (a.dps * allyDmgMult() * allyFacAtkMult(fake)).toFixed(1);
      const kind = a.tank ? `absorve ${Math.round(a.tank * 100)}% do dano` : a.melee ? "corpo a corpo" : "à distância";
      const b = document.createElement("button");
      b.className = "gate-card";
      b.style.setProperty("--fc", FACTIONS[S.gateFac].color);
      b.disabled = !can;
      b.innerHTML = `<span class="gc-ic">${a.icon}</span><span class="gc-n">${a.name}</span>
        <span class="gc-s">❤️ ${hp} · ⚔️ ${dps}</span><span class="gc-k">${kind}</span>
        <span class="gc-c">${curIcon} ${a.cost}</span>`;
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
          ? `Repõe cada baixa com <b>${pref.name}</b> (${pref.cur === "gold" ? "🪙" : "💎"} ${pref.cost}), na ideologia selecionada.`
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
  $("modal").classList.remove("dist-modal"); // limpa modificadores de painéis específicos
  $("modal-title").textContent = title;
  const m = $("modal-content");
  m.innerHTML = "";
  buildFn(m);
  $("modal").classList.remove("hidden");
}
function closeModal() { $("modal").classList.add("hidden"); }
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
  $("laws-scr").classList.remove("hidden");
  buildLawsWheel();
  renderLawsDetail();
  centerLawsWheel();
}
function closeMelhorias() { $("laws-scr").classList.add("hidden"); }
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
    row("Restaurar os hits da muralha", "🧱 Curar", 0, true, () => { S.hits = maxHits(); renderAll(); renderDebugPanel(); }),
    row("Encher a munição de todas as torres", "🎯 Munição", 0, true, () => { S.towers.forEach(t => { if (t) fillTowerAmmo(t); }); renderAll(); renderDebugPanel(); }),
    row("Eliminar todos os inimigos em campo", "☠️ Limpar", 0, true, () => { S.enemies.forEach(e => e.hp = 0); closePause(); }),
    row("Invocar 5 mortos-vivos extras", "🧟 Invocar", 0, true, () => { if (S.waveActive) spawnQueue.push(...pickWave(5)); closePause(); }),
    row("Pular para o próximo dia (fora de turno)", "⏭ Pular dia", 0, !S.waveActive, () => { S.isNight = false; S.day++; S.gold += 15 + S.day * 3; buildNextWave(); renderAll(); renderDebugPanel(); }),
    row(`Muralha invencível ${S.debug.god ? "✅" : "❌"}`, "🛡 God", 0, true, () => { S.debug.god = !S.debug.god; renderDebugPanel(); }),
    row(`Velocidade do jogo: ${S.debug.speed}x`, "⏩ Alternar", 0, true, () => { const i = SPEEDS.indexOf(S.debug.speed); S.debug.speed = SPEEDS[(i + 1) % SPEEDS.length]; renderHUD(); renderDebugPanel(); }),
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
      d.textContent = "Nenhum jogo salvo ainda. Salve pelo menu de Configurações (⚙) durante a partida — e a cada 5 dias um autosave é feito automaticamente.";
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

// ---------- Horda / eventos celestes ----------
function moonPhase() { return S.day % 4 === 0; }
// Lua Sangrenta: a cada 10 dias, na madrugada, horda mais forte e populosa
function bloodMoon() { return S.isNight && S.day % 10 === 0; }
// Sol Negro: dias terminados em 5, durante o dia, eficiência da cidade cai pela metade
function blackSun() { return !S.isNight && S.day % 10 === 5; }
function cityEff() { return blackSun() ? 0.5 : 1; }

function waveSize() {
  const fullMoon = S.isNight && moonPhase();
  // Base cresce ~linear com o dia; o pico de tensão vem da escalada por QUANTIDADE no mid-end.
  let n = 8 + S.day * 3.0 + (S.isNight ? 4 : 0) + (fullMoon ? 6 : 0);
  if (bloodMoon()) n = Math.round(n * 1.6);
  // Acelerador de mid-end (Ato 2): escalada por QUANTIDADE a partir do dia 10, mais forte.
  n += Math.round(Math.pow(Math.max(0, S.day - 10), 1.55) * 1.1);
  return Math.round(Math.min(240, n)); // teto de segurança (performance / evitar slog)
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
  });
};

// ---------- HUD ----------
function renderHUD() {
  const fullMoon = S.isNight && moonPhase();
  const mk = $("morale-mark");
  if (mk) mk.style.left = (50 + S.morale / 3) + "%";
  renderHudBrasao();
  $("hud-hp").innerHTML = `<span class="hp-d">◆</span> ${Math.max(0, S.hits)}/${maxHits()} HP`;
  // moedas globais vivem na barra de recursos da Cidade (só atualiza os números se presentes)
  const rg = $("res-gold"); if (rg) rg.textContent = S.gold;
  const rh = $("res-hearts"); if (rh) rh.textContent = S.hearts;
  const rm = $("res-maos"); if (rm) rm.textContent = `${Math.floor(S.maos)}/${maosCap()}`;
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
let qCd = {};        // cooldown dos quartéis de arqueiros
let blockPool = 0;   // bloqueios de guarnição disponíveis no turno
let gateCd = 0;      // cooldown do preenchimento automático do Portão

function startWave() {
  if (S.waveActive) return;
  S.waveActive = true;
  stopPlacing();
  closeModal();
  $("conveyor").classList.add("running");
  $("conveyor-v").classList.add("running");
  spawnQueue = [...S.nextWave];
  spawnTimer = 0.5; supplyTimer = 0;
  S.groundFires = [];
  S.turnHitsLost = 0;
  qCd = {};
  blockPool = cityFxScan(c => c.built === "quartel", "block");
  renderAll();
}

function spawnEnemy(lane, type) {
  const t = ENEMY_TYPES[type];
  // REGRA: inimigos NÃO escalam HP com o dia. HP base é fixo por tipo; a escalada vem de
  // QUANTIDADE (waveSize) e de NOVOS TIPOS (minDay). Só modificadores EXTERNOS mexem no HP:
  // lua sangrenta (evento celeste), Medo (moral) e dayMods (eventos diários).
  const hp = Math.round(t.hp * (bloodMoon() ? 1.5 : 1) * moraleEnemyHpMult() * dm("enemyHp"));
  S.enemies.push({
    lane, y: -0.05, type,
    hp, maxHp: hp,
    speed: t.spd * slowFactor() * moraleEnemySpdMult() * dm("enemySpd"),
    armor: dm("allArmored", 0) ? Math.min(t.armor, 0.6) : t.armor, // evento "Marcha Blindada"
    burn: 0,
    aura: Math.random() < 0.2 ? SHAPE_KEYS[Math.floor(Math.random() * 3)] : null, // 1/5 nasce com aura (ameaça)
  });
}

function addFloat(x, y, txt, color) {
  // Números de dano (texto que começa com "-dígito", ex.: "-30", "-50 ⚡"): respeitam a config.
  if (!SETTINGS.dmgNumbers && /^-\d/.test(txt)) return;
  S.floats.push({ x, y, txt, color, life: 1.1, max: 1.1 });
}

// Modos de mira configuráveis por torre (clique na torre). "near" = neutro/padrão.
const AIM_MODES = {
  near:   { icon: "🎯", name: "Mais próximo", desc: "mira o inimigo mais perto da muralha (padrão)" },
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
  return TOWER_TYPES[t.type].rate / ((1 + rateBonus() + moralBoost()) * (1 + (fx.r || 0)) * prestigeRateMult(t));
}
// Dano global das torres contra as tropas — subido para acompanhar hordas maiores/mais densas.
const TROOP_DMG_MULT = 1.3;
function towerDmg(t) {
  const fx = towerFx(t);
  const typeDmg = towerTypeFx(t.type, "typeDmg");
  return TOWER_TYPES[t.type].dmg * TROOP_DMG_MULT * lawTowerMult(t)
    * (1 + (fx.d || 0)) * (1 + typeDmg) * Math.pow(1.22, t.lvl - 1) * prestigeDmgMult(t)
    * moraleEffMult() * dm("towerDmg") * facTowerMult(); // leis + moral + evento + facção + prestígio

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
    addResource(b.res, b.yield * idxs.length * mioloYieldMult() * feudOverdriveMult() * dt / FEED_TURN_SECONDS);
  }
}
function tickSupplyChain(dt) {
  tickExtractProd(dt);
  tickTanks(dt);
  tickProduction(dt);
  supplyTimer -= dt;
  if (supplyTimer <= 0) { dispatchCrates(); supplyTimer = supplyInterval(); }
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
  const jobs = [], overflow = [];
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
  // A Medalha (100 ▸ 1) só é creditada quando a caixa chega ao fim.
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
        if (!t.ammoBy) t.ammoBy = {};
        t.ammoBy[type] = Math.min(ammoCap(), ammoOf(t, type) + amount);
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
    addFloat(lane, 0.9, "◈ SELO ROMPIDO", "#c89aff");
    for (const o of S.enemies) if (o.lane === lane) o.hp = -999; // sem recompensa
    return;
  }
  S.wallChip = (S.wallChip || 0) + dmg;
  if (S.wallChip < WALL_CHIP_PER_HIT) { addFloat(lane, 0.95, "🧱 lascou", "#c8b088"); return; }
  S.wallChip -= WALL_CHIP_PER_HIT;
  S.hits--;
  S.turnHitsLost++;
  addFloat(lane, 0.95, "🧱 MURALHA ATINGIDA", "#e05f5f");
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
    if (fx.critC && Math.random() < fx.critC) { dmg *= (fx.critM || 2); }
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
    addFloat(e.lane, e.y - 0.04, `-${dealt}`, p.magic ? "#c89aff" : p.chain ? "#8ae0ff" : "#eecd5c");
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
  if ($("menu").classList.contains("hidden")) tickSupplyChain(dt);
  if (S.towerBuff && S.towerBuff.t > 0) S.towerBuff.t -= dt; // Infusor Arcano (buff de tropas)
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
    if (a.hp <= 0 && a.type !== "sombra") addFloat(a.lane, a.y, "☠ tombou", "#c8b088");
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
    let burst = 2 + Math.floor(S.day / 3.0) + (bloodMoon() ? 2 : 0);
    // Onda de aglomeração: de vez em quando uma leva bem maior desaba de uma vez (pico de tensão).
    const surge = Math.random() < 0.22 + Math.min(0.18, Math.max(0, S.day - 8) * 0.015);
    if (surge) burst = Math.round(burst * 1.9);
    burst = Math.min(spawnQueue.length, burst);
    const lanes = [0, 1, 2, 3, 4].sort(() => Math.random() - 0.5);
    for (let b = 0; b < burst; b++) {
      const _wt = warnTime();
      S.warnings.push({ lane: lanes[b % LANES], t: _wt, tMax: _wt, type: spawnQueue.shift() });
    }
    // Levas chegam mais rápido no mid-end; após uma aglomeração, um respiro maior antes da próxima.
    spawnTimer = Math.max(1.9, 2.9 - Math.max(0, S.day - 10) * 0.05) + (surge ? 2.4 : 0);
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
      if (tt.support === "heal") { const h = 4 + t.lvl; for (const a of S.allies) healAlly(a, h); }
      else if (tt.support === "buff") { S.towerBuff = { atk: 0.25, t: towerRate(t) + 0.5 }; }
      else if (tt.support === "mage") {
        // Escola de Magos: rompe os selos (armadura) dos inimigos perto da muralha
        // e reforça os aliados com uma aura aleatória (ataque OU cura).
        for (const e of S.enemies) {
          if (e.y > 0.6 && e.armor < 1) {
            e.armor = 1; e.vuln = Math.max(e.vuln || 0, 0.15);
            addFloat(e.lane, e.y - 0.04, "◈ selo rompido", "#c89aff");
          }
        }
        if (Math.random() < 0.5) { const h = 5 + t.lvl; for (const a of S.allies) healAlly(a, h); }
        else { S.towerBuff = { atk: 0.2, t: towerRate(t) + 0.5 }; }
      }
      else if (tt.support === "charm") {
        // Máquina de Propaganda: às vezes vira uma tropa inimiga contra os seus.
        const cands = S.enemies.filter(e => e.hp > 0 && !(e.charm > 0));
        if (cands.length && Math.random() < 0.6) {
          const e = cands[Math.floor(Math.random() * cands.length)];
          e.charm = 4;
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
      t: 0, dur: tt.ptime * (fx.fast ? 0.4 : 1),
      dmg: towerDmg(t), aoe: (tt.aoe || (fx.aoeOn ? 0.5 : 0)) * (1 + (fx.aoeM || 0)),
      magic: tt.magic, chain: (tt.chain ? tt.chain + (fx.chain || 0) : (fx.chain ? 1 + fx.chain : 0)) + (tt.magic && law("L42") ? 1 : 0),
      slow: tt.slow, pierce: tt.pierce || 0, boomerang: tt.boomerang, fx,
    });
    // alvos extras (tiros gêmeos, ricochetes, marés...)
    for (let x = 0; x < (fx.extra || 0) && targets.length > x + 1; x++) {
      const t2 = targets[x + 1];
      S.projectiles.push({
        type: t.type, fromLane: i, target: t2, ex: t2.lane, ey: t2.y,
        t: 0, dur: tt.ptime * (fx.fast ? 0.4 : 1),
        dmg: towerDmg(t) * 0.8, aoe: 0, magic: tt.magic, chain: 0, fx,
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
      // selo de proteção: limpa a lane inteira e desaparece
      if (S.seals[e.lane]) {
        S.seals[e.lane] = 0;
        S.sweeps.push({ lane: e.lane, y: 1 });
        addFloat(e.lane, 0.9, "◈ SELO ROMPIDO", "#c89aff");
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
  for (const e of dead) {
    // Roxo (Magia negra): chance do morto ressurgir como Sombra aliada temporária
    const spChance = facSpectralChance();
    if (spChance && Math.random() < spChance && S.allies.length < ALLY_LIMIT) {
      const hp = Math.round(20 * allyHpMult());
      // Sombras nascem do pacto roxo: já juram a ideologia Roxa
      S.allies.push({ type: "sombra", fac: "purple", lane: e.lane, y: e.y, hp, maxHp: hp, state: "idle", ttl: facSpectralTtl() });
      addFloat(e.lane, e.y - 0.05, "👻 Sombra!", "#c89aff");
    }
    const t = ENEMY_TYPES[e.type];
    const g = Math.round(t.gold * killGoldMult()) + (e.bountyG || 0);
    earnGold(g);
    addFloat(e.lane, e.y, `+${g} 🪙`, "#eecd5c");
    if (Math.random() < (t.heart + mioloHeartBonus() + (e.bountyH || 0)) * heartChanceMult()) {
      S.hearts++;
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

function endWave() {
  S.waveActive = false;
  tickExtractors(); // O Feudo produz e desgasta a cada turno
  favPunishTick();  // punições ativas dos Favores (Rei/Conde)
  $("conveyor").classList.remove("running");
  $("conveyor-v").classList.remove("running");
  S.projectiles = []; S.eshots = []; S.effects = []; S.floats = []; S.groundFires = [];
  let income = Math.round((90 + S.day * 3 + pracaPublicaGold() + incomeBonus()) * globalIncM() * moraleEffMult() * dm("income") * facIncomeMult() * mioloIncomeMult() * lawIncomeMult());
  income += 8 * groupLvlSum("tesouraria"); // Tesouraria
  income += 5 * groupLvlSum("praca_chique") + 4 * groupLvlSum("praca_abandonada"); // Praça Chique / Abandonada
  income -= cityFxScan(c => c.built === "quartel", "gUp"); // soldo da Guarda Real
  earnGold(Math.max(0, income));
  S.hearts += heartsPerTurn();
  // Procissão/Dia Sagrado: 💎 por turno perfeito
  if (S.turnHitsLost === 0) S.hearts += cityFxScan(null, "hNoHit");
  // Motor de Argamato consome 💎; Autômato Reparador conserta a muralha
  S.hearts = Math.max(0, S.hearts - cityFxScan(null, "hUp"));
  let rep = cityFxScan(null, "repair") + groupLvlSum("oficina") + (law("L23") ? 1 : 0); // Oficina + Requisição de Pedra
  if (rep) {
    rep += (law("L27") ? 1 : 0) + (law("L46") ? 1 : 0); // Muros Modulares / Cidadela de Ferro rendem mais
    S.hits = Math.min(maxHits(), S.hits + rep);
  }
  if (groupLvlSum("templo")) gainMorale(3 * groupLvlSum("templo")); // Templo da Fé
  if (groupLvlSum("praca_festival")) gainMorale(2 * groupLvlSum("praca_festival")); // Praça do Festival
  const aband = groupLvlSum("praca_abandonada"); // Praça Abandonada: saque rende ouro mas assusta
  if (aband) { S.morale -= aband; clampMorale(); }
  if (S.capataz && !law("L47")) { S.morale -= CAPATAZ_MORALE; clampMorale(); addFloat(2, 0.55, `👊 Capataz: -${CAPATAZ_MORALE} moral`, "#e0705f"); } // Motor Perpétuo isenta
  if (S.feudAid) { // Pedir Ajuda: o Reino manda materiais brutos, mas admitir fraqueza assusta o povo
    for (const k of Object.keys(RESOURCES)) addResource(k, FEUD_AID_RES);
    S.morale -= FEUD_TOGGLE_MORALE; clampMorale();
    addFloat(2, 0.62, `🆘 Pedir Ajuda: -${FEUD_TOGGLE_MORALE} moral`, "#e0705f");
  }
  if (S.feudOverdrive) { // Sobrecarga: extratores no limite, trabalhadores exaustos
    S.morale -= FEUD_TOGGLE_MORALE; clampMorale();
    addFloat(2, 0.69, `⚙️ Sobrecarga: -${FEUD_TOGGLE_MORALE} moral`, "#e0705f");
  }
  // Praça Estranha: bônus caótico por nível (ouro / moral / 💎)
  for (let k = 0; k < groupLvlSum("praca_estranha"); k++) {
    const r = Math.random();
    if (r < 0.34) { earnGold(10); addFloat(2, 0.5, "🌀 +10 🪙", "#eecd5c"); }
    else if (r < 0.67) { gainMorale(3); addFloat(2, 0.5, "🌀 +3 moral", "#8ac6f0"); }
    else { S.hearts += 1; addFloat(2, 0.5, "🌀 +1 💎", "#c89aff"); }
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
  else if (lawM < 0) { S.morale += lawM; clampMorale(); }
  if (law("L1")) addResource("comida", 1); // Ração Justa
  // Moral: resultado do turno. Turno perfeito sobe a Esperança; hits perdidos sobem o Medo
  if (S.turnHitsLost === 0) gainMorale(5 + (law("L2") ? 2 : 0)); // turno perfeito (+Festivais)
  else {
    let loss = -9 * S.turnHitsLost;
    if (law("L26")) loss *= 0.75;              // Abrigos Subterrâneos
    if (S.isNight && law("L37")) loss *= 0.75; // Lampiões de Argamato
    S.morale += loss; clampMorale();
  }
  S.freeConjure = law("L43") && S.turnHitsLost === 0; // Olho do Turbilhão
  const wasNight = S.isNight;
  if (wasNight && bloodMoon()) S.redMoons++; // sobreviveu a uma lua vermelha
  if (wasNight && S.day % 10 === 5) S.blackSuns++; // sobreviveu ao dia de Sol Negro
  if (S.isNight) { S.isNight = false; S.day++; } else { S.isNight = true; }
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
    const evento = bloodMoon() ? "\n\n🩸 LUA SANGRENTA se aproxima: a horda virá mais forte e mais numerosa!"
      : blackSun() ? "\n\n🌑 SOL NEGRO: a eficiência da cidade caiu pela metade neste turno."
      : "";
    saveGame();
    if (S.autoTurn) { addFloat(2, 0.15, `+${income} 🪙 · 🌙`, "#eecd5c"); scheduleAuto(); }
    else showOverlay("A noite se aproxima 🌙",
      `A muralha resistiu (${S.hits}/${maxHits()} hits).\n+${income} 🪙 do conselho da cidade.${evento}\n\nO vigia observa o horizonte, toque no astro da noite para ver o que vem.`);
  }
  renderAll();
}

// Card do Evento Diário (ao amanhecer)
function showDailyEvent(ev, income) {
  const tierTxt = S.moraleLocked ? `\n\nO distrito está em ${moraleName(S.moraleLocked)}.` : "";
  showOverlay(`${ev.ic} Dia ${S.day}: ${ev.t}`,
    `${ev.s}\n\n${effectText(ev)}\n+${income} 🪙 do conselho da cidade.${tierTxt}`);
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
    `Os registros da guarda arderam com a muralha, e o silêncio tomou o Distrito.\n\n` +
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
  const { day, isNight, hits, gold, hearts, won, kills, goldEarned, redMoons, blackSuns, mvpNotice, morale, moraleLocked, dayMods, lastEvent, eventLog, fav, sector, sectorId, sectorDir, factions, purpleThisRun, darkChain, towers, city, feud, field, res, maos, nextGid, laws, conjCount, freeConjure, allies, gateAuto, gateMode, gatePref, gateFac, seals, helpKingdom, capataz, helpPool, feudAid, feudOverdrive } = S;
  return { day, isNight, hits, gold, hearts, won, kills, goldEarned, redMoons, blackSuns, mvpNotice, morale, moraleLocked, dayMods, lastEvent, eventLog, fav, sector, sectorId, sectorDir, factions, purpleThisRun, darkChain, towers, city, feud, field, res, maos, nextGid, laws, conjCount, freeConjure, allies, gateAuto, gateMode, gatePref, gateFac, seals, helpKingdom, capataz, helpPool, feudAid, feudOverdrive };
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
  if (typeof S.blackSuns !== "number") S.blackSuns = 0; // saves antigos
  if (typeof S.goldEarned !== "number") S.goldEarned = 0; // saves antigos
  if (typeof S.sectorId !== "number" || !S.sectorId) S.sectorId = randomSectorId(); // saves antigos
  if (!S.sectorDir) S.sectorDir = randomSectorDir(); // saves antigos
  if (!S.feedEff || typeof S.feedEff !== "object") S.feedEff = {};
  if (typeof S.helpPool !== "number") { S.helpPool = 0; S.helpKingdom = false; S.capataz = false; }
  if (!Array.isArray(S.laws)) { S.laws = []; S.conjCount = 0; S.freeConjure = false; } // saves antigos (árvores de leis)
  // migração de torres: descarta tipos removidos (bombarda/fornalha/bobina); ammo → ammoBy
  S.towers = (S.towers || [null, null, null, null, null]).map(t => {
    if (!t || !TOWER_TYPES[t.type]) return null;
    t.cd = 0;
    if (!t.ammoBy) t.ammoBy = typeof t.ammo === "number" ? { [towerAmmos(t.type)[0]]: t.ammo } : {};
    delete t.ammo;
    return t;
  });
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
    towers: [null, null, null, null, null],
    res: (function () { const b = MIOLO.celeiros.per * mioloLvl("celeiros"); return { minerio: 30 + b, combustivel: 30 + b, bens: 30 + b, comida: 30 + b }; })(),
    maos: Math.min(MAOS_CAP_MAX, MAOS_CAP_BASE + MIOLO.guilda.per * mioloLvl("guilda")), feedEff: {},
    debug: { god: false, speed: 1 },
  });
  initCity();
  buildNextWave();
  renderAll();
}

// ---------- Overlay ----------
let overlayCb = null;
function showOverlay(title, text, cb) {
  $("overlay-title").textContent = title;
  $("overlay-text").textContent = text;
  overlayCb = cb || null;
  $("overlay").classList.remove("hidden");
}
$("overlay-btn").onclick = () => {
  $("overlay").classList.add("hidden");
  if (overlayCb) { const f = overlayCb; overlayCb = null; f(); }
};

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
const PEBBLES = Array.from({ length: 70 }, () => ({
  x: Math.random(), y: Math.random(),
  r: Math.random() * 2.2 + 0.6,
  dark: Math.random() < 0.5,
}));
const PATCHES = Array.from({ length: 12 }, () => ({
  x: Math.random(), y: Math.random(),
  rx: Math.random() * 40 + 22, ry: Math.random() * 14 + 8,
}));

function draw() {
  resizeCanvas(); // mantém o backing store alinhado ao tamanho exibido (astro sempre circular)
  const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  const laneW = w / LANES;
  const fullMoon = S.isNight && moonPhase();

  const ground = ctx.createLinearGradient(0, 0, 0, h);
  ground.addColorStop(0, "#4a3826");
  ground.addColorStop(1, "#382a19");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(40,28,16,.35)";
  for (const p of PATCHES) {
    ctx.beginPath(); ctx.ellipse(p.x * w, p.y * h, p.rx, p.ry, 0, 0, 7); ctx.fill();
  }

  for (let i = 0; i < LANES; i++) {
    ctx.fillStyle = i % 2 ? "rgba(30,20,10,.22)" : "rgba(30,20,10,.14)";
    ctx.fillRect(i * laneW + 4, 0, laneW - 8, h);
  }
  ctx.strokeStyle = "rgba(110,82,50,.35)";
  ctx.lineWidth = 1;
  for (let i = 1; i < LANES; i++) {
    ctx.beginPath(); ctx.moveTo(i * laneW, 0); ctx.lineTo(i * laneW, h); ctx.stroke();
  }

  for (const p of PEBBLES) {
    ctx.fillStyle = p.dark ? "rgba(30,20,10,.5)" : "rgba(140,115,80,.4)";
    ctx.beginPath(); ctx.arc(p.x * w, p.y * h, p.r, 0, 7); ctx.fill();
  }

  // Astro no topo da lane central; some durante o ataque inimigo.
  const drawAstro = () => {
  if (S.waveActive) return;
  const ax = w / 2, ay = 34;
  // número do dia sobre o astro (badge escuro no centro)
  const drawDayBadge = () => {
    ctx.fillStyle = "rgba(22,15,6,.82)";
    ctx.beginPath(); ctx.arc(ax, ay, 12, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(201,162,39,.55)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(ax, ay, 12, 0, 7); ctx.stroke();
    ctx.fillStyle = "#f5f2ec";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "700 14px Georgia, serif";
    ctx.fillText(S.day, ax, ay + 1);
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
      ctx.drawImage(img, ax - 30, ay - 30, 60, 60);
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
  };

  ctx.fillStyle = "#52422e";
  const mw = w / 15;
  for (let i = 0; i < 15; i += 2) ctx.fillRect(i * mw, h - 8, mw, 8);
  ctx.fillStyle = "#3e3122";
  ctx.fillRect(0, h - 3, w, 3);

  // tochas nas QUINAS dos portões: 6 posições compartilhadas (0..5);
  // a quina acende se um dos portões vizinhos tiver torre.
  const t0 = performance.now() / 1000;
  for (let i = 0; i <= LANES; i++) {
    const lit = (i > 0 && S.towers[i - 1]) || (i < LANES && S.towers[i]);
    if (!lit) continue;
    const tx = i * laneW, ty = h - 8;
    const fl = 6 + Math.sin(t0 * 9 + i * 2) * 1.6;
    const tg = ctx.createRadialGradient(tx, ty, 2, tx, ty, fl * 3.2);
    tg.addColorStop(0, "rgba(240,150,50,.5)"); tg.addColorStop(1, "transparent");
    ctx.fillStyle = tg; ctx.fillRect(tx - fl * 3.5, ty - fl * 3.5, fl * 7, fl * 7);
    // chama pequena no topo da quina
    ctx.fillStyle = "rgba(255,190,90,.85)";
    ctx.beginPath(); ctx.arc(tx, ty - 3, 2 + Math.sin(t0 * 11 + i) * 0.6, 0, 7); ctx.fill();
  }

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
      path(); ctx.fillStyle = `rgba(168,106,224,${0.22 * a * flick})`; ctx.fill();
      path(); ctx.shadowColor = "#a86ae0"; ctx.shadowBlur = 22; ctx.strokeStyle = `rgba(168,106,224,${0.5 * a})`; ctx.lineWidth = 9; ctx.stroke();
      path(); ctx.shadowBlur = 14; ctx.strokeStyle = `rgba(200,154,255,${0.9 * a * flick})`; ctx.lineWidth = 5; ctx.stroke();
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
      { col: "168,106,224", sh: "#a86ae0", blur: 20, wdt: 8,   al: 0.45 },
      { col: "200,154,255", sh: "#a86ae0", blur: 13, wdt: 4.5, al: 0.9 * flick },
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

  // selos de proteção: runa discreta na base de cada lane protegida
  for (let i = 0; i < LANES; i++) {
    if (!S.seals[i]) continue;
    const sx = i * laneW + laneW / 2;
    const pulse = 0.35 + 0.15 * Math.sin(performance.now() / 600 + i);
    ctx.fillStyle = `rgba(200,154,255,${pulse})`;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("◈", sx, h - 12);
  }

  // varredura de selo rompido: onda arcana subindo a lane
  for (const sw of S.sweeps) {
    const sx = sw.lane * laneW, sy = sw.y * h;
    const grad = ctx.createLinearGradient(0, sy - 18, 0, sy + 18);
    grad.addColorStop(0, "transparent");
    grad.addColorStop(0.5, "rgba(200,154,255,.55)");
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fillRect(sx + 2, sy - 18, laneW - 4, 36);
    ctx.fillStyle = "rgba(255,244,255,.85)";
    ctx.fillRect(sx + 2, sy - 1, laneW - 4, 2);
  }

  // fogo no chão
  for (const gf of S.groundFires) {
    const gx = gf.lane * laneW + laneW / 2, gy = gf.y * h;
    const flick = 0.6 + 0.4 * Math.sin(performance.now() / 70 + gf.y * 40);
    const gg = ctx.createRadialGradient(gx, gy, 2, gx, gy, gf.r * h * 1.4);
    gg.addColorStop(0, `rgba(240,140,40,${0.5 * flick * Math.min(1, gf.t)})`);
    gg.addColorStop(1, "transparent");
    ctx.fillStyle = gg;
    ctx.fillRect(gx - gf.r * h * 1.5, gy - gf.r * h * 1.5, gf.r * h * 3, gf.r * h * 3);
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
    if (fx.type === "seal") {
      // flash do selo roxo: onda de choque com brilho + disco esmaecendo
      ctx.save();
      const r = 8 + k * 66;
      ctx.shadowColor = "#a86ae0"; ctx.shadowBlur = 20;
      ctx.strokeStyle = `rgba(200,154,255,${(1 - k) * 0.9})`;
      ctx.lineWidth = 3 + (1 - k) * 4;
      ctx.beginPath(); ctx.arc(fxx, fxy, r, 0, 7); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(168,106,224,${(1 - k) * 0.22})`;
      ctx.beginPath(); ctx.arc(fxx, fxy, r * 0.68, 0, 7); ctx.fill();
      ctx.restore();
      continue;
    }
    // ===== VFX das habilidades do Conselho =====
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

  for (const e of S.enemies) {
    const t = ENEMY_TYPES[e.type];
    const x = e.lane * laneW + laneW / 2, y = e.y * h;
    ctx.font = (t.armor < 1 ? 24 : 20) + "px sans-serif";
    ctx.fillText(e.burn > 0 ? "🔥" : t.icon, x, y);
    if (e._targeted) {
      // alvo de torre: só o círculo de mira ao redor (sem transparência no sprite)
      ctx.strokeStyle = "rgba(255,210,122,.9)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y - 6, 14, 0, 7); ctx.stroke();
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

  // astro por último: inimigos passam por baixo dele
  drawAstro();
}

// ---------- Loop ----------
function tick() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastT) / 1000) * S.debug.speed;
  lastT = now;
  update(dt);
}
function frame() {
  draw();
  requestAnimationFrame(frame);
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
const TUTORIAL_TEXT =
  "Há cem anos os mortos marcham, e Karzstak não pode cair. A Muralha Oeste é sua, o rei te confiou o Cetro Real.\n\nComandante, o muro é seu agora. O anterior... falhou.\n\n1. Construa uma Fábrica de Virotes 🏹 no distrito de baixo.\n2. Construa uma Besta 🏹 num portão, cada torre usa a munição da SUA fábrica.\n3. A esteira abastece por proximidade: torre 5 primeiro, depois 4, 3... e só passa adiante quando a da vez está cheia.\n4. A muralha aguenta 5 HITS. Aperte ▶ Turno e sobreviva.\n\n✍ Desenhe formas no campo: círculo, triângulo ou quadrado sobre suas tropas dá auras (vida, ataque, defesa); a forma exigida sobre um inimigo com aura o dispela. Cada conjuração custa 1 💎.";

function setupMenu() {
  const hasSave = !!localStorage.getItem(SAVE_KEY);
  $("btn-continue").disabled = !hasSave;         // Continuar = slot de retomada da última run
  $("btn-load").disabled = loadSlots().length === 0; // Carregar = lista de saves nomeados/autosaves
  if (hasSave) {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      $("menu-note").textContent = `Registro da guarda: dia ${d.day}, muralha ${d.hits} hit(s).`;
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
  $("menu-help").style.display = name === "home" ? "" : "none"; // "?" da home só na home
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
    d.innerHTML = "Jure a UM <b>Lorde</b>: sua habilidade ativa vale em <b>todas as runs</b>. Dispare no campo por <b>clique-direito</b> (PC) ou <b>3 toques</b> (celular), gastando 💎. Ideologia igual à da run: <b>−1 💎</b>."
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
  besta:       "A primeira arma erguida nas ameias. Cada virote leva o nome de um vigia caído.",
  catapulta:   "Madeira velha, contrapeso e ódio. Arremessa projéteis desde o primeiro cerco.",
  caldeirao:   "A sopa que ninguém quer provar. Ferve dia e noite sobre os portões.",
  tesla:       "Presente das oficinas a vapor: relâmpago engarrafado em bobinas de cobre.",
  canalizador: "Um fio do Turbilhão Nexus corre por este pilar de runas.",
  acido:       "Os alquimistas juram que a chuva verde não mancha a muralha. Mentem.",
  // Torres — Avançadas
  balista:     "Virotes untados em óleo: atravessam três mortos e ainda acendem o quarto.",
  canhao:      "Pólvora e ferro fundido — o rugido que responde ao rugido da horda.",
  cospefogo:   "Construído sobre a boca de uma forja. O fogo nunca dorme, só espera.",
  soprador:    "Sopro do inverno preso em tubos: congela a marcha dos que não sentem frio.",
  prisma:      "Lapidado de um único Coração de Argamato, parte a luz — e os mortos.",
  lancaacido:  "A resposta dos engenheiros à carne que não teme lâminas.",
  // Torres — Icônicas
  mortenegra:  "Dizem que o próprio rei negativo recua quando este sino dobra.",
  apagador:    "Onde dispara, o cronista escreve apenas: 'não sobrou nada'.",
  raiosolar:   "Relíquia da Igreja do Amanhecer: um pedaço do sol que odeia a noite.",
  ritualcura:  "Cânticos antigos costuram os vivos enquanto a batalha ruge.",
  infusor:     "Verte magia pura nas armas vizinhas, gota a gota, como vinho raro.",
  // Edifícios
  quartel:     "Beliches apertados e juramentos: aqui o povo vira guarnição.",
  cortico:     "Tetos baixos, sonhos curtos. É o lar possível atrás da muralha.",
  capela:      "Uma vela por cada tropa que voltou. As paredes já são de cera.",
  estabulo:    "Cavalos nascidos ao som do cerco não conhecem o medo.",
  tesouraria:  "Cofres do reino: até o ouro trabalha na guerra.",
  laboratorio: "Vidros, vapores e teorias proibidas — o amanhã destilado às pressas.",
  templo:      "Ergueram-no em uma noite de lua vermelha. A fé aqui é argamassa.",
  oficina:     "Pedreiros dormem com as botas calçadas: a muralha se recusa a morrer.",
  refinaria:   "Tritura Corações de Argamato até restar só o brilho que move o reino.",
  // Praças — Distrito do Povo
  praca_publica:    "O coração da vizinhança: feira, fofoca e o censo do que ainda vive.",
  praca_festival:   "Uma noite de música por semana. É o que segura o resto delas.",
  praca_jardim:     "Flores em plena guerra são um ato de teimosia — e de cura.",
  praca_chique:     "Os nobres pagam caro para esquecer o cheiro do cerco.",
  praca_cerimonial: "Aqui os caídos viram nomes gravados, e os nomes viram cristal.",
  // Praças — Distrito das Fábricas
  praca_trabalho:   "O sino bate, os turnos trocam, e Karzstak não para.",
  praca_vigia:      "Da torre da praça se vê a horda antes que a horda veja a muralha.",
  praca_militar:    "Recrutas marcham em círculos até o passo virar instinto.",
  praca_abandonada: "Ninguém repara quem entra ou sai. Por isso paga tão bem.",
  praca_estranha:   "As bússolas giram e os gatos evitam o centro. Algo dorme embaixo.",
};
const ARS_PAGES = [
  { kind: "towers",    title: "Escolha suas Torres:" },
  { kind: "buildings", title: "Escolha seus Edifícios:" },
  { kind: "pracas",    title: "Escolha suas Praças:" },
];
let arsPage = 0, arsLastPage = -1;
// texto de traço da torre (mesmo do menu de construção)
function towerTrait(tt) {
  return tt.support === "heal" ? "cura passiva das tropas" :
    tt.support === "buff" ? "fortalece as tropas" :
    tt.support === "mage" ? "rompe selos e reforça tropas" :
    tt.support === "charm" ? "vira inimigos contra os seus" :
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
  $("ars-slots").innerHTML = Array.from({ length: 5 }, (_, i) => `<span class="ars-diamond${i < filled ? " on" : ""}"></span>`).join("");
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
    return `<b>${facIc(k)} ${f.name}</b> são odiados por TODOS: sofrem todas as penalidades — e não impõem penalidade a ninguém.`;
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
      const how = facUnlocked(k) ? "Desbloqueada." : p.dlc ? "DLC — bloqueada." : "Jogue para desbloquear.";
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
    // Segure por 2s para jurar.
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
      }, 2000);
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
  resetGame();
  $("menu").classList.add("hidden");
  showFactionChoose((pick) => {
    S.factions = [pick];
    S.hits = maxHits();       // aplica o bônus/penalidade da muralha já no início
    applyFactionTint();
    // Evento obrigatório do dia 1: aplica o buff e anuncia depois do tutorial.
    applyDailyEvent(DAY1_EVENT);
    S.moraleLocked = moraleTier(S.morale);
    renderAll();
    showOverlay("Muralha Oeste de Karzstak", TUTORIAL_TEXT, () => {
      showOverlay(`${DAY1_EVENT.ic} Dia 1: ${DAY1_EVENT.t}`, `${DAY1_EVENT.s}\n\n${effectText(DAY1_EVENT)}`);
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
$("menu-help").onclick = () => {
  openModal("Karzstak Must Not Fall", (m) => {
    const d = document.createElement("div"); d.className = "panel-hint";
    d.innerHTML = "Há cem anos os mortos marcham, e <b>Karzstak não pode cair</b>. Você é o novo comandante da Muralha Oeste: o rei lhe confiou o Cetro Real.<br><br>"
      + "<b>Como jogar:</b> aperte <b>▶ Turno</b> e sobreviva à horda. Construa <b>fábricas</b> no distrito para abastecer as <b>torres</b> nos portões; erga <b>edifícios</b> para fortalecer a cidade. A muralha aguenta alguns <b>hits</b> — se zerar, a run acaba.<br><br>"
      + "<b>Infinito</b> = sobreviva o máximo que puder. <b>História</b> = campanhas (em breve). <b>Miolo / Conselho / Arsenal</b> = progressão persistente entre runs.";
    m.appendChild(d);
  });
};

// ---------- Início ----------
initCity();
buildNextWave();
resizeCanvas();
renderAll();
setupMenu();
lastT = performance.now();
setInterval(tick, 50);
setInterval(feudBeltTick, 750); // fluxo cosmético de recursos até o Centro de Distribuição do Feudo
requestAnimationFrame(frame);
