'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import {
  CONTACT_SOURCES,
  CONTACT_SOURCE_LABELS,
  CONTACT_STATUSES,
  CONTACT_STATUS_LABELS,
  PERMISSIONS,
  createContactSchema,
  type ContactDto,
  type UserDto,
} from '@saas/shared';
import { useSession } from '@/lib/session-context';
import { useCreateContact, useUpdateContact } from '@/hooks/use-contacts';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';

interface ContactFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Present when editing; absent when creating. */
  contact?: ContactDto | null;
  teamMembers?: UserDto[];
}

/**
 * The schema normalises as it validates (`''` → `null`, defaults filled in), so
 * what the fields hold and what the API receives are different shapes. React
 * Hook Form models that with a third generic for the transformed output.
 */
type FormValues = z.input<typeof createContactSchema>;
type SubmitValues = z.output<typeof createContactSchema>;

const EMPTY: FormValues = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  company: '',
  jobTitle: '',
  status: 'lead',
  source: 'other',
  notes: '',
  ownerId: null,
};

export function ContactFormDialog({ open, onClose, contact, teamMembers = [] }: ContactFormDialogProps) {
  const { can } = useSession();
  const canReassign = can(PERMISSIONS.CONTACT_READ_ALL) || can(PERMISSIONS.CONTACT_READ_TEAM);
  const isEditing = Boolean(contact);

  const create = useCreateContact();
  const update = useUpdateContact();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, SubmitValues>({
    resolver: zodResolver(createContactSchema),
    defaultValues: EMPTY,
  });

  // Repopulate whenever the dialog opens for a different contact.
  useEffect(() => {
    if (!open) return;

    reset(
      contact
        ? {
            firstName: contact.firstName,
            lastName: contact.lastName,
            email: contact.email ?? '',
            phone: contact.phone ?? '',
            company: contact.company ?? '',
            jobTitle: contact.jobTitle ?? '',
            status: contact.status,
            source: contact.source,
            notes: contact.notes ?? '',
            ownerId: contact.owner?.id ?? null,
          }
        : EMPTY,
    );
  }, [open, contact, reset]);

  const onSubmit = handleSubmit(async (values) => {
    // An empty <select> value means "unassigned", not the string "".
    const payload = { ...values, ownerId: values.ownerId ? values.ownerId : null };

    try {
      if (contact) {
        await update.mutateAsync({ id: contact.id, input: payload });
      } else {
        await create.mutateAsync(payload);
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          setError(field as keyof FormValues, { message });
        }
      }
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={isEditing ? 'Edit contact' : 'New contact'}
      description={
        isEditing ? undefined : 'Add someone to your pipeline. Only a name is required.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" form="contact-form" loading={isSubmitting}>
            {isEditing ? 'Save changes' : 'Create contact'}
          </Button>
        </>
      }
    >
      <form id="contact-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="First name"
            required
            error={errors.firstName?.message}
            {...register('firstName')}
          />
          <Input
            label="Last name"
            required
            error={errors.lastName?.message}
            {...register('lastName')}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
          <Input label="Phone" type="tel" error={errors.phone?.message} {...register('phone')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Company" error={errors.company?.message} {...register('company')} />
          <Input label="Job title" error={errors.jobTitle?.message} {...register('jobTitle')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Status"
            error={errors.status?.message}
            options={CONTACT_STATUSES.map((status) => ({
              value: status,
              label: CONTACT_STATUS_LABELS[status],
            }))}
            {...register('status')}
          />
          <Select
            label="Source"
            error={errors.source?.message}
            options={CONTACT_SOURCES.map((source) => ({
              value: source,
              label: CONTACT_SOURCE_LABELS[source],
            }))}
            {...register('source')}
          />
        </div>

        {canReassign && teamMembers.length > 0 && (
          <Select
            label="Owner"
            placeholder="Unassigned"
            hint={
              can(PERMISSIONS.CONTACT_READ_ALL)
                ? 'Anyone in the organization.'
                : 'Only your team members.'
            }
            error={errors.ownerId?.message}
            options={teamMembers.map((member) => ({
              value: member.id,
              label: `${member.fullName} — ${member.email}`,
            }))}
            {...register('ownerId')}
          />
        )}

        <Textarea
          label="Notes"
          placeholder="Context, next steps, anything worth remembering."
          error={errors.notes?.message}
          {...register('notes')}
        />
      </form>
    </Dialog>
  );
}
