# Changelog — Live Tab

All notable changes to this plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and it follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions before 0.26.1 were never published; the history starts at the first
public alpha.

## [0.38.0] — 2026-09-03

### Changed

- **The bar numbers are out from under the notes.** The lanes above the strings
  — bar number, chord name, section — were pinned at fixed distances from the
  top string while a note head sticks up by its own radius and a technique
  badge by more than twice that, so at any note size above the smallest the
  header sat inside the notes. They are now built upward from the head: the
  clearance is measured, not guessed, and the bar line lengthens with the
  stack. The room reserved above the strings is the minimum, and the lanes
  spend the air that the centred staff leaves over — so on a single staff they
  rise well clear at no cost to note size, which is where they were reported.
- **A sustain tail says how long the note is.** It used to fade out over its
  last quarter, and a fade says "somewhere around here": the visible end fell
  short of the real one, which is exactly how a duration gets misread. The
  tail is now solid to the sustain's true end and closes with a tick, so there
  is one place to look and it is the right one. It is also thicker, taken off
  the head radius rather than a fixed pixel count.
- **One badge for every technique symbol.** `H` and `P` wore a pill with legs,
  `T` and the accent were bare 9px glyphs in the faintest ink on the staff —
  three drawings for one kind of information. All four now share a dark disc
  with a ring and the symbol inside, the same dark plate the bar and section
  labels use, so they read as a family and stay legible over a coloured
  string. The accent is drawn as a wedge rather than typed as `>`, which in a
  mono face is punctuation on the text baseline.
- **Hammer-on and pull-off are a circular arc with the badge above it.** The
  arc's radius is derived from its sagitta and half-chord, so it is a true
  circle rather than a parabola that resembles one, and the badge is clamped
  so it can never climb into the bar-number lane.

### Fixed

- **The bend section drew tails with no note heads.** A second `r` in the
  tails pass — where the head radius does not exist — threw a ReferenceError
  every frame a bend was in view, and the per-staff guard abandoned the staff
  between the two passes. The earlier fix had corrected the line above it and
  left this one sitting under a comment explaining the very defect. There is
  now a test that walks brace depth over that pass; the first version of it
  counted occurrences and passed with the bug put back, which is worse than no
  test at all.

Versions 0.29.0 through 0.37.0 shipped without changelog entries; their detail
is in the git history.

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
