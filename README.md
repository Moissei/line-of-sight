# Line of Sight

Line of Sight is an Expo SDK 57 / React Native app for nearby discovery, connection requests, and messaging. Routes live in `src/app`; shared components and client helpers live in `src/components` and `src/lib`.

## Setup and development

1. Install dependencies with `npm install`.
2. Copy `.env.example` to a local `.env` and supply the project's Supabase URL and publishable key. Do not commit local environment values.
3. Run `npm start` to start the Expo development server. Use an installed development build for native development; `eas.json` defines the development-client profile.

Existing platform commands are `npm run android`, `npm run ios`, and `npm run web`. They start Expo for the selected platform; they do not build a native binary.

## Validation

```sh
npx tsc --noEmit
npm run lint
node --test scripts/*.test.cjs
npx expo config --type public
git diff --check
```

The regression suite uses Node's test runner. On Windows PowerShell with script execution disabled, use `npm.cmd` and `npx.cmd`.

Read the versioned Expo documentation at https://docs.expo.dev/versions/v57.0.0/ before changing Expo integration. Push-notification and account-deletion review notes are in `docs/`.
