// Live Tab sizes both of its reading modes in musical units — beats for the
// scrolling window, bars for a staff — which is right for note spacing and
// wrong for reading speed. A window of a fixed number of beats crosses the
// screen at a rate proportional to the tempo, and since a display holds each
// frame for one refresh, a moving glyph is smeared over speed/refresh pixels.
// Measured over the local library at the default setting: 294 px/s and a 5 px
// smear at 70 bpm, 848 px/s and 14 px at 201 — wider than a fret digit. That
// is the "slow songs are perfect, fast songs are blurry" report.
//
// The same blind spot broke page turns from the other end: one chart in the
// library marks EVERY beat as a bar line, so beatsPerBar came out 1 and a
// two-bar staff lasted 1.1 seconds — the "page view bugs out with very few
// notes per page" report.
//
// These tests pin the fix from both ends: what the pace correction must do,
// and what it must leave alone. The real functions are extracted from source
// and run in a vm sandbox, so a revert fails here rather than in someone's
// hands.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { extractFunction } = require('./test_utils');

const SCREEN_JS = path.join(__dirname, '..', 'screen.js');
const SRC = fs.readFileSync(SCREEN_JS, 'utf8');

/** The tuning constants, read from source so the tests cannot drift from it. */
function constants() {
    const out = {};
    for (const name of ['PACE_BPM', 'PACE_MAX']) {
        const m = new RegExp('const ' + name + ' = ([\\d.]+)').exec(SRC);
        if (!m) throw new Error('constant ' + name + ' not found in screen.js');
        out[name] = Number(m[1]);
    }
    return out;
}

const C = constants();

// ── The sandbox ──────────────────────────────────────────────────────────────
//
// Only the pure layer: the tempo map and the two functions that decide what a
// staff covers. Nothing here touches a canvas, the host, or the DOM.

function sandbox() {
    const ctx = vm.createContext({
        S: {},
        pageAnim: { index: null, since: 0 },
        performance: { now: () => 1e6 },   // far past any turn: no animation
        window: {},
        console: console,
    });
    const parts = [];
    for (const [name, value] of Object.entries(C)) {
        parts.push('const ' + name + ' = ' + value + ';');
    }
    parts.push('const PAGE_TURN_MS = 260;');
    for (const sig of [
        'function buildTempoMap(',
        'function songBPM(',
        'function paceFactor(',
        'function barLines(',
        'function staffBars(',
        'function pageShift(',
        'function stavesFor(',
    ]) {
        parts.push(extractFunction(SRC, sig));
    }
    vm.runInContext(parts.join('\n\n'), ctx);
    return ctx;
}

/** Default settings, as the Live preset leaves them. */
function settings(over) {
    return Object.assign({
        readMode: 'scroll',
        aheadBeats: 5,
        behindBeats: 1.25,
        pageBars: 3,
        rows: 3,
    }, over || {});
}

/** A clean chart: `bars` bars of `beatsPerBar` at a steady tempo. */
function chart(bpm, bars, beatsPerBar) {
    const step = 60 / bpm;
    const beats = [];
    for (let i = 0; i < bars * beatsPerBar; i++) {
        beats.push({
            time: Math.round(i * step * 1000) / 1000,
            measure: (i % beatsPerBar === 0) ? (1 + i / beatsPerBar) : -1,
        });
    }
    return beats;
}

/**
 * Reading speed in beats per second of screen travel.
 *
 * A staff of a given pixel width holds `pSpan` beats and the music runs past
 * at `bpm/60` beats per second, so px/s is (width / pSpan) * bpm / 60. The
 * width is the same in every case here and cancels out of any comparison, so
 * it is left out: this is px/s per pixel of staff.
 */
function speed(ctx, bpm) {
    const map = ctx.buildTempoMap(chart(bpm, 40, 4));
    const staff = ctx.stavesFor(map, 20, 1)[0];
    return (bpm / 60) / staff.pSpan;
}

// ── Scrolling: the speed must not follow the tempo ───────────────────────────

