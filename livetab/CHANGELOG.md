# Changelog — Live Tab

All notable changes to this plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and it follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions before 0.26.1 were never published; the history starts at the first
public alpha.

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
