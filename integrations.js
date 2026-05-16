require('dotenv').config();
const nodemailer = require('nodemailer');

// ── Stripe ────────────────────────────────────
let _stripe = null;
function getStripe() {
  if (!_stripe && process.env.STRIPE_SECRET_KEY) _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}
async function createStripeCustomer(name, email) {
  const s = getStripe(); if (!s) return null;
  try { return await s.customers.create({ name, email }); } catch(e) { console.error('[Stripe]', e.message); return null; }
}
async function createStripeSubscription(customerId, priceId) {
  const s = getStripe(); if (!s) return null;
  try { return await s.subscriptions.create({ customer:customerId, items:[{price:priceId}], payment_behavior:'default_incomplete', expand:['latest_invoice.payment_intent'] }); }
  catch(e) { console.error('[Stripe]', e.message); return null; }
}
async function getStripePortalUrl(customerId, returnUrl) {
  const s = getStripe(); if (!s) return null;
  try { const sess = await s.billingPortal.sessions.create({ customer:customerId, return_url:returnUrl }); return sess.url; }
  catch(e) { console.error('[Stripe]', e.message); return null; }
}

// ── Email ─────────────────────────────────────
function getMailer() {
  if (!process.env.SMTP_USER) return null;
  return nodemailer.createTransport({ host:process.env.SMTP_HOST||'smtp.gmail.com', port:Number(process.env.SMTP_PORT)||587, secure:false, auth:{user:process.env.SMTP_USER, pass:process.env.SMTP_PASS} });
}
async function sendEmail({ to, subject, html, text }) {
  const m = getMailer(); if (!m) return { success:false, reason:'SMTP not configured' };
  try {
    const info = await m.sendMail({ from:process.env.SMTP_FROM||`"NexusCRM" <${process.env.SMTP_USER}>`, to, subject, html:html||text });
    return { success:true, messageId:info.messageId };
  } catch(e) { console.error('[Email]', e.message); return { success:false, reason:e.message }; }
}

// ── Twilio SMS ────────────────────────────────
let _twilio = null;
function getTwilio() {
  if (!_twilio && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
    _twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return _twilio;
}
async function sendSMS(to, body) {
  const c = getTwilio(); if (!c) return { success:false, reason:'Twilio not configured' };
  try { const m = await c.messages.create({ body, from:process.env.TWILIO_FROM_NUMBER, to }); return { success:true, sid:m.sid }; }
  catch(e) { console.error('[Twilio]', e.message); return { success:false, reason:e.message }; }
}

// ── Slack ─────────────────────────────────────
async function sendSlack(text, channel) {
  if (!process.env.SLACK_BOT_TOKEN) return { success:false };
  try {
    const fetch = require('node-fetch');
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.SLACK_BOT_TOKEN}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ channel:channel||process.env.SLACK_CHANNEL||'#general', text })
    });
    const d = await res.json(); return { success:d.ok };
  } catch(e) { return { success:false }; }
}

// ── Google Calendar ───────────────────────────
function googleAuthUrl(tenantId) {
  if (!process.env.GOOGLE_CLIENT_ID) return null;
  const p = new URLSearchParams({ client_id:process.env.GOOGLE_CLIENT_ID, redirect_uri:process.env.GOOGLE_REDIRECT_URI, response_type:'code', scope:'https://www.googleapis.com/auth/calendar', access_type:'offline', state:String(tenantId) });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
async function googleExchangeCode(code) {
  if (!process.env.GOOGLE_CLIENT_ID) return null;
  try {
    const fetch = require('node-fetch');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id:process.env.GOOGLE_CLIENT_ID, client_secret:process.env.GOOGLE_CLIENT_SECRET, redirect_uri:process.env.GOOGLE_REDIRECT_URI, grant_type:'authorization_code' })
    });
    return res.json();
  } catch { return null; }
}
async function createCalendarEvent({ accessToken, title, description, start, end, attendeeEmail }) {
  try {
    const fetch = require('node-fetch');
    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${accessToken}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ summary:title, description, start:{dateTime:start,timeZone:'UTC'}, end:{dateTime:end,timeZone:'UTC'}, attendees:attendeeEmail?[{email:attendeeEmail}]:[] })
    });
    return res.json();
  } catch { return null; }
}

// ── Zapier Webhooks ───────────────────────────
async function fireWebhooks(webhooks, event, payload) {
  const active = webhooks.filter(w => w.enabled && w.events.split(',').includes(event));
  const fetch = require('node-fetch');
  await Promise.allSettled(active.map(w =>
    fetch(w.url, { method:'POST', headers:{ 'Content-Type':'application/json', ...(w.secret?{'X-Nexus-Secret':w.secret}:{}) }, body:JSON.stringify({ event, payload, timestamp:new Date().toISOString() }) })
  ));
}

// ── AI (Anthropic) ────────────────────────────
async function askClaude(messages, systemPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { success:false, reason:'ANTHROPIC_API_KEY not set in .env' };
  try {
    const fetch = require('node-fetch');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'x-api-key':apiKey, 'anthropic-version':'2023-06-01', 'Content-Type':'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: systemPrompt || 'You are NexusCRM AI Assistant. Help the user manage their CRM data, contacts, deals, and business relationships. Be concise and actionable.',
        messages
      })
    });
    const data = await res.json();
    if (data.error) return { success:false, reason:data.error.message };
    return { success:true, content: data.content[0]?.text || '' };
  } catch(e) { return { success:false, reason:e.message }; }
}

