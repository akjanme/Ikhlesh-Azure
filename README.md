# TaskFlow — Azure Cloud & DevOps Learning Journey

**Goal:** understand not just *how* to deploy an app on Azure, but *why* an organization would choose each rung on this ladder:

```
App Service (x2) → Deployment Slot → Custom Path → Docker → ACR → AKS (2 pods, 1 container each) → self-healing → AKS (1 pod, 2 containers)
```

One application is reused end-to-end — never rewritten, only re-hosted:

- **Frontend:** Angular
- **Backend:** Node.js / Express, exposing `/api/hello` and `/api/health`, JSON responses, version info driven by an environment variable

That one design choice (config via env var, from Step 1) is what makes every later step — App Service settings, Docker `-e` flags, Kubernetes env vars — feel like the same idea reused, not a new thing to learn each time.

## The 11 steps

1. Create the Angular + Node.js application (local only, no Azure)
2. Deploy to **two** Azure App Services, same Plan
3. Add a **deployment slot** to one App Service — deploy, verify independently, stop/restart it
4. Configure a **custom path** (`/myapp`) on one App Service
5. **Dockerize** both the frontend and backend
6. Push both images to **Azure Container Registry (ACR)**
7. Deploy the **same image** to **AKS**
8. Run **2 pods, 1 container per pod**, exposed via a Kubernetes Service
9. Delete a pod and observe **Kubernetes self-healing**
10. Create a separate example: **1 pod, 2 containers**
11. Demonstrate **communication between the two containers** in that pod

## Folder convention

Save each file into this folder as you go, then `git add` / `git commit` / `git push`:

```
<your-learning-folder>\Ikhlesh-Azure\
├── README.md                          <- this file, tracker
├── TaskFlow_Steps-01-06.md            <- Steps 1–6, done
├── TaskFlow_Steps-07-09.md            <- Steps 7–9, next
├── TaskFlow_Steps-10-11.md            <- Steps 10–11, after that
└── (or one running file per your own preference — see note below)
```

**Note on file granularity:** files have been grouped in batches (1–6 together) rather than strictly one-per-step, since several early steps are short. Going forward, ask for a new file whenever you want a checkpoint, or say "give me all steps into md" again at any point to get a fresh consolidated file covering everything completed so far.

## How this works

- Each step is taught one at a time, in chat, in this format: objective, ASCII architecture diagram, prerequisites, Portal steps, CLI commands, Docker commands / Kubernetes YAML where relevant, expected result, verification checklist, common errors/troubleshooting, and interview questions.
- Don't move to the next step until every box in the current step's **verification checklist** is genuinely checked — later steps assume earlier resources actually exist and actually respond correctly, not "probably work."
- Say **CONTINUE** when you're ready for the next step. I'll briefly recap what should already be true, then teach the next one.
- Ask for the content to be saved as a `.md` file (as with Steps 1–6) whenever you want a checkpoint to push to git — the interview section in that file also gets expanded with full answers, scenario-based questions, and real "problems faced" write-ups, not just question prompts.

## Progress tracker

- [x] Step 1 — Angular + Node.js app, local
- [x] Step 2 — Two App Services
- [x] Step 3 — Deployment slot: create, deploy, stop/restart
- [x] Step 4 — Custom path `/myapp`
- [x] Step 5 — Dockerization
- [x] Step 6 — Push to ACR
- [x] Step 7 — Deploy to AKS
- [x] Step 8 — 2 pods, 1 container each + Service
- [x] Step 9 — Delete a pod, observe self-healing
- [x] Step 10 — 1 pod, 2 containers
- [x] Step 11 — Demonstrate inter-container communication

All 11 steps complete. The full record lives in two files: `TaskFlow_Steps-01-06.md` and `TaskFlow_Steps-07-11.md` — push both to git alongside this file.

**Suggested next move:** re-run the whole journey once, end to end, without looking at either file except when genuinely stuck. That's the difference between having followed instructions and having actually learned it.
