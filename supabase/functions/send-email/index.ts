import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { email_account_id, to, subject, html, inspection_ids, attachments } = body;

    if (!email_account_id || !to || !subject || !html) {
      return new Response(JSON.stringify({ error: 'Missing required fields: email_account_id, to, subject, html' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch the email account to get Resend API key
    const { data: account, error: accError } = await supabase
      .from('email_accounts')
      .select('from_email, from_name, resend_api_key')
      .eq('id', email_account_id)
      .single();

    if (accError || !account) {
      return new Response(JSON.stringify({ error: 'Email account not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!account.resend_api_key) {
      return new Response(JSON.stringify({ error: 'No Resend API key configured for this email account' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send via Resend API
    const fromStr = account.from_name
      ? `${account.from_name} <${account.from_email}>`
      : account.from_email;

    const emailPayload: any = {
      from: fromStr,
      to: Array.isArray(to) ? to : to.split(',').map((e: string) => e.trim()),
      subject,
      html,
    };

    // Add attachments if provided (Resend format: [{filename, path}] or [{filename, content}])
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      emailPayload.attachments = attachments;
    }

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${account.resend_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('Resend API error:', resendData);
      return new Response(JSON.stringify({ error: 'Resend API error', details: resendData }), {
        status: resendResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If inspection_ids provided, mark them as email sent
    if (inspection_ids && Array.isArray(inspection_ids) && inspection_ids.length > 0) {
      const { error: updateError } = await supabase
        .from('inspections')
        .update({
          email_sent_at: new Date().toISOString(),
          email_sent_by: user.email,
        })
        .in('id', inspection_ids);

      if (updateError) {
        console.error('Failed to update inspection records:', updateError);
      }
    }

    return new Response(JSON.stringify({ success: true, id: resendData.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('send-email error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
