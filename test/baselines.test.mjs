import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBaselines,BASELINES} from '../src/baselines.mjs';
import {ReportService} from '../src/reports.mjs';
const header='年度,召會ID,層級,區域ID,名稱,基數,備註\n';
test('one baseline table handles years, churches, levels, missing values and CSV quoting',()=>{
  const t=parseBaselines('\uFEFF'+header+'2026,49,大組,1,大組,20,"來源,表"\r\n2026,49,小區,1,"同名""區",0,\r\n2026,50,小區,1,其他召會,,\r\n2027,49,大組,1,次年,25,');
  assert.equal(t[2026][49][2][1],20);assert.equal(t[2026][49][3][1],0);assert.equal(t[2026][50][3][1],null);assert.equal(t[2027][49][2][1],25);
  assert.ok(Object.keys(BASELINES).length>0);
});
test('duplicate IDs, invalid numbers, wrong headers and broken CSV cannot silently change ratios',()=>{
  for(const text of [header+'2026,49,小區,1,甲,10,\n2026,49,小區,01,乙,20,',header+'2026,49,小區,1,甲,-1,',header+'2026,49,小區,1,甲,abc,',header+'2026,49,小區,1,"未結束,10,','wrong\n1,2,3'])assert.throws(()=>parseBaselines(text));
});
test('changing only the baseline table updates report ratios without changing counting code',async()=>{
  const adapter={mode:'demo',churchId:49,async metadata(){return{church:'測試',scopes:[{key:'l3:200',label:'甲區',level:3,path:'甲組 / 甲區',ids:{1:49,2:100,3:200}}]};},async reportCounts(){return[{scope:'l3:200',sunday:10,gospel:0,'home-in':0,'home-out':0,reading:0,group:0,'children-sunday':0,'children-group':0}];}};
  const get=baseline=>new ReportService([{key:'primary',label:'測試',adapter}],{now:()=>new Date('2026-10-28T05:00:00Z'),baselines:parseBaselines(header+'2026,49,大組,100,甲組,'+baseline+',\n2026,49,小區,200,甲區,,')}).weekly({week:'2026-W44'});
  assert.equal((await get(20)).totals.sundayRatio,50);assert.equal((await get(40)).totals.sundayRatio,25);
});
