'use strict';
// The new project is configured separately. No old project credentials are used.
const config = window.PRSN_CONFIG || {};
const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
let db = null;
let startupError = '';
if (configured) {
  try {
    if (!window.supabase) throw Error('Supabase could not load. Check your internet and refresh.');
    db = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  } catch (error) { startupError = error.message; }
}
const preview = !configured;
function requireBackend() {
  if (!db) throw Error(startupError || 'Design preview only. Connect the new Supabase project in config.js to share and chat.');
}
const $ = id => document.getElementById(id);
const subjects = ['Mathematics','Science','English','Hindi','Social Science','Sanskrit','General'];
const types = {prep:'Test preparation',homework:'Homework',resource:'Resource'};
let uid, userName, view = 'all', posts = [], limit = 30, request = 0;
let chatChannel, boardChannel, chatGeneration = 0, messages = new Map(), loadingOlder = false;
let toastTimer, pollTimer, searchTimer;
const mime = {'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'};
function node(tag, text, cls) { const el=document.createElement(tag); if(text!==undefined) el.textContent=text; if(cls) el.className=cls; return el; }
function fail(error) { return error?.message || 'Connection failed. Please try again.'; }
function toast(text) { $('toast').textContent=text; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,4500); }
function checked(result) { if(result.error) throw result.error; return result.data; }
async function busy(form, output, action) { const buttons=[...form.querySelectorAll('button')]; buttons.forEach(b=>b.disabled=true); output.textContent=''; try { await action(); } catch(e) { output.textContent=fail(e); } finally { buttons.forEach(b=>b.disabled=false); } }
function dateText(date) { return new Date(date).toLocaleDateString('en-IN',{day:'numeric',month:'short'}); }
subjects.forEach(subject=>{ $('subject').add(new Option(subject,subject)); $('filterSubject').add(new Option(subject,subject)); });
$('today').textContent = new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'long'});
try { $('name').value=localStorage.getItem('prsn-crimson-name') || ''; } catch {}
$('year').textContent = new Date().getFullYear();
if(startupError) $('loginError').textContent=startupError;
if(preview) $('loginError').textContent='Design preview — enter a name to explore.';
$('loginForm').addEventListener('submit', event=>{ event.preventDefault(); busy(event.currentTarget,$('loginError'),async()=>{
  const name=$('name').value.trim();
  if(name.length<2 || name.length>20) throw Error('Use a name between 2 and 20 characters.');
  if(!preview) {
    requireBackend();
    let session=checked(await db.auth.getSession()).session;
    if(!session) session=checked(await db.auth.signInAnonymously()).session;
    uid=session.user.id;
  }
  userName=name;
  try { localStorage.setItem('prsn-crimson-name',name); } catch {}
  $('userName').textContent=userName; $('avatar').textContent=userName[0].toUpperCase();
  $('login').hidden=true; $('app').hidden=false; $('previewNotice').hidden=!preview;
  await loadPosts();
  if(!preview) {
    startBoard(); await loadUpcoming();
    clearInterval(pollTimer);
    pollTimer=setInterval(()=>{
      if(document.hidden) return;
      loadPosts(); loadUpcoming();
      if($('chatDialog').open) loadRecent(chatGeneration);
    },20000);
  }

}); });
$('exit').onclick=()=>location.reload();
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{
  view=button.dataset.view; limit=30;
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));
  $('heading').textContent=view==='all'?'The shared desk.':types[view];
  $('boardTitle').textContent=view==='all'?'The shared board':types[view]; loadPosts();
});
$('filterSubject').onchange=()=>{limit=30;loadPosts();};
$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{limit=30;loadPosts();},250);};
$('refresh').onclick=()=>{loadPosts();loadUpcoming();}; $('morePosts').onclick=()=>{limit+=30;loadPosts();};
async function loadPosts() {
  if(preview) {
    posts=[]; renderPosts();
    $('boardStatus').textContent='Preview only · No posts or personal data are loaded.';
    $('morePosts').hidden=true;
    return;
  }
  const ticket=++request; $('boardStatus').textContent='Loading shared posts…';
  try {
    let query=db.from('prsn_study_posts').select('*').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(limit+1);
    if(view!=='all') query=query.eq('kind',view);
    if($('filterSubject').value) query=query.eq('subject',$('filterSubject').value);
    const term=$('search').value.trim(); if(term) query=query.ilike('title','%'+term.replace(/[\\%_]/g,'\\$&')+'%');
    const data=checked(await query); if(ticket!==request) return;
    posts=data.slice(0,limit); $('morePosts').hidden=data.length<=limit; renderPosts(); $('boardStatus').textContent='';
    const results=await Promise.all([
      db.from('prsn_study_posts').select('id',{count:'exact',head:true}).eq('kind','prep'),
      db.from('prsn_study_posts').select('id',{count:'exact',head:true}).eq('kind','homework'),
      db.from('prsn_study_posts').select('id',{count:'exact',head:true}).not('file_path','is',null)
    ]);
    if(ticket!==request) return;
    results.forEach((r,i)=>{ $(['prepCount','hwCount','fileCount'][i]).textContent=r.error?'—':r.count; });
  } catch(e) { if(ticket===request) $('boardStatus').textContent='Could not load the board: '+fail(e); }
}
function fileActions(row,bucket) {
  const wrap=node('div',undefined,'file-actions');
  for(const download of [false,true]) {
    const button=node('button',download?'↓ Download':'↗ '+(row.file_name || 'Open file'));
    button.type='button'; button.onclick=async()=>{ button.disabled=true; try {
      // Fresh URLs on each click: old tabs do not retain expired links.
      const data=checked(await db.storage.from(bucket).createSignedUrl(row.file_path,300,download?{download:row.file_name || true}:{}));
      const link=node('a'); link.href=data.signedUrl; link.target='_blank'; link.rel='noopener noreferrer'; document.body.append(link); link.click(); link.remove();
    } catch(e) {toast(fail(e));} finally {button.disabled=false;} }; wrap.append(button);
  } return wrap;
}
function renderPosts() {
  $('posts').replaceChildren();
  if(!posts.length) { $('posts').append(node('div','Nothing here yet. Share the first note, homework or PDF.','empty')); return; }
  posts.forEach(post=>{
    const card=node('article',undefined,'post'), top=node('div',undefined,'post-top');
    top.append(node('span',types[post.kind],'tag'),node('span',post.subject,'subject-tag'));
    card.append(top,node('h3',post.title)); if(post.body) card.append(node('p',post.body));
    if(post.due_date) card.append(node('span','📅 '+dateText(post.due_date+'T12:00:00'),'due'));
    if(post.file_path) card.append(fileActions(post,'prsn-study-files'));
    const bottom=node('div',undefined,'post-bottom'); bottom.append(node('span',post.author_name+' · '+dateText(post.created_at)));
    if(post.author_id===uid) { const del=node('button','Delete','delete'); del.onclick=()=>deleteRow(post,'prsn_study_posts','prsn-study-files',loadPosts); bottom.append(del); }
    card.append(bottom); $('posts').append(card);
  });
}
async function deleteRow(row,table,bucket,after) {
  if(!confirm('Delete your '+(table==='prsn_chat_messages'?'message':'post')+'?')) return;
  try { checked(await db.from(table).delete().eq('id',row.id));
    if(row.file_path) {const cleanup=await db.storage.from(bucket).remove([row.file_path]); if(cleanup.error) toast('Post deleted; attached file cleanup failed.');}
    await after();
  } catch(e) {toast(fail(e));}
}
function startBoard() {
  if(boardChannel) db.removeChannel(boardChannel);
  boardChannel=db.channel('prsn-study-board').on('postgres_changes',{event:'*',schema:'public',table:'prsn_study_posts'},()=>{loadPosts();loadUpcoming();}).subscribe();
}
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('addTop').onclick=()=>{ $('postForm').reset(); $('kind').value=view==='all'?'prep':view; $('postError').textContent=''; $('postDialog').showModal(); };
function validateFile(file) { if(!file) return; if(!mime[file.type]) throw Error('Choose a PDF, JPG, PNG, WebP or GIF.'); if(file.size>10*1024*1024) throw Error('File must be 10 MB or smaller.'); }
async function upload(file,bucket) {
  if(!file) return {};
  validateFile(file); const path=uid+'/'+crypto.randomUUID()+'.'+mime[file.type];
  checked(await db.storage.from(bucket).upload(path,file,{contentType:file.type,upsert:false}));
  return {file_path:path,file_name:file.name.slice(0,180),file_type:file.type};
}
async function insertWithFile(table,bucket,payload,file) {
  requireBackend();
  const attachment=await upload(file,bucket);
  try { return checked(await db.from(table).insert({...payload,...attachment}).select().single()); }
  catch(e) { if(attachment.file_path) await db.storage.from(bucket).remove([attachment.file_path]); throw e; }
}
$('postForm').onsubmit=event=>{event.preventDefault();busy(event.currentTarget,$('postError'),async()=>{
  const title=$('title').value.trim(); if(!title) throw Error('Add a title first.');
  await insertWithFile('prsn_study_posts','prsn-study-files',{author_id:uid,author_name:userName,kind:$('kind').value,subject:$('subject').value,title,body:$('body').value.trim(),due_date:$('due').value || null},$('attachment').files[0]);
  $('postDialog').close(); toast('Shared with the squad!'); await loadPosts(); await loadUpcoming();
});};
$('chatBtn').onclick=()=>{$('codeForm').reset();$('codeError').textContent='';$('codeDialog').showModal();};
$('codeForm').onsubmit=event=>{event.preventDefault();busy(event.currentTarget,$('codeError'),async()=>{
  requireBackend();
  const unlocked=checked(await db.rpc('prsn_unlock_chat',{codeword:$('code').value.trim()}));
  if(!unlocked) throw Error('Wrong codeword. Try again.');
  $('codeDialog').close(); $('code').value=''; await openChat();
});};
async function openChat() {
  const generation=++chatGeneration; messages.clear(); $('messages').replaceChildren(); $('chatError').textContent=''; $('older').hidden=false;
  $('chatDialog').showModal(); $('connection').textContent='Connecting…';
  chatChannel=db.channel('prsn-community-'+generation).on('postgres_changes',{event:'*',schema:'public',table:'prsn_chat_messages'},payload=>{
    if(generation!==chatGeneration) return;
    if(payload.eventType==='DELETE') messages.delete(payload.old.id); else messages.set(payload.new.id,payload.new);
    renderMessages(false);
  }).subscribe(status=>{
    if(generation!==chatGeneration) return;
    $('connection').textContent=status==='SUBSCRIBED'?'Live · connected':'Reconnecting · checking messages every 20s';
    if(status==='SUBSCRIBED') loadRecent(generation);
  });
  await loadRecent(generation,true); $('message').focus();
}
async function loadRecent(generation,initial=false) {
  try {
    const rows=checked(await db.from('prsn_chat_messages').select('*').order('id',{ascending:false}).limit(50));
    if(generation!==chatGeneration || !$('chatDialog').open) return;
    // Reconcile recent deletions while preserving already-loaded older history.
    const newestIds=new Set(rows.map(r=>r.id)), min=rows.length?Math.min(...rows.map(r=>r.id)):Infinity;
    for(const id of messages.keys()) if(id>=min && !newestIds.has(id)) messages.delete(id);
    if(!rows.length) messages.clear();
    rows.forEach(row=>messages.set(row.id,row)); renderMessages(initial); $('chatError').textContent='';
    if(initial) $('older').hidden=rows.length<50;
  } catch(e) {if(generation===chatGeneration) $('chatError').textContent='Chat could not load: '+fail(e);}
}
function renderMessages(forceBottom=false) {
  const box=$('messages'), nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<100, oldTop=box.scrollTop;
  box.replaceChildren();
  const sorted=[...messages.values()].sort((a,b)=>a.id-b.id);
  if(!sorted.length) box.append(node('div','The chat is ready. Say hello to your squad.','empty'));
  sorted.forEach(row=>{
    const card=node('article',undefined,'message'+(row.author_id===uid?' mine':''));
    card.append(node('b',row.author_name)); if(row.body) card.append(node('p',row.body));
    if(row.file_path) card.append(fileActions(row,'prsn-chat-files'));
    card.append(node('small',dateText(row.created_at)+' · '+new Date(row.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})));
    if(row.author_id===uid) {const del=node('button','Delete','delete'); del.onclick=()=>deleteRow(row,'prsn_chat_messages','prsn-chat-files',()=>{messages.delete(row.id);renderMessages();});card.append(del);}
    box.append(card);
  });
  box.scrollTop=(forceBottom || nearBottom)?box.scrollHeight:oldTop;
}
$('older').onclick=async()=>{
  if(loadingOlder || !messages.size) return; loadingOlder=true; $('older').disabled=true;
  const generation=chatGeneration, box=$('messages'), before=box.scrollHeight, top=box.scrollTop;
  try { const rows=checked(await db.from('prsn_chat_messages').select('*').lt('id',Math.min(...messages.keys())).order('id',{ascending:false}).limit(50));
    if(generation!==chatGeneration) return;
    rows.forEach(row=>messages.set(row.id,row)); renderMessages(); box.scrollTop=top+box.scrollHeight-before; $('older').hidden=rows.length<50;
  } catch(e) {$('chatError').textContent=fail(e);} finally {loadingOlder=false;$('older').disabled=false;}
};
$('chatFile').onchange=()=>{$('selectedFile').textContent=$('chatFile').files[0]?.name || '';};
$('messageForm').onsubmit=event=>{event.preventDefault();busy(event.currentTarget,$('chatError'),async()=>{
  const body=$('message').value.trim(), file=$('chatFile').files[0]; if(!body && !file) return;
  const row=await insertWithFile('prsn_chat_messages','prsn-chat-files',{author_id:uid,author_name:userName,body},file);
  messages.set(row.id,row); renderMessages(true); $('message').value='';$('chatFile').value='';$('selectedFile').textContent='';$('message').focus();
});};
$('closeChat').onclick=()=>$('chatDialog').close();
$('chatDialog').addEventListener('close',()=>{chatGeneration++;if(chatChannel)db.removeChannel(chatChannel);chatChannel=null;});

