# Quranic Words web app

A static, responsive Quran reader and Urdu dictionary with Firebase-backed flashcards and studies. It uses Amiri and Scheherazade New, inspired by `gui-app`.

## Run locally

Keep the two repositories as siblings, each with its own `.git` directory:

```text
quranic-usage-text/
  quranic-usage-text/
  quranic-words/
```

Use Node.js 20 or newer (24 recommended):

```powershell
cd quranic-words
npm ci
npm run dev
```

Open http://localhost:4173. `npm run build` generates `dist`; `npm run preview` serves an existing build. `npm test` runs data, verse alignment, review scheduling and mocked Drive integration checks.

Local builds automatically refresh `data/entries.json` and `data/qwords.json` from the sibling `../quranic-usage-text` repository using its existing `scripts/export-web-data.mjs` exporter. You can also run `npm run sync-data` explicitly. The exporter only reads the source repository and writes sanitized snapshots into this repository; source files remain unchanged. If the sibling repository is absent (as on GitHub Actions), builds use the committed snapshots. If it is present but its export fails, the build fails so stale data is not silently published.

After changing master data, run `npm run sync` here to refresh the public snapshots and rebuild the web app. Use `npm run sync-check` to also run the web app checks after syncing and building. These commands are one-way: they read from `../quranic-usage-text/data` and write only to this repository's `data` and generated `dist` folders. The web app never writes to the master repository.

The build reads those sanitized snapshots and generates a complete root-grouped TOC, public entries, a verse-count manifest, and one word-mapping file per Surah. Public entries have an explicit field allowlist: `id`, `word`, `markdown_ur`, `nouns`, `verbs`, `root`, and generated `rootId`. English `markdown`, usage data and master flashcards are never copied. Generated output is ignored by Git.

After updating source data, run `npm run build` and `npm test` here, then commit and push this repository's code and refreshed `data` snapshots. Run Git commands from the appropriate sibling folder to push each repository independently. The source repository's older export instructions use the previous nested layout; from that repository, the new manual export command is `node scripts/export-web-data.mjs ../quranic-words/data`.

## GitHub Pages

1. In **Settings → Pages → Build and deployment**, choose **GitHub Actions** (one-time setup).
2. Push these files to the repository's `main` branch. The workflow automatically tests, builds and deploys on every push to `main`.
4. Follow **Actions → Deploy Quranic Words web app** for the build and deployment status. You can also use **Run workflow** to retry without another commit.

The expected URL for this repository is `https://farazshuja.github.io/quranic-words/`. Add `farazshuja.github.io` to Firebase Authentication's authorized domains before testing live sign-in.

All assets and data use relative URLs, so repository Pages paths such as `https://owner.github.io/repository/` work. Hash navigation needs no server rewrite rules. This workflow publishes the app at that Pages site's root; a repository has one Pages site, so this replaces any existing Pages deployment when you run it. To host under `/web-app/` alongside existing documentation, include `dist` at that subpath in your existing combined Pages artifact instead.

## Enable Firebase sign-in and Firestore

1. In Firebase Console → **Authentication → Sign-in method**, enable **Google**. Under **Settings → Authorized domains**, add `localhost` and `farazshuja.github.io` (plus any custom domain).
2. Create the project's **Cloud Firestore** database.
3. Deploy the included allowlist rules with Firebase CLI from this repository: `firebase deploy --only firestore:rules`. They permit only verified `farazshuja@gmail.com` to access `users/{uid}`.
4. Verify the deployed rules in Firebase Console → Firestore → Rules.

Firebase web config is public by design; Firestore security depends on the deployed rules. Cards live at `users/{uid}/cards/{entryId}`, studies at `users/{uid}/studies/{studyId}`, and the last verse at `users/{uid}/metadata/reading`. Firebase Analytics is not initialized, and the public dictionary remains available without sign-in.

Only verified `farazshuja@gmail.com` is allowed by both the app and Firestore rules. Sign-in and Firestore errors are shown in the UI. Google sign-in must be enabled in Firebase Console.

## Flashcards and synchronization

Hearts toggle saved words and root entries. Cards shows all saved entries with their due dates and last rating; clicking an entry opens the same dictionary card. Study shows due cards, initially hides the answer, then offers **Easy / Medium / Difficult / Failed**. Failed returns in 10 minutes; other choices increase intervals with an ease factor. This is an Anki-style scheduler, not Anki's exact SM-2 or FSRS implementation. Every rating persists grade, interval, due timestamp, ease, review count and lapse count.

Cards and studies are stored as per-user Firestore documents. Card removals remain as tombstones to avoid resurrection from stale caches. An account-specific browser backup is retained for recovery. Dictionary content is never stored in Firestore.

Use manual sync when switching devices. Writes use per-record timestamps, assume reasonably accurate device clocks, and cannot guarantee transactional writes for simultaneous offline edits on multiple devices or tabs. Browse the local privacy page for clearing local caches and deleting cloud data. Keep the page open until a failed save is retried if browser storage is unavailable.

## Verse lookup

Verses come from [Al Quran Cloud's Ayah endpoint](https://alquran.cloud/api), using the `quran-uthmani` edition. Dictionary IDs come exclusively from the corresponding source `qwords` verse: the app does not guess entries for unmapped words. A missing/broken ID shows **No word found**. Orthographic differences are handled by word position when counts match. Initial Bismillah tokens are removed for alignment when the API includes four extra tokens on a Surah's first verse (except Surahs 1 and 9). On other count mismatches, only a conservative normalized subsequence is mapped and the UI shows an alignment notice. This does not attempt to resolve every edition/tokenization discrepancy.

The last successfully fetched verse and its reference are stored locally and automatically restored. For signed-in users, the last opened reference is also synced to Firestore so it can be restored on another device. That cached verse is available if the API is temporarily unavailable; other uncached verses require connectivity. Fonts and Firebase sign-in also require network access. Urdu Markdown is rendered with raw HTML escaped, allowed elements sanitized and link protocols restricted. Entries without `markdown_ur` show an unavailable-explanation message; English content is not substituted.

Verse references inside Urdu explanations are clickable and open the verse in the reader, filling the search box automatically. A range such as `37:6-7` opens its first Ayah (`37:6`). References are checked against the Quran's Surah/Ayah counts before becoming links.

