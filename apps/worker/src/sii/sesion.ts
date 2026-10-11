import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { entrarAlSii, ErrorClaveSii, hayLogin } from './login.js';

/**
 * Una sesión del SII que queda abierta todo el día (Felipe, 2026-10-11: "como
 * es continuo debería quedar la página abierta todo el tiempo, y si hay algún
 * problema se debería volver a entrar").
 *
 * Un Chrome con una pestaña en la página de trabajo (p. ej. e-Boleta). Cada
 * `cadaMs` la recarga: eso mantiene viva la sesión del SII y, si el SII la
 * cerró, encuentra el login y vuelve a entrar. Si Chrome se cae, la próxima
 * vuelta lo abre de nuevo. Los errores de red se reintentan con espera
 * creciente (hasta 5 minutos).
 *
 * Lo que NO se reintenta nunca: el SII diciendo que la clave está mal
 * (`ErrorClaveSii`). La sesión queda `detenida`, avisa una vez, y no vuelve a
 * probar hasta que alguien llame a `reanudar()` con la clave corregida. Un
 * robot que insiste con una clave mala la deja bloqueada.
 *
 * `usar()` presta la pestaña de a uno: dos boletas nunca se escriben a la vez
 * en el mismo formulario.
 */

export type EstadoSesion = 'apagada' | 'entrando' | 'lista' | 'detenida';

export interface AvisoSesion {
  tipo: 'entro' | 'reentro' | 'error' | 'detenida';
  detalle: string;
}

export interface OpcionesSesion {
  chromePath: string;
  /** La página que se deja abierta; si pide login, se entra y se vuelve a ella. */
  url: string;
  rut: string;
  clave: string;
  headless?: boolean;
  /** Carpeta del perfil de Chrome: las cookies sobreviven a un reinicio del worker. */
  perfil?: string;
  /** Cada cuánto se recarga la página para mantener viva la sesión. Por omisión, 4 minutos. */
  cadaMs?: number;
  /**
   * ¿La página cargada es la de trabajo? Por omisión: no hay formulario de
   * login. Conviene afinarlo (p. ej. que exista el formulario de la boleta).
   */
  estaDentro?: (page: Page) => Promise<boolean>;
  alAviso?: (a: AvisoSesion) => void;
}

const ESPERA_MAXIMA_MS = 5 * 60_000;

export class SesionSii {
  estado: EstadoSesion = 'apagada';
  ultimoError: string | null = null;
  /** Cuántas veces entró (la primera incluida). Sirve para vigilar y para las pruebas. */
  entradas = 0;

  private browser: Browser | null = null;
  private page: Page | null = null;
  private cola: Promise<unknown> = Promise.resolve();
  private reloj: NodeJS.Timeout | null = null;
  private fallosSeguidos = 0;
  private proximoIntento = 0;

  constructor(private o: OpcionesSesion) {}

  /** Abre Chrome, entra y empieza a vigilar. Si la clave está mal, lanza `ErrorClaveSii`. */
  async iniciar(): Promise<void> {
    await this.enCola(() => this.asegurar());
    this.reloj ??= setInterval(() => { void this.vigilar(); }, this.o.cadaMs ?? 4 * 60_000);
    this.reloj.unref?.();
  }

  /**
   * Presta la pestaña ya dentro del SII. Espera su turno; si la sesión está
   * `detenida` lanza sin abrir nada.
   */
  usar<T>(trabajo: (page: Page) => Promise<T>): Promise<T> {
    return this.enCola(async () => {
      const page = await this.asegurar();
      return trabajo(page);
    });
  }

  /** Después de corregir la clave: deja de estar detenida y vuelve a entrar. */
  async reanudar(credencial?: { rut: string; clave: string }): Promise<void> {
    if (credencial) this.o = { ...this.o, ...credencial };
    this.estado = this.browser ? 'entrando' : 'apagada';
    this.ultimoError = null;
    this.fallosSeguidos = 0;
    this.proximoIntento = 0;
    await this.iniciar();
  }

  async detener(): Promise<void> {
    if (this.reloj) clearInterval(this.reloj);
    this.reloj = null;
    await this.enCola(() => this.cerrarNavegador());
    if (this.estado !== 'detenida') this.estado = 'apagada';
  }

