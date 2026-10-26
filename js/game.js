// Core game logic for the scavenging minigame.
// Pure functions over a plain JSON state object (safe for localStorage).
// Every mutating function returns a NEW state; inputs are never modified.
// Randomness is injectable via an `rng` parameter (defaults to Math.random).

export const RARITIES = ['common', 'uncommon', 'rare', 'veryRare', 'legendary'];

export const DEFAULT_PAIRS = {
  common: 4,
  uncommon: 3,
  rare: 2,
  veryRare: 1,
  legendary: 1,
  junk: 3,
};

export const FALLBACK_MONSTER = {
  id: '__wandering__',
  name: 'Wandering Monster',
  notes: 'Summoned by a natural 1. DM chooses the creature.',
  icon: { type: 'emoji', value: '👹' },
};

// Phases:
//   awaitRoll  - DM enters the current player's check
//   flipping   - player is flipping cards
//   reveal     - all cards of this try are face up; call resolveReveal()
//   encounter  - a monster was revealed; call resolveEncounter()
//   roundOver  - every player has had a turn; nextRound() or endSession()
//   ended      - session over (see state.endReason)

export function defaultPairsFor(item) {
  if (item.kind === 'junk') return DEFAULT_PAIRS.junk;
  return DEFAULT_PAIRS[item.rarity] ?? 1;
}

export function pairsFor(item) {
  return Number.isInteger(item.pairs) && item.pairs >= 0 ? item.pairs : defaultPairsFor(item);
}

export function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object') return ['Config is missing.'];
  if (!Number.isFinite(config.dc)) errors.push('DC must be a number.');
  if (!Array.isArray(config.players) || config.players.filter((p) => String(p).trim()).length === 0) {
    errors.push('Add at least one player.');
  }
  const items = config.items ?? [];
  const monsters = config.monsters ?? [];
  const ids = new Set();
  for (const def of [...items, ...monsters]) {
    if (!def.id) errors.push(`"${def.name || '?'}" has no id.`);
    else if (ids.has(def.id)) errors.push(`Duplicate id "${def.id}".`);
    ids.add(def.id);
    if (!String(def.name ?? '').trim()) errors.push('Every card needs a name.');
  }
  for (const item of items) {
    if (item.kind !== 'junk' && !RARITIES.includes(item.rarity)) {
      errors.push(`"${item.name}" has an unknown rarity "${item.rarity}".`);
    }
  }
  const totalPairs = items.reduce((n, it) => n + pairsFor(it), 0);
  if (totalPairs === 0) errors.push('The board needs at least one pair of cards.');
  return errors;
}

export function shuffle(array, rng = Math.random) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let uidCounter = 0;
function makeUid(rng) {
  uidCounter += 1;
  return `c${Date.now().toString(36)}${uidCounter.toString(36)}${Math.floor(rng() * 1e6).toString(36)}`;
}

function clone(state) {
  return structuredClone(state);
}

export function createGame(config, rng = Math.random) {
  const errors = validateConfig(config);
  if (errors.length) throw new Error(errors.join(' '));

  const cfg = structuredClone(config);
  cfg.players = cfg.players.map((p) => String(p).trim()).filter(Boolean);
  cfg.items = cfg.items ?? [];
  cfg.monsters = cfg.monsters ?? [];
  cfg.options = { monsterPerRound: false, revealAtEnd: true, ...(cfg.options ?? {}) };

  const deck = [];
  for (const item of cfg.items) {
    const copies = pairsFor(item) * 2;
    for (let i = 0; i < copies; i++) deck.push({ uid: makeUid(rng), defId: item.id, kind: item.kind === 'junk' ? 'junk' : 'item', state: 'down' });
  }
  for (const m of cfg.monsters) {
    const count = Number.isInteger(m.count) && m.count > 0 ? m.count : 0;
    for (let i = 0; i < count; i++) deck.push({ uid: makeUid(rng), defId: m.id, kind: 'monster', state: 'down' });
  }

  return {
    version: 1,
    config: cfg,
    cards: shuffle(deck, rng),
    round: 1,
    turnIndex: 0,
    phase: 'awaitRoll',
    turn: null,
    loot: Object.fromEntries(cfg.players.map((_, i) => [i, []])),
    log: [{ round: 1, text: `Scavenging begins: ${cfg.name || 'Unnamed site'} (DC ${cfg.dc}).` }],
    endReason: null,
  };
}

