const express=require('express'),http=require('http'),{WebSocketServer}=require('ws');
const app=express();app.use(express.static('public'));
const server=http.createServer(app),wss=new WebSocketServer({server,maxPayload:1024});
const newSeed=()=>Math.floor(Math.random()*0x7fffffff);
let seed=newSeed(),next=1;const peers=new Map();
const send=(w,o)=>{if(w.readyState===1)w.send(o)};
wss.on('connection',ws=>{
 const id=next++;peers.set(id,ws);
 send(ws,JSON.stringify({t:'i',id,seed}));
 ws.on('message',m=>{let d;try{d=JSON.parse(m)}catch{return}
  if(!d||d.t!=='s')return;
  const o=JSON.stringify({t:'s',id,x:+d.x||0,z:+d.z||0,y:+d.y||0,m:d.m?1:0,s:d.s?1:0,d:d.d?1:0});
  for(const [i,w] of peers)if(i!==id)send(w,o)});
 ws.on('close',()=>{peers.delete(id);const o=JSON.stringify({t:'l',id});for(const w of peers.values())send(w,o);if(!peers.size)seed=newSeed()});
});
server.listen(process.env.PORT||3000,()=>console.log('Backrooms server up'));
