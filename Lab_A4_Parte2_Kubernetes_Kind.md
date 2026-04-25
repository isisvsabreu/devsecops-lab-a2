# Lab A4 — Parte 2: Kubernetes com Kind

## Deploy Seguro no Kubernetes Local

**Autor:** Victor Raffael Lins Carlota

---

## RESUMO

Nesta prática, vamos migrar a aplicação da Parte 1 (Docker Compose) para Kubernetes, rodando localmente com Kind. Cada recurso do K8s será apresentado com seu YAML e comandos kubectl correspondentes:

| Recurso K8s | Para que serve | Equivalente Compose |
|------------|----------------|---------------------|
| **ConfigMap** | Configuração (DB_HOST, DB_PORT) | `environment:` |
| **Secret** | Credenciais (DB_USER, DB_PASSWORD) | `environment:` |
| **Deployment** | App rodando com réplicas + self-healing | `services: app:` |
| **Service** | Networking estável entre pods | DNS automático do Compose |
| **Job** | Tarefa que roda uma vez (init-db) | `docker compose exec` |
| **Pod** | Unidade mínima (gerenciado pelo Deployment) | Um container |

---

## 1. Pré-Requisitos

- Docker instalado e rodando
- Repositório `devsecops-lab-a2` com as alterações da Parte 1 (PostgreSQL)
- Imagem Docker do backend funcional

### 1.1 Instalar Kind

```bash
# Baixar o binário
curl -sLo kind https://kind.sigs.k8s.io/dl/latest/kind-linux-amd64
chmod +x kind
sudo mv kind /usr/local/bin/

# Verificar
kind --version
# Esperado: kind v0.x.x
```

### 1.2 Instalar kubectl

```bash
# Baixar a versão estável mais recente
curl -sLO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/

# Verificar
kubectl version --client
# Esperado: Client Version: v1.x.x
```

### 1.3 Verificação

```bash
echo "=== Verificação ==="
echo "Docker:  $(docker --version)"
echo "Kind:    $(kind --version)"
echo "kubectl: $(kubectl version --client --short 2>/dev/null || kubectl version --client)"
echo "==================="
```

---

## 2. Criar Cluster Kind

```bash
# Criar cluster (demora ~30 segundos)
kind create cluster --name devsecops

# Verificar que o cluster está rodando
kubectl cluster-info
# Esperado: Kubernetes control plane is running at https://127.0.0.1:xxxxx

kubectl get nodes
# Esperado:
# NAME                      STATUS   ROLES           AGE   VERSION
# devsecops-control-plane   Ready    control-plane   30s   v1.x.x
```

> Kind cria um cluster K8s inteiro dentro de containers Docker. Cada "node" do cluster é um container. Zero infra, zero cloud.

---

## 3. Construir e Carregar Imagens

O Kind usa um registry interno. Precisamos carregar as imagens locais nele:

```bash
cd devsecops-lab-a2

# Construir a imagem do backend
docker build -t devsecops-app:local .

# Carregar no Kind (não precisa de push para registry)
kind load docker-image devsecops-app:local --name devsecops

# Verificar que a imagem está no cluster
docker exec -it devsecops-control-plane crictl images | grep devsecops
```

> No Kind, usamos `kind load docker-image` em vez de `docker push`. A imagem é copiada diretamente para o node do cluster.

---

## 4. Criar Diretório de Manifests

```bash
mkdir -p k8s
```

Todos os YAMLs K8s ficarão neste diretório.

---

## 5. ConfigMap — Configuração da Aplicação

O ConfigMap armazena configurações **não-sensíveis** como variáveis de ambiente.

### 5.1 Criar o YAML

Crie o arquivo `k8s/configmap.yaml`:

```yaml
# ConfigMap: armazena configuração não-sensível
# Equivalente Compose: environment: no docker-compose.yml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config                    # Nome para referenciar em outros recursos
data:
  DB_HOST: postgres-svc               # Nome do Service do PostgreSQL (DNS interno do K8s)
  DB_PORT: "5432"                     # Porta do PostgreSQL (string no ConfigMap)
  DB_NAME: devsecops                  # Nome do banco de dados
```

