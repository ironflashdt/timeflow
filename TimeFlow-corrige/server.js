/* ============================================================================
   TimeFlow — serveur local (Node natif, zéro dépendance)
   - OAuth Google + Google Calendar (lecture/écriture)
   - IA locale gratuite via Ollama
   - Moteur de planification : Focus, Habitudes, Tâches (avec découpage),
     Buffers, priorités P1-P4, heures perso/pro, time defense, no-meeting days
   - Replanification auto quand l'agenda change
   Lancer :  node server.js   →   http://localhost:3000
============================================================================ */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT        = Number(process.env.PORT) || Number(process.argv[2]) || 3000;
const TOKEN_FILE  = path.join(__dirname, 'tokens.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const HABITS_FILE = path.join(__dirname, 'habits.json');
const TASKS_FILE  = path.join(__dirname, 'tasks.json');
const STATS_FILE  = path.join(__dirname, 'stats.json');
const MEMORY_FILE = path.join(__dirname, 'memory.json');

// ─── CONFIG (valeurs par défaut, fusionnées avec config.json) ───
const DEFAULT_HOURS = on => ({ mon:{on:true,start:9,end:18}, tue:{on:true,start:9,end:18}, wed:{on:true,start:9,end:18}, thu:{on:true,start:9,end:18}, fri:{on:true,start:9,end:18}, sat:{on:false,start:10,end:16}, sun:{on:false,start:10,end:16} });
let config = {
  client_id:'', client_secret:'',
  ollama_url:'http://127.0.0.1:11434', model:'qwen2.5:7b',
  ai_provider:'ollama',              // 'ollama' (local, gratuit/illimité) | 'openai' (API compatible : Groq, OpenRouter…)
  ai_base_url:'', ai_api_key:'',     // pour provider 'openai' (ex. https://api.groq.com/openai/v1 + clé)
  timezone:'Europe/Paris',
  work_start:9, work_end:18,          // heures de travail (focus + tâches)
  personal_start:7, personal_end:22,  // heures perso (habitudes par défaut)
  focus_duration:120, buffer_minutes:15,
  no_meeting_days:[],                 // ex: ["mercredi"]
  auto_schedule:true,
  // ── Moteur type Reclaim ──
  task_max_per_day:240, focus_weekly_target:0, focus_max_per_day:180, horizon_days:14,
  // ── Compte / profil ──
  profile:{ name:'', company:'', company_size:'', job_title:'', department:'', role:'', usage:'' },
  start_week_on:'monday',            // 'monday' | 'sunday'
  // ── Horaires détaillés (par jour) ──
  working_hours: DEFAULT_HOURS(), personal_hours:{ mon:{on:true,start:7,end:22}, tue:{on:true,start:7,end:22}, wed:{on:true,start:7,end:22}, thu:{on:true,start:7,end:22}, fri:{on:true,start:7,end:22}, sat:{on:true,start:8,end:23}, sun:{on:true,start:8,end:23} },
  meeting_hours: DEFAULT_HOURS(),
  // ── Marges (buffers) ──
  buffers:{ task_habit_break:0, travel_time:0, decompression:0 },
  // ── Couleurs (catégorie → colorId Google) ──
  colors:{ team_meeting:'9', work:'2', personal:'6', travel_breaks:'8', external_meeting:'7', one_on_one:'1', focus:'2' },
  color_scope:'managed',             // 'managed' | 'all'
  // ── Planification (affichage + comportement) ──
  date_format:'DD/MM/YYYY', time_format:'24h', auto_lock:false, start_intervals:15,
  emoji_prefix:false, calendar_tips:true,
  auto_reflow:true,                  // réorganise tout après une modif manuelle
  preview_mode:true,                 // propose les changements en aperçu (à confirmer) au lieu d'écrire direct
  onboarded:false,                   // l'assistant a-t-il fait connaissance avec l'utilisateur
  ai_tone:'chaleureux',              // 'chaleureux' | 'direct' | 'motivant' — style des réponses de l'assistant
  ai_tts:false,                      // lecture vocale des réponses (hors mode vocal)
  focus_mode:'proactive',            // 'proactive' | 'reactive'
  timeoff:[],                        // [{start:'YYYY-MM-DD',end:'YYYY-MM-DD',label}] congés/absences
  // ── Valeurs par défaut des tâches ──
  task_defaults:{ priority:'p2', duration:60, split:true, min_chunk:30, max_chunk:120, hours:'work', start_delay_h:0, due_days:3, private:true, oneoff_duration:30 },
  // ── Notifications (navigateur) ──
  notif:{ desktop:false, chime:false, tab_alert:true, reminder_min:5, daily_summary:false }
};
// fusion (deep-merge des objets imbriqués connus)
if (fs.existsSync(CONFIG_FILE)) {
  const saved = JSON.parse(fs.readFileSync(CONFIG_FILE));
  const NEST = ['profile','working_hours','personal_hours','meeting_hours','buffers','colors','task_defaults','notif'];
  for (const k of NEST) if (saved[k] && typeof saved[k]==='object') saved[k] = {...config[k], ...saved[k]};
  config = {...config, ...saved};
}
function saveConfig(){ fs.writeFileSync(CONFIG_FILE, JSON.stringify(config)); }

// ─── DONNÉES ───
let tokens = fs.existsSync(TOKEN_FILE) ? JSON.parse(fs.readFileSync(TOKEN_FILE)) : null;
let habits = fs.existsSync(HABITS_FILE) ? JSON.parse(fs.readFileSync(HABITS_FILE)) : [];
let tasks  = fs.existsSync(TASKS_FILE)  ? JSON.parse(fs.readFileSync(TASKS_FILE))  : [];
let stats  = fs.existsSync(STATS_FILE)  ? JSON.parse(fs.readFileSync(STATS_FILE))  : { focusHours:0, meetingHours:0, habitsCompleted:0, streak:0 };

const DEFAULT_MEMORY = { goals:[], constraints:[], preferences:[], weekHistory:[], lastPlanHash:'' };
let memory = fs.existsSync(MEMORY_FILE) ? {...DEFAULT_MEMORY, ...JSON.parse(fs.readFileSync(MEMORY_FILE))} : {...DEFAULT_MEMORY};
function saveMemory(){ fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2)); }

const saveHabits = () => fs.writeFileSync(HABITS_FILE, JSON.stringify(habits));
const saveTasks  = () => fs.writeFileSync(TASKS_FILE,  JSON.stringify(tasks));
const saveStats  = () => fs.writeFileSync(STATS_FILE,  JSON.stringify(stats));

// ─── VERROUS (événements épinglés manuellement → le moteur ne les déplace pas) ───
const LOCKS_FILE = path.join(__dirname, 'locks.json');
let locks = new Set(fs.existsSync(LOCKS_FILE) ? JSON.parse(fs.readFileSync(LOCKS_FILE)) : []);
const saveLocks = () => fs.writeFileSync(LOCKS_FILE, JSON.stringify([...locks]));

// ─── ÉTAT POLLING CALENDRIER ───
let lastCalendarHash = '';
let replanDebounce   = null;

// ─── OAUTH ───
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;
const SCOPES = 'https://www.googleapis.com/auth/calendar';

/* ───────────────────────────────────────────────────────────────
   IDENTIFIANTS GOOGLE OAUTH  (à remplir UNE seule fois)
   ───────────────────────────────────────────────────────────────
   Colle ici les identifiants de TON projet Google Cloud :
     • API « Google Calendar » activée
     • Écran de consentement OAuth configuré
     • URI de redirection autorisée : http://localhost:3000/oauth/callback
   Une fois ces deux valeurs renseignées, l'app affiche directement
   « Continuer avec Google » dès le premier lancement et connecte
   l'agenda automatiquement après la connexion.
   (Si tu utilises déjà l'app, tu retrouves ces valeurs dans config.json.)
   Laisse vide pour conserver l'ancien mode « saisie manuelle ».
*/
const GOOGLE_CLIENT_ID     = ''; // ex : 1234567890-abcd….apps.googleusercontent.com
const GOOGLE_CLIENT_SECRET = ''; // ex : GOCSPX-xxxxxxxxxxxxxxxxxxxx

// Un identifiant saisi manuellement (config.json) a priorité ; sinon on prend l'intégré.
const clientId     = () => config.client_id     || GOOGLE_CLIENT_ID;
const clientSecret = () => config.client_secret || GOOGLE_CLIENT_SECRET;
const hasCreds     = () => !!(clientId() && clientSecret());

function getAuthUrl() {
  const p = new URLSearchParams({
    client_id:clientId(), redirect_uri:REDIRECT_URI, response_type:'code',
    scope:SCOPES, access_type:'offline', prompt:'consent'
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

function oauthPost(body) {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(body);
    const req = https.request({ hostname:'oauth2.googleapis.com', path:'/token', method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(b)} },
      res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch{resolve({});} }); });
    req.on('error',reject); req.write(b); req.end();
  });
}

async function refreshAccessToken() {
  const t = await oauthPost({ client_id:clientId(), client_secret:clientSecret(), refresh_token:tokens.refresh_token, grant_type:'refresh_token' });
  if (!t.access_token) throw new Error('Refresh token invalide — reconnecte-toi.');
  tokens.access_token = t.access_token;
  tokens.expiry_date  = Date.now() + (t.expires_in * 1000);
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens));
}

async function getValidToken() {
  if (!tokens) throw new Error('Non authentifié');
  if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60000) await refreshAccessToken();
  return tokens.access_token;
}

// ─── GOOGLE CALENDAR ───
function calReq(method, urlPath, body=null) {
  return getValidToken().then(token => new Promise((resolve, reject) => {
    const bs = body ? JSON.stringify(body) : null;
    const headers = { 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json' };
    if (bs) headers['Content-Length'] = Buffer.byteLength(bs);
    const req = https.request({ hostname:'www.googleapis.com', path:urlPath, method, headers }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve({status:res.statusCode,data:d?JSON.parse(d):{}});}catch{resolve({status:res.statusCode,data:{}});} });
    });
    req.on('error',reject); if (bs) req.write(bs); req.end();
  }));
}

async function getEvents(timeMin, timeMax) {
  const p = new URLSearchParams({
    timeMin: timeMin || new Date().toISOString(),
    timeMax: timeMax || new Date(Date.now()+7*86400000).toISOString(),
    singleEvents:'true', orderBy:'startTime', maxResults:'250'
  });
  const r = await calReq('GET', `/calendar/v3/calendars/primary/events?${p}`);
  return r.data.items || [];
}

async function createEvent(ev) {
  const b = {
    summary: ev.title, description: ev.description || 'TimeFlow',
    colorId: ev.colorId || '9',
    start: { dateTime:ev.start, timeZone:config.timezone },
    end:   { dateTime:ev.end,   timeZone:config.timezone }
  };
  if (ev.extendedProperties) b.extendedProperties = ev.extendedProperties;
  if (ev.transparency)       b.transparency = ev.transparency;          // 'transparent' = Disponible
  if (ev.location)           b.location = ev.location;
  const r = await calReq('POST', '/calendar/v3/calendars/primary/events', b);
  return r.data;
}

async function updateEvent(id, ev) {
  const body = {};
  if (ev.title!=null) body.summary = ev.title;
  if (ev.description!=null) body.description = ev.description;
  if (ev.start) body.start = { dateTime:ev.start, timeZone:config.timezone };
  if (ev.end)   body.end   = { dateTime:ev.end,   timeZone:config.timezone };
  if (ev.colorId) body.colorId = ev.colorId;
  if (ev.extendedProperties) body.extendedProperties = ev.extendedProperties;
  if (ev.transparency) body.transparency = ev.transparency;
  if (ev.location!=null) body.location = ev.location;
  const r = await calReq('PATCH', `/calendar/v3/calendars/primary/events/${id}`, body);
  return r.data;
}

async function getEvent(id) {
  const r = await calReq('GET', `/calendar/v3/calendars/primary/events/${id}`);
  return r.data;
}

async function deleteEvent(id) {
  const r = await calReq('DELETE', `/calendar/v3/calendars/primary/events/${id}`);
  return r.status === 204 || r.status === 200 || r.status === 410;
}

// ─── IA (agnostique du fournisseur) ───────────────────────────────
//  • provider 'ollama'  → modèle LOCAL gratuit & illimité (Ollama / LM Studio)
//  • provider 'openai'  → toute API compatible OpenAI (Groq, OpenRouter, …)
//  Les deux renvoient la forme { message:{ content } } pour les appelants.
function llmCall(messages, systemPrompt, jsonMode=false){
  const msgs = [{ role:'system', content:systemPrompt }, ...messages];
  return (config.ai_provider === 'openai') ? openaiCall(msgs, jsonMode) : ollamaCall(msgs, jsonMode);
}
let _ollamaModel = null;   // modèle effectivement utilisé (repli si le modèle configuré n'est pas installé)
function listOllamaModels(){
  return new Promise((resolve)=>{ try{ const u=new URL(config.ollama_url||'http://127.0.0.1:11434'); const lib=u.protocol==='https:'?https:http;
    const rq=lib.request({hostname:u.hostname,port:u.port||(u.protocol==='https:'?443:11434),path:'/api/tags',method:'GET'},rs=>{let d='';rs.on('data',c=>d+=c);rs.on('end',()=>{try{resolve((JSON.parse(d).models||[]).map(m=>m.name));}catch(_){resolve([]);}});});
    rq.on('error',()=>resolve([])); rq.setTimeout(2500,()=>{rq.destroy(); resolve([]);}); rq.end(); }catch(_){ resolve([]); } });
}
function ollamaCall(msgs, jsonMode=false){ return ollamaTry(_ollamaModel || config.model || 'qwen2.5:7b', msgs, jsonMode, false); }
function ollamaTry(model, msgs, jsonMode, isRetry){
  return new Promise((resolve, reject) => {
    const u = new URL(config.ollama_url || 'http://127.0.0.1:11434');
    const lib = u.protocol==='https:' ? https : http;
    const body = JSON.stringify({ model, messages: msgs, stream:false, options:{ temperature: jsonMode?0.1:0.5, num_predict: jsonMode?700:400 }, ...(jsonMode ? { format:'json' } : {}) });
    const req = lib.request({ hostname:u.hostname, port:u.port||(u.protocol==='https:'?443:11434), path:'/api/chat', method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} },
      res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{ const j=JSON.parse(d);
        // Modèle non installé → on bascule UNE fois sur un modèle réellement présent (pour ne jamais casser le chat)
        if(j.error && /not found|try pulling|no such model|not exist/i.test(j.error) && !isRetry){
          return listOllamaModels().then(models=>{ const fb=models.find(m=>m!==model); if(fb){ _ollamaModel=fb; ollamaTry(fb, msgs, jsonMode, true).then(resolve,reject); } else reject(new Error(j.error)); }).catch(()=>reject(new Error(j.error)));
        }
        resolve(j); }catch(e){reject(e);} }); });
    req.on('error',reject);
    req.setTimeout(60000, ()=>req.destroy(new Error('Ollama: délai dépassé')));
    req.write(body); req.end();
  });
}
// API compatible OpenAI (Groq, OpenRouter, LM Studio, vLLM…)
function openaiCall(msgs, jsonMode=false){
  return new Promise((resolve, reject) => {
    const base = (config.ai_base_url || 'https://api.groq.com/openai/v1').replace(/\/+$/,'');
    const u = new URL(base + '/chat/completions');
    const lib = u.protocol==='https:' ? https : http;
    const body = JSON.stringify({
      model: config.model || 'llama-3.3-70b-versatile',
      messages: msgs, temperature: jsonMode?0.1:0.5,
      ...(jsonMode ? { response_format:{ type:'json_object' } } : {})
    });
    const req = lib.request({ hostname:u.hostname, port:u.port||(u.protocol==='https:'?443:80), path:u.pathname+u.search, method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':'Bearer '+(config.ai_api_key||'')} },
      res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{ const j=JSON.parse(d);
        const content=j.choices?.[0]?.message?.content; if(content==null && j.error) return reject(new Error(j.error.message||'Erreur API IA'));
        resolve({ message:{ content: content||'' } }); }catch(e){ reject(e); } }); });
    req.on('error',reject);
    req.setTimeout(60000, ()=>req.destroy(new Error('IA cloud: délai dépassé')));
    req.write(body); req.end();
  });
}

// ─── HELPERS PLANIFICATION ───
const DAY_MAP = { dimanche:0, lundi:1, mardi:2, mercredi:3, jeudi:4, vendredi:5, samedi:6 };
const PRIO_RANK = { p1:0, critical:0, p2:1, high:1, p3:2, medium:2, p4:3, low:3 };
const prioRank  = p => PRIO_RANK[String(p||'medium').toLowerCase()] ?? 2;
const PRIO_DOT  = ['🔴','🟠','🟡','🟢'];
const PRIO_COLOR= ['11','6','5','2'];   // Google colorIds: tomato, tangerine, banana, sage
const PRIO_CODES= ['p1','p2','p3','p4'];
const clamp = (n,lo,hi) => Math.max(lo, Math.min(hi, Number.isFinite(+n) ? +n : lo));
const normPrio = (p,def='p3') => { const s=String(p||'').toLowerCase(); if(PRIO_CODES.includes(s)) return s; return PRIO_RANK[s]!=null ? PRIO_CODES[PRIO_RANK[s]] : def; };

// ─── NORMALISATION : borne les durées/priorités pour éviter les blocs absurdes ───
function sanitizeHabit(h){
  const mn = clamp(h.minDur ?? h.duration ?? 60, 15, 480);
  const mx = clamp(h.maxDur ?? h.duration ?? mn, mn, 480);
  const days = (h.idealDays || h.days || []);
  const tpw = clamp(h.timesPerWeek ?? days.length ?? 1, 1, 7);
  const out = { ...h, minDur:mn, maxDur:mx, duration:mx, timesPerWeek:tpw, priority:normPrio(h.priority,'p3') };
  if (out.preferredStart!=null){ const ph=clamp(out.preferredStart,0,23); out.preferredStart=ph; out.preferredEnd=clamp(ph+Math.max(1,Math.ceil(mx/60)),ph+1,24); }
  return out;
}
function sanitizeTask(t){
  const dur  = clamp(t.duration ?? 60, 5, 24*60);
  const split= t.splitUp!==false;
  const minC = clamp(t.minChunk ?? 30, 5, dur);
  const maxC = clamp(t.maxChunk ?? 120, minC, dur);
  return { ...t, duration:dur, splitUp:split, minChunk:split?minC:dur, maxChunk:split?maxC:dur, priority:normPrio(t.priority,'p2'), upNext:!!t.upNext };
}
// ─── ANTI-DOUBLON : renvoie un item identique déjà présent (soumission multiple) ───
const _norm = s => String(s||'').toLowerCase().trim().replace(/\s+/g,' ');
function findDupHabit(h){ const n=_norm(h.name); if(!n) return null;
  return habits.find(x=> _norm(x.name)===n && String(x.idealTime||'')===String(h.idealTime||'') && normPrio(x.priority)===normPrio(h.priority)) || null; }
function findDupTask(t){ const n=_norm(t.title); if(!n) return null;
  return tasks.find(x=> _norm(x.title)===n && String(x.deadline||'')===String(t.deadline||'')) || null; }

