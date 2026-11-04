export const REPORT_COLUMNS = [
  ['baseline','基數'],['sunday','主日'],['sundayRatio','繁增比例'],['gospel','福音出訪'],['gospelRatio','出訪比例'],
  ['home-in','家聚會受訪'],['home-out','家聚會出訪'],['homeTotal','家聚會合計'],['homeRatio','家聚會比例'],
  ['children-sunday','兒童主日'],['children-group','兒童排（兒童）'],['reading','生命讀經'],['group','小排']
];
export const CHURCH_COLUMN_GROUPS = [
  {columns:[['baseline','基數']]},{columns:[['sunday','主日']]},{columns:[['sundayRatio','繁增比例']]},
  {columns:[['baptismYear','今年受浸']]},{columns:[['newcomerSunday','新人主日']]},{columns:[['gospel','福音出訪']]},{columns:[['gospelRatio','出訪比例']]},
  {label:'家聚會',columns:[['home-out','出訪'],['home-in','受訪'],['homeTotal','加總']]},{columns:[['homeRatio','家聚會比例']]},
  {columns:[['collegeSunday','大專主日']]},{columns:[['careerSunday','青職主日']]},{columns:[['careerRatio','青職佔比']]},
  {columns:[['careerHome','青職家聚']]},{columns:[['careerHomeRatio','家聚比例']]},{columns:[['childrenLife','兒童召會生活']]},
  {label:'兒童主日',columns:[['childrenSundayPreschool','學齡前'],['childrenSundayElementary','小學'],['children-sunday','合計']]},
  {columns:[['teensSunday','青少年主日']]},{columns:[['prayer','禱告']]},{columns:[['reading','生命讀經']]},{columns:[['morning','晨興']]},{columns:[['group','小排']]}
];
const CHURCH_COLUMNS=CHURCH_COLUMN_GROUPS.flatMap(group=>group.columns.map(([key,label])=>[key,group.label?group.label+'－'+label:label]));
export function reportColumns(report) { return report.profile==='all-groups'?CHURCH_COLUMNS:REPORT_COLUMNS; }
export function reportNumber(value,key,precision=2) { return value === null || value === undefined ? '—' : key.endsWith('Ratio') ? value.toFixed(precision)+'%' : String(value); }
export function reportCsv(report) {
  const cell = value => '"'+String(value).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  const columns=reportColumns(report), precision=report.profile==='all-groups'?0:2;
  const comparison=report.previousTotals?[{...report.previousTotals,label:'上週'+(report.previousWeek?'（'+report.previousWeek.start+'～'+report.previousWeek.end+'）':'')}]:[];
  const lines = [[report.church,report.group.label,report.week.key],[report.rowLevel===2?'大組':'小區',...columns.map(([key,label])=>key==='baseline'?report.baselineYear+' 基數':label)],
    ...[...report.rows,report.totals,...comparison].map(row=>[row.label,...columns.map(([key])=>reportNumber(row[key],key,precision))])];
  return '\uFEFF'+lines.map(row=>row.map(cell).join(',')).join('\r\n');
}
