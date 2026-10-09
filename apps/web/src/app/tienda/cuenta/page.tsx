import type { Metadata } from 'next';
import { CuentaCliente } from '@/components/tienda/CuentaCliente';

export const metadata: Metadata = { title: 'Mi cuenta' };

export default function CuentaPage() {
  return <CuentaCliente />;
}
