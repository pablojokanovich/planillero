import { handleDepartureEmail } from '../_shared/departure-mailer.mjs';

Deno.serve((request: Request) => handleDepartureEmail(request, {
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  provider: Deno.env.get('NOTIFICATION_PROVIDER') || 'microsoft365',
  microsoftTenantId: Deno.env.get('M365_TENANT_ID'),
  microsoftClientId: Deno.env.get('M365_CLIENT_ID'),
  microsoftClientSecret: Deno.env.get('M365_CLIENT_SECRET'),
  resendKey: Deno.env.get('RESEND_API_KEY'),
  from: Deno.env.get('NOTIFICATION_FROM'),
  webhookSecret: Deno.env.get('DEPARTURE_WEBHOOK_SECRET'),
}));
