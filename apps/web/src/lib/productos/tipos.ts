/**
 * Contrato del repositorio de productos.
 *
 * Las pantallas hablan con esta interfaz, nunca con Supabase directamente.
 * Eso permite dos cosas:
 *
 *  1. En modo demo, el mismo código funciona contra IndexedDB. No hay datos
 *     fijos incrustados en las pantallas: hay un almacén distinto detrás de la
 *     misma interfaz.
 *  2. El día que cambie el proveedor de base de datos, se reemplaza una
 *     implementación y las pantallas no se tocan.
 */

export interface Producto {
  id: string;
  nombre: string;
  /**
   * Qué es el producto, en palabras. "Leche entera, caja de 1 litro".
   *
   * La columna existe en la base desde el primer día y hasta el 2026-09-17 la
   * aplicación no la leía ni la escribía. Es lo que hace que escanear un
   * código diga qué es la cosa y no solo cómo se llama en el catálogo, que no
   * es lo mismo cuando el nombre es "LE-1000 ENT".
   */
  descripcion: string | null;
  sku: string | null;
  categoriaId: string | null;
  categoriaNombre: string | null;
  unidad: string;
  precioVenta: number;
  /** Solo llega si el rol puede verlo. Nunca se expone a `vendedor`. */
  costoPromedio?: number;
  stockMinimo: number;
  perecible: boolean;
  diasAlerta: number;
  activo: boolean;
  codigos: string[];
  stock: number;
  /**
   * Dónde está ese stock (0014). La venta descuenta de la sala; lo que llega
   * del proveedor entra a la bodega. `stock` sigue siendo el total del local.
   */
  stockSala: number;
  stockBodega: number;
  actualizadoEn: string;
}

export interface ProductoNuevo {
  nombre: string;
  descripcion: string | null;
  sku: string | null;
  categoriaId: string | null;
  unidad: string;
  precioVenta: number;
  costo: number;
  stockMinimo: number;
  perecible: boolean;
  diasAlerta: number;
  codigos: string[];
  /**
   * Cuánto hay al crearlo, y **dónde**. Antes era un solo número que caía
   * entero en la bodega sin decírselo a nadie: quien cargaba el catálogo creía
   * dejarlo listo para vender, iba al POS y la sala estaba en cero (0016).
   */
  stockInicialSala: number;
  stockInicialBodega: number;
}

/**
 * Lo que se puede cambiar de un producto existente.
 *
 * Dos campos son opcionales y significan cosas distintas de "vacío":
 *
 * - `costo` ausente = **no tocar el costo promedio**. Lo mantiene la recepción
 *   con el promedio ponderado; mandar 0 porque el campo estaba en blanco le
 *   borraba el costo al producto, y con él el margen y el inventario
 *   valorizado.
 * - `codigos` ausente = **no tocar los códigos de barra**. Un arreglo vacío sí
 *   los borra, porque eso es lo que pide quien vacía la lista en el
 *   formulario. La carga masiva mandaba `[]` cuando la planilla no traía
 *   columna de código, y eso dejaba invisibles al escáner a todos los
 *   productos que la planilla tocara.
 */
export type ProductoEditable = Omit<ProductoNuevo, 'stockInicialSala' | 'stockInicialBodega' | 'costo' | 'codigos'> &
  Partial<Pick<ProductoNuevo, 'costo' | 'codigos'>>;

export interface Categoria {
  id: string;
  nombre: string;
}

export interface FiltroProductos {
  busqueda?: string;
  categoriaId?: string;
  soloActivos?: boolean;
  /** 'bajo' = por debajo del mínimo, 'agotado' = sin stock */
  estado?: 'todos' | 'normal' | 'bajo' | 'agotado';
  limite?: number;
}

export interface ResultadoLote {
  creados: number;
  actualizados: number;
  errores: Array<{ fila: number; nombre: string; mensaje: string }>;
}

export interface RepositorioProductos {
  listar(filtro: FiltroProductos, verCostos: boolean): Promise<Producto[]>;
  obtener(id: string, verCostos: boolean): Promise<Producto | null>;
  crear(datos: ProductoNuevo): Promise<{ id: string }>;
  /**
   * Edición atómica. Si `datos.codigos` viene sin definir, los códigos de
   * barra quedan como estaban; si viene con un arreglo, el producto queda con
   * exactamente esos.
   */
  actualizar(id: string, datos: ProductoEditable): Promise<void>;
  /** Desactiva. Nunca borra: la trazabilidad depende de conservar el registro. */
  desactivar(id: string): Promise<void>;
  reactivar(id: string): Promise<void>;
  /**
   * Elimina definitivamente. Solo permitido si el producto NUNCA tuvo
   * movimientos de inventario ni ventas. Si los tuvo, lanza un error y hay que
   * desactivarlo.
   */
  eliminar(id: string): Promise<void>;
  /** ¿Tiene historial? Determina si se puede eliminar o solo desactivar. */
  tieneMovimientos(id: string): Promise<boolean>;
  categorias(): Promise<Categoria[]>;
  crearCategoria(nombre: string): Promise<Categoria>;
  /** Códigos ya usados, para avisar de duplicados antes de guardar. */
  codigoEnUso(codigo: string, excluirProductoId?: string): Promise<string | null>;
  /**
   * Carga masiva, fila por fila.
   *
   * **No es atómica**, y el comentario anterior decía que sí. Cada fila se
   * aplica por separado: si la número 300 falla, las 299 anteriores ya están
   * en el catálogo. Por eso el resultado devuelve creados, actualizados y
   * errores en vez de lanzar, y por eso la pantalla tiene que decirle al
   * usuario que lo cargado se queda cargado. Hacerla atómica de verdad pide
   * una función transaccional en la base, como `fn_create_product`.
   *
   * `onProgreso` se llama después de cada fila para poder mostrar avance: en
   * un celular con 4G, 600 productos son varios minutos de pantalla quieta.
   */
  importarLote(
    filas: import('@rutaahorro/core').FilaProducto[],
    onProgreso?: (hechas: number, total: number) => void,
  ): Promise<ResultadoLote>;
}
