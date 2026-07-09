# Leitor e Enviador de Notas

MVP web para capturar chaves de notas fiscais pelo celular usando OCR no navegador e enviar notas pendentes ao NotaBe pelo backend com Playwright.

## Estrutura

- `frontend`: React + Vite, dashboard responsivo com abas Capturar notas e Enviar notas.
- `backend`: Node.js + Express, API REST, SSE para logs e automacao Playwright.
- `database`: SQL para Neon PostgreSQL.
- `render.yaml`: Blueprint para backend e frontend no Render.

## 1. Criar banco no Neon

1. Crie um projeto em https://neon.tech.
2. Copie a connection string PostgreSQL do banco.
3. No SQL Editor do Neon, rode o conteudo de `database/schema.sql`.

## 2. Configurar variaveis

Backend:

```bash
cp backend/.env.example backend/.env
```

Preencha:

```bash
DATABASE_URL=postgresql://...
PORT=3000
NODE_ENV=development
NOTABE_URL=https://asin.notabe.com/notes/new
```

Frontend:

```bash
cp frontend/.env.example frontend/.env
```

Preencha:

```bash
VITE_API_URL=http://localhost:3000
```

## 3. Rodar localmente

Backend:

```bash
cd backend
npm install
npx playwright install chromium
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Abra o frontend no endereco mostrado pelo Vite.

## 4. Deploy no Render

Este projeto usa dois servicos:

- Backend: Web Service Node.
- Frontend: Static Site.

O banco fica no Neon, entao `DATABASE_URL` deve ser cadastrado como segredo no servico backend.

### Backend no Render

Configuracao sugerida:

- Root Directory: `backend`
- Build Command: `npm install && npx playwright install chromium`
- Start Command: `npm start`
- Environment:
  - `DATABASE_URL`: connection string do Neon
  - `NODE_ENV`: `production`
  - `NOTABE_URL`: `https://asin.notabe.com/notes/new`
  - `PLAYWRIGHT_BROWSERS_PATH`: `0`

O backend escuta `0.0.0.0:$PORT`, como o Render espera.

### Frontend no Render

Configuracao sugerida:

- Root Directory: `frontend`
- Build Command: `npm install && npm run build`
- Publish Directory: `dist`
- Environment:
  - `VITE_API_URL`: URL publica do backend no Render

Tambem ha um `render.yaml` para usar como Blueprint. Antes de aplicar no Render, faca commit e push para GitHub/GitLab/Bitbucket.

## 5. Instalar Playwright no Render

O comando de build do backend ja inclui:

```bash
npx playwright install chromium
```

No ambiente Node nativo do Render, `npx playwright install --with-deps chromium` pode falhar porque tenta instalar pacotes de sistema com permissao de root. Se o Chromium reclamar de bibliotecas ausentes em runtime, migre o backend para Docker usando uma imagem base oficial do Playwright.

Use tambem:

```bash
PLAYWRIGHT_BROWSERS_PATH=0
```

Em producao o Chromium roda headless com:

```js
{
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
}
```

## 6. Usar no celular

1. Abra o dashboard.
2. Entre em `Capturar notas`.
3. Toque no seletor de imagem/camera.
4. Tire a foto do cupom.
5. Toque em `Ler nota`.
6. Confira ou edite a chave encontrada.
7. Toque em `Salvar nota`.

O OCR roda no navegador com Tesseract.js. A imagem nao precisa ir para o backend.

## 7. Usar no Chromebook/computador

1. Abra o dashboard.
2. Entre em `Enviar notas`.
3. Confira contadores e ultimas notas.
4. Clique em `Iniciar automacao`.
5. Acompanhe os logs em tempo real.

Voce tambem pode pausar, parar, enviar apenas a proxima nota ou reprocessar erros.

## 8. Login, captcha e limites do NotaBe

O sistema nao burla login, captcha ou seguranca do NotaBe.

Se o NotaBe exigir login ou captcha, a automacao pausa e registra o motivo nos logs. Para login manual, rode localmente com:

```bash
PLAYWRIGHT_HEADLESS=false npm run dev
```

Depois de autenticar, a automacao tenta salvar cookies em `backend/.playwright-storage/notabe-state.json`. No Render, armazenamento local pode ser temporario, entao a sessao pode expirar entre deploys/restarts.

## 9. Limitacoes conhecidas

- O seletor do campo do NotaBe e inferido por heuristicas porque o HTML real pode mudar.
- OCR em imagens ruins pode falhar; a edicao manual da chave existe para cobrir esse caso.
- CFe-SAT sem 44 digitos exige confirmacao manual.
- Render pode reiniciar servicos gratuitos, perdendo arquivos locais de sessao.
- A deteccao de sucesso no NotaBe e heuristica; se o site mudar textos, ajuste `backend/src/services/automationRunner.js`.
