# Lab A4 — Parte 1: Docker Compose

## Backend + PostgreSQL com Docker Compose

**Autor:** Victor Raffael Lins Carlota

## RESUMO

Nesta prática, vamos evoluir o backend da A2 para conectar a um banco de dados PostgreSQL, orquestrado com Docker Compose. Ao final, você terá:

- Backend Express com endpoints que lêem/escrevem no banco
- PostgreSQL rodando como container separado
- Docker Compose orquestrando ambos com networking automático
- Dados persistentes via volumes

---

## 1. Pré-Requisitos

- Docker instalado e rodando (`docker --version`)
- Repositório `devsecops-lab-a2` clonado e funcional
- Node.js 22 via NVM (`node --version`)

```bash
cd devsecops-lab-a2
```

---

## 2. Evoluir o Backend

### 2.1 Instalar dependência do PostgreSQL

```bash
npm install pg
```

> **pg** é o driver PostgreSQL para Node.js. Permite conectar, consultar e manipular o banco.

### 2.2 Criar módulo de conexão com o banco

Crie o arquivo `src/db.js`:

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'devsecops',
  user: process.env.DB_USER || 'app',
  password: process.env.DB_PASSWORD || 'secret',
});

module.exports = pool;
```

> **Por que variáveis de ambiente?** Para não hardcodar credenciais no código. No Compose, passamos via `environment`. No K8s, via ConfigMap e Secret.

### 2.3 Criar script de inicialização do banco

Crie o arquivo `src/init-db.js`:

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

initDB()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
```

> Este script cria a tabela `messages` se não existir. Será usado como **Job** no Kubernetes (Parte 2).

### 2.4 Adicionar endpoints de banco ao app

Edite o arquivo `src/app.js` e adicione **após** a linha `app.use(express.json());` o import do banco, e **após** os endpoints existentes os novos:

```javascript
const pool = require('./db');
```

Adicione os novos endpoints **após** o endpoint `POST /api/validate`:

```javascript
// Listar mensagens
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM messages ORDER BY created_at DESC LIMIT 20'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error', detail: err.message });
  }
});

// Criar mensagem
app.post('/api/messages', async (req, res) => {
  const { text } = req.body;
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'Text is required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO messages (text) VALUES ($1) RETURNING *',
      [text.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error', detail: err.message });
  }
});
```

> **Segurança:** usamos `$1` (parameterized query) em vez de template string. Isso previne SQL injection — conceito que vimos com Semgrep no SAST.

### 2.5 Adicionar script no package.json

Adicione `"init-db"` na seção `scripts` do `package.json`:

```json
{
  "scripts": {
    "start": "node src/server.js",
    "test": "jest --verbose --coverage",
    "lint": "eslint src/ tests/",
    "init-db": "node src/init-db.js"
  }
}
```

### 2.6 Atualizar o Dockerfile

O Dockerfile precisa incluir o novo `src/db.js` e `src/init-db.js`. Como já copiamos `src/` inteiro, não precisa mudar o Dockerfile. Mas precisamos incluir `pg` nas dependências de produção.

Verifique que `pg` está em `dependencies` (não `devDependencies`) no `package.json`:

```bash
cat package.json | grep -A5 '"dependencies"'
# Deve mostrar: "express" e "pg"
```

---

## 3. Criar o Docker Compose

### 3.1 Criar docker-compose.yml

Crie o arquivo na raiz do projeto:

```yaml
services:

  # ================================================
  # Backend Express (nossa aplicação)
  # ================================================
  app:
    build: .                              # Constrói imagem a partir do Dockerfile local
    ports:
      - "3000:3000"                       # Mapeia porta 3000 do host para 3000 do container
    environment:                          # Variáveis de ambiente passadas para o container
      DB_HOST: postgres                   # Nome do service = hostname DNS automático
      DB_PORT: 5432                       # Porta padrão do PostgreSQL
      DB_NAME: devsecops                  # Nome do banco (criado pelo postgres automaticamente)
      DB_USER: app                        # Usuário do banco
      DB_PASSWORD: secret                 # Senha (em prod: usar secrets manager)
    depends_on:                           # Ordem de inicialização
      postgres:
        condition: service_healthy        # Só inicia app quando postgres estiver saudável
    restart: unless-stopped               # Reinicia se crashar (exceto stop manual)

  # ================================================
  # Banco de dados PostgreSQL
  # ================================================
  postgres:
    image: postgres:16-alpine             # Imagem oficial do Docker Hub (alpine = leve)
    environment:
      POSTGRES_DB: devsecops              # Cria este banco no primeiro start
      POSTGRES_USER: app                  # Cria este usuário
      POSTGRES_PASSWORD: secret           # Define a senha
    ports:
      - "5432:5432"                       # Expõe para ferramentas locais (DBeaver, psql)
    volumes:
      - pgdata:/var/lib/postgresql/data   # Dados persistem entre docker compose down/up
    healthcheck:                          # Verifica se o banco está pronto para conexões
      test: ["CMD-SHELL", "pg_isready -U app -d devsecops"]
      interval: 5s                        # Verifica a cada 5 segundos
      timeout: 3s                         # Timeout de cada verificação
      retries: 5                          # Marca como unhealthy após 5 falhas

# ================================================
# Volumes nomeados (gerenciados pelo Docker)
# ================================================
volumes:
  pgdata:                                 # Persiste dados do PostgreSQL no host
```

