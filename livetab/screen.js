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
(function () {
    'use strict';

    const ID = 'livetab';
    const LS_KEY = 'livetab.settings';

    // The host cache-busts plugin scripts with `?v=<manifest version>`, so the
    // running version can be read off our own <script> tag rather than kept in
    // a constant here that would drift from plugin.json the first time someone
    // forgot to change both.
    const VERSION = (function () {
        try {
            const src = (document.currentScript && document.currentScript.src) || '';
            const m = /[?&]v=([^&]+)/.exec(src);
            return m ? decodeURIComponent(m[1]) : 'dev';
        } catch (_) {
            return 'dev';
        }
    })();

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
            key: 'pageBars', type: 'int', def: 2, min: 1, max: 4, group: 'reading',
            label: 'Bars per staff', when: isPaged,
            hint: 'Two bars of 4/4 is a comfortable line. More bars fit more music '
                + 'between turns, at the cost of packing the notes tighter. A '
                + 'fast song is given more of them, so that a staff lasts long '
                + 'enough to read; the panel shows both numbers when it does, and '
                + 'moving this slider takes the decision back.',
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
                showTech: true, showPM: true,
                showStrings: true, showTempo: true, showLyrics: false,
            },
        },
        {
            id: 'study', label: 'Study',
            hint: 'Learn the part away from the board: page turns, three staves, '
                + 'and every note named beside its fret.',
            values: {
                readMode: 'page', rows: 3, pageBars: 2, board: 'none',
                noteFill: 'dark', noteScale: 1.05, noteInk: 'string',
                lineInk: 'string', stringAlpha: 0.42, noteLabel: 'both',
                showBars: true, showSections: true, showChords: true,
                showTech: true, showPM: true,
                showStrings: true, showTempo: true, showLyrics: true,
            },
        },
        {
            id: 'sightread', label: 'Sight-reading',
            hint: 'Read it like paper: the same page turns in a single ink, with '
                + 'no colour to lean on.',
            values: {
                readMode: 'page', rows: 3, pageBars: 2, board: 'none',
                noteInk: 'mono', lineInk: 'mono', noteFill: 'dark',
                noteScale: 1.05, stringAlpha: 0.5, noteLabel: 'both',
                showBars: true, showSections: true, showChords: true,
                showTech: true, showPM: true,
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
                showTech: false, showPM: false,
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
                showTech: false, showPM: false,
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
    const MONO_NOTE = '#e8eef7';
    const MONO_LINE = '#9aa7b8';
    const COL_HIT = '#4ade80';
    const COL_MISS = '#f87171';
    const COL_BAR = 'rgba(255,255,255,0.34)';
    const COL_BEAT = 'rgba(255,255,255,0.11)';
    const COL_PLAYHEAD = 'rgba(255,255,255,0.92)';
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
    function barsInRange(beats, from, to) {
        const bars = [];
        if (!Array.isArray(beats)) return bars;
        for (const b of beats) {
            const t = (b && typeof b.time === 'number') ? b.time : null;
            if (t == null || t < from || t > to) continue;
            if (b.measure != null && b.measure !== -1) bars.push({ t: t, measure: b.measure });
        }
        return bars;
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

    // Whether the bars-per-staff slider has been moved by hand for the song
    // now loaded. A preset does not count as moving it — a preset is a set of
    // defaults, and the pace floor is one of the things it defaults to.
    let pageBarsPinned = false;

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

        const markers = [];
        for (const b of beats || []) {
            if (b && typeof b.time === 'number' && b.measure != null && b.measure !== -1) {
                markers.push(b.time);
            }
        }

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
        // A new chart is a new question about how long a staff should be, so
        // the hand-set override does not follow you from the last song.
        pageBarsPinned = false;
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
    const PAGE_SECONDS = 4;      // the shortest a staff may last
    const PAGE_MAX_BEATS = 32;   // ...and the most it may hold

    function songBPM(map) {
        const bpm = map && map.bpm;
        return (isFinite(bpm) && bpm > 20 && bpm < 400) ? bpm : PACE_BPM;
    }

    /** How much wider the scrolling window is than the setting asks. */
    function paceFactor(map) {
        return Math.max(1, Math.min(PACE_MAX, songBPM(map) / PACE_BPM));
    }

    /**
     * How many bars a staff would need in order to last long enough to read.
     *
     * One chart in this library marks every single beat as a bar, which made a
     * two-bar staff 1.1 seconds long and turned the page once a second — that
     * is the report about page turns showing almost no notes.
     */
    function barsNeeded(map) {
        if (!map) return 1;
        const perBar = Math.max(1, map.beatsPerBar);
        const needed = Math.ceil(PAGE_SECONDS * songBPM(map) / 60 / perBar);
        return Math.max(1, Math.min(needed, Math.floor(PAGE_MAX_BEATS / perBar)));
    }

    /**
     * How many bars one staff actually holds.
     *
     * The floor is a starting point, not a rule. Left alone it raises a fast
     * song to something readable; the moment the slider is touched it steps
     * out of the way and the number on the slider is the number on screen.
     *
     * Without that it was worse than the problem it solved: at 181 bpm the
     * floor is four bars, so asking for one, two, three or four all drew four
     * and the slider did nothing at all in three of its four positions. A
     * control that ignores you is not a sensible default, whatever it is
     * defaulting to.
     */
    function staffBars(map) {
        const asked = Math.max(1, S.pageBars);
        if (!map || pageBarsPinned) return asked;
        return Math.max(asked, barsNeeded(map));
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
        const perPage = staffBars(map);
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
            ctx.font = '700 ' + Math.round(8.5 * k) + 'px Inter, system-ui, sans-serif';
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
        const lineOf = (l) => (S.lineInk === 'mono') ? MONO_LINE : (colors[l] || '#888');
        const noteOf = (s) => (S.noteInk === 'mono')
            ? MONO_NOTE : (colors[s + rowOffset] || '#ddd');
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
        ctx.lineWidth = 1;
        ctx.strokeStyle = COL_BEAT;
        ctx.beginPath();
        const firstTick = Math.ceil(view.p0);
        const lastTick = Math.floor(view.p0 + pSpan);
        for (let p = firstTick; p <= lastTick; p++) {
            const x = Math.round(padX + (p - view.p0) * pxPerBeat) + 0.5;
            ctx.moveTo(x, staffTop - 3 * k);
            ctx.lineTo(x, staffBottom + 3 * k);
        }
        ctx.stroke();

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
            ctx.font = '700 ' + Math.round(9 * k) + 'px Inter, system-ui, sans-serif';
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
            ctx.font = '700 ' + Math.round(9 * k) + 'px Inter, system-ui, sans-serif';
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
            ctx.font = '700 ' + Math.round(9.5 * k) + 'px Inter, system-ui, sans-serif';
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
                grad.addColorStop(1, 'rgba(255,255,255,0.15)');
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
                // Bend: how far it goes, in the tab's own shorthand.
                const semis = it.n.bn;
                const txt = (semis >= 2) ? 'full' : (semis >= 1 ? '½' : '¼');
                ctx.font = '700 ' + Math.round(fs * 0.8) + 'px Inter, system-ui, sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.7)';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(txt, (x0 + x1) / 2, y - 9 * k);
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
            if (verdict === 'hit') { ink = COL_HIT; ring = COL_HIT; }
            else if (verdict === 'miss') { ink = COL_MISS; ring = COL_MISS; }

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
            ctx.font = '700 ' + Math.round(fs) + 'px "JetBrains Mono", ui-monospace, monospace';

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
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, x, y + 0.5);

            // The second label, beside the head. Sideways is the only
            // direction with room: at six strings the heads already almost
            // touch vertically. It gets a dark chip of its own, because bare
            // text there competes with the string line it sits on and with any
            // sustain running underneath — which is what made it hard to
            // read. It gives way silently when the next note is too close.
            if (aside) {
                ctx.font = '700 ' + Math.round(fs * 0.74)
                    + 'px Inter, system-ui, sans-serif';
                const aw = ctx.measureText(aside).width;
                if (roomAfter[oi] > rx + aw + 12 * k) {
                    const ax = x + rx + 3 * k;
                    ctx.fillStyle = 'rgba(6,9,15,0.88)';
                    ctx.fillRect(ax - 1.5 * k, y - 6.5 * k, aw + 3 * k, 13 * k);
                    ctx.fillStyle = 'rgba(255,255,255,0.82)';
                    ctx.textAlign = 'left';
                    ctx.fillText(aside, ax, y + 0.5);
                }
            }
            ctx.restore();

            // Hammer-on / pull-off: an arc between the two notes it joins,
            // which is what the technique actually is — a link, not a label.
            const prev = prevOnString[s];
            if (S.showTech && (it.n.ho || it.n.po) && prev != null && fit > 0.55) {
                const span = x - prev;
                if (span > 3 && span < 90 * k) {
                    ctx.save();
                    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
                    ctx.lineWidth = Math.max(1, 1.1 * k);
                    ctx.beginPath();
                    const lift = it.n.ho ? -(r + 6 * k) : (r + 6 * k);
                    ctx.moveTo(prev + r * 0.5, y + lift * 0.35);
                    ctx.quadraticCurveTo((prev + x) / 2, y + lift, x - r * 0.5, y + lift * 0.35);
                    ctx.stroke();
                    if (fit > 0.8) {
                        ctx.font = '700 ' + Math.round(8.5 * k) + 'px Inter, system-ui, sans-serif';
                        ctx.fillStyle = 'rgba(255,255,255,0.6)';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(it.n.ho ? 'H' : 'P', (prev + x) / 2, y + lift * 1.25);
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
                    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
                    ctx.lineWidth = Math.max(1, 1 * k);
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
                    ctx.font = '700 ' + Math.round(9 * k) + 'px Inter, system-ui, sans-serif';
                    ctx.fillStyle = 'rgba(255,255,255,0.6)';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(above.join(' '), x, y - r - 6 * k);
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
            ctx.font = '700 ' + Math.round(8.5 * k) + 'px Inter, system-ui, sans-serif';
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
            ctx.font = '600 ' + Math.round(9.5 * k) + 'px Inter, system-ui, sans-serif';
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
            ctx.font = '700 ' + Math.round(11 * k) + 'px Inter, system-ui, sans-serif';
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
            ctx.strokeStyle = COL_PLAYHEAD;
            ctx.lineWidth = Math.max(1, 1.4 * k);
            ctx.beginPath();
            ctx.moveTo(Math.round(playX) + 0.5, band.top + 4 * k);
            ctx.lineTo(Math.round(playX) + 0.5, band.top + band.height - 3 * k);
            ctx.stroke();
        }

        ctx.restore();

        // ── String names ─────────────────────────────────────────────
        // Outside the clip, and last: they own the margin, nothing may paint
        // over them and they may not paint over the staff.
        if (S.showStrings) {
            ctx.font = '700 ' + Math.round(8.5 * k) + 'px Inter, system-ui, sans-serif';
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
            drawStaff(chart, band, view);
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
                if (!host || !host.parentNode) return;

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
                    return;
                }

                mounted = true;
                onResize = () => { place(); };
                window.addEventListener('resize', onResize);
                place();
                attachBoard();
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

    function mountSettings(root) {
        if (!root) return null;
        // The settings screen can be the first thing that runs — a cold visit
        // with no song ever opened — so the palette is read here too, not only
        // when the in-player panel mounts.
        watchTheme();
        root.textContent = '';
        root.className = 'p-4 space-y-4 text-sm';

        const h3 = document.createElement('h3');
        h3.className = 'text-base font-semibold text-fb-text';
        h3.textContent = 'Live Tab';
        root.appendChild(h3);
        const sub = document.createElement('p');
        sub.className = 'text-xs text-fb-textDim';
        sub.textContent = 'A tablature you can read while it moves, with any note '
            + 'board hosted above it. Hit and miss come from the same judgment the '
            + 'board uses, so a fret number turns green or red as the gem does — '
            + 'which needs note detection running with your instrument connected.';
        root.appendChild(sub);

        // ── Presets ──────────────────────────────────────────────────
        const presetBox = document.createElement('div');
        presetBox.className = 'space-y-2';
        const presetHead = document.createElement('div');
        presetHead.className = 'text-xs uppercase tracking-wide text-fb-textDim';
        presetHead.textContent = 'Preset';
        presetBox.appendChild(presetHead);
        const chips = document.createElement('div');
        chips.className = 'flex flex-wrap gap-2';
        const chipEls = [];
        for (const p of PRESETS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = p.label;
            b.title = p.hint;
            b.addEventListener('click', () => { api.applyPreset(p.id); });
            chips.appendChild(b);
            chipEls.push({ id: p.id, el: b });
        }
        presetBox.appendChild(chips);
        const presetHint = document.createElement('span');
        presetHint.className = CLS.hint;
        presetBox.appendChild(presetHint);
        root.appendChild(presetBox);

        // ── Fields, grouped ──────────────────────────────────────────
        const controls = [];
        const groupBoxes = [];

        function addField(parent, f) {
            const wrap = document.createElement('label');
            wrap.className = (f.type === 'bool')
                ? 'flex items-start gap-2 cursor-pointer'
                : 'block';

            let input;
            let out = null;

            if (f.type === 'bool') {
                input = document.createElement('input');
                input.type = 'checkbox';
                input.className = CLS.check;
                wrap.appendChild(input);
                const txt = document.createElement('span');
                const name = document.createElement('span');
                name.className = 'text-fb-text';
                name.textContent = f.label;
                txt.appendChild(name);
                if (f.hint) {
                    const hint = document.createElement('span');
                    hint.className = CLS.hint;
                    hint.textContent = f.hint;
                    txt.appendChild(hint);
                }
                wrap.appendChild(txt);
            } else if (f.type === 'enum') {
                const name = document.createElement('span');
                name.className = CLS.label;
                name.textContent = f.label;
                wrap.appendChild(name);
                input = document.createElement('select');
                input.className = CLS.select;
                wrap.appendChild(input);
                if (f.hint) {
                    const hint = document.createElement('span');
                    hint.className = CLS.hint;
                    hint.textContent = f.hint;
                    wrap.appendChild(hint);
                }
            } else {
                const name = document.createElement('span');
                name.className = CLS.label;
                name.textContent = f.label + ': ';
                out = document.createElement('b');
                name.appendChild(out);
                if (f.unit) name.appendChild(document.createTextNode(' ' + f.unit));
                wrap.appendChild(name);
                input = document.createElement('input');
                input.type = 'range';
                input.className = CLS.range;
                input.min = String(f.min);
                input.max = String(f.max);
                input.step = String(f.step || ((f.type === 'int') ? 1 : 0.1));
                wrap.appendChild(input);
                if (f.hint) {
                    const hint = document.createElement('span');
                    hint.className = CLS.hint;
                    hint.textContent = f.hint;
                    wrap.appendChild(hint);
                }
            }

            const push = () => {
                const value = (f.type === 'bool') ? input.checked
                    : (f.type === 'enum') ? input.value : Number(input.value);
                api.set({ [f.key]: value });
            };
            input.addEventListener('change', push);
            if (f.type !== 'enum') input.addEventListener('input', push);

            parent.appendChild(wrap);
            controls.push({ f: f, wrap: wrap, input: input, out: out });
        }

        for (const g of GROUPS) {
            const fields = SCHEMA.filter((f) => f.group === g.id);
            if (!fields.length) continue;

            let container;
            let wrapper;
            if (g.advanced) {
                const det = document.createElement('details');
                det.className = 'border border-fb-border rounded';
                const sum = document.createElement('summary');
                sum.className = 'px-3 py-2 cursor-pointer text-xs uppercase '
                    + 'tracking-wide text-fb-textDim select-none';
                sum.textContent = g.label;
                det.appendChild(sum);
                container = document.createElement('div');
                container.className = 'px-3 pb-3 space-y-3';
                det.appendChild(container);
                root.appendChild(det);
                wrapper = det;
            } else {
                container = document.createElement('div');
                container.className = 'space-y-3';
                root.appendChild(container);
                wrapper = container;
            }
            for (const f of fields) addField(container, f);
            groupBoxes.push({ fields: fields, wrapper: wrapper });
        }

        // ── Reset ────────────────────────────────────────────────────
        const foot = document.createElement('div');
        foot.className = 'flex items-center gap-3 pt-1';
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'px-3 py-1.5 rounded bg-fb-card hover:bg-fb-border text-fb-text';
        reset.textContent = 'Reset to defaults';
        reset.addEventListener('click', () => { api.reset(); });
        foot.appendChild(reset);

        // Reporting a rendering bug means saying what the chart looks like from
        // the inside, and nobody can be asked to open a developer console to do
        // it. One button, one paste.
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'px-3 py-1.5 rounded bg-fb-cardMuted hover:bg-fb-card '
            + 'text-fb-text border border-fb-border';
        copy.textContent = 'Copy diagnostics';
        copy.title = 'Copies a snapshot of the plugin, the app and this chart, '
            + 'to paste into a bug report.';
        copy.addEventListener('click', () => {
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
                // No clipboard permission: put it somewhere it can be copied by
                // hand rather than losing it.
                const box = document.createElement('textarea');
                box.value = text;
                box.style.cssText = 'position:fixed;left:-9999px;top:0';
                document.body.appendChild(box);
                box.select();
                let ok = false;
                try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
                box.remove();
                if (!ok) console.log('[' + ID + '] diagnostics', text);
                done(ok);
            }
        });
        foot.appendChild(copy);

        const status = document.createElement('span');
        status.className = 'text-xs text-fb-textDim';
        foot.appendChild(status);
        root.appendChild(foot);

        const panel = {
            root: root,
            sync() {
                const active = activePresetId();
                for (const c of chipEls) {
                    const on = c.id === active;
                    c.el.className = CLS.chip + (on ? CLS.chipOn : CLS.chipOff);
                    // Not a utility and not a token: see inkOn().
                    c.el.style.color = on ? inkOn('primary') : '';
                }
                const p = PRESETS.find((x) => x.id === active);
                presetHint.textContent = p ? p.hint
                    : 'Custom — your own mix of the options below.';

                for (const c of controls) {
                    if (c.input) c.input.style.accentColor = ink('primary');
                    const live = fieldLive(c.f);
                    c.wrap.style.display = live ? '' : 'none';
                    if (!live) continue;
                    if (c.f.type === 'bool') {
                        c.input.checked = !!S[c.f.key];
                    } else if (c.f.type === 'enum') {
                        const opts = fieldOptions(c.f);
                        const same = c.input.options.length === opts.length
                            && opts.every((o, i) => c.input.options[i].value === o[0]);
                        if (!same) {
                            c.input.textContent = '';
                            for (const opt of opts) {
                                const o = document.createElement('option');
                                o.value = opt[0];
                                o.textContent = opt[1];
                                c.input.appendChild(o);
                            }
                        }
                        c.input.value = String(S[c.f.key]);
                    } else {
                        c.input.value = String(S[c.f.key]);
                        if (c.out) c.out.textContent = String(Math.round(S[c.f.key] * 100) / 100);
                    }
                }
                // A group with nothing left to show is a heading over a void.
                for (const box of groupBoxes) {
                    const any = box.fields.some(fieldLive);
                    box.wrapper.style.display = any ? '' : 'none';
                }
                status.textContent = (!S.enabled && fieldLive(FIELD.enabled))
                    ? 'The tab is currently hidden.' : '';
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
        if (!controlPanel) return;
        const open = controlPanel.style.display;
        controlPanel.style.cssText = panelCSS() + ';z-index:' + panelZ()
            + ';display:' + (open || 'none');
        const pill = controlWrap && controlWrap.firstChild;
        if (pill) pill.style.cssText = pillCSS();
        for (const el of controlPanel.querySelectorAll('[data-chip]')) {
            el.style.cssText = chipCSS();
        }
        for (const el of controlPanel.querySelectorAll('[data-btn]')) {
            el.style.cssText = btnCSS();
        }
        for (const el of controlPanel.querySelectorAll('[data-heading]')) {
            el.style.color = ink('textDim');
        }
        for (const el of controlPanel.querySelectorAll('input[type="range"],input[type="checkbox"]')) {
            el.style.accentColor = ink('primary');
        }
        const sticky = controlPanel.querySelector('[data-sticky]');
        if (sticky) sticky.style.background = ink('bg', 0.97);
        const sel = controlPanel.querySelector('[data-board-select]');
        if (sel) sel.style.cssText = selectCSS();
        syncControl();
    }

    let controlWrap = null;
    let controlLabel = null;
    let controlPanel = null;

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
        if (!controlPanel) return;
        const sel = controlPanel.querySelector('[data-board-select]');
        if (!sel) return;
        const ids = Object.keys(BOARDS);
        const same = sel.options.length === ids.length
            && ids.every((id, i) => sel.options[i].value === id);
        if (!same) {
            sel.textContent = '';
            for (const id of ids) {
                const o = document.createElement('option');
                o.value = id;
                o.textContent = BOARDS[id].label;
                sel.appendChild(o);
            }
        }
        syncControl();
    }

    function syncControl() {
        if (!controlLabel) return;
        // The preset name says more in one word than the board does: it implies
        // the mode, the staves and how much is written.
        const active = activePresetId();
        const preset = active ? PRESETS.find((x) => x.id === active) : null;
        const hidden = !S.enabled && S.readMode === 'scroll' && S.board !== 'none';
        controlLabel.textContent = hidden
            ? 'Tab off' : ('Tab · ' + (preset ? preset.label : 'Custom'));
        if (!controlPanel) return;
        const mark = (el, on) => {
            el.style.background = on ? ink('primary', 0.22) : 'transparent';
            el.style.color = on ? ink('text') : ink('textDim');
        };
        for (const el of controlPanel.querySelectorAll('[data-preset]')) {
            const on = el.getAttribute('data-preset') === active;
            mark(el, on);
            el.style.borderColor = on ? ink('primary', 0.6) : ink('border');
        }
        const boardSel = controlPanel.querySelector('[data-board-select]');
        if (boardSel && boardSel.options.length) boardSel.value = S.board;
        for (const el of controlPanel.querySelectorAll('[data-mode]')) {
            mark(el, el.getAttribute('data-mode') === S.readMode);
        }
        const show = controlPanel.querySelector('[data-show]');
        if (show) show.checked = !!S.enabled;
        for (const el of controlPanel.querySelectorAll('[data-enum]')) {
            const parts = el.getAttribute('data-enum').split(':');
            const on = S[parts[0]] === parts[1];
            mark(el, on);
            el.style.borderColor = on ? ink('primary', 0.6) : ink('border');
        }
        for (const el of controlPanel.querySelectorAll('[data-key]')) {
            el.value = String(S[el.getAttribute('data-key')]);
        }
        // A slider that reads 2 while four bars are on screen is a panel
        // telling a lie, and the first thing it costs is the belief that the
        // slider does anything at all. Where the pace correction is changing
        // the number, both are shown: what was asked for, and what is drawn.
        const map = tempoCache.map;
        const effective = {
            pageBars: (S.readMode === 'page') ? staffBars(map) : null,
            aheadBeats: (S.readMode === 'scroll')
                ? Math.round(S.aheadBeats * paceFactor(map) * 10) / 10 : null,
        };
        for (const el of controlPanel.querySelectorAll('[data-out]')) {
            const key = el.getAttribute('data-out');
            const asked = Math.round(S[key] * 100) / 100;
            const now = effective[key];
            el.textContent = String(asked)
                + ((now != null && now !== asked) ? (' → ' + now) : '')
                + (el.getAttribute('data-suffix') || '');
        }
        // A row for a setting that does not apply right now is not greyed out,
        // it is gone: the panel is small and read at a glance mid-song.
        for (const el of controlPanel.querySelectorAll('[data-row]')) {
            const f = FIELD[el.getAttribute('data-row')];
            el.style.display = (!f || fieldLive(f)) ? '' : 'none';
        }
    }

    /**
     * A slider row for one schema field, wired straight to the setting.
     *
     * The panel used to spell out its one slider by hand; the moment a second
     * arrived that stopped being tenable, and the schema already knows the
     * range, the step and whether the field applies at all.
     */
    function controlSlider(key, labelText, suffix) {
        const f = FIELD[key];
        const row = document.createElement('label');
        row.style.cssText = 'display:block;margin-top:8px';
        row.setAttribute('data-row', key);
        const txt = document.createElement('span');
        txt.appendChild(document.createTextNode(labelText + ' '));
        const out = document.createElement('b');
        out.setAttribute('data-out', key);
        out.setAttribute('data-suffix', suffix || '');
        txt.appendChild(out);
        row.appendChild(txt);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(f.min);
        input.max = String(f.max);
        input.step = String(f.step || ((f.type === 'int') ? 1 : 0.1));
        input.setAttribute('data-key', key);
        input.style.cssText = 'width:100%';
        input.addEventListener('input', () => {
            api.set({ [key]: Number(input.value) });
        });
        row.appendChild(input);
        return row;
    }

    /** A row of chips that set one enum field. */
    function controlChips(key, choices) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
        row.setAttribute('data-row', key);
        for (const choice of choices) {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('data-enum', key + ':' + choice[0]);
            b.setAttribute('data-chip', '1');
            b.textContent = choice[1];
            if (choice[2]) b.title = choice[2];
            b.style.cssText = chipCSS();
            b.addEventListener('click', () => { api.set({ [key]: choice[0] }); });
            row.appendChild(b);
        }
        return row;
    }

    function controlHeading(text, key) {
        const el = document.createElement('div');
        el.textContent = text;
        el.setAttribute('data-heading', '1');
        if (key) el.setAttribute('data-row', key);
        el.style.cssText = 'font:700 9px ' + FONT + ';letter-spacing:.08em;'
            + 'color:' + ink('textDim') + ';margin:8px 0 4px';
        return el;
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

    function mountControls() {
        if (controlWrap && controlWrap.parentNode) return true;
        const slot = playerSlot();
        if (!slot) return false;

        controlWrap = document.createElement('div');
        controlWrap.style.cssText = 'position:relative;display:inline-block';

        const pill = document.createElement('button');
        pill.type = 'button';
        pill.style.cssText = pillCSS();
        controlLabel = document.createElement('span');
        pill.appendChild(controlLabel);
        controlWrap.appendChild(pill);

        // Parked in the corner of the window, the way the 3D Highway parks its
        // own settings pane — same place, same size, so the two feel like one
        // app rather than two plugins.
        //
        // It was anchored to its pill at first, which is where the trouble was:
        // the player's <main> scrolls and therefore clips, so a panel grown
        // upward from a pill low on the screen was cut at that element's edge;
        // and once it fitted, changing a setting that adds a row moved the
        // whole thing, because a panel pinned by its bottom edge can only grow
        // upward. Parked in the corner it is clipped by nothing, moves for
        // nothing, and needs no code to follow anything about.
        controlPanel = document.createElement('div');
        controlPanel.style.cssText = panelCSS() + ';z-index:' + panelZ()
            + ';display:none';

        const showRow = document.createElement('label');
        showRow.setAttribute('data-row', 'enabled');
        showRow.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer';
        const showBox = document.createElement('input');
        showBox.style.accentColor = ink('primary');
        showBox.type = 'checkbox';
        showBox.setAttribute('data-show', '1');
        showBox.addEventListener('change', () => { api.set({ enabled: showBox.checked }); });
        showRow.appendChild(showBox);
        const showTxt = document.createElement('span');
        showTxt.textContent = 'Show the tab';
        showRow.appendChild(showTxt);

        // Presets first, and here rather than only in the settings screen:
        // "give me the reading layout" is a decision taken mid-song, and
        // walking out to Graphics settings to take it means stopping playing.
        // Pinned: whatever else the panel grows, these stay reachable. The
        // presets are the way back out of any state, so losing them off the top
        // of a scrolled panel leaves someone stuck in a layout they did not
        // want — and the show/hide switch belongs with them rather than above
        // them, where the pinned header would slide over it.
        const presetBox = document.createElement('div');
        presetBox.setAttribute('data-sticky', '1');
        presetBox.style.cssText = [
            'position:sticky', 'top:-10px', 'z-index:2',
            'background:' + ink('bg', 0.97), 'padding:10px 0 6px', 'margin:-10px 0 0',
        ].join(';');
        presetBox.appendChild(showRow);
        presetBox.appendChild(controlHeading('PRESET'));
        controlPanel.appendChild(presetBox);
        const presetRow = document.createElement('div');
        presetRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px';
        for (const preset of PRESETS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('data-preset', preset.id);
            b.setAttribute('data-chip', '1');
            b.textContent = preset.label;
            b.title = preset.hint;
            b.style.cssText = chipCSS();
            b.addEventListener('click', () => { api.applyPreset(preset.id); });
            presetRow.appendChild(b);
        }
        presetBox.appendChild(presetRow);

        controlPanel.appendChild(controlHeading('HOW IT MOVES'));
        for (const opt of [['scroll', 'Scrolling'], ['page', 'Page turns']]) {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('data-mode', opt[0]);
            b.setAttribute('data-btn', '1');
            b.textContent = opt[1];
            b.style.cssText = btnCSS();
            b.addEventListener('click', () => { api.set({ readMode: opt[0] }); });
            controlPanel.appendChild(b);
        }

        // How far ahead you can see is the one thing worth reaching for while
        // playing — it depends on the passage, and you judge it by looking. In
        // page turns the same question is asked as bars per staff, so the two
        // share the slot and only the one that applies is shown.
        controlPanel.appendChild(controlHeading('HOW FAR AHEAD'));
        controlPanel.appendChild(controlSlider('aheadBeats', 'Beats ahead', ''));
        controlPanel.appendChild(controlSlider('pageBars', 'Bars per staff', ''));
        controlPanel.appendChild(controlSlider('rows', 'Staves', ''));

        // Likewise "name this passage for me" is a practice decision, not a
        // configuration one. The chips are written in the notation itself.
        controlPanel.appendChild(controlHeading('NOTE HEAD'));
        controlPanel.appendChild(controlChips('noteLabel', [
            ['fret', '5', 'The fret number'],
            ['name', 'A#', 'The note name'],
            ['both', '5 A#', 'The fret, with the note name beside it'],
            ['nameFret', 'A# 5', 'The note name, with the fret beside it'],
        ]));

        controlPanel.appendChild(controlHeading('BOARD ABOVE', 'board'));
        const boards = document.createElement('select');
        boards.setAttribute('data-board-select', '1');
        boards.setAttribute('data-row', 'board');
        boards.style.cssText = selectCSS();
        boards.addEventListener('change', () => { api.set({ board: boards.value }); });
        controlPanel.appendChild(boards);

        controlPanel.appendChild(controlSlider('heightPct', 'Tab height', '%'));

        // Clicking a control focuses it, and the browser then scrolls the
        // panel to keep the focused thing in view — which is what pushed the
        // presets out of sight the moment someone changed a setting.
        //
        // A button does not need its default, so it can lose it. An input is
        // not ours to cancel — the default is how a slider is dragged and a
        // checkbox is ticked, and whether a given browser survives losing it
        // is not something to rely on. So an input keeps it, and the panel's
        // scroll position is simply put back afterwards.
        controlPanel.addEventListener('mousedown', (ev) => {
            const t = ev.target;
            if (!t) return;
            if (t.tagName === 'BUTTON') { ev.preventDefault(); return; }
            if (t.tagName !== 'INPUT') return;
            const top = controlPanel.scrollTop;
            const put = () => { controlPanel.scrollTop = top; };
            if (window.requestAnimationFrame) requestAnimationFrame(put); else put();
        });

        panelHost().appendChild(controlPanel);

        const closePanel = () => { controlPanel.style.display = 'none'; };

        pill.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const open = controlPanel.style.display !== 'none';
            controlPanel.style.display = open ? 'none' : 'block';
            if (!open) controlPanel.scrollTop = 0;
        });
        document.addEventListener('click', (ev) => {
            if (!controlWrap.contains(ev.target) && !controlPanel.contains(ev.target)) {
                closePanel();
            }
        });

        slot.appendChild(controlWrap);
        rebuildBoardButtons();
        watchTheme();
        return true;
    }

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
        fb.on('theme:changed', () => {
            readTheme();
            repaintControls();
            notifyPanels();       // the settings screen's one inline colour
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
                barsPerStaff: staffBars(map),
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
            const out = this.set(p.values);
            pageBarsPinned = false;      // a preset restores the defaults
            notifyPanels();
            return out;
        },
        set(patch) {
            if (patch && patch.pageBars !== undefined) pageBarsPinned = true;
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
    }

    console.log('[' + ID + '] plugin loaded');
})();
