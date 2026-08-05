import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth/register-form';

export const metadata: Metadata = { title: 'Create your workspace' };

export default function RegisterPage() {
  return <RegisterForm />;
}
