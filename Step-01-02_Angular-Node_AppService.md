# TaskFlow Learning Journey — Steps 1 & 2

**Stack:** Angular (frontend) + Node.js/Express (backend) → Azure App Service → (later) Docker → ACR → AKS
**Rule for the whole journey:** the application never changes in a way that matters — only *how Azure hosts it* changes. If something breaks later, that discipline is what lets you say "the app is fine, the hosting is wrong" instead of debugging both at once.

---

## STEP 1 — Create the Angular + Node.js application

### Objective
Build a Node.js/Express API (`/api/hello`, `/api/health`) and an Angular frontend that calls it, running entirely on your laptop, with zero Azure resources involved. Prove it works locally before anything touches the cloud.

### Architecture

```
┌─────────────┐        HTTP GET /api/hello        ┌───────────────────────┐
│   Browser    │ ──────────────────────────────────▶│  Angular dev server   │
│ localhost    │                                     │   ng serve :4200      │
└─────────────┘                                     └───────────┬───────────┘
                                                                  │ proxies /api/*
                                                                  ▼
                                                        ┌───────────────────────┐
                                                        │ Node.js / Express API  │
                                                        │         :3000          │
                                                        └───────────────────────┘
```

**Why the proxy exists:** the Angular dev server (4200) and the Express API (3000) are different origins. A direct browser call to `http://localhost:3000/...` triggers a CORS check unless the API explicitly allows it. The Angular proxy config makes `/api/*` look same-origin during development — and this exact "one hostname, multiple backends by path" idea reappears in Step 4 (custom path config) and again in AKS Ingress later. Learn it once, recognize it three times.

### Folder layout

```
taskflow-app/
├── backend/     Node.js / Express API
└── frontend/    Angular application
```

### Build the backend

`backend/server.js`:

```js
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());

const APP_VERSION = process.env.APP_VERSION || '1.0.0';

app.get('/api/hello', (req, res) => {
  res.json({
    message: 'Hello from Node.js API',
    version: APP_VERSION,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'Healthy', version: APP_VERSION });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
```

`backend/package.json` needs a `start` script — this matters again in Step 2, because App Service runs this exact script:

```json
{
  "name": "taskflow-api",
  "version": "1.0.0",
  "scripts": { "start": "node server.js" },
  "dependencies": { "express": "^4.19.0", "cors": "^2.8.5" }
}
```

```bash
cd backend
npm init -y
npm install express cors
node server.js
```

**Why `APP_VERSION` is read from an environment variable, with a fallback, from day one:** this single line is *why* Step 2 (App Service Application Settings) and later Kubernetes ConfigMaps just work without touching this file again. You're not adding configuration support later — you already built it.

### Build the frontend

```bash
cd ..
ng new frontend --routing=false --style=css
cd frontend
```

`frontend/proxy.conf.json`:

```json
{
  "/api": { "target": "http://localhost:3000", "secure": false }
}
```

`frontend/src/app/app.component.ts`:

```ts
import { Component, OnInit } from '@angular/core';
import { HttpClient, HttpClientModule } from '@angular/common/http';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [HttpClientModule],
  template: `<h1>{{ message }}</h1><p>version: {{ version }}</p>`
})
export class AppComponent implements OnInit {
  message = 'Loading...';
  version = '';
  constructor(private http: HttpClient) {}
  ngOnInit() {
    this.http.get<any>('/api/hello').subscribe(res => {
      this.message = res.message;
      this.version = res.version;
    });
  }
}
```

```bash
ng serve --proxy-config proxy.conf.json
```

### Expected result

`http://localhost:4200` shows **"Hello from Node.js API"** and **"version: 1.0.0"** — proof the Angular app reached the Express API through the proxy.

### Verification checklist

- [ ] `node server.js` starts; `curl http://localhost:3000/api/health` returns `{"status":"Healthy",...}`
- [ ] `ng serve --proxy-config proxy.conf.json` starts with no errors
- [ ] Browser shows the live message and version, not "Loading..." forever
- [ ] Setting `APP_VERSION` as an env var before `node server.js` changes what the browser shows, with zero code changes

### Common errors — Step 1

