import { supabase } from './supabase';

/**
 * Send a converted manifest email directly via the Resend API.
 * Looks up the default email account + template from the database,
 * generates a signed URL for the attachment, and calls Resend directly.
 */
export async function sendConvertedManifestEmail(params: {
  warehouseId: string;
  mawb: string;
  shipmentId: string;
  convertedStoragePath: string;
  userEmail?: string | null;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { warehouseId, mawb, shipmentId, convertedStoragePath, userEmail } = params;

  // 1. Fetch default email account for warehouse
  const { data: accounts, error: accountError } = await supabase
    .from('email_accounts')
    .select('id, from_email, from_name, resend_api_key')
    .eq('warehouse_id', warehouseId)
    .eq('is_default', true)
    .limit(1);

  const account = accounts?.[0];
  if (accountError || !account?.resend_api_key) {
    return { success: false, error: `No default email account with Resend API key found for warehouse ${warehouseId}` };
  }

  // 2. Fetch email template
  const { data: templates } = await supabase
    .from('email_templates')
    .select('subject, body, recipients')
    .eq('template_type', 'converted_manifest')
    .limit(1);

  const template = templates?.[0];
  const recipients = template?.recipients;
  if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
    return { success: false, error: 'No recipients configured for converted_manifest template' };
  }

  // 3. Generate signed URL for attachment
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from('shipment-files')
    .createSignedUrl(convertedStoragePath, 3600);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return { success: false, error: `Failed to generate signed URL: ${signedUrlError?.message || 'unknown'}` };
  }

  // 4. Build email content
  const subject = String(template?.subject || 'Converted manifest ({{mawb}})').replace(/\{\{mawb\}\}/g, mawb);
  const bodyText = String(template?.body || 'Dear customs team,\n\nPlease find attached the converted manifest for shipment {{mawb}}.\n\nKind regards').replace(/\{\{mawb\}\}/g, mawb);
  const htmlBody = bodyText.split('\n').map((line) => `<p>${line || '&nbsp;'}</p>`).join('');
  const fromStr = account.from_name ? `${account.from_name} <${account.from_email}>` : account.from_email;

  // 5. Call Resend API directly
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${account.resend_api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromStr,
      to: Array.isArray(recipients) ? recipients : [recipients],
      subject,
      html: htmlBody,
      attachments: [{
        filename: `${mawb.replace(/\D/g, '')}_customs_converted.xlsx`,
        path: signedUrlData.signedUrl,
      }],
    }),
  });

  const resendData = await response.json();
  if (!response.ok) {
    console.error('[sendConvertedManifestEmail] Resend API error', resendData);
    return { success: false, error: resendData?.message || 'Resend API error' };
  }

  // 6. Record email_sent metadata
  if (userEmail) {
    await supabase
      .from('shipment_files')
      .update({ email_sent_at: new Date().toISOString(), email_sent_by: userEmail })
      .eq('shipment_id', shipmentId)
      .eq('file_type', 'manifest_converted');
  }

  return { success: true, id: resendData.id };
}

/**
 * Send a generic email via Resend API using the specified email account.
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

  const { data: account, error: accountError } = await supabase
    .from('email_accounts')
    .select('from_email, from_name, resend_api_key')
    .eq('id', emailAccountId)
    .single();

  if (accountError || !account?.resend_api_key) {
    return { success: false, error: 'Email account not found or no API key configured' };
  }

  const fromStr = account.from_name ? `${account.from_name} <${account.from_email}>` : account.from_email;
  const emailPayload: Record<string, unknown> = {
    from: fromStr,
    to: Array.isArray(to) ? to : String(to).split(',').map((e: string) => e.trim()),
    subject,
    html,
  };

  if (attachments && attachments.length > 0) {
    emailPayload.attachments = attachments;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${account.resend_api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emailPayload),
  });

  const resendData = await response.json();
  if (!response.ok) {
    console.error('[sendEmailViaResend] Resend API error', resendData);
    return { success: false, error: resendData?.message || 'Resend API error' };
  }

  // Update inspection records if applicable
  if (inspectionIds && inspectionIds.length > 0 && userEmail) {
    await supabase
      .from('inspections')
      .update({ email_sent_at: new Date().toISOString(), email_sent_by: userEmail })
      .in('id', inspectionIds);
  }

  return { success: true, id: resendData.id };
}