test('above the reference tempo the reading speed stops rising', () => {
    const ctx = sandbox();
    ctx.S = settings();
    const atRef = speed(ctx, C.PACE_BPM);
    for (const bpm of [150, 180, 201, C.PACE_BPM * C.PACE_MAX]) {
        const got = speed(ctx, bpm);
        assert.ok(Math.abs(got / atRef - 1) < 0.02,
            `at ${bpm} bpm the speed is ${(got / atRef).toFixed(2)}x the speed `
            + `at ${C.PACE_BPM} bpm; it should be held at 1x`);
    }
});

test('below the reference tempo nothing is touched', () => {
    const ctx = sandbox();
    ctx.S = settings();
    for (const bpm of [60, 70, 100, C.PACE_BPM]) {
        const map = ctx.buildTempoMap(chart(bpm, 40, 4));
        assert.equal(ctx.paceFactor(map), 1, `${bpm} bpm should not be stretched`);
        const staff = ctx.stavesFor(map, 20, 1)[0];
        assert.ok(Math.abs(staff.pSpan - 6.25) < 0.01,
            'the window is what the settings ask for');
    }
});

test('the stretch is capped, so an extreme tempo does not shrink the notes away', () => {
    const ctx = sandbox();
    ctx.S = settings();
    const map = ctx.buildTempoMap(chart(400, 40, 4));
    assert.equal(ctx.paceFactor(map), C.PACE_MAX);
});

test('the cursor keeps its place across the width whatever the tempo', () => {
    const ctx = sandbox();
    ctx.S = settings();
    const share = (bpm) => {
        const map = ctx.buildTempoMap(chart(bpm, 40, 4));
        const st = ctx.stavesFor(map, 20, 1)[0];
        return (st.cursorP - st.p0) / st.pSpan;
    };
    const slow = share(80);
    for (const bpm of [120, 160, 200]) {
        assert.ok(Math.abs(share(bpm) - slow) < 1e-9,
            'the tab would appear to jump sideways between songs');
    }
});

test('there is no way to turn the correction off, and nothing needs one', () => {
    // It shipped with a switch. The honest answer to "when would you turn it
    // off?" is "to read a fast song at a speed measured as unreadable", so the
    // switch went and the sliders carry the control instead.
    assert.ok(!/paceAuto/.test(SRC), 'the switch is gone from the source');
    const ctx = sandbox();
    ctx.S = settings();
    const map = ctx.buildTempoMap(chart(200, 40, 4));
    assert.ok(ctx.paceFactor(map) > 1, 'a fast song is stretched, always');
});

// ── Page turns: a staff must last long enough to be read ─────────────────────

/** How long one staff lasts, in seconds. */
function staffSeconds(ctx, bpm, beatsPerBar) {
    const map = ctx.buildTempoMap(chart(bpm, 60, beatsPerBar));
    const staves = ctx.stavesFor(map, 30, 3);
    const cur = staves.find((s) => s.cursorP !== null);
    return cur.pSpan * 60 / bpm;
}

test('a bar line is where the measure number changes', () => {
    // Most charts tag only the downbeat and leave the rest at -1. One in the
    // library tags EVERY beat and repeats the number — 1,1,1,1, 2,2,2,2 —
    // which is a plain 4/4 spelled out beat by beat. Reading "carries a
    // number" as "is a bar line" made that chart four bars per bar, and every
    // compensation built on top of it (an automatic bar count, a per-song
    // slider ceiling, a fit switch) existed only to fight this one line.
    const ctx = sandbox();
    const spelledOut = [];
    for (let i = 0; i < 240; i++) {
        spelledOut.push({ time: i * 0.5, measure: 1 + Math.floor(i / 4) });
    }
    const dense = ctx.buildTempoMap(spelledOut);
    assert.equal(dense.beatsPerBar, 4, 'four beats to the bar, as written');
    assert.equal(ctx.barLines(spelledOut).length, 60, 'sixty bars, not two hundred and forty');

    // ...and a chart that tags only the downbeat is unchanged by the rule.
    const terse = [];
    for (let i = 0; i < 240; i++) {
        terse.push({ time: i * 0.5, measure: (i % 4 === 0) ? (1 + i / 4) : -1 });
    }
    assert.equal(ctx.buildTempoMap(terse).beatsPerBar, 4);
    assert.equal(ctx.barLines(terse).length, 60);
});

