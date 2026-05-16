/*
  NexusCRM v4 — db.js
  All modules: Core CRM + Projects + HelpDesk + Contracts +
  Finance + Campaigns + Automation + Industry + AI + WhatsApp +
  Live Chat + White-label + i18n + Forecasting
*/
const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const path     = require('path');

const db = low(new FileSync(path.join(__dirname, 'nexuscrm-data.json')));

let _seq = Date.now();
const nextId = () => ++_seq;
const now    = () => new Date().toISOString();
const today  = () => new Date().toISOString().slice(0,10);

db.defaults({
  // Core
  tenants:[], users:[], contacts:[], messages:[],
  invoices:[], invoice_items:[], integrations:[],
  webhooks:[], activity_log:[],
  templates:[], reminders:[], proposals:[], proposal_items:[],
  portal_tokens:[], team_activity:[],
  // v4 new
  projects:[], tasks:[], task_comments:[],
  tickets:[], ticket_messages:[],
  contracts:[], contract_items:[],
  expenses:[], expense_categories:[],
  campaigns:[], campaign_contacts:[],
  automation_flows:[], automation_logs:[],
  live_chat_sessions:[], live_chat_messages:[],
  whatsapp_inbox:[], whatsapp_numbers:[],
  ai_conversations:[],
  industry_data:[],
  forecast_snapshots:[],
  branding:[],
  i18n_keys:[],
}).write();

