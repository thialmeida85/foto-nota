import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { addLog } from './logger.js';
import { getNextPendente, updateStatus } from './notasRepository.js';
import { cleanKey, maskKey } from '../utils/mask.js';

const storageDir = path.resolve('.playwright-storage');
const storageStatePath = path.join(storageDir, 'notabe-state.json');
const notabeUrl = process.env.NOTABE_URL || 'https://asin.notabe.com/notes/new';

class AutomationRunner {
  constructor() {
    this.running = false;
    this.paused = false;
    this.stopping = false;
    this.browser = null;
    this.context = null;
  }

  getState() {
    return {
      running: this.running,
      paused: this.paused,
      stopping: this.stopping
    };
  }

  start() {
    if (this.running) {
      this.paused = false;
      addLog('Automacao retomada');
      return;
    }

    this.running = true;
    this.paused = false;
    this.stopping = false;
    addLog('Automacao iniciada');
    this.loop().catch((error) => {
      addLog(`Automacao encerrada por erro: ${error.message}`);
      this.running = false;
      this.cleanup().catch(() => {});
    });
  }

  pause(reason = 'Automacao pausada') {
    this.paused = true;
    addLog(reason);
  }

  async stop() {
    this.stopping = true;
    this.paused = false;
    addLog('Parando automacao');
    await this.cleanup();
    this.running = false;
    this.stopping = false;
    addLog('Automacao parada');
  }

  async sendNextOnce() {
    if (this.running) {
      const error = new Error('A automacao continua esta em execucao. Pause ou pare antes de enviar uma unica nota.');
      error.status = 409;
      throw error;
    }

    this.running = true;
    try {
      return await this.processNext();
    } finally {
      this.running = false;
      await this.cleanup();
    }
  }

  async loop() {
    while (!this.stopping) {
      if (this.paused) {
        await wait(1200);
        continue;
      }

      const result = await this.processNext();
      if (result === 'empty') {
        this.pause('Sem notas pendentes');
      }

      await wait(800);
    }
  }

