/** Portrait browsing stays available; the driving game uses a wide two-thumb layout. */
export function landscapeRequired({width=0,height=0,coarse=false}={}){
 return Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>width&&(coarse||width<=760);
}
export function raceRotationBlocked(phase,viewport){return ['countdown','racing'].includes(phase)&&landscapeRequired(viewport);}
