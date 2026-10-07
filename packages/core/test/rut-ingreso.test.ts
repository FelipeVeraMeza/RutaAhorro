import { describe, it, expect } from 'vitest';
import { rutParaEntrar, correoDeRut, rutDeCorreo, isValidRut } from '../src/rut.js';

// Los RUT de Jo y John (2026-10-07): los dos válidos.
describe('entrar con RUT', () => {
  it('se escribe solo el cuerpo, con o sin puntos, o pegado completo', () => {
    expect(isValidRut('15620607-5')).toBe(true);
    expect(isValidRut('16790449-1')).toBe(true);
    expect(rutParaEntrar('15620607')).toBe('15620607');
    expect(rutParaEntrar('15.620.607')).toBe('15620607');
    expect(rutParaEntrar('15.620.607-5')).toBe('15620607');
    expect(rutParaEntrar(' 16790449 ')).toBe('16790449');
  });
  it('lo que no es un RUT no entra', () => {
    expect(rutParaEntrar('')).toBeNull();
    expect(rutParaEntrar('123')).toBeNull();
    expect(rutParaEntrar('156206075')).toBeNull(); // con el dígito pegado sin guion: 9 dígitos
    expect(rutParaEntrar('felipe@correo.cl')).toBeNull();
  });
  it('el correo técnico va y vuelve, con el dígito verificador calculado', () => {
    expect(correoDeRut('15620607')).toBe('15620607@rut.rutaahorro.local');
    expect(rutDeCorreo('15620607@rut.rutaahorro.local')).toBe('15.620.607-5');
    expect(rutDeCorreo('16790449@RUT.RUTAAHORRO.LOCAL')).toBe('16.790.449-1');
    expect(rutDeCorreo('admin@gmail.com')).toBeNull();
    expect(rutDeCorreo('15620607@otro.cl')).toBeNull();
  });
});
