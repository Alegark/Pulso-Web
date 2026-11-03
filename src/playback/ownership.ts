export type ControlState = 'sin-control' | 'adquiriendo' | 'con-control' | 'cediendo';
export interface ActivityToken { current(): boolean; end(): void }
/** Synchronous admission. Tokens belong to one acquisition, including their finally. */
export class Activity {
  private generation = 0;
  private accepting = false;
  private active = new Set<symbol>();
  private unresolved = new Set<string>();
  constructor(private changed: () => void = () => {}) {}
  get admitted() { return this.accepting; }
  get idle() { return this.active.size === 0 && this.unresolved.size === 0; }
  get resolved() { return this.unresolved.size === 0; }
  scope() { const generation=this.generation; return () => generation===this.generation; }
  get count() { return this.active.size; }
  open() { ++this.generation; this.accepting = true; this.changed(); }
  reopen() { this.accepting = true; this.changed(); }
  close() { this.accepting = false; this.changed(); }
  invalidate() { this.close(); ++this.generation; }
  block(key: string, blocked: boolean) { if (blocked) this.unresolved.add(key); else this.unresolved.delete(key); this.changed(); }
  begin(): ActivityToken | null {
    if (!this.accepting) return null;
    const generation = this.generation, id = Symbol(); this.active.add(id); this.changed();
    return {current: () => generation === this.generation,
      end: () => { if (this.active.delete(id)) this.changed(); }};
  }
}
const playbackLock = 'pulso-web:local:playback';
const channelName = 'pulso-web:local:handoff:v1';
type Request = {tabId: string; requestId: string};
export interface Handoff { prepare(): Promise<void>; blocked(): boolean }
/** Local gesture outcome; pending has no deadline or automatic retry. Cancel is local only. */
export type TransferState = 'idle' | 'acquiring' | 'pending' | 'acquired' | 'refused' | 'cancelled' | 'unsupported' | 'failed';
type Holding = {proof: string; releaseProof?: () => void; releasePlayback?: () => void; proofDone: Promise<unknown>; done: Promise<unknown>};
/** BC carries hints only. Admission always requires both real Web Lock callbacks. */
export class Ownership {
  state: ControlState = 'sin-control';
  proof = '';
  readonly tabId = crypto.randomUUID();
  requests: Request[] = [];
  readonly activity: Activity;
  private channel: BroadcastChannel | null = null;
  private pending: string | null = null;
  private holding: Holding | null = null;
  private intent = 0;
  private outcome: TransferState = 'idle';
  private recent: string[] = [];
  private settling = false;
  private restoring = false;
  constructor(private changed: () => void, private acquired: () => Promise<void>, private locks: LockManager | undefined = navigator.locks, private handoff?: Handoff) {
    this.activity = new Activity(() => this.notify());
    try { if (typeof BroadcastChannel !== 'undefined') { this.channel = new BroadcastChannel(channelName); this.channel.onmessage = e => this.receive(e.data); } } catch { /* Manual check remains available. */ }
  }
  private notify() { try { this.changed(); } catch { /* Observation cannot change lock lifetime. */ } }
  get transferState(): TransferState { return this.outcome; }
  get supported() { return !!this.locks; }
  get messaging() { return !!this.channel; }
  get owner() { return this.state === 'con-control' && this.activity.admitted; }
  private send(type: string, request: Request, transfer = false) {
    try { this.channel?.postMessage({version: 1, type, ...request, sender: this.tabId, ...(transfer ? {transfer: true} : {})}); return !!this.channel; }
    catch { return false; }
  }
  private receive(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const m = value as Record<string, unknown>;
    if (m.version !== 1 || typeof m.tabId !== 'string' || !m.tabId || typeof m.requestId !== 'string' || !m.requestId || m.tabId.length > 100 || m.requestId.length > 100 || typeof m.sender !== 'string' || !m.sender || m.sender.length > 100 || m.sender === this.tabId) return;
    const request = {tabId: m.tabId, requestId: m.requestId};
    if (m.type === 'request' && m.sender === m.tabId && (this.owner || this.holding)) {
      const key = JSON.stringify([m.tabId, m.requestId]);
      if (this.recent.includes(key)) return;
      this.recent = [...this.recent.slice(-31), key];
      if (m.transfer === true && this.handoff) {
        // Do not queue another transfer behind a prepare or an uncertain owner.
        if (!this.owner || this.settling) { this.send('retained', request); return; }
        void this.cede(this.handoff.prepare, this.handoff.blocked).then(ok => {
          this.send(ok ? 'released' : 'retained', request);
        }).catch(() => { this.send('retained', request); });
      } else if (this.owner) {
        this.requests = [...this.requests.slice(-7), request]; this.notify();
      }
    } else if ((m.type === 'released' || m.type === 'retained') && m.tabId === this.tabId && m.requestId === this.pending) {
      this.pending = null;
      if (m.type === 'released') {
        const intent = this.intent;
        void this.attempt(intent).then(result => { if (intent === this.intent) { this.outcome = result === 'acquired' ? 'acquired' : result === 'failed' ? 'failed' : 'refused'; this.notify(); } });
      } else { this.outcome = 'refused'; this.notify(); }
    }
  }
  request() {
    if (this.state !== 'sin-control' || !this.channel || this.pending) return;
    this.pending = crypto.randomUUID();
    if (!this.send('request', {tabId: this.tabId, requestId: this.pending})) this.pending = null;
    this.notify();
  }
  retain() { for (const request of this.requests) this.send('retained', request); this.requests = []; this.notify(); }
  cancelTransfer() { ++this.intent; this.pending = null; this.outcome = 'cancelled'; this.notify(); }
  async acquire() { await this.attempt(this.intent); }
  private async attempt(intent: number): Promise<'acquired' | 'occupied' | 'failed'> {
    if (!this.locks || this.state !== 'sin-control' || this.holding || this.settling || intent !== this.intent) return 'occupied';
    this.state = 'adquiriendo'; this.notify();
    let finish!: (result: 'acquired' | 'occupied' | 'failed') => void;
    let failed = false;
    const admitted = new Promise<'acquired' | 'occupied' | 'failed'>(resolve => { finish = resolve; });
    const holding: Holding = {proof: `pulso-web:local:owner:${crypto.randomUUID()}`, proofDone: Promise.resolve(), done: Promise.resolve()};
    this.holding = holding;
    try {
      holding.done = this.locks.request(playbackLock, {ifAvailable: true}, async lock => {
        if (!lock || intent !== this.intent || this.state !== 'adquiriendo') return;
        const held = new Promise<void>(resolve => { holding.releasePlayback = resolve; });
        try {
          holding.proofDone = this.locks!.request(holding.proof, async () => {
            const proofHeld = new Promise<void>(resolve => { holding.releaseProof = resolve; });
            if (intent !== this.intent || this.state !== 'adquiriendo') { holding.releaseProof?.(); holding.releasePlayback?.(); return; }
            this.pending = null; this.proof = holding.proof; this.state = 'con-control'; this.restoring = true; this.activity.open();
            try { await this.acquired(); finish(this.owner && intent === this.intent ? 'acquired' : 'failed'); }
            catch {
              this.activity.invalidate(); this.state = 'sin-control';
              if (this.activity.idle && (!this.handoff || !this.isBlocked(this.handoff.blocked))) { holding.releaseProof?.(); holding.releasePlayback?.(); }
              finish('failed');
            } finally { this.restoring = false; }
            this.notify();
            await proofHeld;
          });
          // Proof failure must also settle the playback lifetime.
          void holding.proofDone.catch(() => { holding.releasePlayback?.(); });
          await held; await holding.proofDone;
        } finally { holding.releaseProof?.(); }
      });
    } catch { holding.done = Promise.reject(new Error('Lock request failed')); }
    void holding.done.catch(() => { failed = true; }).finally(() => {
      if (this.holding === holding) {
        this.holding = null; this.activity.close(); this.proof = ''; this.state = 'sin-control'; this.notify();
      }
      finish(failed ? 'failed' : 'occupied');
    });
    return admitted;
  }
  /** Explicit gesture only; never calls play.
   * Free lock: resolves after acquired() (paused restore), not the lock lifetime.
   * Occupied lock: resolves at pending; observe transferState==='acquired' after
   * the correlated release, real lock callbacks and complete acquired() restore.
   * owner alone is not a restore-completion signal. Repeated pending clicks coalesce.
   */
  async useHere(): Promise<void> {
    if (this.outcome === 'pending' || this.outcome === 'acquiring' || this.settling) return;
    if (this.restoring) { this.outcome = 'refused'; this.notify(); return; }
    if (this.owner) { this.outcome = 'acquired'; this.notify(); return; }
    const intent = ++this.intent; this.pending = null; this.outcome = 'acquiring'; this.notify();
    if (!this.locks) { this.outcome = 'unsupported'; this.notify(); return; }
    if (this.holding) {
      // R114: hidden ownership is still real ownership. Never reopen its old scope.
      if (this.restoring || !this.handoff || !this.activity.idle || this.isBlocked(this.handoff.blocked)) { this.outcome = 'refused'; this.notify(); return; }
      this.settling = true;
      try {
        await this.handoff.prepare();
        if (!this.activity.idle || this.isBlocked(this.handoff.blocked)) { if (intent === this.intent) this.outcome = 'refused'; return; }
        await this.release();
      } catch { if (intent === this.intent) this.outcome = 'failed'; return; }
      finally { this.settling = false; this.notify(); }
    }
    if (intent !== this.intent) return;
    const result = await this.attempt(intent);
    if (intent !== this.intent) return;
    if (result === 'acquired') this.outcome = 'acquired';
    else if (result === 'failed' || this.holding) this.outcome = 'failed';
    else if (!this.channel) this.outcome = 'unsupported';
    else {
      this.pending = crypto.randomUUID(); this.outcome = 'pending';
      if (!this.send('request', {tabId: this.tabId, requestId: this.pending}, true)) { this.pending = null; this.outcome = 'unsupported'; }
    }
    this.notify();
  }
  private isBlocked(blocked: () => boolean) { try { return blocked(); } catch { return true; } }
  async cede(prepare: () => Promise<void>, extraBlocked: () => boolean) {
    // Refuse before notifying a temporary authority loss: an active operation
    // retains its scope, session and original settlement when handoff is denied.
    if (!this.owner || this.settling || this.restoring || !this.activity.idle || this.isBlocked(extraBlocked)) return false;
    this.settling = true;
    const intent = this.intent;
    if (this.outcome === 'acquired') this.outcome = 'idle';
    this.activity.close(); this.state = 'cediendo'; this.notify();
    const restore = () => { if (intent === this.intent && this.state === 'cediendo') { this.state = 'con-control'; this.activity.reopen(); } };
    try {
      if (!this.activity.idle || this.isBlocked(extraBlocked)) { restore(); return false; }
      try { await prepare(); } catch (error) { restore(); throw error; }
      if (!this.activity.idle || this.isBlocked(extraBlocked)) { restore(); return false; }
      await this.release();
      const requests = this.requests; this.requests = [];
      for (const request of requests) this.send('released', request);
      return true;
    } finally { this.settling = false; this.notify(); }
  }
  private async release() {
    const holding = this.holding;
    this.activity.invalidate();
    if (!holding) return;
    holding.releaseProof?.(); await holding.proofDone.catch(() => {});
    holding.releasePlayback?.(); await holding.done.catch(() => {});
    if (this.holding === holding) { this.holding = null; this.proof = ''; this.state = 'sin-control'; }
    this.notify();
  }
  /** Departure cancels acquisition intent; busy/uncertain work keeps its own settlement. */
  hide(prepare: () => Promise<void>, extraBlocked: () => boolean) {
    const wasOwner = this.owner;
    this.cancelTransfer(); this.activity.invalidate(); this.state = 'sin-control'; this.notify();
    if (wasOwner && !this.restoring && !this.settling && this.activity.idle && !this.isBlocked(extraBlocked)) {
      this.settling = true;
      void (async () => {
        try { await prepare(); if (this.activity.idle && !this.isBlocked(extraBlocked)) await this.release(); }
        catch { /* Retain actual locks; a future explicit gesture can recover. */ }
        finally { this.settling = false; this.notify(); }
      })();
    }
  }
}
