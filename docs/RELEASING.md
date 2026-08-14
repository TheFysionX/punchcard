# Releasing Punchcard

Punchcard uses a public GitHub repository, npm package allowlisting, CI across supported operating systems and Node.js versions, and npm trusted publishing for releases after the first publish.

## One-time repository setup

1. Create the public `TheFysionX/punchcard` GitHub repository from this working tree.
2. Protect `main`: require CI, CodeQL, and one current branch before merge; block force pushes and deletion.
3. Create a GitHub environment named `npm`. Add required reviewers if releases should require a final click.
4. Enable GitHub private vulnerability reporting.
5. Confirm the npm account uses two-factor authentication.

## First npm publish

Trusted-publisher configuration is attached to an npm package, so the first publication may need to be performed manually:

```sh
npm login
npm run release:check
npm publish --access public
```

Then open the package's npm **Settings > Trusted Publisher**, select GitHub Actions, and configure:

- organization or user: `TheFysionX`
- repository: `punchcard`
- workflow: `release.yml`
- environment: `npm`
- allowed action: `npm publish`

The repository URL in `package.json` must exactly match the public GitHub repository.

Create the `v1.0.0` GitHub release after the manual publish. The workflow detects that the exact npm version already exists and exits successfully without attempting to overwrite it.

## Normal release

1. Update the version with `npm version --no-git-tag-version <major|minor|patch>`.
2. Update `CHANGELOG.md` and its comparison link.
3. Run `npm run release:check`.
4. Commit and merge the release changes to `main`.
5. Create a GitHub release whose tag exactly matches `v<package version>`.

Publishing that GitHub release triggers `.github/workflows/release.yml`. It verifies the tag, runs the package's prepublish checks, and uses npm's GitHub OIDC trusted publisher with provenance. No long-lived npm token is stored in GitHub.

## Verify the published release

```sh
npm view punchcard-presence version dist.integrity repository --json
npx --yes punchcard-presence help
```

Confirm that the GitHub release, npm version, changelog entry, and provenance all refer to the same commit and semantic version.

## Bad release

Do not overwrite a published npm version. Fix forward with a new patch version. If a release is unsafe, deprecate it with a clear message and remove the GitHub release only if doing so will not hide evidence users need to recover.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [npm provenance](https://docs.npmjs.com/generating-provenance-statements/), and [GitHub's Node.js package publishing guide](https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages).