// ---------- lookups ----------

export function getDef(state, defId) {
  if (defId === FALLBACK_MONSTER.id) return { ...FALLBACK_MONSTER, kind: 'monster' };
  const item = state.config.items.find((d) => d.id === defId);
  if (item) return { ...item, kind: item.kind === 'junk' ? 'junk' : 'item' };
  const monster = state.config.monsters.find((d) => d.id === defId);
  if (monster) return { ...monster, kind: 'monster' };
  return null;
}

export function currentPlayer(state) {
  return state.config.players[state.turnIndex] ?? null;
}

export function faceDownSlots(state) {
  const out = [];
  state.cards.forEach((c, i) => {
    if (c && c.state === 'down') out.push(i);
  });
  return out;
}

export function flipLimit(state) {
  if (!state.turn) return 0;
  return state.turn.mode === 'flip4' ? 4 : 2;
}

// ---------- internal helpers ----------

function addLog(s, text) {
  s.log.push({ round: s.round, player: s.turnIndex, text });
}

function insertMonster(s, rng) {
  const pool = s.config.monsters.length ? s.config.monsters : [FALLBACK_MONSTER];
  const def = pool[Math.floor(rng() * pool.length)];
  const card = { uid: makeUid(rng), defId: def.id, kind: 'monster', state: 'down' };
  const empty = [];
  s.cards.forEach((c, i) => {
    if (!c || c.state === 'removed') empty.push(i);
  });
  let slot;
  if (empty.length) {
    slot = empty[Math.floor(rng() * empty.length)];
    s.cards[slot] = card;
  } else {
    s.cards.push(card);
    slot = s.cards.length - 1;
  }
  return slot;
}

function endIfCleared(s) {
  if (s.phase !== 'ended' && faceDownSlots(s).length === 0) {
    s.phase = 'ended';
    s.endReason = 'cleared';
    addLog(s, 'The site has been picked clean.');
    return true;
  }
  return false;
}

function advanceTurn(s) {
  s.turn = null;
  if (endIfCleared(s)) return;
  if (s.turnIndex + 1 >= s.config.players.length) {
    s.phase = 'roundOver';
    addLog(s, `Round ${s.round} is over.`);
  } else {
    s.turnIndex += 1;
    s.phase = 'awaitRoll';
  }
}

// After a try or an encounter: continue the turn, or move on.
function continueTurn(s) {
  if (s.turn.pendingMonsters.length) {
    s.phase = 'encounter';
    return;
  }
  if (endIfCleared(s)) return;
  if (s.turn.triesLeft > 0) s.phase = 'flipping';
  else advanceTurn(s);
}

// ---------- actions ----------

/**
 * roll: { total: number, nat20?: boolean, nat1?: boolean }
 * Nat 20 always succeeds, nat 1 always fails (and adds a hidden monster).
 */
export function submitRoll(state, roll, rng = Math.random) {
  if (state.phase !== 'awaitRoll') throw new Error(`Cannot roll during phase "${state.phase}".`);
  const nat20 = !!roll.nat20;
  const nat1 = !nat20 && !!roll.nat1;
  const total = Number(roll.total);
  if (!nat20 && !nat1 && !Number.isFinite(total)) throw new Error('Roll total must be a number.');

  const s = clone(state);
  const success = nat20 || (!nat1 && total >= s.config.dc);
  const name = currentPlayer(s);
  s.turn = {
    roll: { total: Number.isFinite(total) ? total : null, nat20, nat1, success },
    mode: nat20 ? 'flip4' : 'normal',
    triesLeft: nat20 ? 1 : success ? 2 : 1,
    flipped: [],
    pendingMonsters: [],
    surprised: false,
    lastResult: null,
  };

  if (nat20) addLog(s, `${name} rolled a natural 20! They may flip 4 cards at once.`);
  else if (nat1) addLog(s, `${name} rolled a natural 1. Something stirs in the dark… (1 try)`);
  else addLog(s, `${name} rolled ${total} vs DC ${s.config.dc}: ${success ? 'success (2 tries)' : 'failure (1 try)'}.`);

  if (nat1) {
    const slot = insertMonster(s, rng);
    s.turn.addedMonsterSlot = slot;
  }

  s.phase = 'flipping';
  if (endIfCleared(s)) s.turn = null;
  return s;
}

