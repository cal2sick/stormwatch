# Contributing

Thanks for helping. Stormwatch is meant to be simple to run, honest about uncertainty, and useful when it matters.

1. Open an issue first for anything bigger than a small fix.
2. Fork, then branch from `main` (`fix-slider-snap`, `add-surge-layer`, ...).
3. `npm install`, make the change, then `npm run typecheck && npm test && npm run build`. Check it live with `npm start`.
4. Open a pull request with what changed, why, and how you checked it. CI must pass.

Ground rules (see [AGENTS.md](AGENTS.md) for the full list):
- Free, public, keyless data only. No telemetry.
- **Never commit personal data**: your coordinates, address, name, email, or local file paths. Use `.env` for your own settings; tests use arbitrary or public city coordinates.
- Official alert text stays verbatim; estimates are labeled; the safety banner stays.
- Readable plain-English UI text.

By contributing you agree your work is released under the [MIT License](LICENSE) and you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
