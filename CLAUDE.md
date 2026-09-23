# Speck

An open source RMM for Windows and Linux. This file orients an agent session;
it does not replace the documents it points to.

## Read first

- `AGENTS.md` — the operating rules for this repository. Follow them.
- `WORKBOOK.md` — current state, verification record and next action. Read it
  before changing any deployed system.
- `docs/progress/JOURNAL.md` — dated record of what was deployed and verified.
- `README.md` — capabilities, remote access model, layout and dev setup.

## Layout

```text
agent/       Go Windows/Linux services and desktop observer
server/      FastAPI control plane, authentication, jobs, remote relay, Slide
web/         TypeScript console
desktop/     Electron operator client
ios/         iPhone and iPad client
installers/  Windows and Linux enrollment installers
scripts/     Build, local checks and deployment helpers
deploy/      systemd, Caddy and firewall configuration
brand/       Identity guide, tokens and assets
docs/        Deployment, security, recovery and screenshots
output/      Ignored: private deployment state, lab identifiers, evidence
worktrees/   Linked worktrees, one per `codex/*` branch
```

## Checks

Local results are the release gate; hosted CI is a secondary check.

```sh
./scripts/check-local.sh core   # backend, Linux agent, platform builds, web unit and browser
./scripts/check-local.sh ios    # iPhone units and iPad layout, macOS only
```

Narrower loops: `uv run pytest`, `uv run ruff check server`,
`(cd agent && go test ./internal/agent)`, `npm run test:ui --prefix web`.

## Constraints

- Keep provider keys, credentials, customer configuration and private remote
  session data out of source control. Private material belongs in `output/`
  or the local operator vault.
- Windows and Linux are first-class targets. Report each platform's verified
  capabilities honestly; do not describe unverified behaviour as working.
- Recovery tests stay isolated. Preserve source machines; a restored endpoint
  must never impersonate or overwrite its original.
- Before a production build, confirm `origin/main` is an ancestor of the release
  commit and preserve deployed work that has not reached main. Re-compare the
  live index immediately before publishing.
- Record deployments and validation in `WORKBOOK.md` and the journal.
