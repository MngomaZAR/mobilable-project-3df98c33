# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Papzi (SnapBook) is a React Native / Expo photography marketplace mobile app. It connects clients with local photographers. The backend is a **hosted Supabase instance** (no local backend server needed). See `README.md` and `QUICK_START.md` for full feature details.

### Running the app

- **Dev server (web):** `npx expo start --web --port 8081`
- **Dev server (all platforms):** `npm start` (then press `w` for web, `a` for Android, `i` for iOS)
- The app runs on port 8081 by default in web mode.

### Lint / Test / Build

- **Lint:** `ESLINT_USE_FLAT_CONFIG=false npx eslint --ext .js,.jsx,.ts,.tsx src/` — the project uses `.eslintrc.js` (ESLint 8-style config) but installs ESLint 9+; you must set `ESLINT_USE_FLAT_CONFIG=false`.
- **Tests:** `npm test` — runs Jest with `--passWithNoTests`. 3 test suites, 6 tests.
- **TypeScript check:** `npx tsc --noEmit` — there are pre-existing type errors in the codebase (not introduced by setup).

### Key caveats

- `npm install` requires `--legacy-peer-deps` due to a peer dependency conflict between `react@^19.1.0` and `react-native@0.76.1` (expects `react@^18.2.0`).
- The `.env` file contains Supabase credentials (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`) that are already committed. The Supabase project at `luxppjfrlsnvtslundfz.supabase.co` must be reachable for auth/data features to work.
- Auth sign-in/sign-up shows "TypeError: Failed to fetch" in the cloud environment because the Supabase instance may not be reachable from the VM network. The rest of the app UI (Home, Bookings, Feed tabs, photographer profiles) renders and navigates correctly without auth.
- The optional Hasura Docker backend (`npm run hasura:up`) is not required for normal development.
