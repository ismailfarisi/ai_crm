'use client';

import { useRef } from 'react';
import { ImageUp, Trash2 } from 'lucide-react';
import { LOGO_CONTENT_TYPES, LOGO_MAX_BYTES } from '@saas/shared';
import { API_PUBLIC_URL } from '@/lib/api/config';
import { useClearOrganizationLogo, useSetOrganizationLogo } from '@/hooks/use-organization';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';

/**
 * The logo printed on every document the business sends.
 *
 * The company profile gave the organization an address, a tax registration and
 * a footer, but documents stayed text-only — there was no image upload
 * anywhere, so the most visible thing on the paperwork a customer receives was
 * the one thing that could not be set.
 *
 * Raster formats only, and small. A logo is the one stored file served back
 * inline, on a page a customer opens without signing in; an inline SVG is a
 * script running on the origin that served it.
 */
export function CompanyLogoCard({ logoUrl }: { logoUrl: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useSetOrganizationLogo();
  const clear = useClearOrganizationLogo();

  // `logoUrl` is relative to the API, which is on its own origin.
  const src = logoUrl ? `${API_PUBLIC_URL.replace(/\/api\/v\d+$/, '')}${logoUrl}` : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-ink">Logo</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-20 w-40 shrink-0 place-items-center rounded-xl border border-dashed border-border bg-surface-muted/40">
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt="Your company logo"
                className="max-h-16 max-w-36 object-contain"
              />
            ) : (
              <span className="text-xs text-ink-subtle">No logo yet</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={upload.isPending}
              onClick={() => input.current?.click()}
            >
              <ImageUp className="size-4" />
              {src ? 'Replace' : 'Upload'}
            </Button>
            {src && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={clear.isPending}
                onClick={() => clear.mutate()}
              >
                <Trash2 className="size-4" />
                Remove
              </Button>
            )}
          </div>
        </div>

        <p className="text-xs text-ink-subtle">
          PNG, JPEG or WebP, under {Math.round(LOGO_MAX_BYTES / 1024 / 1024)} MB. It prints at
          the top of quotes and invoices, including the page your customer opens from the link
          you send.
        </p>

        <input
          ref={input}
          type="file"
          accept={LOGO_CONTENT_TYPES.join(',')}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared straight away so picking the same file twice — after a
            // failed upload, say — still fires a change event.
            event.target.value = '';
            if (file) upload.mutate(file);
          }}
        />
      </CardBody>
    </Card>
  );
}