test('the staff holds the bars the setting asks for, on every song', () => {
    // No floor, no automatic choice, no ceiling that moves: three bars lasts
    // between three and a half and thirteen seconds across the whole tempo
    // range, and every one of those is long enough to read.
    const ctx = sandbox();
    for (const bpm of [70, 124, 181, 201]) {
        const map = ctx.buildTempoMap(chart(bpm, 60, 4));
        for (const pageBars of [1, 2, 3, 4, 8]) {
            ctx.S = settings({ readMode: 'page', pageBars: pageBars });
            assert.equal(ctx.staffBars(), pageBars);
            const seconds = pageBars * map.beatsPerBar * 60 / bpm;
            if (pageBars === 3) {
                assert.ok(seconds >= 3.5,
                    `three bars at ${bpm} bpm lasts only ${seconds.toFixed(1)}s`);
            }
        }
    }
});

test('every staff starts on a bar line', () => {
    const ctx = sandbox();
    ctx.S = settings({ readMode: 'page', pageBars: 3 });
    const map = ctx.buildTempoMap(chart(201, 60, 4));
    const bars = new Set(map.barPos.map((p) => Math.round(p * 100) / 100));
    for (const st of ctx.stavesFor(map, 30, 3)) {
        assert.ok(bars.has(Math.round(st.p0 * 100) / 100),
            `a staff starts at beat ${st.p0}, which is not a bar line`);
    }
});

// ── The grid the whole thing stands on ───────────────────────────────────────

test('the song tempo is read from the chart, not from its declared value', () => {
    const ctx = sandbox();
    for (const bpm of [70, 124, 201]) {
        const map = ctx.buildTempoMap(chart(bpm, 40, 4));
        assert.ok(Math.abs(map.bpm - bpm) < 1, `read ${map.bpm} for a ${bpm} chart`);
        assert.equal(map.beatsPerBar, 4);
    }
});

test('subdivisions in the grid are dropped rather than counted as beats', () => {
    const ctx = sandbox();
    const beats = [];
    let measure = 1;
    for (let i = 0; i < 160; i++) {
        beats.push({ time: i * 0.5, measure: (i % 4 === 0) ? measure++ : -1 });
        if (i % 8 === 0) beats.push({ time: i * 0.5 + 0.25, measure: -1 });
    }
    const map = ctx.buildTempoMap(beats);
    assert.ok(map.stats.dropped >= 19, 'the off-beat markers were kept as beats');
    assert.ok(Math.abs(map.bpm - 120) < 1, `read ${map.bpm} instead of 120`);
});

test('holes in the grid are filled in beats rather than swallowed', () => {
    const ctx = sandbox();
    const beats = [];
    let measure = 1;
    for (let i = 0; i < 160; i++) {
        if (i >= 40 && i < 44) continue;            // four beats missing
        beats.push({ time: i * 0.5, measure: (i % 4 === 0) ? measure++ : -1 });
    }
    const map = ctx.buildTempoMap(beats);
    assert.equal(map.stats.filled, 4);
    assert.ok(Math.abs(map.bpm - 120) < 1);
    // The hole must not shift the beats after it: beat 80 is still at 40 s.
    assert.ok(Math.abs(map.pos(40) - 80) < 0.01, `beat ${map.pos(40)} at 40 s`);
});

// ── The panel's own mousedown MOVED TO THE KIT ──────────────────────────────
//
// The guard and its two tests now live in `feedBack-plugin-kit`, on
// `createPanel`, because that is where the scrolling body is: the panel drops
// the mousedown default so focusing a control cannot scroll the presets off the
// top, and it must NOT drop it for an input, a select or a textarea, which are
// operated through that default.
//
// The exception is the half this repository got wrong first — it cancelled the
// default for inputs too and Chromium happened to survive it. Both assertions
// went to the kit with the code, so every consumer gets them instead of one.

// ── Every helper the sync paths call must exist ─────────────────────────────
//
// `readout` was deleted along with the hand-built `controlSlider` that used to
// sit beside it, and `readoutParts` calls it — so a sync threw a
// ReferenceError on the first slider it reached. BOTH panels looked healthy,
// because the throw only happens in SCROLLING mode: page turns hide the ahead
// slider, so the line was never reached and every symptom was a value quietly
// not arriving.
//
// That is the shape worth guarding: a helper removed as collateral, on a branch
// the eye was not on. The list is explicit rather than derived because a
// derived one needs an allowlist of every global this file touches, and a list
// of ten names that the two sync paths actually depend on is both honest and
// cheap to keep.

