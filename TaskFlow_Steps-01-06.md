# TaskFlow Learning Journey — Steps 1 through 6

**Stack:** Angular (frontend) + Node.js/Express (backend) → Azure App Service → Docker → Azure Container Registry → (next: AKS)
**Rule for the whole journey:** the application never changes in a way that matters — only *how Azure hosts it* changes. When something breaks, that discipline lets you say "the app is fine, the hosting is wrong" instead of debugging both at once.

---

## STEP 1 — Create the Angular + Node.js application

### Objective
Build a Node.js/Express API (`/api/hello`, `/api/health`) and an Angular frontend that calls it, entirely on your laptop, zero Azure resources involved.

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

**Why the proxy exists:** `localhost:4200` and `localhost:3000` are different origins even though both say "localhost" — a direct browser call triggers CORS unless the API explicitly allows it. The Angular proxy makes `/api/*` look same-origin during development. This "one hostname, many backends by path" idea reappears in Step 4 and again in AKS Ingress later.

### Folder layout
```
taskflow-app/
├── backend/     Node.js / Express API
└── frontend/    Angular application
```

### Backend

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

`backend/package.json` — the `start` script matters again in Step 2 (App Service runs this exact script):
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

**Why `APP_VERSION` is env-driven from day one:** this single line is why Step 2's App Service settings and later Kubernetes ConfigMaps just work without touching this file again.

### Frontend

```bash
cd ..
ng new frontend --routing=false --style=css
cd frontend
```

`frontend/proxy.conf.json`:
```json
{ "/api": { "target": "http://localhost:3000", "secure": false } }
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
`http://localhost:4200` shows **"Hello from Node.js API"** and **"version: 1.0.0"**.

### Verification checklist
- [ ] `curl http://localhost:3000/api/health` returns `{"status":"Healthy",...}`
- [ ] `ng serve --proxy-config proxy.conf.json` starts with no errors
- [ ] Browser shows live message/version, not "Loading..." forever
- [ ] Setting `APP_VERSION` before `node server.js` changes the displayed version with zero code changes

### Common errors
| Symptom | Cause | Fix |
|---|---|---|
| Stuck on "Loading..." | Missed `--proxy-config`, or backend not running | Confirm backend on `:3000`; restart with proxy flag |
| CORS error | Missing `cors()`, or calling the absolute URL directly | Keep `app.use(cors())`; call `/api/hello`, not the absolute URL |
| `ng: command not found` | Angular CLI not global | `npm install -g @angular/cli` |
| Port 3000 in use | Leftover process | Kill it, or change `PORT` |

---

## STEP 2 — Deploy to two Azure App Services

### Objective
Host the Step 1 app on Azure using **two separate App Service instances** — proving the same codebase runs independently in two places.

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

**Why the Plan is separate from the App Service:** the Plan is the billed compute (VM size, OS, tier); the App Service is a logical app slot running on it. Two App Services on one Plan share the same VM(s) — cheaper while learning, and the classic interview question.

### Portal steps
1. **Create a resource** → **Resource Group** → `rg-taskflow`.
2. Inside it → **Create** → **Web App**: name `app-taskflow-api-01`, Runtime **Node 20 LTS**, OS **Linux**, Plan: create new `asp-taskflow`, SKU **B1**.
3. Repeat for `app-taskflow-api-02`, using the **existing** `asp-taskflow` Plan.

### CLI
```bash
RG=rg-taskflow
LOCATION=eastus
PLAN=asp-taskflow

az group create --name $RG --location $LOCATION

az appservice plan create --name $PLAN --resource-group $RG --sku B1 --is-linux

az webapp create --name app-taskflow-api-01 --resource-group $RG --plan $PLAN --runtime "NODE:20-lts"
az webapp create --name app-taskflow-api-02 --resource-group $RG --plan $PLAN --runtime "NODE:20-lts"
```

### Deploy
```bash
cd backend
zip -r ../api.zip . -x "node_modules/*"

az webapp deploy --resource-group $RG --name app-taskflow-api-01 --src-path ../api.zip --type zip
az webapp deploy --resource-group $RG --name app-taskflow-api-02 --src-path ../api.zip --type zip
```

**Why exclude `node_modules`:** `az webapp deploy` hands the zip to **Oryx**, which runs `npm install` server-side. Zipping `node_modules` yourself can make Oryx skip the install, leaving a platform mismatch (native modules built for the wrong OS).

