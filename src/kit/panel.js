/*
 * kit 0.18.0 — the parked panel, and the button in the player that opens it.
 *
 * Two plugins wrote this before it lived here: Riff Repeater (155 lines) and
 * Live Tab (~410 lines across `mountControls`, `panelCSS` and
 * `repaintControls`). Both arrived at the same corner, one of them after two
 * bug reports.
 *
 * WHAT IT OBEYS (core's docs/plugin-v3-ui.md):
 *
 *   - append to `feedBack.ui.playerControlSlot()`, never `#player-controls` —
 *     the transport auto-hides a couple of seconds after the pointer stills
 *     and takes anything appended to it along
 *   - never `insertBefore` the legacy separator or `button:last-child`; those
 *     anchors do not exist in the v3 transport
 *   - guard idempotency against the ACTUAL container, not a hard-coded id: the
 *     rail popover is rebuilt on some navigations
 *   - portal the panel to `<body>`; the trigger lives inside a popover that
 *     closes on an outside click, and a panel parented to it would go too
 *
 * AND WHAT IT REFUSES TO DO: follow its trigger. See DESIGN.md §9 — a panel
 * inside the player's scrolling `<main>` is clipped by that element rather
 * than the screen, a panel pinned by one edge can only grow from the other so
 * changing a control moves the whole thing, and anchored to the rail it sits
 * over the notes. Parking it deletes all of that code.
 */

const SLOT_RETRY_MS = 500;
/** ~12s. A plugin's script can load a long way ahead of the player chrome. */
const SLOT_RETRY_TRIES = 24;

/**
 * @param {object} o
 * @param {string} o.id        the plugin id, for the element ids
 * @param {string} o.label     the button's text
 * @param {string} [o.title]   the button's tooltip
 * @param {string} [o.ariaLabel] the panel's accessible name
 * @param {() => boolean} [o.canOpen] extra gate, e.g. "only in the player"
 */
