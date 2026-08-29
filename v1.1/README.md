# NOCLIP

A found-footage Backrooms experience in the browser. No menu: the page loads and you
are already falling through a hole in the ceiling.

**Controls** — WASD move · SHIFT run · C crouch · SPACE jump · Q look behind ·
F camcorder lamp · T copy this tape's link · R rewind (after the tape ends)

## What is in it

* **Nine room types**, each a real zone with its own ceiling height, palette, fog and
  layout generator: the yellow open-plan lobby, one-cell-wide hallways, the marked
  rooms, cold white admin, poolrooms with standing water, a dead-power blackout wing,
  a concrete substructure, the red hall, and cramped utility runs. Zones are cut by
  BSP, so every doorway can open onto a completely different world.
* **The Entity** — a procedural rig, no model files. It wanders, hears you run, stalks,
  then hunts at a speed you cannot simply outrun. Break line of sight and it loses you.
  Let it reach you and the tape cuts.
* **Real recordings**, fetched at boot from Wikimedia Commons (all public domain / CC0):
  fluorescent ballast buzz, mains hum, monster growls, a demonic scream, the UVB-76
  wail, dull thuds, tape static, heavy breathing and real footsteps. Every sample has a
  synthesised fallback, so the game never runs silent if a fetch fails.
* **Multiplayer, no lobby.** The tape code lives in the URL (`#tape=ABCD`). Press T to
  copy the link; anyone who opens it falls into the same level with you. Host-authoritative:
  the host simulates The Entity and streams it to everyone else.
* **The camcorder is the UI** — timecode, battery, REC, signal strength. Signal rises as
  you get closer to the way out.

## Running it

Any static server will do:

```bash
python3 -m http.server 8711
```

For development use `tools/devserver.py`, which stamps every ES module import with the
newest mtime — browsers keep modules in an in-process cache that ignores `no-store`, so
without the stamp your edits silently do not load.

## Multiplayer over the internet

Out of the box, multiplayer runs over `BroadcastChannel`, which links tabs on one
machine. For real peers, paste a Firebase web config into `FIREBASE_CONFIG` in
`js/net.js`; signalling then goes through Realtime Database and the game itself runs on
WebRTC data channels.

## Your own music

Put audio files in `audio/` and list them in `audio/manifest.json`:

```json
{ "opening": "theme.mp3", "explore": ["a.mp3", "b.mp3"], "hunt": null }
```

`opening` plays over the fall and again at the end of the tape; `explore` is shuffled
underneath the wandering with a few seconds of silence between tracks; `hunt` scores
the chase, or stays `null` so the music hard-cuts to a drone the moment it sees you.

Audio files are gitignored — they stay on your machine. With none present the game
synthesises its own beds, so it still works everywhere.

## Layout

```

  index.html      viewfinder chrome + importmap
styles.css
js/config.js      tuning constants and the room-type roster
js/level.js       BSP zoning, generators, merged chunk geometry
js/tex.js         every surface drawn procedurally into a canvas
js/player.js      controller, walk cycle, hand-held camera, legs
js/entity.js      The Entity: rig, BFS pathing, five-state mind
js/audio.js       fetch + slice + synth fallback
js/fx.js          render target, bloom, the VHS composite
js/lights.js      pooled point lights chasing the nearest fixtures
js/net.js         host-authoritative multiplayer
js/hud.js         camcorder readouts
js/main.js        boot, the fall, the loop, the director
tools/            dev-only: no-cache server, frame capture, browser probes
```

Each deploy freezes a copy of the root into an immutable `vX.Y/` folder, reachable
at `/vX.Y/`. The root is always the current build.
