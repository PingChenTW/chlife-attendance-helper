import {readFileSync} from 'node:fs';
import {ensure} from './errors.mjs';

export function parseBaselines(text) {
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  const source=String(text).replace(/^\uFEFF/,'');
  const finish=()=>{row.push(cell);if(row.some(v=>v.trim()!==''))rows.push(row);row=[];cell='';closed=false;};
  for(let i=0;i<source.length;i++) {
    const c=source[i];
    if(quoted){if(c==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){ensure(cell==='' && !closed,500,'BASELINE_CONFIG','基數表的引號格式錯誤。');quoted=true;}
    else if(c===','){row.push(cell);cell='';closed=false;}
    else if(c==='\n' || c==='\r'){if(c==='\r' && source[i+1]==='\n')i++;finish();}
    else{ensure(!closed || c.trim()==='',500,'BASELINE_CONFIG','基數表的引號後有多餘內容。');if(!closed)cell+=c;}
  }
  ensure(!quoted,500,'BASELINE_CONFIG','基數表有未結束的引號。');if(row.length || cell || closed)finish();
  const header=['年度','召會ID','層級','區域ID','名稱','基數','備註'];
  ensure(rows.length>1 && JSON.stringify(rows[0].map(v=>v.trim()))===JSON.stringify(header),500,'BASELINE_CONFIG','基數表欄位需為：年度、召會ID、層級、區域ID、名稱、基數、備註。');
  const table={},seen=new Set();
  for(let i=1;i<rows.length;i++) {
    const columns=rows[i].map(v=>v.trim()),[year,church,kind,id,name,baseline]=columns,level=kind==='大組'?2:kind==='小區'?3:null;
    ensure(columns.length===7 && /^\d{4}$/.test(year) && /^\d+$/.test(church) && Number.isSafeInteger(Number(church)) && Number(church)>0 && level && /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id)>0 && name && (baseline==='' || /^\d+$/.test(baseline) && Number.isSafeInteger(Number(baseline))),500,'BASELINE_CONFIG',`基數表第 ${i+1} 列有無效資料；基數請填非負整數或留空。`);
    const key=[Number(year),Number(church),level,Number(id)].join(':');
    ensure(!seen.has(key),500,'BASELINE_CONFIG',`基數表第 ${i+1} 列與其他資料重複，請直接修改原列。`);seen.add(key);
    table[Number(year)]??={};table[Number(year)][Number(church)]??={};table[Number(year)][Number(church)][level]??={};
    table[Number(year)][Number(church)][level][Number(id)]=baseline===''?null:Number(baseline);
  }
  return table;
}
export const BASELINES=parseBaselines(readFileSync(new URL('../baselines.csv',import.meta.url),'utf8'));
