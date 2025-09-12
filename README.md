<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1nP0B5ED6Fccu6AXPiDrpD5BMq4-oARpE

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create [.env.local](.env.local) and set:
   - `OPENROUTER_API_KEY=<your OpenRouter key>` (used for SVG lessons + Flash agent)
   - `GEMINI_API_KEY=<your Gemini key>` (used for live TTS audio only)
3. Run the app:
   `npm run dev`

Note: Exposing API keys in the browser is not recommended for production. Use a small server proxy for OpenRouter requests in production deployments.
