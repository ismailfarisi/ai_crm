import { ButtonLink, Container } from '@/components/ui';

export default function NotFound() {
  return (
    <Container className="py-32 text-center">
      <p className="font-mono text-sm text-cut">404</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">This page fell off the cutting table.</h1>
      <p className="mt-4 text-ink-muted">The page you were looking for doesn’t exist.</p>
      <div className="mt-8">
        <ButtonLink href="/">Back to the homepage</ButtonLink>
      </div>
    </Container>
  );
}