  async processNext() {
    const nota = await getNextPendente();
    if (!nota) return 'empty';

    const chaveLimpa = cleanKey(nota.chave_nfe);
    addLog(`Enviando chave ${maskKey(chaveLimpa)}`);
    await updateStatus(nota.id, {
      status: 'processando',
      mensagem_erro: null,
      incrementTentativas: true
    });

    try {
      const page = await this.getPage();
      await page.goto(notabeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      await this.ensureLoggedIn(page);
      await this.guardAgainstManualBlocks(page);

      const input = await this.findPrimaryInput(page);
      if (!input) throw new Error('Campo de entrada nao encontrado.');

      await input.fill(chaveLimpa);
      await input.dispatchEvent('input');
      await input.dispatchEvent('change');
      await input.press('End');

      const button = await this.findSendButton(page);
      if (!button) throw new Error('Botao Envia nao encontrado.');

      await Promise.allSettled([
        page.waitForLoadState('networkidle', { timeout: 20000 }),
        button.click()
      ]);

      await page.waitForTimeout(2500);
      await this.guardAgainstManualBlocks(page);

      const result = await this.detectResult(page);
      if (result.status === 'erro') {
        await updateStatus(nota.id, {
          status: 'erro',
          mensagem_erro: result.message,
          sent_at: null
        });
        addLog(`Resultado ${maskKey(chaveLimpa)}: ${result.message}`);
        return 'error';
      }

      await updateStatus(nota.id, {
        status: 'enviada',
        mensagem_erro: null,
        sent_at: new Date().toISOString()
      });
      addLog(`Resultado ${maskKey(chaveLimpa)}: enviada`);
      return 'sent';
    } catch (error) {
      await updateStatus(nota.id, {
        status: 'erro',
        mensagem_erro: error.message,
        sent_at: null
      });
      addLog(`Erro ao enviar ${maskKey(chaveLimpa)}: ${error.message}`);
      return 'error';
    }
  }

  async getPage() {
    if (!this.browser) {
      const headless = process.env.NODE_ENV === 'production'
        ? true
        : process.env.PLAYWRIGHT_HEADLESS !== 'false';

      addLog('Abrindo NotaBe');
      this.browser = await chromium.launch({
        headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });

      fs.mkdirSync(storageDir, { recursive: true });
      const contextOptions = fs.existsSync(storageStatePath)
        ? { storageState: storageStatePath }
        : {};
      this.context = await this.browser.newContext(contextOptions);
    }

    const pages = this.context.pages();
    return pages[0] || this.context.newPage();
  }

  async cleanup() {
    if (this.context) {
      try {
        fs.mkdirSync(storageDir, { recursive: true });
        await this.context.storageState({ path: storageStatePath });
      } catch (error) {
        addLog(`Nao foi possivel salvar sessao: ${error.message}`);
      }
    }

    if (this.browser) {
      await this.browser.close().catch(() => {});
    }

    this.browser = null;
    this.context = null;
  }

  async guardAgainstManualBlocks(page) {
    const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const lowered = text.toLowerCase();

    if (lowered.includes('captcha') || lowered.includes('recaptcha')) {
      this.pause('Captcha detectado. Resolva manualmente; a automacao nao burla captcha.');
      throw new Error('Captcha detectado.');
    }

    if (lowered.includes('login') || lowered.includes('senha') || lowered.includes('entrar')) {
      this.pause('Faca login no navegador da automacao.');
      throw new Error('Sessao expirada ou login necessario.');
    }
  }

  async ensureLoggedIn(page) {
    if (!await this.looksLikeLoginPage(page)) return;

    const username = process.env.NOTABE_USERNAME;
    const password = process.env.NOTABE_PASSWORD;

    if (!username || !password) {
      this.pause('Login necessario. Configure NOTABE_USERNAME e NOTABE_PASSWORD no backend.');
      throw new Error('Sessao expirada ou login necessario.');
    }

    addLog('Login NotaBe necessario. Tentando autenticar com credenciais configuradas.');

    const usernameInput = await this.findLoginInput(page);
    const passwordInput = await this.findPasswordInput(page);

    if (!usernameInput || !passwordInput) {
      this.pause('Tela de login detectada, mas campos de usuario/senha nao foram encontrados.');
      throw new Error('Campos de login do NotaBe nao encontrados.');
    }

    await usernameInput.fill(username);
    await passwordInput.fill(password);
    await usernameInput.dispatchEvent('input');
    await passwordInput.dispatchEvent('input');
    await usernameInput.dispatchEvent('change');
    await passwordInput.dispatchEvent('change');

    const loginButton = await this.findLoginButton(page);
    if (!loginButton) {
      this.pause('Tela de login detectada, mas botao Entrar/Login nao foi encontrado.');
      throw new Error('Botao de login do NotaBe nao encontrado.');
    }

    await Promise.allSettled([
      page.waitForLoadState('networkidle', { timeout: 20000 }),
      loginButton.click()
    ]);

    await page.waitForTimeout(2500);

    if (await this.hasCaptcha(page)) {
      this.pause('Captcha detectado no login. A automacao nao burla captcha.');
      throw new Error('Captcha detectado no login.');
    }

    if (await this.looksLikeLoginPage(page)) {
      this.pause('Login NotaBe nao concluido. Confira usuario, senha ou verificacao manual.');
      throw new Error('Login NotaBe nao concluido.');
    }

    await page.goto(notabeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    addLog('Login NotaBe concluido.');
  }

  async looksLikeLoginPage(page) {
    const passwordCount = await page.locator('input[type="password"]:visible').count().catch(() => 0);
    if (passwordCount > 0) return true;

    const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const lowered = text.toLowerCase();
    return lowered.includes('senha') && (lowered.includes('entrar') || lowered.includes('login'));
  }

  async hasCaptcha(page) {
    const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const lowered = text.toLowerCase();
    return lowered.includes('captcha') || lowered.includes('recaptcha');
  }

  async findLoginInput(page) {
    const locators = [
      page.locator('input[type="email"]:visible').first(),
      page.locator('input[name*="email" i]:visible').first(),
      page.locator('input[name*="user" i]:visible').first(),
      page.locator('input[name*="login" i]:visible').first(),
      page.locator('input[autocomplete="username"]:visible').first(),
      page.locator('input[type="text"]:visible').first(),
      page.locator('input:not([type="password"]):visible').first()
    ];

    return firstExistingLocator(locators);
  }

  async findPasswordInput(page) {
    return firstExistingLocator([
      page.locator('input[type="password"]:visible').first(),
      page.locator('input[name*="senha" i]:visible').first(),
      page.locator('input[name*="password" i]:visible').first()
    ]);
  }

  async findLoginButton(page) {
    return firstExistingLocator([
      page.getByRole('button', { name: /entrar|login|acessar|continuar/i }).first(),
      page.locator('button:has-text("Entrar"), button:has-text("Login"), button:has-text("Acessar"), input[type="submit"]').first()
    ]);
  }

  async findPrimaryInput(page) {
    const locators = [
      page.locator('input[type="text"]:visible').first(),
      page.locator('input:visible').first(),
      page.locator('textarea:visible').first()
    ];

    for (const locator of locators) {
      if (await locator.count().catch(() => 0)) return locator;
    }

    return page.evaluateHandle(() => {
      const fields = [...document.querySelectorAll('input, textarea')]
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        })
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
      return fields[0] || null;
    }).then((handle) => handle.asElement()).catch(() => null);
  }

  async findSendButton(page) {
    const byRole = page.getByRole('button', { name: /envia/i }).first();
    if (await byRole.count().catch(() => 0)) return byRole;

    const byText = page.locator('button:has-text("Envia"), input[type="submit"], [role="button"]:has-text("Envia")').first();
    if (await byText.count().catch(() => 0)) return byText;

    return null;
  }

  async detectResult(page) {
    const body = await page.locator('body').innerText({ timeout: 8000 }).catch(() => '');
    const lowered = body.toLowerCase();

    if (lowered.includes('erro na leitura')) {
      return { status: 'erro', message: 'Erro na Leitura' };
    }

    if (lowered.includes('erro')) {
      const line = body.split('\n').find((item) => item.toLowerCase().includes('erro'));
      return { status: 'erro', message: line?.slice(0, 180) || 'Site retornou erro.' };
    }

    return { status: 'enviada', message: 'Enviada' };
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function firstExistingLocator(locators) {
  for (const locator of locators) {
    if (await locator.count().catch(() => 0)) return locator;
  }

  return null;
}

export const automationRunner = new AutomationRunner();
