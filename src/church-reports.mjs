import { ensure } from './errors.mjs';
export const REPORT_FIELDS=['sunday','gospel','home-in','home-out','reading','group','children-sunday','children-group'];
const GENERAL=REPORT_FIELDS.slice(0,6),CHILDREN=REPORT_FIELDS.slice(6);
const valid=n=>n===null || (Number.isSafeInteger(n) && n>=0);
const add=(a,b)=>a===null || b===null ? null : a+b;
const sourceStores=new WeakMap();
function storeFor(base){if(!sourceStores.has(base))sourceStores.set(base,{geometry:new Map(),geometryPending:new Map(),snapshots:new Map(),pending:new Map(),cooldown:0});return sourceStores.get(base);}
function extraRow(rows,totals,scope,label) {
  const extra={scope,label};
  for(const key of REPORT_FIELDS) {
    const total=rows.reduce((sum,row)=>add(sum,row[key]),0),difference=total===null || totals[key]===null ? null : totals[key]-total;
    ensure(difference===null || difference>=0,409,'REPORT_MOVED','讀取時原網站報表已變動，請重新讀取。');extra[key]=difference;
  }
  return REPORT_FIELDS.some(key=>extra[key]>0) ? [extra] : [];
}
// Read-only geometry and counts come from the formal report API, never from point-name privileges.
export class ChurchReportAdapter {
  constructor(base,{defaultGroupId}) {this.base=base;this.mode=base.mode;this.churchId=base.churchId;this.defaultGroupId=defaultGroupId;this.store=storeFor(base);this.allowChurchReport=true;}
  meetings(meta,keys) {
    const result=keys.map(key=>[...meta.meetings,...(meta.childMeetings??[])].find(m=>m.key===key));
    ensure(result.every(Boolean),502,'REPORT_MEETINGS','無法確認原網站報表聚會欄位。');return result;
  }
  async raw(week,meta,keys,role,groupIds,level=2) {
    const meetings=this.meetings(meta,keys);
    const p=new URLSearchParams({year:String(week.year),week:String(week.week),scope:'church',scope_id:String(this.churchId),church_level:String(level),row_contract:'2',direct_rows:'1',split_children_sunday:role?'0':'1',meetings:meetings.map(m=>m.id).join(',')});
    if(role)p.set('role',role);if(groupIds?.length)p.set('lv2_ids',groupIds.join(','));
    ensure(Date.now()>=this.store.cooldown,429,'UPSTREAM_RATE_LIMIT','原網站報表查詢較頻繁，請稍後再重新讀取。');
    let data;try{data=await this.base.request('/admin/reports/weekly?'+p);}catch(error){if(error.code==='UPSTREAM_RATE_LIMIT')this.store.cooldown=Date.now()+(error.retryAfter??60)*1000;throw error;}
    ensure(Array.isArray(data?.rows) && Array.isArray(data.meetings) && data.totals?.attendance && meetings.every(m=>data.meetings.some(c=>Number(c.id)===m.id)),502,'REPORT_SCHEMA','原網站報表格式已變更，請重新讀取。');
    return {data,meetings};
  }
  values(attendance,meetings) {
    return Object.fromEntries(meetings.map(m=>{const n=attendance?.[String(m.id)];ensure(valid(n),502,'REPORT_SCHEMA','原網站報表人數格式已變更。');return[m.key,n];}));
  }
  async metadata(week) {
    const cached=this.store.geometry.get(week.key);
    if(cached && cached.expires>Date.now())return {...cached.meta,defaultReportGroup:'l2:'+this.defaultGroupId};
    if(this.store.geometryPending.has(week.key))return {...await this.store.geometryPending.get(week.key),defaultReportGroup:'l2:'+this.defaultGroupId};
    const pending=this.loadMetadata(week);this.store.geometryPending.set(week.key,pending);
    try{return {...await pending,defaultReportGroup:'l2:'+this.defaultGroupId};}finally{this.store.geometryPending.delete(week.key);}
  }
  async loadMetadata(week) {
    const own=await this.base.metadata(week);
    const [tree,proof]=await Promise.all([this.base.request('/admin/church-tree?purpose=rollcall&week_year='+week.year+'&week='+week.week),this.raw(week,own,GENERAL)]);
    ensure(Array.isArray(tree),502,'REPORT_SCHEMA','原網站區域資料格式已變更。');
    const authorized=new Map(proof.data.rows.filter(r=>r.row_kind==='node' && !r.node_deleted && Number(r.node_id)>0).map(r=>[Number(r.node_id),r]));
    const allGroups=[],scopes=[],churchId=this.churchId;
    function walk(node,parentGroup=null) {
      let group=parentGroup;
      if(Number(node.level)===2){group={id:Number(node.id),label:node.name,key:'l2:'+node.id};allGroups.push(group);}
      if(Number(node.level)===3 && group && authorized.has(group.id))scopes.push({key:'l3:'+node.id,label:node.name,level:3,path:group.label+' / '+node.name,ids:{1:churchId,2:group.id,3:Number(node.id)}});
      for(const child of node.children??[])walk(child,group);
    }
    // The church ID is fixed by the authenticated source, not supplied by the phone.
    for(const root of tree)if(Number(root.id)===this.churchId)walk(root);
    const reportGroups=allGroups.filter(g=>authorized.has(g.id));
    ensure(reportGroups.length,403,'REPORT_SCOPE','這個帳號目前沒有可讀取的大組報表。');
    const meta={...own,scopes,reportGroups,supportsChurchReport:allGroups.length>0 && reportGroups.length===allGroups.length};
    if(this.store.geometry.size>=2)this.store.geometry.delete(this.store.geometry.keys().next().value);
    this.store.geometry.set(week.key,{expires:Date.now()+60000,meta});return meta;
  }
  async snapshot(week,meta) {
    const cached=this.store.snapshots.get(week.key);if(cached && cached.expires>Date.now())return cached;
    if(this.store.pending.has(week.key))return this.store.pending.get(week.key);
    const pending=(async()=>{
      const sections={};
      // One bounded read per level/role; switching groups reuses this aggregate snapshot.
      for(const level of [2,3])for(const [kind,keys,role] of [['general',GENERAL,undefined],['preschool',CHILDREN,'學齡前'],['elementary',CHILDREN,'國小']])sections[level+kind]=await this.raw(week,meta,keys,role,undefined,level);
      const value={sections,loadedAt:new Date().toISOString(),expires:Date.now()+60000};
      if(this.store.snapshots.size>=2)this.store.snapshots.delete(this.store.snapshots.keys().next().value);
      this.store.snapshots.set(week.key,value);return value;
    })();this.store.pending.set(week.key,pending);
    try{return await pending;}finally{this.store.pending.delete(week.key);}
  }
  counts(snapshot,level,nodes) {
    const general=snapshot.sections[level+'general'],preschool=snapshot.sections[level+'preschool'],elementary=snapshot.sections[level+'elementary'];
    const values=(result,id,role)=>{
      const rows=result.data.rows.filter(r=>r.row_kind==='node' && Number(r.node_id)===id && !r.node_deleted);
      if(role && !rows.length)return Object.fromEntries(result.meetings.map(m=>[m.key,0]));
      ensure(rows.length===1,502,'REPORT_INCOMPLETE','原網站大組報表資料不完整。');return this.values(rows[0].attendance,result.meetings);
    };
    const rows=nodes.map(g=>{
      const a=values(general,g.id),p=values(preschool,g.id,true),e=values(elementary,g.id,true);
      return {scope:g.key,label:g.label,...a,...Object.fromEntries(CHILDREN.map(key=>[key,add(p[key],e[key])]))};
    });
    const p=this.values(preschool.data.totals.attendance,preschool.meetings),e=this.values(elementary.data.totals.attendance,elementary.meetings);
    const totals={...this.values(general.data.totals.attendance,general.meetings),...Object.fromEntries(CHILDREN.map(key=>[key,add(p[key],e[key])]))};
    return {rows,totals};
  }
  async reportCounts(week,scopes,meta) {
    const group=meta.reportGroups.find(g=>g.id===scopes[0]?.ids[2]);
    ensure(group,403,'REPORT_SCOPE','無法確認這個大組的報表範圍。');
    const snapshot=await this.snapshot(week,meta);
    const ended=new Set(snapshot.sections['3general'].data.rows.filter(r=>r.row_kind==='ended_bucket' && Number(r.parent_id)===group.id).flatMap(r=>(r.ended_nodes??[]).map(n=>Number(n.node_id))));
    const omittedScopes=scopes.filter(s=>ended.has(s.ids[3])).map(s=>s.key);
    const nodes=scopes.filter(s=>!ended.has(s.ids[3])).map(s=>({id:s.ids[3],key:s.key,label:s.label}));
    const rows=this.counts(snapshot,3,nodes).rows,official=this.counts(snapshot,2,[group]);
    let extra;try{extra=extraRow(rows,official.rows[0],'other:'+group.key,'直屬／其他未列小區');}catch(error){if(error.code==='REPORT_MOVED')this.store.snapshots.delete(week.key);throw error;}
    return {rows,omittedScopes,extraRows:extra,loadedAt:snapshot.loadedAt,cacheSeconds:60};
  }
  async churchCounts(week,meta) {
    ensure(meta.supportsChurchReport,403,'REPORT_SCOPE','這個帳號沒有可確認的全召會報表權限。');
    const snapshot=await this.snapshot(week,meta),result=this.counts(snapshot,2,meta.reportGroups);
    let extra;try{extra=extraRow(result.rows,result.totals,'other:church','未分大組／其他');}catch(error){if(error.code==='REPORT_MOVED')this.store.snapshots.delete(week.key);throw error;}
    return {rows:[...result.rows,...extra],loadedAt:snapshot.loadedAt,cacheSeconds:60};
  }
}