export function flipCard(state, slot) {
  if (state.phase !== 'flipping') throw new Error(`Cannot flip during phase "${state.phase}".`);
  const card = state.cards[slot];
  if (!card || card.state !== 'down') throw new Error(`Slot ${slot} cannot be flipped.`);

  const s = clone(state);
  const t = s.turn;
  s.cards[slot].state = 'up';
  t.flipped.push(slot);
  const c = s.cards[slot];

  if (t.mode === 'normal' && c.kind === 'monster') {
    // Monster ends the try immediately; any other face-up card goes back down.
    for (const other of t.flipped) {
      if (other !== slot) s.cards[other].state = 'down';
    }
    t.flipped = [];
    t.triesLeft -= 1;
    t.pendingMonsters = [slot];
    t.surprised = false;
    addLog(s, `${currentPlayer(s)} uncovered ${getDef(s, c.defId).name}! Combat begins.`);
    s.phase = 'encounter';
    return s;
  }

  const remaining = faceDownSlots(s).length;
  if (t.flipped.length >= flipLimit(s) || remaining === 0) {
    s.phase = 'reveal';
    t.lastResult = computeResult(s, t.flipped);
  }
  return s;
}

function computeResult(s, slots) {
  const byDef = new Map();
  const monsters = [];
  for (const slot of slots) {
    const c = s.cards[slot];
    if (c.kind === 'monster') {
      monsters.push(slot);
      continue;
    }
    if (!byDef.has(c.defId)) byDef.set(c.defId, []);
    byDef.get(c.defId).push(slot);
  }
  const matches = [];
  const unmatched = [];
  for (const [defId, group] of byDef) {
    let i = 0;
    for (; i + 1 < group.length; i += 2) matches.push({ defId, slots: [group[i], group[i + 1]] });
    if (i < group.length) unmatched.push(group[i]);
  }
  return { matches, unmatched, monsters };
}

/** Apply the face-up cards of the current try: award matches, flip back the rest. */
export function resolveReveal(state) {
  if (state.phase !== 'reveal') throw new Error(`Cannot resolve reveal during phase "${state.phase}".`);
  const s = clone(state);
  const t = s.turn;
  const { matches, unmatched, monsters } = t.lastResult;
  const name = currentPlayer(s);

  for (const m of matches) {
    const def = getDef(s, m.defId);
    for (const slot of m.slots) s.cards[slot].state = 'removed';
    if (def.kind === 'junk') {
      addLog(s, `${name} matched ${def.name}. Just junk.`);
    } else {
      s.loot[s.turnIndex].push({ defId: def.id, name: def.name, rarity: def.rarity, round: s.round });
      addLog(s, `${name} found ${def.name}!`);
    }
  }
  for (const slot of unmatched) s.cards[slot].state = 'down';
  if (!matches.length && !monsters.length) addLog(s, `${name} found no match.`);

  t.flipped = [];
  t.triesLeft -= 1;
  if (monsters.length) {
    t.pendingMonsters = monsters.slice();
    t.surprised = t.mode === 'flip4';
    for (const slot of monsters) {
      addLog(s, `${name} uncovered ${getDef(s, s.cards[slot].defId).name}!${t.surprised ? ' The monster is surprised.' : ''}`);
    }
  }
  continueTurn(s);
  return s;
}

/** The monster currently being fought, or null. */
export function currentEncounter(state) {
  if (state.phase !== 'encounter' || !state.turn?.pendingMonsters.length) return null;
  const slot = state.turn.pendingMonsters[0];
  return { slot, def: getDef(state, state.cards[slot].defId), surprised: state.turn.surprised };
}

