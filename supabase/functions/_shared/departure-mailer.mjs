import { mailConfigured, createMailSender } from './mail-transport.mjs';

function dateTime(value) {
  const text = String(value || '');
  return text ? `${text.slice(0, 10).split('-').reverse().join('/')} ${text.slice(11, 16)}` : 'Sin horario';
}
export function departureEmail(row) {
  const stops = (row.stops || []).map((stop, index) => `${index + 1}. ${stop.destination}${stop.address ? ` (${stop.address})` : ''}. Llegada: ${dateTime(stop.eta)}`).join('\n');
  return {
    subject: `Nueva salida: ${row.truck_type} - ${dateTime(row.departure_at)}`,
    text: `Nueva salida de camiones\n\nCamion: ${row.truck_type}\nChofer: ${row.driver}\nOrigen: ${row.origin}\nCarga: ${dateTime(row.loading_at)}\nSalida: ${dateTime(row.departure_at)}\n\nRecorrido:\n${stops}`
  };
}
export async function handleDepartureEmail(request, env, fetcher = fetch) {
  const reply = (status, body) => Response.json(body, { status });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  if (!env.webhookSecret) return reply(503, { error: 'Notifications not configured' });
  if (request.headers.get('x-webhook-secret') !== env.webhookSecret) return reply(401, { error: 'Unauthorized' });
  if (!env.supabaseUrl || !env.serviceKey || !mailConfigured(env)) return reply(503, { error: 'Email service not configured' });
  let payload;
  try { payload = await request.json(); } catch (error) { return reply(400, { error: 'Invalid payload' }); }
  if (payload.type !== 'INSERT' || payload.table !== 'logistics_departures' || payload.schema !== 'public') return reply(200, { skipped: true });
  const id = payload.record?.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) return reply(400, { error: 'Invalid departure' });
  async function database(path, options = {}) {
    const res = await fetcher(`${env.supabaseUrl}/rest/v1/${path}`, { ...options, signal: AbortSignal.timeout(10000), headers: {
      apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json', ...options.headers
    } });
    if (!res.ok) throw new Error('Database request failed');
    return res.status === 204 ? null : res.json();
  }
  try {
    const [row] = await database(`logistics_departures?id=eq.${id}&select=*`);
    if (!row || row.deleted || !row.created_by) return reply(200, { skipped: true, reason: 'No verified creator' });
    const admins = await database(`departure_notification_admins?user_id=eq.${encodeURIComponent(row.created_by)}&select=user_id`);
    if (!admins.length) return reply(200, { skipped: true, reason: 'Creator not authorized' });
    const recipients = await database('departure_notification_recipients?enabled=eq.true&select=id,email&order=id.asc');
    const deliveries = await database(`departure_notification_deliveries?departure_id=eq.${id}&select=recipient_id`);
    const sent = new Set(deliveries.map(item => item.recipient_id));
    // Compose from the original INSERT so retries use an identical provider payload.
    const message = departureEmail(payload.record);
    const send = createMailSender(env, fetcher);
    let count = 0;
    let failed = 0;
    for (const recipient of recipients) {
      if (sent.has(recipient.id)) continue;
      try {
        const providerId = await send(recipient, message, `departure-${id}-${recipient.id}`);
        await database('departure_notification_deliveries?on_conflict=departure_id,recipient_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify({ departure_id: id, recipient_id: recipient.id, provider_id: providerId }) });
        count++;
      } catch (error) { failed++; }
    }
    return reply(failed ? 502 : 200, { sent: count, failed });
  } catch (error) { return reply(502, { error: 'Notification processing failed' }); }
}
