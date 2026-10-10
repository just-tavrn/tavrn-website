# Rebuilding the download page on a release

The download page is built from `src/data/downloads.json`, which `scripts/fetch-releases.mjs` writes from the latest
GitHub releases of `tavrn-web` (the desktop installers) and `tavrn-node` (the container image tag) at the start of
every `pnpm build`. The website's image workflow (`.github/workflows/image.yml`) already listens to a
`repository_dispatch` of type `release-published`, so a new release only has to send that event once its installers
are attached.

## What tavrn-web's release workflow needs

Add one job to `tavrn-web/.github/workflows/release.yml` that runs after `desktop` (the job that attaches the
installers, the updater signatures and `latest.json` through `desktop.yml`'s `release-assets` job):

```yaml
  website:
    name: Rebuild the download page
    needs: desktop
    if: ${{ vars.CI_ENABLED == 'true' }}
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - name: repository_dispatch to tavrn-website
        env:
          GH_TOKEN: ${{ secrets.WEBSITE_DISPATCH_TOKEN }}
          TAG: ${{ github.ref_name }}
        run: |
          if [ -z "$GH_TOKEN" ]; then
            echo "::warning::WEBSITE_DISPATCH_TOKEN is not set: the download page is not rebuilt automatically"
            exit 0
          fi
          gh api --method POST repos/just-tavrn/tavrn-website/dispatches \
            -f event_type=release-published \
            -F "client_payload[repository]=$GITHUB_REPOSITORY" \
            -F "client_payload[tag]=$TAG"
```

The same step with the action instead of `gh` (pinned by commit like the organization's other actions):

```yaml
      - uses: peter-evans/repository-dispatch@28959ce8df70de7be546dd1250a005dd32156697 # v4.0.1
        with:
          token: ${{ secrets.WEBSITE_DISPATCH_TOKEN }}
          repository: just-tavrn/tavrn-website
          event-type: release-published
          client-payload: '{"repository": "${{ github.repository }}", "tag": "${{ github.ref_name }}"}'
```

The plain `gh api` call needs no third-party action and skips cleanly while the secret is missing; it is the
suggested variant.

`tavrn-node`'s release workflow can send the same event (with its own repository in the payload) so the image tag on
the page follows node releases too; the website does not read the payload, it always fetches both latest releases.

## The token

`GITHUB_TOKEN` of tavrn-web cannot trigger workflows in another repository. `WEBSITE_DISPATCH_TOKEN` is an
organization or repository secret of tavrn-web holding either

- a fine-grained personal access token with access to `just-tavrn/tavrn-website` only and the repository
  permission **Contents: Read and write** (what `POST /repos/{owner}/{repo}/dispatches` requires), or
- an installation token of an organization GitHub App with the same permission (`actions/create-github-app-token`).

## While the repositories are private

`fetch-releases.mjs` reads the releases anonymously unless `GITHUB_TOKEN` is set, and the image is built inside
`docker build` without a token. While `tavrn-web` and `tavrn-node` are private the API answers 404, the fetcher keeps
the committed example data (`"example": true`) and the page shows disabled buttons with the "no public release yet"
note. Once the repositories are public no token is needed. Building the image with real data from private
repositories would need the token as a BuildKit secret (`--secret id=github_token`) read by the Dockerfile's build
stage; that is not wired up, because the page is not meant to link private release assets anyway (visitors could not
download them).

To check the fetcher by hand: `GITHUB_TOKEN=$(gh auth token) just fetch-releases`. It refuses to write releases
without installers (the web bundle `tavrn-web-X.Y.Z.tar.gz` alone is not a download) and keeps the file untouched
when nothing changed, so a build leaves the working tree clean.
