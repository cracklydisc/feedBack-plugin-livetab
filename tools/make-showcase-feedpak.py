# -*- coding: utf-8 -*-
"""
make-showcase-feedpak.py — un brano di prova che contiene ogni caso di una tab.

PERCHE ESISTE
-------------
Le articolazioni di questo renderer — hammer-on, pull-off, bend, slide,
vibrato, tremolo, armonici, tap, accenti, mute, legature — sono disegnate da
sempre, e non erano mai state GUARDATE, perche nessun brano della libreria di
prova ne contiene una. Il difetto che si trova cosi non e "non funziona": e
"nessuno sa come si legge", che e peggio e si scopre suonando.

Quindi: un pacchetto autorato a mano, una sezione per caso, a un tempo lento,
con il testo che dice cosa stai guardando. Nessuna canzone vera lo farebbe —
ed e il punto.

COM'E FATTO
-----------
Dichiarativo: `SECTIONS` e una tabella di sezioni e ognuna produce le sue note
da una funzione. Aggiungere un caso e aggiungere una riga, non modificare il
generatore — che e la ragione per cui questo e uno script e non un file JSON
scritto una volta.

Lo stem e un CLICK TRACK generato qui: un burst di seno per battito, piu acuto
sul primo di ogni battuta. Serve perche una tab si prova a tempo, e un brano
muto non dice se le note cadono dove le senti.

USO
---
    python tools/make-showcase-feedpak.py [--out DIR] [--bpm 80] [--validate]

Scrive `Tab Showcase - Every Notation [showcase].feedpak` in DIR (di default la
libreria dell'installazione portatile, se c'e, altrimenti la cartella corrente).

CAMPI DELLE NOTE, dal contratto in `feedBack/lib/song.py::note_to_wire`:
    t s f sus sl slu bn ho po hm hp pm mt vb tr ac tp
  piu, omessi quando falsi: ln fhm plk slp rh pkd ig
"""

import argparse
import json
import math
import os
import struct
import subprocess
import sys
import wave
import zipfile
import zlib

# ── il metro ─────────────────────────────────────────────────────────────
#
# Un tempo lento e onesto: tutto quello che questo pacchetto esiste per
# mostrare deve essere leggibile fermo, prima di chiedersi se lo e in
# movimento.
DEFAULT_BPM = 80.0
BEATS_PER_BAR = 4
BARS_PER_SECTION = 4

STRINGS = 6                     # 0 = mi cantino, 5 = mi basso (ordine dell'app)


def bar_time(bpm, bar):
    """Il tempo in secondi dell'inizio della battuta `bar` (1-based)."""
    return (bar - 1) * BEATS_PER_BAR * (60.0 / bpm)


def beat_time(bpm, bar, beat):
    """`beat` e 1-based dentro la battuta, e puo essere frazionario."""
    return bar_time(bpm, bar) + (beat - 1) * (60.0 / bpm)


def note(t, s, f, **kw):
    """Una nota. I campi ai valori di default si omettono, come la specifica."""
    n = {'t': round(t, 3), 's': s, 'f': f}
    for k, v in kw.items():
        if v in (None, False, 0, -1, ''):
            continue
        n[k] = round(v, 3) if isinstance(v, float) else v
    return n


# ══════════════════════════════════════════════════════════════════════════
# Le sezioni: una per caso. Ognuna riceve (bpm, bar0) e rende le sue note.
# ══════════════════════════════════════════════════════════════════════════

def s_plain(bpm, b0):
    """Una nota per battito, su ogni corda: il caso base e la scala verticale."""
    out = []
    for i in range(BEATS_PER_BAR * BARS_PER_SECTION):
        bar, beat = b0 + i // BEATS_PER_BAR, 1 + i % BEATS_PER_BAR
        out.append(note(beat_time(bpm, bar, beat), i % STRINGS, 3 + (i % 5)))
    return out


