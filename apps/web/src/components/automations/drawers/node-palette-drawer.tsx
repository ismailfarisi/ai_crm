'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Webhook,
  Calendar,
  Zap,
  Play,
  Split,
  Timer,
  Code2,
  Globe,
  Mail,
  Database,
  ShieldAlert,
  Search,
  X,
  Plus,
  type LucideIcon,
  MessageSquareText,
  Route,
} from 'lucide-react';
import clsx from 'clsx';
import type { AutomationNodeType } from '@saas/shared';
import { isTriggerType, stepWording, type StepWording } from '../step-wording';

export type PaletteCategory =
  | 'All'
  | 'Triggers'
  | 'Logic'
  | 'Transform'
  | 'Actions'
  | 'AI'
  | 'Human-in-the-Loop';

export interface NodePaletteItem {
  type: AutomationNodeType;
  label: string;
  category: PaletteCategory;
  icon: LucideIcon;
  description: string;
  badge?: string;
  iconBg: string;
  iconColor: string;
}

export const NODE_PALETTE_ITEMS: NodePaletteItem[] = [
  // Triggers
  {
    type: 'webhookTrigger',
    label: 'Webhook Trigger',
    category: 'Triggers',
    icon: Webhook,
    description: 'Listen for incoming HTTP POST/GET webhook calls',
    badge: 'Trigger',
    iconBg: 'bg-brand-soft',
    iconColor: 'text-ink',
  },
  {
    type: 'scheduleTrigger',
    label: 'Schedule Cron',
    category: 'Triggers',
    icon: Calendar,
    description: 'Trigger workflow periodically on a cron schedule',
    badge: 'Trigger',
    iconBg: 'bg-info-soft',
    iconColor: 'text-info',
  },
  {
    type: 'crmEventTrigger',
    label: 'CRM Event',
    category: 'Triggers',
    icon: Zap,
    description: 'Trigger on contact, deal, quote, or invoice events',
    badge: 'Trigger',
    iconBg: 'bg-success-soft',
    iconColor: 'text-success',
  },
  {
    type: 'manualTrigger',
    label: 'Manual Trigger',
    category: 'Triggers',
    icon: Play,
    description: 'Run workflow on-demand via studio UI or API call',
    badge: 'Trigger',
    iconBg: 'bg-info-soft',
    iconColor: 'text-info',
  },

  // Logic
  {
    type: 'conditionNode',
    label: 'Condition Branch',
    category: 'Logic',
    icon: Split,
    description: 'Branch flow into True / False paths based on expressions',
    badge: 'Branch',
    iconBg: 'bg-info-soft',
    iconColor: 'text-info',
  },
  {
    type: 'delayNode',
    label: 'Delay / Timer',
    category: 'Logic',
    icon: Timer,
    description: 'Durable execution pause for a specified duration',
    badge: 'Pause',
    iconBg: 'bg-brand-soft',
    iconColor: 'text-ink',
  },

  // Transform
  {
    type: 'transformNode',
    label: 'Data Transform',
    category: 'Transform',
    icon: Code2,
    description: 'Reshape, compute, and map variables via JS expressions',
    badge: 'Mapper',
    iconBg: 'bg-success-soft',
    iconColor: 'text-success',
  },

  // Actions
  {
    type: 'httpRequestNode',
    label: 'HTTP Request',
    category: 'Actions',
    icon: Globe,
    description: 'Call external REST APIs with custom headers and body',
    badge: 'REST',
    iconBg: 'bg-info-soft',
    iconColor: 'text-info',
  },
  {
    type: 'sendEmailNode',
    label: 'Send Email',
    category: 'Actions',
    icon: Mail,
    description: 'Send transactional or alert emails with template fields',
    badge: 'Email',
    iconBg: 'bg-danger-soft',
    iconColor: 'text-danger',
  },
  {
    type: 'crmMutateNode',
    label: 'CRM Mutation',
    category: 'Actions',
    icon: Database,
    description: 'Create or update CRM contacts, deals, quotes, and tasks',
    badge: 'CRM',
    iconBg: 'bg-brand-soft',
    iconColor: 'text-ink',
  },

  // AI
  {
    type: 'aiPromptNode',
    label: 'AI Prompt / LLM',
    category: 'AI',
    icon: MessageSquareText,
    description: 'Execute LLM reasoning, draft generation, or summarization',
    badge: 'AI',
    iconBg: 'bg-info-soft',
    iconColor: 'text-info',
  },
  {
    type: 'aiAgentNode',
    label: 'Autonomous AI Agent',
    category: 'AI',
    icon: Route,
    description: 'Autonomous multi-step ReAct agent with tool execution and HITL approvals',
    badge: 'Agent',
    iconBg: 'bg-brand-soft',
    iconColor: 'text-ink',
  },

  // Human-in-the-Loop
  {
    type: 'approvalNode',
    label: 'Human Approval',
    category: 'Human-in-the-Loop',
    icon: ShieldAlert,
    description: 'Pause and wait for manager approval before continuing',
    badge: 'HITL',
    iconBg: 'bg-brand-soft',
    iconColor: 'text-ink',
  },
];

export const PALETTE_CATEGORIES: PaletteCategory[] = [
  'All',
  'Triggers',
  'Logic',
  'Transform',
  'Actions',
  'AI',
  'Human-in-the-Loop',
];

export interface NodePaletteDrawerProps {
  isOpen?: boolean;
  onClose?: () => void;
  onAddNode?: (type: AutomationNodeType) => void;
  onDragStart?: (event: React.DragEvent, type: AutomationNodeType) => void;
  className?: string;
  /** The automation already has what starts it: offer only steps, not a second start. */
  hasTrigger?: boolean;
  /** The step the new one will follow, when opened from a step's "+". */
  afterStepName?: string | null;
}

