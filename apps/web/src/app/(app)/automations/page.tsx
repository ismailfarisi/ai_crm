'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Zap,
  Plus,
  Search,
  Play,
  Trash2,
  Sparkles,
  Webhook,
  Calendar,
  Layers,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { useAutomations, useDeleteAutomationWorkflow, useCreateAutomationWorkflow } from '@/hooks/use-automations';
import type { AutomationWorkflowDto } from '@saas/shared';

export default function AutomationsListPage() {
  const router = useRouter();
  const { data: workflows = [], isLoading, refetch } = useAutomations();
  const deleteMutation = useDeleteAutomationWorkflow();
  const createMutation = useCreateAutomationWorkflow();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');

  const filteredWorkflows = workflows.filter((wf) => {
    const matchesSearch =
      wf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (wf.description && wf.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesFilter = filterType === 'ALL' || wf.triggerType === filterType;
    return matchesSearch && matchesFilter;
  });

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this automation?')) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Automation deleted');
      refetch();
    } catch {
      toast.error('Failed to delete automation');
    }
  };

  const handleCreateFromTemplate = async (template: { name: string; description: string; triggerType: any }) => {
    try {
      const created = await createMutation.mutateAsync({
        name: template.name,
        description: template.description,
        triggerType: template.triggerType,
        nodes: [
          {
            id: 'trigger-1',
            type: template.triggerType === 'WEBHOOK' ? 'webhookTrigger' : 'crmEventTrigger',
            position: { x: 100, y: 150 },
            data: { label: template.name, config: {} },
          },
        ],
        edges: [],
      });
      toast.success('Created new automation workflow');
      router.push(`/automations/${created.id}`);
    } catch {
      toast.error('Failed to create workflow');
    }
  };

  return (
    <div data-testid="automations-list-page" className="p-8 max-w-7xl mx-auto space-y-8 select-text">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
              <Zap className="h-4 w-4" />
            </span>
            <h1 className="text-xl font-bold text-stone-900">Automation Studio</h1>
          </div>
          <p className="text-xs text-stone-500 mt-1">
            Build event-driven DAG workflows, cron routines, AI CFO digests, and human approval pipelines.
          </p>
        </div>

        <Link
          href="/automations/new"
          data-testid="create-automation-btn"
          className="flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-amber-700 active:scale-95 shadow-sm transition-all cursor-pointer self-start"
        >
          <Plus className="h-4 w-4" /> New Automation
        </Link>
      </div>

      {/* Starter Templates */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-stone-600">Quick-Start Flow Presets</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            onClick={() =>
              handleCreateFromTemplate({
                name: 'Quote Approval to Invoice Flow',
                description: 'Pause on Quote creation for manager approval; generate Invoice on approval.',
                triggerType: 'CRM_EVENT',
              })
            }
            className="group p-4 rounded-2xl border border-stone-200 bg-white hover:border-amber-400 hover:shadow-md transition-all cursor-pointer space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <span className="text-[10px] font-bold uppercase text-emerald-700">CRM Event</span>
            </div>
            <h4 className="text-xs font-bold text-stone-900 group-hover:text-amber-800">
              Quote Approval & Invoice Generator
            </h4>
            <p className="text-[11px] text-stone-500 leading-relaxed">
              Auto-assigns quotes, verifies margin, halts for approval, and issues invoices.
            </p>
          </div>

          <div
            onClick={() =>
              handleCreateFromTemplate({
                name: 'Daily AI CFO Cashflow Health Check',
                description: 'Runs daily at 8am: fetches burn rate and emails executive cash summary.',
                triggerType: 'SCHEDULE',
              })
            }
            className="group p-4 rounded-2xl border border-stone-200 bg-white hover:border-amber-400 hover:shadow-md transition-all cursor-pointer space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-100 text-purple-800">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="text-[10px] font-bold uppercase text-purple-700">Scheduled AI</span>
            </div>
            <h4 className="text-xs font-bold text-stone-900 group-hover:text-amber-800">
              Daily AI Financial & Cashflow Briefing
            </h4>
            <p className="text-[11px] text-stone-500 leading-relaxed">
              Cron trigger analyzes daily accounts receivables, runway, and sends report to owner.
            </p>
          </div>

          <div
            onClick={() =>
              handleCreateFromTemplate({
                name: 'Inbound Webhook to Lead Enrichment',
                description: 'Captures external website leads via webhook and creates CRM contacts.',
                triggerType: 'WEBHOOK',
              })
            }
            className="group p-4 rounded-2xl border border-stone-200 bg-white hover:border-amber-400 hover:shadow-md transition-all cursor-pointer space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-800">
                <Webhook className="h-4 w-4" />
              </span>
              <span className="text-[10px] font-bold uppercase text-blue-700">Webhook</span>
            </div>
            <h4 className="text-xs font-bold text-stone-900 group-hover:text-amber-800">
              Inbound Webhook Lead Enrichment
            </h4>
            <p className="text-[11px] text-stone-500 leading-relaxed">
              Accepts JSON payload, enriches company details, and alerts team on Slack.
            </p>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
          <input
            type="text"
            data-testid="search-automations-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search automations..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-stone-200 rounded-xl text-stone-900 focus:border-amber-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 self-start sm:self-auto">
          {['ALL', 'WEBHOOK', 'SCHEDULE', 'CRM_EVENT', 'MANUAL'].map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setFilterType(type)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer',
                filterType === type
                  ? 'bg-amber-100 text-amber-900 font-semibold'
                  : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50',
              )}
            >
              {type === 'ALL' ? 'All Triggers' : type}
            </button>
          ))}
        </div>
      </div>

      {/* Workflows Grid List */}
      {isLoading ? (
        <div className="py-12 flex justify-center text-stone-400 text-xs">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
            Loading workflows...
          </div>
        </div>
      ) : filteredWorkflows.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-2xl border border-stone-200 p-8 space-y-3">
          <Zap className="h-8 w-8 text-stone-300 mx-auto" />
          <h3 className="text-sm font-bold text-stone-900">No Automation Workflows Found</h3>
          <p className="text-xs text-stone-500 max-w-sm mx-auto">
            {searchQuery
              ? `No automations match "${searchQuery}".`
              : 'Create your first workflow or pick a template above to get started.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredWorkflows.map((wf) => (
            <Link
              key={wf.id}
              href={`/automations/${wf.id}`}
              data-testid={`workflow-card-${wf.id}`}
              className="group flex flex-col justify-between rounded-2xl border border-stone-200 bg-white p-5 hover:border-amber-400 hover:shadow-lg transition-all"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="rounded-lg bg-stone-100 px-2.5 py-1 text-[10px] font-bold text-stone-700 uppercase tracking-wider">
                    {wf.triggerType}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={clsx(
                        'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase',
                        wf.status === 'ACTIVE'
                          ? 'bg-emerald-50 text-emerald-700'
                          : wf.status === 'PAUSED'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-stone-100 text-stone-500',
                      )}
                    >
                      <span
                        className={clsx(
                          'h-1.5 w-1.5 rounded-full',
                          wf.status === 'ACTIVE' ? 'bg-emerald-500 animate-pulse' : 'bg-stone-400',
                        )}
                      />
                      {wf.status}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, wf.id)}
                      className="p-1 rounded-md text-stone-400 hover:text-rose-600 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-stone-900 group-hover:text-amber-700 transition-colors">
                    {wf.name}
                  </h3>
                  <p className="mt-1 text-xs text-stone-500 line-clamp-2">
                    {wf.description || 'No description provided.'}
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between text-[11px] text-stone-400">
                <span>{wf.nodes?.length || 0} Nodes in Graph</span>
                <span className="flex items-center gap-1 font-semibold text-amber-700 group-hover:translate-x-0.5 transition-transform">
                  Open Studio <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
