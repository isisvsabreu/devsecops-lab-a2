# Lab A5 — Parte 2: Deploy Render + ZAP DAST

## DAST com OWASP ZAP Contra URL Pública

**Autor:** Victor Raffael Lins Carlota
**Disciplina:** DevSecOps — Aula 5: DAST e API Security com ZAP
**Pré-requisito:** Lab A5 Parte 1 concluída (backend com helmet + Kind CI/CD)

---

## RESUMO

Nesta prática, vamos:

1. **Deploy no Render.com** — app acessível via URL pública (free tier, sem cartão)
2. **ZAP Baseline Scan** — DAST automatizado no pipeline contra a URL do Render
3. **Interpretar e corrigir** — analisar relatório e melhorar a segurança da app

**Por que Render para DAST?** O ZAP no GitHub Actions precisa acessar a aplicação via rede. O Kind no runner só expõe localhost — o ZAP no CI/CD não consegue alcançar. O Render fornece URL pública gratuita. Em produção real, usaríamos K8s + Ingress + TLS.

---

## 1. Pré-Requisitos

- Lab A5 Parte 1 concluída (helmet, rate-limit, CORS)
- Conta no GitHub com Actions habilitado
- Repositório público (GHCR gratuito)

---

## 2. Criar Conta no Render

1. Acesse [render.com](https://render.com)
2. Clique **Get Started for Free**
3. Faça login com **GitHub** (recomendado — facilita o deploy)

> Render.com oferece free tier real: sem cartão de crédito, 750 horas/mês de compute, PostgreSQL gratuito por 90 dias.

---

## 3. Criar PostgreSQL no Render

O backend precisa de banco de dados.

1. No Dashboard: **New → PostgreSQL**
2. Configurações:
   - **Name:** `devsecops-db`
   - **Region:** Oregon (US West)
   - **PostgreSQL Version:** 16
   - **Instance Type:** **Free**
3. Clique **Create Database**
4. Aguarde criação (~1 min)
5. Na aba **Info**, anote as credenciais:

```
Hostname:  dpg-xxxxx-a.oregon-postgres.render.com
Port:      5432
Database:  devsecops_db
Username:  devsecops_db_user
Password:  (gerado automaticamente)
```

> Guarde esses valores — serão usados como variáveis de ambiente no Web Service.

---

## 4. Criar Web Service no Render

1. No Dashboard: **New → Web Service**
2. Conecte ao repositório `devsecops-lab-a2`
3. Configurações:
   - **Name:** `devsecops-lab`
   - **Region:** Oregon (mesmo do banco)
   - **Runtime:** Docker (Render detecta o Dockerfile)
   - **Instance Type:** **Free**
4. Em **Environment Variables**, adicione:

```
DB_HOST     = dpg-xxxxx-a.oregon-postgres.render.com  (hostname do banco)
DB_PORT     = 5432
DB_NAME     = devsecops_db                             (database name)
DB_USER     = devsecops_db_user                        (username)
DB_PASSWORD = (senha gerada pelo Render)
```

5. Clique **Create Web Service**

O Render vai:
- Clonar o repositório
- Buildar a imagem a partir do Dockerfile
- Iniciar o container
- Gerar URL: `https://devsecops-lab-xxxx.onrender.com`

### 4.1 Inicializar o banco automaticamente

O free tier do Render não disponibiliza a aba Shell. A solução é fazer a app inicializar o banco automaticamente ao iniciar, reutilizando o `init-db.js` que já existe.

**Passo 1 — Refatorar `src/init-db.js` para exportar a função:**

```javascript
const pool = require('./db');

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      text VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('Database initialized');
}

// Se executado diretamente: node src/init-db.js (Job K8s, CLI)
if (require.main === module) {
  initDB()
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}

// Se importado: require('./init-db') retorna a função
module.exports = initDB;
```

> **`require.main === module`** — este padrão permite que o arquivo funcione de duas formas:
> - Executado diretamente (`node src/init-db.js`) → roda e faz `process.exit()`
> - Importado por outro arquivo (`require('./init-db')`) → exporta a função sem sair

**Passo 2 — Editar `src/server.js` para importar e chamar:**

```javascript
const app = require('./app');
const initDB = require('./init-db');

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDB();
  } catch (err) {
    console.error('Database init failed:', err.message);
    // App sobe mesmo sem banco (health check funciona)
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
```

> **Sem duplicação:** a query SQL fica em um lugar só (`init-db.js`). O `server.js` importa e chama. O Job K8s continua usando `node src/init-db.js` diretamente.

**Passo 3 — Commit:**

```bash
git add src/init-db.js src/server.js
git commit -m "refactor: auto-init database on startup via init-db module"
```

### 4.2 Testar endpoints

```bash
export RENDER_URL=https://devsecops-lab-xxxx.onrender.com

curl $RENDER_URL/health
# Esperado: {"status":"ok","timestamp":"..."}

# Verificar headers de segurança
curl -I $RENDER_URL/health
# Esperado: X-Content-Type-Options, X-Frame-Options, etc.
# NÃO deve ter: X-Powered-By

# Testar endpoints de dados
curl -X POST $RENDER_URL/api/messages \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from Render!"}'

curl $RENDER_URL/api/messages
```

> **Cold start:** o free tier do Render "dorme" após 15 min de inatividade. O primeiro request demora ~30s. Isso é normal.

### ✅ Validação

Se `curl $RENDER_URL/health` retorna 200, o deploy está funcionando.

---

## 5. Configurar Deploy Hook

O Deploy Hook permite triggerar deploy via URL (sem UI):

1. Render Dashboard → seu Web Service → **Settings**
2. Seção **Deploy Hook** → copie a URL
3. No GitHub → repositório → **Settings → Secrets and variables → Actions**
4. Adicione dois secrets:

| Secret | Valor |
|--------|-------|
| `RENDER_DEPLOY_HOOK` | URL do deploy hook copiada |
| `RENDER_URL` | URL pública (ex: `https://devsecops-lab-xxxx.onrender.com`) |

---

## 6. Rodar ZAP Localmente (Opcional)

Antes de automatizar, teste o ZAP manualmente:

```bash
docker run -v $(pwd):/zap/wrk/:rw -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t $RENDER_URL
```

> **`-v $(pwd):/zap/wrk/:rw`** é obrigatório — o ZAP precisa de um diretório de trabalho para escrever arquivos temporários. Sem esse volume, o scan falha com `FileNotFoundError: /zap/wrk/zap.yaml`.

### 6.1 Entender como o ZAP Spider funciona

O ZAP Spider começa na URL fornecida e segue links para descobrir páginas. Como nossa app é uma **API REST** (JSON, sem HTML com links), o Spider encontra poucos endpoints sozinho.

A solução é **apontar o ZAP para `/health`** — um endpoint que retorna 200 com headers de segurança. Assim o ZAP analisa os headers reais da app em vez de páginas 404:

```bash
# Apontar para /health (retorna 200 com todos os headers de segurança)
docker run -v $(pwd):/zap/wrk/:rw -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t $RENDER_URL/health -j
```

> **`-j`** ativa o AJAX Spider, que descobre mais endpoints em APIs REST.
>
> **Por que `/health` e não `/`?** Expor uma rota raiz que lista endpoints é information disclosure — facilita o trabalho do atacante. O `/health` retorna status 200 sem revelar a estrutura da API.

### 6.2 Salvar relatório HTML

```bash
docker run -v $(pwd):/zap/wrk/:rw -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t $RENDER_URL/health -j -r report.html
# O arquivo report.html será criado no diretório atual
```

### 6.3 Interpretar o primeiro scan

Com o hardening aplicado (helmet completo + CORS restrito + 404 handler JSON), o resultado esperado é:

```
PASS: 63+ regras
WARN-NEW: 0-2 findings (dependendo da configuração)
FAIL-NEW: 0
```

Se o ZAP reportar findings em URLs 404 sem headers de segurança, significa que o 404 handler não foi deployado. Verifique que o push + deploy no Render completaram.

---

## 7. Criar Arquivo de Regras do ZAP

Crie `.zap-rules.tsv` na raiz do repositório. As regras são baseadas nos findings reais que o ZAP encontra na nossa API:

```tsv
10010	IGNORE	Cookie No HttpOnly Flag (API stateless, sem cookies de sessão)
10011	IGNORE	Cookie Without Secure Flag (API stateless)
10015	IGNORE	Re-examine Cache-control Directives
10049	WARN	Storable and Cacheable Content
10054	IGNORE	Cookie without SameSite Attribute (API REST)
10055	WARN	CSP Directive with No Fallback (frame-ancestors, form-action)
10063	WARN	Permissions Policy Header Not Set
10098	WARN	Cross-Domain Misconfiguration (CORS)
10202	IGNORE	Absence of Anti-CSRF Tokens (API REST, não usa formulários)
```

> **Formato:** `ID<TAB>ACTION<TAB>Descrição`
> - **IGNORE** = não reporta (falso positivo para API REST stateless sem cookies)
> - **WARN** = reporta mas não bloqueia — itens que pretendemos corrigir
> - **FAIL** = bloqueia o pipeline (promover gradualmente)
>
> **Estratégia:** começar com WARN. Após corrigir os findings no código, promover para FAIL para garantir que não regridam.

```bash
git add .zap-rules.tsv
git commit -m "config: add ZAP rules based on real findings"
```

---

## 8. Adicionar Permissão de Issues ao Workflow

A action do ZAP cria automaticamente uma **Issue** no repositório com os findings. Para isso, o workflow precisa de permissão de escrita em issues.

Edite `.github/workflows/devsecops.yml`. Na seção `permissions` (no topo do arquivo), adicione `issues: write`:

```yaml
permissions:
  contents: read
  packages: write
  issues: write              # ZAP cria issue com findings
```

> **Verificação:** confirme que o repositório tem **Settings → Actions → General → Workflow permissions → Read and write permissions** marcado (já configurado na A4 Parte 3 para o GHCR).

---

## 9. Adicionar Jobs de Deploy Render + DAST ao Workflow

Edite `.github/workflows/devsecops.yml`. Adicione os jobs `deploy-render` e `dast` **após** o job `deploy-k8s`:

```yaml
  # ============================================
  # Stage 8: Deploy Render (PaaS)
  # ============================================
  deploy-render:
    name: "🚀 Deploy Render"
    runs-on: ubuntu-latest
    needs: security-gate
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - name: Trigger Render deploy
        run: |
          HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
            -X POST "${{ secrets.RENDER_DEPLOY_HOOK }}")
          echo "Deploy hook response: $HTTP_STATUS"

      - name: Aguardar deploy + health check
        run: |
          echo "Aguardando 90s para Render deployar..."
          sleep 90
          for i in $(seq 1 5); do
            STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
              "${{ secrets.RENDER_URL }}/health")
            if [ "$STATUS" = "200" ]; then
              echo "✅ Health check passed (attempt $i)"
              exit 0
            fi
            echo "Attempt $i: status $STATUS, retrying in 15s..."
            sleep 15
          done
          echo "❌ Health check failed after 5 attempts"
          exit 1

  # ============================================
  # Stage 9: DAST (OWASP ZAP Baseline)
  # ============================================
  dast:
    name: "🔍 ZAP Baseline Scan"
    runs-on: ubuntu-latest
    needs: deploy-render
    steps:
      - name: Checkout (para .zap-rules.tsv)
        uses: actions/checkout@v4

      - name: ZAP Baseline Scan
        uses: zaproxy/action-baseline@v0.14.0
        with:
          target: ${{ secrets.RENDER_URL }}/health
          rules_file_name: .zap-rules.tsv
          cmd_options: '-j'
          fail_action: false             # true = bloqueia, false = reporta sem bloquear
          artifact_name: zap-report

      - name: Upload ZAP Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: zap-baseline-report
          path: report_html.html
          retention-days: 30
```

> **Notas importantes:**
> - `needs: security-gate` — deploy só acontece se scan passou
> - `if: github.ref == 'refs/heads/main'` — só na main (não em PRs)
> - `sleep 90` — aguarda cold start do Render + rebuild
> - Health check com retry (5 tentativas, 15s entre cada)
> - `fail_action: false` — reporta findings sem bloquear o pipeline (`true` = bloqueia)
> - `if: always()` — salva relatório mesmo se scan encontrar problemas

---

## 10. Commit e Push

```bash
git add .github/workflows/devsecops.yml .zap-rules.tsv
git commit -m "feat: add Render deploy + ZAP DAST to pipeline"
git push
```

---

## 11. Acompanhar Execução

```bash
gh run watch
```

Ou acesse **Actions** no GitHub. O pipeline agora tem **9 stages**:

```
🔍 ESLint                    ✅
🔎 Semgrep SAST              ✅
🧪 Jest Testes               ✅
🐳 Docker Build + Push       ✅
🛡️ Trivy Security Scan      ✅
🚨 Security Gate             ✅
🚀 Deploy K8s (Kind)         ✅  ← Parte 1
🚀 Deploy Render             ✅  ← Parte 2
🔍 ZAP Baseline Scan         ✅  ← DAST
```

> Os jobs `deploy-k8s` e `deploy-render` podem rodar em paralelo (ambos dependem do `security-gate`).

---

## 12. Baixar e Interpretar Relatório ZAP

### 11.1 Baixar

1. Na aba **Actions** → clique na execução mais recente
2. Role até **Artifacts**
3. Baixe `zap-baseline-report`
4. Abra `report_html.html` no navegador

### 11.2 Interpretar findings

O ZAP classifica por risco:

| Risco | Significado | Ação |
|-------|-------------|------|
| **HIGH** | Vulnerabilidade explorável | Corrigir AGORA |
| **MEDIUM** | Problema de segurança | Corrigir no próximo sprint |
| **LOW** | Boa prática ausente | Planejar correção |
| **Informational** | Observação | Avaliar relevância |

### 11.3 Findings reais e como resolver

Com o hardening da Parte 1 (helmet completo + CORS restrito + 404 handler), o relatório melhora significativamente:

| Finding (ID) | Sev. | Sem hardening | Com hardening |
|-------------|------|---------------|---------------|
| X-Content-Type-Options (10021) | Med | ❌ Missing | ✅ Resolvido (helmet) |
| X-Frame-Options (10020) | Med | ❌ Missing | ✅ Resolvido (helmet) |
| X-Powered-By (10037) | Low | ❌ "Express" | ✅ Resolvido (disable) |
| CSP missing directives (10055) | Med | ❌ No CSP | ✅ Resolvido (frameAncestors, formAction) |
| Cross-Domain CORS (10098) | Med | ❌ origin: * | ✅ Resolvido (origin restrito) |
| Permissions Policy (10063) | Low | ❌ Missing | ✅ Resolvido (permissionsPolicy no helmet) |
| Storable Content (10049) | Info | ⚠️ Pode aparecer | Adicionar `Cache-Control: no-store` se necessário |
| Cookie flags (10010/10011) | Low | ℹ️ API stateless | IGNORE no .zap-rules.tsv |
| Anti-CSRF Tokens (10202) | Info | ℹ️ API REST | IGNORE no .zap-rules.tsv |

> **Objetivo:** com o hardening aplicado, o scan deve retornar **0 FAIL, 0-1 WARN, 63+ PASS**.

---

## 13. Corrigir Findings Restantes (se houver)

Se o ZAP ainda reportar "Storable and Cacheable Content", adicione header de cache nas respostas JSON:

```javascript
// No app.js, após os middlewares de segurança:
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
```

```bash
git add . && git commit -m "security: add Cache-Control no-store" && git push
```

O pipeline roda → deploy → ZAP → comparar relatório antes/depois.

---

## 14. Troubleshooting

**Problema:** `Warning: 'fail_action' should be either 'true' or 'false'`
**Solução:** A action `zaproxy/action-baseline` aceita apenas `true` ou `false`. Use `fail_action: false` (não bloqueia) ou `fail_action: true` (bloqueia se houver findings).

**Problema:** `Error: Resource not accessible by integration` (403 ao criar Issue)
**Solução:** A action do ZAP tenta criar uma Issue com os findings. Verifique:
1. O workflow tem `permissions: issues: write`
2. O repositório tem **Settings → Actions → General → Workflow permissions → Read and write permissions**

**Problema:** `Job spider error accessing URL ... status code returned: 404 expected 200`
**Solução:** O target do ZAP aponta para uma URL que retorna 404. Use `${{ secrets.RENDER_URL }}/health` (retorna 200).

**Problema:** Deploy hook retorna 403/404
**Solução:** Verifique se o secret `RENDER_DEPLOY_HOOK` tem a URL completa (começando com `https://api.render.com/deploy/...`).

**Problema:** Health check falha após deploy
**Solução:** O free tier do Render tem cold start de ~30-60s. Aumente o `sleep` para 120s ou adicione mais retries.

**Problema:** Muitos findings WARN no relatório
**Solução:** Adicione IDs ao `.zap-rules.tsv` com `IGNORE` para falsos positivos confirmados.

---

## Estrutura do Projeto (Final A5)

```
devsecops-lab-a2/
├── .github/workflows/devsecops.yml   ← 9 stages (CI + CD + DAST)
├── .zap-rules.tsv                     ← regras do ZAP (NOVO)
├── k8s/                               ← manifests K8s = IaC (A4)
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── postgres-deployment.yaml
│   ├── postgres-service.yaml
│   ├── init-db-job.yaml
│   ├── app-deployment.yaml
│   ├── app-service.yaml
│   └── network-policy.yaml
├── src/
│   ├── app.js                         ← com helmet + rateLimit + cors
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

## Pipeline Completo — 9 Stages

```
┌─────────┐   ┌──────────┐   ┌──────────┐   ┌────────────┐
│  lint    │──►│ semgrep  │──►│  test    │──►│ build+push │
│(ESLint)  │   │ (SAST)   │   │ (Jest)   │   │  (GHCR)    │
└─────────┘   └──────────┘   └──────────┘   └─────┬──────┘
                                                    │
                                                    ▼
                                            ┌─────────────┐
                                            │ scan (Trivy) │
                                            │SCA+secrets   │
                                            │+image        │
                                            └──────┬──────┘
                                                    │
                                                    ▼
                                            ┌─────────────┐
                                            │ gate         │
                                            │exit-code 1   │
                                            └──────┬──────┘
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
| CI → CD | Pipeline evoluiu de CI puro para deploy automatizado |
| IaC | K8s manifests no Git, aplicados automaticamente |
| DAST | ZAP baseline scan contra app rodando |
| API Security | helmet + rate-limit + CORS + .zap-rules.tsv |
| Defense in Depth | 7 camadas: lint + SAST + SCA + secrets + image + IaC + DAST |
| Registry handoff | Imagem no GHCR consumida pelo Kind e Render |
| Kind vs Cloud | Kind para K8s CD no CI, Render para URL pública + DAST |

---

## Referências

1. **OWASP ZAP** — https://zaproxy.org
2. **ZAP Baseline Action** — https://github.com/zaproxy/action-baseline
3. **helmet.js** — https://helmetjs.github.io
4. **express-rate-limit** — https://github.com/express-rate-limit/express-rate-limit
5. **Kind GitHub Action** — https://github.com/helm/kind-action
6. **Render.com Docs** — https://docs.render.com