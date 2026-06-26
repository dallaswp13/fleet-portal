# Fleet Portal — Project Folder Guide

This folder is organized for professional version management. Here's what everything is and how to use it.

---

## 📁 Folder Structure

```
Fleet Portal/
├── fleet-portal-production/    ← LIVE SITE (see below)
│   └── fleet-portal/           ← Git repository — the active codebase
├── _archive/                   ← Old manual version snapshots (v1.1–v1.40)
├── _tools/                     ← Supporting scripts and utilities
│   ├── Claude Intent Parser/
│   └── Update Database Files/
└── README.md                   ← This file
```

---

## 🚀 The Live Site (`fleet-portal-production/fleet-portal`)

This is the only folder you need to work in day-to-day. It is a **Git repository** connected to your live deployment. Any changes committed and pushed here will affect the live site.

**Current version:** v1.40
**Git history available:** v1.31 → v1.40 (tagged)

### How version control works now

Instead of copying the whole folder to make a new version, Git tracks every change automatically. Here's the basic workflow:

1. Make your changes inside `fleet-portal-production/fleet-portal/`
2. When you're happy with the changes, commit them with a version label
3. Push to deploy

You no longer need to manually create `fleet-portal-v1.XX` folders — Git is your version history.

---

## 📦 Archive (`_archive/`)

These are the old manual version snapshots made before Git was fully adopted. They are **read-only reference copies** — do not edit them.

- **v1.1–v1.30** — Pre-Git snapshots (not in repository history)
- **v1.31–v1.40** — Also captured in Git history with tags

If you ever need to look at what the site looked like at a specific old version, check this folder or use `git checkout v1.XX` inside the production repo.

---

## 🔧 Tools (`_tools/`)

Supporting scripts and utilities that are not part of the live site codebase.

| Folder | Purpose |
|--------|---------|
| `Claude Intent Parser/` | Voice/intent parsing scripts |
| `Update Database Files/` | Database import files and scripts |

---

## ✅ Quick Reference

| Task | How to do it |
|------|-------------|
| See version history | Open `fleet-portal-production/fleet-portal/CHANGES.md` |
| Roll back to a version | `git checkout v1.XX` inside the repo |
| Find an old snapshot | Look in `_archive/fleet-portal-vX.XX/` |
| Update the live site | Commit + push inside `fleet-portal-production/fleet-portal/` |
