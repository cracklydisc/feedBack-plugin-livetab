# Changelog — Live Tab

All notable changes to this plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and it follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions before 0.26.1 were never published; the history starts at the first
public alpha.

## [0.29.0] — 2026-09-03

One release, not ten. The version in `plugin.json` moved from 0.29.0 to 0.38.0
during development — those numbers were working markers between commits on an
unreleased branch, not releases, and treating them as such would have implied
nine versions nobody could install. The release after 0.28.0 is this one.

### Added

- **The shared design system.** Live Tab draws its settings screen and its
  in-player panel from the plugin kit that Riff Repeater uses, so the two
  plugins are the same object rather than two things that resemble each other.
  The kit is vendored, not imported — copied into `src/kit/` — because any
  plugin can be disabled and there is no load order to rely on.
- **The settings screen is built from the schema.** Every control is chosen by
  the shape of the value it edits rather than picked by hand: a bool gets a
  toggle, up to four options get a segmented control, a runtime list gets a
  native select, a short range gets a stepper and a long one a slider. Adding
  a setting no longer means deciding what it should look like.
- **Hammer-on, pull-off, bend, harmonic, tap, accent and dead notes are drawn.**
  The chart already carried all of it and none of it was on the staff. Each is
  drawn as what it is: a bend is an arc that rises with an arrowhead and the
  distance written at its head, a harmonic is a diamond head rather than a
  circle with a diamond around it, a dead note is an `×` in the head, and a
  slur is a circular arc between the two notes it joins.
- **One badge for every technique symbol.** `H`, `P`, `T` and the accent share
  a dark disc with a ring and the symbol inside — the same dark plate the bar
  and section labels use — so they read as one family and stay legible over a
  coloured string. The accent is drawn as a wedge rather than typed as `>`,
  which in a mono face is punctuation sitting on the text baseline.
- **A showcase pack.** `tools/make-showcase-feedpak.py` builds a song whose
  fifteen sections exercise every notation field the format has, so a defect in
  the drawing of an articulation is visible before it ships instead of being
  reported from a real song weeks later. It has already found four.

### Changed

- **The verdict colours the whole note, and it fills as you hold it.** Only the
  head turned green: on a long sustain or a vibrato — where the tail *is* the
  note, and the biggest thing on the staff — the feedback was about the circle
  at the left while the part you were actually playing said nothing. Now the
  stretch already under the cursor takes the verdict's colour and the stretch
  ahead keeps the string's, with a hard edge at the playhead, so the green
  fills the note from left to right as you hold it. Slide bands, their arrival
  heads, bend arcs and the bend amount follow the same rule. One flat colour
  would have said "this note went well" while the note was still going, which
  on a two-bar hold is an answer given before the question.
- **A note swells while you are playing it.** The heads have always grown on
  the beat they land on; a long note's head is long gone by the time you are
  holding it, and under the cursor there was only the tail, the same thickness
  from end to end — the one part you were playing was the one part not saying
  so. It now thickens while the cursor is inside it, capped at the string
  spacing so a held chord does not merge into one smear. With the green filling
  from the left, that is two signals for the same fact: one of colour, one of
  weight.
- **Outside the zone the notes lose their colour.** With a loop or a drill
  running, what comes before and after is context, not something to play in
  this pass — and it was drawn in the same ink as the passage, six coloured
  strings identical either side, so the part you were working on had only a 10%
  background wash to distinguish it. Outside is greyscale now (`dim` at 55%,
  still readable because it is still the context the passage comes out of).
  Which zone: the *judged* window when a drill is running, the loop otherwise —
  the run-in sits inside the loop and outside the score, and grey tells the
  truth about it.
- **A drill's run-in reads as a run-in.** The drill opens its loop five
  seconds before the bars you picked so you do not arrive at a sprint, and
  `getLoop()` reports that earlier point — so the tab showed the loop starting
  at bar 42 when you had asked for 45, greens and reds inside it, and the
  Repeater's counter looked wrong for starting where it does. The judged window
  comes from `getConductorState().range`, and it now gets a second wash and a
  dashed line on its first edge: the run-in stays inside the loop, because you
  need to hear it, but it reads as approach rather than as the passage. Notes
  in it carry no verdict either — the detector judges them, nothing counts
  them, and red on an uncounted note is a lie about your own score.
- **The panel stops closing when you pause** (kit): the transport and the
  player's rail are no longer "outside" for the dismiss-on-outside-click rule.
