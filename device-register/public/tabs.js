/* One tab per job, instead of one long page.
 *
 * A tab appears only when the person signed in can see something in it,
 * which is decided by the sections themselves: app.js and assets.js already
 * hide what a role may not use, so a tab whose sections are all hidden has
 * nothing for them. No permission is decided here.
 *
 * The address names the tab (#people, #assets…), so a tab can be bookmarked,
 * and the browser remembers the last one used. Sections are unhidden as the
 * data arrives, so the tab asked for is kept as the wish and shown the moment
 * it has something in it; until then, and for a tab this role never gets,
 * the dashboard shows.
 */
(() => {
  'use strict';

  const KEY = 'device-register.tab';
  const FALLBACK = 'dashboard';
  const nav = document.getElementById('tabs');
  const app = document.getElementById('app');
  if (!nav || !app) return;

  const tabs = () => [...nav.querySelectorAll('[role="tab"]')];
  const idOf = (tab) => tab.id.replace(/^tab-/, '');
  const panelOf = (id) => document.getElementById(`panel-${id}`);
  const known = (id) => tabs().some((tab) => idOf(tab) === id);

  const remember = (id) => { try { localStorage.setItem(KEY, id); } catch { /* storage blocked */ } };
  const remembered = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

  /* Setting an attribute to the value it already has still counts as a
     change to the observer below, so only ever set what differs. */
  const setHidden = (el, value) => { if (el.hidden !== value) el.hidden = value; };
  const setAttr = (el, name, value) => { if (el.getAttribute(name) !== value) el.setAttribute(name, value); };

  const usable = (id) => {
    const panel = panelOf(id);
    return Boolean(panel) && [...panel.querySelectorAll(':scope > section')].some((s) => !s.hidden);
  };

  const fromHash = () => {
    const id = decodeURIComponent(location.hash.replace(/^#/, ''));
    return known(id) ? id : null;
  };

  let wanted = fromHash() || (known(remembered()) ? remembered() : FALLBACK);
  let shown = null;

  function display(id, focus) {
    shown = id;
    for (const tab of tabs()) {
      const on = idOf(tab) === id;
      setAttr(tab, 'aria-selected', on ? 'true' : 'false');
      setAttr(tab, 'tabindex', on ? '0' : '-1');
      setHidden(panelOf(idOf(tab)), !on);
      if (on && focus) tab.focus();
    }
  }

  function refresh() {
    for (const tab of tabs()) setHidden(tab, !usable(idOf(tab)));
    const target = usable(wanted) ? wanted : FALLBACK;
    if (target !== shown) display(target, false);
  }

  function show(id, { focus = false, push = true } = {}) {
    wanted = known(id) ? id : FALLBACK;
    remember(wanted);
    if (push && location.hash !== `#${wanted}`) history.pushState(null, '', `#${wanted}`);
    const target = usable(wanted) ? wanted : FALLBACK;
    display(target, focus);
  }

  function setCount(id, n) {
    const tab = document.getElementById(`tab-${id}`);
    const box = tab && tab.querySelector('.tab-count');
    if (!box) return;
    const text = n > 0 ? String(n) : '';
    if (box.textContent !== text) box.textContent = text;
    setAttr(tab, 'aria-label', n > 0 ? `${tab.firstChild.textContent.trim()}, ${n}` : tab.firstChild.textContent.trim());
  }

  nav.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab) return;
    event.preventDefault();
    show(idOf(tab));
  });

  /* Arrow keys move between the tabs this person can see, as a tab strip
     does everywhere else; Home and End go to either end. */
  nav.addEventListener('keydown', (event) => {
    const visible = tabs().filter((tab) => !tab.hidden);
    const at = visible.findIndex((tab) => idOf(tab) === shown);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    let next = null;
    if (step) next = visible[(at + step + visible.length) % visible.length];
    else if (event.key === 'Home') next = visible[0];
    else if (event.key === 'End') next = visible[visible.length - 1];
    if (!next) return;
    event.preventDefault();
    show(idOf(next), { focus: true });
  });

  /* Back and forward, and an address typed or edited by hand. */
  const follow = () => { if ((fromHash() || FALLBACK) !== wanted) show(fromHash() || FALLBACK, { push: false }); };
  window.addEventListener('popstate', follow);
  window.addEventListener('hashchange', follow);

  new MutationObserver(refresh).observe(app, { attributes: true, attributeFilter: ['hidden'], subtree: true });

  window.registerTabs = { show, setCount, refresh };
  refresh();
})();
