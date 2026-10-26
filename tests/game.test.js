import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, validateConfig, submitRoll, flipCard, resolveReveal, resolveEncounter,
  currentEncounter, endTurn, nextRound, endSession, unfoundCards, lootSummaryText,
  defaultPairsFor, faceDownSlots, FALLBACK_MONSTER,
} from '../js/game.js';

function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const emoji = (value) => ({ type: 'emoji', value });

function baseConfig(overrides = {}) {
  return {
    name: 'Test Site',
    dc: 12,
    players: ['Ana', 'Bo'],
    items: [
      { id: 'potion', name: 'Potion', kind: 'item', rarity: 'common', icon: emoji('🧪') },
      { id: 'ring', name: 'Ring', kind: 'item', rarity: 'legendary', description: 'Shiny.', icon: emoji('💍') },
      { id: 'bone', name: 'Bone', kind: 'junk', icon: emoji('🦴') },
    ],
    monsters: [{ id: 'rat', name: 'Giant Rat', count: 1, icon: emoji('🐀') }],
    ...overrides,
  };
}

// Replace the shuffled board with a known layout. defIds: array of def ids (null = empty slot).
function withBoard(state, defIds) {
  const kindOf = (id) => (id === 'rat' || id === FALLBACK_MONSTER.id ? 'monster' : id === 'bone' ? 'junk' : 'item');
  return {
    ...state,
    cards: defIds.map((id, i) => (id ? { uid: `u${i}`, defId: id, kind: kindOf(id), state: 'down' } : null)),
  };
}

test('default pairs follow rarity, junk has 3', () => {
  assert.equal(defaultPairsFor({ rarity: 'common' }), 4);
  assert.equal(defaultPairsFor({ rarity: 'uncommon' }), 3);
  assert.equal(defaultPairsFor({ rarity: 'rare' }), 2);
  assert.equal(defaultPairsFor({ rarity: 'veryRare' }), 1);
  assert.equal(defaultPairsFor({ rarity: 'legendary' }), 1);
  assert.equal(defaultPairsFor({ kind: 'junk' }), 3);
});

test('createGame builds the deck from pair counts and monster counts', () => {
  const g = createGame(baseConfig(), seeded());
  // potion 4 pairs + ring 1 pair + bone 3 pairs = 8 pairs = 16 cards, + 1 monster
  assert.equal(g.cards.length, 17);
  assert.equal(g.cards.filter((c) => c.defId === 'potion').length, 8);
  assert.equal(g.cards.filter((c) => c.kind === 'monster').length, 1);
  assert.equal(g.phase, 'awaitRoll');
  assert.ok(g.cards.every((c) => c.state === 'down'));
});

test('pairs override is respected', () => {
  const cfg = baseConfig();
  cfg.items[0].pairs = 1;
  const g = createGame(cfg, seeded());
  assert.equal(g.cards.filter((c) => c.defId === 'potion').length, 2);
});

test('validateConfig reports problems', () => {
  assert.deepEqual(validateConfig(baseConfig()), []);
  assert.ok(validateConfig(baseConfig({ players: [] })).length);
  assert.ok(validateConfig(baseConfig({ dc: 'x' })).length);
  assert.ok(validateConfig(baseConfig({ items: [] })).length);
  const dup = baseConfig();
  dup.monsters[0].id = 'potion';
  assert.ok(validateConfig(dup).some((e) => e.includes('Duplicate')));
  assert.throws(() => createGame(baseConfig({ players: [] })));
});

test('failed check gives 1 try, success gives 2, ties succeed', () => {
  const g = createGame(baseConfig(), seeded());
  assert.equal(submitRoll(g, { total: 11 }).turn.triesLeft, 1);
  assert.equal(submitRoll(g, { total: 12 }).turn.triesLeft, 2);
  assert.equal(submitRoll(g, { total: 30 }).turn.mode, 'normal');
});