def s_sustain(bpm, b0):
    """Note tenute: la coda deve dire quanto dura, non solo che c'e."""
    out = []
    for i in range(BARS_PER_SECTION * 2):
        bar, beat = b0 + i // 2, 1 + (i % 2) * 2
        out.append(note(beat_time(bpm, bar, beat), 2 + (i % 3), 5 + (i % 4),
                        sus=(60.0 / bpm) * (1.5 if i % 2 else 0.75)))
    return out


def s_palm(bpm, b0):
    """Palm mute: ottavi sulla corda bassa, la riga P.M. sotto il pentagramma."""
    out = []
    for i in range(BEATS_PER_BAR * BARS_PER_SECTION * 2):
        bar, beat = b0 + i // (BEATS_PER_BAR * 2), 1 + (i % (BEATS_PER_BAR * 2)) * 0.5
        out.append(note(beat_time(bpm, bar, beat), 5, 0, pm=True))
    return out


def s_hopo(bpm, b0):
    """Hammer-on e pull-off: coppie vicine, che e il caso in cui l'arco serve."""
    out = []
    for i in range(BARS_PER_SECTION * 2):
        bar, beat = b0 + i // 2, 1 + (i % 2) * 2
        t = beat_time(bpm, bar, beat)
        s = 2 + (i % 2)
        up = (i % 2 == 0)
        # NIENTE `ln` QUI, ed era un difetto del pacchetto, non del renderer.
        #
        # `ln` vuol dire "tenuta, non ribattuta" e `ho` vuol dire "attaccata
        # martellando": sono alternative, non cumulabili. Marcandole entrambe,
        # la seconda nota risultava legata E martellata, e usciva con le
        # parentesi della legatura dentro la capsula sotto l'arco della
        # legatura di espressione — quattro segni per un'idea. Il renderer
        # disegnava correttamente una cosa che non esiste.
        out.append(note(t, s, 5))
        out.append(note(t + (60.0 / bpm) * 0.5, s, 7 if up else 3,
                        ho=up, po=not up))
    return out


def s_slides(bpm, b0):
    """Slide con destinazione, e slide senza (`slu`), in su e in giu."""
    out = []
    cases = [(5, 9, False), (9, 5, False), (7, 12, True), (12, 7, True)]
    for i in range(BARS_PER_SECTION * 2):
        bar, beat = b0 + i // 2, 1 + (i % 2) * 2
        a, b, un = cases[i % len(cases)]
        kw = {'slu': b} if un else {'sl': b}
        out.append(note(beat_time(bpm, bar, beat), 3, a,
                        sus=(60.0 / bpm) * 1.2, **kw))
    return out


def s_bends(bpm, b0):
    """Bend a un quarto, a mezzo e pieno: l'arco e la freccia hanno tre altezze."""
    out = []
    for i in range(BARS_PER_SECTION * 2):
        bar, beat = b0 + i // 2, 1 + (i % 2) * 2
        semis = [0.5, 1.0, 2.0, 1.0][i % 4]
        out.append(note(beat_time(bpm, bar, beat), 1 + (i % 2), 7,
                        sus=(60.0 / bpm) * 1.0, bn=semis))
    return out


def s_vibrato(bpm, b0):
    """Vibrato e tremolo: l'onda sulla coda, e la coda tremolata."""
    out = []
    for i in range(BARS_PER_SECTION * 2):
        bar, beat = b0 + i // 2, 1 + (i % 2) * 2
        out.append(note(beat_time(bpm, bar, beat), 2, 9,
                        sus=(60.0 / bpm) * 1.5,
                        vb=(i % 2 == 0), tr=(i % 2 == 1)))
    return out


def s_harmonics(bpm, b0):
    """Armonico naturale e pizzicato: il rombo, pieno per il pinch."""
    out = []
    for i in range(BARS_PER_SECTION * 2):
        bar, beat = b0 + i // 2, 1 + (i % 2) * 2
        out.append(note(beat_time(bpm, bar, beat), 3 + (i % 2), 12,
                        sus=(60.0 / bpm) * 0.9,
                        hm=(i % 2 == 0), hp=(i % 2 == 1)))
    return out


