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
      await this.resolveCnpjStep(page);
      await this.navigateToSubmissionPage(page);

      const input = await this.findFiscalKeyInput(page);
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

      if (result.status !== 'enviada') {
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

    if (await this.looksLikeLoginPage(page) || lowered.includes('login necessario') || lowered.includes('login necessário')) {
      this.pause('Faca login no navegador da automacao.');
      throw new Error('Sessao expirada ou login necessario.');
    }
  }

  async ensureLoggedIn(page) {
    await this.openLoginEntryPointIfNeeded(page);

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

  async openLoginEntryPointIfNeeded(page) {
    if (await this.looksLikeLoginPage(page)) return;

    const entryPoint = await this.findLoginEntryPoint(page);
    if (!entryPoint) return;

    const username = process.env.NOTABE_USERNAME;
    const password = process.env.NOTABE_PASSWORD;

    if (!username || !password) {
      this.pause('Login necessario. Configure NOTABE_USERNAME e NOTABE_PASSWORD no backend.');
      throw new Error('Sessao expirada ou login necessario.');
    }

    addLog('Home do NotaBe sem login. Clicando em Entrar.');
    await Promise.allSettled([
      page.waitForLoadState('networkidle', { timeout: 15000 }),
      entryPoint.click()
    ]);
    await page.waitForTimeout(1200);
  }

  async navigateToSubmissionPage(page) {
    addLog('Verificando tela de envio do NotaBe');

    if (await this.isSubmissionPageReady(page)) return;

    const steps = [
      /nova nota/i,
      /adicionar nota/i,
      /enviar nota/i,
      /inserir nota/i,
      /cadastrar nota/i,
      /registrar nota/i,
      /lançar nota/i,
      /lancar nota/i,
      /incluir nota/i,
      /adicionar cupom/i,
      /enviar cupom/i,
      /cadastrar cupom/i,
      /cupom/i,
      /nota fiscal/i,
      /^notas$/i
    ];

    for (const step of steps) {
      const clicked = await this.clickVisibleByText(page, step);
      if (!clicked) continue;

      addLog(`Navegando no NotaBe: ${step.source}`);
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(1000);
      await this.guardAgainstManualBlocks(page);
      await this.resolveCnpjStep(page);

      if (await this.isSubmissionPageReady(page)) return;
    }

    await page.goto(notabeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});

    if (!await this.isSubmissionPageReady(page)) {
      const title = await page.title().catch(() => '');
      throw new Error(`Nao consegui chegar na tela de insercao do codigo do NotaBe. URL atual: ${page.url()} ${title ? `Titulo: ${title}` : ''}`);
    }
  }

  async isSubmissionPageReady(page) {
    const input = await this.findFiscalKeyInput(page);
    const button = await this.findSendButton(page);
    return Boolean(input && button);
  }

  async resolveCnpjStep(page) {
    if (!await this.looksLikeCnpjStep(page)) return;

    const cnpj = cleanKey(process.env.NOTABE_CNPJ || '');
    if (!cnpj) {
      this.pause('NotaBe pediu CNPJ. Configure NOTABE_CNPJ no backend para continuar.');
      throw new Error('Etapa de CNPJ detectada no NotaBe. Configure NOTABE_CNPJ.');
    }

    addLog('Etapa de CNPJ detectada. Preenchendo CNPJ configurado.');
    const input = await this.findCnpjInput(page);
    if (!input) {
      throw new Error('Etapa de CNPJ detectada, mas campo CNPJ nao foi encontrado.');
    }

    await input.fill(cnpj);
    await input.dispatchEvent('input');
    await input.dispatchEvent('change');

    const button = await firstExistingVisibleLocator([
      page.getByRole('button', { name: /continuar|entrar|acessar|avancar|avançar|confirmar|enviar/i }).first(),
      page.locator('button:has-text("Continuar"), button:has-text("Entrar"), button:has-text("Acessar"), button:has-text("Avançar"), button:has-text("Avancar"), button:has-text("Confirmar"), input[type="submit"]').first()
    ]);

    if (!button) {
      throw new Error('Etapa de CNPJ detectada, mas botao para continuar nao foi encontrado.');
    }

    await Promise.allSettled([
      page.waitForLoadState('networkidle', { timeout: 15000 }),
      button.click()
    ]);
    await page.waitForTimeout(1200);

    if (await this.looksLikeCnpjStep(page)) {
      throw new Error('CNPJ nao foi aceito pelo NotaBe. Confira NOTABE_CNPJ.');
    }
  }

  async clickVisibleByText(page, textRegex) {
    const locators = [
      page.getByRole('link', { name: textRegex }).first(),
      page.getByRole('button', { name: textRegex }).first(),
      page.locator('a, button, [role="button"]').filter({ hasText: textRegex }).first()
    ];

    const target = await firstExistingVisibleLocator(locators);
    if (!target) return false;

    try {
      await target.click();
      return true;
    } catch {
      return false;
    }
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

  async looksLikeCnpjStep(page) {
    const input = await this.findCnpjInput(page);
    if (input) return true;

    const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const lowered = text.toLowerCase();
    return lowered.includes('cnpj')
      && !lowered.includes('chave de acesso')
      && !lowered.includes('codigo da nota')
      && !lowered.includes('código da nota');
  }

  async findCnpjInput(page) {
    return firstExistingVisibleLocator([
      page.locator('input[placeholder*="cnpj" i]:visible').first(),
      page.locator('input[name*="cnpj" i]:visible').first(),
      page.locator('input[id*="cnpj" i]:visible').first()
    ]);
  }

  async findLoginInput(page) {
    const locators = [
      page.getByLabel(/email/i).first(),
      page.locator('label').filter({ hasText: /^email$/i }).locator('..').locator('input:visible').first(),
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
      page.getByLabel(/senha/i).first(),
      page.locator('label').filter({ hasText: /^senha$/i }).locator('..').locator('input:visible').first(),
      page.locator('input[type="password"]:visible').first(),
      page.locator('input[name*="senha" i]:visible').first(),
      page.locator('input[name*="password" i]:visible').first()
    ]);
  }

  async findLoginButton(page) {
    return firstExistingLocator([
      page.locator('form').getByRole('button', { name: /^entrar$/i }).first(),
      page.locator('form button:has-text("Entrar"), form input[type="submit"]').first(),
      page.getByRole('button', { name: /entrar|login|acessar|continuar/i }).first(),
      page.locator('button:has-text("Entrar"), button:has-text("Login"), button:has-text("Acessar"), input[type="submit"]').first()
    ]);
  }

  async findLoginEntryPoint(page) {
    return firstExistingVisibleLocator([
      page.getByRole('link', { name: /^entrar$/i }).first(),
      page.getByRole('button', { name: /^entrar$/i }).first(),
      page.locator('a:has-text("Entrar"), button:has-text("Entrar")').first()
    ]);
  }

  async findFiscalKeyInput(page) {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const lowered = bodyText.toLowerCase();
    const hasFiscalKeyContext = lowered.includes('chave')
      || lowered.includes('código da nota')
      || lowered.includes('codigo da nota')
      || lowered.includes('cupom fiscal')
      || lowered.includes('nota fiscal')
      || lowered.includes('nf-e')
      || lowered.includes('nfc-e');

    const targeted = [
      page.locator('input[placeholder*="chave" i]:visible').first(),
      page.locator('input[placeholder*="codigo" i]:visible').first(),
      page.locator('input[placeholder*="código" i]:visible').first(),
      page.locator('input[placeholder*="nota" i]:visible').first(),
      page.locator('input[placeholder*="cupom" i]:visible').first(),
      page.locator('input[name*="chave" i]:visible').first(),
      page.locator('input[name*="codigo" i]:visible').first(),
      page.locator('input[name*="nota" i]:visible').first(),
      page.locator('input[name*="cupom" i]:visible').first(),
      page.locator('textarea[placeholder*="chave" i]:visible').first(),
      page.locator('textarea[placeholder*="codigo" i]:visible').first(),
      page.locator('textarea[placeholder*="nota" i]:visible').first()
    ];

    const targetedInput = await firstExistingVisibleLocator(targeted);
    if (targetedInput) return targetedInput;

    if (!hasFiscalKeyContext) return null;

    return firstExistingVisibleLocator([
      page.locator('input[type="text"]:visible').first(),
      page.locator('textarea:visible').first()
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
    const byRole = page.getByRole('button', { name: /envia|enviar|salvar|cadastrar|registrar/i }).first();
    if (await byRole.count().catch(() => 0)) return byRole;

    const byText = page.locator('button:has-text("Envia"), button:has-text("Enviar"), button:has-text("Salvar"), button:has-text("Cadastrar"), button:has-text("Registrar"), input[type="submit"], [role="button"]:has-text("Envia"), [role="button"]:has-text("Enviar")').first();
    if (await byText.count().catch(() => 0)) return byText;

    return null;
  }

  async detectResult(page) {
    const body = await page.locator('body').innerText({ timeout: 8000 }).catch(() => '');
    const lowered = body.toLowerCase();

    const errorPatterns = [
      'erro na leitura',
      'erro',
      'inválid',
      'invalid',
      'não foi possível',
      'nao foi possivel',
      'não encontrado',
      'nao encontrado',
      'falha'
    ];

    for (const pattern of errorPatterns) {
      if (lowered.includes(pattern)) {
        const line = body.split('\n').find((item) => item.toLowerCase().includes(pattern));
        return { status: 'erro', message: line?.slice(0, 180) || 'Site retornou erro.' };
      }
    }

    const successPatterns = [
      'sucesso',
      'enviada',
      'enviado',
      'cadastrada',
      'cadastrado',
      'registrada',
      'registrado',
      'nota inserida',
      'salvo',
      'salva'
    ];

    for (const pattern of successPatterns) {
      if (lowered.includes(pattern)) {
        return { status: 'enviada', message: 'Enviada' };
      }
    }

    return {
      status: 'indefinido',
      message: 'Envio sem confirmacao clara no NotaBe. Nota nao marcada como enviada.'
    };
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

async function firstExistingVisibleLocator(locators) {
  for (const locator of locators) {
    if (!await locator.count().catch(() => 0)) continue;
    if (await locator.isVisible().catch(() => false)) return locator;
  }

  return null;
}

export const automationRunner = new AutomationRunner();