// Créneaux libres d'une journée entre [startH, endH], durée min en minutes
function getFreeSlots(events, date, startH, endH, minDuration=30) {
  const slots = [];
  const dS = new Date(date); dS.setHours(startH,0,0,0);
  const dE = new Date(date); dE.setHours(endH,0,0,0);
  const busy = events
    .filter(e => { const s=new Date(e.start?.dateTime||e.start?.date); const en=new Date(e.end?.dateTime||e.end?.date); return en>dS && s<dE; })
    .map(e => ({ start:new Date(e.start?.dateTime||e.start?.date), end:new Date(e.end?.dateTime||e.end?.date) }))
    .sort((a,b)=>a.start-b.start);
  let cur = new Date(dS);
  for (const b of busy) {
    if (cur < b.start) { const dur=(b.start-cur)/60000; if (dur>=minDuration) slots.push({start:new Date(cur),end:new Date(b.start),duration:dur}); }
    if (b.end > cur) cur = new Date(b.end);
  }
  if (cur < dE) { const dur=(dE-cur)/60000; if (dur>=minDuration) slots.push({start:new Date(cur),end:new Date(dE),duration:dur}); }
  return slots;
}

// ISO avec le BON décalage horaire (gère l'heure d'été automatiquement)
function isoLocal(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2,'0');
  const off = -d.getTimezoneOffset();              // minutes à l'est de UTC
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(a/60))}:${pad(a%60)}`;
}

function buildEventsHash(events) {
  return events.map(e=>`${e.id}|${e.start?.dateTime}|${e.end?.dateTime}`).sort().join(';');
}
const tfManaged = e => e.extendedProperties?.private?.tfManaged === '1';
// « Géré » = bloc créé par TimeFlow et déplaçable par l'optimiseur. Détection par
// MÉTADONNÉES d'abord (tfManaged), plus quelques marqueurs emoji legacy non ambigus
// (focus 🎯 / pause ⏸️ / pastille de priorité en tête de titre).
// ⚠️ On ne se base JAMAIS sur le nom d'une habitude/tâche : sinon un vrai événement
// Google (« Déjeuner avec Paul », « Sport ») serait pris pour un bloc géré et SUPPRIMÉ
// lors du wipe d'optimize(). C'était une cause de perte de données.
const isManaged = e => tfManaged(e) || e.summary?.includes('🎯') || e.summary?.includes('⏸️') ||
  PRIO_DOT.some(d=>e.summary?.startsWith(d));
const isLocked  = e => locks.has(e.id) || e.extendedProperties?.private?.tfLocked === '1';
const tfKindOf  = e => e.extendedProperties?.private?.tfKind || (e.summary?.includes('🎯')?'focus':(e.summary?.includes('⏸️')?'buffer':'task'));

const sameDay = (a,b) => new Date(a).toDateString() === new Date(b).toDateString();
const eventsOfDay = (events, day) => events.filter(e => sameDay(e.start?.dateTime||e.start?.date, day));
const snoozed = x => x.snoozeUntil && new Date(x.snoozeUntil) > new Date();
const blockedDay = dayLow => (config.no_meeting_days||[]).map(s=>s.toLowerCase()).includes(dayLow)
  || memory.constraints.some(c => { const t=c.text.toLowerCase(); return t.includes(dayLow) && /(pas|jamais|no )/.test(t); });

// ─── MÉMOIRE (contexte pour l'IA) ───
function buildMemoryContext() {
  const L = [];
  if (memory.goals.length)       L.push('OBJECTIFS:\n'+memory.goals.map(g=>`- ${g.text}`).join('\n'));
  if (memory.constraints.length) L.push('CONTRAINTES:\n'+memory.constraints.map(c=>`- ${c.text}`).join('\n'));
  if (memory.preferences.length) L.push('PRÉFÉRENCES:\n'+memory.preferences.map(p=>`- ${p.text}`).join('\n'));
  if (memory.weekHistory.length) L.push('HISTORIQUE RÉCENT:\n'+memory.weekHistory.slice(-3).map(w=>`- Semaine du ${w.weekOf}: ${w.summary}`).join('\n'));
  return L.join('\n\n');
}

// ════════════════════════════════════════════════════════════════════════
//  PARSEUR DE COMMANDES EN FRANÇAIS (déterministe — marche SANS modèle)
//  Transforme une phrase en « intent » (même forme que celui produit par l'IA).
//  Objectif : rendre l'assistant fiable et instantané sur les demandes
//  courantes ; Ollama ne sert que de repli (formulations ambiguës) + réponse.
// ════════════════════════════════════════════════════════════════════════
const FR_MONTHS = { 'janvier':0,'février':1,'fevrier':1,'mars':2,'avril':3,'mai':4,'juin':5,'juillet':6,'août':7,'aout':7,'septembre':8,'octobre':9,'novembre':10,'décembre':11,'decembre':11 };
const FR_WDAYS  = { 'dimanche':0,'lundi':1,'mardi':2,'mercredi':3,'jeudi':4,'vendredi':5,'samedi':6 };
const _ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
let lastTouched = null;   // dernier élément créé/modifié, pour résoudre « cette habitude / ça / le »
let draftEvent = null;    // événement créé EN APERÇU (pas encore appliqué) → modifiable par « appelle-le X », « plutôt à 7h »…

// Trouve une DATE dans le texte (minuit). base = aujourd'hui.
function frDate(t, base){
  const today=new Date(base); today.setHours(0,0,0,0);
  if(/\baujourd'?hui\b/.test(t)) return new Date(today);
  if(/\baprès[- ]?demain\b|\bapres[- ]?demain\b/.test(t)){ const d=new Date(today); d.setDate(d.getDate()+2); return d; }
  if(/\bdemain\b/.test(t)){ const d=new Date(today); d.setDate(d.getDate()+1); return d; }
  let m=t.match(/dans\s+(\d+)\s*(jours?|semaines?|mois|j)\b/);
  if(m){ const n=+m[1]; const d=new Date(today); if(/sem/.test(m[2]))d.setDate(d.getDate()+n*7); else if(/mois/.test(m[2]))d.setMonth(d.getMonth()+n); else d.setDate(d.getDate()+n); return d; }
  m=t.match(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/);              // 12/06 ou 12/06/2026
  if(m){ const day=+m[1],mon=+m[2]-1; let yr=m[3]?+m[3]:today.getFullYear(); if(yr<100)yr+=2000; const d=new Date(yr,mon,day); d.setHours(0,0,0,0); if(!m[3]&&d<today)d.setFullYear(yr+1); return d; }
  m=t.match(/\b(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\b/);  // 12 juin
  if(m){ const day=+m[1],mon=FR_MONTHS[m[2]]; const d=new Date(today.getFullYear(),mon,day); d.setHours(0,0,0,0); if(d<today)d.setFullYear(d.getFullYear()+1); return d; }
  m=t.match(/\ble\s+(\d{1,2})(?!\s*[h:\d])/);                               // "le 12" (pas suivi d'une heure)
  if(m){ const day=+m[1]; const d=new Date(today.getFullYear(),today.getMonth(),day); d.setHours(0,0,0,0); if(d<today)d.setMonth(d.getMonth()+1); return d; }
  for(const name of Object.keys(FR_WDAYS)){                                  // lundi, mardi prochain…
    if(new RegExp('\\b'+name+'\\b').test(t)){ const wd=FR_WDAYS[name]; const d=new Date(today); let diff=(wd-d.getDay()+7)%7; if(diff===0)diff=7; d.setDate(d.getDate()+diff); return d; }
  }
  return null;
}
// Durée en minutes : "2h", "1h30", "1,5h", "90 min", "45 minutes"
function frDuration(t){
  let m=t.match(/(\d+)\s*h\s*(\d{1,2})\b/);            if(m) return (+m[1])*60+(+m[2]);
  m=t.match(/(\d+)[.,](\d+)\s*h\b/);                    if(m) return Math.round(parseFloat(m[1]+'.'+m[2])*60);
  m=t.match(/(\d+)\s*(?:heures?|h)\b/);                 if(m) return (+m[1])*60;
  m=t.match(/(\d+)\s*(?:minutes?|min|mn)\b/);           if(m) return +m[1];
  return null;
}
// Heures de début/fin. Retire les motifs reconnus du texte (objet {start,end,rest}).
function frTimes(t){
  let startH=null,startM=0,endH=null,endM=0,rest=t;
  let m=rest.match(/(?:de|entre|d['’])\s*(\d{1,2})\s*h\s*(\d{0,2})\s*(?:à|a|-|et|jusqu['’]?à?|au)\s*(\d{1,2})\s*h\s*(\d{0,2})/);
  if(m){ startH=+m[1];startM=+(m[2]||0);endH=+m[3];endM=+(m[4]||0); rest=rest.replace(m[0],' '); }
  if(startH==null){ m=rest.match(/(?:à|a|vers)\s*(\d{1,2})\s*(?:h|heures?|:)\s*(\d{0,2})/); if(m){ startH=+m[1];startM=+(m[2]||0); rest=rest.replace(m[0],' '); } }
  if(startH==null){ m=rest.match(/\b(\d{1,2})\s*h\s*(\d{2})\b/); if(m){ startH=+m[1];startM=+(m[2]||0); rest=rest.replace(m[0],' '); } }
  if(startH==null){ if(/\bce soir\b|\bsoir\b/.test(rest))startH=19; else if(/\bmidi\b/.test(rest))startH=12; else if(/après[- ]?midi|apres[- ]?midi|aprem/.test(rest))startH=14; else if(/\bmatin\b/.test(rest))startH=9; }
  return { startH, startM, endH, endM, rest };
}
function frPriority(t){
  let m=t.match(/\bp\s*([1-4])\b/);                 if(m) return 'p'+m[1];
  if(/\bcritique\b|\burgent(e|es)?\b|\bprioritaire\b|tr[èe]s important/.test(t)) return 'p1';
  if(/priorit[ée]\s+haute|\bhaute\b|important/.test(t)) return 'p2';
  if(/priorit[ée]\s+(moyenne|normale)|\bmoyenne?\b/.test(t)) return 'p3';
  if(/priorit[ée]\s+basse|\bbasse\b|\bpas urgent/.test(t)) return 'p4';
  return null;
}
// Liste de jours mentionnés (pour habitudes)
function frDays(t){
  if(/tou(s|t)\s+les\s+jours|chaque\s+jour|quotidien|7\s*\/?\s*7|tous les soirs|tous les matins/.test(t)) return ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
  if(/\bweek[- ]?ends?\b|\bweekends?\b|\bw\.?e\.?\b/.test(t)) return ['samedi','dimanche'];
  if(/\ben semaine\b|\bla semaine\b|jours ouvr[ée]s?|du lundi au vendredi/.test(t)) return ['lundi','mardi','mercredi','jeudi','vendredi'];
  const out=[]; for(const name of Object.keys(FR_WDAYS)) if(new RegExp('\\b'+name+'s?\\b').test(t)) out.push(name);
  return out;
}
// Catégorie / fenêtre horaire d'après l'activité
function frHoursType(t){ if(/travail|boulot|bureau|projet|client|rapport|réunion|reunion|révision|revision|devoir|cours|étud|etud|deep work/.test(t)) return 'work'; return 'personal'; }
// Contexte « changement de durée » (vs déplacement d'heure)
function isDurContext(t){ return /dur[ée]e|raccourci|allonge|rallonge|écourte|ecourte|rallonger|raccourcir/.test(t); }
// Durée explicite d'une MODIFICATION (« durée 2h », « de 90 min », « pendant 1h », « durée … 1h30 »)
function modDuration(t){
  let m=t.match(/dur[ée]e?\b[^0-9]{0,30}?(\d+)\s*h\s*(\d{2})?/); if(m) return (+m[1])*60+(+(m[2]||0));
  m=t.match(/dur[ée]e?\b[^0-9]{0,30}?(\d+)\s*(?:min|minutes?)/); if(m) return +m[1];
  m=t.match(/\b(?:raccourci\w*|allonge\w*|rallonge\w*|écourte\w*|ecourte\w*)\b[^0-9]{0,30}?(\d+)\s*h\s*(\d{2})?/); if(m) return (+m[1])*60+(+(m[2]||0));
  m=t.match(/\b(?:de|pendant)\s+(\d+)\s*h\s*(\d{2})?\b/); if(m) return (+m[1])*60+(+(m[2]||0));
  m=t.match(/\b(?:de|pendant)\s+(\d+)\s*(?:min|minutes?)\b/); if(m) return +m[1];
  return null;
}
// Retrouve l'élément visé par une modification : pronom (→ dernier touché), habitude, tâche, ou événement
function resolveTarget(t, ctx, opts){
  opts=opts||{};
  const norm=s=>String(s||'').toLowerCase().replace(/^[🔁🎯⏸️📌🟢🟡🟠🔴\s]+/,'').trim();
  // 1) Élément EXPLICITEMENT nommé (le nom le plus long l'emporte → évite les collisions de mots courts)
  const cands=[];
  for(const x of (ctx.habits||[])){ const n=norm(x.name); if(n.length>2 && t.includes(n)) cands.push({ kind:'habit', id:x.id, name:x.name, obj:x, len:n.length }); }
  for(const x of (ctx.tasks||[])){ const n=norm(x.title); if(n.length>2 && t.includes(n)) cands.push({ kind:'task', id:x.id, name:x.title, obj:x, len:n.length }); }
  for(const e of (ctx.currentEvents||[])){ const s=norm(e.summary); if(!s) continue; const w=s.split(/\s+/).filter(x=>x.length>2); const hit=w.find(word=>t.includes(word)); if(hit) cands.push({ kind:'event', id:e.id, name:e.summary, obj:e, len:hit.length }); }
  if(cands.length){ cands.sort((a,b)=>b.len-a.len); return cands[0]; }
  // 2) Référence ANAPHORIQUE (« cette habitude », « ça », « là », « le/la », « celle-là »…) → dernier élément touché
  if(opts.anaphora!==false && lastTouched && !lastTouched.draft && /\b(cette?|cet|ces|celui|celle|ceux|[çc]a|cela|l[àa]\b|dessus|\ble\b|\bla\b|\bles\b|l['’]|ce\s+(bloc|truc|cr[ée]neau|rdv|rendez|[ée]v[ée]nement))\b/.test(t)) return lastTouched;
  return null;
}

// Construit un intent depuis une phrase. Renvoie {intent, matched, summary}
function parseFrCommand(msg, base, ctx){
  const raw=msg.trim(); const t=' '+raw.toLowerCase()+' ';
  const intent={};
  const has=(...w)=>w.some(x=>t.includes(x));
  const verbCreate=/\b(bloque|bloquer|ajoute|ajouter|cr[ée]{1,2}|cree|crée|programme|planifie|r[ée]serve|reserve|cale|note|rajoute|pr[ée]vois|mets?|met)\b/.test(t);
  const findName=(arr,key)=>{ for(const x of arr){ const n=String(x.name||x.title||'').toLowerCase().trim(); if(n && t.includes(n)) return x; } return null; };

  // 0a) PILOTER L'APERÇU : appliquer / annuler le plan en attente (à la voix ou à l'écrit)
  if(/^\s*(ok|oui|d'?accord|parfait|bien|super)?[ ,]*(applique[rz]?|valide[rz]?|confirme[rz]?|fais[- ]?le|vas[- ]?y|go|c['’ ]?est bon|c est bon)\b/.test(t) || /\b(applique|valide|confirme)\b[^.]{0,30}\b(changements?|aper[çc]u|plan|modif\w*)\b/.test(t)){
    intent.apply=true; return { intent, matched:true, summary:'Changements appliqués.' };
  }
  if(/\b(annule[r]?|abandonne|laisse tomber|oublie)\b[^.]{0,20}\b(l['’ ]?aper[çc]u|le plan|les? changements?|tout|[çc]a)\b/.test(t) || /^\s*(annule|annuler|laisse tomber|abandonne)\s*$/.test(t)){
    intent.discard=true; return { intent, matched:true, summary:'Aperçu annulé — rien n\'a été modifié.' };
  }
  // 0b) CAPACITÉS : « que peux-tu faire / aide »
  if(/\b(que (peux|sais)-tu faire|qu'est-ce que tu (peux|sais)|tes? capacit[ée]s?|comment (tu marches|ça marche|t'utiliser)|à quoi tu sers)\b/.test(t) || /^\s*aide\s*$/.test(t)){
    intent.help=true; return { intent, matched:true, summary:'' };
  }
  // 0c-bis) MODIFIER L'ÉVÉNEMENT EN APERÇU (créé mais pas encore appliqué) :
  //   « appelle-le X », « renomme-le en X », « il s'appelle X », « plutôt à 7h », « mets-le mercredi ».
  //   On réécrit le brouillon et on régénère l'aperçu (au lieu de chercher un vrai événement Google inexistant).
  if(draftEvent){
    const newEntity=/\b(habitude|rituel|routine|t[âa]che|cong[ée]|vacances|r[ée]glage|priorit[ée]|r[ée]organise|optimise|supprime|annule)\b/.test(t);
    const hasRenameVerb=/\b(renomm\w*|s['’ ]?appell?\w*|appell?e\w*|intitul\w*|nomm\w*)\b/.test(t);
    let nt=null;
    if(hasRenameVerb && !newEntity){
      let rm=t.match(/\ben\s+["«]?\s*([^"»]+?)\s*["»]?\s*$/);
      if(!rm) rm=t.match(/(?:s['’ ]?appelle|appell?e|appeler|nomme|nommer|intitule|renomme)\b[\s-]+(?:(?:le|la|l['’]|[çc]a)\s+)?["«]?\s*([^"»]+?)\s*["»]?\s*$/);
      if(rm) nt=rm[1].trim().replace(/^["'«»\s]+|["'«»\s]+$/g,'');
      if(nt && nt.length<2) nt=null;
    }
    // DURÉE du brouillon : « dure 1h30 », « durée 2h », « pendant 45 min » → on change la durée (PAS l'heure : « 1h30 » n'est pas 01h30 ici)
    const durCtx=/\b(dur\w*|pendant|raccourci\w*|[ée]courte\w*|allonge\w*|rallonge\w*)\b/.test(t);
    if(durCtx && !newEntity && !nt){
      let nd2=modDuration(t);
      if(!nd2){ const lm=t.match(/(\d+)\s*h\s*(\d{0,2})/)||t.match(/(\d+)\s*(?:min|minutes?|mn)/); if(lm){ nd2=/h/.test(lm[0])?(+lm[1])*60+(+(lm[2]||0)):+lm[1]; } }
      if(nd2 && nd2>0){
        const s0=new Date(draftEvent.start); const ne2=new Date(s0.getTime()+nd2*60000);
        intent.event={ op:'create', title:draftEvent.title, start:isoLocal(s0), end:isoLocal(ne2), keepSlot:true };
        return { intent, matched:true, summary:`Aperçu mis à jour : « ${draftEvent.title} » — durée ${nd2>=60?Math.floor(nd2/60)+'h'+(nd2%60?pad2(nd2%60):''):nd2+' min'}.` };
      }
    }
    const refPron=/\b(le|la|l['’]|lui|[çc]a|cela|celui|celle|dessus)\b/.test(t) || /^\s*(non|plut[oô]t|finalement|en fait)\b/.test(t);
    const tmD=frTimes(' '+raw.toLowerCase()+' '); const ndD=frDate(t, base);
    const retime=(tmD.startH!=null || ndD) && refPron && !newEntity;
    if(nt || retime){
      const s0=new Date(draftEvent.start), e0=new Date(draftEvent.end);
      let durMin=Math.max(15,(e0-s0)/60000); const ns=new Date(s0);
      if(ndD) ns.setFullYear(ndD.getFullYear(), ndD.getMonth(), ndD.getDate());
      if(tmD.startH!=null) ns.setHours(tmD.startH, tmD.startM||0, 0, 0);
      if(tmD.endH!=null){ const d=(tmD.endH*60+tmD.endM)-(tmD.startH*60+(tmD.startM||0)); if(d>0) durMin=d; }
      const ne=new Date(ns.getTime()+durMin*60000);
      const title=nt || draftEvent.title;
      intent.event={ op:'create', title, start:isoLocal(ns), end:isoLocal(ne), keepSlot:true };
      return { intent, matched:true, summary:`Aperçu mis à jour : « ${title} » ${_ymd(ns)} à ${pad2(ns.getHours())}h${pad2(ns.getMinutes())}.` };
    }
  }
  // 0c) RÉINITIALISER / VIDER le planning (destructif → toujours via aperçu à confirmer)
  //     Robuste aux fautes (« suprime »), à l'anglais (« calendar ») et aux formes nues (« supprime tout »).
  {
    const destroy=/\b(supprime[rz]?|suprime[rz]?|suprimme|efface[rz]?|efface|enl[èe]ve|enleve|vire|vide[rz]?|nettoie[rz]?|r[ée]initialise[rz]?|reset|remets?\s+à\s+z[ée]ro|table rase|clean)\b/.test(t);
    const bulk=/\b(tout|tous|toute|toutes|calendrier|calendar|agenda|planning|semaine|[ée]v[ée]nements?|blocs?|rien)\b/.test(t) || /^\s*(supprime|suprime|efface|vide|nettoie|r[ée]initialise|reset)\s*$/.test(t);
    const named=!!(findName(ctx.habits||[]) || findName(ctx.tasks||[]) || (ctx.currentEvents||[]).find(e=>{ const s=String(e.summary||'').toLowerCase().replace(/^[^a-zà-ÿ]+/,'').split(' ')[0]; return s.length>2 && t.includes(s); }));
    if(destroy && bulk && !named){ intent.reset=true; return { intent, matched:true, summary:'Réinitialisation préparée (aperçu).' }; }
  }

  // 1) CONGÉS / VACANCES
  if(/\b(cong[ée]s?|vacances|absent|absence|en repos|je pars|je suis off|jour[s]? off)\b/.test(t)){
    // gère aussi les jours nus : "du 12 au 16"
    const mkDay=(str)=>{ const x=String(str||'').trim(); let d=frDate(' '+x+' ',base); if(d) return d;
      const mm=x.match(/(\d{1,2})/); if(mm){ const day=+mm[1]; const today=new Date(base); today.setHours(0,0,0,0); const dt=new Date(today.getFullYear(),today.getMonth(),day); dt.setHours(0,0,0,0); if(dt<today) dt.setMonth(dt.getMonth()+1); return dt; } return null; };
    let m=t.match(/du\s+(.+?)\s+(?:au|jusqu['’]?au|à|a)\s+([^.,;]+)/);
    let d1=null,d2=null;
    if(m){ d1=mkDay(m[1]); d2=mkDay(m[2]); }
    if(!d1) d1=frDate(t,base); if(!d2) d2=d1;
    if(d1){ if(d2&&d2<d1) d2=new Date(d1); intent.timeoff={ start:_ymd(d1), end:_ymd(d2||d1), label:'Congés' }; intent.optimize=true; return { intent, matched:true, summary:`Congés notés du ${_ymd(d1)} au ${_ymd(d2||d1)} (aucun travail planifié, habitudes perso conservées).` }; }
  }

  // 2) RÉGLAGES (heures de travail, focus, jours sans réunion, réorg auto, notifs)
  {
    const cfg={};
    let m=t.match(/heures?\s+de\s+travail\s+(?:de\s+)?(\d{1,2})\s*h\s*(?:à|a|-|au?)\s*(\d{1,2})\s*h/);
    if(m){ cfg.work_start=+m[1]; cfg.work_end=+m[2]; }
    m=t.match(/objectif\s+(?:de\s+)?focus\s+(?:de\s+|à\s+)?(\d{1,2})\s*h/) || t.match(/(\d{1,2})\s*h(?:eures?)?\s+de\s+focus\s+par\s+semaine/);
    if(m){ cfg.focus_weekly_target=+m[1]; }
    if(/focus\s+proactif/.test(t)) cfg.focus_mode='proactive';
    if(/focus\s+r[ée]actif/.test(t)) cfg.focus_mode='reactive';
    if(/(pas|aucune|jamais)\s+de\s+r[ée]union/.test(t)){ const days=frDays(t); if(days.length) cfg.no_meeting_days=days; }
    if(/d[ée]sactive[r]?\s+la\s+r[ée]organisation|coupe[r]?\s+l['’]auto|sans\s+r[ée]org/.test(t)) cfg.auto_reflow=false;
    if(/active[r]?\s+la\s+r[ée]organisation|r[ée]org(anisation)?\s+auto/.test(t)) cfg.auto_reflow=true;
    if(Object.keys(cfg).length){ intent.config=cfg; intent.optimize=true; return { intent, matched:true, summary:'Réglages mis à jour.' }; }
  }

  // 3) PRIORITÉ d'un item existant : "passe le sport en P1"
  if(/\b(passe|mets?|met|d[ée]finis|change|mettre)\b/.test(t) && (frPriority(t) || /\ben\s+p[1-4]\b/.test(t))){
    const pr=frPriority(t);
    const tgtT=findName(ctx.tasks||[]); const tgtH=findName(ctx.habits||[]);
    const tgt=tgtT||tgtH; if(tgt && pr){ intent.priority={ kind:tgtT?'task':'habit', name:(tgt.title||tgt.name), priority:pr }; return { intent, matched:true, summary:`Priorité de « ${tgt.title||tgt.name} » → ${pr.toUpperCase()}.` }; }
  }

  // 4) SUPPRESSION : "supprime/annule le sport de demain"
  if(/\b(supprime|supprimer|annule|annuler|enl[èe]ve|retire|retirer|efface|effacer|enlever|vire)\b/.test(t)){
    const ev=(ctx.currentEvents||[]).find(e=>{ const s=String(e.summary||'').toLowerCase().replace(/^[🔁🎯⏸️📌🟢🟡🟠🔴\s]+/,''); return s && t.includes(s.split(' ')[0]) && s.length>2; });
    if(ev){ intent.event={ op:'delete', eventId:ev.id }; return { intent, matched:true, summary:`Événement « ${ev.summary} » supprimé.` }; }
    const th=findName(ctx.habits||[]); if(th){ intent.habit={ op:'delete', id:th.id, name:th.name }; return { intent, matched:true, summary:`Habitude « ${th.name} » supprimée.` }; }
    const tt=findName(ctx.tasks||[]); if(tt){ intent.task={ op:'delete', id:tt.id, title:tt.title }; return { intent, matched:true, summary:`Tâche « ${tt.title} » supprimée.` }; }
  }

  // 4.5) MODIFICATION d'un élément EXISTANT (déplacer / changer jours / durée / heure / renommer)
  {
    const modVerb=/\b(d[ée]place|d[ée]placer|bouge|bouger|d[ée]cale|d[ée]caler|recale|reprogramme|reprogrammer|change|changer|modifie|modifier|renomme|renommer|raccourci[ts]?|raccourcir|allonge|rallonge|rallonger|avance|avancer|repousse|repousser|mets?|met|mettre|passe|passer|ajuste[rz]?|corrige[rz]?)\b/.test(t);
    const correction=/^\s*(non\b|plut[oô]t\b|finalement\b|en fait\b)/.test(t) || /\bplut[oô]t\b|\bfinalement\b/.test(t);
    // Verbe de modif FORT (sans ambiguïté avec une création) → sert à « réfléchir » : si rien de clair, on DEMANDE plutôt que d'inventer.
    const modStrong=/\b(d[ée]place\w*|bouge\w*|d[ée]cale\w*|recale\w*|reprogramme\w*|modifie\w*|modifier|renomme\w*|raccourci\w*|allonge\w*|rallonge\w*|avance\w*|repousse\w*|change\w*|ajuste\w*|corrige\w*)\b/.test(t);
    // Ressemble à une CRÉATION explicite (« crée une habitude », « ajoute une tâche ») → on laisse l'étape de création gérer.
    const createVerb=/\b(cr[ée]{1,2}\w*|cree|cr[ée]er|ajoute\w*|rajoute\w*|nouvelle?|nouveau)\b/.test(t);
    const looksCreate=(/\b(une?|un|des)\s+(nouvelle?\s+|nouveau\s+|autre\s+)?(habitude|rituel|routine|t[âa]che|[ée]v[ée]nement|r[ée]union|rdv|rendez-?vous|cr[ée]neau)\b/.test(t) || createVerb) && !modStrong;
    if((modVerb || correction) && !looksCreate){
      let tgt=resolveTarget(t, ctx, { anaphora:true });
      if(!tgt && correction && lastTouched) tgt=lastTouched;   // « non, plutôt… » corrige le dernier élément touché
      if(tgt){
        const dctx=isDurContext(t); const tmRaw=frTimes(t); const tm = dctx ? {startH:null,startM:0,endH:null,endM:0} : tmRaw;  // en contexte "durée", on ne déplace pas l'heure
        const days=frDays(t); const pr=frPriority(t); let newDur=modDuration(t);
        // En contexte « durée » sans durée trouvée, on capte le 1er nombre (« raccourcis à 30 min »)
        if(dctx && !newDur){ const lm=t.match(/(\d+)\s*h\s*(\d{2})?/)||t.match(/(\d+)\s*(?:min|minutes?)/); if(lm){ newDur = /h/.test(lm[0]) ? (+lm[1])*60+(+(lm[2]||0)) : +lm[1]; } }
        const rn=t.match(/(?:renomm\w*|appell?e\w*|intitul\w*)\s+(?:.+?\s+)?en\s+([^.,;]+)/) || t.match(/(?:renomm\w*|appell?e\w*)\s+([^.,;]+)/);
        const rename=rn? cleanName(rn[1]) : '';
        if(tgt.kind==='habit'){
          const up={ op:'update', id:tgt.id, name:tgt.name };
          if(days.length){ up.idealDays=days; up.days=days; up.timesPerWeek=days.length; }
          if(tm.startH!=null) up.idealTime=pad2(tm.startH)+':'+pad2(tm.startM||0);
          if(newDur){ up.minDur=newDur; up.maxDur=newDur; }
          if(pr) up.priority=pr;
          if(rename) up.name=rename;
          if(Object.keys(up).length>3){ intent.habit=up; return { intent, matched:true, summary:`Habitude « ${tgt.name} » mise à jour.` }; }
        } else if(tgt.kind==='task'){
          const up={ op:'update', id:tgt.id, title:tgt.name };
          // une tâche n'a pas d'heure fixe : « passe le rapport à 2h » → durée 2h
          if(!newDur && tm.startH!=null) newDur=tm.startH*60+(tm.startM||0);
          if(newDur) up.duration=newDur;
          if(pr) up.priority=pr;
          if(rename) up.title=rename;
          const dd=frDate(t, base); if(dd && /(avant|pour|d['’]ici|[ée]ch[ée]ance|le\s+\d)/.test(t)) up.deadline=_ymd(dd);
          if(Object.keys(up).length>3){ intent.task=up; return { intent, matched:true, summary:`Tâche « ${tgt.name} » mise à jour.` }; }
        } else if(tgt.kind==='event'){
          const e=tgt.obj; const s0=new Date(e.start?.dateTime||e.start?.date), e0=new Date(e.end?.dateTime||e.end?.date);
          let durMin=Math.max(15,(e0-s0)/60000); const ns=new Date(s0);
          const nd=frDate(t, base); if(nd) ns.setFullYear(nd.getFullYear(), nd.getMonth(), nd.getDate());
          if(tm.startH!=null) ns.setHours(tm.startH, tm.startM||0, 0, 0);
          if(tm.endH!=null) durMin=(tm.endH*60+tm.endM)-(tm.startH*60+(tm.startM||0));
          else if(newDur) durMin=newDur;
          if(durMin<=0) durMin=Math.max(15,(e0-s0)/60000);
          const ne=new Date(ns.getTime()+durMin*60000);
          const up={ op:'update', eventId:e.id };
          if(rename) up.title=rename;
          if(tm.startH!=null || nd || newDur){ up.start=isoLocal(ns); up.end=isoLocal(ne); }
          if(up.title || up.start){ intent.event=up; return { intent, matched:true, summary:`Événement « ${e.summary} » modifié.` }; }
        }
      }
      // RÉFLEXION : verbe de modif clair mais cible/détail manquant → on DEMANDE (au lieu de créer n'importe quoi)
      if(modStrong || correction){
        if(!tgt) return { intent:{ ask:'Quel élément voulez-vous modifier ? Dites son nom (ex : « le sport »), ou « celle-là » pour la dernière créée.' }, matched:true, summary:'' };
        return { intent:{ ask:`Que voulez-vous changer pour « ${tgt.name} » ? (jour, heure, durée, priorité ou nom)` }, matched:true, summary:'' };
      }
    }
  }

  // 5) OPTIMISATION pure
  if(/\b(r[ée]organise|r[ée]organiser|optimise|optimiser|replanifie|replanifier|recalcule|replanning|refais\s+mon\s+planning|planifie\s+ma\s+semaine|range\s+mon\s+planning)\b/.test(t) && !verbCreateActivity(t)){
    intent.optimize=true; return { intent, matched:true, summary:'Planning réorganisé.' };
  }

  // 5b) APPRENTISSAGE (déclaratif) — objectifs & préférences en mémoire.
  //     Placé AVANT la création car « je préfère le sport le soir » contient « soir »
  //     (qui sinon serait pris pour une heure d'événement).
  {
    const verbAction=/\b(ajoute|bloque|cr[ée]{1,2}|crée|programme|planifie|r[ée]serve|reserve|mets?|met)\b/.test(t);
    if(!verbAction){
      if(/\bmon objectif\b|\bmon but\b|\bje veux (réussir|décrocher|obtenir|atteindre|progresser)\b|\bj'aimerais (réussir|décrocher|obtenir|devenir|progresser)\b/.test(t)){
        intent.memory={ goals:[raw.trim()] }; return { intent, matched:true, summary:'Objectif noté — j\'en tiendrai compte pour organiser ton temps.' };
      }
      if(/\bje préfère\b|\bje préfèrerais\b|\bje suis (plutôt )?(du|une personne du)?\s*(matin|soir)\b|\bje travaille mieux\b|\bj'aime mieux\b|\bj'aime (faire|bien|plutôt)\b|\bidéalement\b|\bje n'aime pas\b|\bje déteste\b/.test(t)){
        intent.memory={ preferences:[raw.trim()] }; return { intent, matched:true, summary:'Préférence notée — je m\'en souviendrai pour mieux planifier.' };
      }
    }
  }

  // 6) HABITUDE récurrente vs TÂCHE vs ÉVÉNEMENT
  const days=frDays(t);
  const tm=frTimes(t);                       // heures (retirées de tm.rest)
  const dur0=frDuration(tm.rest);            // durée calculée SANS les heures (sinon "18h" → 1080 min)
  const date=frDate(t,base);
  const pr=frPriority(t);
  const recurring=/\bhabitude\b|\bchaque\b|tous\s+les|toutes\s+les|\d+\s*fois\s*(?:\/|par)\s*semaine|\brituel\b|\broutine\b|réguli[èe]r/.test(t) || days.length>=2;
  const deadlineCue=/(avant|pour le|pour|d['’]ici|jusqu['’]?à|deadline|[ée]ch[ée]ance)/.test(t);
  const taskWord=/\bt[âa]che\b|\bà\s+faire\b|\bdevoir\b|\brapport\b|r[ée]vis|\bbosser\b|terminer|finir|r[ée]dige|pr[ée]pare|\bexos?\b|exercices?|dissertation|fiche/.test(t);
  const meetingWord=/\br[ée]union\b|\brdv\b|rendez|\bappel\b|\bcall\b|d[ée]jeuner|d[îi]ner|\bvisio\b/.test(t);
  // Tâche = mot de tâche, OU (échéance + durée, ponctuel, pas une réunion)
  const isTask = (taskWord && (deadlineCue || /\bt[âa]che\b/.test(t) || dur0)) || (deadlineCue && dur0 && !recurring && !meetingWord);
  const isQuestion=/\?|\bqu['’]?est|\bquoi\b|\bquand\b|\bcombien\b|\bmontre|\baffiche|\bliste\b|\bquel(le)?s?\b|c['’]est quoi/.test(t);
  const hasWhen = tm.startH!=null || date!=null;

  if(verbCreate || recurring || isTask || (hasWhen && !isQuestion)){
    // RÉFLEXION : un titre qui ressemble à une phrase entière = commande mal comprise → on DEMANDE au lieu de créer un « monstre ».
    { const candName=cleanName(raw);
      if(candName && (candName.length>52 || candName.split(/\s+/).filter(Boolean).length>7)){
        return { intent:{ ask:`Je veux bien comprendre 🤔 Donnez-moi un nom court (ex : « Sport », « Réviser maths ») et précisez : habitude, tâche ou événement ? Votre phrase est un peu longue pour servir de titre.` }, matched:true, summary:'' };
      } }

    if(recurring && !isTask){
      // HABITUDE
      const idealTime = pad2(tm.startH!=null?tm.startH:18)+':'+pad2(tm.startM||0);
      let perWeek; const mw=t.match(/(\d+)\s*fois\s*(?:\/|par)\s*semaine/); if(mw) perWeek=+mw[1];
      const idays = days.length? days : ['lundi','mardi','mercredi','jeudi','vendredi'];
      const dur = dur0 || 60;
      const name = cleanName(raw) || 'Habitude';
      intent.habit={ op:'add', name, priority: pr||'p3', hoursType: frHoursType(t),
        idealDays: idays, idealDay: days.length===1?days[0]:'', idealTime, minDur: dur, maxDur: dur,
        timesPerWeek: perWeek || idays.length, startDate:'', endDate:'' };
      // pas d'optimize global ici : l'ajout déclenche un placement FOCALISÉ (juste cette habitude)
      return { intent, matched:true, summary:`Habitude « ${name} » créée (${idays.length} jour(s), ${dur} min).` };
    }

    if(isTask){
      // TÂCHE (durée + échéance)
      const dur = dur0 || 60;
      const deadline = date? _ymd(date) : '';
      const title = cleanName(raw) || 'Tâche';
      intent.task={ op:'add', title, duration: dur, priority: pr||'p2',
        deadline, upNext: /\bup\s*next\b|d[èe]s que possible|tout de suite|en priorit[ée]/.test(t), hoursType: frHoursType(t) };
      // placement focalisé (juste cette tâche)
      return { intent, matched:true, summary:`Tâche « ${title} » (${dur} min)${deadline?` à rendre avant le ${deadline}`:''}.` };
    }

    // ÉVÉNEMENT fixe (heure et/ou date présentes)
    if(hasWhen){
      const d = date? new Date(date) : new Date(base);
      let sh=tm.startH!=null?tm.startH:9, sm=tm.startM||0;
      let durMin = (tm.endH!=null) ? (tm.endH*60+tm.endM)-(sh*60+sm) : (dur0||60);
      if(durMin<=0) durMin=60;
      const start=new Date(d); start.setHours(sh,sm,0,0);
      if(!date && start < new Date(base)) start.setDate(start.getDate()+1);   // heure déjà passée → demain
      const end=new Date(start.getTime()+durMin*60000);
      const title=cleanName(raw) || 'Événement';
      intent.event={ op:'create', title, start:isoLocal(start), end:isoLocal(end), keepSlot:true };
      return { intent, matched:true, summary:`Événement « ${title} » le ${_ymd(start)} à ${pad2(sh)}h${pad2(sm)}.` };
    }
  }

  return { intent:{}, matched:false, summary:'' };
}
// Un verbe d'optimisation accompagné d'une création explicite → pas une simple optimisation
function verbCreateActivity(t){ return /\b(ajoute|bloque|cr[ée]{1,2}|crée|programme|r[ée]serve)\b/.test(t) && /\b(sport|r[ée]union|t[âa]che|habitude|r[ée]vision|rendez|rdv|focus|[ée]v[ée]nement)\b/.test(t); }
// Mots-outils filtrés lors de l'extraction du titre
const FR_STOP = new Set(['de','du','des','une','un','la','le','les','l','mon','ma','mes','ce','cette','ces','a','à','au','aux','pour','d','en','sur','dans','avant','apres','après','chaque','tous','tout','toute','toutes','fois','par','semaine','week','weekend','weekends','week-end','week-ends','end','ends','jour','jours','quotidien','quotidienne','habitude','tache','tâche','evenement','événement','rendez-vous','rdv','seance','séance','bloc','priorite','priorité','critique','urgent','urgente','prioritaire','haute','basse','moyenne','normale','up','next','et','vers','jusqu','environ','max','seulement','uniquement','soit','plutot','plutôt','finalement','prochain','prochaine','je','tu','il','on','met','mets','metre','faire','fais','fait','planifie','planifier','ajoute','ajouter','rajoute','rajouter','bloque','bloquer','cree','crée','creer','créer','programme','programmer','reserve','réserve','reserver','réserver','note','noter','prevois','prévois','cale','caler','do','dois','veux','voudrais','aimerais','peux']);
// Extrait un titre lisible : retire heures/durées/dates puis filtre les mots-outils
function cleanName(raw){
  let s=String(raw||'').toLowerCase();
  s=s.replace(/(?:de|entre|d['’]|à|a|vers|au)\s*\d{1,2}\s*h\s*\d{0,2}/g,' ');     // "à 18h", "de 9h à 11h"
  s=s.replace(/\b\d{1,2}\s*[h:]\s*\d{0,2}\b/g,' ');                                // "18h30", "14:00"
  s=s.replace(/\b\d+[.,]?\d*\s*(?:h|heures?|min|minutes?|mn)\b/g,' ');             // "2h", "90 min"
  s=s.replace(/\b\d{1,2}[\/.]\d{1,2}(?:[\/.]\d{2,4})?\b/g,' ');                    // "12/06"
  s=s.replace(/\bdans\s+\d+\s*\w+/g,' ');                                          // "dans 3 jours"
  s=s.replace(/\d+\s*fois\s*(?:\/|par)?\s*semaine?/g,' ');                         // "3 fois par semaine"
  s=s.replace(/\bp[1-4]\b/g,' ');
  const months=Object.keys(FR_MONTHS), wdays=Object.keys(FR_WDAYS);
  const toks=s.split(/[\s,;.:!?'’()\/«»"]+/).filter(Boolean).filter(w=>{
    const b=w.replace(/[^a-zàâäéèêëïîôöùûüç-]/g,'');
    if(!b) return false;                                  // chiffres seuls, ponctuation
    if(FR_STOP.has(b)) return false;
    if(wdays.includes(b)||months.includes(b)) return false;
    if(['demain','aujourdhui','aujourd','hui','matin','midi','soir','aprem','apresmidi','prochain','prochaine'].includes(b)) return false;
    if(['min','mn','h','hr','hrs','heure','heures','minute','minutes','sec','secondes'].includes(b)) return false;   // unités de temps orphelines
    return true;
  });
  const out=toks.join(' ').trim();
  return out ? out.charAt(0).toUpperCase()+out.slice(1) : '';
}

// ─── CHAT IA ───
const HELP_TEXT = `Voici tout ce que je peux faire sur votre agenda 👇