- **A note the cursor has not reached carries no verdict.** After a loop
  restart the first notes came back wearing the previous pass's judgments,
  green and red, ahead of the playhead. Two sources, one rule. The green was
  the detector's: `noteStateFor` returns a full-strength hit whenever
  `age = songT - dispAnchor` is negative, commented "struck a hair early" —
  which on a gem highway means milliseconds, while a loop wrap moves the clock
  back by seconds and drops the whole previous pass into that branch. Not a
  defect for a renderer that never draws what is behind the wrap; a tablature
  draws a window of notes *ahead* of the cursor and is handed all of it. The
  red was ours, the verdict memory filling the gap the detector leaves on a
  miss after the jump. Both are gone now, because a verdict is a statement
  about something you played.
- **A verdict is remembered while the note is on screen.** The detector reports
  a miss for 0.6s (`NOTE_MISS_GEM_TTL`) and a hit for the length of its glow,
  which is right for a gem that scrolls away — but a tablature keeps the note
  in view, so after those six tenths it went back to grey at 30%: "nothing
  happened" in place of "you missed this one". The first verdict is kept now,
  and the provider still wins whenever it has something to say; the memory
  fills gaps, it never invents a judgment or anticipates one. Time running
  backwards — a loop, a seek, a new song — drops it, or a Riff Repeater loop
  would show the last pass's red before you played the note.
- **The drawing reads the kit's tokens.** Colours and type come from the theme
  at draw time rather than from constants in this file, so the staff follows
  the same palette as every panel. A canvas cannot inherit a custom property,
  so it is read with `getComputedStyle`.
- **The bar numbers are out from under the notes.** The lanes above the strings
  were pinned at fixed distances from the top string while a note head sticks
  up by its own radius and a technique badge by more than twice that, so at any
  note size above the smallest the header sat inside the notes. The stack is
  now built upward from the head, and the bar line lengthens with it. The room
  reserved above the strings is the minimum, and the lanes spend the air a
  centred staff already leaves over — so on a single staff they rise well clear
  at no cost to note size.
- **A sustain tail says how long the note is.** It used to fade out over its
  last quarter, and a fade says "somewhere around here": the visible end fell
  short of the real one, which is exactly how a duration gets misread. The tail
  is now solid to the sustain's true end and closes with a tick, and it is
  thicker — taken off the head radius rather than a fixed pixel count.
- The in-player panel is the kit's folded strip: a footswitch for stop, a
  single `OPEN` affordance, and A/B markers with brackets on a padded timeline
  instead of full-height rules.

- **The tab's own controls are on the kit's dark ground.** The settings sheet's
  chips and the stepper's `−`/`+` sat on a lighter tone than the select beside
  them — two controls in one panel on two different grounds. Fixed in the kit
  (0.29.0) and re-vendored, so Riff Repeater moves with it: a control rests in
  the ground, the hairline says it is a control, the accent says which one you
  picked.
- **The look-ahead wash is lighter** — accent at 0.07 rather than 0.12. A veil
  that tints what you are reading works against the only thing this page is
  for, and the region still reads: what has to be visible is its edge, not the
  veil.

### Fixed

- **A plugin panel could vanish from the player's controls.** The kit's slot
  watch gave up twelve seconds after attaching, so a player that rebuilt its
  control slot after that lost the Tab view button for the rest of the session
  — and the plugin could not tell, because `mountControls()` reports success as
  soon as its panel object exists. Fixed in the kit (a resting heartbeat that
  never stops) and re-vendored.
- **Chord names never drew, on any song with phrase data.** The plugin asked
  for the difficulty-filtered chord list and fell through to the raw one only
  when the answer was falsy — and an empty array is truthy, so a chart whose
  phrases carry notes but no chords reported zero chords for ever. Both lists
  are now consulted, and the fallback is on emptiness rather than on absence.
- **The bend section drew tails with no note heads.** A stray `r` in the tails
  pass — where the head radius does not exist — threw a ReferenceError every
  frame a bend was in view, and the per-staff guard abandoned the staff between
  the two passes. There is now a test that walks brace depth over that pass.
- **A fret number sat above the centre of its head.** `actualBoundingBox`
  metrics are relative to the *current* text baseline, and the baseline was
  being set after the measurement — so a 38px digit was corrected by 2.8px
  instead of 12. Every isolated test passed, because a scratch canvas starts
  clean.
- **A toggle never showed its on state.** The switch's DOM order is input,
  text, track — the label was deliberately moved in front of the switch — while
  three rules still read `input:checked + .fbk-toggle-track`, the *immediately*
  next sibling. The immediately next sibling is the text, so those rules
  matched nothing: clicking set the value and the switch stayed dark. The line
  below it used `~`, so the label brightened while the track did not — half the
  control saying one thing and half the other. Fixed in the kit with a test
  that derives the child order from the builder and checks every combinator can
  still reach across it.
