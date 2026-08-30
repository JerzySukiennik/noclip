window.__shot = async (name, w=900, h=600, clean=true) => {
  const s = window.__nc(); const cv = document.querySelector('canvas');
  if (clean) { s.fx.u('uGlitch', 0); s.fx.u('uHurt', 0); s.fx.u('uTrack', 0.10); s.fx.u('uFade', 1); }
  s.renderer.setSize(w, h, false); s.camera.aspect = w/h; s.camera.updateProjectionMatrix();
  s.fx.render(s.scene, s.camera, s.T);
  const o = document.createElement('canvas'); o.width=w; o.height=h;
  o.getContext('2d').drawImage(cv, 0, 0, w, h);
  await fetch('http://127.0.0.1:8712/', {method:'POST', body: name + '|' + o.toDataURL('image/jpeg',0.82)});
  return 1;
};
window.__go = (zoneId, tries=900) => {
  const s = window.__nc(); const z = s.level.zones.find(z=>z.type.id===zoneId);
  if (!z) return 'no zone';
  for (let t=0;t<tries;t++){
    const cx = z.rect.x+2+((Math.random()*(z.rect.w-4))|0), cy = z.rect.y+2+((Math.random()*(z.rect.h-4))|0);
    if (s.level.isOpen(cx,cy)) { window.__nc.tp(cx,cy); window.__nc.tick(4,1/60); return cx+','+cy; }
  }
  return 'no cell';
};
window.__look = (yaw, pitch=0) => { const p=window.__nc().player; p.yaw=yaw; p.pitch=pitch; window.__nc.tick(2,1/60); };
window.__bright = () => {
  const cv=document.querySelector('canvas'); const o=document.createElement('canvas');
  o.width=120;o.height=80;o.getContext('2d').drawImage(cv,0,0,120,80);
  const d=o.getContext('2d').getImageData(0,0,120,80).data; let s=0,mx=0,clip=0;
  for(let i=0;i<d.length;i+=4){const l=(d[i]*.3+d[i+1]*.59+d[i+2]*.11);s+=l;mx=Math.max(mx,l);if(l>250)clip++;}
  return {mean:+(s/(d.length/4)).toFixed(1), max:mx|0, clipPct:+(100*clip/(d.length/4)).toFixed(1)};
};
'ready'
