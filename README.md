# Organisational Dysfunction

|  |  |
|---|---|
| **Creator** | Sigurd Sæther Sørensen |
| **Based on** | Trond Hjorteland — *Organisational Dysfunction of the Day* ([full list](https://www.linkedin.com/pulse/organisational-dysfunction-day-full-list-trond-hjorteland-gxrze/)) |
| **Framework** | Open sociotechnical systems theory (DP1 / DP2) |
| **Contents** | 1 skill · 59 dysfunctions |
| **Version** | 0.1.0 |

A GitHub Copilot agent skill of org-design knowledge for diagnosing the recurring ways organisations and teams get stuck — and what to actually do about them.

It packages **59 named dysfunctions** from Trond Hjorteland's *"Organisational Dysfunction of the Day"* series, all read through the same lens: **open sociotechnical systems theory (OST)** and its DP1 (top-down bureaucracy) vs DP2 (self-managing teams) distinction.

## What's inside

One sharp, cleanly-triggering skill — `organisational-dysfunction` — built on the [Agent Skills](https://agentskills.io/) progressive-disclosure pattern:

- **`SKILL.md`** — the always-loaded router. Holds the shared DP1/DP2 lens once, plus an index of all 59 dysfunctions grouped by theme.
- **`references/NN-*.md`** — one lean file per dysfunction: how it shows up, the sociotechnical diagnosis (the *why*), and concrete remedies. Copilot reads only the one(s) that match.

## When it triggers

Whenever someone describes a workplace or team problem that smells structural rather than personal: stuck or slow decisions, hollow agile ceremonies (standups, retros, OKRs, DORA, Team Topologies), disengagement or "quiet quitting", a "frozen middle", stalled change initiatives, AI dropped into a broken process, or blame aimed at people instead of the system.

## Installation

The skill follows the open [Agent Skills](https://agentskills.io/) standard, so it works across GitHub Copilot in VS Code, the Copilot CLI, and the Copilot cloud agent. In every case it activates **automatically** when you describe an org/team dysfunction — you never call it by name.

> **One word worth knowing:** a **skill** is the unit of knowledge — a `SKILL.md` folder that Copilot loads on demand when your task matches its description.

### GitHub Copilot in VS Code

This repo already ships the skill under `.github/skills/organisational-dysfunction/`, so opening the repo in VS Code is enough — Copilot discovers it automatically, no install step. To confirm, open Chat, type `/skills`, and check that **organisational-dysfunction** is listed.

To make it available in **every** workspace, copy it into your personal skills folder:

```bash
git clone https://github.com/sorensensig/organisational-dysfunction
cp -r organisational-dysfunction/.github/skills/organisational-dysfunction ~/.copilot/skills/
```

(On Windows PowerShell: `Copy-Item -Recurse organisational-dysfunction/.github/skills/organisational-dysfunction $HOME/.copilot/skills/`.)

### GitHub Copilot CLI

Personal skills in `~/.copilot/skills/` are picked up by the CLI as well. Alternatively, install it straight from the repo with GitHub CLI:

```bash
gh skill install sorensensig/organisational-dysfunction
```

### Team / scripted setup

To have a whole team pick it up automatically, commit the skill under `.github/skills/` in your project repo (as this repo does). Copilot discovers project skills there for everyone who opens the repository — no per-user install required.

## Attribution

The references **synthesise and paraphrase** [Trond Hjorteland](https://www.linkedin.com/in/trondhjort/)'s publicly posted series through the OST framing he uses — they are not verbatim copies. For his own words, see his article [**"Organisational Dysfunction of the Day — full list"**](https://www.linkedin.com/pulse/organisational-dysfunction-day-full-list-trond-hjorteland-gxrze/) on LinkedIn (which links every individual post) and his forthcoming (2026) book.

Each reference file also notes its source dysfunction number; the corresponding original post can be found via the full-list article above.