- **The settings page has no header of its own.** "Tab view" and its subtitle
  sat inside a page already titled Settings that lists the plugins by name — a
  second title telling the reader they had entered somewhere new when they had
  not. A panel that opens over the game needs to say what it is, because it
  arrives with no frame; here the frame is the page.
- **"Match my instrument's strings" is on by default.** It only ever does
  anything when your instrument has more strings than the chart and is the same
  family, so for most players flipping it changed nothing — and when it does
  apply, matching is what you want: a line on the screen being a string on the
  neck is the whole value of a tablature. The hint now also gives the reason to
  turn it off, which it never had: the extra line costs vertical space, so the
  heads come down with it.
- **Every control starts at the same place.** The field row sized its label to
  its own text, so with the real labels — FRET NUMBERS, STRING CONTRAST, WHAT
  THE NOTE HEAD SAYS — each control began at a different x: nine of them on one
  page. The kit already had the rule for this (§1.4, one label column) and the
  field component had never used it; it does now, and the sheet takes a wider
  column than a panel because its rows are twice as wide. Two start positions
  left: the label column, and the controls that carry their own name.
- **A stepper is the same control here as in the panel.** Stretched to a
  settings row it became 532px wide, with the `−` and `+` at opposite ends and
  the label adrift between them — the same markup reading as a different
  control. It now grows to the size it has in the panel and stops.
- **A control's boundary is its own again.** The row drew a well with a stroke
  and stripped whatever it contained, on a one-signal-per-boundary rule applied
  downward: inside a row a stepper became a floating `−` and `+` and a
  segmented became two words. The design puts the boundary on the control —
  the slider is a bare row with its groove, the select is a box, the stepper is
  a well with its buttons inside — so the row is a row again, and a stepper or
  a toggle takes its whole width. An empty field label no longer prints the
  divider it was drawn to carry.
- **The settings page no longer explains how settings pages work.** "Changes
  apply live · saved per song" sat under the title on every sync; in a page of
  options that is a description of every page of options. The subtitle now
  names what the options apply to — artist, song, arrangement — which shows the
  "saved per song" part instead of asserting it, and the footer line is quiet
  unless it has news (the tab being hidden).
- **A partial bend was the illegible one.** `½` and `¼` are single
  typographic glyphs drawn a little over half height inside the em, so beside
  `full` — four letters at full size — a semitone read at half the scale.
  Written `1/2` and `1/4` now: three full-size figures at `full`'s scale, and
  tablature writes both forms. The amount also sits on the same dark plate as
  every other label on the staff, which it was the last one without.
- **A slide's arrival is a head at full weight.** It was a circle at 83% with
  its number at 85% and no capsule, so a two-digit destination was three
  reductions stacked on the same figure. Same radius, same font, same capsule
  as a played note now — hollow, with a thinner ring, because the difference
  between picked and reached is weight, not size.
- **`H` and `P` fill their badge.** Reported as not centred; measured three ways
  — font metrics, the live canvas pixels, the badge redrawn at 8× — the letter
  is centred to within 0.13px on both axes, so there was no centring error to
  correct. There was a letter 39% of the disc's height inside a ring that
  fades, and a small letter in a large disc reads as a letter set wrong. At 52%
  it becomes the disc's content. The plate is opaque too: the slur's arc
  arrives tangent to the bottom edge and at 92% showed through.
- Page view no longer loses the staves below the first when one of them throws,
  and a fault is reported once rather than sixty times a second.

## [0.28.0] — 2026-09-01

### Added

- **A rhythm ruler.** Note spacing was already proportional to note value, so
  where a note sits between two beats already *is* its rhythm — there was just
  nothing to count it against. The staff is now ruled at whole beats, and at
  halves and quarters of a beat when there is room to tell them apart, each
  weight fainter than the last so the lines are something to land on rather
  than something to read. Off, whole beats, or subdivided: your choice.
- **The loop, drawn on the staff.** When a loop is armed, the stretch that
  repeats is shaded and its ends are marked with repeat signs — the heavy bar,
  thin line and two dots every musician already reads — in the same green as
  the app's own loop buttons. Learning a passage is playing it round and round,
  and the thing that gets lost is where round begins.
- Live Tab declares itself to the app's capability graph as a visualization
  provider, and reports when its renderer comes up or fails to. It was a blank
  row in the Capability Inspector before, which is unhelpful to anyone trying
  to work out why a player is empty.

### Changed

- **Bars per staff is one slider, 1 to 8, the same on every song.** Three is
  the default: it lasts between three and a half and thirteen seconds depending
  on the tempo, and holds twelve beats, which stays legible at any width. There
  is no automatic count and nothing that changes from song to song, because
  with bar lines read correctly none of that is needed. Past eight a fret
  number has under 30 pixels to itself and the heads start touching.
