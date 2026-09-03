/*
 * kit 0.18.0 — the token bridge.
 *
 * Reads the host's palette and writes it back as `--fbk-*` custom properties
 * that a stylesheet can use, then follows `theme:changed`. This existed three
 * times across three plugins in three different shapes before it lived here:
 * `tidy/src/theme.js` (62 lines), `riffrepeater/src/theme.js` (65 lines), and
 * Live Tab's `ink()` / `inkOn()` helpers building inline style strings.
 *
 * TWO LAYERS, following the app's own proposal in docs/host-theme-contract.md.
 *
 * Layer 1 — ROLES. Colours, as the `"r g b"` triplets the host uses, consumed
 * as `rgb(var(--fbk-accent))` with optional alpha `rgb(var(--fbk-accent) / .4)`.
 * These come straight from `feedBack.theme.get().tokens`, so an equipped shop
 * theme moves every consumer at once.
 *
 * Layer 2 — RECIPES. Devices, as full CSS values: how *this* look makes a
 * primary special, how it lights an active cell, what a panel's elevation is.
 * The host does not ship these yet (the contract is a proposal and its
 * `theme-contract.css` does not exist), so the kit fills them — with the
 * app's default neon-ish sky-on-navy as the default recipe.
 *
 * The point of the split is the rule in DESIGN.md §6: a consumer references a
 * role or a slot and never writes a device. `none` is a legal value for every
 * slot except `--fbk-meter-fill`, so a glow-less skin can neutralise the glow
 * and get a solid border instead of a control that vanished.
 *
 * WHY THE HOST'S `--fbv-*` ARE NOT READ: they are documented as internal
 * plumbing. `feedBack.theme.get()` is the sanctioned surface, and it is
 * feature-detected here so an older host falls back to the defaults below —
 * which are the host's own palette, so the fallback looks like the app.
 */

/** role -> the default `"r g b"`, mirroring the host's own `fb` palette. */
const ROLES = {
    /*
     * ── THE RACK ─────────────────────────────────────────────────────────
     *
     *     well    #05070C   a slot cut INTO the chassis
     *     chassis #0C0F16   the unit's own body
     *     plate   #12141C   the footer plate
     *     control #1E222C   the face of a thing you press
     *     stroke  #2A2E3A   the 1px division between racks
     *
     * Two things changed from the palette this replaced, and both matter.
     *
     * NEUTRAL, not navy. The old ramp was slate-blue (15 23 42 and friends),
     * which put a hue on every surface and left the one interactive blue
     * competing with its own background. These are grey: the only chroma in
     * the panel is the blue you can press and the three grades you cannot.
     *
     * WELLS, not cards. The old ramp got LIGHTER as it nested, on a
     * cards-stacked-on-cards model. This is a rack unit: the chassis is the
     * body, a well is cut into it and is therefore DARKER, and a control is
     * raised off it and is lighter. Depth by lighting, one direction, and the
     * radii follow it — a well is rounder (12) than the chassis (10), the way
     * a routed slot is.
     */
    bg: '5 7 12',                 // well
    surface: '12 15 22',          // chassis — host `card`
    plate: '18 20 28',            // footer plate
    surface2: '30 34 44',         // control — host `cardMuted`
    border: '42 46 58',           // stroke
    sidebar: '12 15 22',

    text: '232 238 252',
    dim: '138 160 200',           // host `textDim`
    /*
     * A real ink, not an opacity.
     *
     * `opacity: 0.38` multiplies down whatever is underneath, so a disabled
     * accent button went pale blue and a disabled quiet one nearly vanished —
     * two different amounts of "off". The spec is explicit that disabled is
     * FLAT: no shadow, no glow, and the status line above says why.
     */
    disabled: '92 111 148',

    /*
     * ONE interactive colour, and the spec states its scope better than the
     * kit did: blue means *pressable, selected, or the rung you are on*.
     *
     * `onAccent` is the WELL, not white — measured, not chosen: white on this
     * blue is 2.22:1 and pure white 2.58:1, which fails every threshold there
     * is, while the well is 7.43:1. A blue this light can only carry dark ink.
     */
    accent: '41 168 255',         // host `primary`
    accentHi: '96 194 255',       // host `primaryHi`
    focus: '41 168 255',          // host `focus-ring` — deliberately the same blue
    onAccent: '5 7 12',

    /*
     * ── GRADES: read-only, and never on anything pressable ───────────────
     *
     * Splits at 40 and 70. Amber does double duty as the status slot's
     * warning, which is why it has two stops — `mid` for a grade, `midHi` for
     * the stroke of a blocked status well.
     */
    bad: '229 72 77',             // < 40      — host `low`
    mid: '245 165 36',            // 40–69, and the warning stroke — host `mid`
    midHi: '245 197 66',
    good: '61 220 132',           // >= 70     — host `good`

    alert: '229 72 77',           // host `accent`
    gold: '232 192 64',
};

