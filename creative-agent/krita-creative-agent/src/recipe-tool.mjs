// @ts-check
import { isPaintingMode } from './modes.mjs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Value } from 'typebox/value';
import { GENERATOR_VERSION, recipeSchema } from './stroke-generator.mjs';
import { gestureStrokes, directionField, maskInside } from './gesture-strokes.ts';
import { passShape, viewPixels } from './shapes/use.ts';
import { decodePlane } from './shapes/png.ts';

// What the generator may read about the place (gesture-strokes.ts GestureContext): the element's shape when the recipe
// names one (else the artist's Paint only here area), and, for follow_form or colour_from form, the direction field and
// colours of the goal image where it sits on the canvas, else of the canvas the painter last saw.
async function gestureContext(runtime, recipe, canvas) {
  /** @type {import('./gesture-strokes.ts').GestureContext} */ const context = {};
  /** @type {Record<string, any>} */ const report = {};
  let shape = null;
  if (recipe.inside_shape) {
    shape = await passShape(runtime, { inside_shape: recipe.inside_shape });
    const [, , w, h] = shape.bounds;
    context.inside = maskInside(decodePlane(await readFile(shape.mask_path), { width: w, height: h }), shape.bounds);
    report.inside = 'shape';
  }
  if (recipe.direction === 'follow_form' || recipe.colour_from === 'form') {
    const cache = { callNative: (op, params) => runtime.callNative(op, params), canvasPixels: null };
    const placed = runtime.finishGoal ? (await runtime.finishGoal(canvas).catch(() => null))?.goal ?? null : null;
    let field = null;
    if (placed?.reference?.path && Number(placed.reference.width) > 0) {
      const { pixels } = await viewPixels(cache, placed.reference.path, undefined, FORM_SIDE);
      const k = pixels.width / Number(placed.reference.width);
      field = directionField(pixels, { source: placed.source.map(v => v * k), target: placed.target }, recipe.region);
      if (field && field.coverage >= 0.5) report.form_from = 'goal image'; else field = null;
    }
    const seen = runtime.decisionObservation, path = seen?.unguided_path ?? seen?.image_path;
    if (!field && typeof path === 'string') {
      const { pixels } = await viewPixels(cache, path);
      const target = Array.isArray(seen.region) && seen.region.length === 4 ? seen.region.map(Number) : [0, 0, canvas.width, canvas.height];
      field = directionField(pixels, { source: [0, 0, pixels.width, pixels.height], target }, recipe.region);
      if (field) report.form_from = 'canvas';
    }
    if (field) { Object.assign(context, { flow: field.flow, edge: field.edge, colour: field.colour }); report.form_directed = Math.round(field.coherent * 100) / 100; }
  }
  return { context, shape, report };
}
// The goal image is read at this long side for the direction field: its marks stay a few cells wide.
const FORM_SIDE = 2048;

