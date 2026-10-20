# 01-nativewind-setup.md

Read AGENTS.md first and follow it strictly.

Set up NativeWind in this Expo app by following the NativeWind documentation below exactly. Do not use outdated setup steps or docs for other versions.

https://www.nativewind.dev/v5/getting-started/installation
https://www.nativewind.dev/v5/llms-full.txt

Before changing anything:

- Check `package.json` for the installed Expo SDK, React Native, NativeWind, Tailwind CSS, and `react-native-reanimated` / `react-native-safe-area-context` versions.
- If NativeWind is already installed, follow the setup for that exact version only.
- If NativeWind is not installed, stop and ask me before installing. Then list the exact packages and peer dependencies the docs require and install them with `npx expo install` so the versions are SDK-compatible.
- Tell me which NativeWind and Tailwind versions you are using before writing config.

Apply only the setup the installed version requires:

- `global.css` at the project root with the required Tailwind/NativeWind imports
- PostCSS config and/or `tailwind.config.js`, whichever the installed version uses. Set the content/source paths to `App.tsx` and `src/**/*.{ts,tsx}`
- `metro.config.js` wrapped with the NativeWind Metro helper, pointing at `./global.css`
- `babel.config.js` changes only if this version's docs require them
- TypeScript types: `nativewind-env.d.ts` (or the file the docs specify), included in `tsconfig.json`, so `className` type-checks on React Native components
- Import `global.css` once in the app entry. This app uses React Navigation with `App.tsx`, not Expo Router, so do not create an `app/` folder or `_layout.tsx`

Rules:

- Do not add Gracehush colors, fonts, or BEM utilities yet. That is the next step.
- Do not create screens, navigation, or components.
- Do not modify `app.json` plugins or any Clerk, Supabase, audio, or notification code.
- If AGENTS.md mentions `tailwind.config.js` but the installed version uses CSS-first config, follow the installed version and tell me.

To verify, temporarily render one `View` and `Text` in `App.tsx` using only classes (for example `flex-1 items-center justify-center bg-white` and `text-xl font-bold text-black`). Use inline style for `SafeAreaView`, per AGENTS.md. Mark it `// TEMP: NativeWind check — removed in 03`.

Then run:

```bash
npx expo start -c
npm run lint
npm run typecheck
```

Confirm that the styles render on both an iOS and an Android development build, and fix every error before finishing.

When done, list each file created or changed, the exact versions used, and any step from the docs you skipped and why.
