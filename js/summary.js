import { h, clear, iconNode, toast, append } from './dom.js';
const add = (el, ...c) => append(el, c);
import { S } from './strings.js';
import { getDef, unfoundCards, lootSummaryText, rarityLabel } from './game.js';

const T = S.summary;

export function mountSummary(root, state, { onBack }) {
  clear(root);
  let showMissed = true;

  const text = lootSummaryText(state);
  const copyBtn = h('button', { type: 'button', class: 'btn primary', onClick: async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(T.copied, 'good');
    } catch {
      fallbackCopy();
    }
  } }, T.copy);

  function fallbackCopy() {
    const ta = h('textarea', { class: 'copy-fallback', readonly: true, rows: 10 }, text);
    copyBtn.after(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    toast(ok ? T.copied : T.copyFallback, ok ? 'good' : 'warn');
  }

  const lootBlocks = state.config.players.map((p, i) => {
    const entries = state.loot[i] ?? [];
    return h('section', { class: 'panel player-loot' },
      h('h3', null, p),
      entries.length
        ? h('ul', { class: 'loot-detail' }, entries.map((e) => {
          const def = getDef(state, e.defId);
          return h('li', { class: `tone-${e.rarity}` },
            iconNode(def?.icon, 'mini-icon'),
            h('div', null, h('strong', null, e.name), ' ', h('span', { class: 'rarity-tag' }, rarityLabel(e.rarity)), def?.description ? h('p', { class: 'hint' }, def.description) : null));
        }))
        : h('p', { class: 'hint' }, T.nothing));
  });

  const missedGrid = h('div', { class: 'missed-grid' });
  const missedToggle = h('button', { type: 'button', class: 'btn small', 'aria-expanded': 'true', onClick: () => {
    showMissed = !showMissed;
    missedGrid.hidden = !showMissed;
    missedToggle.textContent = showMissed ? T.hideMissed : T.showMissed;
    missedToggle.setAttribute('aria-expanded', String(showMissed));
  } }, T.hideMissed);

  let missedSection = null;
  if (state.config.options?.revealAtEnd) {
    for (const { def, copies } of unfoundCards(state)) {
      const tone = def.kind === 'monster' ? 'tone-monster' : def.kind === 'junk' ? 'tone-junk' : `tone-${def.rarity}`;
      missedGrid.append(h('div', { class: `missed-card card-face ${tone}` },
        iconNode(def.icon, 'card-icon'),
        h('span', { class: 'card-name' }, def.name),
        h('span', { class: 'copies' }, def.kind === 'monster' ? T.monstersLeft(copies) : T.pairsLeft(Math.ceil(copies / 2)))));
    }
    missedSection = h('section', { class: 'panel' }, h('div', { class: 'row between' }, h('h2', null, T.missed), missedToggle), missedGrid);
  }

  add(root, 
    h('header', { class: 'hero' },
      h('h1', null, T.title),
      h('p', null, `${state.config.name || ''} · ${T.rounds(state.round)}`),
      h('p', { class: `end-reason ${state.endReason}` }, T.reason[state.endReason] ?? '')),
    h('div', { class: 'loot-columns' }, lootBlocks),
    h('div', { class: 'row wrap center' }, copyBtn, h('button', { type: 'button', class: 'btn', onClick: onBack }, T.backToSetup)),
    missedSection,
  );
}
