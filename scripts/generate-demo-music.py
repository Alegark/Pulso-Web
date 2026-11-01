"""Three original procedural instrumental sketches. No external recordings or songs."""
from pathlib import Path
import array, hashlib, json, math, random, subprocess, sys, wave
ROOT=Path(__file__).resolve().parent.parent
RATE=22050
BEAT=.5
DURATION=16.5

def frequency(midi): return 440*2**((midi-69)/12)

def write_piece(name, seed, chords, melody, extension, codec):
    random.seed(seed)
    data=array.array('f',[0])*int(DURATION*RATE)
    def note(start,duration,midi,volume,bright=False):
        freq=frequency(midi)
        for i in range(int(duration*RATE)):
            index=int(start*RATE)+i
            if index>=len(data): break
            t=i/RATE
            envelope=min(1,t/.015)*math.exp(-t*(5 if bright else 2))*min(1,max(0,(duration-t)/.08))
            sound=math.sin(2*math.pi*freq*t)
            if bright: sound+=.28*math.sin(4*math.pi*freq*t)+.1*math.sin(6*math.pi*freq*t)
            data[index]+=volume*envelope*sound
    for beat in range(32):
        root=chords[(beat//4)%len(chords)]
        if beat%4==0:
            for interval in (0,4,7): note(beat*BEAT,1.9,root+interval,.085)
        note(beat*BEAT,.44,root-12,.12)
        for half in range(2):
            pitch=melody[(beat*2+half)%len(melody)]
            if pitch is not None: note((beat+half*.5)*BEAT,.38,pitch,.12,True)
        # Quiet kick/snare-like rhythmic texture, synthesized from deterministic noise.
        for i in range(int(.12*RATE)):
            index=int(beat*BEAT*RATE)+i
            if index>=len(data): break
            t=i/RATE
            data[index]+=.055*math.exp(-30*t)*math.sin(2*math.pi*(65*t-100*t*t))
            if beat%2: data[index]+=.018*math.exp(-45*t)*random.uniform(-1,1)
    peak=max(abs(v) for v in data) or 1
    pcm=array.array('h',(int(max(-1,min(1,v/peak*.65))*32767) for v in data))
    if sys.byteorder!='little':pcm.byteswap()
    staging=ROOT/'.local'/'demo-music';staging.mkdir(parents=True,exist_ok=True)
    wav=staging/(name+'.wav')
    with wave.open(str(wav),'wb') as w:w.setparams((1,2,RATE,0,'NONE','not compressed'));w.writeframes(pcm.tobytes())
    dest=ROOT/'public'/'samples'/(name+'.'+extension)
    args=[str(ROOT/'node_modules/@ffmpeg-installer/linux-x64/ffmpeg'),'-y','-i',str(wav),'-codec:a',codec,'-b:a','64k','-metadata','title='+name,'-metadata','artist=Pulso · muestra original','-metadata','album=Prueba instrumental']
    if codec=='aac':args+=['-profile:a','aac_low']
    subprocess.run(args+[str(dest)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    b=dest.read_bytes()
    return dict(id=name,file='/samples/'+dest.name,mime='audio/mp4' if extension=='m4a' else 'audio/mpeg',bytes=len(b),sha256=hashlib.sha256(b).hexdigest())

samples=[
write_piece('Aurora',1,[48,57,53,55],[72,76,79,None,76,74,72,None,69,72,76,79,76,None,74,72],'mp3','libmp3lame'),
write_piece('Brisa',2,[53,55,48,57],[77,None,81,79,77,76,74,None,72,76,None,79,81,79,76,None],'m4a','aac'),
write_piece('Camino',3,[55,53,57,48],[79,76,74,None,72,74,76,None,81,79,76,72,None,74,72,None],'mp3','libmp3lame')]
(ROOT/'src/demo-music.ts').write_text('import type {Fixture} from "./storage/assets";\nexport const demoMusic: Fixture[] = '+json.dumps(samples,ensure_ascii=False,indent=2)+';\n')
print('Generated 3 original instrumental samples, 16.5 seconds each.')