| Symptom | Cause | Fix |
|---|---|---|
| Browser stuck on "Loading..." | Missed `--proxy-config` flag, or backend not running | Confirm backend is up on `:3000`; restart Angular with the proxy flag |
| CORS error in console | `cors()` middleware missing, or calling the absolute URL instead of the relative proxied path | Keep `app.use(cors())`; call `/api/hello`, not `http://localhost:3000/api/hello` |
| `ng: command not found` | Angular CLI not installed globally | `npm install -g @angular/cli` |
| Port 3000 already in use | Leftover Node process from an earlier run | Kill the old process, or set a different `PORT` env var |

---

## STEP 2 — Deploy to two Azure App Services

### Objective

Host the exact app from Step 1 on Azure using **two separate App Service instances** — proving the same codebase can run independently in two places, each with its own URL, and (in later steps) its own version.

### Architecture

```
┌───────────────┐     ┌──────────────────────────────┐
│ Resource Group │     │   App Service Plan             │
│ rg-taskflow    │────▶│   asp-taskflow (Linux, B1)     │
└───────────────┘     └───────────────┬────────────────┘
                                        │
                       ┌────────────────┴────────────────┐
                       ▼                                   ▼
           ┌─────────────────────┐             ┌─────────────────────┐
           │ app-taskflow-api-01  │             │ app-taskflow-api-02  │
           │ Node.js API          │             │ Node.js API          │
           └─────────────────────┘             └─────────────────────┘
```

**Why the Plan is a separate resource from the App Service:** the **Plan** is the actual compute you're billed for — VM size, OS, scaling tier. The **App Service** is just an application slot running on that compute. Two App Services on one Plan share the same underlying VM(s) — cheaper while learning, and "what's the difference between an App Service and an App Service Plan" is close to a guaranteed interview question, so internalize this now.

### Prerequisites

- Azure CLI installed and `az login` completed
- The working app from Step 1

### Azure Portal steps