/** Which host token each role reads from. */
/*
 * Role -> the host's own token name, used ONLY when a consumer opts into
 * bridging with `follow(null, { bridge: true })`.
 *
 * Kept complete even though it is off by default, because the mapping is the
 * hard part: it is the one place that knows the app calls its interactive blue
 * `primary` and its recessed surface `cardMuted`.
 */
const FROM_HOST = {
    bg: 'bg',
    sidebar: 'sidebar',
    surface: 'card',
    surface2: 'cardMuted',
    border: 'border',
    text: 'text',
    dim: 'textDim',
    accent: 'primary',
    accentHi: 'primaryHi',
    alert: 'accent',
    good: 'good',
    mid: 'mid',
    bad: 'low',
    gold: 'gold',
    onAccent: 'on-accent',
    focus: 'focus-ring',
    /*
     * `plate`, `disabled` and `midHi` have no host key.
     *
     * The host publishes two surface tones and this rack needs four, so the
     * extra steps stay at the kit's defaults rather than being guessed per
     * theme. `onAccent` DOES map — but see the note on it: a host that pairs
     * a light primary with white ink is publishing a 2.2:1 combination, and
     * `inkOn()` exists for exactly that.
     */
};

/**
 * Layer 2 defaults — the app's own look, as devices AND as measurements.
 *
 * Written in terms of the Layer 1 roles so an equipped theme recolours them
 * without touching this table. A skin that wants a different LANGUAGE (no
 * glow, a bevel, a texture, tighter type) overrides the slots rather than the
 * roles.
 *
 * ── THE THREE SCALES ────────────────────────────────────────────────────
 *
 * These are the part that was missing. Before them the CSS used 10, 11, 12, 13
 * and 20px type and 6, 7, 8, 9, 10, 11, 12 and 15px spacing, all picked per
 * rule — which is exactly what "approximate" looks like from a metre away.
 *
 * TYPE — five steps, and no element may invent a sixth. A `font` shorthand
 * cannot carry letter-spacing, so each step is a pair: `--fbk-t-X` for the
 * shorthand and `--fbk-t-X-track` for the tracking.
 *
 * SPACE — a 2px base, six steps. No margin, padding or gap in the kit is a
 * number; every one of them is `var(--fbk-s-N)`.
 *
 * HEIGHT — three heights, and every interactive control is exactly one of
 * them. That is what makes rows share a baseline instead of each row being as
 * tall as whatever it happens to contain.
 */
