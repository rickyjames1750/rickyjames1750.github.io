import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const materials = new Map();
function material(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({ color, roughness: .72, ...extra }));
  return materials.get(key);
}
const palette = {
  metal: material('#7c888c', { metalness: .9, roughness: .25 }),
  body: material('#727f82', { metalness: .82, roughness: .2 }),
  dark: material('#111d28', { metalness: .6, roughness: .25 }),
  rubber: material('#15202a', { roughness: .95 }),
  glass: material('#132c3d', { metalness: .75, roughness: .13 }),
  white: material('#dce5e3', { metalness: .32, roughness: .38 }),
  red: material('#c8363e', { metalness: .38, roughness: .38 }),
  led: material('#c2ffff', { emissive: '#91ecff', emissiveIntensity: 4, roughness: .2 }),
  tail: material('#ff4551', { emissive: '#f11928', emissiveIntensity: 3 }),
  window: material('#6ba5b1', { metalness: .6, roughness: .2, emissive: '#224b61', emissiveIntensity: .45 }),
  warm: material('#f2d39a', { emissive: '#f9b95e', emissiveIntensity: 1.4 }),
};
function add(parent, geometry, mat, x = 0, y = 0, z = 0) {
  const mesh = new T.Mesh(geometry, typeof mat === 'string' ? material(mat) : mat);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function box(parent, w, h, d, mat, x = 0, y = 0, z = 0) { return add(parent, new T.BoxGeometry(w, h, d), mat, x, y, z); }
function cylinder(parent, r1, r2, h, mat, x = 0, y = 0, z = 0, n = 16) { return add(parent, new T.CylinderGeometry(r1, r2, h, n), mat, x, y, z); }
function roundedBox(w, h, d, radius = .1, steps = 3) {
  const r = Math.min(radius, w / 2 - .001, h / 2 - .001, d / 2 - .001);
  const shape = new T.Shape();
  const x = -w / 2 + r, y = -h / 2 + r, sw = w - 2 * r, sh = h - 2 * r;
  shape.moveTo(x, y); shape.lineTo(x + sw, y); shape.lineTo(x + sw, y + sh); shape.lineTo(x, y + sh); shape.closePath();
  const g = new T.ExtrudeGeometry(shape, { depth: d - 2 * r, bevelEnabled: true, bevelSegments: steps, steps: 1, bevelSize: r, bevelThickness: r, curveSegments: 4 });
  g.translate(0, 0, -(d - 2 * r) / 2); g.computeVertexNormals(); return g;
}
function round(parent, w, h, d, mat, x, y, z, r = .1) { return add(parent, roundedBox(w, h, d, r), mat, x, y, z); }
function rod(parent, from, to, radius, mat, segments = 8) {
  const a = new T.Vector3(...from), b = new T.Vector3(...to), vector = b.clone().sub(a);
  const m = cylinder(parent, radius, radius, vector.length(), mat);
  m.position.copy(a.add(b).multiplyScalar(.5)); m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), vector.normalize()); return m;
}
function profile(parent, points, width, mat) {
  const s = new T.Shape(); points.forEach(([z, y], i) => i ? s.lineTo(z, y) : s.moveTo(z, y)); s.closePath();
  const g = new T.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelSegments: 3, bevelSize: .055, bevelThickness: .055, steps: 1 });
  g.translate(0, 0, -width / 2); g.rotateY(-Math.PI / 2); return add(parent, g, mat);
}
function text(parent, label, x, y, z, width, color = '#d8f4f4', rotation = 0) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 512, 128); ctx.fillStyle = color;
  ctx.font = '500 52px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 256, 64);
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  const m = add(parent, new T.PlaneGeometry(width, width / 4), new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }), x, y, z);
  m.rotation.y = rotation; m.castShadow = false; return m;
}


// Static architecture shares materials, so a handful of batches can replace hundreds of meshes.
function batchStatic(root, excluded = []) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(), batches = new Map();
  root.traverse(object => {
    if (!object.isMesh || object.isInstancedMesh || Array.isArray(object.material) || object.material.transparent) return;
    let ancestor = object;
    while (ancestor && ancestor !== root) { if (excluded.includes(ancestor)) return; ancestor = ancestor.parent; }
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
    if (!batches.has(object.material)) batches.set(object.material, []);
    batches.get(object.material).push({ object, geometry });
  });
  for (const [mat, items] of batches) {
    if (items.length < 2) { items.forEach(i => i.geometry.dispose()); continue; }
    const geometry = mergeGeometries(items.map(i => i.geometry), false);
    if (geometry) {
      const batch = new T.Mesh(geometry, mat); batch.castShadow = true; batch.receiveShadow = true; root.add(batch);
      items.forEach(i => { i.object.removeFromParent(); i.object.geometry.dispose(); });
    }
    items.forEach(i => i.geometry.dispose());
  }
}

