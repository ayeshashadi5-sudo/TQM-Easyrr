#!/usr/bin/env python3
"""يحوّل نسخة Claude (claude-artifact/tracker.html) إلى واجهة مستقلة تتصل بخادم/قاعدة خارجية.
  python3 tools/build-standalone.py             # public/index.html  (خادم Node بكوكي، نفس الدومين)
  python3 tools/build-standalone.py --pages     # index.html (الجذر)  (GitHub Pages + Supabase، عبر config.js)
  python3 tools/build-standalone.py SRC DST     # مسارات مخصصة (وضع Node)"""
import re,sys,os
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args=[a for a in sys.argv[1:] if not a.startswith('--')];pages='--pages' in sys.argv
src=args[0] if args else os.path.join(root,'claude-artifact','tracker.html')
dst=args[1] if len(args)>1 else os.path.join(root,'index.html' if pages else os.path.join('public','index.html'))
h=open(src,encoding='utf-8').read()
def rep(a,b):
    global h
    assert h.count(a)==1,(h.count(a),a[:70]);h=h.replace(a,b)
SHIM=r'''<script>
(()=>{const C=window.QMT||{},API=C.api||'',JWT=/^eyJ/.test(C.anon||'');let tok='';try{tok=localStorage.getItem('qmt_tok')||''}catch(e){}
const L=[];let seen={},pt=null,es=null,dirty=new Set(),tm=null,first=true;
const hdr=()=>{const h={'Content-Type':'application/json','X-Requested-With':'qmt'};if(C.api){h.apikey=C.anon;if(JWT)h.Authorization='Bearer '+C.anon;if(tok)h['x-qmt-token']=tok}return h};
const api=async(m,u,b)=>{const r=await fetch(API+u,{method:m,credentials:C.api?'omit':'same-origin',headers:hdr(),body:b===undefined?undefined:JSON.stringify(b)});
const j=await r.json().catch(()=>({}));
if(r.status===401&&u!=='/api/login'){window.dispatchEvent(new Event('unauth'));throw new Error('انتهت الجلسة، سجّل الدخول من جديد')}
if(!r.ok)throw new Error(j.error||j.message||('خطأ '+r.status));return j};
const snap=a=>({docs:a.map(d=>({id:d.id,data:()=>d.data}))});
async function flush(){tm=null;const cs=[...dirty];dirty.clear();if(!cs.length)return;try{const all=await api('GET','/api/all?c='+cs.join(','));cs.forEach(c=>{const a=all[c]||[],t=JSON.stringify(a);L.filter(l=>l.c===c).forEach(l=>{if(t!==l.last){l.last=t;l.cb(snap(a))}})})}catch(e){}}
const want=c=>{dirty.add(c);if(!tm)tm=setTimeout(flush,30)};
const ver=async()=>{if(!C.api)return api('GET','/api/v');const h={'Content-Type':'application/json',apikey:C.anon};if(JWT)h.Authorization='Bearer '+C.anon;const r=await fetch(C.url+'/rest/v1/rpc/qmt_ver',{method:'POST',headers:h,body:'{}'});return r.json()};
const check=async()=>{if(document.hidden||(C.api&&!tok))return;try{const v=await ver();Object.keys(v).forEach(c=>{if(seen[c]!==v[c]){const was=seen[c]!==undefined||!first;seen[c]=v[c];if(was&&L.some(l=>l.c===c))want(c)}});first=false}catch(e){}};
const poll=()=>{if(!pt){pt=setInterval(check,C.api?6000:4000);check()}if(!C.api&&!es){try{es=new EventSource('/api/stream');es.onmessage=()=>check();es.onerror=()=>{}}catch(e){}}};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)check()});
window.DB={collection:c=>({async get(){return snap(await api('GET','/api/c/'+c))},onSnapshot(cb){L.push({c,last:undefined,cb});poll();want(c)},async add(o){return{id:(await api('POST','/api/c/'+c,o)).id}}}),
doc:p=>{const[c,...r]=p.split('/'),u=`/api/c/${c}/${encodeURIComponent(r.join('/'))}`;return{async get(){try{const d=await api('GET',u);return{exists:true,data:()=>d}}catch(e){return{exists:false,data:()=>undefined}}},set:o=>api('PUT',u,o),update:o=>api('PATCH',u,o),delete:()=>api('DELETE',u)}},
async login(n,p){const j=await api('POST','/api/login',{name:n,pin:p});if(C.api){tok=j.token;try{localStorage.setItem('qmt_tok',tok)}catch(e){}}return j},
async me(){if(C.api&&!tok)return{};try{return await api('GET','/api/me')}catch(e){return{}}},
async logout(){try{await api('POST','/api/logout')}catch(e){}tok='';try{localStorage.removeItem('qmt_tok')}catch(e){}this.closeStream()},
reloadAll(){seen={};first=true;L.forEach(l=>{l.last=undefined});[...new Set(L.map(l=>l.c))].forEach(want);poll()},
closeStream(){clearInterval(pt);pt=null;if(es){es.close();es=null}}};
})();
</script>
'''
i=h.index('<script>');h=h[:i]+('<script src="config.js"></script>\n' if pages else '')+SHIM+h[i:]
m=re.search(r"const db=await claude\.use\('db'\);\s*if\(!db\)\{[^}]*\}",h);assert m
h=h[:m.start()]+"const db=window.DB;"+h[m.end():]
rep("try{cur=localStorage.getItem('uid')}catch(e){}","")
i=h.index("sub(db.collection('users')");j=h.index("busy=false;draw()})();",i)+len("busy=false;draw()})();")
subs="\n".join(l for l in h[i:j].split("\n") if l.startswith("sub(db.collection"))
h=h[:i]+"let started=false;\nfunction startSubs(){\n"+subs+"}\nasync function boot(){try{const us=await db.collection('users').get();U=mp(us.docs.map(d=>({id:d.id,...d.data()})));if(!started){started=true;startSubs()}else db.reloadAll()}catch(e){console.error(e)}busy=false;draw()}\nwindow.addEventListener('unauth',()=>{cur=null;busy=false;draw()});\n"+h[j:]
i=h.index("if(a==='login'){");j=h.index("else if(a==='dash')",i)
h=h[:i]+"""if(a==='login'){const n=v('#ln'),p=v('#lp');try{const j=await db.login(n,p);cur=j.id;view={t:'d'};busy=true;document.activeElement.blur();draw();await boot()}catch(e){$('#le').textContent=e.message||'تعذر الاتصال بالخادم'}}
else if(a==='out'){await db.logout();cur=null;U={};P={};E=[];H=[];RD={};SS={};REL=[];RT=[];AS=[];view={t:'d'};draw()}
"""+h[j:]
k=h.rindex("draw();\n})();")
h=h[:k]+"""busy=true;draw();
(async()=>{try{const m=await db.me();if(m.id){cur=m.id;await boot()}else{busy=false;draw()}}catch(e){busy=false;draw()}})();
})();"""+h[k+len("draw();\n})();"):]
h=h.replace("جاري تجهيز البيانات الأولية، لحظات…","جاري التحميل…")
os.makedirs(os.path.dirname(dst),exist_ok=True);open(dst,'w',encoding='utf-8').write(h)
print('written',dst,len(h))
