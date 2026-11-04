import { CHURCH_COLUMN_GROUPS, reportColumns, reportNumber, reportCsv } from './report-model.js';
import { createPracticeApi } from './practice.js';
import { parseGroupContext, groupApiPath, applyGroupContext, redirectDefaultGroup } from './group-context.js';
const redirecting=redirectDefaultGroup(window.location,window.ATTENDANCE_CONFIG);
const linkGroup=parseGroupContext(window.location.search);applyGroupContext(linkGroup,document);
const $ = id=>document.getElementById(id);
const base = String(window.ATTENDANCE_CONFIG?.apiBase ?? '').replace(/\/$/,'');
const practice = window.ATTENDANCE_CONFIG?.practice ? createPracticeApi() : null;
let usageReporter;
function reportUsage(page, group) {
  usageReporter ??= import('./usage-client.js').then(module => module.createUsageReporter({ apiBase: base, enabled: !practice })).catch(() => null);
  void usageReporter.then(report => report?.(page, group)).catch(() => {});
}
const state = { meta:null,week:null,source:'primary',group:'',report:null,busy:false,seq:0 };
async function api(path) {
  const requestPath=groupApiPath(path,linkGroup);
  if(linkGroup.id && practice)throw new Error('大組專屬連結需連接正式服務，目前為練習版。');
  if (practice) return practice(path);
  let response;
  try { response = await fetch(base+requestPath,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(90000)}); }
  catch { throw new Error(navigator.onLine?'報表連線中斷，請稍後重新讀取。':'目前沒有網路，請連線後重新讀取報表。'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('報表服務可能正在啟動，請稍候約一分鐘再重新讀取。'); }
  if (!response.ok) throw new Error(data.error?.message ?? '暫時無法讀取報表。');
  return data;
}
function options(node,values,selected) { node.replaceChildren(...values.map(v=>{ const option=document.createElement('option'); option.value=v.key;option.textContent=v.label;return option; }));node.value=selected; }
function busy(value) {
  state.busy=value;
  for (const node of [$('report-source'),$('report-group'),$('report-refresh'),...$('report-weeks').children]) node.disabled=value;
  $('report-content').setAttribute('aria-busy',String(value));
}
function metrics() {
  const report=state.report, row=report.rows.find(r=>r.scope===$('report-district').value) ?? report.totals;
  $('detail-title').textContent=row===report.totals?`${report.group.label} · ${report.rowLevel===2?'合計':'小計'}`:row.label;
  $('report-metrics').replaceChildren(...reportColumns(report).map(([key,label])=>{
    const box=document.createElement('div');box.className='report-metric'+(key.endsWith('Ratio')?' ratio':'');
    const title=document.createElement('span');title.textContent=key==='baseline'?`${report.baselineYear} 基數`:label;
    const value=document.createElement('strong');value.textContent=reportNumber(row[key],key,report.profile==='all-groups'?0:2);box.append(title,value);return box;
  }));
}
function render(report) {
  if(report.mode==='live')void reportUsage('reports',linkGroup.id);
  state.report=report;state.group=report.group.key;
  $('report-church').textContent=report.church;
  $('report-demo').hidden=report.mode!=='demo';
  options($('report-group'),report.groups,report.group.key);
  const churchView=report.rowLevel===2;
  const fullChurch=report.profile==='all-groups', columns=reportColumns(report), precision=fullChurch?0:2;
  const detailLabel=$('report-detail-label') ?? document.querySelector('label[for="report-district"]');
  const tableToggle=$('report-table-toggle') ?? document.querySelector('#full-report summary');
  if(detailLabel)detailLabel.textContent=churchView?'查看大組':'查看小區';
  if(tableToggle)tableToggle.textContent=churchView?'查看各大組完整表格':'查看各小區完整表格';
  options($('report-district'),[{key:'total',label:churchView?'全召會 · 合計':'全部小區 · 大組小計'},...report.rows.map(r=>({key:r.scope,label:r.label}))],'total');
  $('report-title').textContent=`${report.group.label} · ${report.week.label}`;
  $('report-date').textContent=`${report.week.year} 年第 ${report.week.week} 週 · ${report.week.start} ～ ${report.week.end}`;
  $('report-progress').textContent=(report.inProgress?'本週進行中：目前數字只反映已登錄的出席。':'上週資料仍可能因補登而更新。')+(report.cacheSeconds?'報表最多約一分鐘更新一次。':'');
  $('table-caption').textContent=`${report.group.label} · ${report.week.key}`;
  const header=document.createElement('tr');
  if(fullChurch) {
    const lead=document.createElement('th');lead.scope='col';lead.rowSpan=2;lead.textContent='大組';header.append(lead);
    const subheader=document.createElement('tr');
    for(const band of CHURCH_COLUMN_GROUPS) {
      const cell=document.createElement('th');cell.scope=band.label?'colgroup':'col';
      if(band.label){cell.colSpan=band.columns.length;cell.textContent=band.label;for(const [,label]of band.columns){const sub=document.createElement('th');sub.scope='col';sub.textContent=label;subheader.append(sub);}}
      else{cell.rowSpan=2;const [key,label]=band.columns[0];cell.textContent=key==='baseline'?`${report.baselineYear} 基數`:label;}
      header.append(cell);
    }
    $('report-table').querySelector('thead').replaceChildren(header,subheader);
  } else {
    for (const label of [churchView?'大組':'小區',...columns.map(([key,label])=>key==='baseline'?`${report.baselineYear} 基數`:label)]) { const cell=document.createElement('th');cell.scope='col';cell.textContent=label;header.append(cell); }
    $('report-table').querySelector('thead').replaceChildren(header);
  }
  function tableRow(row) { const tr=document.createElement('tr');const name=document.createElement('th');name.scope='row';name.textContent=row.label;tr.append(name);for(const [key] of columns){const cell=document.createElement('td');cell.className=key.endsWith('Ratio')?'ratio':key==='baseline'?'baseline':'';cell.textContent=reportNumber(row[key],key,precision);tr.append(cell);}return tr; }
  $('report-table').querySelector('tbody').replaceChildren(...report.rows.map(tableRow));
  $('report-table').querySelector('tfoot').replaceChildren(tableRow(report.totals),...(report.previousTotals?[tableRow(report.previousTotals)]:[]));
  $('report-comparison').hidden=!report.previousWeek;
  if(report.previousWeek)$('report-comparison').textContent=`表格「上週」比較：${report.previousWeek.start}～${report.previousWeek.end}。${report.previousWeek.year!==report.baselineYear?`比較列使用 ${report.previousWeek.year} 年基數。`:''}今年受浸為當年本地受浸累計；新人主日為這些人該週的主日出席。${report.baptismEstimated?'原網站提示受浸數包含推估，請與管理者核對。':''}`;
  const baselineRows=churchView?report.rows.filter(row=>row.scope.startsWith('l2:')):report.rows;
  $('baseline-note').textContent=report.mode==='demo'?'示範資料未設定正式基數。':`${report.baselineYear} 基數：${baselineRows.filter(row=>row.baseline!==null).length}／${baselineRows.length} 個${churchView?'大組':'小區'}已設定。${report.baselineKind==='group'?'大組小計另採管理者提供的大組基數。':report.baselineKind==='groups'?'全召會基數採大組基數加總。':''}未設定時顯示「—」。資料時間：${new Date(report.loadedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}`;
  $('report-definition').textContent=fullChurch?'兒童主日分為學齡前與小學（依原網站「國小」身分），合計含已受浸與未受浸兒童。兒童召會生活是當週參加任一聚會的不重複人數。家聚會加總、青職家聚皆為出訪＋受訪。':'一般聚會沿用正式週報預設口徑，主日由原站拆分兒童。兒童主日、兒童排專欄統計「學齡前、國小」，含已受浸兒童，範圍與原站「童（福朋）」欄不同。家聚會合計為受訪＋出訪，同人兩項都有登錄會計兩次。';
  metrics();$('report-content').hidden=false;
}
async function load() {
  const seq=++state.seq;busy(true);state.report=null;$('report-content').hidden=true;$('report-retry').hidden=true;
  $('report-status').hidden=false;$('report-status').className='notice report-status';$('report-status').textContent='正在讀取原網站正式報表，請稍候…';
  for(const button of $('report-weeks').children)button.setAttribute('aria-pressed',String(button.dataset.week===state.week));
  try {
    const report=await api(`/api/reports/${state.group==='church'?'summary':'weekly'}?`+new URLSearchParams({week:state.week,source:state.source,...(state.group?{group:state.group}:{})}));
    if(seq!==state.seq)return;
    render(report);$('report-status').hidden=true;
  } catch(error) {
    if(seq!==state.seq)return;
    $('report-status').className='notice error report-status';$('report-status').textContent=error.message;$('report-retry').hidden=false;
  } finally { if(seq===state.seq)busy(false); }
}
async function start() {
  try {
    state.meta=await api('/api/reports/meta');state.week=state.meta.weeks[0].key;state.source=state.meta.sources[0].key;
    options($('report-source'),state.meta.sources,state.source);$('source-field').hidden=state.meta.sources.length<=1;
    $('report-weeks').replaceChildren(...state.meta.weeks.map(week=>{ const button=document.createElement('button');button.className='week-button';button.dataset.week=week.key;button.setAttribute('aria-pressed',String(week.key===state.week));button.append(document.createTextNode(week.label));const small=document.createElement('small');small.textContent=`${week.start.slice(5).replace('-','/')} ～ ${week.end.slice(5).replace('-','/')}`;button.append(small);button.onclick=()=>{state.week=week.key;load();};return button; }));
    await load();
  } catch(error) { $('report-status').textContent=error.message;$('report-status').className='notice error report-status';$('report-retry').hidden=false; }
}
$('report-group').onchange=()=>{state.group=$('report-group').value;load();};
$('report-source').onchange=()=>{state.source=$('report-source').value;state.group='';$('report-group').replaceChildren(new Option('正在取得大組…',''));load();};
$('report-district').onchange=metrics;
$('report-refresh').onclick=load;
$('report-retry').onclick=()=>state.meta?load():start();
$('report-download').onclick=()=>{if(!state.report)return;const url=URL.createObjectURL(new Blob([reportCsv(state.report)],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`聚會報表-${state.source}-${state.report.group.key.replace(':','-')}-${state.week}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
if(!redirecting)start();
