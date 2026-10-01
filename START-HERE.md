# PRSN Crimson — fresh project

## Pehle design dekho
1. Extract this ZIP into a new folder in VS Code.
2. Open index.html with Live Server. You can also open it directly for the design preview.
3. Enter your name. Your supplied new Supabase URL and publishable key are already in config.js. Complete the Supabase steps below before signing in. Empty config values can still be used for design preview.
4. No fake posts, counts or online users are generated. Live database setup is required.

## Naya Supabase connect karo
1. Open your new Supabase project: jhgqamhaxhfjsimslptx.
2. Enable Anonymous Sign-Ins in Authentication settings. No email or phone is required by this app.
3. Run all of setup.sql in that new project's SQL Editor.
4. config.js already contains the supplied new project URL and publishable key. No further key edits are needed.
5. Save and refresh. Use localhost/Live Server or an HTTPS deployment for uploads and browser identity.
6. Open Community chat and use Bachyo. The backend checks the codeword, case-insensitively.

If CAPTCHA is enabled for anonymous sign-in in your project, its widget/token integration must also be added; this starter does not include CAPTCHA.

## Files
- index.html: all screens and forms.
- style.css: black/blood-red design, glass cards, Playfair Display and DM Sans.
- script.js: preview guards, board, schedule, files and chat.
- config.js: only the NEW project URL and publishable key.
- setup.sql: tables, access rules, codeword function, private buckets and realtime publication.

Deploy index.html, style.css, script.js, config.js and your music/song.mp3 file. Do not publish setup.sql or this documentation.

## Included features
- Preparation notes, homework and general resources with subject filters and title search.
- PDF/photos up to 10 MB, private file storage, fresh open/download links.
- Dated preparation/homework posts displayed in the upcoming schedule.
- Live chat: latest 50 first, older history, text and attachments, own-message delete.
- Post deletion by the author, using an anonymous browser user ID.
- Responsive layout, keyboard focus states, reduced-motion support.
- Optional looping background music: add music/song.mp3 and tap Music. Volume starts at 18%. The audio file is not included. Voice calls and admin panel are not included.

## What access means
Names are display labels, not verified identity. Anyone able to open the site and obtain an anonymous session can use the study board. Chat requires the shared codeword, with server-side access rules. The codeword is a small-group gate, not strong identity verification; guess-rate limiting is not implemented. Approved browser sessions retain backend chat access even when the popup asks again.

Anonymous identity stays in that browser. Clearing browser data or using a different browser creates a new identity; it will not own your old posts. Multiple people using the same browser share the same anonymous identity. Attachments opened through a signed URL can be viewed by anyone holding that link until its five-minute expiry.

No old backend credentials or data are used. No Supabase project has been created or configured remotely by the assistant.

## Test after connecting
Use normal and incognito windows to simulate two friends. Share a note, dated homework, PDF and photo. Check subject/title filters and upcoming dates. Try a wrong chat code, then Bachyo. Send messages both ways, reload, and delete your own message. Confirm the other browser cannot delete it. Test opening and downloading files. If something fails, copy the visible error.

## Checks completed
- Desktop and 390px mobile preview checked in Chromium. No horizontal overflow or JavaScript errors during tested flows.
- Preview shows an explicit connection notice and rejects posting/chat actions before configuration.
- Mocked Supabase tests passed for named entry, creating posts, safely rendering text, codeword handling, sending and deleting messages.
- SQL rules reused from a locally validated setup: rerunnable migration, locked chat/files before unlock, per-user write/delete ownership and storage restrictions.
- Real Supabase auth, uploads and realtime still require testing against your NEW project.
- Preview screenshots use fallback fonts because Google Fonts was blocked in the test browser. The site requests Playfair Display and DM Sans when internet access permits.

## Current setup status
The supplied URL/key have been inserted into config.js. SQL has NOT been run remotely. Enable anonymous sign-in and run setup.sql in the dashboard. A publishable browser key cannot administer SQL or project settings.
