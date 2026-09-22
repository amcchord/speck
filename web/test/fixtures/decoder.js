
import Guacamole from 'guacamole-common-js';
import {useReliableImageDecoder} from '../../src/remote-startup';
let bitmapCalls=0;
window.createImageBitmap=()=>{bitmapCalls++; return Promise.reject(new Error('Simulated ImageBitmap failure'));};
const display=new Guacamole.Display(),layer=display.getDefaultLayer();
display.statisticWindow=1000;
let flushed=0;display.onstatistics=()=>flushed++;
useReliableImageDecoder(display,Guacamole,navigator.userAgent);
document.querySelector('#screen').append(display.getElement());
display.resize(layer,64,64);
function stream(data){
 const input=new Guacamole.InputStream({sendAck(){}},1);
 display.drawStream(layer,0,0,input,'image/png');
 input.onblob(data);input.onend();
}
stream(btoa('intentionally broken image'));
const source=document.createElement('canvas');source.width=64;source.height=64;
source.getContext('2d').fillStyle='#385d44';source.getContext('2d').fillRect(0,0,64,64);
stream(source.toDataURL().split(',')[1]);
display.flush(()=>{
 const pixel=layer.getCanvas().getContext('2d').getImageData(20,20,1,1).data;
 const pass=bitmapCalls===0 && pixel[0]===56 && pixel[1]===93 && pixel[2]===68;
 document.querySelector('#result').textContent=(pass?'PASS':'FAIL')+' — Corrupt image unblocked; following valid frame rendered.\nImageBitmap calls: '+bitmapCalls+'\nPixel: '+Array.from(pixel).join(',');
},Date.now(),1);
setTimeout(()=>{if(document.querySelector('#result').textContent.startsWith('Running'))document.querySelector('#result').textContent='FAIL — frame remained blocked';},4000);
