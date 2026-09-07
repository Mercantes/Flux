'use server';

import { revalidatePath } from 'next/cache';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { logAudit } from '@/lib/audit/audit-log';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { logLeadEvent } from './log-lead-event';
import { recalcFitScoreForLead } from './recalc-fit-scores';
import { normalizeOriginFields } from '../schemas/lead.schemas';
import { leadFieldLabel } from '../constants/lead-field-labels';

/**
 * Resume paused enrollments when lead data is updated.
 * Finds enrollments paused due to missing email/phone and reactivates them.
 */
async function resumePausedEnrollments(
  supabase: SupabaseClient,
  leadId: string,
  reasons: string[],
): Promise<number> {
  // Find paused enrollments that have a failed interaction with one of the given reasons
  const { data: failedInteractions } = (await from(supabase, 'interactions')
    .select('cadence_id')
    .eq('lead_id', leadId)
    .eq('type', 'failed')
    .in('metadata->>error', reasons)
  ) as { data: Array<{ cadence_id: string }> | null };

  if (!failedInteractions?.length) return 0;

  const cadenceIds = [...new Set(failedInteractions.map((i) => i.cadence_id))];

  // Resume only enrollments that are paused AND belong to active cadences
  const { data: updated } = (await from(supabase, 'cadence_enrollments')
    .update({ status: 'active' } as Record<string, unknown>)
    .eq('lead_id', leadId)
    .eq('status', 'paused')
    .in('cadence_id', cadenceIds)
    .select('id')
  ) as { data: Array<{ id: string }> | null };

  const count = updated?.length ?? 0;
  if (count > 0) {
    console.warn(`[lead-update] Resumed ${count} paused enrollments for lead=${leadId} reasons=${reasons.join(',')}`);
  }
  return count;
}

