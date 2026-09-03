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