### Expected result
```bash
curl https://app-taskflow-api-01.azurewebsites.net/api/hello
curl https://app-taskflow-api-02.azurewebsites.net/api/hello
```
Both respond independently, both `version: "1.0.0"`.

### Verification checklist
- [ ] `az webapp list --resource-group $RG -o table` shows both **Running**
- [ ] Both `/api/health` return 200
- [ ] `az webapp log tail` shows a clean start, no crash loop

### Common errors
| Symptom | Cause | Fix |
|---|---|---|
| Placeholder page instead of JSON | Zip included `node_modules`, Oryx skipped install | Rezip without `node_modules` |
| 502 | Hardcoded port instead of `process.env.PORT` | Read `PORT` from env |
| "Name already taken" | App Service names are globally unique | Add a unique suffix |
| Old content after deploy | Browser cache | `curl` to confirm real state |

---

## STEP 3 — Deployment slot: create, stop, restart

### Objective
Add a **staging** slot to `app-taskflow-api-01`, deploy a changed version to it only, verify independently of production, then demonstrate **stopping and restarting** the slot as an operational action separate from deploying new code.

### Architecture
```
┌────────────────────────────────────────────┐
│           app-taskflow-api-01                │
│   ┌────────────────────┐  ┌───────────────┐ │
│   │   production slot   │  │  staging slot  │ │
│   │  (default hostname)  │  │ (own hostname) │ │
│   │   version 1.0.0      │  │ version 2.0.0  │ │
│   └────────────────────┘  └───────────────┘ │
└────────────────────────────────────────────┘
```

**Why a slot instead of deploying directly to production:** a slot gives the new version its own real, testable URL on the same App Service, before anyone else sees it. Only then do you promote it.

### Portal steps
1. `app-taskflow-api-01` → **Deployment slots** → **Add Slot** → name `staging`, don't clone settings.
2. Open the slot — note its distinct hostname: `app-taskflow-api-01-staging.azurewebsites.net`.
3. **Stop**: inside the slot → toolbar → **Stop**. **Restart**: same location → **Start**.

### CLI
```bash
RG=rg-taskflow

az webapp deployment slot create --name app-taskflow-api-01 --resource-group $RG --slot staging

cd backend
# bump: const APP_VERSION = process.env.APP_VERSION || '2.0.0';
zip -r ../api-v2.zip . -x "node_modules/*"
az webapp deploy --resource-group $RG --name app-taskflow-api-01 --slot staging --src-path ../api-v2.zip --type zip

az webapp stop --name app-taskflow-api-01 --resource-group $RG --slot staging
az webapp show --name app-taskflow-api-01 --resource-group $RG --slot staging --query state   # "Stopped"

az webapp start --name app-taskflow-api-01 --resource-group $RG --slot staging
az webapp show --name app-taskflow-api-01 --resource-group $RG --slot staging --query state   # "Running"
```

**Why `--slot staging` must be on every command:** omit it and the command silently targets production. This is the most common slot mistake — get in the habit of typing `--slot` immediately after the app name.

### Expected result
```bash
curl https://app-taskflow-api-01.azurewebsites.net/api/hello           # version 1.0.0, untouched
curl https://app-taskflow-api-01-staging.azurewebsites.net/api/hello   # version 2.0.0
```
After stopping staging, its URL returns 403/"stopped" — not 502. That distinction matters: 502 means the app tried and crashed; 403 means Azure deliberately isn't running it.

### Verification checklist
- [ ] Production shows `1.0.0`, staging shows `2.0.0`, simultaneously
- [ ] Stopping staging fails cleanly (403/stopped), production unaffected
- [ ] Starting staging brings `2.0.0` back
- [ ] Production's own `state` (no `--slot`) never changed to `Stopped`

### Common errors
| Symptom | Cause | Fix |
|---|---|---|
| Production went down after `az webapp stop` | Forgot `--slot staging` | Always type `--slot <name>` right after the app name |
| Staging shows old version after deploy | Deployed without `--slot`, landed elsewhere | Re-run deploy with the slot flag |
| Slot creation fails with a pricing error | Slots require Standard (S1)+, not Basic | `az appservice plan update --sku S1` |
| 502 instead of clean stop | Restarted mid-deploy | Wait for deploy to finish first |

---

## STEP 4 — Custom path configuration (`/myapp`)

