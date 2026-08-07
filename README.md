# Realtime Speech Translator

A realtime speech translator built with Next.js 15. Captures audio from your browser microphone, streams it to OpenAI's Realtime API over WebRTC, auto-detects the input language, and plays back an English translation as speech.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy the example env file and add your OpenAI API key:
   ```
   cp .env.example .env.local
   ```
   Then edit `.env.local` and set `OPENAI_API_KEY` to your key.

3. Start the dev server:
   ```
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000), click the mic button, and start speaking. The translated English speech will play back through your speakers.
