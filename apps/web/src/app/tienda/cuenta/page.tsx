import type { Metadata } from 'next';
import { CuentaCliente } from '@/components/tienda/CuentaCliente';

// Los datos de cada persona: no se indexa.
export const metadata: Metadata = { title: 'Mi cuenta', robots: { index: false, follow: true } };

export default function CuentaPage() {
  return <CuentaCliente />;
}