def s_touch(bpm, b0):
    """Tap, accento, fret-hand mute e mute: i segni sopra e dentro la testa."""
    out = []
    flags = [{'tp': True}, {'ac': True}, {'fhm': True}, {'mt': True}]
    for i in range(BEATS_PER_BAR * BARS_PER_SECTION):
        bar, beat = b0 + i // BEATS_PER_BAR, 1 + i % BEATS_PER_BAR
        out.append(note(beat_time(bpm, bar, beat), 4, 7, **flags[i % 4]))
    return out


def s_twodigit(bpm, b0):
    """Tasti a due cifre: la testa diventa una capsula e deve restare in riga."""
    out = []
    frets = [12, 14, 16, 19, 21, 22, 17, 15]
    for i in range(BARS_PER_SECTION * 2):
        bar, beat = b0 + i // 2, 1 + (i % 2) * 2
        out.append(note(beat_time(bpm, bar, beat), 1, frets[i % len(frets)]))
    return out


def s_dense(bpm, b0):
    """Sedicesimi: il caso in cui la densita si risolve allargando."""
    out = []
    per_bar = BEATS_PER_BAR * 4
    for i in range(per_bar * BARS_PER_SECTION):
        bar = b0 + i // per_bar
        beat = 1 + (i % per_bar) * 0.25
        out.append(note(beat_time(bpm, bar, beat), 0 if i % 2 else 1,
                        5 + (i % 4)))
    return out


def s_jumps(bpm, b0):
    """Salti di posizione: dal 3 al 15 e ritorno, per la mano e per gli anchor."""
    out = []
    frets = [3, 15, 5, 17, 7, 19, 3, 12]
    for i in range(BARS_PER_SECTION * 2):
        bar, beat = b0 + i // 2, 1 + (i % 2) * 2
        out.append(note(beat_time(bpm, bar, beat), 3, frets[i % len(frets)]))
    return out


def s_chords(bpm, b0):
    """Accordi: teste impilate, dal bicordo alla forma a cinque corde."""
    out = []
    shapes = [
        [(1, 5), (2, 7)],
        [(0, 3), (1, 5), (2, 5)],
        [(1, 7), (2, 9), (3, 9), (4, 7)],
        [(0, 5), (1, 5), (2, 5), (3, 7), (4, 7)],
    ]
    for i in range(BARS_PER_SECTION * 2):
        bar, beat = b0 + i // 2, 1 + (i % 2) * 2
        t = beat_time(bpm, bar, beat)
        for (s, f) in shapes[i % len(shapes)]:
            out.append(note(t, s, f, sus=(60.0 / bpm) * 0.8))
    return out


def s_ties(bpm, b0):
    """Legature: la nota tenuta si scrive fra parentesi, non ribattuta."""
    out = []
    for i in range(BARS_PER_SECTION):
        bar = b0 + i
        t = bar_time(bpm, bar)
        step = 60.0 / bpm
        out.append(note(t, 2, 7, sus=step * 0.9, ln=True))
        out.append(note(t + step, 2, 7, sus=step * 0.9, ln=True))
        out.append(note(t + step * 2, 2, 7, sus=step * 1.8))
    return out


def s_silence(bpm, b0):
    """Niente. Una sezione vuota e uno stato, e va disegnata come tale."""
    return []