// Original model informed by the Gravity's long wheelbase, panoramic cabin, and light signature.
export function createGravityCar() {
  const car = new T.Group(); car.name = 'Gravity-inspired electric SUV';
  profile(car, [[-2.45,.48],[-2.56,.88],[-2.42,1.13],[-1.8,1.35],[.6,1.31],[1.6,1.18],[2.5,1.02],[2.58,.62],[2.25,.46]], 2.12, palette.body);
  profile(car, [[-1.94,1.22],[-1.52,1.83],[-1.08,1.94],[.66,1.9],[1.45,1.28]], 1.87, palette.glass);
  round(car, 1.98, .09, 2.62, palette.dark, 0, 1.95, -.28, .04);
  round(car, 1.78, .025, 2.42, material('#264859', { metalness: .9, roughness: .09 }), 0, 2.005, -.28, .012);
  // A narrow metallic roof surround and sill trim articulate the body in grazing light.
  for (const side of [-1, 1]) {
    rod(car, [side*.96,1.96,-1.5], [side*.96,1.92,.84], .025, palette.metal);
    rod(car, [side*.98,1.85,.75], [side*1.02,1.29,1.44], .045, palette.body);
    rod(car, [side*.99,1.29,-1.99], [side*.98,1.85,-1.5], .065, palette.body);
    box(car, .045,.6,.055, palette.dark, side*.995,1.57,-.22);
    box(car, .05,.025,3.6, palette.metal, side*1.09,.66,-.1);
    box(car, .045,.04,.25, palette.metal, side*1.095,1.15,.55);
    box(car, .045,.04,.25, palette.metal, side*1.095,1.15,-.95);
    round(car,.26,.17,.4,palette.body,side*1.18,1.29,1.08,.05);
    box(car,.04,.1,.28,palette.glass,side*1.33,1.3,1.06);
    // Wheel-arch trim follows a partial torus.
    for (const z of [-1.55,1.52]) {
      const arch = add(car, new T.TorusGeometry(.49,.04,5,20,Math.PI), palette.dark, side*1.085,.48,z);
      arch.rotation.y = Math.PI/2;
    }
  }
  round(car,1.95,.07,.055,palette.led,0,1.04,2.55,.025);
  box(car,1.7,.14,.045,palette.dark,0,.8,2.6);
  round(car,1.5,.055,.045,palette.metal,0,.63,2.61,.02);
  round(car,2,.065,.055,palette.tail,0,1.11,-2.49,.025);
  box(car,1.72,.22,.08,palette.dark,0,.56,-2.51);
  box(car,.36,.12,.02,palette.white,0,.77,-2.56);
  text(car,'L U C I D',0,1.04,-2.56,.58,'#d5dfdf',Math.PI);
  const wheels = [];
  for (const side of [-1,1]) for (const z of [-1.55,1.52]) {
    const wheel = new T.Group(); wheel.position.set(side*1.07,.45,z); car.add(wheel); wheels.push(wheel);
    const tyre = cylinder(wheel,.445,.445,.28,palette.rubber,0,0,0,32); tyre.rotation.z = Math.PI/2;
    const rim = cylinder(wheel,.335,.335,.025,palette.metal,side*.15,0,0,24); rim.rotation.z = Math.PI/2;
    const inner = cylinder(wheel,.28,.28,.03,palette.dark,side*.17,0,0,24); inner.rotation.z = Math.PI/2;
    const hub = cylinder(wheel,.095,.095,.045,palette.metal,side*.2,0,0,16); hub.rotation.z = Math.PI/2;
    for (let i=0;i<5;i++) {
      const a=i*Math.PI*2/5, spoke=box(wheel,.045,.075,.56,palette.metal,side*.195,0,0); spoke.rotation.x=a;
    }
    const disc = cylinder(wheel,.25,.25,.03,material('#8e9d9e',{metalness:.85,roughness:.4}),side*.1,0,0,24); disc.rotation.z=Math.PI/2;
  }
  car.userData.wheels = wheels;
  car.userData.wheelRadius = .445;
  car.userData.wheelCenters = wheels.map(w => ({x:w.position.x,y:w.position.y,z:w.position.z}));
  batchStatic(car, wheels);
  car.updateMatrixWorld(true);
  car.userData.wheelBottom = Math.min(...wheels.map(w => new T.Box3().setFromObject(w).min.y));
  const measured = new T.Box3().setFromObject(car);
  car.userData.bounds = {min:measured.min.toArray(),max:measured.max.toArray()};
  car.userData.collisionHalfExtents={x:Math.max(-measured.min.x,measured.max.x),z:Math.max(-measured.min.z,measured.max.z)};
  car.userData.grounding = {wheelBottom:car.userData.wheelBottom,wheelRadius:.445,axleZ:[-1.55,1.52],trackWidth:2.14};
  return car;
}

