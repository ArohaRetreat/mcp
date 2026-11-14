# Delivery

## Documentation review

Every PR records a visible decision under **Documentation impact**. Use one of these lines.

```text
Updated: <affected guides or links>
No change: <reason the guides still apply>
```

Foundation CI checks for the entry. The PR review checks the accuracy and scope of the decision, including for Dependabot. Use the [Aroha handbook](https://aroharetreat.github.io/website/handbook/) for public instructions and keep private operational details in the owning service's documentation.

These practices and the bundled skill were adopted from [App Launchpad 1.14.0](https://github.com/theharithsa/app-launchpad-template/releases/tag/v1.14.0), source `97aff26610feed99e9d0329c8eab4ea33794c1ed`. The template metadata records the original scaffold.

- [Issue-to-merge and release procedure](../.agents/skills/app-launchpad/references/github-release.md)
- [Authorization and safety](../.agents/skills/app-launchpad/references/safety.md)
- [Evidence states](../.agents/skills/app-launchpad/references/evidence.md)
- [Baseline repository ruleset](repository-ruleset.md)
- [Template versions and consumer upgrades](versioning.md)

## Prepared0.3.0 — contract1.3

Issue6 adds121 typed tools from the website’s canonical1.3 contract, including read-only POST customer lookup. Ten package tests pass locally, including real SDK stdio CRUD/denial and native metrics/logs/traces to a synthetic collector. The production dependency audit reports zero vulnerabilities. Source generation, reviewed merge, npm publication, fresh-cache integrity verification and live API availability are separate gates. Existing connected grants are not widened.
