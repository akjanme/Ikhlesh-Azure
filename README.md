# Azure Learning Journey — Ikhlesh

**Goal:** understand not just *how* to deploy an app on Azure, but *why* an organization would choose each rung on this ladder:

```
App Service → Deployment Slots → Custom Path → Docker → AKS (2 pods, 1 container each) → AKS (1 pod, 2 containers)
```

One application is reused end-to-end: an **ASP.NET Core Web API** with `/api/hello` and `/api/health`, both returning JSON with a version number. That's deliberate — the app never changes meaningfully; only *how Azure hosts it* changes. That contrast is the whole lesson.

## Folder convention

Save each phase as its own file in this folder as you go:

```
D:\2026 Learning From Beginning\Ikhlesh-Azure\
├── README.md                          <- this file, tracker
├── Phase1-Create-AspNetCore-WebAPI.md <- done first
├── Phase2-AppService.md               <- next, on "CONTINUE"
├── Phase3-DeploymentSlots.md
├── Phase4-CustomPath.md
├── Phase5-Dockerization.md
├── Phase6-AksFundamentals.md
├── Phase7-Aks-2Pods-1Container.md
├── Phase8-Aks-1Pod-2Containers.md
├── Phase9-Comparison.md
└── Phase10-FinalChallenge.md
```

## How this works

- Each phase file is self-contained: objective, diagram, prerequisites, portal steps, CLI commands, YAML (once relevant), expected output, verification, common errors, interview questions, mini quiz, practical task.
- Each phase is time-boxed to roughly **2 hours** of focused work.
- Don't move to the next phase file until every box in that phase's **Verification** section is checked for real (not "it probably works") — the next phase assumes the previous one's resources actually exist and actually respond correctly.
- When you're ready for the next phase, just say **CONTINUE** — I'll briefly recap what should be true right now, then hand you the next file.

## Progress tracker

- [ ] Phase 1 — Create the ASP.NET Core Web API
- [ ] Phase 2 — Two Azure App Services, same app, independent versions
- [ ] Phase 3 — Deployment slot (staging → production swap)
- [ ] Phase 4 — Custom path configuration (`/myapp`)
- [ ] Phase 5 — Dockerization + push to ACR
- [ ] Phase 6 — Kubernetes/AKS fundamentals (concepts only)
- [ ] Phase 7 — AKS: 2 pods, 1 container each
- [ ] Phase 8 — AKS: 1 pod, 2 containers (sidecar)
- [ ] Phase 9 — Comparison: App Service vs Slot vs Container vs Pod vs Deployment vs AKS
- [ ] Phase 10 — Final end-to-end challenge

Start with `Phase1-Create-AspNetCore-WebAPI.md`.
