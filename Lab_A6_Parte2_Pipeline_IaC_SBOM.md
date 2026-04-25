# Lab A6 — Prática 2: Extensão do Pipeline (IaC Scan + SBOM)

## Adicionar Trivy Config e Syft ao Workflow

**Autor:** Victor Raffael Lins Carlota
**Disciplina:** DevSecOps — Aula 6: Supply Chain, IaC e Chaos Engineering
**Pré-requisito:** Lab A6 Prática 1 concluída (findings corrigidos, SBOM local gerado)

---

## RESUMO

Nesta prática, vamos:

1. **Adicionar step `trivy config`** ao workflow — IaC scan automatizado
2. **Adicionar job `sbom`** ao workflow — gerar SBOM como artefato
3. **Push e verificar** — pipeline agora com 11 stages

Este é o mesmo padrão de extensão das aulas anteriores:
- A3: adicionou Semgrep ao pipeline
- A4: adicionou push GHCR ao pipeline
- A5: adicionou deploy + DAST ao pipeline
- **A6: adiciona IaC scan + SBOM ao pipeline**

---

## 1. Pré-Requisitos

- Pipeline A5 funcional (9 stages)
- Findings de IaC corrigidos na Prática 1 (resource limits, etc.)
- Repositório com manifests em `k8s/` e `Dockerfile`

---

## 2. Adicionar IaC Scan ao Workflow

### 2.1 Editar o workflow

Edite `.github/workflows/devsecops.yml`. Adicione o step de IaC scan **dentro do job `security-scan`**, após os scans existentes (SCA, secrets, image):

```yaml
      # IaC Scan (Dockerfile + K8s manifests)
      - name: "🏗️ Trivy: IaC Scan"
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: config
          scan-ref: '.'
          severity: HIGH,CRITICAL
          exit-code: '0'
```

> **Nota sobre `exit-code`:**
> - `'0'` = reporta findings mas NÃO bloqueia o pipeline (recomendado no início)
> - `'1'` = bloqueia o pipeline se encontrar HIGH/CRITICAL (promover gradualmente)
>
> Comece com `'0'` para ver o que o Trivy encontra. Após corrigir os findings na Prática 1, mude para `'1'`.

### 2.2 Posição no workflow

O step deve ficar **após** o image scan e **antes** do security-gate:

```yaml
  security-scan:
    name: "🛡️ Security Scan"
    steps:
      - # ... checkout, build, etc.

      - name: "Trivy: SCA + Secrets"
        # ... (já existe)

      - name: "Trivy: Image Scan"
        # ... (já existe)

      - name: "🏗️ Trivy: IaC Scan"       # ← NOVO
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: config
          scan-ref: '.'
          severity: HIGH,CRITICAL
          exit-code: '0'
```

---

## 3. Adicionar Job de SBOM ao Workflow

### 3.1 Adicionar o job

Adicione um **novo job** `sbom` ao workflow, após o job `build` (precisa da imagem no GHCR):

```yaml
  # ============================================
  # Stage: Generate SBOM
  # ============================================
  sbom:
    name: "📋 Generate SBOM"
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Generate SBOM with Syft
        uses: anchore/sbom-action@v0
        with:
          image: ghcr.io/${{ github.repository }}:latest
          format: cyclonedx-json
          artifact-name: sbom.cyclonedx.json
```

> **O que este job faz:**
> 1. Faz login no GHCR (precisa acessar a imagem)
> 2. Usa `anchore/sbom-action` para rodar Syft na imagem do GHCR
> 3. Gera SBOM no formato CycloneDX JSON
> 4. Publica automaticamente como artefato do workflow

### 3.2 Posição no workflow

O job `sbom` depende do `build` (precisa da imagem publicada). Pode rodar em paralelo com o `security-scan`:

```
build → security-scan → gate → deploy-k8s → deploy-render → dast
     ↘ sbom (paralelo)
```

---

## 4. Workflow Completo (seção relevante)

Para referência, a estrutura completa dos jobs:

```yaml
name: DevSecOps Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

permissions:
  contents: read
  packages: write
  issues: write

jobs:
  lint:
    # ... (existente)

  semgrep:
    # ... (existente)

  test:
    # ... (existente)

  build:
    # ... (existente, inclui push GHCR)

  security-scan:
    name: "🛡️ Security Scan"
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4

      - name: "Trivy: SCA + Secrets"
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          scan-ref: '.'
          severity: HIGH,CRITICAL

      - name: "Trivy: Image Scan"
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ghcr.io/${{ github.repository }}:latest
          severity: HIGH,CRITICAL

      - name: "🏗️ Trivy: IaC Scan"                    # ← NOVO
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: config
          scan-ref: '.'
          severity: HIGH,CRITICAL
          exit-code: '0'

  sbom:                                                   # ← NOVO JOB
    name: "📋 Generate SBOM"
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: anchore/sbom-action@v0
        with:
          image: ghcr.io/${{ github.repository }}:latest
          format: cyclonedx-json
          artifact-name: sbom.cyclonedx.json

  security-gate:
    # ... (existente)

  deploy-k8s:
    # ... (existente)

  deploy-render:
    # ... (existente)

  dast:
    # ... (existente)
```

---

## 5. Commit e Push

```bash
git add .github/workflows/devsecops.yml
git commit -m "feat: add IaC scan (trivy config) + SBOM generation (syft) to pipeline"
git push
```

---

## 6. Acompanhar Execução

```bash
gh run watch
```

Ou acesse **Actions** no GitHub. O pipeline agora tem **11 stages**:

```
🔍 ESLint                    ✅
🔎 Semgrep SAST              ✅
🧪 Jest Testes               ✅
🐳 Docker Build + Push       ✅
🛡️ Security Scan            ✅  (agora com IaC scan)
📋 Generate SBOM             ✅  ← NOVO
🚨 Security Gate             ✅
🚀 Deploy K8s (Kind)         ✅
🚀 Deploy Render             ✅
🔍 ZAP Baseline Scan         ✅
```

> O job `sbom` roda em paralelo com `security-scan` — ambos dependem do `build`. Não aumenta o tempo total do pipeline.

---

## 7. Verificar o IaC Scan

No log do job `security-scan`, procure a seção **Trivy: IaC Scan**:

```
Dockerfile (dockerfile)
═══════════════════════
Tests: 8 (SUCCESSES: 8, FAILURES: 0)

k8s/app-deployment.yaml (kubernetes)
═════════════════════════════════════
Tests: 25 (SUCCESSES: 23, FAILURES: 2)
Failures: 2 (LOW: 2)
```

Se houver findings HIGH/CRITICAL, volte à Prática 1 e corrija. Quando estiver limpo, mude `exit-code` para `'1'` para proteger contra regressões.

---

## 8. Baixar e Inspecionar o SBOM

### 8.1 Baixar

1. Aba **Actions** → execução mais recente
2. Role até **Artifacts**
3. Baixe `sbom.cyclonedx.json`

### 8.2 Inspecionar

```bash
# Quantos componentes na imagem?
cat sbom.cyclonedx.json | jq '.components | length'

# Listar todos os packages npm
cat sbom.cyclonedx.json | jq -r '.components[] | select(.type == "library") | "\(.name)@\(.version)"' | sort

# Procurar express
cat sbom.cyclonedx.json | jq '.components[] | select(.name == "express")'

# Procurar pg
cat sbom.cyclonedx.json | jq '.components[] | select(.name == "pg")'
```

### 8.3 Reflexão

- Quantos componentes estão na imagem? (esperado: 100-200)
- Você sabia que tinha tantos packages?
- Se um CVE for descoberto no `send` (dependência transitiva do express), o SBOM responde em segundos se você está afetado

---

## 9. Promover IaC Scan para Bloqueante (Opcional)

Quando todos os findings HIGH/CRITICAL estiverem corrigidos, mude o `exit-code` para bloquear o pipeline:

```yaml
      - name: "🏗️ Trivy: IaC Scan"
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: config
          scan-ref: '.'
          severity: HIGH,CRITICAL
          exit-code: '1'                  # ← Agora bloqueia!
```

```bash
git add .github/workflows/devsecops.yml
git commit -m "security: promote IaC scan to blocking (exit-code 1)"
git push
```

> A partir de agora, qualquer misconfiguration HIGH/CRITICAL no Dockerfile ou nos manifests K8s bloqueia o pipeline. Proteção contra regressão.

