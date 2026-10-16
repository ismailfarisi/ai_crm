import { toast } from 'sonner';
import type { WpsSifDto } from '@saas/shared';

/** Hands the SIF text to the browser as a file download; warnings go to a toast. */
export function downloadSif(dto: WpsSifDto): void {
  const url = URL.createObjectURL(new Blob([dto.content], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = dto.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  if (dto.warnings.length > 0) toast.warning(dto.warnings.join('\n'));
}
