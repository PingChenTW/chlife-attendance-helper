export const REPORT_COLUMNS = [
  ['baseline','基數'],['sunday','主日'],['sundayRatio','繁增比例'],['gospel','福音出訪'],['gospelRatio','出訪比例'],
  ['home-in','家聚會受訪'],['home-out','家聚會出訪'],['homeTotal','家聚會合計'],['homeRatio','家聚會比例'],
  ['children-sunday','兒童主日'],['children-group','兒童排（兒童）'],['reading','生命讀經'],['group','小排']
];
export function reportNumber(value,key) { return value === null || value === undefined ? '—' : key.endsWith('Ratio') ? value.toFixed(2)+'%' : String(value); }
export function reportCsv(report) {
  const cell = value => '"'+String(value).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  const lines = [[report.church,report.group.label,report.week.key],['小區',...REPORT_COLUMNS.map(([key,label])=>key==='baseline'?report.baselineYear+' 基數':label)],
    ...[...report.rows,report.totals].map(row=>[row.label,...REPORT_COLUMNS.map(([key])=>reportNumber(row[key],key))])];
  return '\uFEFF'+lines.map(row=>row.map(cell).join(',')).join('\r\n');
}