export function recipeTool(runtime,executePass) {
  return defineTool({name:'paint_recipe',label:'Painting generated strokes',executionMode:'sequential',parameters:recipeSchema,
    description:'Generate native brush curves locally from a compact recipe. Use for broad coverage, irregular scumbling and overlapping texture instead of writing hundreds of coordinates. Region is a rectangular clip (brush marks cannot cross it); irregularity 0 is ordered placement, 1 adds jitter, clumps, wander and cross-strokes. Direction is horizontal/vertical/diagonal/random, an angle in degrees, or follow_form: every stroke follows the form at its spot, which is what brushwork over a form needs (one direction word over a box reads as machine-made rows). inside_shape keeps the strokes to one element\u2019s own shape with a soft boundary. Length, angle, bend and spacing always vary a little, and every stroke has a pressure shape (taper by default). For brushwork over several areas (floor, wall, dress) send one paint_recipe call per area, not one batch of all: each area is then judged and kept on its own. Size, opacity and optional length are [min,max]; palette uses exactly the supplied colours. Seed makes the command plan repeatable. Runs saved, reversible paint_pass chunks of up to 256 curves; each chunk is a named layer, not an independent stage review. Stop prevents the next chunk. Returns the last canvas image and execution counts. Does not sample references automatically or guarantee a material effect; inspect the result.',
    execute:async(id,recipe,signal)=>{
      signal?.throwIfAborted();
      if(runtime.mode!==undefined && (!isPaintingMode(runtime.mode) || runtime.executionPhase!=='agent'))throw new Error('Painting recipes are only available in active Agent execution.');
      if(runtime.cancelRequested || runtime.faulted)throw new Error('Painting is stopped or needs recovery.');
      if(!Value.Check(recipeSchema,recipe))throw new Error('Invalid stroke recipe. Use the documented fields and numeric ranges.');
      const canvas={width:Number(runtime.decisionObservation?.width),height:Number(runtime.decisionObservation?.height)};
      if(!(canvas.width>0&&canvas.height>0))throw new Error('Recipe region must fit the observed canvas.');
      const {context,shape,report}=await gestureContext(runtime,recipe,canvas);
      signal?.throwIfAborted();
      const strokes=gestureStrokes(recipe,canvas,context);
      // Inside a shape the plugin keeps the paint to the shape's own mask; a box would cut the strokes at its sides.
      const limit=shape?{inside_shape:{mask_path:shape.mask_path,bounds:shape.bounds}}:{region:recipe.region};
      const key=createHash('sha256').update(id).digest('hex');
      const fingerprint=createHash('sha256').update(JSON.stringify(recipe)).digest('hex');
      const folder=join(runtime.study.directory,'recipes');await mkdir(folder,{recursive:true});
      const filename=join(folder,key+'.json');
      const persist=async record=>{await writeFile(filename+'.tmp',JSON.stringify(record)+'\n');await rename(filename+'.tmp',filename);};
      let old;
      try{old=JSON.parse(await readFile(filename,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      if(old){
        if(old.fingerprint!==fingerprint)throw new Error('Recipe operation ID was already used with different arguments.');
        // Never infer that a dispatched but unrecorded chunk is safe to repeat.
        if(old.status==='running' || old.status==='failed')throw new Error('This recipe has an interrupted execution record. Inspect its native operation receipts before starting more paint.');
        return {content:[{type:'text',text:JSON.stringify({...old.summary,replayed:true})}],details:{...old.summary,replayed:true}};
      }
      /** @type {Record<string, any>} */
      const record={version:GENERATOR_VERSION,fingerprint,recipe,canvas:{width:runtime.decisionObservation.width,height:runtime.decisionObservation.height},status:'running',chunks:[],summary:{requested_strokes:strokes.length,completed_strokes:0,completed_chunks:0,recipe_file:filename,...report}};
      await persist(record);
      let last;
      try {
        for(let offset=0;offset<strokes.length;offset+=256){
          if(signal?.aborted || runtime.cancelRequested)break;
          const index=offset/256;
          const operationId='recipe-'+key.slice(0,48)+'-'+index;
          runtime.emit({type:'status',phase:'painting',message:recipe.name+' · '+offset+'/'+strokes.length+' strokes completed'});
          last=await executePass(operationId,{name:recipe.name+' · '+(index+1),preset:recipe.preset,...limit,layer_opacity:recipe.layer_opacity??1,...(recipe.panel?{panel:recipe.panel}:{}),...(recipe.blend_mode?{blend_mode:recipe.blend_mode}:{}),...(recipe.clip_to?{clip_to:recipe.clip_to}:{}),strokes:strokes.slice(offset,offset+256)},signal);
          record.chunks.push({operation_id:operationId,strokes:Math.min(256,strokes.length-offset),layer_id:last.details?.layer_id,checkpoint:last.details?.checkpoint});
          record.summary.completed_strokes+=Math.min(256,strokes.length-offset);record.summary.completed_chunks++;
          await persist(record);
        }
        record.status=record.summary.completed_strokes===strokes.length?'complete':'stopped';
        record.summary.status=record.status;record.summary.chunks=record.chunks;
        await persist(record);
      } catch(error){
        record.status='failed';record.summary.status='failed';
        await persist(record).catch(()=>{});
        throw error;
      }
      return {content:[{type:'text',text:JSON.stringify(record.summary)},...(last?.content??[]).filter(c=>c.type==='image')],details:record.summary};
    }});
}