### 3.2 Subir o ambiente

```bash
# Subir tudo em background, rebuildando a imagem da app
docker compose up -d --build
```

Acompanhe o status:

```bash
# Verificar containers
docker compose ps
# Esperado:
# NAME       SERVICE    STATUS
# ...-app    app        running
# ...-postgres postgres running (healthy)

# Acompanhar logs da app
docker compose logs -f app
# Esperado: "Server running on port 3000"
```

### 3.3 Inicializar o banco

```bash
# Executar o script de criação da tabela dentro do container da app
docker compose exec app node src/init-db.js
# Esperado: "Database initialized"
```

### 3.4 Testar os endpoints

```bash
# Health check (já existia na A2)
curl http://localhost:3000/health
# Esperado: {"status":"ok","timestamp":"..."}

# Info (já existia na A2)
curl http://localhost:3000/api/info
# Esperado: {"app":"devsecops-lab-a2","version":"1.0.0",...}

# Criar uma mensagem (NOVO)
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{"text": "Primeira mensagem via Compose!"}'
# Esperado: {"id":1,"text":"Primeira mensagem via Compose!","created_at":"..."}

# Listar mensagens (NOVO)
curl http://localhost:3000/api/messages
# Esperado: [{"id":1,"text":"Primeira mensagem via Compose!",...}]

# Criar mais mensagens
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -d '{"text": "Segunda mensagem"}'
```

### ✅ Validação

Se todos os curls retornaram sucesso, Docker Compose está orquestrando backend + PostgreSQL.

---

## 4. Explorar o Compose

### 4.1 Testar persistência de dados

```bash
# Derrubar tudo (containers e rede, mas NÃO o volume)
docker compose down

# Subir novamente
docker compose up -d

# Inicializar tabela (idempotente — IF NOT EXISTS)
docker compose exec app node src/init-db.js

# Verificar se as mensagens ainda estão lá
curl http://localhost:3000/api/messages
# Esperado: mensagens anteriores ainda presentes (volume persistiu!)
```

### 4.2 Acessar o banco diretamente

```bash
# Abrir psql dentro do container
docker compose exec postgres psql -U app -d devsecops

# Dentro do psql:
SELECT * FROM messages;
\dt
```

### 4.3 Comandos úteis do Compose

```bash
# Ver logs combinados de todos os services
docker compose logs -f

# Ver status dos containers
docker compose ps

# Rebuildar apenas a app (após mudar código)
docker compose up -d --build app

# Parar sem remover
docker compose stop

# Remover TUDO incluindo volumes (dados do banco)
docker compose down -v
```

---

## 5. Limpeza

```bash
# Parar e remover containers + rede (mantém volume com dados)
docker compose down

# Para limpar TUDO (incluindo dados do banco):
# docker compose down -v
```

---

## 6. Commit

```bash
git add .
git commit -m "feat: add PostgreSQL + Docker Compose"
git push
```

---

## Estrutura do Projeto (atualizada)

```
devsecops-lab-a2/
├── .github/workflows/devsecops.yml
├── src/
│   ├── app.js              ← agora com endpoints /api/messages
│   ├── db.js               ← conexão PostgreSQL via Pool (NOVO)
│   ├── init-db.js           ← script de criação de tabela (NOVO)
│   └── server.js
├── tests/
│   └── app.test.js
├── docker-compose.yml        ← orquestra app + postgres (NOVO)
├── Dockerfile
├── eslint.config.mjs
├── package.json
└── README.md
```

---

## Próximo Passo

Na **Parte 2**, migraremos esta mesma aplicação para Kubernetes com Kind, usando:
- **ConfigMap** para configuração do banco (host, port, name)
- **Secret** para credenciais (user, password)
- **Deployment** para app e postgres
- **Service** para networking entre pods
- **Job** para inicialização do banco