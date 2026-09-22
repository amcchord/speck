import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'web/package.json'));
const { Resvg } = require('@resvg/resvg-js');
const assets = path.join(root, 'ios/Speck/Assets.xcassets');
const write = (name, value) => fs.writeFileSync(path.join(assets, name), JSON.stringify(value, null, 2) + '\n');
const png = (source, destination, width) => fs.writeFileSync(path.join(assets, destination), new Resvg(source, {fitTo: {mode: 'width', value: width}}).render().asPng());
fs.mkdirSync(path.join(assets,'AppIcon.appiconset'), {recursive:true});
fs.mkdirSync(path.join(assets,'Wordmark.imageset'), {recursive:true});
fs.mkdirSync(path.join(assets,'WordmarkLight.imageset'), {recursive:true});
fs.mkdirSync(path.join(assets,'Forest.colorset'), {recursive:true});
write('Contents.json', {info:{author:'xcode',version:1}});
const icon = fs.readFileSync(path.join(root,'brand/assets/speck-icon.svg'),'utf8').replace('rx="14"','');
png(icon, 'AppIcon.appiconset/AppIcon.png', 1024);
write('AppIcon.appiconset/Contents.json',{images:[{filename:'AppIcon.png',idiom:'universal',platform:'ios',size:'1024x1024'}], info:{author:'xcode',version:1}});
for (const [set,color] of [['Wordmark','forest'],['WordmarkLight','lime']]) {
  png(fs.readFileSync(path.join(root,`brand/assets/speck-wordmark-${color}.svg`),'utf8'), `${set}.imageset/wordmark.png`, 792);
  write(`${set}.imageset/Contents.json`,{images:[{filename:'wordmark.png',idiom:'universal'}],info:{author:'xcode',version:1}});
}
write('Forest.colorset/Contents.json',{colors:[{idiom:'universal',color:{'color-space':'srgb',components:{red:'0.098',green:'0.180',blue:'0.141',alpha:'1.000'}}}],info:{author:'xcode',version:1}});
