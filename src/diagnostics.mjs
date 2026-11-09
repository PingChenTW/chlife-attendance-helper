import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';

const contexts = new AsyncLocalStorage();
const stages = new Set(['helper','initialize','upstream-login','upstream-refresh','upstream-directory','upstream-meetings','upstream-roster','upstream-attendance','upstream-report']);
export function createRequestTrace(url, defaultGroup, writer) {
  let path; try { path = new URL(url, 'http://localhost').pathname; } catch { return null; }
  const match = path.match(/^\/api\/groups\/([1-8])\/(.+)$/);
  const group = match?.[1] ?? defaultGroup;
  if (match) path = '/api/' + match[2];
  const operation = ({ '/api/meta':'metadata', '/api/roster':'roster', '/api/attendance':'attendance', '/api/reports/meta':'report-metadata', '/api/reports/weekly':'report', '/api/reports/summary':'report' })[path];
  if (!operation) return null;
  return { requestId:randomUUID(), group:/^[1-8]$/.test(group ?? '') ? group : null, operation, started:Date.now(), writer };
}
export const diagnosticScope = (context, action) => contexts.run(context, action);
export const errorStage = error => stages.has(error?.diagnosticStage) ? error.diagnosticStage : 'helper';
export function emitDiagnostic(event, stage, { durationMs = 0, error, status } = {}) {
  const context = contexts.getStore(); if (!context) return;
  const row = { type:'attendance-diagnostic', at:new Date().toISOString(), requestId:context.requestId, group:context.group, operation:context.operation,
    event, stage:stages.has(stage) ? stage : 'helper', durationMs:Math.max(0,Math.min(600000,Math.round(durationMs))) };
  if (error) row.code = error instanceof AppError && /^[A-Z_]{1,50}$/.test(error.code) ? error.code : 'INTERNAL_ERROR';
  if (Number.isInteger(status) && status >= 100 && status <= 599) row.status = status;
  if (Number.isInteger(error?.upstreamStatus) && error.upstreamStatus >= 100 && error.upstreamStatus <= 599) row.upstreamStatus = error.upstreamStatus;
  try { context.writer?.(row); } catch { /* Logging must not affect the original operation. */ }
}
export async function traceStage(stage, action) {
  const started = Date.now(); emitDiagnostic('start',stage);
  try { const value = await action(); emitDiagnostic('complete',stage,{durationMs:Date.now()-started}); return value; }
  catch (error) {
    try { if (!stages.has(error.diagnosticStage)) error.diagnosticStage = stage; } catch { /* Immutable or non-object errors remain generic. */ }
    emitDiagnostic('error',stage,{durationMs:Date.now()-started,error,status:error?.status}); throw error;
  }
}
