/*
 * Live Tab — a tablature you can actually read while it moves.
 *
 * The plugin sits between the views that already exist. Tab View draws real
 * tab, but as static pages with a cursor that jumps. Jumping Tab is fully
 * game-like: gems fly at a hit line and there is no tab left to read. Live Tab
 * keeps the tab legible while it moves, hosts any note board above it, and
 * shows the same hit/miss verdicts the board shows — so the feedback lands
 * where the player is already looking.
 *
 * How the file is arranged:
 *
 *   1. Settings schema      one list drives defaults, clamping and the panel
 *   2. Presets              named starting points, plus advanced options
 *   3. Palette              colour, borrowed from the app's string colours
 *   4. Pure helpers         no canvas, no host, unit-testable
 *   5. Tempo map            time <-> beat position, from a cleaned beat grid
 *   6. Reading modes        which staves to draw, and what each one covers
 *   7. Host access          everything read from `window.highway`
 *   8. Drawing              the staff, its notes and its marks
 *   9. Composite viz        the borrowed board above, the tab below
 *  10. Settings panel       built from the schema
 *  11. Player control       the two or three choices taken mid-song
 *  12. Public API           window.livetab
 */
/*
 * ── THE SHARED KIT ──────────────────────────────────────────────────────
 *
 * Vendored under `src/kit/`, copied and never imported from anywhere shared:
 * there are no import maps in this host and no load-order guarantee between
 * plugins, and any plugin can be disabled — so a plugin that reached into
 * another one for its design system would be a plugin that stops rendering
 * when the reader turns something else off.
 *
 * The imports live out here because a module's do, and the IIFE below closes
 * over this scope, so everything inside it can see them. The IIFE is now
 * redundant — a module has its own scope — and is kept because removing it
 * would reindent three thousand lines for no behaviour.
 *
 * `plugin.json` gained `scriptType: "module"` for this. The file was already
 * `'use strict'` and already one closed IIFE, so nothing else about it had to
 * change.
 */
import * as kit from './src/kit/index.js';
import * as c from './src/kit/controls.js';

