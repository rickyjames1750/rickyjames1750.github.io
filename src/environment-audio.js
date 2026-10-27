import * as T from 'three';

// Express scene motion relative to the current listener, sharing the exact
// positions used to render the vehicles. No looping audio files or network assets.
export function environmentAudio({listener,train,trainSpeed=0,cameraQuaternion,drone,braking=false,day=false}){
 const relative=new T.Vector3().subVectors(train,listener),right=new T.Vector3(1,0,0).applyQuaternion(cameraQuaternion);
 return{braking,trainDistance:relative.length(),trainSpeed,trainPan:T.MathUtils.clamp(relative.dot(right)/12,-1,1),droneDistance:drone?.distance,droneSpeed:drone?.speed,dronePan:drone?T.MathUtils.clamp(drone.position.clone().sub(listener).dot(right)/10,-1,1):0,birdActivity:day?.85:.55};
}