// ── Seed ─────────────────────────────────────
if (!db.get('tenants').size().value()) {
  const tid = nextId(), adminId = nextId(), userId = nextId();

  db.get('tenants').push({
    id:tid, name:'Nexus Demo Org', slug:'nexus-demo', plan:'scale',
    sub_status:'trialing', trial_ends_at: new Date(Date.now()+14*864e5).toISOString(),
    seats_limit:999, stripe_customer_id:null, stripe_sub_id:null,
    industry:'general', created_at:now(),
  }).write();

  db.get('users').push({id:adminId,tenant_id:tid,name:'Admin',email:'admin@nexuscrm.com',
    password:bcrypt.hashSync('Admin@2025!',10),role:'admin',created_at:now(),last_login:null}).write();
  db.get('users').push({id:userId,tenant_id:tid,name:'Sales Rep',email:'user@nexuscrm.com',
    password:bcrypt.hashSync('User@2025!',10),role:'user',created_at:now(),last_login:null}).write();

  // Contacts
  const cSeeds=[
    {name:'Amara Osei',email:'amara@growthco.io',phone:'+254712000001',whatsapp:'+254712000001',company:'GrowthCo',title:'Head of Marketing',status:'Client',stage:'Proposal',deal:42000,last_contact:'2025-04-28',notes:'Interested in enterprise plan.'},
    {name:'David Mwangi',email:'d.mwangi@techbridge.ke',phone:'+254721000002',whatsapp:'+254721000002',company:'TechBridge',title:'CTO',status:'Lead',stage:'Qualified',deal:18500,last_contact:'2025-04-15',notes:'Evaluating 3 CRM solutions.'},
    {name:'Priya Sharma',email:'priya@nexadigital.com',phone:'+919876543210',whatsapp:'+919876543210',company:'Nexa Digital',title:'CEO',status:'Partner',stage:'Closed',deal:75000,last_contact:'2025-05-01',notes:'Monthly sync scheduled.'},
    {name:'Lior Ben-David',email:'lior@stacklabs.io',phone:'+97252000004',whatsapp:'+97252000004',company:'StackLabs',title:'Product Manager',status:'Lead',stage:'Lead',deal:9800,last_contact:'2025-03-22',notes:'Needs CFO approval.'},
    {name:'Chisom Eze',email:'chisom@luminarehq.com',phone:'+2348020000050',whatsapp:'+2348020000050',company:'Luminare HQ',title:'VP Sales',status:'Client',stage:'Closed',deal:31200,last_contact:'2025-04-30',notes:'Upsell opportunity.'},
    {name:'Sofia Reyes',email:'sofia@cloudvane.mx',phone:'+525500000006',whatsapp:'+525500000006',company:'CloudVane',title:'Ops Lead',status:'Churned',stage:'Lead',deal:0,last_contact:'2025-02-10',notes:'Re-engage Q3.'},
  ];
  const cIds=cSeeds.map(c=>{const id=nextId();db.get('contacts').push({id,tenant_id:tid,created_by:adminId,created_at:now(),updated_at:now(),...c}).write();return id});

  // Invoices
  [{contact_id:cIds[0],invoice_number:'INV-0001',status:'paid',subtotal:42000,tax_rate:16,tax_amount:6720,total:48720,due_date:'2025-04-15',currency:'USD',paid_at:now()},
   {contact_id:cIds[1],invoice_number:'INV-0002',status:'sent',subtotal:18500,tax_rate:16,tax_amount:2960,total:21460,due_date:'2025-05-30',currency:'USD',paid_at:null},
   {contact_id:cIds[2],invoice_number:'INV-0003',status:'paid',subtotal:75000,tax_rate:16,tax_amount:12000,total:87000,due_date:'2025-04-01',currency:'USD',paid_at:now()},
  ].forEach(inv=>{const id=nextId();db.get('invoices').push({id,tenant_id:tid,created_by:adminId,notes:'',created_at:now(),updated_at:now(),...inv}).write();db.get('invoice_items').push({id:nextId(),invoice_id:id,description:`Service`,quantity:1,unit_price:inv.subtotal,amount:inv.subtotal}).write()});

  // Templates
  [{name:'Introduction',channel:'email',subject:'Introduction from {{sender_name}}',body:'Hi {{name}},\n\nI\'m {{sender_name}}. I wanted to reach out regarding {{company}}.\n\nWould you be open to a quick call?\n\n{{sender_name}}'},
   {name:'Follow-up',channel:'email',subject:'Following up — {{company}}',body:'Hi {{name}},\n\nJust following up on our conversation about {{company}}.\n\nAre you still interested?\n\n{{sender_name}}'},
   {name:'WhatsApp Intro',channel:'whatsapp',body:'Hi {{name}} 👋 This is {{sender_name}}. Would love to connect about {{company}}!'},
  ].forEach(t=>db.get('templates').push({id:nextId(),tenant_id:tid,created_by:adminId,...t,created_at:now()}).write());

  // Projects
  const p1=nextId();
  db.get('projects').push({id:p1,tenant_id:tid,name:'NexusCRM Onboarding',description:'Client onboarding project',contact_id:cIds[0],status:'active',priority:'high',due_date:'2025-06-30',created_by:adminId,created_at:now()}).write();
  [{title:'Setup CRM workspace',status:'done',priority:'high',assigned_to:adminId,due_date:'2025-05-10',description:''},
   {title:'Import existing contacts',status:'in_progress',priority:'high',assigned_to:adminId,due_date:'2025-05-15',description:''},
   {title:'Train sales team',status:'todo',priority:'medium',assigned_to:userId,due_date:'2025-05-25',description:''},
   {title:'Configure email integration',status:'todo',priority:'low',assigned_to:userId,due_date:'2025-06-01',description:''},
  ].forEach(t=>db.get('tasks').push({id:nextId(),tenant_id:tid,project_id:p1,...t,created_at:now(),updated_at:now()}).write());

  // Tickets
  [{contact_id:cIds[0],subject:'Cannot access dashboard',body:'I keep getting a 403 error when logging in.',priority:'high',status:'open',assigned_to:adminId},
   {contact_id:cIds[1],subject:'Invoice PDF not generating',body:'The download button does nothing.',priority:'medium',status:'in_progress',assigned_to:adminId},
   {contact_id:cIds[4],subject:'Need to update billing details',body:'Our card expired, need to update.',priority:'low',status:'resolved',assigned_to:userId},
  ].forEach(t=>db.get('tickets').push({id:nextId(),tenant_id:tid,...t,ticket_number:`TKT-${String(db.get('tickets').size().value()+1).padStart(4,'0')}`,created_at:now(),updated_at:now(),resolved_at:t.status==='resolved'?now():null}).write());

  // Contracts
  [{contact_id:cIds[0],title:'Enterprise SaaS Agreement',value:42000,status:'signed',start_date:'2025-01-01',end_date:'2025-12-31',auto_renew:true},
   {contact_id:cIds[2],title:'Partnership Agreement',value:75000,status:'signed',start_date:'2025-02-01',end_date:'2026-01-31',auto_renew:false},
   {contact_id:cIds[1],title:'Pilot Agreement',value:5000,status:'draft',start_date:'2025-06-01',end_date:'2025-08-31',auto_renew:false},
  ].forEach(c=>db.get('contracts').push({id:nextId(),tenant_id:tid,created_by:adminId,...c,contract_number:`CTR-${String(db.get('contracts').size().value()+1).padStart(4,'0')}`,notes:'',created_at:now()}).write());

  // Expense categories
  ['Travel','Software','Marketing','Office','Meals','Equipment'].forEach(n=>db.get('expense_categories').push({id:nextId(),tenant_id:tid,name:n}).write());
  [{description:'Flight to Nairobi',amount:450,category:'Travel',date:'2025-04-10',receipt:null,status:'approved',submitted_by:adminId},
   {description:'CRM hosting (Railway)',amount:29,category:'Software',date:'2025-05-01',receipt:null,status:'approved',submitted_by:adminId},
   {description:'Google Ads campaign',amount:350,category:'Marketing',date:'2025-04-15',receipt:null,status:'pending',submitted_by:userId},
  ].forEach(e=>db.get('expenses').push({id:nextId(),tenant_id:tid,...e,created_at:now()}).write());

  // Email campaigns
  const camp1=nextId();
  db.get('campaigns').push({id:camp1,tenant_id:tid,name:'May Newsletter',subject:'What\'s new at NexusCRM',body:'<h2>Hello {{name}},</h2><p>Here\'s what\'s new this month...</p>',status:'sent',segment:'all',sent_at:now(),opens:3,clicks:1,created_by:adminId,created_at:now()}).write();
  cIds.forEach(cid=>db.get('campaign_contacts').push({id:nextId(),campaign_id:camp1,contact_id:cid,opened:Math.random()>.5,clicked:Math.random()>.8,sent_at:now()}).write());

  // Automation flows
  db.get('automation_flows').push({id:nextId(),tenant_id:tid,name:'New Lead Welcome',trigger:'contact_created',conditions:JSON.stringify([{field:'status',op:'eq',value:'Lead'}]),actions:JSON.stringify([{type:'send_email',template:'Introduction',delay_hours:0},{type:'set_reminder',days:3,message:'Follow up with new lead'}]),status:'active',run_count:4,created_by:adminId,created_at:now()}).write();
  db.get('automation_flows').push({id:nextId(),tenant_id:tid,name:'Cold Lead Re-engage',trigger:'no_contact_days',conditions:JSON.stringify([{field:'days',op:'gte',value:14}]),actions:JSON.stringify([{type:'send_whatsapp',template:'WhatsApp Intro'},{type:'add_tag',value:'needs-followup'}]),status:'active',run_count:2,created_by:adminId,created_at:now()}).write();

  // WhatsApp inbox seed
  [{contact_id:cIds[0],direction:'outbound',content:'Hi Amara! Following up on the enterprise plan.',wa_number:'+254712000001',status:'sent'},
   {contact_id:cIds[0],direction:'inbound',content:'Hi! Yes, I\'m interested. Can we schedule a call?',wa_number:'+254712000001',status:'received'},
   {contact_id:cIds[1],direction:'outbound',content:'Hi David, happy to arrange a demo!',wa_number:'+254721000002',status:'sent'},
  ].forEach(m=>db.get('whatsapp_inbox').push({id:nextId(),tenant_id:tid,...m,timestamp:now()}).write());

  // Team activity
  [adminId,userId].forEach(uid=>{
    const u=db.get('users').find({id:uid}).value();
    db.get('team_activity').push({id:nextId(),tenant_id:tid,user_id:uid,user_name:u.name,contacts_added:uid===adminId?6:0,messages_sent:uid===adminId?8:1,deals_closed:uid===adminId?2:0,revenue:uid===adminId?135000:0,emails_sent:uid===adminId?5:0,calls_logged:uid===adminId?4:0,tickets_resolved:uid===adminId?2:0,week_start:today(),updated_at:now()}).write();
  });

  // Branding (white-label)
  db.get('branding').push({id:nextId(),tenant_id:tid,app_name:'NexusCRM',logo_url:'',primary_color:'#3b82f6',accent_color:'#a855f7',custom_domain:'',favicon_url:'',tagline:'Relationships, Reimagined.',created_at:now()}).write();

  // Forecast snapshot
  const months=['Jan','Feb','Mar','Apr','May','Jun'];
  db.get('forecast_snapshots').push({id:nextId(),tenant_id:tid,period:'2025-H1',data:JSON.stringify(months.map((m,i)=>({month:m,actual:i<4?[28000,35000,42000,51000][i]:0,forecast:[30000,37000,44000,53000,62000,70000][i]}))),created_at:now()}).write();

  console.log('✅ NexusCRM v4 database seeded with all modules.');
}

