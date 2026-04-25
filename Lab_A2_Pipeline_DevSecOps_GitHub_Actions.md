
book
Prática 2 Shift-Left na Prática: SAST, SCA e Secrets
Victor Raffael Lins Carlota
•
7 de abr. (editado: 9 de abr.)
Lab_A2_Pipeline_DevSecOps_GitHub_Actions.md
Texto

Comentários da turma

Adicionar comentário para a turma...

# Lab — Pipeline DevSecOps com GitHub Actions

## Aula 2 — Shift-Left na Prática: SAST, SCA e Secrets

**Autor:** Victor Raffael Lins Carlota

---

## RESUMO

Neste tutorial, você vai construir um backend Node.js do zero, containerizado com Docker, e integrá-lo a uma pipeline completa no GitHub Actions com **5 estágios de qualidade e segurança**:

1. **Lint** — ESLint para análise estática de estilo e erros
2. **Testes Unitários** — Jest para validação funcional
3. **Build Docker** — Construção da imagem do container
4. **Security Scan (SCA)** — Trivy para vulnerabilidades em dependências
5. **Security Gate** — Bloqueio automático se CRITICAL for encontrado

---

## CONTEÚDO

### 1. Pré-Requisitos

Para a execução completa deste laboratório, você precisa de:

- **Conta no GitHub** (gratuita): [github.com](https://github.com)
- **Git** instalado localmente (`git --version`)
- **Node.js 22 (LTS)** instalado via NVM (`node --version`)
- **Docker** instalado e rodando (`docker --version`)
- **GitHub CLI** (opcional, mas recomendado): `gh --version`
- **Editor de código**: VS Code recomendado

> **Nota:** Se você completou o lab da Aula 1, já tem Git e Docker prontos. Siga as seções abaixo apenas para o que ainda não tiver instalado.

---

### 1.1 Instalar NVM (Node Version Manager)

O NVM permite instalar e alternar entre versões do Node.js sem conflito. É o padrão da indústria para gerenciar Node em ambientes de desenvolvimento.

**Linux / macOS / WSL:**

```bash
# Instalar NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Recarregar o shell (ou feche e abra o terminal)
source ~/.bashrc    # ou ~/.zshrc se usar Zsh

# Verificar instalação
nvm --version
# Esperado: 0.40.1 (ou superior)
```

**Instalar Node.js 22 (LTS):**

```bash
# Instalar a versão LTS mais recente
nvm install 22

# Usar como padrão
nvm alias default 22

# Verificar
node --version
# Esperado: v22.x.x

npm --version
# Esperado: 10.x.x
```

> **Dica:** Se você já tem Node instalado via apt/brew e quer migrar para NVM, desinstale a versão anterior primeiro para evitar conflitos: `sudo apt remove nodejs` (Ubuntu) ou `brew uninstall node` (macOS).

---

### 1.2 Instalar GitHub CLI (gh)

O GitHub CLI permite criar repositórios, gerenciar PRs e acompanhar workflows direto do terminal — sem precisar abrir o navegador.

**Ubuntu / WSL:**

```bash
# Adicionar repositório oficial
(type -p wget >/dev/null || sudo apt-get install wget -y) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && sudo apt update \
  && sudo apt install gh -y
```

**macOS:**

```bash
brew install gh
```

**Autenticar:**

```bash
gh auth login
# Escolha: GitHub.com → HTTPS → Login with a web browser
# Siga as instruções no terminal
```

**Verificar:**

```bash
gh auth status
# Esperado: Logged in to github.com account SEU-USER
```

> **Comandos úteis do gh que usaremos:**
> - `gh repo create` — cria repositório
> - `gh run list` — lista execuções do workflow
> - `gh run watch` — acompanha execução em tempo real no terminal

---

---

### 1.3 Verificação Final do Ambiente

Execute este bloco para confirmar que tudo está instalado:

```bash
echo "=== Verificação do Ambiente ==="
echo "Node.js:  $(node --version)"
echo "npm:      $(npm --version)"
echo "Git:      $(git --version)"
echo "Docker:   $(docker --version)"
echo "gh:       $(gh --version 2>/dev/null || echo 'não instalado (opcional)')"
echo "nvm:      $(nvm --version 2>/dev/null || echo 'não instalado')"
echo "==============================="
```

**Resultado esperado:**

```
=== Verificação do Ambiente ===
Node.js: v22.x.x
npm:     10.x.x
Git:     git version 2.x.x
Docker:  Docker version 27.x.x
gh:      gh version 2.x.x
nvm:     0.40.1
===============================
```

> Se algum item faltar, volte à seção correspondente acima.

---

### 2. Criar o Repositório

#### 2.1 Criar no GitHub

**Opção A — Via GitHub CLI (recomendado):**

```bash
# Criar repo público e clonar em um só comando
gh repo create devsecops-lab-a2 --public --clone
cd devsecops-lab-a2
```

**Opção B — Via navegador:**

Acesse [github.com/new](https://github.com/new) e crie um repositório:

- **Nome:** `devsecops-lab-a2`
- **Visibilidade:** Public (para GitHub Actions gratuito)
- **Inicializar com README:** Sim

Depois clone:

```bash
git clone https://github.com/SEU-USER/devsecops-lab-a2.git
cd devsecops-lab-a2
```

> Substitua `SEU-USER` pelo seu username do GitHub.

---

### 3. Criar o Backend Node.js

#### 3.1 Inicializar o projeto

```bash
npm init -y
```

> Cria o `package.json` com valores padrão. Vamos editá-lo depois.

#### 3.2 Instalar dependências

```bash
npm install express
npm install --save-dev jest eslint globals supertest
```

> - **express**: framework web minimalista
> - **jest**: framework de testes unitários
> - **eslint**: linter para análise estática de código
> - **globals**: definições de ambiente para ESLint (node, jest, browser)
> - **supertest**: permite testar endpoints HTTP sem subir o servidor

#### 3.3 Criar a aplicação

Crie o diretório e o arquivo principal:

```bash
mkdir src
```

Crie o arquivo `src/app.js`:

```javascript
const express = require('express');
const app = express();

app.use(express.json());

// Health check — usado pelo Kubernetes, load balancers, etc.
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Endpoint principal
app.get('/api/info', (req, res) => {
  res.json({
    app: 'devsecops-lab-a2',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Endpoint com lógica de negócio simples
app.post('/api/validate', (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({
      error: 'Email inválido',
      received: email
    });
  }

  return res.json({
    valid: true,
    email: email.toLowerCase().trim()
  });
});

module.exports = app;
```

> **Por que separar `app.js` do server?** Para permitir que os testes importem o `app` sem iniciar o servidor HTTP. Essa é uma boa prática de testabilidade.

Crie o arquivo `src/server.js`:

```javascript
const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

#### 3.4 Testar localmente

```bash
node src/server.js
```

Em outro terminal:

```bash
curl http://localhost:3000/health
# Esperado: {"status":"ok","timestamp":"..."}

curl http://localhost:3000/api/info
# Esperado: {"app":"devsecops-lab-a2","version":"1.0.0","environment":"development"}

curl -X POST http://localhost:3000/api/validate \
  -H "Content-Type: application/json" \
  -d '{"email":"teste@email.com"}'
# Esperado: {"valid":true,"email":"teste@email.com"}
```

Pare o servidor com `Ctrl+C`.

#### ✅ Validação

Se todos os curls retornaram JSON válido, a aplicação está funcionando.

---

### 4. Adicionar Testes Unitários (Jest)

#### 4.1 Criar o diretório de testes

```bash
mkdir tests
```

#### 4.2 Criar os testes

Crie o arquivo `tests/app.test.js`:

```javascript
const request = require('supertest');
const app = require('../src/app');

describe('Health Check', () => {
  it('deve retornar status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('GET /api/info', () => {
  it('deve retornar informações da aplicação', async () => {
    const res = await request(app).get('/api/info');
    expect(res.statusCode).toBe(200);
    expect(res.body.app).toBe('devsecops-lab-a2');
    expect(res.body.version).toBe('1.0.0');
  });
});

describe('POST /api/validate', () => {
  it('deve validar email correto', async () => {
    const res = await request(app)
      .post('/api/validate')
      .send({ email: 'User@Email.COM' });

    expect(res.statusCode).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.email).toBe('user@email.com');
  });

  it('deve rejeitar email sem @', async () => {
    const res = await request(app)
      .post('/api/validate')
      .send({ email: 'invalido' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Email inválido');
  });

  it('deve rejeitar body sem email', async () => {
    const res = await request(app)
      .post('/api/validate')
      .send({});

    expect(res.statusCode).toBe(400);
  });
});
```

> Cada `describe` agrupa testes de um endpoint. Cada `it` testa um cenário.
> `supertest` faz requisições HTTP diretamente ao `app` sem precisar subir o servidor.

#### 4.3 Configurar o script de teste

Edite o `package.json` e substitua a seção `"scripts"`:

```json
{
  "scripts": {
    "start": "node src/server.js",
    "test": "jest --verbose --coverage",
    "lint": "eslint src/ tests/"
  }
}
```

#### 4.4 Executar os testes

```bash
npm test
```

#### ✅ Validação

O output deve mostrar:

```
 PASS  tests/app.test.js
  Health Check
    ✓ deve retornar status ok
  GET /api/info
    ✓ deve retornar informações da aplicação
  POST /api/validate
    ✓ deve validar email correto
    ✓ deve rejeitar email sem @
    ✓ deve rejeitar body sem email

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

E um relatório de cobertura de código será exibido.

---

### 5. Configurar ESLint (Análise Estática)

#### 5.1 Criar o arquivo de configuração

Crie o arquivo `eslint.config.mjs` na raiz do projeto:

```javascript
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,   // require, module, process, __dirname, console
        ...globals.jest,   // describe, it, expect, beforeEach, afterEach
      }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
      "eqeqeq": "error",
      "no-eval": "error",
    }
  }
];
```

> **O que cada parte faz:**
> - `js.configs.recommended` — regras padrão do ESLint (no-undef, no-unused-vars, etc.)
> - `globals.node` — declara variáveis globais do Node.js (require, module, process) para que o ESLint não reclame de "not defined"
> - `globals.jest` — declara variáveis globais do Jest (describe, it, expect) pelo mesmo motivo
> - `"no-eval": "error"` — bloqueia `eval()`, prevenindo injection (OWASP A03)
> - `"eqeqeq": "error"` — exige `===` em vez de `==`, prevenindo coerção de tipo insegura

#### 5.2 Executar o lint

```bash
npm run lint
```

#### ✅ Validação

Se não houver erros, o comando retorna sem output. Se houver warnings, serão listados.

---

### 6. Criar o Dockerfile

Crie o arquivo `Dockerfile` na raiz do projeto:

```dockerfile
# Stage 1: Build e testes
FROM node:22-alpine AS builder

WORKDIR /app

# Copiar apenas package files primeiro (cache de camadas)
COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Runtime
FROM node:22-alpine

# Criar usuário não-root (segurança)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copiar dependências do stage anterior
COPY --from=builder /app/node_modules ./node_modules
COPY src/ ./src/

# Não rodar como root
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
```

> **Boas práticas de segurança aplicadas:**
> - **Multi-stage build**: imagem final menor, sem ferramentas de build
> - **alpine**: base mínima (~5MB vs ~300MB do ubuntu)
> - **non-root user**: princípio de menor privilégio
> - **HEALTHCHECK**: permite que orquestradores monitorem a saúde
> - **`npm ci`**: instalação reproduzível a partir do lock file

Crie o `.dockerignore`:

```
node_modules
.git
.gitignore
tests
coverage
*.md
Dockerfile
.dockerignore
.github
```

> O `.dockerignore` evita copiar arquivos desnecessários para a imagem — incluindo `.git` (que pode conter secrets no histórico).

#### 6.1 Testar o build local

```bash
docker build -t devsecops-lab-a2:local .
docker run -d -p 3000:3000 --name lab-a2 devsecops-lab-a2:local
curl http://localhost:3000/health
docker stop lab-a2 && docker rm lab-a2
```

#### ✅ Validação

O curl deve retornar `{"status":"ok",...}`.

---

### 7. Criar a Pipeline no GitHub Actions

Esta é a parte central do tutorial. Vamos criar um workflow que executa automaticamente a cada push.

#### 7.1 Criar o diretório

```bash
mkdir -p .github/workflows
```

#### 7.2 Criar o workflow

Crie o arquivo `.github/workflows/devsecops.yml`:

```yaml
name: DevSecOps Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  # ============================================
  # Stage 1: Lint (Análise Estática)
  # ============================================
  lint:
    name: "🔍 ESLint - Análise Estática"
    runs-on: ubuntu-latest
    steps:
      - name: Checkout do código
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Instalar dependências
        run: npm ci

      - name: Executar ESLint
        run: npm run lint

  # ============================================
  # Stage 2: Testes Unitários
  # ============================================
  test:
    name: "🧪 Jest - Testes Unitários"
    runs-on: ubuntu-latest
    needs: lint  # Só roda se o lint passar
    steps:
      - name: Checkout do código
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Instalar dependências
        run: npm ci

      - name: Executar testes com cobertura
        run: npm test

      - name: Upload do relatório de cobertura
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/

  # ============================================
  # Stage 3: Build Docker
  # ============================================
  build:
    name: "🐳 Docker Build"
    runs-on: ubuntu-latest
    needs: test  # Só roda se os testes passarem
    steps:
      - name: Checkout do código
        uses: actions/checkout@v4

      - name: Build da imagem Docker
        run: |
          docker build -t devsecops-lab-a2:${{ github.sha }} .
          echo "✅ Imagem construída: devsecops-lab-a2:${{ github.sha }}"

      - name: Verificar tamanho da imagem
        run: |
          docker images devsecops-lab-a2:${{ github.sha }} --format "Tamanho: {{.Size}}"

      - name: Salvar imagem como artefato
        run: |
          docker save devsecops-lab-a2:${{ github.sha }} -o image.tar

      - name: Upload da imagem
        uses: actions/upload-artifact@v4
        with:
          name: docker-image
          path: image.tar
          retention-days: 1

  # ============================================
  # Stage 4: Security Scan (Trivy SCA)
  # ============================================
  security-scan:
    name: "🛡️ Trivy - Security Scan"
    runs-on: ubuntu-latest
    needs: build  # Só roda após o build
    steps:
      - name: Checkout do código
        uses: actions/checkout@v4

      - name: Download da imagem Docker
        uses: actions/download-artifact@v4
        with:
          name: docker-image

      - name: Carregar imagem Docker
        run: docker load -i image.tar

      # Scan de dependências (filesystem)
      - name: "Trivy: Scan de dependências (SCA)"
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          scan-ref: .
          severity: HIGH,CRITICAL
          format: table

      # Scan de secrets (credenciais hardcoded)
      - name: "Trivy: Secret Scanning"
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          scan-ref: .
          scanners: secret
          exit-code: 1

      # Scan da imagem Docker
      - name: "Trivy: Scan da imagem Docker"
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: devsecops-lab-a2:${{ github.sha }}
          severity: HIGH,CRITICAL
          format: table

  # ============================================
  # Stage 5: Security Gate
  # ============================================
  security-gate:
    name: "🚨 Security Gate"
    runs-on: ubuntu-latest
    needs: security-scan
    steps:
      - name: Checkout do código
        uses: actions/checkout@v4

      - name: "Gate: Bloquear se CRITICAL encontrado"
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          scan-ref: .
          severity: CRITICAL
          exit-code: 1
          format: table

      - name: "✅ Pipeline aprovado"
        if: success()
        run: |
          echo "========================================="
          echo "  ✅ PIPELINE DEVSECOPS APROVADO"
          echo "  Todos os checks passaram:"
          echo "    ✓ Lint (ESLint)"
          echo "    ✓ Testes unitários (Jest)"
          echo "    ✓ Build Docker"
          echo "    ✓ Security Scan (Trivy)"
          echo "    ✓ Security Gate (sem CRITICAL)"
          echo "========================================="
```

> **Entendendo a pipeline:**
>
> | Stage | Ferramenta | O que faz | Bloqueia? |
> |-------|-----------|-----------|-----------|
> | Lint | ESLint | Erros de sintaxe, style, `no-eval` | ✅ Sim |
> | Test | Jest | Testes unitários + cobertura | ✅ Sim |
> | Build | Docker | Constrói imagem multi-stage | ✅ Sim |
> | Scan | Trivy | Busca CVEs (HIGH + CRITICAL) | ❌ Apenas reporta |
> | Gate | Trivy | Busca CRITICAL | ✅ **Bloqueia deploy** |
>
> O `needs:` garante a **sequência**: lint → test → build → scan → gate.
> Se qualquer stage falhar, os seguintes não executam.

---

### 8. Push e Observar a Pipeline

#### 8.1 Criar .gitignore

```bash
cat > .gitignore << 'EOF'
node_modules/
coverage/
*.tar
.env
EOF
```

#### 8.2 Commit e Push

```bash
git add .
git commit -m "feat: backend + docker + tests + lint + trivy pipeline"
git push origin main
```

#### 8.3 Observar no GitHub

**Opção A — Via navegador:**

1. Acesse seu repositório no GitHub
2. Clique na aba **Actions**
3. Observe o workflow **"DevSecOps Pipeline"** executando
4. Clique para ver cada stage em tempo real

**Opção B — Via GitHub CLI (sem sair do terminal):**

```bash
# Listar execuções recentes
gh run list

# Acompanhar a execução mais recente em tempo real
gh run watch

# Ver logs de uma execução específica
gh run view --log
```

> O `gh run watch` mostra o progresso de cada job com ✅ e ❌ diretamente no terminal — muito útil para acompanhar sem abrir o navegador.

#### ✅ Validação

Você deve ver os 5 stages executando sequencialmente:

```
🔍 ESLint - Análise Estática     ✅
🧪 Jest - Testes Unitários       ✅
🐳 Docker Build                  ✅
🛡️ Trivy - Security Scan         ✅
🚨 Security Gate                 ✅ ou ❌
```

> **Se o Security Gate falhar:** é porque o Trivy encontrou vulnerabilidades CRITICAL nas dependências. Isso é esperado e é o comportamento correto — a pipeline está fazendo seu trabalho!

---

### 9. Exercício: Provocar e Corrigir Falhas

Agora que a pipeline está funcionando, vamos provocar falhas intencionais para entender o comportamento de cada stage.

#### 9.1 Provocar falha no Lint

Edite `src/app.js` e adicione no final:

```javascript
// Código intencionalmente ruim
eval("console.log('inseguro')");
```

```bash
git add . && git commit -m "test: provocar falha no lint" && git push
```

**Resultado esperado:** ❌ Stage de Lint falha (`no-eval` rule). Testes e build NÃO executam.

**Corrigir:** remova a linha do `eval`, commit e push.

#### 9.2 Provocar falha nos testes

Edite `src/app.js`, na rota `/api/info`, mude `version` para `"2.0.0"`.

```bash
git add . && git commit -m "test: provocar falha nos testes" && git push
```

**Resultado esperado:** ❌ Lint passa, mas Jest falha (teste espera `"1.0.0"`).

**Corrigir:** reverta a versão ou atualize o teste.

#### 9.3 Observar findings do Trivy

Na aba Actions, clique no stage "Trivy - Security Scan" e expanda os logs. Você verá:

- CVEs encontrados nas dependências do Node.js
- CVEs na imagem base (`node:22-alpine`)
- Classificação por severidade (LOW, MEDIUM, HIGH, CRITICAL)

> **Reflexão para o Tech Lead:**
> - Quais dessas vulnerabilidades são realmente exploráveis no seu contexto?
> - O `express` que usamos tem CVE? Qual a versão corrigida?
> - Vale atualizar agora ou é risco aceitável?

---

### 10. Estrutura Final do Projeto

Ao final deste tutorial, seu repositório deve ter esta estrutura:

```
devsecops-lab-a2/
├── .github/
│   └── workflows/
│       └── devsecops.yml      ← Pipeline GitHub Actions
├── src/
│   ├── app.js                 ← Aplicação Express
│   └── server.js              ← Entrypoint HTTP
├── tests/
│   └── app.test.js            ← Testes unitários
├── .dockerignore              ← Exclusões do Docker
├── .gitignore                 ← Exclusões do Git
├── Dockerfile                 ← Build multi-stage
├── eslint.config.mjs          ← Configuração ESLint
├── package.json               ← Dependências e scripts
└── README.md
```

---

### Checklist Final

- [ ] Repositório criado no GitHub
- [ ] Backend Node.js funcionando localmente
- [ ] 5 testes passando (`npm test`)
- [ ] ESLint sem erros (`npm run lint`)
- [ ] Docker build funcional (`docker build .`)
- [ ] GitHub Actions executando os 5 stages
- [ ] Trivy reportando vulnerabilidades
- [ ] Security Gate bloqueando (ou passando) conforme política

---

### Troubleshooting

**Problema:** `npm ci` falha no GitHub Actions com "missing package-lock.json"

**Solução:** Rode `npm install` localmente e faça commit do `package-lock.json`. O `npm ci` exige esse arquivo.

**Problema:** Docker build falha com "COPY failed: file not found"

**Solução:** Verifique se os paths no Dockerfile correspondem à estrutura real do projeto (`src/app.js`, não `app.js`).

**Problema:** `gh auth login` pede token em vez de abrir o navegador

**Solução:** Escolha HTTPS durante o login. Se necessário, crie um Personal Access Token em github.com/settings/tokens e cole quando solicitado.

---

### Desafio Extra (Opcional)

Para quem terminou antes:

1. **Adicionar badge no README:** Cole este markdown no `README.md`:
   ```markdown
   ![DevSecOps Pipeline](https://github.com/SEU-USER/devsecops-lab-a2/actions/workflows/devsecops.yml/badge.svg)
   ```

2. **Criar branch protegida:** No GitHub → Settings → Branches → Add rule → Require status checks → Selecione os jobs da pipeline. Assim, nenhum PR pode ser mergeado sem todos os checks passando.

---

### Limpeza do Ambiente

```bash
# Remover containers locais
docker rm -f lab-a2 2>/dev/null

# Remover imagens locais
docker rmi devsecops-lab-a2:local 2>/dev/null

# O repositório no GitHub pode ser mantido para as próximas aulas
```

---

### Referências

1. **GitHub Actions Documentation** — https://docs.github.com/en/actions
2. **Trivy GitHub Action** — https://github.com/aquasecurity/trivy-action
3. **Jest Documentation** — https://jestjs.io/docs/getting-started
4. **ESLint Getting Started** — https://eslint.org/docs/latest/use/getting-started
5. **Docker Multi-stage Builds** — https://docs.docker.com/build/building/multi-stage/
6. **NVM (Node Version Manager)** — https://github.com/nvm-sh/nvm
7. **GitHub CLI (gh)** — https://cli.github.com/manual/
