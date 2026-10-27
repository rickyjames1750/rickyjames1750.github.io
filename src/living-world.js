import * as T from 'three';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const UP=new T.Vector3(0,1,0);
const MOD=(n,d)=>((n%d)+d)%d;
function roundedCube(){
  const s=new T.Shape();s.moveTo(-.38,-.38);s.lineTo(.38,-.38);s.lineTo(.38,.38);s.lineTo(-.38,.38);s.closePath();
  const g=new T.ExtrudeGeometry(s,{depth:.76,bevelEnabled:true,bevelSegments:2,steps:1,bevelThickness:.12,bevelSize:.12});g.translate(0,0,-.38);return g;
}
function leafGeometry(){
  const edge=[[-.07,0,-.085],[0,0,-.17],[.075,0,-.07],[.09,0,.04],[0,0,.16],[-.085,0,.045]],positions=[],uv=[];
  for(let i=0;i<edge.length;i++){const a=edge[i],b=edge[(i+1)%edge.length];positions.push(0,.022,0,...a,...b);uv.push(.5,.5,(a[0]+.1)/.2,(a[2]+.17)/.34,(b[0]+.1)/.2,(b[2]+.17)/.34);}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}

/** Small bounded actors, independent of the vehicle/rail simulation and its collision domain. */
export function createLivingWorld({scene,roadCurve,railCurve,corridors,bridgeDrive,zones=[],reducedMotion=false,isOnLand=()=>true,sampleHeight=()=>.825,quality='high'}={}) {
  if(!scene||!roadCurve?.getPointAt)throw new TypeError('Living world requires a scene and driving curve.');
  const root=new T.Group();root.name='Living Peninsula — original robots, drones, and leaves';scene.add(root);
  const ownedGeometries=new Set(),ownedMaterials=new Set(),batches=[];
  function ownGeometry(g){ownedGeometries.add(g);return g;}
  function material(color,extra={}){const m=new T.MeshStandardMaterial({color,roughness:.58,metalness:.25,...extra});ownedMaterials.add(m);return m;}
  const palette={
    teal:material('#528f88'),paper:material('#d1ddd1',{roughness:.42}),dark:material('#19343e',{metalness:.5}),
    mint:material('#9fe4cf',{emissive:'#5ed4ba',emissiveIntensity:.9}),warm:material('#dcb47b',{emissive:'#9c6328',emissiveIntensity:.28}),
    metal:material('#849c9e',{metalness:.65,roughness:.35}),leaf:material('#c5a36b',{side:T.DoubleSide,metalness:0,roughness:.94,emissive:'#34291a',emissiveIntensity:.12}),
  };
  function batch(g,m,capacity){const mesh=new T.InstancedMesh(g,m,capacity);mesh.count=0;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=false;root.add(mesh);batches.push(mesh);return mesh;}
  const cube=ownGeometry(roundedCube()),sphere=ownGeometry(new T.IcosahedronGeometry(1,1)),cylinder=ownGeometry(new T.CylinderGeometry(.5,.5,1,8));
  const boxBatches=Object.fromEntries(Object.entries(palette).filter(([k])=>k!=='leaf').map(([key,m])=>[key,batch(cube,m,280)]));
  const metalRods=batch(cylinder,palette.metal,180),sphereMint=batch(sphere,palette.mint,40),sphereMetal=batch(sphere,palette.metal,80);
  const rotorRings=batch(ownGeometry(new T.TorusGeometry(.19,.012,4,18)),palette.dark,20);
  const padRings=batch(ownGeometry(new T.RingGeometry(.24,.28,28)),palette.mint,12);
  const leaves=batch(ownGeometry(leafGeometry()),palette.leaf,144);
  let seed=8243;const random=()=>((seed=seed*16807%2147483647)-1)/2147483646;
  const pos=new T.Vector3(),size=new T.Vector3(),q=new T.Quaternion(),euler=new T.Euler(),local=new T.Matrix4(),world=new T.Matrix4(),pose=new T.Matrix4(),delta=new T.Vector3(),middle=new T.Vector3();
  function put(mesh,frame,x,y,z,w,h,d,rx=0,ry=0,rz=0){pos.set(x,y,z);size.set(w,h,d);q.setFromEuler(euler.set(rx,ry,rz));local.compose(pos,q,size);world.multiplyMatrices(frame,local);mesh.setMatrixAt(mesh.count++,world);}
  function box(color,frame,x,y,z,w,h,d,rx=0,ry=0,rz=0){put(boxBatches[color],frame,x,y,z,w,h,d,rx,ry,rz);}
  function ball(mesh,frame,x,y,z,r){put(mesh,frame,x,y,z,r,r,r);}
  function rod(frame,a,b,diameter=.06){delta.set(b[0]-a[0],b[1]-a[1],b[2]-a[2]);const length=delta.length();middle.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);q.setFromUnitVectors(UP,delta.multiplyScalar(1/Math.max(.0001,length)));size.set(diameter,length,diameter);local.compose(middle,q,size);world.multiplyMatrices(frame,local);metalRods.setMatrixAt(metalRods.count++,world);}
  const routeLength=roadCurve.getLength();
  const frames=Array.from({length:701},(_,i)=>{const p=roadCurve.getPointAt(i/700),d=roadCurve.getTangentAt(i/700).setY(0).normalize();return {x:p.x,z:p.z,dx:d.x,dz:d.z};});
  function frameAt(t,lateral){const u=clamp(t,0,1)*700,i=Math.min(699,Math.floor(u)),f=u-i,a=frames[i],b=frames[i+1],dx=a.dx+(b.dx-a.dx)*f,dz=a.dz+(b.dz-a.dz)*f,norm=Math.hypot(dx,dz)||1;return {x:a.x+(b.x-a.x)*f+dz/norm*lateral,z:a.z+(b.z-a.z)*f-dx/norm*lateral,heading:Math.atan2(dx,dz)};}
  function railClear(x,z,r=.3){return !corridors?.railClearance||corridors.railClearance({x,z,r})>.05;}
  function valid(x,z,r=.3){return isOnLand(x,z)&&railClear(x,z,r)&&!bridgeDrive?.contains(x,z,r+.15);}
  function closest(zone){let best=0,distance=Infinity;for(let i=0;i<frames.length;i++){const p=frames[i],d=(p.x-zone.x)**2+(p.z-zone.z)**2;if(d<distance){distance=d;best=i/700;}}return best;}
  const candidates=[.035,.075,...zones.map(closest),.16,.39,.63,.83,.96];
  const robots=[],drones=[],pads=[];
  for(const t of candidates){if(robots.length>=8)break;const side=robots.length%3===2?1:-1,lateral=side*2.75,extent=2.1;
    if(robots.some(r=>Math.abs(r.t-t)*routeLength<4))continue;
    const probes=[-extent,-extent/2,0,extent/2,extent].map(d=>frameAt(t+d/routeLength,lateral));if(probes.some(p=>!valid(p.x,p.z,.22)))continue;
    robots.push({t,lateral,extent,phase:random()*Math.PI*2,size:.78+random()*.13,heading:null});
  }
  for(const t of [.07,...zones.map(closest),.48,.78]){if(drones.length>=4)break;if(drones.some(d=>Math.abs(d.t-t)*routeLength<9))continue;
    const probes=[-4,0,4].map(d=>frameAt(t+d/routeLength,-3.05));if(probes.some(p=>!valid(p.x,p.z,.65)))continue;
    drones.push({t,phase:random()*Math.PI*2,heading:frameAt(t,-3.05).heading,position:new T.Vector3(),speed:0,positioned:false});
    const p=frameAt(t,-2.82);if(valid(p.x,p.z,.35))pads.push({...p,y:.827});
  }
  const leafStates=Array.from({length:144},(_,i)=>{
    let t=i<48?.025+random()*.14:.04+random()*.91,p=frameAt(t,0);
    for(let tries=0;tries<12&&!valid(p.x,p.z,.25);tries++){t=.04+random()*.91;p=frameAt(t,0);}
    return {t,phase:random()*9,period:6+random()*4,spin:random()*Math.PI*2,size:.55+random()*.6,refresh:random()*.4,ground:.79};
  });
  for(let i=0;i<144;i++)leaves.setColorAt(i,new T.Color().setHSL(.09+random()*.06,.24+random()*.23,.42+random()*.18));
  if(leaves.instanceColor)leaves.instanceColor.needsUpdate=true;
  root.userData.reservations={robotPaths:robots.map(r=>({t:r.t,lateral:r.lateral,extent:r.extent})),dronePaths:drones.map(d=>({t:d.t,lateral:-3.05,altitude:4.9})),pads:pads.map(p=>({...p,r:.28}))};
  let clock=0,lastQuality='',rendered=false,disposed=false,actorsPaused=true,counts={robots:0,drones:0,leaves:0};
  const audioPosition=new T.Vector3(),nearestPosition=new T.Vector3();
  function robot(r,index,carPosition,dt){
    const travel=reducedMotion?0:Math.sin(clock*.38+r.phase)*r.extent,t=r.t+travel/routeLength,p=frameAt(t,r.lateral);
    const toward=reducedMotion?1:Math.cos(clock*.38+r.phase),walking=!reducedMotion;
    const desired=p.heading+(toward<0?Math.PI:0),gait=walking?clock*5.9+r.phase:0;
    if(r.heading===null)r.heading=desired;else r.heading+=Math.atan2(Math.sin(desired-r.heading),Math.cos(desired-r.heading))*Math.min(1,dt*4);
    const heading=r.heading;
    const near=carPosition&&Math.hypot(carPosition.x-p.x,carPosition.z-p.z)<2.6;
    const floor=Math.max(.825,Number(sampleHeight(p.x,p.z))||.825);
    pos.set(p.x,floor+(walking?Math.abs(Math.sin(gait))*.009:0),p.z);q.setFromEuler(euler.set(0,heading,0));size.setScalar(r.size);pose.compose(pos,q,size);
    box('teal',pose,0,.57,0,.3,.37,.22);box('dark',pose,0,.365,0,.22,.09,.17);box('paper',pose,0,.91,0,.32,.25,.245);
    box('dark',pose,0,.925,.128,.266,.13,.018);for(const x of [-.068,.068])box('mint',pose,x,.93,.141,.052,.026,.012);
    box('warm',pose,0,.62,.12,.09,.045,.014);box('dark',pose,0,.55,-.17,.25,.27,.12);box('warm',pose,0,.55,-.238,.14,.13,.02);
    rod(pose,[.08,1.045,-.02],[.08,1.16,-.02],.012);ball(sphereMint,pose,.08,1.175,-.02,.025);
    for(const side of [-1,1]){
      const phase=gait+(side<0?Math.PI:0),step=walking?Math.cos(phase)*.13:0,lift=walking?Math.max(0,Math.sin(phase))*.055:0;
      const hip=[side*.102,.36,0],knee=[side*.105,.2,step*.6+.018],ankle=[side*.105,.07+lift,step];
      rod(pose,hip,knee,.065);rod(pose,knee,ankle,.06);ball(sphereMetal,pose,...knee,.045);box('dark',pose,side*.105,.044+lift,step+.035,.115,.078,.18);
      const wave=near&&side<0&&!reducedMotion,arm=walking?Math.sin(phase)*.07:0;
      const shoulder=[side*.19,.73,0],elbow=wave?[side*.28,.89,.03]:[side*.225,.54,-arm],hand=wave?[side*.32,1.07+Math.sin(clock*7)*.035,.06]:[side*.22,.39,-arm*1.6];
      ball(sphereMetal,pose,...shoulder,.052);rod(pose,shoulder,elbow,.06);rod(pose,elbow,hand,.055);ball(sphereMetal,pose,...hand,.047);
    }
  }
  function drone(d,index,dt){
    const travel=reducedMotion?0:Math.sin(clock*.19+d.phase)*4,p=frameAt(d.t+travel/routeLength,-3.05+(reducedMotion?0:Math.sin(clock*.27+d.phase)*.12));
    const desired=p.heading+(!reducedMotion&&Math.cos(clock*.19+d.phase)<0?Math.PI:0),diff=Math.atan2(Math.sin(desired-d.heading),Math.cos(desired-d.heading));d.heading+=diff*Math.min(1,dt*1.5);
    pos.set(p.x,4.9+(reducedMotion?0:Math.sin(clock*1.7+d.phase)*.13),p.z);
    d.speed=d.positioned&&dt>0?pos.distanceTo(d.position)/dt:0;d.position.copy(pos);d.positioned=true;
    q.setFromEuler(euler.set(reducedMotion?0:Math.sin(clock*.8+d.phase)*.035,d.heading,reducedMotion?0:Math.sin(clock*.5+d.phase)*.07,'YXZ'));size.setScalar(.92);pose.compose(pos,q,size);
    box('paper',pose,0,.02,0,.42,.14,.32);box('teal',pose,0,.105,0,.3,.065,.24);box('warm',pose,0,-.18,0,.25,.23,.22);box('dark',pose,0,-.19,.117,.13,.075,.025);
    box('mint',pose,0,.02,.17,.21,.025,.014);box('dark',pose,0,-.07,.14,.09,.09,.09);ball(sphereMetal,pose,0,-.07,.192,.04);
    for(const x of [-.35,.35])for(const z of [-.28,.28]){
      rod(pose,[0,.025,0],[x,.09,z],.04);put(rotorRings,pose,x,.105,z,1,1,1,Math.PI/2);
      const angle=reducedMotion?index:clock*55*(x*z>0?1:-1)+index;
      for(const rotation of [0,Math.PI/2])box('metal',pose,x,.108,z,.31,.008,.03,0,angle+rotation,0);
      box(x<0?'warm':'mint',pose,x,.066,z,.028,.024,.04);
    }
  }
  function update({dt=0,time,carPosition,carVelocity=0,paused=false,quality:nextQuality=quality}={}){
    if(disposed)return;
    actorsPaused=Boolean(paused||reducedMotion);
    const level=nextQuality==='eco'?'eco':'high';if((paused||reducedMotion)&&rendered&&level===lastQuality)return;
    dt=clamp(Number.isFinite(dt)?dt:0,0,.05);if(!paused&&!reducedMotion)clock+=dt;
    for(const mesh of batches)mesh.count=0;
    const previouslyVisibleDrones=counts.drones;
    counts={robots:Math.min(robots.length,reducedMotion?4:level==='eco'?4:8),drones:Math.min(drones.length,reducedMotion?2:level==='eco'?2:4),leaves:reducedMotion?24:level==='eco'?48:144};
    for(let i=0;i<counts.robots;i++)robot(robots[i],i,carPosition,paused||reducedMotion?0:dt);
    for(let i=0;i<counts.drones;i++)drone(drones[i],i,paused||reducedMotion||i>=previouslyVisibleDrones?0:dt);
    for(const pad of pads.slice(0,counts.drones)){
      pos.set(pad.x,pad.y,pad.z);q.setFromEuler(euler.set(-Math.PI/2,0,0));size.setScalar(1);world.compose(pos,q,size);padRings.setMatrixAt(padRings.count++,world);
      pos.set(pad.x,pad.y+.001,pad.z);q.setFromEuler(euler.set(0,pad.heading,0));pose.compose(pos,q,size);
      box('mint',pose,0,0,0,.045,.002,.23,0,0,-.3);box('mint',pose,.04,0,.035,.13,.002,.035);
    }
    for(let i=0;i<counts.leaves;i++){
      const leaf=leafStates[i],fraction=reducedMotion?MOD(leaf.phase,1):MOD(clock+leaf.phase,leaf.period)/leaf.period;
      const lateral=(fraction-.5)*7.2,t=leaf.t+(reducedMotion?0:Math.sin(clock*.2+leaf.phase)*.7/routeLength),p=frameAt(t,lateral);
      if(bridgeDrive?.contains(p.x,p.z,.25)){size.setScalar(0);world.compose(pos.set(p.x,-10,p.z),q.identity(),size);leaves.setMatrixAt(i,world);continue;}
      leaf.refresh-=dt;
      if(leaf.refresh<=0||!rendered){leaf.ground=Number(sampleHeight(p.x,p.z))||.6;leaf.refresh=.4;}
      const wake=carPosition?Math.max(0,1-Math.hypot(carPosition.x-p.x,carPosition.z-p.z)/2.1)*Math.min(1,Math.abs(carVelocity)/8):0;
      const lift=reducedMotion?.015:.025+Math.abs(Math.sin(fraction*Math.PI*5+leaf.phase))*.09+wake*.17;
      pos.set(p.x,leaf.ground+lift,p.z);q.setFromEuler(euler.set(reducedMotion?0:clock*1.7+leaf.phase,p.heading+leaf.spin,reducedMotion?.12:Math.sin(clock*2+leaf.spin)*1.25));size.setScalar(leaf.size);world.compose(pos,q,size);leaves.setMatrixAt(i,world);
    }
    leaves.count=counts.leaves;
    for(const mesh of batches)if(mesh.count)mesh.instanceMatrix.needsUpdate=true;
    rendered=true;lastQuality=level;
  }
  update({dt:0,paused:true,quality});
  /** Nearest currently rendered drone, using cached actor poses rather than scene traversal. */
  function nearestDrone(listener){
    if(disposed||!root.parent||!counts.drones||![listener?.x,listener?.y,listener?.z].every(Number.isFinite))return undefined;
    for(let ancestor=root;ancestor;ancestor=ancestor.parent)if(!ancestor.visible)return undefined;
    // Only update this group's ancestor matrices; none of the instanced actors are traversed.
    root.updateWorldMatrix(true,false);
    let nearest,minimum=Infinity;
    for(let i=0;i<counts.drones;i++){
      const drone=drones[i];if(!drone.positioned)continue;
      audioPosition.copy(drone.position).applyMatrix4(root.matrixWorld);
      const distance=Math.hypot(audioPosition.x-listener.x,audioPosition.y-listener.y,audioPosition.z-listener.z);
      if(distance<minimum){minimum=distance;nearest=drone;nearestPosition.copy(audioPosition);}
    }
    return nearest?{position:nearestPosition.clone(),distance:minimum,speed:actorsPaused?0:nearest.speed*root.matrixWorld.getMaxScaleOnAxis()}:undefined;
  }
  return {
    root,update,nearestDrone,
    get stats(){return {...counts,drawCalls:batches.filter(m=>m.count>0).length,chargingPads:pads.length,reducedMotion,actorsBounded:true};},
    dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const mesh of batches)mesh.dispose();for(const g of ownedGeometries)g.dispose();for(const m of ownedMaterials)m.dispose();},
  };
}
