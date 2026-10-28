import { createHmac, randomBytes } from 'node:crypto';
import { ensure, AppError } from './errors.mjs';
import { AttendanceService } from './service.mjs';
import { ChlifeAdapter } from './upstream.mjs';
import { ReportService } from './reports.mjs';
import baselines from './report-config.json' with { type: 'json' };

export function configuredGroups(json, { secret = randomBytes(32).toString('hex'), now, adapterFactory = entry => new ChlifeAdapter(entry) } = {}) {
  const result = new Map();
  if (!json) return result;
  let config;
  try { config = JSON.parse(json); } catch { throw new AppError(500,'GROUP_CONFIG','大組入口設定格式錯誤，請管理者檢查機密設定。'); }
  ensure(config && !Array.isArray(config) && Array.isArray(config.accounts) && config.accounts.length <= 8 && Array.isArray(config.links) && config.links.length <= 8,500,'GROUP_CONFIG','大組入口設定格式錯誤。');
  const adapters = new Map();
  for (const entry of config.accounts) {
    ensure(entry && /^[a-z][a-z0-9-]{0,39}$/.test(entry.key) && !adapters.has(entry.key) && Number.isSafeInteger(entry.churchId) && entry.churchId > 0 && typeof entry.account === 'string' && entry.account && typeof entry.password === 'string' && entry.password,500,'GROUP_CONFIG','大組帳號設定不完整或代碼重複。');
    adapters.set(entry.key,adapterFactory(entry));
  }
  for (const link of config.links) {
    ensure(link && typeof link.group === 'string' && /^[1-8]$/.test(link.group) && !result.has(link.group) && adapters.has(link.source) && Number.isSafeInteger(link.groupId) && link.groupId > 0 && (link.allowWrites === undefined || typeof link.allowWrites === 'boolean'),500,'GROUP_CONFIG','大組入口設定不完整或重複。');
    const base = adapters.get(link.source), siteKey='group-'+link.group;
    const adapter = {
      mode:base.mode, churchId:base.churchId,
      async metadata(week) {
        if (base.authenticate) { const auth=await base.authenticate();ensure(!auth.user.report_only,403,'GROUP_READ_ONLY','這個來源是純報表帳號，尚不能啟用點名入口。'); }
        const meta=await base.metadata(week);
        const scopes=meta.scopes.filter(s=>s.ids?.[1]===base.churchId && s.ids?.[2]===link.groupId);
        ensure(scopes.some(s=>s.level===3),403,'GROUP_SCOPE','此帳號沒有這個大組的完整小區權限，請聯絡管理者。');
        return {...meta,scopes,group:scopes[0].path.split(' / ')[0]};
      },
      roster:(...args)=>base.roster(...args),setAttendance:(...args)=>base.setAttendance(...args),reportCounts:(...args)=>base.reportCounts(...args)
    };
    const scopedSecret=createHmac('sha256',secret).update(siteKey+':'+base.churchId+':'+link.groupId).digest('hex');
    const service=new AttendanceService(adapter,{...(now?{now}:{}),secret:scopedSecret,allowWrites:link.allowWrites===true});
    const metadata=service.metadata.bind(service);service.metadata=async()=>({...await metadata(),siteKey});
    // A group URL exposes only its own source. It cannot enumerate or switch to the legacy source.
    const reports=new ReportService([{key:'primary',label:'本大組',adapter}],{...(now?{now}:{}),baselines:{primary:baselines[siteKey] ?? {}}});
    result.set(link.group,{service,reports});
  }
  return result;
}
