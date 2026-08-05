import { redirect } from 'next/navigation';

/** `proxy.ts` has already decided whether a session exists by the time we get here. */
export default function RootPage() {
  redirect('/dashboard');
}
