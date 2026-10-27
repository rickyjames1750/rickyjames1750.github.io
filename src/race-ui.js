import {createRaceCurve} from './bay-race.js';

export function raceTime(value){
 if(!Number.isFinite(value))return '—';
 const centiseconds=Math.round(Math.max(0,value)*100),minutes=Math.floor(centiseconds/6000),seconds=(centiseconds%6000)/100;
 return `${minutes}:${seconds.toFixed(2).padStart(5,'0')}`;
}
export const ordinal=value=>`${value}${value===1?'st':value===2?'nd':value===3?'rd':'th'}`;

/** Optional racing leaves the reading experience and its navigation available at all times. */
export function bindRaceUI({world,ambience,root,onExplore=()=>{}}){
 const lifecycle=new AbortController(),listen=(el,type,handler,options={})=>el.addEventListener(type,handler,{...options,signal:lifecycle.signal});
 const launch=document.createElement('button');launch.id='race-launch';launch.className='race-launch';launch.innerHTML='<span>⚑ Race the Bay</span><small>3 laps · about 90 seconds</small>';
 const shortcuts=document.createElement('div');shortcuts.className='portfolio-shortcuts';const quickWork=document.querySelector('.quick-work');quickWork.replaceWith(shortcuts);shortcuts.append(quickWork,launch);
 const driveLaunch=document.createElement('button');driveLaunch.id='race-drive-launch';driveLaunch.innerHTML='⚑ <span>Bay Circuit</span>';document.querySelector('.drive-options').append(driveLaunch);
 const layer=document.createElement('section');layer.id='race-layer';layer.hidden=true;layer.setAttribute('aria-label','Bay Circuit race');layer.innerHTML=`
 <div class="race-topline"><div><span class="eyebrow">BAY CIRCUIT / THREE LAPS</span><strong id="race-city">San Francisco</strong></div><button id="race-exit">Exit race <span>↗</span></button></div>
 <div class="race-score"><div><strong id="race-place">1st</strong><span>OF 4</span></div><div><small>LAP</small><b id="race-lap">1 / 3</b></div><div><small>TIME</small><b id="race-clock">0:00.00</b></div></div>
 <aside class="race-map" aria-label="Race circuit map"><svg id="race-map-svg" viewBox="0 0 150 180" aria-hidden="true"></svg><span>ONE BAY. FULL CIRCLE.</span></aside>
 <div id="race-countdown" role="status" aria-live="assertive"><span>GET READY</span><strong>3</strong><small>Auto acceleration on · steer to race</small></div>
 <div class="race-power"><span>BOOST <b id="race-charge">100%</b></span><div><i id="race-charge-bar"></i></div><small>Auto acceleration · arrows or joystick to steer</small></div>
 <div class="race-pedals"><button id="race-brake">Ⅱ <span>Brake</span><kbd>Space</kbd></button><button id="race-boost">ϟ <span>Boost</span><kbd>Shift</kbd></button></div>`;
 root.append(layer);
 const menu=document.createElement('dialog');menu.id='race-menu';menu.className='race-dialog';menu.setAttribute('aria-labelledby','race-menu-title');menu.innerHTML=`<button class="race-dialog-close" aria-label="Close race menu">×</button><span class="eyebrow">A LITTLE FRIENDLY COMPETITION</span><h2 id="race-menu-title">Around the Bay.<br><em>Ahead of the pack.</em></h2><p>A scenic skyway from San Francisco down the Peninsula, through Fremont and Oakland, and home across the Bay Bridge.</p><div class="race-facts"><span><b>3</b> laps</span><span><b>3</b> rivals</span><span><b>~90s</b> to finish</span></div><ol class="race-how"><li><b>Just steer.</b> Acceleration is automatic. Drag the right-hand joystick or use ← →.</li><li><b>Catch the lead.</b> Hold Boost or Shift when the road is clear. The meter recharges.</li><li><b>Stay in the middle.</b> Soft barriers keep you on track. Brake with the button or Space.</li></ol><button id="race-start" class="primary">Let’s race <span>↗</span></button><button class="race-menu-back text-button">Back to portfolio</button>`;
 const results=document.createElement('dialog');results.id='race-results';results.className='race-dialog';results.setAttribute('aria-labelledby','race-result-title');results.innerHTML=`<span class="eyebrow">BAY CIRCUIT / FINISH LINE</span><h2 id="race-result-title">You made the loop.</h2><div class="race-result-stats"><strong id="race-result-place">1st</strong><div><span>FINISH TIME</span><b id="race-result-time"></b><small id="race-best-lap"></small></div></div><ol id="race-standings" aria-label="Final standings"></ol><p id="race-result-message"></p><div class="race-result-actions"><button id="race-again" class="primary">Race again <span>↺</span></button><button id="race-portfolio">Explore my work <span>↗</span></button></div>`;
 document.querySelector('#app').append(menu,results);
 const $=id=>document.getElementById(id);let finishTimer=null,phase='idle',lastFocus=null;
 const curve=createRaceCurve({height:9}),points=curve.getSpacedPoints(160);const bounds={minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))};
 const mapPoint=p=>({x:12+(p.x-bounds.minX)/(bounds.maxX-bounds.minX)*126,y:12+(p.z-bounds.minZ)/(bounds.maxZ-bounds.minZ)*155});
 $('race-map-svg').innerHTML=`<path d="${points.map((p,i)=>{const q=mapPoint(p);return `${i?'L':'M'}${q.x.toFixed(2)},${q.y.toFixed(2)}`;}).join(' ')}Z" fill="none" stroke="#b5e6d0" stroke-width="2.5"/><text x="12" y="10">SF</text><text x="101" y="20">OAK</text><text x="109" y="106">FRE</text><text x="13" y="136">MV</text>${['you','nova','milo','rio'].map((id,i)=>`<circle id="map-${id}" r="${i?3:4.6}" fill="${['#ffffff','#f7b168','#74c9f4','#db9ae7'][i]}" stroke="#102d35" stroke-width="1.6"/>`).join('')}`;
 function open(){lastFocus=document.activeElement;world.pause(true);ambience.setPaused(true);menu.showModal();}
 function closeMenu(){menu.close();world.pause(false);ambience.setPaused(false);lastFocus?.focus();}
 function begin(){clearTimeout(finishTimer);finishTimer=null;if(menu.open)menu.close();if(results.open)results.close();world.pause(false);ambience.setPaused(false);world.startRace();$('race-exit').focus();}
 function leave(){clearTimeout(finishTimer);finishTimer=null;if(results.open)results.close();world.pause(false);ambience.setPaused(false);world.cancelRace();document.body.classList.toggle('driving',world.mode()!=='explore');document.querySelector('#joystick').setAttribute('aria-label','Driving joystick: drag up to accelerate, left or right to steer, down to reverse');lastFocus?.focus();}
 for(const el of [launch,driveLaunch])listen(el,'click',open);
 listen(menu.querySelector('.race-dialog-close'),'click',closeMenu);listen(menu.querySelector('.race-menu-back'),'click',closeMenu);listen(menu,'cancel',e=>{e.preventDefault();closeMenu();});
 listen($('race-start'),'click',begin);listen($('race-again'),'click',begin);listen($('race-exit'),'click',leave);listen(results,'cancel',e=>{e.preventDefault();leave();});listen($('race-portfolio'),'click',()=>{leave();onExplore();});
 function hold(button,callback){listen(button,'pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);button.dataset.active='true';callback(true);});const release=()=>{button.dataset.active='false';callback(false);};for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(button,type,release);listen(window,'blur',release);listen(document,'visibilitychange',()=>{if(document.hidden)release();});}
 hold($('race-boost'),v=>world.setRaceBoost(v));hold($('race-brake'),v=>world.setBrake(v));
 function showResults(state){
  if(phase!=='finished')return;if(document.querySelector('dialog[open]')){finishTimer=setTimeout(()=>showResults(state),300);return;}world.pause(true);ambience.setPaused(true);
  $('race-result-title').textContent=state.place===1?'First across the Bay.':'You made the loop.';
  $('race-result-place').textContent=ordinal(state.place);$('race-result-time').textContent=raceTime(state.finishedTime);$('race-best-lap').textContent=`Best lap · ${raceTime(state.bestLap)}`;
  $('race-standings').innerHTML=state.standings.map((d,i)=>`<li class="${d.id==='you'?'race-you':''}"><span>${i+1}</span><i style="background:${d.color}"></i><b>${d.name}</b><small>${d.finished?raceTime(d.finishTime):'Behind you'}</small></li>`).join('');
  $('race-result-message').textContent=state.place===1?'Beautiful driving. Take a victory lap through my work.':'Nice run. Try short boosts on the straights to chase first place.';results.showModal();
 }
 function update(state){
  if(!state)return;phase=state.phase;const active=phase!=='idle';layer.hidden=!active;document.body.classList.toggle('racing',active);document.body.dataset.racePhase=phase;
  for(const el of document.querySelectorAll('.travel-modes,.drive-options,.world-tools,.route-dock'))el.inert=active;
  if(!active){clearTimeout(finishTimer);finishTimer=null;document.querySelector('.joystick-label').textContent='HOLD + DRAG TO DRIVE';return;}
  document.body.classList.remove('joystick-hidden');document.querySelector('.mobile-drive').inert=false;
  document.querySelector('#joystick').setAttribute('aria-label','Race steering joystick: drag left or right; acceleration is automatic');document.querySelector('.joystick-label').textContent='DRAG LEFT / RIGHT TO STEER';
  $('race-place').textContent=ordinal(state.place);$('race-lap').textContent=`${state.lap} / ${state.laps}`;$('race-clock').textContent=raceTime(state.elapsed);$('race-city').textContent=state.city;
  $('race-charge').textContent=Math.round(state.boostEnergy*100)+'%';$('race-charge-bar').style.width=state.boostEnergy*100+'%';$('race-boost').dataset.active=String(state.boosting);
  $('race-countdown').hidden=phase!=='countdown';$('race-countdown').querySelector('strong').textContent=state.countdown;
  for(const driver of state.standings||[]){const q=mapPoint(curve.getPointAt(driver.progress));const dot=$('map-'+driver.id);dot.setAttribute('cx',q.x);dot.setAttribute('cy',q.y);}
  if(phase==='finished'&&!results.open&&!finishTimer)finishTimer=setTimeout(()=>showResults(state),1350);
 }
 return {update,event(event){ambience.raceCue(event.type);},destroy(){clearTimeout(finishTimer);lifecycle.abort();launch.remove();driveLaunch.remove();layer.remove();menu.remove();results.remove();}};
}