### Objective
Make `app-taskflow-api-02` reachable under a sub-path: `GET /myapp/api/hello`.

### The platform fact that matters here
Azure's **"Path mappings" → virtual applications and directories** is an **IIS/Windows-only** mechanism. Your App Service is **Linux + Node** — that Portal blade only exposes storage mounts on Linux, not URL virtual directories. The correct answer for Linux/Node: **the app's own routing handles the path**, not App Service configuration. Same "one hostname, path-routed" idea as Step 1's proxy and later AKS Ingress.

### Architecture
```
┌───────────────────────────────────────────────┐
│              app-taskflow-api-02                │
│   Express app                                   │
│   ┌─────────────────────────────────────────┐  │
│   │  app.use('/myapp', router)                │  │
│   │        └── GET /api/hello                 │  │
│   │        └── GET /api/health                │  │
│   └─────────────────────────────────────────┘  │
│   Result: GET /myapp/api/hello  → 200            │
│           GET /api/hello        → 404            │
└───────────────────────────────────────────────┘
```

### Updated code

`backend/server.js`:
```js
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());

const APP_VERSION = process.env.APP_VERSION || '1.0.0';
const router = express.Router();

router.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from Node.js API', version: APP_VERSION, timestamp: new Date().toISOString() });
});
router.get('/api/health', (req, res) => {
  res.json({ status: 'Healthy', version: APP_VERSION });
});

app.use('/myapp', router);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
```

**What changed:** `router.get(...)` is unchanged from Step 1/2; `app.use('/myapp', router)` is the one line that prefixes every route. The path is a mounting decision, not a rewrite of the handlers.

### Deploy
```bash
cd backend
zip -r ../api-myapp.zip . -x "node_modules/*"
az webapp deploy --resource-group rg-taskflow --name app-taskflow-api-02 --src-path ../api-myapp.zip --type zip
```

### Portal steps
1. `app-taskflow-api-02` → **Configuration** → **Path mappings** — open it once, confirm only storage mounts appear (proof of the Linux limitation above).
2. **Advanced Tools (Kudu)** → **Debug console** — useful for `curl localhost/myapp/api/hello` from *inside* the container to rule out "is it the app or the networking in front of it."

### Expected result
```bash
curl https://app-taskflow-api-02.azurewebsites.net/myapp/api/hello   # 200
curl https://app-taskflow-api-02.azurewebsites.net/api/hello         # 404
```

### Verification checklist
- [ ] `/myapp/api/hello` → 200 with expected JSON
- [ ] Bare `/api/hello` → 404 (proves the mount is real)
- [ ] `app-taskflow-api-01` untouched, still responds at its original paths

### Common errors
| Symptom | Cause | Fix |
|---|---|---|
| Both paths 404 | Old process still running, deploy didn't restart it | `az webapp log tail` to confirm the new code started |
| Looking for "virtual directory" and can't find it | You're on Linux | Confirm with `az webapp show --query "kind"`; this is a platform limit, not a UI hunt |
| Frontend 404s everywhere | `apiUrl` still points at old root paths | Update `environment.prod.ts` to `.../myapp/api`, rebuild, redeploy |

---

## STEP 5 — Dockerize the application

### Objective
Containerize both apps — same source, no logic changes — and prove both images work locally before touching Azure.

### Architecture
```
┌───────────────────────────┐        ┌───────────────────────────┐
│   taskflow-api image       │        │   taskflow-web image        │
│  (Node 20 alpine, 2-stage)  │        │  (nginx alpine, 2-stage)     │
│  Stage 1: npm ci + copy      │        │  Stage 1: npm ci + ng build  │
│  Stage 2: runtime only        │        │  Stage 2: nginx serves dist  │
│  CMD node server.js           │        │  EXPOSE 80                   │
│  EXPOSE 3000                  │        │                             │
└───────────────────────────┘        └───────────────────────────┘
```

**Why multi-stage:** the build stage needs `devDependencies` and the Angular CLI; none of that belongs in the running image. Multi-stage copies out only the finished artifact.

### Dockerfiles