export function createCaltrain() {
  const train = new T.Group(); train.name='Electric Caltrain — original stylized model';
  const carriageData=[];
  for(let i=0;i<3;i++) {
    const offset=8-i*8.25;
    const carriage=new T.Group();carriage.name=['North driving cab','Pantograph carriage','South driving cab'][i];
    carriage.position.z=offset;train.add(carriage);
    const wheelCenters=[],wheelMeshes=[];
    round(carriage,2.55,3.2,7.7,palette.white,0,2.25,0,.2);
    round(carriage,2.58,.65,7.75,palette.red,0,3.65,0,.13);
    box(carriage,2.62,.44,7.8,palette.dark,0,.9,0);
    for(const side of [-1,1]) {
      for(const y of [1.65,2.8]) for(let j=0;j<7;j++) {
        round(carriage,.035,.62,.65,palette.glass,side*1.293,y,-2.8+j*.86,.015);
      }
      for(const dz of [-2.2,2.2]) {
        box(carriage,.04,1.72,.63,palette.metal,side*1.3,1.6,dz);
        box(carriage,.047,.58,.4,palette.glass,side*1.326,2.03,dz);
        box(carriage,.05,.03,.58,palette.warm,side*1.327,2.52,dz);
      }
      const brand=cylinder(carriage,.3,.3,.035,palette.red,side*1.33,2.2,0,24);brand.rotation.z=Math.PI/2;
      text(carriage,'Caltrain',side*1.35,2.18,0,.55,'#fff3e6',side*Math.PI/2);
      for(const dz of [-2.55,2.55]) for(const w of [-.35,.35]) {
        const wheel=cylinder(carriage,.31,.31,.18,palette.rubber,side*1.04,.5,dz+w,14);wheel.rotation.z=Math.PI/2;
        wheelCenters.push({x:side*1.04,y:.5,z:dz+w});wheelMeshes.push(wheel);
      }
    }
    if(i<2)round(carriage,1.85,2.5,.45,palette.dark,0,2.1,-4.1,.13);
    box(carriage,1.85,.14,2.4,palette.metal,0,3.98,-.6);
    carriageData.push({group:carriage,offset,wheelCenters,wheelMeshes,axleOffsets:[-2.9,-2.2,2.2,2.9]});
  }
  // End cabs belong to their own carriage, so curves cannot tear a cab away from its body.
  const front=carriageData[0].group,rear=carriageData[2].group;
  round(front,2.45,2.9,.65,palette.red,0,2.1,4,.25);
  const wind=round(front,1.93,1.15,.08,palette.glass,0,2.88,4.39,.035);wind.rotation.x=-.13;
  round(front,1.76,.63,.08,palette.white,0,1.85,4.39,.04);
  for(const x of [-.87,.87])round(front,.35,.13,.07,palette.led,x,1.31,4.41,.025);
  box(front,.6,.14,.07,palette.dark,0,.91,4.42);
  text(front,'Caltrain',0,1.82,4.45,.95,'#303a40');
  text(front,'SAN FRANCISCO',0,3.04,4.45,1.42,'#d4e9da');
  round(rear,2.45,2.9,.65,palette.red,0,2.1,-3.95,.25);
  const rearWind=round(rear,1.93,1.15,.08,palette.glass,0,2.88,-4.33,.035);rearWind.rotation.x=.13;
  round(rear,1.76,.63,.08,palette.white,0,1.85,-4.33,.04);
  for(const x of [-.87,.87])round(rear,.35,.13,.07,palette.tail,x,1.31,-4.35,.025);
  text(rear,'Caltrain',0,1.82,-4.38,.95,'#303a40',Math.PI);
  const middle=carriageData[1].group;
  const pantograph = new T.Group(); pantograph.position.set(0,4.02,-.35);middle.add(pantograph);
  for(const x of [-.4,.4]) {
    rod(pantograph,[x,0,-.8],[x,.9,.35],.035,palette.dark);
    rod(pantograph,[x,.9,.35],[x,1.3,-.4],.035,palette.dark);
  }
  box(pantograph,1.8,.06,.16,palette.metal,0,1.32,-.4);
  train.userData.pantograph=pantograph;
  train.updateMatrixWorld(true);
  const wheelBottom=Math.min(...carriageData.flatMap(data=>data.wheelMeshes.map(w=>new T.Box3().setFromObject(w).min.y)));
  // Keep groups independent. The world controller may place each center on its own arc-length sample.
  for(const data of carriageData) {
    batchStatic(data.group,[pantograph]);
    delete data.wheelMeshes;
    data.wheelBottom=wheelBottom;
    data.group.userData.offset=data.offset;
  }
  train.updateMatrixWorld(true);
  const measured=new T.Box3().setFromObject(train),pantographBounds=new T.Box3().setFromObject(pantograph);
  train.userData.carriages=carriageData;
  train.userData.wheelBottom=wheelBottom;
  train.userData.wheelRadius=.31;
  train.userData.effectiveWheelRadius=.5-wheelBottom;
  train.userData.wheelCenters=carriageData.flatMap(data=>data.wheelCenters.map(p=>({...p,z:p.z+data.offset})));
  train.userData.bounds={min:measured.min.toArray(),max:measured.max.toArray()};
  train.userData.length=measured.max.z-measured.min.z;
  train.userData.width=measured.max.x-measured.min.x;
  train.userData.contactHeight=pantographBounds.max.y;
  train.userData.pantographContact={x:0,y:pantographBounds.max.y,z:-1};
  train.userData.grounding={wheelBottom,nominalWheelRadius:.31,effectiveWheelRadius:.5-wheelBottom,trackWidth:2.08};
  return train;
}

