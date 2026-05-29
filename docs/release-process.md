# Dibao Release Process

This document records the release workflow for Dibao's BUSL-1.1 delayed-open-source licensing model.

## BUSL Version Management

1. Every release tag must freeze `LICENSE.md`.
2. Every version's Release Date is the date that specific version is first publicly released.
3. Every version's Change Date is its Release Date plus 4 years.
4. The Change License is fixed as Apache License 2.0 (`Apache-2.0`).
5. The `main` branch `LICENSE.md` can represent the current development version and may contain TODO dates, but legal certainty comes from the `LICENSE.md` in each release tag.
6. Docker images and GitHub Releases must use explicit version numbers. Do not rely only on `latest`.
7. After the Change Date, maintainers may add a `vX.Y.Z-apache` convenience tag or update the GitHub Release notes to state that the version is now available under Apache-2.0. This is not required for the license change to take effect.

## Sentry Release Telemetry

Formal release and hotfix Docker images must be built with the private Sentry build config injected through BuildKit secret `dibao_sentry_config`. In GitHub Actions, keep the private JSON in the `DIBAO_SENTRY_CONFIG_JSON` repository secret and write it only to a temporary runner file before passing it through `docker/build-push-action` `secret-files`.

Do not hardcode or print runtime Sentry DSN, org, project, or auth tokens in tracked source, workflow logs, release notes, or chat output.

Before calling a Docker release installable, verify the published image contains a non-empty runtime Sentry config at `/app/.dibao/sentry.json` and that the bundled Web app was built with a non-empty browser Sentry DSN. The verification report may say `hasDsn: true`, `hasOrg: true`, and `hasProject: true`, but must not reveal the actual values.

If the Sentry config is missing or empty, treat the release image as invalid and republish the same release candidate after fixing the publish pipeline. For a same-version pipeline-only repair, do not bump `package.json` or move the release tag unless the user explicitly asks for a new version or tag move; republish the affected Docker image tags and record the digest change.

## Release Checklist

- [ ] Update `package.json` version.
- [ ] Confirm Release Date.
- [ ] Calculate Change Date as Release Date plus 4 years.
- [ ] Run `node scripts/release/update-license.mjs <version> <release-date>`.
- [ ] Confirm `LICENSE.md` has the correct Licensed Work, Release Date, and Change Date.
- [ ] Confirm Docker license labels carry `BUSL-1.1`, `Apache-2.0`, and the release Change Date.
- [ ] Confirm the private Sentry build config is available to the release workflow and injected as BuildKit secret `dibao_sentry_config`.
- [ ] Update CHANGELOG or release notes.
- [ ] Check README License section for accuracy.
- [ ] Run release gates appropriate for the release scope.
- [ ] Create the release tag only after explicit approval.
- [ ] Publish the Docker image with an explicit immutable version tag.
- [ ] Verify the published Docker image has non-empty runtime and browser Sentry config without printing private values.
