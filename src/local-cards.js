import {mergeDecks} from './core.js';

const STORE_KEY = 'qw.local';

// Anonymous persistence with the same surface FirebaseCards exposes. Cards and
// studies are kept only in this browser so Study works without an account; when
// the user signs in, this data is seeded up to Firebase instead of being lost.
export class LocalCards {
  constructor({storage = localStorage, onChange = () => {}}) {
    Object.assign(this, {storage, onChange});
    this.user = {sub:'local-device', name:'This device', email:null};
    this.ready = true; this.synced = true; this.status = 'Saving on this device.';
    this.deck = {}; this.studies = {}; this._lastVerse = null;
    try {
      const cached = JSON.parse(this.storage.getItem(STORE_KEY) || '{}');
      this.deck = mergeDecks(cached.cards || {});
      this.studies = cached.studies && typeof cached.studies === 'object' ? cached.studies : {};
    } catch { /* A broken cache starts empty. */ }
  }
  get mode() { return 'local'; }
  get authorized() { return true; }
  get busy() { return false; }
  get lastVerse() {
    try { return this._lastVerse || JSON.parse(this.storage.getItem('qw.lastVerse') || 'null')?.reference || null; }
    catch { return this._lastVerse; }
  }
  emit() { this.onChange(this); }
  backup() {
    try { this.storage.setItem(STORE_KEY, JSON.stringify({version:1, cards:this.deck, studies:this.studies})); this.backupAvailable = true; }
    catch { this.backupAvailable = false; this.status = 'Browser storage is unavailable; cards cannot be saved on this device.'; }
  }
  async signIn() { throw new Error('Sign in with Google to sync cards to Firebase.'); }
  async signOut() {
    try { this.storage.removeItem(STORE_KEY); } catch { /* keep going */ }
    this.deck = {}; this.studies = {}; this.status = 'Local cards cleared.'; this.emit();
  }
  async sync() { /* Everything is already local. */ }
  mutate(id, card) { this.deck[id] = card; this.backup(); this.emit(); }
  mutateStudy(id, study) { this.studies[id] = study; this.backup(); this.emit(); }
  setLastVerse(reference) { this._lastVerse = reference; }
}
