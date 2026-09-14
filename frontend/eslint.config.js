// Minimal lint gate for the portal.
//
// It exists for one failure mode that `vite build` cannot catch: a reference
// to an identifier that no longer exists. The bundler compiles that happily
// and the page white-screens at render — which is exactly how /pms/planning
// went blank after a tab-bar refactor dropped a `const` but left one use of
// it 25 lines below.
//
// Deliberately narrow. This is not a style pass: there are ~60 pages written
// over a long period, and turning on a full ruleset would bury the two rules
// that actually prevent broken pages under thousands of cosmetic warnings
// nobody will read. Add rules when they earn their place.
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "../inet_app/public/portal/**",
      // src/modules/ is dead code: nothing in the app imports any of it, and
      // POIntake.jsx does not even parse (the file contains two concatenated
      // copies of itself, so `useEffect` is imported twice). It has been like
      // that since the first commit. Excluded so the gate stays meaningful
      // rather than always red — delete the directory and drop this entry.
      "src/modules/**",
    ],
  },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // The white-screen rule.
      "no-undef": "error",
      // Hooks called conditionally corrupt React's hook order — also a
      // runtime break the bundler is happy to emit.
      "react-hooks/rules-of-hooks": "error",
      // Stale-closure bugs are real but a judgement call, and several of
      // these deps arrays are deliberately partial with a comment saying so.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
