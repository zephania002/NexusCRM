/*
  NexusCRM v4 — server.js
  Universal All-in-One CRM
  Run: npm install && node server.js
  http://localhost:3000
  admin@nexuscrm.com / Admin@2025!
*/
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const path    = require('path');

const { db, q }   = require('./db');
const { authenticate, adminOnly, generateToken } = require('./middleware');
const integ       = require('./integrations');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use('/api/billing/webhook', express.raw({ type:'application/json' }));
app.use(cors()); app.use(express.json());
app.use(express.static(path.join(__dirname)));

const getTenant = req => q.getTenantById(req.user.tenantId);

// ── Reminder scheduler (every 5 min) ─────────
setInterval(async () => {
  const due = q.getPendingReminders();
  for (const r of due) {
    const contact = db.get('contacts').find({id:r.contact_id}).value();
    if (!contact) continue;
    const msg = integ.mergeTemplate(r.message, contact, {name:'NexusCRM'});
    if (r.channel==='email' && contact.email) await integ.sendEmail({to:contact.email, subject:`Follow-up: ${contact.name}`, html:msg});
    if (r.channel==='sms' && (contact.phone||contact.whatsapp)) await integ.sendSMS(contact.phone||contact.whatsapp, msg);
    q.createMessage(r.tenant_id, r.contact_id, r.user_id, r.channel, 'outbound', `[Auto] ${msg}`, null, 'sent');
    const nextDue = r.repeat_days ? new Date(Date.now()+r.repeat_days*86400000).toISOString() : null;
    q.completeReminder(r.id, nextDue);
  }
}, 5*60*1000);

// ── Automation flow runner ─────────────────────
async function runAutomations(tid, trigger, contact) {
  const flows = q.getAllFlows(tid).filter(f => f.status==='active' && f.trigger===trigger);
  for (const flow of flows) {
    try {
      const conditions = JSON.parse(flow.conditions||'[]');
      const pass = conditions.every(c => {
        if (c.field==='status') return contact[c.field] === c.value;
        if (c.field==='days') return Math.floor((Date.now()-new Date(contact.last_contact||Date.now()))/86400000) >= Number(c.value);
        return true;
      });
      if (!pass) continue;
      const actions = JSON.parse(flow.actions||'[]');
      for (const action of actions) {
        if (action.type==='send_email') {
          const tpl = q.getTemplates(tid).find(t=>t.name===action.template);
          if (tpl && contact.email) {
            const body = integ.mergeTemplate(tpl.body, contact, {name:'NexusCRM'});
            const subj = integ.mergeTemplate(tpl.subject||'', contact, {name:'NexusCRM'});
            await integ.sendEmail({to:contact.email, subject:subj, html:body});
          }
        } else if (action.type==='set_reminder') {
          q.createReminder(tid, contact.id, flow.created_by, 'follow_up', 'email', `Follow up with ${contact.name}`, new Date(Date.now()+(action.days||3)*86400000).toISOString(), null);
        }
      }
      db.get('automation_flows').find({id:flow.id}).assign({run_count:(flow.run_count||0)+1}).write();
      q.logAutomation(tid, flow.id, contact.id, `Ran: ${flow.name}`);
    } catch(e) { console.error('[Automation]', e.message); }
  }
}

// ════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error:'Email and password required.' });
  const allUsers = db.get('users').filter({email:email.toLowerCase()}).value();
  if (!allUsers.length) return res.status(401).json({ error:'Invalid credentials.' });
  const user = allUsers[0];
  const tenant = q.getTenantById(user.tenant_id);
  if (!tenant || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error:'Invalid credentials.' });
  q.updateLastLogin(user.id);
  q.logActivity(tenant.id, user.id, null, 'login', 'Logged in');
  const token = generateToken(user, tenant);
  res.json({ token, user:{id:user.id,name:user.name,email:user.email,role:user.role}, tenant:{id:tenant.id,name:tenant.name,plan:tenant.plan,slug:tenant.slug,sub_status:tenant.sub_status,industry:tenant.industry} });
});
app.get('/api/auth/me', authenticate, (req,res) => {
  const user=q.getUserById(req.user.id); if(!user) return res.status(404).json({error:'Not found.'});
  res.json({user,tenant:getTenant(req)});
});
app.post('/api/auth/register', authenticate, adminOnly, (req,res) => {
  const {name,email,password,role='user'} = req.body;
  if (!name||!email||!password) return res.status(400).json({error:'All fields required.'});
  if (password.length<6) return res.status(400).json({error:'Password min 6 chars.'});
  if (q.getUserByEmail(email.toLowerCase(),req.user.tenantId)) return res.status(409).json({error:'Email in use.'});
  const info=q.createUser(req.user.tenantId,name.trim(),email.toLowerCase(),bcrypt.hashSync(password,10),role);
  res.status(201).json({id:info.lastInsertRowid,name,email,role});
});
app.post('/api/auth/change-password', authenticate, (req,res) => {
  const {currentPassword,newPassword} = req.body;
  const user=db.get('users').find({id:req.user.id}).value();
  if (!bcrypt.compareSync(currentPassword,user.password)) return res.status(401).json({error:'Current password incorrect.'});
  if ((newPassword||'').length<6) return res.status(400).json({error:'Min 6 chars.'});
  db.get('users').find({id:req.user.id}).assign({password:bcrypt.hashSync(newPassword,10)}).write();
  res.json({message:'Password updated.'});
});

// ════════════════════════════════════════════════
//  USERS
// ════════════════════════════════════════════════
app.get('/api/users', authenticate, adminOnly, (req,res) => res.json(q.getAllUsers(req.user.tenantId)));
app.put('/api/users/:id', authenticate, adminOnly, (req,res) => { q.updateUser(req.body.name,req.body.email,req.body.role,parseInt(req.params.id),req.user.tenantId); res.json({message:'Updated.'}); });
app.delete('/api/users/:id', authenticate, adminOnly, (req,res) => {
  if (parseInt(req.params.id)===req.user.id) return res.status(400).json({error:'Cannot delete yourself.'});
  q.deleteUser(parseInt(req.params.id),req.user.tenantId); res.json({message:'Deleted.'});
});