test('nat 20 gives one 4-card flip even if total is low; nat 1 fails even if total is high', () => {
  const g = createGame(baseConfig(), seeded());
  const n20 = submitRoll(g, { total: 3, nat20: true });
  assert.equal(n20.turn.mode, 'flip4');
  assert.equal(n20.turn.triesLeft, 1);
  assert.equal(n20.turn.roll.success, true);
  const n1 = submitRoll(g, { total: 25, nat1: true }, seeded(3));
  assert.equal(n1.turn.roll.success, false);
  assert.equal(n1.turn.triesLeft, 1);
});

test('nat 1 adds a hidden monster, growing the board when there is no empty slot', () => {
  const g = createGame(baseConfig(), seeded());
  const s = submitRoll(g, { total: 1, nat1: true }, seeded(5));
  assert.equal(s.cards.length, g.cards.length + 1);
  assert.equal(s.cards.filter((c) => c.kind === 'monster').length, 2);
  assert.equal(s.cards[s.turn.addedMonsterSlot].state, 'down');
});

test('nat 1 monster fills an empty slot when one exists', () => {
  let g = withBoard(createGame(baseConfig(), seeded()), ['potion', null, 'potion', 'ring', 'ring']);
  g.cards[3].state = 'removed';
  g.cards[4].state = 'removed';
  const s = submitRoll(g, { total: 1, nat1: true }, seeded(7));
  assert.equal(s.cards.length, 5);
  assert.ok([1, 3, 4].includes(s.turn.addedMonsterSlot));
  assert.equal(s.cards[s.turn.addedMonsterSlot].kind, 'monster');
});

test('nat 1 with no monsters configured uses the fallback monster', () => {
  const g = createGame(baseConfig({ monsters: [] }), seeded());
  const s = submitRoll(g, { total: 1, nat1: true }, seeded());
  assert.equal(s.cards[s.turn.addedMonsterSlot].defId, FALLBACK_MONSTER.id);
});

test('a match awards loot to the current player and removes the cards', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['ring', 'potion', 'ring', 'potion']);
  s = submitRoll(s, { total: 15 });
  s = flipCard(s, 0);
  assert.equal(s.phase, 'flipping');
  s = flipCard(s, 2);
  assert.equal(s.phase, 'reveal');
  assert.equal(s.turn.lastResult.matches.length, 1);
  s = resolveReveal(s);
  assert.equal(s.cards[0].state, 'removed');
  assert.equal(s.cards[2].state, 'removed');
  assert.deepEqual(s.loot[0].map((l) => l.defId), ['ring']);
  assert.equal(s.phase, 'flipping');
  assert.equal(s.turn.triesLeft, 1);
});

test('a mismatch flips cards back and uses the try; turn passes when tries run out', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['ring', 'potion', 'ring', 'potion']);
  s = submitRoll(s, { total: 1 });
  s = flipCard(flipCard(s, 0), 1);
  s = resolveReveal(s);
  assert.equal(s.cards[0].state, 'down');
  assert.equal(s.cards[1].state, 'down');
  assert.equal(s.turnIndex, 1);
  assert.equal(s.phase, 'awaitRoll');
  assert.equal(s.loot[0].length, 0);
});

test('junk matches give nothing', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['bone', 'bone', 'potion', 'potion']);
  s = submitRoll(s, { total: 1 });
  s = resolveReveal(flipCard(flipCard(s, 0), 1));
  assert.equal(s.cards[0].state, 'removed');
  assert.equal(s.loot[0].length, 0);
});

test('cannot flip a face-up or removed card, or flip outside the flipping phase', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['ring', 'potion', 'ring', 'potion']);
  assert.throws(() => flipCard(s, 0));
  s = flipCard(submitRoll(s, { total: 15 }), 0);
  assert.throws(() => flipCard(s, 0));
});

test('monster as first card starts an encounter and consumes the try', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['rat', 'potion', 'potion', 'ring', 'ring']);
  s = submitRoll(s, { total: 15 });
  s = flipCard(s, 0);
  assert.equal(s.phase, 'encounter');
  assert.equal(s.turn.triesLeft, 1);
  const enc = currentEncounter(s);
  assert.equal(enc.def.name, 'Giant Rat');
  assert.equal(enc.surprised, false);
});

