import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedback, readPreferences } from './feedback.js';

function environment() {
  const media = new Map();
  let time = 1000, stored = null;
  const nodes = [], pulses = [], animations = [];
  class Animation extends EventTarget {
    cancel() { this.cancelled = true; this.dispatchEvent(new Event('cancel')); }
    finish() { this.dispatchEvent(new Event('finish')); }
  }
  function element() {
    return { style:{}, setAttribute(){}, remove(){nodes.splice(nodes.indexOf(this),1);},
      getBoundingClientRect:()=>({left:200,top:100,width:30,height:30}),
      animate(frames,options){const a=new Animation();a.frames=frames;a.options=options;animations.push(a);return a;}
    };
  }
  const storage = {getItem:()=>stored,setItem:(_key,value)=>{stored=value;}};
  const view = {innerWidth:1000,innerHeight:800,performance:{now:()=>time},getComputedStyle:()=>({backgroundColor:'#fff',color:'#000'}),
    matchMedia(query){if(!media.has(query)){const m=new EventTarget();m.matches=query.includes('coarse');media.set(query,m);}return media.get(query);}};
  const doc = {hidden:false,documentElement:{dataset:{}},addEventListener(){},createElement:element,body:{append:node=>nodes.push(node)}};
  const device = {vibrate:pattern=>{pulses.push(pattern);return true;}};
  return {view,doc,device,storage,nodes,pulses,animations,element,media,advance:ms=>time+=ms};
}

test('feedback preferences validate and survive unavailable storage',()=>{
  assert.deepEqual(readPreferences({getItem:()=>'{bad'}),{motion:true,vibration:true});
  assert.deepEqual(readPreferences({getItem:()=>'{"motion":false,"vibration":false}'}),{motion:false,vibration:false});
  assert.deepEqual(readPreferences({getItem(){throw Error();}}),{motion:true,vibration:true});
});
test('haptics are touch-only, throttled, optional, and fail harmlessly',()=>{
  const env=environment(), feel=createFeedback(env);
  assert.equal(feel.haptic('keep'),true);assert.deepEqual(env.pulses,[8]);
  assert.equal(feel.haptic('keep'),false);env.advance(200);
  assert.equal(feel.haptic('vote'),true);assert.deepEqual(env.pulses[1],[12,40,18]);
  feel.toggle('vibration');env.advance(200);assert.equal(feel.haptic('vote'),false);
  feel.toggle('vibration');env.media.get('(any-pointer: coarse)').matches=false;
  assert.equal(feel.canVibrate,false);assert.equal(feel.haptic('keep'),false);
  env.media.get('(any-pointer: coarse)').matches=true;env.device.vibrate=()=>{throw Error('denied');};
  assert.equal(feel.haptic('keep'),false);delete env.device.vibrate;assert.equal(feel.haptic('keep'),false);
});
test('new effects cancel the previous effect and held presses release cleanly',()=>{
  const env=environment(), feel=createFeedback(env), el=env.element();
  const press=feel.animate(el,[{transform:'scale(.97)'}],{fill:'forwards'});press.finish();
  const release=feel.animate(el,[{transform:'none'}]);assert.equal(press.cancelled,true);
  feel.cancel();assert.equal(release.cancelled,true);
});
test('reduced motion cancels in-flight effects, suppresses vibration, and cannot be overridden',()=>{
  const env=environment(), feel=createFeedback(env), el=env.element();
  feel.transfer({left:10,top:200,width:40,height:40},el,'Answer A');assert.equal(env.nodes.length,1);
  const reduced=env.media.get('(prefers-reduced-motion: reduce)');reduced.matches=true;reduced.dispatchEvent(new Event('change'));
  assert.equal(feel.motion,false);assert.equal(env.nodes.length,0);assert.equal(feel.haptic('vote'),false);
  feel.toggle('motion');feel.toggle('motion');assert.equal(feel.motion,false);
  assert.equal(feel.animate(el,[{}]),null);assert.equal(env.doc.documentElement.dataset.motion,'off');
});
test('turning motion off persists, removes transient chips, and unsupported animation cleans up',()=>{
  const env=environment(), feel=createFeedback(env);
  feel.transfer({left:10,top:200,width:40,height:40},env.element(),'Answer A');
  feel.toggle('motion');assert.equal(env.nodes.length,0);assert.equal(readPreferences(env.storage).motion,false);
  let cleaned=false;feel.animate({},[{}],{},()=>{cleaned=true;});assert.equal(cleaned,true);
  feel.toggle('motion');cleaned=false;feel.animate({},[{}],{},()=>{cleaned=true;});assert.equal(cleaned,true);
});
