import { supabase } from './supabase';

/**
 * Send a converted manifest email.
 * Reads template + email account client-side, then calls Edge Function with explicit fields.
 */
export async function sendConvertedManifestEmail(params: {
  warehouseId: string;
  mawb: string;
  shipmentId: string;
  convertedStoragePath: string;
  userEmail?: string | null;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { warehouseId, mawb, shipmentId, convertedStoragePath, userEmail } = params;

  // 1. Fetch email account for this warehouse
  const { data: accounts, error: accountError } = await supabase
    .from('email_accounts')
    .select('id, from_email, from_name, resend_api_key')
    .eq('warehouse_id', warehouseId)
    .eq('is_default', true)
    .limit(1);

  const account = accounts?.[0];
  console.log('[ResendEmail] Account lookup', { found: accounts?.length ?? 0, hasKey: !!account?.resend_api_key, error: accountError?.message });

  if (accountError || !account?.id) {
    return { success: false, error: `No default email account found for warehouse: ${accountError?.message || 'not found'}` };
  }

  // 2. Fetch email template
  const { data: templates, error: templateError } = await supabase
    .from('email_templates')
    .select('subject, body, recipients')
    .eq('template_type', 'converted_manifest')
    .limit(1);

  const template = templates?.[0];
  console.log('[ResendEmail] Template lookup', { found: templates?.length ?? 0, recipients: template?.recipients, error: templateError?.message });

  if (templateError || !template?.recipients) {
    return { success: false, error: `No recipients in converted_manifest template: ${templateError?.message || 'empty recipients'}` };
  }

  // 3. Parse recipients
  const toArray = typeof template.recipients === 'string'
    ? template.recipients.split(',').map((r: string) => r.trim()).filter(Boolean)
    : Array.isArray(template.recipients) ? template.recipients : [];

  console.log('[ResendEmail] To array:', toArray);

  if (toArray.length === 0) {
    return { success: false, error: 'No valid recipients after parsing template.recipients' };
  }

  // 4. Generate signed URL for attachment
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('shipment-files')
    .createSignedUrl(convertedStoragePath, 3600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return { success: false, error: `Failed to generate signed URL: ${signedUrlError?.message || 'unknown'}` };
  }

  // 5. Build email content
  const subject = String(template.subject || 'Converted manifest ({{mawb}})').replace(/\{\{mawb\}\}/g, mawb);
  const bodyText = String(template.body || 'Dear customs team,\n\nPlease find attached the converted manifest for shipment {{mawb}}.\n\nKind regards').replace(/\{\{mawb\}\}/g, mawb);
  const htmlBody = bodyText.split('\n').map((line: string) => `<p>${line || '&nbsp;'}</p>`).join('');

  // 6. Call Edge Function with explicit fields (generic path, no mode)
  const { data, error } = await supabase.functions.invoke('send-email', {
    body: {
      email_account_id: account.id,
      resend_api_key: account.resend_api_key,
      from: account.from_name ? `${account.from_name} <${account.from_email}>` : account.from_email,
      to: toArray,
      subject,
      html: htmlBody,
      attachments: [{
        filename: `${mawb.replace(/\D/g, '')}_customs_converted.xlsx`,
        path: signedUrlData.signedUrl,
      }],
    },
  });

  if (error) {
    console.error('[sendConvertedManifestEmail] Edge Function error', error);
    return { success: false, error: error.message || 'Edge Function error' };
  }

  if (data?.error) {
    return { success: false, error: data.error };
  }

  // 7. Update shipment_files record
  if (userEmail) {
    await supabase
      .from('shipment_files')
      .update({ email_sent_at: new Date().toISOString(), email_sent_by: userEmail })
      .eq('shipment_id', shipmentId)
      .eq('file_type', 'manifest_converted');
  }

  console.log('[sendConvertedManifestEmail] ✅ Email sent', { id: data?.id });
  return { success: true, id: data?.id };
}

/**
 * Send a generic email via the send-email Edge Function.
 */
export async function sendEmailViaResend(params: {
  emailAccountId: string;
  to: string | string[];
  subject: string;
  html: string;
  inspectionIds?: string[];
  userEmail?: string | null;
  attachments?: Array<{ filename: string; content?: string; path?: string }>;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { emailAccountId, to, subject, html, inspectionIds, userEmail, attachments } = params;

  const { data, error } = await supabase.functions.invoke('send-email', {
    body: {
      email_account_id: emailAccountId,
      to: Array.isArray(to) ? to : String(to).split(',').map((e: string) => e.trim()),
      subject,
      html,
      inspection_ids: inspectionIds,
      attachments,
      // Note: resend_api_key should be passed by caller if the deployed function requires it
    },
  });

  if (error) {
    console.error('[sendEmailViaResend] Edge Function error', error);
    return { success: false, error: error.message || 'Edge Function error' };
  }

  if (data?.error) {
    return { success: false, error: data.error };
  }

  return { success: true, id: data?.id };
}