const SECTIONS: StepWording['kind'][] = ['Starts it', 'Do something', 'Decide or wait'];

/** A palette item in the builder's plain words; an item without wording keeps its own. */
function plain(item: NodePaletteItem) {
  const wording = stepWording(item.type);
  return {
    ...item,
    label: wording?.label ?? item.label,
    description: wording?.description ?? item.description,
    kind: wording?.kind ?? (item.category === 'Triggers' ? 'Starts it' : 'Do something'),
    advanced: wording?.advanced ?? false,
  };
}

/**
 * The step chooser. It floats over the canvas instead of pushing it aside,
 * lists steps by what they do, and leaves out the ways to start an automation
 * once it has one.
 */
export function NodePaletteDrawer({
  isOpen = true,
  onClose,
  onAddNode,
  onDragStart,
  className,
  hasTrigger = false,
  afterStepName,
}: NodePaletteDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showMore, setShowMore] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Escape closes the chooser, as it would any other panel. A modal dialog
  // above it (a confirmation) handles its own Escape first.
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('dialog[open]')) return;
      onCloseRef.current?.();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const q = searchQuery.toLowerCase().trim();
  const items = useMemo(
    () =>
      NODE_PALETTE_ITEMS.map(plain).filter((item) => {
        if (hasTrigger && isTriggerType(item.type)) return false;
        return !q || item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
      }),
    [q, hasTrigger],
  );
  // Searching looks through everything; otherwise the rarely needed steps stay folded away.
  const visible = items.filter((item) => q || showMore || !item.advanced);
  const hiddenCount = items.length - visible.length;

  const handleDragStart = (e: React.DragEvent, item: NodePaletteItem) => {
    e.dataTransfer.setData('application/reactflow', item.type);
    e.dataTransfer.setData('automation/node-type', item.type);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(e, item.type);
  };

  if (!isOpen) return null;

  const heading = !hasTrigger ? 'What should start it?' : afterStepName ? 'What happens next?' : 'Add a step';
  const sub = !hasTrigger
    ? 'Choose what sets this automation off.'
    : afterStepName
      ? `Runs after “${afterStepName}”, already connected.`
      : 'Click a step to add it, or drag it onto the canvas.';

  return (
    <aside
      data-testid="node-palette-drawer"
      aria-label={heading}
      className={clsx(
        'absolute inset-y-0 left-0 w-80 max-w-[85%] border-r border-border bg-surface flex flex-col select-none shadow-xl z-30',
        className,
      )}
    >
      <div className="p-4 border-b border-border/40 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">{heading}</h3>
            <p data-testid="node-palette-sub" className="text-[11px] text-ink-muted mt-0.5">
              {sub}
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-subtle pointer-events-none" />
          <input
            type="text"
            data-testid="node-palette-search"
            aria-label="Search steps"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search, e.g. email or wait"
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-surface-muted border border-border rounded-lg text-ink placeholder:text-ink-subtle focus:bg-surface focus:border-brand focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink p-0.5"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div data-testid="node-palette-list" className="flex-1 overflow-y-auto p-3 space-y-4">
        {visible.length === 0 && (
          <div className="py-12 text-center text-ink-subtle space-y-1">
            <Search className="h-6 w-6 mx-auto stroke-1" />
            <p className="text-xs font-medium text-ink-muted">Nothing matches “{searchQuery}”</p>
            <p className="text-[11px]">Try another word, such as email, wait or approve.</p>
          </div>
        )}

        {SECTIONS.map((section) => {
          const inSection = visible.filter((item) => item.kind === section);
          if (inSection.length === 0) return null;
          return (
            <section key={section} className="space-y-2">
              {/* The heading already says "start" when only triggers are listed. */}
              {hasTrigger && <h4 className="px-1 text-[11px] font-semibold text-ink-muted">{section}</h4>}
              {inSection.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.type}
                    type="button"
                    draggable
                    data-testid={`palette-item-${item.type}`}
                    onDragStart={(e) => handleDragStart(e, item)}
                    onClick={() => onAddNode?.(item.type)}
                    className="group flex w-full items-start gap-2.5 p-2.5 text-left bg-surface border border-border rounded-xl hover:border-brand hover:bg-surface-muted/50 hover:shadow-xs transition cursor-pointer"
                  >
                    <div
                      className={clsx(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-2xs mt-0.5',
                        item.iconBg,
                        item.iconColor,
                      )}
                    >
                      <Icon aria-hidden className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="block text-xs font-semibold text-ink">{item.label}</span>
                      <span className="block text-[11px] text-ink-muted leading-snug mt-0.5">{item.description}</span>
                    </div>
                    <Plus aria-hidden className="h-3.5 w-3.5 mt-1 shrink-0 text-ink-subtle group-hover:text-ink" />
                  </button>
                );
              })}
            </section>
          );
        })}

        {!q && (hiddenCount > 0 || showMore) && (
          <button
            type="button"
            data-testid="palette-more-btn"
            aria-expanded={showMore}
            onClick={() => setShowMore((v) => !v)}
            className="w-full rounded-lg px-2 py-1.5 text-left text-[11px] font-semibold text-ink-muted hover:bg-surface-muted hover:text-ink cursor-pointer"
          >
            {showMore ? 'Fewer options' : `More options (${hiddenCount}): connect to other apps`}
          </button>
        )}
      </div>
    </aside>
  );
}
