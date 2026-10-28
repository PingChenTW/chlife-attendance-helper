import { REPORT_COLUMNS, reportNumber, reportCsv } from './report-model.js';
import { createPracticeApi } from './practice.js';
const $ = id=>document.getElementById(id);
const base = String(window.ATTENDANCE_CONFIG?.apiBase ?? '').replace(/\/$/,'');
const practice = window.ATTENDANCE_CONFIG?.practice ? createPracticeApi() : null;
const state = { meta:null,week:null,source:'primary',group:'',report:null,busy:false,seq:0 };
async function api(path) {
  if (practice) return practice(path);
  let response;
  try { response = await fetch(base+path,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(90000)}); }
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
  $('detail-title').textContent=row===report.totals?`${report.group.label} · 小計`:row.label;
  $('report-metrics').replaceChildren(...REPORT_COLUMNS.map(([key,label])=>{
    const box=document.createElement('div');box.className='report-metric'+(key.endsWith('Ratio')?' ratio':'');
    const title=document.createElement('span');title.textContent=key==='baseline'?`${report.baselineYear} 基數`:label;
    const value=document.createElement('strong');value.textContent=reportNumber(row[key],key);box.append(title,value);return box;
  }));
}
function render(report) {
  state.report=report;state.group=report.group.key;
  $('report-church').textContent=report.church;
  $('report-demo').hidden=report.mode!=='demo';
  options($('report-group'),report.groups,report.group.key);
  options($('report-district'),[{key:'total',label:'全部小區 · 大組小計'},...report.rows.map(r=>({key:r.scope,label:r.label}))],'total');
  $('report-title').textContent=`${report.group.label} · ${report.week.label}`;
  $('report-date').textContent=`${report.week.year} 年第 ${report.week.week} 週 · ${report.week.start} ～ ${report.week.end}`;
  $('report-progress').textContent=report.inProgress?'本週進行中：目前數字只反映已登錄的出席。':'上週資料仍可能因補登而更新。';
  $('table-caption').textContent=`${report.group.label} · ${report.week.key}`;
  const header=document.createElement('tr');
  for (const label of ['小區',...REPORT_COLUMNS.map(([key,label])=>key==='baseline'?`${report.baselineYear} 基數`:label)]) { const cell=document.createElement('th');cell.scope='col';cell.textContent=label;header.append(cell); }
  $('report-table').querySelector('thead').replaceChildren(header);
  function tableRow(row) { const tr=document.createElement('tr');const name=document.createElement('th');name.scope='row';name.textContent=row.label;tr.append(name);for(const [key] of REPORT_COLUMNS){const cell=document.createElement('td');cell.className=key.endsWith('Ratio')?'ratio':key==='baseline'?'baseline':'';cell.textContent=reportNumber(row[key],key);tr.append(cell);}return tr; }
  $('report-table').querySelector('tbody').replaceChildren(...report.rows.map(tableRow));
  $('report-table').querySelector('tfoot').replaceChildren(tableRow(report.totals));
  $('baseline-note').textContent=report.mode==='demo'?'示範資料未設定正式基數。':`${report.baselineYear} 基數：${report.rows.filter(row=>row.baseline!==null).length}／${report.rows.length} 個小區已由管理者設定。未設定時顯示「—」。更新時間：${new Date(report.loadedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})}`;
  metrics();$('report-content').hidden=false;
}
async function load() {
  const seq=++state.seq;busy(true);state.report=null;$('report-content').hidden=true;$('report-retry').hidden=true;
  $('report-status').hidden=false;$('report-status').className='notice report-status';$('report-status').textContent='正在讀取原網站正式報表，請稍候…';
  for(const button of $('report-weeks').children)button.setAttribute('aria-pressed',String(button.dataset.week===state.week));
  try {
    const report=await api('/api/reports/weekly?'+new URLSearchParams({week:state.week,source:state.source,...(state.group?{group:state.group}:{})}));
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
    $('report-weeks').replaceChildren(...state.meta.weeks.map(week=>{ const button=document.createElement('button');button.className='week-button';button.dataset.week=week.key;button.setAttribute('aria-pressed',String(week.key===state.week));button.append(document.createTextNode(week.label));const small=document.createElement('small');small.textContent=`${week.start.slice(5).replace('-','/')} ～ ${week.end.slice(5).replace('-','/')}`;button.append(small);button.onclick=()=>{state.week=week.key;state.group='';load();};return button; }));
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
start();
