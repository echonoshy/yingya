"""Prepare original grain, local font subsets and an editable particle word."""
from pathlib import Path
import json, re, tempfile, shutil
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.merge import Merger
from fontTools.varLib.instancer import instantiateVariableFont

base=Path(__file__).resolve().parent;repo=base.parents[1]
out=base/'public/fonts';out.mkdir(parents=True,exist_ok=True)
text=''.join(p.read_text() for p in (base/'src').glob('*') if p.suffix in ['.tsx','.json'])
chars=set(map(ord,''.join(re.findall(r'[\u3400-\u9fff]',text))))|set(range(32,127))|set(map(ord,'，。→·—＋％'))
for name,package,weight in [('Sans','noto-sans-sc',900),('Serif','noto-serif-sc',700)]:
 with tempfile.TemporaryDirectory() as td:
  needed=chars.copy();parts=[]
  for i,p in enumerate(sorted((repo/f'node_modules/@fontsource-variable/{package}/files').glob('*.woff2'))):
   if 'wght' not in p.name or 'normal' not in p.name or 'slnt' in p.name:continue
   f=TTFont(p);keep=set(f.getBestCmap())&needed
   if not keep:continue
   if 'fvar' in f:instantiateVariableFont(f,{'wght':weight},inplace=True)
   options=subset.Options();options.layout_features=[]
   s=subset.Subsetter(options=options);s.populate(unicodes=keep);s.subset(f);f.flavor=None
   q=Path(td)/f'{i}.ttf';f.save(q);parts.append(str(q));needed-=keep
   if not needed:break
  f=Merger().merge(parts);f.flavor='woff2';f.save(out/f'{name}.woff2')
  print(name,'missing:',sorted(needed))
  if name=='Sans':
   f.flavor=None;ttf=Path(td)/'particle.ttf';f.save(ttf)
   font=ImageFont.truetype(str(ttf),390);box=font.getbbox('FORM');w=box[2]-box[0];h=box[3]-box[1]
   mask=Image.new('L',(w+20,h+20));ImageDraw.Draw(mask).text((10-box[0],10-box[1]),'FORM',font=font,fill=255)
   points=[];rng=np.random.default_rng(710)
   for y in range(0,h+20,4):
    for x in range(0,w+20,4):
     if mask.getpixel((x,y))>150 and rng.random()<.68:points.append([round((x-(w+20)/2)*1.03+rng.uniform(-1,1),2),round(y-(h+20)/2+rng.uniform(-1,1),2)])
   (base/'src/glyph-points.json').write_text(json.dumps(points,separators=(',',':'))+'\n');print('Particle points:',len(points))
shutil.copy2(base/'source-fonts/BodoniModa-Italic.ttf',out/'Editorial.ttf')
shutil.copy2(repo/'node_modules/@fontsource/fragment-mono/files/fragment-mono-latin-400-normal.woff2',out/'Mono.woff2')
(out/'licenses').mkdir(exist_ok=True)
shutil.copy2(base/'source-fonts/BodoniModa-OFL.txt',out/'licenses/BodoniModa-OFL.txt')
shutil.copy2(base/'source-fonts/Fragment-Mono-OFL.txt',out/'licenses/Fragment-Mono-OFL.txt')
rng=np.random.default_rng(72);noise=rng.normal(125,38,(512,512)).clip(0,255).astype('uint8');Image.fromarray(noise).save(base/'public/grain.png')
