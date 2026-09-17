/**
 * Datos de ejemplo del MODO DEMO.
 *
 * Existen para poder recorrer la aplicación sin Supabase configurado y sin
 * iniciar sesión. No se usan jamás fuera del modo demo.
 *
 * Los números son los de un almacén de barrio real: precios chilenos,
 * márgenes de retail (25-40 %), y una caja con un faltante pequeño, que es
 * lo que de verdad pasa en un local.
 */

export interface DemoProducto {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  categoria: string;
  sale_price: number;
  avg_cost: number;
  unit: string;
  stock: number;
  min_stock: number;
  tracks_expiry: boolean;
}

export const DEMO_PRODUCTOS: DemoProducto[] = [
  { id: 'p01', name: 'Arroz grado 1 · 1 kg',      sku: 'ARR-1K',  barcode: '7801234000018', categoria: 'Abarrotes', sale_price: 1590, avg_cost: 1100, unit: 'unidad', stock: 42,  min_stock: 10, tracks_expiry: false },
  { id: 'p02', name: 'Fideos spaghetti · 400 g',  sku: 'FID-400', barcode: '7801234000025', categoria: 'Abarrotes', sale_price:  990, avg_cost:  640, unit: 'unidad', stock: 8,   min_stock: 12, tracks_expiry: false },
  { id: 'p03', name: 'Aceite vegetal · 900 ml',   sku: 'ACE-900', barcode: '7801234000032', categoria: 'Abarrotes', sale_price: 2490, avg_cost: 1850, unit: 'unidad', stock: 19,  min_stock: 6,  tracks_expiry: false },
  { id: 'p04', name: 'Azúcar · 1 kg',             sku: 'AZU-1K',  barcode: '7801234000049', categoria: 'Abarrotes', sale_price: 1290, avg_cost:  900, unit: 'unidad', stock: 27,  min_stock: 8,  tracks_expiry: false },
  { id: 'p05', name: 'Leche entera · 1 L',        sku: 'LEC-1L',  barcode: '7801234000056', categoria: 'Lácteos',   sale_price: 1190, avg_cost:  850, unit: 'unidad', stock: 36,  min_stock: 20, tracks_expiry: true },
  { id: 'p06', name: 'Yogurt frutilla · 150 g',   sku: 'YOG-150', barcode: '7801234000063', categoria: 'Lácteos',   sale_price:  590, avg_cost:  390, unit: 'unidad', stock: 18,  min_stock: 24, tracks_expiry: true },
  { id: 'p07', name: 'Queso gauda · 250 g',       sku: 'QUE-250', barcode: '7801234000070', categoria: 'Lácteos',   sale_price: 3290, avg_cost: 2400, unit: 'unidad', stock: 11,  min_stock: 6,  tracks_expiry: true },
  { id: 'p08', name: 'Bebida cola · 1.5 L',       sku: 'BEB-15',  barcode: '7801234000087', categoria: 'Bebidas',   sale_price: 1890, avg_cost: 1350, unit: 'unidad', stock: 54,  min_stock: 15, tracks_expiry: false },
  { id: 'p09', name: 'Agua mineral · 1.5 L',      sku: 'AGU-15',  barcode: '7801234000094', categoria: 'Bebidas',   sale_price:  990, avg_cost:  620, unit: 'unidad', stock: 31,  min_stock: 15, tracks_expiry: false },
  { id: 'p10', name: 'Jugo naranja · 1 L',        sku: 'JUG-1L',  barcode: '7801234000100', categoria: 'Bebidas',   sale_price: 1390, avg_cost:  980, unit: 'unidad', stock: 14,  min_stock: 10, tracks_expiry: true },
  { id: 'p11', name: 'Detergente líquido · 3 L',  sku: 'DET-3L',  barcode: '7801234000117', categoria: 'Limpieza',  sale_price: 5990, avg_cost: 4300, unit: 'unidad', stock: 9,   min_stock: 4,  tracks_expiry: false },
  { id: 'p12', name: 'Cloro · 900 ml',            sku: 'CLO-900', barcode: '7801234000124', categoria: 'Limpieza',  sale_price:  890, avg_cost:  560, unit: 'unidad', stock: 3,   min_stock: 8,  tracks_expiry: false },
  { id: 'p13', name: 'Pan de molde · 500 g',      sku: 'PAN-500', barcode: '7801234000131', categoria: 'Panadería', sale_price: 2190, avg_cost: 1550, unit: 'unidad', stock: 7,   min_stock: 10, tracks_expiry: true },
  { id: 'p14', name: 'Huevos · docena',           sku: 'HUE-12',  barcode: '7801234000148', categoria: 'Abarrotes', sale_price: 3490, avg_cost: 2600, unit: 'unidad', stock: 22,  min_stock: 8,  tracks_expiry: true },
  { id: 'p15', name: 'Café instantáneo · 170 g',  sku: 'CAF-170', barcode: '7801234000155', categoria: 'Abarrotes', sale_price: 4990, avg_cost: 3700, unit: 'unidad', stock: 13,  min_stock: 5,  tracks_expiry: false },
];

/** Fecha relativa a hoy, para que los vencimientos siempre se vean realistas. */
function enDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export interface DemoLote {
  lot_id: string;
  product_id: string;
  product_name: string;
  lot_code: string;
  expiry_date: string;
  quantity: number;
  unit_cost: number;
  value_at_risk: number;
  days_to_expiry: number;
  expiry_status: 'vencido' | 'por_vencer' | 'vigente';
  /** La del producto. El queso va en kg, no en "u". */
  unit: string;
}