const RECIPES = {
    /* ── type ───────────────────────────────────────────────────────────
     *
     * The family is named rather than inherited, because a `font` shorthand
     * needs a real family — `font: 500 13px/1.45 inherit` is invalid and
     * silently drops the whole declaration. This is the app's own body stack
     * (`fontFamily.display` in its tailwind.config.js); v3's Rubik is a
     * display face for headings and not what a panel of controls wants.
     */
    /*
     * ── FACES ────────────────────────────────────────────────────────────
     *
     * Rubik, because the app already uses it — measured: `document.fonts`
     * lists it and it renders 4% wider than the sans fallback, and v3's own
     * body and player HUD are `Rubik, system-ui, sans-serif`. Up to 0.8.0
     * this said Inter, with a comment that Rubik is "a display face and not
     * what a panel of controls wants". Wrong about this app: matching its
     * furniture is §8, and its furniture is Rubik.
     *
     * The family is named rather than inherited because a `font` shorthand
     * needs a real one — `font: 500 11px/1.45 inherit` is invalid and
     * silently drops the whole declaration.
     */
    font: 'Rubik, system-ui, sans-serif',

    /*
     * A second face for NUMBERS, and one rule decides which face anything
     * gets: **what can change while you play is mono; what you can press is
     * Rubik.**
     *
     * Not decoration. Every number in a practice HUD moves while you are
     * reading it, and in a proportional face the digits have different widths
     * — so `0:41.2` shifts sideways on every tick and `91%` jumps when it
     * becomes `100%`. Mono makes that impossible.
     *
     * JetBrains Mono is named first because it is the design's choice, but it
     * is NOT loaded by the app (measured: its width is identical to the
     * system mono), so today this resolves to SF Mono or Consolas. That still
     * satisfies the requirement, which is that digits do not move. Loading
     * the face is a separate decision with a network cost.
     */
    'font-num': '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',

    /* ── TYPE — eight steps, five Rubik and three mono ────────────────────
     *
     * Tracking is positive and generous on the small heavy steps: at 9–10px
     * a 600–900 weight closes up, and the letter-spacing is what keeps an
     * all-caps rack label legible instead of a smear.
     */
    't-display': '900 14px/1.15 var(--fbk-font)',   /* the chassis title */
    't-display-track': '0.12em',
    't-rack': '900 10px/1.2 var(--fbk-font)',       /* a rack's own label */
    't-rack-track': '0.16em',
    't-field': '600 9px/1.2 var(--fbk-font)',       /* a field label inside a rack */
    't-field-track': '0.12em',
    't-label': '700 13px/1.25 var(--fbk-font)',     /* a control's own words */
    't-label-track': '0',
    't-body': '500 11px/1.45 var(--fbk-font)',      /* status and helper copy */
    't-body-track': '0',

    /* The one big live number: a grade, a tempo. */
    't-num-xl': '900 28px/1 var(--fbk-font-num)',
    't-num-xl-track': '-0.01em',
    /* The number a stepper sets — bigger than a readout, because you aim at it. */
    't-num-md': '900 18px/1.1 var(--fbk-font-num)',
    't-num-md-track': '0',
    /* Every other quantity: clocks, counts, percentages in a line of text. */
    't-num': '700 11px/1.2 var(--fbk-font-num)',
    't-num-track': '0.02em',

    /* Kept as the names a hundred existing rules reference. `t-value` has
       always held a clock or a percentage, so it IS the readout step; `t-micro`
       has always been the eyebrow, which is now `t-rack`. */
    't-value': '700 11px/1.2 var(--fbk-font-num)',
    't-value-track': '0.02em',
    't-micro': '900 10px/1.2 var(--fbk-font)',
    't-micro-track': '0.16em',

    /* ── SPACE — a 2px base on a 4px grid, six steps ─────────────────────
     *
     * The rack spec's gaps are 6 / 8 / 10 and its paddings 4 / 10 / 14 / 18,
     * which is what these are. Two changes from the ramp they replace
     * (2/4/6/10/14/20): the middle got denser and the top got shorter,
     * because a rack is FLAT and divided by 1px strokes rather than by air —
     * so the space that used to separate groups is now a line, and the space
     * inside a group can close up.
     */
    's-1': '2px',
    's-2': '4px',
    's-3': '6px',
    's-4': '8px',
    's-5': '10px',
    's-6': '14px',
    /* Only the chassis's own outer padding needs this, hence the seventh. */
    's-7': '18px',

    /* ── control heights: three, and no others ────────────────────────── */
    /* ── HEIGHT — sized by WHEN you touch it, not by what it is ───────────
     *
     * This is the rule that replaced a flat 26/32/44, and it is a better
     * question: not "how big is a stepper" but "is this pressed while the
     * song is running?"
     *
     *   h-sm  24  setup-only — a unit switch, a mode set once, a slider thumb.
     *             You are stopped when you touch it, so a mouse-sized target
     *             is honest and the row stays short.
     *   h-md  40  ANYTHING pressed during play. A stepper, a segmented cell,
     *             a list row, the phrase timeline. 40 with >=6px of air is a
     *             target you can hit with a guitar in your hands.
     *   h-lg  56  the footswitch. It is called that on purpose: it is the one
     *             control you hit without looking.
     *
     * The touch scale below still lifts all three, because a fingertip is a
     * different problem again (see TOUCH_HEIGHTS).
     */
    'h-sm': '24px',
    'h-md': '40px',
    'h-lg': '56px',

    /*
     * The width every inline label shares.
     *
     * Without it each row's control started at a different x, because the
     * labels are different lengths — visible and wrong in a 336px panel. A
     * label that does not fit becomes a block label instead of widening this.
     */
    'label-w': '62px',

    /* The thickness of a hairline, so a skin can make them heavier. */
    hairline: '1px',

    /* ── devices ──────────────────────────────────────────────────────
     * How a primary action is made special. At least one of fill/border/halo
     * must be non-none, or a primary would be visually flat. */
    'emph-fill': 'linear-gradient(180deg, rgb(var(--fbk-accent-hi)), rgb(var(--fbk-accent)))',
    'emph-border': '1px solid rgb(var(--fbk-accent-hi) / 0.7)',
    'emph-halo': '0 0 0 1px rgb(var(--fbk-accent) / 0.45), 0 8px 24px rgb(var(--fbk-accent) / 0.35)',
    'emph-on': 'rgb(var(--fbk-on-accent))',

    /* How a small control says "active / armed / current". */
    /*
     * ── THE RAISED FACE ─────────────────────────────────────────────────
     *
     * A top light line and a shadow under it: light comes from above, and a
     * thing you press catches it. This is the difference between a button and
     * a printed rectangle, and it was missing — the controls were completely
     * flat, which was reported.
     *
     * A slot rather than a literal, per the second law, and `none` is legal:
     * a shop skin that wants everything flat sets these to `none` and gets a
     * flat panel rather than one with a highlight it cannot remove.
     */
    'control-lift': 'inset 0 1px 0 rgb(var(--fbk-text) / 0.14), 0 1px 2px rgb(var(--fbk-bg) / 0.9)',
    'control-lift-on': 'inset 0 1px 0 rgb(var(--fbk-text) / 0.22), 0 2px 6px rgb(var(--fbk-bg) / 0.9)',
    /* Pressed: the light line moves to the BOTTOM, which is what a face going
       in actually does. Cheaper and more convincing than moving the whole box. */
    'control-lift-down': 'inset 0 -1px 0 rgb(var(--fbk-text) / 0.14), inset 0 2px 4px rgb(var(--fbk-bg) / 0.8)',

    'lit-fill': 'rgb(var(--fbk-accent))',
    'lit-halo': '0 0 12px rgb(var(--fbk-accent) / 0.55)',

    /*
     * ── THE GLOW ────────────────────────────────────────────────────────
     *
     * A number on a device is BACKLIT, and this is most of the gap between
     * the drawn panel and the shipped one: same hue, same weight, same size,
     * and the drawing looked lit where ours looked printed. Reported as
     * "mancano i glow", which was exactly right.
     *
     * `currentColor` rather than a role, because everything that glows here
     * already carries its band AS its colour — the live percentage is green
     * or amber or red, the rail's numbers green or blue, the meter's cells
     * one of three. One slot follows every one of them, where a glow per band
     * would be five literals and a sixth to forget.
     *
     * Still slots, so `none` is legal: a shop skin that wants a flat panel
     * sets these to `none` and gets flat numbers, not numbers with a halo it
     * cannot reach.
     */
    'num-glow': '0 0 16px color-mix(in srgb, currentColor 42%, transparent)',
    'led-glow': '0 0 8px color-mix(in srgb, currentColor 55%, transparent)',
    /* The lit edge of a block you can press — the strip's stroke on hover. */
    'edge-glow': '0 0 0 1px rgb(var(--fbk-accent) / 0.5), 0 0 20px rgb(var(--fbk-accent) / 0.26)',
    'lit-on': 'rgb(var(--fbk-on-accent))',

    /* A panel is an object over a stage: a real shadow and a top light line.
       This is the cheapest cue that something is physical rather than drawn. */
    'panel-shadow': '0 24px 60px rgb(0 0 0 / 0.6)',
    'panel-inner': 'inset 0 1px 0 rgb(255 255 255 / 0.06)',

    /* Progress / cleared / target. The ONE paint for a filled meter, and the
       one slot where `none` is illegal — a meter with no paint is invisible. */
    'meter-fill': 'rgb(var(--fbk-good))',

    /* Shape. */
    /* ── RADII — one per nesting level, softening inward ─────────────────
     *
     * header segmented 5 · control 8 · chassis and footswitch 10 · well 12.
     *
     * The well being ROUNDER than the chassis it sits in is the lighting
     * model showing through: a routed slot has a tool radius, and a plate cut
     * to fit inside it is sharper. It is also the cheapest cue that one is
     * inside the other — shape says depth, so a stroke does not have to.
     */
    'radius-seg': '5px',
    'radius-sm': '8px',           // a control: stepper, segmented cell, button
    /*
     * 14, not 10, and the well stays at 12.
     *
     * The spec's 10 was read off a footswitch, and a 360×580 chassis needs a
     * softer corner than a 56px button to read as the same family — the arc
     * has to be visible against the length of the edge it interrupts.
     * Reported as the card's corner needing attention, and it is the one place
     * a single number for two very different box sizes was wrong.
     *
     * The well keeping 12 means a well is now SHARPER than the chassis, which
     * inverts the earlier note about routed slots. Both readings are coherent;
     * this one is the design's, and a 12px radius inside a 14px one is a
     * concentric pair rather than a nested contradiction.
     */
    radius: '14px',               // the chassis
    'radius-switch': '10px',      // the footswitch
    'radius-well': '12px',
    'radius-pill': '999px',       // a toggle's track, and only that

    /*
     * Disabled, as one recipe.
     *
     * It was per-component before: `opacity: 0.4` here, `filter: saturate(0.4)`
     * there, and the primary ended up a muddy grey-blue that read as broken
     * rather than as unavailable. One opacity, one rule, and the halo goes.
     */
    'disabled-opacity': '0.38',

    /* Decorative timing. Gated below, so no consumer can forget. */
    motion: '140ms ease',
};

