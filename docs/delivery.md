# Delivery

- [Issue-to-merge and release procedure](../.agents/skills/app-launchpad/references/github-release.md)
- [Authorization and safety](../.agents/skills/app-launchpad/references/safety.md)
- [Evidence states](../.agents/skills/app-launchpad/references/evidence.md)
- [Baseline repository ruleset](repository-ruleset.md)
- [Template versions and consumer upgrades](versioning.md)

## Prepared0.3.0 — contract1.3

Issue6 adds121 typed tools from the website’s canonical1.3 contract, including read-only POST customer lookup. Ten package tests pass locally, including real SDK stdio CRUD/denial and native metrics/logs/traces to a synthetic collector. The production dependency audit reports zero vulnerabilities. Source generation, reviewed merge, npm publication, fresh-cache integrity verification and live API availability are separate gates. Existing connected grants are not widened.