function lote(
  id: string, productId: string, nombre: string, codigo: string,
  dias: number, cantidad: number, costo: number,
): DemoLote {
  return {
    unit: DEMO_PRODUCTOS.find((p) => p.id === productId)?.unit ?? 'unidad',
    lot_id: id,
    product_id: productId,
    product_name: nombre,
    lot_code: codigo,
    expiry_date: enDias(dias),
    quantity: cantidad,
    unit_cost: costo,
    value_at_risk: Math.round(cantidad * costo),
    days_to_expiry: dias,
    expiry_status: dias < 0 ? 'vencido' : dias <= 30 ? 'por_vencer' : 'vigente',
  };
}

export const DEMO_LOTES: DemoLote[] = [
  lote('l01', 'p06', 'Yogurt frutilla · 150 g', 'L-2409A', -2,  6,  390),
  lote('l02', 'p13', 'Pan de molde · 500 g',    'L-2411B',  1,  7, 1550),
  lote('l03', 'p05', 'Leche entera · 1 L',      'L-2410C',  4, 12,  850),
  lote('l04', 'p07', 'Queso gauda · 250 g',     'L-2408D',  9, 11, 2400),
  lote('l05', 'p10', 'Jugo naranja · 1 L',      'L-2412E', 18, 14,  980),
  lote('l06', 'p14', 'Huevos · docena',         'L-2415F', 23, 22, 2600),
  lote('l07', 'p05', 'Leche entera · 1 L',      'L-2420G', 41, 24,  850),
];

/** Ventas del día: 38 transacciones, ticket promedio realista de almacén. */
export const DEMO_VENTAS_HOY = {
  cantidad: 38,
  total: 187_450,
  ticket_promedio: 4_933,
  anuladas: 1,
};

export const DEMO_CAJA = {
  id: 'caja-demo',
  opened_at: (() => {
    const d = new Date();
    d.setHours(9, 15, 0, 0);
    return d.toISOString();
  })(),
  opening_amount: 30_000,
  cash_sales: 121_300,
  cash_in: 0,
  cash_out: 5_000,
  get expected_amount() {
    return this.opening_amount + this.cash_sales + this.cash_in - this.cash_out;
  },
  sales_count: DEMO_VENTAS_HOY.cantidad,
  sales_total: DEMO_VENTAS_HOY.total,
  average_ticket: DEMO_VENTAS_HOY.ticket_promedio,
  by_payment_method: {
    efectivo: 121_300,
    debito: 48_900,
    credito: 17_250,
    transferencia: 0,
  },
};

export const DEMO_MOVIMIENTOS_CAJA = [
  {
    id: 'm01', type: 'egreso', amount: 5000,
    reason: 'Compra de bolsas',
    created_at: (() => { const d = new Date(); d.setHours(11, 40, 0, 0); return d.toISOString(); })(),
  },
];

export const DEMO_CIERRES = [
  { session_id: 'c01', full_name: 'Marcela Soto',  opened_at: '', closed_at: enDias(-1), difference: 0,     sales_total: 164_200 },
  { session_id: 'c02', full_name: 'Jorge Peña',    opened_at: '', closed_at: enDias(-2), difference: -2_000, sales_total: 198_700 },
  { session_id: 'c03', full_name: 'Marcela Soto',  opened_at: '', closed_at: enDias(-3), difference: 0,     sales_total: 143_900 },
  { session_id: 'c04', full_name: 'Felipe Vera',   opened_at: '', closed_at: enDias(-4), difference: 1_500,  sales_total: 176_300 },
];

/** Productos bajo su stock mínimo (los que ya vienen así en DEMO_PRODUCTOS). */
export const DEMO_BAJO_STOCK = DEMO_PRODUCTOS
  .filter((p) => p.min_stock > 0 && p.stock <= p.min_stock)
  .map((p) => ({
    product_id: p.id,
    name: p.name,
    quantity: p.stock,
    min_stock: p.min_stock,
    unit: p.unit,
  }));

/** Inventario valorizado, de mayor a menor capital inmovilizado. */
export const DEMO_INVENTARIO_VALORIZADO = DEMO_PRODUCTOS
  .map((p) => ({
    product_id: p.id,
    name: p.name,
    category_name: p.categoria,
    quantity: p.stock,
    avg_cost: p.avg_cost,
    sale_price: p.sale_price,
    cost_value: Math.round(p.stock * p.avg_cost),
  }))
  .sort((a, b) => b.cost_value - a.cost_value);

export const DEMO_USUARIOS = [
  { nombre: 'Felipe Vera',  rol: 'admin'      as const, descripcion: 'Dueño · ve todo, incluidos costos y márgenes' },
  { nombre: 'Marcela Soto', rol: 'supervisor' as const, descripcion: 'Encargada de turno · opera y autoriza, sin ver costos' },
  { nombre: 'Jorge Peña',   rol: 'vendedor'   as const, descripcion: 'Cajero · solo vende y ve sus propias ventas' },
  { nombre: 'Luis Rojas',   rol: 'bodega'     as const, descripcion: 'Bodega · recibe mercadería, no vende ni ve dinero' },
];