// ════════════════════════════════════════════════
//  CONTACTS + AI SCORING
// ════════════════════════════════════════════════
app.get('/api/contacts', authenticate, (req,res) => {
  let contacts=q.getAllContacts(req.user.tenantId);
  const {search,status,stage}=req.query;
  if (search) { const s=search.toLowerCase(); contacts=contacts.filter(c=>c.name.toLowerCase().includes(s)||(c.email||'').toLowerCase().includes(s)||(c.company||'').toLowerCase().includes(s)); }
  if (status) contacts=contacts.filter(c=>c.status===status);
  if (stage)  contacts=contacts.filter(c=>c.stage===stage);
  res.json(contacts.map(c=>({...c,deal_score:integ.calcDealScore(c)})));
});
app.get('/api/contacts/:id', authenticate, (req,res) => {
  const c=q.getContactById(parseInt(req.params.id),req.user.tenantId); if(!c) return res.status(404).json({error:'Not found.'});
  res.json({...c,deal_score:integ.calcDealScore(c)});
});
app.post('/api/contacts', authenticate, async (req,res) => {
  const {name,email,phone,whatsapp,company,title,status,stage,deal,last_contact,notes} = req.body;
  if (!name) return res.status(400).json({error:'Name required.'});
  const info=q.createContact(req.user.tenantId,name.trim(),email||'',phone||'',whatsapp||phone||'',company||'',title||'',status||'Lead',stage||'Lead',Number(deal)||0,last_contact||'',notes||'',req.user.id);
  const contact=q.getContactById(info.lastInsertRowid,req.user.tenantId);
  q.logActivity(req.user.tenantId,req.user.id,contact.id,'create_contact',`Added: ${name}`);
  q.incrementActivity(req.user.id,req.user.tenantId,'contacts_added');
  await runAutomations(req.user.tenantId,'contact_created',contact);
  await integ.fireWebhooks(q.getWebhooks(req.user.tenantId),'contact.created',contact);
  res.status(201).json({...contact,deal_score:integ.calcDealScore(contact)});
});
app.put('/api/contacts/:id', authenticate, async (req,res) => {
  const id=parseInt(req.params.id);
  const ex=q.getContactById(id,req.user.tenantId); if(!ex) return res.status(404).json({error:'Not found.'});
  const {name,email,phone,whatsapp,company,title,status,stage,deal,last_contact,notes}=req.body;
  q.updateContact(name||ex.name,email||ex.email,phone||ex.phone,whatsapp||ex.whatsapp,company||ex.company,title||ex.title,status||ex.status,stage||ex.stage,Number(deal)||0,last_contact||ex.last_contact,notes||ex.notes,id,req.user.tenantId);
  const updated=q.getContactById(id,req.user.tenantId);
  q.logActivity(req.user.tenantId,req.user.id,id,'update_contact',`Updated: ${name}`);
  res.json({...updated,deal_score:integ.calcDealScore(updated)});
});
app.patch('/api/contacts/:id/stage', authenticate, (req,res) => {
  const {stage}=req.body;
  if (!['Lead','Qualified','Proposal','Closed'].includes(stage)) return res.status(400).json({error:'Invalid stage.'});
  q.updateStage(stage,parseInt(req.params.id),req.user.tenantId);
  q.logActivity(req.user.tenantId,req.user.id,parseInt(req.params.id),'move_stage',`Stage → ${stage}`);
  res.json({stage});
});
app.delete('/api/contacts/:id', authenticate, adminOnly, (req,res) => {
  const id=parseInt(req.params.id);
  const c=q.getContactById(id,req.user.tenantId); if(!c) return res.status(404).json({error:'Not found.'});
  q.deleteContact(id,req.user.tenantId);
  q.logActivity(req.user.tenantId,req.user.id,null,'delete_contact',`Deleted: ${c.name}`);
  res.json({message:'Deleted.'});
});

// ── AI Endpoints ──────────────────────────────
app.get('/api/ai/suggestions', authenticate, (req,res) => {
  const contacts=q.getAllContacts(req.user.tenantId);
  res.json(integ.getFollowUpSuggestions(contacts).slice(0,20));
});
app.get('/api/ai/briefing', authenticate, (req,res) => {
  const contacts=q.getAllContacts(req.user.tenantId);
  const sugg=integ.getFollowUpSuggestions(contacts);
  const stats=q.getStats(req.user.tenantId);
  const reminders=q.getAllReminders(req.user.tenantId).filter(r=>r.status==='pending').slice(0,5);
  res.json({high_priority:sugg.filter(s=>s.priority==='high').slice(0,5),stats,reminders,generated_at:new Date().toISOString()});
});
app.get('/api/ai/forecast', authenticate, (req,res) => {
  const contacts=q.getAllContacts(req.user.tenantId);
  const invoices=q.getAllInvoices(req.user.tenantId);
  const churn=integ.getChurnRisk(contacts);
  const forecast=integ.generateForecast(contacts,invoices);
  res.json({forecast,churn_risk:churn.slice(0,10)});
});
app.post('/api/ai/chat', authenticate, async (req,res) => {
  const {message} = req.body;
  if (!message) return res.status(400).json({error:'Message required.'});
  const contacts=q.getAllContacts(req.user.tenantId);
  const stats=q.getStats(req.user.tenantId);
  const history=q.getAIHistory(req.user.tenantId);
  const systemPrompt=`You are NexusCRM AI Assistant for ${getTenant(req)?.name||'a business'}. 
CRM Data Summary: ${contacts.length} contacts, $${stats.pipeline?.toLocaleString()||0} pipeline, $${stats.revenue?.toLocaleString()||0} revenue, ${stats.open_tickets||0} open tickets, ${stats.active_projects||0} active projects.
Top contacts: ${contacts.slice(0,5).map(c=>`${c.name} (${c.company}, ${c.status}, $${c.deal})`).join('; ')}.
Be concise, use data where possible, give actionable advice.`;
  const messages=[...history.map(h=>({role:h.role,content:h.content})),{role:'user',content:message}];
  q.addAIMessage(req.user.tenantId,req.user.id,'user',message);
  const result=await integ.askClaude(messages,systemPrompt);
  if (result.success) {
    q.addAIMessage(req.user.tenantId,req.user.id,'assistant',result.content);
    res.json({reply:result.content});
  } else {
    res.json({reply:`AI not configured. Set ANTHROPIC_API_KEY in your .env file to enable the AI assistant. Error: ${result.reason}`});
  }
});
app.delete('/api/ai/chat', authenticate, (req,res) => { q.clearAIHistory(req.user.tenantId); res.json({message:'Cleared.'}); });