- **The repository is now the plugin, so it can be cloned into place.** Install
  it with `git clone … livetab` inside your plugins folder and the app can
  update it for you from **Plugins → Check for Updates**. That already worked
  for any plugin that is a git checkout; Live Tab was shaped so that it could
  never be one, which is why nobody on 0.26.1 ever heard about 0.27.0. The ZIP
  install still works, and still cannot update itself.

### Fixed

- **Bar lines were miscounted on charts that spell out every beat.** A bar line
  is where the measure *number changes*, not merely where a beat carries one.
  Most charts tag only the downbeat, but one tags every beat and repeats the
  number — 1,1,1,1, 2,2,2,2 — which is a plain 4/4 written out beat by beat.
  Reading it the old way gave that chart four bars for every real one: a
  picket fence of bar lines and numbers, and a staff that held a quarter of the
  music it should. Across a library of forty charts the two readings agree
  everywhere else. *(This was the real cause behind the bars-per-staff
  complaints; the automatic count and the moving slider ceiling that were
  briefly built to compensate for it are gone with it.)*
- Re-running the plugin's script — which the app does on update, rollback and
  reinstall — used to leave the previous run's settings panel orphaned in the
  page, its theme listener still firing and its retry timer still ticking. Each
  run now dismantles its predecessor first.

## [0.27.0] — 2026-09-01

### Changed

- **The reading speed no longer follows the tempo.** Both reading modes were
  sized in musical units — beats for the scrolling window, bars for a staff —
  which is right for note spacing and wrong for speed: it made the pixels per
  second proportional to the tempo. Since a display holds each frame for one
  refresh, a moving glyph is smeared over speed÷refresh pixels. Measured across
  forty charts at the default setting: 294 px/s and a 5 px smear at 70 bpm,
  848 px/s and 14 px at 201 — wider than a fret digit. Above 120 bpm the
  scrolling window now widens with the tempo, up to twice what was asked for,
  so a fast song reads at the pace of a moderate one. Below 120 nothing
  changes. *(Reported by three players: "slow songs perfect, fast songs
  blurry".)*
- **A staff in page turns lasts long enough to read.** A fast song is given
  enough bars for four seconds of music. One chart in testing marked every
  single beat as a bar line, which made a two-bar staff last 1.1 seconds and
  turned the page once a second. Moving the bars-per-staff slider takes the
  decision back for that song; a preset puts the default back.
- **The panel says what it draws.** Where the correction is lifting a setting,
  both numbers are shown — `Ahead 5 → 7.5`, `Bars per staff 2 → 4` — so a
  slider never reads 2 while four bars are on screen.
- **The panel follows the app's theme.** It carried its own hardcoded palette,
  so equipping a theme recoloured everything around it and left it behind. It
  now reads the host's palette and repaints when a theme changes, including
  picking a text colour that stays legible on a light accent.
- The in-player panel moved into the player at the popover stacking level the
  v3 UI contract sets, instead of floating above it against the page.

### Notes for upgraders

Nothing to do. Saved settings carry over; an option from the alpha that no
longer exists is dropped on load.

## [0.26.2] — 2026-08-31

### Fixed

- **The in-player panel is parked in the corner**, the way the app's own note
  boards park theirs. Anchored to its button it was clipped by the player's
  scrolling area, so the presets and the first settings were unreachable on
  some layouts, and changing a preset moved the panel under the pointer.
  *(Reported by zMenta.)*

## [0.26.1] — 2026-08-31

First public alpha.

### Added

- **A tablature that stays legible while it moves.** Positions are measured in
  beats over a cleaned copy of the chart's beat grid, so note spacing is
  proportional to note value and the tab advances one beat per beat.
- **Two ways to read** — a scrolling staff under a fixed cursor, or page turns
  where each staff holds whole bars and the stack slides up by one staff at the
  end of a line.
- **A note board hosted above the tab** — the 3D Highway and the other bundled
  renderers — so neither covers the other.
- **Notation**: slides, hammer-ons and pull-offs, harmonics, vibrato, bend
  depth, palm mute, accents, taps, fret-hand mutes and linked notes.
- **Around the staff**: bar numbers, section names, chord names, tempo, the
  open note of every string read from the song's own tuning, and lyrics under
  the notes they land on.
- **Hit and miss from the host's note-state provider**, so a fret number turns
  green or red in the same frame the gem does.
- **Four to eight strings**, guitar or bass.
- **Presets** — Live, Study, Sight-reading, Arcade, Minimal — with every
  advanced option folded away underneath.
- **Copy diagnostics** in the settings panel: the plugin version, what it found
  in the host, and what the chart looks like from the inside, so a bug can be
  diagnosed without anyone having to own the chart.
