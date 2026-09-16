import { describe, it, expect } from 'vitest';
import { isValidRut, formatRut, cleanRut, computeDv } from '../src/rut.js';
import { isValidEan, detectFormat, normalizeBarcode, generateInternalBarcode } from '../src/barcode.js';
import { toUserMessage, errorCode } from '../src/errors.js';

describe('RUT chileno', () => {
  it('valida RUTs correctos', () => {
    expect(isValidRut('11.111.111-1')).toBe(true);
    expect(isValidRut('111111111')).toBe(true);
    expect(isValidRut('12.345.678-5')).toBe(true);
  });

  it('valida el dígito verificador K', () => {
    expect(computeDv('20347878')).toBe('K');
    expect(isValidRut('20.347.878-K')).toBe(true);
    expect(isValidRut('20347878k')).toBe(true);
  });

  it('rechaza dígito verificador incorrecto', () => {
    expect(isValidRut('11.111.111-2')).toBe(false);
    expect(isValidRut('12.345.678-9')).toBe(false);
  });

  it('rechaza entradas que no son RUT', () => {
    expect(isValidRut('')).toBe(false);
    expect(isValidRut('abc')).toBe(false);
    // Un teléfono mal pegado no debe pasar como RUT
    expect(isValidRut('9')).toBe(false);
    expect(isValidRut('12345')).toBe(false);
  });

  it('normaliza y formatea', () => {
    expect(cleanRut('12.345.678-5')).toBe('123456785');
    expect(formatRut('123456785')).toBe('12.345.678-5');
    expect(formatRut('20347878K')).toBe('20.347.878-K');
  });
});

describe('códigos de barras', () => {
  it('valida el dígito de control EAN-13', () => {
    expect(isValidEan('7802250011125')).toBe(true);   // EAN-13 sintético con dígito de control válido
    expect(isValidEan('4006381333931')).toBe(true);
  });

  it('rechaza un EAN-13 con dígito de control malo', () => {
    // Una lectura borrosa puede devolver 13 dígitos que no son un código real
    expect(isValidEan('4006381333932')).toBe(false);
  });

  it('rechaza longitudes que no existen', () => {
    expect(isValidEan('12345')).toBe(false);
    expect(isValidEan('')).toBe(false);
    expect(isValidEan('abcdefghijklm')).toBe(false);
  });

  it('identifica el formato por longitud', () => {
    expect(detectFormat('7802250011125')).toBe('EAN-13');
    expect(detectFormat('012345678905')).toBe('UPC-A');
    expect(detectFormat('96385074')).toBe('EAN-8');
    expect(detectFormat('ABC-123')).toBe('CODE-128');
  });

  it('normaliza UPC-A a EAN-13 para que sea el mismo producto', () => {
    expect(normalizeBarcode('012345678905')).toBe('0012345678905');
    expect(normalizeBarcode('7802250011125')).toBe('7802250011125');
  });

  it('genera códigos internos válidos en el rango reservado', () => {
    const code = generateInternalBarcode(1);
    expect(code).toHaveLength(13);
    expect(code.startsWith('200')).toBe(true);
    expect(isValidEan(code)).toBe(true);
  });

  it('genera códigos internos distintos y todos válidos', () => {
    const codes = [1, 2, 42, 999, 123456].map(generateInternalBarcode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every(isValidEan)).toBe(true);
  });
});

describe('mensajes de error en lenguaje del negocio (RNF-20)', () => {
  it('traduce códigos conocidos', () => {
    expect(toUserMessage({ message: 'CAJA_NO_ABIERTA' }))
      .toBe('Debes abrir caja antes de vender');
  });

  it('nombra el producto concreto cuando falta stock', () => {
    expect(toUserMessage({ message: 'STOCK_INSUFICIENTE: Coca-Cola 1.5L' }))
      .toBe('No hay stock suficiente de Coca-Cola 1.5L');
  });

  it('explica el vencimiento faltante nombrando el producto', () => {
    expect(toUserMessage({ message: 'VENCIMIENTO_REQUERIDO: Yogurt Frutilla' }))
      .toBe('"Yogurt Frutilla" es perecible: indica la fecha de vencimiento');
  });

  it('nunca filtra jerga técnica al cajero', () => {
    const msg = toUserMessage({ message: 'PostgresError: constraint violation on relation sale_items' });
    expect(msg).toBe('Ocurrió un problema. Ya fuimos notificados');
    expect(msg).not.toMatch(/constraint|relation|Postgres/i);
  });

  it('reconoce el código duplicado de Postgres', () => {
    expect(toUserMessage({ message: 'duplicate key value violates unique constraint "product_barcodes_tenant_id_barcode_key"' }))
      .toBe('Ese código ya pertenece a otro producto');
  });

  it('extrae el código cuando existe', () => {
    expect(errorCode({ message: 'STOCK_INSUFICIENTE: algo' })).toBe('STOCK_INSUFICIENTE');
    expect(errorCode({ message: 'cualquier cosa' })).toBeNull();
  });
});

describe('errores del alta de producto (fn_create_product)', () => {
  it('nombra el producto que ya ocupa el código de barra', () => {
    expect(toUserMessage('CODIGO_EN_USO:7801234000018:Arroz grado 1 · 1 kg'))
      .toBe('El código 7801234000018 ya está en "Arroz grado 1 · 1 kg"');
  });

  it('funciona aunque venga sin el nombre del dueño', () => {
    expect(toUserMessage('CODIGO_EN_USO:7801234000018'))
      .toBe('El código 7801234000018 ya está en otro producto');
  });

  it('traduce el resto de los códigos nuevos', () => {
    expect(toUserMessage('SIN_PERMISO_CREAR_PRODUCTO')).toBe('No tienes permiso para crear productos');
    expect(toUserMessage('NOMBRE_REQUERIDO')).toBe('El producto necesita un nombre');
    expect(toUserMessage('MONTO_NEGATIVO')).toBe('El precio y el costo no pueden ser negativos');
    expect(toUserMessage('CANTIDAD_NEGATIVA')).toBe('La cantidad no puede ser negativa');
  });

  it('no deja pasar un código sin traducir como si fuera mensaje al usuario', () => {
    expect(toUserMessage('ALGO_QUE_NO_EXISTE')).not.toContain('ALGO_QUE_NO_EXISTE');
  });
});