### 5.2 Aplicar e verificar

```bash
# Aplicar o ConfigMap
kubectl apply -f k8s/configmap.yaml
# Esperado: configmap/app-config created

# Verificar
kubectl get configmap app-config
kubectl describe configmap app-config
# Mostra as chaves e valores
```

### 5.3 Comandos úteis

```bash
# Listar todos os ConfigMaps
kubectl get configmap

# Ver conteúdo em YAML
kubectl get configmap app-config -o yaml

# Editar interativamente
kubectl edit configmap app-config

# Deletar
kubectl delete configmap app-config
```

---

## 6. Secret — Credenciais do Banco

O Secret armazena dados **sensíveis** (senhas, tokens, chaves). Base64-encoded (não criptografado — atenção!).

### 6.1 Criar o YAML

Crie o arquivo `k8s/secret.yaml`:

```yaml
# Secret: armazena credenciais sensíveis
# Base64 encoded (NÃO é criptografia!)
# Em produção: use Sealed Secrets, External Secrets ou Vault
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials                # Nome para referenciar em outros recursos
type: Opaque                          # Tipo genérico (outros: tls, dockerconfigjson)
stringData:                           # stringData aceita plain text (K8s codifica para base64)
  DB_USER: app
  DB_PASSWORD: secret
```

> **stringData** vs **data**: `stringData` aceita texto puro (K8s converte para base64 automaticamente). `data` exige que você mesmo codifique: `echo -n 'secret' | base64` → `c2VjcmV0`.

### 6.2 Aplicar e verificar

```bash
# Aplicar
kubectl apply -f k8s/secret.yaml
# Esperado: secret/db-credentials created

# Verificar (valores são mascarados)
kubectl get secret db-credentials
kubectl describe secret db-credentials
# Mostra as chaves mas NÃO os valores

# Para ver os valores (base64 decode):
kubectl get secret db-credentials -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
# Esperado: secret
```

### 6.3 Comandos úteis

```bash
# Criar secret via CLI (alternativa ao YAML)
kubectl create secret generic db-credentials \
  --from-literal=DB_USER=app \
  --from-literal=DB_PASSWORD=secret

# Listar secrets
kubectl get secrets

# Deletar
kubectl delete secret db-credentials
```

---

## 7. Deployment do PostgreSQL

O Deployment garante que o pod do PostgreSQL esteja sempre rodando.

### 7.1 Criar o YAML

Crie o arquivo `k8s/postgres-deployment.yaml`:

```yaml
# Deployment: gerencia pods do PostgreSQL
# Garante que o número de réplicas esteja rodando
# Se o pod morrer, o Deployment recria automaticamente
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
spec:
  replicas: 1                         # Banco de dados: 1 réplica (stateful)
  selector:
    matchLabels:
      app: postgres                   # Seleciona pods com este label
  template:                           # Template do Pod que será criado
    metadata:
      labels:
        app: postgres                 # Label do pod (usado pelo selector e pelo Service)
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine   # Imagem oficial do PostgreSQL
          ports:
            - containerPort: 5432     # Porta que o PostgreSQL escuta
          env:                        # Variáveis de ambiente diretas
            - name: POSTGRES_DB
              value: devsecops
            - name: POSTGRES_USER     # Pega do Secret
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: DB_USER
            - name: POSTGRES_PASSWORD # Pega do Secret
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: DB_PASSWORD
          readinessProbe:             # K8s verifica se o pod está pronto
            exec:
              command: ["pg_isready", "-U", "app", "-d", "devsecops"]
            initialDelaySeconds: 5
            periodSeconds: 5
```

### 7.2 Aplicar e verificar

```bash
kubectl apply -f k8s/postgres-deployment.yaml
# Esperado: deployment.apps/postgres created

# Verificar o Deployment
kubectl get deployment postgres
# Esperado: READY 1/1

# Verificar o Pod criado pelo Deployment
kubectl get pods -l app=postgres
# Esperado: STATUS Running, READY 1/1

# Ver logs do PostgreSQL
kubectl logs -l app=postgres
# Esperado: "database system is ready to accept connections"
```

