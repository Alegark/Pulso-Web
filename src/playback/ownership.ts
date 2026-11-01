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
/** Messages are notifications only. Only the nested real lock callback admits an owner. */
export class Ownership {
  state: ControlState = 'sin-control';
  proof = '';
  readonly tabId = crypto.randomUUID();
  requests: Request[] = [];
  readonly activity: Activity;
  private channel: BroadcastChannel | null = null;
  private pending: string | null = null;
  private releaseProof: (() => void) | null = null;
  private releasePlayback: (() => void) | null = null;
  private proofDone: Promise<unknown> = Promise.resolve();
  private playbackDone: Promise<unknown> = Promise.resolve();
  constructor(private changed: () => void, private acquired: () => Promise<void>, private locks: LockManager | undefined = navigator.locks) {
    this.activity = new Activity(changed);
    try { if (typeof BroadcastChannel !== 'undefined') { this.channel = new BroadcastChannel(channelName); this.channel.onmessage = e => this.receive(e.data); } } catch { /* Manual release/check remains available. */ }
  }
  get supported() { return !!this.locks; }
  get messaging() { return !!this.channel; }
  get owner() { return this.state === 'con-control' && this.activity.admitted; }
  private send(type: string, request: Request) { this.channel?.postMessage({version: 1, type, ...request, sender: this.tabId}); }
  private receive(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const m = value as Record<string, unknown>;
    if (m.version !== 1 || typeof m.tabId !== 'string' || typeof m.requestId !== 'string' || m.tabId.length > 100 || m.requestId.length > 100 || m.sender === this.tabId) return;
    if (m.type === 'request' && this.owner) {
      if (!this.requests.some(r => r.requestId === m.requestId && r.tabId === m.tabId)) this.requests = [...this.requests.slice(-7), {tabId: m.tabId, requestId: m.requestId}];
      this.changed();
    } else if ((m.type === 'released' || m.type === 'retained') && m.tabId === this.tabId && m.requestId === this.pending) {
      this.pending = null;
      if (m.type === 'released') void this.acquire();
      else this.changed();
    }
  }
  request() {
    if (this.state !== 'sin-control' || !this.channel) return;
    this.pending = crypto.randomUUID(); this.send('request', {tabId: this.tabId, requestId: this.pending}); this.changed();
  }
  retain() { for (const request of this.requests) this.send('retained', request); this.requests = []; this.changed(); }
  async acquire() {
    if (!this.locks || this.state !== 'sin-control' || this.releasePlayback) return;
    this.state = 'adquiriendo'; this.changed();
    const task = this.locks.request(playbackLock, {ifAvailable: true}, async lock => {
      if (!lock) return;
      const held = new Promise<void>(resolve => { this.releasePlayback = resolve; });
      const proof = `pulso-web:local:owner:${crypto.randomUUID()}`;
      this.proofDone = this.locks!.request(proof, async () => {
        const proofHeld = new Promise<void>(resolve => { this.releaseProof = resolve; });
        // pagehide may have invalidated the pending acquisition.
        if (this.state !== 'adquiriendo') { this.releaseProof!(); this.releasePlayback!(); return; }
        this.pending=null;this.proof = proof; this.state = 'con-control'; this.activity.open();
        try { await this.acquired(); } finally { this.changed(); }
        await proofHeld;
      });
      await held;
      await this.proofDone;
    });
    this.playbackDone = task;
    void task.catch(() => { this.activity.close(); }).finally(() => {
      if (this.state === 'adquiriendo' || this.state === 'sin-control') {this.state = 'sin-control';this.releasePlayback=null;this.releaseProof=null;this.proof='';}
      this.changed();
    });
    // Do not await a lock request that intentionally lasts for the ownership lifetime.
  }
  async cede(prepare: () => Promise<void>, extraBlocked: () => boolean) {
    if (!this.owner) return false;
    this.activity.close(); this.state = 'cediendo'; this.changed();
    if (!this.activity.idle || extraBlocked()) { this.state = 'con-control'; this.activity.reopen(); this.changed(); return false; }
    try { await prepare(); }
    catch (error) { this.state = 'con-control'; this.activity.reopen(); this.changed(); throw error; }
    await this.release();
    const requests = this.requests; this.requests = [];
    for (const request of requests) this.send('released', request);
    this.changed(); return true;
  }
  private async release() {
    this.activity.invalidate();
    this.releaseProof?.(); await this.proofDone; this.releaseProof = null;
    this.releasePlayback?.(); await this.playbackDone; this.releasePlayback = null;
    this.proof = ''; this.state = 'sin-control'; this.changed();
  }
  /** Browser departure: never volunteer a lock while an operation is uncertain. */
  hide(prepare: () => Promise<void>, extraBlocked: () => boolean) {
    const wasOwner = this.owner; this.activity.invalidate(); this.state = 'sin-control'; this.changed();
    if (wasOwner && this.activity.idle && !extraBlocked()) void prepare().then(() => this.release()).catch(() => { this.changed(); });
  }
}
