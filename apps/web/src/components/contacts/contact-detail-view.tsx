'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Mail, MessageSquare, Phone, User } from 'lucide-react';
import { CONTACT_SOURCE_LABELS, CONTACT_STATUS_LABELS } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { formatRelative, initials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { ContactMessagesTab } from '@/components/contacts/contact-messages-tab';

export function ContactDetailView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState<'details' | 'messages'>('messages');

  const {
    data: contact,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: queryKeys.contact(id),
    queryFn: () => api.contacts.get(id),
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-subtle hover:text-ink mb-2"
        >
          <ArrowLeft className="size-3.5" />
          Back to Contacts
        </Link>
      </div>

      {isPending ? (
        <Card className="p-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </Card>
      ) : isError || !contact ? (
        <EmptyState
          title="Contact not found"
          description={error instanceof Error ? error.message : 'The contact could not be found or you do not have permission to view it.'}
          action={
            <Link href="/contacts">
              <Button variant="outline">Back to Contacts</Button>
            </Link>
          }
        />
      ) : (
        <>
          {/* Header */}
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="grid size-14 place-items-center rounded-full bg-brand-soft text-lg font-semibold text-brand ring-1 ring-brand/20">
                  {initials(contact.fullName, '')}
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-ink">
                    {contact.fullName}
                  </h1>
                  <p className="text-sm text-ink-subtle">
                    {contact.jobTitle ? `${contact.jobTitle} at ` : ''}
                    {contact.company || 'Independent'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
                    {contact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="size-3.5 text-ink-subtle" />
                        {contact.email}
                      </span>
                    )}
                    {contact.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="size-3.5 text-ink-subtle" />
                        {contact.phone}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge tone="brand">{CONTACT_STATUS_LABELS[contact.status]}</Badge>
                <Badge tone="neutral">{CONTACT_SOURCE_LABELS[contact.source]}</Badge>
              </div>
            </div>
          </Card>

          {/* Tab Navigation */}
          <div className="border-b border-border">
            <nav className="-mb-px flex gap-6" aria-label="Tabs">
              <button
                onClick={() => setActiveTab('messages')}
                className={`flex items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors ${
                  activeTab === 'messages'
                    ? 'border-brand text-brand'
                    : 'border-transparent text-ink-subtle hover:border-border hover:text-ink'
                }`}
              >
                <MessageSquare className="size-4" />
                Messages Timeline
              </button>
              <button
                onClick={() => setActiveTab('details')}
                className={`flex items-center gap-2 border-b-2 pb-3 pt-1 text-sm font-medium transition-colors ${
                  activeTab === 'details'
                    ? 'border-brand text-brand'
                    : 'border-transparent text-ink-subtle hover:border-border hover:text-ink'
                }`}
              >
                <User className="size-4" />
                Contact Details
              </button>
            </nav>
          </div>

          {/* Tab Content */}
          {activeTab === 'messages' && (
            <ContactMessagesTab contact={contact} />
          )}

          {activeTab === 'details' && (
            <Card className="p-6 space-y-4">
              <h3 className="text-base font-semibold text-ink">Overview</h3>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                <div>
                  <dt className="text-xs text-ink-subtle">Full Name</dt>
                  <dd className="font-medium text-ink mt-0.5">{contact.fullName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-subtle">Email</dt>
                  <dd className="font-medium text-ink mt-0.5">{contact.email || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-subtle">Phone</dt>
                  <dd className="font-medium text-ink mt-0.5">{contact.phone || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-subtle">Company</dt>
                  <dd className="font-medium text-ink mt-0.5">{contact.company || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-subtle">Status</dt>
                  <dd className="font-medium text-ink mt-0.5">{CONTACT_STATUS_LABELS[contact.status]}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-subtle">Source</dt>
                  <dd className="font-medium text-ink mt-0.5">{CONTACT_SOURCE_LABELS[contact.source]}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-subtle">Created At</dt>
                  <dd className="font-medium text-ink mt-0.5">{formatRelative(contact.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-subtle">Owner</dt>
                  <dd className="font-medium text-ink mt-0.5">{contact.owner?.fullName || 'Unassigned'}</dd>
                </div>
              </dl>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