function tree(parent,x,z,scale=1) {
  cylinder(parent,.09*scale,.13*scale,1.4*scale,'#514b46',x,.6+.7*scale,z,7);
  const foliage=add(parent,new T.IcosahedronGeometry(.7*scale,1),material('#4b7667'),x,.6+1.5*scale,z);foliage.scale.set(.8,1.3,.8);
}
function building(parent,x,z,w,d,h,color='#b7c9c6',windows=true) {
  round(parent,w,h,d,material(color,{metalness:.25,roughness:.55}),x,.6+h/2,z,Math.min(.15,w/8));
  if(windows && h>2) {
    // Single instanced mesh per facade keeps the city inexpensive to draw.
    const floors=Math.min(16,Math.floor(h/.75)), cols=Math.max(2,Math.floor(w/.7));
    const pane=new T.InstancedMesh(new T.PlaneGeometry(.28,.35),palette.window,floors*cols);const dummy=new T.Object3D();let n=0;
    for(let f=0;f<floors;f++)for(let c=0;c<cols;c++) {dummy.position.set(x-w/2+(c+.5)*w/cols,1.15+f*.7,z+d/2+.015);dummy.updateMatrix();pane.setMatrixAt(n++,dummy.matrix);}
    parent.add(pane);
  }
  box(parent,w*.76,.13,d*.74,material('#42686a'),x,h+.72,z);
}

