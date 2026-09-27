import {escapeDetail as e} from './resource-story';
import './site-map.css';
type Site = Record<string,any>;
export function mappedSites(sites:Site[]) {return sites.filter(s=>s.location&&Number.isFinite(s.location.latitude)&&Math.abs(s.location.latitude)<=85&&Number.isFinite(s.location.longitude)&&Math.abs(s.location.longitude)<=180);}
export function mountSiteMap(root:HTMLElement,sites:Site[],select:(site:Site)=>void){
  const mapped=mappedSites(sites);
  root.innerHTML=`<div class="site-map"><div class="site-map-heading"><span><b>Site locations</b><small>${mapped.length} of ${sites.length} sites have a reported location · Zoom in to explore streets</small></span><div class="map-controls"><button aria-label="Fit all sites" data-map-fit>Fit sites</button></div></div><div class="map-canvas" role="region" aria-label="Interactive site map"></div><div class="map-footer"><span><i></i> Connected <i class="offline"></i> Needs attention</span><small data-map-note>Locations reported by UniFi · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">Report a map issue</a></small></div></div>`;
  const canvas=root.querySelector<HTMLElement>('.map-canvas')!;
  if(!mapped.length){canvas.innerHTML='<p class="map-empty">No geographic coordinates reported. Explore the sites below.</p>';return;}
  void import('leaflet').then(L=>{
    if(!root.isConnected)return;
    const map=L.map(canvas,{scrollWheelZoom:false,attributionControl:true,zoomControl:true});
    map.attributionControl.setPrefix(false);
    const bounds=L.latLngBounds(mapped.map(s=>[s.location.latitude,s.location.longitude] as [number,number]));
    const fit=()=>map.fitBounds(bounds,{padding:[45,45],maxZoom:14,animate:false});
    fit();
    // Browser caching follows the tile service headers. Only visible tiles are
    // fetched; origin-only referrers never disclose a machine/site identifier.
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,keepBuffer:0,updateWhenIdle:true,referrerPolicy:'origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}).addTo(map);
    let errors=0;
    tiles.on('tileerror',()=>{if(++errors>2)root.querySelector('[data-map-note]')!.textContent='Base map unavailable. Site markers and details remain available.';});
    const groups=new Map<string,Site[]>();
    for(const site of mapped){const key=site.location.latitude.toFixed(5)+','+site.location.longitude.toFixed(5);groups.set(key,[...(groups.get(key)||[]),site]);}
    for(const group of groups.values()){
      const site=group[0],offline=group.some(s=>s.state!=='connected');
      const marker=L.marker([site.location.latitude,site.location.longitude],{title:group.map(s=>s.name).join(' · '),keyboard:true,icon:L.divIcon({className:'site-pin'+(offline?' offline':''),html:`<span>${group.length>1?group.length:mapped.indexOf(site)+1}</span>`,iconSize:[30,30],iconAnchor:[15,15]})}).addTo(map);
      marker.bindTooltip(group.length===1?e(site.name):group.length+' sites at this location',{direction:'top',offset:[0,-14]});
      if(group.length===1) marker.on('click',()=>select(site));
      else {
        const list=document.createElement('div');list.className='map-site-options';
        list.innerHTML='<b>Sites at this location</b>'+group.map((s,i)=>`<button data-site-choice="${i}">${e(s.name)}<small>${e(s.state)}</small></button>`).join('');
        list.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.onclick=()=>{map.closePopup();select(group[Number(b.dataset.siteChoice)]);});
        marker.bindPopup(list);
      }
      marker.getElement()?.setAttribute('aria-label',group.length===1?'Inspect '+site.name:'Inspect '+group.length+' sites at this location');
    }
    L.control.scale({imperial:false}).addTo(map);
    root.querySelector('[data-map-fit]')!.addEventListener('click',fit);
    const resize=new ResizeObserver(()=>map.invalidateSize({animate:false}));resize.observe(canvas);
    const life=new MutationObserver(()=>{if(!root.isConnected){life.disconnect();resize.disconnect();map.remove();}});life.observe(document.body,{childList:true,subtree:true});
  }).catch(()=>{if(root.isConnected)canvas.innerHTML='<p class="map-empty">The map could not load. Explore the sites below.</p>';});
}
