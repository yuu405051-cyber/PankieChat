# PankieChat V2 — Full Feature Build

Responsive Liquid Glass chat app for desktop and mobile. Firebase project configuration is already set in `firebase.js`.

## Included
- Email/password sign up and sign in
- Unique usernames and username search
- Public General room and private one-to-one chats
- Realtime text messaging
- Reply, edit, delete, forward, reactions, pin/unpin
- Read receipts, online/last-seen and typing status
- Profile display-name and avatar URL editing
- Small photo, video, audio and file attachments stored as data URLs in Realtime Database (300 KB maximum per file)
- Voice recording and sending (browser microphone permission required)
- Location sharing (browser location permission required)
- Chat wallpaper presets
- Browser notification permission can be enabled by the browser; in-app toast feedback is included
- Mobile/desktop responsive layout and installable PWA shell

## Setup
1. In Firebase Console, confirm Email/Password Authentication is enabled.
2. Realtime Database → Rules: paste `database.rules.json` and Publish.
4. Serve this folder from a static host such as Netlify. Do not open `index.html` directly as a `file://` URL.
5. Test with two separate accounts (normal and private/incognito browser windows).

## Notes
- Attachments and voice messages do not use Firebase Storage. Each file is limited to 300 KB and counts toward your Realtime Database storage/bandwidth quota. Large videos/files are not suitable for this free method.
- Location sharing requires HTTPS and explicit browser permission.
- Voice recording requires HTTPS and microphone permission.
- Wallpaper choice is stored locally per browser/device.
- This is a functional starter build, not end-to-end encrypted. Do not treat it as a secure messenger for sensitive information.
- Account deletion, push notifications, group creation, and full privacy controls are not included in this build.
