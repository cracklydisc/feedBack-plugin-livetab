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

const SCREEN_JS = path.join(__dirname, '..', 'livetab', 'screen.js');
const SRC = fs.readFileSync(SCREEN_JS, 'utf8');

/** The tuning constants, read from source so the tests cannot drift from it. */
function constants() {
    const out = {};
    for (const name of ['PACE_BPM', 'PACE_MAX', 'PAGE_SECONDS', 'PAGE_MAX_BEATS']) {
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
        // Set by the real api.set() the moment the slider is touched. A global
        // rather than a script-level binding, so a test can move it.
        pageBarsPinned: false,
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
        'function barsNeeded(',
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
        pageBars: 2,
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

test('the floor steps aside as soon as the slider is moved', () => {
    // The floor's first version did not, and at 181 bpm — where four bars are
    // needed — asking for one, two, three or four bars all drew four. Three of
    // the slider's four positions did nothing, which is what a player reported
    // as the new switch having locked every other setting.
    const ctx = sandbox();
    const map = ctx.buildTempoMap(chart(181, 60, 4));
    assert.ok(ctx.barsNeeded(map) > 1, 'this song is meant to have a floor');

    ctx.pageBarsPinned = false;
    ctx.S = settings({ readMode: 'page', pageBars: 2 });
    assert.equal(ctx.staffBars(map), ctx.barsNeeded(map),
        'left alone, a fast song is given a staff long enough to read');

    ctx.pageBarsPinned = true;
    const seen = [];
    for (const pageBars of [1, 2, 3, 4]) {
        ctx.S = settings({ readMode: 'page', pageBars: pageBars });
        seen.push(ctx.staffBars(map));
    }
    assert.deepEqual(seen, [1, 2, 3, 4],
        'once moved, the slider is the number of bars on screen');
});

test('a staff never lasts less than the floor, however the chart is barred', () => {
    const ctx = sandbox();
    ctx.S = settings({ readMode: 'page' });
    const cases = [
        [201, 4, 'a fast song in 4/4'],
        [189, 4, 'a fast song in 4/4'],
        [110, 1, 'a chart that marks every beat as a bar'],
        [124, 3, 'a fast song in 3/4'],
    ];
    for (const [bpm, beatsPerBar, what] of cases) {
        const got = staffSeconds(ctx, bpm, beatsPerBar);
        assert.ok(got >= C.PAGE_SECONDS - 0.01,
            `${what} at ${bpm}: a staff lasts ${got.toFixed(1)}s, `
            + `under the ${C.PAGE_SECONDS}s floor`);
    }
});

test('a slow song keeps the bars per staff it was asked for', () => {
    const ctx = sandbox();
    ctx.S = settings({ readMode: 'page' });
    for (const bpm of [70, 74, 84, 100]) {
        const map = ctx.buildTempoMap(chart(bpm, 60, 4));
        assert.equal(ctx.staffBars(map), ctx.S.pageBars,
            `${bpm} bpm should not be regrouped`);
    }
});

test('asking for more bars never gives you fewer', () => {
    // The first version of this rounded up to a whole MULTIPLE of the setting,
    // which reads well until the arithmetic lands just past a boundary: at 181
    // bpm, asking for three bars gave six while asking for four gave four. A
    // slider that goes backwards when you raise it is worse than one that does
    // not preserve the phrasing.
    const ctx = sandbox();
    for (const bpm of [70, 124, 181, 188, 201]) {
        let last = 0;
        for (const pageBars of [1, 2, 3, 4]) {
            ctx.S = settings({ readMode: 'page', pageBars: pageBars });
            const got = ctx.staffBars(ctx.buildTempoMap(chart(bpm, 60, 4)));
            assert.equal(got, Math.round(got), 'a staff holds whole bars');
            assert.ok(got >= pageBars, 'never fewer bars than were asked for');
            assert.ok(got >= last,
                `at ${bpm} bpm, ${pageBars} bars gives ${got} after `
                + `${pageBars - 1} gave ${last}`);
            last = got;
        }
    }
});

test('a staff never grows past the beats it can hold legibly', () => {
    const ctx = sandbox();
    ctx.S = settings({ readMode: 'page', pageBars: 4 });
    const map = ctx.buildTempoMap(chart(240, 60, 4));
    assert.ok(ctx.staffBars(map) * map.beatsPerBar <= C.PAGE_MAX_BEATS);
});

test('regrouped staves still start on a bar line', () => {
    const ctx = sandbox();
    ctx.S = settings({ readMode: 'page' });
    const map = ctx.buildTempoMap(chart(201, 60, 4));
    assert.ok(ctx.staffBars(map) > ctx.S.pageBars,
        'this song is meant to be regrouped');
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

// ── The panel's own mousedown ────────────────────────────────────────────────
//
// The panel drops the mousedown default so that focusing a control cannot
// scroll the presets off the top. It used to drop it for an INPUT too, which
// is a default that is not ours to cancel: it is how a slider is dragged and a
// checkbox is ticked. Chromium happened to survive it; that is not a thing to
// depend on. The real listener is pulled out of source and run against fake
// events.

function mousedownListener() {
    const marker = "controlPanel.addEventListener('mousedown', ";
    const at = SRC.indexOf(marker);
    assert.notEqual(at, -1, 'the panel no longer binds mousedown');
    // extractFunction returns the signature too, so this is already the whole
    // arrow function — wrapping it in another one would just curry it.
    const fn = extractFunction(SRC.slice(at), '(ev) => ');
    const ctx = vm.createContext({
        window: { requestAnimationFrame: (fn) => fn() },
        controlPanel: { scrollTop: 0 },
        requestAnimationFrame: (fn) => fn(),
    });
    return vm.runInContext('(' + fn + ')', ctx);
}

function fakeEvent(tagName) {
    return {
        target: { tagName: tagName },
        prevented: false,
        preventDefault() { this.prevented = true; },
    };
}

test('an input keeps the mousedown default it is operated with', () => {
    const on = mousedownListener();
    for (const tag of ['INPUT', 'SELECT']) {
        const ev = fakeEvent(tag);
        on(ev);
        assert.equal(ev.prevented, false,
            `${tag} should be left to handle its own mousedown`);
    }
});

test('a button still loses it, so the presets stay put', () => {
    const on = mousedownListener();
    const ev = fakeEvent('BUTTON');
    on(ev);
    assert.equal(ev.prevented, true);
});
