import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fotos de productos (RT-50, docs/30), en el servidor.
 *
 * Viven en el bucket público `productos` de Supabase Storage, en
 * `<local>/<producto>-<origen>-<marca de tiempo>.<ext>`. Público porque la
 * tienda las muestra a cualquiera; nadie más que el servidor escribe ahí.
 * `origen` es `foto` (la subió alguien del local) u `off` (vino de Open Food
 * Facts): la tienda cita la fuente al pie si alguna es `off` (CC BY-SA).
 *
 * `products.image_url` se escribe con la llave de servicio, después de
 * comprobar el rol y el local. El disparador de 0020 igual marca `updated_at`
 * (y conserva el último `updated_by`, porque sin sesión no hay `auth.uid()`).
 */
export const BUCKET_FOTOS = 'productos';
export const MAX_BYTES_FOTO = 5 * 1024 * 1024;
const TIPOS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function extensionDeFoto(tipo: string): string | null {
  return TIPOS[tipo.split(';')[0].trim().toLowerCase()] ?? null;
}

/**
 * RNF-T20 · El tipo REAL del archivo, por sus primeros bytes. El que dice el
 * navegador (o el servidor de origen) se puede falsear: un HTML con
 * `Content-Type: image/png` quedaría publicado en un bucket público.
 */
export function tipoRealDeFoto(bytes: ArrayBuffer): string | null {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  const texto = String.fromCharCode(...b);
  if (texto.startsWith('RIFF') && texto.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function asegurarBucket(db: SupabaseClient) {
  const { data } = await db.storage.getBucket(BUCKET_FOTOS);
  if (data) return;
  const { error } = await db.storage.createBucket(BUCKET_FOTOS, {
    public: true, fileSizeLimit: MAX_BYTES_FOTO, allowedMimeTypes: Object.keys(TIPOS),
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

/** La ruta del archivo dentro del bucket, a partir de su URL pública. */
function rutaEnBucket(url: string | null): string | null {
  const m = url?.match(new RegExp(`/storage/v1/object/public/${BUCKET_FOTOS}/(.+)$`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Sube la foto, la deja como `image_url` del producto y borra la anterior. Devuelve la URL nueva. */
export async function guardarFotoProducto(
  db: SupabaseClient, tenantId: string, productoId: string,
  bytes: ArrayBuffer, origen: 'foto' | 'off',
): Promise<string> {
  // Manda lo que dicen los bytes (RNF-T20): la cabecera que manda el
  // navegador o el servidor de origen ni siquiera se recibe.
  const real = tipoRealDeFoto(bytes);
  const ext = real ? extensionDeFoto(real) : null;
  if (!real || !ext) throw Object.assign(new Error('La foto tiene que ser JPG, PNG o WebP'), { code: 'FOTO_FORMATO' });
  if (bytes.byteLength > MAX_BYTES_FOTO) throw Object.assign(new Error('La foto pesa más de 5 MB'), { code: 'FOTO_PESADA' });

  const { data: prod, error: e1 } = await db.from('products')
    .select('id, image_url').eq('id', productoId).eq('tenant_id', tenantId).maybeSingle();
  if (e1) throw e1;
  if (!prod) throw Object.assign(new Error('El producto no existe'), { code: 'PRODUCTO_NO_ENCONTRADO' });

  await asegurarBucket(db);
  const ruta = `${tenantId}/${productoId}-${origen}-${Date.now()}.${ext}`;
  const { error: e2 } = await db.storage.from(BUCKET_FOTOS).upload(ruta, bytes, { contentType: real, upsert: false, cacheControl: '31536000' });
  if (e2) throw e2;
  const url = db.storage.from(BUCKET_FOTOS).getPublicUrl(ruta).data.publicUrl;

  const { error: e3 } = await db.from('products').update({ image_url: url }).eq('id', productoId).eq('tenant_id', tenantId);
  if (e3) {
    await db.storage.from(BUCKET_FOTOS).remove([ruta]);
    throw e3;
  }
  const vieja = rutaEnBucket(prod.image_url as string | null);
  if (vieja) await db.storage.from(BUCKET_FOTOS).remove([vieja]);
  return url;
}

export async function quitarFotoProducto(db: SupabaseClient, tenantId: string, productoId: string) {
  const { data: prod, error } = await db.from('products')
    .select('image_url').eq('id', productoId).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw error;
  if (!prod) throw Object.assign(new Error('El producto no existe'), { code: 'PRODUCTO_NO_ENCONTRADO' });
  const { error: e2 } = await db.from('products').update({ image_url: null }).eq('id', productoId).eq('tenant_id', tenantId);
  if (e2) throw e2;
  const vieja = rutaEnBucket(prod.image_url as string | null);
  if (vieja) await db.storage.from(BUCKET_FOTOS).remove([vieja]);
}