SECTIONS = [
    ('plain',      'Single notes',        s_plain),
    ('sustain',    'Sustains',            s_sustain),
    ('palmmute',   'Palm mute',           s_palm),
    ('hopo',       'Hammer-on pull-off',  s_hopo),
    ('slides',     'Slides',              s_slides),
    ('bends',      'Bends',               s_bends),
    ('vibrato',    'Vibrato tremolo',     s_vibrato),
    ('harmonics',  'Harmonics',           s_harmonics),
    ('touch',      'Tap accent mute',     s_touch),
    ('twodigit',   'High frets',          s_twodigit),
    ('chords',     'Chords',              s_chords),
    ('ties',       'Ties',                s_ties),
    ('dense',      'Sixteenths',          s_dense),
    ('jumps',      'Position jumps',      s_jumps),
    ('silence',    'Nothing at all',      s_silence),
]


# ══════════════════════════════════════════════════════════════════════════
# Il pacchetto
# ══════════════════════════════════════════════════════════════════════════

def build(bpm):
    notes, sections, phrases, anchors = [], [], [], []
    bar = 1
    for i, (sid, label, fn) in enumerate(SECTIONS):
        t0 = bar_time(bpm, bar)
        sections.append({'name': sid, 'number': i + 1, 'time': round(t0, 3)})
        mine = fn(bpm, bar)
        notes.extend(mine)
        t1 = bar_time(bpm, bar + BARS_PER_SECTION)
        # ── I LIVELLI PORTANO LE NOTE, e questo non e' un dettaglio ─────
        #
        # L'app suona da `phrases[].levels[].notes`, non dall'array in cima:
        # quello e' l'insieme completo, i livelli dicono quali note
        # appartengono a quale difficolta. Con i livelli vuoti la scansione
        # registra `notes: 0` e il brano appare nella libreria e non ha niente
        # da suonare a nessuna difficolta — che e esattamente come si e'
        # presentato al primo tentativo.
        #
        # Una difficolta sola, con tutto dentro: e' il caso piu semplice che
        # sia valido, e un pacchetto di prova non deve anche esercitare la
        # riduzione progressiva.
        phrases.append({
            'start_time': round(t0, 3), 'end_time': round(t1, 3),
            'max_difficulty': 0,
            'levels': [{
                'difficulty': 0,
                'notes': [dict(n) for n in mine],
                'chords': [],
                'anchors': [{'time': round(bar_time(bpm, bar + b), 3),
                             'fret': 1, 'width': 4}
                            for b in range(BARS_PER_SECTION)],
                'handshapes': [],
            }],
        })
        # Un anchor per battuta, alla posizione piu bassa che la battuta chiede:
        # e cosi che l'app sa dove sta la mano, ed e cio che un salto deve far
        # vedere.
        for b in range(BARS_PER_SECTION):
            bt0 = bar_time(bpm, bar + b)
            bt1 = bar_time(bpm, bar + b + 1)
            here = [n['f'] for n in mine if bt0 <= n['t'] < bt1 and n['f'] > 0]
            anchors.append({'time': round(bt0, 3),
                            'fret': min(here) if here else 1, 'width': 4})
        bar += BARS_PER_SECTION

    notes.sort(key=lambda n: (n['t'], n['s']))
    total_bars = bar - 1 + 1
    duration = bar_time(bpm, total_bars + 1)

    # I battiti, con il numero di battuta: la griglia da cui la tab misura tutto.
    beats = []
    for b in range(1, total_bars + 2):
        for k in range(BEATS_PER_BAR):
            t = beat_time(bpm, b, 1 + k)
            if t > duration:
                break
            # `measure` su OGNI battito, non solo sul primo della battuta: lo
            # schema lo richiede sempre, e un pacchetto reale della libreria
            # sembrava dire il contrario solo perche i suoi battiti extra
            # cadono tutti su un inizio di battuta.
            beats.append({'time': round(t, 3), 'measure': b})

    # Gli accordi: raggruppo le note simultanee di piu di una corda.
    by_t = {}
    for n in notes:
        by_t.setdefault(n['t'], []).append(n)
    chords, handshapes, templates, cid = [], [], [], 0
    for t in sorted(by_t):
        group = by_t[t]
        if len(group) < 2:
            continue
        frets = [-1] * STRINGS
        for n in group:
            frets[n['s']] = n['f']
        name = 'Shape%d' % (cid + 1)
        templates.append({'name': name, 'displayName': name,
                          'frets': frets, 'fingers': [-1] * STRINGS})
        chords.append({'t': t, 'id': cid,
                       'notes': [{'s': n['s'], 'f': n['f']} for n in group]})
        handshapes.append({'chord_id': cid, 'start_time': t,
                           'end_time': round(t + 60.0 / bpm, 3)})
        cid += 1

    arrangement = {
        'name': 'Lead',
        'tuning': [0, 0, 0, 0, 0, 0],
        'capo': 0,
        'centOffset': 0,
        'notes': notes,
        'chords': chords,
        'anchors': anchors,
        'handshapes': handshapes,
        'templates': templates,
        'tones': {'base': 'showcase_clean', 'definitions': []},
        'phrases': phrases,
        'beats': beats,
        'sections': sections,
        'stats': {'events': len(notes) + len(chords), 'notes': len(notes)},
    }

    timeline = {
        'version': 1,
        # Un cambio di tempo e uno di metro, perche una tab deve reggerli:
        # la griglia si riscrive e le note non devono spostarsi.
        'tempos': [{'time': 0.0, 'bpm': bpm},
                   {'time': round(bar_time(bpm, 33), 3), 'bpm': bpm * 1.5}],
        'time_signatures': [{'time': 0.0, 'ts': [4, 4]},
                            {'time': round(bar_time(bpm, 45), 3), 'ts': [3, 4]},
                            {'time': round(bar_time(bpm, 49), 3), 'ts': [6, 8]}],
        'beats': beats,
        'sections': sections,
    }

    # Il testo nomina la sezione che stai guardando: un pacchetto di prova deve
    # dire di cosa e la prova.
    lyrics = []
    for i, (sid, label, fn) in enumerate(SECTIONS):
        words = label.split()
        t0 = bar_time(bpm, 1 + i * BARS_PER_SECTION)
        step = (BEATS_PER_BAR * BARS_PER_SECTION * (60.0 / bpm)) / max(1, len(words))
        for j, w in enumerate(words):
            lyrics.append({'t': round(t0 + j * step, 3),
                           'd': round(step * 0.8, 3), 'w': w})

    manifest = '\n'.join([
        'feedpak_version: "1.0.0"',
        'title: "Tab Showcase — Every Notation"',
        'artist: "feedBack plugin kit"',
        'album: "Test Assets"',
        'year: 2026',
        'authors:',
        '  - name: "make-showcase-feedpak.py"',
        '    role: "transcriber"',
        'duration: %.3f' % duration,
        'arrangements:',
        '  - id: "lead"',
        '    name: "Lead"',
        '    file: "arrangements/lead.json"',
        '    type: "guitar"',
        '    tuning: [0, 0, 0, 0, 0, 0]',
        '    capo: 0',
        '    event_count: %d' % (len(notes) + len(chords)),
        '    note_count: %d' % len(notes),
        'stems:',
        '  - id: "full"',
        '    file: "stems/full.ogg"',
        '    name: "Click track"',
        '    codec: "vorbis"',
        '    default: true',
        'preview: "preview.ogg"',
        'cover: "cover.png"',
        'lyrics: "lyrics.json"',
        'lyrics_source: "authored"',
        'language: "en"',
        'lyric_tracks:',
        '  - id: "original"',
        '    file: "lyrics.json"',
        '    language: "en"',
        '    kind: "original"',
        '    lyrics_source: "authored"',
        '    name: "Section names"',
        'song_timeline: "song_timeline.json"',
        '',
    ])
    return manifest, arrangement, timeline, lyrics, duration, beats