// ════════════════════════════════════════════════
//  MESSAGING
// ════════════════════════════════════════════════
app.get('/api/contacts/:id/messages', authenticate, (req,res) => res.json(q.getMsgsByContact(parseInt(req.params.id),req.user.tenantId)));
app.get('/api/messages', authenticate, (req,res) => res.json(q.getAllMessages(req.user.tenantId)));
app.post('/api/contacts/:id/messages', authenticate, (req,res) => {
  const {channel,content,subject,direction}=req.body; if(!content) return res.status(400).json({error:'Content required.'});
  const info=q.createMessage(req.user.tenantId,parseInt(req.params.id),req.user.id,channel||'note',direction||'outbound',content,subject||null,'sent');
  q.updateLastContact(parseInt(req.params.id),req.user.tenantId);
  q.incrementActivity(req.user.id,req.user.tenantId,'messages_sent');
  res.status(201).json({id:info.lastInsertRowid});
});
app.post('/api/contacts/:id/whatsapp', authenticate, async (req,res) => {
  const id=parseInt(req.params.id);
  const c=q.getContactById(id,req.user.tenantId); if(!c) return res.status(404).json({error:'Not found.'});
  const {message,useApi=false}=req.body; if(!message) return res.status(400).json({error:'Message required.'});
  const phone=(c.whatsapp||c.phone||'').replace(/\D/g,''); if(!phone) return res.status(400).json({error:'No WhatsApp number.'});
  if (useApi && process.env.WHATSAPP_API_TOKEN) {
    const result=await integ.sendWhatsAppBusiness(phone,message);
    q.createMessage(req.user.tenantId,id,req.user.id,'whatsapp','outbound',message,null,result.success?'sent':'failed');
    q.addWAMessage(req.user.tenantId,id,'outbound',message,c.whatsapp||c.phone);
    q.updateLastContact(id,req.user.tenantId);
    return res.json(result.success?{message:'Sent via WhatsApp Business API.',messageId:result.messageId}:{warning:result.reason,waUrl:`https://wa.me/${phone}?text=${encodeURIComponent(message)}`});
  }
  q.createMessage(req.user.tenantId,id,req.user.id,'whatsapp','outbound',message,null,'sent');
  q.addWAMessage(req.user.tenantId,id,'outbound',message,c.whatsapp||c.phone);
  q.updateLastContact(id,req.user.tenantId);
  q.incrementActivity(req.user.id,req.user.tenantId,'messages_sent');
  res.json({waUrl:`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,phone,message});
});
app.post('/api/contacts/:id/email', authenticate, async (req,res) => {
  const id=parseInt(req.params.id);
  const c=q.getContactById(id,req.user.tenantId); if(!c) return res.status(404).json({error:'Not found.'});
  const {subject,body}=req.body; if(!subject||!body) return res.status(400).json({error:'Subject and body required.'});
  if (!c.email) return res.status(400).json({error:'No email on contact.'});
  const result=await integ.sendEmail({to:c.email,subject,html:body.replace(/\n/g,'<br>')});
  q.createMessage(req.user.tenantId,id,req.user.id,'email','outbound',body,subject,result.success?'sent':'failed');
  q.updateLastContact(id,req.user.tenantId);
  q.incrementActivity(req.user.id,req.user.tenantId,'emails_sent');
  res.json(result.success?{message:'Email sent.',messageId:result.messageId}:{warning:result.reason||'SMTP not configured. Email logged.',status:'failed'});
});
app.post('/api/contacts/:id/sms', authenticate, async (req,res) => {
  const id=parseInt(req.params.id);
  const c=q.getContactById(id,req.user.tenantId); if(!c) return res.status(404).json({error:'Not found.'});
  const {message}=req.body; const phone=c.phone||c.whatsapp; if(!phone) return res.status(400).json({error:'No phone.'});
  const result=await integ.sendSMS(phone,message);
  q.createMessage(req.user.tenantId,id,req.user.id,'sms','outbound',message,null,result.success?'sent':'failed');
  q.incrementActivity(req.user.id,req.user.tenantId,'messages_sent');
  res.json(result.success?{message:'SMS sent.',sid:result.sid}:{warning:result.reason});
});

// ── WhatsApp Inbox ────────────────────────────
app.get('/api/whatsapp/inbox', authenticate, (req,res) => {
  const inbox=q.getWAInbox(req.user.tenantId);
  const grouped={};
  inbox.forEach(m=>{
    const cid=m.contact_id;
    if (!grouped[cid]) { const c=db.get('contacts').find({id:cid}).value(); grouped[cid]={contact:c,messages:[]}; }
    grouped[cid].messages.push(m);
  });
  res.json(Object.values(grouped));
});
app.get('/api/whatsapp/conversation/:contactId', authenticate, (req,res) => res.json(q.getWAConversation(req.user.tenantId,parseInt(req.params.contactId))));
// Webhook for incoming WhatsApp messages (from Meta)
app.get('/api/whatsapp/webhook', (req,res) => {
  const {hub:{mode,challenge,'verify_token':token}={}} = { hub:req.query };
  if (mode==='subscribe' && token===process.env.WHATSAPP_VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  res.status(403).send('Forbidden');
});
app.post('/api/whatsapp/webhook', (req,res) => {
  const body=req.body;
  if (body?.object==='whatsapp_business_account') {
    body.entry?.forEach(entry=>{
      entry.changes?.forEach(change=>{
        change.value?.messages?.forEach(msg=>{
          if (msg.type==='text') {
            const from=msg.from;
            const contact=db.get('contacts').filter(c=>c.whatsapp?.replace(/\D/g,'')==from||c.phone?.replace(/\D/g,'')==from).value()[0];
            if (contact) {
              q.addWAMessage(contact.tenant_id,contact.id,'inbound',msg.text.body,from);
              q.createMessage(contact.tenant_id,contact.id,null,'whatsapp','inbound',msg.text.body,null,'received');
              console.log(`[WhatsApp] Inbound from ${from}: ${msg.text.body}`);
            }
          }
        });
      });
    });
  }
  res.sendStatus(200);
});

// ════════════════════════════════════════════════
//  TEMPLATES
// ════════════════════════════════════════════════
app.get('/api/templates', authenticate, (req,res) => res.json(q.getTemplates(req.user.tenantId)));
app.post('/api/templates', authenticate, (req,res) => {
  const {name,channel,subject,body}=req.body; if(!name||!body) return res.status(400).json({error:'Name and body required.'});
  const info=q.createTemplate(req.user.tenantId,req.user.id,name,channel||'email',subject||'',body);
  res.status(201).json({id:info.lastInsertRowid,name,channel,subject,body});
});
app.put('/api/templates/:id', authenticate, (req,res) => { q.updateTemplate(req.body.name,req.body.channel,req.body.subject,req.body.body,parseInt(req.params.id),req.user.tenantId); res.json({message:'Updated.'}); });
app.delete('/api/templates/:id', authenticate, (req,res) => { q.deleteTemplate(parseInt(req.params.id),req.user.tenantId); res.json({message:'Deleted.'}); });
app.post('/api/templates/:id/preview', authenticate, (req,res) => {
  const t=q.getTemplateById(parseInt(req.params.id),req.user.tenantId); if(!t) return res.status(404).json({error:'Not found.'});
  const contact=req.body.contact_id?q.getContactById(req.body.contact_id,req.user.tenantId):null;
  const sender=q.getUserById(req.user.id);
  res.json({body:integ.mergeTemplate(t.body,contact,sender),subject:integ.mergeTemplate(t.subject||'',contact,sender)});
});

// ════════════════════════════════════════════════
//  REMINDERS
// ════════════════════════════════════════════════
app.get('/api/reminders', authenticate, (req,res) => res.json(q.getAllReminders(req.user.tenantId)));
app.post('/api/reminders', authenticate, (req,res) => {
  const {contact_id,type,channel,message,due_at,repeat_days}=req.body;
  if (!contact_id||!message||!due_at) return res.status(400).json({error:'contact_id, message, due_at required.'});
  const info=q.createReminder(req.user.tenantId,parseInt(contact_id),req.user.id,type||'follow_up',channel||'email',message,due_at,repeat_days||null);
  res.status(201).json({id:info.lastInsertRowid});
});
app.patch('/api/reminders/:id/done', authenticate, (req,res) => { q.completeReminder(parseInt(req.params.id),null); res.json({message:'Done.'}); });
app.delete('/api/reminders/:id', authenticate, (req,res) => { q.deleteReminder(parseInt(req.params.id),req.user.tenantId); res.json({message:'Deleted.'}); });

// ════════════════════════════════════════════════
//  PROPOSALS
// ════════════════════════════════════════════════
app.get('/api/proposals', authenticate, (req,res) => res.json(q.getAllProposals(req.user.tenantId)));
app.get('/api/proposals/:id', authenticate, (req,res) => {
  const p=q.getProposalById(parseInt(req.params.id),req.user.tenantId); if(!p) return res.status(404).json({error:'Not found.'});
  const c=p.contact_id?q.getContactById(p.contact_id,req.user.tenantId):null;
  res.json({...p,contact_name:c?.name||null,company:c?.company||null,email:c?.email||null,items:q.getProposalItems(p.id)});
});
app.post('/api/proposals', authenticate, (req,res) => {
  const {contact_id,title,intro,closing,valid_until,currency,items,discount,notes}=req.body;
  if (!title||!items?.length) return res.status(400).json({error:'Title and items required.'});
  const subtotal=items.reduce((s,i)=>s+(i.quantity*i.unit_price),0); const disc=Number(discount)||0; const total=subtotal-disc;
  const info=q.createProposal(req.user.tenantId,contact_id||null,req.user.id,title,intro||'',closing||'',valid_until||'',currency||'USD',subtotal,total,disc,notes||'');
  items.forEach(item=>q.addProposalItem(info.lastInsertRowid,item.description,item.quantity,item.unit_price,item.quantity*item.unit_price));
  res.status(201).json({id:info.lastInsertRowid,proposal_number:info.proposal_number,total});
});
app.patch('/api/proposals/:id/status', authenticate, (req,res) => {
  const {status}=req.body; if(!['draft','sent','accepted','declined'].includes(status)) return res.status(400).json({error:'Invalid status.'});
  q.updateProposalStatus(status,parseInt(req.params.id),req.user.tenantId);
  if (status==='accepted'&&process.env.SLACK_BOT_TOKEN) integ.sendSlack(`🎉 Proposal accepted!`);
  res.json({message:'Updated.',status});
});
app.post('/api/proposals/:id/send', authenticate, async (req,res) => {
  const p=q.getProposalById(parseInt(req.params.id),req.user.tenantId); if(!p) return res.status(404).json({error:'Not found.'});
  const contact=p.contact_id?q.getContactById(p.contact_id,req.user.tenantId):null; if(!contact?.email) return res.status(400).json({error:'No email.'});
  const items=q.getProposalItems(p.id);
  const rows=items.map(i=>`<tr><td style="padding:7px">${i.description}</td><td style="padding:7px;text-align:right">${i.quantity}</td><td style="padding:7px;text-align:right">$${i.unit_price.toFixed(2)}</td><td style="padding:7px;text-align:right;font-weight:bold">$${i.amount.toFixed(2)}</td></tr>`).join('');
  const html=`<div style="font-family:sans-serif;max-width:680px;margin:0 auto;background:#0f1117;color:#f0f2f7;border-radius:16px;overflow:hidden"><div style="background:#3b82f6;padding:24px 28px"><h1 style="margin:0;font-size:22px">${p.proposal_number} — ${p.title}</h1></div><div style="padding:28px"><p>Dear ${contact.name},</p><p>${p.intro||'Please find your proposal below.'}</p><table style="width:100%;border-collapse:collapse;margin:20px 0;background:#181c25;border-radius:10px;overflow:hidden"><thead><tr style="background:#1f2433"><th style="padding:9px;text-align:left;color:#8892a4;font-size:11px;text-transform:uppercase">Description</th><th style="padding:9px;text-align:right;color:#8892a4;font-size:11px;text-transform:uppercase">Qty</th><th style="padding:9px;text-align:right;color:#8892a4;font-size:11px;text-transform:uppercase">Unit</th><th style="padding:9px;text-align:right;color:#8892a4;font-size:11px;text-transform:uppercase">Total</th></tr></thead><tbody style="color:#f0f2f7">${rows}</tbody></table><div style="text-align:right"><strong style="font-size:18px;color:#3b82f6">Total: $${p.total.toFixed(2)} ${p.currency}</strong></div><p style="margin-top:20px">${p.closing||'We look forward to working with you.'}</p></div></div>`;
  const result=await integ.sendEmail({to:contact.email,subject:`Proposal ${p.proposal_number}`,html});
  q.updateProposalStatus('sent',p.id,req.user.tenantId);
  res.json(result.success?{message:'Sent.'}:{warning:result.reason||'SMTP not configured.'});
});
app.delete('/api/proposals/:id', authenticate, (req,res) => { q.deleteProposal(parseInt(req.params.id),req.user.tenantId); res.json({message:'Deleted.'}); });

// ════════════════════════════════════════════════
//  PROJECTS & TASKS
// ════════════════════════════════════════════════
app.get('/api/projects', authenticate, (req,res) => res.json(q.getAllProjects(req.user.tenantId)));
app.get('/api/projects/:id', authenticate, (req,res) => {
  const p=q.getProjectById(parseInt(req.params.id),req.user.tenantId); if(!p) return res.status(404).json({error:'Not found.'});
  res.json({...p,tasks:q.getTasksByProject(p.id)});
});
app.post('/api/projects', authenticate, (req,res) => {
  const info=q.createProject(req.user.tenantId,req.user.id,req.body);
  q.logActivity(req.user.tenantId,req.user.id,req.body.contact_id||null,'create_project',`Created project: ${req.body.name}`);
  res.status(201).json({id:info.lastInsertRowid});
});
app.put('/api/projects/:id', authenticate, (req,res) => { q.updateProject(parseInt(req.params.id),req.user.tenantId,req.body); res.json({message:'Updated.'}); });
app.delete('/api/projects/:id', authenticate, adminOnly, (req,res) => { q.deleteProject(parseInt(req.params.id),req.user.tenantId); res.json({message:'Deleted.'}); });
app.get('/api/projects/:id/tasks', authenticate, (req,res) => res.json(q.getTasksByProject(parseInt(req.params.id))));
app.post('/api/projects/:id/tasks', authenticate, (req,res) => {
  const info=q.createTask(req.user.tenantId,parseInt(req.params.id),req.user.id,req.body);
  res.status(201).json({id:info.lastInsertRowid});
});
app.patch('/api/tasks/:id', authenticate, (req,res) => { q.updateTask(parseInt(req.params.id),req.user.tenantId,req.body); res.json({message:'Updated.'}); });
app.delete('/api/tasks/:id', authenticate, (req,res) => { q.deleteTask(parseInt(req.params.id),req.user.tenantId); res.json({message:'Deleted.'}); });
app.get('/api/tasks', authenticate, (req,res) => {
  const tasks=q.getAllTasks(req.user.tenantId);
  res.json(tasks.map(t=>{const p=db.get('projects').find({id:t.project_id}).value();const u=db.get('users').find({id:t.assigned_to}).value();return{...t,project_name:p?.name||null,assigned_name:u?.name||null}}));
});

// ════════════════════════════════════════════════
//  HELP DESK / TICKETS
// ════════════════════════════════════════════════
app.get('/api/tickets', authenticate, (req,res) => res.json(q.getAllTickets(req.user.tenantId)));
app.get('/api/tickets/:id', authenticate, (req,res) => {
  const t=q.getTicketById(parseInt(req.params.id),req.user.tenantId); if(!t) return res.status(404).json({error:'Not found.'});
  res.json({...t,messages:q.getTicketMessages(t.id)});
});
app.post('/api/tickets', authenticate, (req,res) => {
  const {contact_id,subject,body,priority}=req.body; if(!subject||!body) return res.status(400).json({error:'Subject and body required.'});
  const info=q.createTicket(req.user.tenantId,contact_id||null,req.user.id,subject,body,priority||'medium');
  q.logActivity(req.user.tenantId,req.user.id,contact_id||null,'create_ticket',`Ticket: ${subject}`);
  res.status(201).json({id:info.lastInsertRowid,ticket_number:info.ticket_number});
});
app.patch('/api/tickets/:id', authenticate, (req,res) => {
  const id=parseInt(req.params.id);
  const {status}=req.body;
  if (status==='resolved') { req.body.resolved_at=new Date().toISOString(); q.incrementActivity(req.user.id,req.user.tenantId,'tickets_resolved'); }
  q.updateTicket(id,req.user.tenantId,req.body);
  res.json({message:'Updated.'});
});
app.post('/api/tickets/:id/messages', authenticate, (req,res) => {
  const {content,internal}=req.body; if(!content) return res.status(400).json({error:'Content required.'});
  const mid=q.addTicketMessage(req.user.tenantId,parseInt(req.params.id),req.user.id,content,internal||false);
  res.status(201).json({id:mid});
});

// ════════════════════════════════════════════════
//  CONTRACTS
// ════════════════════════════════════════════════
app.get('/api/contracts', authenticate, (req,res) => res.json(q.getAllContracts(req.user.tenantId)));
app.get('/api/contracts/:id', authenticate, (req,res) => {
  const c=q.getContractById(parseInt(req.params.id),req.user.tenantId); if(!c) return res.status(404).json({error:'Not found.'});
  const contact=c.contact_id?q.getContactById(c.contact_id,req.user.tenantId):null;
  res.json({...c,contact_name:contact?.name||null,company:contact?.company||null,email:contact?.email||null});
});
app.post('/api/contracts', authenticate, (req,res) => {
  const {contact_id,...data}=req.body; if(!data.title) return res.status(400).json({error:'Title required.'});
  const info=q.createContract(req.user.tenantId,contact_id||null,req.user.id,data);
  q.logActivity(req.user.tenantId,req.user.id,contact_id||null,'create_contract',`Created: ${data.title}`);
  res.status(201).json({id:info.lastInsertRowid,contract_number:info.contract_number});
});
app.patch('/api/contracts/:id/status', authenticate, (req,res) => {
  q.updateContractStatus(req.body.status,parseInt(req.params.id),req.user.tenantId); res.json({message:'Updated.'});
});
app.delete('/api/contracts/:id', authenticate, adminOnly, (req,res) => { q.deleteContract(parseInt(req.params.id),req.user.tenantId); res.json({message:'Deleted.'}); });

// ════════════════════════════════════════════════
//  EXPENSES & FINANCE
// ════════════════════════════════════════════════
app.get('/api/expenses', authenticate, (req,res) => res.json(q.getAllExpenses(req.user.tenantId)));
app.get('/api/expenses/categories', authenticate, (req,res) => res.json(q.getExpenseCategories(req.user.tenantId)));
app.post('/api/expenses', authenticate, (req,res) => {
  const info=q.createExpense(req.user.tenantId,{...req.body,submitted_by:req.user.id,status:'pending'});
  res.status(201).json({id:info.lastInsertRowid});
});
app.patch('/api/expenses/:id/status', authenticate, adminOnly, (req,res) => { q.updateExpenseStatus(req.body.status,parseInt(req.params.id),req.user.tenantId); res.json({message:'Updated.'}); });
app.delete('/api/expenses/:id', authenticate, (req,res) => { q.deleteExpense(parseInt(req.params.id),req.user.tenantId); res.json({message:'Deleted.'}); });
app.get('/api/finance/summary', authenticate, (req,res) => {
  const invoices=q.getAllInvoices(req.user.tenantId);
  const expenses=q.getAllExpenses(req.user.tenantId);
  const revenue=invoices.filter(i=>i.status==='paid').reduce((s,i)=>s+(Number(i.total)||0),0);
  const totalExpenses=expenses.filter(e=>e.status==='approved').reduce((s,e)=>s+(Number(e.amount)||0),0);
  const byCategory={};
  expenses.forEach(e=>{byCategory[e.category]=(byCategory[e.category]||0)+(Number(e.amount)||0)});
  res.json({revenue,expenses:totalExpenses,profit:revenue-totalExpenses,by_category:byCategory,invoices_pending:invoices.filter(i=>i.status==='sent').reduce((s,i)=>s+(Number(i.total)||0),0)});
});

// ════════════════════════════════════════════════
//  EMAIL CAMPAIGNS
// ════════════════════════════════════════════════
app.get('/api/campaigns', authenticate, (req,res) => res.json(q.getAllCampaigns(req.user.tenantId)));
app.get('/api/campaigns/:id', authenticate, (req,res) => {
  const c=q.getCampaignById(parseInt(req.params.id),req.user.tenantId); if(!c) return res.status(404).json({error:'Not found.'});
  const recipients=db.get('campaign_contacts').filter({campaign_id:c.id}).value();
  res.json({...c,recipients_count:recipients.length,opens:recipients.filter(r=>r.opened).length,clicks:recipients.filter(r=>r.clicked).length});
});
app.post('/api/campaigns', authenticate, (req,res) => {
  const info=q.createCampaign(req.user.tenantId,req.user.id,req.body);
  res.status(201).json({id:info.lastInsertRowid});
});
app.post('/api/campaigns/:id/send', authenticate, async (req,res) => {
  const id=parseInt(req.params.id);
  const campaign=q.getCampaignById(id,req.user.tenantId); if(!campaign) return res.status(404).json({error:'Not found.'});
  let contacts=q.getAllContacts(req.user.tenantId).filter(c=>c.email);
  if (campaign.segment==='leads') contacts=contacts.filter(c=>c.status==='Lead');
  if (campaign.segment==='clients') contacts=contacts.filter(c=>c.status==='Client');
  if (campaign.segment==='partners') contacts=contacts.filter(c=>c.status==='Partner');
  let sent=0, failed=0;
  for (const contact of contacts) {
    const body=integ.mergeTemplate(campaign.body,contact,{name:'NexusCRM'});
    const subject=integ.mergeTemplate(campaign.subject,contact,{name:'NexusCRM'});
    const result=await integ.sendEmail({to:contact.email,subject,html:body});
    db.get('campaign_contacts').push({id:require('./db').nextId(),campaign_id:id,contact_id:contact.id,opened:false,clicked:false,sent_at:new Date().toISOString()}).write();
    if (result.success) sent++; else failed++;
  }
  q.updateCampaign(id,req.user.tenantId,{status:'sent',sent_at:new Date().toISOString()});
  q.logActivity(req.user.tenantId,req.user.id,null,'send_campaign',`Campaign "${campaign.name}": ${sent} sent, ${failed} failed`);
  res.json({message:`Campaign sent: ${sent} delivered, ${failed} failed.`,sent,failed});
});
app.delete('/api/campaigns/:id', authenticate, (req,res) => { q.deleteCampaign(parseInt(req.params.id),req.user.tenantId); res.json({message:'Deleted.'}); });

// ════════════════════════════════════════════════
//  AUTOMATION FLOWS
// ════════════════════════════════════════════════
app.get('/api/automation', authenticate, (req,res) => res.json(q.getAllFlows(req.user.tenantId)));
app.post('/api/automation', authenticate, (req,res) => {
  const info=q.createFlow(req.user.tenantId,req.user.id,req.body);
  res.status(201).json({id:info.lastInsertRowid});
});
app.patch('/api/automation/:id', authenticate, (req,res) => { q.updateFlow(parseInt(req.params.id),req.user.tenantId,req.body); res.json({message:'Updated.'}); });
app.delete('/api/automation/:id', authenticate, (req,res) => { q.deleteFlow(parseInt(req.params.id),req.user.tenantId); res.json({message:'Deleted.'}); });

// ════════════════════════════════════════════════
//  INVOICES
// ════════════════════════════════════════════════
app.get('/api/invoices', authenticate, (req,res) => res.json(q.getAllInvoices(req.user.tenantId)));
app.get('/api/invoices/:id', authenticate, (req,res) => {
  const inv=q.getInvoiceById(parseInt(req.params.id),req.user.tenantId); if(!inv) return res.status(404).json({error:'Not found.'});
  const c=inv.contact_id?q.getContactById(inv.contact_id,req.user.tenantId):null;
  res.json({...inv,contact_name:c?.name||null,company:c?.company||null,items:q.getInvoiceItems(inv.id)});
});
app.post('/api/invoices', authenticate, async (req,res) => {
  const {contact_id,currency,items,tax_rate,due_date,notes}=req.body; if(!items?.length) return res.status(400).json({error:'Items required.'});
  const subtotal=items.reduce((s,i)=>s+(i.quantity*i.unit_price),0); const tax=subtotal*((tax_rate||0)/100); const total=subtotal+tax;
  const invNum=`INV-${String(q.nextInvoiceNum(req.user.tenantId).n).padStart(4,'0')}`;
  const info=q.createInvoice(req.user.tenantId,contact_id||null,req.user.id,invNum,'draft',currency||'USD',subtotal,tax_rate||0,tax,total,due_date||'',notes||'');
  items.forEach(item=>q.addInvoiceItem(info.lastInsertRowid,item.description,item.quantity,item.unit_price,item.quantity*item.unit_price));
  res.status(201).json({id:info.lastInsertRowid,invoice_number:invNum,total});
});
app.patch('/api/invoices/:id/status', authenticate, async (req,res) => {
  const {status}=req.body; if(!['draft','sent','paid','overdue','cancelled'].includes(status)) return res.status(400).json({error:'Invalid.'});
  const id=parseInt(req.params.id);
  const inv=q.getInvoiceById(id,req.user.tenantId); if(!inv) return res.status(404).json({error:'Not found.'});
  q.updateInvoiceStatus(status,id,req.user.tenantId);
  if (status==='paid'&&process.env.SLACK_BOT_TOKEN) integ.sendSlack(`💰 Invoice ${inv.invoice_number} PAID — $${inv.total.toFixed(2)}`);
  res.json({message:'Updated.',status});
});
app.post('/api/invoices/:id/send', authenticate, async (req,res) => {
  const inv=q.getInvoiceById(parseInt(req.params.id),req.user.tenantId); if(!inv) return res.status(404).json({error:'Not found.'});
  const contact=inv.contact_id?q.getContactById(inv.contact_id,req.user.tenantId):null; if(!contact?.email) return res.status(400).json({error:'No email.'});
  const items=q.getInvoiceItems(inv.id);
  const rows=items.map(i=>`<tr><td style="padding:7px">${i.description}</td><td style="padding:7px;text-align:right">${i.quantity}</td><td style="padding:7px;text-align:right">$${i.unit_price.toFixed(2)}</td><td style="padding:7px;text-align:right;font-weight:bold">$${i.amount.toFixed(2)}</td></tr>`).join('');
  const html=`<div style="font-family:sans-serif;max-width:600px"><h2>Invoice ${inv.invoice_number}</h2><p>Dear ${contact.name}, total due: <strong>$${inv.total.toFixed(2)} ${inv.currency}</strong></p><table border="1" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse"><thead><tr style="background:#f5f5f5"><th style="padding:8px;text-align:left">Description</th><th style="padding:8px">Qty</th><th style="padding:8px">Unit</th><th style="padding:8px">Total</th></tr></thead><tbody>${rows}</tbody></table><p><strong>Total: $${inv.total.toFixed(2)}</strong></p></div>`;
  const result=await integ.sendEmail({to:contact.email,subject:`Invoice ${inv.invoice_number}`,html});
  q.updateInvoiceStatus('sent',inv.id,req.user.tenantId);
  res.json(result.success?{message:'Emailed.'}:{warning:result.reason||'SMTP not configured.'});
});
app.delete('/api/invoices/:id', authenticate, adminOnly, (req,res) => {
  const inv=q.getInvoiceById(parseInt(req.params.id),req.user.tenantId); if(!inv) return res.status(404).json({error:'Not found.'});
  if (inv.status!=='draft') return res.status(400).json({error:'Only drafts.'});
  q.deleteInvoiceItems(parseInt(req.params.id)); q.deleteInvoice(parseInt(req.params.id),req.user.tenantId); res.json({message:'Deleted.'});
});

// ════════════════════════════════════════════════
//  TEAM, STATS, ACTIVITY
// ════════════════════════════════════════════════
app.get('/api/team', authenticate, (req,res) => {
  const team=q.getTeamActivity(req.user.tenantId);
  const users=q.getAllUsers(req.user.tenantId);
  res.json(team.map(t=>{const u=users.find(u=>u.id===t.user_id)||{};return{...t,email:u.email,role:u.role,last_login:u.last_login}}).sort((a,b)=>b.revenue-a.revenue));
});
app.get('/api/stats', authenticate, (req,res) => res.json({...q.getStats(req.user.tenantId),recent_activity:q.getActivity(req.user.tenantId),tenant:getTenant(req)}));
app.get('/api/activity', authenticate, (req,res) => res.json(q.getActivity(req.user.tenantId)));

// ════════════════════════════════════════════════
//  BRANDING (White-label)
// ════════════════════════════════════════════════
app.get('/api/branding', authenticate, (req,res) => res.json(q.getBranding(req.user.tenantId)||{}));
app.put('/api/branding', authenticate, adminOnly, (req,res) => { q.updateBranding(req.user.tenantId,req.body); res.json({message:'Branding updated.'}); });

// ════════════════════════════════════════════════
//  BILLING, INTEGRATIONS, WEBHOOKS
// ════════════════════════════════════════════════
app.get('/api/billing/plans',(req,res)=>res.json([
  {id:'starter',name:'Starter',price:29,seats:1,contacts:500,features:['Contacts & Pipeline','Invoicing','WhatsApp links','Basic analytics']},
  {id:'pro',name:'Pro',price:79,seats:5,contacts:'Unlimited',features:['Everything in Starter','Projects & Tasks','Help Desk','Campaigns','AI Assistant','Automations','Contracts']},
  {id:'scale',name:'Scale',price:199,seats:999,contacts:'Unlimited',features:['Everything in Pro','White-label','Client Portal','WhatsApp Business API','Revenue Forecasting','Churn Prediction','Custom domain']},
]));
app.post('/api/billing/checkout',authenticate,adminOnly,async(req,res)=>{
  const priceMap={starter:process.env.STRIPE_PRICE_STARTER,pro:process.env.STRIPE_PRICE_PRO,scale:process.env.STRIPE_PRICE_SCALE};
  const priceId=priceMap[req.body.plan]; if(!priceId) return res.status(400).json({error:'Stripe Price IDs not set in .env'});
  const tenant=getTenant(req); let cid=tenant.stripe_customer_id;
  if(!cid){const u=q.getUserById(req.user.id);const cust=await integ.createStripeCustomer(tenant.name,u.email);if(!cust)return res.status(500).json({error:'Stripe error.'});cid=cust.id;db.get('tenants').find({id:tenant.id}).assign({stripe_customer_id:cid}).write();}
  const sub=await integ.createStripeSubscription(cid,priceId); if(!sub) return res.status(500).json({error:'Subscription error.'});
  res.json({subscriptionId:sub.id,clientSecret:sub.latest_invoice?.payment_intent?.client_secret});
});
app.get('/api/billing/portal',authenticate,adminOnly,async(req,res)=>{
  const t=getTenant(req); if(!t.stripe_customer_id) return res.status(400).json({error:'No Stripe customer.'});
  const url=await integ.getStripePortalUrl(t.stripe_customer_id,`http://localhost:${PORT}/index.html`); if(!url) return res.status(500).json({error:'Portal error.'});
  res.json({url});
});
app.post('/api/billing/webhook',(req,res)=>{
  try{const e=integ.getStripe()?.webhooks.constructEvent(req.body,req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);if(e?.type?.startsWith('customer.subscription.')){const t=db.get('tenants').find({stripe_customer_id:e.data.object.customer}).value();if(t)q.updateTenantPlan(t.plan,e.data.object.id,e.data.object.status,t.id);}}catch{}
  res.sendStatus(200);
});
app.get('/api/integrations',authenticate,adminOnly,(req,res)=>res.json(q.getIntegrations(req.user.tenantId).map(r=>({...r,config:r.config?JSON.parse(r.config):{}}))));
app.post('/api/integrations/:type',authenticate,adminOnly,(req,res)=>{q.upsertIntegration(req.user.tenantId,req.params.type,JSON.stringify(req.body));res.json({message:'Saved.'});});
app.patch('/api/integrations/:type/toggle',authenticate,adminOnly,(req,res)=>{q.toggleIntegration(req.body.enabled?1:0,req.user.tenantId,req.params.type);res.json({message:'Toggled.'});});
app.get('/api/webhooks',authenticate,adminOnly,(req,res)=>res.json(q.getWebhooks(req.user.tenantId)));
app.post('/api/webhooks',authenticate,adminOnly,(req,res)=>{const{url,events}=req.body;if(!url||!events)return res.status(400).json({error:'URL and events required.'});const secret=crypto.randomBytes(16).toString('hex');const info=q.createWebhook(req.user.tenantId,url,Array.isArray(events)?events.join(','):events,secret);res.status(201).json({id:info.lastInsertRowid,secret});});
app.delete('/api/webhooks/:id',authenticate,adminOnly,(req,res)=>{q.deleteWebhook(parseInt(req.params.id),req.user.tenantId);res.json({message:'Deleted.'});});

// ════════════════════════════════════════════════
//  CLIENT PORTAL
// ════════════════════════════════════════════════
app.post('/api/portal/invite/:contactId',authenticate,adminOnly,async(req,res)=>{
  const id=parseInt(req.params.contactId);
  const c=q.getContactById(id,req.user.tenantId); if(!c) return res.status(404).json({error:'Not found.'});
  if (!c.email) return res.status(400).json({error:'No email.'});
  const token=q.createPortalToken(req.user.tenantId,id,c.email);
  const portalUrl=`${req.protocol}://${req.get('host')}/portal.html?token=${token}`;
  const result=await integ.sendEmail({to:c.email,subject:`Your client portal — NexusCRM`,html:`<div style="font-family:sans-serif;max-width:500px"><h2>Hello ${c.name}!</h2><p>Access your invoices and proposals here:</p><p><a href="${portalUrl}" style="background:#3b82f6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block">Open Portal →</a></p><p style="color:#888;font-size:13px">Valid for 30 days.</p></div>`});
  res.json({message:result.success?'Invite sent.':'Token created. SMTP not configured — share URL manually.',portalUrl,token});
});
app.get('/api/portal/data',(req,res)=>{
  const token=req.query.token||req.headers['x-portal-token']; if(!token) return res.status(401).json({error:'Token required.'});
  const pt=q.getPortalToken(token); if(!pt) return res.status(403).json({error:'Invalid or expired token.'});
  const contact=q.getContactById(pt.contact_id,pt.tenant_id); if(!contact) return res.status(404).json({error:'Not found.'});
  const invoices=q.getAllInvoices(pt.tenant_id).filter(i=>i.contact_id===pt.contact_id).map(i=>({...i,items:q.getInvoiceItems(i.id)}));
  const proposals=q.getAllProposals(pt.tenant_id).filter(p=>p.contact_id===pt.contact_id).map(p=>({...p,items:q.getProposalItems(p.id)}));
  const contracts=q.getAllContracts(pt.tenant_id).filter(c=>c.contact_id===pt.contact_id);
  res.json({contact:{name:contact.name,company:contact.company,email:contact.email,status:contact.status},invoices,proposals,contracts});
});

// ════════════════════════════════════════════════
//  SPA FALLBACK
// ════════════════════════════════════════════════
app.get('*',(req,res)=>{
  if(req.path.startsWith('/api')) return res.status(404).json({error:'Not found.'});
  if(req.path==='/index.html') return res.sendFile(path.join(__dirname,'index.html'));
  if(req.path==='/portal.html') return res.sendFile(path.join(__dirname,'portal.html'));
  res.sendFile(path.join(__dirname,'login.html'));
});

app.listen(PORT,()=>{
  console.log(`\n  ╔═══════════════════════════════════════════════╗`);
  console.log(`  ║  🚀  NexusCRM v4 — Universal All-in-One CRM   ║`);
  console.log(`  ╠═══════════════════════════════════════════════╣`);
  console.log(`  ║  http://localhost:${PORT}                           ║`);
  console.log(`  ╠═══════════════════════════════════════════════╣`);
  console.log(`  ║  admin@nexuscrm.com  /  Admin@2025!           ║`);
  console.log(`  ║  user@nexuscrm.com   /  User@2025!            ║`);
  console.log(`  ╚═══════════════════════════════════════════════╝\n`);
});
