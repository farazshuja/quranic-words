# Quranic Words web app

A static, responsive Quran reader and Urdu dictionary with Google Drive flashcards. It uses Amiri and Scheherazade New, inspired by `gui-app`. No application server or client secret is needed.

## Run locally

Use Node.js 20 or newer (24 recommended):

```powershell
cd quranic-words
npm ci
npm run dev
```

Open http://localhost:4173. `npm run build` generates `dist`; `npm run preview` serves an existing build. `npm test` runs data, verse alignment, review scheduling and mocked Drive integration checks.

The build **only reads** the sanitized `data/entries.json` and `data/qwords.json` snapshots. It generates a complete root-grouped TOC, public entries, a verse-count manifest, and one word-mapping file per Surah. Public entries have an explicit field allowlist: `id`, `word`, `markdown_ur`, `nouns`, `verbs`, `root`, and generated `rootId`. English `markdown`, usage data and master flashcards are never copied. Generated output is ignored by Git.

## GitHub Pages

1. In **Settings → Pages → Build and deployment**, choose **GitHub Actions** (one-time setup).
2. Push these files to the repository's `main` branch. The workflow automatically tests, builds and deploys on every push to `main`.
3. Your public OAuth client ID is already in `config.json`. You can optionally override it with the repository Actions variable `GOOGLE_CLIENT_ID`. No secret or extra variable is required for the current configuration.
4. Follow **Actions → Deploy Quranic Words web app** for the build and deployment status. You can also use **Run workflow** to retry without another commit.

The expected URL for this repository is `https://farazshuja.github.io/quranic-words/`. Add `https://farazshuja.github.io` to the Google OAuth client's authorized JavaScript origins before testing live sign-in.

All assets and data use relative URLs, so repository Pages paths such as `https://owner.github.io/repository/` work. Hash navigation needs no server rewrite rules. This workflow publishes the app at that Pages site's root; a repository has one Pages site, so this replaces any existing Pages deployment when you run it. To host under `/web-app/` alongside existing documentation, include `dist` at that subpath in your existing combined Pages artifact instead.

## Enable Google sign-in and private Drive storage

1. Create a Google Cloud project and **enable Google Drive API**.
2. Configure Google Auth Platform branding, audience and consent. Add your deployed privacy-page URL (`https://owner.github.io/repository/#privacy`) and application homepage. In testing mode add your Google account and other intended users as test users; publish the consent configuration for public access when ready.
3. Create an OAuth 2.0 client of type **Web application**.
4. Under **Authorized JavaScript origins**, register `http://localhost:4173` and `https://owner.github.io` (origins have no repository path). Add any custom-domain origin as well. The popup token flow does not use a redirect URI.
5. Put the public client ID in `config.json` or the repository variable above and rebuild. **Do not add a client secret.**

The app uses Google's browser [token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model) with `openid`, `email`, `profile`, and [`https://www.googleapis.com/auth/drive.appdata`](https://developers.google.com/workspace/drive/api/guides/appdata). It checks granted access and fetches the authenticated account profile. Anyone who can authorize this OAuth application can use Study/Cards; there is no owner-maintained email allowlist. Client-side authentication protects access to the user's Drive data; the public dictionary is available to everyone.

Google tokens remain in memory. After a page reload or token expiry, users select sign-in again to reconnect their account. The app never stores access or refresh tokens. Google sign-out ends this app's session, without signing out of the user's other Google services. Failed/cancelled popups, rejected permissions and Drive errors are surfaced in the UI. Actual Google authorization must be tested with your configured OAuth project and a real account.

## Flashcards and synchronization

Hearts toggle saved words and root entries. Cards shows all saved entries with their due dates and last rating; clicking an entry opens the same dictionary card. Study shows due cards, initially hides the answer, then offers **Easy / Medium / Difficult / Failed**. Failed returns in 10 minutes; other choices increase intervals with an ease factor. This is an Anki-style scheduler, not Anki's exact SM-2 or FSRS implementation. Every rating persists grade, interval, due timestamp, ease, review count and lapse count.

The app stores a versioned `quranic-words-cards-v1.json` in the user's private Drive app-data folder, with an account-specific local browser backup. Sync reads remote records first and merges by per-card timestamp. Removed cards remain as tombstones to avoid resurrection by stale local caches. Changes made during a sync get another sync pass. Sync retries on reconnection and can be triggered manually. The application folder uses a small amount of the user's Drive storage and cannot access their ordinary files.

Use manual sync when switching devices. This lightweight file-based approach uses last-write-wins timestamps, assumes reasonably accurate device clocks, and cannot guarantee transactional writes for simultaneous offline edits on multiple devices or tabs. Browse the local privacy page for clearing local caches and deleting hidden cloud data. Keep the page open until a failed save is retried if browser storage is unavailable. Dictionary content itself is never stored in Drive.

## Verse lookup

Verses come from [Al Quran Cloud's Ayah endpoint](https://alquran.cloud/api), using the `quran-uthmani` edition. Dictionary IDs come exclusively from the corresponding source `qwords` verse: the app does not guess entries for unmapped words. A missing/broken ID shows **No word found**. Orthographic differences are handled by word position when counts match. Initial Bismillah tokens are removed for alignment when the API includes four extra tokens on a Surah's first verse (except Surahs 1 and 9). On other count mismatches, only a conservative normalized subsequence is mapped and the UI shows an alignment notice. This does not attempt to resolve every edition/tokenization discrepancy.

The last successfully fetched verse and its reference are stored locally and automatically restored. That cached verse is available if the API is temporarily unavailable; other uncached verses require connectivity. Fonts and Google sign-in also require network access. Urdu Markdown is rendered with raw HTML escaped, allowed elements sanitized and link protocols restricted. Entries without `markdown_ur` show an unavailable-explanation message; English content is not substituted.

Verse references inside Urdu explanations are clickable and open the verse in the reader, filling the search box automatically. A range such as `37:6-7` opens its first Ayah (`37:6`). References are checked against the Quran's Surah/Ayah counts before becoming links.

