import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore, collection, doc, getDocs, setDoc} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {mergeDecks} from './core.js';

const ALLOWED_EMAIL = 'farazshuja@gmail.com';

export class FirebaseCards {
  constructor({config, storage = localStorage, onChange = () => {}}) {
    Object.assign(this, {storage, onChange});
    const app = initializeApp(config);
    this.auth = getAuth(app); this.db = getFirestore(app);
    this.deck = {}; this.studies = {}; this.lastVerse = null; this.lastVerseUpdatedAt = 0;
    this.user = null; this.ready = false; this.busy = false; this.status = 'Connecting to Firebase…';
    this.authReady = new Promise(resolve => {
      onAuthStateChanged(this.auth, async user => {
        if (user && user.email?.toLowerCase() === ALLOWED_EMAIL) {
          this.user = {sub:user.uid, name:user.displayName || user.email, email:user.email};
          this.ready = true;
          this.loadBackup();
          try { await this.sync(); }
          catch (error) { this.status = `${error.message} Your local copy is still available.`; }
        } else {
          if (user) await firebaseSignOut(this.auth);
          this.user = null; this.ready = true; this.deck = {}; this.studies = {};
          this.status = user ? `Access is currently limited to ${ALLOWED_EMAIL}.` : 'Sign in to sync your cards and studies.';
        }
        this.emit(); resolve();
      }, error => {this.ready = true; this.status = error.message; this.emit(); resolve();});
    });
  }
  get authorized() { return this.ready && !!this.user; }
  get busy() { return this._busy || false; }
  set busy(value) { this._busy = value; }
  get cacheKey() { return this.user ? `qw.firebase.${this.user.sub}` : null; }
  emit() { this.onChange(this); }
  backup() {
    try { this.storage.setItem(this.cacheKey, JSON.stringify({version:1, cards:this.deck, studies:this.studies})); this.backupAvailable = true; }
    catch { this.backupAvailable = false; this.status = 'Browser storage is unavailable; keep this page open while Firebase syncs.'; }
  }
  loadBackup() {
    try {
      const cached = JSON.parse(this.storage.getItem(this.cacheKey) || '{}');
      this.deck = mergeDecks(cached.cards || {});
      this.studies = cached.studies && typeof cached.studies === 'object' ? cached.studies : {};
    } catch { this.deck = {}; this.studies = {}; }
  }
  async signIn() {
    await this.authReady;
    if (this.busy) return;
    this.busy = true; this.emit();
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({login_hint:ALLOWED_EMAIL, prompt:'select_account'});
      const result = await signInWithPopup(this.auth, provider);
      if (result.user.email?.toLowerCase() !== ALLOWED_EMAIL) {
        await firebaseSignOut(this.auth);
        throw new Error(`Only ${ALLOWED_EMAIL} can use Cards and Study right now.`);
      }
      this.user = {sub:result.user.uid, name:result.user.displayName || result.user.email, email:result.user.email};
      this.ready = true;
      this.loadBackup();
      this.busy = false;
      await this.sync();
    } finally { this.busy = false; this.emit(); }
  }
  async signOut() {
    await firebaseSignOut(this.auth);
    this.user = null; this.deck = {}; this.studies = {}; this.lastVerse = null; this.lastVerseUpdatedAt = 0; this.status = 'Signed out.'; this.emit();
  }
  async sync() {
    if (!this.authorized || this.busy) return;
    this.busy = true; this.status = 'Syncing cards and studies with Firebase…'; this.emit();
    try {
      const root = collection(this.db, 'users', this.user.sub, 'cards');
      const studiesRoot = collection(this.db, 'users', this.user.sub, 'studies');
      const [cardsSnapshot, studiesSnapshot] = await Promise.all([getDocs(root), getDocs(studiesRoot)]);
      const remoteDeck = {}, remoteStudies = {};
      cardsSnapshot.forEach(snapshot => {remoteDeck[snapshot.id] = snapshot.data();});
      studiesSnapshot.forEach(snapshot => {remoteStudies[snapshot.id] = snapshot.data();});
      const localDeck = this.deck, localStudies = this.studies;
      this.deck = mergeDecks(this.deck, remoteDeck);
      for (const [id, study] of Object.entries(remoteStudies)) if (!this.studies[id] || (study.updatedAt || 0) > (this.studies[id].updatedAt || 0)) this.studies[id] = study;
      const pending = [];
      for (const [id, card] of Object.entries(localDeck)) if (!remoteDeck[id] || (card.updatedAt || 0) > (remoteDeck[id].updatedAt || 0)) pending.push(setDoc(doc(this.db, 'users', this.user.sub, 'cards', id), card));
      for (const [id, study] of Object.entries(localStudies)) if (!remoteStudies[id] || (study.updatedAt || 0) > (remoteStudies[id].updatedAt || 0)) pending.push(setDoc(doc(this.db, 'users', this.user.sub, 'studies', id), study));
      const metadata = await getDocs(collection(this.db, 'users', this.user.sub, 'metadata'));
      metadata.forEach(item => {const data = item.data(); if (item.id === 'reading' && data.lastVerse) {this.lastVerse = data.lastVerse; this.lastVerseUpdatedAt = data.updatedAt || 0;}});
      if (this.lastVerse) pending.push(setDoc(doc(this.db, 'users', this.user.sub, 'metadata', 'reading'), {lastVerse:this.lastVerse, updatedAt:this.lastVerseUpdatedAt}));
      await Promise.all(pending);
      this.backup(); this.status = `Saved to Firebase · ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
    } catch (error) {
      this.status = `${error.message} ${this.backupAvailable === false ? 'Keep this page open to preserve local changes.' : 'Your browser backup remains available.'}`;
      throw error;
    } finally { this.busy = false; this.emit(); }
  }
  async write(path, id, data) {
    if (!this.authorized) throw new Error('Sign in with the allowed Google account to save data.');
    this.busy = true; this.status = 'Saving to Firebase…'; this.emit();
    try {
      await setDoc(doc(this.db, 'users', this.user.sub, path, id), data);
      this.backup(); this.status = `Saved to Firebase · ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
    } catch (error) { this.status = `${error.message} Your browser backup remains available.`; throw error; }
    finally {this.busy = false; this.emit();}
  }
  mutate(id, card) { this.deck[id] = card; this.backup(); this.emit(); void this.write('cards', id, card).catch(error => {this.status = error.message; this.emit();}); }
  mutateStudy(id, study) { this.studies[id] = study; this.backup(); this.emit(); void this.write('studies', id, study).catch(error => {this.status = error.message; this.emit();}); }
  setLastVerse(reference) {
    if (!this.authorized || this.lastVerse === reference) return;
    this.lastVerse = reference; this.lastVerseUpdatedAt = Date.now();
    void this.write('metadata', 'reading', {lastVerse:reference, updatedAt:this.lastVerseUpdatedAt}).catch(error => {this.status = error.message; this.emit();});
  }
}