export async function updateLead(
  leadId: string,
  updates: Record<string, unknown>,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Only allow safe fields
  const safeFields = ['razao_social', 'nome_fantasia', 'email', 'emails', 'telefone', 'phones', 'status', 'notes', 'socios', 'instagram', 'linkedin', 'website', 'first_name', 'last_name', 'job_title', 'lead_source', 'canal', 'segmento', 'cnpj', 'is_inbound', 'email_bounced_at', 'whatsapp_invalid_at', 'custom_field_values', 'closer_id', 'assigned_to', 'faturamento_estimado', 'won_at', 'meeting_held_at'];
  const safeUpdates: Record<string, unknown> = {};
  for (const key of safeFields) {
    if (key in updates) {
      safeUpdates[key] = updates[key];
    }
  }

  if (Object.keys(safeUpdates).length === 0) {
    return { success: false, error: 'Nenhum campo válido para atualizar' };
  }

  // Valida o enum de status antes de persistir: `updates` chega como Record
  // arbitrário, e um status inválido caía num erro genérico de banco (23514).
  // (Phones em formato string já são tolerados pelo resolver — #319 — então não
  // há bug de fila por essa via; aqui blindamos só o enum.)
  if ('status' in safeUpdates) {
    const parsed = z
      .enum(['new', 'contacted', 'qualified', 'won', 'unqualified', 'archived'])
      .safeParse(safeUpdates.status);
    if (!parsed.success) {
      return { success: false, error: `Status inválido: ${String(safeUpdates.status)}` };
    }
    safeUpdates.status = parsed.data;
  }

  // Sanitize CNPJ: strip formatting (dots, slashes, hyphens) and convert empty to null
  if ('cnpj' in safeUpdates) {
    const rawCnpj = (safeUpdates.cnpj as string)?.replace(/\D/g, '').trim();
    safeUpdates.cnpj = rawCnpj ? rawCnpj : null;
  }
  if ('canal' in safeUpdates && !(safeUpdates.canal as string)?.trim()) {
    delete safeUpdates.canal;
  }

  // Normalize lead_source/canal: only Outbound/Blackbox/Leadbroker valid as Origem;
  // any other value moves to canal as sub-origem.
  if ('lead_source' in safeUpdates) {
    const norm = normalizeOriginFields(
      safeUpdates.lead_source as string | null,
      ('canal' in safeUpdates ? safeUpdates.canal : undefined) as string | null | undefined,
    );
    safeUpdates.lead_source = norm.lead_source;
    if (norm.canal !== null && norm.canal !== undefined) {
      safeUpdates.canal = norm.canal;
    }
  }

  // Auto-set stage timestamps when status changes — covers manual status
  // edits via the lead detail UI. qualified_at fires when SDR pushes the lead
  // forward (manual flip mirrors what scheduleMeeting does). won_at is NOT
  // stamped here: it's reserved for /api/feedback (result=meeting_done), so
  // the dashboard "Oportunidades" only counts realized meetings.
  if ('status' in safeUpdates) {
    const now = new Date().toISOString();
    const statusTimestamps: Record<string, string> = {
      contacted: 'contacted_at',
      qualified: 'qualified_at',
      unqualified: 'lost_at',
      archived: 'archived_at',
    };
    const tsField = statusTimestamps[safeUpdates.status as string];
    if (tsField) safeUpdates[tsField] = now;
  }

  // Fetch current lead to detect changes (for audit + email/phone resume)
  const { data: currentLead } = (await from(supabase, 'leads')
    .select('*')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .single()) as { data: Record<string, unknown> | null };

  // If email is being updated and it changed, clear bounce flag
  const newEmail = safeUpdates.email as string | undefined;
  const emailChanged = newEmail !== undefined && newEmail !== (currentLead?.email as string | null) && newEmail;
  if (emailChanged && currentLead?.email_bounced_at) {
    safeUpdates.email_bounced_at = null;
  }

  // If phone/phones is being updated and it changed, clear whatsapp_invalid flag
  const phoneFieldChanged =
    ('telefone' in safeUpdates && safeUpdates.telefone !== currentLead?.telefone) ||
    ('phones' in safeUpdates && JSON.stringify(safeUpdates.phones) !== JSON.stringify(currentLead?.phones));
  if (phoneFieldChanged && currentLead?.whatsapp_invalid_at) {
    safeUpdates.whatsapp_invalid_at = null;
  }

  const { error } = await from(supabase, 'leads')
    .update(safeUpdates as Record<string, unknown>)
    .eq('id', leadId)
    .eq('org_id', orgId);

  if (error) {
    console.error('[updateLead] Error:', error.message, 'Fields:', Object.keys(safeUpdates));

    const pgCode = (error as { code?: string }).code;
    if (pgCode === '23505' && 'cnpj' in safeUpdates && typeof safeUpdates.cnpj === 'string') {
      const attemptedCnpj = safeUpdates.cnpj;
      const { data: conflict } = (await from(supabase, 'leads')
        .select('id, nome_fantasia, razao_social, assigned_to')
        .eq('org_id', orgId)
        .eq('cnpj', attemptedCnpj)
        .is('deleted_at', null)
        .neq('id', leadId)
        .maybeSingle()) as { data: { id: string; nome_fantasia: string | null; razao_social: string | null; assigned_to: string | null } | null };
      const conflictName = conflict?.nome_fantasia ?? conflict?.razao_social ?? 'outro lead';
      return {
        success: false,
        error: `Já existe um lead com esse CNPJ na sua organização: "${conflictName}". Edite ou arquive o lead existente antes de reutilizar este CNPJ.`,
      };
    }

    return { success: false, error: 'Erro ao atualizar lead. Tente novamente.' };
  }

  // Auto-complete cadence enrollments when lead is finalized (won, lost, archived)
  if ('status' in safeUpdates) {
    const finalStatuses = ['qualified', 'won', 'unqualified', 'archived'];
    if (finalStatuses.includes(safeUpdates.status as string)) {
      const { createServiceRoleClient: createSvc } = await import('@/lib/supabase/service');
      const svc = createSvc();
      await from(svc, 'cadence_enrollments')
        .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
        .eq('lead_id', leadId)
        .in('status', ['active', 'paused']);
    }
  }

  // Log field changes to audit log
  if (currentLead) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, newVal] of Object.entries(safeUpdates)) {
      const oldVal = currentLead[key];
      // Compare serialized values to handle objects (custom_field_values, phones, socios)
      if (JSON.stringify(oldVal ?? null) !== JSON.stringify(newVal ?? null)) {
        changes[key] = { from: oldVal ?? null, to: newVal ?? null };
      }
    }
    if (Object.keys(changes).length > 0) {
      logAudit({
        orgId,
        userId: auth.data.userId,
        action: 'lead.fields_updated',
        resourceType: 'lead',
        resourceId: leadId,
        metadata: { changes },
      });

      // Skip complex object fields (phones, socios, emails) from the message — they're in metadata
      const skipFields = new Set(['phones', 'socios', 'emails']);
      const changeDescriptions: string[] = [];
      // Keep the timeline event compact: long values (BANT text, ad-library
      // URLs, etc.) are truncated here — the full before/after lives in
      // metadata.changes and is shown in the lead audit tab.
      const truncate = (s: string, max = 80): string =>
        s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
      for (const [key, change] of Object.entries(changes)) {
        if (skipFields.has(key)) continue;
        const oldVal = change.from;
        const newVal = change.to;

        // Special handling for custom_field_values: lookup field name by UUID
        if (key === 'custom_field_values') {
          const fromObj = (oldVal ?? {}) as Record<string, string>;
          const toObj = (newVal ?? {}) as Record<string, string>;
          const allFieldIds = new Set([...Object.keys(fromObj), ...Object.keys(toObj)]);
          if (allFieldIds.size > 0) {
            const { data: cfDefs } = (await from(supabase, 'custom_fields')
              .select('id, field_name')
              .in('id', [...allFieldIds])) as { data: Array<{ id: string; field_name: string }> | null };
            const cfNameMap = new Map((cfDefs ?? []).map((f) => [f.id, f.field_name]));
            for (const fieldId of allFieldIds) {
              const fieldName = cfNameMap.get(fieldId) ?? fieldId.slice(0, 8);
              const oldStr = String(fromObj[fieldId] ?? '').trim() || '(vazio)';
              const newStr = String(toObj[fieldId] ?? '').trim() || '(vazio)';
              if (oldStr !== newStr) {
                changeDescriptions.push(`${fieldName}: ${truncate(oldStr)} → ${truncate(newStr)}`);
              }
            }
          }
          continue;
        }

        const label = leadFieldLabel(key);
        let fromStr = oldVal != null && oldVal !== '' && typeof oldVal !== 'object' ? String(oldVal) : '(vazio)';
        let toStr = newVal != null && newVal !== '' && typeof newVal !== 'object' ? String(newVal) : '(vazio)';

        // Resolve closer_id UUIDs to names
        if (key === 'closer_id') {
          const closerIds = [oldVal, newVal].filter((v): v is string => typeof v === 'string' && v.length > 0);
          if (closerIds.length > 0) {
            const { data: closers } = await from(supabase, 'closers')
              .select('id, name')
              .in('id', closerIds) as { data: Array<{ id: string; name: string }> | null };
            const closerMap = new Map((closers ?? []).map((c) => [c.id, c.name]));
            if (typeof oldVal === 'string' && closerMap.has(oldVal)) fromStr = closerMap.get(oldVal)!;
            if (typeof newVal === 'string' && closerMap.has(newVal)) toStr = closerMap.get(newVal)!;
          }
        }

        changeDescriptions.push(`${label}: ${truncate(fromStr)} → ${truncate(toStr)}`);
      }
      logLeadEvent(supabase, {
        orgId,
        leadId,
        userId: auth.data.userId,
        event: 'fields_updated',
        message: changeDescriptions.join('\n'),
        metadata: { changes },
      });
    }
  }

  // Resume paused enrollments when email/phone is added or changed
  const newTelefone = safeUpdates.telefone as string | undefined;
  const telefoneChanged = newTelefone !== undefined && newTelefone !== (currentLead?.telefone as string | null) && newTelefone;

  if (emailChanged || telefoneChanged) {
    const reasons: string[] = [];
    if (emailChanged) reasons.push('no_lead_email', 'email_bounced');
    if (telefoneChanged) reasons.push('invalid_phone');
    resumePausedEnrollments(supabase, leadId, reasons).catch((err) => {
      console.error('[lead-update] Failed to resume paused enrollments:', err);
    });
  }

  // Recalc fit score if relevant fields changed
  const fitScoreFields = ['razao_social', 'nome_fantasia', 'email', 'telefone', 'notes'];
  const hasRelevantChange = fitScoreFields.some((f) => f in safeUpdates);
  if (hasRelevantChange) {
    recalcFitScoreForLead(supabase, leadId, orgId).catch((err) => {
      console.error('[lead-update] Failed to recalc fit score:', err);
    });
  }

  revalidatePath('/leads');
  revalidatePath(`/leads/${leadId}`);

  return { success: true, data: undefined };
}
