const numerals=['','一','二','三','四','五','六','七','八'];
export function parseGroupContext(search='') {
  const values=new URLSearchParams(search).getAll('group');
  if(!values.length)return {id:null,invalid:false};
  if(values.length!==1 || !/^[1-8]$/.test(values[0]))return {id:null,invalid:true};
  return {id:values[0],invalid:false,label:'第'+numerals[Number(values[0])]+'大組'};
}
export function groupApiPath(path,context) {
  if(context.invalid)throw new Error('大組連結無效，請使用管理者提供的完整網址。');
  if(!context.id)return path;
  if(!path.startsWith('/api/'))throw new Error('大組連結無效。');
  return '/api/groups/'+context.id+'/'+path.slice(5);
}
export function groupHref(href,context) { return context.id ? href.split('?')[0]+'?group='+context.id : href; }
export function groupManifest(base,id) {
  if(!/^[1-8]$/.test(id))throw new Error('大組連結無效。');
  return {...base,id:'./?group='+id,start_url:'./?group='+id,name:'一起點名 · 第'+numerals[Number(id)]+'大組',short_name:numerals[Number(id)]+'大組點名'};
}
export function applyGroupContext(context,doc) {
  if(!context.id)return;
  for(const a of doc.querySelectorAll('.brand,.page-nav a'))a.setAttribute('href',groupHref(a.getAttribute('href'),context));
  const manifest=doc.querySelector('link[rel="manifest"]');if(manifest)manifest.setAttribute('href','./manifest-group-'+context.id+'.webmanifest');
  const subtitle=doc.querySelector('.brand small');if(subtitle)subtitle.textContent=context.label+' · 點名與報表';
  const group=doc.getElementById('group-label');if(group)group.textContent=context.label;
  const church=doc.getElementById('report-church');if(church)church.textContent=context.label;
  doc.title=context.label+' · '+doc.title;
}
