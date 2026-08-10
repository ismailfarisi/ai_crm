'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, Eye, EyeOff, Globe } from 'lucide-react';
import {
  metaWhatsAppConfigSchema,
  telegramConfigSchema,
  emailSmtpConfigSchema,
  emailResendConfigSchema,
} from '@saas/shared';
import { api, queryKeys, type ChannelConfigDto } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useSession } from '@/lib/session-context';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { cn } from '@/lib/utils';

interface ChannelConfigModalProps {
  open: boolean;
  onClose: () => void;
  config: ChannelConfigDto | null;
}

const PROVIDER_SLUGS: Record<ChannelConfigDto['provider'], string> = {
  WHATSAPP_META: 'whatsapp',
  TELEGRAM: 'telegram',
  EMAIL_SMTP: 'email_smtp',
  EMAIL_RESEND: 'email_resend',
};

const PROVIDER_TITLES: Record<ChannelConfigDto['provider'], string> = {
  WHATSAPP_META: 'Meta WhatsApp Cloud API Configuration',
  TELEGRAM: 'Telegram Bot Configuration',
  EMAIL_SMTP: 'SMTP Email Configuration',
  EMAIL_RESEND: 'Resend Email Configuration',
};

export function ChannelConfigModal({ open, onClose, config }: ChannelConfigModalProps) {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [copied, setCopied] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Local form state for provider credentials
  const [formData, setFormData] = useState<Record<string, any>>({});

  const provider = config?.provider ?? 'WHATSAPP_META';
  const providerSlug = PROVIDER_SLUGS[provider];

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/webhooks/channels/${providerSlug}/${session.organization.id}`
      : `/api/webhooks/channels/${providerSlug}/${session.organization.id}`;

  useEffect(() => {
    if (config?.credentials) {
      setFormData(config.credentials);
    } else {
      setFormData({});
    }
    setErrors({});
  }, [config, open]);

  const updateField = (key: string, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const validate = (): boolean => {
    setErrors({});
    let result;

    switch (provider) {
      case 'WHATSAPP_META':
        result = metaWhatsAppConfigSchema.safeParse(formData);
        break;
      case 'TELEGRAM':
        result = telegramConfigSchema.safeParse(formData);
        break;
      case 'EMAIL_SMTP':
        result = emailSmtpConfigSchema.safeParse({
          ...formData,
          port: typeof formData.port === 'string' ? parseInt(formData.port, 10) : formData.port,
          secure: formData.secure ?? true,
        });
        break;
      case 'EMAIL_RESEND':
        result = emailResendConfigSchema.safeParse(formData);
        break;
      default:
        return true;
    }

    if (!result.success) {
      const formattedErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const fieldName = issue.path[0] as string;
        if (fieldName && !formattedErrors[fieldName]) {
          formattedErrors[fieldName] = issue.message;
        }
      }
      setErrors(formattedErrors);
      return false;
    }

    return true;
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payloadCredentials = { ...formData };
      if (provider === 'EMAIL_SMTP') {
        payloadCredentials.port =
          typeof payloadCredentials.port === 'string'
            ? parseInt(payloadCredentials.port, 10)
            : payloadCredentials.port;
        payloadCredentials.secure = payloadCredentials.secure ?? true;
      }
      return api.channels.saveConfig(provider, {
        isEnabled: config?.isEnabled ?? true,
        credentials: payloadCredentials,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.channels });
      toast.success('Channel configuration saved successfully');
      onClose();
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not save channel configuration',
      );
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      saveMutation.mutate();
    }
  };

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast.success('Webhook URL copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  if (!config) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={PROVIDER_TITLES[provider]}
      description="Configure API credentials and settings for this communication channel."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saveMutation.isPending}>
            Cancel
          </Button>
          <Button loading={saveMutation.isPending} onClick={handleSubmit}>
            Save Configuration
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Copyable Webhook URL section */}
        <div className="rounded-lg border border-border bg-surface-muted/50 p-3.5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-muted">
            <Globe className="size-3.5 text-brand" />
            <span>Inbound Webhook Endpoint URL</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-surface px-2.5 py-1.5 text-xs text-ink border border-border font-mono">
              {webhookUrl}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyWebhook}
              className="shrink-0"
            >
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-[11px] text-ink-subtle">
            Paste this URL into your {PROVIDER_TITLES[provider].split(' ')[0]} webhook settings.
          </p>
        </div>

        {/* Provider Specific Form Fields */}
        {provider === 'WHATSAPP_META' && (
          <div className="space-y-4">
            <Input
              label="Phone Number ID"
              placeholder="e.g. 104827364829104"
              value={formData.phoneNumberId || ''}
              error={errors.phoneNumberId}
              onChange={(e) => updateField('phoneNumberId', e.target.value)}
              required
            />
            <Input
              label="Business Account ID"
              placeholder="e.g. 987654321098765"
              value={formData.businessAccountId || ''}
              error={errors.businessAccountId}
              onChange={(e) => updateField('businessAccountId', e.target.value)}
              required
            />
            <SecretInput
              label="Access Token"
              placeholder="EAAG..."
              value={formData.accessToken || ''}
              error={errors.accessToken}
              onChange={(val) => updateField('accessToken', val)}
              required
            />
            <SecretInput
              label="Webhook Verify Token"
              placeholder="Your custom verification token"
              value={formData.verifyToken || ''}
              error={errors.verifyToken}
              onChange={(val) => updateField('verifyToken', val)}
              hint="Must match the verification token configured in Meta App Dashboard."
              required
            />
          </div>
        )}

        {provider === 'TELEGRAM' && (
          <div className="space-y-4">
            <SecretInput
              label="Bot Token"
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
              value={formData.botToken || ''}
              error={errors.botToken}
              onChange={(val) => updateField('botToken', val)}
              hint="Obtained from @BotFather on Telegram."
              required
            />
            <Input
              label="Bot Username"
              placeholder="e.g. my_company_crm_bot"
              value={formData.botUsername || ''}
              error={errors.botUsername}
              onChange={(e) => updateField('botUsername', e.target.value)}
              required
            />
          </div>
        )}

        {provider === 'EMAIL_SMTP' && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="SMTP Host"
                placeholder="smtp.mailgun.org"
                value={formData.host || ''}
                error={errors.host}
                onChange={(e) => updateField('host', e.target.value)}
                required
              />
              <Input
                label="SMTP Port"
                type="number"
                placeholder="587"
                value={formData.port ?? 587}
                error={errors.port}
                onChange={(e) => updateField('port', e.target.value)}
                required
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                id="smtp-secure"
                type="checkbox"
                className="size-4 rounded border-border accent-brand"
                checked={formData.secure ?? true}
                onChange={(e) => updateField('secure', e.target.checked)}
              />
              <label htmlFor="smtp-secure" className="text-sm font-medium text-ink cursor-pointer">
                Use TLS / SSL (Secure connection)
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="SMTP User"
                placeholder="postmaster@mg.example.com"
                value={formData.user || ''}
                error={errors.user}
                onChange={(e) => updateField('user', e.target.value)}
                required
              />
              <SecretInput
                label="SMTP Password"
                placeholder="••••••••"
                value={formData.pass || ''}
                error={errors.pass}
                onChange={(val) => updateField('pass', val)}
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="From Email"
                type="email"
                placeholder="noreply@example.com"
                value={formData.fromEmail || ''}
                error={errors.fromEmail}
                onChange={(e) => updateField('fromEmail', e.target.value)}
                required
              />
              <Input
                label="From Name"
                placeholder="Relay CRM Support"
                value={formData.fromName || ''}
                error={errors.fromName}
                onChange={(e) => updateField('fromName', e.target.value)}
                required
              />
            </div>
          </div>
        )}

        {provider === 'EMAIL_RESEND' && (
          <div className="space-y-4">
            <SecretInput
              label="Resend API Key"
              placeholder="re_123456789..."
              value={formData.apiKey || ''}
              error={errors.apiKey}
              onChange={(val) => updateField('apiKey', val)}
              hint="Generate from your Resend.com dashboard."
              required
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="From Email"
                type="email"
                placeholder="onboarding@resend.dev"
                value={formData.fromEmail || ''}
                error={errors.fromEmail}
                onChange={(e) => updateField('fromEmail', e.target.value)}
                required
              />
              <Input
                label="From Name"
                placeholder="Relay CRM"
                value={formData.fromName || ''}
                error={errors.fromName}
                onChange={(e) => updateField('fromName', e.target.value)}
                required
              />
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}

function SecretInput({
  label,
  value,
  onChange,
  error,
  placeholder,
  hint,
  required,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  error?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          className={cn(
            'w-full rounded-lg border bg-surface px-3 py-2 pr-10 text-sm text-ink placeholder:text-ink-subtle transition-colors',
            error ? 'border-danger' : 'border-border hover:border-border-strong',
          )}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink p-1 rounded-md"
          aria-label={show ? 'Hide secret' : 'Show secret'}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
