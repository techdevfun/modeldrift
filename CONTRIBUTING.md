# Contributing

Issues and pull requests are welcome. A few ground rules:

- Keep it zero-dependency and offline: modeldrift never calls a provider.
- Every new signal needs a unit test, and every new command needs an e2e test.
- Public content is English only. Run `npm run preflight` before opening a PR.
- Do not add features that judge output quality - modeldrift reports that
  outputs differ, never whether the new output is better or worse.