// ── WhatsApp Business API ─────────────────────
async function sendWhatsAppBusiness(to, message, templateName) {
  const token   = process.env.WHATSAPP_API_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return { success:false, reason:'WhatsApp Business API not configured. Set WHATSAPP_API_TOKEN and WHATSAPP_PHONE_ID in .env' };
  try {
    const fetch = require('node-fetch');
    const body = templateName
      ? { messaging_product:'whatsapp', to, type:'template', template:{ name:templateName, language:{ code:'en_US' } } }
      : { messaging_product:'whatsapp', to, type:'text', text:{ body:message } };
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) return { success:false, reason:data.error.message };
    return { success:true, messageId:data.messages?.[0]?.id };
  } catch(e) { return { success:false, reason:e.message }; }
}

// ── Deal Score Algorithm ──────────────────────
function calcDealScore(contact) {
  let score = 50;
  const stageScores = { Lead:0, Qualified:15, Proposal:30, Closed:50 };
  score += stageScores[contact.stage] || 0;
  const statusBonus = { Client:20, Partner:15, Lead:0, Churned:-30 };
  score += statusBonus[contact.status] || 0;
  if (contact.last_contact) {
    const days = Math.floor((Date.now() - new Date(contact.last_contact)) / 86400000);
    if (days <= 3) score += 15;
    else if (days <= 7) score += 8;
    else if (days <= 14) score += 0;
    else if (days <= 30) score -= 10;
    else score -= 25;
  }
  if (contact.deal > 50000) score += 5;
  if (contact.deal > 100000) score += 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Follow-up suggestions ─────────────────────
function getFollowUpSuggestions(contacts) {
  return contacts
    .filter(c => c.status !== 'Churned')
    .map(c => {
      const days = c.last_contact ? Math.floor((Date.now()-new Date(c.last_contact))/86400000) : 999;
      const score = calcDealScore(c);
      let priority='low', reason='', action='';
      if (c.status==='Lead' && c.stage==='Proposal' && days>3) { priority='high'; reason=`Proposal pending ${days}d`; action='Send follow-up'; }
      else if (c.status==='Lead' && days>7) { priority='high'; reason=`Lead cold ${days}d`; action='Re-engage'; }
      else if (c.status==='Client' && days>30) { priority='medium'; reason=`Client silent ${days}d`; action='Check-in call'; }
      else if (c.stage==='Qualified' && days>5) { priority='medium'; reason=`Stalled ${days}d`; action='Move to proposal'; }
      else { priority='low'; reason=`Last contact ${days}d ago`; action='Monitor'; }
      return { ...c, daysSince:days, score, priority, reason, action };
    })
    .sort((a,b) => { const p={high:0,medium:1,low:2}; return (p[a.priority]-p[b.priority])||(b.score-a.score); });
}

// ── Revenue Forecast ──────────────────────────
function generateForecast(contacts, invoices) {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const label = d.toLocaleString('default', { month:'short', year:'2-digit' });
    const actual = i === 0
      ? invoices.filter(inv => inv.status==='paid' && inv.paid_at?.startsWith(d.toISOString().slice(0,7))).reduce((s,inv)=>s+(Number(inv.total)||0),0)
      : 0;
    const pipelineContrib = contacts.filter(c => ['Proposal','Qualified'].includes(c.stage)).reduce((s,c)=>s+(Number(c.deal)||0)*((calcDealScore(c)/100)*0.3),0);
    const forecast = Math.round(actual || (pipelineContrib / 6) * (1 + i * 0.05));
    months.push({ month:label, actual, forecast });
  }
  return months;
}

// ── Churn Prediction ──────────────────────────
function getChurnRisk(contacts) {
  return contacts
    .filter(c => c.status === 'Client' || c.status === 'Partner')
    .map(c => {
      const days = c.last_contact ? Math.floor((Date.now()-new Date(c.last_contact))/86400000) : 999;
      let risk = 0;
      if (days > 60) risk += 40;
      else if (days > 30) risk += 20;
      else if (days > 14) risk += 10;
      if (c.stage !== 'Closed') risk += 15;
      if (!c.deal || c.deal === 0) risk += 10;
      const riskLevel = risk >= 50 ? 'high' : risk >= 25 ? 'medium' : 'low';
      return { ...c, churn_risk:risk, risk_level:riskLevel, days_since_contact:days };
    })
    .sort((a,b) => b.churn_risk - a.churn_risk);
}

// ── Template merge ────────────────────────────
function mergeTemplate(body, contact, sender) {
  return (body||'')
    .replace(/\{\{name\}\}/gi,        contact?.name||'there')
    .replace(/\{\{company\}\}/gi,      contact?.company||'your company')
    .replace(/\{\{deal\}\}/gi,         contact?.deal?.toLocaleString()||'0')
    .replace(/\{\{stage\}\}/gi,        contact?.stage||'')
    .replace(/\{\{sender_name\}\}/gi,  sender?.name||'The Team')
    .replace(/\{\{phone\}\}/gi,        contact?.phone||'')
    .replace(/\{\{title\}\}/gi,        contact?.title||'');
}

module.exports = {
  getStripe, createStripeCustomer, createStripeSubscription, getStripePortalUrl,
  sendEmail, sendSMS, sendSlack,
  googleAuthUrl, googleExchangeCode, createCalendarEvent,
  fireWebhooks, askClaude, sendWhatsAppBusiness,
  calcDealScore, getFollowUpSuggestions, generateForecast, getChurnRisk, mergeTemplate,
};
