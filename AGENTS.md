# Repository Guidelines

## Project Structure & Module Organization
- Entry points: `index.html`, `index.tsx`, `App.tsx`.
- UI components in `components/` (e.g., `Header.tsx`, `SvgDisplay.tsx`).
- API/Audio logic in `services/` (`geminiService.ts`, `realtimeAudioService.ts`). `geminiService.ts` now calls OpenRouter for lesson generation and follow‑ups; `realtimeAudioService.ts`/`geminiLiveAudioService.ts` still use Gemini for TTS.
- Build output in `dist/` (ignored by Git). Config: `vite.config.ts`, `tsconfig.json`.
- Secrets in `.env.local` (ignored). Required: `OPENROUTER_API_KEY` (SVG + Flash), `GEMINI_API_KEY` (live audio).

## Build, Test, and Development Commands
- `npm run dev` — start Vite dev server (typically http://localhost:5173).
- `npm run build` — production build to `dist/`.
- `npm run preview` — serve the built app locally.
Notes: ensure `.env.local` includes `OPENROUTER_API_KEY` and, if using TTS, `GEMINI_API_KEY`. Vite exposes: `process.env.OPENROUTER_API_KEY` (OpenRouter) and `process.env.API_KEY`/`process.env.GEMINI_API_KEY` (Gemini live audio) via `vite.config.ts`.

## Coding Style & Naming Conventions
- Language: TypeScript + React function components and hooks.
- Indentation: 2 spaces; always use semicolons; single quotes preferred.
- Files: PascalCase for components (`Header.tsx`), camelCase for utilities/services (`geminiService.ts`).
- Exports: default for top-level pages, named exports for components/utilities.
- Imports: prefer alias `@` to root (e.g., `import { SvgDisplay } from '@/components/SvgDisplay';`).
- Keep side effects in `services/`; keep components presentational where possible.

## Testing Guidelines
- No test suite yet. If adding tests, use Vitest + React Testing Library.
- Location: `tests/` or `__tests__` beside source file.
- Naming: `*.test.ts` / `*.test.tsx`.
- Commands: `npx vitest` (and add `"test": "vitest"` to `package.json`). Target ≥80% critical-path coverage.

## Commit & Pull Request Guidelines
- Use Conventional Commits: `feat: ...`, `fix: ...`, `chore: ...`, `refactor: ...`.
- Keep PRs focused and small; describe the what/why/how, link issues, and include UI screenshots/GIFs when relevant.
- Checklist: build passes, manual smoke run (`npm run dev`), updated docs if behavior changes.

## Security & Configuration Tips
- Never commit secrets. `.env.local` is ignored, but rotate keys if leaked.
- Required env: `GEMINI_API_KEY=<your key>`; app maps it to `process.env.API_KEY` for `@google/genai`.
- Network: icons are fetched from `unpkg` at runtime; handle failures gracefully and avoid blocking UI.

## Agent-Specific Instructions
- Keep diffs minimal and style-consistent; prefer small, isolated changes.
- When adding files, follow the structure above and include brief inline JSDoc where helpful.
