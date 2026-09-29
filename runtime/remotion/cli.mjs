#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {initProject, buildPreview, checkProject, renderProject} from './engine.mjs';
try {
  const {values, positionals} = parseArgs({allowPositionals:true, options:{help:{type:'boolean'},project:{type:'string',default:'.'},output:{type:'string'},width:{type:'string'},height:{type:'string'},fps:{type:'string'},duration:{type:'string'},quality:{type:'string'},json:{type:'boolean'},snapshots:{type:'boolean'}}});
  if (values.help) {console.log('Usage: node runtime/remotion/cli.mjs init | build | check | render --project PATH [--output FILE] [--width N --height N --fps N --duration SECONDS]'); process.exit(0);}
  const options = Object.fromEntries(['width','height','fps','duration'].filter(k => values[k] !== undefined).map(k => [k,Number(values[k])]));
  let result;
  switch(positionals[0]) {
    case 'init': result = await initProject(values.project, options); break;
    case 'build': result = await buildPreview(values.project); break;
    case 'check': result = await checkProject(values.project); break;
    case 'render':
      if (!values.output) throw Error('render requires --output');
      result = {yingyaRemotion:await renderProject(values.project, values.output, {...options,quality:values.quality})}; break;
    default: throw Error('Use init | build | check | render --project PATH');
  }
  console.log(JSON.stringify(result));
} catch(error) {console.error(error.stack || String(error));process.exitCode=1;}