const PROP_PREFIX = '--fbk-';

/** camelCase role -> the custom property name. `accentHi` -> `--fbk-accent-hi`. */
/**
 * A role name -> the custom property it is written as.
 *
 * `accentHi` -> `--fbk-accent-hi`, and — this is the part that was missing —
 * `surface2` -> `--fbk-surface-2`. Without the digit rule the theme wrote
 * `--fbk-surface2` while the stylesheet read `--fbk-surface-2` **thirty times**,
 * so the control tone was the hardcoded fallback in every rule that used it,
 * always, whatever the palette said. It survived a palette rewrite, a
 * fallback-alignment pass and a mirror test, because every one of those
 * compared VALUES and none of them asked whether the property existed at all.
 */
function propFor(role) {
    return PROP_PREFIX + role
        .replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
        .replace(/([a-z])(\d)/g, '$1-$2');
}

let unsubscribe = null;
let recipeOverride = null;

/**
 * Whether to take colours from the host's equipped theme.
 *
 * OFF by default since 0.13.0. See the note in `write()`: a plugin with an
 * identity of its own cannot have its palette silently replaced by the app's,
 * and the app publishes tokens whether or not a theme is equipped.
 */
let bridgeHost = false;

function hostTokens() {
    const fb = window.feedBack;
    const theme = fb && fb.theme;
    if (!theme || typeof theme.get !== 'function') return null;
    try { return theme.get()?.tokens || null; } catch (_) { return null; }
}

