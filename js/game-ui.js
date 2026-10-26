import { h, clear, iconNode, toast, append } from './dom.js';
const add = (el, ...c) => append(el, c);
import { S } from './strings.js';
import {
  getDef, currentPlayer, currentEncounter, flipLimit,
  submitRoll, flipCard, resolveReveal, resolveEncounter, endTurn, nextRound, endSession,
} from './game.js';

const T = S.game;
const REVEAL_MS = 1400;

function tone(def) {
  if (!def) return 'tone-common';
  if (def.kind === 'monster') return 'tone-monster';
  if (def.kind === 'junk') return 'tone-junk';
  return `tone-${def.rarity || 'common'}`;
}

function faceContent(def) {
  return [
    iconNode(def?.icon, 'card-icon'),
    h('span', { class: 'card-name' }, def?.name ?? '?'),
  ];
}

/**
 * act(fn): applies fn(state) -> newState, saves and re-renders. Returns true on success.
 * onAbandon(): confirm + leave.
 */
export function createGameView(root, { act, onAbandon }) {
  let state = null;
  let peek = false;
  let revealTimer = null;
  let banner = null; // { lines: [{text, desc, kind}] }
  let encounterKey = null;
  let panelCollapsed = false;
  let slots = [];

  // ----- skeleton -----
  const bannerEl = h('div', { class: 'banner', role: 'status', 'aria-live': 'polite', hidden: true });
  const grid = h('div', { class: 'grid', role: 'group', 'aria-label': T.boardLabel });
  const siteTitle = h('h2', { class: 'site-title' });
  const main = h('main', { class: 'board-wrap' }, siteTitle, bannerEl, grid);

  const headerEl = h('div', { class: 'dm-head' });
  const orderEl = h('ol', { class: 'turn-order' });
  const controlsEl = h('div', { class: 'controls' });
  const lootEl = h('div', { class: 'loot' });
  const logList = h('ol', { class: 'log-list' });
  const logDetails = h('details', { class: 'log' }, h('summary', null, T.logTitle), logList);

  const peekBtn = h('button', { type: 'button', class: 'btn icon-btn peek-btn', 'aria-pressed': 'false', title: T.peek, 'aria-label': T.peek, onClick: () => {
    peek = !peek;
    peekBtn.setAttribute('aria-pressed', String(peek));
    grid.classList.toggle('peek', peek);
    peekNote.hidden = !peek;
  } }, '👁');
  const peekNote = h('p', { class: 'hint peek-note', hidden: true }, T.peekOn);
  const collapseBtn = h('button', { type: 'button', class: 'btn icon-btn', 'aria-expanded': 'true', title: T.panelHide, onClick: () => {
    panelCollapsed = !panelCollapsed;
    layout.classList.toggle('panel-collapsed', panelCollapsed);
    collapseBtn.setAttribute('aria-expanded', String(!panelCollapsed));
    collapseBtn.title = panelCollapsed ? T.panelShow : T.panelHide;
    collapseBtn.textContent = panelCollapsed ? '◀' : '▶';
  } }, '▶');
  const abandonBtn = h('button', { type: 'button', class: 'btn danger small', onClick: onAbandon }, T.abandon);

  const panelBody = h('div', { class: 'panel-body' },
    headerEl,
    h('h3', null, T.turnOrder), orderEl,
    controlsEl,
    peekNote,
    h('h3', null, T.lootTitle), lootEl,
    logDetails,
    abandonBtn,
  );
  const aside = h('aside', { class: 'dm-panel', 'aria-label': T.panelToggle },
    h('div', { class: 'panel-tools' }, h('span', { class: 'panel-title' }, T.panelToggle), peekBtn, collapseBtn),
    panelBody,
  );
  const layout = h('div', { class: 'game-layout' }, main, aside);
  const modalHost = h('div', { class: 'modal-host' });
  clear(root).append(layout, modalHost);

  // ----- grid -----
  function buildSlot(i) {
    const back = h('div', { class: 'face back' }, h('div', { class: 'back-art', 'aria-hidden': 'true' }), h('span', { class: 'known-mark', 'aria-hidden': 'true', title: T.cardKnownWarning }, '⚠'), h('div', { class: 'peekface', 'aria-hidden': 'true' }));
    const front = h('div', { class: 'face front', 'aria-hidden': 'true' });
    const btn = h('button', { type: 'button', class: 'card', onClick: () => onCardClick(i) }, h('div', { class: 'card-inner' }, back, front));
    const el = h('div', { class: 'slot' }, btn);
    return { el, btn, back, front, peekface: back.querySelector('.peekface'), uid: null };
  }

  function updateSlot(i, card, matchSet, dangerSet) {
    const sl = slots[i];
    const empty = !card || card.state === 'removed';
    sl.el.classList.toggle('empty', empty);
    if (empty) {
      sl.btn.disabled = true;
      sl.btn.setAttribute('aria-label', T.cardEmpty);
      sl.btn.tabIndex = -1;
      sl.btn.classList.remove('up', 'match', 'danger', 'known');
      return;
    }
    if (sl.uid !== card.uid) {
      sl.uid = card.uid;
      const def = getDef(state, card.defId);
      sl.btn.className = `card ${tone(def)}`;
      clear(sl.front).append(...faceContent(def));
      clear(sl.peekface).append(...faceContent(def));
      sl.name = def?.name ?? '?';
    }
    const up = card.state === 'up';
    sl.btn.classList.toggle('up', up);
    sl.btn.classList.toggle('known', !!card.known && !up);
    sl.btn.classList.toggle('match', matchSet.has(i));
    sl.btn.classList.toggle('danger', dangerSet.has(i));
    sl.front.setAttribute('aria-hidden', String(!up));
    sl.btn.setAttribute('aria-label', up ? T.cardUp(sl.name) : T.cardDown(i + 1));
    const canFlip = state.phase === 'flipping' && card.state === 'down';
    sl.btn.disabled = !canFlip && state.phase !== 'reveal';
    sl.btn.tabIndex = canFlip ? 0 : -1;
    sl.btn.classList.toggle('inactive', !canFlip);
  }

  function updateGrid() {
    while (slots.length < state.cards.length) {
      const sl = buildSlot(slots.length);
      slots.push(sl);
      grid.append(sl.el);
    }
    const matchSet = new Set();
    const dangerSet = new Set();
    if (state.phase === 'reveal' && state.turn?.lastResult) {
      state.turn.lastResult.matches.forEach((m) => m.slots.forEach((s) => matchSet.add(s)));
      state.turn.lastResult.monsters.forEach((s) => dangerSet.add(s));
    }
    state.cards.forEach((c, i) => updateSlot(i, c, matchSet, dangerSet));
  }

  function onCardClick(i) {
    if (state.phase === 'reveal') { skipReveal(); return; }
    if (state.phase !== 'flipping') return;
    act((s) => flipCard(s, i));
  }

  // ----- reveal -----
  function describeResult(s) {
    const r = s.turn.lastResult;
    const player = currentPlayer(s);
    const lines = [];
    for (const m of r.matches) {
      const def = getDef(s, m.defId);
      if (def.kind === 'junk') lines.push({ kind: 'junk', text: T.foundJunk(def.name) });
      else lines.push({ kind: 'good', text: T.foundItem(player, def.name), desc: def.description, rarity: def.rarity });
    }
    for (const slot of r.monsters) lines.push({ kind: 'bad', text: T.monsterAppears(getDef(s, s.cards[slot].defId).name) });
    if (!lines.length) lines.push({ kind: 'plain', text: T.noMatch });
    return { lines };
  }

  function skipReveal() {
    clearTimeout(revealTimer);
    revealTimer = null;
    if (state.phase === 'reveal') act((s) => resolveReveal(s));
  }

  // ----- banner -----
  function renderBanner() {
    clear(bannerEl);
    if (!banner) { bannerEl.hidden = true; return; }
    bannerEl.hidden = false;
    bannerEl.className = `banner ${banner.lines[0]?.kind ?? ''}`;
    for (const l of banner.lines) {
      bannerEl.append(h('p', { class: `banner-line ${l.kind}` }, h('strong', null, l.text), l.desc ? h('span', { class: 'banner-desc' }, ` ${l.desc}`) : null));
    }
    if (state.phase === 'reveal') {
      bannerEl.append(h('button', { type: 'button', class: 'btn primary small', onClick: skipReveal }, T.revealContinue));
    }
  }

  // ----- panel -----
  function updateHeader() {
    clear(headerEl).append(
      h('div', { class: 'stat' }, h('span', { class: 'stat-big' }, T.round(state.round))),
      h('div', { class: 'stat' }, h('span', { class: 'stat-big' }, T.dc(state.config.dc))),
    );
    siteTitle.textContent = state.config.name || '';
    clear(orderEl);
    state.config.players.forEach((p, i) => {
      const cur = i === state.turnIndex && state.phase !== 'roundOver';
      orderEl.append(h('li', { class: `${cur ? 'current' : ''} ${i < state.turnIndex || state.phase === 'roundOver' ? 'done' : ''}`, 'aria-current': cur ? 'true' : null }, p));
    });
  }

  function updateLoot() {
    clear(lootEl);
    state.config.players.forEach((p, i) => {
      const items = state.loot[i] ?? [];
      lootEl.append(h('div', { class: `loot-player ${i === state.turnIndex ? 'current' : ''}` },
        h('h4', null, p),
        items.length
          ? h('ul', null, items.map((e) => h('li', { class: `tone-${e.rarity}` }, h('span', { class: 'dot', 'aria-hidden': 'true' }), e.name)))
          : h('p', { class: 'hint' }, T.nothingYet)));
    });
  }

  function updateLog() {
    clear(logList);
    for (let i = state.log.length - 1; i >= 0; i--) {
      const e = state.log[i];
      logList.append(h('li', null, h('span', { class: 'log-round' }, `R${e.round}`), ` ${e.text}`));
    }
  }

  function confirmEnd() {
    if (confirm(T.confirmEnd)) act((s) => endSession(s));
  }

  function updateControls() {
    clear(controlsEl);
    const s = state;
    const player = currentPlayer(s);
    const endBtn = h('button', { type: 'button', class: 'btn danger', onClick: confirmEnd }, T.endScavenging);
    const turn = s.turn;

    if (s.phase === 'awaitRoll') {
      const total = h('input', { type: 'number', step: 1, inputmode: 'numeric', 'aria-label': T.rollTotal, class: 'roll-input' });
      const n20 = h('input', { type: 'checkbox' });
      const n1 = h('input', { type: 'checkbox' });
      n20.addEventListener('change', () => { if (n20.checked) n1.checked = false; });
      n1.addEventListener('change', () => { if (n1.checked) n20.checked = false; });
      add(controlsEl, 
        h('p', { class: 'hint' }, T.awaitRollHint(player)),
        h('form', { class: 'roll-form', onSubmit: (e) => {
          e.preventDefault();
          if (total.value === '' && !n20.checked && !n1.checked) { toast(T.rollNeeded, 'warn'); return; }
          banner = null;
          const roll = { total: total.value === '' ? null : Number(total.value), nat20: n20.checked, nat1: n1.checked };
          if (act((st) => submitRoll(st, roll))) {
            if (roll.nat1) banner = { lines: [{ kind: 'bad', text: T.nat1Hidden }] };
            else if (roll.nat20) banner = { lines: [{ kind: 'good', text: T.nat20Banner }] };
            renderBanner();
          }
        } },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, T.rollTotal), total),
        h('div', { class: 'row' },
          h('label', { class: 'check' }, n20, T.nat20),
          h('label', { class: 'check' }, n1, T.nat1)),
        h('button', { type: 'submit', class: 'btn primary' }, T.submitRoll)),
        h('div', { class: 'row wrap' }, h('button', { type: 'button', class: 'btn', onClick: () => act((st) => endTurn(st)) }, T.endTurn), endBtn),
      );
      setTimeout(() => { if (state === s && document.activeElement?.tagName !== 'INPUT') total.focus({ preventScroll: true }); }, 0);
    } else if (s.phase === 'flipping') {
      const limit = flipLimit(s);
      add(controlsEl, 
        h('p', { class: 'roll-result' }, rollText(turn.roll)),
        turn.mode === 'flip4' ? h('p', { class: 'mode-flip4' }, T.flip4Mode) : null,
        turn.roll.nat1 ? h('p', { class: 'nat1-note' }, T.nat1Hidden) : null,
        h('p', { class: 'tries' }, T.triesLeft(turn.triesLeft)),
        h('p', { class: 'hint' }, T.flipHint(limit - turn.flipped.length)),
        h('div', { class: 'row wrap' }, h('button', { type: 'button', class: 'btn', onClick: () => act((st) => endTurn(st)) }, T.endTurn), endBtn),
      );
    } else if (s.phase === 'reveal') {
      add(controlsEl, h('p', { class: 'hint' }, T.revealing));
    } else if (s.phase === 'encounter') {
      add(controlsEl, h('p', { class: 'hint' }, T.encounterTitle));
    } else if (s.phase === 'roundOver') {
      add(controlsEl, 
        h('p', null, T.roundOverText(s.round)),
        h('div', { class: 'row wrap' }, h('button', { type: 'button', class: 'btn primary', onClick: () => act((st) => nextRound(st)) }, T.nextRound), endBtn),
      );
    }
  }

  function rollText(r) {
    if (r.nat20) return `${T.nat20}!`;
    if (r.nat1) return `${T.nat1}!`;
    return `${r.total} vs ${T.dc(state.config.dc)}: ${r.success ? '✔' : '✘'}`;
  }

  // ----- encounter modal -----
  function updateEncounter() {
    const enc = currentEncounter(state);
    const key = enc ? `${enc.slot}:${state.turn.pendingMonsters.length}:${state.round}:${state.turnIndex}` : null;
    if (key === encounterKey) return;
    encounterKey = key;
    clear(modalHost);
    if (!enc) return;
    const total = state.turn.pendingMonsters.length;
    const notes = enc.def.notes;
    const choose = (outcome) => act((s) => resolveEncounter(s, outcome));
    const dlg = h('div', { class: 'modal encounter', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'enc-title', tabindex: '-1' },
      h('div', { class: 'flash', 'aria-hidden': 'true' }),
      h('div', { class: 'modal-card' },
        h('p', { class: 'enc-who' }, T.encounterWho(currentPlayer(state))),
        h('h2', { id: 'enc-title' }, T.encounterTitle),
        enc.surprised ? h('div', { class: 'surprised-badge' }, T.surprised) : null,
        enc.surprised ? h('p', { class: 'hint' }, T.surprisedHint) : null,
        h('div', { class: 'enc-monster' }, iconNode(enc.def.icon, 'enc-icon'), h('div', { class: 'enc-name' }, enc.def.name)),
        h('p', { class: 'enc-notes' }, notes || T.noNotes),
        state.turn.roll.nat1 ? h('p', { class: 'nat1-note' }, T.nat1Hidden) : null,
        total > 1 ? h('p', { class: 'hint' }, T.encounterOf(1, total)) : null,
        h('div', { class: 'enc-buttons' },
          h('button', { type: 'button', class: 'btn big good', onClick: () => choose('victory') }, h('span', null, T.victory), h('small', null, T.victoryHint)),
          h('button', { type: 'button', class: 'btn big warn', onClick: () => choose('fled') }, h('span', null, T.fled), h('small', null, T.fledHint)),
          h('button', { type: 'button', class: 'btn big bad', onClick: () => choose('defeat') }, h('span', null, T.defeat), h('small', null, T.defeatHint))),
      ),
    );
    modalHost.append(dlg);
    dlg.focus();
  }

  // ----- main update -----
  function update(next) {
    const prevPhase = state?.phase;
    state = next;
    updateGrid();
    updateHeader();
    updateControls();
    updateLoot();
    updateLog();
    if (state.phase === 'reveal') {
      banner = describeResult(state);
      if (!revealTimer) revealTimer = setTimeout(skipReveal, REVEAL_MS);
    } else {
      clearTimeout(revealTimer);
      revealTimer = null;
      if (prevPhase === 'encounter' && state.phase !== 'encounter') banner = banner && banner.lines[0]?.kind === 'bad' ? null : banner;
    }
    renderBanner();
    updateEncounter();
  }

  return { update, destroy() { clearTimeout(revealTimer); } };
}
