# Voice to Text

A raw, browser-based voice-to-text (speech recognition) application. Speak into your
microphone and your words are transcribed to editable text in real time.

## How it works

- Uses the browser's built-in **Web Speech API** (`SpeechRecognition` /
  `webkitSpeechRecognition`). No external API keys or paid services are required.
- Runs entirely client-side. A minimal Node.js static file server (`server.js`)
  serves the files in `public/`.
- Supports live/interim results, multiple languages, copy-to-clipboard, and clearing.

## Browser support

Speech recognition requires a Chromium-based browser (Chrome, Edge, Brave). It is
not supported in Firefox. Microphone access is blocked inside embedded preview
iframes — open the app in a new browser tab and allow the microphone when prompted.

## Project layout

- `server.js` — minimal zero-dependency Node.js static server (port 5000).
- `public/index.html` — app markup.
- `public/style.css` — styling.
- `public/app.js` — speech recognition logic.

## Running

The "Start application" workflow runs `npm start` (which runs `node server.js`) on
port 5000.

## Deployment

Configured as a static deployment serving the `public/` directory.

## User preferences

- Keep the project a raw voice-to-text tool only — no additional features unless requested.