test('monster as second card flips the first card back down', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['potion', 'rat', 'potion', 'ring', 'ring']);
  s = submitRoll(s, { total: 15 });
  s = flipCard(flipCard(s, 0), 1);
  assert.equal(s.phase, 'encounter');
  assert.equal(s.cards[0].state, 'down');
  assert.equal(s.turn.flipped.length, 0);
});

test('victory removes the monster and the turn continues', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['rat', 'potion', 'potion', 'ring', 'ring']);
  s = flipCard(submitRoll(s, { total: 15 }), 0);
  s = resolveEncounter(s, 'victory');
  assert.equal(s.cards[0].state, 'removed');
  assert.equal(s.phase, 'flipping');
  assert.equal(s.turn.triesLeft, 1);
});

test('victory on the last try passes the turn', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['rat', 'potion', 'potion', 'ring', 'ring']);
  s = flipCard(submitRoll(s, { total: 1 }), 0);
  s = resolveEncounter(s, 'victory');
  assert.equal(s.phase, 'awaitRoll');
  assert.equal(s.turnIndex, 1);
});

test('fleeing puts the monster back face down as known, and loses remaining tries', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['rat', 'potion', 'potion', 'ring', 'ring']);
  s = flipCard(submitRoll(s, { total: 15 }), 0);
  s = resolveEncounter(s, 'fled');
  assert.equal(s.cards[0].state, 'down');
  assert.equal(s.cards[0].known, true);
  assert.equal(s.turnIndex, 1);
  assert.equal(s.phase, 'awaitRoll');
});

test('defeat ends the session but keeps loot', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['ring', 'ring', 'rat', 'potion', 'potion']);
  s = submitRoll(s, { total: 15 });
  s = resolveReveal(flipCard(flipCard(s, 0), 1));
  s = flipCard(s, 2);
  s = resolveEncounter(s, 'defeat');
  assert.equal(s.phase, 'ended');
  assert.equal(s.endReason, 'defeat');
  assert.equal(s.loot[0].length, 1);
});

test('nat 20 flips 4 cards and scores every pair among them', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['potion', 'ring', 'potion', 'ring', 'bone', 'bone']);
  s = submitRoll(s, { total: 20, nat20: true });
  for (const slot of [0, 1, 2]) {
    s = flipCard(s, slot);
    assert.equal(s.phase, 'flipping');
  }
  s = flipCard(s, 3);
  assert.equal(s.phase, 'reveal');
  s = resolveReveal(s);
  assert.deepEqual(s.loot[0].map((l) => l.defId).sort(), ['potion', 'ring']);
  assert.equal(s.turnIndex, 1);
});

test('nat 20 with three of a kind gives one match and one leftover', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['potion', 'potion', 'potion', 'ring', 'potion', 'ring']);
  s = submitRoll(s, { total: 20, nat20: true });
  for (const slot of [0, 1, 2, 3]) s = flipCard(s, slot);
  s = resolveReveal(s);
  assert.equal(s.loot[0].length, 1);
  assert.equal(s.cards.filter((c) => c.state === 'removed').length, 2);
  assert.equal(s.cards[2].state, 'down');
});

test('monster in a nat-20 flip: all 4 revealed, pairs scored, then surprised encounter', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['rat', 'ring', 'ring', 'potion', 'potion']);
  s = submitRoll(s, { total: 20, nat20: true });
  s = flipCard(s, 0);
  assert.equal(s.phase, 'flipping', 'monster must not interrupt the 4-card flip');
  for (const slot of [1, 2, 3]) s = flipCard(s, slot);
  assert.equal(s.phase, 'reveal');
  s = resolveReveal(s);
  assert.equal(s.loot[0][0].defId, 'ring');
  assert.equal(s.phase, 'encounter');
  assert.equal(currentEncounter(s).surprised, true);
  s = resolveEncounter(s, 'victory');
  assert.equal(s.cards[0].state, 'removed');
  assert.equal(s.turnIndex, 1);
});

