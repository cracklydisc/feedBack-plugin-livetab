/*
 * kit 0.18.0 — the four control families, as builders.
 *
 * Each returns `{ el, ... }` where `el` is the node to append and the rest is
 * the handle you drive it with. Nothing here holds application state: a
 * builder gives you a node plus a `set()` that takes the truth from wherever
 * your model keeps it. That is what lets a panel re-render from scratch on a
 * timer and still be correct.
 *
 * There are four families and no others, because the one thing a panel must
 * never do is use two shapes for the same kind of question — or one shape for
 * two. See DESIGN.md §1 for the version of that mistake that shipped.
 */

/**
 * A number, or null when there isn't one.
 *
 * `Number(null)` is 0 and 0 passes `Number.isFinite`, so a bare finite check
 * turns "absent" into "zero" — which has now cost four bugs across two
 * repositories: a stored best of 0% on a never-measured passage, a drill
 * result preferred over a real one, an accuracy band colouring red for
 * "never played", and a stepper that jumped to its minimum when handed null.
 * Every number entering the kit goes through here.
 */
export function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

export function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
}

export function button(cls, text, title, onClick) {
    const b = el('button', cls, text);
    b.type = 'button';
    if (title) b.title = title;
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

/** A key cap. Pair it with a real `window.registerShortcut` registration. */
export function kbd(keys) {
    const n = el('span', 'fbk-kbd', keys);
    n.setAttribute('aria-hidden', 'true');   // the shortcut is announced by the host's help panel
    return n;
}

/** A caveat. The sentence goes in the tooltip, never on the panel. */
export function badge(glyph, title) {
    const n = el('span', 'fbk-badge', glyph || '⚠');
    if (title) n.title = title;
    return n;
}

/** The state of an input, to sit inside the control that needs it. */
export function dot(state, title) {
    const n = el('span', 'fbk-dot');
    n.dataset.state = state || 'off';
    if (title) n.title = title;
    return n;
}

/** A section heading with the hairline that makes it read as a divider. */
export function section(title) {
    const wrap = el('div', 'fbk-section');
    wrap.appendChild(el('h4', 'fbk-section-title', title));
    wrap.appendChild(el('span', 'fbk-section-rule'));
    return wrap;
}

/**
 * A section heading that folds what is under it, and reads its own state.
 *
 *     HOW YOU DRILL   80 → 90 → 100 · 85%              ›
 *
 * This exists for exactly one thing: a block of POLICY inside a panel whose
 * job is something else. Policy is what you set once and then live with — how
 * aggressive the ladder is, what counts as clean — and it does not belong in
 * the default view of a panel you opened to do a task. But it must not move to
 * another screen either, because then changing it costs a context switch.
 *
 * A fold is the only honest answer to that: the summary keeps the value
 * visible, so nothing is hidden, and the controls are one click away.
 *
 * DO NOT use it for the thing the panel is FOR. A fold over the primary
 * workflow is a second click charged for the reason the user opened the panel,
 * and the summary then competes with the controls it replaced instead of
 * standing in for them. If the value changes every time you use the panel, it
 * is not policy — leave it open.
 *
 * The head is a real `<button>` with `aria-expanded`, so the whole heading row
 * is the hit target rather than a chevron somebody has to aim at.
 */
export function fold(opts = {}) {
    const { title = '', summary = '', open = false, ariaLabel = null } = opts;

    const wrap = el('section', 'fbk-fold');
    const head = el('button', 'fbk-fold-head');
    head.type = 'button';
    if (ariaLabel) head.setAttribute('aria-label', ariaLabel);

    const heading = el('span', 'fbk-fold-title', title);
    const sum = el('span', 'fbk-fold-summary', summary);
    /*
     * A chevron, not a triangle or a plus. It rotates, so the same glyph says
     * both states and there is nothing to keep in sync — and rotation is the
     * one transform the "Still" recipe can neutralise without the control
     * becoming ambiguous, because the open state also shows its body.
     */
    const chev = el('span', 'fbk-fold-chev', '›');

    /*
     * CHEVRON FIRST. It was trailing, 200px from the title, and it was also
     * the quietest thing in its own row — so the only signal that the row did
     * anything sat where nobody was looking, at the lowest contrast in the
     * group. Reported as "it isn't clear that the section expands", which was
     * the row telling the truth about itself.
     *
     * Leading fixes three things at once. The affordance is where the eye
     * enters the row. It is next to the text it belongs to rather than
     * flushed to an edge it has no relationship with. And the summary can
     * then right-align against the panel's other values — the Chart field's
     * readout lands on the same pixel, which is one shared alignment instead
     * of a third ragged one (Refactoring UI: use fewer alignments).
     */
    head.appendChild(chev);
    head.appendChild(heading);
    head.appendChild(sum);

    const body = el('div', 'fbk-fold-body');

    wrap.appendChild(head);
    wrap.appendChild(body);

    let isOpen = false;

    function setOpen(on) {
        isOpen = !!on;
        head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        /*
         * `hidden` rather than a class, so the fourth law holds: a consumer
         * that styles `.fbk-fold-body` with a `display` cannot leave a closed
         * body on screen (kit.css scopes the `!important` that guarantees it).
         */
        body.hidden = !isOpen;
        wrap.dataset.open = isOpen ? 'true' : 'false';
    }

    head.addEventListener('click', () => setOpen(!isOpen));
    setOpen(open);

    return {
        el: wrap,
        /** Append the folded controls here. */
        body,
        head,
        /** The three head cells, in DOM order: chevron, title, summary. */
        parts: { chev, title: heading, summary: sum },
        /**
         * The VALUE, kept visible while the body is shut.
         *
         * Whatever the controls inside say, said in one line. A fold whose
         * summary does not answer the question the controls answer is a fold
         * that hides rather than folds.
         *
         * A value, and not a sentence: this slot is the flexible cell of a
         * three-cell row, so on a 336px panel it is about 165px and anything
         * longer ellipsizes. Riff Repeater put "applies to every passage,
         * every song" here when open and it arrived as "applies to every
         * passage, every …", which is a summary that has stopped summarising.
         * Prose belongs in a `.fbk-hint` at the top of `body`, where it has
         * the full width and is next to the controls it describes.
         */
        setSummary(text) { sum.textContent = text === null || text === undefined ? '' : String(text); },
        setOpen,
        toggle() { setOpen(!isOpen); },
        isOpen() { return isOpen; },
    };
}

/**
 * A RACK — one block of the unit.
 *
 *     ● LOOP   INTRO 1 · BEST 58%              [ TIME | BARS ]
 *     ────────────────────────────────────────────────────────
 *     …controls…
 *
 * The panel is a chassis and this is a module bolted into it: a label, an
 * optional read-only aside, an optional header control, and a body. Racks are
 * FLAT and separated by a 1px stroke rather than by margin — which is why the
 * space scale got denser when this arrived. Air between groups was doing a
 * line's job.
 *
 * `setAside` is for a VALUE, never a control: it sits in the label's row at
 * the mono readout step, and the point of the slot is that you can read the
 * rack's state without opening anything. A control goes in `header`, which is
 * right-aligned after it and sized for something set once (`h-sm`).
 */
export function rack(opts = {}) {
    const { label = '', tone = null } = opts;
    const wrap = el('section', 'fbk-rack');
    if (tone) wrap.dataset.tone = tone;

    const head = el('div', 'fbk-rack-head');
    head.appendChild(el('span', 'fbk-rack-dot'));
    const name = el('h4', 'fbk-rack-label', label);
    const aside = el('span', 'fbk-rack-aside');
    const header = el('div', 'fbk-rack-header');
    head.appendChild(name);
    head.appendChild(aside);
    head.appendChild(header);

    const body = el('div', 'fbk-rack-body');
    wrap.appendChild(head);
    wrap.appendChild(body);

    return {
        el: wrap,
        /** Append the rack's controls here. */
        body,
        /** Right-aligned slot for ONE control that is set once. */
        header,
        head,
        /** The read-only state, in the label's row. Nullish clears it. */
        setAside(text) { aside.textContent = (text === null || text === undefined) ? '' : String(text); },
        setLabel(text) { name.textContent = text === null || text === undefined ? '' : String(text); },
    };
}

/**
 * A WELL — a slot cut into the chassis.
 *
 * Darker than what surrounds it, rounder than the chassis (a routed slot has a
 * tool radius), and it means one thing: *this is a readout, not a control*.
 * The climb rail lives in one; so does a blocked status line, which is the
 * same idea turned to urgency — a message that has to stop you gets cut into
 * the panel instead of printed on it.
 *
 * `tone` paints the stroke: `warn` for the amber one.
 */
export function well(tone = null) {
    const n = el('div', 'fbk-well');
    if (tone) n.dataset.tone = tone;
    return n;
}

/**
 * A FIELD — a labelled well with controls in it.
 *
 *     ┌──────────────────────────────────────────┐
 *     │  STEP        +2  │ +5 │  +10             │
 *     └──────────────────────────────────────────┘
 *
 * This is the unit the rack is actually built from, and getting it wrong is
 * what made a first attempt at this design look nothing like it. The rows had
 * the right controls in the right order and sat on FLAT ground: label outside
 * on the left, control to its right, no boundary anywhere. What the design
 * does instead is put **every control group in a well with its own label
 * inside it** — so a rack reads as four objects bolted to a chassis rather
 * than as four lines of a form.
 *
 * The label goes inside for a reason beyond looks: a label in an external
 * column has to share a fixed width with every other label in the panel, so
 * `DIFFICULTY` forces `STEP` to start 40px further right than it needs to.
 * Inside its own well each label takes the room it needs and the wells still
 * line up, because the WELLS are what is aligned.
 */
export function field(opts = {}) {
    const { label = '', tone = null, tight = false } = opts;
    const wrap = el('div', tight ? 'fbk-field fbk-field-tight' : 'fbk-field');
    if (tone) wrap.dataset.tone = tone;
    const legend = label ? el('span', 'fbk-field-label', label) : null;
    if (legend) wrap.appendChild(legend);
    const body = el('div', 'fbk-field-body');
    wrap.appendChild(body);
    return {
        el: wrap,
        /** Append the controls here. */
        body,
        label: legend,
        setLabel(text) { if (legend) legend.textContent = text === null || text === undefined ? '' : String(text); },
    };
}

/**
 * A RAIL — a ladder, as a readout.
 *
 *     CLIMB · ON RUNG              3 clean runs to goal
 *     ●───────◉───────○───────○───────○
 *     80      85      90      95     100
 *
 * NOT PRESSABLE, and that is the design rather than a limitation. The rungs
 * DERIVE from start, step and goal — three steppers own those — so a rail you
 * could click would be a fourth writer of a value three controls already
 * write, which is §15's defect exactly. It shows three states: cleared,
 * current, ahead.
 *
 * And there is deliberately no caption warning about time-stretch on the slow
 * rungs. The rack is called SPEED, its audience already reaches for a practice
 * tool, and a permanent warning about a choice somebody made on purpose is
 * what §4 exists to prevent.
 */
/**
 * Half the widest dot, and therefore how far in the track starts.
 *
 * A constant, because the whole point is that the rail's length does not
 * change with the number of rungs — see the note in `set()`.
 */
const RAIL_INSET = 10;

/**
 * How close a dragged handle has to be to an edge before it snaps.
 *
 * In pixels, because "near" is a distance on screen: it scales with the song's
 * length on its own, where a threshold in seconds would be generous on a short
 * song and useless on a long one.
 */
const SNAP_PX = 14;

/**
 * The most air a zone gives up on each side so the row reads as zones.
 *
 * A cap rather than a value: each block gets the smaller of this and a quarter
 * of its own width, so a chart of ten sections and a chart of seventy-three
 * phrases both come out as a row of separate things.
 */
const BLOCK_GAP_PX = 3;

/**
 * The least air between two zones — they must never touch.
 *
 * A proportional gap alone gives a four-pixel phrase a gap you cannot see, so
 * a row of thin zones reads as one bar again. Half a pixel each side is a
 * hairline, which is all "these are two things" needs.
 */
const BLOCK_GAP_MIN_PX = 0.5;

/**
 * Below this a zone cannot afford to give any away.
 *
 * A sub-pixel block asked for the minimum gap would spend its whole width on
 * it and paint nothing — visible-as-nothing while still being clickable, which
 * is worse than touching its neighbour.
 */
const BLOCK_GAP_FLOOR_PX = 2;

/**
 * How much of a zone's own painted width its corner may take.
 *
 * A radius is only a corner while it is small against the side it is rounding.
 * At `radius-seg` on a three-pixel bar it saturates and the zone becomes a
 * lozenge — reported as the radius being too high when the blocks are small,
 * which is the same arithmetic as a border radius on a thin button. A third of
 * the paint keeps a corner a corner; wide zones hit the cap and keep the
 * design's own radius.
 */
const BLOCK_RADIUS_SHARE = 3;

/**
 * How far apart the two brackets have to be before both letters fit.
 *
 * They are centred on their own rails, so the pair overlaps only when the
 * selection is narrower than one 10px letter — plus two pixels so they never
 * touch. Anchored INSIDE the selection instead, the same letters needed 22px
 * and were therefore hidden on every section of a five-minute song.
 */
const TAG_ROOM_PX = 12;

export function rail(opts = {}) {
    const { ariaLabel = null } = opts;
    const wrap = el('div', 'fbk-rail');
    wrap.setAttribute('role', 'img');
    if (ariaLabel) wrap.setAttribute('aria-label', ariaLabel);
    const line = el('div', 'fbk-rail-line');
    const dots = el('div', 'fbk-rail-dots');
    const marks = el('div', 'fbk-rail-marks');
    wrap.appendChild(line);
    wrap.appendChild(dots);
    wrap.appendChild(marks);

    let signature = '';

    return {
        el: wrap,
        /**
         * `rungs` is `[{ value, label, state }]`, state `done | on | next`.
         * Rebuilt only when the shape changes, so an idle tick is a class swap.
         */
        set(rungs) {
            const list = Array.isArray(rungs) ? rungs : [];
            /* A 21-rung ladder's dots would overlap at 12px. */
            wrap.dataset.dense = list.length > 8 ? 'true' : 'false';

            const sig = list.map((r) => r.value + ':' + (r.label === undefined ? '' : r.label)).join(',');
            if (sig !== signature) {
                signature = sig;
                dots.textContent = '';
                marks.textContent = '';
                /*
                 * EVERY DOT, BUT NOT EVERY LABEL.
                 *
                 * A step of +2 from 60 is 21 rungs, and 21 numbers in 330px is
                 * a smear. The dots are the ladder and they all belong — the
                 * shape of the climb is the information — while the labels are
                 * a convenience, so above a handful only the ends and every
                 * nth survive. The current rung is labelled by `set()` below
                 * whatever this leaves, because that one is never optional.
                 */
                const every = list.length <= 6 ? 1 : Math.ceil(list.length / 5);
                for (let i = 0; i < list.length; i += 1) {
                    const r = list[i];
                    /*
                     * WHERE this rung sits, as a fraction of a FIXED track.
                     *
                     * Equal flex cells aligned the dots to their numbers but
                     * made the track's usable length depend on how many rungs
                     * there were — the line's inset was half a cell, so
                     * switching from +5 to +2 visibly grew and shrank the
                     * rail. Reported: keep the line the same length and just
                     * add the extra steps inside it.
                     *
                     * So the track is constant and each rung is PLACED on it.
                     * The first is always at the inset and the last always at
                     * `100% - inset`, whatever comes between — and a dot and
                     * its number share the same fraction, so they cannot
                     * drift apart by construction rather than by arithmetic
                     * that has to be kept in step.
                     */
                    const at = list.length > 1 ? i / (list.length - 1) : 0;
                    const pos = `calc(${RAIL_INSET}px + ${at} * (100% - ${RAIL_INSET * 2}px))`;
                    /*
                     * A dot inside a CELL, not as the cell.
                     *
                     * The cells are what divide the rail into equal shares so
                     * a number lands under its dot; a dot itself is a fixed
                     * 12px circle. Making the dot the cell made it stretch to
                     * fill its share — one wide blue pill where a round dot
                     * belonged, which is what shipped for one version.
                     */
                    const cell = el('span', 'fbk-rail-cell');
                    cell.style.left = pos;
                    cell.appendChild(el('span', 'fbk-rail-dot'));
                    dots.appendChild(cell);

                    /*
                     * Every dot, but not every number — 11 rungs is a smear.
                     * An unlabelled mark is still PLACED, so it holds no width
                     * and steals none: the ones that survive stay on their own
                     * dots. An earlier version collapsed them to `width: 0` in
                     * a flex row instead, which let the survivors redistribute
                     * and put every label back off its dot.
                     */
                    /*
                     * Keep the ends and every nth — but NOT one that lands
                     * next to the end.
                     *
                     * With 11 rungs `every` is 3, so the kept indices were 0,
                     * 3, 6, 9 and 10: `98` printed a couple of pixels from
                     * `100`, which is a label that costs space and tells you
                     * nothing you were not about to read anyway. Reported as
                     * exactly that. A kept index has to be at least half a
                     * stride clear of the last one, which drops 98 and keeps
                     * 94 on a 16-rung ladder where the stride is wider.
                     */
                    const last = list.length - 1;
                    const clear = Math.max(1, Math.ceil(every / 2));
                    const keep = i === 0 || i === last
                        || (i % every === 0 && last - i >= clear);
                    const mark = el('span', 'fbk-rail-mark',
                        keep ? String(r.label === undefined ? r.value : r.label) : '');
                    mark.style.left = pos;
                    marks.appendChild(mark);
                }
            }
            const dn = dots.children;
            const mn = marks.children;
            for (let i = 0; i < list.length; i += 1) {
                /* `dn[i]` is the cell; the dot is its only child. */
                const dot = dn[i] && dn[i].children[0];
                if (dot) dot.dataset.state = list[i].state || 'next';
                if (!mn[i]) continue;
                mn[i].dataset.state = list[i].state || 'next';
                /*
                 * The rung you are ON always carries its number, even on a
                 * ladder too dense to label. "Which speed am I playing at" is
                 * the one question the rail exists to answer.
                 */
                if (list[i].state === 'on' && !mn[i].textContent) {
                    mn[i].textContent = String(list[i].label === undefined ? list[i].value : list[i].label);
                }
            }
            /*
             * The line fills to the current rung, so progress is a LENGTH.
             * Without it the only cue is how many dots are green, which is a
             * number you have to count — and counting is the thing a HUD is
             * supposed to save you.
             */
            /*
             * The fill is a fraction of the line, and the line now spans the
             * outer dots' centres — so the current rung's index over the gaps
             * between them is exactly right, with no edge correction.
             */
            const onAt = list.findIndex((r) => r.state === 'on');
            const pct = list.length > 1 && onAt >= 0 ? (onAt / (list.length - 1)) * 100 : 0;
            line.style.setProperty('--fbk-fill', pct + '%');
        },
    };
}

/**
 * An LED METER — a discrete grade bar.
 *
 * Segments rather than a smooth fill, because what it reports IS discrete: a
 * count of judged notes, of attempts, of cleared runs. A continuous bar
 * promises a precision the number behind it does not have — and at 8% a smooth
 * meter is a sliver you cannot see, while ten cells with one lit is
 * unambiguous.
 *
 * Grade colours only, and never on anything pressable (§3).
 */
export function ledMeter(opts = {}) {
    const { segments = 10 } = opts;
    const wrap = el('span', 'fbk-led');
    const cells = [];
    for (let i = 0; i < segments; i += 1) {
        const c = el('span', 'fbk-led-cell');
        cells.push(c);
        wrap.appendChild(c);
    }
    return {
        el: wrap,
        /** `value` 0..100 and a band name. A nullish value lights nothing. */
        set(value, bandName) {
            const v = num(value);
            const lit = v === null ? 0 : Math.round((Math.max(0, Math.min(100, v)) / 100) * segments);
            for (let i = 0; i < cells.length; i += 1) {
                if (i < lit && bandName) cells[i].dataset.band = bandName;
                else delete cells[i].dataset.band;
            }
        },
    };
}

/**
 * A STATUS LINE whose chrome scales with urgency.
 *
 *     ● ok — a plain line, no well
 *     ┌────────────────────────────────────────────────┐
 *     │ ● blocked — a well, an amber stroke    Fix ›   │
 *     └────────────────────────────────────────────────┘
 *
 * Three states, three amounts of furniture, and that is the part worth
 * copying: a message that is merely true gets a line; a message that stops you
 * gets cut into the chassis and outlined.
 *
 * `ok` is SILENT unless a caller insists. "Everything is normal" is a signal
 * that carries nothing (§16) — the green dot on a primary, again — so nothing
 * is drawn until there is something to say.
 *
 * `act` adds the trailing link, because a blocked state you cannot act on is a
 * dead end. If there is a fix, it belongs within reach of the sentence.
 */
export function statusLine() {
    const wrap = el('div', 'fbk-status');
    wrap.hidden = true;
    wrap.appendChild(el('span', 'fbk-status-dot'));
    const text = el('span', 'fbk-status-text');
    const action = el('button', 'fbk-status-action');
    action.type = 'button';
    action.hidden = true;
    wrap.appendChild(text);
    wrap.appendChild(action);

    let handler = null;
    action.addEventListener('click', () => { if (handler) handler(); });

    return {
        el: wrap,
        /** `state` is `ok | warn | blocked`, or nullish to say nothing. */
        set(state, message, act = null) {
            const quiet = !state || !message;
            wrap.hidden = quiet;
            if (quiet) { handler = null; action.hidden = true; return; }
            wrap.dataset.state = state;
            text.textContent = String(message);
            handler = act && typeof act.onClick === 'function' ? act.onClick : null;
            action.hidden = !handler;
            action.textContent = handler ? String(act.label) + ' ›' : '';
        },
    };
}

/**
 * A LIST ROW — a name, a grade, a value, and a way in.
 *
 * `h-md`, because it is pressed while the song is running.
 */
export function listRow(opts = {}) {
    const {
        label = '', value = null, band: bandName = null,
        title = '', onClick = null, segments = 12,
    } = opts;
    const row = el(onClick ? 'button' : 'div', 'fbk-list-row');
    if (onClick) {
        row.type = 'button';
        row.addEventListener('click', onClick);
    }
    if (title) row.title = title;
    row.appendChild(el('span', 'fbk-list-name', label));
    const meter = ledMeter({ segments });
    meter.set(value, bandName);
    row.appendChild(meter.el);
    row.appendChild(el('span', 'fbk-list-value', num(value) === null ? '–' : Math.round(num(value)) + '%'));
    if (onClick) row.appendChild(el('span', 'fbk-list-chev', '›'));
    return row;
}

/**
 * A RANGE STRIP — the phrase timeline, and the only loop selector there is.
 *
 *     ┌──┬────────────┬──┐
 *     │A │            │B │   ▮▮▯▮▮▯▯▮▮▯
 *     └──┴────────────┴──┘
 *
 * One control replaced four: mode tabs, section chevrons, a phrase stepper and
 * two rows of edge steppers. The argument is direct manipulation — the thing
 * you want to say is "loop from here to here", and every one of those controls
 * was a way of spelling that out in numbers instead of pointing at it.
 *
 * Three gestures, and they do not overlap:
 *   - **tap a block** loops that block
 *   - **drag a handle** moves that edge, snapping to block edges
 *   - **drag across the blocks** takes a fresh range
 *
 * The blocks stay PROPORTIONAL to the song, because the strip is a map and a
 * map whose widths lie is not one. Which makes some blocks too thin to hit, so
 * the geometry and the hit test are separate: every block gets a target at
 * least `minHit` wide grown about its own centre, and a tap picks the target
 * whose centre is nearest. Nothing moves on screen. (§12.)
 *
 * A block with nothing in it is drawn and NOT in the hit table — the strip
 * stays truthful about the song's shape while refusing to let you land
 * somewhere nothing can happen.
 *
 * `onPick(key)`, `onEdge(which, seconds)` and `onDrag(a, b)` are the whole
 * write surface; the strip holds no state and is redrawn from `set()`.
 */
export function rangeStrip(opts = {}) {
    const {
        minHit = 40, ariaLabel = null,
        onPick = null, onEdge = null, onDrag = null,
        slop = 4,
    } = opts;

    const wrap = el('div', 'fbk-strip');
    wrap.setAttribute('role', 'group');
    if (ariaLabel) wrap.setAttribute('aria-label', ariaLabel);
    const blocks = el('div', 'fbk-strip-blocks');
    /*
     * THE SELECTION IS A FRAME AND THE EDGES ARE BRACKETS.
     *
     * They were two filled tabs hanging off the outside of the selection —
     * which is a picture of two blocks either side of it, not of a region with
     * two edges, and on a narrow loop the pair read as one blob. A bracket
     * belongs to the thing it encloses: taller than the strip so it reads as a
     * frame over the map rather than another block on it, with corner ticks
     * turning inward and a small letter in the corner.
     *
     * Small, because the steppers underneath carry the big A and B. Up here
     * the letter only has to say which bracket you grabbed.
     */
    const sel = el('div', 'fbk-strip-sel');
    const bracket = (letter) => {
        const h = el('button', 'fbk-strip-handle');
        h.appendChild(el('span', 'fbk-strip-bracket'));
        h.appendChild(el('span', 'fbk-strip-tag', letter));
        return h;
    };
    const handleA = bracket('A');
    const handleB = bracket('B');
    handleA.type = 'button';
    handleB.type = 'button';
    handleA.dataset.edge = 'start';
    handleB.dataset.edge = 'end';
    handleA.title = 'Drag to move the loop start — snaps to a phrase edge';
    handleB.title = 'Drag to move the loop end — snaps to a phrase edge';
    sel.appendChild(handleA);
    sel.appendChild(handleB);
    /*
     * AN INNER TRACK, and it exists for one reason: air at the ends.
     *
     * A loop starting at bar one puts its bracket on the strip's own border,
     * where a 3px rail and the well's edge are the same line and the letter has
     * nowhere to sit. Padding the strip does NOT solve it — an absolutely
     * positioned child's containing block is the padding BOX, so `inset: 0`
     * lands inside the border and the padding never pushes it in. The inset has
     * to be on something the blocks and the frame both live in.
     *
     * So the track is the timeline: time zero is its left edge, the duration is
     * its right, and `rect()` measures it. Everything that converts a pixel to
     * a second reads that one box.
     */
    /*
     * THE PLAYHEAD IS A LINE.
     *
     * It used to be a lit LEFT EDGE of whichever block held the playhead,
     * which gets two things wrong at once: it takes the block's corner radius,
     * so the mark is curved, and it can only ever be where a block begins — so
     * it jumps from zone to zone instead of moving. Reported as both.
     *
     * A one-pixel line placed at a fraction of the track has neither problem.
     * It is square because it is an instant, and it is as tall as the zones
     * because that is what it is crossing.
     */
    const head = el('div', 'fbk-strip-head');
    head.hidden = true;

    const track = el('div', 'fbk-strip-track');
    track.appendChild(blocks);
    track.appendChild(head);
    track.appendChild(sel);
    wrap.appendChild(track);

    let items = [];          // [{key, start, end, events, band, graduated}]
    let duration = 0;
    let hits = [];           // [{key, centre, from, to}] in px
    let signature = '';
    const nodes = new Map();

    /*
     * THE TRACK'S INNER BOX, not the strip's border box.
     *
     * The strip pads itself horizontally so the brackets have somewhere to
     * stand at bar one and at the last bar — and the moment it does, "where is
     * time zero" stops being the left edge of the element. Everything that
     * converts between a pixel and a second reads this, so there is exactly one
     * answer: the blocks row IS the timeline, and it is already inset by the
     * padding because it is an absolutely positioned child.
     *
     * Measuring `wrap` instead would put every drag, every snap and every hit
     * out by the padding, in the same direction, invisibly.
     */
    const rect = () => track.getBoundingClientRect();
    const timeAt = (clientX) => {
        const r = rect();
        if (!r.width || !duration) return 0;
        const x = Math.max(0, Math.min(r.width, clientX - r.left));
        return (x / r.width) * duration;
    };

    /**
     * The block boundary nearest a time — what a handle snaps to.
     *
     * ZERO AND THE DURATION COUNT AS BOUNDARIES. Without them, dragging A to
     * the very start snapped to the first block's start instead, which on a
     * chart whose first phrase begins at 0:03 meant the loop could not be
     * moved before 0:03 however far you dragged — reported exactly that way.
     * The song's own ends are edges; leaving them out made the strip narrower
     * than the song it draws.
     */
    function snap(seconds) {
        let best = seconds;
        let dist = Infinity;
        const edges = [0, duration];
        for (const it of items) edges.push(it.start, it.end);
        for (const edge of edges) {
            if (!Number.isFinite(edge)) continue;
            const d = Math.abs(edge - seconds);
            if (d < dist) { dist = d; best = edge; }
        }

        /*
         * SNAP ONLY WHEN NEAR, so a deliberate drag can place freely.
         *
         * It snapped unconditionally, which meant an edge could sit *only* on
         * a block boundary — and since the ± steppers move by a bar, there was
         * no way at all to place one mid-phrase. That is a real thing to want:
         * a lick with a pickup starts before the bar line.
         *
         * The threshold is in PIXELS converted to time, not in seconds,
         * because what "near" means is a distance on screen: 14px is about
         * half a fingertip and it scales with the song's length by itself,
         * where a fixed 0.5s would be generous on a two-minute song and
         * useless on a ten-minute one.
         */
        const w = rect().width || 1;
        const tolerance = duration > 0 ? (SNAP_PX / w) * duration : 0;
        return dist <= tolerance ? best : seconds;
    }

    function hitAt(clientX) {
        if (!hits.length) return null;
        const x = clientX - rect().left;
        let best = null;
        let bestDist = Infinity;
        for (const h of hits) {
            if (x < h.from || x > h.to) continue;
            const d = Math.abs(x - h.centre);
            if (d < bestDist) { bestDist = d; best = h.key; }
        }
        return best;
    }

    /*
     * A drag on a HANDLE and a drag on the STRIP are different gestures, and
     * the handle has to win — it sits on top of the blocks, so without the
     * `dragging` guard a grab of the handle would also start a fresh range
     * underneath it.
     */
    let dragging = null;     // 'start' | 'end'
    let sweepFrom = null;    // {x, t}

    for (const h of [handleA, handleB]) {
        h.addEventListener('pointerdown', (e) => {
            dragging = h.dataset.edge;
            h.setPointerCapture?.(e.pointerId);
            e.stopPropagation();
        });
        h.addEventListener('pointermove', (e) => {
            if (dragging !== h.dataset.edge || !onEdge) return;
            onEdge(dragging, snap(timeAt(e.clientX)));
        });
        h.addEventListener('pointerup', () => { dragging = null; });
        h.addEventListener('pointercancel', () => { dragging = null; });
    }

    wrap.addEventListener('pointerdown', (e) => {
        if (dragging) return;
        sweepFrom = { x: e.clientX, t: timeAt(e.clientX) };
    });
    wrap.addEventListener('pointermove', (e) => {
        if (dragging || !sweepFrom || !onDrag) return;
        if (Math.abs(e.clientX - sweepFrom.x) < slop) return;
        const t = timeAt(e.clientX);
        onDrag(Math.min(sweepFrom.t, t), Math.max(sweepFrom.t, t));
    });
    wrap.addEventListener('pointerup', (e) => {
        if (dragging) { dragging = null; sweepFrom = null; return; }
        if (!sweepFrom) return;
        // Under the slop it was a tap, which loops the block it landed on.
        if (Math.abs(e.clientX - sweepFrom.x) < slop && onPick) {
            const key = hitAt(e.clientX);
            if (key) onPick(key);
        }
        sweepFrom = null;
    });

    return {
        el: wrap,
        handles: { start: handleA, end: handleB },
        /**
         * `list` is the blocks, `range` is `{start, end}` or null.
         *
         * `band` paints the grade; `events === 0` marks a block as empty and
         * takes it out of the hit table. `null` events means NOT COUNTED YET
         * and is left alone — `Number(null)` is 0, and reading absent as empty
         * is how a whole strip once went inert between a song loading and its
         * chart arriving.
         */
        set(list, songSeconds, range) {
            items = Array.isArray(list) ? list : [];
            duration = Number(songSeconds) > 0 ? Number(songSeconds) : 0;

            const sig = items.map((i) => i.key).join('|') + '@' + duration;
            if (sig !== signature) {
                signature = sig;
                blocks.textContent = '';
                nodes.clear();
                for (const it of items) {
                    const b = el('div', 'fbk-strip-block');
                    b.dataset.key = it.key;
                    b.style.left = ((it.start / duration) * 100) + '%';
                    b.style.width = (((it.end - it.start) / duration) * 100) + '%';
                    nodes.set(it.key, b);
                    blocks.appendChild(b);
                }
            }

            /*
             * EVERY ZONE LEAVES A GAP, and it is sized from the zone's own
             * width rather than fixed.
             *
             * Contiguous blocks with a hairline between them read as one
             * hatched bar, and the new brackets need air to sit against. But a
             * fixed gap is only right at one density: this strip carries ten
             * sections on one chart and seventy-three phrases on another, and
             * 3px of padding on a 4px phrase leaves nothing to look at. A
             * quarter of the block, capped, is a gap at both.
             */
            const stripW = rect().width || 0;
            for (const it of items) {
                const node = nodes.get(it.key);
                if (!node) continue;
                const px = duration > 0 ? ((it.end - it.start) / duration) * stripW : 0;
                const gap = px < BLOCK_GAP_FLOOR_PX
                    ? 0
                    : Math.min(BLOCK_GAP_PX, Math.max(BLOCK_GAP_MIN_PX, px / 6));
                node.style.setProperty('--fbk-block-gap', gap.toFixed(2) + 'px');
                /*
                 * The corner follows the paint, not the box: the gap has
                 * already come out of the width by the time you see it.
                 */
                const paint = Math.max(0, px - gap * 2);
                node.style.setProperty('--fbk-block-radius',
                    (paint / BLOCK_RADIUS_SHARE).toFixed(2) + 'px');
                node.dataset.band = it.band || 'none';
                /* What KIND of zone — a phrase, a section, or time no zone
                   covers. The last of those is drawn differently. */
                node.dataset.kind = it.kind || '';
                node.dataset.empty = num(it.events) === 0 ? 'true' : 'false';
                node.classList.toggle('fbk-strip-block-done', !!it.graduated);
                if (it.title) node.title = it.title;
            }

            /*
             * The hit table: each selectable block's own extent, PADDED by
             * half a hit target on each side, resolved by nearest centre.
             *
             * The padding is what makes a thin block reachable, and it is
             * also what makes the two empty-block behaviours fall out of one
             * rule. Growing symmetrically about the CENTRE instead — which is
             * what this did first — left a dead band wherever an empty block
             * sat between two blocks already wider than `minHit`: neither
             * neighbour grew, so a 3px gap swallowed taps and gave no reason.
             * Padding the edges tiles a small gap and still leaves a wide one
             * dead, which is the right pair: a tap that silently jumps an inch
             * away is worse than a tap that plainly does nothing.
             */
            const w = rect().width || 0;
            const pad = minHit / 2;
            hits = items
                .filter((it) => num(it.events) !== 0)
                .map((it) => {
                    const l = (it.start / duration) * w;
                    const r = (it.end / duration) * w;
                    return { key: it.key, centre: (l + r) / 2, from: l - pad, to: r + pad };
                });

            const has = range && duration > 0
                && Number.isFinite(Number(range.start)) && Number.isFinite(Number(range.end));
            sel.hidden = !has;
            if (has) {
                sel.style.left = ((range.start / duration) * 100) + '%';
                sel.style.width = (((range.end - range.start) / duration) * 100) + '%';
                /*
                 * Whether the two bracket letters have room side by side —
                 * and NOT DECIDED AT ALL when the strip has no width yet.
                 *
                 * `set()` runs while the panel is closed, where every element
                 * measures zero, and `0 < 34` is true: a strip that had never
                 * been laid out reported a narrow selection and hid both
                 * letters. Absence read as smallness, which is the same
                 * mistake as `Number(null) === 0` in a different costume. When
                 * we cannot measure, we show.
                 */
                const selPx = ((range.end - range.start) / duration) * stripW;
                sel.dataset.narrow = (stripW > 0 && selPx < TAG_ROOM_PX) ? 'true' : 'false';
                /*
                 * AT THE EXTREMES THE HANDLES TURN INWARD.
                 *
                 * They hang outside the selection so a narrow loop still reads
                 * as two edges — but a loop that starts at 0 puts A outside the
                 * STRIP, and `.fbk-body` is a scroll container, so it clips
                 * whatever leaves. Reported as the handles being slightly cut
                 * at the ends.
                 *
                 * Flipped to the inside there. It is the one case where inside
                 * cannot be ambiguous: at the very start there is nothing to
                 * the left of A to confuse it with.
                 */
                const eps = duration * 0.01;
                /*
                 * WHAT USED TO BE HERE: `atStart` / `atEnd`, which turned the
                 * handles inward at the ends so the scroll container could not
                 * clip them.
                 *
                 * The brackets do not need it. The drag column is centred on
                 * the edge and INVISIBLE, so nothing is lost when half of it
                 * falls outside; the mark and the letter are both anchored
                 * inward by construction. A rule that flipped their side is a
                 * rule about a mechanism that is gone.
                 */
            }
        },
        /**
         * Put the playhead at `seconds`, or hide it with null.
         *
         * Called as often as the caller likes — it writes one property and
         * reads nothing, so driving it from a frame loop is the intended use.
         * That is the other half of "it should move smoothly": at the panel's
         * own twice-a-second render, even a correctly placed line steps.
         */
        playhead(seconds) {
            const t = Number(seconds);
            const ok = Number.isFinite(t) && duration > 0 && seconds !== null && seconds !== undefined;
            head.hidden = !ok;
            if (!ok) return;
            /*
             * ONLY WHEN IT MOVES.
             *
             * This is called from a frame loop, so a paused song asked for the
             * same `left` sixty times a second — each one a style write on an
             * element inside the player, and each one work the compositor has
             * to consider. A gauge that does not move should cost nothing.
             */
            const at = Math.max(0, Math.min(1, t / duration));
            const next = (at * 100).toFixed(4) + '%';
            if (head.style.left !== next) head.style.left = next;
        },
        disable(off) {
            handleA.disabled = !!off;
            handleB.disabled = !!off;
        },
    };
}

/**
 * A FOLDED STRIP — the panel, shrunk to what you can read while playing.
 *
 *     ┌──────────────────────────────────────────────┐
 *     │  LIVE  SPEED                3 runs to goal   │
 *     │  91%   ●───◉───○───○───○                     │
 *     │  ● Intro 1  ▮▮▮▯▯▯   4/7 · 0:41.2            │
 *     └──────────────────────────────────────────────┘
 *
 * No buttons in it. The WHOLE BLOCK is the target, because the one thing you
 * might want mid-song is "give me the rest of it" and aiming at a chevron with
 * a guitar in your hands is not a gesture. Hover and focus turn the stroke and
 * the grip blue and reveal the key hint in the corner — the affordance appears
 * when you go looking for it and stays out of the way when you do not.
 *
 * It is a STATE of the panel, not a second widget: same layer, same open and
 * close, same shortcut registry. Two objects would be two z-indexes, two
 * lifecycles, and two places for a bug about which one is showing.
 */
export function foldedStrip(opts = {}) {
    const { label = 'OPEN', hint = null, onOpen = null, onEnd = null, endLabel = 'End' } = opts;

    /*
     * A DIV WITH A FULL-AREA HIT, not one big <button>.
     *
     * It was a button, which is the honest markup for "the whole block is the
     * target" — and it capped the control at exactly one action, because a
     * button inside a button is invalid and does not fire. That cap became a
     * problem the moment we hid the detector's own drill HUD: that HUD carried
     * the only one-press way OUT of a running drill, and a loop you cannot
     * stop without first opening something is a trap.
     *
     * So: the hit is a button stretched behind the content, the content sits
     * above it and passes clicks through, and anything that needs its own
     * press takes `pointer-events: auto` and wins. Same single-target feel,
     * room for the one control that has to be reachable.
     */
    const wrap = el('div', 'fbk-folded');

    const hit = el('button', 'fbk-folded-hit');
    hit.type = 'button';
    hit.setAttribute('aria-expanded', 'false');
    hit.setAttribute('aria-label', hint ? label + ' (' + hint + ')' : label);
    if (onOpen) hit.addEventListener('click', onOpen);
    wrap.appendChild(hit);

    /*
     * The grip and the cue share the top lane and CROSS-FADE.
     *
     * The cue used to be pinned to the bottom right, where it landed on top of
     * the row of facts — reported as unreadable, and it was: two texts drawn
     * in the same sixty pixels. The lane is the one place in the strip that
     * holds no content, and it is already where the affordance is, so the
     * handle simply labels itself when you point at it. Nothing is covered,
     * because nothing else is ever there.
     */
    wrap.appendChild(el('span', 'fbk-folded-grip'));
    const cue = el('span', 'fbk-folded-cue', hint ? label + ' \u00b7 ' + hint : label);
    wrap.appendChild(cue);

    /*
     * TWO ZONES, because the footswitch belongs to the UPPER one.
     *
     * It was a flex sibling of the whole readout column, so a 56px pedal beside
     * an 85px stack sat centred across BOTH rows and squeezed the lower one out
     * of the corner — reported as the stop being in the wrong place. In the
     * design the switch shares its line with the live number and the rail, and
     * the row of facts runs the full width underneath it, divider included.
     *
     * So: a grid. `body` is the upper zone next to the switch, `foot` spans
     * both columns beneath. The consumer decides what goes in each, which is
     * the only part of this the kit cannot know.
     */
    const body = el('span', 'fbk-folded-body');
    wrap.appendChild(body);
    const foot = el('span', 'fbk-folded-foot');
    wrap.appendChild(foot);

    /*
     * THE WAY OUT — a footswitch, and it looks like one.
     *
     * A tall thin column read as a scrollbar or a divider rather than a
     * control, and next to a hover-revealed OPEN it looked like the pair of a
     * thing it is not: reported as the two fighting. A square you stamp on is
     * the shape this action has on real gear, and it settles the conflict by
     * being a different KIND of object from the handle beside it — one is a
     * lid you lift, one is a pedal you hit.
     *
     * The glyph is a DRAWN square, not `\u25a0`: at this size the character's
     * weight and vertical placement move with whatever font resolved, and a
     * stop icon that sits a pixel high looks broken rather than styled.
     */
    let end = null;
    if (onEnd) {
        end = el('button', 'fbk-folded-end');
        end.type = 'button';
        end.title = endLabel;
        end.appendChild(el('span', 'fbk-folded-end-icon'));
        end.appendChild(el('span', 'fbk-folded-end-cap', endLabel));
        /*
         * `stopPropagation` is not what keeps this from opening the panel —
         * the hit is a SIBLING, and an event only bubbles to ancestors. It is
         * here for a consumer that delegates on the wrap.
         */
        end.addEventListener('click', (ev) => { ev.stopPropagation(); onEnd(); });
        wrap.appendChild(end);
    }

    return {
        el: wrap,
        /** The full-area target. Exposed so a consumer can focus it. */
        hit,
        /**
         * The upper zone, beside the footswitch. Nothing pressable — clicks
         * fall through to the full-area target.
         */
        body,
        /**
         * The full-width row underneath, running past the footswitch.
         *
         * For the line of facts that wants the whole width — the passage, a
         * meter, a count. Left empty it collapses.
         */
        foot,
        /** The stop control, or null when no `onEnd` was given. */
        end,
        /**
         * Relabel the way out.
         *
         * Which run you are stopping is a state — a drill and a free loop are
         * both "the thing that is playing" and they are not stopped by the
         * same word — so the cap is settable rather than fixed at build.
         */
        setEnd(text) {
            if (!end) return;
            const cap = end.querySelector('.fbk-folded-end-cap');
            if (cap) cap.textContent = text === null || text === undefined ? '' : String(text);
            end.title = text ? String(text) : '';
        },
        setCue(text) { cue.textContent = text === null || text === undefined ? '' : String(text); },
    };
}

/** A big tabular number with a small unit — DESIGN.md §7. */
export function readout(unit) {
    const wrap = el('span', 'fbk-readout');
    const value = el('span', 'fbk-readout-value', '–');
    wrap.appendChild(value);
    if (unit) wrap.appendChild(el('span', 'fbk-readout-unit', unit));

    /*
     * A SECOND NUMBER, derived, after the one you set.
     *
     * `5 -> 7.8`: what you asked for, and what is actually on screen once the
     * tempo has widened the window. It belongs beside the value rather than in
     * a hint, because it is a READING that changes while you play.
     *
     * On the READOUT rather than on the slider, because every readout has the
     * same question: a stepper's value can have a derived companion too. And it
     * must never be what the control writes to — §21.
     */
    const aside = el('span', 'fbk-readout-aside');
    aside.hidden = true;
    wrap.appendChild(aside);

    return {
        el: wrap,
        /** The derived companion, or null to hide it. */
        setAside(text) {
            const t = (text === null || text === undefined || text === '') ? null : String(text);
            aside.hidden = t === null;
            aside.textContent = t === null ? '' : t;
        },
        set(v) { value.textContent = (v === null || v === undefined) ? '–' : String(v); },
    };
}

/** The slab of facts about whatever is selected. */
export function plate() {
    const wrap = el('div', 'fbk-plate');
    const title = el('span', 'fbk-plate-title');
    const meta = el('span', 'fbk-plate-meta');
    wrap.appendChild(title);
    wrap.appendChild(meta);
    return {
        el: wrap,
        set(t, m) {
            title.textContent = t || '';
            meta.textContent = m || '';
        },
    };
}

/**
 * FAMILY 1 — segmented. Pick one of a small fixed set.
 *
 * `items` is `[{ value, label, title }]`. `onPick` gets the value.
 */
export function segmented(items, onPick, ariaLabel, opts = {}) {
    /*
     * TWO SIZES, and the rule is when you touch it, not what it holds.
     *
     *   row     `h-md` — values you change while setting up a passage
     *   header  `h-sm` — a unit or a mode set once, in a rack's header slot
     *
     * A `TIME | BARS` switch and a `+2 | +5 | +10` step are the same widget
     * and want different sizes, because one of them you set on the first day
     * and the other you reach for every passage.
     */
    /*
     * PAST FOUR OPTIONS IT WRAPS, and that is not a second widget.
     *
     * Five named choices in one row gives each of them a fifth of the panel —
     * `Sight-reading` in 66 pixels — so the row either truncates the words or
     * stops being a row. The same pick, laid out as chips over two lines, keeps
     * every label whole and reads as one group because it still is one.
     *
     * DERIVED from the option count, like the strip's zone gap and its corner
     * radius: whoever declares five options should not also have to know that
     * five is where a row stops working. `opts.wrap` forces it either way for
     * the case the count cannot see.
     */
    /*
     * TWO REASONS TO WRAP, and the second one is the half I missed first.
     *
     * The count is one: five options in a row get a fifth of the width each.
     * But four options can overflow just as badly if the labels are long — a
     * four-way pick whose options read `The fret, with the note name beside it`
     * has 120 characters in a row with room for about thirty-six, and it does
     * not wrap, it ESCAPES: the buttons render past the edge of the card.
     *
     * Thirty-six characters across all labels is the budget the design's own
     * notes name, and it is the right unit — what fails is the text not
     * fitting, so the measure has to be the text.
     */
    const list = items || [];
    const chars = list.reduce(
        (n, it) => n + ((it.label && it.label.nodeType) ? 0 : String(it.label || '').length),
        0,
    );
    const many = list.length > SEG_MAX_INLINE || chars > SEG_MAX_CHARS;
    const laid = (opts.wrap === undefined) ? many : !!opts.wrap;
    const cls = ['fbk-seg'];
    if (opts.size === 'header') cls.push('fbk-seg-header');
    if (laid) cls.push('fbk-seg-wrap');
    const wrap = el('div', cls.join(' '));
    wrap.setAttribute('role', 'group');
    if (ariaLabel) wrap.setAttribute('aria-label', ariaLabel);
    const nodes = new Map();
    const marks = new Map();
    for (const it of (items || [])) {
        const b = button('fbk-seg-btn', null, it.title || null, () => onPick(it.value));
        /*
         * A LABEL CAN BE A NODE, not only a string.
         *
         * Some options ARE a picture: `(5) A#` says what a note head shows by
         * being one, and a word for it would be a caption on a caption. Those
         * cannot arrive as text, so an item's `label` is appended when it is a
         * node and set as text when it is not.
         *
         * The wrap budget above measures only the string form, which is right:
         * a drawn option is as wide as it is drawn, not as long as its name.
         */
        const label = el('span', 'fbk-seg-label');
        if (it.label && typeof it.label === 'object' && it.label.nodeType) {
            label.appendChild(it.label);
        } else {
            label.textContent = (it.label === null || it.label === undefined) ? '' : String(it.label);
        }
        b.appendChild(label);
        b.setAttribute('aria-pressed', 'false');
        nodes.set(it.value, b);
        wrap.appendChild(b);
    }
    return {
        el: wrap,
        /** Light exactly one. */
        set(value) {
            for (const [v, b] of nodes) {
                const on = v === value;
                b.classList.toggle('fbk-on', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            }
        },
        /**
         * Put a mark on one option, or clear it with null.
         *
         * For the thing a label cannot say: this preset is the one you picked
         * AND you have since changed something under it. Two facts about one
         * chip, so the second one cannot be another chip — it is a dot on this
         * one, in the alert-adjacent hue the rack's own header uses to say
         * EDITED.
         */
        mark(value, tone) {
            for (const [v, b] of nodes) {
                const want = (v === value) ? (tone || 'edit') : null;
                const had = marks.get(v) || null;
                if (want === had) continue;
                marks.set(v, want);
                const old = b.querySelector('.fbk-seg-mark');
                if (old) old.remove();
                if (want) {
                    const d = el('span', 'fbk-seg-mark');
                    d.dataset.tone = want;
                    b.appendChild(d);
                }
            }
        },
        disable(off) { for (const [, b] of nodes) b.disabled = !!off; },
        node(value) { return nodes.get(value) || null; },
        values() { return [...nodes.keys()]; },
    };
}

/**
 * How many options a single row of a segmented control can hold.
 *
 * Four, because the panel is 360px wide and a well takes some of that: five
 * named labels get about 66px each, which is not enough for a word like
 * `Sight-reading`. Past this the same control lays its options out as wrapping
 * chips — see the note in `segmented`.
 */
export const SEG_MAX_INLINE = 4;

/**
 * How many characters of label a single row can hold, across all its options.
 *
 * A count alone is not enough: four options whose labels run to a hundred
 * characters do not wrap, they escape the card. Thirty-six is what a 360px
 * panel's row fits at the label step, and a sheet's wider row is still the
 * place where a long option belongs on its own line rather than stretched.
 */
export const SEG_MAX_CHARS = 36;

/**
 * FAMILY 1b — a SELECT. One of a list too long, or too changeable, to lay out.
 *
 *     ┌────────────────────────────────────────┬───┐
 *     │  3D Highway                            │ v │
 *     └────────────────────────────────────────┴───┘
 *
 * The third answer to "pick one", and the rule for reaching it is the same as
 * the other two: it is the option COUNT that decides, not the author. Up to
 * four, a segmented row; past that, chips — until the list is long enough that
 * chips would be a wall, or the app supplies it at runtime so nobody knows how
 * many there will be. Then the choice collapses to the one that is current.
 *
 * IT IS A NATIVE `<select>`, and the list it opens is the platform's.
 *
 * The first build of this drew its own sheet under the well: rows, hover
 * states, a document-level pointer listener to close it, focus handling,
 * Escape. Withdrawn on the reader's call — "the sheet is not necessary, the
 * select is enough" — and they were right for more reasons than the one given.
 * A list of installed boards is not a place you design; it is a place you go
 * and come straight back from. Native gets keyboard, type-ahead, screen
 * readers, a gamepad, and a list that can be taller than the panel, none of
 * which a hand-drawn sheet had, and all of which have to keep working.
 *
 * What is ours is the WELL it sits in: the chassis, the corner, the chevron in
 * its own lit square. The element is transparent on top of that, so the control
 * looks like the rest of the rack and behaves like the platform.
 */
export function select(items, onPick, opts = {}) {
    const { ariaLabel = null, placeholder = 'Choose' } = opts;

    const wrap = el('div', 'fbk-select');

    const input = document.createElement('select');
    input.className = 'fbk-select-input';
    if (ariaLabel) input.setAttribute('aria-label', ariaLabel);
    input.addEventListener('change', () => onPick(input.value));
    wrap.appendChild(input);

    /*
     * The chevron is OURS and inert.
     *
     * A native select draws its own arrow, which is the platform's shape in the
     * platform's colour and lands wherever it lands. `appearance: none` takes
     * it away and this puts back one that belongs to the rack. `pointer-events`
     * are off in the stylesheet so the press still reaches the select
     * underneath — the well is the target, all of it.
     */
    wrap.appendChild(el('span', 'fbk-select-chevron'));

    let list = [];

    function build(next) {
        list = Array.isArray(next) ? next.slice() : [];
        input.textContent = '';
        for (const it of list) {
            const o = document.createElement('option');
            o.value = String(it.value);
            o.textContent = it.note ? `${it.label} — ${it.note}` : it.label;
            if (it.title) o.title = it.title;
            input.appendChild(o);
        }
        input.dataset.empty = list.length ? 'false' : 'true';
    }

    build(items);

    return {
        el: wrap,
        /** The `<select>` itself, for a caller that wants to focus it. */
        input,
        /**
         * Show `value` as current.
         *
         * A value that is not in the list leaves the element showing whatever
         * the platform picks, so it is reported rather than swallowed: a board
         * that was uninstalled while it was the chosen one is a real state, and
         * the panel above this should say so rather than quietly reading as
         * something else.
         */
        set(value) {
            const has = list.some((it) => String(it.value) === String(value));
            input.value = has ? String(value) : '';
            input.dataset.missing = has ? 'false' : 'true';
            return has;
        },
        /**
         * Replace the list, but only when it CHANGED.
         *
         * The board list comes from the app and can arrive after the panel does,
         * so this gets called on every render — and rebuilding a select's
         * options while its list is open closes it under the reader's hand.
         * `signature` is whatever string identifies the current list.
         */
        rebuild(signature, next) {
            if (wrap.dataset.sig === signature) return false;
            wrap.dataset.sig = signature;
            const was = input.value;
            build(next);
            if (was) input.value = was;
            return true;
        },
        disable(off) { input.disabled = !!off; },
        values() { return list.map((it) => String(it.value)); },
        /** The placeholder, for a list that has not arrived yet. */
        placeholder,
    };
}

/**
 * FAMILY 2 — chips. Pick a subset, and optionally show progress through it.
 *
 * `rail: true` puts them on a track, which is what lets the same widget be a
 * setting when idle and a progress display when something is running —
 * DESIGN.md §5, and the best control the kit has.
 *
 * State per chip is one of: `null` (not in the set), `'on'` (in it), `'now'`
 * (where we are), `'done'` (cleared).
 */
export function chips(items, onToggle, opts = {}) {
    const wrap = el('div', opts.rail ? 'fbk-chips fbk-chips-rail' : 'fbk-chips');
    wrap.setAttribute('role', 'group');
    if (opts.ariaLabel) wrap.setAttribute('aria-label', opts.ariaLabel);
    const nodes = new Map();

    function add(it) {
        const b = button('fbk-chip', it.label, it.title || null, () => onToggle(it.value));
        nodes.set(it.value, b);
        wrap.appendChild(b);
        return b;
    }
    for (const it of (items || [])) add(it);

    return {
        el: wrap,
        /**
         * Rebuild only when the SET changed.
         *
         * A rebuilt chip is a chip that cannot be clicked, and a panel that
         * re-renders twice a second would rebuild them mid-click. `signature`
         * is whatever string identifies the current set.
         */
        rebuild(signature, items2) {
            if (wrap.dataset.sig === signature) return false;
            wrap.dataset.sig = signature;
            wrap.textContent = '';
            nodes.clear();
            for (const it of (items2 || [])) add(it);
            return true;
        },
        set(states) {
            for (const [v, b] of nodes) {
                const s = states ? states[v] : null;
                b.classList.toggle('fbk-on', s === 'on');
                b.classList.toggle('fbk-now', s === 'now');
                b.classList.toggle('fbk-done', s === 'done');
            }
        },
        title(value, text) {
            const b = nodes.get(value);
            if (b) b.title = text || '';
        },
        disable(off, only) {
            for (const [v, b] of nodes) {
                b.disabled = !!off && (!only || only.includes(v));
            }
        },
        node(value) { return nodes.get(value) || null; },
    };
}

/** FAMILY 3 — a boolean. */
export function toggle(label, title, onChange) {
    const wrap = el('label', 'fbk-toggle');
    if (title) wrap.title = title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => onChange(input.checked));
    wrap.appendChild(input);
    /*
     * TEXT FIRST, then the switch.
     *
     * It read switch-then-text, which is the form convention and the wrong one
     * here: these live in a rack's header, right-aligned against the panel's
     * edge, so the switch has to be the thing nearest that edge or the row
     * ends in a word and the control floats in the middle of it.
     */
    wrap.appendChild(el('span', 'fbk-toggle-text', label));
    wrap.appendChild(el('span', 'fbk-toggle-track'));
    return {
        el: wrap,
        input,
        set(on) { input.checked = !!on; },
        disable(off) { input.disabled = !!off; },
    };
}

/**
 * FAMILY 4 — a number you nudge.
 *
 * No text input, deliberately: a number you type reads as a form. Values the
 * steps cannot reach belong on the settings page (DESIGN.md §1).
 */
export function stepper(opts = {}) {
    const {
        unit = '',
        step = 1,
        min = -Infinity,
        max = Infinity,
        onChange = () => {},
        downTitle = 'Less',
        upTitle = 'More',
        /**
         * How the value is printed, when it is not just a number.
         *
         * A clock, a bar number, a ratio. Without it a stepper can only hold
         * an integer with a unit, which covers most of them and not the ones
         * that matter most — a loop edge reads `0:03.0`, and formatting that
         * in the caller would mean the caller also owning the readout.
         */
        format = null,
    } = opts;

    const wrap = el('div', opts.wide ? 'fbk-stepper fbk-stepper-wide' : 'fbk-stepper');
    let value = num(opts.value) ?? 0;

    const down = button('fbk-step', '−', downTitle, () => bump(-step));

    /*
     * THE LABEL NAMES THE UNIT, and it goes INSIDE the stepper.
     *
     *     ┌───┬──────────┬───┐
     *     │ − │  START   │ + │
     *     │   │   80%    │   │
     *     └───┴──────────┴───┘
     *
     * Two steppers side by side with their legends in a separate label column
     * is two rows and a guess about which legend belongs to which; stacked
     * over the value it names, a stepper is one object you can read on its
     * own. It is also what lets `A · ±1 bar` exist at all — the label carries
     * both what the control is and what one press does, which no external
     * legend has room for.
     *
     * The `emph` flag paints the value blue: on a rack of steppers, one of
     * them is the number that drives the drill and the rest are policy.
     */
    const stack = el('div', 'fbk-stepper-stack');
    const legend = opts.label ? el('span', 'fbk-stepper-label', opts.label) : null;
    if (legend) stack.appendChild(legend);
    const out = readout(unit);
    if (opts.emph) out.el.dataset.emph = '1';
    stack.appendChild(out.el);

    const up = button('fbk-step', '+', upTitle, () => bump(step));
    wrap.appendChild(down);
    wrap.appendChild(stack);
    wrap.appendChild(up);

    function bump(by) {
        const next = Math.max(min, Math.min(max, value + by));
        if (next === value) return;
        value = next;
        out.set(format ? format(value) : value);
        sync();
        onChange(value);
    }

    function sync() {
        down.disabled = wrap.dataset.off === '1' || value <= min;
        up.disabled = wrap.dataset.off === '1' || value >= max;
    }

    out.set(format ? format(value) : value);
    sync();

    return {
        el: wrap,
        /** The legend above the value, for a caller that renames the unit. */
        label: legend,
        /**
         * The two buttons, so a caller can rewire them.
         *
         * A stepper usually owns its number: press, clamp, report. Some do
         * not — a loop edge is a TIME the model owns, and the buttons ask it
         * to move rather than changing anything here. Exposing them beats a
         * second half-stepper component whose only difference is who holds
         * the value.
         */
        down,
        up,
        get() { return value; },
        set(v) {
            const n = num(v);
            if (n === null) return;
            value = Math.max(min, Math.min(max, n));
            out.set(format ? format(value) : value);
            sync();
        },
        disable(off) {
            wrap.dataset.off = off ? '1' : '0';
            sync();
        },
    };
}

/** A HUD gauge that is still an `<input type="range">`, for the keyboard. */
/**
 * A gauge you drag: label, value, track — in that order, on one row.
 *
 *     CHART  100 %   ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * The order is the point. Version 0.4 put the value AFTER the track, which
 * spends the row on three separated things and leaves the track 129px of a
 * 306px body — 42% of the width for the only part you touch. 0.5 fixed the
 * width by stacking a label line above a full-width track, and that cost a
 * row and left the label and its value at opposite ends of it.
 *
 * Putting the value next to its label fixes both: they read as one thing
 * (Refactoring UI's "combine labels and values"), and the track gets
 * everything left over — 216px here — on one row.
 */
export function slider(opts = {}) {
    const {
        min = 0, max = 100, step = 1, unit = '%',
        ariaLabel, onInput = () => {},
        label = '',
    } = opts;

    const wrap = el('div', 'fbk-row fbk-slider-row');

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'fbk-slider';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    if (ariaLabel) input.setAttribute('aria-label', ariaLabel);

    const out = readout(unit);

    /*
     * THE LIT PART OF THE TRACK, painted by us.
     *
     * Firefox has `::-moz-range-progress` and Chromium has nothing — no
     * pseudo-element for the filled side of a range at all. So the fill is a
     * gradient on the input itself, with the stop driven by `--fbk-fill`, and
     * it is the only way to have a gauge that reads the same in both engines.
     * Without it the track was uniformly grey and only the thumb said where
     * the value was, which is the "no coloured bar" report.
     */
    function paint() {
        const lo = Number(min);
        const hi = Number(max);
        const v = Number(input.value);
        const frac = hi > lo ? (v - lo) / (hi - lo) : 0;
        input.style.setProperty('--fbk-fill', (Math.max(0, Math.min(1, frac)) * 100) + '%');
    }

    input.addEventListener('input', () => {
        out.set(input.value);
        paint();
        onInput(Number(input.value));
    });

    const heading = label ? el('span', 'fbk-label fbk-label-inline fbk-slider-label', label) : null;
    /*
     * WITH a label: label, value, track — the value beside the word that names
     * it, so they read as one unit and the track takes the rest.
     *
     * WITHOUT one: track, then value. A label-less slider is inside a `field`
     * whose legend already names it, so there is nothing for the value to pair
     * with on the left — and putting it there instead left the track ending
     * 62px short of the field's edge, which is the "the difficulty bar does
     * not go all the way" report.
     */
    if (heading) {
        wrap.appendChild(heading);
        wrap.appendChild(out.el);
        wrap.appendChild(input);
    } else {
        wrap.appendChild(input);
        wrap.appendChild(out.el);
    }

    paint();

    return {
        el: wrap,
        input,
        /** The label node, for a caller that wants to retitle it. */
        label: heading,
        /**
         * The derived companion to the value, or null to hide it.
         *
         * Passed straight through to the readout, which owns it — see the note
         * there. A slider that shows `5 -> 7.8` still writes only the 5.
         */
        setAside(text) { out.setAside(text); },
        /** Skipped while focused, so it cannot fight the user's drag. */
        set(v) {
            const n = num(v);
            if (n !== null && document.activeElement !== input) input.value = String(n);
            out.set(input.value);
            paint();
        },
        disable(off) { input.disabled = !!off; },
    };
}

export function meterRow(opts = {}) {
    const { label = '', value = 0, band = null, title = '', onClick = null, suffix = null } = opts;
    const row = el(onClick ? 'button' : 'div', 'fbk-meter-row');
    if (onClick) {
        row.type = 'button';
        row.addEventListener('click', onClick);
    }
    if (title) row.title = title;
    row.appendChild(el('span', 'fbk-meter-name', label));
    const bar = el('span', 'fbk-meter');
    if (band) bar.dataset.band = band;
    const v = num(value) ?? 0;
    bar.style.setProperty('--fbk-fill', Math.max(0, Math.min(100, Math.round(v))) + '%');
    row.appendChild(bar);
    row.appendChild(el('span', 'fbk-meter-value', Math.round(v) + '%'));
    if (suffix) row.appendChild(suffix);
    return row;
}

/**
 * The band for an accuracy, using the app's own splits.
 *
 * The null check is separate from the finite check on purpose: `Number(null)`
 * is 0, so a never-measured value would otherwise colour exactly like one you
 * missed every note of.
 */
export function band(accuracy) {
    const a = num(accuracy);
    if (a === null) return null;
    if (a >= 0.9) return 'good';
    if (a >= 0.5) return 'mid';
    return 'bad';
}
