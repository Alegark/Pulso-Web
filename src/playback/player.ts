export interface Entry { id: string; trackId: string; title: string; src: string }
export type PlayerFailureCode = 'autoplay-denied'|'media-aborted'|'media-network'|'media-decode'|'media-unsupported'|'media-unknown'|'unknown';
export type FailureObserver = (phase:'play'|'read') => ((code:PlayerFailureCode)=>void)|undefined;
export type State = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';
export interface Media {
  readonly error?: {readonly code:number}|null;
  src: string; currentTime: number; duration: number; ended: boolean;
  play(): Promise<void>; pause(): void; load(): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
export class Player {
  entries: Entry[] = [];
  index = -1;
  state: State = 'idle';
  error = '';
  generation = 0;
  repeat: 'off'|'one'|'all' = 'off';
  shuffleOrder: string[]|null = null;
  private listeners: [string, EventListener][] = [];
  private subscribers = new Set<() => void>();
  private suspended = false;
  constructor(readonly audio: Media, private admitted: () => boolean = () => true, private failureObserver?:FailureObserver) {}
  private observe(phase:'play'|'read') {
    let notify:((code:PlayerFailureCode)=>void)|undefined;try{notify=this.failureObserver?.(phase);}catch{/* optional observer */}
    let used=false;return (code:PlayerFailureCode)=>{if(used)return;used=true;try{notify?.(code);}catch{/* diagnostics cannot affect engine */}};
  }
  suspend() {
    this.suspended = true; this.invalidate(); this.audio.pause();
    this.audio.src = ''; this.audio.load(); this.state = 'paused'; this.emit();
  }
  private get allowed() { return !this.suspended && this.admitted(); }
  subscribe = (fn: () => void) => { this.subscribers.add(fn); return () => { this.subscribers.delete(fn); }; };
  private emit() { this.subscribers.forEach(fn => fn()); }
  get current() { return this.entries[this.index]; }
  setQueue(entries: Entry[]) {
    if (!this.admitted()) return; this.suspended = false;
    this.invalidate(); this.audio.pause(); this.entries = entries.map(e => ({...e}));
    this.index = -1; this.shuffleOrder=null; this.state = 'idle'; this.emit();
  }
  private invalidate() {
    ++this.generation;
    this.listeners.forEach(([type, fn]) => this.audio.removeEventListener(type, fn));
    this.listeners = [];
  }
  select(index: number, autoplay = false, restorePosition = 0) {
    if (!this.allowed) return;
    const entry = this.entries[index]; if (!entry) return;
    this.invalidate(); this.audio.pause(); this.index = index; this.error = '';
    const generation = this.generation; let consumed = false; const failed=this.observe('read');
    const on = (type: string, fn: () => void) => {
      const guarded: EventListener = () => { if (this.allowed && generation === this.generation && this.audio.src === entry.src) fn(); };
      this.listeners.push([type, guarded]); this.audio.addEventListener(type, guarded);
    };
    on('playing', () => { this.state = 'playing'; this.emit(); });
    on('pause', () => { if (this.state !== 'ended') this.state = 'paused'; this.emit(); });
    on('waiting', () => { this.state = 'buffering'; this.emit(); });
    on('timeupdate', () => this.emit());
    on('loadedmetadata', () => { if (restorePosition > 0) { this.seek(restorePosition); restorePosition = 0; } if (this.state === 'loading') this.state = 'paused'; this.emit(); });
    on('error', () => { let code:PlayerFailureCode='media-unknown';try{switch(this.audio.error?.code){case 1:code='media-aborted';break;case 2:code='media-network';break;case 3:code='media-decode';break;case 4:code='media-unsupported';break;}}catch{/* unknown */}failed(code); this.state = 'error'; this.error = 'No se pudo leer el audio. Puedes reintentar o elegir la siguiente pista.'; this.emit(); });
    on('ended', () => {
      if (consumed || !this.audio.ended) return; consumed = true;
      if(this.repeat==='one')this.select(this.index,true);
      else if(this.following()>=0)this.select(this.following(),true);
      else { this.state = 'ended'; this.emit(); }
    });
    this.audio.src = entry.src; this.audio.load(); this.state = 'loading'; this.emit();
    if (autoplay) void this.play();
  }
  async play() {
    if (!this.allowed) return;
    if (!this.current) { this.select(0, true); return; }
    if (this.audio.ended || this.state === 'ended') { this.audio.currentTime = 0; this.select(this.index); }
    const generation = this.generation,src=this.audio.src,failed=this.observe('play');
    try { await this.audio.play(); if (generation !== this.generation && !this.allowed) this.audio.pause(); }
    catch (error) { if (this.allowed && generation === this.generation && this.audio.src===src) { let denied=false;try{denied=error instanceof Error&&error.name==='NotAllowedError';}catch{/* unknown */}failed(denied?'autoplay-denied':'unknown');this.state = 'error'; this.error = denied ? 'Toca Reproducir para continuar; el navegador requiere una interacción.' : 'El navegador no pudo abrir este audio. Prueba otra pista o vuelve a preparar la cola.'; this.emit(); } }
  }
  pause() { this.audio.pause(); this.state = 'paused'; this.emit(); }
  following() {
    const order=this.shuffleOrder??this.entries.map(e=>e.id);const position=order.indexOf(this.current?.id??'');
    const next=order[position+1]??(this.repeat==='all'?order[0]:undefined);
    return this.entries.findIndex(e=>e.id===next);
  }
  next() { if (!this.allowed) return; const next=this.following();if(next>=0)this.select(next,true); }
  previous() { if (!this.allowed) return;
    if(this.audio.currentTime>3){this.seek(0);return;}
    const order=this.shuffleOrder??this.entries.map(e=>e.id);const position=order.indexOf(this.current?.id??'');
    const id=order[Math.max(0,position-1)];this.select(this.entries.findIndex(e=>e.id===id),true);
  }
  setRepeat(mode:'off'|'one'|'all'){ if (!this.allowed) return;this.repeat=mode;this.emit();}
  setShuffle(enabled:boolean,random= Math.random){ if (!this.allowed) return;
    if(!enabled){this.shuffleOrder=null;this.emit();return;}
    const ids=this.entries.filter(e=>e.id!==this.current?.id).map(e=>e.id);
    for(let i=ids.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}
    this.shuffleOrder=this.current?[this.current.id,...ids]:ids;this.emit();
  }
  restoreModes(repeat:unknown,order:unknown){
    this.repeat=repeat==='one'||repeat==='all'?repeat:'off';
    this.shuffleOrder=null;
    if(Array.isArray(order)&&order.length===this.entries.length&&new Set(order).size===order.length&&order.every(id=>typeof id==='string'&&this.entries.some(e=>e.id===id)))this.shuffleOrder=[...order];
    this.emit();
  }
  moveEntry(id:string,delta:-1|1){ if (!this.allowed) return;
    const current=this.current?.id;const i=this.entries.findIndex(e=>e.id===id);const j=i+delta;
    if(i<0||j<0||j>=this.entries.length)return;
    [this.entries[i],this.entries[j]]=[this.entries[j],this.entries[i]];this.index=this.entries.findIndex(e=>e.id===current);
    if(this.shuffleOrder){const x=this.shuffleOrder.indexOf(id);const y=x+delta;if(x>=0&&y>=0&&y<this.shuffleOrder.length)[this.shuffleOrder[x],this.shuffleOrder[y]]=[this.shuffleOrder[y],this.shuffleOrder[x]];}
    this.emit();
  }
  removeFuture(id:string){ if (!this.allowed) return;
    if(id===this.current?.id)return;const current=this.current?.id;
    this.entries=this.entries.filter(e=>e.id!==id);this.index=this.entries.findIndex(e=>e.id===current);
    if(this.shuffleOrder)this.shuffleOrder=this.shuffleOrder.filter(e=>e!==id);this.emit();
  }
  seek(seconds: number) { if (!this.allowed) return; if (Number.isFinite(seconds) && Number.isFinite(this.audio.duration) && this.audio.duration > 0) { this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration)); this.emit(); } }
}