`backend/Dockerfile`:
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app ./
EXPOSE 3000
CMD ["node", "server.js"]
```

`frontend/Dockerfile`:
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration production

FROM nginx:alpine
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

`frontend/nginx.conf` (SPA fallback — without it, refreshing on any non-root route 404s):
```nginx
server {
  listen 80;
  location / {
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;
  }
}
```

`environment.prod.ts` — point at wherever the API is reachable from (finalized in Step 7):
```ts
export const environment = {
  production: true,
  apiUrl: '/myapp/api'
};
```

### Build, run, verify
```bash
docker build -t taskflow-api:v1 ./backend
docker build -t taskflow-web:v1 ./frontend

docker run -d --name api-test -p 3000:3000 -e APP_VERSION=1.0.0 taskflow-api:v1
docker ps
curl http://localhost:3000/myapp/api/hello
docker logs api-test

docker run -d --name web-test -p 8080:80 taskflow-web:v1
curl -I http://localhost:8080

docker stop api-test web-test
docker rm api-test web-test
```

**Flags that recur constantly from here on:** `-d` detached; `--name` a handle instead of a hash; `-p hostPort:containerPort`; `-e` passes an env var into the container — same mechanism as App Service Application Settings, different platform.

### Expected result
- `docker images` shows `taskflow-api:v1` well under 200MB
- `curl` returns the same JSON seen since Step 1
- `docker logs` shows a clean startup, no restart loop

### Verification checklist
- [ ] Both images build without errors
- [ ] API container: `docker run` + `curl` succeeds at the same endpoint path as Step 4
- [ ] Frontend container: `curl -I` succeeds
- [ ] Images are lean — multi-stage actually worked
- [ ] `docker stop`/`docker logs` behave as expected

### Common errors
| Symptom | Cause | Fix |
|---|---|---|
| `npm ci` fails: "no package-lock.json" | `npm ci` requires a committed lockfile | `npm install` once locally, commit the lockfile, rebuild |
| Container exits immediately | Node crashed on startup | `docker logs <name>` — usually a missing env var |
| Frontend 404s on refresh at non-root routes | Missing SPA fallback | Add `try_files $uri $uri/ /index.html;` |
| Image 400MB+ | `node_modules`/Angular CLI leaked into final stage | Confirm the final stage only `COPY --from=build` of the output folder |
| Connection refused on curl | Port not published, or container not running | `docker ps` to confirm |

---

## STEP 6 — Push images to Azure Container Registry (ACR)

### Objective
Create a private ACR and push both images — making them reachable from any Azure compute, not just your laptop's Docker daemon.

### Architecture
```
┌─────────────────────┐        docker push        ┌───────────────────────────────┐
│  Your laptop          │ ─────────────────────────▶ │   acrtaskflow.azurecr.io        │
│  Docker daemon         │                             │   taskflow-api  : v1             │
│  taskflow-api:v1       │                             │   taskflow-web  : v1             │
│  taskflow-web:v1       │                             │                                 │
└─────────────────────┘                             └───────────────────────────────┘
                                                                    │
                                                        pulled later by AKS (Step 7)
```

**Why ACR over Docker Hub:** ACR integrates with AKS via managed identity (`--attach-acr` in Step 7) — AKS nodes authenticate to pull images without you ever handling a registry password inside the cluster. Docker Hub's free-tier pull limits also tend to bite mid-deploy or mid-demo.

### Portal steps
1. **Create a resource** → **Container Registry** → name `acrtaskflow<yourinitials>` (globally unique, alphanumeric only).
2. SKU: **Basic**.
3. **Access keys** — leave **Admin user disabled**; authenticate via `az acr login` (your own Azure AD identity) instead.

### CLI
```bash
RG=rg-taskflow
ACR=acrtaskflowlearn   # must be globally unique

az acr create --resource-group $RG --name $ACR --sku Basic
az acr login --name $ACR

docker tag taskflow-api:v1 $ACR.azurecr.io/taskflow-api:v1
docker tag taskflow-web:v1 $ACR.azurecr.io/taskflow-web:v1

docker push $ACR.azurecr.io/taskflow-api:v1
docker push $ACR.azurecr.io/taskflow-web:v1