📅 Événements — « ajoute appeler maman demain à 16h30 », « déplace le déjeuner à 13h », « renomme la réunion en Point équipe », « supprime le rendez-vous de mardi ».
🔁 Habitudes — « crée une habitude lecture 30 min tous les jours à 21h », « mets le sport le week-end », « change la durée de la révision à 1h ».
✅ Tâches — « ajoute une tâche réviser maths 3h avant vendredi », « passe le rapport en P1 ».
🌴 Congés — « je suis en congés du 12 au 16 ».
⚙️ Réglages — « heures de travail 9h-17h », « pas de réunion le mercredi », « objectif focus 5h/semaine ».
♻️ Réorganiser — « réorganise ma semaine » : je propose un APERÇU des changements.
🧹 Réinitialiser — « vide le calendrier » / « supprime tous les blocs générés » (vos vrais rendez-vous Google sont conservés).
✔️ Valider — après une proposition, dites « applique » pour confirmer, ou « annule ».
🧠 Mémoire — « je préfère le sport le soir », « mon objectif est de réussir le bac » : je m'en sers pour mieux planifier.

Rien n'est écrit dans votre agenda sans votre validation. Que voulez-vous faire ?`;

async function processChat(userMessage, chatHistory, currentEvents) {
  const today = new Date();
  const todayStr = today.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const todayISO = today.toISOString().split('T')[0];
  const memCtx = buildMemoryContext();
  const evCtx = currentEvents.length
    ? currentEvents.map(e=>`ID:${e.id}|"${e.summary||'Sans titre'}"|${e.start?.dateTime||e.start?.date}→${e.end?.dateTime||e.end?.date}`).join('\n')
    : 'Aucun événement.';

  const cfgSummary = `Travail ${config.work_start}h-${config.work_end}h · Perso ${config.personal_start}h-${config.personal_end}h · Focus ${config.focus_weekly_target}h/sem (${config.focus_mode}) · Réorg auto ${config.auto_reflow!==false?'oui':'non'} · Congés: ${(config.timeoff||[]).map(t=>t.start+'→'+t.end).join(', ')||'aucun'}`;

  const intentSystem = `Tu es l'assistant de TimeFlow, un agenda intelligent. Aujourd'hui: ${todayStr} (${todayISO}). Fuseau ${config.timezone}.
Tu peux TOUT piloter : événements, habitudes, tâches, priorités, réglages, congés, et réorganiser le planning.
Réponds UNIQUEMENT en JSON valide (aucun markdown, aucun texte autour).

Contexte utilisateur:
${memCtx || 'Aucun.'}
Réglages: ${cfgSummary}
Habitudes: ${habits.map(h=>`#${h.id}|${h.name}|${h.priority||'p3'}`).join(' ; ')||'aucune'}
Tâches: ${tasks.map(t=>`#${t.id}|${t.title}|${t.priority||'p2'}${t.deadline?'|échéance '+t.deadline:''}`).join(' ; ')||'aucune'}
Événements (ID|titre|début→fin):
${evCtx}${lastTouched? `\nDernier élément que TU viens de toucher (résous « ça / la / le / cette / celle-là / celui-là » par CELUI-CI) : ${lastTouched.kind} #${lastTouched.id} « ${lastTouched.name||''} »`:''}

Renseigne UNIQUEMENT les blocs utiles (laisse null le reste) :
{
 "event": {"op":"create|update|delete","title":"","start":"${todayISO}T09:00:00","end":"${todayISO}T10:00:00","eventId":""} | null,
 "habit": {"op":"add|update|delete","id":"","name":"","emoji":"","priority":"p3","hoursType":"personal","idealDays":["lundi","mercredi"],"idealDay":"","idealTime":"18:00","minDur":45,"maxDur":60,"timesPerWeek":3,"startDate":"","endDate":""} | null,
 "task": {"op":"add|update|delete","id":"","title":"","duration":60,"priority":"p2","deadline":"${todayISO}","upNext":false,"hoursType":"work"} | null,
 "priority": {"kind":"habit|task","name":"","priority":"p1"} | null,
 "config": {"work_start":9,"work_end":18,"focus_weekly_target":5,"focus_mode":"reactive","auto_reflow":true,"no_meeting_days":["mercredi"]} | null,
 "timeoff": {"start":"YYYY-MM-DD","end":"YYYY-MM-DD","label":"Congés"} | null,
 "optimize": false,
 "memory": {"goals":[],"constraints":[],"preferences":[]}
}
Règles de classification :
- Activité RÉCURRENTE (chaque semaine, plusieurs jours) -> habit. Jours en français ; "tous les jours"=les 7 jours ; "le week-end"=samedi+dimanche ; "en semaine"=lundi→vendredi.
- Travail PONCTUEL avec échéance ("réviser maths 3h avant vendredi") -> task.
- Rendez-vous/réunion à HEURE FIXE ("réunion jeudi 14h") -> event create.
- MODIFIER un élément existant ("déplace X à 19h", "change la durée de X", "mets X le week-end", "renomme X en Y") -> event.update / habit.update / task.update (mets l'eventId ou l'id ou le name exact de l'élément visé).
- "supprime/annule X" -> op delete sur l'élément.
- PRONOM sans nom ("modifie-la", "change ça", "mets-le le week-end", "non plutôt 19h") -> reprends le « Dernier élément touché » ci-dessus (même kind + son id exact). Ne crée JAMAIS un élément dont le nom serait la phrase de l'utilisateur.
- "mets/passe X en P1/critique" -> priority. "réorganise/optimise" -> optimize:true. "congés du X au Y" -> timeoff + optimize:true.
- Objectif de vie -> memory.goals ; contrainte ("jamais le mercredi") -> memory.constraints ; préférence ("sport le soir") -> memory.preferences.
- Heures : 24h. Durées en minutes. "ce soir"=19h, "midi"=12h, "le matin"=9h.

Exemples (entrée -> JSON) :
"déplace mon déjeuner à 13h" -> {"event":{"op":"update","eventId":"<id du déjeuner>","start":"${todayISO}T13:00:00","end":"${todayISO}T14:00:00"}}
"mets le sport le week-end seulement" -> {"habit":{"op":"update","name":"sport","idealDays":["samedi","dimanche"],"timesPerWeek":2}}
"mets-la le week-end" (Dernier élément touché = habit #12 « Courir ») -> {"habit":{"op":"update","id":"12","idealDays":["samedi","dimanche"],"timesPerWeek":2}}
"raccourcis la révision à 1h" -> {"habit":{"op":"update","name":"révision","minDur":60,"maxDur":60}}
"ajoute lecture 30 min tous les jours à 21h" -> {"habit":{"op":"add","name":"Lecture","idealDays":["lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"],"idealTime":"21:00","minDur":30,"maxDur":30,"timesPerWeek":7}}
"j'ai un dossier de 4h à rendre pour mardi" -> {"task":{"op":"add","title":"Dossier","duration":240,"deadline":"<date mardi>","priority":"p2"}}
"qu'est-ce que j'ai demain ?" -> {} (question : pas d'action, on répondra en texte)

Réponds par le JSON le plus simple qui satisfait la demande. Si c'est une simple question, renvoie {}.`;

  // 1) Parseur déterministe FR (fiable, instantané) — gère 80% des demandes courantes.
  // 2) Repli Ollama uniquement si la phrase n'est pas reconnue (formulations libres).
  let intent = {}; let det=null;
  try { det = parseFrCommand(userMessage, today, { habits, tasks, currentEvents }); } catch(e){ console.error('parseFr:', e.message); }
  const umLow = String(userMessage).trim().toLowerCase();
  // Confirmation COURTE alors qu'un aperçu est en attente → on APPLIQUE (avant tout LLM, qui sinon hallucine)
  if (pendingPlan && !(det && det.matched)
      && /^(ok|oui|d'?accord|parfait|vas-?y|allez|aller|maintenant|c'?est bon|fais[- ]?le|go|valide[rz]?|confirme[rz]?|applique[rz]?|supprime|suprime|efface|vide)\b/.test(umLow)
      && umLow.split(/\s+/).length<=4){
    intent = { apply:true };
  } else if (det && det.matched) {
    intent = det.intent;
  } else {
    try {
      const r = await llmCall([{role:'user',content:userMessage}], intentSystem, true);
      let raw = (r.message?.content||'{}').replace(/```json|```/g,'').trim();
      const a = raw.indexOf('{'), b = raw.lastIndexOf('}');          // isole le 1er objet JSON
      if (a>=0 && b>a) raw = raw.slice(a, b+1);
      intent = JSON.parse(raw);
    } catch(e){ console.error('Intent fail:', e.message); }
  }

  const snap=()=>({ goals:memory.goals, constraints:memory.constraints, preferences:memory.preferences });

  // ── Commandes de pilotage de l'aperçu (appliquer / annuler) et aide ──
  if (intent.apply){
    if (pendingPlan && tokens){ const r=await applyPlan(pendingPlan); draftEvent=null; await weeklyReview();
      return { response: r.applied?`✅ C'est appliqué — ${r.created||0} bloc(s) ajouté(s)${r.deleted?`, ${r.deleted} retiré(s)`:''} dans votre agenda.`:'Il n\'y avait rien à appliquer.', action:{type:'multi',applied:['Aperçu appliqué']}, reload:true, clearPreview:true, risks:[], memorySnapshot:snap() }; }
    return { response:"Il n'y a pas d'aperçu en attente. Demandez-moi d'abord un changement (ex. « ajoute 1h de lecture demain à 21h »), puis dites « applique ».", reload:false, memorySnapshot:snap() };
  }
  if (intent.discard){ pendingPlan=null; draftEvent=null;
    return { response:"C'est annulé — rien n'a été modifié dans votre agenda.", reload:true, clearPreview:true, memorySnapshot:snap() };
  }
  if (intent.help){
    return { response: HELP_TEXT, reload:false, memorySnapshot:snap() };
  }
  if (intent.ask){   // clarification déterministe (l'IA « réfléchit » : elle demande au lieu d'inventer)
    return { response: intent.ask, reload:false, memorySnapshot:snap() };
  }
  if (intent.reset){
    if(!tokens) return { response:'Connectez d\'abord Google Agenda pour que je puisse agir dessus.', reload:false, memorySnapshot:snap() };
    const ro = await optimize({ days:config.horizon_days||14, preview:true, clearOnly:true });
    if(ro.error) return { response:'Je n\'ai pas pu préparer ça ('+ro.error+').', reload:false, memorySnapshot:snap() };
    const plan = ro.plan;
    if(plan && plan.counts.removed){
      return { response:`Oui, je peux faire ça 👍 J'ai préparé la réinitialisation : ${plan.counts.removed} bloc(s) générés (habitudes, tâches, focus) seront retirés du calendrier. Vos vrais rendez-vous Google sont conservés. Dites « applique » pour confirmer (ou « annule »). Les habitudes/tâches elles‑mêmes restent — supprimez‑les dans leurs onglets si besoin.`, preview:plan, reload:false, risks:[], memorySnapshot:snap() };
    }
    return { response:'Votre calendrier est déjà au propre — aucun bloc généré à retirer. (Vos vrais rendez-vous Google ne sont jamais supprimés automatiquement.)', reload:false, memorySnapshot:snap() };
  }

  const applied=[]; let memChanged=false, structural=false, actionError=null, eventChanged=false, focusItem=null;
  // focusItem = quand un SEUL élément (habitude/tâche) est ajouté/modifié → on ne replanifie QUE lui
  // (sinon ajouter « lecture » re-générait tout : morning routine, déjeuner… = aperçu géant « rien à voir »)
  const fixedCreates=[], fixedDeletes=[];          // événements fixes mis en attente (mode preview)
  const previewOn = config.preview_mode!==false;   // aperçu avant écriture ?
  const findByName=(arr,name)=>{ if(!name) return null; const n=String(name).toLowerCase(); return arr.find(x=>String(x.name||x.title||'').toLowerCase()===n) || arr.find(x=>String(x.name||x.title||'').toLowerCase().includes(n)); };

  // Mémoire
  const mem=intent.memory||{};
  ['goals','constraints','preferences'].forEach(k=>{ (mem[k]||[]).forEach(txt=>{ if(txt && !memory[k].find(x=>x.text===txt)){ memory[k].push({id:Date.now()+''+Math.random(),text:txt,addedAt:new Date().toISOString()}); memChanged=true; applied.push('Mémoire : '+txt); } }); });

  try {
    // ÉVÉNEMENT (fixe, sans chevauchement, créneau déduit du titre)
    if (intent.event && intent.event.op){
      const ev=intent.event;
      if (ev.op==='create' && ev.title && ev.start && ev.end){
        // heure explicite (keepSlot) → on garde le créneau (anti-chevauchement seulement, PAS de relocalisation par mot-clé du titre)
        const slot = ev.keepSlot ? placeNoOverlap(ev.start, ev.end, currentEvents, null) : placeNoOverlap(ev.start, ev.end, currentEvents, inferWindow(ev.title));
        if (previewOn){ fixedCreates.push({ title:ev.title, start:slot.start, end:slot.end, colorId:'9' }); draftEvent={ title:ev.title, start:slot.start, end:slot.end }; lastTouched={ kind:'event', id:null, name:ev.title, draft:true }; applied.push('À créer : '+ev.title+(slot.shifted?' (créneau ajusté)':'')); }
        else { await createEvent({title:ev.title, start:slot.start, end:slot.end}); draftEvent=null; applied.push('Événement créé : '+ev.title+(slot.shifted?' (déplacé pour éviter un chevauchement)':'')+(slot.conflict?' (créneau libre introuvable)':'')); }
      } else if (ev.op==='update' && ev.eventId){
        let st=ev.start, en=ev.end;
        if (st&&en){ const slot=placeNoOverlap(st,en,currentEvents.filter(x=>x.id!==ev.eventId), ev.title?inferWindow(ev.title):null); st=slot.start; en=slot.end; }
        const u=await updateEvent(ev.eventId,{title:ev.title,start:st,end:en}); eventChanged=true;
        lastTouched={ kind:'event', id:ev.eventId, name:(ev.title||u.summary||'') };
        applied.push('Événement modifié : '+(ev.title||u.summary||'')+(st?' → '+new Date(st).toLocaleString('fr-FR',{weekday:'short',hour:'2-digit',minute:'2-digit'}):''));
      } else if (ev.op==='delete' && ev.eventId){
        if (previewOn){ const e=currentEvents.find(x=>x.id===ev.eventId); fixedDeletes.push({ id:ev.eventId, title:e?.summary||'Événement', start:e?.start?.dateTime||'', end:e?.end?.dateTime||'' }); applied.push('À supprimer : '+(e?.summary||'événement')); }
        else if (await deleteEvent(ev.eventId)){ locks.delete(ev.eventId); saveLocks(); applied.push('Événement supprimé'); }
      }
    }
    // HABITUDE
    if (intent.habit && intent.habit.op){
      const h=intent.habit;
      if (h.op==='add' && h.name){
        const maxD=h.maxDur||h.minDur||60, minD=h.minDur||maxD; const days=h.idealDays||h.days||[];
        const cand=sanitizeHabit({id:Date.now()+'',active:true,name:h.name,emoji:h.emoji||'',priority:h.priority||'p3',hoursType:h.hoursType||'personal',idealDays:days,idealDay:h.idealDay||'',idealTime:h.idealTime||'18:00',minDur:minD,maxDur:maxD,timesPerWeek:h.timesPerWeek||days.length||1,startDate:h.startDate||'',endDate:h.endDate||'',days,duration:maxD});
        const dup=findDupHabit(cand);
        if(dup){ lastTouched={kind:'habit',id:dup.id,name:dup.name}; applied.push('Habitude déjà présente : '+dup.name+' (aucun doublon créé)'); }
        else { habits.push(cand); saveHabits(); structural=true; lastTouched={kind:'habit',id:cand.id,name:cand.name}; focusItem={kind:'habit',id:cand.id}; applied.push('Habitude créée : '+cand.name); }
      } else if (h.op==='update'){ const tgt=h.id?habits.find(x=>x.id===h.id):findByName(habits,h.name); if(tgt){ Object.keys(h).forEach(k=>{ if(['op','id'].includes(k))return; if(h[k]!=null&&h[k]!=='') tgt[k]=h[k]; }); Object.assign(tgt, sanitizeHabit(tgt)); saveHabits(); structural=true; lastTouched={kind:'habit',id:tgt.id,name:tgt.name}; focusItem={kind:'habit',id:tgt.id}; applied.push('Habitude modifiée : '+tgt.name); } }
      else if (h.op==='delete'){ const tgt=h.id?habits.find(x=>x.id===h.id):findByName(habits,h.name); if(tgt){ const did=tgt.id; habits=habits.filter(x=>x!==tgt); saveHabits(); structural=true; focusItem={kind:'habit',id:did}; applied.push('Habitude supprimée : '+tgt.name); } }
    }
    // TÂCHE
    if (intent.task && intent.task.op){
      const t=intent.task;
      if (t.op==='add' && t.title){
        const cand=sanitizeTask({id:Date.now()+'',active:true,scheduled:false,title:t.title,duration:t.duration||60,priority:t.priority||'p2',deadline:t.deadline||'',upNext:!!t.upNext,hoursType:t.hoursType||'work',splitUp:true,minChunk:30,maxChunk:120});
        const dup=findDupTask(cand);
        if(dup){ lastTouched={kind:'task',id:dup.id,name:dup.title}; applied.push('Tâche déjà présente : '+dup.title+' (aucun doublon créé)'); }
        else { tasks.push(cand); saveTasks(); structural=true; lastTouched={kind:'task',id:cand.id,name:cand.title}; focusItem={kind:'task',id:cand.id}; applied.push('Tâche créée : '+cand.title); }
      }
      else if (t.op==='update'){ const tgt=t.id?tasks.find(x=>x.id===t.id):findByName(tasks,t.title); if(tgt){ Object.keys(t).forEach(k=>{ if(['op','id'].includes(k))return; if(t[k]!=null&&t[k]!=='') tgt[k]=t[k]; }); Object.assign(tgt, sanitizeTask(tgt)); tgt.scheduled=false; delete tgt.eventIds; saveTasks(); structural=true; lastTouched={kind:'task',id:tgt.id,name:tgt.title}; focusItem={kind:'task',id:tgt.id}; applied.push('Tâche modifiée : '+tgt.title); } }
      else if (t.op==='delete'){ const tgt=t.id?tasks.find(x=>x.id===t.id):findByName(tasks,t.title); if(tgt){ const did=tgt.id; tasks=tasks.filter(x=>x!==tgt); saveTasks(); structural=true; focusItem={kind:'task',id:did}; applied.push('Tâche supprimée : '+tgt.title); } }
    }
    // PRIORITÉ
    if (intent.priority && intent.priority.priority){
      const p=intent.priority; const arr=p.kind==='task'?tasks:habits; const tgt=findByName(arr,p.name);
      if(tgt){ tgt.priority=normPrio(p.priority); tgt.scheduled=false; if(p.kind==='task') saveTasks(); else saveHabits(); structural=true; focusItem={kind:p.kind==='task'?'task':'habit',id:tgt.id}; applied.push('Priorité ('+(tgt.name||tgt.title)+') -> '+tgt.priority.toUpperCase()); }
    }
    // RÉGLAGES (liste blanche)
    if (intent.config && typeof intent.config==='object'){
      const WL=['work_start','work_end','personal_start','personal_end','focus_duration','focus_weekly_target','focus_max_per_day','focus_mode','task_max_per_day','horizon_days','auto_reflow','preview_mode','ai_tone','auto_lock','no_meeting_days','buffers','working_hours','personal_hours','meeting_hours','time_format','start_week_on','emoji_prefix'];
      const patch={}; Object.keys(intent.config).forEach(k=>{ if(WL.includes(k)) patch[k]=intent.config[k]; });
      ['buffers','working_hours','personal_hours','meeting_hours'].forEach(k=>{ if(patch[k]&&typeof patch[k]==='object') patch[k]={...config[k],...patch[k]}; });
      if(Object.keys(patch).length){ config={...config,...patch}; saveConfig(); structural=true; focusItem=null; applied.push('Réglages mis à jour : '+Object.keys(patch).join(', ')); }
    }
    // CONGÉS / VACANCES
    if (intent.timeoff && intent.timeoff.start && intent.timeoff.end){
      const to=intent.timeoff; config.timeoff=[...(config.timeoff||[]),{start:to.start,end:to.end,label:to.label||'Congés'}]; saveConfig();
      structural=true; focusItem=null; applied.push('Congés enregistrés : '+to.start+' -> '+to.end+' (aucun travail planifié, habitudes perso conservées)');
    }
  } catch(e){ actionError=e.message; }
  if (memChanged) saveMemory();

  // ── Planification : APERÇU (preview) ou application directe ──
  // IMPORTANT : un simple événement fixe (ou un déplacement) ne déclenche PAS de
  // réorganisation globale — on n'ajoute/déplace QUE cet élément (zéro chevauchement
  // garanti par placeNoOverlap). La réorganisation n'a lieu que pour une vraie
  // demande structurelle (nouvelle habitude/tâche) ou un « réorganise » explicite.
  let risks=[]; let reorganized=false; let previewPlan=null;
  const shouldReorg = (intent.optimize===true) || (structural && config.auto_reflow!==false);
  const hasFixed = fixedCreates.length>0 || fixedDeletes.length>0;
  if ((shouldReorg || hasFixed) && tokens){
    try{
      if (previewOn){
        let plan=null;
        if (shouldReorg){   // réorganisation : FOCALISÉE sur l'élément ajouté/modifié, OU complète si « optimise »/réglages
          const focus = (intent.optimize===true) ? null : focusItem;   // « optimise » = réorg complète ; sinon, juste l'élément
          const ro=await optimize({days:config.horizon_days||14, preview:true, extraBusy:fixedCreates, onlyItem:focus});
          risks=ro.risks||[]; plan=pendingPlan;
        }
        if (!plan){ plan={ id:Date.now(), createdAt:new Date().toISOString(), only:'all', deletes:[], creates:[], risks:[] }; }
        fixedDeletes.forEach(d=> plan.deletes.push(d));
        fixedCreates.forEach((c,i)=> plan.creates.push({ idx:100000+i, kind:'event', ref:'', title:c.title, start:c.start, end:c.end, colorId:c.colorId||'9', location:'', visibility:'' }));
        pendingPlan=plan; previewPlan=publicPlan(plan); reorganized=true;
        if (previewPlan.counts.added||previewPlan.counts.removed) applied.push('Aperçu prêt : '+previewPlan.counts.added+' ajout(s)'+(previewPlan.counts.removed?', '+previewPlan.counts.removed+' retrait(s)':''));
      } else {
        for(const d of fixedDeletes){ try{ if(await deleteEvent(d.id)) locks.delete(d.id); }catch{} }
        for(const c of fixedCreates){ try{ await createEvent({title:c.title,start:c.start,end:c.end,colorId:c.colorId}); }catch{} }
        if (shouldReorg){ const focus=(intent.optimize===true)?null:focusItem; const ro=await optimize({days:config.horizon_days||14, onlyItem:focus}); risks=ro.risks||[]; applied.push(focus?'Planning mis à jour':'Planning réorganisé autour de vos contraintes'); }
        reorganized=true;
      }
    }catch(e){ actionError=actionError||e.message; }
  }

  // ── Réponse : INSTANTANÉE (déterministe) dès qu'il y a une action ; Ollama réservé au conversationnel ──
  let responseText;
  const didAct = applied.length>0 || previewPlan;
  if (didAct){
    responseText = buildActionReply(applied, previewPlan, risks, previewOn);
  } else {
    const toneDesc = config.ai_tone==='direct' ? 'direct et efficace (pas de fioritures)' : config.ai_tone==='motivant' ? 'motivant et encourageant' : 'chaleureux et bienveillant';
    const respSystem = `Tu es TimeFlow, l'assistant d'un agenda intelligent. Style ${toneDesc}. Réponds en français, 1 à 3 phrases. Aujourd'hui ${todayStr}.
${memCtx ? 'Ce que tu sais de l\'utilisateur:\n'+memCtx : ''}
Événements à venir (pour répondre aux questions sur l'agenda):
${evCtx}

TU PEUX agir sur le calendrier : créer/déplacer/renommer/supprimer des événements, gérer habitudes et tâches, changer des priorités, poser des congés, modifier des réglages, RÉORGANISER et même VIDER/réinitialiser le planning — toujours via un aperçu que l'utilisateur valide. Ne réponds JAMAIS « je ne peux pas modifier l'agenda » : tu le peux.

RÈGLES (importantes) :
- Quand la demande est une action claire, elle est exécutée automatiquement (préparée en aperçu) — tu n'as donc rien à refuser.
- Si tu réponds ici, c'est que la demande était une question OU imprécise : alors réponds, OU demande LA précision manquante, OU propose la bonne formulation. Reste positif et serviable.
- N'affirme pas avoir DÉJÀ fait un changement si tu n'en es pas sûr (l'utilisateur valide via « applique »). Mais n'affirme jamais l'inverse non plus.
- Pour les questions sur l'agenda, base-toi uniquement sur les événements listés ci-dessus (pas d'horaires inventés).`;
    try {
      const r2 = await llmCall([...chatHistory, {role:'user',content:userMessage}], respSystem, false);
      responseText = r2.message?.content?.trim();
    } catch(e){ /* IA indisponible → repli ci-dessous */ }
    // Garde-fou anti-charabia : si le modèle produit des caractères CJK (chinois/japonais/coréen),
    // une réponse interminable, ou un faux planning halluciné → on remplace par un repli propre.
    const garbled = responseText && (/[　-鿿぀-ヿ가-힯]/.test(responseText) || responseText.length>700 || /(\bpas d'[ée]v[ée]nements? programm|voici (un nouveau|votre) (calendrier|planning|agenda))/i.test(responseText));
    if (!responseText || garbled) responseText = fallbackResponse(applied, risks, det, currentEvents, actionError);
  }

  return {
    response: responseText,
    action: applied.length ? { type:'multi', applied } : null,
    error: actionError, memoryUpdated: memChanged, risks,
    preview: previewPlan,                                   // si présent → le front affiche l'aperçu à confirmer
    reload: (reorganized && !previewPlan) || structural || memChanged,
    memorySnapshot: { goals:memory.goals, constraints:memory.constraints, preferences:memory.preferences }
  };
}
// Réponse d'action instantanée (sans modèle) — claire et fidèle à ce qui a été fait/proposé.
function buildActionReply(applied, previewPlan, risks, previewOn){
  const L=[];
  if (previewPlan && (previewPlan.counts.added||previewPlan.counts.removed)){
    const c=previewPlan.counts;
    L.push(`J'ai préparé un aperçu : ${c.added} ajout(s)${c.removed?`, ${c.removed} retrait(s)`:''}. Vérifiez sur le calendrier puis cliquez « Appliquer » — ou ajustez/annulez.`);
  } else if (applied.length){
    L.push('C\'est fait : '+applied.join(' · ')+'.');
  } else {
    L.push('OK.');
  }
  if (risks && risks.length) L.push(`⚠️ ${risks.length} tâche(s) risquent de dépasser leur échéance — repoussez-la, raccourcissez-la ou libérez du temps.`);
  return L.join(' ');
}

// Réponse de repli en clair, sans modèle (Ollama éteint) — toujours utile.
function fallbackResponse(applied, risks, det, currentEvents, actionError){
  const parts=[];
  if (applied.length){ parts.push('C\'est fait :'); parts.push(applied.map(a=>'• '+a).join('\n')); }
  else if (det && det.summary){ parts.push(det.summary); }
  if (risks && risks.length){ parts.push('\n⚠️ '+risks.length+' tâche(s) à risque : '+risks.map(r=>`${r.title} (${r.missing} min non placés)`).join(' ; ')+'.'); }
  if (actionError){ parts.push('\n(Note : '+actionError+')'); }
  if (!parts.length){
    // Aucune action : on liste les prochains événements pour rester utile.
    const now=new Date();
    const up=(currentEvents||[]).filter(e=>e.start?.dateTime && new Date(e.start.dateTime)>=now)
      .sort((a,b)=>new Date(a.start.dateTime)-new Date(b.start.dateTime)).slice(0,5);
    if(up.length){
      parts.push('Voici ce qui arrive :');
      parts.push(up.map(e=>{ const s=new Date(e.start.dateTime); return `• ${s.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'})} ${pad2(s.getHours())}h${pad2(s.getMinutes())} — ${e.summary||'Sans titre'}`; }).join('\n'));
    } else {
      parts.push('Je n\'ai pas d\'action à effectuer ici. Essayez par ex. « bloque 2h de sport demain à 18h », « ajoute une tâche réviser maths 3h avant vendredi » ou « réorganise mon planning ».');
    }
  }
  return parts.join('\n');
}

// ─── MOTEUR DE PLANIFICATION (type Reclaim : contraintes + priorités) ───
// Pas d'IA : un solveur glouton à scoring. Ordre strict P1→P4 ; à priorité égale,
// habitudes avant tâches (comme Reclaim). Les blocs gérés non verrouillés sont
// recalculés ; les événements réels + blocs verrouillés sont immuables.
const pad2 = n => String(n).padStart(2,'0');
function startOfToday(){ const d=new Date(); d.setHours(0,0,0,0); return d; }
function hoursWindow(type){ return type==='personal' ? [config.personal_start??7, config.personal_end??22] : [config.work_start??9, config.work_end??18]; }
// Heures par jour (0=dim..6=sam) → [start,end] ou null si jour désactivé
const HK = ['sun','mon','tue','wed','thu','fri','sat'];
function dayHours(type, wd){
  const map = type==='personal'?config.personal_hours : type==='meeting'?config.meeting_hours : config.working_hours;
  const d = map && map[HK[wd]];
  if(d){ if(d.on===false) return null; return [d.start, d.end]; }
  return hoursWindow(type);
}
function dayKey(wd){ return Object.keys(DAY_MAP).find(k=>DAY_MAP[k]===wd); }
function gapMin(){ return (config.buffers?.task_habit_break ?? config.buffer_minutes) || 0; }
function snapStep(){ return config.start_intervals || 5; }
function roundUp5(d){ const ms=snapStep()*60000; return new Date(Math.ceil(d.getTime()/ms)*ms); }
function emo(e){ return config.emoji_prefix===false ? '' : (e?e+' ':''); }
function catColor(cat, fallback){ return (config.colors && config.colors[cat]) || fallback; }

// ── Congés / absences : pas de travail planifié sur ces dates ──
function inTimeoff(day){ return (config.timeoff||[]).some(t=>{ try{ const s=new Date(t.start+'T00:00:00'), e=new Date(t.end+'T23:59:59'); return day>=s && day<=e; }catch(_){ return false; } }); }

// ── Inférence du créneau d'après le titre (matin/soir/sport…) → [hDébut,hFin,maxMin] ──
function inferWindow(title){
  const t=(title||'').toLowerCase(); const has=(...w)=>w.some(x=>t.includes(x));
  if(has('réveil','reveil','wake up')) return [5,9,30];
  if(has('morning routine','routine du matin','routine matinale','matinale')) return [5,10,120];
  if(has('petit-déj','petit dej','petit-dejeuner','breakfast')) return [6,10,60];
  if(has('matin','morning')) return [6,12,180];
  if(has('déjeuner','dejeuner','lunch','midi')) return [11,14,90];
  if(has('après-midi','apres-midi','afternoon')) return [13,18,240];
  if(has('dîner','diner','dinner')) return [18,22,90];
  if(has('coucher','bedtime','routine du soir','évening routine')) return [20,23,60];
  if(has('soir','evening','nuit','night')) return [18,23,180];
  if(has('sport','gym','workout','muscu','fitness','training','entraînement','entrainement','course','running','jogging','run')) return [6,21,120];
  if(has('méditation','meditation','yoga','stretch','étirement')) return [6,22,60];
  if(has('lecture','reading','lire')) return [7,23,90];
  if(has('deep work','travail profond','concentration','focus')) return [8,18,180];
  if(has('réunion','reunion','meeting','call','rdv','rendez-vous')) return [8,19,120];
  return null;
}
function overlaps(s,e,events,ignoreId){ return (events||[]).some(ev=>{ if(ignoreId&&ev.id===ignoreId) return false; const es=ev.start?.dateTime?new Date(ev.start.dateTime):null; const ee=ev.end?.dateTime?new Date(ev.end.dateTime):null; if(!es||!ee) return false; return e>es && s<ee; }); }
// Place un événement fixe sans chevauchement, en respectant la fenêtre déduite du titre
function placeNoOverlap(startISO, endISO, events, win){
  let s=new Date(startISO), e=new Date(endISO); let dur=Math.max(15,(e-s)/60000);
  if(win){ const [h0,h1,maxM]=win; if(maxM && dur>maxM) dur=maxM;
    if(s.getHours()<h0){ s.setHours(h0, s.getMinutes(),0,0); }
    if(s.getHours()>=h1){ s.setHours(h0,0,0,0); } // ramène en début de fenêtre
    e=new Date(s.getTime()+dur*60000);
  }
  if(!overlaps(s,e,events)) return { start:isoLocal(s), end:isoLocal(e), shifted:(isoLocal(s)!==startISO) };
  let cur=new Date(s); const limit=new Date(s.getTime()+14*86400000);
  while(cur<limit){
    if(win){ const h=cur.getHours(); if(h<win[0]){ cur.setHours(win[0],0,0,0); continue; } if(h>=win[1]){ cur.setDate(cur.getDate()+1); cur.setHours(win[0],0,0,0); continue; } }
    const ce=new Date(cur.getTime()+dur*60000);
    if(win && (ce.getHours()>win[1] || (ce.getHours()===win[1]&&ce.getMinutes()>0))){ cur.setDate(cur.getDate()+1); cur.setHours(win[0],0,0,0); continue; }
    if(!overlaps(cur,ce,events)) return { start:isoLocal(cur), end:isoLocal(ce), shifted:true };
    cur=new Date(cur.getTime()+15*60000);
  }
  return { start:isoLocal(s), end:isoLocal(e), conflict:true };
}

// Créneaux libres d'un jour dans [h0,h1] (≥ minDur), hors passé et hors "busy"
function freeIn(day,h0,h1,busy,minDur){
  const dS=new Date(day); dS.setHours(h0,0,0,0);
  const dE=new Date(day); dE.setHours(h1,0,0,0);
  const now=new Date();
  let lo=dS; if(dS<now) lo=roundUp5(now); if(lo>=dE) return [];
  const within=busy.filter(b=>b.end>lo && b.start<dE)
    .map(b=>({start:new Date(Math.max(b.start.getTime(),lo.getTime())),end:new Date(Math.min(b.end.getTime(),dE.getTime()))}))
    .sort((a,b)=>a.start-b.start);
  const slots=[]; let cur=new Date(lo);
  for(const b of within){ if(cur<b.start){ const d=(b.start-cur)/60000; if(d>=minDur) slots.push({start:new Date(cur),end:new Date(b.start),duration:d}); } if(b.end>cur) cur=new Date(b.end); }
  if(cur<dE){ const d=(dE-cur)/60000; if(d>=minDur) slots.push({start:new Date(cur),end:new Date(dE),duration:d}); }
  return slots;
}

async function createManaged(b){
  return createEvent({
    title:b.title, start:isoLocal(b.start), end:isoLocal(b.end), colorId:b.colorId, description:'TimeFlow',
    location:b.location||undefined,
    transparency: b.visibility==='free' ? 'transparent' : undefined,
    extendedProperties:{ private:{ tfManaged:'1', tfKind:b.kind, tfRef:String(b.ref||'') } }
  });
}

// ── OPTIMISEUR À SCORE (stabilité · fenêtre préférée · proximité heure idéale) ──
let _prevSlots = new Map();   // « kind:ref » → [Date de début] de la version PRÉCÉDENTE du planning
const prevKey = (kind, ref, title) => ref ? (kind+':'+ref) : (kind+':'+_norm(title));
// Fenêtre horaire préférée déduite de la mémoire (« sport le soir », « révisions l'après-midi »…)
function prefWindowFor(name){
  const n=_norm(name); const first=n.split(' ')[0]; if(first.length<3) return null;
  const winOf=s=> /matin/.test(s)?[6,12]: /midi/.test(s)?[11,14]: /apr[èe]s[- ]?midi|aprem/.test(s)?[13,18]: /soir/.test(s)?[18,23]: null;
  for(const p of (memory.preferences||[])){ const txt=String(p.text||'').toLowerCase(); if(txt.includes(first)){ const w=winOf(txt); if(w) return w; } }
  return null;
}
// Le créneau correspond-il à la version précédente ? (même jour de semaine + heure ±20 min)
function isStable(kind, ref, title, start){
  const arr=_prevSlots.get(prevKey(kind,ref,title)); if(!arr) return false;
  const sm=start.getHours()*60+start.getMinutes();
  return arr.some(p=> p.getDay()===start.getDay() && Math.abs((p.getHours()*60+p.getMinutes())-sm)<=20);
}
// Score d'un créneau (plus haut = mieux) : proximité heure idéale + stabilité + fenêtre préférée
function slotScore(start, idealStart, kind, ref, title, prefWin){
  let s = -Math.abs(start-idealStart)/1800000;                 // −1 par 30 min d'écart à l'heure idéale
  if(isStable(kind,ref,title,start)) s += 6;                   // garder la place précédente → minimiser les changements
  if(prefWin){ const hh=start.getHours()+start.getMinutes()/60; if(hh>=prefWin[0] && hh<prefWin[1]) s += 3; }  // fenêtre préférée (mémoire)
  return s;
}

// Placement d'une habitude : timesPerWeek occurrences/semaine, jour idéal puis heure idéale
function placeHabit(h, busy, t0, t1, created){
  const elig=(h.idealDays||h.days||[]).map(d=>DAY_MAP[String(d).toLowerCase()]).filter(x=>x!=null);
  if(!elig.length) return 0;
  const ideal=h.idealDay?DAY_MAP[String(h.idealDay).toLowerCase()]:null;
  const target=h.maxDur||h.duration||60;
  const minDur=Math.min(h.minDur||target, target);
  const hType=h.hoursType||'personal';
  const [ih,im]=String(h.idealTime||(h.preferredStart!=null?pad2(h.preferredStart)+':00':'18:00')).split(':').map(Number);
  const perWeek=h.timesPerWeek||elig.length||1;
  const hStart=h.startDate? new Date(h.startDate+'T00:00:00') : null;
  const hEnd=h.endDate? new Date(h.endDate+'T23:59:59') : null;
  let weekStart=new Date(t0); const dow=weekStart.getDay(); weekStart.setDate(weekStart.getDate()-((dow+6)%7)); weekStart.setHours(0,0,0,0);
  let total=0;
  while(weekStart<t1){
    let dayList=[];
    for(let i=0;i<7;i++){ const day=new Date(weekStart); day.setDate(weekStart.getDate()+i); day.setHours(0,0,0,0);
      if(day<startOfToday()||day>t1) continue;
      if(hStart && day<hStart) continue; if(hEnd && day>hEnd) continue;
      const wd=day.getDay(); if(!elig.includes(wd)) continue; if(blockedDay(dayKey(wd))) continue;
      if(hType!=='personal' && inTimeoff(day)) continue;
      if(!dayHours(hType, wd)) continue;
      dayList.push(day);
    }
    // Ordre des jours : jour idéal d'abord, puis les jours déjà utilisés (stabilité), puis le reste
    const prevArr=_prevSlots.get(prevKey('habit',h.id,h.name))||[];
    const prevDows=new Set(prevArr.map(p=>p.getDay()));
    dayList.sort((a,b)=>{ const pa=(ideal!=null&&a.getDay()===ideal?2:0)+(prevDows.has(a.getDay())?1:0); const pb=(ideal!=null&&b.getDay()===ideal?2:0)+(prevDows.has(b.getDay())?1:0); return pb-pa; });
    const prefWin=prefWindowFor(h.name);
    let placedWeek=0;
    for(const day of dayList){ if(placedWeek>=perWeek) break;
      const win=dayHours(hType, day.getDay()); if(!win) continue; const [h0,h1]=win;
      const slots=freeIn(day,h0,h1,busy,minDur); if(!slots.length) continue;
      const idealStart=new Date(day); idealStart.setHours(ih,im||0,0,0);
      const fits=(st,sl)=> st>=sl.start && new Date(st.getTime()+Math.min(target,(sl.end-st)/60000)*60000)<=sl.end && (sl.end-st)/60000>=minDur;
      let best=null;
      for(const s of slots){
        const cands=[];
        if(idealStart>=s.start && new Date(idealStart.getTime()+target*60000)<=s.end) cands.push(new Date(idealStart)); // heure idéale
        cands.push(new Date(s.start));                                                                                   // début du créneau
        for(const p of prevArr){ if(p.getDay()===day.getDay()){ const ps=new Date(day); ps.setHours(p.getHours(),p.getMinutes(),0,0); if(fits(ps,s)) cands.push(ps); } }  // créneau précédent (stabilité)
        for(const start of cands){ if(!fits(start,s)) continue;
          const score=slotScore(start, idealStart, 'habit', h.id, h.name, prefWin);
          if(!best||score>best.score) best={start, slotEnd:s.end, score};
        }
      }
      if(!best) continue;
      const len=Math.min(target, (best.slotEnd-best.start)/60000); if(len<minDur) continue;
      const end=new Date(best.start.getTime()+len*60000);
      const col=h.color || catColor(hType==='personal'?'personal':'work','6');
      created.push({kind:'habit', ref:h.id, title:`${emo(h.emoji||'🔁')}${h.name}`, start:best.start, end, colorId:col, visibility:h.visibility, location:h.location});
      busy.push({start:best.start, end:new Date(end.getTime()+gapMin()*60000)});
      placedWeek++; total++;
    }
    weekStart=new Date(weekStart); weekStart.setDate(weekStart.getDate()+7);
  }
  return total;
}

// Placement d'une tâche : découpage min/max, plafond/jour, avant l'échéance, après "start"
function placeTask(t, busy, horizonEnd, created){
  const total=t.duration||60; let remaining=total;
  const split=t.splitUp!==false;
  const minC=split?Math.max(15,t.minChunk||30):total;
  const maxC=split?Math.max(minC,t.maxChunk||120):total;
  const maxPerDay=Math.max(maxC, t.maxPerDay||config.task_max_per_day||240);
  const hType=t.hoursType||'work';
  const deadline=t.deadline? new Date(String(t.deadline).length<=10? t.deadline+'T23:59:59': t.deadline) : horizonEnd;
  const startAfter=t.scheduleAfter? new Date(t.scheduleAfter) : new Date();
  const rank=prioRank(t.priority);
  const chunks=[];
  for(let i=0;i<21 && remaining>0;i++){
    const day=startOfToday(); day.setDate(day.getDate()+i);
    if(day>deadline) break;
    if(blockedDay(dayKey(day.getDay()))) continue;
    if(hType!=='personal' && inTimeoff(day)) continue;
    const win=dayHours(hType, day.getDay()); if(!win) continue; const [h0,h1]=win;
    let perDay=0, guard=0;
    while(remaining>0 && perDay<maxPerDay && guard++<10){
      const want=Math.min(minC, remaining);
      const slots=freeIn(day,h0,h1,busy,want).filter(s=>s.end>startAfter); if(!slots.length) break;
      const s=slots[0];
      const start=s.start<startAfter? new Date(startAfter): new Date(s.start);
      const avail=(s.end-start)/60000; if(avail<want) break;
      const chunk=Math.min(maxC, remaining, avail, maxPerDay-perDay); if(chunk<want) break;
      const end=new Date(start.getTime()+chunk*60000);
      chunks.push({start,end});
      busy.push({start, end:new Date(end.getTime()+gapMin()*60000)});
      remaining-=chunk; perDay+=chunk;
      if(!split) break;
    }
    if(!split && chunks.length) break;
  }
  const n=chunks.length;
  chunks.forEach((c,idx)=>{
    const dot = config.emoji_prefix===false ? '' : (t.emoji?t.emoji+' ':PRIO_DOT[rank]+' ');
    const label=n>1? `${dot}${t.title} (${idx+1}/${n})` : `${dot}${t.title}`;
    const col=t.color || catColor(hType==='personal'?'personal':'work', PRIO_COLOR[rank]);
    created.push({kind:'task', ref:t.id, title:label, start:c.start, end:c.end, colorId:col});
  });
  return { n, placed: total-remaining, missing: remaining };
}

// Ordonnancement des tâches type Reclaim : Up Next → à risque (échéance) → priorité + échéance
function businessDaysUntil(deadline){
  const today=startOfToday(); let d=new Date(today), n=0, guard=0;
  while(d<=deadline && guard++<120){ const wd=d.getDay(); if(dayHours('work',wd) && !blockedDay(dayKey(wd))) n++; d.setDate(d.getDate()+1); }
  return Math.max(1,n);
}
function orderTasks(list, horizonEnd){
  const meta=list.map(t=>{
    const total=t.duration||60;
    const maxC=(t.splitUp!==false)?Math.max(15,t.maxChunk||config.task_defaults?.max_chunk||120):total;
    const maxPerDay=Math.max(maxC, t.maxPerDay||config.task_max_per_day||240);
    const deadline=t.deadline? new Date(String(t.deadline).length<=10? t.deadline+'T23:59:59': t.deadline) : horizonEnd;
    const daysNeeded=Math.ceil(total/maxPerDay);
    const slack=businessDaysUntil(deadline)-daysNeeded;
    return { t, deadline, slack, upNext:!!t.upNext, ord:(t.upNextOrder??0) };
  });
  const upN = meta.filter(x=>x.upNext).sort((a,b)=>a.ord-b.ord);
  const rest= meta.filter(x=>!x.upNext);
  const risk= rest.filter(x=>x.slack<=1).sort((a,b)=> a.deadline-b.deadline || prioRank(a.t.priority)-prioRank(b.t.priority));
  const norm= rest.filter(x=>x.slack>1 ).sort((a,b)=> prioRank(a.t.priority)-prioRank(b.t.priority) || a.deadline-b.deadline);
  return [...upN, ...risk, ...norm].map(x=>x.t);
}

// Focus proactif (si objectif hebdo défini) : remplit les trous des jours ouvrés
function placeFocus(busy, t0, t1, created){
  const targetMin=(config.focus_weekly_target||0)*60; if(targetMin<=0) return 0;
  const dur=config.focus_duration||120; const maxDay=config.focus_max_per_day||180;
  let weekStart=new Date(t0); const dow=weekStart.getDay(); weekStart.setDate(weekStart.getDate()-((dow+6)%7)); weekStart.setHours(0,0,0,0);
  let total=0;
  while(weekStart<t1){
    let weekMin=0;
    for(let i=0;i<7;i++){ if(weekMin>=targetMin) break;
      const day=new Date(weekStart); day.setDate(weekStart.getDate()+i); day.setHours(0,0,0,0);
      if(day<startOfToday()||day>t1) continue; if(blockedDay(dayKey(day.getDay()))) continue;
      if(inTimeoff(day)) continue;
      const win=dayHours('work', day.getDay()); if(!win) continue; const [h0,h1]=win;
      let dayMin=0, guard=0;
      while(weekMin<targetMin && dayMin<maxDay && guard++<4){
        const need=Math.min(dur, targetMin-weekMin, maxDay-dayMin);
        const minSlot = config.focus_mode==='reactive' ? Math.min(dur, need) : Math.min(need,30);
        const slots=freeIn(day,h0,h1,busy,minSlot); if(!slots.length) break;
        const s=slots.sort((a,b)=>b.duration-a.duration)[0];
        const len=Math.min(dur, s.duration, targetMin-weekMin, maxDay-dayMin); if(len<30) break;
        const end=new Date(s.start.getTime()+len*60000);
        created.push({kind:'focus', ref:'', title:`${emo('🎯')}Focus`, start:new Date(s.start), end, colorId:catColor('focus','2')});
        busy.push({start:new Date(s.start), end:new Date(end.getTime()+gapMin()*60000)});
        weekMin+=len; dayMin+=len; total++;
      }
    }
    weekStart=new Date(weekStart); weekStart.setDate(weekStart.getDate()+7);
  }
  return total;
}
function placeFocusDay(day, busy, created){
  const win=dayHours('work', day.getDay()); if(!win) return 0; const [h0,h1]=win; const dur=config.focus_duration||120;
  const slots=freeIn(day,h0,h1,busy,Math.min(dur,30)); if(!slots.length) return 0;
  const s=slots.sort((a,b)=>b.duration-a.duration)[0]; const len=Math.min(dur,s.duration);
  const end=new Date(s.start.getTime()+len*60000);
  created.push({kind:'focus',ref:'',title:`${emo('🎯')}Focus`,start:new Date(s.start),end,colorId:catColor('focus','2')});
  busy.push({start:new Date(s.start),end}); return 1;
}

// ─── SOLVEUR PRINCIPAL ───
// Verrou de concurrence : empêche deux passes simultanées (reflow client + poll
// serveur + planning hebdo) qui, en effaçant/recréant les blocs gérés en même
// temps, pouvaient dupliquer ou supprimer des événements. Si une passe tourne,
// la nouvelle est mise en file (une seule) pour capter l'état le plus récent.
let _optimizing=false, _optimizeQueued=false;
let pendingPlan=null;   // plan d'aperçu (mode preview) en attente de confirmation
async function optimize(opts={}){
  if(!tokens) return {created:0, error:'non connecté'};
  if(_optimizing){ _optimizeQueued=true; return {created:0, skipped:true}; }
  _optimizing=true;
  let result;
  try { result = await _optimizeCore(opts); }
  finally { _optimizing=false; }
  if(_optimizeQueued){ _optimizeQueued=false; return optimize(opts); }
  return result;
}
async function _optimizeCore(opts={}){
  if(!tokens) return {created:0, error:'non connecté'};
  const only = opts.only||'all';
  const preview = opts.preview===true;
  const days = opts.days || config.horizon_days || 14;
  const now=new Date();
  const t0=new Date(now); t0.setHours(0,0,0,0);
  const t1=new Date(t0); t1.setDate(t0.getDate()+days); t1.setHours(23,59,59,0);
  try{
    let events = await getEvents(t0.toISOString(), t1.toISOString());
    // 1) Repère les blocs gérés FUTURS à remplacer. En PREVIEW on ne supprime pas
    //    (on calcule juste le diff) ; en mode normal la suppression a lieu à l'étape 4.
    let wipe=[]; let busy;
    const oid = opts.onlyItem && opts.onlyItem.id ? String(opts.onlyItem.id) : null;
    if(oid){
      // PLACEMENT FOCALISÉ : on ne (re)place QUE cet élément. On retire seulement SES anciens
      // blocs ; tous les autres blocs gérés restent en place → l'aperçu ne montre que CET item.
      wipe = events.filter(e=> isManaged(e) && !isLocked(e) && e.start?.dateTime && new Date(e.end.dateTime)>now && e.extendedProperties?.private?.tfRef===oid);
      const wiped=new Set(wipe.map(e=>e.id));
      _prevSlots = new Map();
      for(const e of wipe){ const k=prevKey(tfKindOf(e), oid, (e.summary||'').replace(/^[^\wÀ-ÿ]+/,'')); if(!_prevSlots.has(k)) _prevSlots.set(k, []); _prevSlots.get(k).push(new Date(e.start.dateTime)); }
      // busy = TOUT le reste (réels + AUTRES blocs gérés + verrouillés) → zéro chevauchement
      busy = events.filter(e=> e.start?.dateTime && !wiped.has(e.id)).map(e=>({start:new Date(e.start.dateTime), end:new Date(e.end.dateTime)}));
    } else {
      if(opts.wipe!==false){
        wipe = events.filter(e=> isManaged(e) && !isLocked(e) && e.start?.dateTime
          && (only==='all' || tfKindOf(e)===only)
          && new Date(e.end.dateTime) > now);
        const wiped=new Set(wipe.map(e=>e.id));
        events = events.filter(e=>!wiped.has(e.id));   // pour le calcul du « busy », on suppose qu'ils seront retirés
        _prevSlots = new Map();
        for(const e of wipe){ const k=prevKey(tfKindOf(e), e.extendedProperties?.private?.tfRef||'', (e.summary||'').replace(/^[^\wÀ-ÿ]+/,'')); if(!_prevSlots.has(k)) _prevSlots.set(k, []); _prevSlots.get(k).push(new Date(e.start.dateTime)); }
      }
      // "busy" immuable = événements réels + blocs verrouillés
      busy = events.filter(e=> e.start?.dateTime && (!isManaged(e) || isLocked(e)))
        .map(e=>({start:new Date(e.start.dateTime), end:new Date(e.end.dateTime)}));
    }
    if(Array.isArray(opts.extraBusy)) opts.extraBusy.forEach(b=>{ try{ busy.push({start:new Date(b.start), end:new Date(b.end)}); }catch(_){} });
    // 3) Placement — ordre type Reclaim : habitudes (priorité, défense stricte d'abord),
    //    puis Focus PROACTIF (défend le temps avant les tâches), puis tâches (urgence),
    //    puis Focus RÉACTIF (ne remplit que le temps restant).
    const created=[]; const risks=[];
    if(oid){
      // Placement focalisé : seulement l'habitude ou la tâche visée
      if(opts.onlyItem.kind==='habit'){ const h=habits.find(x=>String(x.id)===oid && x.active!==false); if(h) placeHabit(h, busy, t0, t1, created); }
      else if(opts.onlyItem.kind==='task'){ const tk=tasks.find(x=>String(x.id)===oid && x.active!==false); if(tk){ const r=placeTask(tk, busy, t1, created); if(r&&r.missing>0) risks.push({id:tk.id,title:tk.title,missing:r.missing,priority:tk.priority,deadline:tk.deadline||null}); } }
    } else
    // clearOnly = on supprime les blocs gérés SANS rien replacer (réinitialisation)
    if(!opts.clearOnly){
    const habitsActive = habits.filter(h=>h.active!==false && !snoozed(h));
    const tasksPending = tasks.filter(t=>t.active!==false && !t.scheduled && !snoozed(t) && !t.locked);
    if(only==='all'||only==='habit'){
      for(let p=0;p<4;p++){
        habitsActive.filter(h=>prioRank(h.priority)===p)
          .sort((a,b)=>((b.timeDefense==='aggressive')?1:0)-((a.timeDefense==='aggressive')?1:0))
          .forEach(h=>placeHabit(h,busy,t0,t1,created));
      }
    }
    const focusProactive = config.focus_mode!=='reactive';
    if((only==='all'||only==='focus') && focusProactive) placeFocus(busy,t0,t1,created);
    if(only==='all'||only==='task'){
      for(const t of orderTasks(tasksPending, t1)){
        const r=placeTask(t,busy,t1,created);
        if(r && r.missing>0) risks.push({ id:t.id, title:t.title, missing:r.missing, priority:t.priority, deadline:t.deadline||null });
      }
    }
    if((only==='all'||only==='focus') && !focusProactive) placeFocus(busy,t0,t1,created);
    }

    // 4a) PREVIEW : on ne touche pas à Google — on stocke le plan (diff) pour confirmation.
    if(preview){
      const plan = {
        id: Date.now(), createdAt: new Date().toISOString(), only,
        deletes: wipe.map(e=>({ id:e.id, title:e.summary||'(sans titre)', start:e.start.dateTime, end:e.end.dateTime, kind:tfKindOf(e), colorId:e.colorId })),
        creates: created.map((b,i)=>({ idx:i, kind:b.kind, ref:String(b.ref||''), title:b.title, start:isoLocal(b.start), end:isoLocal(b.end), colorId:b.colorId, location:b.location||'', visibility:b.visibility||'' })),
        risks
      };
      pendingPlan = plan;
      return { preview:true, plan: publicPlan(plan), risks, created:created.length };
    }

    // 4b) NORMAL : applique réellement — supprime les anciens blocs puis crée les nouveaux.
    for(const e of wipe){ try{ await deleteEvent(e.id); locks.delete(e.id); }catch{} }
    const wiped=new Set(wipe.map(e=>e.id));
    if(only==='all'||only==='task') tasks.forEach(t=>{ if((t.eventIds||[t.eventId]).some(id=>wiped.has(id))){ t.scheduled=false; t.eventIds=[]; t.eventId=null; } });
    const idsByTask={}; const todayEnd=new Date(t0); todayEnd.setHours(23,59,59,0); let lockedAny=false;
    for(const b of created){ try{ const ev=await createManaged(b);
      if(b.kind==='task') (idsByTask[b.ref]=idsByTask[b.ref]||[]).push(ev.id);
      if(config.auto_lock && ev.id && new Date(b.start)<=todayEnd){ locks.add(ev.id); lockedAny=true; }
    }catch(e){ console.error('create',e.message); } }
    if(wipe.length || lockedAny) saveLocks();
    if(only==='all'||only==='task'){ Object.entries(idsByTask).forEach(([rid,ids])=>{ const t=tasks.find(x=>x.id===rid); if(t){ t.scheduled=true; t.eventIds=ids; t.eventId=ids[0]; } }); saveTasks(); }
    return {created:created.length, risks};
  }catch(e){ console.error('optimize:', e.message); return {created:0, error:e.message}; }
}

// Vue publique d'un plan (pour le client) = diff NET : on annule les paires
// « supprimé puis recréé à l'identique » (même titre + mêmes horaires) pour
// n'afficher que les vrais changements (ajouts / retraits / déplacements).
function publicPlan(plan){
  if(!plan) return null;
  const keyOf=(t,s,e)=>`${t}|${new Date(s).getTime()}|${new Date(e).getTime()}`;
  const delSet=new Set(plan.deletes.map(d=>keyOf(d.title,d.start,d.end)));
  const creSet=new Set(plan.creates.map(c=>keyOf(c.title,c.start,c.end)));
  const creates=plan.creates.filter(c=>!delSet.has(keyOf(c.title,c.start,c.end)))
    .map(b=>({ idx:b.idx, kind:b.kind, title:b.title, start:b.start, end:b.end, colorId:b.colorId }));
  const deletes=plan.deletes.filter(d=>!creSet.has(keyOf(d.title,d.start,d.end)))
    .map(d=>({ id:d.id, title:d.title, start:d.start, end:d.end, kind:d.kind }));
  return { id:plan.id, createdAt:plan.createdAt, creates, deletes,
    risks: plan.risks||[], counts:{ added:creates.length, removed:deletes.length } };
}
// Applique un plan d'aperçu : supprime les blocs marqués puis crée les nouveaux (managés ou fixes).
async function applyPlan(plan){
  if(!plan) return { applied:false, error:'aucun plan en attente' };
  if(!tokens)  return { applied:false, error:'non connecté' };
  for(const d of plan.deletes){ try{ await deleteEvent(d.id); locks.delete(d.id); }catch{} }
  const wiped=new Set(plan.deletes.map(d=>d.id));
  tasks.forEach(t=>{ if((t.eventIds||[t.eventId]).some(id=>wiped.has(id))){ t.scheduled=false; t.eventIds=[]; t.eventId=null; } });
  const idsByTask={};
  for(const b of plan.creates){
    try{
      const body={ title:b.title, start:new Date(b.start), end:new Date(b.end), colorId:b.colorId, location:b.location||undefined, visibility:b.visibility };
      let ev;
      if(b.kind==='event'){ ev=await createEvent({ title:b.title, start:isoLocal(new Date(b.start)), end:isoLocal(new Date(b.end)), colorId:b.colorId, location:b.location||undefined }); }
      else { ev=await createManaged(body); if(b.kind==='task' && b.ref) (idsByTask[b.ref]=idsByTask[b.ref]||[]).push(ev.id); }
    }catch(e){ console.error('applyPlan create', e.message); }
  }
  Object.entries(idsByTask).forEach(([rid,ids])=>{ const t=tasks.find(x=>x.id===rid); if(t){ t.scheduled=true; t.eventIds=ids; t.eventId=ids[0]; } });
  saveTasks(); saveLocks();
  const r={ applied:true, created:plan.creates.length, deleted:plan.deletes.length };
  if(pendingPlan && pendingPlan.id===plan.id) pendingPlan=null;
  return r;
}

// ─── Fonctions historiques (déléguées au solveur) ───
async function autoTimeBlock(targetDate){
  if(!tokens||!config.auto_schedule) return 0;
  try{
    const date=new Date(targetDate); date.setHours(0,0,0,0); const end=new Date(date); end.setHours(23,59,59,0);
    const events=await getEvents(date.toISOString(), end.toISOString());
    if(events.some(e=>tfKindOf(e)==='focus')) return 0;
    const busy=events.filter(e=>e.start?.dateTime && (!isManaged(e)||isLocked(e))).map(e=>({start:new Date(e.start.dateTime),end:new Date(e.end.dateTime)}));
    const created=[]; placeFocusDay(date, busy, created);
    for(const b of created){ try{ await createManaged(b);}catch{} }
    return created.length;
  }catch(e){ console.error('TimeBlock:',e.message); return 0; }
}
async function scheduleHabits(){ return (await optimize({only:'habit', days:8})).created; }
async function scheduleTasks(){ return (await optimize({only:'task'})).created; }

async function addBuffers(){
  if(!tokens) return 0;
  const brk=config.buffers?.task_habit_break||0, travel=config.buffers?.travel_time||0, decomp=config.buffers?.decompression||0;
  if(!brk && !travel && !decomp && !config.buffer_minutes) return 0;
  let n=0;
  try{
    const t0=new Date(); t0.setHours(0,0,0,0); const t1=new Date(t0); t1.setDate(t0.getDate()+(config.horizon_days||14));
    const events=await getEvents(t0.toISOString(), t1.toISOString());
    const timed=events.filter(e=>e.start?.dateTime && tfKindOf(e)!=='buffer' && !e.summary?.includes('🚗') && !e.summary?.includes('😌'));
    const mkBuf=async(title,colorCat,start,end)=>{ await createEvent({title, start:isoLocal(start), end:isoLocal(end), colorId:catColor(colorCat,'8'), transparency:'transparent', extendedProperties:{private:{tfManaged:'1',tfKind:'buffer'}}}); n++; };
    const occupied=timed.map(e=>({s:new Date(e.start.dateTime),e:new Date(e.end.dateTime)}));
    const free=(s,e)=>!occupied.some(o=>e>o.s && s<o.e);
    // Travel + décompression autour des événements
    for(const e of timed){
      const s=new Date(e.start.dateTime), en=new Date(e.end.dateTime);
      const isMeeting=!isManaged(e);
      if(travel && e.location){
        const b1s=new Date(s.getTime()-travel*60000); if(free(b1s,s)) await mkBuf(emo('🚗')+'Trajet','travel_breaks',b1s,s);
        const b2e=new Date(en.getTime()+travel*60000); if(free(en,b2e)) await mkBuf(emo('🚗')+'Trajet','travel_breaks',en,b2e);
      }
      if(decomp && isMeeting){
        const de=new Date(en.getTime()+decomp*60000); if(free(en,de)) await mkBuf(emo('😌')+'Décompression','travel_breaks',en,de);
      }
    }
    // Pauses entre blocs trop rapprochés (Task & Habit breaks)
    const minGap=brk||config.buffer_minutes||0;
    if(minGap){
      const days={};
      timed.forEach(e=>{ const k=new Date(e.start.dateTime).toDateString(); (days[k]=days[k]||[]).push(e); });
      for(const k of Object.keys(days)){
        const sorted=days[k].sort((a,b)=>new Date(a.start.dateTime)-new Date(b.start.dateTime));
        for(let i=0;i<sorted.length-1;i++){
          const g=(new Date(sorted[i+1].start.dateTime)-new Date(sorted[i].end.dateTime))/60000;
          if(g>0 && g<minGap){ await mkBuf(emo('⏸️')+'Pause','travel_breaks',new Date(sorted[i].end.dateTime),new Date(sorted[i+1].start.dateTime)); }
        }
      }
    }
  }catch(e){ console.error('Buffers:',e.message); }
  return n;
}

// ─── REVUE HEBDO ───
async function weeklyReview() {
  if (!tokens) return;
  try {
    const events = await getEvents(new Date(Date.now()-7*86400000).toISOString(), new Date().toISOString());
    let fm=0, mm=0, hc=0;
    for (const e of events) {
      if (!e.start?.dateTime) continue;
      const dur = (new Date(e.end?.dateTime)-new Date(e.start?.dateTime))/60000;
      const managed = isManaged(e), kind = tfKindOf(e);
      if (managed && kind==='focus') fm+=dur;
      else if (managed && kind==='habit') hc++;
      else if (!managed) mm+=dur;   // vraies réunions / événements (les blocs gérés tâches/pauses ne comptent pas)
    }
    stats = { focusHours:Math.round(fm/60*10)/10, meetingHours:Math.round(mm/60*10)/10, habitsCompleted:hc, streak:(stats.streak||0)+(hc>0?1:0), lastReview:new Date().toISOString() };
    saveStats();
    const weekOf = new Date(Date.now()-7*86400000).toISOString().split('T')[0];
    memory.weekHistory = memory.weekHistory.filter(w=>w.weekOf!==weekOf);
    memory.weekHistory.push({ weekOf, summary:`Focus: ${stats.focusHours}h, Réunions: ${stats.meetingHours}h, Habitudes: ${hc} complétées`, created:new Date().toISOString() });
    if (memory.weekHistory.length>8) memory.weekHistory = memory.weekHistory.slice(-8);
    saveMemory();
  } catch(e){ console.error('Review:', e.message); }
}

// ─── PLANIFIER (délégué au solveur) ───
async function planWeek(targetMonday){ return (await optimize({days:7})).created; }
async function planTwoWeeks(){ const r=await optimize({days:config.horizon_days||14}); await weeklyReview(); return r.created; }

// ─── DÉTECTION CHANGEMENTS + REPLAN ───
async function detectCalendarChanges() {
  if (!tokens) return;
  try {
    const now=new Date(), tw=new Date(now.getTime()+14*86400000);
    const events = await getEvents(now.toISOString(), tw.toISOString());
    const userEvents = events.filter(e=>!isManaged(e));
    const hash = buildEventsHash(userEvents);
    if (hash !== lastCalendarHash && lastCalendarHash !== '') {
      if (replanDebounce) clearTimeout(replanDebounce);
      replanDebounce = setTimeout(async()=>{ await smartReplan(); replanDebounce=null; }, 30000);
    }
    lastCalendarHash = hash;
  } catch(e){}
}

async function smartReplan(){ if(!tokens) return;
  // En mode aperçu, on n'écrit jamais en arrière-plan sans confirmation : on ne fait rien
  // (l'utilisateur réorganise via « Optimiser » ou l'assistant, qui proposent un aperçu).
  if(config.preview_mode!==false) return;
  await optimize({days:config.horizon_days||14});
}

// ─── SCHEDULER (déclencheurs temporels) ───
function startScheduler() {
  setInterval(async()=>{
    if (!tokens) return;
    const now=new Date(), h=now.getHours(), m=now.getMinutes(), d=now.getDay();
    if (h===7 && m===0 && config.auto_schedule){ const t=new Date(); t.setDate(t.getDate()+1); await autoTimeBlock(t); }
    if (d===0 && h===20 && m===0) await planTwoWeeks();
    if (d===0 && h===20 && m===30) await weeklyReview();
  }, 60000);
  setInterval(detectCalendarChanges, 5*60*1000);
  setTimeout(async()=>{ if (tokens){ try{
    const now=new Date(), tw=new Date(now.getTime()+14*86400000);
    const events = await getEvents(now.toISOString(), tw.toISOString());
    lastCalendarHash = buildEventsHash(events.filter(e=>!isManaged(e)));
  }catch{} } }, 10000);
}
if (!process.env.TF_NO_LISTEN) startScheduler();

// ─── HTTP ───
function cors(res){ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type'); }
function j(res,data,status=200){ cors(res); res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(data)); }
function h(res,content){ cors(res); res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(content); }
function body(req){ return new Promise(r=>{ let b=''; req.on('data',d=>b+=d); req.on('end',()=>{ try{r(JSON.parse(b));}catch{r({});} }); }); }

const LOGIN_PAGE = creds => `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TimeFlow</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue","Segoe UI",system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f;display:flex;align-items:center;justify-content:center;height:100vh;-webkit-font-smoothing:antialiased}
.c{background:#fff;border-radius:16px;padding:44px 40px;width:380px;text-align:center;border:1px solid #e6e6e9;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.logo{width:56px;height:56px;border-radius:14px;background:#1d1d1f;color:#fff;margin:0 auto 22px;display:flex;align-items:center;justify-content:center}
h1{font-size:24px;font-weight:600;letter-spacing:-.02em;margin-bottom:8px}p{color:#86868b;font-size:14px;margin-bottom:28px;line-height:1.5}
.gbtn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:13px;background:#fff;border:1px solid #d2d2d7;border-radius:10px;color:#1d1d1f;font-size:15px;cursor:pointer;font-weight:500;text-decoration:none;transition:.15s ease}.gbtn:hover{background:#f5f5f7;border-color:#b8b8be}
.or{margin:18px 0 12px;color:#aeaeb2;font-size:12px}.link{color:#0071e3;font-size:13px;cursor:pointer;background:none;border:none}
.hint{margin-top:16px;color:#aeaeb2;font-size:12px;line-height:1.5}.adv-toggle{display:inline-block;margin-top:18px;color:#86868b;font-size:12.5px}.adv-toggle:hover{color:#0071e3}
input{width:100%;padding:11px 13px;background:#f5f5f7;border:1px solid #d2d2d7;border-radius:10px;color:#1d1d1f;font-size:13px;margin-bottom:9px;font-family:ui-monospace,monospace}input:focus{outline:none;border-color:#0071e3;background:#fff;box-shadow:0 0 0 3px rgba(0,113,227,.12)}
.sbtn{width:100%;padding:12px;background:#0071e3;border:none;border-radius:10px;color:#fff;font-size:15px;cursor:pointer;font-weight:500;transition:background .15s ease}.sbtn:hover{background:#0064c8}</style></head>
<body><div class="c"><div class="logo"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg></div><h1>TimeFlow</h1>
${creds
  ? `<p>Connecte ton agenda Google et laisse TimeFlow organiser ta semaine automatiquement.</p><a class="gbtn" href="/auth"><svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>Continuer avec Google</a>
  <div class="hint">TimeFlow accède uniquement à ton Google Agenda et fonctionne en local sur ton ordinateur.</div>
  <button class="link adv-toggle" onclick="document.getElementById('adv').style.display='block';this.style.display='none'">Utiliser d'autres identifiants Google</button>
  <div id="adv" style="display:none;margin-top:14px;text-align:left"><input id="cid" placeholder="Client ID"><input id="cs" type="password" placeholder="Client Secret"><button class="sbtn" onclick="save()">Enregistrer et connecter</button></div>`
  : `<p>Pour démarrer, renseigne les identifiants OAuth de ton projet Google Cloud (API Calendar activée).</p><div style="text-align:left"><input id="cid" placeholder="Client ID (…apps.googleusercontent.com)"><input id="cs" type="password" placeholder="Client Secret (GOCSPX-…)"><button class="sbtn" onclick="save()">Connecter</button></div><div class="hint">Astuce : renseigne ces identifiants dans server.js pour afficher directement le bouton « Continuer avec Google ».</div>`}
</div><script>function save(){fetch('/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:document.getElementById('cid').value,client_secret:document.getElementById('cs').value})}).then(r=>r.json()).then(d=>location.href=d.auth_url);}</script></body></html>`;

// ─── App installable (PWA) : icône + manifeste + service worker ───
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#5b34e6"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><g fill="none" stroke="#ffffff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"><rect x="120" y="140" width="272" height="240" rx="34"/><path d="M120 206 H392"/><path d="M196 140 V108 M316 140 V108"/><path d="M210 290 l32 32 62 -78"/></g></svg>`;
const MANIFEST = JSON.stringify({
  name:'TimeFlow — Agenda intelligent', short_name:'TimeFlow',
  description:'Votre agenda intelligent piloté par IA, en local.',
  start_url:'/app', scope:'/', display:'standalone', orientation:'any',
  background_color:'#0e0f13', theme_color:'#7c5cff', lang:'fr',
  icons:[{ src:'/icon.svg', sizes:'any', type:'image/svg+xml', purpose:'any maskable' }]
});
// Service worker « réseau d'abord » : l'app est installable + démarre hors-ligne, MAIS jamais de contenu périmé (online = toujours frais ; les /api ne sont jamais mises en cache).
const SW_JS = `const C='timeflow-shell-v1';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch',e=>{ const u=new URL(e.request.url); if(e.request.method!=='GET'||u.pathname.startsWith('/api')) return; e.respondWith(fetch(e.request).then(r=>{ try{ const cp=r.clone(); caches.open(C).then(c=>c.put(e.request,cp)); }catch(_){ } return r; }).catch(()=>caches.match(e.request))); });`;

const server = http.createServer(async(req,res)=>{
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method==='OPTIONS'){ cors(res); res.writeHead(204); res.end(); return; }

  // App installable (PWA) — accessibles même non connecté
  if (url.pathname==='/manifest.webmanifest'){ cors(res); res.writeHead(200,{'Content-Type':'application/manifest+json; charset=utf-8'}); res.end(MANIFEST); return; }
  if (url.pathname==='/icon.svg'){ cors(res); res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public, max-age=604800'}); res.end(ICON_SVG); return; }
  if (url.pathname==='/sw.js'){ cors(res); res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Service-Worker-Allowed':'/'}); res.end(SW_JS); return; }

  if (url.pathname==='/auth'){ if (hasCreds()){ res.writeHead(302,{Location:getAuthUrl()}); res.end(); } else { res.writeHead(302,{Location:'/'}); res.end(); } return; }

  if (url.pathname==='/' && !tokens){ h(res, LOGIN_PAGE(hasCreds())); return; }

  if (url.pathname==='/setup' && req.method==='POST'){
    const b = await body(req); config.client_id=b.client_id; config.client_secret=b.client_secret; saveConfig();
    j(res,{auth_url:getAuthUrl()}); return;
  }

  if (url.pathname==='/oauth/callback'){
    const code = url.searchParams.get('code');
    try {
      const t = await oauthPost({ code, client_id:clientId(), client_secret:clientSecret(), redirect_uri:REDIRECT_URI, grant_type:'authorization_code' });
      if (!t.access_token) throw new Error(t.error_description||'Échec OAuth');
      tokens = {...t, expiry_date:Date.now()+(t.expires_in*1000)}; fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens));
      h(res, `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue","Segoe UI",system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;-webkit-font-smoothing:antialiased}.card{background:#fff;border:1px solid #e6e6e9;border-radius:16px;padding:40px 44px;box-shadow:0 1px 3px rgba(0,0,0,.04)}.ok{width:52px;height:52px;border-radius:50%;background:#34c759;color:#fff;margin:0 auto 18px;display:flex;align-items:center;justify-content:center}h2{font-weight:600;font-size:20px;letter-spacing:-.02em;margin:0 0 6px}p{color:#6e6e73;font-size:14px;margin:0}a{color:#0071e3;text-decoration:none}</style></head><body><div class="card"><div class="ok"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4 10-10.5"/></svg></div><h2>Google Calendar connecté</h2><p>Ouverture de <a href="http://localhost:${PORT}/app">l'application</a>…</p></div><script>setTimeout(()=>location.href='/app',1200)</script></body></html>`);
    } catch(e){ j(res,{error:e.message},500); }
    return;
  }

  if (url.pathname==='/app' || (url.pathname==='/' && tokens)){
    const ap = path.join(__dirname,'app.html');
    if (fs.existsSync(ap)) h(res, fs.readFileSync(ap,'utf8')); else j(res,{error:'app.html introuvable'},404);
    return;
  }

  // ── API ──
  if (url.pathname==='/api/status'){ j(res,{authenticated:!!tokens, config}); return; }
  if (url.pathname==='/api/config' && req.method==='POST'){ const b=await body(req);
      const NEST=['profile','working_hours','personal_hours','meeting_hours','buffers','colors','task_defaults','notif'];
      for(const k of NEST) if(b[k] && typeof b[k]==='object') b[k]={...config[k],...b[k]};
      config={...config,...b}; saveConfig(); j(res,{success:true,config}); return; }
  if (url.pathname==='/api/logout' && req.method==='POST'){ tokens=null; if(fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE); j(res,{success:true}); return; }

  // Compte Google connecté (email + nom via l'agenda principal)
  if (url.pathname==='/api/me'){
    if(!tokens){ j(res,{connected:false}); return; }
    try{ const r=await calReq('GET','/calendar/v3/calendars/primary');
      const list=await calReq('GET','/calendar/v3/users/me/calendarList');
      const cals=(list.data.items||[]).map(c=>({id:c.id,summary:c.summary,primary:!!c.primary,role:c.accessRole}));
      j(res,{connected:true, email:r.data.id, name:r.data.summary, timezone:r.data.timeZone, calendars:cals}); }
    catch(e){ j(res,{connected:true, error:e.message}); } return;
  }
  // Test connexion Ollama
  if (url.pathname==='/api/ollama/test' || url.pathname==='/api/ai/test'){
    // Cloud (compatible OpenAI) → petit appel de vérification
    if(config.ai_provider==='openai'){
      try{ const r=await openaiCall([{role:'user',content:'ping'}], false);
        j(res,{ ok:true, message:'IA cloud opérationnelle ('+(config.model||'?')+')' }); }
      catch(e){ j(res,{ ok:false, error:'Cloud injoignable : '+e.message+' (vérifiez l\'URL et la clé API)' }); }
      return;
    }
    // Local (Ollama) → liste les modèles installés
    try{ const u=new URL(config.ollama_url||'http://127.0.0.1:11434'); const lib=u.protocol==='https:'?https:http;
      const tags=await new Promise((resolve,reject)=>{ const rq=lib.request({hostname:u.hostname,port:u.port||(u.protocol==='https:'?443:11434),path:'/api/tags',method:'GET'},rs=>{let d='';rs.on('data',c=>d+=c);rs.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}})}); rq.on('error',reject); rq.setTimeout(2500,()=>{rq.destroy(new Error('timeout'))}); rq.end(); });
      const models=(tags.models||[]).map(m=>m.name);
      j(res,{ok:true, message:'Ollama répond', models, hasModel:models.some(m=>m.startsWith((config.model||'').split(':')[0]))}); }
    catch(e){ j(res,{ok:false, error:'Ollama injoignable ('+e.message+'). Lancez « ollama serve ».'}); } return;
  }
  // Export / Import / Reset des données
  if (url.pathname==='/api/export'){ j(res,{ exportedAt:new Date().toISOString(), config, habits, tasks, memory }); return; }
  if (url.pathname==='/api/import' && req.method==='POST'){ const b=await body(req);
      if(Array.isArray(b.habits)){ const seen=new Set(); habits=b.habits.map(sanitizeHabit).filter(h=>{ const k=_norm(h.name)+'|'+(h.idealTime||'')+'|'+normPrio(h.priority); if(!_norm(h.name)||seen.has(k)) return false; seen.add(k); return true; }); saveHabits(); }
      if(Array.isArray(b.tasks)){ const seen=new Set(); tasks=b.tasks.map(sanitizeTask).filter(t=>{ const k=_norm(t.title)+'|'+(t.deadline||''); if(!_norm(t.title)||seen.has(k)) return false; seen.add(k); return true; }); saveTasks(); }
      if(b.memory && typeof b.memory==='object'){ memory={...DEFAULT_MEMORY,...b.memory}; saveMemory(); }
      if(b.config && typeof b.config==='object'){ const c={...b.config}; delete c.client_id; delete c.client_secret; config={...config,...c}; saveConfig(); }
      j(res,{success:true, habits:habits.length, tasks:tasks.length}); return; }
  if (url.pathname==='/api/reset' && req.method==='POST'){ const b=await body(req);
      if(b.habits!==false){ habits=[]; saveHabits(); }
      if(b.tasks!==false){ tasks=[]; saveTasks(); }
      if(b.memory){ memory={...DEFAULT_MEMORY}; saveMemory(); }
      j(res,{success:true}); return; }

  if (url.pathname==='/api/events' && req.method==='GET'){
    try { const items = await getEvents(url.searchParams.get('timeMin'), url.searchParams.get('timeMax'));
      j(res, items.map(e=>({id:e.id,title:e.summary||'Sans titre',start:e.start?.dateTime||e.start?.date,end:e.end?.dateTime||e.end?.date,colorId:e.colorId,allDay:!e.start?.dateTime,managed:isManaged(e),locked:isLocked(e),kind:tfKindOf(e)}))); }
    catch(e){ j(res,{error:e.message},500); } return;
  }
  if (url.pathname==='/api/events' && req.method==='POST'){ try{ const b=await body(req);
      if(b.start && b.end && !b.allDay){ const t0=new Date(b.start); t0.setHours(0,0,0,0); const t1=new Date(t0); t1.setDate(t0.getDate()+1);
        let evs=[]; try{ evs=await getEvents(t0.toISOString(), t1.toISOString()); }catch(_){}
        const slot=placeNoOverlap(b.start, b.end, evs, null); b.start=slot.start; b.end=slot.end; }
      const ev=await createEvent(b); if(b.lock&&ev.id){ locks.add(ev.id); saveLocks(); } j(res,{id:ev.id,title:ev.summary}); }catch(e){ j(res,{error:e.message},500); } return; }
  if (url.pathname.startsWith('/api/events/') && req.method==='PATCH'){ try{ const id=url.pathname.split('/')[3]; const b=await body(req);
      const ev=await updateEvent(id,b);
      if(b.lock){ locks.add(id); saveLocks(); } if(b.unlock){ locks.delete(id); saveLocks(); }
      j(res,{id:ev.id,title:ev.summary,locked:locks.has(id)}); }catch(e){ j(res,{error:e.message},500); } return; }
  if (url.pathname.startsWith('/api/events/') && req.method==='DELETE'){ try{ const id=url.pathname.split('/')[3]; await deleteEvent(id);
      if(locks.has(id)){ locks.delete(id); saveLocks(); }
      let changed=false; tasks.forEach(t=>{ if((t.eventIds||[t.eventId]).includes(id)){ t.eventIds=(t.eventIds||[]).filter(x=>x!==id); if(!t.eventIds.length){ t.scheduled=false; t.eventId=null; } changed=true; } }); if(changed) saveTasks();
      j(res,{success:true}); }catch(e){ j(res,{error:e.message},500); } return; }

  if (url.pathname==='/api/chat' && req.method==='POST'){
    try { const b=await body(req);
      const events = await getEvents(new Date().toISOString(), new Date(Date.now()+7*86400000).toISOString());
      j(res, await processChat(b.message||'', b.history||[], events)); }
    catch(e){ j(res,{error:e.message, response:'Désolé, une erreur est survenue (Ollama est-il lancé ?).'},500); } return;
  }

  if (url.pathname==='/api/memory' && req.method==='GET'){ j(res,memory); return; }
  if (url.pathname==='/api/memory' && req.method==='POST'){
    const b=await body(req); const type=b.type, text=b.text?.trim();
    if (type && text && memory[type]){ if(!memory[type].find(x=>x.text===text)) memory[type].push({id:Date.now()+'',text,addedAt:new Date().toISOString()}); saveMemory(); }
    j(res,memory); return;
  }
  if (url.pathname.startsWith('/api/memory/') && req.method==='DELETE'){
    const p=url.pathname.split('/'); const type=p[3], id=p[4];
    if (memory[type]){ memory[type]=memory[type].filter(x=>x.id!==id); saveMemory(); } j(res,memory); return;
  }

  if (url.pathname==='/api/freeSlots'){
    try { const date=url.searchParams.get('date')?new Date(url.searchParams.get('date')):new Date();
      const de=new Date(date); de.setHours(23,59,0,0);
      const evs=await getEvents(date.toISOString(),de.toISOString());
      const slots=getFreeSlots(evs,date,config.work_start,config.work_end,30);
      j(res,slots.map(s=>({start:s.start.toISOString(),end:s.end.toISOString(),duration:s.duration}))); }
    catch(e){ j(res,{error:e.message},500); } return;
  }

  if (url.pathname==='/api/habits' && req.method==='GET'){ j(res,habits); return; }
  if (url.pathname==='/api/habits' && req.method==='POST'){ const b=await body(req);
      const dup=findDupHabit(b); if(dup){ j(res,dup); return; }   // anti double-soumission (idempotent)
      // NB : on ne planifie PAS ici — le client déclenche l'aperçu/reflow (afterManualChange).
      const ha=sanitizeHabit({id:Date.now()+'',active:true,...b}); habits.push(ha); saveHabits(); j(res,ha); return; }
  if (url.pathname.startsWith('/api/habits/') && req.method==='DELETE'){ const id=url.pathname.split('/')[3]; habits=habits.filter(x=>x.id!==id); saveHabits(); j(res,{success:true}); return; }
  if (url.pathname.startsWith('/api/habits/') && req.method==='PATCH'){ const id=url.pathname.split('/')[3]; const b=await body(req); habits=habits.map(x=>x.id===id?sanitizeHabit({...x,...b}):x); saveHabits(); j(res,{success:true}); return; }

  if (url.pathname==='/api/tasks' && req.method==='GET'){ j(res,tasks); return; }
  if (url.pathname==='/api/tasks' && req.method==='POST'){ const b=await body(req);
      const dup=findDupTask(b); if(dup){ j(res,dup); return; }     // anti double-soumission (idempotent)
      // NB : on ne planifie PAS ici — le client déclenche l'aperçu/reflow (afterManualChange).
      const ta=sanitizeTask({id:Date.now()+'',active:true,scheduled:false,...b}); tasks.push(ta); saveTasks(); j(res,ta); return; }
  if (url.pathname.startsWith('/api/tasks/') && req.method==='DELETE'){ const id=url.pathname.split('/')[3]; tasks=tasks.filter(x=>x.id!==id); saveTasks(); j(res,{success:true}); return; }
  if (url.pathname.startsWith('/api/tasks/') && req.method==='PATCH'){ const id=url.pathname.split('/')[3]; const b=await body(req); tasks=tasks.map(x=>x.id===id?sanitizeTask({...x,...b}):x); saveTasks(); j(res,{success:true}); return; }

  if (url.pathname==='/api/stats'){ j(res,stats); return; }

  if (url.pathname==='/api/run/optimize' && req.method==='POST'){ const b=await body(req); const r=await optimize({days:b.days||config.horizon_days||14}); await weeklyReview(); j(res,{success:!r.error,created:r.created,error:r.error,risks:r.risks||[]}); return; }
  if (url.pathname==='/api/run/timeblock' && req.method==='POST'){ const t=new Date(); t.setDate(t.getDate()+1); const n=await autoTimeBlock(t); j(res,{success:true,created:n}); return; }
  if (url.pathname==='/api/run/habits'   && req.method==='POST'){ const n=await scheduleHabits(); j(res,{success:true,created:n}); return; }
  if (url.pathname==='/api/run/tasks'    && req.method==='POST'){ const n=await scheduleTasks();  j(res,{success:true,created:n}); return; }
  if (url.pathname==='/api/run/buffers'  && req.method==='POST'){ const n=await addBuffers();     j(res,{success:true,created:n}); return; }
  if (url.pathname==='/api/run/review'   && req.method==='POST'){ await weeklyReview(); j(res,stats); return; }
  if (url.pathname==='/api/run/planweek' && req.method==='POST'){ const n=await planTwoWeeks(); j(res,{success:true,created:n}); return; }
  if (url.pathname==='/api/run/replan'   && req.method==='POST'){ await smartReplan(); j(res,{success:true}); return; }

  // ── APERÇU (mode preview type Reclaim : on stage le diff, l'utilisateur confirme) ──
  if (url.pathname==='/api/plan' && req.method==='GET'){ j(res,{ plan: publicPlan(pendingPlan) }); return; }
  if (url.pathname==='/api/plan/preview' && req.method==='POST'){ const b=await body(req);
      // onlyItem (optionnel) = ne (re)planifier QUE cet élément (ajout d'une seule habitude/tâche)
      const r=await optimize({days:b.days||config.horizon_days||14, preview:true, onlyItem:(b.onlyItem&&b.onlyItem.id)?b.onlyItem:null});
      j(res,{ success:!r.error, error:r.error, plan:r.plan||null, risks:r.risks||[] }); return; }
  if (url.pathname==='/api/plan/apply' && req.method==='POST'){
      if(!pendingPlan){ j(res,{success:false, error:'aucun aperçu en attente'}); return; }
      const r=await applyPlan(pendingPlan); await weeklyReview(); j(res,{ success:!!r.applied, ...r }); return; }
  if (url.pathname==='/api/plan/discard' && req.method==='POST'){ pendingPlan=null; j(res,{success:true}); return; }
  if (url.pathname==='/api/plan/remove' && req.method==='POST'){ const b=await body(req);
      if(pendingPlan){
        if(b.createIdx!=null) pendingPlan.creates=pendingPlan.creates.filter(c=>c.idx!==b.createIdx);
        if(b.deleteId)        pendingPlan.deletes=pendingPlan.deletes.filter(d=>d.id!==b.deleteId);
      }
      j(res,{ success:true, plan:publicPlan(pendingPlan) }); return; }

  res.writeHead(404); res.end('Not found');
});

if (!process.env.TF_NO_LISTEN) server.listen(PORT,()=>{
  console.log(`\n⚡ TimeFlow → http://localhost:${PORT}/app`);
  if (!tokens) console.log(`⚠️  Configuration → http://localhost:${PORT}`);
  else console.log(`✅ Google Calendar connecté · Planificateur actif`);
  console.log(`📅 Planning auto : dimanche 20h (2 semaines à l'avance)`);
  console.log(`🔄 Détection des changements : toutes les 5 minutes\n`);
});

// Porte de test : `TF_NO_LISTEN=1 node -e "require('./server').parseFrCommand(...)"`
// (n'ouvre pas le port, n'arme pas les minuteries — sert aux tests unitaires du parseur).
if (process.env.TF_NO_LISTEN) module.exports = { parseFrCommand, frDate, frDuration, frTimes, frPriority, cleanName, sanitizeHabit, sanitizeTask, findDupHabit, findDupTask, normPrio, isManaged, inferWindow, placeNoOverlap, placeHabit, placeTask, orderTasks, freeIn, optimize, publicPlan, processChat, config, _setPrev:(m)=>{ _prevSlots=m; } };