export function createPanel(o) {
    const id = String(o.id || 'plugin');
    const panelId = `${id}-panel`;
    const buttonId = `${id}-open`;

    const root = document.createElement('div');
    root.className = 'fbk-panel';
    root.id = panelId;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', o.ariaLabel || o.label || id);
    root.hidden = true;

    const head = document.createElement('div');
    head.className = 'fbk-head';
    const title = document.createElement('span');
    title.className = 'fbk-title';
    title.textContent = o.label || id;
    const subtitle = document.createElement('span');
    subtitle.className = 'fbk-subtitle';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'fbk-x';
    close.textContent = '✕';
    close.title = 'Close (Esc)';
    /*
     * The title and the song STACKED, not side by side.
     *
     * The song is what the unit is loaded with, so it reads as a second line
     * of the chassis legend rather than a sibling of it — and side by side
     * they competed for one row's width, which is why a long artist name used
     * to ellipsize the thing you were looking at.
     */
    const stack = document.createElement('div');
    stack.className = 'fbk-head-stack';
    stack.appendChild(title);
    stack.appendChild(subtitle);
    head.appendChild(stack);
    head.appendChild(close);
    root.appendChild(head);

    const body = document.createElement('div');
    body.className = 'fbk-body';
    root.appendChild(body);

    /*
     * PRESSING A CONTROL MUST NOT SCROLL THE PANEL.
     *
     * The body is the one scrolling child, so giving focus to a button near its
     * bottom makes the browser scroll it into view — and what leaves the top is
     * whatever the reader was picking from. Pressing a preset chip scrolled the
     * preset row off the screen.
     *
     * Dropping the mousedown default fixes it, and the exception matters more
     * than the rule: an INPUT, a SELECT, a TEXTAREA and anything editable are
     * OPERATED through that default — it is how a slider is dragged and a
     * checkbox is ticked — so cancelling it there breaks the control. Live Tab
     * shipped this guard without the exception and Chromium happened to
     * survive it, which is not a thing to depend on; the two tests that came
     * with the fix moved here with the code.
     */
    /*
     * A LABEL IS PART OF ITS CONTROL, and that is the correction this guard
     * needed a version later.
     *
     * The first version tested `target.tagName` against a list of form tags. A
     * `.fbk-toggle` is a `<label>` wrapping a checkbox, so a press lands on the
     * LABEL or on the track span inside it — neither of which is in the list —
     * and cancelling the default there is exactly how a label stops ticking its
     * checkbox. Reported as "the switch does not change state", and it is the
     * same mistake the guard was written to fix, arriving from the other side.
     *
     * So the question is not what the target IS, it is whether the target sits
     * inside something operated through this default.
     */
    const OPERATED = 'label, input, select, textarea, [contenteditable="true"]';
    body.addEventListener('mousedown', (ev) => {
        const t = ev && ev.target;
        if (t && typeof t.closest === 'function' && t.closest(OPERATED)) return;
        /* A stub or a text node has no `closest`; fall back to the tag. */
        const tag = t && t.tagName ? String(t.tagName).toUpperCase() : '';
        if (['INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'LABEL'].includes(tag)) return;
        if (t && t.isContentEditable) return;
        ev.preventDefault();
    });

    /*
     * A sticky footer, for the action the panel exists to perform.
     *
     * Reported on Riff Repeater: "does it make sense to have the main action
     * halfway down the panel?" It did not. A panel of this shape is a form
     * with one verb at the end of it, and if the verb sits wherever the
     * controls happen to stop then it lands mid-scroll — you configure, then
     * hunt. Worse, everything BELOW it (a speed row, a difficulty slider,
     * a statistics list) reads as though it comes after pressing, which is
     * backwards.
     *
     * Sticky, not fixed, and the same mechanism the head uses: it scrolls
     * with the content until it reaches the bottom edge and then stays. So a
     * short panel has its footer in the natural flow and a long one always has
     * the verb on screen, without two layout modes to reason about.
     *
     * Empty until a consumer puts something in it, and `.fbk-foot:empty` in
     * kit.css collapses it — so a panel that has no single action pays
     * nothing for this.
     */
    const foot = document.createElement('div');
    foot.className = 'fbk-foot';
    root.appendChild(foot);

    /*
     * THE FOLDED STATE — the same object at reading size.
     *
     * A panel like this one is two things at two moments: while you are
     * setting a passage up you want every control, and while you are PLAYING
     * you want one number and a way back. Those used to be a full rack and
     * nothing at all, so during a drill the only thing on screen was another
     * plugin's HUD.
     *
     * A state and not a second widget: same z-index, same open and close, same
     * shortcut registry. Two widgets would be two lifecycles and two places
     * for a bug about which one is showing.
     *
     * `folded` is a child of the panel and the head/body/foot are hidden while
     * it shows, so the chassis, the shadow and the corner are shared rather
     * than reimplemented — which is the whole reason it lives here and not in
     * a consumer.
     */
    const folded = document.createElement('div');
    folded.className = 'fbk-folded-slot';
    folded.hidden = true;
    root.appendChild(folded);

    /*
     * The one imperative surface, and the one exception to "the panel reads
     * only your snapshot": why something just FAILED. That is an event, not a
     * state, so a snapshot cannot hold it. Why something is BLOCKED is not
     * here — that belongs on the disabled control's own tooltip.
     */
    const flash = document.createElement('p');
    flash.className = 'fbk-flash';
    flash.hidden = true;
    body.appendChild(flash);
    let flashTimer = null;

    let open = false;
    let button = null;
    let placed = false;
    let retryTimer = null;
    let tries = 0;
    const listeners = new Set();

    function slot() {
        const fb = window.feedBack;
        const ui = fb && fb.ui;
        if (!ui || typeof ui.playerControlSlot !== 'function') return null;
        try { return ui.playerControlSlot() || null; } catch (_) { return null; }
    }

    function inPlayer() {
        const active = document.querySelector('.screen.active');
        return !!active && active.id === 'player';
    }

    function ensureButton() {
        const container = slot() || document.getElementById('player-controls');
        if (!container) return false;
        if (button && container.contains(button)) return true;
        if (button && button.parentNode) button.parentNode.removeChild(button);

        button = document.createElement('button');
        button.id = buttonId;
        button.type = 'button';
        button.className = 'fbk-open-btn';
        button.title = o.title || o.label || id;
        button.setAttribute('aria-haspopup', 'dialog');
        button.textContent = o.label || id;
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            setOpen(!open);
        });
        container.appendChild(button);
        return true;
    }

    function ensurePanel() {
        if (placed && root.parentNode === document.body) return;
        document.body.appendChild(root);
        placed = true;
    }

    function announce() {
        for (const fn of Array.from(listeners)) {
            try { fn(open); } catch (err) { console.warn(`[${id}] panel listener threw:`, err); }
        }
    }

    function setOpen(next) {
        // The panel belongs to the player. The button is hidden off it, but a
        // programmatic open can still get here — and did: the highway keeps
        // the last song's data after you navigate away, so a plugin's "ready"
        // stayed true and its panel opened over the song library.
        if (next && !inPlayer()) return;
        if (next && typeof o.canOpen === 'function' && !o.canOpen()) return;
        open = !!next;
        ensurePanel();
        root.hidden = !open;
        root.classList.toggle('fbk-panel-open', open);
        if (button) button.classList.toggle('fbk-on', open);
        announce();
    }

    function syncVisibility() {
        if (!button) return;
        const here = inPlayer();
        button.hidden = !here;
        if (!here && open) setOpen(false);
    }

    function onKeydown(e) {
        if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
        }
    }

    function onDocClick(e) {
        if (!open) return;
        if (root.contains(e.target)) return;
        if (button && button.contains(e.target)) return;
        setOpen(false);
    }

    close.addEventListener('click', () => setOpen(false));

    function attach() {
        ensureButton();
        ensurePanel();
        syncVisibility();
        if (!retryTimer) {
            retryTimer = setInterval(() => {
                tries += 1;
                const ok = ensureButton();
                if (ok) syncVisibility();
                // Keep going past the first success: the slot can be
                // re-created, and ensureButton() is a no-op when in place.
                if (tries > SLOT_RETRY_TRIES && ok) {
                    clearInterval(retryTimer);
                    retryTimer = null;
                }
            }, SLOT_RETRY_MS);
        }
        document.addEventListener('keydown', onKeydown, true);
        document.addEventListener('click', onDocClick, true);
    }

    function detach() {
        if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
        if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('click', onDocClick, true);
        if (button && button.parentNode) button.parentNode.removeChild(button);
        button = null;
        if (root.parentNode) root.parentNode.removeChild(root);
        placed = false;
        listeners.clear();
        open = false;
    }

    return {
        /** Append your controls here. */
        body,
        /**
         * The sticky footer, for the one action the panel is for.
         *
         * Put the primary here and nothing else that is not an alternative to
         * it — DESIGN.md §2. Left empty it collapses to nothing.
         */
        foot,
        /**
         * The folded state's container. Put a `foldedStrip()` in it.
         *
         * Shown by `fold(true)`, which hides the head, body and footer — so
         * the chassis is shared and there is only ever one panel.
         */
        folded,
        /**
         * Swap between the full rack and the reading-size strip.
         *
         * Not an open/close: the panel is open in both. This is which SIZE it
         * is at, which is why it is a separate verb from `open()`.
         */
        fold(on) {
            const small = !!on && folded.children.length > 0;
            folded.hidden = !small;
            head.hidden = small;
            body.hidden = small;
            foot.hidden = small;
            root.dataset.folded = small ? 'true' : 'false';
            return small;
        },
        isFolded() { return !folded.hidden; },
        root,

        attach,
        detach,
        syncVisibility,

        open: () => setOpen(true),
        close: () => setOpen(false),
        toggle: () => setOpen(!open),
        isOpen: () => open,
        onToggle(fn) {
            if (typeof fn === 'function') listeners.add(fn);
            return () => listeners.delete(fn);
        },

        /** The line beside the title — the song, usually. */
        setSubtitle(text) { subtitle.textContent = text || ''; },

        /** Why something just failed. Clears itself; your render never touches it. */
        say(text, ms = 6000) {
            if (!text) return;
            flash.textContent = text;
            flash.hidden = false;
            if (flashTimer) clearTimeout(flashTimer);
            flashTimer = setTimeout(() => {
                flash.hidden = true;
                flash.textContent = '';
                flashTimer = null;
            }, ms);
        },

        /** True when the player screen is showing — the gate the panel uses. */
        inPlayer,
    };
}
