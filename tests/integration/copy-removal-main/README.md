# R98 real main integration harness

Run from the Pulso-Web repository:

```sh
INSTABOX_HEADLESS=1 node tests/integration/check-copy-removal-main.mjs
```

Do not run a final selection until ROOT supplies its explicit GO and updates
`.local/copy-removal-parent-integration/freeze.json`. The runner verifies all
107 frozen src/public files and the named dependency receipts before building.
A source delta during execution rejects the selection. There is no product edit,
repository build, `dist` write, npm install, private port, account or external API.

The runner copies all src/public and index.html into its own timestamped `.local`
snapshot, builds native and observed bundles plus the actual SW there, and serves
only that output on 127.0.0.1 port0. Chromium154 runs headless with sandbox enabled;
each fixture gets a fresh browser context and a cold, unseeded product startup.
All audio is generated synthetic PCM WAV (and a local ffmpeg sine MP3 for the
8MiB+1 limit fixture). Metadata, aliases, lists and tracking belong to those contexts.

G01/G02 use untransformed main/controller/core/runtime: native import, UI queue A,
actual controlling SW with physicalSources:1, paused restore, explicit removal B,
kept A audio/source/calls, native IDB/OPFS and retained organization. The IDB
capability fixture explicitly removes getDirectory in DOM and actual dedicated
workers; it does not replace workers or IDB.

Other groups use an enforce:pre plugin with exact occurrence assertions. The
resulting bundle must contain its marker strings. Product handles stay in private
closures/maps; exported observations cannot become plans, runtime or reservations.
The root hooks observe state/refresh/reservation and expose narrowly named TESTONLY
commands. React callback captures remain in a private map, keyed only for replay
probes. The core hooks delay known boundaries or inject named DOMExceptions; they
do not replace core, Player, Activity, runtime, workers, native storage or mutations.

The observed confirm-after-worker hook waits on native lock-query observations
before injecting later faults. This explicit TESTONLY scheduling barrier makes the
fault boundary reachable without treating an earlier safe busy/conflict result as
an ACK failure. G01/G02 have no such barrier. Native transaction-precommit uses
real IDB requests to keep the prepared transaction open until abort/settlement;
it is a declared TESTONLY keepalive, never a fake transaction or commit.

Cleanup closes every own context/browser/server in finally. Reports retain initial,
build and final source/output/harness fingerprints; external attempts and browser
errors must be zero. Synthetic chunk payloads in new reports are represented by
byte count/SHA256 (assertions still compare native data). Old raw reports are kept.
`R98_FILTER` is diagnostic only; filtered runs cannot satisfy final group count.

Current status is RED on old main689 / state0c85, awaiting ROOT fixes and new GO.
The three native regressions are useful focus after successful close (G13), own
refresh settlement retention and tracking-read-unavailable gate retention (G15).
These are not acceptance of P0-W/T12 or a physical iPhone. iPhone remains pending.
See `.local/copy-removal-main-r98/ROOT-FINDINGS.json` and REPORT.md for raw provenance,
coverage gaps and development-harness failures, which are not renamed PASS.
