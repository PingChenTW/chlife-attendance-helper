const QUEUE_KEY='attendance-diagnostics:v1';
const STAGES=['helper-connect','metadata','roster','attendance','report'];
const CODES=['CLIENT_TIMEOUT','CLIENT_NETWORK','CLIENT_OFFLINE','HELPER_NON_JSON'];
const labels={helper:'點名服務',initialize:'資料初始化','upstream-login':'原網站登入','upstream-refresh':'原網站登入更新','upstream-directory':'小區目錄讀取','upstream-meetings':'聚會目錄讀取','upstream-roster':'原網站名單讀取','upstream-attendance':'原網站點名儲存','upstream-report':'原網站報表讀取'};
const safeEvent=event=>event&&Object.keys(event).length===6&&/^[1-8]$/.test(event.group)&&STAGES.includes(event.stage)&&CODES.includes(event.code)&&
  Number.isSafeInteger(event.durationMs)&&event.durationMs>=0&&event.durationMs<=600000&&typeof event.eventId==='string'&&/^[a-f0-9-]{36}$/i.test(event.eventId)&&
  typeof event.occurredAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.occurredAt)&&Number.isFinite(Date.parse(event.occurredAt));
export function createDiagnosticReporter({apiBase='',group,enabled=true,storage,fetchImpl=globalThis.fetch,now=()=>Date.now()}={}){
  let queue=[],running;
  try{const saved=JSON.parse(storage?.getItem(QUEUE_KEY)??'[]');if(Array.isArray(saved))queue=saved.filter(safeEvent).filter(event=>now()-Date.parse(event.occurredAt)<86400000&&Date.parse(event.occurredAt)<=now()).slice(-20);}catch{}
  const save=()=>{try{storage?.setItem(QUEUE_KEY,JSON.stringify(queue));}catch{}};
  const flush=()=>{
    if(!enabled||running||!queue.length)return running??Promise.resolve();
    running=Promise.resolve().then(async()=>{
      while(queue.length){
        const event=queue[0];
        if(now()-Date.parse(event.occurredAt)>=86400000){queue.shift();save();continue;}
        try{const response=await fetchImpl(String(apiBase).replace(/\/$/,'')+'/api/usage/diagnostics',{method:'POST',credentials:'omit',keepalive:true,headers:{'Content-Type':'application/json','X-Usage-Client':'1'},body:JSON.stringify(event),signal:AbortSignal.timeout(5000)});if(response.status!==202)break;queue=queue.filter(row=>row.eventId!==event.eventId);save();}catch{break;}
      }
    }).finally(()=>{running=null;});return running;
  };
  return {pending:()=>queue.length,flush,record(stage,code,durationMs){
    if(!enabled||typeof group!=='string'||!/^[1-8]$/.test(group)||!STAGES.includes(stage)||!CODES.includes(code))return;
    const event={group,stage,code,durationMs:Math.max(0,Math.min(600000,Math.round(durationMs))),occurredAt:new Date(now()).toISOString(),eventId:crypto.randomUUID()};
    if(!safeEvent(event))return;queue.push(event);if(queue.length>20)queue.splice(0,queue.length-20);save();
  }};
}
export function createConnectionClient({apiBase='',fetchImpl=globalThis.fetch,reporter,online=()=>globalThis.navigator?.onLine!==false}={}){
  return async(path,options={},stage='metadata')=>{
    const started=Date.now(),write=(options.method??'GET').toUpperCase()==='POST';
    const failure=(code,message)=>{try{reporter?.record(stage,code,Date.now()-started);void reporter?.flush();}catch{}return new Error(message);};
    let response;
    try{response=await fetchImpl(String(apiBase).replace(/\/$/,'')+path,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(90000),...options});}
    catch(error){
      const timeout=['TimeoutError','AbortError'].includes(error?.name),code=!online()?'CLIENT_OFFLINE':timeout?'CLIENT_TIMEOUT':'CLIENT_NETWORK';
      const message=write?'這次送出尚未確認，請先重新讀取名單核對，勿連續重送。':!online()?'目前沒有網路，請連線後按「重新讀取」。':stage==='helper-connect'?`點名服務${timeout?'連線逾時':'暫時連不上'}，可能尚未啟動，請稍候按「重新讀取」。`:`讀取資料${timeout?'逾時':'連線中斷'}，請按「重新讀取」。`;
      throw failure(code,message);
    }
    let data;try{data=await response.json();}catch{throw failure('HELPER_NON_JSON',write?'這次送出尚未確認，請先重新讀取名單核對，勿連續重送。':'點名服務尚未回傳有效資料，可能正在啟動；請稍候按「重新讀取」。');}
    try{void reporter?.flush();}catch{}
    if(!response.ok){
      const error=data?.error??{},label=labels[error.stage],reference=/^[a-f0-9-]{36}$/i.test(error.requestId??'')?`（查詢碼 ${error.requestId.slice(0,8)}）`:'';
      const reason=error.code==='RATE_LIMIT'?'操作較頻繁，請稍候再試。':error.code==='UPSTREAM_RATE_LIMIT'?'原網站限制請求，請稍候重新讀取。':error.code==='UPSTREAM_TIMEOUT'?'連線逾時，請稍後重新讀取。':error.code==='UPSTREAM_UNAVAILABLE'?'暫時無法連線，請稍後重新讀取。':String(error.message??'暫時無法完成，請稍後再試。');
      throw new Error(`${label?label+'：':''}${reason}${reference}${write?' 請先重新讀取名單核對，勿連續重送。':''}`);
    }
    return data;
  };
}