test('the sync paths do not call a helper that was deleted', () => {
    const needed = [
        'readout',        // the number a slider reads, pace correction included
        'readoutParts',   // that number split from its derived companion
        'paceFactor',     // what widens the window above a moderate tempo
        'groupAside',     // a rack's derived header reading
        'fieldLive',      // whether a field's `when` says it applies
        'fieldOptions',   // an enum's options, board list included
        'boardOptions',   // the boards the app has installed
        'activePresetId', // which preset's values still all hold
        'shortOption',    // the name out of a schema label's sentence
        'headGlyph',      // the drawn note-head options
        'controlKind',    // which control a value's shape earns
        'diagnostics',    // what the footer copies
    ];
    /* Substring rather than a regex: the escaping is the part that goes wrong,
       and `function name(` is already unambiguous in this file. */
    const missing = needed.filter((name) => !SRC.includes('function ' + name + '(')
        && !SRC.includes('const ' + name + ' ='));
    assert.deepEqual(missing, [], 'called by a sync path but not defined: ' + missing.join(', '));
});

// ─────────────────────────────────────────────────────────────────────────
// The head radius is called `r` INSIDE the heads pass and nowhere else.
//
// `drawStaff` draws in two passes over the same notes: first the tails, then
// the heads. `r` — the head radius — is declared in the heads pass, so an `r`
// written in the tails pass is a ReferenceError, and one is enough to abandon
// the staff halfway: the tails are already painted, the heads never arrive.
//
// That has now happened twice in the same block. The first fix changed the
// `bx` line and left the `moveTo` two lines below it, under a comment that
// explained the very defect still sitting there — so the bend section drew
// tails with no circles for a whole release, and the only evidence was one
// console line from the per-staff guard.
//
// The first version of this guard COUNTED bare `r`s and allowed a few, because
// the tails pass does declare one of its own — the slide's landing dot. It
// passed with the bug put back, which makes it worse than no guard: it reports
// "checked" about something it cannot see. So it walks brace depth instead and
// asks the only question that matters: is this `r` inside a block that
// declares one?
test('the tails pass never reads the head radius by its short name', () => {
    const from = SRC.indexOf('// ── Sustains, slides and bends ');
    const to = SRC.indexOf('// ── Note heads ');
    assert.ok(from > 0 && to > from, 'both passes must still be marked');

    /* Comments talk ABOUT `r` — that is what they are for here — and a string
       can hold any letter, so neither is a read and neither holds a brace.
       Stripped before the walk rather than during it. */
    const code = SRC.slice(from, to)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''))
        .map((line) => line.replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, ' '))
        .join('\n');

    const BARE_R = /(?<![A-Za-z0-9_$.])r(?![A-Za-z0-9_$])/;
    const stray = [];
    let depth = 0;
    let declaredAt = null;

    for (const line of code.split('\n')) {
        // Left the block that declared one: back to `r` meaning nothing here.
        if (declaredAt !== null && depth < declaredAt) declaredAt = null;
        if (/\b(?:const|let|var)\s+r\b/.test(line)) declaredAt = depth;
        else if (declaredAt === null && BARE_R.test(line)) stray.push(line.trim());
        for (const ch of line) {
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
        }
    }

    assert.deepEqual(stray, [],
        'the tails pass reads `r`, which only exists in the heads pass');
});