1. **portal.azure.com** → **Create a resource** → **Resource Group** → name `rg-taskflow`, pick a region near you.
2. Inside the resource group → **Create** → **Web App**:
   - Name: `app-taskflow-api-01` (must be globally unique across all of Azure — the portal tells you immediately if it's taken)
   - Publish: **Code**
   - Runtime stack: **Node 20 LTS**
   - Operating System: **Linux**
   - Plan: create new → `asp-taskflow` → Pricing tier **B1 Basic** (the free **F1** tier is too limited for reliable deploys)
3. **Review + create**.
4. Repeat step 2 for `app-taskflow-api-02`, but this time choose **existing Plan** → `asp-taskflow`, instead of creating a new one.

### Azure CLI

```bash
RG=rg-taskflow
LOCATION=eastus
PLAN=asp-taskflow

az group create --name $RG --location $LOCATION

az appservice plan create \
  --name $PLAN --resource-group $RG \
  --sku B1 --is-linux

az webapp create \
  --name app-taskflow-api-01 --resource-group $RG \
  --plan $PLAN --runtime "NODE:20-lts"

az webapp create \
  --name app-taskflow-api-02 --resource-group $RG \
  --plan $PLAN --runtime "NODE:20-lts"
```

**What each command actually does:**
- `az group create` — the container every other resource in this journey will live inside; deleting it later cleans up everything at once.
- `az appservice plan create --sku B1 --is-linux` — provisions the compute. `--is-linux` matters: Linux and Windows App Service Plans are fundamentally different backing infrastructure and you can't mix Linux/Windows apps on the same plan.
- `az webapp create --runtime "NODE:20-lts"` — creates the App Service *and* tells Azure which language runtime container to run your code inside.

### Deploy the backend code

```bash
cd backend
zip -r ../api.zip . -x "node_modules/*"

az webapp deploy --resource-group $RG --name app-taskflow-api-01 --src-path ../api.zip --type zip
az webapp deploy --resource-group $RG --name app-taskflow-api-02 --src-path ../api.zip --type zip
```

**Why exclude `node_modules` from the zip:** `az webapp deploy` hands the zip to **Oryx**, App Service's build system, which runs `npm install` server-side using your `package.json`. If you zip `node_modules` in yourself, Oryx sometimes assumes the app is "pre-built" and skips the install step — which is fine until a dependency version mismatch between your machine and the Linux container bites you. Let Oryx do it.

### Expected result

```bash
curl https://app-taskflow-api-01.azurewebsites.net/api/hello
curl https://app-taskflow-api-02.azurewebsites.net/api/hello
```

Both return their own JSON independently, each showing `"version": "1.0.0"`.

### Verification checklist

- [ ] `az webapp list --resource-group $RG -o table` shows both apps as **Running**
- [ ] Both `/api/health` endpoints return HTTP 200
- [ ] `az webapp log tail --name app-taskflow-api-01 --resource-group $RG` shows a clean start, no crash loop

### Common errors — Step 2

| Symptom | Cause | Fix |
|---|---|---|
| Default "Your app is running" placeholder page instead of your JSON | Zip deploy skipped `npm install` because `node_modules` was included | Zip only source + `package.json`; let Oryx install |
| 502 Bad Gateway | App crashed on startup — usually a hardcoded port | Read `process.env.PORT` in `server.js`; never hardcode 3000 for the deployed app |
| "Name already taken" during create | App Service names are globally unique across **all** Azure customers, not just your subscription | Add a unique suffix, e.g. `-yourinitials` |
| Deploy succeeds, old content still shows | Browser cache | `curl` instead of the browser to confirm the real state |

---

## Interview Q&A — detailed, with scenarios and real problems faced

### Conceptual — Step 1 (the application layer)

**Q1. Why does the Angular dev server need a proxy config to reach the Node API, and what breaks without it?**
The browser enforces the Same-Origin Policy. `localhost:4200` and `localhost:3000` are different origins even though both say "localhost," so a direct `fetch`/`HttpClient` call to `:3000` triggers a CORS preflight — and without `cors()` middleware on the API, the browser blocks the response before your code ever sees it. The proxy config rewrites `/api/*` requests so they appear to come from `:4200` itself, sidestepping the whole problem *in development only* — it has no effect on the built production bundle, which is why production hosting (Steps 2–4) needs its own answer to "how does the frontend reach the backend."

**Q2. What's the practical difference between `ng serve` and `ng build`?**
`ng serve` compiles in memory, serves it via a dev server with live reload, and is never meant to be deployed. `ng build` (typically `--configuration production`) writes real, minified static files to `dist/` — HTML, JS, CSS — which is what actually gets hosted anywhere (App Service, Static Web Apps, nginx, a CDN). If you ever find yourself trying to "deploy" the output of `ng serve`, that's the mistake.

**Q3. Why read `APP_VERSION` from an environment variable now, when no Azure resource exists yet to set one?**
Because the *cost* of adding configuration flexibility later — after the app is already deployed three different ways — is much higher than adding it now, in five minutes, while there's only one code path to change. This is a general principle, not an Azure-specific one: design for externalized config before you have multiple environments, not after.

---

### Conceptual — Step 2 (App Service)

**Q4. What is the actual difference between an App Service Plan and an App Service?**
The **Plan** is billed compute — a set of VM instances at a given size/tier (B1, P1v3, etc.) and OS (Linux/Windows). The **App Service** is a logical application slot that runs *on* that compute; you can put multiple App Services on one Plan and they share the underlying VM(s) and its resource limits. Scaling the Plan (more/bigger instances) scales every App Service on it together; you cannot scale one App Service on a shared Plan independently of the others.

**Q5. If two App Services share one Plan and one gets hit with heavy traffic, does the other one suffer?**
Yes, potentially — they share the Plan's CPU/memory/instance count. A traffic spike on one can starve the other if the Plan isn't scaled up. This is exactly the tradeoff of "cheaper while learning" vs. "isolated in production" — a real production setup would usually put unrelated apps on separate Plans specifically to avoid this blast radius.

**Q6. Why does `az webapp deploy` (zip deploy) need a `start` script in `package.json`, rather than just running a file directly?**
Because Oryx's build/run contract for Node apps is generic — it doesn't know your entry-point filename. `npm start` is the one command it always knows to invoke after `npm install`. If `start` is missing or points at the wrong file, the container builds successfully but never actually launches your server, which usually shows up as a 502 with no obvious error in your own code.

---

### Scenario-based questions

**Scenario 1:** *"Your manager says: 'The API works when I test it with curl, but the frontend can't reach it once both are deployed to Azure.' What do you check first?"*
Locally the fix was a dev-server proxy — but that proxy doesn't exist once the Angular app is built as static files and hosted somewhere. In production the frontend's JS bundle needs the API's **real absolute URL** baked in at build time (e.g. via `environment.prod.ts`), or a reverse proxy / path-mapping in front of both. First check: what URL is the deployed frontend bundle actually calling? Open browser dev tools → Network tab → look at the failed request's target URL, not just "it doesn't work."

**Scenario 2:** *"You deployed a new version to `app-taskflow-api-01` and now `/api/hello` 502s, but `/api/health` on `app-taskflow-api-02` still works fine. What's your triage order?"*
Since the two App Services share nothing except the Plan, and only one is broken, this points at the deploy itself, not shared infrastructure. Triage order: (1) `az webapp log tail` on the broken app — is it even starting? (2) check the `start` script and whether `process.env.PORT` is actually being read; (3) confirm the zip didn't accidentally include a broken `node_modules` that shadows what Oryx installs.

**Scenario 3:** *"The client wants App Service 1 and App Service 2 to always run the exact same version, deployed together, with no chance of drift. How would you change your deployment process to guarantee that, using only what you've learned so far?"*
Deploy the identical zip artifact to both in the same script/pipeline run rather than as two separate manual commands run at different times — build once, deploy the one artifact twice. (This is the seed of what a CI/CD pipeline formalizes later: one build stage, multiple deploy stages against the same artifact.)

**Scenario 4:** *"You're asked to estimate cost before provisioning. What single Azure CLI/portal fact determines most of the bill for Step 2, and why?"*
The **App Service Plan's SKU/tier** (B1 here) — because both App Services ride on the same Plan, you're billed once for the Plan's compute regardless of how many App Services sit on it. Adding a third App Service to the same Plan doesn't multiply the cost; adding a second *Plan* would.

**Scenario 5:** *"A teammate says 'let's just put everything — frontend, backend, and eventually five other microservices — on one App Service Plan to save money.' What's your pushback?"*
Cost savings are real, but so is the shared blast radius (Q5 above): one noisy or crashing app can degrade every app on that Plan, and you lose the ability to scale services independently based on their actual individual load. The right answer is usually "group by criticality and load pattern," not "group everything."

---

### Real problems faced (with root cause and fix)

**Problem 1 — "It deploys successfully every time, but the site shows the default placeholder page."**
*Root cause:* the zip included `node_modules`, so Oryx treated it as a pre-built app and skipped `npm install` — but the pre-built `node_modules` didn't match what the Linux container expected (some native modules are platform-specific), so the app silently failed to start and App Service fell back to the placeholder.
*Fix:* rezip excluding `node_modules` entirely (`zip -r ../api.zip . -x "node_modules/*"`), redeploy, let Oryx install fresh inside the Linux container.

**Problem 2 — "Works fine for a few minutes after deploy, then starts 502-ing intermittently."**
*Root cause:* the API was leaking connections/listeners on every restart because `PORT` was hardcoded to `3000` instead of read from `process.env.PORT` — App Service's internal routing occasionally reassigns the container's port, and a hardcoded value stopped matching what the platform expected after a warm restart.
*Fix:* `const PORT = process.env.PORT || 3000;` — always defer to the platform's assigned port in any hosted environment; the hardcoded fallback is for local dev only.

**Problem 3 — "curl works, but the browser shows a CORS error, only in production, not locally."**
*Root cause:* `cors()` was configured with no origin restriction locally (fine for dev), but once deployed, a teammate had "hardened" it by allowlisting only `http://localhost:4200` — which of course doesn't match the real production frontend's domain.
*Fix:* make the CORS allowlist configuration-driven (another environment variable, same principle as `APP_VERSION`) rather than hardcoded, so each environment sets its own allowed origin without a code change.

**Problem 4 — "Both App Services show 'Running' in the portal, but only one actually responds."**
*Root cause:* "Running" in the portal reflects the **App Service resource's** state, not whether the **Node process inside it** started successfully — a crashed Node process still leaves the App Service resource itself in "Running" state; Azure restarts the container in a loop but the portal's top-level status doesn't reflect that.
*Fix:* never trust the portal's green "Running" badge alone — always confirm with `az webapp log tail` or a direct `curl` to the actual endpoint.

---

Say **CONTINUE** for Step 3 — deployment slots, and demonstrating stop/restart on a slot.