  /** Una vuelta del vigilante: recarga y, si hace falta, vuelve a entrar. Nunca lanza. */
  async vigilar(): Promise<void> {
    if (this.estado === 'detenida' || Date.now() < this.proximoIntento) return;
    await this.enCola(async () => {
      if (this.page && !this.page.isClosed()) {
        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
      }
      await this.asegurar();
    }).catch(() => { /* ya quedó en ultimoError y se avisó */ });
  }

  // ---------------------------------------------------------------- internos

  private enCola<T>(f: () => Promise<T>): Promise<T> {
    const r = this.cola.then(f, f);
    this.cola = r.catch(() => {});
    return r;
  }

  private aviso(a: AvisoSesion) {
    try { this.o.alAviso?.(a); } catch { /* un aviso que falla no tumba la sesión */ }
  }

  private async cerrarNavegador() {
    const b = this.browser;
    this.browser = null;
    this.page = null;
    if (!b) return;
    try {
      await Promise.race([b.close(), new Promise((_, no) => setTimeout(() => no(new Error('no cerró')), 8000))]);
    } catch {
      try { b.process()?.kill('SIGKILL'); } catch { /* ya no está */ }
    }
  }

  private async abrir(): Promise<Page> {
    if (this.browser?.connected && this.page && !this.page.isClosed()) return this.page;
    await this.cerrarNavegador();
    this.browser = await puppeteer.launch({
      executablePath: this.o.chromePath,
      headless: this.o.headless ?? true,
      userDataDir: this.o.perfil,
      protocolTimeout: 120_000,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    });
    // Si Chrome se cae, la próxima vuelta lo abre de nuevo.
    this.browser.on('disconnected', () => { this.browser = null; this.page = null; });
    const [primera] = await this.browser.pages();
    this.page = primera ?? await this.browser.newPage();
    this.page.on('dialog', (d) => { void d.accept().catch(() => {}); });
    this.page.setDefaultNavigationTimeout(60_000);
    return this.page;
  }

  private async dentro(page: Page): Promise<boolean> {
    if (await hayLogin(page)) return false;
    return this.o.estaDentro ? this.o.estaDentro(page) : true;
  }

  /** Deja la pestaña dentro del SII y en la página de trabajo, o lanza. */
  private async asegurar(): Promise<Page> {
    if (this.estado === 'detenida') {
      throw new ErrorClaveSii(this.ultimoError ?? 'La sesión del SII está detenida: corrige la clave y reanuda.');
    }
    if (Date.now() < this.proximoIntento) {
      throw new Error(`El SII falló hace poco; se vuelve a intentar a las ${new Date(this.proximoIntento).toLocaleTimeString('es-CL')}. ${this.ultimoError ?? ''}`);
    }
    try {
      const page = await this.abrir();
      if (page.url() === 'about:blank' || !(await this.dentro(page))) {
        if (page.url() === 'about:blank' || !(await hayLogin(page))) {
          await page.goto(this.o.url, { waitUntil: 'networkidle2', timeout: 45_000 });
        }
        if (!(await this.dentro(page))) {
          const reentrada = this.entradas > 0;
          this.estado = 'entrando';
          await entrarAlSii(page, this.o.rut, this.o.clave);
          // El SII suele volver a otra página después del login.
          if (!(await this.dentro(page))) await page.goto(this.o.url, { waitUntil: 'networkidle2', timeout: 45_000 });
          if (!(await this.dentro(page))) throw new Error(`Entró al SII, pero no llegó a ${this.o.url} (quedó en ${page.url()}).`);
          this.entradas++;
          this.aviso({ tipo: reentrada ? 'reentro' : 'entro', detalle: page.url() });
        }
      }
      this.estado = 'lista';
      this.ultimoError = null;
      this.fallosSeguidos = 0;
      return page;
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      this.ultimoError = mensaje;
      if (e instanceof ErrorClaveSii) {
        this.estado = 'detenida';
        this.aviso({ tipo: 'detenida', detalle: mensaje });
        await this.cerrarNavegador();
        throw e;
      }
      this.fallosSeguidos++;
      this.proximoIntento = Date.now() + Math.min(ESPERA_MAXIMA_MS, 5000 * 2 ** (this.fallosSeguidos - 1));
      this.estado = this.browser ? 'entrando' : 'apagada';
      this.aviso({ tipo: 'error', detalle: mensaje });
      throw e;
    }
  }
}
