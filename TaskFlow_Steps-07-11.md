# TaskFlow Learning Journey — Steps 7 through 11

**Continues from:** `TaskFlow_Steps-01-06.md` (Angular + Node.js app → two App Services → deployment slot → custom path → Docker → ACR)
**This file:** the same images from Step 6, deployed to AKS, scaled, self-healed, and finally run as a genuinely coupled two-container pod.

---

## STEP 7 — Deploy the same image to AKS

### Objective
Stand up an AKS cluster, attach it to the existing ACR (no manual registry secrets), and run the Step 6 image as a single pod — proof the image is portable before adding scaling or multi-container complexity.

### Architecture
```
┌─────────────────────────────────────────────────────┐
│                    AKS cluster                        │
│                   (aks-taskflow)                        │
│   ┌───────────────────────────────────────────────┐  │
│   │                Node pool (1–2 VMs)                │  │
│   │   ┌─────────────────────────────────────┐       │  │
│   │   │   Pod: taskflow-api                    │       │  │
│   │   │   Container: taskflow-api:v1            │       │  │
│   │   └─────────────────────────────────────┘       │  │
│   └───────────────────────────────────────────────┘  │
└────────────────────────────┬──────────────────────────┘
                              │ pulls image via managed identity
                              ▼
                    acrtaskflowlearn.azurecr.io
```

**Why `--attach-acr` matters:** it grants the AKS cluster's managed identity `AcrPull` permission on the registry automatically. Without it, every pod would need a manually created `imagePullSecret` — a static credential inside the cluster, exactly what Step 6 taught you to avoid.

### Prerequisites
- `kubectl` installed
- ACR from Step 6, with `v1` images pushed

### Portal steps
1. `rg-taskflow` → **Create a resource** → **Kubernetes Service (AKS)**.
2. Name `aks-taskflow`, node count **1**, default node size.
3. Skip the Container Registry integration in the **Integrations** tab — attach it via CLI so you see exactly what it does.
4. After creation → **Kubernetes resources** blade for a lightweight visual view without leaving the browser.

### CLI
```bash
RG=rg-taskflow
AKS=aks-taskflow
ACR=acrtaskflowlearn

az aks create --resource-group $RG --name $AKS --node-count 1 --generate-ssh-keys
az aks get-credentials --resource-group $RG --name $AKS
az aks update --resource-group $RG --name $AKS --attach-acr $ACR

kubectl get nodes
```

### First deployment

`api-deployment-v1.yaml`:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: taskflow-api
spec:
  replicas: 1
  selector:
    matchLabels: { app: taskflow-api }
  template:
    metadata:
      labels: { app: taskflow-api }
    spec:
      containers:
        - name: api
          image: acrtaskflowlearn.azurecr.io/taskflow-api:v1
          ports: [{ containerPort: 3000 }]
          env:
            - name: APP_VERSION
              value: "1.0.0"
```

```bash
kubectl apply -f api-deployment-v1.yaml
kubectl get pods -w
```

### Expected result
```
NAME                            READY   STATUS    RESTARTS   AGE
taskflow-api-7d9c8f6b4d-x2k9p   1/1     Running   0          30s
```
```bash
kubectl port-forward pod/<pod-name> 3000:3000
curl http://localhost:3000/myapp/api/hello
```

### Verification checklist
- [ ] `az aks update --attach-acr` completed without error
- [ ] `kubectl get pods` shows `1/1 Running`
- [ ] `kubectl logs <pod-name>` shows a clean startup, no crash loop
- [ ] `curl` via port-forward returns the same JSON as every prior step

### Common errors
| Symptom | Cause | Fix |
|---|---|---|
| `ImagePullBackOff` | ACR not attached, or wrong image name/tag | `az aks update --attach-acr $ACR`; verify the image string against `az acr repository show-tags` |
| `kubectl get nodes` times out | Missing `get-credentials`, or wrong subscription | Re-run `az aks get-credentials`; `az account show` |
| `CrashLoopBackOff` | App failing to start inside the container | `kubectl logs <pod>` — usually a missing env var |

---

## STEP 8 — 2 pods, 1 container per pod, exposed via a Service

### Objective
Scale to `replicas: 2` and add a Service so both pods are reachable through one stable address — proof Kubernetes load-balances across identical pods automatically.

### Architecture
```
                    ┌───────────────────────────┐
   client ────────▶ │  Service: taskflow-api-svc   │
                    │        (ClusterIP)            │
                    └──────────────┬─────────────┘
                                     │ round-robins
                     ┌───────────────┴───────────────┐
                     ▼                                 ▼
        ┌─────────────────────┐          ┌─────────────────────┐
        │  Pod 1 (1 container)  │          │  Pod 2 (1 container)  │
        │  taskflow-api:v1       │          │  taskflow-api:v1       │
        └─────────────────────┘          └─────────────────────┘
