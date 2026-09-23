import { columns } from './fleet-model';
import { icon } from './icons';

// Move only displayed columns; hidden columns keep their saved slots.
export function reorderedColumns(order: string[], visible: string[], key: string, index: number) {
  const moved=visible.filter(k=>k!==key);
  moved.splice(index,0,key);
  let position=0;
  return order.map(k=>visible.includes(k) ? moved[position++] : k);
}

export function bindFleetHeaders(wrap: HTMLElement, reorder: (key: string, index: number) => void) {
  const head=wrap.querySelector('thead')!;
  const abort=new AbortController();
  const status=document.getElementById('fleet-column-status')!;
  const headers=()=>[...head.querySelectorAll<HTMLElement>('th[data-column]')];
  let drag: {key:string;button:HTMLButtonElement;pointer:number;startX:number;startY:number;x:number;y:number;index:number;ghost?:HTMLElement} | undefined;
  let frame=0, suppressClick=false;
  function marker() {
    headers().forEach(h=>h.classList.remove('header-drop-before','header-drop-after'));
    if(!drag?.ghost) return;
    const others=headers().filter(h=>h.dataset.column!==drag!.key);
    const index=others.findIndex(h=>{const box=h.getBoundingClientRect();return drag!.x<box.left+box.width/2;});
    drag.index=index<0 ? others.length : index;
    (index<0 ? others.at(-1) : others[index])?.classList.add(index<0?'header-drop-after':'header-drop-before');
    const box=wrap.getBoundingClientRect();
    drag.ghost.style.left=`${Math.max(box.left,Math.min(drag.x-48,box.right-drag.ghost.offsetWidth))}px`;
  }
  function scroll() {
    if(!drag?.ghost) return;
    if(!wrap.isConnected) {finish(false);return;}
    const bounds=wrap.getBoundingClientRect();
    const speed=drag.x<bounds.left+40 ? -Math.min(14,(bounds.left+40-drag.x)/3) : drag.x>bounds.right-40 ? Math.min(14,(drag.x-bounds.right+40)/3) : 0;
    if(speed) {wrap.scrollLeft+=speed;marker();}
    frame=requestAnimationFrame(scroll);
  }
  function finish(commit: boolean) {
    if(!drag) return;
    const ended=drag;drag=undefined;cancelAnimationFrame(frame);
    ended.ghost?.remove();
    head.classList.remove('is-reordering');
    headers().forEach(h=>h.classList.remove('header-drop-before','header-drop-after','header-dragging'));
    if(ended.button.hasPointerCapture(ended.pointer)) ended.button.releasePointerCapture(ended.pointer);
    if(!ended.ghost) return;
    suppressClick=true;
    if(commit) reorder(ended.key,ended.index);
    else status.textContent='Column reordering canceled.';
  }
  head.addEventListener('click',event=>{
    if(suppressClick && event.detail>0) {event.preventDefault();event.stopImmediatePropagation();}
    suppressClick=false;
  },true);
  head.addEventListener('pointerdown',event=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('[data-sort-column]');
    if(!button || event.button!==0 || !event.isPrimary || drag) return;
    suppressClick=false;
    const key=button.dataset.sortColumn!;
    drag={key,button,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,index:headers().findIndex(h=>h.dataset.column===key)};
    button.setPointerCapture(event.pointerId);
  });
  head.addEventListener('pointermove',event=>{
    if(!drag || drag.pointer!==event.pointerId) return;
    drag.x=event.clientX;drag.y=event.clientY;
    if(!drag.ghost && Math.hypot(drag.x-drag.startX,drag.y-drag.startY)>6) {
      const th=drag.button.closest('th')!;
      const box=th.getBoundingClientRect();
      const ghost=document.createElement('div');
      ghost.className='fleet-header-drag';ghost.setAttribute('aria-hidden','true');
      ghost.innerHTML=`${icon('grip')}<span>${columns[drag.key].label}</span>`;
      ghost.style.top=`${box.top}px`;document.body.append(ghost);drag.ghost=ghost;
      th.classList.add('header-dragging');head.classList.add('is-reordering');
      frame=requestAnimationFrame(scroll);
    }
    if(drag.ghost) {event.preventDefault();marker();}
  });
  head.addEventListener('pointerup',event=>{if(event.pointerId===drag?.pointer) finish(true);});
  head.addEventListener('pointercancel',()=>finish(false));
  head.addEventListener('lostpointercapture',()=>finish(false));
  document.addEventListener('keydown',event=>{
    if(drag && event.key==='Escape') {event.preventDefault();event.stopPropagation();finish(false);return;}
    const key=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-sort-column]')?.dataset.sortColumn;
    if(!key || !head.contains(event.target as Node) || !event.altKey || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const from=headers().findIndex(h=>h.dataset.column===key);
    const to=Math.max(0,Math.min(headers().length-1,from+(event.key==='ArrowLeft'?-1:1)));
    if(from!==to) reorder(key,to);
  },{signal:abort.signal});
  return ()=>{finish(false);abort.abort();};
}
