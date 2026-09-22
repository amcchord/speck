import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMicrophone } from '../src/microphone.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const calls = { tracks:0, closed:0, ended:0, source:0, node:0, packets:0 }, states=[], errors=[];
  const track = {stop: () => calls.tracks++};
  const media = {getTracks: () => [track]};
  const source = {connect() {}, disconnect: () => calls.source++};
  const node = {port:{onmessage:null},connect() {},disconnect: () => calls.node++};
  const context = {sampleRate:44100, destination:{},audioWorklet:{addModule:async()=>{}},resume:async()=>{},close:async()=>{calls.closed++},createMediaStreamSource:()=>source};
  const stream = {sendEnd:()=>calls.ended++};
  const writer = {onack:null,sendData:()=>calls.packets++};
  const env = {getUserMedia:async()=>media,createContext:()=>context,createNode:()=>node,createWriter:()=>writer};
  const client = {createAudioStream:type=>{assert.equal(type,'audio/L16;rate=44100,channels=1'); return stream;}};
  const start = () => startMicrophone(client,{state:s=>states.push(s),error:e=>errors.push(e)},env);
  return {calls,states,errors,media,node,writer,env,start};
}
test('mute stops tracks, nodes, context and upstream exactly once', async()=>{
  const h=harness(), recorder=h.start(); await tick();
  h.writer.onack({code:0}); assert.deepEqual(h.states,['starting','waiting','active']);
  h.node.port.onmessage({data:new ArrayBuffer(4096)}); assert.equal(h.calls.packets,1);
  recorder.stop(); recorder.stop();
  assert.deepEqual(h.calls,{tracks:1,closed:1,ended:1,source:1,node:1,packets:1});
  assert.equal(h.node.port.onmessage,null); assert.equal(h.states.at(-1),'stopped');
});
test('cancel during permission prompt releases any stream granted later',async()=>{
  const h=harness();let resolve;h.env.getUserMedia=()=>new Promise(r=>resolve=r);
  const recorder=h.start();recorder.stop();resolve(h.media);await tick();
  assert.equal(h.calls.tracks,1);assert.equal(h.calls.ended,0);assert.deepEqual(h.states,['starting','stopped']);
});
test('permission denial returns to idle without leaving capture active',async()=>{
  const h=harness();h.env.getUserMedia=async()=>{throw new Error('denied')};h.start();await tick();
  assert.equal(h.errors.length,1);assert.equal(h.states.at(-1),'stopped');assert.equal(h.calls.tracks,0);
});
test('upstream rejection tears down all capture resources',async()=>{
  const h=harness();h.start();await tick();h.writer.onack({code:0x300});
  assert.equal(h.errors.length,1);assert.equal(h.calls.tracks,1);assert.equal(h.calls.closed,1);assert.equal(h.calls.ended,1);
});
test('disconnect while the worklet loads cannot restart capture',async()=>{
  const h=harness();let resolve;h.env.createContext=()=>({audioWorklet:{addModule:()=>new Promise(r=>resolve=r)},close:async()=>h.calls.closed++});
  const recorder=h.start();await tick();recorder.stop();resolve();await tick();
  assert.equal(h.calls.tracks,1);assert.equal(h.calls.closed,1);assert.equal(h.calls.ended,0);
});
test('microphone remains ready until the remote application starts recording',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness(), recorder=h.start();await tick();
  t.mock.timers.tick(60000);
  assert.equal(h.states.at(-1),'waiting');assert.equal(h.errors.length,0);
  h.writer.onack({code:0});assert.equal(h.states.at(-1),'active');recorder.stop();
});
test('remote application ending recording is a normal close',async()=>{
  const h=harness();h.start();await tick();h.writer.onack({code:0});
  h.writer.onack({code:0x0206});
  assert.equal(h.errors.length,0);assert.equal(h.states.at(-1),'stopped');
  assert.equal(h.calls.tracks,1);assert.equal(h.calls.closed,1);
});