```

**Why a Service, not just pod IPs:** pod IPs are ephemeral — a restarted pod gets a new one. A Service gives one stable DNS name/IP that always points at whichever pods currently match its label selector.

### Add a hostname to the response, so load-balancing is provable

`backend/server.js`:
```js
router.get('/api/hello', (req, res) => {
  res.json({
    message: 'Hello from Node.js API',
    version: APP_VERSION,
    hostname: require('os').hostname(),
    timestamp: new Date().toISOString()
  });
});
```
```bash
docker build -t $ACR.azurecr.io/taskflow-api:v2 ./backend
docker push $ACR.azurecr.io/taskflow-api:v2
```

### `api-deployment.yaml`
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: taskflow-api
spec:
  replicas: 2
  selector:
    matchLabels: { app: taskflow-api }
  template:
    metadata:
      labels: { app: taskflow-api }
    spec:
      containers:
        - name: api
          image: acrtaskflowlearn.azurecr.io/taskflow-api:v2
          ports: [{ containerPort: 3000 }]
          env:
            - name: APP_VERSION
              value: "2.0.0"
---
apiVersion: v1
kind: Service
metadata:
  name: taskflow-api-svc
spec:
  selector: { app: taskflow-api }
  ports: [{ port: 80, targetPort: 3000 }]
  type: ClusterIP
```

**Why the Service's `selector` matters more than any pod name:** it's how the Service finds which pods to route to — any pod carrying `app: taskflow-api` is automatically included, whether original or a replacement (relevant in Step 9).

```bash
kubectl apply -f api-deployment.yaml
kubectl get pods -o wide
kubectl get svc
```

### Expected result
```bash
kubectl port-forward svc/taskflow-api-svc 8080:80
curl http://localhost:8080/myapp/api/hello
curl http://localhost:8080/myapp/api/hello
```
The `hostname` field should differ across repeated calls — different pods answering.

### Verification checklist
- [ ] Exactly 2 pods, both `1/1 Running`
- [ ] `taskflow-api-svc` has a ClusterIP
- [ ] Repeated curls through the Service return **different `hostname` values**
- [ ] `kubectl describe svc taskflow-api-svc` → Endpoints lists both pods' IPs

### Common errors
| Symptom | Cause | Fix |
|---|---|---|
| Service has 0 endpoints | Selector labels don't match pod template labels exactly | Compare `spec.selector` against `metadata.labels` character-for-character |
| Hostname never alternates | Port-forwarded to a specific pod, not the Service | Confirm target is `svc/taskflow-api-svc`, not `pod/<name>` |
| One pod `Pending` | Insufficient node capacity | Scale the node pool, or lower resource requests |

---

## STEP 9 — Delete a pod, observe self-healing

### Objective
Delete a running pod directly and watch Kubernetes automatically replace it.

### Architecture
```
 before                                 during                                after
┌──────┐ ┌──────┐          ┌──────┐  ┌ ─ ─ ─ ┐          ┌──────┐ ┌──────┐
│ Pod A│ │ Pod B│  delete  │ Pod A│  ¦ (gone)¦  create  │ Pod A│ │ Pod C│
└──────┘ └──────┘  Pod B   └──────┘  └ ─ ─ ─ ┘  new pod └──────┘ └──────┘
   Deployment controller continuously reconciles: "spec says 2, count actual pods, fix the gap"
```

**Why this happens:** a Deployment is a standing target, not a one-time instruction. The controller's reconcile loop constantly compares desired state (`replicas: 2`) to actual state; a deleted pod is an immediate mismatch it corrects.

