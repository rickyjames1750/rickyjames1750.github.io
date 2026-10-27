import { Group, Vector3 } from 'three';

const controllers=new WeakMap();
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

// Exact underdamped spring step for a target held constant over one frame.
// It remains stable at low frame rates; no Euler integration or frame-dependent impulses.
function spring(position,velocity,target,dt,omega,damping) {
  const alpha=damping*omega,beta=omega*Math.sqrt(1-damping*damping),offset=position-target;
  const decay=Math.exp(-alpha*dt),cos=Math.cos(beta*dt),sin=Math.sin(beta*dt),b=(velocity+alpha*offset)/beta;
  return [target+decay*(offset*cos+b*sin),decay*((-alpha*offset+beta*b)*cos+(-alpha*b-beta*offset)*sin)];
}

/** Whole-vehicle impact flight. Add these offsets to the fresh grounded pose. */
export function createVehicleHop({reducedMotion=false,maxHeight=.72,gravity=10.5}={}) {
  maxHeight=clamp(Number.isFinite(maxHeight)?maxHeight:.72,.4,1);
  gravity=clamp(Number.isFinite(gravity)?gravity:10.5,7,18);
  let age=0,origin=0,launch=0,duration=0,height=0,verticalVelocity=0,airborne=false,cooldown=0;
  const state=()=>{
    const lift=maxHeight?height/maxHeight:0,phase=duration?age/duration:1;
    return {height,verticalVelocity,airborne,pitch:height?lift*Math.sin(phase*Math.PI*2)*.045:0,roll:height?lift*Math.sin(phase*Math.PI*3)*.055:0};
  };
  function reset(){age=origin=launch=duration=height=verticalVelocity=cooldown=0;airborne=false;return state();}
  return {
    state,reset,
    trigger(intensity=1){
      const strength=clamp(Number.isFinite(intensity)?intensity:0,0,1);
      if(reducedMotion||!strength||cooldown>0)return false;
      // Every visible hit has enough lift to read clearly, while overlapping hits
      // can never ratchet the vehicle beyond one bounded flight envelope.
      const peak=Math.min(maxHeight,.45+strength*.23);
      origin=height;launch=Math.sqrt(2*gravity*Math.max(0,peak-origin));age=0;
      duration=(launch+Math.sqrt(launch*launch+2*gravity*origin))/gravity;
      verticalVelocity=launch;airborne=duration>0;cooldown=.08;return airborne;
    },
    update(dt=0,{paused=false}={}){
      if(reducedMotion)return reset();
      if(paused||!Number.isFinite(dt)||dt<=0)return state();
      if(dt>.25)return reset();
      cooldown=Math.max(0,cooldown-dt);
      if(!airborne)return state();
      age=Math.min(duration,age+dt);
      height=clamp(origin+launch*age-gravity*age*age/2,0,maxHeight);
      verticalVelocity=launch-gravity*age;
      if(age>=duration-1e-9){height=verticalVelocity=0;airborne=false;}
      return state();
    },
  };
}

/** Pure braking-response spring; pitch is positive for a forward nose dive. */
export function createBrakeDynamics({maxPitch=.105,maxHeave=.06,frequency=3.4,damping=.42,reducedMotion=false}={}) {
  maxPitch=Math.max(0,maxPitch);maxHeave=Math.max(0,maxHeave);frequency=clamp(frequency,.5,8);damping=clamp(damping,.15,.95);
  const omega=2*Math.PI*frequency;
  let pitch=0,pitchVelocity=0,heave=0,heaveVelocity=0,previousSpeed=0;
  function state(){return {pitch,heave,pitchVelocity,heaveVelocity};}
  function reset(){pitch=pitchVelocity=heave=heaveVelocity=previousSpeed=0;return state();}
  return {
    reset,state,
    update({dt=0,speed=0,acceleration,braking=false,paused=false}={}) {
      if(paused||reducedMotion)return reset();
      if(!Number.isFinite(dt)||dt<=0)return state();
      // A suspended/background turn must not replay a stale braking impulse on return.
      if(dt>.25){reset();previousSpeed=Number.isFinite(speed)?speed:0;return state();}
      dt=Math.min(dt,.1);speed=Number.isFinite(speed)?speed:0;
      const measuredDeceleration=(Math.abs(previousSpeed)-Math.abs(speed))/dt;
      const deceleration=Number.isFinite(acceleration)?Math.max(0,-acceleration):Math.max(0,measuredDeceleration);
      const recentlyMoving=Math.max(Math.abs(speed),Math.abs(previousSpeed))>.6;
      const force=recentlyMoving?clamp((deceleration-1)/10,0,1)*(braking?1:.28):0;
      const direction=Math.sign(speed)||Math.sign(previousSpeed)||1;
      const targetPitch=direction*maxPitch*.86*force,targetHeave=maxHeave*.86*force;
      [pitch,pitchVelocity]=spring(pitch,pitchVelocity,targetPitch,dt,omega,damping);
      [heave,heaveVelocity]=spring(heave,heaveVelocity,targetHeave,dt,omega*1.08,damping+.04);
      if(Math.abs(pitch)>maxPitch){pitch=clamp(pitch,-maxPitch,maxPitch);if(Math.sign(pitchVelocity)===Math.sign(pitch))pitchVelocity=0;}
      if(heave>maxHeave){heave=maxHeave;if(heaveVelocity>0)heaveVelocity=0;}
      if(heave< -maxHeave*.3){heave=-maxHeave*.3;if(heaveVelocity<0)heaveVelocity=0;}
      if(!force&&Math.abs(pitch)<.00002&&Math.abs(pitchVelocity)<.0003)pitch=pitchVelocity=0;
      if(!force&&Math.abs(heave)<.00001&&Math.abs(heaveVelocity)<.00015)heave=heaveVelocity=0;
      previousSpeed=speed;return state();
    },
  };
}