---

## 10. Troubleshooting

**Problema:** IaC scan reporta finding em `secret.yaml` (data in plaintext)
**Solução:** Esperado no lab. Em produção: use Sealed Secrets ou External Secrets Operator. No lab, mantenha `exit-code: '0'` ou ignore o finding com severidade LOW.

**Problema:** SBOM job falha com "unauthorized" ao acessar GHCR
**Solução:** O job precisa de `docker/login-action` antes do `anchore/sbom-action`. Verifique que `permissions: packages: write` está no workflow.

**Problema:** SBOM artifact não aparece
**Solução:** O `anchore/sbom-action@v0` publica o artefato automaticamente. Verifique se o job completou com sucesso. O artefato aparece na seção "Artifacts" da execução.

**Problema:** IaC scan encontra muitos findings LOW
**Solução:** Filtre por severidade: `severity: HIGH,CRITICAL` ignora LOW e MEDIUM. Para ver tudo: `severity: LOW,MEDIUM,HIGH,CRITICAL`.

---

## Estrutura do Pipeline (Final A6)

```
┌─────────┐   ┌──────────┐   ┌──────────┐   ┌────────────┐
│  lint    │──►│ semgrep  │──►│  test    │──►│ build+push │
│(ESLint)  │   │ (SAST)   │   │ (Jest)   │   │  (GHCR)    │
└─────────┘   └──────────┘   └──────────┘   └─────┬──────┘
                                              ┌────┴────┐
                                              ▼         ▼
                                     ┌──────────┐  ┌──────────┐
                                     │ security │  │  sbom    │
                                     │ scan     │  │ (Syft)   │
                                     │+IaC scan │  └──────────┘
                                     └────┬─────┘
                                          ▼
                                     ┌──────────┐
                                     │  gate    │
                                     └────┬─────┘
                                     ┌────┴────┐
                                     ▼         ▼
                                ┌──────────┐  ┌──────────┐
                                │deploy-k8s│  │deploy-   │
                                │(Kind)    │  │render    │
                                └──────────┘  └────┬─────┘
                                                   │
                                                   ▼
                                             ┌──────────┐
                                             │  dast    │
                                             │(ZAP)     │
                                             └──────────┘
```

---

## Conexão com a Disciplina

| Conceito | Onde aplicamos |
|----------|---------------|
| IaC Scan | `trivy config .` no pipeline — misconfigurations bloqueiam deploy |
| SBOM | `anchore/sbom-action` gera inventário como artefato |
| Pipeline as Code | Workflow YAML é IaC — cada extensão é um commit revisável |
| Defense in Depth | +2 camadas: IaC scan + SBOM (total: 9 camadas) |
| Supply Chain | SBOM documenta todos os componentes da imagem |
| Padrão de extensão | A3→A4→A5→A6: cada aula adiciona stages sem quebrar o existente |

---

## Estrutura do Projeto (Final A6)

```
devsecops-lab-a2/
├── .github/workflows/devsecops.yml   ← 11 stages (CI + IaC + SBOM + CD + DAST)
├── .zap-rules.tsv
├── k8s/                               ← manifests corrigidos (resource limits)
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── postgres-deployment.yaml
│   ├── postgres-service.yaml
│   ├── init-db-job.yaml
│   ├── app-deployment.yaml            ← com resources.limits
│   ├── app-service.yaml
│   └── network-policy.yaml
├── src/
│   ├── app.js                         ← helmet + rateLimit + cors + 404 handler
│   ├── db.js
│   ├── init-db.js
│   └── server.js
├── tests/
│   └── app.test.js
├── docker-compose.yml
├── Dockerfile                         ← USER node + HEALTHCHECK
├── eslint.config.mjs
├── package.json
└── README.md
```

---

## Referências

1. **Trivy Config Scanning** — https://aquasecurity.github.io/trivy/latest/docs/scanner/misconfiguration
2. **Trivy GitHub Action** — https://github.com/aquasecurity/trivy-action
3. **Anchore SBOM Action** — https://github.com/anchore/sbom-action
4. **CycloneDX Specification** — https://cyclonedx.org/specification/overview
5. **Syft Documentation** — https://github.com/anchore/syft