// ─────────────────────────────────────────────────────────────────────────
// An empty array is truthy, and that is why chord names never appeared.
//
// `getFilteredChords()` returns what the selected mastery level expects you to
// play, and falls back to the whole list only for a song with one difficulty.
// Asking for it with `filtered || full` looks like it handles both and does
// not: on a chart with phrase data whose phrases carry notes but no chords —
// the ordinary case — the filtered answer is `[]`, which is truthy, so the
// second call never happened and the chord lane had nothing to draw for ever.
//
// `chartList` falls back on EMPTINESS instead. These tests are what tell the
// two apart: `||` passes the first three and fails the fourth.
test('the chart list falls back when the filtered view is empty', () => {
    const fn = extractFunction(SRC, 'function chartList');
    const sandbox = { call: (host, name) => host[name] };
    vm.createContext(sandbox);
    vm.runInContext(fn + '\nglobalThis.chartList = chartList;', sandbox);
    const chartList = sandbox.chartList;

    const full = [{ t: 1 }, { t: 2 }];

    /* Spread into a host array before comparing: a value built inside the vm
       sandbox has that context's Array prototype, and strict deep equality
       checks the prototype — the arrays match and the assertion fails. */
    const got = (host) => [...chartList(host, 'f', 'a')].map((x) => x.t);

    // Filtered has something: it wins, the full list is not consulted.
    assert.deepEqual(got({ f: [{ t: 9 }], a: full }), [9]);
    // No filtered view at all (single-difficulty song): the full list.
    assert.deepEqual(got({ f: null, a: full }), [1, 2]);
    // Neither: an empty array, not null, because callers read `.length`.
    assert.deepEqual(got({ f: null, a: null }), []);
    // The case that was broken: filtered is EMPTY but the chart has chords.
    assert.deepEqual(got({ f: [], a: full }), [1, 2]);
});

// ─────────────────────────────────────────────────────────────────────────
// A chord card reads left to right from the LOWEST string.
//
// Chord boxes have been written that way for as long as they have existed,
// while the chart indexes strings from 0 = high E. Getting it backwards would
// print a real chord's mirror image — which still looks like a plausible chord
// shape, so nothing about the picture would say it was wrong.
test('the chord card puts the lowest string first', () => {
    const fn = extractFunction(SRC, 'function chordCells');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(fn + '\nglobalThis.chordCells = chordCells;', sandbox);
    const chordCells = sandbox.chordCells;

    // Am as the chart holds it: index 0 is the high E.
    const am = { frets: [0, 1, 2, 2, 0, -1], fingers: [0, 1, 2, 3, 0, -1] };
    const cells = [...chordCells(am, 6)];
    assert.deepEqual(cells.map((c) => c.fret), ['×', '0', '2', '2', '1', '0'],
        'x02210, the way Am is written');
    assert.deepEqual(cells.map((c) => c.finger), [0, 0, 3, 2, 1, 0]);

    // No finger data — the Guitar Pro case — says the fret and nothing more.
    const noFingers = [...chordCells({ frets: [3, 0, 0, 0, 2, 3], fingers: [-1, -1, -1, -1, -1, -1] }, 6)];
    assert.deepEqual(noFingers.map((c) => c.finger), [0, 0, 0, 0, 0, 0]);
    // An open string carries no finger even when the source claims one.
    assert.equal(chordCells({ frets: [0], fingers: [2] }, 4)[3].finger, 0);
    // Nothing played at all is not a chord.
    assert.equal(chordCells({ frets: [-1, -1, -1, -1, -1, -1] }, 6), null);
    assert.equal(chordCells(null, 6), null);
});

// ─────────────────────────────────────────────────────────────────────────
// A LOOP MUST NOT INHERIT THE LAST PASS'S VERDICTS.
//
// The verdict memory is keyed on the note object, and a loop replays the very
// same objects — so without this, the red from the previous pass would be back
// on the note before you played it: a judgment from the wrong pass, which is
// worse than no judgment. Time running backwards is the signal, with a quarter
// of a second of slack because a player's clock can wobble by a frame without
// it being a jump.
test('the verdict memory is dropped when time runs backwards', () => {
    const fn = extractFunction(SRC, 'function verdictClock');
    const sandbox = { verdictSeen: null, verdictSince: -1, WeakMap };
    vm.createContext(sandbox);
    vm.runInContext(
        'let verdictSeen = new WeakMap(); let verdictSince = -1;\n'
        + fn
        + '\nglobalThis.run = (times) => {\n'
        + '  const seen = [];\n'
        + '  for (const t of times) { const before = verdictSeen; verdictClock(t);'
        + '    seen.push(verdictSeen === before); }\n'
        + '  return seen;\n'
        + '};', sandbox);

    // Playing forward: the memory is kept throughout.
    assert.deepEqual([...sandbox.run([1, 2, 3, 4])], [true, true, true, true]);
    // A frame of wobble is not a jump.
    assert.deepEqual([...sandbox.run([5, 4.9, 5.1])], [true, true, true]);
    // A loop point, a seek, a new song: dropped.
    assert.deepEqual([...sandbox.run([10, 2])], [true, false]);
});

