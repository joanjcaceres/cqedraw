# Contributing to cQEDraw

Thanks for helping improve cQEDraw. This guide is meant to make the first
contribution path clear whether you are fixing the Python desktop app, the web
app, documentation, or project packaging.

## Before You Start

- Check the issue tracker for an existing bug report, feature request, or
  discussion before opening a new one.
- Keep each change focused on one issue, bug, or feature. Smaller pull requests
  are easier to review and safer to merge.
- For larger UI, data model, generated output, packaging, or compatibility
  changes, open an issue first so the design can be discussed before
  implementation.
- If you are unsure where a change belongs, ask in the related issue. A short
  question is welcome.

## Reporting Bugs

When reporting a bug, include:

- What you expected to happen.
- What actually happened.
- Steps to reproduce the problem.
- Whether it happens in the web app, the Python desktop app, or both.
- Your operating system, browser, Python version, or Node.js version when
  relevant.
- Any error messages, screenshots, saved project JSON, or small example circuit
  that helps reproduce the issue.

If the bug affects generated matrices or copied snippets, include the expected
and actual generated `C` and `L_inv` behavior when possible.

## Requesting Features

For feature requests, describe:

- The workflow or problem the feature would improve.
- The users who would benefit from it.
- Any compatibility requirements for saved projects, generated snippets, or
  existing browser and desktop behavior.
- Any alternatives or workarounds you considered.

Design-heavy or output-changing features should start as an issue before a pull
request.

## Local Setup

cQEDraw has a Python desktop app and a web app. You only need the setup for the
area you are changing, but running both sets of checks is helpful when a change
touches shared behavior.

Pixi is not required for public contributors. The commands below use Python,
pip, and npm directly.

### Python Desktop App

Requirements:

- Python 3.11 or newer.
- Tkinter support in your Python installation if you want to launch the desktop
  GUI. Some Linux distributions package Tkinter separately, for example
  `python3-tk` on Debian and Ubuntu.

Set up the Python project from the repository root:

```bash
python -m pip install -e ".[dev]"
```

Run the Python test suite:

```bash
pytest
```

Verify the command-line entry point:

```bash
cqedraw --version
```

Launch the desktop app during manual testing:

```bash
python -m cqedraw
```

### Web App

Requirements:

- Node.js 22 is recommended because CI uses Node 22.

Set up the web app:

```bash
cd web
npm ci
```

Run the local development server:

```bash
npm run dev
```

Run the web checks:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

If Playwright has not installed a browser on your machine yet, install Chromium
before running the end-to-end tests:

```bash
npx playwright install chromium
```

On Linux CI-style environments, Playwright may also need system dependencies:

```bash
npx playwright install --with-deps chromium
```

## Generated Matrix And Snippet Behavior

cQEDraw's core promise is that the drawn circuit produces stable capacitance and
inverse-inductance output for Black Box Quantization workflows. Web and desktop
changes should preserve generated `C` and `L_inv` output behavior unless the
pull request explicitly changes the output contract.

Be especially careful with changes that affect:

- Node numbering, merge behavior, or ground handling.
- Capacitance or inverse-inductance matrix assembly.
- Symbol parsing or ordering.
- Generated Python snippets, including sparse matrix helpers.
- Saved project JSON that may be loaded by future versions.

When a pull request intentionally changes output behavior, document the old and
new behavior, explain why the change is needed, and add or update tests that
show the expected compatibility impact.

## Branches And Pull Requests

- Branch from the latest `main`.
- Use a descriptive branch name such as `fix-node-merge-test` or
  `docs-contributor-guide`.
- Link the related issue in the pull request description.
- Summarize what changed and why.
- Include the checks you ran. If a check was not run, say why.
- Keep unrelated formatting, refactors, generated assets, and dependency
  changes out of the pull request unless they are necessary for the issue.
- Do not change generated matrix or snippet behavior as a side effect. If a
  change is intentional, call it out clearly in the pull request.
- Update user-facing documentation when behavior, compatibility, installation,
  or release expectations change.

## Compatibility-Sensitive Changes

Please document compatibility-sensitive changes in the issue or pull request.
Examples include:

- Generated `C` and `L_inv` output changes.
- Saved project JSON format changes.
- Python version or dependency changes.
- Web browser, PWA, or GitHub Pages behavior changes.
- Desktop packaging, installer, or release artifact changes.
- Changes that affect how copied snippets work with downstream analysis code.

Good compatibility notes explain who is affected, whether old projects or
snippets still work, and how contributors or users should migrate.

## Asking Questions

Questions are welcome in issues and pull requests. For larger design changes,
open an issue before implementation and include enough context for reviewers to
compare options, risks, and compatibility tradeoffs.