export function createLandmarks(scene, project) {
  const root = new T.Group(); root.name='Bay Area architectural landmarks';scene.add(root);
  const at=(lon,lat)=>{const p=project(lon,lat);return new T.Vector3(p.x,0,p.z);};
  const animated=[], colliders=[];
  const collider=(lon,lat,r)=>colliders.push({...project(lon,lat),r});
  // Golden Gate's clear driving span joins its approaches at the exact deck-top endpoints.
  const bridge=new T.Group();bridge.name='Golden Gate Bridge';bridge.position.copy(at(-122.4783,37.8199));root.add(bridge);
  const vermilion=material('#d25b40',{metalness:.45,roughness:.4});
  const deckLength=15,deckWidth=5.4,deckTop=2.4,towerX=2.9,railX=2.55;
  box(bridge,deckWidth,.4,deckLength,material('#344956'),0,deckTop-.2,0);
  const towerColliders=[];
  for(const x of [-towerX,towerX]) {
    // Guardrails define the driveable envelope without putting tower piers in a lane.
    rod(bridge,[Math.sign(x)*railX,2.9,-deckLength/2],[Math.sign(x)*railX,2.9,deckLength/2],.07,vermilion);
    rod(bridge,[Math.sign(x)*railX,2.58,-deckLength/2],[Math.sign(x)*railX,2.58,deckLength/2],.045,vermilion);
    for(let i=0;i<=20;i++)box(bridge,.045,.53,.045,vermilion,Math.sign(x)*railX,2.665,-7.5+i*.75);
    for(const z of [-3.65,3.65]) {
      box(bridge,.5,11.2,.65,vermilion,x,5.6,z);
      box(bridge,.85,.6,.95,vermilion,x,.6,z);
      towerColliders.push({x:bridge.position.x+x,z:bridge.position.z+z,r:.43});
    }
  }
  // The lowest transverse beam clears the scaled SUV roof by more than .9 world units.
  for(const z of [-3.65,3.65])for(const y of [4.3,7.2,10.3])box(bridge,6.3,.3,.55,vermilion,0,y,z);
  for(const x of [-towerX,towerX]) {
    const points=[];
    for(let i=0;i<=80;i++) {
      const z=-7.5+i/80*15;let y;
      if(z<-3.65)y=3.2+(z+7.5)/3.85*7.6;
      else if(z>3.65)y=10.8-(z-3.65)/3.85*7.6;
      else y=5.2+5.6*(z/3.65)**2;
      points.push(new T.Vector3(x,y,z));
      if(i%3===0)rod(bridge,[x,deckTop,z],[x,y,z],.025,vermilion,5);
    }
    add(bridge,new T.TubeGeometry(new T.CatmullRomCurve3(points),100,.07,6,false),vermilion);
  }
  for(let i=0;i<20;i++)box(bridge,.08,.018,.3,palette.warm,0,deckTop+.014,-7.2+i*.75);
  for(const x of [-2.13,2.13])box(bridge,.07,.012,deckLength-.08,material('#d6c99e'),x,deckTop+.009,0);
  const south=new T.Vector3(bridge.position.x,deckTop,bridge.position.z+deckLength/2);
  const north=new T.Vector3(bridge.position.x,deckTop,bridge.position.z-deckLength/2);
  const bridgeMetadata={
    id:'golden-gate',name:'Golden Gate Bridge',root:bridge,center:new T.Vector3(bridge.position.x,deckTop,bridge.position.z),
    endpoints:{south,north},centerline:[south.clone(),north.clone()],deckTop,width:deckWidth,roadWidth:4.2,
    driveHalfWidth:2.1,railInnerHalfWidth:railX-.07,lowestCrossbarBottom:4.15,towerColliders,
    vegetationBounds:new T.Box3(new T.Vector3(bridge.position.x-5,-10,north.z-4),new T.Vector3(bridge.position.x+5,20,south.z+4)),
  };
  colliders.push(...towerColliders);

  const sf=new T.Group();sf.position.copy(at(-122.398,37.789));root.add(sf);
  // Salesforce Tower's taper and rounded crown.
  const tower=material('#536f7d',{metalness:.65,roughness:.28});
  cylinder(sf,1.3,2.25,22,tower,0,11.6,0,28);
  const crown=add(sf,new T.SphereGeometry(1.3,24,12,0,Math.PI*2,0,Math.PI/2),palette.window,0,22.6,0);crown.scale.y=1.5;
  for(let y=2;y<22.7;y+=.75) {
    const r=2.25-(y-.6)/22*.95;const ring=add(sf,new T.TorusGeometry(r+.012,.018,4,32),palette.metal,0,y,0);ring.rotation.x=Math.PI/2;
  }
  for(let i=0;i<16;i++){const a=i/16*Math.PI*2;rod(sf,[Math.sin(a)*2.25,.8,Math.cos(a)*2.25],[Math.sin(a)*1.3,22.5,Math.cos(a)*1.3],.02,palette.metal);}
  const surrounding=[[-5,-4,2.2,2.8,9],[-6,5,2.6,2.4,12],[6,-6,2.5,2.8,16],[7,7,2,2.5,7],[-9,5,2.7,2.2,6],[0,-8,2.4,2.5,10],[10,-4,2,2,5]];
  surrounding.forEach((a,i)=>building(sf,...a,i%2?'#91a4a6':'#c9d0c8'));
  // Salesforce Park: an elevated, landscaped linear roof rather than another tower.
  const roofPark=new T.Group();roofPark.position.set(3.7,0,.6);sf.add(roofPark);
  round(roofPark,3.2,1.4,11.5,material('#b1bfba'),0,1.3,0,.5);
  round(roofPark,3,.12,11.2,material('#5b846b'),0,2.07,0,.5);
  const roofTrees=new T.Group();roofTrees.position.y=1.47;roofPark.add(roofTrees);
  for(let i=0;i<8;i++)tree(roofTrees,i%2?-.7:.65,-4.4+i*1.2,.48);

  const park=new T.Group();park.position.copy(at(-122.394,37.781));root.add(park);
  const oval=add(park,new T.CircleGeometry(1,40),material('#567b60'),0,.63,0);oval.rotation.x=-Math.PI/2;oval.rotation.z=-.65;oval.scale.set(.8,2.4,1);
  for(let i=0;i<9;i++){const z=-2+i*.5;tree(park,-.8,z,.48);tree(park,.8,z,.48);}
  building(park,-2,1,1.5,2.6,1.6,'#b69a85');building(park,2.2,-1,1.4,2.8,2.2,'#b0b8ac');
  // Brannan and the streets around the ellipse form a recognisable diagonal precinct.
  const streets=new T.Group();streets.rotation.y=.58;park.add(streets);
  for(const x of [-1.65,1.65])box(streets,.8,.035,6.2,material('#405153'),x,.65,0);
  for(const z of [-3.35,3.35])box(streets,4.1,.035,.75,material('#405153'),0,.65,z);
  const curbPoints=Array.from({length:81},(_,i)=>{const a=i/80*Math.PI*2;return new T.Vector3(Math.cos(a)*1.07,.69,Math.sin(a)*2.85);});
  add(streets,new T.TubeGeometry(new T.CatmullRomCurve3(curbPoints,true),90,.045,5,true),material('#a6b7a6'));
  const footpath=Array.from({length:65},(_,i)=>{const a=i/64*Math.PI*2;return new T.Vector3(Math.cos(a)*.53,.69,Math.sin(a)*2.05);});
  add(streets,new T.TubeGeometry(new T.CatmullRomCurve3(footpath,true),70,.07,4,true),material('#a9b79b'));
  for(const z of [-2.8,2.8])for(let i=0;i<4;i++)box(streets,.62,.015,.07,material('#d5d8c4'),1.65,.68,z+i*.11);
  for(const z of [-1.5,1.4])for(const x of [-.75,.75]) {
    box(streets,.32,.07,.45,material('#9a8063'),x,.93,z);
    box(streets,.05,.32,.4,palette.dark,x-.1,.78,z);
    cylinder(streets,.025,.025,.8,palette.metal,x,1.02,z+.34,7);
    const lamp=add(streets,new T.SphereGeometry(.06,8,6),palette.warm,x,1.48,z+.34);lamp.castShadow=false;
  }
  const spc=new T.Group();spc.position.set(-1.4,0,3.6);spc.rotation.y=.58;park.add(spc);
  box(spc,2.8,1.8,1.6,material('#945f4c'),0,1.5,0);
  box(spc,3,.12,1.8,material('#b8ae95'),0,2.47,0);
  for(let i=0;i<5;i++){box(spc,.32,.8,.04,palette.glass,-1.04+i*.52,1.7,.82);box(spc,.4,.06,.045,material('#ba9a7b'),-1.04+i*.52,2.12,.83);}
  box(spc,.4,1.17,.05,palette.dark,0,1.2,.85);
  box(spc,1.9,.3,.07,material('#1c3038'),0,2.22,.87);
  text(spc,'SOUTH PARK COMMONS',0,2.22,.92,1.65,'#efe2cb');
  text(spc,'380 BRANNAN',0,.82,.92,.9,'#e0cbb0');

  const stanford=new T.Group();stanford.position.copy(at(-122.1697,37.4275));stanford.scale.set(.55,1,.55);root.add(stanford);
  const sandstone=material('#d3b991'),terracotta=material('#a9684b');
  box(stanford,10,.18,8,material('#5a7c5f'),0,.67,0);
  for(const z of [-3,3]) {
    box(stanford,9,1.35,1.3,sandstone,0,1.4,z);
    const roofSection=new T.Shape();roofSection.moveTo(-.8,0);roofSection.lineTo(0,.55);roofSection.lineTo(.8,0);roofSection.closePath();
    const roofGeometry=new T.ExtrudeGeometry(roofSection,{depth:9.3,bevelEnabled:false,steps:1});roofGeometry.translate(0,0,-4.65);roofGeometry.rotateY(Math.PI/2);
    add(stanford,roofGeometry,terracotta,0,2.07,z);
    for(let i=0;i<9;i++){const arch=add(stanford,new T.TorusGeometry(.26,.065,6,12,Math.PI),sandstone,-4+i,1.36,z+.68);arch.rotation.z=0;box(stanford,.42,.65,.025,palette.dark,-4+i,.94,z+.69);}
  }
  box(stanford,1.5,7.8,1.5,sandstone,4,4.6,-1);
  for(const x of [3.55,4.45])box(stanford,.24,1.15,.03,palette.dark,x,7.6,-.23);
  cylinder(stanford,.9,.95,.3,sandstone,4,8.7,-1,12);
  const roof=add(stanford,new T.SphereGeometry(.82,12,8,0,Math.PI*2,0,Math.PI/2),terracotta,4,8.9,-1);roof.scale.y=.85;
  for(let i=0;i<7;i++)tree(stanford,-4+i*1.3,4.5,.65);

  const meta=new T.Group();meta.position.copy(at(-122.148,37.485));root.add(meta);
  round(meta,12,1.4,7,material('#abbab0'),0,1.3,0,.35);
  round(meta,11.7,.15,6.7,material('#5a8067'),0,2.08,0,.3);
  const metaTrees=new T.Group();metaTrees.position.y=1.48;meta.add(metaTrees);
  for(let i=0;i<25;i++)tree(metaTrees,-5+(i%8)*1.4,-2.3+Math.floor(i/8)*1.4,.45);
  const infinity=new T.CatmullRomCurve3(Array.from({length:81},(_,i)=>{const a=i/80*Math.PI*2;return new T.Vector3(Math.cos(a)*1.45,Math.sin(a*2)*.55+1.8,0);}));
  add(meta,new T.TubeGeometry(infinity,100,.075,7,true),material('#5fa7ef',{emissive:'#3278bf',emissiveIntensity:.6}),0,0,4.2);

  const google=new T.Group();google.position.copy(at(-122.084,37.422));root.add(google);
  for(const x of [-3.2,3.2]) {
    box(google,5.6,1.2,5.7,material('#bbc8c5'),x,1.2,0);
    // Bay View-inspired photovoltaic canopy, rendered as corrugated blue curves.
    for(let i=0;i<7;i++) {
      const strip=add(google,new T.CylinderGeometry(.65,.65,5.8,10,1,true,0,Math.PI),material('#3b6373',{metalness:.65,roughness:.3}),x-2.6+i*.86,2.1,0);
      strip.rotation.x=Math.PI/2;strip.rotation.z=Math.PI/2;
    }
  }
  for(let i=0;i<4;i++)cylinder(google,.18,.18,1.4,material(['#6098e3','#da5e50','#e2bc52','#68a77d'][i]),-1.5+i,1.3,4.5,12);

  const oakland=new T.Group();oakland.position.copy(at(-122.272,37.805));root.add(oakland);
  [[0,0,3,3,9],[4,2,2.2,2.4,6],[-4,2,2,2,7],[1,4,2.5,2.1,4],[-2,-3,2,2,5]].forEach(a=>building(oakland,...a,'#869e9f'));
  collider(-122.398,37.789,2.4);
  for(const [x,z,w,d] of surrounding){const origin=project(-122.398,37.789);colliders.push({x:origin.x+x,z:origin.z+z,r:Math.max(w,d)*.58});}
  const roofAnchor=project(-122.398,37.789);colliders.push({x:roofAnchor.x+3.7,z:roofAnchor.z+.6,r:2});
  const parkAnchor=project(-122.394,37.781);colliders.push({x:parkAnchor.x-1.4,z:parkAnchor.z+3.6,r:1.6});
  collider(-122.1697,37.4275,2.6);collider(-122.148,37.485,5.5);collider(-122.084,37.422,5.5);
  batchStatic(root);
  return { root, animated, colliders, bridge:bridgeMetadata };
}