### Commands
```bash
kubectl get pods
kubectl delete pod taskflow-api-6f8b9d7c5-abcde
kubectl get pods -w
```

### Expected result
```
NAME                            READY   STATUS        AGE
taskflow-api-6f8b9d7c5-abcde    1/1     Terminating   5m
taskflow-api-6f8b9d7c5-fghij    1/1     Running       5m
taskflow-api-6f8b9d7c5-klmno    0/1     ContainerCreating   1s
taskflow-api-6f8b9d7c5-klmno    1/1     Running       8s
```
A new pod, with a **different name**, appears within seconds; the Service's endpoints update automatically.

### Verification checklist
- [ ] Pod count returns to 2 within ~10–30 seconds
- [ ] Replacement pod has a different name than the deleted one
- [ ] `curl` through the Service keeps working throughout
- [ ] `kubectl describe svc` shows the new pod's IP replacing the old one in Endpoints

### Common errors
| Symptom | Cause | Fix |
|---|---|---|
| No replacement ever appears | Deleted the Deployment, not just a pod | Re-apply the Deployment YAML; delete only the pod for this exercise |
| Replacement stuck `Pending` | Node capacity issue | `kubectl describe pod` → Events section |
| Brief errors during the window | Normal — momentary 1-of-2 serving gap | Expected; motivates running more replicas or readiness probes in production |

---

## STEP 10 — One pod, two containers

### Objective
Build a pod running **two containers together** — the API plus an nginx reverse-proxy sidecar — sharing one network namespace.

### Architecture
```
┌─────────────────────────────────────────┐
│                    Pod                     │
│   ┌───────────────┐     ┌───────────────┐  │
│   │  nginx sidecar  │────▶│  api container │  │
│   │  listens :8080  │curl │  listens :3000 │  │
│   └───────────────┘ localhost└───────────────┘  │
│         both containers share one IP        │
└─────────────────────────────────────────┘
```

**Why this differs fundamentally from Step 8's two pods:** containers in one pod share a network namespace (talk over `localhost`, not a Service) and a lifecycle (scheduled and scaled as one unit). Two separate pods share neither. This is the concept with no clean App Service equivalent.

### nginx sidecar config
`nginx-sidecar.conf`:
```nginx
server {
  listen 8080;
  location / {
    proxy_pass http://localhost:3000;
  }
}
```
```bash
kubectl create configmap nginx-sidecar-conf --from-file=default.conf=nginx-sidecar.conf
```

### `api-sidecar-pod.yaml`
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: taskflow-api-sidecar
  labels: { app: taskflow-api-sidecar }
spec:
  containers:
    - name: api
      image: acrtaskflowlearn.azurecr.io/taskflow-api:v2
      ports: [{ containerPort: 3000 }]
      env:
        - name: APP_VERSION
          value: "sidecar-demo"
    - name: nginx-proxy
      image: nginx:alpine
      ports: [{ containerPort: 8080 }]
      volumeMounts:
        - name: nginx-conf
          mountPath: /etc/nginx/conf.d
  volumes:
    - name: nginx-conf
      configMap:
        name: nginx-sidecar-conf
---
apiVersion: v1
kind: Service
metadata:
  name: taskflow-sidecar-svc
spec:
  selector: { app: taskflow-api-sidecar }
  ports: [{ port: 80, targetPort: 8080 }]
  type: ClusterIP
```

**Why the Service points at port 8080 (nginx), not 3000 (api):** external traffic only ever reaches nginx; nginx is the only thing that talks to the API container directly, over `localhost`, because they share a pod.

```bash
kubectl apply -f api-sidecar-pod.yaml
kubectl get pod taskflow-api-sidecar
```

### Expected result
```
NAME                    READY   STATUS    RESTARTS   AGE
taskflow-api-sidecar    2/2     Running   0          15s
```

### Verification checklist
- [ ] `2/2 Running`
- [ ] `kubectl get pod ... -o jsonpath='{.spec.containers[*].name}'` lists both `api` and `nginx-proxy`
- [ ] `kubectl logs -c api` and `kubectl logs -c nginx-proxy` both return distinct logs
- [ ] Port-forwarding to the Service and curling returns the API's JSON, having passed through nginx

### Common errors
| Symptom | Cause | Fix |
|---|---|---|
| Pod stuck `0/2` or `1/2` | ConfigMap missing/misnamed | `kubectl describe pod` → Events |
| `kubectl logs` errors with no `-c` | Ambiguous multi-container pod | Always specify `-c api` or `-c nginx-proxy` |
| curl gets nginx's own 502 | `proxy_pass` port doesn't match the API's actual `containerPort` | Confirm both are `3000` |

---

## STEP 11 — Demonstrate communication between the two containers

### Objective
Prove the sidecar pattern is actually doing what Step 10 claimed — a real, observed request passing between the two containers, not just "it's `2/2` Running."

### Architecture
```
   you (kubectl exec)                 Pod: taskflow-api-sidecar