(function () {
    'use strict';

    const ID = 'livetab';
    const LS_KEY = 'livetab.settings';

    // ── Running twice ────────────────────────────────────────────────────
    //
    // The host re-evaluates a plugin's script on update, rollback and
    // reinstall. Everything below is built fresh when it does, so without
    // this a second run would leave the first run's panel orphaned in the
    // DOM, its theme listener still firing, and its mount-retry timer still
    // ticking — three of the things plugin-runtime-idempotent.v1 names.
    //
    // So each run publishes how to dismantle itself on a stable window key,
    // and calls its predecessor's before building anything. The shape is the
    // one docs/capability-domains.md prescribes for shared plugin state.
    const HOOKS_KEY = '__feedBackLiveTabHooks';

    try {
        const prev = window[HOOKS_KEY];
        if (prev && typeof prev.teardown === 'function') prev.teardown();
    } catch (err) {
        console.warn('[' + ID + '] the previous instance did not come down '
            + 'cleanly; carrying on:', err);
    }

    /** Everything this run has to undo, newest last. */
    const disposers = [];

    /**
     * Tell the capability graph how the renderer got on.
     *
     * The host records who is providing the visualization and why one failed;
     * a provider that never says is a blank row in the inspector when someone
     * is trying to work out why the screen is empty.
     */
    function emitViz(event, payload) {
        const caps = window.feedBack && window.feedBack.capabilities;
        if (!caps || caps.version !== 1 || typeof caps.emitEvent !== 'function') return;
        try {
            caps.emitEvent('visualization', event, Object.assign({ providerId: ID }, payload || {}));
        } catch (_) { /* the graph is a nicety, never a dependency */ }
    }

    function onTeardown(fn) { disposers.push(fn); }

    // The host cache-busts plugin scripts with `?v=<manifest version>`, so the
    // running version can be read off our own <script> tag rather than kept in
    // a constant here that would drift from plugin.json the first time someone
    // forgot to change both.
    const VERSION = (function () {
        try {
            /*
             * `import.meta.url` FIRST, because this file is a module now.
             *
             * `document.currentScript` is null inside a module — always, by
             * spec — so the conversion to `scriptType: "module"` would have
             * dropped this to 'dev' silently, and 'dev' is what the kit
             * stylesheet's cache key would then have been for every release.
             * The `currentScript` read stays as the fallback for a host that
             * ever serves this as a classic script again.
             */
            const src = (typeof import.meta !== 'undefined' && import.meta.url)
                || (document.currentScript && document.currentScript.src)
                || '';
            const m = /[?&]v=([^&]+)/.exec(src);
            return m ? decodeURIComponent(m[1]) : 'dev';
        } catch (_) {
            return 'dev';
        }
    })();

    /*
     * THE KIT'S STYLESHEET, injected by the kit itself.
     *
     * `install` prepends the link so the kit loses every specificity tie to
     * this plugin's own rules, and stamps `?v=` from the version above — which
     * is why that read had to keep working.
     */
    kit.install({ id: ID, version: VERSION });

    // ─────────────────────────────────────────────────────────────────────
    // 1. Settings schema — the single source of truth.
    //
    // Every option is declared once, with its type, its range and how the
    // panel should present it. `DEFAULTS`, `normalise()` and the whole
    // settings UI are derived from this list, so adding an option is one entry
    // here rather than four edits that can drift apart. Unknown keys in
    // storage are dropped on load, which is also how options retired between
    // versions clean themselves up.
    // ─────────────────────────────────────────────────────────────────────

    const GROUPS = [
        { id: 'basics', label: 'Basics', advanced: false },
        { id: 'reading', label: 'Reading', advanced: true },
        { id: 'look', label: 'Notes & colour', advanced: true },
        { id: 'marks', label: 'What is written', advanced: true },
        { id: 'frame', label: 'Board & backdrop', advanced: true },
    ];

    const isPaged = (s) => s.readMode === 'page';
    const isScroll = (s) => s.readMode === 'scroll';

    const SCHEMA = [
        {
            key: 'enabled', type: 'bool', def: true, group: 'basics',
            label: 'Show the tab',
            when: (s) => s.readMode === 'scroll' && s.board !== 'none',
            hint: 'Turning it off gives the whole player to the board above and '
                + 'leaves Live Tab hosting it. It only means anything when there '
                + 'is a board to give the room to: with none, and while the tab '
                + 'turns pages, the tab is all there is.',
        },
        {
            key: 'readMode', type: 'enum', def: 'scroll', group: 'basics',
            label: 'How the tab moves',
            options: [
                ['scroll', 'Scrolling — the tab slides under a fixed cursor'],
                ['page', 'Page turns — the cursor walks, the page turns'],
            ],
            hint: 'Scrolling is one continuous staff: nothing to lose your place '
                + 'in, and it pairs with a board above. Page turns is how sheet '
                + 'music reads — each staff holds a fixed range of bars, the '
                + 'cursor crosses it, and at the end the stack slides up one '
                + 'staff. Nothing moves mid-bar, so the numbers hold still while '
                + 'you play them.',
        },
        {
            key: 'board', type: 'enum', def: 'highway_3d', dynamic: true,
            group: 'basics', label: 'Board above the tab', when: isScroll,
            hint: 'Live Tab hosts this board in the upper part of the player and '
                + 'keeps the lower part for the tab, so neither covers the other. '
                + 'The list is read from the app, so any view you install appears '
                + 'here. Scrolling only: page turns give the whole player to the '
                + 'staves, because sharing it with a board leaves them closer '
                + 'together than a note head is wide.',
        },
        {
            key: 'heightPct', type: 'num', def: 30, min: 14, max: 60, step: 1,
            group: 'basics', label: 'Tab height', unit: '% of the player',
            when: isScroll,
            hint: 'How the player is split between the board and the tab. '
                + 'Ignored when there is no board above.',
        },

        // ── Reading ──────────────────────────────────────────────────
        {
            key: 'rows', type: 'int', def: 3, min: 2, max: 4, group: 'reading',
            label: 'Staves', when: isPaged,
            hint: 'Page turns only. The staves below the cursor already hold the '
                + 'bars to come, so the eye can read ahead the way it does off '
                + 'paper. Scrolling always uses one staff: two staves both sliding '
                + 'at once give the eye no way to tell which line is now.',
        },
        {
            key: 'pageBars', type: 'int', def: 3, min: 1, max: 8, group: 'reading',
            label: 'Bars per staff', when: isPaged,
            hint: 'Three bars of 4/4 lasts long enough to read at any tempo in '
                + 'reach — five and a half seconds at 130, three and a half at '
                + 'the fastest thing you are likely to play — and holds twelve '
                + 'beats, which stays legible at any width. Fewer turns the page '
                + 'more often; more packs the notes tighter. Past eight the fret '
                + 'numbers have under 30 pixels each and stop being separable.',
        },
        {
            key: 'aheadBeats', type: 'num', def: 5, min: 2, max: 24, step: 0.5,
            group: 'reading', label: 'Ahead', unit: 'beats', when: isScroll,
            hint: 'How much of what is coming is on screen, in beats — so note '
                + 'spacing is proportional to note value and a quarter really is '
                + 'twice an eighth. Above a moderate tempo the window widens to '
                + 'keep the reading speed steady, and the panel shows both '
                + 'numbers: what you asked for, and what is on screen.',
        },
        {
            key: 'behindBeats', type: 'num', def: 1.25, min: 0.5, max: 8, step: 0.25,
            group: 'reading', label: 'Behind', unit: 'beats', when: isScroll,
            hint: 'How much of what you have just played stays visible.',
        },

        // ── Notes & colour ───────────────────────────────────────────
        {
            key: 'highStringOnTop', type: 'bool', def: true, group: 'look',
            label: 'Thinnest string on top',
            hint: 'On by default: that is how tablature is written on paper. '
                + 'Turn it off to put the thin E at the bottom and mirror the '
                + 'note board’s order instead.',
        },
        {
            key: 'useHostColors', type: 'bool', def: true, group: 'look',
            label: 'Use the app’s string colours',
            hint: 'Per-string colours and their presets live in the app’s own '
                + 'Graphics settings, and the tab follows them, so one palette '
                + 'serves every view. Turn this off to keep Live Tab on its own '
                + 'default palette instead.',
        },
        {
            key: 'noteLabel', type: 'enum', def: 'fret', group: 'look',
            label: 'What the note head says', options: [
                ['fret', 'The fret number'],
                ['name', 'The note name \u2014 E, F#, A#'],
                ['both', 'The fret, with the note name beside it'],
                ['nameFret', 'The note name, with the fret beside it'],
            ],
            hint: 'Learning where the notes are, rather than only which fret to '
                + 'press, is most of what reading music buys you. Names are '
                + 'worked out from the song\u2019s own tuning, so a drop or a flat '
                + 'tuning names its notes correctly. The head is the legible '
                + 'slot, so put in it whichever of the two you are working on: '
                + 'the fret to find the note, the name to learn it. Whatever '
                + 'goes beside is dropped wherever a run is too tight to fit '
                + 'it, the same way the technique marks are.',
        },
        {
            key: 'matchInstrument', type: 'bool', def: false, group: 'look',
            label: 'Match my instrument\u2019s strings',
            hint: 'A four-string chart on a five-string bass draws the extra low '
                + 'string as an empty line, so the staff matches the neck in front '
                + 'of you and a string is one line in both places. Read from the '
                + 'instrument set in the app\u2019s tuning settings.',
        },
        {
            key: 'noteInk', type: 'enum', def: 'string', group: 'look',
            label: 'Fret numbers', options: [
                ['string', 'In the string’s colour'],
                ['mono', 'One ink, like printed tab'],
            ],
            hint: 'Colour tells you which string at a glance. One ink is how tab '
                + 'is printed, and some eyes hold a shape better without hue.',
        },
        {
            key: 'lineInk', type: 'enum', def: 'string', group: 'look',
            label: 'String lines', options: [
                ['string', 'Coloured per string'],
                ['mono', 'Grey'],
            ],
        },
        {
            key: 'noteFill', type: 'enum', def: 'dark', group: 'look',
            label: 'Note heads', options: [
                ['dark', 'Dark head, coloured digit — printed tab'],
                ['solid', 'Filled head, dark digit — like the board’s gems'],
            ],
            hint: 'A filled head is the fastest thing to spot at speed. A dark '
                + 'head puts the digit forward, which reads better slowly.',
        },
        {
            key: 'noteScale', type: 'num', def: 1, min: 0.7, max: 1.6, step: 0.05,
            group: 'look', label: 'Note size',
            hint: 'Heads and digits together. Dense passages still shrink on their '
                + 'own so the numbers never collide; this sets the ceiling.',
        },
        {
            key: 'stringAlpha', type: 'num', def: 0.42, min: 0.15, max: 1, step: 0.02,
            group: 'look', label: 'String contrast',
        },

        // ── What is written ──────────────────────────────────────────
        {
            key: 'rhythmGrid', type: 'enum', def: 'auto', group: 'marks',
            label: 'Rhythm ruler',
            options: [
                ['auto', 'Subdivided as finely as it fits'],
                ['beats', 'Whole beats only'],
                ['off', 'Nothing'],
            ],
            hint: 'Note spacing is already proportional to note value, so where '
                + 'a note sits between two beats IS its rhythm. The ruler gives '
                + 'the eye something to count against: whole beats through the '
                + 'staff, and halves and quarters of a beat hanging below it '
                + 'when there is room for them to be told apart.',
        },
        {
            key: 'showLoop', type: 'bool', def: true, group: 'marks',
            label: 'The loop',
            hint: 'When a loop is armed, shade the stretch that repeats and '
                + 'mark where it turns. Learning a passage is playing it round '
                + 'and round, and the thing that gets lost is where round '
                + 'begins.',
        },
        { key: 'showBars', type: 'bool', def: true, group: 'marks', label: 'Bar numbers' },
        { key: 'showSections', type: 'bool', def: true, group: 'marks', label: 'Section names' },
        { key: 'showChords', type: 'bool', def: true, group: 'marks', label: 'Chord names' },
        {
            key: 'showTech', type: 'bool', def: true, group: 'marks',
            label: 'Technique marks (h, p, t, ◇)',
        },
        { key: 'showPM', type: 'bool', def: true, group: 'marks', label: 'Palm-mute brackets' },
        {
            key: 'showStrings', type: 'bool', def: true, group: 'marks',
            label: 'String names in the margin',
            hint: 'The open note of each line, down the left edge, read from the '
                + 'song\u2019s own tuning \u2014 so a drop or a flat tuning shows what it '
                + 'really is. Worth more here than on paper: the order can be '
                + 'flipped and the staff can have four, five or six lines.',
        },
        {
            key: 'showTempo', type: 'bool', def: true, group: 'marks',
            label: 'Tempo mark',
            hint: 'The beats per minute where the cursor is, so a change of tempo '
                + 'shows as a change of number.',
        },
        {
            key: 'showLyrics', type: 'bool', def: false, group: 'marks',
            label: 'Lyrics under the staff',
            hint: 'Syllables under the notes they fall on. The app already shows '
                + 'the line you are on across the top; this is the other thing '
                + 'lyrics are good for \u2014 knowing exactly which note the word '
                + 'lands on.',
        },

        // ── Board & backdrop ─────────────────────────────────────────
        {
            key: 'boardAspect', type: 'num', def: 1.78, min: 0, max: 4, step: 0.02,
            group: 'frame', label: 'Board proportions', when: isScroll,
            hint: 'Width ÷ height the board is held to. A short full-width box '
                + 'distorts a 3D board into a wide funnel, so it is narrowed and '
                + 'centred instead. Below 1 it fills the width.',
        },
        {
            key: 'panelOpacity', type: 'num', def: 0.9, min: 0.3, max: 1, step: 0.02,
            group: 'frame', label: 'Backdrop', when: isScroll,
            hint: 'How solid the tab’s own background is behind a board. With no '
                + 'board it is always solid.',
        },
    ];

    const FIELD = {};
    for (const f of SCHEMA) FIELD[f.key] = f;

    function optionValues(f) {
        return (f.options || []).map((o) => o[0]);
    }

    /** Coerce any object into a valid settings object. Drops unknown keys. */
    function normalise(raw) {
        const s = raw || {};
        const out = {};
        for (const f of SCHEMA) {
            const v = s[f.key];
            if (f.type === 'bool') {
                out[f.key] = (v === undefined || v === null) ? f.def : !!v;
            } else if (f.type === 'num' || f.type === 'int') {
                let n = Number(v);
                if (!isFinite(n)) n = f.def;
                n = Math.max(f.min, Math.min(f.max, n));
                out[f.key] = (f.type === 'int') ? Math.round(n) : n;
            } else if (f.type === 'enum') {
                const ok = f.dynamic
                    ? (typeof v === 'string' && !!v)
                    : optionValues(f).indexOf(v) >= 0;
                out[f.key] = ok ? v : f.def;
            } else {
                out[f.key] = (v === undefined) ? f.def : v;
            }
        }
        return out;
    }

    const DEFAULTS = normalise({});

    function loadSettings() {
        let stored = null;
        try {
            const raw = window.localStorage.getItem(LS_KEY);
            if (raw) stored = JSON.parse(raw);
        } catch (_) { /* private mode or bad JSON */ }
        return normalise(Object.assign({}, DEFAULTS, stored || {}));
    }

    let S = loadSettings();

    function saveSettings() {
        try { window.localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (_) {}
    }

    /** True when a field is meaningful given the rest of the settings. */
    function fieldLive(f) {
        return (typeof f.when !== 'function') || !!f.when(S);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. Presets — a starting point, not a straitjacket.
    //
    // Almost nobody wants to set fifteen sliders, and the ones who do want
    // them all. So: a row of presets that each make internal sense, and the
    // advanced options folded away underneath. A preset is plain data, and it
    // only claims to be active while every value it names still holds.
    // ─────────────────────────────────────────────────────────────────────

    const PRESETS = [
        {
            id: 'live', label: 'Live',
            hint: 'Play along and read the tab while you do: a board above, a '
                + 'full staff below with the bars, the sections and the marks on it.',
            values: {
                readMode: 'scroll', board: 'highway_3d', heightPct: 32,
                aheadBeats: 5, behindBeats: 1.25, noteFill: 'dark', noteScale: 1,
                noteInk: 'string', lineInk: 'string', stringAlpha: 0.42,
                noteLabel: 'fret',
                showBars: true, showSections: true, showChords: true,
                showTech: true, showPM: true, showLoop: true, rhythmGrid: 'auto',
                showStrings: true, showTempo: true, showLyrics: false,
            },
        },
        {
            id: 'study', label: 'Study',
            hint: 'Learn the part away from the board: page turns, three staves, '
                + 'and every note named beside its fret.',
            values: {
                readMode: 'page', rows: 3, pageBars: 3, board: 'none',
                noteFill: 'dark', noteScale: 1.05, noteInk: 'string',
                lineInk: 'string', stringAlpha: 0.42, noteLabel: 'both',
                showBars: true, showSections: true, showChords: true,
                showTech: true, showPM: true, showLoop: true, rhythmGrid: 'auto',
                showStrings: true, showTempo: true, showLyrics: true,
            },
        },
        {
            id: 'sightread', label: 'Sight-reading',
            hint: 'Read it like paper: the same page turns in a single ink, with '
                + 'no colour to lean on.',
            values: {
                readMode: 'page', rows: 3, pageBars: 3, board: 'none',
                noteInk: 'mono', lineInk: 'mono', noteFill: 'dark',
                noteScale: 1.05, stringAlpha: 0.5, noteLabel: 'both',
                showBars: true, showSections: true, showChords: true,
                showTech: true, showPM: true, showLoop: true, rhythmGrid: 'auto',
                showStrings: true, showTempo: true, showLyrics: true,
            },
        },
        {
            id: 'arcade', label: 'Arcade',
            hint: 'Play, do not read: the board is the game and the tab shrinks '
                + 'to a ribbon of filled heads beneath it, nothing written on it '
                + 'at all — there to show what you hit, not to be read.',
            values: {
                readMode: 'scroll', board: 'highway_3d', heightPct: 16,
                aheadBeats: 3.5, behindBeats: 1, noteFill: 'solid', noteScale: 1.15,
                noteInk: 'string', lineInk: 'string', stringAlpha: 0.42,
                noteLabel: 'fret',
                showBars: false, showSections: false, showChords: false,
                showTech: false, showPM: false, showLoop: false, rhythmGrid: 'off',
                showStrings: false, showTempo: false, showLyrics: false,
            },
        },
        {
            id: 'minimal', label: 'Minimal',
            hint: 'One big scrolling staff and nothing else — no board, no '
                + 'names, nothing written but the bar numbers.',
            values: {
                readMode: 'scroll', board: 'none', heightPct: 45,
                aheadBeats: 6, behindBeats: 1.5, noteFill: 'dark', noteScale: 0.95,
                noteInk: 'string', lineInk: 'mono', stringAlpha: 0.3,
                noteLabel: 'fret',
                showBars: true, showSections: false, showChords: false,
                showTech: false, showPM: false, showLoop: true, rhythmGrid: 'beats',
                showStrings: true, showTempo: false, showLyrics: false,
            },
        },
    ];

    function presetMatches(preset) {
        for (const key of Object.keys(preset.values)) {
            if (S[key] !== preset.values[key]) return false;
        }
        return true;
    }

    function activePresetId() {
        for (const p of PRESETS) if (presetMatches(p)) return p.id;
        return null;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. Palette
    // ─────────────────────────────────────────────────────────────────────

    const GUITAR_COLORS = ['#ff5552', '#fff352', '#31caff', '#ffae31', '#84ff42', '#e639ff'];
    const BASS_COLORS = ['#ff5552', '#fff352', '#31caff', '#ffae31', '#84ff42', '#e639ff'];
    /*
     * ── THE DRAWING READS THE KIT'S TOKENS ──────────────────────────────
     *
     * These were hex: `#e8eef7`, `#9aa7b8`, `#4ade80`, `#f87171`. Every one of
     * them is a role the kit already publishes, and three were the WRONG shade
     * of the right idea — the kit's `good` is #3DDC84, not #4ade80, so a green
     * head and a green rail in the panel beside it were two different greens.
     *
     * Read at CALL TIME, not captured once: the kit writes `--fbk-*` on the
     * root and rewrites them when a theme changes, so a constant would be
     * whatever was true when the module loaded. That is the same mistake as
     * the panel's `repaintControls`, one layer down — except a canvas cannot
     * inherit a custom property, so it has to ask.
     *
     * A cache keyed on the root's own `data-fbk-theme`-less reality would be
     * premature: `getComputedStyle` on the root is a few microseconds and this
     * runs once per frame per colour, not per note.
     */
    const KIT_FALLBACK = {
        text: '232 238 252', dim: '138 160 200', accent: '41 168 255',
        good: '61 220 132', bad: '229 72 77', bg: '5 7 12',
    };

    function kitInk(role, alpha) {
        let triplet = KIT_FALLBACK[role] || KIT_FALLBACK.text;
        try {
            const v = getComputedStyle(document.documentElement)
                .getPropertyValue('--fbk-' + role).trim();
            if (v) triplet = v;
        } catch (_) { /* no document yet — the fallback is the kit's own value */ }
        return (alpha === undefined)
            ? 'rgb(' + triplet + ')'
            : 'rgb(' + triplet + ' / ' + alpha + ')';
    }

    /*
     * The kit's own type stacks, so a fret number on the tab and one in the
     * panel are the same face. Numbers were already Mono; the TEXT was `Inter`,
     * which is nothing this design system uses.
     */
    function kitFont(role) {
        const fallback = (role === 'num')
            ? '"JetBrains Mono", ui-monospace, monospace'
            : 'Rubik, system-ui, sans-serif';
        try {
            const v = getComputedStyle(document.documentElement)
                .getPropertyValue(role === 'num' ? '--fbk-font-num' : '--fbk-font').trim();
            return v || fallback;
        } catch (_) { return fallback; }
    }

    const MONO_NOTE = () => kitInk('text');
    const MONO_LINE = () => kitInk('dim');
    const COL_HIT = () => kitInk('good');
    const COL_MISS = () => kitInk('bad');
    const COL_BAR = 'rgba(255,255,255,0.34)';
    const COL_BEAT = 'rgba(255,255,255,0.11)';
    const COL_HALF = 'rgba(255,255,255,0.075)';
    const COL_QUARTER = 'rgba(255,255,255,0.042)';
    // The app's own loop buttons are green; the tab says the same thing in the
    // same colour rather than inventing a second vocabulary for it.
    const COL_LOOP = 'rgba(74,222,128,0.85)';
    const COL_LOOP_FILL = 'rgba(74,222,128,0.10)';
    /*
     * THE CURSOR IS THE ACCENT, not white.
     *
     * White made it one more bright thing among the note heads and the bar
     * lines; the accent is the only colour in this system that means "here,
     * now", and it is what the panel's own live rung uses. Reported as part of
     * the tab's own design pass.
     */
    const COL_PLAYHEAD = () => kitInk('accent');
    const NOW_WINDOW = 0.09;
    const ROW_GAP_MAX = 26;

    // Seven- and eight-string guitars add their extra strings below the low E,
    // which is the order the app's own colour slots use too (low7, low8).
    const LOW_EXTRA = ['#7c8cff', '#f472b6'];

    function paletteFor(stringCount, isBass) {
        const bass = (isBass === undefined) ? (stringCount <= 5) : !!isBass;
        const base = bass ? BASS_COLORS : GUITAR_COLORS;
        if (stringCount <= base.length) return base;
        return LOW_EXTRA.slice(0, stringCount - base.length).reverse().concat(base);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 4. Pure helpers — no canvas, no host.
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Which visual row a string index sits on.
     *
     * Chart index 0 is the lowest string. Tab is written with the thinnest on
     * top, so by default the order is reversed; the board draws it the other
     * way round, and some players would rather the two agree.
     */
    function rowFor(stringIndex, stringCount, highOnTop) {
        return highOnTop ? (stringCount - 1 - stringIndex) : stringIndex;
    }

    function techniqueMark(n) {
        if (!n) return '';
        if (n.ho) return 'h';
        if (n.po) return 'p';
        if (n.tp) return 't';
        if (n.hm || n.hp) return '◇';
        return '';
    }

    function slideTarget(n) {
        if (!n) return null;
        const sl = (typeof n.sl === 'number' && n.sl >= 0) ? n.sl : null;
        if (sl != null) return sl;
        return (typeof n.slu === 'number' && n.slu >= 0) ? n.slu : null;
    }

    /** Normalise a provider verdict: bare string or { state } -> 'hit'|'miss'|null. */
    function verdictOf(raw) {
        if (!raw) return null;
        const st = (typeof raw === 'object') ? raw.state : raw;
        if (st === 'hit' || st === 'active') return 'hit';
        if (st === 'miss') return 'miss';
        return null;
    }

    /** Flatten a chord into note-shaped entries sharing the chord's time. */
    function chordNotes(chord, templates) {
        if (!chord) return [];
        if (Array.isArray(chord.notes) && chord.notes.length) {
            return chord.notes.map((cn) => Object.assign({}, cn, { t: chord.t }));
        }
        const tpl = (Array.isArray(templates) && chord.id != null) ? templates[chord.id] : null;
        const frets = tpl && Array.isArray(tpl.frets) ? tpl.frets : null;
        if (!frets) return [];
        const out = [];
        for (let s = 0; s < frets.length; s++) {
            if (frets[s] >= 0) out.push({ s: s, f: frets[s], t: chord.t });
        }
        return out;
    }

    /**
     * Smallest pixel gap between consecutive notes on the same string.
     *
     * A fast passage packs notes closer than a fret number is wide and the
     * digits start colliding. Measuring the tightest spacing actually on
     * screen lets the type shrink exactly as much as that passage needs,
     * instead of picking one size that is either too big for a solo or too
     * small for everything else.
     */
    function tightestGap(items, xOf, stringCount) {
        const lastX = new Array(stringCount).fill(null);
        const ordered = items.slice().sort((a, b) => a.t - b.t);
        let min = Infinity;
        for (const it of ordered) {
            const s = it.n.s | 0;
            if (s < 0 || s >= stringCount) continue;
            const x = xOf(it.t);
            const prev = lastX[s];
            if (prev != null) {
                const d = Math.abs(x - prev);
                if (d > 0.5 && d < min) min = d;
            }
            lastX[s] = x;
        }
        return min;
    }

    // ── Pitch ────────────────────────────────────────────────────────
    // Only pitch classes, never octaves: a name is what was asked for, and
    // there is no octave numbering to get wrong. Fret numbers in these charts
    // are absolute positions on the neck, so a capo does not enter into it —
    // fret 5 is fret 5 whether or not something is clamped at fret 2.
    const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const OPEN_GUITAR = [4, 9, 2, 7, 11, 4];   // E A D G B E
    const OPEN_BASS4 = [4, 9, 2, 7];           // E A D G
    const OPEN_BASS5 = [11, 4, 9, 2, 7];       // B E A D G

    /**
     * Open-string pitch classes, lowest string first, for any string count.
     *
     * Extended rather than enumerated: a seven-string adds a B a fourth below
     * the low E, an eight-string an F# below that, and a five-string bass adds
     * the same low B while a six adds a high C. Charts with more strings than
     * we have ever seen therefore name their notes correctly instead of being
     * truncated to six and silently losing the bottom of the instrument.
     */
    function openPitchClasses(stringCount, isBass) {
        const n = Math.max(4, stringCount | 0);
        let out;
        if (isBass) {
            out = OPEN_BASS4.slice();               // E A D G
            if (n >= 5) out = OPEN_BASS5.slice();   // B E A D G
            if (n >= 6) out.push(0);                // high C
        } else {
            out = OPEN_GUITAR.slice();              // E A D G B E
            while (out.length < n) out.unshift((((out[0] - 5) % 12) + 12) % 12);
        }
        return out.slice(0, n);
    }

    /**
     * Name of the note a fret sounds, given the song's tuning.
     *
     * `tuning.offsets` are per-string semitone offsets from standard, which is
     * how the charts carry a drop D or an Eb tuning, so a transposed song names
     * its notes correctly rather than a semitone out.
     */
    function noteNameFor(stringIndex, fret, tuning, stringCount) {
        if (fret == null || fret < 0) return '';
        const open = openPitchClasses(stringCount, !!(tuning && tuning.bass));
        const base = open[stringIndex];
        if (base == null) return '';
        const offsets = (tuning && Array.isArray(tuning.offsets)) ? tuning.offsets : [];
        const off = Number(offsets[stringIndex]) || 0;
        return NOTE_NAMES[(((base + off + fret) % 12) + 12) % 12];
    }

    /**
     * How many lines the staff draws, and how far the chart's strings shift up.
     *
     * Extra strings on a real instrument are always the low ones — a five-string
     * bass adds a B below the E — so a four-string chart on that bass keeps its
     * strings and gains an empty line underneath. Only within the same family:
     * a bass chart read by someone holding a six-string guitar must not sprout
     * two bass strings, which is exactly what the naive version did.
     */
    /**
     * How finely to rule the beat, given how much room a beat has.
     *
     * Halves and quarters of a beat, and no further: a thirty-second is not
     * something anyone counts off a moving ruler, and drawing one only fills
     * the space between the notes with lines. A subdivision is only worth
     * drawing if its ticks are far enough apart to be told from each other —
     * below that they read as a smear, which is the opposite of counting.
     */
    const SUB_MIN_PX = 18;

    /**
     * Draw text centred on the INK, not on the em box.
     *
     * `textBaseline = 'middle'` centres the font's em box, and a digit's ink is
     * not in the middle of that box: `5` has no descender, so the em box
     * reserves room below it that the glyph never uses and the digit rides
     * high. Inside a circle that is immediately visible — reported as the
     * number not being in the centre of the circumference — and the old answer
     * was a hand-tuned `y + 0.5`, which is a fudge for one font at one size
     * that goes wrong at every other.
     *
     * `actualBoundingBoxAscent/Descent` measure the glyph that will actually be
     * painted, so the correction is exact for whatever is inside: a digit, two
     * digits, `A#`, a bracketed `(7)`, an `H`. Which is the requirement —
     * whatever is in there is in the true centre.
     *
     * Falls back to `middle` where the metrics are missing, because a slightly
     * high digit is better than a digit at the baseline.
     */
    function fillInkCentred(ctx, text, cx, cy, align) {
        ctx.textAlign = align || 'center';
        const m = ctx.measureText(text);
        const up = m.actualBoundingBoxAscent;
        const down = m.actualBoundingBoxDescent;
        if (typeof up === 'number' && typeof down === 'number') {
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(text, cx, cy + (up - down) / 2);
            return;
        }
        ctx.textBaseline = 'middle';
        ctx.fillText(text, cx, cy);
    }

    function beatDivisions(pxPerBeat) {
        if (S.rhythmGrid === 'off') return 0;
        if (S.rhythmGrid !== 'auto') return 1;
        if (pxPerBeat / 4 >= SUB_MIN_PX) return 4;
        if (pxPerBeat / 2 >= SUB_MIN_PX) return 2;
        return 1;
    }

    /**
     * The armed loop, in song seconds, or null.
     *
     * Read a few times a second and remembered, not asked for on every frame:
     * the host's own comment records that another plugin polling this surface
     * at 30 Hz turned each tick into a snapshot serialization and saturated
     * the inspector. Nothing here needs to know within 250 ms.
     */
    let loopCache = { at: -1e9, a: null, b: null };

    function currentLoop() {
        if (!S.showLoop) return null;
        const now = (window.performance && performance.now) ? performance.now() : 0;
        if (now - loopCache.at > 250) {
            loopCache = { at: now, a: null, b: null };
            try {
                const fb = window.feedBack;
                const l = (fb && typeof fb.getLoop === 'function')
                    ? fb.getLoop({ reason: 'livetab-draw' }) : null;
                if (l && typeof l.loopA === 'number' && typeof l.loopB === 'number'
                    && l.loopB > l.loopA) {
                    loopCache.a = l.loopA;
                    loopCache.b = l.loopB;
                }
            } catch (_) { /* an older host with no loop API */ }
        }
        return (loopCache.a === null) ? null : { a: loopCache.a, b: loopCache.b };
    }

    function staffLines(chartCount, myCount, chartIsBass, myIsBass) {
        const plain = { lines: chartCount, rowOffset: 0 };
        if (!myCount || myCount <= chartCount) return plain;
        if (!!chartIsBass !== !!myIsBass) return plain;
        const lines = Math.min(8, myCount);
        if (lines <= chartCount) return plain;
        return { lines: lines, rowOffset: lines - chartCount };
    }

    /**
     * A lyric syllable as it should be printed.
     *
     * The charts already carry the hyphen where a word is broken across
     * syllables — "cre-", "scen-", "do+" — and use a trailing '+' purely as an
     * end-of-word marker that is never printed. Nothing else needs adding:
     * inferring a hyphen from the absence of '+' put one after every whole
     * word, since a chart only marks the syllables it actually split.
     */
    function syllable(word) {
        const w = String(word == null ? '' : word).trim();
        if (!w) return '';
        return w.endsWith('+') ? w.slice(0, -1) : w;
    }

    /** Bar lines (with their numbers) inside a time range, from the raw grid. */
    /**
     * Where the bar lines are.
     *
     * A bar line is where the measure NUMBER CHANGES, not merely where a beat
     * carries one. Charts differ in how much they annotate: most tag only the
     * downbeat and leave the rest at -1, but one in this library tags every
     * single beat and repeats the number — 1,1,1,1, 2,2,2,2 — which is a plain
     * 4/4 spelled out beat by beat.
     *
     * Reading "has a number" as "is a bar line" turned that chart into four
     * bars per bar, and everything downstream inherited it: a two-bar staff
     * lasted half a second, the automatic fit answered with ten bars, and the
     * slider's ceiling had to be raised to thirty-two to reach what the fit had
     * asked for. All of it compensation for this one line. Across the library
     * the two readings agree on every chart but that one.
     */
    function barLines(beats) {
        const out = [];
        if (!Array.isArray(beats)) return out;
        let last = null;
        for (const b of beats) {
            const t = (b && typeof b.time === 'number') ? b.time : null;
            if (t == null || b.measure == null || b.measure === -1) continue;
            if (b.measure === last) continue;
            last = b.measure;
            out.push({ t: t, measure: b.measure });
        }
        return out;
    }

    function barsInRange(beats, from, to) {
        return barLines(beats).filter((b) => b.t >= from && b.t <= to);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. Tempo map — time <-> beat position, over a cleaned beat grid.
    //
    // Everything about how the tab reads comes from here, so it is worth
    // stating plainly what it does and why.
    //
    // Positions are measured in BEATS, not seconds. Two consequences, both of
    // them the point: note spacing is proportional to note value (a quarter
    // really is twice an eighth, in a slow song and a fast one alike), and the
    // tab advances at exactly one beat per beat, so the movement is locked to
    // the music rather than to the clock.
    //
    // The grid it measures is cleaned first, because charts lie. Real example:
    // one chart opens with a beat at 0:00, a three-second hole, then a "bar" of
    // four beats 75 ms apart, before the song proper settles at 0.41 s per
    // beat. Reading the local tempo out of that gave a window five times too
    // narrow, so the tab tore along through the empty intro and then abruptly
    // settled when the first notes arrived. Cleaning is two rules, both against
    // a robust median of every interval in the song: drop beats closer together
    // than half a beat (subdivision noise masquerading as tempo), and fill
    // holes longer than about two beats with whole beats (so a gap does not
    // become one enormous beat). Bar numbers still come from the raw grid —
    // only the mapping is cleaned, so labels stay where the chart puts them.
    // ─────────────────────────────────────────────────────────────────────

    let tempoCache = { beats: null, map: null };
    /*
     * Whether a staff has already failed to draw. One report per session: the
     * fault is in the code, not in the frame, so the second occurrence tells
     * nobody anything the first did not.
     */
    let drawFailed = false;

    function buildTempoMap(beats) {
        const raw = [];
        for (const b of beats || []) {
            if (b && typeof b.time === 'number' && isFinite(b.time)) raw.push(b.time);
        }
        raw.sort((a, b) => a - b);
        if (raw.length < 2) return null;

        const gaps = [];
        for (let i = 1; i < raw.length; i++) {
            const d = raw[i] - raw[i - 1];
            if (d > 0.02) gaps.push(d);
        }
        if (!gaps.length) return null;
        gaps.sort((a, b) => a - b);
        const ref = gaps[Math.floor(gaps.length / 2)];
        if (!(ref > 0.02)) return null;

        const grid = [raw[0]];
        let dropped = 0;
        let filled = 0;
        for (let i = 1; i < raw.length; i++) {
            const prev = grid[grid.length - 1];
            const d = raw[i] - prev;
            if (d < ref * 0.55) { dropped += 1; continue; }   // subdivision noise
            if (d > ref * 1.8) {                       // a hole: fill it in beats
                const steps = Math.max(1, Math.round(d / ref));
                for (let j = 1; j < steps; j++) { grid.push(prev + (d * j) / steps); filled += 1; }
            }
            grid.push(raw[i]);
        }
        if (grid.length < 2) return null;

        const markers = barLines(beats).map((b) => b.t);

        const map = {
            ref: ref, grid: grid, markers: markers,
            // What the cleaning had to do to this chart's grid. A chart that
            // needed a lot of it is the first thing to look at when someone
            // reports that the tab reads oddly.
            stats: { raw: raw.length, kept: grid.length, dropped: dropped, filled: filled },
        };

        /** Fractional beat index at time `t`, extrapolated outside the grid. */
        map.pos = function (t) {
            const g = grid;
            const n = g.length;
            if (t <= g[0]) return (t - g[0]) / ref;
            if (t >= g[n - 1]) return (n - 1) + (t - g[n - 1]) / ref;
            let lo = 0;
            let hi = n - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (g[mid] <= t) lo = mid; else hi = mid;
            }
            const span = g[hi] - g[lo];
            return lo + ((span > 0) ? (t - g[lo]) / span : 0);
        };

        /** Time at fractional beat index `p` — the inverse of `pos`. */
        map.time = function (p) {
            const g = grid;
            const n = g.length;
            if (p <= 0) return g[0] + p * ref;
            if (p >= n - 1) return g[n - 1] + (p - (n - 1)) * ref;
            const i = Math.floor(p);
            return g[i] + (g[i + 1] - g[i]) * (p - i);
        };

        /**
         * Beats per minute around `t`, from the cleaned grid.
         *
         * Not from the host's getBPM(): that reads the raw grid, and on a chart
         * whose grid opens with junk it answers 24 for a song that plays at 124.
         * The cleaning that keeps the scroll honest keeps this honest too, and a
         * short median means a tempo change reads as a change rather than as a
         * flicker.
         */
        map.bpmAt = function (t) {
            const n = grid.length;
            const at = Math.max(0, Math.min(n - 2, Math.floor(map.pos(t))));
            const spans = [];
            for (let j = Math.max(0, at - 2); j < Math.min(n - 1, at + 3); j++) {
                const d = grid[j + 1] - grid[j];
                if (d > 0.05 && d < 4) spans.push(d);
            }
            if (!spans.length) return 60 / ref;
            spans.sort((a, b) => a - b);
            return 60 / spans[Math.floor(spans.length / 2)];
        };

        // One tempo for the whole song, alongside the local one above. The
        // reading window is sized from it, and a window that breathed with
        // every tempo change would zoom the notes in and out while they are
        // being read — the steadiness is the point.
        const wholeSong = [];
        for (let i = 1; i < grid.length; i++) {
            const d = grid[i] - grid[i - 1];
            if (d > 0.05 && d < 4) wholeSong.push(d);
        }
        wholeSong.sort((a, b) => a - b);
        map.bpm = wholeSong.length
            ? 60 / wholeSong[Math.floor(wholeSong.length / 2)] : 60 / ref;

        // Beats per bar, measured in the cleaned grid's own units. The median
        // shrugs off a pickup bar or a lone 2/4.
        let beatsPerBar = 4;
        if (markers.length >= 3) {
            const counts = [];
            for (let i = 1; i < markers.length; i++) {
                const c = map.pos(markers[i]) - map.pos(markers[i - 1]);
                if (c > 0.5 && c < 24) counts.push(c);
            }
            if (counts.length) {
                counts.sort((a, b) => a - b);
                beatsPerBar = Math.max(1, Math.round(counts[Math.floor(counts.length / 2)]));
            }
        }
        map.beatsPerBar = beatsPerBar;

        // Bar lines in beat space. A page is measured in bars, not in beats,
        // and this is the list it counts along. Markers closer together than
        // half a beat are the same bar line twice as far as reading goes.
        const barPos = [];
        for (const t of markers) {
            const bp = map.pos(t);
            if (!barPos.length || bp - barPos[barPos.length - 1] > 0.4) barPos.push(bp);
        }
        map.barPos = barPos;

        /** Beat position of bar line `i`, extrapolated past either end. */
        map.barAt = function (i) {
            const n = barPos.length;
            if (!n) return i * beatsPerBar;
            if (i < 0) return barPos[0] + i * beatsPerBar;
            if (i < n) return barPos[i];
            return barPos[n - 1] + (i - (n - 1)) * beatsPerBar;
        };

        /** Which bar contains beat position `p`; negative before the first. */
        map.barIndexAt = function (pp) {
            const b = barPos;
            const n = b.length;
            if (!n) return Math.floor(pp / beatsPerBar);
            if (pp < b[0]) return Math.floor((pp - b[0]) / beatsPerBar);
            if (pp >= b[n - 1]) return (n - 1) + Math.floor((pp - b[n - 1]) / beatsPerBar);
            let lo = 0;
            let hi = n - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (b[mid] <= pp) lo = mid; else hi = mid;
            }
            return lo;
        };

        // Where the pages start counting: the first bar line followed by a bar
        // of the usual length. Anchoring on a ragged pickup would put every
        // page half a bar out for the rest of the song.
        let anchor = 0;
        let anchorBar = 0;
        for (let i = 0; i < barPos.length - 1; i++) {
            if (Math.abs((barPos[i + 1] - barPos[i]) - beatsPerBar) < 0.35) {
                anchor = barPos[i];
                anchorBar = i;
                break;
            }
        }
        map.anchor = anchor;
        map.anchorBar = anchorBar;
        return map;
    }

    function tempoMap(beats) {
        if (tempoCache.beats === beats) return tempoCache.map;
        const map = buildTempoMap(beats);
        tempoCache = { beats: beats, map: map };
        return map;
    }

    /** For a chart with no usable grid: one beat is half a second, 4/4. */
    function fallbackMap() {
        const ref = 0.5;
        return {
            ref: ref, grid: [0], markers: [], barPos: [], beatsPerBar: 4,
            anchor: 0, anchorBar: 0, bpm: 60 / ref,
            stats: { raw: 0, kept: 0, dropped: 0, filled: 0 },
            pos: (t) => t / ref,
            time: (p) => p * ref,
            bpmAt: () => 60 / ref,
            barAt: (i) => i * 4,
            barIndexAt: (p) => Math.floor(p / 4),
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // 6. Reading modes — what each staff covers.
    //
    // Both modes come down to the same thing: a list of staves, each with a
    // window in beat position, at most one of them holding the cursor. Keeping
    // that shape means the drawing code has no idea which mode it is in, and a
    // third mode would be a third branch here and nothing else.
    // ─────────────────────────────────────────────────────────────────────

    const PAGE_TURN_MS = 260;
    let pageAnim = { index: null, since: 0 };

    // The pace of the reading.
    //
    // Both modes size themselves in musical units — beats for the scrolling
    // window, bars for a staff — which is right for note spacing and wrong for
    // speed. A window of a fixed number of beats crosses the screen at a rate
    // proportional to the tempo, and a display holds each frame for a refresh,
    // so a moving glyph is smeared over speed/refresh pixels. Measured across
    // forty charts at the default setting: 294 px/s and a 5 px smear at 70 bpm,
    // 848 px/s and 14 px at 201 — wider than a fret digit is. Slow songs read
    // perfectly, fast ones blur, which is precisely what came back from the
    // people playing them.
    //
    // So the window stretches with the tempo instead: above PACE_BPM the
    // reading speed is held at what it is at PACE_BPM, below it nothing
    // changes. Note spacing stays proportional to note value either way — only
    // how much of the song is on screen moves.
    //
    // There is no switch for this. It was built with one, and the honest answer
    // to "when would you turn it off?" is: to read a fast song at a speed that
    // was measured as unreadable. The sliders still say how much is on screen,
    // which is the control anyone actually wanted, and in page turns moving the
    // slider takes the decision back completely.
    const PACE_BPM = 120;
    const PACE_MAX = 2;          // never more than twice what was asked for

    function songBPM(map) {
        const bpm = map && map.bpm;
        return (isFinite(bpm) && bpm > 20 && bpm < 400) ? bpm : PACE_BPM;
    }

    /** How much wider the scrolling window is than the setting asks. */
    function paceFactor(map) {
        return Math.max(1, Math.min(PACE_MAX, songBPM(map) / PACE_BPM));
    }

    /**
     * How many bars one staff holds. The setting, and nothing else.
     *
     * There were three answers here before this one, and all three were
     * fighting the same phantom: a chart whose bar lines had been miscounted
     * four to one. Once a bar line is read as a change of measure number, a
     * bar is a bar on every chart in the library, three of them last between
     * three and a half and thirteen seconds depending on the tempo, and every
     * one of those is long enough to read. So there is no floor to apply, no
     * automatic choice to explain, and no ceiling that moves from song to song.
     */
    function staffBars() {
        return Math.max(1, S.pageBars);
    }

    /**
     * How far the stack still has to travel, 1 -> 0, for the current page.
     *
     * The turn is the only movement in this mode, so it has to read as one
     * gesture: quick off the mark, settling into place. A seek is not a turn —
     * sliding through twenty pages to reach a bookmark would be a smear — so
     * only a step to the very next page animates.
     */
    function pageShift(index) {
        const t = (window.performance && performance.now) ? performance.now() : 0;
        if (pageAnim.index === null || index !== pageAnim.index) {
            const stepped = (pageAnim.index !== null && index === pageAnim.index + 1);
            pageAnim = { index: index, since: stepped ? t : (t - PAGE_TURN_MS) };
        }
        const p = Math.max(0, Math.min(1, (t - pageAnim.since) / PAGE_TURN_MS));
        return Math.pow(1 - p, 3);
    }

    /** Staves to draw: [{ row, p0, pSpan, cursorP, veil }]. */
    function stavesFor(map, now, rows) {
        const nowP = map.pos(now);

        if (S.readMode !== 'page') {
            // Ahead and behind stretch together, so the cursor keeps its place
            // across the width and the tab does not appear to jump sideways
            // when the song changes.
            const pace = paceFactor(map);
            const span = Math.max(1, (S.aheadBeats + S.behindBeats) * pace);
            return [{
                row: 0, p0: nowP - S.behindBeats * pace, pSpan: span,
                cursorP: nowP, veil: 0,
            }];
        }

        // A staff holds whole bars, and starts and ends on bar lines — which
        // is the entire promise of the mode. Counting a fixed number of beats
        // instead looks identical until the chart contains one irregular bar:
        // this song has a two-beat bar in its intro, and from there on every
        // staff began half a bar late and stayed that way.
        const perPage = staffBars();
        const bar = map.barIndexAt(nowP);
        const index = Math.floor((bar - map.anchorBar) / perPage);
        const shift = pageShift(index);
        const out = [];
        for (let i = -1; i < rows; i++) {
            const row = i + shift;
            if (row <= -1 || row >= rows) continue;
            const firstBar = map.anchorBar + (index + i) * perPage;
            const p0 = map.barAt(firstBar);
            out.push({
                row: row,
                p0: p0,
                pSpan: Math.max(1, map.barAt(firstBar + perPage) - p0),
                // A page holds exactly its bars. A scrolling window is a
                // viewport and wants notes sliding in from beyond its edge; a
                // page is a closed container, and a bar that starts on one
                // staff has to finish there.
                bounded: true,
                cursorP: (i === 0) ? nowP : null,
                // Which staff you are on has to be obvious without hunting for
                // the cursor, so the others sit behind a veil: the page being
                // left goes dark, the ones still to come only recede.
                veil: (i < 0) ? 0.62 : (i > 0 ? 0.3 : 0),
            });
        }
        return out;
    }

    function rowsUsed() {
        return (S.readMode === 'page') ? S.rows : 1;
    }

    /**
     * The board actually hosted, which is none while the tab turns pages.
     *
     * Page turns need the whole player: three staves sharing it with a board
     * leaves about 9px between strings while a note head is 13px across, so
     * the heads would sit on the lines above and below. The setting is kept —
     * switching back to scrolling restores the board you chose — but it does
     * not apply, and the panels hide it rather than offering a broken view.
     */
    function activeBoard() {
        return (S.readMode === 'page') ? 'none' : (S.board || 'none');
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. Host access
    // ─────────────────────────────────────────────────────────────────────

    function hw() {
        const h = window.highway;
        return (h && typeof h.getTime === 'function') ? h : null;
    }

    function call(api2, name, fallback) {
        if (!api2 || typeof api2[name] !== 'function') return fallback;
        try {
            const v = api2[name]();
            return (v === undefined || v === null) ? fallback : v;
        } catch (_) {
            return fallback;
        }
    }

    /**
     * The song's tuning, as the tab needs it for note names.
     *
     * `currentSong` carries the per-string offsets and the arrangement, which is
     * the only place a plugin can read them: the highway's own getTuning() is
     * not wired on this path and returns undefined.
     */
    function songTuning() {
        const fb = window.feedBack;
        const cs = (fb && fb.currentSong) || {};
        let bass = false;
        try {
            bass = !!(fb && typeof fb.isBassArrangement === 'function' && fb.isBassArrangement());
        } catch (_) { bass = false; }
        if (!bass) bass = /bass/i.test(String(cs.arrangement || ''));
        return {
            offsets: Array.isArray(cs.tuning) ? cs.tuning : [],
            bass: bass,
        };
    }

    /** The player's own instrument: { count, bass }. count 0 when unknown. */
    function myInstrument() {
        try {
            const wt = window.feedBack.workingTuning.get();
            const n = Number(wt && wt.stringCount);
            return {
                count: (isFinite(n) && n >= 4 && n <= 8) ? n : 0,
                bass: String(wt && wt.instrument || '').toLowerCase() === 'bass',
            };
        } catch (_) {
            return { count: 0, bass: false };
        }
    }

    /** Height reserved by the transport bar, so the tab never hides it. */
    function transportHeight() {
        const el = document.getElementById('player-controls');
        if (!el) return 56;
        const r = el.getBoundingClientRect();
        return (r.height > 0 ? r.height : 56) + 8;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 8. Drawing
    // ─────────────────────────────────────────────────────────────────────

    // `paintTab` writes through this; `renderInto` points it at whichever
    // context is being painted.
    let ctx = null;

    // Set by the factory when the chosen board turned out not to support this
    // song: the tab then owns the whole area and its backdrop must be solid.
    let boardIsBlank = false;

    /**
     * One staff, covering `view.pSpan` beats from `view.p0`.
     *
     * The caller decides what a staff shows, which is what lets one drawing
     * serve both reading modes. A staff is "live" when the cursor is inside
     * it — only that one gets a playhead, a halo and a faded spent region.
     */
    function drawStaff(chart, band, view) {
        const { colors, count, lines, rowOffset, templates, items, provider,
            now, map, k, w, tuning } = chart;
        // The string names need a lane of their own, or a note arriving at the
        // staff's edge is drawn straight over them — the margin was never
        // reserved, it was just the space left before the first note. So the
        // gutter is measured from the names themselves, the staff starts clear
        // of it, and everything drawn on the staff is clipped to that edge, so
        // notes entering and leaving are cut at the start of the system rather
        // than wandering into the margin.
        const lineName = (l) => noteNameFor(l, 0, tuning, lines);
        let legendW = 0;
        if (S.showStrings) {
            ctx.save();
            ctx.font = '700 ' + Math.round(8.5 * k) + 'px ' + kitFont('text');
            for (let l = 0; l < lines; l++) {
                legendW = Math.max(legendW, ctx.measureText(lineName(l)).width);
            }
            ctx.restore();
        }
        const gutter = legendW > 0 ? (4 * k + legendW) : 0;
        const clipLeft = gutter > 0 ? gutter + 4 * k : 0;
        const padX = Math.max(26 * k, gutter + 16 * k);
        const usableW = Math.max(1, w - padX * 2);
        const pSpan = Math.max(0.25, view.pSpan);
        const pxPerBeat = usableW / pSpan;
        const xAt = (t) => padX + (map.pos(t) - view.p0) * pxPerBeat;
        const isLive = view.cursorP != null;
        const cursorP = isLive
            ? Math.max(view.p0, Math.min(view.p0 + pSpan, view.cursorP)) : view.p0;
        const playX = padX + (cursorP - view.p0) * pxPerBeat;

        ctx.save();
        ctx.beginPath();
        ctx.rect(clipLeft, band.top, Math.max(1, w - clipLeft), band.height);
        ctx.clip();

        // Scrolling reads a little past both edges so notes slide in and out
        // instead of appearing; a page reads exactly its own bars.
        const bounded = !!view.bounded;
        const slack = bounded ? 0 : 0.6;
        const from = map.time(view.p0 - slack);
        const to = map.time(view.p0 + pSpan + slack);
        const bars = barsInRange(chart.beats, from, to);
        // Half-open at the top: the bar line closing the page is drawn, but the
        // notes standing on it belong to the staff below.
        const endT = bounded ? map.time(view.p0 + pSpan) - 1e-4 : to;

        // Type size follows the tightest spacing actually on screen, so a fast
        // run shrinks exactly as much as that run needs and nothing else does.
        const visible = items.filter((it) => it.t >= from && it.t <= endT);
        // A note struck on the staff above can still be ringing on this one.
        // Its head belongs to the staff it was played on, but its tail has to
        // run on here, or a held note simply vanishes at the page turn and
        // there is no way to tell how long it lasts.
        const sounding = items.filter((it) => {
            const sus = (typeof it.n.sus === 'number') ? it.n.sus : 0;
            return sus > 0.02 && it.t < from && (it.t + sus) >= from;
        });
        const tight = tightestGap(visible, xAt, count);
        const fit = isFinite(tight) ? Math.max(0.5, Math.min(1, tight / (21 * k))) : 1;
        const fsWanted = 12.5 * k * fit * S.noteScale;

        // How tall a note head actually gets here. The palm-mute row hangs off
        // this rather than off a fixed offset: the head grows with the note-size
        // setting and shrinks in a dense run, and a fixed offset meant P.M.
        // ended up touching the circles it is supposed to sit under.
        const headWanted = 9 * k * fit * S.noteScale;
        const headMax = headWanted * 1.16;

        // Everything written above the strings needs its own lane, or a chord
        // change on a downbeat prints its name straight through the bar number,
        // and a section mark through both. One tier each, and the headroom is
        // only as deep as the tiers actually in use.
        const wantChord = S.showChords;
        const wantSect = S.showSections;
        const tiers = 1 + (wantChord ? 1 : 0) + (wantSect ? 1 : 0);
        const headroom = (6 + tiers * 12) * k;
        // Below the strings, in order: the palm-mute brackets, then the words.
        const footroom = headMax + 6 * k
            + (S.showPM ? 15 * k : 0)
            + (S.showLyrics ? 15 * k : 0)
            + 4 * k;
        const innerH = Math.max(1, band.height - headroom - footroom);
        const gap = Math.min(ROW_GAP_MAX * k, innerH / Math.max(1, lines - 1));

        // A note head cannot be taller than the space between two strings, or a
        // chord stacks six circles into five gaps and they overlap. `fit` only
        // ever measured the horizontal crowding — how close the next note on
        // the same string is — and said nothing about the staff being short.
        // The type follows the head down, since a digit bigger than the circle
        // holding it is no better than the overlap it replaced.
        const headR = Math.min(headWanted, gap * 0.46);
        const fs = Math.min(fsWanted, headR * 1.45);
        const staffTop = band.top + headroom + Math.max(0, (innerH - gap * (lines - 1)) / 2);
        const staffBottom = staffTop + gap * (lines - 1);
        // A chart string and a staff line are not always the same thing: on a
        // five-string bass playing a four-string chart there is a line with
        // nothing on it, and the notes sit one line up.
        const yLine = (l) => staffTop + rowFor(l, lines, S.highStringOnTop) * gap;
        const yAt = (s) => yLine(s + rowOffset);

        const laneBar = staffTop - 10 * k;
        const laneChord = staffTop - 22 * k;
        const laneSect = staffTop - (wantChord ? 34 : 22) * k;

        // Two labels can also collide inside one lane — a chord every eighth
        // note, say. First one wins the spot; the loser is dropped rather than
        // printed over, since the notes still say what the chord is.
        const laneUse = new Map();
        const laneFree = (lane, x0, x1) => {
            // A label sliced by the edge of the staff reads as a fault, not as
            // a label continuing off-screen: better none than half of one.
            if (x0 < clipLeft || x1 > w) return false;
            let taken = laneUse.get(lane);
            if (!taken) { taken = []; laneUse.set(lane, taken); }
            for (const sp of taken) {
                if (x1 > sp[0] - 3 * k && x0 < sp[1] + 3 * k) return false;
            }
            taken.push([x0, x1]);
            return true;
        };

        // Colour. The string palette is the app's, so changing it in Graphics
        // settings changes the tab too; mono is the other way tab is read.
        const lineOf = (l) => (S.lineInk === 'mono') ? MONO_LINE() : (colors[l] || '#888');
        const noteOf = (s) => (S.noteInk === 'mono')
            ? MONO_NOTE() : (colors[s + rowOffset] || '#ddd');
        const nameOf = (s, fret) => noteNameFor(s + rowOffset, fret, tuning, lines);

        // ── What has already gone by ─────────────────────────────────
        // A moving tab needs the eye pulled forward. Everything left of the
        // cursor is spent, so it sits under a fade that deepens towards the
        // edge — enough to separate past from future without hiding the notes
        // you have just played and might still want to check.
        if (isLive && playX > padX) {
            const past = ctx.createLinearGradient(0, 0, playX, 0);
            past.addColorStop(0, 'rgba(4,7,12,0.72)');
            past.addColorStop(0.75, 'rgba(4,7,12,0.30)');
            past.addColorStop(1, 'rgba(4,7,12,0)');
            ctx.fillStyle = past;
            ctx.fillRect(0, band.top, playX, band.height);
        }

        // ── Beat grid ────────────────────────────────────────────────
        // Beats stay faint and stop short of the strings; bar lines run taller
        // and carry the number. Rhythm should be felt, not read. The ticks are
        // whole beats of the cleaned grid, so a chart that writes four beats
        // 75 ms apart no longer prints four lines on top of each other.
        const divs = beatDivisions(pxPerBeat);
        const firstTick = Math.ceil(view.p0);
        const lastTick = Math.floor(view.p0 + pSpan);

        if (divs >= 1) {
            ctx.lineWidth = 1;
            ctx.strokeStyle = COL_BEAT;
            ctx.beginPath();
            for (let p = firstTick; p <= lastTick; p++) {
                const x = Math.round(padX + (p - view.p0) * pxPerBeat) + 0.5;
                ctx.moveTo(x, staffTop - 3 * k);
                ctx.lineTo(x, staffBottom + 3 * k);
            }
            ctx.stroke();
        }

        // The subdivisions run the height of the staff, like the beats.
        // A ruler under the bottom string was the first try and it reads
        // badly: the note you are placing sits up on the strings, so judging
        // it against a mark at the foot of the staff means measuring across
        // the whole thing. A line that passes beside the note needs no
        // measuring at all — the eye just sees whether it sits on one.
        //
        // Which means they have to be quiet enough not to be read as anything.
        // Two weights, so the half of a beat is findable and the quarter is
        // only there to be landed on: bar, beat, half, quarter, each fainter
        // than the last.
        if (divs >= 2) {
            for (const pass of [{ every: 2, ink: COL_HALF }, { every: 1, ink: COL_QUARTER }]) {
                if (divs < pass.every * 2 && pass.every === 2) continue;
                ctx.lineWidth = 1;
                ctx.strokeStyle = pass.ink;
                ctx.beginPath();
                for (let p = firstTick - 1; p <= lastTick; p++) {
                    for (let i = 1; i < divs; i++) {
                        const isHalf = (i * 2) % divs === 0;
                        if (pass.every === 2 ? !isHalf : isHalf) continue;
                        const at = p + i / divs;
                        if (at <= view.p0 || at >= view.p0 + pSpan) continue;
                        const x = Math.round(padX + (at - view.p0) * pxPerBeat) + 0.5;
                        ctx.moveTo(x, staffTop - 1 * k);
                        ctx.lineTo(x, staffBottom + 1 * k);
                    }
                }
                ctx.stroke();
            }
        }

        // ── The loop ─────────────────────────────────────────────────
        // Under the bar lines and under the notes: it is the ground the
        // passage stands on, not something else written on the staff.
        const loop = currentLoop();
        if (loop) {
            const lx0 = xAt(loop.a);
            const lx1 = xAt(loop.b);
            const x0 = Math.max(clipLeft, lx0);
            const x1 = Math.min(w, lx1);
            if (x1 > x0) {
                ctx.fillStyle = COL_LOOP_FILL;
                ctx.fillRect(x0, staffTop - 6 * k, x1 - x0,
                    (staffBottom - staffTop) + 12 * k);
                // Repeat signs, not just uprights. A tinted band is easy to
                // miss against a dark staff and says nothing about which way
                // the music goes; the sign every musician already reads — a
                // heavy bar, a thin one, and two dots facing the music that
                // repeats — says both at a glance and needs no legend.
                //
                // Only the end that is actually on this staff gets one: a loop
                // running past the edge should look like it continues, not
                // like it turns there.
                const top = staffTop - 6 * k;
                const bot = staffBottom + 6 * k;
                const dotR = Math.max(1.4, 1.9 * k);
                const dotY = [staffTop + (staffBottom - staffTop) * 0.34,
                              staffTop + (staffBottom - staffTop) * 0.66];
                const repeat = (x, facing) => {
                    if (x < clipLeft - 6 * k || x > w + 6 * k) return;
                    const heavy = Math.max(2, 3 * k);
                    ctx.fillStyle = COL_LOOP;
                    ctx.fillRect(Math.round(x - (facing > 0 ? 0 : heavy)), top, heavy, bot - top);
                    ctx.strokeStyle = COL_LOOP;
                    ctx.lineWidth = Math.max(1, 1.2 * k);
                    ctx.beginPath();
                    const thin = Math.round(x + facing * (heavy + 3 * k)) + 0.5;
                    ctx.moveTo(thin, top);
                    ctx.lineTo(thin, bot);
                    ctx.stroke();
                    ctx.beginPath();
                    for (const y of dotY) {
                        ctx.moveTo(x + facing * (heavy + 9 * k) + dotR, y);
                        ctx.arc(x + facing * (heavy + 9 * k), y, dotR, 0, Math.PI * 2);
                    }
                    ctx.fill();
                };
                repeat(lx0, 1);
                repeat(lx1, -1);
            }
        }

        ctx.lineWidth = Math.max(1, 1.1 * k);
        ctx.strokeStyle = COL_BAR;
        ctx.beginPath();
        for (const bar of bars) {
            const x = Math.round(xAt(bar.t)) + 0.5;
            ctx.moveTo(x, laneBar - 6 * k);
            ctx.lineTo(x, staffBottom + 13 * k);
        }
        ctx.stroke();

        if (S.showBars) {
            // The number rides the bar line rather than floating over it, so it
            // reads as a label on that line and not as another note.
            ctx.font = '700 ' + Math.round(9 * k) + 'px ' + kitFont('text');
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (const bar of bars) {
                const x = Math.round(xAt(bar.t)) + 0.5;
                // The number of the bar that opens the next staff belongs to
                // that staff, not to the end of this one.
                if (bounded && bar.t > endT) continue;
                const label = String(bar.measure);
                const tw = ctx.measureText(label).width;
                const bx = x + 3 * k;
                if (!laneFree('bar', bx - 2 * k, bx + tw + 2 * k)) continue;
                ctx.fillStyle = 'rgba(9,13,22,0.9)';
                ctx.fillRect(bx - 1.5 * k, laneBar - 6 * k, tw + 3 * k, 12 * k);
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.fillText(label, bx, laneBar);
            }
        }

        // The tempo rides the bar-number lane at its right end. The very top of
        // the player belongs to the host on both sides — the song title on one,
        // the "Up Next" pill on the other — so a mark placed up there ends up
        // under something else. Down here it sits on the staff's own furniture,
        // and it books its place in the lane like any other label.
        if (S.showTempo && isLive && chart.bpm > 0) {
            ctx.font = '700 ' + Math.round(9 * k) + 'px ' + kitFont('text');
            ctx.textBaseline = 'middle';
            const mark = '♩ ' + Math.round(chart.bpm);
            const mw = ctx.measureText(mark).width;
            if (laneFree('bar', w - padX - mw - 3 * k, w - padX + 2 * k)) {
                ctx.textAlign = 'right';
                ctx.fillStyle = 'rgba(255,255,255,0.42)';
                ctx.fillText(mark, w - padX, laneBar);
            }
        }

        if (wantSect) {
            /*
             * The section name is an EYEBROW — the same step a rack's label
             * wears in the panel (`t-rack`: 900, 10px, .16em, dim). It names
             * the region rather than saying anything about now, so it reads as
             * a legend and not as content. `letterSpacing` on a 2D context is
             * Chromium-only and degrades to zero tracking elsewhere, which is
             * the right way round for a progressive detail.
             */
            ctx.font = '900 ' + Math.round(10 * k) + 'px ' + kitFont('text');
            ctx.letterSpacing = Math.round(1.6 * k) + 'px';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (const sec of chart.sections) {
                const t = (sec && typeof sec.time === 'number') ? sec.time : null;
                if (t == null || t < from || t > to) continue;
                const label = String(sec.name || '').toUpperCase();
                if (!label) continue;
                const x = xAt(t) + 4 * k;
                const tw = ctx.measureText(label).width;
                if (!laneFree('sect', x - 2 * k, x + tw + 2 * k)) continue;
                ctx.fillStyle = 'rgba(9,13,22,0.85)';
                ctx.fillRect(x - 2 * k, laneSect - 6 * k, tw + 4 * k, 12 * k);
                ctx.fillStyle = 'rgba(255,255,255,0.38)';
                ctx.fillText(label, x, laneSect);
            }
        }

        // ── Strings ──────────────────────────────────────────────────
        // Thicker towards the bass, the way a real set of strings looks and the
        // way tab is engraved: it tells you which line you are on peripherally,
        // without counting from the edge.
        for (let l = 0; l < lines; l++) {
            const y = Math.round(yLine(l)) + 0.5;
            const heavy = 1 - (rowFor(l, lines, S.highStringOnTop) / Math.max(1, lines - 1));
            ctx.strokeStyle = lineOf(l);
            ctx.lineWidth = Math.max(1, (0.9 + heavy * 1.5) * k);
            ctx.globalAlpha = S.stringAlpha;
            ctx.beginPath();
            ctx.moveTo(padX, y);
            ctx.lineTo(w - padX, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // ── The now band ─────────────────────────────────────────────
        // Soft, rather than a hairline: at speed a 1px rule is hard to hold on
        // to, and the band reads as the moment rather than as a divider.
        if (isLive) {
            const halo = ctx.createLinearGradient(playX - 16 * k, 0, playX + 16 * k, 0);
            halo.addColorStop(0, 'rgba(255,255,255,0)');
            halo.addColorStop(0.5, 'rgba(255,255,255,0.10)');
            halo.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = halo;
            ctx.fillRect(playX - 16 * k, band.top, 32 * k, band.height);
        }

        // A slide's arrival is drawn as a ghost head — but only when the chart
        // has nothing there. When the next note IS the arrival, two circles
        // land on the same spot and the passage reads as a mistake.
        //
        // Against a sorted index per string rather than a scan of the whole
        // chart: the scan cost one pass over every note in the song for every
        // sustain on screen, which is quadratic in the density of the chart —
        // measured at 1.65 ms per frame across three staves on a middling song,
        // and four times the notes would have cost sixteen times that.
        const noteAt = (stringIdx, time) => {
            const arr = chart.byString[stringIdx];
            if (!arr || !arr.length) return false;
            let lo = 0;
            let hi = arr.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (arr[mid] < time) lo = mid + 1; else hi = mid;
            }
            if (Math.abs(arr[lo] - time) < 0.09) return true;
            return lo > 0 && Math.abs(arr[lo - 1] - time) < 0.09;
        };

        // ── Sustains, slides and bends ───────────────────────────────
        // Drawn first so the note heads sit on top of their own tails.
        ctx.lineCap = 'round';
        for (const it of visible.concat(sounding)) {
            const s = it.n.s | 0;
            if (s < 0 || s >= count) continue;
            const sus = (typeof it.n.sus === 'number') ? it.n.sus : 0;
            if (sus <= 0.02) continue;
            const y = yAt(s);
            const x0 = xAt(it.t);
            const x1 = xAt(it.t + sus);
            const col = noteOf(s);
            const target = slideTarget(it.n);

            if (target != null) {
                // A slide is a band that leaves the played fret and arrives at
                // the target, so the eye follows the movement rather than
                // reading two unrelated numbers. Unpitched slides get the same
                // band dashed, since the destination is a gesture, not a pitch.
                const rise = 5 * k;
                const up = target > (it.n.f || 0);
                ctx.save();
                if (it.n.slu != null && it.n.slu >= 0 && (it.n.sl == null || it.n.sl < 0)) {
                    ctx.setLineDash([4 * k, 3 * k]);
                }
                const grad = ctx.createLinearGradient(x0, y, x1, y);
                grad.addColorStop(0, col);
                /* Fading to nothing rather than to a white ghost: the band
                   belongs to the string it leaves, all the way along. */
                grad.addColorStop(1, kitInk('dim', 0.15));
                ctx.strokeStyle = grad;
                ctx.lineWidth = Math.max(2.5, 3.4 * k);
                ctx.globalAlpha = 0.75;
                ctx.beginPath();
                ctx.moveTo(x0, y);
                ctx.lineTo(x1, y + (up ? -rise : rise));
                ctx.stroke();
                ctx.restore();

                // Hollow head at the arrival fret: it is reached, not picked.
                if (!noteAt(s, it.t + sus)) {
                    const r = headR * 0.83;
                    ctx.beginPath();
                    ctx.arc(x1, y + (up ? -rise : rise), r, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(6,9,15,0.9)';
                    ctx.fill();
                    ctx.strokeStyle = col;
                    ctx.lineWidth = Math.max(1, 1.2 * k);
                    ctx.globalAlpha = 0.8;
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                    ctx.font = '600 ' + Math.round(fs * 0.85)
                        + 'px "JetBrains Mono", ui-monospace, monospace';
                    ctx.fillStyle = col;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    const arrival = (S.noteLabel === 'name')
                        ? nameOf(s, target) : String(target);
                    ctx.fillText(arrival, x1, y + (up ? -rise : rise) + 0.5);
                }
            } else {
                ctx.strokeStyle = col;
                ctx.globalAlpha = 0.5;
                ctx.lineWidth = Math.max(2.5, (it.n.vb ? 4 : 3.2) * k);
                ctx.beginPath();
                ctx.moveTo(x0, y);
                if (it.n.vb) {
                    // Vibrato rides the tail as a wave, the way tab writes it.
                    const amp = 1.6 * k;
                    const step = 10 * k;
                    let sign = 1;
                    for (let x = x0; x < x1; x += step) {
                        ctx.lineTo(Math.min(x + step, x1), y + sign * amp);
                        sign = -sign;
                    }
                } else {
                    ctx.lineTo(x1, y);
                }
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            if (it.n.bn) {
                /*
                 * A BEND IS A MOVEMENT, so it gets drawn as one: an arc rising
                 * out of the head, an arrowhead where it arrives, and the
                 * distance written at the top.
                 *
                 * It used to be the text alone — `full` floating above the
                 * string, which says how far without saying that anything
                 * moves. A tab's whole job is to make time and pitch visible,
                 * and a bend is the one articulation that is pure pitch.
                 *
                 * In the STRING's colour, not white: it belongs to the note it
                 * leaves, and every other thing that belongs to a note here
                 * takes that colour.
                 */
                const semis = it.n.bn;
                const txt = (semis >= 2) ? 'full' : (semis >= 1 ? '½' : '¼');
                const rise = Math.min(gap * 0.8, (10 + 4 * Math.min(2, semis)) * k);
                const bx = x0 + Math.max(6 * k, r * 0.8);
                const topY = y - rise;

                ctx.save();
                ctx.strokeStyle = col;
                ctx.lineWidth = Math.max(1.5, 2 * k);
                ctx.beginPath();
                ctx.moveTo(bx, y - r * 0.4);
                ctx.quadraticCurveTo(bx + 5 * k, topY, bx + 11 * k, topY);
                ctx.stroke();

                /* The arrowhead, drawn rather than typed — a `^` is whatever
                   the font has and sits on the text baseline, not on the arc. */
                const ax = bx + 11 * k;
                const ah = 3.2 * k;
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.moveTo(ax + ah, topY);
                ctx.lineTo(ax - ah * 0.6, topY - ah);
                ctx.lineTo(ax - ah * 0.6, topY + ah);
                ctx.closePath();
                ctx.fill();

                ctx.font = '700 ' + Math.round(fs * 0.74) + 'px ' + kitFont('num');
                ctx.fillStyle = col;
                fillInkCentred(ctx, txt, ax + ah + 3 * k, topY, 'left');
                ctx.restore();
            }
        }

        // ── Note heads ───────────────────────────────────────────────
        const ordered = visible.slice().sort((a, b) => a.t - b.t);
        const prevOnString = new Array(count).fill(null);

        // Distance to the next note on the same string, so a label printed
        // beside a head can be dropped when there is no room for it rather
        // than colliding with what comes next.
        const roomAfter = new Array(ordered.length).fill(Infinity);
        const nextIdx = new Array(ordered.length).fill(-1);
        const lastIdx = new Array(count).fill(-1);
        for (let i = 0; i < ordered.length; i++) {
            const si = ordered[i].n.s | 0;
            if (si < 0 || si >= count) continue;
            if (lastIdx[si] >= 0) {
                roomAfter[lastIdx[si]] = xAt(ordered[i].t) - xAt(ordered[lastIdx[si]].t);
                nextIdx[lastIdx[si]] = i;
            }
            lastIdx[si] = i;
        }

        // ── Ties ─────────────────────────────────────────────────────
        // A linked note is held, not struck again, and a tab that prints it
        // like any other note is telling you to pick it. So the arrival is
        // parenthesised, the way tab writes a note that is only still ringing,
        // and an arc joins the two. Slides are skipped: their band already
        // says the note travels, and a second mark over it is noise.
        const tiedIn = new Array(ordered.length).fill(false);
        for (let i = 0; i < ordered.length; i++) {
            const n = ordered[i].n;
            if (!n.ln || slideTarget(n) != null) continue;
            const j = nextIdx[i];
            if (j >= 0) tiedIn[j] = true;
        }

        for (let oi = 0; oi < ordered.length; oi++) {
            const it = ordered[oi];
            const s = it.n.s | 0;
            if (s < 0 || s >= count) continue;
            const x = xAt(it.t);
            const y = yAt(s);
            // Same for the heads: a half circle at the margin looks broken,
            // and the note is on its way out of the window anyway. Its tail
            // still runs to the edge, so nothing is lost that matters.
            if (x < clipLeft + headR) continue;

            let verdict = null;
            if (provider) {
                try { verdict = verdictOf(provider(it.n, it.t)); } catch (_) { verdict = null; }
            }
            const isNow = isLive && Math.abs(it.t - now) <= NOW_WINDOW;
            const base = noteOf(s);
            const ghost = !!it.n.ig;          // rendered but not scored
            let ink = base;
            let ring = base;
            if (verdict === 'hit') { ink = COL_HIT(); ring = COL_HIT(); }
            else if (verdict === 'miss') { ink = COL_MISS(); ring = COL_MISS(); }

            ctx.save();
            if (ghost) ctx.globalAlpha = 0.42;
            else if (!verdict && isLive && it.t < now - NOW_WINDOW) ctx.globalAlpha = 0.3;

            const r = isNow ? Math.min(headR * 1.16, gap * 0.5) : headR;

            // Harmonics wear a diamond outside the head — natural and pinch
            // share the shape, pinch is the filled one.
            if (S.showTech && (it.n.hm || it.n.hp)) {
                const d = r + 3.5 * k;
                ctx.beginPath();
                ctx.moveTo(x, y - d);
                ctx.lineTo(x + d, y);
                ctx.lineTo(x, y + d);
                ctx.lineTo(x - d, y);
                ctx.closePath();
                ctx.strokeStyle = 'rgba(255,255,255,0.65)';
                ctx.lineWidth = Math.max(1, 1.1 * k);
                if (it.n.hp) {
                    ctx.fillStyle = 'rgba(255,255,255,0.12)';
                    ctx.fill();
                }
                ctx.stroke();
            }

            // Which of the two goes in the head, and which beside it. The
            // head is the legible slot; the setting decides what belongs there.
            const fretText = String(it.n.f != null ? it.n.f : '');
            const name = (S.noteLabel === 'fret') ? '' : nameOf(s, it.n.f);
            let label = fretText;
            let aside = '';
            if (it.n.mt) {
                label = '×';
            } else if (S.noteLabel === 'name') {
                label = name || fretText;
            } else if (S.noteLabel === 'both') {
                aside = name;
            } else if (S.noteLabel === 'nameFret' && name) {
                label = name;
                aside = fretText;
            }
            // A held note is written in brackets: it is sounding, not played.
            if (tiedIn[oi] && !it.n.mt) label = '(' + label + ')';
            ctx.font = '700 ' + Math.round(fs) + 'px ' + kitFont('num');

            // A circle sized for one digit crowds two. The head grows sideways
            // into a capsule instead, so 14 and 16 keep the same breathing room
            // inside as 5 — and the row of heads still reads as one line.
            const tw = ctx.measureText(label).width;
            const rx = Math.max(r, tw / 2 + 4.6 * k * fit);
            ctx.beginPath();
            if (rx <= r + 0.5) {
                ctx.arc(x, y, r, 0, Math.PI * 2);
            } else {
                ctx.moveTo(x - rx + r, y - r);
                ctx.arcTo(x + rx, y - r, x + rx, y + r, r);
                ctx.arcTo(x + rx, y + r, x - rx, y + r, r);
                ctx.arcTo(x - rx, y + r, x - rx, y - r, r);
                ctx.arcTo(x - rx, y - r, x + rx, y - r, r);
                ctx.closePath();
            }

            // A filled head reads like the board's gem — the fastest thing to
            // spot at speed; a dark head puts the digit forward, which reads
            // better slowly. Either way the verdict owns the outline.
            const solid = (S.noteFill === 'solid') && !ghost;
            ctx.fillStyle = solid ? ring : (ghost ? 'rgba(6,9,15,0.6)' : '#070b12');
            ctx.fill();
            ctx.lineWidth = Math.max(1.1, (isNow ? 2 : 1.4) * k);
            ctx.strokeStyle = ring;
            if (ghost) ctx.setLineDash([3 * k, 2.5 * k]);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = solid ? '#08101c' : ink;
            fillInkCentred(ctx, label, x, y);

            // The second label, beside the head. Sideways is the only
            // direction with room: at six strings the heads already almost
            // touch vertically. It gets a dark chip of its own, because bare
            // text there competes with the string line it sits on and with any
            // sustain running underneath — which is what made it hard to
            // read. It gives way silently when the next note is too close.
            if (aside) {
                ctx.font = '700 ' + Math.round(fs * 0.74)
                    + 'px ' + kitFont('text');
                const aw = ctx.measureText(aside).width;
                if (roomAfter[oi] > rx + aw + 12 * k) {
                    const ax = x + rx + 3 * k;
                    ctx.fillStyle = 'rgba(6,9,15,0.88)';
                    ctx.fillRect(ax - 1.5 * k, y - 6.5 * k, aw + 3 * k, 13 * k);
                    ctx.fillStyle = 'rgba(255,255,255,0.82)';
                    fillInkCentred(ctx, aside, ax, y, 'left');
                }
            }
            ctx.restore();

            // Hammer-on / pull-off: an arc between the two notes it joins,
            // which is what the technique actually is — a link, not a label.
            const prev = prevOnString[s];
            if (S.showTech && (it.n.ho || it.n.po) && prev != null && fit > 0.55) {
                const span = x - prev;
                /*
                 * THE LETTER GOES WITH THE ARC, or neither goes.
                 *
                 * They had separate guards — the arc needed `span < 90 * k`
                 * and the letter only `fit > 0.8` — so at wide spacing the arc
                 * was refused and an `H` was left floating between two notes
                 * with nothing joining them. A letter alone says a technique
                 * happened somewhere near here, which is the one thing a tab
                 * must not say.
                 *
                 * Found by the showcase pack the moment there was a chart with
                 * a hammer-on in it, which is the whole reason that pack
                 * exists.
                 */
                if (span > 3 && span < 90 * k) {
                    ctx.save();
                    /*
                     * `dim`, not white. A slur is a HINT about how two notes
                     * join, not content — and `dim` is this system's role for
                     * exactly that, so the mark follows a theme instead of
                     * being one fixed white among six string colours.
                     */
                    ctx.strokeStyle = kitInk('dim');
                    ctx.lineWidth = Math.max(1.5, 2 * k);
                    ctx.beginPath();
                    const lift = it.n.ho ? -(r + 6 * k) : (r + 6 * k);
                    ctx.moveTo(prev + r * 0.5, y + lift * 0.35);
                    ctx.quadraticCurveTo((prev + x) / 2, y + lift, x - r * 0.5, y + lift * 0.35);
                    ctx.stroke();
                    /* Inside the arc's guard now, so the two cannot disagree. */
                    if (fit > 0.8) {
                        /* Mono, like every other single character on the
                           staff: an H beside a fret number in a different face
                           reads as two different kinds of writing. */
                        ctx.font = '700 ' + Math.round(9 * k) + 'px ' + kitFont('num');
                        ctx.fillStyle = kitInk('dim');
                        fillInkCentred(ctx, it.n.ho ? 'H' : 'P', (prev + x) / 2, y + lift * 1.25);
                    }
                    ctx.restore();
                }
            }
            prevOnString[s] = x;

            // The tie itself: flatter and quieter than a hammer-on's arc, and
            // wearing no letter, which is what tells the two apart.
            if (it.n.ln && slideTarget(it.n) == null && nextIdx[oi] >= 0) {
                const x2 = xAt(ordered[nextIdx[oi]].t);
                if (x2 > x + 2 && x2 - x < 220 * k) {
                    ctx.save();
                    /* Quieter than a slur's arc and in the same role, which
                       is what tells the two apart without a letter. */
                    ctx.strokeStyle = kitInk('dim', 0.6);
                    ctx.lineWidth = Math.max(1, 1.2 * k);
                    ctx.beginPath();
                    const lift = -(r + 4 * k);
                    ctx.moveTo(x + r * 0.6, y + lift * 0.3);
                    ctx.quadraticCurveTo((x + x2) / 2, y + lift, x2 - r * 0.6, y + lift * 0.3);
                    ctx.stroke();
                    ctx.restore();
                }
            }

            // Marks that sit over the head share one row, so a tapped accented
            // note does not print two glyphs in the same spot.
            if (S.showTech && fit > 0.72) {
                const above = [];
                if (it.n.tp) above.push('T');
                if (it.n.ac) above.push('>');
                if (it.n.fhm) above.push('\u2715');
                if (above.length) {
                    ctx.font = '700 ' + Math.round(9 * k) + 'px ' + kitFont('num');
                    ctx.fillStyle = kitInk('dim');
                    fillInkCentred(ctx, above.join(' '), x, y - r - 6 * k);
                }
            }
        }

        // ── Palm mute ────────────────────────────────────────────────
        // Written the way tab writes it: one P.M. and a dashed span over the
        // passage. A label under every note buried the staff in repetition.
        if (S.showPM) {
            const runs = [];
            let run = null;
            for (const it of ordered) {
                if (!it.n.pm) { run = null; continue; }
                const x = xAt(it.t);
                if (run && x - run.x1 < 60 * k) {
                    run.x1 = x;
                } else {
                    run = { x0: x, x1: x };
                    runs.push(run);
                }
            }
            const py = staffBottom + headR + 7 * k;
            ctx.font = '700 ' + Math.round(8.5 * k) + 'px ' + kitFont('text');
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (const r of runs) {
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.fillText('P.M.', r.x0 - 4 * k, py);
                const lead = ctx.measureText('P.M.').width + 2 * k;
                if (r.x1 > r.x0 + lead) {
                    ctx.save();
                    ctx.setLineDash([4 * k, 3 * k]);
                    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(r.x0 - 4 * k + lead, py);
                    ctx.lineTo(r.x1 + 4 * k, py);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }

        // ── Lyrics ───────────────────────────────────────────────────
        // Under the note the syllable falls on. The app already shows the line
        // you are on across the top; the value here is the alignment.
        if (S.showLyrics && chart.lyrics.length) {
            const ly = staffBottom + headR + 7 * k + (S.showPM ? 15 * k : 0);
            ctx.font = '600 ' + Math.round(9.5 * k) + 'px ' + kitFont('text');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const ev of chart.lyrics) {
                const t = (ev && typeof ev.t === 'number') ? ev.t : null;
                if (t == null || t < from || t > to) continue;
                const word = syllable(ev.w);
                if (!word) continue;
                const lx = xAt(t);
                const half = ctx.measureText(word).width / 2;
                if (!laneFree('lyric', lx - half, lx + half)) continue;
                ctx.fillStyle = (isLive && t <= now)
                    ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.42)';
                ctx.fillText(word, lx, ly);
            }
        }

        if (wantChord) {
            ctx.font = '700 ' + Math.round(11 * k) + 'px ' + kitFont('text');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // Only where the chord actually changes. A label over every strum
            // of the same shape is a row of noise, not information.
            let lastName = null;
            for (const c of chart.chords) {
                if (!c || c.id == null) continue;
                const tpl = templates[c.id];
                const nm = tpl && (tpl.displayName || tpl.name);
                if (!nm) continue;
                const changed = nm !== lastName;
                lastName = nm;
                if (!changed || c.t < from || c.t > to) continue;
                const cx = xAt(c.t);
                const half = ctx.measureText(String(nm)).width / 2;
                if (!laneFree('chord', cx - half, cx + half)) continue;
                ctx.fillStyle = 'rgba(255,214,120,0.85)';
                ctx.fillText(String(nm), cx, laneChord);
            }
        }

        if (isLive) {
            /*
             * A LOOK-AHEAD WASH, then the cursor.
             *
             * The wash says what the `Beats ahead` slider MEANS: the notes it
             * covers are the ones you are about to play, and the ones past it
             * are context. That was a number in a panel and nothing on the
             * staff, so the setting had no visible consequence at all.
             *
             * Drawn under the cursor and over the strings, in the accent at a
             * tenth — enough to read as a region, not enough to compete with
             * anything written in it.
             */
            /*
             * In BEATS, because that is what this layout is made of.
             *
             * The first version divided the setting by a `beatsPerSec` that
             * does not exist anywhere in this file — a name I assumed. It threw
             * a ReferenceError on every frame and the draw is inside a
             * try/catch, so it failed in silence and took the rest of the frame
             * with it: no cursor stroke, and in page turns none of the staves
             * after this one. Two reports, one invented identifier.
             *
             * `pxPerBeat` and `paceFactor` are both right here, and x is a
             * function of the beat position, so no time conversion is needed at
             * all — which is why the wrong version was also the long way round.
             */
            const aheadX = playX + (S.aheadBeats || 0) * paceFactor(map) * pxPerBeat;
            if (aheadX > playX + 2) {
                const wash = ctx.createLinearGradient(playX, 0, aheadX, 0);
                wash.addColorStop(0, kitInk('accent', 0.12));
                wash.addColorStop(1, kitInk('accent', 0));
                ctx.fillStyle = wash;
                ctx.fillRect(playX, band.top + 2 * k, aheadX - playX, band.height - 4 * k);
            }

            /*
             * THE CURSOR: three pixels and an alone, because it is the one
             * thing on the staff that means "now". A 1.4px white hairline was
             * one more bright vertical among the bar lines.
             */
            ctx.save();
            ctx.strokeStyle = COL_PLAYHEAD();
            ctx.lineWidth = Math.max(2, 3 * k);
            ctx.shadowColor = kitInk('accent', 0.7);
            ctx.shadowBlur = 14 * k;
            ctx.beginPath();
            ctx.moveTo(Math.round(playX) + 0.5, band.top + 4 * k);
            ctx.lineTo(Math.round(playX) + 0.5, band.top + band.height - 3 * k);
            ctx.stroke();
            ctx.restore();
        }

        ctx.restore();

        // ── String names ─────────────────────────────────────────────
        // Outside the clip, and last: they own the margin, nothing may paint
        // over them and they may not paint over the staff.
        if (S.showStrings) {
            ctx.font = '700 ' + Math.round(8.5 * k) + 'px ' + kitFont('text');
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            for (let l = 0; l < lines; l++) {
                const nm = lineName(l);
                if (!nm) continue;
                ctx.fillStyle = (S.lineInk === 'mono')
                    ? 'rgba(255,255,255,0.45)' : (colors[l] || '#888');
                ctx.globalAlpha = 0.75;
                ctx.fillText(nm, gutter, yLine(l));
                ctx.globalAlpha = 1;
            }
        }
    }

    /** Paints the tab into the current `ctx` for a w×h box. */
    function paintTab(w, h) {
        ctx.clearRect(0, 0, w, h);
        // With no board behind us the backdrop must be solid, otherwise the
        // host canvas ghosts through the translucency.
        const backdropAlpha = (activeBoard() === 'none' || boardIsBlank)
            ? 1 : S.panelOpacity;
        ctx.fillStyle = 'rgba(6,9,15,' + backdropAlpha.toFixed(2) + ')';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0.5);
        ctx.lineTo(w, 0.5);
        ctx.stroke();

        const host = hw();
        if (!host) return;
        const notes = call(host, 'getFilteredNotes', null) || call(host, 'getNotes', []) || [];
        const chords = call(host, 'getFilteredChords', null) || call(host, 'getChords', []) || [];
        if (!notes.length && !chords.length) return;

        const templates = call(host, 'getChordTemplates', []) || [];
        // Up to eight: the app reports the arrangement's own string count and
        // tells plugins to size against it rather than assuming six. Clamping
        // to six dropped the bottom string of a seven-string chart without
        // saying so, and put its notes on the wrong line.
        const count = Math.max(4, Math.min(8, call(host, 'getStringCount', 6) || 6));
        const hostColors = S.useHostColors ? call(host, 'getStringColors', null) : null;
        const now = call(host, 'getTime', 0) || 0;
        const beats = call(host, 'getBeats', []) || [];

        const items = [];
        for (const n of notes) if (n) items.push({ n: n, t: n.t });
        for (const c of chords) {
            if (!c) continue;
            for (const cn of chordNotes(c, templates)) items.push({ n: cn, t: c.t });
        }

        // Onset times per string, sorted, so "is there a note here?" is a
        // binary search instead of a walk through the whole song.
        const byString = [];
        for (let s = 0; s < count; s++) byString.push([]);
        for (const it of items) {
            const s = it.n.s | 0;
            if (s >= 0 && s < count) byString[s].push(it.t);
        }
        for (const arr of byString) arr.sort((a, b) => a - b);

        const rows = rowsUsed();
        const map = tempoMap(beats) || fallbackMap();

        // The chart says how many strings it uses; the player's instrument may
        // have more. Extra strings are always the low ones — a five-string bass
        // adds a B below E — so the chart's strings shift up by the difference.
        const tuning = songTuning();
        const mine = S.matchInstrument ? myInstrument() : { count: 0, bass: false };
        const shape = staffLines(count, mine.count, tuning.bass, mine.bass);
        const lines = shape.lines;
        const rowOffset = shape.rowOffset;

        const chart = {
            colors: (Array.isArray(hostColors) && hostColors.length >= lines)
                ? hostColors : paletteFor(lines, tuning.bass),
            count: count,
            lines: lines,
            rowOffset: rowOffset,
            tuning: tuning,
            templates: templates,
            chords: chords,
            items: items,
            byString: byString,
            now: now,
            beats: beats,
            map: map,
            sections: call(host, 'getSections', []) || [],
            lyrics: S.showLyrics ? (call(host, 'getLyrics', []) || []) : [],
            bpm: map.bpmAt(now),
            provider: call(host, 'getNoteStateProvider', null),
            k: Math.max(0.7, Math.min(2.2, h / (rows * 175))),
            w: w,
        };

        // A little air at the top: a staff's labels live above its strings, and
        // the topmost staff would otherwise push them under the song title.
        const topPad = Math.min(26, h * 0.06);
        const rowH = (h - topPad) / rows;

        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.clip();

        for (const view of stavesFor(map, now, rows)) {
            const band = { top: topPad + view.row * rowH, height: rowH };
            /*
             * ONE STAFF'S FAILURE MUST NOT TAKE THE PAGE.
             *
             * A throw inside `drawStaff` used to end this loop, so a fault on
             * the first staff left staves two and three blank — and something
             * upstream swallowed the exception, so the only evidence was a page
             * that had lost most of itself. That is how a single invented
             * identifier read as "we broke page view".
             *
             * Reported ONCE, not per frame: sixty identical lines a second is
             * how a console stops being read.
             */
            try {
                drawStaff(chart, band, view);
            } catch (err) {
                if (!drawFailed) {
                    drawFailed = true;
                    console.error('[' + ID + '] drawStaff threw — the rest of the page still drew:', err);
                }
            }
            if (view.veil > 0) {
                ctx.fillStyle = 'rgba(6,9,15,' + view.veil.toFixed(2) + ')';
                ctx.fillRect(0, band.top, w, band.height);
            }
        }

        // Staff separators belong to the frame, not to the content: they stay
        // put while a page turn slides underneath them.
        if (rows > 1) {
            ctx.strokeStyle = 'rgba(255,255,255,0.07)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 1; i < rows; i++) {
                ctx.moveTo(0, Math.round(topPad + i * rowH) + 0.5);
                ctx.lineTo(w, Math.round(topPad + i * rowH) + 0.5);
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    /** Paints into any 2D context — used by the visualization factory. */
    function renderInto(targetCtx, w, h) {
        const prev = ctx;
        ctx = targetCtx;
        try { paintTab(w, h); } finally { ctx = prev; }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 9. Composite visualization: the board on top, the tab below.
    //
    // As a visualization we own the player area, so we can hand the board
    // renderer a canvas covering only the upper slice — it mounts its own wrap
    // sized to whatever canvas it is given — and keep the lower slice for the
    // tab. Nothing overlaps, and the board is genuinely smaller rather than
    // cropped.
    //
    // The board is borrowed, not reimplemented: `borrowHostViz` lazy-loads
    // another visualization plugin and picks up its factory global, the same
    // way the Virtuoso plugin borrows the 3D highway. So `board` can point at
    // any standard visualization, which is what makes this an add-on to them
    // rather than a replacement for them.
    // ─────────────────────────────────────────────────────────────────────

    const NO_BOARD = { label: 'None (tab only)', path: null };

    // Seed with the two that are certain to exist; the real list is read from
    // the host at startup so any visualization plugin the user has installed
    // shows up here without this file knowing about it.
    // What the server thinks our manifest says. The `?v=` on our own script is
    // stamped when the server reads the manifest, so on a machine whose server
    // has been up since before an edit the two disagree — which is itself worth
    // knowing in a bug report.
    let manifestVersion = null;

    let BOARDS = {
        highway_3d: { label: '3D Highway', path: '/api/plugins/highway_3d/screen.js' },
        jumpingtab: { label: 'Jumping Tab', path: '/api/plugins/jumpingtab/screen.js' },
        none: NO_BOARD,
    };

    function boardEntry(id) {
        if (id === 'none') return NO_BOARD;
        return BOARDS[id] || { label: id, path: '/api/plugins/' + id + '/screen.js' };
    }

    /**
     * Ask the host which visualizations exist and offer them as boards.
     *
     * `/api/plugins` reports `type: 'visualization'` per plugin, which is
     * exactly the set that registers a borrowable factory global. The host's
     * own core surfaces (Classic 2D Highway, Venue) are deliberately absent
     * from it — they are not plugins and expose no factory, so they cannot be
     * hosted. Our own id is skipped for the obvious reason.
     */
    async function discoverBoards() {
        let list;
        try {
            const r = await fetch('/api/plugins', { cache: 'no-store' });
            if (!r.ok) return;
            list = await r.json();
        } catch (_) {
            return;                 // offline or older host: keep the seed list
        }
        if (!Array.isArray(list)) return;
        const found = {};
        for (const pl of list) {
            if (!pl) continue;
            if (pl.id === ID) { manifestVersion = pl.version || null; continue; }
            if (pl.type !== 'visualization') continue;
            if (pl.enabled === false || pl.has_script === false) continue;
            found[pl.id] = {
                label: pl.name || pl.id,
                path: '/api/plugins/' + pl.id + '/screen.js',
            };
        }
        if (!Object.keys(found).length) return;
        found.none = NO_BOARD;      // last in the menu
        BOARDS = found;
        try { rebuildBoardButtons(); } catch (_) {}
        notifyPanels();
    }

    /**
     * What a borrowed board needs to know about the song to judge itself.
     *
     * A visualization may declare `matchesArrangement(songInfo)` — Staff View
     * does, and answers false unless the pack ships engraving data. Honouring
     * it is what stops a board from being handed a song it can only render as
     * a black rectangle.
     */
    function songInfoForMatch() {
        const cs = (window.feedBack && window.feedBack.currentSong) || {};
        return {
            has_notation: !!cs.hasNotation,
            hasNotation: !!cs.hasNotation,
            has_drum_tab: !!cs.hasDrumTab,
            arrangement: cs.arrangement,
        };
    }

    function vizFactoryFor(vizId) {
        const a = 'feedBackViz_' + vizId;
        const b = 'slopsmithViz_' + vizId;
        return (typeof window[a] === 'function' && window[a])
            || (typeof window[b] === 'function' && window[b]) || null;
    }

    const loadedScripts = new Set();

    function loadScriptOnce(src) {
        if (loadedScripts.has(src)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src = src;
            el.async = true;
            el.onload = () => { loadedScripts.add(src); resolve(); };
            el.onerror = () => { el.remove(); reject(new Error('load failed: ' + src)); };
            document.head.appendChild(el);
        });
    }

    /** Another visualization's factory, loading its script if needed. */
    async function borrowHostViz(vizId, scriptPath) {
        let f = vizFactoryFor(vizId);
        if (f) return f;
        if (!scriptPath) return null;
        try { await loadScriptOnce(scriptPath); } catch (_) { return null; }
        // The global may register a tick or two after onload.
        const start = Date.now();
        while (!vizFactoryFor(vizId) && Date.now() - start < 3000) {
            await new Promise((r) => setTimeout(r, 50));
        }
        f = vizFactoryFor(vizId);
        if (!f) {
            console.warn('[' + ID + '] ' + scriptPath
                + ' loaded but registered no viz factory - contract drift?');
        }
        return f || null;
    }

    function createFactory() {
        let host = null;          // the canvas the player handed us
        let boardCanvas = null;   // upper slice, given to the borrowed renderer
        let tabCanvas = null;     // lower slice, ours
        let tabCtx = null;
        let board = null;         // borrowed renderer instance
        let boardId = null;
        let boardBlocked = false; // chosen board cannot render this song
        let attaching = false;
        let mounted = false;
        let onResize = null;
        let lastBundle = null;

        function slices() {
            if (!host) return null;
            const r = host.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return null;
            // The transport bar floats over the bottom of the player, so the
            // usable height stops above it — otherwise the palm-mute row and
            // the lowest strings end up behind the buttons.
            const reserved = transportHeight();
            const avail = Math.max(120, r.height - reserved);
            // "Show the tab" hands the whole player to the board — which
            // requires there to be a board. With none, switching it off would
            // leave an empty player, so the tab stays.
            const noBoard = (activeBoard() === 'none' || boardBlocked);
            const tabH = (!S.enabled && !noBoard) ? 0
                : noBoard
                    ? avail
                    : Math.max(90, Math.min(Math.round(avail * (S.heightPct / 100)),
                        avail - 120));
            return {
                w: r.width, h: r.height, boardH: avail - tabH, tabH: tabH, reserved: reserved,
            };
        }

        function place() {
            const sl = slices();
            if (!sl || !tabCanvas || !tabCtx) return null;
            if (boardCanvas) {
                // Squashing a 3D board into a short, full-width box changes its
                // aspect and the perspective reads as a wide funnel. Narrowing
                // the container instead keeps the board's own proportions, so
                // it looks like a smaller board rather than a distorted one.
                const bw = (S.boardAspect >= 1)
                    ? Math.min(sl.w, Math.round(sl.boardH * S.boardAspect))
                    : sl.w;
                boardCanvas.style.left = Math.round((sl.w - bw) / 2) + 'px';
                boardCanvas.style.right = 'auto';
                boardCanvas.style.width = bw + 'px';
                boardCanvas.style.height = Math.round(sl.boardH) + 'px';
                boardCanvas.width = Math.max(1, bw);
                boardCanvas.height = Math.max(1, Math.round(sl.boardH));
            }
            tabCanvas.style.top = Math.round(sl.boardH) + 'px';
            tabCanvas.style.height = Math.round(sl.tabH) + 'px';
            tabCanvas.style.display = (sl.tabH > 0) ? 'block' : 'none';
            if (sl.tabH <= 0) return sl;
            const dpr = window.devicePixelRatio || 1;
            const w = Math.max(1, Math.round(sl.w * dpr));
            const h = Math.max(1, Math.round(sl.tabH * dpr));
            if (tabCanvas.width !== w || tabCanvas.height !== h) {
                tabCanvas.width = w;
                tabCanvas.height = h;
            }
            tabCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            return sl;
        }

        function detachBoard() {
            if (board && typeof board.destroy === 'function') {
                try { board.destroy(); } catch (_) {}
            }
            board = null;
            boardId = null;
            boardBlocked = false;
            boardIsBlank = false;
        }

        async function attachBoard() {
            const want = activeBoard();
            if ((boardId === want && board) || attaching) return;
            attaching = true;
            try {
                detachBoard();
                if (want === 'none') { boardId = 'none'; return; }
                const factory = await borrowHostViz(want, boardEntry(want).path);
                if (!factory || !mounted) return;
                if (typeof factory.matchesArrangement === 'function') {
                    let fits = true;
                    try { fits = !!factory.matchesArrangement(songInfoForMatch()); }
                    catch (_) { fits = true; }
                    if (!fits) {
                        // Keep the choice — another song may suit it — but give
                        // the space to the tab instead of to a blank board.
                        console.info('[' + ID + '] ' + want
                            + ' does not support this arrangement; showing the tab alone');
                        boardId = want;
                        boardBlocked = true;
                        boardIsBlank = true;
                        place();
                        return;
                    }
                }
                board = factory();
                board.init(boardCanvas, lastBundle);
                boardId = want;
                boardIsBlank = false;
                const sl = place();
                if (sl && typeof board.resize === 'function') {
                    const r = boardCanvas.getBoundingClientRect();
                    board.resize(r.width || sl.w, r.height || sl.boardH);
                }
            } catch (err) {
                console.warn('[' + ID + '] borrowed board failed to mount', err);
                detachBoard();
            } finally {
                attaching = false;
            }
        }

        return {
            init(providedCanvas, bundle) {
                host = providedCanvas;
                lastBundle = bundle || null;
                if (!host || !host.parentNode) {
                    emitViz('renderer-failed', { reason: 'no canvas to mount on' });
                    return;
                }

                // The board renderer needs a canvas of its own to size against;
                // the host canvas may be a WebGL surface we must not claim.
                boardCanvas = document.createElement('canvas');
                boardCanvas.id = ID + '-board';
                boardCanvas.style.cssText = [
                    'position:absolute', 'left:0', 'top:0', 'right:0',
                    'display:block', 'pointer-events:none', 'z-index:1',
                ].join(';');
                host.insertAdjacentElement('afterend', boardCanvas);

                tabCanvas = document.createElement('canvas');
                tabCanvas.id = ID + '-tab';
                tabCanvas.style.cssText = [
                    'position:absolute', 'left:0', 'right:0', 'z-index:2',
                    'display:block', 'pointer-events:none',
                ].join(';');
                boardCanvas.insertAdjacentElement('afterend', tabCanvas);
                tabCtx = tabCanvas.getContext('2d');
                if (!tabCtx) {
                    boardCanvas.remove();
                    tabCanvas.remove();
                    boardCanvas = null;
                    tabCanvas = null;
                    emitViz('renderer-failed', { reason: 'no 2d context' });
                    return;
                }

                mounted = true;
                onResize = () => { place(); };
                window.addEventListener('resize', onResize);
                place();
                attachBoard();
                emitViz('renderer-ready', {});
            },
            draw(bundle) {
                if (!mounted || !tabCtx) return;
                lastBundle = bundle || lastBundle;
                const sl = place();
                if (!sl) return;
                if (board && typeof board.draw === 'function') {
                    try { board.draw(bundle); } catch (err) {
                        console.warn('[' + ID + '] board draw failed', err);
                    }
                }
                if (boardId !== activeBoard()) {
                    // The board setting changed (or its script has only just
                    // landed): swap the hosted renderer without a restart.
                    attachBoard();
                }
                if (sl.tabH <= 0) return;
                try {
                    renderInto(tabCtx, sl.w, sl.tabH);
                } catch (err) {
                    console.warn('[' + ID + '] tab draw failed', err);
                }
            },
            resize(w, h) {
                const sl = place();
                if (board && typeof board.resize === 'function') {
                    try { board.resize(sl ? sl.w : w, sl ? sl.boardH : h); } catch (_) {}
                }
            },
            destroy() {
                if (onResize) window.removeEventListener('resize', onResize);
                onResize = null;
                detachBoard();
                if (boardCanvas) boardCanvas.remove();
                if (tabCanvas) tabCanvas.remove();
                boardCanvas = null;
                tabCanvas = null;
                tabCtx = null;
                host = null;
                mounted = false;
            },
        };
    }

    /**
     * Whether Live Tab is the right view for this arrangement.
     *
     * The same contract we ask of the boards we host, honoured in our own
     * direction: a fretted staff says nothing about a drum part or a keyboard
     * one, and Auto should not land on it there. `stringCount` is the app's
     * canonical signal — its own comment tells plugins to size against it
     * rather than assume six.
     */
    function matchesArrangement(songInfo) {
        const info = songInfo || {};
        if (info.has_drum_tab || info.hasDrumTab) return false;
        const name = String(info.arrangement_smart_name || info.arrangementSmartName
            || info.arrangement || '');
        if (/drum|percussion|keys|piano|synth|vocal|lyric/i.test(name)) return false;
        const n = Number(info.stringCount || info.string_count);
        if (isFinite(n) && n > 0 && (n < 4 || n > 8)) return false;
        return true;
    }

    createFactory.matchesArrangement = matchesArrangement;
    window.slopsmithViz_livetab = createFactory;
    window.feedBackViz_livetab = createFactory;

    // ─────────────────────────────────────────────────────────────────────
    // 10. Settings panel, built from the schema.
    //
    // Generated rather than written out in HTML, for the reason schemas usually
    // win: an option added above appears here, correctly typed and clamped,
    // with nothing to keep in step. `settings.html` is a shell that hands us
    // its root element.
    //
    // Shape: presets first, because most people want a sensible whole rather
    // than fifteen decisions; then the few settings that change what you are
    // looking at; then everything else, folded away.
    // ─────────────────────────────────────────────────────────────────────

    const panels = new Set();

    function boardOptions() {
        return Object.keys(BOARDS).map((id) => [id, BOARDS[id].label]);
    }

    function fieldOptions(f) {
        return (f.key === 'board') ? boardOptions() : (f.options || []);
    }

    // The host owns the palette and lets a plugin read it: theme.get() returns
    // the semantic roles as "r g b" triplets, and theme:changed fires when
    // somebody equips a theme in the shop. A panel carrying its own hex values
    // is a panel that stops matching the app the moment that happens — the
    // regression docs/host-theme-contract.md was written about. In markup the
    // same roles are the fb-* utilities, which the host recolours for us.
    const ROLES = {
        bg: '15 23 42', card: '30 41 59', cardMuted: '11 18 32',
        border: '51 65 85', text: '248 250 252', textDim: '148 163 184',
        primary: '14 165 233', primaryHi: '56 189 248',
        'on-accent': '248 250 252',
    };

    let theme = Object.assign({}, ROLES);

    /** One theme role as a CSS colour, optionally at `alpha`. */
    function ink(role, alpha) {
        const rgb = theme[role] || ROLES[role] || ROLES.text;
        return (alpha === undefined)
            ? ('rgb(' + rgb + ')') : ('rgb(' + rgb + ' / ' + alpha + ')');
    }

    /**
     * What stays legible written on top of a fill.
     *
     * The host's palette has no such role: a theme declares its accent and
     * says nothing about what goes on it, so white-on-amber is a contrast
     * failure waiting to happen — the one host-theme-contract.md opens with.
     * Chosen from the fill's own luminance instead of assumed.
     */
    function inkOn(role) {
        const parts = String(theme[role] || ROLES[role] || '').split(/\s+/).map(Number);
        if (parts.length < 3 || parts.some((n) => !isFinite(n))) return ink('text');
        const lin = parts.map((v) => {
            const c = v / 255;
            return (c <= 0.04045) ? (c / 12.92) : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
        return (L > 0.35) ? ink('bg') : ink('text');
    }

    function readTheme() {
        const api = window.feedBack && window.feedBack.theme;
        if (!api || typeof api.get !== 'function') return;
        try {
            const got = api.get();
            if (got && got.tokens) theme = Object.assign({}, ROLES, got.tokens);
        } catch (_) { /* an older host: the defaults above are the same palette */ }
    }

    const CLS = {
        hint: 'block text-xs text-fb-textDim mt-0.5',
        label: 'text-fb-text',
        select: 'mt-1 w-full bg-fb-cardMuted border border-fb-border rounded '
            + 'px-2 py-1 text-fb-text focus:border-fb-primary',
        range: 'w-full',
        check: 'w-4 h-4 mt-0.5',
        chip: 'px-2.5 py-1 rounded-full border text-xs font-semibold',
        // accent-fb-primary exists as a utility but the host's theme CSS only
        // rewrites bg-/text-/border-, so it would keep its build-time blue
        // under every theme. Written from the token in sync() instead.
        chipOn: ' bg-fb-primary border-fb-primary',
        chipOff: ' bg-fb-cardMuted border-fb-border text-fb-textDim '
            + 'hover:bg-fb-card hover:text-fb-text',
    };

    /*
     * ── WHICH CONTROL A VALUE GETS ──────────────────────────────────────
     *
     * Read off the value's own shape, never chosen by hand. Kit DESIGN.md §24
     * carries the table and the arithmetic behind each threshold; the point of
     * doing it here is that whoever adds a schema field should not also have to
     * know where a row of chips stops working.
     */
    const STEPPER_MAX_STEPS = 8;

    /*
     * A schema label is a SENTENCE; a chip wants the name out of it.
     *
     * `'Scrolling — the tab slides under a fixed cursor'` is written to be read
     * once, in a hint or a tooltip, and it is the right thing to have written.
     * On a chip it is 46 characters where there is room for eight. The half
     * before the dash is the name, and the whole sentence stays as the title —
     * so nothing is lost, it just moves to where there is room for it.
     */
    function shortOption(label) {
        const text = String(label === null || label === undefined ? '' : label);
        const cut = text.split(/\s+—\s+|\s+-\s+/)[0];
        return cut.trim() || text;
    }


    function controlKind(f) {
        if (f.type === 'bool') return 'toggle';
        if (f.type === 'enum') {
            /*
             * A list the APP supplies is a select whatever its length: the
             * board list arrives at runtime and can grow when the reader
             * installs a view, so nobody gets to lay it out.
             */
            if (f.dynamic) return 'select';
            return (fieldOptions(f).length > c.SEG_MAX_INLINE) ? 'select' : 'segmented';
        }
        const span = (Number(f.max) - Number(f.min)) / (Number(f.step) || 1) + 1;
        return (span <= STEPPER_MAX_STEPS) ? 'stepper' : 'slider';
    }

    /**
     * What a numeric setting reads as, including the number the pace correction
     * turns it into.
     *
     * RESTORED: this was deleted along with the hand-built `controlSlider` that
     * used to sit beside it, and `readoutParts` below calls it — so the sync
     * threw a ReferenceError on the first slider it reached. Both panels looked
     * healthy because the throw only happens in SCROLLING mode: page turns hide
     * the ahead slider, so the line was never reached and every symptom was a
     * value quietly not arriving.
     *
     * A slider that reads 2 while four bars are on screen is a panel telling a
     * lie, and the first thing it costs is the belief that the slider does
     * anything at all. Where the pace correction is changing the number, both
     * are shown: what was asked for, and what is drawn.
     */
    function readout(key) {
        const map = tempoCache.map;
        if (key === 'pageBars') return String(S.pageBars);
        const asked = Math.round(S[key] * 100) / 100;
        if (key === 'aheadBeats' && S.readMode === 'scroll') {
            const now = Math.round(S.aheadBeats * paceFactor(map) * 10) / 10;
            if (now !== asked) return asked + ' → ' + now;
        }
        return String(asked);
    }

    /** The value, and its derived companion, as two things rather than one string. */
    function readoutParts(key) {
        const whole = readout(key);
        const i = whole.indexOf(' → ');
        if (i < 0) return { value: whole, aside: null };
        return { value: whole.slice(0, i), aside: '→ ' + whole.slice(i + 3) };
    }

    /**
     * What a rack says about itself in its header.
     *
     * A derived reading, so the reader can tell what the group is producing
     * without going through every control in it — kit DESIGN.md §5. Never an
     * input (§21): everything here is computed from the settings.
     */
    function groupAside(id) {
        if (id === 'basics') {
            if (!isScroll(S)) return 'TAB FULL SCREEN';
            if (S.board === 'none') return 'TAB ONLY';
            return 'TAB ' + Math.round(S.heightPct) + '% OF SCREEN';
        }
        if (id === 'reading') {
            return isPaged(S)
                ? (S.pageBars * S.rows) + ' BARS PER PAGE'
                : readoutParts('aheadBeats').value + ' BEATS AHEAD';
        }
        if (id === 'look') {
            const label = { fret: 'FRET', pitch: 'PITCH', both: 'FRET + PITCH', none: 'PLAIN' };
            return label[S.noteLabel] || null;
        }
        return null;
    }

    /*
     * ── THE SETTINGS SCREEN ─────────────────────────────────────────────
     *
     * Built from the kit, in the same language as the in-player panel. That is
     * a reversal of the position the kit itself held for eight releases — see
     * the note on `settings-mount.js` and DESIGN.md §24 — and the argument is
     * that the kit is an identity rather than a HUD style: two plugins whose
     * panels match and whose settings screens do not are two plugins that look
     * related in one place and unrelated everywhere else.
     *
     * The SCHEMA does not change. It already declares every option once, with
     * the `when` predicates the conditional fields need; what changed is what
     * draws them.
     */
    function mountSettings(root) {
        if (!root) return null;
        // The settings screen can be the first thing that runs — a cold visit
        // with no song ever opened — so the palette is read here too, not only
        // when the in-player panel mounts.
        watchTheme();
        root.textContent = '';
        root.className = 'fbk-sheet';

        // ── the head: what this is, and what it is looking at ────────────
        const head = c.el('div', 'fbk-sheet-head');
        const stack = c.el('div', 'fbk-head-stack');
        stack.appendChild(c.el('span', 'fbk-title', 'Tab view'));
        const sub = c.el('span', 'fbk-subtitle');
        stack.appendChild(sub);
        head.appendChild(c.el('span', 'fbk-rack-dot'));
        head.appendChild(stack);
        root.appendChild(head);

        const intro = c.el('p', 'fbk-note',
            'A tablature you can read while it moves, with any note board hosted '
            + 'above it. Hit and miss come from the same judgment the board uses, '
            + 'so a fret number turns green or red as the gem does — which needs '
            + 'note detection running with your instrument connected.');
        root.appendChild(intro);

        // ── PRESET: a pick of five, so it wraps, and it can be marked ────
        const presetRack = c.rack({ label: 'Preset' });
        root.appendChild(presetRack.el);

        const reset = c.button('fbk-btn fbk-btn-accent fbk-btn-small', 'Reset',
            'Put every value back to what this preset says', () => {
                const id = lastPresetId;
                if (id) api.applyPreset(id);
            });
        presetRack.header.appendChild(reset);

        const presets = c.segmented(
            PRESETS.map((x) => ({ value: x.id, label: x.label, title: x.hint })),
            (id) => { lastPresetId = id; api.applyPreset(id); },
            'Preset',
        );
        presetRack.body.appendChild(presets.el);
        const presetHint = c.el('p', 'fbk-note');
        presetRack.body.appendChild(presetHint);

        /*
         * The preset the reader last CHOSE, which is not the same as the one
         * whose values still hold. Changing one option under `Study` leaves no
         * preset matching, and the panel still has to be able to say which one
         * you have edited — and to put it back.
         */
        let lastPresetId = activePresetId();

        // ── one rack per group, every control from the schema ────────────
        const controls = [];
        const racks = [];

        for (const g of GROUPS) {
            const fields = SCHEMA.filter((f) => f.group === g.id);
            if (!fields.length) continue;
            const rack = c.rack({ label: g.label });
            root.appendChild(rack.el);
            racks.push({ g, rack, fields });

            for (const f of fields) {
                const kind = controlKind(f);
                const box = c.field({ label: f.label });
                let ctl = null;

                if (kind === 'toggle') {
                    ctl = c.toggle(f.label, f.hint || null, (on) => api.set({ [f.key]: on }));
                    /* The toggle carries the name itself, so the field does not
                       repeat it — one label per control, never two. */
                    box.setLabel('');
                } else if (kind === 'segmented') {
                    ctl = c.segmented(
                        fieldOptions(f).map(([v, label]) => ({ value: v, label: shortOption(label), title: label })),
                        (v) => api.set({ [f.key]: v }),
                        f.label,
                    );
                } else if (kind === 'select') {
                    ctl = c.select(
                        fieldOptions(f).map(([v, label]) => ({ value: v, label })),
                        (v) => api.set({ [f.key]: v }),
                        { ariaLabel: f.label, placeholder: 'Choose' },
                    );
                } else if (kind === 'stepper') {
                    ctl = c.stepper({
                        label: f.label,
                        value: S[f.key],
                        min: f.min, max: f.max, step: f.step || 1,
                        unit: f.unit || '',
                        onChange: (v) => api.set({ [f.key]: v }),
                    });
                    box.setLabel('');
                } else {
                    ctl = c.slider({
                        min: f.min, max: f.max, step: f.step || 1,
                        unit: f.unit || '',
                        ariaLabel: f.label,
                        onInput: (v) => api.set({ [f.key]: v }),
                    });
                }

                box.body.appendChild(ctl.el);
                rack.body.appendChild(box.el);
                if (f.hint && kind !== 'toggle') {
                    const hint = c.el('p', 'fbk-note', f.hint);
                    rack.body.appendChild(hint);
                    controls.push({ f, kind, ctl, box, hint });
                } else {
                    controls.push({ f, kind, ctl, box, hint: null });
                }
            }
        }

        // ── the foot: what happens to what you just changed ──────────────
        const foot = c.el('div', 'fbk-sheet-foot');
        const status = c.statusLine();
        foot.appendChild(status.el);

        // Reporting a rendering bug means saying what the chart looks like from
        // the inside, and nobody can be asked to open a developer console to do
        // it. One button, one paste.
        const copy = c.button('fbk-btn fbk-btn-small', 'Copy diagnostics',
            'Copies a snapshot of the plugin, the app and this chart, to paste '
            + 'into a bug report.', () => {
                const text = JSON.stringify(diagnostics(), null, 2);
                const done = (ok) => {
                    copy.textContent = ok ? 'Copied' : 'Press Ctrl+C';
                    setTimeout(() => { copy.textContent = 'Copy diagnostics'; }, 2500);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(() => done(true), () => fallback());
                } else {
                    fallback();
                }
                function fallback() {
                    // No clipboard permission: put it somewhere it can be copied
                    // by hand rather than losing it.
                    const box2 = document.createElement('textarea');
                    box2.value = text;
                    box2.style.cssText = 'position:fixed;left:-9999px;top:0';
                    document.body.appendChild(box2);
                    box2.select();
                    let ok = false;
                    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
                    box2.remove();
                    if (!ok) console.log('[' + ID + '] diagnostics', text);
                    done(ok);
                }
            });
        foot.appendChild(copy);
        root.appendChild(foot);

        const panel = {
            root: root,
            sync() {
                sub.textContent = 'Changes apply live · saved per song';

                // ── the preset row ───────────────────────────────────────
                const active = activePresetId();
                if (active) lastPresetId = active;
                presets.set(active);
                /*
                 * EDITED is a mark on the chip, not a chip of its own: "this is
                 * the preset you picked" and "you have changed something under
                 * it" are two facts about the same option.
                 */
                presets.mark(active ? null : lastPresetId);
                presetRack.setAside(active ? null : 'EDITED');
                reset.hidden = !!active || !lastPresetId;
                const p2 = PRESETS.find((x) => x.id === (active || lastPresetId));
                presetHint.textContent = active
                    ? (p2 ? p2.hint : '')
                    : (p2 ? 'Your own mix, from ' + p2.label + '. Reset puts it back.'
                          : 'Custom — your own mix of the options below.');

                // ── every control ────────────────────────────────────────
                for (const k of controls) {
                    const live = fieldLive(k.f);
                    k.box.el.hidden = !live;
                    if (k.hint) k.hint.hidden = !live;
                    if (!live) continue;

                    if (k.kind === 'toggle') {
                        k.ctl.set(!!S[k.f.key]);
                    } else if (k.kind === 'segmented') {
                        k.ctl.set(S[k.f.key]);
                    } else if (k.kind === 'select') {
                        const opts = fieldOptions(k.f);
                        k.ctl.rebuild(opts.map((o) => o[0]).join('|'),
                            opts.map(([v, label]) => ({ value: v, label })));
                        k.ctl.set(S[k.f.key]);
                    } else if (k.kind === 'stepper') {
                        k.ctl.set(S[k.f.key]);
                    } else {
                        const parts = readoutParts(k.f.key);
                        k.ctl.set(S[k.f.key]);
                        k.ctl.setAside(parts.aside);
                    }
                }

                // ── a rack with nothing left in it is a heading over a void ─
                for (const r of racks) {
                    const any = r.fields.some(fieldLive);
                    r.rack.el.hidden = !any;
                    r.rack.setAside(any ? (groupAside(r.g.id) || '') : '');
                }

                status.set(
                    (!S.enabled && fieldLive(FIELD.enabled)) ? 'warn' : 'ok',
                    (!S.enabled && fieldLive(FIELD.enabled))
                        ? 'The tab is currently hidden — the board above has the whole player.'
                        : 'Changes apply live, and are saved per song.',
                );
            },
        };
        panels.add(panel);
        panel.sync();
        return panel;
    }

    function notifyPanels() {
        for (const p of Array.from(panels)) {
            if (!p.root || !p.root.isConnected) { panels.delete(p); continue; }
            try { p.sync(); } catch (_) {}
        }
        try { syncControl(); } catch (_) {}
    }

    // ─────────────────────────────────────────────────────────────────────
    // 11. Player control — the choices that matter mid-song, where they are
    // looked for. Turning the board off, or switching how the tab moves, is a
    // decision taken while playing; the host's Visualization panel is not ours
    // to extend, and v3 exposes a stable slot for exactly this.
    // ─────────────────────────────────────────────────────────────────────

    // Every rule that carries a colour is a function of the host palette, so
    // one repaint on theme:changed moves the whole panel. Geometry stays
    // inline and literal: sizes do not need a theme, and a runtime-installed
    // plugin cannot rely on arbitrary-value Tailwind classes existing in the
    // served stylesheet (docs/plugin-styles.md).
    const FONT = 'Inter,system-ui,sans-serif';

    function btnCSS() {
        return [
            'display:block', 'width:100%', 'text-align:left',
            'padding:5px 7px', 'margin-bottom:2px', 'border-radius:6px',
            'border:0', 'cursor:pointer', 'background:transparent',
            'color:' + ink('textDim'), 'font:600 11px ' + FONT,
        ].join(';');
    }

    function chipCSS() {
        return [
            'padding:3px 8px', 'border-radius:999px', 'cursor:pointer',
            'border:1px solid ' + ink('border'), 'background:transparent',
            'color:' + ink('textDim'), 'font:600 10px ' + FONT,
        ].join(';');
    }

    function panelCSS() {
        return [
            'position:fixed', 'top:64px', 'right:12px', 'width:248px',
            'max-height:74vh', 'overflow-y:auto', 'overscroll-behavior:contain',
            'scrollbar-width:thin', 'padding:10px', 'border-radius:10px',
            'background:' + ink('bg', 0.97), 'border:1px solid ' + ink('border'),
            'box-shadow:0 10px 30px rgb(0 0 0 / 0.5)',
            'font:500 11px ' + FONT, 'color:' + ink('textDim'),
        ].join(';');
    }

    function pillCSS() {
        return [
            'display:inline-flex', 'align-items:center', 'gap:6px',
            'padding:5px 10px', 'border-radius:999px',
            'background:' + ink('card', 0.85), 'border:1px solid ' + ink('border'),
            'color:' + ink('text'), 'font:600 11px ' + FONT, 'cursor:pointer',
        ].join(';');
    }

    function selectCSS() {
        return [
            'width:100%', 'padding:4px 6px', 'border-radius:6px',
            'background:' + ink('cardMuted'), 'color:' + ink('text'),
            'border:1px solid ' + ink('border'),
            'font:600 11px ' + FONT, 'cursor:pointer',
        ].join(';');
    }

    /**
     * Put the host's current colours back on every part of the panel.
     *
     * Called once at mount and again whenever a theme is equipped. Display
     * state is deliberately preserved: a repaint must not open or close it.
     */
    function repaintControls() {
        /*
         * NOTHING TO REPAINT ANY MORE.
         *
         * This walked `[data-chip]`, `[data-btn]`, `[data-heading]` and every
         * input in the panel on each theme change and wrote colours back onto
         * them one at a time. The kit's colours are custom properties, so a
         * theme change is a token write on the root and the DOM never hears
         * about it — see `follow()` in the kit's theme module.
         */
    }

    /*
     * WITHDRAWN with the hand-built panel: `controlWrap`, `controlLabel`,
     * `controlPanel`, and the `controlHeading` / `controlChips` /
     * `controlSlider` constructors that filled it.
     *
     * The kit's `createPanel` owns the chassis, its own opener in the player's
     * slot, the open and close and the Escape; `panel.setSubtitle` says what
     * the pill's label used to. Three of those constructors were this file
     * reinventing a rack, a segmented pick and a slider — which is exactly
     * what having a kit is for.
     */

    function playerSlot() {
        const fb = window.feedBack;
        return (fb && fb.ui && typeof fb.ui.playerControlSlot === 'function')
            ? fb.ui.playerControlSlot() : null;
    }

    /**
     * The board list as a menu, not a stack of buttons.
     *
     * It used to be one button per board, which was fine with three and became
     * the tallest thing in the panel once installs started carrying nine: the
     * panel outgrew the space above the pill, grew upward off the top of the
     * screen, and took the preset row with it. A menu is one row whatever the
     * user has installed.
     */
    function rebuildBoardButtons() {
        /*
         * The board list is the SELECT's own business now: `rebuild` in
         * `syncControl` replaces its options when the list changed and leaves
         * them alone when it did not, which is what this rebuilt by hand.
         */
        syncControl();
    }

    function syncControl() {
        if (!panel) return;

        const active = activePresetId();
        if (active) lastPresetId = active;
        const preset = PRESETS.find((x) => x.id === (active || lastPresetId)) || null;

        // The preset name says more in one word than the board does: it implies
        // the mode, the staves and how much is written.
        const hidden = !S.enabled && S.readMode === 'scroll' && S.board !== 'none';
        panel.setSubtitle(hidden
            ? 'The tab is hidden — the board has the player'
            : ('Tab · ' + (preset ? preset.label : 'Custom')));

        presetSeg.set(active);
        /*
         * EDITED is a MARK on the chip you picked, not a sixth chip: "this is
         * the preset" and "you have changed something under it" are two facts
         * about one option.
         */
        presetSeg.mark(active ? null : lastPresetId);
        presetRackRef.setAside(active ? null : 'EDITED');
        presetReset.hidden = !!active || !lastPresetId;

        // ── MOTION, and which question the mode leaves worth asking ──────
        modeSeg.set(S.readMode);
        const scroll = isScroll(S);
        aheadField.el.hidden = !scroll;
        pagedRow.hidden = scroll;
        if (scroll) {
            const parts = readoutParts('aheadBeats');
            aheadSlider.set(S.aheadBeats);
            aheadSlider.setAside(parts.aside);
        } else {
            barsStep.set(S.pageBars);
            staveStep.set(S.rows);
        }
        motionRackRef.setAside(groupAside('reading'));

        headSeg.set(S.noteLabel);
        headRackRef.setAside(groupAside('look'));

        // ── BOARD ABOVE ──────────────────────────────────────────────────
        const opts = boardOptions();
        boardSelect.rebuild(opts.map((o) => o[0]).join('|'),
            opts.map(([v, label]) => ({ value: v, label })));
        boardSelect.set(S.board);
        boardSelect.disable(!scroll);
        showToggle.set(!!S.enabled);
        showToggle.el.hidden = !fieldLive(FIELD.enabled);
        heightField.el.hidden = !fieldLive(FIELD.heightPct) || S.board === 'none';
        heightSlider.set(S.heightPct);
        boardRackRef.setAside(groupAside('basics'));
    }



    /**
     * Where the panel hangs, and how high it stacks.
     *
     * docs/plugin-v3-ui.md sets the chrome's layers: transport and HUD at 20,
     * the rail at 30, popovers at 40. Inside #player — which is fixed, full
     * bleed and clips nothing — those numbers are the ones that apply, and the
     * panel is a popover. Only when there is no player to hang from does it
     * fall back to the body, where it has to clear #player's own 100.
     */
    function panelHost() {
        return document.getElementById('player') || document.body;
    }

    function panelZ() {
        return document.getElementById('player') ? 40 : 150;
    }

    /*
     * ── THE IN-PLAYER PANEL ─────────────────────────────────────────────
     *
     * Built from the kit, so this and Riff Repeater are the same object in two
     * plugins: same chassis, same hatched ears, same racks, same open and
     * close, same Escape.
     *
     * WHAT THIS REPLACED: a hand-built panel of inline `cssText`, with a
     * `repaintControls` that walked `[data-chip]`, `[data-btn]`,
     * `[data-heading]` and every input on a theme change and wrote colours
     * back onto each one. None of that survives — the kit's colours are custom
     * properties, so a theme change is a token write and the DOM never hears
     * about it. That whole function's panel half is gone.
     *
     * THE RACKS ARE THE DESIGN'S, and each field went to the nearest one:
     * `Show the tab` sits in BOARD ABOVE's header, because what it does is
     * hand the room to the board; the read mode and everything about how far
     * you can see are one rack, MOTION, because changing the mode changes
     * which of those questions there is to ask.
     */
    function mountControls() {
        if (panel) return true;
        if (!playerSlot()) return false;

        panel = kit.createPanel({
            id: ID,
            label: 'Tab view',
            title: 'Tab view — how the tablature reads',
        });

        // ── PRESET ───────────────────────────────────────────────────────
        const presetRack = c.rack({ label: 'Preset' });
        panel.body.appendChild(presetRack.el);
        presetReset = c.button('fbk-btn fbk-btn-accent fbk-btn-small', 'Reset',
            'Put every value back to what this preset says',
            () => { if (lastPresetId) api.applyPreset(lastPresetId); });
        presetRack.header.appendChild(presetReset);
        presetRackRef = presetRack;
        presetSeg = c.segmented(
            PRESETS.map((x) => ({ value: x.id, label: x.label, title: x.hint })),
            (id) => { lastPresetId = id; api.applyPreset(id); },
            'Preset',
        );
        presetRack.body.appendChild(presetSeg.el);

        // ── MOTION: the mode, and whatever it makes worth asking ─────────
        const motion = c.rack({ label: 'Motion' });
        panel.body.appendChild(motion.el);
        motionRackRef = motion;
        modeSeg = c.segmented(
            FIELD.readMode.options.map(([v, label]) => ({
                value: v, label: shortOption(label), title: label,
            })),
            (v) => api.set({ readMode: v }),
            'How the tab moves',
        );
        motion.body.appendChild(modeSeg.el);

        /*
         * CONDITIONAL, and it is the schema's own `when` that decides.
         *
         * Scrolling asks how far ahead you can see; page turns asks how much
         * is on a page. They are never both true, so they share the row rather
         * than stacking — the design's `Beats ahead <-> Bars/staff + Staves`.
         */
        aheadField = c.field({ label: FIELD.aheadBeats.label });
        aheadSlider = c.slider({
            min: FIELD.aheadBeats.min, max: FIELD.aheadBeats.max,
            step: FIELD.aheadBeats.step, unit: FIELD.aheadBeats.unit || '',
            ariaLabel: FIELD.aheadBeats.label,
            onInput: (v) => api.set({ aheadBeats: v }),
        });
        aheadField.body.appendChild(aheadSlider.el);
        motion.body.appendChild(aheadField.el);

        /*
         * HALF THE ROW EACH. `fbk-row` lets its children size themselves,
         * which is right for a label and a value and wrong for a PAIR: two
         * steppers that shrink to fit leave a gap on the right and read as one
         * control with something beside it. Bars and staves are one decision
         * in two halves. Kit `.fbk-duo`.
         */
        const paged = c.el('div', 'fbk-duo');
        barsStep = c.stepper({
            /*
             * `Bars`, not `Bars / staff`.
             *
             * It sits beside `Staves` in the same row of the same rack, so the
             * "per staff" is already said by the thing next to it — and a
             * stepper's label has half a row: the slash pushed the number down
             * a line.
             */
            label: 'Bars', value: S.pageBars,
            min: FIELD.pageBars.min, max: FIELD.pageBars.max, step: 1,
            onChange: (v) => api.set({ pageBars: v }),
        });
        staveStep = c.stepper({
            label: 'Staves', value: S.rows,
            min: FIELD.rows.min, max: FIELD.rows.max, step: 1,
            onChange: (v) => api.set({ rows: v }),
        });
        paged.appendChild(barsStep.el);
        paged.appendChild(staveStep.el);
        pagedRow = paged;
        motion.body.appendChild(paged);

        // ── NOTE HEAD ────────────────────────────────────────────────────
        const heads = c.rack({ label: 'Note head' });
        panel.body.appendChild(heads.el);
        headRackRef = heads;
        headSeg = c.segmented(
            FIELD.noteLabel.options.map(([v, label]) => ({
                value: v, label: headGlyph(v) || shortOption(label), title: label,
            })),
            (v) => api.set({ noteLabel: v }),
            'What the note head says',
        );
        heads.body.appendChild(headSeg.el);

        // ── BOARD ABOVE, and the switch that hands it the room ───────────
        const board = c.rack({ label: 'Board above' });
        panel.body.appendChild(board.el);
        boardRackRef = board;
        showToggle = c.toggle('Show the tab',
            FIELD.enabled.hint, (on) => api.set({ enabled: on }));
        board.header.appendChild(showToggle.el);

        boardSelect = c.select([], (v) => api.set({ board: v }), {
            ariaLabel: 'Board above the tab', placeholder: 'Choose',
        });
        board.body.appendChild(boardSelect.el);

        heightField = c.field({ label: FIELD.heightPct.label });
        heightSlider = c.slider({
            min: FIELD.heightPct.min, max: FIELD.heightPct.max, step: 1,
            unit: '%', ariaLabel: FIELD.heightPct.label,
            onInput: (v) => api.set({ heightPct: v }),
        });
        heightField.body.appendChild(heightSlider.el);
        board.body.appendChild(heightField.el);

        panel.attach(playerSlot());
        syncControl();
        return true;
    }

    /*
     * WHAT A NOTE HEAD SAYS, drawn rather than named.
     *
     * `(5)`, `A#`, `(5) A#`, `A# (5)`: the option IS a picture of the thing, so
     * a word for it would be a caption on a caption — and the schema's whole
     * sentence stays as the title, where there is room for it.
     *
     * NODES, not characters. The first pass used `⓿` and a circled zero is not
     * a fret number in a ring; it is whatever the font has. `.fbk-pip` is the
     * app's own note-head shape, so a `5` in it reads as the thing every board
     * draws. Segmented labels take a node for exactly this (kit 0.28.0).
     *
     * The keys are the SCHEMA's: `fret | name | both | nameFret`. The first
     * pass guessed `pitch` and `pitchFirst`, so two of the four options fell
     * through to their sentences and rendered as paragraphs on a chip — which
     * is how the panel looked wrong in a way that had nothing to do with CSS.
     */
    function headGlyph(key) {
        const pip = () => c.el('span', 'fbk-pip', '5');
        const name = () => c.el('span', null, 'A♯');
        const box = c.el('span', 'fbk-glyph');
        if (key === 'fret') { box.appendChild(pip()); return box; }
        if (key === 'name') { box.appendChild(name()); return box; }
        if (key === 'both') { box.appendChild(pip()); box.appendChild(name()); return box; }
        if (key === 'nameFret') { box.appendChild(name()); box.appendChild(pip()); return box; }
        return null;
    }

    let panel = null;
    let presetRackRef = null;
    let presetSeg = null;
    let presetReset = null;
    let motionRackRef = null;
    let modeSeg = null;
    let aheadField = null;
    let aheadSlider = null;
    let pagedRow = null;
    let barsStep = null;
    let staveStep = null;
    let headRackRef = null;
    let headSeg = null;
    let boardRackRef = null;
    let boardSelect = null;
    let showToggle = null;
    let heightField = null;
    let heightSlider = null;

    /*
     * The preset the reader last CHOSE, which is not the one whose values still
     * hold: change one option under `Study` and no preset matches, and the
     * panel still has to be able to say which one you edited, and put it back.
     */
    let lastPresetId = null;

    /**
     * Follow the host's palette for as long as the panel exists.
     *
     * Bound once: the panel is rebuilt when the player remounts, and a
     * listener per mount would repaint it as many times as the song has been
     * opened.
     */
    let themeBound = false;

    function watchTheme() {
        readTheme();
        repaintControls();
        const fb = window.feedBack;
        if (themeBound || !fb || typeof fb.on !== 'function') return;
        themeBound = true;
        const onThemeChanged = () => {
            readTheme();
            repaintControls();
            notifyPanels();       // the settings screen's one inline colour
        };
        fb.on('theme:changed', onThemeChanged);
        onTeardown(() => {
            themeBound = false;
            if (typeof fb.off === 'function') fb.off('theme:changed', onThemeChanged);
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // 12. Public API
    // ─────────────────────────────────────────────────────────────────────

    /**
     * One paste-able snapshot for a bug report.
     *
     * A tester on a chat channel cannot describe a chart, and the maintainer
     * cannot open it. This says what the plugin is, what it found in the host,
     * and — the part that matters — what this particular chart looks like from
     * the inside: how many strings, how ragged its beat grid was before the
     * cleaning, how many bars the pages are counting along.
     */
    function diagnostics() {
        const host = hw();
        const fb = window.feedBack || {};
        const cs = fb.currentSong || {};
        const beats = host ? (call(host, 'getBeats', []) || []) : [];
        const map = beats.length ? tempoMap(beats) : null;
        const notes = host ? (call(host, 'getFilteredNotes', []) || []) : [];
        const chords = host ? (call(host, 'getFilteredChords', []) || []) : [];
        const tuning = songTuning();
        const out = {
            plugin: {
                id: ID,
                version: VERSION,
                manifestVersion: manifestVersion,
                stale: !!(manifestVersion && VERSION !== 'dev' && manifestVersion !== VERSION),
                settingsVersion: api.version,
            },
            preset: activePresetId() || 'custom',
            settings: Object.assign({}, S),
            host: {
                uiVersion: fb.uiVersion || null,
                highway: !!host,
                playerControlSlot: !!(fb.ui && typeof fb.ui.playerControlSlot === 'function'),
                noteStateProvider: !!(host && call(host, 'getNoteStateProvider', null)),
                workingTuning: !!(fb.workingTuning && typeof fb.workingTuning.get === 'function'),
                boardsDiscovered: Object.keys(BOARDS).length,
                boards: Object.keys(BOARDS),
            },
            song: {
                title: cs.title || null,
                arrangement: cs.arrangement || null,
                format: cs.format || null,
                stringsInChart: host ? call(host, 'getStringCount', null) : null,
                stringsOnInstrument: myInstrument().count || null,
                bassArrangement: tuning.bass,
                tuningOffsets: tuning.offsets,
                notes: notes.length,
                chords: chords.length,
                sections: host ? (call(host, 'getSections', []) || []).length : 0,
                lyrics: host ? (call(host, 'getLyrics', []) || []).length : 0,
            },
            grid: map ? {
                beatsRaw: map.stats.raw,
                beatsKept: map.stats.kept,
                beatsDropped: map.stats.dropped,
                beatsFilled: map.stats.filled,
                beatSeconds: Math.round(map.ref * 1000) / 1000,
                beatsPerBar: map.beatsPerBar,
                bars: map.barPos.length,
                anchorBar: map.anchorBar,
                bpm: Math.round(map.bpm),
                paceFactor: Math.round(paceFactor(map) * 100) / 100,
                barsPerStaff: staffBars(),
            } : null,
        };
        out.summary = ID + ' ' + VERSION + ' · ' + (out.song.title || 'no song')
            + ' · ' + (out.song.arrangement || '?')
            + ' · ' + out.song.stringsInChart + ' strings'
            + (out.grid ? (' · grid ' + out.grid.beatsKept + '/' + out.grid.beatsRaw
                + ' kept, ' + out.grid.beatsDropped + ' dropped, '
                + out.grid.beatsFilled + ' filled') : ' · no grid');
        return out;
    }

    const api = {
        version: 2,
        pluginVersion: VERSION,
        diag() { return diagnostics(); },
        get() { return Object.assign({}, S); },
        schema() { return SCHEMA.map((f) => Object.assign({}, f)); },
        groups() { return GROUPS.map((g) => Object.assign({}, g)); },
        boards() {
            const out = {};
            for (const id of Object.keys(BOARDS)) out[id] = BOARDS[id].label;
            return out;
        },
        presets() {
            return PRESETS.map((p) => ({ id: p.id, label: p.label, hint: p.hint }));
        },
        activePreset() { return activePresetId(); },
        applyPreset(id) {
            const p = PRESETS.find((x) => x.id === id);
            if (!p) return this.get();
            return this.set(p.values);
        },
        set(patch) {
            S = normalise(Object.assign({}, S, patch || {}));
            saveSettings();
            notifyPanels();
            return this.get();
        },
        reset() {
            S = normalise({});
            saveSettings();
            notifyPanels();
            return this.get();
        },
        toggle() { return this.set({ enabled: !S.enabled }).enabled; },
        mountSettings: mountSettings,
        helpers: {
            paletteFor, rowFor, techniqueMark, slideTarget, verdictOf, chordNotes,
            normalise, tightestGap, barsInRange, buildTempoMap, stavesFor,
            openPitchClasses, noteNameFor, songTuning, myInstrument, staffLines,
            syllable,
        },
    };

    window.livetab = api;

    discoverBoards();

    // The slot appears with the player, so poll briefly rather than assuming
    // this script runs after it.
    if (!mountControls()) {
        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            if (mountControls() || tries > 120) clearInterval(timer);
        }, 500);
        onTeardown(() => clearInterval(timer));
    }

    onTeardown(() => { panels.clear(); });

    window[HOOKS_KEY] = {
        version: VERSION,
        teardown() {
            // Reverse order, so a listener is gone before the node it watches.
            for (const fn of disposers.splice(0).reverse()) {
                try { fn(); } catch (_) { /* one failure must not strand the rest */ }
            }
        },
    };

    console.log('[' + ID + '] plugin loaded');
})();
