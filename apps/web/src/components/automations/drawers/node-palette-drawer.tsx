'use client';

import React, { useState, useMemo } from 'react';
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
  Sparkles,
  ShieldAlert,
  Search,
  X,
  Plus,
  GripVertical,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import type { AutomationNodeType } from '@saas/shared';

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
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-700',
  },
  {
    type: 'scheduleTrigger',
    label: 'Schedule Cron',
    category: 'Triggers',
    icon: Calendar,
    description: 'Trigger workflow periodically on a cron schedule',
    badge: 'Trigger',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-700',
  },
  {
    type: 'crmEventTrigger',
    label: 'CRM Event',
    category: 'Triggers',
    icon: Zap,
    description: 'Trigger on contact, deal, quote, or invoice events',
    badge: 'Trigger',
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-700',
  },
  {
    type: 'manualTrigger',
    label: 'Manual Trigger',
    category: 'Triggers',
    icon: Play,
    description: 'Run workflow on-demand via studio UI or API call',
    badge: 'Trigger',
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-700',
  },

  // Logic
  {
    type: 'conditionNode',
    label: 'Condition Branch',
    category: 'Logic',
    icon: Split,
    description: 'Branch flow into True / False paths based on expressions',
    badge: 'Branch',
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-700',
  },
  {
    type: 'delayNode',
    label: 'Delay / Timer',
    category: 'Logic',
    icon: Timer,
    description: 'Durable execution pause for a specified duration',
    badge: 'Pause',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-700',
  },

  // Transform
  {
    type: 'transformNode',
    label: 'Data Transform',
    category: 'Transform',
    icon: Code2,
    description: 'Reshape, compute, and map variables via JS expressions',
    badge: 'Mapper',
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-700',
  },

  // Actions
  {
    type: 'httpRequestNode',
    label: 'HTTP Request',
    category: 'Actions',
    icon: Globe,
    description: 'Call external REST APIs with custom headers and body',
    badge: 'REST',
    iconBg: 'bg-sky-50',
    iconColor: 'text-sky-700',
  },
  {
    type: 'sendEmailNode',
    label: 'Send Email',
    category: 'Actions',
    icon: Mail,
    description: 'Send transactional or alert emails with template fields',
    badge: 'Email',
    iconBg: 'bg-rose-50',
    iconColor: 'text-rose-700',
  },
  {
    type: 'crmMutateNode',
    label: 'CRM Mutation',
    category: 'Actions',
    icon: Database,
    description: 'Create or update CRM contacts, deals, quotes, and tasks',
    badge: 'CRM',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-700',
  },

  // AI
  {
    type: 'aiPromptNode',
    label: 'AI Prompt / LLM',
    category: 'AI',
    icon: Sparkles,
    description: 'Execute LLM reasoning, draft generation, or summarization',
    badge: 'AI',
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-700',
  },

  // Human-in-the-Loop
  {
    type: 'approvalNode',
    label: 'Human Approval',
    category: 'Human-in-the-Loop',
    icon: ShieldAlert,
    description: 'Pause and wait for manager approval before continuing',
    badge: 'HITL',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-800',
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
}

export function NodePaletteDrawer({
  isOpen = true,
  onClose,
  onAddNode,
  onDragStart,
  className,
}: NodePaletteDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<PaletteCategory>('All');

  const filteredItems = useMemo(() => {
    return NODE_PALETTE_ITEMS.filter((item) => {
      const matchesCategory =
        selectedCategory === 'All' || item.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.type.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  const handleDragStart = (e: React.DragEvent, item: NodePaletteItem) => {
    e.dataTransfer.setData('application/reactflow', item.type);
    e.dataTransfer.setData('automation/node-type', item.type);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.(e, item.type);
  };

  if (!isOpen) return null;

  return (
    <aside
      data-testid="node-palette-drawer"
      className={clsx(
        'w-80 border-r border-stone-200 bg-white flex flex-col h-full select-none shadow-sm z-20',
        className,
      )}
    >
      {/* Drawer Header */}
      <div className="p-4 border-b border-stone-100 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-stone-900 flex items-center gap-1.5">
              <span>Node Palette</span>
              <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full border border-amber-200/60">
                {NODE_PALETTE_ITEMS.length}
              </span>
            </h3>
            <p className="text-[11px] text-stone-500 mt-0.5">
              Drag nodes onto canvas or click + to add
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-colors"
              aria-label="Close palette"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400 pointer-events-none" />
          <input
            type="text"
            data-testid="node-palette-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search nodes (e.g. Webhook, AI)..."
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-lg text-stone-900 placeholder:text-stone-400 focus:bg-white focus:border-amber-500 focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 p-0.5"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none no-scrollbar">
          {PALETTE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              data-testid={`category-filter-${cat.toLowerCase().replace(/\s+/g, '-')}`}
              onClick={() => setSelectedCategory(cat)}
              className={clsx(
                'px-2.5 py-1 text-[11px] font-medium rounded-md whitespace-nowrap transition-all cursor-pointer',
                selectedCategory === cat
                  ? 'bg-amber-500 text-white shadow-2xs font-semibold'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200/80 hover:text-stone-900',
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Node Cards List */}
      <div
        data-testid="node-palette-list"
        className="flex-1 overflow-y-auto p-3 space-y-2"
      >
        {filteredItems.length === 0 ? (
          <div className="py-12 text-center text-stone-400 space-y-1">
            <Search className="h-6 w-6 mx-auto stroke-1" />
            <p className="text-xs font-medium text-stone-600">No nodes found</p>
            <p className="text-[11px]">Try searching for something else</p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.type}
                draggable
                data-testid={`palette-item-${item.type}`}
                onDragStart={(e) => handleDragStart(e, item)}
                onClick={() => onAddNode?.(item.type)}
                className="group relative flex items-start gap-2.5 p-2.5 bg-white border border-stone-200 rounded-xl hover:border-amber-500 hover:shadow-xs transition-all cursor-grab active:cursor-grabbing hover:bg-stone-50/50"
              >
                {/* Drag Handle Indicator */}
                <div className="pt-1 text-stone-300 group-hover:text-stone-400">
                  <GripVertical className="h-3.5 w-3.5" />
                </div>

                {/* Node Icon */}
                <div
                  className={clsx(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-2xs mt-0.5',
                    item.iconBg,
                    item.iconColor,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 pr-6">
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-xs font-semibold text-stone-900 truncate">
                      {item.label}
                    </h4>
                    {item.badge && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-stone-500 bg-stone-100 px-1 py-0.2 rounded">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-stone-500 leading-snug line-clamp-2 mt-0.5">
                    {item.description}
                  </p>
                </div>

                {/* Quick Add Button */}
                <button
                  type="button"
                  data-testid={`add-node-btn-${item.type}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddNode?.(item.type);
                  }}
                  className="absolute right-2 top-2 h-6 w-6 rounded-md bg-stone-100 text-stone-600 opacity-0 group-hover:opacity-100 hover:bg-amber-500 hover:text-white flex items-center justify-center transition-all shadow-2xs cursor-pointer"
                  title="Add to canvas"
                  aria-label={`Add ${item.label}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
