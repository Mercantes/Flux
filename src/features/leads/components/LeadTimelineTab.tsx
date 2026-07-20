'use client';

import { sanitizeHtml } from '@/lib/security/sanitize-html';
import {
  Calendar,
  Check,
  Linkedin,
  Mail,
  MessageSquare,
  MousePointerClick,
  Phone,
  Reply,
  Search,
  Send,
  UserCog,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';

import type { TimelineEntry } from '@/features/cadences/cadences.contract';
import type { InteractionType } from '@/features/cadences/types';

const typeConfig: Record<InteractionType, { label: string; icon: typeof Send; className: string }> = {
  sent: { label: 'Enviado', icon: Send, className: 'text-blue-500' },
  delivered: { label: 'Entregue', icon: Check, className: 'text-green-500' },
  opened: { label: 'Aberto', icon: Mail, className: 'text-[var(--primary)]' },
  clicked: { label: 'Clicou', icon: MousePointerClick, className: 'text-orange-500' },
  replied: { label: 'Respondeu', icon: Reply, className: 'text-emerald-600' },
  bounced: { label: 'Bounce', icon: XCircle, className: 'text-red-500' },
  failed: { label: 'Falhou', icon: XCircle, className: 'text-red-600' },
  meeting_scheduled: { label: 'Reunião', icon: Calendar, className: 'text-indigo-500' },
};

export const channelIcon: Record<string, typeof Mail> = {
  email: Mail,
  whatsapp: MessageSquare,
  phone: Phone,
  linkedin: Linkedin,
  research: Search,
  system: UserCog,
  calendar: Calendar,
};

export const channelLabel: Record<string, string> = {
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  phone: 'Telefone',
  linkedin: 'LinkedIn',
  research: 'Pesquisa',
  system: 'Atividade',
  calendar: 'Reunião',
};

export const channelColor: Record<string, string> = {
  email: 'bg-blue-500',
  whatsapp: 'bg-emerald-500',
  phone: 'bg-amber-500',
  linkedin: 'bg-[#0A66C2]',
  research: 'bg-violet-500',
  system: 'bg-gray-500',
  calendar: 'bg-indigo-500',
};

export function formatTimelineDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMs / 3_600_000);

  if (diffMin < 5) return 'AGORA';
  if (diffMin < 60) return `${diffMin}min`;
  if (diffH < 24 && date.getDate() === now.getDate()) return 'HOJE';

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth()) return 'ONTEM';

  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export { typeConfig };

interface LeadTimelineTabProps {
  timeline: TimelineEntry[] | undefined;
}

export function LeadTimelineTab({ timeline }: LeadTimelineTabProps) {
  return (
    <div className="space-y-1">
      {!timeline || timeline.length === 0 ? (
        <p className="py-4 text-center text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Nenhuma interação registrada.
        </p>
      ) : (
        timeline.map((entry) => {
          const ChannelIcon = channelIcon[entry.channel] ?? Mail;
          const label = channelLabel[entry.channel] ?? entry.channel;
          const bgColor = channelColor[entry.channel] ?? 'bg-[var(--muted)]';
          const relDate = formatRelativeDate(entry.created_at);
          const stepLabel = entry.step_order != null ? ` ${entry.step_order}` : '';

          return (
            <div key={entry.id} className="flex gap-3 rounded-lg p-3 hover:bg-[var(--muted)]/50 transition-colors">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${bgColor} text-white`}>
                <ChannelIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {relDate === 'AGORA' && (
                      <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        AGORA
                      </span>
                    )}
                    <span className="text-sm font-semibold">
                      {entry.channel === 'system' && entry.performed_by_name
                        ? entry.performed_by_name
                        : label}{stepLabel}
                    </span>
                    {entry.channel !== 'system' && entry.performed_by_name && (
                      <span className="text-xs text-muted-foreground">por {entry.performed_by_name}</span>
                    )}
                    {entry.ai_generated && (
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">IA</Badge>
                    )}
                    {(entry.metadata as Record<string, unknown> | null)?.source === 'external_api4com' && (
                      <Badge variant="outline" className="h-4 px-1 text-[10px] border-amber-500/50 text-amber-600">Externa</Badge>
                    )}
                    {(entry.metadata as Record<string, unknown> | null)?.manual_send === true && (
                      <Badge
                        variant="outline"
                        className="h-4 px-1 text-[10px] border-sky-500/50 text-sky-600 dark:text-sky-400"
                        title="Enviado manualmente pelo SDR, fora da plataforma"
                      >
                        Manual
                      </Badge>
                    )}
                  </div>
                  {relDate !== 'AGORA' && (
                    <span className="shrink-0 text-[11px] text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                      {relDate}
                    </span>
                  )}
                </div>
                {entry.message_content ? (
                  <div
                    className="mt-1 whitespace-pre-line break-words [overflow-wrap:anywhere] text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)] [&_a]:text-[var(--primary)] [&_a]:underline"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(
                        entry.message_content
                          .replace(/\{\{[^}]+\}\}/g, '')
                          .trim(),
                      ),
                    }}
                  />
                ) : (
                  <p className="mt-1 text-xs italic text-[var(--muted-foreground)] dark:text-[var(--foreground)]/60">
                    Nenhuma anotação
                  </p>
                )}
                {/* Call recording + transcription */}
                {entry.channel === 'phone' && entry.recording_url && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <audio
                        controls
                        preload="none"
                        className="h-8 max-w-[300px]"
                        src={
                          entry.call_id
                            ? `/api/proxy/recording?callId=${entry.call_id}`
                            : `/api/proxy/recording?url=${encodeURIComponent(entry.recording_url)}`
                        }
                      />
                      {entry.call_duration && (
                        <span className="text-[10px] text-muted-foreground">
                          {Math.floor(entry.call_duration / 60)}:{String(entry.call_duration % 60).padStart(2, '0')}
                        </span>
                      )}
                    </div>
                    {entry.transcription && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-primary hover:underline">
                          Ver transcrição
                        </summary>
                        <p className="mt-1 whitespace-pre-line text-muted-foreground bg-muted/30 rounded p-2">
                          {entry.transcription}
                        </p>
                      </details>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
