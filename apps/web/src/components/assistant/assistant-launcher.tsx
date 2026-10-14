'use client';

import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAssistant } from './assistant-provider';

export function AssistantLauncher() {
  const { open, setOpen } = useAssistant();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setOpen(!open)}
      aria-label="Open assistant (Ctrl+J)"
      aria-expanded={open}
      title="Assistant (Ctrl/⌘ J)"
    >
      <Sparkles className="size-5" aria-hidden="true" />
    </Button>
  );
}