function reducedMotion() {
    const fb = window.feedBack;
    const theme = fb && fb.theme;
    if (theme && typeof theme.prefersReducedMotion === 'function') {
        try { return !!theme.prefersReducedMotion(); } catch (_) { /* fall through */ }
    }
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
}

function write() {
    const root = document.documentElement;
    const tokens = hostTokens();

    /*
     * ── THE PALETTE IS OURS, AND THE HOST BRIDGE IS OPT-IN ──────────────
     *
     * This line used to read
     *
     *     const value = (tokens && hostKey && tokens[hostKey]) || ROLES[role];
     *
     * — the host's token first, the kit's default only as a fallback. It was
     * the kit's founding decision and it was wrong for what these plugins are
     * for. Consequences, measured in the running app:
     *
     *     role        design    what was on screen
     *     accent      41 168 255    14 165 233
     *     bg           5  7 12      15 23 42
     *     surface     12 15 22      30 41 59
     *
     * Every colour was the app's. Not because a theme was equipped — the host
     * reported `isThemed: false` — but because it publishes its DEFAULT tokens
     * too, and `||` only falls back when a token is missing. So a design system
     * built to have an identity was quietly wearing the host's, and the gallery
     * looked correct while the app did not: outside the app there are no host
     * tokens, so the gallery had been showing the kit's palette all along.
     *
     * A plugin with a visual identity of its own has to be the authority on its
     * own colours. Bridging is still available for a plugin that wants to
     * disappear into the app's furniture — `follow({ bridge: true })` — but it
     * is now the exception it always should have been.
     */
    for (const role of Object.keys(ROLES)) {
        const hostKey = FROM_HOST[role];
        const bridged = bridgeHost && tokens && hostKey && tokens[hostKey];
        root.style.setProperty(propFor(role), bridged || ROLES[role]);
    }

    const recipes = { ...RECIPES, ...(recipeOverride || {}) };
    for (const slot of Object.keys(recipes)) {
        root.style.setProperty(PROP_PREFIX + slot, recipes[slot]);
    }

    /*
     * The touch scale, after the recipes so it wins over them — and after any
     * consumer override too, deliberately: a plugin may redefine the look, it
     * may not decide that a finger is smaller than it is.
     */
    if (coarsePointer()) {
        for (const slot of Object.keys(TOUCH_HEIGHTS)) {
            root.style.setProperty(PROP_PREFIX + slot, TOUCH_HEIGHTS[slot]);
        }
    }

    // The single reduced-motion gate. `--fbk-motion` is the only place
    // decorative timing is named, so setting it to `none` here disables every
    // transition in the kit at once and a consumer cannot forget the gate.
    if (reducedMotion()) root.style.setProperty(PROP_PREFIX + 'motion', 'none');
}