---

## 8. Service do PostgreSQL

O Service cria um endereço estável para acessar os pods do PostgreSQL.

### 8.1 Criar o YAML

Crie o arquivo `k8s/postgres-service.yaml`:

```yaml
# Service: endereço de rede estável para o PostgreSQL
# Pods são efêmeros (IP muda). Service é fixo.
# O nome do Service vira hostname DNS: postgres-svc
apiVersion: v1
kind: Service
metadata:
  name: postgres-svc                  # Este nome vira DNS interno (= DB_HOST no ConfigMap)
spec:
  selector:
    app: postgres                     # Roteia tráfego para pods com label app=postgres
  ports:
    - port: 5432                      # Porta do Service
      targetPort: 5432                # Porta do container
  type: ClusterIP                     # Acesso interno ao cluster (padrão)
```

### 8.2 Aplicar e verificar

```bash
kubectl apply -f k8s/postgres-service.yaml
# Esperado: service/postgres-svc created

kubectl get svc postgres-svc
# Esperado: TYPE ClusterIP, PORT 5432
```

> Agora qualquer pod no cluster pode conectar ao PostgreSQL via `postgres-svc:5432`.

---

## 9. Job — Inicializar o Banco

O Job executa uma tarefa que roda **uma vez** e termina. Perfeito para migrations e seeds.

### 9.1 Criar o YAML

Crie o arquivo `k8s/init-db-job.yaml`:

```yaml
# Job: executa uma tarefa uma vez e termina
# Ideal para: migrations, seeds, backups
# Diferente do Deployment: não fica rodando, termina com sucesso ou falha
apiVersion: batch/v1
kind: Job
metadata:
  name: init-db
spec:
  backoffLimit: 3                     # Tenta 3 vezes se falhar
  template:
    spec:
      restartPolicy: Never            # Não reinicia o pod se falhar (Job gerencia retries)
      containers:
        - name: init-db
          image: devsecops-app:local  # Mesma imagem da app (tem o script init-db.js)
          command: ["node", "src/init-db.js"]  # Sobrescreve o CMD do Dockerfile
          envFrom:                    # Carrega TODAS as variáveis do ConfigMap
            - configMapRef:
                name: app-config
          env:                        # Variáveis do Secret (individualmente)
            - name: DB_USER
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: DB_USER
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: DB_PASSWORD
```

### 9.2 Aplicar e verificar

```bash
kubectl apply -f k8s/init-db-job.yaml
# Esperado: job.batch/init-db created

# Acompanhar execução
kubectl get jobs
# Esperado: COMPLETIONS 1/1 (quando terminar)

# Ver logs do Job
kubectl logs job/init-db
# Esperado: "Database initialized"

# Ver o pod do Job (status: Completed)
kubectl get pods -l job-name=init-db
# Esperado: STATUS Completed
```

### 9.3 Comandos úteis para Jobs

```bash
# Listar Jobs
kubectl get jobs

# Deletar Job (e seus pods)
kubectl delete job init-db

# Reexecutar: delete e apply novamente
kubectl delete job init-db && kubectl apply -f k8s/init-db-job.yaml
```

---

## 10. Deployment da Aplicação

O Deployment gerencia os pods do backend Express.

### 10.1 Criar o YAML

Crie o arquivo `k8s/app-deployment.yaml`:

```yaml
# Deployment: gerencia pods da aplicação Express
# 2 réplicas: se um pod morre, K8s recria. Load balancing automático.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: devsecops-app
spec:
  replicas: 2                         # 2 instâncias (alta disponibilidade)
  selector:
    matchLabels:
      app: devsecops
  template:
    metadata:
      labels:
        app: devsecops
    spec:
      containers:
        - name: app
          image: devsecops-app:local
          imagePullPolicy: Never       # Imagem carregada via kind load (não puxa de registry)
          ports:
            - containerPort: 3000
          envFrom:                     # Carrega config do ConfigMap
            - configMapRef:
                name: app-config
          env:                         # Credenciais do Secret
            - name: DB_USER
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: DB_USER
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: DB_PASSWORD
          securityContext:              # Segurança a nível de Container
            allowPrivilegeEscalation: false   # Não pode escalar privilégios
            readOnlyRootFilesystem: true      # Filesystem read-only
          livenessProbe:               # K8s reinicia o pod se falhar
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:              # K8s só envia tráfego quando pronto
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
```