az acr repository list --name $ACR --output table
az acr repository show-tags --name $ACR --repository taskflow-api --output table
```

**Why `az acr login`, not a stored password:** it fetches a short-lived token tied to your Azure AD identity and hands it to Docker — nothing static is stored. **Why tag and push are separate:** an image name encodes *where it's stored*; `docker tag` points a second name (no rebuild, no duplicate layers) at the ACR hostname, and `push` reads that prefix to know where to send it.

### Expected result
```
Result
--------------
taskflow-api
taskflow-web
```
with `v1` showing under `show-tags` for each — proof the images exist in Azure, not just that `push` printed success locally.

### Verification checklist
- [ ] `az acr repository list` shows both repositories
- [ ] `show-tags` confirms `v1`
- [ ] `docker pull` after removing your local copy succeeds — genuinely retrievable, not cached
- [ ] Admin user stayed disabled

### Common errors
| Symptom | Cause | Fix |
|---|---|---|
| `denied: requested access` on push | Login session expired, or wrong registry in the tag | Re-run `az acr login`; check `docker images` for the exact `$ACR.azurecr.io/...` tag |
| Name rejected during create | Must be globally unique, lowercase alphanumeric only | Try a longer, more specific name |
| Push hangs/times out | Large image, or Basic SKU throughput limits | Confirm image is lean (Step 5); retry |
| `docker pull` auth error after successful login | Logged into the wrong subscription/tenant | `az account show`; `az account set --subscription <id>` |

---

## Interview Q&A — all steps, with answers, scenarios, and real problems faced

### Step 1 — the application layer

**Q1. Why does the Angular dev server need a proxy config to reach the Node API, and what breaks without it?**
The browser enforces Same-Origin Policy — `:4200` and `:3000` are different origins. A direct call triggers a CORS preflight, and without `cors()` on the API the browser blocks the response. The proxy makes `/api/*` look same-origin *in development only* — it has no effect on the production bundle.

**Q2. What's the practical difference between `ng serve` and `ng build`?**
`ng serve` compiles in memory for live reload and is never deployed. `ng build --configuration production` writes real static files to `dist/` — what actually gets hosted anywhere.

**Q3. Why read `APP_VERSION` from an env var before any Azure resource exists to set one?**
Adding config flexibility now, with one code path, is far cheaper than retrofitting it after the app is deployed three different ways.

### Step 2 — App Service

**Q4. What's the actual difference between an App Service Plan and an App Service?**
The Plan is billed compute (VM size/tier/OS); the App Service is a logical app slot running on it. Scaling the Plan scales every App Service on it together — you can't scale one independently on a shared Plan.

**Q5. If two App Services share a Plan and one gets hit with heavy traffic, does the other suffer?**
Yes — they share CPU/memory/instance count. A real production setup separates unrelated apps onto different Plans specifically to avoid this shared blast radius.

**Q6. Why does zip deploy need a `start` script rather than running a file directly?**
Oryx's run contract for Node apps is generic — it only knows to invoke `npm start` after `npm install`. A missing/wrong `start` script builds fine but never launches the server, usually surfacing as a 502 with nothing wrong in your own code.

### Step 3 — deployment slots

**Q7. Why does a slot need its own hostname, and what would you lose without it?**
It gives the new version a genuinely separate, testable endpoint on the same App Service. Without a distinct hostname you couldn't verify staging without it competing with or replacing production traffic.

**Q8. What's the difference between stopping a slot and deleting it?**
Stopping pauses the running process while keeping the slot's configuration and deployment history intact — useful when pausing testing temporarily. Deleting removes the slot entirely, including its settings; use it only when that slot's purpose is genuinely done.

**Q9 — Scenario.** *You just stopped production during a live demo by mistake. Walk through recovery and prevention.*
Recovery: `az webapp start --name <app> --resource-group <rg>` (no `--slot`, targeting production directly), then confirm with `az webapp show --query state`. Prevention: make `--slot <name>` (or its deliberate absence) the very next thing you type after the app name, every time — treat it as part of the command's required syntax, not an optional flag you might forget.

**Problem faced:** a connection string was marked "deployment slot setting" on production by mistake. After a swap, the slot that became production kept the *old* slot's connection string instead of inheriting the intended one — because slot-specific settings deliberately don't swap with the slot; they stay pinned to whichever slot they were set on. Fix: audit which settings are marked slot-specific before any swap, and only mark settings slot-specific when that's genuinely the intent (e.g., a staging-only test database).

### Step 4 — custom path config

**Q10. Why doesn't "virtual applications and directories" apply to a Linux App Service, and what do you do instead?**
That feature is implemented by IIS, which only runs on Windows App Service. On Linux, the app's own router (Express, in this case) owns URL path structure.

**Q11 — Scenario.** *You need two different apps under one hostname at `/app1` and `/app2`, and platform-level path mapping isn't available. What are your options?*
Put something in front of both apps that does path-based routing: an Application Gateway or Azure Front Door with path rules, or an nginx/reverse-proxy layer, each forwarding `/app1/*` and `/app2/*` to the respective backend. This is the same pattern AKS Ingress uses later — routing decisions belong to whatever sits in front of the apps, not inside each app individually, once there's more than one app to coordinate.

**Q12 — Scenario.** *A teammate hardcodes `/myapp` into every route string instead of `app.use('/myapp', router)`. Six months later the path needs to change to `/taskflow`. What's the cost difference?*
With `app.use('/myapp', router)`, the change is one line. With hardcoded strings scattered across every route, it's a find-and-replace across the codebase with real risk of missing one — and worse, any code that constructs URLs by concatenating the path elsewhere now has two sources of truth to update in lockstep.

**Problem faced:** after adding the `/myapp` prefix, the Angular frontend kept 404ing because `environment.prod.ts` still pointed at the old root path — a reminder that a backend routing change is invisible to the frontend until its own config is updated and rebuilt.

### Step 5 — Docker

**Q13. Why doesn't the final Docker stage need the Angular CLI or full `node_modules`?**
The Angular CLI and dev dependencies only do work at *build* time (compiling TypeScript, bundling, minifying). The final stage only needs to *serve* the already-compiled output — nginx serving static files, or Node running already-transpiled JS — so none of the build tooling belongs in what actually ships.

**Q14. What's the difference between `npm ci` and `npm install`, and why does a Dockerfile want `npm ci`?**
`npm ci` installs exactly what's in `package-lock.json`, deletes `node_modules` first if present, and fails outright if the lockfile is missing or inconsistent with `package.json`. `npm install` can update the lockfile and tolerate drift. In a Dockerfile you want byte-for-byte reproducible builds — `npm ci` is what guarantees that.

**Q15 — Scenario.** *A teammate's image is 3x larger than yours for the same app. What do you check first?*
First, whether their final stage does `COPY --from=build` of just the build output, or accidentally copies the whole `/app` directory (dragging `node_modules` and dev tooling along). Second, layer order — Dockerfiles cache layer-by-layer, and putting `COPY . .` before `RUN npm ci` invalidates the dependency-install cache on every single source change, which doesn't bloat the image directly but does bloat build time and encourages sloppy iteration that leads to bloat elsewhere.

**Problem faced:** the frontend image worked at `/` but 404'd on every direct refresh at another route — classic missing SPA fallback in `nginx.conf`. The browser's client-side router handles in-app navigation fine, but a hard refresh asks nginx directly for a path nginx doesn't have a file for; `try_files ... /index.html` is what redirects that request back into the Angular app instead of nginx returning its own 404.

### Step 6 — ACR

**Q16. Why does `az acr login` avoid a static admin password, and why leave Admin user disabled?**
`az acr login` issues a short-lived token tied to your actual Azure AD identity — nothing long-lived to leak, and every pull/push is attributable to a real identity in audit logs. A shared admin password, by contrast, is a single static secret that, if leaked, grants full registry access with no way to tell which person or system used it.

**Q17. Why are `docker tag` and `docker push` two separate commands?**
An image name encodes where it lives, not just what it's called. `docker tag` creates a second reference to the same image layers (no rebuild, no disk duplication) with the registry hostname baked in; `push` reads that prefix to know where to actually send the data.

**Q18 — Scenario.** *Someone asks "why ACR instead of Docker Hub for this project?" specific to what happens next.*
Because Step 7 attaches ACR to AKS via `--attach-acr`, which grants the AKS cluster's managed identity pull access automatically — no registry secret ever has to be created or rotated inside the cluster. Docker Hub would require manually creating and maintaining a Kubernetes `imagePullSecret` with real credentials, which is exactly the kind of static secret ACR's approach avoids.

**Problem faced:** `docker push` succeeded from a personal laptop but failed with a 401 from a CI agent running the same commands. Root cause: `az acr login` on the laptop was riding an interactive Azure AD session; the CI agent had no such session and needed its own non-interactive identity (a service principal or, better, workload identity federation) to authenticate — a reminder that "works on my machine" for ACR auth often means "works under *my* identity," which doesn't automatically transfer to an automated context.

---

Say **CONTINUE** for Step 7 — deploying this same image to AKS.
