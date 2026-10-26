import { h, clear, toast } from './dom.js';
import { S } from './strings.js';
import { createGame } from './game.js';
import { BUILTIN_PRESETS } from './builtin.js';
import { loadGame, saveGame, clearGame, loadSetup } from './storage.js';
import { mountSetup, emptyForm, normalizeToForm } from './setup.js';
import { createGameView } from './game-ui.js';
import { mountSummary } from './summary.js';

const root = document.getElementById('app');
let state = null;
let view = null;
let saveWarned = false;

function persist() {
  const res = saveGame(state);
  if (!res.ok && !saveWarned) {
    saveWarned = true;
    toast(S.common.saveFailedGame, 'warn', 8000);
  }
}

function act(fn) {
  try {
    state = fn(state);
  } catch (e) {
    toast(S.common.actionFailed(e.message), 'bad');
    return false;
  }
  persist();
  if (state.phase === 'ended') {
    showSummary();
  } else {
    view.update(state);
  }
  return true;
}

function teardown() {
  view?.destroy();
  view = null;
}

function showGame() {
  teardown();
  document.body.dataset.screen = 'game';
  view = createGameView(root, {
    act,
    onAbandon: () => {
      if (confirm(S.game.confirmAbandon)) {
        clearGame();
        state = null;
        showSetup();
      }
    },
  });
  view.update(state);
}

function showSummary() {
  teardown();
  document.body.dataset.screen = 'summary';
  mountSummary(root, state, {
    onBack: () => {
      const form = normalizeToForm(state.config, state.config.players) ?? emptyForm();
      clearGame();
      state = null;
      showSetup(form);
    },
  });
  window.scrollTo(0, 0);
}

function startingForm() {
  const saved = loadSetup();
  const f = saved && Array.isArray(saved.items) ? normalizeToForm(saved, ['', '']) : null;
  if (f && Array.isArray(saved.players)) f.players = saved.players.map(String);
  if (f) return f;
  const base = normalizeToForm(BUILTIN_PRESETS[0], ['Player 1', 'Player 2']);
  base.players = ['Player 1', 'Player 2'];
  return base;
}

function showSetup(form = startingForm()) {
  teardown();
  document.body.dataset.screen = 'setup';
  mountSetup(root, {
    form,
    onStart: (config) => {
      try {
        state = createGame(config);
      } catch (e) {
        toast(S.common.actionFailed(e.message), 'bad');
        return;
      }
      persist();
      showGame();
      window.scrollTo(0, 0);
    },
  });
}

document.title = S.appTitle;
const saved = loadGame();
if (saved) {
  state = saved;
  if (state.phase === 'ended') showSummary();
  else showGame();
} else {
  showSetup();
}