### 10.2 Aplicar e verificar

```bash
kubectl apply -f k8s/app-deployment.yaml
# Esperado: deployment.apps/devsecops-app created

# Verificar Deployment
kubectl get deployment devsecops-app
# Esperado: READY 2/2

# Verificar Pods
kubectl get pods -l app=devsecops
# Esperado: 2 pods com STATUS Running

# Ver logs de um pod
kubectl logs -l app=devsecops --tail=20

# Descrever o Deployment (ver eventos, condições)
kubectl describe deployment devsecops-app
```

---

## 11. Service da Aplicação

### 11.1 Criar o YAML

Crie o arquivo `k8s/app-service.yaml`:

```yaml
# Service: endereço estável para acessar a aplicação
# Load balancing automático entre as 2 réplicas
apiVersion: v1
kind: Service
metadata:
  name: devsecops-svc
spec:
  selector:
    app: devsecops                    # Roteia para pods com label app=devsecops
  ports:
    - port: 80                        # Porta do Service (externa)
      targetPort: 3000                # Porta do container
  type: ClusterIP                     # Acesso interno (usaremos port-forward)
```

### 11.2 Aplicar e verificar

```bash
kubectl apply -f k8s/app-service.yaml
# Esperado: service/devsecops-svc created

kubectl get svc devsecops-svc
# Esperado: TYPE ClusterIP, PORT 80
```

---

## 12. Acessar a Aplicação

```bash
# Port-forward: conecta porta local à porta do Service
kubectl port-forward svc/devsecops-svc 8080:80 &
# O & roda em background
```

> **Se estiver usando WSL:** o port-forward acima escuta apenas em `127.0.0.1` dentro do WSL. Para acessar do navegador do Windows, use `--address`:
> ```bash
> kubectl port-forward svc/devsecops-svc 8080:80 --address 0.0.0.0 &
> ```
> Depois acesse `http://localhost:8080` no navegador do Windows normalmente. Em versões recentes do WSL2, `localhost` já é compartilhado automaticamente — teste primeiro sem `--address`.

```bash
# Testar
curl http://localhost:8080/health
# Esperado: {"status":"ok","timestamp":"..."}

curl http://localhost:8080/api/info
# Esperado: {"app":"devsecops-lab-a2","version":"1.0.0",...}

curl -X POST http://localhost:8080/api/messages \
  -H "Content-Type: application/json" \
  -d '{"text": "Primeira mensagem via Kubernetes!"}'
# Esperado: {"id":1,"text":"Primeira mensagem via Kubernetes!",...}

curl http://localhost:8080/api/messages
# Esperado: array com a mensagem criada
```

### ✅ Validação

Se os endpoints retornaram sucesso, a aplicação está rodando no Kubernetes com Kind!

---

## 13. Testar Self-Healing

```bash
# Ver os pods rodando
kubectl get pods -l app=devsecops
# Anote o nome de um pod (ex: devsecops-app-abc123)

# Matar o pod
kubectl delete pod <NOME_DO_POD>

# Imediatamente verificar
kubectl get pods -l app=devsecops
# Esperado: o pod antigo está Terminating, um NOVO já está sendo criado
# Em ~10 segundos: 2/2 pods Running novamente

# O Deployment GARANTE 2 réplicas. Sempre.
```

> No Docker Compose, se o container morre, fica morto (a não ser que use `restart: always`). No K8s, o Deployment recria automaticamente.

---

## 14. Aplicar Network Policy

### 14.1 Criar o YAML

Crie o arquivo `k8s/network-policy.yaml`:

