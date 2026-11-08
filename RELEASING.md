# Publishing releases

A version tag publishes everything, in the order the MCP Registry requires. The workflow is `.github/workflows/release.yml`.

1. Merge the reviewed update after CI succeeds. The version must be the same in `package.json`, `server.json` and `src/server.ts`; the test suite checks it. Regenerate `server-card.json` with `npm run catalog` and add a `CHANGELOG.md` section for the version.
2. Tag the merge commit with the version, such as `v1.0.0`, and push the tag.
3. The workflow checks that the tag matches `package.json`, audits runtime dependencies, typechecks, builds and runs the tests.
4. It publishes the npm package with provenance through trusted publishing. No npm token is stored in the repository; the package needs a trusted publisher on npmjs.com that points at this repository and `release.yml`.
5. It creates the GitHub release for the tag, with the notes taken from the matching `CHANGELOG.md` section.
6. It publishes `server.json` to the MCP Registry, authenticated by the `getmcpads.com` DNS key.

Each step skips cleanly when its target already holds the version, so rerunning a partial release is safe. To publish an existing tag again, run the Release workflow manually and give it the tag.

The README distinguishes source installation from package installation, because the GitHub release, npm and the registry can briefly differ while a release is in progress.

Before tagging, add the release to CHANGELOG.md as `## X.Y.Z - YYYY-MM-DD - Title`, then run `npm run release-history`. The README shows every release from the changelog, and the test suite fails when it falls behind.