/**
 * Animate only the chassis, leaving the measured wheel groups parented to car.
 * Call update() after groundVehicle()/groundCar(). Terrain pitch/roll and tire contact
 * are never changed. Positive body pitch lowers local +Z (the front) while braking.
 */
export function createVehicleDynamics(car,options={}) {
  if(controllers.has(car))return controllers.get(car);
  const wheels=car.userData?.wheels;
  if(!wheels?.length)throw new TypeError('Braking dynamics requires the vehicle’s measured wheel groups.');
  const body=new Group();body.name='Suspended chassis';
  const pivot=new Vector3(0,.85,0),parts=car.children.filter(child=>!wheels.includes(child));
  body.position.copy(pivot);car.add(body);
  for(const part of parts){part.position.sub(pivot);body.add(part);}
  const dynamics=createBrakeDynamics(options);let disposed=false,brakingBefore=false,lastSpeed=0,joltAge=1,joltStrength=0,joltDuration=.85,applied=dynamics.state();
  const apply=value=>{
    const envelope=options.reducedMotion||joltAge>=joltDuration?0:joltStrength*Math.pow(1-joltAge/joltDuration,2);
    const roll=envelope?Math.sin(joltAge*69)*envelope*.115:0,shakePitch=envelope?Math.sin(joltAge*53)*envelope*.055:0;
    body.rotation.set(value.pitch+shakePitch,Math.sin(joltAge*43)*envelope*.022,roll);
    body.position.set(pivot.x+Math.sin(joltAge*81)*envelope*.075,pivot.y-value.heave+Math.sin(joltAge*59)*envelope*.045,pivot.z);
    applied={...value,roll,shake:envelope};return applied;
  };
  const jolt=(strength,duration)=>{if(disposed||options.reducedMotion)return false;joltStrength=Math.max(joltStrength*(1-Math.min(1,joltAge/joltDuration)),clamp(Number.isFinite(strength)?strength:0,0,1));joltDuration=duration;joltAge=0;return joltStrength>0;};
  const controller={
    body,
    update(input={}){
      if(disposed)return applied;
      const speed=Math.abs(input.speed||0),braking=Boolean(input.braking);
      if(input.paused||input.dt>.25){joltAge=1;joltStrength=0;brakingBefore=false;lastSpeed=0;}
      else {
        if(braking&&!brakingBefore&&Math.max(speed,lastSpeed)>1.5)jolt(.62,.52);
        joltAge+=Math.max(0,Math.min(.1,input.dt||0));brakingBefore=braking;lastSpeed=speed;
      }
      return apply(dynamics.update(input));
    },
    impact(intensity=1){return jolt(intensity,.85);},
    reset(){joltAge=1;joltStrength=0;brakingBefore=false;lastSpeed=0;return apply(dynamics.reset());},
    state:()=>applied,
    dispose(){
      if(disposed)return;controller.reset();disposed=true;
      for(const part of [...body.children]){part.position.add(pivot);car.add(part);}
      body.removeFromParent();controllers.delete(car);
    },
  };
  controllers.set(car,controller);return controller;
}
