import { admin } from '../supabase.js';

/**
 * RNF-T26 · Los datos de contacto de los pedidos web entregados o cancelados
 * hace más de 12 meses se borran (0041, `fn_anonimizar_pedidos_web`). Queda el
 * pedido (productos y total) para los reportes. Es el plazo que dice la
 * página de privacidad de la tienda.
 */
export const MESES_CONSERVACION = 12;

export async function runAnonimizarPedidosWeb() {
  const { data, error } = await admin.rpc('fn_anonimizar_pedidos_web', { p_meses: MESES_CONSERVACION });
  if (error) {
    // Sin 0041 aplicada no hay pedidos que anonimizar: no es una falla.
    if (error.code === 'PGRST202' || error.code === '42883') return { anonimizados: 0, nota: 'sin 0041' };
    throw new Error(`No se pudieron anonimizar los pedidos web: ${error.message}`);
  }
  return { anonimizados: Number(data ?? 0) };
}
