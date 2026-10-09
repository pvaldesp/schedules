import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
// Small .env reader keeps this prototype dependency-free. In production use the platform's secret store.
try {
  for (const line of (await readFile(path.join(root, '.env'), 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const port = Number(process.env.PORT || 3000);
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };
const send = (res, status, data, type='application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type':type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(typeof data === 'string' ? data : JSON.stringify(data)); };
const readJson = async req => { let body=''; for await (const part of req) body += part; if(body.length>10000) throw new Error('Solicitud demasiado grande'); return JSON.parse(body || '{}'); };
const list = x => Array.isArray(x) ? x : (x?.data || x?.results || x?.routes || x?.schedules || x?.pointToPointRoutes || x?.items || []);
const date = v => v ? String(v).slice(0,10) : '';

function normalizeMaersk(payload) {
  return list(payload).map((r,i) => {
    const legs = r.transportPlan?.transportPlanSteps || r.legs || r.route?.legs || [];
    const first = legs[0] || r;
    const last = legs.at(-1) || r;
    const origin = first.departure || first.origin || {};
    const dest = last.arrival || last.destination || {};
    return { id:`MAEU-${i}-${r.voyageNumber || ''}`, carrier:'Maersk', vessel:first.vessel?.name || r.vesselName || 'Buque por confirmar', voyage:first.voyageNumber || r.voyageNumber || '—', origin:origin.location?.locationName || origin.location?.UNLocationCode || origin.locationName || origin.portName || 'Origen solicitado', destination:dest.location?.locationName || dest.location?.UNLocationCode || dest.locationName || dest.portName || 'Destino solicitado', etd:date(origin.dateTime || origin.estimatedDepartureDateTime || r.departureDate), eta:date(dest.dateTime || dest.estimatedArrivalDateTime || r.arrivalDate), transitDays:r.transitTime || r.transitDays || null, transshipments:Math.max(0, legs.length-1), stops:legs.map(x=>x.vessel?.name).filter(Boolean) };
  });
}
function normalizeCma(payload) {
  return list(payload).map((r,i) => {
    const legs = r.legs || r.route?.legs || r.routing?.legs || [];
    const first = legs[0] || r;
    const last = legs.at(-1) || r;
    const dep = first.departure || first.from || first;
    const arr = last.arrival || last.to || last;
    return { id:`CMA-${i}-${r.routingReference || ''}`, carrier:'CMA CGM', vessel:first.vessel?.name || first.vesselName || r.vesselName || 'Buque por confirmar', voyage:first.voyageNumber || first.voyage || r.voyageNumber || '—', origin:dep.location?.locationName || dep.location?.UNLocationCode || dep.locationName || dep.portName || 'Origen solicitado', destination:arr.location?.locationName || arr.location?.UNLocationCode || arr.locationName || arr.portName || 'Destino solicitado', etd:date(dep.dateTime || dep.estimatedDepartureDateTime || dep.date), eta:date(arr.dateTime || arr.estimatedArrivalDateTime || arr.date), transitDays:r.transitTime || r.transitDays || null, transshipments:Math.max(0, legs.length-1), stops:legs.map(x=>x.vessel?.name || x.vesselName).filter(Boolean) };
  });
}

async function searchMaersk(q) {
  if (!process.env.MAERSK_CONSUMER_KEY) throw new Error('Falta MAERSK_CONSUMER_KEY. Configura la credencial emitida en el portal oficial.');
  const params = new URLSearchParams({ collectionOriginCountryCode:q.originCountry, collectionOriginCityName:q.originCity, deliveryDestinationCountryCode:q.destCountry, deliveryDestinationCityName:q.destCity, dateFrom:q.dateFrom, dateTo:q.dateTo, vesselOperatorCarrierCode:'MAEU' });
  const response = await fetch(`https://api.maersk.com/products/ocean-products/point-to-point?${params}`, { headers:{ 'Consumer-Key':process.env.MAERSK_CONSUMER_KEY, 'Accept':'application/json' }, signal:AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Maersk respondió ${response.status}. Verifica acceso, parámetro/códigos de ubicación y credenciales.`);
  return normalizeMaersk(await response.json());
}
async function searchCma(q) {
  if (!process.env.CMA_API_KEY) throw new Error('Falta CMA_API_KEY. Suscribe el producto Routing Finder en el portal de CMA CGM.');
  // The CMA CGM portal defines the operation and security scheme. Keep the endpoint configurable
  // because pilot/production subscriptions expose their own base URLs and parameter names.
  const base = process.env.CMA_ROUTING_URL;
  const endpoint = process.env.CMA_ROUTING_PATH || '/v2/routings';
  const params = new URLSearchParams({ placeOfLoading:q.originCode, placeOfDischarge:q.destCode, departureDateFrom:q.dateFrom, departureDateTo:q.dateTo });
  const headers = { 'Accept':'application/json', 'x-api-key':process.env.CMA_API_KEY };
  if (process.env.CMA_CLIENT_ID && process.env.CMA_CLIENT_SECRET && process.env.CMA_TOKEN_URL) {
    const tokenRes = await fetch(process.env.CMA_TOKEN_URL, { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body:new URLSearchParams({ grant_type:'client_credentials', client_id:process.env.CMA_CLIENT_ID, client_secret:process.env.CMA_CLIENT_SECRET }), signal:AbortSignal.timeout(15000) });
    if (!tokenRes.ok) throw new Error(`CMA CGM OAuth respondió ${tokenRes.status}. Verifica suscripción y credenciales.`);
    headers.Authorization = `Bearer ${(await tokenRes.json()).access_token}`;
  }
  const response = await fetch(`${base.replace(/\/$/,'')}${endpoint}?${params}`, { headers, signal:AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`CMA CGM respondió ${response.status}. Confirma en Swagger del producto la URL, nombres de parámetros y esquema de autenticación de tu suscripción.`);
  return normalizeCma(await response.json());
}

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/status' && req.method === 'GET') return send(res,200,{ maersk:!!process.env.MAERSK_CONSUMER_KEY, cma:!!process.env.CMA_API_KEY, mode:process.env.MAERSK_CONSUMER_KEY || process.env.CMA_API_KEY ? 'live-ready':'demo' });
  if (url.pathname === '/api/search' && req.method === 'POST') {
    try {
      const q = await readJson(req);
      if (!q.originCity || !q.destCity || !q.dateFrom || !q.dateTo) return send(res,400,{ error:'Completa origen, destino y rango de fechas.' });
      if (q.dateTo < q.dateFrom) return send(res,400,{ error:'La fecha final debe ser igual o posterior a la inicial.' });
      if (q.mode === 'demo') return send(res,200,{ mode:'demo', results:demoResults(q) });
      const carriers = q.carriers || ['maersk','cma'];
      const results = await Promise.allSettled(carriers.map(c => c === 'maersk' ? searchMaersk(q) : searchCma(q)));
      const merged = results.flatMap(x => x.status === 'fulfilled' ? x.value : []);
      const errors = results.map((x,i) => x.status === 'rejected' ? { carrier:carriers[i], message:x.reason?.message || 'Error de conexión' } : null).filter(Boolean);
      return send(res,200,{ mode:'live', results:merged, errors, fetchedAt:new Date().toISOString() });
    } catch(e) { return send(res,400,{ error:e.message || 'No se pudo procesar la búsqueda.' }); }
  }
  const file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const full = path.resolve(root,file);
  if (!full.startsWith(root + path.sep)) return send(res,403,{error:'Forbidden'});
  try { const data=await readFile(full); send(res,200,data,mime[path.extname(full)]||'application/octet-stream'); } catch { send(res,404,'No encontrado','text/plain; charset=utf-8'); }
});

function demoResults(q) {
  const out=[];
  if ((q.carriers||[]).includes('maersk')) out.push({ id:'demo-m', carrier:'Maersk', vessel:'Maersk Seletar', voyage:'628W', origin:q.originCity, destination:q.destCity, etd:q.dateFrom, eta:new Date(Date.parse(q.dateFrom+'T00:00:00Z')+25*86400000).toISOString().slice(0,10), transitDays:25, transshipments:1, stops:['Maersk Seletar','Maersk Seletar'] });
  if ((q.carriers||[]).includes('cma')) out.push({ id:'demo-c', carrier:'CMA CGM', vessel:'CMA CGM Jacques Saadé', voyage:'0ME8JW1MA', origin:q.originCity, destination:q.destCity, etd:new Date(Date.parse(q.dateFrom+'T00:00:00Z')+3*86400000).toISOString().slice(0,10), eta:new Date(Date.parse(q.dateFrom+'T00:00:00Z')+31*86400000).toISOString().slice(0,10), transitDays:28, transshipments:0, stops:['CMA CGM Jacques Saadé'] });
  return out;
}
server.listen(port,()=>console.log(`Sailings Hub disponible en http://localhost:${port}`));
