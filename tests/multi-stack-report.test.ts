import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSnapshot, type RepositorySnapshot } from "../src/lib/analyzer";
import { neutralReport, reportLabel } from "../src/lib/report-summary";
test("generic import risks are checked and headlined outside Next.js",()=>{
  for(const packages of [{vite:"7"},{express:"5"},{nuxt:"4"},{astro:"5"},{"@sveltejs/kit":"2"}]){
    const files={"package.json":JSON.stringify({dependencies:packages}),"src/index.ts":"import Thing from './thing'; export default Thing;","src/Thing.ts":"export default 1;"};
    const snapshot:RepositorySnapshot={owner:"fixture",name:"web",defaultBranch:"main",contents:new Map(Object.entries(files)),entries:Object.keys(files).map(path=>({path,type:"blob"})),sourceFilesFound:2,sourceFilesRead:2,partial:false};
    const results=analyzeSnapshot(snapshot);const imports=results.checks.find(c=>c.id==="imports");
    assert.equal(imports?.status,"red");assert.equal(imports?.category,"vercel");assert.equal(results.checks.filter(c=>c.id==="imports").length,1);
    assert.equal(results.checks.some(c=>c.id==="next-entry"),false);assert.equal(neutralReport(results),false);assert.doesNotMatch(reportLabel(results),/Not a Next|limited/);
  }
});
