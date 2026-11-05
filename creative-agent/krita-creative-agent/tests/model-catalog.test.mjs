import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {inheritPiCatalog} from '../src/model-catalog.mjs';
import {PaintingRuntime} from '../src/runtime.mjs';

/** A local OpenAI-compatible server that answers GET /v1/models with `listing` and remembers the key it was sent. */
async function modelServer(listing){
  let authorization='';
  const server=createServer((request,response)=>{
    authorization=request.headers.authorization ?? '';
    if(request.url!=='/v1/models'){response.writeHead(404).end();return;}
    response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(listing));
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  return {url:`http://127.0.0.1:${server.address().port}/v1`,authorization:()=>authorization,close:()=>new Promise(done=>server.close(done))};
}

const model=(id,input=['text','image'])=>({id,name:id,provider:'deepseek',api:'openai-completions',baseUrl:'https://api.deepseek.com',input,reasoning:false,
  contextWindow:64000,maxTokens:4096,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}});

test('Pi catalog inheritance refreshes matching routes and preserves private custom records without writing Pi files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'creative-catalog-')),pi=join(root,'pi'),output=join(root,'output');
  try{
    await mkdir(pi);await mkdir(output);
    const inherited={deepseek:{lastModified:Number.MAX_SAFE_INTEGER,models:[model('deepseek-flash'),model('deepseek-v4-pro',['text'])]}};
    const privateCatalog={deepseek:{models:[model('deepseek-flash',['text']),model('private-custom')]},privateProvider:{models:[{id:'local-model'}]}};
    const original=JSON.stringify(inherited);await writeFile(join(pi,'models-store.json'),original);
    await writeFile(join(output,'model-catalog.json'),JSON.stringify(privateCatalog));
    const file=await inheritPiCatalog(pi,output),saved=JSON.parse(await readFile(file,'utf8'));
    assert.deepEqual(saved.deepseek.models.find(m=>m.id==='deepseek-flash').input,['text','image']);
    assert.ok(saved.deepseek.models.some(m=>m.id==='private-custom'));
    assert.deepEqual(saved.privateProvider,privateCatalog.privateProvider);
    assert.equal(await readFile(join(pi,'models-store.json'),'utf8'),original);
    await inheritPiCatalog(pi,output);assert.equal(JSON.parse(await readFile(file,'utf8')).deepseek.models.length,3);
    await writeFile(join(pi,'models-store.json'),'{broken');
    const before=await readFile(file,'utf8');await assert.rejects(inheritPiCatalog(pi,output),/model catalog/);assert.equal(await readFile(file,'utf8'),before);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('real SDK initialization inherits official Pi routes, exposes text and batch entries, and restores additional custom connections',async()=>{
  const root=await mkdtemp(join(tmpdir(),'creative-model-runtime-')),pi=join(root,'pi'),output=join(root,'output');
  const events=[],bridge={async connect(){},async call(){return {status:'ok',protocol_version:2};}};
  const create=()=>new PaintingRuntime({root,config:{output,pi_agent_dir:pi},bridge,emit:e=>events.push(e)});
  const server=await modelServer({data:[{id:'first',name:'First',context_length:32000,top_provider:{max_completion_tokens:4000},architecture:{input_modalities:['text','image']}},
    {id:'second'},{id:'text-embedding',type:'embeddings'}]});
  let runtime;
  try{
    await mkdir(pi);await mkdir(output);
    await writeFile(join(pi,'auth.json'),JSON.stringify({deepseek:{type:'api_key',key:'test-only-auth'}}));
    await writeFile(join(pi,'models-store.json'),JSON.stringify({deepseek:{lastModified:Number.MAX_SAFE_INTEGER,models:[model('deepseek-flash'),model('deepseek-v4-pro',['text']),model('test-batch')]}}));
    await writeFile(join(pi,'models.json'),JSON.stringify({providers:{'pi-custom':{api:'openai-completions',baseUrl:'http://127.0.0.1:1/v1',apiKey:'test-config-only',models:[{...model('pi-custom-model'),provider:undefined}]}}}));
    runtime=create();await runtime.initialize();
    const rows=runtime.listModels();
    assert.ok(rows.some(m=>m.provider==='deepseek'&&m.id==='deepseek-flash'&&m.configured&&m.declared_images_supported));
    assert.ok(rows.some(m=>m.id==='deepseek-v4-pro'&&!m.declared_images_supported&&!m.painting_eligible&&m.interactive));
    assert.ok(rows.some(m=>m.id==='test-batch'&&!m.interactive));
    assert.ok(rows.some(m=>m.provider==='pi-custom'&&m.id==='pi-custom-model'));
    assert.ok(runtime.listProviders().some(p=>p.id==='deepseek'&&p.configured));
    // A custom endpoint: its own provider, the models its server lists, and only the limits the server reports.
    const connected=await runtime.configureProvider({name:'Companion custom',base_url:server.url,api_key:'custom-test-only'});
    assert.deepEqual(connected.models.sort(),['first','second']);
    assert.equal(connected.provider,'custom-companion-custom');
    assert.equal(server.authorization(),'Bearer custom-test-only');
    const saved=String(await readFile(join(output,'model-connections.json')));
    assert.ok(!saved.includes('custom-test-only'));
    const first=JSON.parse(saved)['custom-companion-custom'].models.find(m=>m.id==='first');
    assert.deepEqual(first,{id:'first',name:'First',contextWindow:32000,maxTokens:4000,input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},'an endpoint model is saved with a zero price');
    assert.deepEqual(JSON.parse(saved)['custom-companion-custom'].models.find(m=>m.id==='second'),{id:'second',name:'second',input:['text','image'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0}});
    await runtime.releaseLock();runtime=create();await runtime.initialize();
    assert.ok(runtime.models.getModel('custom-companion-custom','first'));assert.ok(runtime.models.getModel('custom-companion-custom','second'));
    assert.equal(runtime.models.getModel('custom-companion-custom','first').contextWindow,32000);
    assert.ok(runtime.models.getModel('deepseek','deepseek-flash'));assert.ok(runtime.models.hasConfiguredAuth('custom-companion-custom'));
  }finally{await runtime?.releaseLock();await server.close();await rm(root,{recursive:true,force:true});}
});

test('a provider Pi knows is connected with its key alone and keeps the limits of Pi\'s catalog',async()=>{
  const root=await mkdtemp(join(tmpdir(),'creative-known-provider-')),pi=join(root,'pi'),output=join(root,'output');
  const bridge={async connect(){},async call(){return {status:'ok',protocol_version:2};}};
  const offline=process.env.PI_OFFLINE;process.env.PI_OFFLINE='1';
  let runtime;
  try{
    await mkdir(pi);await mkdir(output);
    runtime=new PaintingRuntime({root,config:{output,pi_agent_dir:pi},bridge,emit(){}});await runtime.initialize();
    assert.equal(runtime.models.hasConfiguredAuth('anthropic'),false);
    const connected=await runtime.configureProvider({provider:'anthropic',api_key:'test-only-anthropic'});
    assert.equal(connected.provider,'anthropic');assert.ok(runtime.models.hasConfiguredAuth('anthropic'));
    const auth=JSON.parse(await readFile(join(pi,'auth.json'),'utf8'));
    assert.deepEqual(auth.anthropic,{type:'api_key',key:'test-only-anthropic'});
    const catalog=runtime.models.getModels('anthropic').find(m=>m.input.includes('image'));
    assert.ok(catalog.contextWindow>64000||catalog.maxTokens!==8192,'the limits come from Pi, not from Toska');
    assert.ok(runtime.listModels().some(m=>m.provider==='anthropic'&&m.configured&&m.painting_eligible));
    await assert.rejects(runtime.configureProvider({provider:'anthropic',api_key:''}),/API key/);
    await assert.rejects(runtime.configureProvider({provider:'no-such-provider',api_key:'k'}),/Choose a provider/);
  }finally{if(offline===undefined)delete process.env.PI_OFFLINE;else process.env.PI_OFFLINE=offline;await runtime?.releaseLock();await rm(root,{recursive:true,force:true});}
});