test('two monsters in a nat-20 flip are fought one after another; fleeing sends both back', () => {
  const cfg = baseConfig();
  cfg.monsters[0].count = 2;
  let base = withBoard(createGame(cfg, seeded()), ['rat', 'rat', 'ring', 'ring', 'potion', 'potion']);
  base = submitRoll(base, { total: 20, nat20: true });
  for (const slot of [0, 1, 2, 3]) base = flipCard(base, slot);
  base = resolveReveal(base);

  let won = resolveEncounter(base, 'victory');
  assert.equal(won.phase, 'encounter');
  won = resolveEncounter(won, 'victory');
  assert.equal(won.cards[0].state, 'removed');
  assert.equal(won.cards[1].state, 'removed');

  const fled = resolveEncounter(base, 'fled');
  assert.equal(fled.cards[0].state, 'down');
  assert.equal(fled.cards[1].state, 'down');
  assert.equal(fled.cards[1].known, true);
  assert.equal(fled.phase, 'awaitRoll');
});

test('flip limit shrinks when fewer face-down cards remain', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['ring', 'ring', 'potion', 'potion']);
  s.cards[2].state = 'removed';
  s.cards[3].state = 'removed';
  s = submitRoll(s, { total: 20, nat20: true });
  s = flipCard(flipCard(s, 0), 1);
  assert.equal(s.phase, 'reveal');
  s = resolveReveal(s);
  assert.equal(s.phase, 'ended');
  assert.equal(s.endReason, 'cleared');
});

test('rounds: after the last player the round is over; nextRound resets turn order', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['ring', 'potion', 'ring', 'potion']);
  s = endTurn(s);
  assert.equal(s.turnIndex, 1);
  s = endTurn(submitRoll(s, { total: 15 }));
  assert.equal(s.phase, 'roundOver');
  s = nextRound(s, seeded());
  assert.equal(s.round, 2);
  assert.equal(s.turnIndex, 0);
  assert.equal(s.phase, 'awaitRoll');
  assert.equal(s.cards.length, 4, 'no monster added by default');
});

test('monsterPerRound adds a hidden monster on each new round', () => {
  let s = withBoard(createGame(baseConfig({ options: { monsterPerRound: true } }), seeded()), ['ring', 'potion', 'ring', 'potion']);
  s = endTurn(endTurn(s));
  s = nextRound(s, seeded());
  assert.equal(s.cards.length, 5);
  assert.equal(s.cards[4].kind, 'monster');
});

test('endTurn flips back a half-flipped pair', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['ring', 'potion', 'ring', 'potion']);
  s = flipCard(submitRoll(s, { total: 15 }), 0);
  s = endTurn(s);
  assert.equal(s.cards[0].state, 'down');
});

test('endSession ends manually; not allowed mid-encounter', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['rat', 'potion', 'potion']);
  const ended = endSession(s);
  assert.equal(ended.phase, 'ended');
  assert.equal(ended.endReason, 'manual');
  s = flipCard(submitRoll(s, { total: 15 }), 0);
  assert.throws(() => endSession(s));
});

test('actions never mutate their input state', () => {
  const g = createGame(baseConfig(), seeded());
  const snapshot = JSON.stringify(g);
  const s = flipCard(submitRoll(g, { total: 15 }), 0);
  assert.equal(JSON.stringify(g), snapshot);
  assert.notEqual(JSON.stringify(s), snapshot);
});

test('state survives a JSON round trip (localStorage)', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['ring', 'ring', 'potion', 'potion']);
  s = JSON.parse(JSON.stringify(submitRoll(s, { total: 15 })));
  s = resolveReveal(flipCard(flipCard(s, 0), 1));
  assert.equal(s.loot[0][0].defId, 'ring');
});

test('summary helpers', () => {
  let s = withBoard(createGame(baseConfig(), seeded()), ['ring', 'ring', 'potion', 'potion', 'rat']);
  s = submitRoll(s, { total: 1 });
  s = resolveReveal(flipCard(flipCard(s, 0), 1));
  const unfound = unfoundCards(s);
  assert.deepEqual(unfound.map((u) => [u.def.id, u.copies]).sort(), [['potion', 2], ['rat', 1]]);
  const text = lootSummaryText(s);
  assert.match(text, /Ana:\n {2}- Ring \[Legendary\] - Shiny\./);
  assert.match(text, /Bo:\n {2}\(nothing\)/);
  assert.equal(faceDownSlots(s).length, 3);
});
