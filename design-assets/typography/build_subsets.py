from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.merge import Merger
from fontTools.varLib.instancer import instantiateVariableFont
import json,hashlib,argparse,tempfile
root=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser(description='Regenerate the fixed-copy UI font subsets')
parser.add_argument('--display-source',type=Path,required=True)
args=parser.parse_args()
scratch=tempfile.TemporaryDirectory(prefix='yingya-fonts-')
out=root/'web/src/assets/typography';out.mkdir(exist_ok=True)
texts={name:record['characters'] for name,record in json.loads((out/'coverage.json').read_text()).items()}

def cut(font,chars):
 opts=subset.Options();opts.layout_features=[]
 ss=subset.Subsetter(options=opts);ss.populate(unicodes=[ord(c) for c in chars]);ss.subset(font)
 return font

def save(font,name):
 for record in font['name'].names:
  if record.nameID in (1,4,6):record.string=('Yingya '+name).replace(' ','') if record.nameID==6 else 'Yingya '+name
 font.flavor='woff2';p=out/(name.lower()+'.woff2');font.save(p)
 return p
f=TTFont(args.display_source)
assert set(map(ord,texts['display']))<=set(f.getBestCmap())
save(cut(f,texts['display']),'Display')
for name, folder in [('note', root/'node_modules/@chinese-fonts/lxgwwenkai/dist/LXGWWenKai-Regular'), ('serif', root/'node_modules/@fontsource-variable/noto-serif-sc/files')]:
 remaining=set(map(ord,texts[name]));parts=[]
 for p in sorted(folder.glob('*.woff2')):
  f=TTFont(p);found=remaining&set(f.getBestCmap())
  if not found:continue
  f=cut(f,''.join(map(chr,found)))
  if 'fvar' in f:f=instantiateVariableFont(f,{'wght':900},inplace=True)
  f.flavor=None
  dest=Path(scratch.name)/f'{name}-{len(parts)}.ttf';f.save(dest);parts.append(str(dest));remaining-=found
  if not remaining:break
 assert not remaining,remaining
 font=Merger().merge(parts);save(font,name.title())
manifest={name:{'characters':''.join(sorted(set(text))),'bytes':(out/(name+'.woff2')).stat().st_size,'sha256':hashlib.sha256((out/(name+'.woff2')).read_bytes()).hexdigest()} for name,text in texts.items()}
(out/'coverage.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(manifest,ensure_ascii=False,indent=2))

scratch.cleanup()
