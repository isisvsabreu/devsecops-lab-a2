# Lab A6 — Prática 1: IaC Scan Local + SBOM

## Trivy Config + Syft — Escanear Antes de Automatizar

**Autor:** Victor Raffael Lins Carlota
**Disciplina:** DevSecOps — Aula 6: Supply Chain, IaC e Chaos Engineering
**Pré-requisito:** Lab A5 concluído (pipeline 9 stages, manifests K8s em k8s/)

---

## RESUMO

Nesta prática, vamos:

1. **Escanear o Dockerfile** com `trivy config` — encontrar misconfigurations
2. **Escanear os manifests K8s** com `trivy config k8s/` — encontrar problemas de segurança
3. **Interpretar e corrigir** os findings
4. **Gerar SBOM local** com Syft — inventariar todos os componentes da imagem

Ao final, os manifests estarão mais seguros e você terá um SBOM do projeto.

---

## 1. Instalar Trivy CLI

Se ainda não tem o Trivy instalado localmente:

**Linux/WSL:**
```bash
sudo apt-get install -y wget apt-transport-https gnupg lsb-release
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo apt-key add -
echo "deb https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main" | sudo tee /etc/apt/sources.list.d/trivy.list
sudo apt-get update && sudo apt-get install -y trivy
```

**macOS:**
```bash
brew install trivy
```

**Verificar:**
```bash
trivy --version
# Esperado: Version: 0.5x.x
```

> Trivy já está no pipeline (GitHub Actions usa `aquasecurity/trivy-action`). Aqui instalamos localmente para análise interativa.

---

## 2. Escanear o Dockerfile

```bash
cd devsecops-lab-a2
trivy config Dockerfile
```

### 2.1 Findings esperados

Dependendo do seu Dockerfile, findings comuns incluem:

| Finding | Severidade | Descrição | Remediação |
|---------|-----------|-----------|-----------|
| `DS002` | HIGH | Última instrução não é USER | Adicionar `USER node` no final |
| `DS026` | MEDIUM | Sem HEALTHCHECK | Adicionar `HEALTHCHECK CMD` |
| `DS001` | MEDIUM | FROM com tag :latest | Usar tag específica (node:22-alpine) |

### 2.2 Verificar nosso Dockerfile

O Dockerfile da A2 já deve ter boas práticas. Confirme:

```dockerfile
# Verificar que temos:
FROM node:22-alpine          # ✅ Tag específica (não :latest)
RUN addgroup -S app && \
    adduser -S app -G app    # ✅ Usuário não-root
USER app                     # ✅ Última instrução é USER
HEALTHCHECK CMD curl -f http://localhost:3000/health || exit 1  # ✅ HEALTHCHECK
```

Se algum desses itens está faltando, adicione e re-rode o scan:

```bash
trivy config Dockerfile
# Objetivo: 0 HIGH, 0 CRITICAL
```

---

## 3. Escanear os Manifests K8s

```bash
trivy config k8s/
```

### 3.1 Findings esperados

O Trivy analisa cada arquivo YAML individualmente:

| Finding | Severidade | Arquivo | Descrição |
|---------|-----------|---------|-----------|
| `KSV001` | MEDIUM | app-deployment.yaml | Container resources CPU limits not set |
| `KSV003` | MEDIUM | app-deployment.yaml | Container resources memory limits not set |
| `KSV012` | MEDIUM | postgres-deployment.yaml | Container runs as root |
| `KSV014` | LOW | app-deployment.yaml | readOnlyRootFilesystem not set |
| `KSV021` | LOW | app-deployment.yaml | Default namespace used |
| `KSV106` | MEDIUM | secret.yaml | Secret data stored in plaintext |

### 3.2 Interpretar o output

O output do Trivy mostra:

```
k8s/app-deployment.yaml (kubernetes)
═════════════════════════════════════

Tests: 25 (SUCCESSES: 20, FAILURES: 5)
Failures: 5 (HIGH: 0, MEDIUM: 3, LOW: 2)

MEDIUM: Container 'app' resources CPU limit not set
────────────────────────────────────────────────────
Add resources.limits.cpu

MEDIUM: Container 'app' resources memory limit not set
──────────────────────────────────────────────────────
Add resources.limits.memory
```

Cada finding tem:
- **Severidade**: CRITICAL, HIGH, MEDIUM, LOW
- **ID**: KSV001, KSV003, etc.
- **Arquivo e recurso**: qual Deployment/Service afetado
- **Remediação**: o que adicionar para corrigir

---

## 4. Corrigir Findings

### 4.1 Adicionar resource limits aos Deployments

Edite `k8s/app-deployment.yaml`. Na seção `containers`, adicione `resources`:

```yaml
      containers:
        - name: app
          image: devsecops-app:local
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 3000
          resources:                    # ← NOVO
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
```

Faça o mesmo para `k8s/postgres-deployment.yaml`:

```yaml
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          resources:                    # ← NOVO
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
```

