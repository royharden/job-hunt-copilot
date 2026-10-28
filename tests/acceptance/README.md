# Independent reviewer checks

Default `npm test` includes repository checks. Recovery UI tests additionally need reviewer-only JSDOM tooling:

```powershell
npm install --prefix .agent-work/rv-tooling --ignore-scripts --no-audit --no-fund jsdom@26.1.0 playwright-core@1.55.1 pg@8.16.3
npx --no-install vitest run --config tests/acceptance/ui.vitest.config.ts
```

Tooling stays outside the product manifest/lock. UI setup loads its own synthetic DOM and auth client; it never uses a signed-in browser or remote auth. The recovery file must run with that config. Full default test integration is reconciled before final acceptance; separate commands are recorded explicitly.
