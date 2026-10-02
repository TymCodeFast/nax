#!/usr/bin/env python3
# Génère assets/icon.png, icon@512.png et icon.ico à partir de la géométrie de assets/icon.svg (même tracé, rendu PIL supersamplé).
# Usage : python scripts/make-icon.py  (depuis la racine du projet ; dépendance : Pillow)
from PIL import Image, ImageDraw
import os; os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
S=4; W=512*S
def P(*pts): return [(x*S,y*S) for x,y in pts]
img=Image.new('RGBA',(W,W),(0,0,0,0))
# fond : dégradé vertical masqué par un carré arrondi
grad=Image.new('RGBA',(W,W))
top=(0x1a,0x1f,0x2a); bot=(0x0c,0x0f,0x15)
gd=ImageDraw.Draw(grad)
for y in range(32*S,480*S):
    t=(y-32*S)/(448*S); c=tuple(int(top[i]+(bot[i]-top[i])*t) for i in range(3))
    gd.line([(0,y),(W,y)],fill=c+(255,))
mask=Image.new('L',(W,W),0)
ImageDraw.Draw(mask).rounded_rectangle([32*S,32*S,480*S,480*S],radius=104*S,fill=255)
img.paste(grad,(0,0),mask)
d=ImageDraw.Draw(img)
d.rounded_rectangle([33*S,33*S,479*S,479*S],radius=103*S,outline=(255,255,255,18),width=2*S)
white=(0xf4,0xf6,0xfa,255); acc=(0x4f,0x8e,0xf7,255)
d.rectangle(P((150,148),(202,364)),fill=white)
d.rectangle(P((310,148),(362,364)),fill=white)
d.polygon(P((150,148),(213,148),(362,364),(299,364)),fill=white)
d.polygon(P((299,148),(362,148),(213,364),(150,364)),fill=acc)
base=img.resize((1024,1024),Image.LANCZOS)
base.resize((256,256),Image.LANCZOS).save('assets/icon.png')
base.resize((512,512),Image.LANCZOS).save('assets/icon@512.png')
sizes=[16,24,32,48,64,128,256]
frames=[base.resize((s,s),Image.LANCZOS) for s in sizes]
frames[-1].save('assets/icon.ico',format='ICO',sizes=[(s,s) for s in sizes],append_images=frames[:-1])
print('ok : assets/icon.png, icon@512.png, icon.ico')
