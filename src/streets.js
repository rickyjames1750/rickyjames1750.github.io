import * as T from 'three';
import { CORRIDORS, createCorridorIndex, footprintDistanceToPolyline } from './corridors.js';
import { SURFACES } from './surfaces.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const stationNames = {
  about: ['SAN FRANCISCO', '4TH & KING'],
  experience: ['SOUTH SAN FRANCISCO', 'PENINSULA LINE'],
  projects: ['REDWOOD CITY', 'PENINSULA LINE'],
  education: ['PALO ALTO', 'PENINSULA LINE'],
  contact: ['MOUNTAIN VIEW', 'PENINSULA LINE'],
};

/** Original street and station furniture, built in each route's local tangent frame. */
export function createStreets(scene, { roadCurve, railCurve, zones, driveways = [] }) {
  const root = new T.Group(); root.name = 'Peninsula stations and streets'; scene.add(root);
  const corridor=createCorridorIndex(roadCurve,railCurve);
  const furnitureSources=[],furniture=(object,kind,zoneId=null)=>{furnitureSources.push({object,kind,zoneId});return object;};
  const crossesDriveway=(x,z,margin=.16)=>driveways.some(driveway=>driveway?.contains?.(x,z,margin));
  const groundSources=[];
  const ground=mesh=>{mesh.castShadow=false;mesh.receiveShadow=false;groundSources.push(mesh);return mesh;};
  const mats = new Map();
  function material(color, extra = {}) {
    const key = color + JSON.stringify(extra);
    if (!mats.has(key)) mats.set(key, new T.MeshStandardMaterial({color,roughness:.82,...extra}));
    return mats.get(key);
  }
  const pavement=material('#9aa69c'),edge=material('#c4c7ae'),asphalt=material('#53605b');
  const metal=material('#3b5154',{metalness:.55,roughness:.45}),wood=material('#9b8870');
  const tactile=material('#d6b25e',{roughness:.9}),green=material('#4d7563');
  const warm=material('#f4d2a0',{emissive:'#f5ba73',emissiveIntensity:1.2});
  const white=material('#c6d5c8'),signMat=material('#183f42');
  function mesh(parent,g,m,x=0,y=0,z=0) {const o=new T.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;}
  function box(parent,w,h,d,m,x,y,z) {const object=mesh(parent,new T.BoxGeometry(w,h,d),m,x,y,z);if(h<=.03){object.castShadow=false;object.receiveShadow=false;}return object;}
  function cylinder(parent,r,h,m,x,y,z,n=8) {const object=mesh(parent,new T.CylinderGeometry(r,r,h,n),m,x,y,z);if(r<=.035){object.castShadow=false;object.receiveShadow=false;}return object;}
  function frame(curve,t) {
    const p=curve.getPointAt(T.MathUtils.clamp(t,0,1)),d=curve.getTangentAt(T.MathUtils.clamp(t,0,1));
    return {p,d,angle:Math.atan2(d.x,d.z)};
  }
  function closest(curve,z) {let nearest=0,distance=Infinity;for(let i=0;i<=500;i++){const p=curve.getPointAt(i/500),d=(p.x-z.x)**2+(p.z-z.z)**2;if(d<distance){distance=d;nearest=i/500;}}return nearest;}
  function place(curve,t) {const {p,angle}=frame(curve,t),g=new T.Group();g.position.set(p.x,0,p.z);g.rotation.y=angle;root.add(g);return g;}
  function label(parent,title,subtitle,x,y,z,width=2.15,rotation=0) {
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#174044';ctx.fillRect(0,0,1024,256);
    ctx.fillStyle='#dbe8d6';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 64px sans-serif';ctx.fillText(title,512,105,960);
    ctx.fillStyle='#92b6a5';ctx.font='400 31px sans-serif';ctx.fillText(subtitle,512,186,960);
    ctx.fillStyle='#c54848';ctx.fillRect(0,0,1024,9);
    const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;
    const m=mesh(parent,new T.PlaneGeometry(width,width/4),new T.MeshBasicMaterial({map:tex}),x,y,z);m.rotation.y=rotation;m.castShadow=false;
    return m;
  }
  function bench(parent,x,z,rotate=0,y=1.12) {
    const b=new T.Group();b.position.set(x,y,z);b.rotation.y=rotate;parent.add(b);
    for(const side of [-.36,.36])box(b,.05,.28,.36,metal,side,.16,0);
    for(let i=0;i<3;i++)box(b,.92,.045,.105,wood,0,.33,-.115+i*.115);
    for(let i=0;i<2;i++)box(b,.92,.07,.045,wood,0,.48+i*.085,-.17);
    return furniture(b,'bench');
  }
  function lamp(parent,x,z,ground=.825,height=2.1) {
    const g=new T.Group();parent.add(g);const direction=Math.sign(x)||1;
    cylinder(g,.028,height,metal,x,ground+height/2,z);
    box(g,.32,.045,.17,metal,x+direction*.09,ground+height,z);
    box(g,.27,.025,.12,warm,x+direction*.09,ground+height-.034,z);
    return furniture(g,'lamp');
  }
  function planter(parent,x,z,length=.9,ground=.82) {
    const g=new T.Group();parent.add(g);
    box(g,.48,.28,length,material('#728b7b'),x,ground+.14,z);
    box(g,.42,.045,length-.06,material('#586c51'),x,ground+.295,z);
    for(let i=0;i<4;i++) {
      const tuft=mesh(g,new T.IcosahedronGeometry(.14,0),green,x+(i%2?.1:-.1),ground+.42,z-length*.3+i*length*.2);tuft.scale.set(.75,1,.7);
    }
    return furniture(g,'planter');
  }
  // Raised continuous curb and sidewalk geometry stays outside the 4.2-wide driving surface.
  function strip(offset,width,height,mat) {
    const samples=360,vertices=[],indices=[],uv=[];
    for(let i=0;i<=samples;i++) {
      const {p,d}=frame(roadCurve,i/samples),n=new T.Vector3(d.z,0,-d.x);
      for(const edge of [-.5,.5]) {const q=p.clone().addScaledVector(n,offset+edge*width);vertices.push(q.x,height,q.z);uv.push(edge+.5,i/samples);}
    }
    for(let i=0;i<samples;i++){
      const j=i*2,quad=[j,j+1,j+2,j+3].map(index=>({x:vertices[index*3],z:vertices[index*3+2]}));
      const probes=[...quad,{x:quad.reduce((a,p)=>a+p.x,0)/4,z:quad.reduce((a,p)=>a+p.z,0)/4}];
      for(const [a,b]of [[0,1],[0,2],[1,3],[2,3]])probes.push({x:(quad[a].x+quad[b].x)/2,z:(quad[a].z+quad[b].z)/2});
      if(probes.some(p=>crossesDriveway(p.x,p.z)))continue;
      indices.push(j,j+1,j+2,j+1,j+3,j+2);
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();
    const m=mesh(root,g,mat);m.name='Continuous sidewalk/curb with driveway openings';m.material.side=T.DoubleSide;m.castShadow=false;ground(m);return m;
  }
  for(const side of [-1,1]) {
    strip(side*2.32,.16,.837,edge);
    strip(side*2.75,.69,.825,pavement);
    strip(side*3.13,.07,.831,asphalt);
  }
  const roadLength=roadCurve.getLength(),lampCount=Math.max(8,Math.floor(roadLength/6));
  for(let i=0;i<lampCount;i++) {
    const t=(i+.3)/lampCount,g=place(roadCurve,t),side=i%2?1:-1;
    lamp(g,side*3.04,0,.825,1.9);
    // Tile joints, a modest planted verge, and occasional wayfinding diamonds.
    box(g,.62,.012,.025,material('#7b8e83'),side*2.75,.836,-.65);
    if(i%3===0)planter(g,side*3.6,.3,.8,SURFACES.land);
    if(i%5===0) {
      const sign=new T.Group();g.add(sign);
      cylinder(sign,.028,.75,metal,side*3.04,1.2,.85);
      const plaque=box(sign,.27,.27,.045,signMat,side*3.04,1.59,.85);plaque.rotation.z=Math.PI/4;
      const flash=box(sign,.1,.15,.052,material('#d6c68e'),side*3.04,1.59,.88);flash.rotation.z=-.25;furniture(sign,'wayfinding');
    }
  }
  const stations=[];
  for(const zone of zones) {
    const t=closest(railCurve,zone),g=place(railCurve,t),[title,subtitle]=stationNames[zone.id]||[zone.city.toUpperCase(),'PENINSULA LINE'];
    g.name=`${title} station platform`;stations.push({id:zone.id,t,root:g});
    // Local +X is the bay/east side of this southbound line; main road is west of rail.
    const center=CORRIDORS.stationPlatformCenter,width=CORRIDORS.stationPlatformWidth,length=8.8,inner=center-width/2;
    ground(box(g,width,.52,length,pavement,center,.86,0)); // top 1.12, above rail head 0.985
    ground(box(g,.085,.025,length-.1,tactile,inner+.09,1.135,0));
    ground(box(g,.025,.025,length-.1,edge,inner+.01,1.133,0));
    // Recessed tile joints give the platform a measured architectural rhythm.
    for(let i=0;i<12;i++)box(g,width-.18,.008,.017,material('#7f9488'),center+.04,1.125,-4.1+i*.72);
    for(const x of [center-.22,center+.28])box(g,.014,.008,length-.16,material('#7f9488'),x,1.125,0);
    // Lean canopy uses supports at its outer edge, well outside train clearance.
    const canopy=new T.Group();g.add(canopy);
    box(canopy,1.34,.1,4.9,metal,2.02,3.03,0);
    box(canopy,1.27,.035,4.8,white,2.02,3.09,0);
    for(const z of [-1.9,1.9]) {
      box(canopy,.07,1.89,.07,metal,2.49,2.065,z);
      box(canopy,1.15,.045,.06,metal,1.96,2.91,z);
    }
    for(const z of [-1.5,0,1.5])box(canopy,.55,.025,.1,warm,1.92,2.967,z);
    bench(g,2.28,-1.4,Math.PI/2);bench(g,2.28,1.4,Math.PI/2);
    planter(g,2.35,-3.35,1.0,1.12);planter(g,2.35,3.35,1.0,1.12);
    for(const z of [-3.9,3.9])lamp(g,2.55,z,1.12,1.45);
    // Sign parallel to the platform is legible from both sides of the train corridor.
    const board=new T.Group();board.position.set(2.71,0,0);board.rotation.y=-Math.PI/2;g.add(board);
    box(board,2.35,.62,.075,signMat,0,2.02,0);
    for(const x of [-.86,.86])box(board,.04,.73,.04,metal,x,1.425,0);
    label(board,title,subtitle,0,2.02,.045,2.25);
    label(board,title,subtitle,0,2.02,-.045,2.25,Math.PI);
    // A short accessible ramp and landing connect the outer platform edge to the town.
    ground(box(g,.8,.47,1.3,pavement,3.04,.835,-2.9));
    const ramp=ground(box(g,1.16,.12,1.3,pavement,4,.8,-2.9));ramp.rotation.z=-.36;
    ground(box(g,.8,.1,1.4,asphalt,4.75,.66,-2.9));
  }
  // Batch by material and shadow state so solid furniture cannot restore shadows on thin floors.
  // Sign textures remain one draw per board.
  root.updateMatrixWorld(true);
  // Collision-only world-space snapshots survive opaque batching without adding duplicate renderables.
  const proxyMaterial=new T.MeshBasicMaterial({side:T.DoubleSide});
  const groundMeshes=groundSources.map(source=>{const geometry=source.geometry.clone();geometry.applyMatrix4(source.matrixWorld);const proxy=new T.Mesh(geometry,proxyMaterial);proxy.name='Drivable station/street surface';proxy.updateMatrixWorld(true);return proxy;});
  const furnitureFootprints=[];
  for(const {object,kind,zoneId}of furnitureSources){
    const b=new T.Box3().setFromObject(object),footprint={kind,zoneId,x:(b.min.x+b.max.x)/2,z:(b.min.z+b.max.z)/2,w:b.max.x-b.min.x,d:b.max.z-b.min.z};
    // Clear a full conservative furniture footprint, not merely the pole/bench center.
    if(crossesDriveway(footprint.x,footprint.z,Math.hypot(footprint.w,footprint.d)/2+.4)){object.removeFromParent();continue;}
    furnitureFootprints.push(footprint);
  }
  // Defensive geometry contract: furniture stays outside both the live carriageway and running track.
  for(const footprint of furnitureFootprints){
    if(footprintDistanceToPolyline(footprint,corridor.road)<CORRIDORS.roadPavementHalfWidth+.05)throw new Error(`${footprint.kind} intrudes on the driving pavement.`);
    if(footprintDistanceToPolyline(footprint,corridor.rail)<CORRIDORS.railTrackHalfWidth+.08)throw new Error(`${footprint.kind} intrudes on the running track.`);
  }
  const inverse=root.matrixWorld.clone().invert(),batches=new Map();
  root.traverse(object=>{
    if(!object.isMesh||object.isInstancedMesh||object.material.map||Array.isArray(object.material))return;
    let g=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();
    g.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
    const key=`${object.material.uuid}|${Number(object.castShadow)}|${Number(object.receiveShadow)}`;
    if(!batches.has(key))batches.set(key,{mat:object.material,castShadow:object.castShadow,receiveShadow:object.receiveShadow,items:[]});
    batches.get(key).items.push({object,geometry:g});
  });
  for(const {mat,castShadow,receiveShadow,items} of batches.values()) {
    if(items.length<2){items.forEach(i=>i.geometry.dispose());continue;}
    const merged=mergeGeometries(items.map(i=>i.geometry),false);
    if(merged){const m=mesh(root,merged,mat);m.castShadow=castShadow;m.receiveShadow=receiveShadow;items.forEach(i=>{i.object.removeFromParent();i.object.geometry.dispose();});}
    items.forEach(i=>i.geometry.dispose());
  }
  root.userData.stations=stations.map(({id,t})=>({id,t}));
  root.userData.furnitureFootprints=furnitureFootprints;
  return {root,groundMeshes,furnitureFootprints};
}
