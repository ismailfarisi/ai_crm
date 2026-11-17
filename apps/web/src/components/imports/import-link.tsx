'use client';

import Link from 'next/link';
import { FileUp } from 'lucide-react';
import { IMPORT_DEFINITIONS, type ImportEntity } from '@saas/shared';
import { Can } from '@/components/auth/can';
import { Button, type Variant } from '@/components/ui/button';

/** "Import" on a list screen: opens the import flow with this list chosen. */
export function ImportLink({
  entity,
  variant = 'outline',
  label = 'Import',
}: {
  entity: ImportEntity;
  variant?: Variant;
  label?: string;
}) {
  return (
    <Can permission={IMPORT_DEFINITIONS[entity].createPermission}>
      <Link href={`/settings/import?entity=${entity}`}>
        <Button variant={variant} type="button">
          <FileUp className="size-4" />
          {label}
        </Button>
      </Link>
    </Can>
  );
}