// ════════════════════════════════════════════════
//  QUERY LAYER
// ════════════════════════════════════════════════
const q = {
  // Tenant
  getTenantBySlug: s  => db.get('tenants').find({slug:s}).value(),
  getTenantById:   id => db.get('tenants').find({id}).value(),
  updateTenantPlan:(plan,sid,status,id) => db.get('tenants').find({id}).assign({plan,stripe_sub_id:sid,sub_status:status}).write(),

  // Users
  getUserByEmail:(email,tid)=>db.get('users').filter({email:email.toLowerCase(),tenant_id:tid}).value()[0]||null,
  getUserById:id=>{const u=db.get('users').find({id}).value();if(!u)return null;const{password:_,...s}=u;return s},
  getAllUsers:tid=>db.get('users').filter({tenant_id:tid}).map(u=>{const{password:_,...s}=u;return s}).value().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)),
  createUser:(tid,name,email,pw,role)=>{const id=nextId();db.get('users').push({id,tenant_id:tid,name,email:email.toLowerCase(),password:pw,role,created_at:now(),last_login:null}).write();return{lastInsertRowid:id}},
  updateLastLogin:id=>db.get('users').find({id}).assign({last_login:now()}).write(),
  updateUser:(name,email,role,id,tid)=>db.get('users').find({id,tenant_id:tid}).assign({name,email,role}).write(),
  deleteUser:(id,tid)=>db.get('users').remove({id,tenant_id:tid}).write(),

  // Contacts
  getAllContacts:tid=>db.get('contacts').filter({tenant_id:tid}).value().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)),
  getContactById:(id,tid)=>db.get('contacts').find({id,tenant_id:tid}).value(),
  createContact:(tid,name,email,phone,wa,company,title,status,stage,deal,lc,notes,by)=>{const id=nextId();db.get('contacts').push({id,tenant_id:tid,name,email,phone,whatsapp:wa,company,title,status,stage,deal,last_contact:lc,notes,created_by:by,tags:[],industry_data:{},created_at:now(),updated_at:now()}).write();return{lastInsertRowid:id}},
  updateContact:(name,email,phone,wa,company,title,status,stage,deal,lc,notes,id,tid)=>db.get('contacts').find({id,tenant_id:tid}).assign({name,email,phone,whatsapp:wa,company,title,status,stage,deal,last_contact:lc,notes,updated_at:now()}).write(),
  deleteContact:(id,tid)=>db.get('contacts').remove({id,tenant_id:tid}).write(),
  updateStage:(stage,id,tid)=>db.get('contacts').find({id,tenant_id:tid}).assign({stage,updated_at:now()}).write(),
  updateLastContact:(id,tid)=>db.get('contacts').find({id,tenant_id:tid}).assign({last_contact:today(),updated_at:now()}).write(),

  // Messages
  getMsgsByContact:(cid,tid)=>{const msgs=db.get('messages').filter({contact_id:cid,tenant_id:tid}).value().sort((a,b)=>new Date(a.sent_at)-new Date(b.sent_at));return msgs.map(m=>({...m,sender_name:db.get('users').find({id:m.user_id}).value()?.name||'System'}))},
  getAllMessages:tid=>db.get('messages').filter({tenant_id:tid}).value().sort((a,b)=>new Date(b.sent_at)-new Date(a.sent_at)).slice(0,100).map(m=>({...m,sender_name:db.get('users').find({id:m.user_id}).value()?.name||'System',contact_name:db.get('contacts').find({id:m.contact_id}).value()?.name||'Unknown'})),
  createMessage:(tid,cid,uid,channel,dir,content,subject,status)=>{const id=nextId();db.get('messages').push({id,tenant_id:tid,contact_id:cid,user_id:uid,channel,direction:dir,content,subject,status,sent_at:now()}).write();return{lastInsertRowid:id}},

  // Invoices
  getAllInvoices:tid=>db.get('invoices').filter({tenant_id:tid}).value().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(inv=>{const c=inv.contact_id?db.get('contacts').find({id:inv.contact_id}).value():null;return{...inv,contact_name:c?.name||null,company:c?.company||null}}),
  getInvoiceById:(id,tid)=>db.get('invoices').find({id,tenant_id:tid}).value(),
  getInvoiceItems:id=>db.get('invoice_items').filter({invoice_id:id}).value(),
  createInvoice:(tid,cid,by,num,status,cur,sub,tr,tax,total,due,notes)=>{const id=nextId();db.get('invoices').push({id,tenant_id:tid,contact_id:cid,created_by:by,invoice_number:num,status,currency:cur,subtotal:sub,tax_rate:tr,tax_amount:tax,total,due_date:due,notes,paid_at:null,created_at:now(),updated_at:now()}).write();return{lastInsertRowid:id}},
  updateInvoiceStatus:(status,id,tid)=>{const p={status,updated_at:now()};if(status==='paid')p.paid_at=now();db.get('invoices').find({id,tenant_id:tid}).assign(p).write()},
  deleteInvoice:(id,tid)=>db.get('invoices').remove({id,tenant_id:tid,status:'draft'}).write(),
  addInvoiceItem:(iid,desc,qty,up,amt)=>{const id=nextId();db.get('invoice_items').push({id,invoice_id:iid,description:desc,quantity:qty,unit_price:up,amount:amt}).write();return{lastInsertRowid:id}},
  deleteInvoiceItems:iid=>db.get('invoice_items').remove({invoice_id:iid}).write(),
  nextInvoiceNum:tid=>({n:db.get('invoices').filter({tenant_id:tid}).size().value()+1}),

  // Templates
  getTemplates:tid=>db.get('templates').filter({tenant_id:tid}).value(),
  getTemplateById:(id,tid)=>db.get('templates').find({id,tenant_id:tid}).value(),
  createTemplate:(tid,by,name,channel,subject,body)=>{const id=nextId();db.get('templates').push({id,tenant_id:tid,created_by:by,name,channel,subject:subject||null,body,created_at:now()}).write();return{lastInsertRowid:id}},
  updateTemplate:(name,channel,subject,body,id,tid)=>db.get('templates').find({id,tenant_id:tid}).assign({name,channel,subject,body}).write(),
  deleteTemplate:(id,tid)=>db.get('templates').remove({id,tenant_id:tid}).write(),

  // Reminders
  getAllReminders:tid=>db.get('reminders').filter({tenant_id:tid}).value().sort((a,b)=>new Date(a.due_at)-new Date(b.due_at)).map(r=>{const c=db.get('contacts').find({id:r.contact_id}).value();const u=db.get('users').find({id:r.user_id}).value();return{...r,contact_name:c?.name||null,contact_phone:c?.phone||null,contact_email:c?.email||null,contact_wa:c?.whatsapp||null,user_name:u?.name||null}}),
  getPendingReminders:()=>db.get('reminders').filter({status:'pending'}).value().filter(r=>new Date(r.due_at)<=new Date()),
  createReminder:(tid,cid,uid,type,channel,msg,due,repeat)=>{const id=nextId();db.get('reminders').push({id,tenant_id:tid,contact_id:cid,user_id:uid,type,channel,message:msg,due_at:due,status:'pending',repeat_days:repeat||null,created_at:now()}).write();return{lastInsertRowid:id}},
  completeReminder:(id,nextDue)=>{if(nextDue)db.get('reminders').find({id}).assign({due_at:nextDue}).write();else db.get('reminders').find({id}).assign({status:'done'}).write()},
  deleteReminder:(id,tid)=>db.get('reminders').remove({id,tenant_id:tid}).write(),

  // Proposals
  getAllProposals:tid=>db.get('proposals').filter({tenant_id:tid}).value().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(p=>{const c=db.get('contacts').find({id:p.contact_id}).value();return{...p,contact_name:c?.name||null,company:c?.company||null}}),
  getProposalById:(id,tid)=>db.get('proposals').find({id,tenant_id:tid}).value(),
  getProposalItems:id=>db.get('proposal_items').filter({proposal_id:id}).value(),
  createProposal:(tid,cid,by,title,intro,closing,valid_until,currency,subtotal,total,discount,notes)=>{const id=nextId();const num=`PROP-${String(db.get('proposals').filter({tenant_id:tid}).size().value()+1).padStart(4,'0')}`;db.get('proposals').push({id,tenant_id:tid,contact_id:cid,created_by:by,proposal_number:num,title,intro,closing,valid_until,currency,subtotal,total,discount,notes,status:'draft',sent_at:null,accepted_at:null,created_at:now(),updated_at:now()}).write();return{lastInsertRowid:id,proposal_number:num}},
  addProposalItem:(pid,desc,qty,up,amt)=>{const id=nextId();db.get('proposal_items').push({id,proposal_id:pid,description:desc,quantity:qty,unit_price:up,amount:amt}).write()},
  updateProposalStatus:(status,id,tid)=>{const p={status,updated_at:now()};if(status==='sent')p.sent_at=now();if(status==='accepted')p.accepted_at=now();db.get('proposals').find({id,tenant_id:tid}).assign(p).write()},
  deleteProposal:(id,tid)=>{db.get('proposal_items').remove({proposal_id:id}).write();db.get('proposals').remove({id,tenant_id:tid}).write()},

  // Projects & Tasks
  getAllProjects:tid=>db.get('projects').filter({tenant_id:tid}).value().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(p=>{const c=p.contact_id?db.get('contacts').find({id:p.contact_id}).value():null;const tasks=db.get('tasks').filter({project_id:p.id}).value();return{...p,contact_name:c?.name||null,task_count:tasks.length,done_count:tasks.filter(t=>t.status==='done').length}}),
  getProjectById:(id,tid)=>db.get('projects').find({id,tenant_id:tid}).value(),
  createProject:(tid,by,data)=>{const id=nextId();db.get('projects').push({id,tenant_id:tid,created_by:by,...data,created_at:now(),updated_at:now()}).write();return{lastInsertRowid:id}},
  updateProject:(id,tid,data)=>db.get('projects').find({id,tenant_id:tid}).assign({...data,updated_at:now()}).write(),
  deleteProject:(id,tid)=>{db.get('tasks').remove({project_id:id}).write();db.get('projects').remove({id,tenant_id:tid}).write()},
  getTasksByProject:pid=>db.get('tasks').filter({project_id:pid}).value().sort((a,b)=>new Date(a.due_date)-new Date(b.due_date)),
  getAllTasks:tid=>db.get('tasks').filter({tenant_id:tid}).value(),
  createTask:(tid,pid,by,data)=>{const id=nextId();db.get('tasks').push({id,tenant_id:tid,project_id:pid,created_by:by,...data,created_at:now(),updated_at:now()}).write();return{lastInsertRowid:id}},
  updateTask:(id,tid,data)=>db.get('tasks').find({id,tenant_id:tid}).assign({...data,updated_at:now()}).write(),
  deleteTask:(id,tid)=>db.get('tasks').remove({id,tenant_id:tid}).write(),

  // Tickets
  getAllTickets:tid=>db.get('tickets').filter({tenant_id:tid}).value().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(t=>{const c=db.get('contacts').find({id:t.contact_id}).value();const u=db.get('users').find({id:t.assigned_to}).value();return{...t,contact_name:c?.name||null,assigned_name:u?.name||null}}),
  getTicketById:(id,tid)=>db.get('tickets').find({id,tenant_id:tid}).value(),
  createTicket:(tid,cid,by,subject,body,priority)=>{const id=nextId();const num=`TKT-${String(db.get('tickets').filter({tenant_id:tid}).size().value()+1).padStart(4,'0')}`;db.get('tickets').push({id,tenant_id:tid,contact_id:cid,created_by:by,ticket_number:num,subject,body,priority:priority||'medium',status:'open',assigned_to:by,resolved_at:null,created_at:now(),updated_at:now()}).write();return{lastInsertRowid:id,ticket_number:num}},
  updateTicket:(id,tid,data)=>db.get('tickets').find({id,tenant_id:tid}).assign({...data,updated_at:now()}).write(),
  getTicketMessages:id=>db.get('ticket_messages').filter({ticket_id:id}).value().sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)),
  addTicketMessage:(tid,id,uid,content,internal)=>{const mid=nextId();db.get('ticket_messages').push({id:mid,ticket_id:id,user_id:uid,content,internal:internal||false,created_at:now()}).write();return mid},

  // Contracts
  getAllContracts:tid=>db.get('contracts').filter({tenant_id:tid}).value().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).map(c=>{const ct=db.get('contacts').find({id:c.contact_id}).value();return{...c,contact_name:ct?.name||null,company:ct?.company||null}}),
  getContractById:(id,tid)=>db.get('contracts').find({id,tenant_id:tid}).value(),
  createContract:(tid,cid,by,data)=>{const id=nextId();const num=`CTR-${String(db.get('contracts').filter({tenant_id:tid}).size().value()+1).padStart(4,'0')}`;db.get('contracts').push({id,tenant_id:tid,contact_id:cid,created_by:by,contract_number:num,...data,created_at:now()}).write();return{lastInsertRowid:id,contract_number:num}},
  updateContractStatus:(status,id,tid)=>db.get('contracts').find({id,tenant_id:tid}).assign({status}).write(),
  deleteContract:(id,tid)=>db.get('contracts').remove({id,tenant_id:tid}).write(),

  // Expenses
  getAllExpenses:tid=>db.get('expenses').filter({tenant_id:tid}).value().sort((a,b)=>new Date(b.date)-new Date(a.date)),
  getExpenseCategories:tid=>db.get('expense_categories').filter({tenant_id:tid}).value(),
  createExpense:(tid,data)=>{const id=nextId();db.get('expenses').push({id,tenant_id:tid,...data,created_at:now()}).write();return{lastInsertRowid:id}},
  updateExpenseStatus:(status,id,tid)=>db.get('expenses').find({id,tenant_id:tid}).assign({status}).write(),
  deleteExpense:(id,tid)=>db.get('expenses').remove({id,tenant_id:tid}).write(),

  // Campaigns
  getAllCampaigns:tid=>db.get('campaigns').filter({tenant_id:tid}).value().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)),
  getCampaignById:(id,tid)=>db.get('campaigns').find({id,tenant_id:tid}).value(),
  createCampaign:(tid,by,data)=>{const id=nextId();db.get('campaigns').push({id,tenant_id:tid,created_by:by,...data,status:'draft',opens:0,clicks:0,created_at:now()}).write();return{lastInsertRowid:id}},
  updateCampaign:(id,tid,data)=>db.get('campaigns').find({id,tenant_id:tid}).assign({...data}).write(),
  deleteCampaign:(id,tid)=>db.get('campaigns').remove({id,tenant_id:tid}).write(),

  // Automation flows
  getAllFlows:tid=>db.get('automation_flows').filter({tenant_id:tid}).value(),
  createFlow:(tid,by,data)=>{const id=nextId();db.get('automation_flows').push({id,tenant_id:tid,created_by:by,...data,run_count:0,created_at:now()}).write();return{lastInsertRowid:id}},
  updateFlow:(id,tid,data)=>db.get('automation_flows').find({id,tenant_id:tid}).assign(data).write(),
  deleteFlow:(id,tid)=>db.get('automation_flows').remove({id,tenant_id:tid}).write(),
  logAutomation:(tid,fid,cid,action)=>db.get('automation_logs').push({id:nextId(),tenant_id:tid,flow_id:fid,contact_id:cid,action,created_at:now()}).write(),

  // WhatsApp Inbox
  getWAInbox:tid=>db.get('whatsapp_inbox').filter({tenant_id:tid}).value().sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)),
  getWAConversation:(tid,cid)=>db.get('whatsapp_inbox').filter({tenant_id:tid,contact_id:cid}).value().sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp)),
  addWAMessage:(tid,cid,dir,content,wa_number)=>{const id=nextId();db.get('whatsapp_inbox').push({id,tenant_id:tid,contact_id:cid,direction:dir,content,wa_number,status:dir==='outbound'?'sent':'received',timestamp:now()}).write();return{lastInsertRowid:id}},

  // AI Conversations
  getAIHistory:tid=>db.get('ai_conversations').filter({tenant_id:tid}).value().sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)).slice(-20),
  addAIMessage:(tid,uid,role,content)=>db.get('ai_conversations').push({id:nextId(),tenant_id:tid,user_id:uid,role,content,created_at:now()}).write(),
  clearAIHistory:tid=>db.get('ai_conversations').remove({tenant_id:tid}).write(),

  // Client Portal
  createPortalToken:(tid,cid,email)=>{const token=crypto.randomBytes(32).toString('hex');db.get('portal_tokens').remove({contact_id:cid}).write();db.get('portal_tokens').push({id:nextId(),tenant_id:tid,contact_id:cid,email,token,created_at:now(),expires_at:new Date(Date.now()+30*864e5).toISOString()}).write();return token},
  getPortalToken:token=>{const pt=db.get('portal_tokens').find({token}).value();if(!pt||new Date(pt.expires_at)<new Date())return null;return pt},

  // Branding
  getBranding:tid=>db.get('branding').find({tenant_id:tid}).value(),
  updateBranding:(tid,data)=>{const ex=db.get('branding').find({tenant_id:tid}).value();if(ex)db.get('branding').find({tenant_id:tid}).assign(data).write();else db.get('branding').push({id:nextId(),tenant_id:tid,...data,created_at:now()}).write()},

  // Integrations / Webhooks / Activity
  getIntegrations:tid=>db.get('integrations').filter({tenant_id:tid}).value(),
  upsertIntegration:(tid,type,config)=>{const ex=db.get('integrations').find({tenant_id:tid,type}).value();ex?db.get('integrations').find({tenant_id:tid,type}).assign({config,enabled:1}).write():db.get('integrations').push({id:nextId(),tenant_id:tid,type,config,enabled:1,created_at:now()}).write()},
  toggleIntegration:(enabled,tid,type)=>db.get('integrations').find({tenant_id:tid,type}).assign({enabled}).write(),
  getWebhooks:tid=>db.get('webhooks').filter({tenant_id:tid}).value(),
  createWebhook:(tid,url,events,secret)=>{const id=nextId();db.get('webhooks').push({id,tenant_id:tid,url,events,secret,enabled:1,created_at:now()}).write();return{lastInsertRowid:id}},
  deleteWebhook:(id,tid)=>db.get('webhooks').remove({id,tenant_id:tid}).write(),
  logActivity:(tid,uid,cid,action,details)=>db.get('activity_log').push({id:nextId(),tenant_id:tid,user_id:uid,contact_id:cid,action,details,created_at:now()}).write(),
  getActivity:tid=>db.get('activity_log').filter({tenant_id:tid}).value().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,30).map(a=>({...a,user_name:db.get('users').find({id:a.user_id}).value()?.name||'System',contact_name:a.contact_id?db.get('contacts').find({id:a.contact_id}).value()?.name||null:null})),

  // Team Activity
  getTeamActivity:tid=>db.get('team_activity').filter({tenant_id:tid}).value(),
  incrementActivity:(uid,tid,field,by=1)=>{const row=db.get('team_activity').find({user_id:uid,tenant_id:tid}).value();if(row)db.get('team_activity').find({user_id:uid,tenant_id:tid}).assign({[field]:(row[field]||0)+by,updated_at:now()}).write();else{const u=db.get('users').find({id:uid}).value();db.get('team_activity').push({id:nextId(),tenant_id:tid,user_id:uid,user_name:u?.name||'Unknown',contacts_added:0,messages_sent:0,deals_closed:0,revenue:0,emails_sent:0,calls_logged:0,tickets_resolved:0,week_start:today(),updated_at:now(),[field]:by}).write()}},

  // Stats
  getStats:tid=>{
    const contacts=db.get('contacts').filter({tenant_id:tid}).value();
    const invoices=db.get('invoices').filter({tenant_id:tid}).value();
    const tickets=db.get('tickets').filter({tenant_id:tid}).value();
    const projects=db.get('projects').filter({tenant_id:tid}).value();
    const contracts=db.get('contracts').filter({tenant_id:tid}).value();
    const expenses=db.get('expenses').filter({tenant_id:tid}).value();
    const reminders=db.get('reminders').filter({tenant_id:tid,status:'pending'}).value();
    const proposals=db.get('proposals').filter({tenant_id:tid}).value();
    const messages=db.get('messages').filter({tenant_id:tid}).value();
    return{
      total_contacts:contacts.length,
      leads:contacts.filter(c=>c.status==='Lead').length,
      clients:contacts.filter(c=>c.status==='Client').length,
      partners:contacts.filter(c=>c.status==='Partner').length,
      churned:contacts.filter(c=>c.status==='Churned').length,
      pipeline:contacts.reduce((s,c)=>s+(Number(c.deal)||0),0),
      revenue:invoices.filter(i=>i.status==='paid').reduce((s,i)=>s+(Number(i.total)||0),0),
      unpaid_invoices:invoices.filter(i=>i.status==='sent').length,
      open_tickets:tickets.filter(t=>t.status==='open').length,
      active_projects:projects.filter(p=>p.status==='active').length,
      active_contracts:contracts.filter(c=>c.status==='signed').length,
      total_expenses:expenses.reduce((s,e)=>s+(Number(e.amount)||0),0),
      pending_reminders:reminders.filter(r=>new Date(r.due_at)<=new Date(Date.now()+864e5)).length,
      proposals_sent:proposals.filter(p=>p.status==='sent').length,
      messages_today:messages.filter(m=>m.sent_at?.startsWith(today())).length,
    };
  },
};

module.exports = { db, q, nextId, now, today };