// ─────────────────────────────────────────────────────────────────────────
// THE FUTURE HAS NO VERDICTS.
//
// Obvious, and it was not being enforced: after a loop restart the first notes
// came back wearing the previous pass's judgments, green and red, ahead of the
// cursor.
//
// Two different sources, one rule closes both. The GREEN was the detector's:
// `noteStateFor` computes `age = songT - dispAnchor` and returns a
// full-strength hit when `age < 0`, commented "struck a hair early" — which on
// a gem highway means a few milliseconds. A loop wrap moves the clock back by
// eleven seconds, so every note judged in the last pass lands in that branch.
// That is not a defect for a renderer that never draws what is behind the
// wrap; a tablature draws a window of notes AHEAD of the cursor and gets the
// whole previous pass handed to it. The RED was ours: the verdict memory
// filling the gap the detector leaves on a miss after the jump.
//
// So the rule is not "notice the jump" — a race with the clock — but "a note
// you have not reached carries no verdict", which is true by construction.
test('a note the cursor has not reached carries no verdict', () => {
    /*
     * `verdictFor` PER INTERO, non solo la regola.
     *
     * La prima versione di questo test provava `verdictApplies` da sola, e
     * passava anche togliendo la chiamata da `verdictFor`: una regola giusta
     * che nessuno consulta. E' lo stesso buco del test della guardia dello
     * slot, trovato lo stesso giorno rimettendo il difetto — un test che non
     * cade quando il difetto torna non sta verificando quello che dice.
     *
     * Qui corre la catena vera: filtro del futuro, provider, memoria.
     */
    const rule = extractFunction(SRC, 'function verdictApplies');
    const chain = extractFunction(SRC, 'const verdictFor =');

    const build = (live, now, answers) => {
        const asked = [];
        const sandbox = {
            NOW_WINDOW: 0.09, Number, WeakMap,
            isLive: live, now,
            provider: (n, t) => { asked.push(t); return answers[t]; },
            verdictOf: (raw) => (raw ? (raw.state === 'active' ? 'hit' : raw.state) : null),
        };
        vm.createContext(sandbox);
        vm.runInContext(
            'let verdictSeen = new WeakMap();\n' + rule + '\n' + chain
            + '\nglobalThis.ask = verdictFor;',
            sandbox);
        /* L'array vive nello scope del test, non nel sandbox: una funzione
           scritta DENTRO il vm non lo vedrebbe. */
        sandbox.chieste = asked;
        return sandbox;
    };

    // The case from the report: the clock wrapped back to 9, and the notes at
    // 12 and 14 were judged in the pass before. The detector answers a
    // full-strength hit for one of them — its `age < 0` branch — and nothing
    // for the missed one, which is the gap the memory used to fill.
    const wrapped = build(true, 9, { 12: { state: 'hit' }, 14: null });
    assert.equal(wrapped.ask({ n: {}, t: 12 }), null, 'a hit from the pass before');
    assert.equal(wrapped.ask({ n: {}, t: 14 }), null, 'a miss from the pass before');
    assert.deepEqual(wrapped.chieste, [],
        'the provider is not even asked about a note that has not happened');

    // Behind the cursor the verdict lands...
    const played = build(true, 20, { 12: { state: 'miss' } });
    const note = {};
    assert.equal(played.ask({ n: note, t: 12 }), 'miss');
    // ...and is remembered once the detector's brief window closes.
    const quiet = build(true, 20, {});
    quiet.ask({ n: note, t: 12 });
    assert.equal(played.ask({ n: note, t: 12 }), 'miss', 'still red while on screen');

    // Under the cursor counts as played: that is the note you are holding.
    const held = build(true, 12, { 12: { state: 'active' } });
    assert.equal(held.ask({ n: {}, t: 12 }), 'hit');

    // Not live — a page with no cursor — nothing is "now", so nothing is
    // filtered and a finished section keeps its colours.
    const still = build(false, 9, { 12: { state: 'hit' } });
    assert.equal(still.ask({ n: {}, t: 12 }), 'hit');
});
