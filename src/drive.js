import {mergeDecks} from './core.js';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'quranic-words-cards-v1.json';
const API = 'https://www.googleapis.com/drive/v3/files';

export class DriveCards {
  constructor({clientId, storage = localStorage, fetcher = globalThis.fetch.bind(globalThis), onChange = () => {}}) {
    Object.assign(this, {clientId, storage, fetcher, onChange});
    this.deck = {}; this.user = null; this.token = null; this.expires = 0;
    this.ready = false; this.busy = false; this.status = ''; this.generation = 0;
  }
  get authorized() { return this.ready && !!this.token && Date.now() < this.expires; }
  get cacheKey() { return this.user ? `qw.deck.${this.user.sub}` : null; }
  emit() { this.onChange(this); }
  backup() {
    try { this.storage.setItem(this.cacheKey, JSON.stringify({version: 1, cards: this.deck})); this.backupAvailable = true; }
    catch { this.backupAvailable = false; this.status = 'Browser storage is unavailable. Keep this page open until Drive sync succeeds.'; }
  }
  async signIn() {
    if (!this.clientId) throw new Error('Google sign-in has not been configured. Set the OAuth client ID in web-app/config.json and rebuild.');
    const oauth = globalThis.google?.accounts?.oauth2;
    if (!oauth) throw new Error('Google sign-in is still loading or was blocked. Check your connection and try again.');
    if (this.busy) return;
    this.busy = true; this.emit();
    const generation = this.generation;
    try {
      const response = await new Promise((resolve, reject) => {
        const client = oauth.initTokenClient({client_id: this.clientId, scope: `openid email profile ${DRIVE_SCOPE}`,
          callback: r => r.error ? reject(new Error(r.error_description || r.error)) : resolve(r),
          error_callback: e => reject(new Error(e.type === 'popup_closed' ? 'Sign-in window was closed.' : 'Could not open Google sign-in. Allow popups and try again.'))});
        client.requestAccessToken({prompt: 'select_account'});
      });
      if (generation !== this.generation) return;
      if (!oauth.hasGrantedAllScopes(response, DRIVE_SCOPE, 'openid', 'profile')) throw new Error('Allow profile and private app-data access to use flashcards.');
      this.token = response.access_token; this.expires = Date.now() + Number(response.expires_in) * 1000 - 30000;
      const profile = await this.request('https://www.googleapis.com/oauth2/v3/userinfo');
      if (generation !== this.generation) return;
      if (!profile.sub) throw new Error('Google did not return an account identity.');
      this.user = {sub: profile.sub, name: profile.name || profile.email || 'Google account'};
      let cached = {};
      try { cached = JSON.parse(this.storage.getItem(this.cacheKey) || '{}').cards || {}; } catch { /* malformed cache is ignored */ }
      this.deck = mergeDecks(cached); this.ready = true;
      this.status = 'Signed in. Loading cards from Drive…';
    } catch (error) {
      this.token = null; this.ready = false; throw error;
    } finally { this.busy = false; this.emit(); }
    if (this.authorized) await this.sync();
  }
  signOut() {
    this.generation++; this.token = null; this.expires = 0; this.ready = false;
    this.user = null; this.deck = {}; this.busy = false; this.status = ''; this.emit();
  }
  async request(url, options = {}) {
    if (!this.token || Date.now() >= this.expires) {
      this.token = null; throw new Error('Your Google session expired. Sign in again to sync your saved changes.');
    }
    const response = await this.fetcher(url, {...options, signal: AbortSignal.timeout(20000),
      headers: {...options.headers, Authorization: `Bearer ${this.token}`}});
    if (!response.ok) {
      if (response.status === 401) this.token = null;
      throw new Error(response.status === 401 ? 'Your Google session expired. Sign in again.' : `Google Drive request failed (${response.status}). Check your connection or Drive API configuration, then retry sync.`);
    }
    return response.status === 204 ? null : response.json();
  }
  mutate(id, card) {
    if (!this.authorized) throw new Error('Sign in with Google to save or review cards.');
    this.deck[id] = card; this.backup(); this.emit();
    // Changes during an in-flight sync are included by a subsequent pass.
    this.dirty = true;
    if (!this.busy) void this.sync();
  }
  async listFiles() {
    const files = []; let pageToken;
    do {
      const params = new URLSearchParams({spaces:'appDataFolder', q:`name = '${FILE_NAME}' and trashed = false`,
        fields:'nextPageToken,files(id,createdTime)', pageSize:'100'});
      if (pageToken) params.set('pageToken', pageToken);
      const result = await this.request(`${API}?${params}`);
      files.push(...(result.files || [])); pageToken = result.nextPageToken;
    } while (pageToken);
    return files.sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id));
  }
  async sync() {
    if (!this.authorized || this.busy) return;
    this.busy = true; this.status = 'Syncing with your private Drive folder…'; this.emit();
    const generation = this.generation;
    try {
      do {
        this.dirty = false;
        const files = await this.listFiles();
        const remoteDecks = [];
        for (const file of files) {
          const data = await this.request(`${API}/${encodeURIComponent(file.id)}?alt=media`);
          if (data.version !== 1 || !data.cards || typeof data.cards !== 'object' || Array.isArray(data.cards))
            throw new Error('The Drive card file has an unsupported format. It has not been overwritten.');
          remoteDecks.push(data.cards);
        }
        if (generation !== this.generation) return;
        this.deck = mergeDecks(...remoteDecks, this.deck);
        this.backup();
        const content = JSON.stringify({version:1, cards:this.deck});
        if (files.length) {
          await this.request(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(files[0].id)}?uploadType=media`,
            {method:'PATCH', headers:{'Content-Type':'application/json'}, body:content});
        } else if (Object.keys(this.deck).length) {
          const boundary = `qw_${crypto.randomUUID()}`;
          const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name:FILE_NAME, parents:['appDataFolder']})}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
          await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
            {method:'POST', headers:{'Content-Type':`multipart/related; boundary=${boundary}`}, body});
        }
        if (generation !== this.generation) return;
      } while (this.dirty);
      this.status = `Saved to Google Drive · ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`;
    } catch (error) {
      if (generation === this.generation) this.status = `${error.message} ${this.backupAvailable === false ? 'Keep this page open to preserve your unsaved changes;' : 'Your changes remain in this browser;'} retry sync after reconnecting.`;
    } finally {
      if (generation === this.generation) { this.busy = false; this.emit(); }
    }
  }
}