> **Por que resource limits?** Sem limits, um pod pode consumir toda a CPU/memória do node, causando DoS nos outros pods. O Trivy reporta como MEDIUM porque é uma best practice de segurança.

### 4.2 Verificar securityContext

Na A4, já adicionamos `securityContext` básico. Confirme que o Deployment da app tem:

```yaml
      containers:
        - name: app
          securityContext:
            runAsNonRoot: true
            readOnlyRootFilesystem: false  # Node.js precisa escrever em /tmp
            allowPrivilegeEscalation: false
```

> `readOnlyRootFilesystem: true` é ideal, mas o Node.js precisa escrever em /tmp para funcionar. Alternativa: montar tmpfs em /tmp.

### 4.3 Sobre o Secret no Git

O Trivy pode reportar que `secret.yaml` com `data:` ou `stringData:` está no Git. Isso é esperado no lab — em produção:

- Use **Sealed Secrets** (criptografa o Secret, só o cluster decifra)
- Use **External Secrets Operator** (puxa do AWS Secrets Manager, Vault, etc.)
- Use **GitHub Secrets** via pipeline (não commitar no repo)

Para o lab, mantenha o secret no Git mas documente que é uma exceção educacional.

---

## 5. Re-escanear Após Correções

```bash
trivy config k8s/
```

Compare o resultado antes e depois:

```
ANTES: Failures: 5 (MEDIUM: 3, LOW: 2)
DEPOIS: Failures: 1-2 (LOW: 1-2)
```

Os findings MEDIUM (resource limits) devem ter desaparecido. Findings LOW (readOnlyRootFilesystem, default namespace) são aceitáveis no lab.

---

## 6. Escanear Tudo de Uma Vez

O Trivy pode escanear o repositório inteiro:

```bash
trivy config .
```

Isso escaneia:
- `Dockerfile`
- `docker-compose.yml`
- `k8s/*.yaml`
- Qualquer outro arquivo de configuração (Terraform, Helm, etc.)

---

## 7. Instalar Syft e Gerar SBOM

### 7.1 Instalar Syft

**Linux/WSL:**
```bash
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin
```

**macOS:**
```bash
brew install syft
```

**Verificar:**
```bash
syft --version
```

### 7.2 Gerar SBOM do diretório

```bash
syft dir:. -o cyclonedx-json > sbom-dir.json
```

Isso gera um SBOM dos arquivos do projeto (package.json, package-lock.json).

### 7.3 Gerar SBOM da imagem Docker

Se você tem a imagem construída localmente:

```bash
docker build -t devsecops-app:local .
syft devsecops-app:local -o cyclonedx-json > sbom-image.json
```

Ou do GHCR:

```bash
syft ghcr.io/SEU_USER/devsecops-lab-a2:latest -o cyclonedx-json > sbom-image.json
```

### 7.4 Inspecionar o SBOM

```bash
# Quantos componentes?
cat sbom-image.json | jq '.components | length'
# Esperado: 100-200 componentes

# Listar os 10 maiores por nome
cat sbom-image.json | jq -r '.components[] | .name' | sort | head -20

# Procurar um package específico
cat sbom-image.json | jq '.components[] | select(.name == "express")'
```

> O SBOM da imagem Docker lista TODOS os packages: npm (express, pg, helmet, cors e suas dependências) + Alpine OS packages (busybox, musl, openssl, etc.).

### 7.5 Escanear SBOM por CVEs (opcional)

Se tiver o Grype instalado:

```bash
# Instalar Grype
curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin

# Escanear SBOM
grype sbom:sbom-image.json
```

---

## 8. Commit

```bash
git add k8s/ Dockerfile
git commit -m "security: fix IaC findings (resource limits, securityContext)"
```

> Não faça push ainda — na Prática 2 vamos adicionar os novos steps ao workflow.

---

## Resumo do que Fizemos

| Etapa | Comando | O que encontrou |
|-------|---------|----------------|
| Scan Dockerfile | `trivy config Dockerfile` | USER, HEALTHCHECK, tag |
| Scan K8s | `trivy config k8s/` | resource limits, securityContext |
| Correção | Editar YAMLs | Adicionar resources.limits |
| Re-scan | `trivy config k8s/` | Confirmar correções |
| SBOM dir | `syft dir:.` | packages do projeto |
| SBOM image | `syft image:local` | TODOS os components da imagem |
| Inspecionar | `jq` no sbom.json | 100-200 components |

---

## Conexão com a Disciplina

| Conceito | Onde aplicamos |
|----------|---------------|
| IaC | Manifests K8s e Dockerfile são Infrastructure as Code |
| IaC Scan | Trivy config encontra misconfigurations antes do deploy |
| SBOM | Syft gera inventário completo de componentes |
| Supply Chain | SBOM responde "o que tem dentro da imagem?" |
| Defense in Depth | +2 camadas: IaC scan + SBOM |

---

## Próximo Passo

Na **Prática 2**, vamos adicionar `trivy config` e `syft` ao workflow do GitHub Actions — automatizando o que fizemos localmente.