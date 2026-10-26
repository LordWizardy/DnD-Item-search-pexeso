import { h, clear, iconNode, toast, makeId, append } from './dom.js';
const add = (el, ...c) => append(el, c);
import { S } from './strings.js';
import { RARITIES, defaultPairsFor, pairsFor, validateConfig } from './game.js';
import { fileToDataUrl } from './images.js';
import { BUILTIN_PRESETS } from './builtin.js';
import { loadPresets, savePreset, deletePreset, saveSetup } from './storage.js';

const T = S.setup;

// ---------- form <-> config ----------

export function emptyForm() {
  return {
    name: '',
    dc: 12,
    players: ['', ''],
    items: [],
    monsters: [],
    options: { monsterPerRound: false, revealAtEnd: true },
  };
}

function cleanIcon(icon) {
  if (icon && icon.value && ['emoji', 'image', 'url'].includes(icon.type)) return { type: icon.type, value: String(icon.value) };
  return { type: 'emoji', value: '❔' };
}

export function buildConfig(form) {
  const dcRaw = String(form.dc ?? '').trim();
  return {
    name: String(form.name ?? '').trim(),
    dc: dcRaw === '' ? NaN : Number(dcRaw),
    players: form.players.map((p) => String(p).trim()).filter(Boolean),
    items: form.items.map((it) => {
      const out = { id: it.id, name: String(it.name ?? '').trim(), kind: it.kind === 'junk' ? 'junk' : 'item' };
      if (out.kind === 'item') out.rarity = it.rarity;
      const p = String(it.pairs ?? '').trim();
      if (p !== '' && Number.isInteger(Number(p)) && Number(p) >= 0) out.pairs = Number(p);
      if (String(it.description ?? '').trim()) out.description = String(it.description).trim();
      out.icon = cleanIcon(it.icon);
      return out;
    }),
    monsters: form.monsters.map((m) => {
      const out = { id: m.id, name: String(m.name ?? '').trim(), count: Math.max(0, parseInt(m.count, 10) || 0) };
      if (String(m.notes ?? '').trim()) out.notes = String(m.notes).trim();
      out.icon = cleanIcon(m.icon);
      return out;
    }),
    options: { monsterPerRound: !!form.options.monsterPerRound, revealAtEnd: !!form.options.revealAtEnd },
  };
}

export function presetFromForm(form, name) {
  const c = buildConfig(form);
  delete c.players;
  if (Number.isNaN(c.dc)) c.dc = 12;
  c.name = name || c.name;
  return c;
}

/** Turn any loaded preset/config object into a form-shaped object (or null if unusable). */
export function normalizeToForm(p, keepPlayers) {
  if (!p || typeof p !== 'object' || (!Array.isArray(p.items) && !Array.isArray(p.monsters))) return null;
  const f = emptyForm();
  f.name = String(p.name ?? '');
  f.dc = Number.isFinite(Number(p.dc)) ? Number(p.dc) : 12;
  const incoming = Array.isArray(p.players) ? p.players.map(String) : null;
  f.players = incoming && incoming.length ? incoming : keepPlayers;
  const used = new Set();
  const uniq = (def, fallbackName) => {
    let id = def.id && !used.has(def.id) ? String(def.id) : makeId(def.name || fallbackName);
    used.add(id);
    return id;
  };
  f.items = (p.items ?? []).map((it) => {
    const kind = it.kind === 'junk' ? 'junk' : 'item';
    const o = { id: uniq(it, 'item'), name: String(it.name ?? ''), kind, rarity: RARITIES.includes(it.rarity) ? it.rarity : 'common', description: it.description ?? '', icon: cleanIcon(it.icon) };
    o.pairs = Number.isInteger(it.pairs) ? it.pairs : '';
    return o;
  });
  f.monsters = (p.monsters ?? []).map((m) => ({ id: uniq(m, 'monster'), name: String(m.name ?? ''), count: Number.isInteger(m.count) ? m.count : 1, notes: m.notes ?? '', icon: cleanIcon(m.icon) }));
  f.options = { monsterPerRound: !!p.options?.monsterPerRound, revealAtEnd: p.options?.revealAtEnd !== false };
  return f;
}

