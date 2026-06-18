# fleet-portal — Multilingual AI Support Agent for a 1,000+ Driver Fleet

[![Live](https://img.shields.io/badge/Live-fleet--portal-000?logo=vercel)](https://fleet-portal-navy.vercel.app/)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Anthropic Claude](https://img.shields.io/badge/Anthropic_Claude-D97757?logo=anthropic&logoColor=white)

A production AI support agent that gives 1,000+ taxi drivers instant, 24/7 help over text — in any language — backed by a fleet/driver management database. Designed, built, and deployed solo.

## Why it matters
Drivers used to wait ~5 minutes for a human to answer a support text, and after hours or on weekends often no one was available — so a device issue could idle a driver (and their income) until business hours. fleet-portal closed that gap.

- ⚡ **First response cut from ~5 minutes to ~5 seconds**
- 🌍 **Any language** — drivers get help in their native language automatically
- 🤖 **~50 interactions/day automated**, reclaiming **600+ staff hours/year**
- 🕒 **24/7 uptime** keeps drivers earning when no human support is online

## What it does
- **Intent parsing** — recognizes common requests (e.g., device reboots) and resolves them automatically
- **Human-in-the-loop escalation** — routes complex issues to staff instead of guessing
- **Multilingual replies** with a consistent, professional support tone
- **Fleet database** — driver/device records and a management UI

## How it works
Driver text → MaaS360 integration → LLM (Anthropic Claude) classifies intent → auto-resolve or escalate → reply generated in the driver's language.

## Tech
TypeScript · Anthropic Claude API · MaaS360 API · Vercel · _(database: add)_

## Screenshots
_Add 2–3 screenshots (chat flow, dashboard) here — screenshots carry a private/visual project far._

## Local setup
_Document env vars and run steps here. **Never commit real keys or driver data** — use a gitignored `.env` and demo data only._