/** outcome: 'victory' | 'fled' | 'defeat' */
export function resolveEncounter(state, outcome) {
  if (state.phase !== 'encounter') throw new Error(`No encounter to resolve (phase "${state.phase}").`);
  const s = clone(state);
  const t = s.turn;
  const slot = t.pendingMonsters.shift();
  const def = getDef(s, s.cards[slot].defId);
  const name = currentPlayer(s);

  if (outcome === 'victory') {
    s.cards[slot].state = 'removed';
    addLog(s, `${def.name} was defeated.`);
    continueTurn(s);
  } else if (outcome === 'fled') {
    // Fled monsters (and any still waiting) go back face down as known dangers.
    for (const m of [slot, ...t.pendingMonsters]) {
      s.cards[m].state = 'down';
      s.cards[m].known = true;
    }
    t.pendingMonsters = [];
    t.triesLeft = 0;
    addLog(s, `${name} fled from ${def.name}. Their search is over for this round.`);
    advanceTurn(s);
  } else if (outcome === 'defeat') {
    s.cards[slot].state = 'down';
    s.cards[slot].known = true;
    s.phase = 'ended';
    s.endReason = 'defeat';
    s.turn = null;
    addLog(s, `The party was defeated by ${def.name}. Scavenging ends.`);
  } else {
    throw new Error(`Unknown encounter outcome "${outcome}".`);
  }
  return s;
}

/** DM forfeits the current player's remaining tries (or skips their roll). */
export function endTurn(state) {
  if (!['awaitRoll', 'flipping'].includes(state.phase)) throw new Error(`Cannot end turn during phase "${state.phase}".`);
  const s = clone(state);
  if (s.turn) {
    for (const slot of s.turn.flipped) s.cards[slot].state = 'down';
  }
  addLog(s, `${currentPlayer(s)} ends their turn.`);
  advanceTurn(s);
  return s;
}

export function nextRound(state, rng = Math.random) {
  if (state.phase !== 'roundOver') throw new Error(`Cannot start a new round during phase "${state.phase}".`);
  const s = clone(state);
  s.round += 1;
  s.turnIndex = 0;
  s.phase = 'awaitRoll';
  s.turn = null;
  addLog(s, `Round ${s.round} begins.`);
  if (s.config.options.monsterPerRound) {
    insertMonster(s, rng);
    addLog(s, 'Your searching has drawn attention… a monster lurks somewhere.');
  }
  return s;
}

export function endSession(state) {
  if (state.phase === 'ended') return state;
  if (['reveal', 'encounter'].includes(state.phase)) throw new Error(`Finish the current ${state.phase} first.`);
  const s = clone(state);
  if (s.turn) for (const slot of s.turn.flipped) s.cards[slot].state = 'down';
  s.turn = null;
  s.phase = 'ended';
  s.endReason = 'manual';
  addLog(s, 'The party stops scavenging.');
  return s;
}

// ---------- summaries ----------

/** Unfound cards grouped by definition: [{ def, copies }] (monsters and junk included). */
export function unfoundCards(state) {
  const counts = new Map();
  for (const c of state.cards) {
    if (c && c.state !== 'removed') counts.set(c.defId, (counts.get(c.defId) ?? 0) + 1);
  }
  return [...counts].map(([defId, copies]) => ({ def: getDef(state, defId), copies }));
}

const RARITY_LABEL = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  veryRare: 'Very Rare',
  legendary: 'Legendary',
};

export function rarityLabel(rarity) {
  return RARITY_LABEL[rarity] ?? rarity;
}

export function lootSummaryText(state) {
  const lines = [`Scavenging: ${state.config.name || 'Unnamed site'} (DC ${state.config.dc}, ${state.round} round${state.round === 1 ? '' : 's'})`];
  state.config.players.forEach((player, i) => {
    lines.push('', `${player}:`);
    const items = state.loot[i] ?? [];
    if (!items.length) lines.push('  (nothing)');
    for (const entry of items) {
      const def = getDef(state, entry.defId);
      const desc = def?.description ? ` - ${def.description}` : '';
      lines.push(`  - ${entry.name} [${rarityLabel(entry.rarity)}]${desc}`);
    }
  });
  return lines.join('\n');
}
