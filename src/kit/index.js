/*
 * kit 0.18.0 — the entry point.
 *
 * `install()` does the two things every consumer needs and would otherwise
 * each get slightly wrong: it puts the kit's stylesheet on the page, and it
 * starts the theme bridge.
 *
 * WHY THE STYLESHEET IS INJECTED RATHER THAN DECLARED. A plugin manifest's
 * `styles` field takes ONE path, so a plugin cannot declare both its own sheet
 * and the kit's. The three ways out were: a build step that concatenates them
 * (plugins deliberately have none), pasting the kit's CSS into each plugin's
 * sheet (unmaintainable), or one `<link>` injected at import. This is the
 * third. It is served by the plugin's own asset route — the kit is vendored
 * INTO the plugin, so `assets/kit.css` is the plugin's file — which is also
 * why there is no cross-plugin dependency to break.
 *
 * VENDORED, NOT DEPENDED ON. There is no shared-library mechanism in this
 * host: no import maps, no guaranteed plugin load order, and a plugin can be
 * disabled or simply not installed. A runtime dependency on another plugin
 * would mean every consumer breaks when one of them is switched off. So the
 * kit is copied into each plugin and its version is stamped in the header of
 * every file. See README.md for the update procedure.
 */

import { follow, unfollow } from './theme.js';

export const VERSION = '0.26.0';

const LINK_ATTR = 'data-fbk-kit';

/**
 * @param {object} o
 * @param {string} o.id       the plugin id — its asset route is derived from it
 * @param {string} [o.version] the plugin's manifest version, for cache-busting
 * @param {object} [o.recipes] Layer 2 overrides, for a plugin with its own look
 */
export function install(o) {
    const id = String(o && o.id ? o.id : '').trim();
    if (!id) {
        console.warn('[kit] install() needs the plugin id');
        return;
    }

    // Idempotent, and keyed by plugin: two consumers on the page each get
    // their own link, which is harmless (same rules) and means uninstalling
    // one does not unstyle the other.
    const existing = document.querySelector(`link[${LINK_ATTR}="${id}"]`);
    const href = `/api/plugins/${encodeURIComponent(id)}/assets/kit.css`
        + (o.version ? `?v=${encodeURIComponent(o.version)}` : '');
    if (existing) {
        if (existing.getAttribute('href') !== href) existing.setAttribute('href', href);
    } else {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.setAttribute(LINK_ATTR, id);
        link.href = href;
        /*
         * PREPENDED, not appended — the kit is a base layer and has to lose
         * every tie.
         *
         * A consumer's `.rr-pick { flex-wrap: nowrap }` and the kit's
         * `.fbk-row { flex-wrap: wrap }` are both single-class selectors, so
         * source order alone decides. Appending put the kit last and it won,
         * which meant a plugin could not override the kit without inventing
         * specificity — and the first thing one tried to override silently
         * did nothing.
         *
         * `prepend` puts it ahead of whatever is already in <head> and ahead
         * of the plugin sheet the host injects, so the consumer always wins.
         */
        document.head.prepend(link);
    }

    follow(o.recipes || null);
}

/** Take the stylesheet and the theme bridge back down. */
export function uninstall(id) {
    const link = document.querySelector(`link[${LINK_ATTR}="${String(id)}"]`);
    if (link && link.parentNode) link.parentNode.removeChild(link);
    // Only stop the bridge when nothing else is using it.
    if (!document.querySelector(`link[${LINK_ATTR}]`)) unfollow();
}

export { createPanel } from './panel.js';
export { mountSettings } from './settings-mount.js';
export * as controls from './controls.js';
export * as shortcuts from './shortcuts.js';
export { ink, inkOn, roles, slots } from './theme.js';
