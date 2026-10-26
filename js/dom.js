// Tiny DOM helper: h('div', {class:'x', onclick: fn, 'aria-label': 'y'}, child, ...)
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function slug(text) {
  return String(text || 'card').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'card';
}

export function makeId(name) {
  return `${slug(name)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Render a card/item icon: emoji text or <img>. */
export function iconNode(icon, cls = '') {
  const ic = icon && icon.value ? icon : { type: 'emoji', value: '❔' };
  if (ic.type === 'image' || ic.type === 'url') {
    const img = h('img', { class: `icon icon-img ${cls}`, src: ic.value, alt: '', draggable: 'false', loading: 'lazy' });
    img.addEventListener('error', () => {
      const fb = h('span', { class: `icon icon-emoji ${cls}`, 'aria-hidden': 'true' }, '❔');
      img.replaceWith(fb);
    });
    return img;
  }
  return h('span', { class: `icon icon-emoji ${cls}`, 'aria-hidden': 'true' }, ic.value);
}

/** Show a transient message. kind: '' | 'good' | 'bad' | 'warn' */
export function toast(message, kind = '', ms = 4500) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  box.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}