// The schedule comes from real dated posts; there are no invented tests.
async function loadUpcoming() {
  if(preview) return;
  try {
    const now=new Date();
    const localToday=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
    const rows=checked(await db.from('prsn_study_posts').select('id,title,subject,kind,due_date')
      .in('kind',['prep','homework']).gte('due_date',localToday).order('due_date',{ascending:true}).limit(5));
    $('upcomingList').replaceChildren();
    if(!rows.length) $('upcomingList').append(node('p','Nothing scheduled yet. Add a date when you share a post.','muted'));
    rows.forEach(row=>{
      const item=node('div',undefined,'upcoming-item');
      item.append(node('b',row.title),node('small',dateText(row.due_date+'T12:00:00')+' · '+row.subject));
      $('upcomingList').append(item);
    });
  } catch(e) { $('upcomingList').replaceChildren(node('p','Schedule unavailable. Refresh to retry.','muted')); }
}
// Gentle background particles: decorative, with reduced-motion support in CSS.
for(let i=0;i<22;i++) {
  const dot=node('span',undefined,'particle');
  dot.style.left=(Math.random()*100)+'%'; dot.style.top=(Math.random()*100)+'%';
  dot.style.setProperty('--duration',(5+Math.random()*9)+'s');
  dot.style.animationDelay=(-Math.random()*12)+'s'; $('particles').append(dot);
}