def click_wav(path, beats, duration, rate=44100):
    """
    Un click per battito, piu acuto sul primo di ogni battuta.

    Serve perche una tab si prova A TEMPO: un pacchetto muto non dice se una
    nota cade dove la senti, che e meta di cio che una tab deve dimostrare.
    """
    total = int(duration * rate) + rate
    buf = bytearray(total * 2)
    for b in beats:
        f0 = 1600.0 if 'measure' in b else 900.0
        start = int(b['time'] * rate)
        n = int(0.035 * rate)
        for i in range(n):
            if start + i >= total:
                break
            env = math.exp(-6.0 * i / n)
            v = int(12000 * env * math.sin(2 * math.pi * f0 * i / rate))
            struct.pack_into('<h', buf, (start + i) * 2, max(-32767, min(32767, v)))
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(buf))


def solid_png(path, w=512, h=512, rgb=(6, 9, 18)):
    """Una copertina: il fondo del design system, generata senza dipendenze."""
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)


def to_ogg(wav, ogg):
    """ffmpeg se c'e; altrimenti si tiene il WAV e la specifica lo accetta."""
    try:
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav,
                        '-c:a', 'libvorbis', '-q:a', '3', ogg],
                       check=True)
        return True
    except Exception as err:
        print('  ffmpeg non disponibile (%s) — resto sul WAV' % err)
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=None)
    ap.add_argument('--bpm', type=float, default=DEFAULT_BPM)
    ap.add_argument('--validate', action='store_true')
    args = ap.parse_args()

    out = args.out
    if not out:
        lib = os.path.expanduser('~/Desktop/Feedback/song')
        out = lib if os.path.isdir(lib) else '.'

    manifest, arrangement, timeline, lyrics, duration, beats = build(args.bpm)
    tmp = os.path.join(out, '_showcase_tmp')
    os.makedirs(tmp, exist_ok=True)
    wav = os.path.join(tmp, 'full.wav')
    ogg = os.path.join(tmp, 'full.ogg')
    png = os.path.join(tmp, 'cover.png')
    click_wav(wav, beats, duration)
    solid_png(png)
    have_ogg = to_ogg(wav, ogg)

    name = 'Tab Showcase - Every Notation [showcase].feedpak'
    path = os.path.join(out, name)
    stem_name = 'stems/full.ogg' if have_ogg else 'stems/full.wav'
    if not have_ogg:
        manifest = manifest.replace('stems/full.ogg', 'stems/full.wav')
        manifest = manifest.replace('codec: "vorbis"', 'codec: "pcm"')
        manifest = manifest.replace('preview: "preview.ogg"', 'preview: "preview.wav"')

    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.yaml', manifest)
        z.writestr('arrangements/lead.json', json.dumps(arrangement))
        z.writestr('song_timeline.json', json.dumps(timeline))
        z.writestr('lyrics.json', json.dumps(lyrics))
        z.write(png, 'cover.png')
        z.write(ogg if have_ogg else wav, stem_name)
        z.write(ogg if have_ogg else wav,
                'preview.ogg' if have_ogg else 'preview.wav')

    for f in (wav, ogg, png):
        if os.path.exists(f):
            os.remove(f)
    os.rmdir(tmp)

    print('scritto: %s' % path)
    print('  %.1fs, %d note, %d accordi, %d sezioni'
          % (duration, len(arrangement['notes']), len(arrangement['chords']),
             len(arrangement['sections'])))
    used = {}
    for n in arrangement['notes']:
        for k in n:
            if k not in ('t', 's', 'f'):
                used[k] = used.get(k, 0) + 1
    print('  campi di notazione esercitati: %s'
          % ', '.join('%s×%d' % (k, v) for k, v in sorted(used.items())))

    if args.validate:
        tool = os.path.expanduser('~/Desktop/Feedback/tool/feedpak_validate.py')
        if os.path.exists(tool):
            print('\n--- feedpak_validate.py ---')
            subprocess.run([sys.executable, tool, path])
        else:
            print('validatore non trovato in %s' % tool)


if __name__ == '__main__':
    main()
