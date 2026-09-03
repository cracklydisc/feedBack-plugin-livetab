/*
 * kit 0.18.0 — shortcuts, through the host's own registry.
 *
 * `window.registerShortcut` is documented as a plugin-facing API and it earns
 * its keep twice: the app's `?` panel and its Settings → Keybinds tab list
 * what you add, and it warns on the console when a key is already taken
 * instead of two handlers quietly both firing. A plugin binding its own
 * `keydown` gets none of that.
 *
 * WHAT IS ALREADY TAKEN, asked of the registry rather than guessed. In the
 * `player` scope the app owns:
 *
 *   Space          play / pause
 *   ← →            seek ∓5s
 *   Escape         back
 *   [ ]            A/V sync offset  (NOT loop in/out, despite the obvious guess)
 *   + − = _        volume
 *   A (with Shift) the 3D Highway's framing tuner
 *
 * So the bindings a music plugin reaches for first — Space to start, [ and ]
 * to move a loop — are all spoken for, and rebinding them would break the
 * transport to add a convenience. `taken()` below is how you check before
 * choosing, and it is worth calling: this list will grow.
 */

/**
 * Every combo the host currently knows about, as `[{ combo, scope, description }]`.
 *
 * Empty on a host without the registry, and empty for plugins that have not
 * loaded yet — so treat it as "what is definitely taken", not as "what is free".
 */
export function taken() {
    if (typeof window.getAllShortcuts !== 'function') return [];
    try { return window.getAllShortcuts() || []; } catch (_) { return []; }
}

/** Whether a key is already registered in a scope. Case-insensitive. */
export function isTaken(key, scope = 'player') {
    const want = String(key).toLowerCase();
    return taken().some((s) => String(s.combo).toLowerCase() === want
        && (!scope || String(s.scope) === scope));
}

/**
 * Register a set of shortcuts, and get back the function that removes them.
 *
 * `items` is `[{ key, description, handler, modifiers? }]`. The description is
 * prefixed with your plugin's name, because it lands in a list the whole app
 * shares and "next section" on its own tells a reader nothing.
 *
 * A failure to register is warned and skipped rather than thrown: a missing
 * shortcut is a degraded plugin, not a broken one.
 */
export function register(items, opts = {}) {
    const scope = opts.scope || 'player';
    const name = opts.name || '';
    if (typeof window.registerShortcut !== 'function') return () => {};

    const done = [];
    for (const it of (items || [])) {
        if (!it || !it.key || typeof it.handler !== 'function') continue;
        const description = name ? `${name}: ${it.description || it.key}` : (it.description || it.key);
        try {
            window.registerShortcut({ ...it, description, scope });
            done.push(it.key);
        } catch (err) {
            console.warn(`[kit] could not register '${it.key}' in '${scope}':`, err);
        }
    }

    return () => {
        if (typeof window.unregisterShortcut !== 'function') return;
        for (const key of done) {
            try { window.unregisterShortcut(key, scope); } catch (_) { /* going away anyway */ }
        }
        done.length = 0;
    };
}
