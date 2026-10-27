export function readingState({scrollTop=0,scrollHeight=0,clientHeight=0}={}){
 const extent=Math.max(0,Number(scrollHeight)-Number(clientHeight));
 const top=Math.min(extent,Math.max(0,Number(scrollTop)||0));
 const scrollable=extent>1,atEnd=!scrollable||extent-top<=2;
 return{extent,top,scrollable,atEnd,percent:scrollable?Math.min(100,top/extent*100):100};
}
export function scrollPosition(percent,extent){return Math.max(0,Number(extent)||0)*Math.min(100,Math.max(0,Number(percent)||0))/100;}

/** A persistent, keyboard-accessible reading rail independent of OS scrollbar settings. */
export function bindResumeReader({dialog,scroller,slider,progress,more,section,body,onSection,reducedMotion=false}){
 const lifecycle=new AbortController();let frame=0,destroyed=false;
 const listen=(el,type,handler,options={})=>el.addEventListener(type,handler,{...options,signal:lifecycle.signal});
 function update(){
  frame=0;if(destroyed)return;const state=readingState(scroller);
  slider.disabled=!state.scrollable;slider.value=state.percent;
  slider.setAttribute('aria-valuetext',state.scrollable?`${Math.round(state.percent)}% of section read`:'Entire section visible');
  progress.textContent=`${Math.round(state.percent)}%`;
  dialog.dataset.more=String(state.scrollable&&!state.atEnd);
  slider.style.setProperty('--read-progress',`${state.percent}%`);
  more.disabled=!state.scrollable;
  more.querySelector('span').textContent=!state.scrollable?'All content visible':state.atEnd?'Back to top':'More below';
  more.querySelector('b').textContent=state.atEnd?'↑':'↓';
  more.setAttribute('aria-label',!state.scrollable?'All content is visible':state.atEnd?'Return to the top of this section':'Scroll down to read more of this section');
 }
 const schedule=()=>{if(!frame&&!destroyed)frame=requestAnimationFrame(update);};
 listen(scroller,'scroll',schedule,{passive:true});
 listen(slider,'input',()=>{scroller.scrollTop=scrollPosition(slider.value,readingState(scroller).extent);update();});
 listen(more,'click',()=>{const state=readingState(scroller);scroller.scrollTo({top:state.atEnd?0:Math.min(state.extent,state.top+scroller.clientHeight*.72),behavior:reducedMotion?'instant':'smooth'});});
 listen(section,'change',()=>onSection(section.value));
 const resize=new ResizeObserver(schedule);resize.observe(scroller);resize.observe(body);
 const changes=new MutationObserver(schedule);changes.observe(body,{childList:true,subtree:true});
 listen(window,'resize',schedule);
 return{open(id,label){section.value=id;slider.setAttribute('aria-label',`Scroll through ${label}`);scroller.setAttribute('aria-label',`${label} resume content`);scroller.scrollTop=0;update();schedule();},destroy(){destroyed=true;lifecycle.abort();resize.disconnect();changes.disconnect();if(frame)cancelAnimationFrame(frame);}};
}