```yaml
# NetworkPolicy: restringe tráfego de rede entre pods
# Por padrão, todos os pods falam com todos (inseguro!)
# Esta policy: postgres só aceita conexões da app
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: restrict-postgres
spec:
  podSelector:
    matchLabels:
      app: postgres                   # Aplica ao pod do PostgreSQL
  policyTypes:
    - Ingress                         # Restringe tráfego de ENTRADA
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: devsecops          # Só pods com label app=devsecops podem acessar
      ports:
        - port: 5432                  # Apenas na porta do PostgreSQL
```

### 14.2 Aplicar

```bash
kubectl apply -f k8s/network-policy.yaml
# Esperado: networkpolicy.networking.k8s.io/restrict-postgres created

kubectl get networkpolicy
```

> **Nota:** Network Policies precisam de um CNI (Container Network Interface) que suporte (Calico, Cilium). O Kind padrão usa kindnet que tem suporte limitado. Em clusters de produção, o enforcement é garantido.

---

## 15. Resumo — Visão Geral

```bash
# Ver TUDO que criamos no cluster
kubectl get all
kubectl get configmap,secret,networkpolicy
```

Resultado esperado:

```
NAME                               READY   STATUS
pod/devsecops-app-xxxxx            1/1     Running
pod/devsecops-app-yyyyy            1/1     Running
pod/postgres-zzzzz                 1/1     Running

NAME                    TYPE        PORT(S)
service/devsecops-svc   ClusterIP   80/TCP
service/postgres-svc    ClusterIP   5432/TCP

NAME                            READY   UP-TO-DATE
deployment.apps/devsecops-app   2/2     2
deployment.apps/postgres        1/1     1

NAME                       COMPLETIONS
job.batch/init-db          1/1
```

---

## 16. Limpeza

```bash
# Parar o port-forward
kill %1 2>/dev/null

# Deletar o cluster inteiro
kind delete cluster --name devsecops
# Esperado: Deleting cluster "devsecops" ...

# Verificar que foi removido
kind get clusters
# Esperado: (vazio)
```

---

## Estrutura Final do Projeto

```
devsecops-lab-a2/
├── .github/workflows/devsecops.yml
├── k8s/                              ← NOVO
│   ├── configmap.yaml                ← Configuração da app
│   ├── secret.yaml                   ← Credenciais do banco
│   ├── postgres-deployment.yaml      ← PostgreSQL pod
│   ├── postgres-service.yaml         ← DNS estável para postgres
│   ├── init-db-job.yaml              ← Inicialização do banco
│   ├── app-deployment.yaml           ← App com 2 réplicas + security
│   ├── app-service.yaml              ← DNS estável para app
│   └── network-policy.yaml           ← Firewall entre pods
├── src/
│   ├── app.js
│   ├── db.js
│   ├── init-db.js
│   └── server.js
├── tests/
│   └── app.test.js
├── docker-compose.yml
├── Dockerfile
├── eslint.config.mjs
├── package.json
└── README.md
```

---

## Comparativo Final: Compose vs K8s

| Aspecto | Docker Compose | Kubernetes |
|---------|---------------|------------|
| Config | `environment:` no YAML | ConfigMap |
| Credenciais | `environment:` no YAML | Secret |
| App rodando | `services: app:` | Deployment (2 réplicas) |
| Banco rodando | `services: postgres:` | Deployment (1 réplica) |
| Networking | DNS automático por service name | Service (ClusterIP) |
| Init script | `docker compose exec` | Job |
| Persistência | `volumes:` | PersistentVolumeClaim (avançado) |
| Segurança | Tudo fala com tudo | Network Policy + Pod Security |
| Self-healing | `restart: unless-stopped` | Deployment garante réplicas |
| Acesso local | `ports: "3000:3000"` | `kubectl port-forward` |

---

## Referências

1. **Kubernetes Documentation** — https://kubernetes.io/docs
2. **Kind** — https://kind.sigs.k8s.io
3. **kubectl Cheat Sheet** — https://kubernetes.io/docs/reference/kubectl/cheatsheet/
4. **Pod Security Standards** — https://kubernetes.io/docs/concepts/security/pod-security-standards/
5. **Network Policies** — https://kubernetes.io/docs/concepts/services-networking/network-policies/