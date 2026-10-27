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

/** Pure braking-response spring; pitch is positive for a forward nose dive. */
export function createBrakeDynamics({maxPitch=.035,maxHeave=.018,frequency=2.8,damping=.58,reducedMotion=false}={}) {
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
  const dynamics=createBrakeDynamics(options);let disposed=false;
  const apply=value=>{body.rotation.set(value.pitch,0,0);body.position.set(pivot.x,pivot.y-value.heave,pivot.z);return value;};
  const controller={
    body,
    update(input){return disposed?dynamics.state():apply(dynamics.update(input));},
    reset(){return apply(dynamics.reset());},
    state:()=>dynamics.state(),
    dispose(){
      if(disposed)return;controller.reset();disposed=true;
      for(const part of [...body.children]){part.position.add(pivot);car.add(part);}
      body.removeFromParent();controllers.delete(car);
    },
  };
  controllers.set(car,controller);return controller;
}
