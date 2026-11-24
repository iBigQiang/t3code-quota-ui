// Translate source-owned presentation strings before compiling the web renderer.
// Never walk user-authored chat, repository files or terminal output at runtime.
const fs = require("node:fs");
const path = require("node:path");
const ts = require(require.resolve("typescript", { paths: [process.cwd(),path.join(process.cwd(),"apps/web")] }));
const messages = JSON.parse(fs.readFileSync(path.join(__dirname,"messages.json"),"utf8"));
const src = path.resolve("apps/web/src");
const prop = /^(label|title|description|placeholder|aria-label|tooltip|emptyLabel|detail|subtitle|heading|actionLabel|emptyMessage|headerText)$/;
const language = 'globalThis.document?.documentElement.lang === "zh"';
let count = 0;
for(const name of fs.readdirSync(src,{recursive:true})) {
  if (!/\.tsx?$/.test(name) || /\.(test|spec|stories)\.|(__tests__|fixtures|i18n)\//.test(name)) continue;
  const filename=path.join(src,name), source=fs.readFileSync(filename,"utf8");
  const file=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true);
  const edits=[];
  function visit(n){
    const jsx=ts.isJsxText(n);
    if(jsx || ts.isStringLiteralLike(n)){
      const p=n.parent;
      const key=p.name?.getText(file);
      const attr=ts.isJsxAttribute(p)&&prop.test(key);
      const member=ts.isPropertyAssignment(p)&&prop.test(key);
      let container=p;
      while(ts.isConditionalExpression(container)||ts.isParenthesizedExpression(container)) container=container.parent;
      const rendered=ts.isJsxExpression(container) && (!ts.isJsxAttribute(container.parent)||prop.test(container.parent.name.getText(file)));
      if(jsx||attr||member||rendered){
        const raw=n.text, en=raw.trim().replace(/\s+/g," "), zh=Object.hasOwn(messages,en)?messages[en]:undefined;
        if(zh && !en.includes("&") && zh!==en){
          const enText=jsx?JSON.stringify(en):n.getText(file);
          const value='('+language+' ? '+JSON.stringify(zh)+' : '+enText+')';
          if(member && p.name && ts.isIdentifier(p.name) && !ts.isJsxAttribute(p.parent)){
            edits.push([p.getStart(file),p.end,'get '+key+'() { return '+value+'; }']);
          }else if(jsx){
            const start=n.pos, text=source.slice(start,n.end);
            edits.push([start,n.end,text.match(/^\s*/)[0]+'{'+value+'}'+text.match(/\s*$/)[0]]);
          }else edits.push([n.getStart(file),n.end,attr?'{'+value+'}':value]);
        }
      }
    }
    ts.forEachChild(n,visit);
  }
  visit(file);
  if(!edits.length)continue;
  let out=source;
  for(const [a,b,v] of edits.sort((x,y)=>y[0]-x[0])) out=out.slice(0,a)+v+out.slice(b);
  const parsed=ts.createSourceFile(filename,out,ts.ScriptTarget.Latest,true);
  if(parsed.parseDiagnostics.length)throw Error('Invalid localized source: '+filename);
  fs.writeFileSync(filename,out);count+=edits.length;
}
console.log('Localized renderer presentation sites:',count);
if(count<1000)throw Error('Renderer localization coverage below expected baseline');
// Notify quota widgets when the application locale changes, even after start-up.
const runtime = path.join(src,"i18n/runtime.ts");
const original = fs.readFileSync(runtime,"utf8");
const marker = "document.documentElement.lang = locale;";
if(!original.includes(marker)) throw Error("Cannot locate locale activation");
fs.writeFileSync(runtime,original.replace(marker,marker+'\n  (globalThis as typeof globalThis & { __t3QuotaUi?: { setLang: (lang: string) => void } }).__t3QuotaUi?.setLang(locale === "zh" ? "zh" : "en");'));
const provider=path.join(src,"i18n/I18nProvider.tsx");
fs.writeFileSync(provider,fs.readFileSync(provider,"utf8").replace('<GTProvider locale=', '<GTProvider key={locale} locale='));
// Keep the installer smoke test independent of the runner's desktop locale.
const smoke = path.resolve("scripts/smoke-desktop-app.ts");
fs.writeFileSync(smoke,fs.readFileSync(smoke,"utf8").replace('name: "Switch currency"', 'name: /Switch currency|切换币种/').replace('name: "Switch language"', 'name: /Switch language|切换语言/'));