export function boardStats(config) {
  const pairs = config.items.reduce((n, it) => n + pairsFor(it), 0);
  const monsters = config.monsters.reduce((n, m) => n + (Number.isInteger(m.count) && m.count > 0 ? m.count : 0), 0);
  return { pairs, monsters, total: pairs * 2 + monsters };
}

// ---------- presets ----------

let bundledCache = null; // null = not tried, [] list, or false = failed
async function loadBundledIndex() {
  if (bundledCache !== null) return bundledCache;
  try {
    const res = await fetch('presets/index.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const list = await res.json();
    bundledCache = Array.isArray(list) ? list.filter((e) => e && e.file) : false;
  } catch {
    bundledCache = false;
  }
  return bundledCache;
}

// ---------- screen ----------

export function mountSetup(root, { form, onStart, notice }) {
  let saveTimer = null;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveSetup(form), 250);
  };

  const refs = {};
  const changed = () => {
    refreshDerived();
    persist();
  };

  function refreshDerived() {
    const config = buildConfig(form);
    const errors = validateConfig(config);
    const st = boardStats({ items: config.items, monsters: config.monsters });
    refs.board.textContent = T.boardSize(st.total, st.pairs, st.monsters);
    clear(refs.errors);
    if (errors.length) {
      refs.errors.append(h('strong', null, T.errorsTitle), h('ul', null, [...new Set(errors)].map((e) => h('li', null, e))));
    }
    refs.errors.hidden = !errors.length;
    refs.start.disabled = errors.length > 0;
  }

  // ----- section builders -----

  function textInput(obj, key, attrs = {}) {
    return h('input', { type: 'text', value: obj[key] ?? '', ...attrs, onInput: (e) => { obj[key] = e.target.value; changed(); } });
  }

  function playersSection() {
    const list = h('ol', { class: 'player-list' });
    const draw = () => {
      clear(list);
      form.players.forEach((_, i) => {
        list.append(
          h('li', { class: 'row' },
            h('input', { type: 'text', 'aria-label': T.playerPlaceholder(i + 1), placeholder: T.playerPlaceholder(i + 1), value: form.players[i], onInput: (e) => { form.players[i] = e.target.value; changed(); } }),
            h('button', { type: 'button', class: 'btn small', 'aria-label': T.moveUp, title: T.moveUp, disabled: i === 0, onClick: () => { [form.players[i - 1], form.players[i]] = [form.players[i], form.players[i - 1]]; draw(); changed(); } }, '↑'),
            h('button', { type: 'button', class: 'btn small', 'aria-label': T.moveDown, title: T.moveDown, disabled: i === form.players.length - 1, onClick: () => { [form.players[i + 1], form.players[i]] = [form.players[i], form.players[i + 1]]; draw(); changed(); } }, '↓'),
            h('button', { type: 'button', class: 'btn small danger', 'aria-label': T.remove, title: T.remove, onClick: () => { form.players.splice(i, 1); draw(); changed(); } }, '✕'),
          ),
        );
      });
    };
    draw();
    return h('section', { class: 'panel' },
      h('h2', null, T.players),
      list,
      h('button', { type: 'button', class: 'btn', onClick: () => { form.players.push(''); draw(); changed(); list.querySelector('li:last-child input')?.focus(); } }, `+ ${T.addPlayer}`),
    );
  }

  function iconPicker(def) {
    const wrap = h('div', { class: 'icon-picker' });
    const draw = () => {
      clear(wrap);
      const type = def.icon?.type ?? 'emoji';
      const preview = h('span', { class: 'icon-preview' }, iconNode(def.icon));
      const refreshPreview = () => { clear(preview); preview.append(iconNode(def.icon)); };
      const select = h('select', { 'aria-label': T.colIcon, onChange: (e) => { def.icon = { type: e.target.value, value: '' }; draw(); changed(); } },
        [['emoji', T.iconEmoji], ['image', T.iconImage], ['url', T.iconUrl]].map(([v, l]) => h('option', { value: v, selected: v === type }, l)));
      let input;
      if (type === 'emoji') {
        input = h('input', { type: 'text', class: 'emoji-input', maxlength: 8, placeholder: T.iconEmojiPlaceholder, 'aria-label': T.iconEmoji, value: def.icon?.value ?? '', onInput: (e) => { def.icon = { type: 'emoji', value: e.target.value }; refreshPreview(); changed(); } });
      } else if (type === 'url') {
        input = h('input', { type: 'url', placeholder: T.iconUrlPlaceholder, 'aria-label': T.iconUrl, value: def.icon?.value ?? '', onChange: (e) => { def.icon = { type: 'url', value: e.target.value.trim() }; refreshPreview(); changed(); } });
      } else {
        input = h('input', { type: 'file', accept: 'image/*', 'aria-label': T.iconChooseFile, onChange: async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            def.icon = { type: 'image', value: await fileToDataUrl(file) };
            refreshPreview();
            changed();
          } catch {
            toast(T.iconUploadFailed, 'bad');
          }
        } });
      }
      wrap.append(preview, select, input);
    };
    draw();
    return wrap;
  }

  function itemRow(item, rerenderList) {
    const row = h('div', { class: 'edit-row item-row' });
    const pairsInput = h('input', { type: 'number', min: 0, step: 1, 'aria-label': T.colPairs, placeholder: T.pairsPlaceholder(defaultPairsFor(item)), value: item.pairs ?? '', onInput: (e) => { item.pairs = e.target.value; changed(); } });
    const updatePlaceholder = () => { pairsInput.placeholder = T.pairsPlaceholder(defaultPairsFor(item)); };
    const kindSel = h('select', { 'aria-label': T.colKind, onChange: (e) => {
      item.kind = e.target.value;
      if (item.kind === 'item' && !RARITIES.includes(item.rarity)) item.rarity = 'common';
      row.replaceWith(itemRow(item, rerenderList));
      changed();
    } }, h('option', { value: 'item', selected: item.kind !== 'junk' }, T.kindItem), h('option', { value: 'junk', selected: item.kind === 'junk' }, T.kindJunk));
    const raritySel = item.kind === 'junk' ? null : h('select', { 'aria-label': T.colRarity, class: `rarity-${item.rarity}`, onChange: (e) => { item.rarity = e.target.value; e.target.className = `rarity-${item.rarity}`; updatePlaceholder(); changed(); } },
      RARITIES.map((r) => h('option', { value: r, selected: r === item.rarity }, S.common.rarity[r])));
    row.append(
      field(T.colName, textInput(item, 'name', { placeholder: T.newItemName, 'aria-label': T.colName })),
      field(T.colKind, kindSel),
      raritySel ? field(T.colRarity, raritySel) : h('div', { class: 'field spacer' }),
      field(T.colPairs, pairsInput),
      field(T.colDescription, textInput(item, 'description', { 'aria-label': T.colDescription }), 'wide'),
      field(T.colIcon, iconPicker(item)),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn small', onClick: () => { const i = form.items.indexOf(item); form.items.splice(i + 1, 0, { ...structuredClone(item), id: makeId(item.name), name: item.name ? `${item.name} (copy)` : '' }); rerenderList(); changed(); } }, T.duplicate),
        h('button', { type: 'button', class: 'btn small danger', onClick: () => { form.items.splice(form.items.indexOf(item), 1); rerenderList(); changed(); } }, T.delete)),
    );
    return row;
  }

  function monsterRow(m, rerenderList) {
    return h('div', { class: 'edit-row monster-row' },
      field(T.colName, textInput(m, 'name', { placeholder: T.newMonsterName, 'aria-label': T.colName })),
      field(T.colCount, h('input', { type: 'number', min: 0, step: 1, 'aria-label': T.colCount, value: m.count, onInput: (e) => { m.count = e.target.value; changed(); } })),
      field(T.colNotes, textInput(m, 'notes', { 'aria-label': T.colNotes }), 'wide'),
      field(T.colIcon, iconPicker(m)),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn small', onClick: () => { form.monsters.splice(form.monsters.indexOf(m) + 1, 0, { ...structuredClone(m), id: makeId(m.name), name: m.name ? `${m.name} (copy)` : '' }); rerenderList(); changed(); } }, T.duplicate),
        h('button', { type: 'button', class: 'btn small danger', onClick: () => { form.monsters.splice(form.monsters.indexOf(m), 1); rerenderList(); changed(); } }, T.delete)),
    );
  }

  function field(label, control, extra = '') {
    return h('label', { class: `field ${extra}` }, h('span', { class: 'field-label' }, label), control);
  }

  function listSection(title, arr, makeRow, addLabel, makeNew) {
    const list = h('div', { class: 'edit-list' });
    const draw = () => { clear(list); arr.forEach((x) => list.append(makeRow(x, draw))); };
    draw();
    return h('section', { class: 'panel' },
      h('h2', null, title),
      list,
      h('button', { type: 'button', class: 'btn', onClick: () => { arr.push(makeNew()); draw(); changed(); list.lastElementChild?.querySelector('input')?.focus(); } }, `+ ${addLabel}`),
    );
  }

  // ----- presets section -----

  function presetsSection() {
    const select = h('select', { 'aria-label': T.presets });
    const nameInput = h('input', { type: 'text', placeholder: T.saveAsPlaceholder, 'aria-label': T.saveAsPlaceholder });
    const msg = h('p', { class: 'hint', role: 'status' });
    const say = (text, bad) => { msg.textContent = text; msg.className = `hint ${bad ? 'bad' : ''}`; };
    const bundledMap = new Map();

    async function fillOptions(keep) {
      clear(select);
      select.append(h('option', { value: '' }, T.presetChoose));
      const g1 = h('optgroup', { label: T.presetBuiltin });
      BUILTIN_PRESETS.forEach((p, i) => g1.append(h('option', { value: `builtin:${i}` }, p.name)));
      select.append(g1);
      const idx = await loadBundledIndex();
      if (idx && idx.length) {
        const g2 = h('optgroup', { label: T.presetBundled });
        idx.forEach((e) => { bundledMap.set(e.file, e); g2.append(h('option', { value: `bundled:${e.file}` }, e.name || e.file)); });
        select.append(g2);
      } else if (idx === false) {
        say(T.presetsUnavailable, false);
      }
      const saved = Object.keys(loadPresets());
      if (saved.length) {
        const g3 = h('optgroup', { label: T.presetSaved });
        saved.forEach((n) => g3.append(h('option', { value: `saved:${n}` }, n)));
        select.append(g3);
      }
      if (keep) select.value = keep;
    }

    async function getPreset(value) {
      const [kind, ...rest] = value.split(':');
      const key = rest.join(':');
      if (kind === 'builtin') return BUILTIN_PRESETS[Number(key)];
      if (kind === 'saved') return loadPresets()[key];
      if (kind === 'bundled') {
        const res = await fetch(`presets/${key}`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      }
      return null;
    }

    function applyForm(f, label) {
      Object.assign(form, f);
      renderAll();
      saveSetup(form);
      toast(label, 'good');
    }

    const storageMessage = (res) => (res.quota ? T.quotaExceeded : T.storageFailed);

    const loadBtn = h('button', { type: 'button', class: 'btn', onClick: async () => {
      if (!select.value) return;
      try {
        const p = await getPreset(select.value);
        const f = normalizeToForm(p, form.players);
        if (!f) throw new Error('bad');
        applyForm(f, T.presetLoaded(p.name || ''));
      } catch {
        say(T.presetNotLoaded, true);
      }
    } }, T.load);

    const saveBtn = h('button', { type: 'button', class: 'btn', onClick: () => {
      const name = nameInput.value.trim();
      if (!name) { say(T.presetNameNeeded, true); return; }
      if (name in loadPresets() && !confirm(T.confirmOverwriteSaved(name))) return;
      const res = savePreset(name, presetFromForm(form, name));
      if (!res.ok) { say(storageMessage(res), true); toast(storageMessage(res), 'bad', 8000); return; }
      say(T.presetSavedMsg(name));
      fillOptions(`saved:${name}`);
    } }, T.save);

    const delBtn = h('button', { type: 'button', class: 'btn danger', onClick: () => {
      if (!select.value.startsWith('saved:')) return;
      const name = select.value.slice(6);
      deletePreset(name);
      say(T.presetDeletedMsg(name));
      fillOptions();
    } }, T.deleteSaved);

    const exportBtn = h('button', { type: 'button', class: 'btn', onClick: () => {
      const preset = presetFromForm(form);
      const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `${(preset.name || 'preset').replace(/[^\w-]+/g, '-').toLowerCase()}.json` });
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } }, T.exportJson);

    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onChange: async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const p = JSON.parse(await file.text());
        const f = normalizeToForm(p, form.players);
        if (!f) throw new Error('bad');
        applyForm(f, T.importedMsg(f.name));
      } catch {
        say(T.importFailed, true);
      }
    } });
    const importBtn = h('button', { type: 'button', class: 'btn', onClick: () => fileInput.click() }, T.importJson);

    fillOptions();
    return h('section', { class: 'panel' },
      h('h2', null, T.presets),
      h('div', { class: 'row wrap' }, select, loadBtn, delBtn),
      h('div', { class: 'row wrap' }, nameInput, saveBtn, exportBtn, importBtn, fileInput),
      msg,
    );
  }

  // ----- whole page -----

  function renderAll() {
    clear(root);
    refs.board = h('p', { class: 'board-size' });
    refs.errors = h('div', { class: 'errors', role: 'alert' });
    refs.start = h('button', { type: 'button', class: 'btn primary big', onClick: () => {
      saveSetup(form);
      onStart(buildConfig(form));
    } }, T.start);

    const monsterPerRound = h('input', { type: 'checkbox', checked: form.options.monsterPerRound, onChange: (e) => { form.options.monsterPerRound = e.target.checked; changed(); } });
    const revealAtEnd = h('input', { type: 'checkbox', checked: form.options.revealAtEnd, onChange: (e) => { form.options.revealAtEnd = e.target.checked; changed(); } });

    add(root, 
      h('header', { class: 'hero' }, h('h1', null, S.appTitle), h('p', null, S.appSubtitle)),
      notice ? h('p', { class: 'notice' }, notice) : null,
      presetsSection(),
      h('section', { class: 'panel' },
        h('h2', null, T.session),
        h('div', { class: 'row wrap' },
          field(T.sessionName, textInput(form, 'name', { placeholder: T.sessionNamePlaceholder, 'aria-label': T.sessionName }), 'grow'),
          field(T.dc, h('input', { type: 'number', step: 1, value: form.dc, 'aria-label': T.dc, onInput: (e) => { form.dc = e.target.value; changed(); } }), 'narrow'),
        )),
      playersSection(),
      listSection(T.items, form.items, itemRow, T.addItem, () => ({ id: makeId('item'), name: '', kind: 'item', rarity: 'common', pairs: '', description: '', icon: { type: 'emoji', value: '🎁' } })),
      listSection(T.monsters, form.monsters, monsterRow, T.addMonster, () => ({ id: makeId('monster'), name: '', count: 1, notes: '', icon: { type: 'emoji', value: '👹' } })),
      h('section', { class: 'panel' },
        h('h2', null, T.options),
        h('label', { class: 'check' }, monsterPerRound, T.optMonsterPerRound),
        h('label', { class: 'check' }, revealAtEnd, T.optRevealAtEnd)),
      h('div', { class: 'start-bar' }, refs.board, refs.errors, refs.start),
    );
    refreshDerived();
  }

  renderAll();
}