// Music is optional and starts only after an explicit tap (browser autoplay rules).
const bgMusic = $('bgMusic');
bgMusic.volume = 0.18;
let musicPending = false;
function updateMusicButtons() {
  const playing = !bgMusic.paused && !bgMusic.ended;
  document.querySelectorAll('[data-music]').forEach(button => {
    button.setAttribute('aria-pressed', String(playing));
    button.setAttribute('aria-label', playing ? 'Pause background music' : 'Play background music');
    button.title = playing ? 'Pause background music' : 'Play background music';
    button.querySelector('span').textContent = playing ? 'Music on' : 'Music off';
  });
}
document.querySelectorAll('[data-music]').forEach(button => {
  button.addEventListener('click', async () => {
    if (musicPending) return;
    if (!bgMusic.paused) { bgMusic.pause(); return; }
    musicPending = true;
    try {
      if (bgMusic.error) bgMusic.load();
      await bgMusic.play();
    } catch (error) {
      toast(error.name === 'NotAllowedError'
        ? 'Tap Music again to allow audio playback.'
        : 'Song unavailable. Put a playable MP3 at music/song.mp3 and refresh.');
    } finally { musicPending = false; updateMusicButtons(); }
  });
});
bgMusic.addEventListener('play', updateMusicButtons);
bgMusic.addEventListener('pause', updateMusicButtons);
bgMusic.addEventListener('error', updateMusicButtons);