/**
 * Start the bridge, and keep it in step with the equipped theme.
 *
 * `recipes` overrides Layer 2 for a plugin that wants its own design language
 * — the escape hatch a plugin skin needs without reinventing the roles. Most
 * consumers pass nothing.
 */
/**
 * The height scale again, for a finger.
 *
 * A mouse lands within a pixel or two of where it is aimed; a fingertip
 * contacts roughly 9mm of glass. So these are not the same control at two
 * sizes, they are two different physical problems — and the honest fix is to
 * change the SCALE rather than to grow individual controls, because growing
 * one is how a row ends up with a 44px stepper next to a 26px chip and no
 * shared rhythm left.
 *
 * 44px is the figure WCAG 2.5.5 (Target Size, AAA) asks for and the one both
 * platform guidelines settle on. `h-sm` goes to 32 rather than 44 because it
 * is the height of things that sit in groups — chips, small buttons — where
 * the row's own padding contributes and 44 would make a five-rung ladder
 * taller than the primary.
 *
 * This is applied by `write()` only when the pointer is actually coarse, and
 * it is re-applied if that changes: a convertible laptop switches while the
 * panel is open.
 */
const TOUCH_HEIGHTS = {
    /*
     * `h-md` is already 40 for a mouse, because the rack scale asks how a
     * control is USED rather than what it is. A fingertip still wants more:
     * 48 clears WCAG 2.5.5's 44 with room for the >=6px of air the spec asks
     * between targets, and 32 lifts the setup-only row off a mouse-sized
     * minimum without making a header taller than the row under it.
     */
    'h-sm': '32px',
    'h-md': '48px',
    'h-lg': '64px',
};

/** True when the primary pointer is a finger rather than a mouse. */
function coarsePointer() {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch (_) { return false; }
}

