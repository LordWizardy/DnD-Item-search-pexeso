// Small built-in preset so the app works even without presets/*.json (file://).
export const BUILTIN_PRESETS = [
  {
    name: 'Abandoned Cellar (built-in)',
    dc: 12,
    items: [
      { id: 'healing-potion', name: 'Potion of Healing', kind: 'item', rarity: 'common', pairs: 2, description: 'Restores 2d4+2 hit points.', icon: { type: 'emoji', value: '🧪' } },
      { id: 'silver-dagger', name: 'Silver Dagger', kind: 'item', rarity: 'uncommon', description: 'A +0 dagger that counts as silvered.', icon: { type: 'emoji', value: '🗡️' } },
      { id: 'ring-protection', name: 'Ring of Protection', kind: 'item', rarity: 'rare', description: '+1 to AC and saving throws (attunement).', icon: { type: 'emoji', value: '💍' } },
      { id: 'rotten-rope', name: 'Rotten Rope', kind: 'junk', icon: { type: 'emoji', value: '🪢' } },
      { id: 'broken-bottle', name: 'Broken Bottle', kind: 'junk', pairs: 1, icon: { type: 'emoji', value: '🍾' } },
    ],
    monsters: [
      { id: 'giant-rat', name: 'Giant Rat', count: 2, notes: '2 giant rats, AC 12, 7 HP each.', icon: { type: 'emoji', value: '🐀' } },
      { id: 'skeleton', name: 'Skeleton', count: 1, notes: 'AC 13, 13 HP. Shortbow and shortsword.', icon: { type: 'emoji', value: '💀' } },
    ],
    options: { monsterPerRound: false, revealAtEnd: true },
  },
];