┌─────────────────────┐        ┌───────────────────────────────┐
│  exec into nginx      │───────▶│  nginx :8080  ──curl──▶  api :3000 │
│  container, curl        │        │      (both containers, same pod)   │
│  localhost:8080          │        └───────────────────────────────┘
└─────────────────────┘
```

### Three levels of proof

**1. External — call the Service:**
```bash
kubectl port-forward svc/taskflow-sidecar-svc 8081:80
curl http://localhost:8081/myapp/api/hello
```
The JSON payload can only have come from `api` — nginx has no code that generates it, only proxies.

**2. Internal — exec into nginx, reach the API directly:**
```bash
kubectl exec -it taskflow-api-sidecar -c nginx-proxy -- sh
wget -qO- http://localhost:3000/myapp/api/hello
exit
```
This runs *inside* nginx's container and reaches the API purely via `localhost` — no Service, no DNS, no external path. This is the proof that actually confirms the shared network namespace claim, rather than trusting the external call alone.

**3. Log correlation:**
```bash
kubectl logs taskflow-api-sidecar -c nginx-proxy --tail=5
kubectl logs taskflow-api-sidecar -c api --tail=5
```
Matching timestamps across both containers for the same request.

### Expected result
All three checks succeed and agree with each other.

### Verification checklist
- [ ] External curl through the Service returns valid JSON
- [ ] `kubectl exec` into nginx + `wget localhost:3000` succeeds directly
- [ ] Logs from both containers show correlated timestamps
- [ ] You can explain why check #2 would be impossible if the two containers were in separate pods

### Common errors
| Symptom | Cause | Fix |
|---|---|---|
| `wget`/`curl` not found in the shell | `nginx:alpine` is minimal | Use `wget -qO-`, generally present in alpine |
| `exec -c nginx-proxy` fails, "container not found" | Typo, or missing `-c` | `kubectl get pod ... -o jsonpath='{.spec.containers[*].name}'` for exact names |
| Logs don't seem to correlate | Reading logs long after the request | Run curl and `kubectl logs --tail=5` back to back, same session |

---

## Interview Q&A — Steps 7–11, with answers, scenarios, and real problems faced

### Step 7 — AKS + ACR

**Q1. What does `--attach-acr` actually grant, and why is it better than an `imagePullSecret`?**
It assigns the AKS cluster's kubelet managed identity the `AcrPull` role directly on the registry — every node authenticates as itself, with no credential stored anywhere in the cluster. An `imagePullSecret`, by contrast, is a static credential (often an admin login or service principal secret) stored as a Kubernetes Secret in a namespace — readable by anyone with Secret-read access in that namespace, requiring manual rotation, and if leaked, usable outside the cluster entirely.

**Q2. Why deploy a single-replica pod first, before jumping to 2 replicas?**
It isolates variables. If something fails once you're at 2 replicas and a Service, you don't know whether the problem is the image/app itself or the Service/label wiring around it. Proving one pod works first means any later multi-pod issue is almost certainly about the Service, not the application.

**Q3 — Scenario.** *`ImagePullBackOff` appears even though the image definitely exists in ACR — what do you check, in order?*
1. Confirm `--attach-acr` actually completed (`az aks show` and check the identity/ACR role assignment), since role-assignment propagation can lag a few minutes even after a successful command.
2. Check `kubectl describe pod` for the exact pull error text — a **401** means an auth problem (ACR not attached, or the role hasn't propagated yet); a **404** means the image name/tag string itself is wrong.
3. Diff the image string in your YAML character-for-character against `az acr repository show-tags` output — a stray capital letter or wrong tag is the single most common cause.

**Problem faced:** after running `az aks update --attach-acr`, `ImagePullBackOff` persisted for close to two minutes before resolving on its own. Root cause: Azure RBAC role assignments don't apply instantaneously — there's real propagation delay. Lesson: before assuming the command failed, wait a couple of minutes and retry rather than immediately troubleshooting a "broken" attach that actually succeeded.

### Step 8 — Service and load balancing

**Q4. Why does a Service's label selector, not a fixed pod list, make Kubernetes networking resilient?**
Because pod identity is disposable — pods get replaced constantly (crashes, rolling updates, node evictions). A selector re-evaluates continuously against whatever pods currently exist with matching labels, so the Service never needs to be told about specific pod names; it just always reflects reality.

**Q5. What's the practical difference between `ClusterIP`, `NodePort`, and `LoadBalancer` — which would you use to expose this to the internet?**
`ClusterIP` (used here) is only reachable inside the cluster — fine for internal traffic or port-forwarding while learning. `NodePort` opens a fixed port on every node's own IP — usable externally but clunky and rarely used directly in production. `LoadBalancer` provisions an actual cloud load balancer (an Azure Load Balancer, here) with a real public IP — the standard way to expose a Service externally, though for path-based routing across multiple services you'd typically add an Ingress controller in front of several `ClusterIP` Services instead of giving each its own `LoadBalancer`.

**Q6 — Scenario.** *A Service shows "0 endpoints" even though `kubectl get pods` shows both pods Running — what's almost certainly wrong?*
The Service's `spec.selector` doesn't actually match the pods' `metadata.labels` — a typo, a mismatched key, or copying the Service's own name into the selector by mistake instead of the pod template's label. `kubectl describe svc` and `kubectl get pods --show-labels` side by side will reveal the mismatch immediately.

**Problem faced:** the Service's selector was accidentally written as `app: taskflow-api-svc` (matching the *Service's own name*) instead of `app: taskflow-api` (the pods' actual label) — a copy-paste slip. Endpoints stayed empty despite both pods showing `Running`, which was initially confusing because nothing in `kubectl get pods` itself looked wrong; the mismatch only showed up by explicitly comparing the two label values side by side.

### Step 9 — Self-healing

**Q7. What's actually watching the cluster and deciding to create a replacement pod?**
The **ReplicaSet controller** (which a Deployment manages underneath) runs a continuous reconcile loop: compare the desired replica count in spec against the actual count of matching pods, and create or delete pods as needed to close any gap. "Kubernetes does it" is true but vague — naming the specific controller and its reconcile-loop model is the answer that shows real understanding.

**Q8. Why does the replacement pod get a new name instead of reusing the deleted one?**
Pods are treated as disposable, stateless units by design — a pod's name includes a hash tied to its ReplicaSet plus a random suffix, and Kubernetes never "resurrects" a specific pod identity. A new pod is a fresh object from the scheduler's perspective, even though it's running the identical image/config as the one it replaced.

**Q9 — Scenario.** *You need zero dropped requests during a pod replacement, not just "eventually recovers." What would you research next?*
Readiness probes (so the Service only routes to a pod once it's actually ready to serve, not the instant it starts), rolling update strategy settings (`maxUnavailable`/`maxSurge` on the Deployment, controlling how aggressively old pods are replaced), and PodDisruptionBudgets (limiting how many pods can be down simultaneously during voluntary disruptions like node maintenance).

**Problem faced:** during the brief replacement window, one `curl` through the Service returned a connection error even though `kubectl get pods` showed 2/2 pods listed almost immediately. Root cause: there's a small propagation delay between a pod becoming `Running` and kube-proxy actually updating its routing rules to include it as an endpoint — the pod *existing* and the pod being *routable* aren't the exact same instant. This is precisely the gap readiness probes and more replicas are meant to shrink in production.

### Step 10 — Multi-container pod

**Q10. Why do the two containers communicate over `localhost` instead of a Service, and what would change if they were separate pods?**
Containers in one pod share a network namespace — one IP, one set of ports — so `localhost` genuinely reaches the other container directly. If they were separate pods, each would get its own IP and would need a Service (and DNS resolution through it) to reach each other, adding a real network hop and losing the guarantee that both are always co-scheduled on the same node.

**Q11. What do the two containers in a pod share, and what do they not share?**
Shared: network namespace (one IP, `localhost` reachability), and optionally storage via shared volumes; both are scheduled onto the same node together and torn down together when the pod itself is deleted. Not shared, by default: process namespace (each container's processes are isolated from the other unless `shareProcessNamespace: true` is explicitly set), and each container has its own filesystem and its own independent resource limits/requests — one container restarting due to a crash doesn't necessarily restart the other.

**Q12 — Scenario.** *When should you NOT put two containers in one pod?*
When the two components genuinely scale independently or need separate failure/restart domains — e.g., an API server and a wholly separate nightly batch job have no reason to be co-scheduled, and forcing them into one pod would couple their scaling (you can't scale the API to 5 replicas without also getting 5 copies of the batch job) and their failure blast radius (a crash-looping batch job container can trigger restarts that also disrupt the API's availability, depending on restart policy). Separate pods, each with their own Service if needed, are the right call whenever the components' lifecycles aren't genuinely tied together.

**Problem faced:** the ConfigMap mount initially replaced the entire `/etc/nginx/conf.d` directory contents with just the one file provided — which happened to be fine here since only one config file was needed, but it's a trap worth knowing about: mounting a ConfigMap at a directory path replaces everything already there unless you mount individual keys with `subPath` instead. Anyone adding a second config file later without knowing this would silently lose whatever else was in that directory.

### Step 11 — Inter-container communication

**Q13. Why does the internal exec-based proof (Step 2 in that section) matter more than the external Service call alone?**
The external call could, in principle, be satisfied by some other misconfiguration — for example, if the API container's port had been accidentally exposed externally too, the "proof" would actually be testing the wrong path entirely and still appear to succeed. Reaching the API from *inside* the nginx container, purely via `localhost`, with no Service or external routing involved, is the only check that directly verifies the specific mechanism (shared network namespace) rather than an external symptom that happens to look correct.

**Q14. If the sidecar's role changed from reverse-proxy to log-shipper, how would the communication mechanism change?**
It would move from network calls to a **shared volume**. The API container would write logs to a path backed by a shared `emptyDir` volume; the sidecar would tail and forward that same file from its own mount of the same volume. No ports, no `curl`/`wget` between them at all — the coordination happens entirely through the filesystem both containers can see.

**Q15 — Scenario, tying Steps 7–11 together.** *Explain to a new hire why this journey moved from "two separate App Services" all the way to "two containers sharing one pod."*
Each rung solves a specific problem the previous one couldn't, at the cost of some added complexity: two App Services (Step 2) prove the app can run in more than one place, but App Service is fully managed with limited control over the runtime environment. A deployment slot (Step 3) adds safe, testable releases without new infrastructure. Docker (Step 5) makes the app portable across *any* platform, not just App Service. ACR (Step 6) distributes that portable artifact securely and privately. AKS with 2 pods (Steps 7–8) trades some of App Service's simplicity for real orchestration — scaling, self-healing (Step 9), and fine-grained control over networking. Finally, the two-container pod (Steps 10–11) is reserved for the one case none of the earlier rungs could express at all: two processes that are so tightly coupled — sharing a network namespace and a lifecycle — that they should be scheduled, scaled, and torn down as a single unit. The lesson for a new hire: reach for each rung *because* of the specific problem it solves, not because it's "more advanced" — using AKS multi-container pods for something that's really just two independent services would be over-engineering in the other direction.

**Problem faced:** the very first `kubectl exec` attempt failed with "a container name must be specified" because `-c nginx-proxy` was omitted — the same lesson from Step 10's troubleshooting table, showing up again in a slightly different command. Once a pod has more than one container, *every* `kubectl logs` and `kubectl exec` call needs the `-c` flag; there's no default it silently picks for you.

---

This completes the 11-step journey. Both files together (`TaskFlow_Steps-01-06.md` and this one) are the full, reproducible record — push both to git alongside the updated `README.md`.