export function follow(recipes = null, opts = {}) {
    recipeOverride = recipes;
    /*
     * `bridge: true` hands the palette back to the host — for a plugin that
     * should look like part of the app rather than like itself. Everything
     * else still follows `theme:changed`, because a bridged consumer needs to
     * re-read and an unbridged one costs nothing to re-write.
     */
    bridgeHost = !!opts.bridge;
    write();
    if (unsubscribe) return;

    const stops = [];

    /*
     * A convertible laptop changes pointer while the panel is open — folding
     * the keyboard back is exactly the moment the controls need to grow — so
     * the touch scale is watched, not read once at install.
     */
    try {
        const mq = window.matchMedia('(pointer: coarse)');
        const onPointer = () => write();
        if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', onPointer);
            stops.push(() => mq.removeEventListener('change', onPointer));
        }
    } catch (_) { /* no matchMedia: the scale is whatever write() decided */ }

    const fb = window.feedBack;
    if (fb && typeof fb.on === 'function') {
        const handler = () => write();
        fb.on('theme:changed', handler);
        stops.push(() => {
            try { if (typeof fb.off === 'function') fb.off('theme:changed', handler); } catch (_) { /* going away */ }
        });
    }

    if (!stops.length) return;
    unsubscribe = () => { for (const stop of stops) stop(); };
}

export function unfollow() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    recipeOverride = null;
    bridgeHost = false;
    const root = document.documentElement;
    for (const role of Object.keys(ROLES)) root.style.removeProperty(propFor(role));
    for (const slot of Object.keys(RECIPES)) root.style.removeProperty(PROP_PREFIX + slot);
    // The touch scale writes the same property names, but removing a property
    // twice is harmless and forgetting one would leave a 44px stepper behind
    // after uninstall.
    for (const slot of Object.keys(TOUCH_HEIGHTS)) root.style.removeProperty(PROP_PREFIX + slot);
}

/**
 * A resolved role, for a canvas or a WebGL renderer.
 *
 * The CSS path is the right one for anything in the DOM; this exists because
 * a canvas cannot read a custom property. Returns a real CSS colour string.
 */
export function ink(role, alpha) {
    const value = (hostTokens()?.[FROM_HOST[role]]) || ROLES[role] || ROLES.text;
    return alpha === undefined ? `rgb(${value})` : `rgb(${value} / ${alpha})`;
}

/**
 * What stays legible written on a fill.
 *
 * The host's palette pairs `on-accent` with its accent and says nothing about
 * the rest, so white-on-amber is one careless line away. This picks black or
 * white by luminance for any role — the same fix Live Tab wrote inline.
 */
export function inkOn(role) {
    /* The same authority as `write()`: ours unless bridging is on. */
    const bridged = bridgeHost ? hostTokens()?.[FROM_HOST[role]] : null;
    const raw = bridged || ROLES[role] || '';
    const [r, g, b] = String(raw).split(/\s+/).map(Number);
    if (![r, g, b].every(Number.isFinite)) return `rgb(${ROLES.text})`;
    // Rec. 601 luma is close enough for a two-way choice and needs no gamma.
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luma > 0.6 ? 'rgb(9 12 20)' : `rgb(${ROLES.text})`;
}

/** The role table, for a consumer that wants to enumerate them. */
export const roles = Object.freeze(Object.keys(ROLES));

/**
 * The role table itself, as `"r g b"` triplets.
 *
 * Exposed because a consumer that wants to check a pairing needs the numbers,
 * not the names — and checking a pairing is a thing this kit asks for by
 * name (§16: a signal has to survive its own background). The kit's own tests
 * use it to pin that the ink on the accent clears 4.5:1, which is the
 * arithmetic that white-on-a-light-blue keeps failing.
 *
 * These are DEFAULTS. An equipped host theme overrides them at write time, so
 * this answers "what does the kit ship", not "what is on screen".
 */
export const roleDefaults = Object.freeze({ ...ROLES });

/**
 * The recipe table, as shipped.
 *
 * Exposed for the same reason as `roleDefaults`, and for one more: every rule
 * in kit.css carries a hand-written fallback (`var(--fbk-h-md, 40px)`) so a
 * panel is still shaped if `follow()` never ran — which makes the stylesheet a
 * second copy of this table. The kit's own test reads both and refuses to let
 * them disagree, because a mirror nobody compares goes wrong quietly.
 */
export const recipeDefaults = Object.freeze({ ...RECIPES });

/** The recipe slots, for the same reason. */
export const slots = Object.freeze(Object.keys(RECIPES));
