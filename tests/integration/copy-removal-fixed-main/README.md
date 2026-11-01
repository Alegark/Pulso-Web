# R102 independent integrated removal acceptance

Run at repository root, only against the explicitly authorized freeze revision
`REMOVAL_R91_R94_R96_R97_ROOT_FIX`:

```sh
INSTABOX_HEADLESS=1 node tests/integration/check-copy-removal-fixed-main.mjs
```

Twenty unique groups form one final selection. `R102_FILTER` accepts a diagnostic
regular expression; filtered runs cannot pass final acceptance. Every invocation
retains its timestamped snapshot/raw outputs under
`.local/copy-removal-fixed-main-r102/`. The final receipt is
`.local/evidence/copy-removal-fixed-main-r102.json`.

The harness copies all src/public and index.html, verifies all107 frozen sources
and named dependency receipts, and builds only inside its own artifact tree.
G01/G02 use untransformed main/controller/core/runtime, real UI imports with no
IDB seed, native IDB/OPFS, actual dedicated workers, and normally registered actual
controlling SW (`physicalSources:1` before B review). IDB capability absence is
explicit in DOM and dedicated worker bundles; no storage implementation is replaced.
All fixtures are own synthetic audio and metadata in fresh loopback contexts.
Chromium154 runs headless with its sandbox enabled. No product/dist edits, provider
traffic, account, private4175 access, Git mutation, ODD/Engram writes or subdelegation.

Observed builds add exact-anchor enforce:pre TESTONLY hooks, verified in emitted
bundles. Native Player, Activity, storage, mutators, worker protocol and runtime
remain real. Hooks observe scalar state, retain actual React callbacks in private
maps, and delay named execution boundaries or inject named DOMExceptions. No plan,
reservation, proof or runtime handle is exported or reconstructed from JSON.

R97 regressions hold the actual root refresh after core terminal, preserve visible
outcome+working, deny direct/forced close and inspect, and observe runtime release
only after exact cancel/dispose/refresh settlement. They cover guard revocation and
secondary refresh failure. Native session getItem denial after detach preserves
tracking/gate through close and real document reopen; recovery requires a gesture.
The DOM focus check requires a useful heading after its connected opener becomes
disabled, no Tab intent theft, and no overflow at320/568 with200% font approximation.

Other groups cover aliases/backupv2/exact relink, old kept generations and8MiB
boundary, per-plan consent, current/future/retained/pending sources, real locks,
ACK prepared/detach/final, native abort, dispatch settlement, startup/no-autodelete,
new continuation consent, stale React gates, DB-close TESTONLY event/ActivityABA,
real handoff with next owner paused, and terminal historical/anomalous generations.
The worker reader barrier uses a TESTONLY BroadcastChannel after a native reader
opens; cancel still runs the actual worker protocol and releases its real lock.
The syscall barrier adopts the actual removeEntry promise before delaying delivery.
The prepared transaction keepalive uses actual IDB requests, never a fake transaction.

Reports include source/output/harness byte+SHA256 maps, exact native assertions,
synthetic chunk summaries, network/pageerror observations and finally cleanup.
Diagnostic raw failures stay separate and are never summed into the final count.
The initial giant-array Playwright fixture exhausted the runner heap; base64 transfer
corrects that harness cost, with the original log/progress retained. No product heap
guarantee follows. Physical iPhone, HTTPS deployment, offline/private transport,
physical erase, process crash and global P0-W/T12 acceptance remain outside this run.
