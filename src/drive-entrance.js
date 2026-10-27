// A deterministic two-gesture entrance. The second gesture may arrive during
// the approach; it is queued so a quick double tap never feels unresponsive.
export function createDriveEntrance({reducedMotion=false,onChange=()=>{}}={}){
 const duration={approach:reducedMotion?.08:1.85,reveal:reducedMotion?.12:1.7};
 let phase='idle',elapsed=0,queued=false;
 const emit=()=>onChange(phase);
 const change=value=>{phase=value;elapsed=0;emit();};
 return {
  begin(){queued=false;change('approach');},
  reveal(){if(phase==='approach')queued=true;else if(phase==='ready')change('reveal');},
  cancel(){if(phase!=='idle'){queued=false;change('idle');}},
  update(dt){if(!Number.isFinite(dt)||dt<=0)return this.state();if(phase==='approach'||phase==='reveal'){elapsed+=Math.min(dt,.1);if(elapsed>=duration[phase]){if(phase==='approach')change(queued?'reveal':'ready');else change('idle');}}return this.state();},
  state(){const progress=phase==='ready'?1:Math.min(1,elapsed/(duration[phase]||1));return{phase,active:phase!=='idle',progress,eased:progress*progress*(3-2*progress),queued};}
 };
}
