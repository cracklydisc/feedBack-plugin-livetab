/*
 * kit 0.18.0 — the settings-panel retry dance.
 *
 * This existed twice, identical line for line, in `tidy/settings.html:98` and
 * `riffrepeater/settings.html:231`. The problem it solves is real and not
 * obvious: a plugin's `settings.html` can be rendered by a cold settings
 * screen BEFORE the plugin's own script has put its API on `window`, so a
 * panel that reads the API on first paint finds nothing and sits on
 * "Loading…" for ever.
 *
 * So: poll briefly, build when the API turns up, and say plainly that the
 * plugin did not load if it never does. The last part matters — the failure
 * a user actually hits is a disabled plugin, and "Loading…" for eternity
 * tells them nothing about it.
 *
 * NOTE ON WHERE FORMS BELONG. A settings PAGE is a form and should look like
 * one: it is the right home for the exact values a panel's steppers cannot
 * reach, and for store maintenance. The kit's game-HUD rules are about the
 * in-player panel, not about this. Use the host's own utility classes here.
 */

const DEFAULT_TRIES = 40;
const DEFAULT_INTERVAL_MS = 250;

/**
 * @param {object} o
 * @param {string} o.rootId     the element in your settings.html to fill
 * @param {() => any} o.api     returns your API, or a falsy value if not ready
 * @param {(api, root) => void} o.build  fills the root; called once
 * @param {string} [o.missing]  what to say if the API never arrives
 * @returns {() => void} a cancel function, for a settings panel that unmounts
 */
export function mountSettings(o) {
    const root = document.getElementById(o.rootId);
    if (!root) return () => {};

    const tries = Number.isFinite(o.tries) ? o.tries : DEFAULT_TRIES;
    const every = Number.isFinite(o.interval) ? o.interval : DEFAULT_INTERVAL_MS;
    let timer = null;
    let n = 0;

    function attempt() {
        let api = null;
        try { api = o.api(); } catch (_) { api = null; }
        if (!api) return false;
        try {
            o.build(api, root);
        } catch (err) {
            console.error('[kit] settings build threw:', err);
            root.textContent = 'This plugin\'s settings failed to render. See the console.';
        }
        return true;
    }

    if (!attempt()) {
        timer = setInterval(() => {
            n += 1;
            if (attempt() || n > tries) {
                clearInterval(timer);
                timer = null;
                if (n > tries && !attempt()) {
                    root.textContent = o.missing
                        || 'This plugin has not loaded. Restart fee[dB]ack, or check that it is '
                           + 'enabled on the Plugins page.';
                }
            }
        }, every);
    }

    return () => {
        if (timer) { clearInterval(timer); timer = null; }
    };
}
